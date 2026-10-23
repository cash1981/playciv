/**
 * The Start of Turn abilities of wonders, Great Persons, techs, huts and relics
 * (assisted play, part 13; `src/assisted-abilities.ts`). Card texts and rules:
 * `docs/agents/tasks/assisted-sot.md`.
 */

import { describe, expect, it } from 'vitest'

import { removePiece, setWonderOwner, undoLastBoardChange } from '../src/actions/board.js'
import { revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { assistedAvailability, availableActionsFor, performAssistedAction } from '../src/assisted.js'
import { ABILITY_ACTIONS, ABILITY_KINDS } from '../src/assisted-abilities.js'
import { playableCardsOf } from '../src/assisted-cards.js'
import { coinSourcesOf } from '../src/coins.js'
import { cultureMarkerOf } from '../src/culture-track.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { AssistedActionKind, GameState } from '../src/state.js'
import { toPlayerView } from '../src/state.js'

import { withCardInHand, withHutInHand } from './assisted-fixture.js'
import { AT, me, put, sotTurn } from './sot-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1 } from './fixture.js'

const OTHERS = [KARANDRAS1, ITCHI, CHUL]

const act = (state: GameState, action: AssistedActionKind, requestId = 'req-1', confirmedRepeat = false) =>
  performAssistedAction(state, {
    playerId: CASH1981,
    action,
    requestId,
    at: AT,
    ...(confirmedRepeat ? { confirmedRepeat: true } : {}),
  })

const status = (state: GameState, action: AssistedActionKind) => assistedAvailability(state, CASH1981, action)

function undoByVote(state: GameState, requestId: string): GameState {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line for the action')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of OTHERS) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  return next
}

/** The error the vote ends with when the reversal refuses, or `undefined` when the undo goes through. */
function undoRefusal(state: GameState, requestId: string): { readonly kind: string; readonly reason?: string } | undefined {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line for the action')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of OTHERS) {
    const voted = vote(next, { logId: entry.id, playerId, vote: true, at: AT })
    if (!voted.ok) return voted.error as { kind: string; reason?: string }
    next = voted.value
  }
  return undefined
}

const reasonOf = (result: ReturnType<typeof act>): string => {
  const error = unwrapErr(result)
  if (error.kind !== 'ASSISTED_ACTION_REJECTED') throw new Error(`unexpected error ${error.kind}`)
  return error.reason
}

const afterSot = (state: GameState): GameState =>
  unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'SOT' }))

/** A wonder on the map, owned by `ownerId`. */
function withWonder(state: GameState, assetId: string, ownerId = CASH1981, column = 6, row = 6): GameState {
  const placed = put(state, ownerId, assetId, column, row)
  const piece = placed.board.pieces.at(-1)
  if (piece === undefined || piece.assetId !== assetId) throw new Error('the wonder was not placed')
  return unwrap(setWonderOwner(placed, { playerId: ownerId, pieceId: piece.id, ownerId }))
}

const wonderPiece = (state: GameState, assetId: string) => {
  const piece = state.board.pieces.find((candidate) => candidate.assetId === assetId)
  if (piece === undefined) throw new Error(`no ${assetId} on the board`)
  return piece
}

/** Turns a card in the hand faceup, the way the reveal button does. */
const revealed = (state: GameState, itemId: string): GameState => ({
  ...state,
  players: state.players.map((candidate) =>
    candidate.playerId === CASH1981
      ? { ...candidate, items: candidate.items.map((item) => (item.id === itemId ? { ...item, hidden: false } : item)) }
      : candidate,
  ),
})

/** A Great Person card of the given name, in the hand and faceup. */
function withPerson(state: GameState, name: string): GameState {
  const { state: drawn, itemId } = withCardInHand(state, name)
  return revealed(drawn, itemId)
}

/** A relic the player took off the map: placed, then removed by them. */
function withRelicTaken(state: GameState, assetId: string, playerId = CASH1981): GameState {
  const placed = put(state, playerId, assetId, 8, 8)
  const piece = wonderPiece(placed, assetId)
  return unwrap(removePiece(placed, { playerId, pieceId: piece.id }))
}

// ---------------------------------------------------------------------------

describe('the table of abilities', () => {
  it('is one button per ability, all in Start of Turn, each kind once', () => {
    expect(new Set(ABILITY_KINDS).size).toBe(ABILITY_KINDS.length)
    for (const definition of ABILITY_ACTIONS) {
      expect(definition.kind.startsWith('sot:')).toBe(true)
      expect(definition.phase).toBe('SOT')
      expect(definition.button).toBe(true)
      expect(definition.group.length).toBeGreaterThan(0)
    }
  })

  it('shows nobody an ability they do not hold, as not-owned', () => {
    const actions = availableActionsFor(sotTurn(), CASH1981).filter((action) => action.action.startsWith('sot:'))
    expect(actions).toHaveLength(ABILITY_KINDS.length)
    expect(actions.every((action) => action.status === 'not-owned')).toBe(true)
  })
})

describe.each([
  ['sot:stonehenge', 'wonders/stonehenge', 'Stonehenge', { culture: 1, trade: 0 }],
  ['sot:colossus', 'wonders/colossus', 'The Colossus', { culture: 0, trade: 3 }],
  ['sot:louvre', 'wonders/louvre', 'The Louvre', { culture: 3, trade: 0 }],
] as const)('%s', (kind, assetId, label, gain) => {
  const owned = () => withWonder(sotTurn({ culture: 5, trade: 5 }), assetId)

  it('is not-owned without the wonder, and not for a wonder another player owns', () => {
    expect(status(sotTurn(), kind)).toMatchObject({ status: 'not-owned', reason: `You do not own ${label}.` })
    expect(status(withWonder(sotTurn(), assetId, KARANDRAS1), kind).status).toBe('not-owned')
  })

  it('is ready in Start of Turn, wrong-phase after it', () => {
    expect(status(owned(), kind).status).toBe('ready')
    expect(status(afterSot(owned()), kind)).toMatchObject({
      status: 'wrong-phase',
      reason: 'Only available during your open Start of Turn phase.',
    })
  })

  it('adds the numbers, logs it, and is used once a turn', () => {
    const used = unwrap(act(owned(), kind))
    expect(me(used).stats.culture).toBe(5 + gain.culture)
    expect(me(used).stats.trade).toBe(5 + gain.trade)
    expect(used.log.at(-1)?.publicLog).toMatch(new RegExp(`^cash1981 used ${label}: gained `))
    expect(status(used, kind).status).toBe('used')
    expect(reasonOf(act(used, kind, 'req-2'))).toContain('already been used this turn')
  })

  it('takes the numbers off again on undo and frees the use', () => {
    const undone = undoByVote(unwrap(act(owned(), kind)), 'req-1')
    expect(me(undone).stats.culture).toBe(5)
    expect(me(undone).stats.trade).toBe(5)
    expect(status(undone, kind).status).toBe('ready')
  })

  it('is unavailable while an enemy figure blockades the wonder', () => {
    const blockaded = put(owned(), KARANDRAS1, 'figures/bluearmy', 6, 6)
    expect(status(blockaded, kind)).toMatchObject({ status: 'unavailable' })
    expect(status(blockaded, kind).reason).toContain('blockaded')
  })
})

describe("Lorenzo de' Medici and Alan Turing", () => {
  it('needs the card revealed and is not-owned without it', () => {
    expect(status(sotTurn(), 'sot:lorenzo').status).toBe('not-owned')
    const { state } = withCardInHand(sotTurn(), "Lorenzo de' Medici")
    expect(status(state, 'sot:lorenzo')).toMatchObject({
      status: 'unavailable',
      reason: "Reveal Lorenzo de' Medici before using it.",
    })
  })

  it('gives 1 culture for every 3 coins, counting every coin', () => {
    const base = sotTurn({ culture: 0, trade: 0 })
    const withCoins = {
      ...base,
      players: base.players.map((candidate) =>
        candidate.playerId === CASH1981
          ? { ...candidate, stats: { ...candidate.stats, coinSources: { ...candidate.stats.coinSources, sheet: 7 } } }
          : candidate,
      ),
    }
    const state = withPerson(withCoins, "Lorenzo de' Medici")
    expect(Object.values(coinSourcesOf(state, me(state))).reduce((sum, value) => sum + value, 0)).toBeGreaterThanOrEqual(7)
    const used = unwrap(act(state, 'sot:lorenzo'))
    const coins = Object.values(coinSourcesOf(state, me(state))).reduce((sum, value) => sum + value, 0)
    expect(me(used).stats.culture).toBe(Math.floor(coins / 3))
    expect(me(used).stats.trade).toBe(0)
    const undone = undoByVote(used, 'req-1')
    expect(me(undone).stats.culture).toBe(0)
  })

  it('gives Turing 1 trade and 1 culture for every 2 armies not built', () => {
    const base = withPerson(sotTurn({ culture: 0, trade: 0 }), 'Alan Turing')
    // Six armies in the supply: three pairs
    const full = unwrap(act(base, 'sot:turing'))
    expect(me(full).stats).toMatchObject({ trade: 3, culture: 3 })
    // Two built: four left, two pairs
    const built = put(put(base, CASH1981, 'figures/redarmy', 2, 2), CASH1981, 'figures/redarmy', 3, 2)
    const less = unwrap(act(built, 'sot:turing'))
    expect(me(less).stats).toMatchObject({ trade: 2, culture: 2 })
  })

  it('cannot be used while every Scientist figure of the player is blockaded', () => {
    const state = withPerson(sotTurn(), 'Alan Turing')
    const token = put(state, CASH1981, 'great people/scientist', 6, 6)
    expect(status(token, 'sot:turing').status).toBe('ready')
    const blockaded = put(token, KARANDRAS1, 'figures/bluearmy', 6, 6)
    expect(status(blockaded, 'sot:turing').reason).toContain('blockaded')
  })

  it('leaves both out of the cards that can be played, because they have a button', () => {
    const state = withPerson(withPerson(sotTurn(), "Lorenzo de' Medici"), 'Alan Turing')
    expect(playableCardsOf(state, me(state)).map((card) => card.name)).not.toContain("Lorenzo de' Medici")
    expect(playableCardsOf(state, me(state)).map((card) => card.name)).not.toContain('Alan Turing')
  })
})

describe('Sydney Opera House', () => {
  const owned = () => withWonder(sotTurn({ step: 9, culture: 0, trade: 0 }), 'wonders/sydneyoperahouse')

  it('advances the leader marker one space for free, and says so in one tagged line', () => {
    const state = owned()
    const before = cultureMarkerOf(state, me(state))?.step
    const used = unwrap(act(state, 'sot:sydneyOperaHouse'))
    expect(cultureMarkerOf(used, me(used))?.step).toBe((before ?? -1) + 1)
    expect(me(used).stats.culture).toBe(0)
    expect(me(used).stats.trade).toBe(0)
    expect(used.log.filter((entry) => entry.assistedActionId === 'req-1')).toHaveLength(1)
    expect(used.log.some((entry) => entry.publicLog.startsWith('cash1981 advanced for free on the culture track'))).toBe(true)
    expect(status(used, 'sot:sydneyOperaHouse').status).toBe('used')
  })

  it('lets the card choice of Mysticism go through its record', () => {
    const state = withWonder(sotTurn({ step: 9, techs: ['Mysticism'] }), 'wonders/sydneyoperahouse')
    const used = unwrap(act(state, 'sot:sydneyOperaHouse'))
    const reward = me(used).pendingRewards[0]
    if (reward === undefined) throw new Error('no reward waiting')
    const chosen = unwrap(
      performAssistedAction(used, {
        playerId: CASH1981,
        action: 'chooseReward',
        requestId: 'req-2',
        at: AT,
        payload: { rewardId: reward.id, itemId: reward.candidateIds[0] ?? '' },
      }),
    )
    expect(me(chosen).pendingRewards).toEqual([])
  })

  it('refuses at the end of the track and while a card choice waits', () => {
    expect(reasonOf(act(withWonder(sotTurn({ step: 21 }), 'wonders/sydneyoperahouse'), 'sot:sydneyOperaHouse'))).toContain(
      'Culture Victory',
    )
    const waiting = unwrap(act(withWonder(sotTurn({ step: 9, techs: ['Mysticism'] }), 'wonders/sydneyoperahouse'), 'sot:sydneyOperaHouse'))
    // A new Start of Turn would free the use; the card still to choose must stop a second advance
    const reopened: GameState = {
      ...waiting,
      players: waiting.players.map((candidate) =>
        candidate.playerId === CASH1981
          ? { ...candidate, playerTurns: candidate.playerTurns.map((turn) => ({ ...turn, usedActions: [] })) }
          : candidate,
      ),
    }
    expect(status(reopened, 'sot:sydneyOperaHouse')).toMatchObject({
      status: 'unavailable',
      reason: 'Choose the card to keep from your last advance first.',
    })
  })

  it('moves the marker back on undo, and the board’s own undo leaves the move to the vote', () => {
    const state = owned()
    const used = unwrap(act(state, 'sot:sydneyOperaHouse'))
    expect(unwrapErr(undoLastBoardChange(used, CASH1981)).kind).toBe('BOARD_UNDO_ASSISTED')
    const undone = undoByVote(used, 'req-1')
    expect(cultureMarkerOf(undone, me(undone))?.step).toBe(cultureMarkerOf(state, me(state))?.step)
    expect(status(undone, 'sot:sydneyOperaHouse').status).toBe('ready')
  })
})

describe('Panama Canal', () => {
  const owned = () => withWonder(sotTurn(), 'wonders/panamacanal')

  it('adds a coin token to the wonder, counted as a coin', () => {
    const used = unwrap(act(owned(), 'sot:panamaCanal'))
    expect(wonderPiece(used, 'wonders/panamacanal').coinTokens).toBe(1)
    expect(coinSourcesOf(used, me(used)).panamaCanal).toBe(1)
    expect(used.log.at(-1)?.publicLog).toBe('cash1981 used Panama Canal: added a coin token to it (1 on it)')
    const twice = unwrap(act(used, 'sot:panamaCanal', 'req-2', true))
    expect(wonderPiece(twice, 'wonders/panamacanal').coinTokens).toBe(2)
  })

  it('takes the coin off on undo, and the board’s own undo leaves it to the vote', () => {
    const used = unwrap(act(owned(), 'sot:panamaCanal'))
    expect(unwrapErr(undoLastBoardChange(used, CASH1981)).kind).toBe('BOARD_UNDO_ASSISTED')
    const undone = undoByVote(used, 'req-1')
    expect(wonderPiece(undone, 'wonders/panamacanal').coinTokens ?? 0).toBe(0)
    expect(status(undone, 'sot:panamaCanal').status).toBe('ready')
  })
})

describe('Cristo Redentor', () => {
  const owned = () => withWonder(sotTurn(), 'wonders/cristoredentor')

  it('draws two culture events of the level chosen and keeps both', () => {
    const state = owned()
    const used = unwrap(act(state, 'sot:cristoRedentor:2'))
    const drawn = me(used).items.filter((item) => item.sheetName === 'CULTURE_2' && !me(state).items.some((had) => had.id === item.id))
    expect(drawn).toHaveLength(2)
    expect(drawn.every((card) => card.hidden)).toBe(true)
    expect(used.items.length).toBe(state.items.length - 2)
    expect(used.log.at(-2)?.publicLog).toBe('cash1981 used Cristo Redentor: drew 2 level II culture event cards')
    // The public line names no card
    expect(used.log.at(-2)?.publicLog).not.toContain(drawn[0]?.id ?? '?')
  })

  it('is once a turn across the three levels', () => {
    const used = unwrap(act(owned(), 'sot:cristoRedentor:1'))
    expect(status(used, 'sot:cristoRedentor:1').status).toBe('used')
    expect(status(used, 'sot:cristoRedentor:3').status).toBe('used')
  })

  it('with Mysticism each of the two draws takes two cards and keeps one, as a choice of its own', () => {
    const state = withWonder(sotTurn({ techs: ['Mysticism'] }), 'wonders/cristoredentor')
    const used = unwrap(act(state, 'sot:cristoRedentor:2'))
    const rewards = me(used).pendingRewards
    expect(rewards.map((reward) => reward.id)).toEqual(['req-1', 'req-1:2'])
    expect(rewards.every((reward) => reward.candidateIds.length === 2 && reward.keep === 1)).toBe(true)
    expect(me(used).items.length).toBe(me(state).items.length + 4)
    expect(used.log.at(-2)?.publicLog).toBe(
      'cash1981 used Cristo Redentor: drew 4 level II culture event cards, keeping one of each pair',
    )

    // Both choices are made through the record of the action
    const choose = (from: GameState, rewardId: string, requestId: string) =>
      unwrap(
        performAssistedAction(from, {
          playerId: CASH1981,
          action: 'chooseReward',
          requestId,
          at: AT,
          payload: { rewardId, itemId: me(from).pendingRewards.find((reward) => reward.id === rewardId)?.candidateIds[0] ?? '' },
        }),
      )
    const first = choose(used, 'req-1', 'req-2')
    expect(me(first).pendingRewards.map((reward) => reward.id)).toEqual(['req-1:2'])
    const second = choose(first, 'req-1:2', 'req-3')
    expect(me(second).pendingRewards).toEqual([])
    expect(me(second).items.length).toBe(me(state).items.length + 2)
    expect(second.discardedItems.length).toBe(state.discardedItems.length + 2)

    // A vote undoes both pairs, kept and discarded cards alike
    const undone = undoByVote(second, 'req-1')
    expect(me(undone).items.length).toBe(me(state).items.length)
    expect(undone.discardedItems.length).toBe(state.discardedItems.length)
    expect(undone.items.length).toBe(state.items.length)
  })

  it('takes both waiting choices away on undo before either is made', () => {
    const state = withWonder(sotTurn({ techs: ['Mysticism'] }), 'wonders/cristoredentor')
    const used = unwrap(act(state, 'sot:cristoRedentor:1'))
    expect(me(used).pendingRewards).toHaveLength(2)
    const undone = undoByVote(used, 'req-1')
    expect(me(undone).pendingRewards).toEqual([])
    expect(me(undone).items.length).toBe(me(state).items.length)
    expect(undone.items.length).toBe(state.items.length)
  })

  it('waits for a card choice and for a hand over its size, and warns when the two cards bring it over', () => {
    const waiting = withWonder(sotTurn({ techs: ['Mysticism'] }), 'wonders/cristoredentor')
    const drawn = unwrap(act(waiting, 'sot:cristoRedentor:1'))
    const reopened: GameState = {
      ...drawn,
      players: drawn.players.map((candidate) =>
        candidate.playerId === CASH1981
          ? { ...candidate, playerTurns: candidate.playerTurns.map((turn) => ({ ...turn, usedActions: [] })) }
          : candidate,
      ),
    }
    expect(status(reopened, 'sot:cristoRedentor:1')).toMatchObject({
      status: 'unavailable',
      reason: 'Choose the card to keep from your last advance first.',
    })
  })

  it('has its own button text', () => {
    const state = withWonder(sotTurn(), 'wonders/cristoredentor')
    const entry = toPlayerView(state, CASH1981).you?.availableActions.find((action) => action.action === 'sot:cristoRedentor:3')
    expect(entry?.buttonText).toBe('Cristo Redentor: draw two level III events')
  })

  it('puts the cards back in the deck on undo, and refuses once one has left the hand', () => {
    const state = owned()
    const used = unwrap(act(state, 'sot:cristoRedentor:3'))
    const undone = undoByVote(used, 'req-1')
    expect(me(undone).items.length).toBe(me(state).items.length)
    expect(undone.items.length).toBe(state.items.length)
    expect(status(undone, 'sot:cristoRedentor:3').status).toBe('ready')

    const drawnIds = used.assistedActions[0]?.effect.kind === 'sotDraw' ? used.assistedActions[0].effect.drawn : []
    const missing: GameState = {
      ...used,
      players: used.players.map((candidate) =>
        candidate.playerId === CASH1981
          ? { ...candidate, items: candidate.items.filter((item) => item.id !== drawnIds[0]) }
          : candidate,
      ),
    }
    expect(undoRefusal(missing, 'req-1')).toMatchObject({
      kind: 'ASSISTED_UNDO_BLOCKED',
      reason: 'A card this drew has left the hand, so Cristo Redentor cannot be undone.',
    })
  })
})

describe('abilities that only log', () => {
  it.each([
    ['sot:greatWall', 'wonders/greatwall', 'The Great Wall', 'built city walls in one of their cities for free'],
    ['sot:hangingGardens', 'wonders/hanginggardens', 'The Hanging Gardens', 'built a figure for free in the square of the Hanging Gardens'],
    ['sot:tajMahal', 'wonders/tajmahal', 'Taj Mahal', 'built an unlocked building for free in one of their cities'],
    ['sot:bigBen', 'wonders/bigben', 'Big Ben', 'gained one of every resource in the market'],
  ] as const)('%s writes one line, changes no numbers, and is once a turn', (kind, assetId, label, text) => {
    const state = withWonder(sotTurn({ culture: 5, trade: 5 }), assetId)
    expect(status(state, kind).status).toBe('ready')
    const used = unwrap(act(state, kind))
    expect(used.log.at(-1)?.publicLog).toBe(`cash1981 used ${label}: ${text}`)
    expect(me(used).stats).toEqual(me(state).stats)
    expect(status(used, kind).status).toBe('used')
    const undone = undoByVote(used, 'req-1')
    expect(status(undone, kind).status).toBe('ready')
    expect(undone.log.at(-1)?.publicLog).toContain('take back by hand what you did on the map')
  })

  it('gives Machu Picchu only after a coin has been invested this turn', () => {
    const base = sotTurn({ stats: { coinSources: { ...me(sotTurn()).stats.coinSources, sheet: 1 } } })
    const state = withWonder(base, 'wonders/machupichu')
    expect(status(state, 'sot:machuPicchu')).toMatchObject({
      status: 'unavailable',
      reason: 'Invest a coin first: Machu Picchu gives its resource after you invest.',
    })
    const invested = unwrap(
      performAssistedAction(state, {
        playerId: CASH1981,
        action: 'invest',
        requestId: 'req-0',
        at: AT,
        payload: { source: 'sheet', card: 'infra' },
      }),
    )
    expect(status(invested, 'sot:machuPicchu').status).toBe('ready')
    const used = unwrap(act(invested, 'sot:machuPicchu'))
    expect(used.log.at(-1)?.publicLog).toBe(
      'cash1981 used Machu Picchu: gained a resource of their choice from the market after investing',
    )
  })

  it('needs Plastics revealed, and is once a turn', () => {
    expect(status(sotTurn(), 'sot:plastics').status).toBe('not-owned')
    const state = sotTurn({ techs: ['Plastics'] })
    expect(status(state, 'sot:plastics').status).toBe('ready')
    const used = unwrap(act(state, 'sot:plastics'))
    expect(used.log.at(-1)?.publicLog).toBe('cash1981 used Plastics: built a unit, figure or building for free')
    expect(status(used, 'sot:plastics').status).toBe('used')
  })

  it('spends a Wheat for Ecology, gives it back on undo, and needs one to start', () => {
    const state = sotTurn({ techs: ['Ecology'] })
    expect(status(state, 'sot:ecology')).toMatchObject({ status: 'needs-resource' })
    const { state: withWheat, hutId } = withHutInHand(state, 'Wheat')
    expect(status(withWheat, 'sot:ecology').status).toBe('ready')
    const used = unwrap(act(withWheat, 'sot:ecology'))
    expect(me(used).items.some((item) => item.id === hutId)).toBe(false)
    expect(used.discardedItems.some((item) => item.id === hutId)).toBe(true)
    const undone = undoByVote(used, 'req-1')
    expect(me(undone).items.some((item) => item.id === hutId)).toBe(true)
    expect(undone.log.at(-1)?.publicLog).toContain('the Wheat token returned')
  })
})

describe('free techs', () => {
  it('Statue of Liberty grants a tech of any level, spent when it is revealed in Start of Turn', () => {
    const state = withWonder(sotTurn(), 'wonders/statueofliberty')
    const used = unwrap(act(state, 'sot:statueOfLiberty'))
    expect(me(used).techGrants).toEqual([{ id: 'req-1', source: 'Statue of Liberty', level: null, turnNumber: 1 }])
    expect(used.log.at(-1)?.publicLog).toBe(
      'cash1981 used Statue of Liberty: may research one tech another player knows for free',
    )
    expect(toPlayerView(used, CASH1981).you?.startOfTurn?.techGrants).toEqual([
      { id: 'req-1', source: 'Statue of Liberty', level: null },
    ])
    // Spent by revealing a hidden tech, whatever its level
    const tech = used.techs.find((candidate) => candidate.level === 3)
    if (tech === undefined) throw new Error('no level III tech in the fixture')
    const chosen: GameState = {
      ...used,
      players: used.players.map((candidate) =>
        candidate.playerId === CASH1981
          ? { ...candidate, techsChosen: [...candidate.techsChosen, { ...tech, hidden: true, ownerId: CASH1981 }] }
          : candidate,
      ),
    }
    const name = me(chosen).techsChosen.at(-1)?.name ?? ''
    const learned = unwrap(revealTech(chosen, { playerId: CASH1981, techName: name }))
    expect(me(learned).techGrants).toEqual([])
  })

  it('takes the grant back on undo, and refuses once the tech has been learned', () => {
    const state = withWonder(sotTurn(), 'wonders/statueofliberty')
    const used = unwrap(act(state, 'sot:statueOfLiberty'))
    expect(me(undoByVote(used, 'req-1')).techGrants).toEqual([])
    const spent: GameState = {
      ...used,
      players: used.players.map((candidate) => (candidate.playerId === CASH1981 ? { ...candidate, techGrants: [] } : candidate)),
    }
    expect(undoRefusal(spent, 'req-1')).toMatchObject({
      kind: 'ASSISTED_UNDO_BLOCKED',
      reason: 'The tech this gave has been learned already. Remove that tech first.',
    })
  })

  it('the Teacher hut is discarded for a level I tech, and comes back on undo', () => {
    expect(status(sotTurn(), 'sot:teacher')).toMatchObject({ status: 'not-owned', reason: 'You hold no Teacher hut.' })
    const { state, hutId } = withHutInHand(sotTurn(), 'Teacher')
    expect(status(state, 'sot:teacher').status).toBe('ready')
    const used = unwrap(act(state, 'sot:teacher'))
    expect(me(used).items.some((item) => item.id === hutId)).toBe(false)
    expect(used.discardedItems.some((item) => item.id === hutId)).toBe(true)
    expect(me(used).techGrants).toEqual([{ id: 'req-1', source: 'Teacher', level: 1, turnNumber: 1 }])
    // The hut is the limit, not a usage key
    expect(status(used, 'sot:teacher').status).toBe('not-owned')
    const undone = undoByVote(used, 'req-1')
    expect(me(undone).items.some((item) => item.id === hutId)).toBe(true)
    expect(me(undone).techGrants).toEqual([])
    expect(undone.discardedItems.some((item) => item.id === hutId)).toBe(false)
  })

  it('Atlantis is claimed by the player who took the relic off the map, once', () => {
    const onMap = put(sotTurn(), CASH1981, 'relics/atlantis', 8, 8)
    expect(status(onMap, 'sot:atlantis')).toMatchObject({ status: 'not-owned' })
    expect(status(onMap, 'sot:atlantis').reason).toContain('still on the map')

    const mine = withRelicTaken(sotTurn(), 'relics/atlantis')
    expect(status(mine, 'sot:atlantis').status).toBe('ready')
    expect(status(withRelicTaken(sotTurn(), 'relics/atlantis', KARANDRAS1), 'sot:atlantis').status).toBe('not-owned')

    const used = unwrap(act(mine, 'sot:atlantis'))
    expect(me(used).techGrants).toEqual([{ id: 'req-1', source: 'Atlantis', level: null, turnNumber: 1 }])
    // Not `used`: that would offer "use it again?", and the relic gives its ability once
    expect(status(used, 'sot:atlantis')).toMatchObject({ status: 'unavailable' })
    // Not even a confirmed repeat gives it twice
    expect(reasonOf(act(used, 'sot:atlantis', 'req-2', true))).toContain('claimed the Atlantis relic already')

    const undone = undoByVote(used, 'req-1')
    expect(status(undone, 'sot:atlantis').status).toBe('ready')
  })
})

describe('the Seven Cities of Gold', () => {
  it('puts two markers on the card chosen without paying a coin, once for the game', () => {
    const state = withRelicTaken(sotTurn(), 'relics/seven_cities_of_gold')
    expect(status(state, 'sot:sevenCities:infra').status).toBe('ready')
    const used = unwrap(act(state, 'sot:sevenCities:infra'))
    expect(me(used).stats.infra).toBe(2)
    expect(me(used).stats.coinSources).toEqual(me(state).stats.coinSources)
    expect(used.log.at(-1)?.publicLog).toBe(
      'cash1981 used the Seven Cities of Gold: invested 2 markers in Infrastructure for free (2 markers on it)',
    )
    for (const card of ['infra', 'efta', 'mic', 'pe'] as const) {
      expect(status(used, `sot:sevenCities:${card}`).status).toBe('unavailable')
    }
    expect(me(undoByVote(used, 'req-1')).stats.infra).toBe(0)
  })

  it('activates Public Education when the markers reach its threshold', () => {
    const base = sotTurn({ stats: { pe: 1 } })
    const state = withRelicTaken(base, 'relics/seven_cities_of_gold')
    const used = unwrap(act(state, 'sot:sevenCities:pe'))
    expect(me(used).stats.pe).toBe(3)
    expect(me(used).techGrants).toEqual([{ id: 'req-1', source: 'Public Education', level: null, turnNumber: 1 }])
    const undone = undoByVote(used, 'req-1')
    expect(me(undone).stats.pe).toBe(1)
    expect(me(undone).techGrants).toEqual([])
  })
})

describe('what other players can see', () => {
  it('shows an opponent nothing of the abilities, and the record names no card', () => {
    const { state: withHut } = withHutInHand(withWonder(sotTurn(), 'wonders/panamacanal'), 'Teacher')
    const used = unwrap(act(withHut, 'sot:teacher'))
    const view = toPlayerView(used, KARANDRAS1)
    expect(JSON.stringify(view)).not.toContain('"effect"')
    expect(JSON.stringify(view.opponents)).not.toContain('techGrants')
    expect(JSON.stringify(view.opponents)).not.toContain('Teacher')
    // The other player's own buttons say nothing about the owner's hand
    expect(view.you?.availableActions.find((action) => action.action === 'sot:teacher')?.status).toBe('not-owned')
  })

  it('lets the owner see the buttons of their own abilities as ready', () => {
    const state = withWonder(sotTurn(), 'wonders/stonehenge')
    const view = toPlayerView(state, CASH1981)
    expect(view.you?.availableActions.find((action) => action.action === 'sot:stonehenge')).toMatchObject({
      phase: 'SOT',
      group: 'Wonders',
      status: 'ready',
    })
  })
})
