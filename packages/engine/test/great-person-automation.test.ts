/**
 * The first automated Great Person batch: Archimedes, Shakespeare, Pasteur,
 * Michelangelo, Edison, Mother Teresa and Marie Curie. Each test names the
 * printed ability it covers.
 */

import { describe, expect, it } from 'vitest'

import { placePiece } from '../src/actions/board.js'
import { drawWonderToBoard } from '../src/actions/draw.js'
import { chooseTech, removeTech, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { assistedAvailability, performAssistedAction } from '../src/assisted.js'
import { spendResource, returnResource } from '../src/assisted-resources.js'
import { buildOptionsOf } from '../src/build-options.js'
import type { BuildPayload } from '../src/build-options.js'
import { cultureMarkerLevelOf, toPlayerView } from '../src/state.js'
import { stackingLimitOf } from '../src/great-person-effects.js'
import { findBoardAsset, mapTop, slotOrigin } from '../src/board.js'
import { SQUARE_SIZE } from '../src/board.js'
import type { GameState, Playerhand } from '../src/state.js'
import { findPlayer } from '../src/state.js'
import { unwrap } from '../src/result.js'

import { startOfTurn, withCardInHand, withHutInHand } from './assisted-fixture.js'
import { withCivilization, withMarkerAt, withStats } from './culture-advance-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-10-27T10:00:00.000Z'
const OTHERS = [KARANDRAS1, ITCHI, CHUL]

const me = (state: GameState, playerId = CASH1981): Playerhand => {
  const found = findPlayer(state, playerId)
  if (found === undefined) throw new Error(`no player ${playerId}`)
  return found
}

const revealed = (state: GameState, itemId: string): GameState => ({
  ...state,
  players: state.players.map((candidate) =>
    candidate.playerId === CASH1981
      ? {
          ...candidate,
          items: candidate.items.map((item) => (item.id === itemId ? { ...item, hidden: false } : item)),
        }
      : candidate,
  ),
})

const play = (
  state: GameState,
  requestId: string,
  itemId: string,
  options: {
    readonly targets?: readonly string[]
    readonly resource?: string
    readonly coinSource?: string
    readonly substitute?: string
  } = {},
) =>
  performAssistedAction(state, {
    playerId: CASH1981,
    action: 'playCard',
    requestId,
    at: AT,
    payload: {
      itemId,
      targets: options.targets ?? [],
      ...(options.resource === undefined ? {} : { resource: options.resource }),
      ...(options.coinSource === undefined ? {} : { coinSource: options.coinSource }),
      ...(options.substitute === undefined ? {} : { substitute: options.substitute }),
    },
  })

function undoByVote(state: GameState, requestId: string): GameState {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line for the action')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of OTHERS) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  return next
}

/** Start of Turn and Trade done, City Management open; Research is not. */
const cityManagement = (state: GameState): GameState =>
  unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))

/** Everything but Research done, so choosing a tech counts as research this turn. */
const researching = (state: GameState): GameState =>
  unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'MOVEMENT' }))

describe('Archimedes', () => {
  const finishResearch = (state: GameState): GameState => {
    let next = state
    for (const playerId of [CASH1981, KARANDRAS1, ITCHI, CHUL]) {
      next = unwrap(markPhasesDone(next, { playerId, turnNumber: 1, upToPhase: 'RESEARCH' }))
    }
    return next
  }

  it('pays 3 culture after everyone has finished Research, and removing the tech takes it back', () => {
    const card = withCardInHand(firstCivGame(), 'Archimedes')
    const state = researching(revealed(card.state, card.itemId))
    const chosen = unwrap(chooseTech(state, { playerId: CASH1981, techName: 'Code of Laws' }))
    expect(me(chosen).stats.culture).toBe(0)

    const done = finishResearch(chosen)
    expect(me(done).stats.culture).toBe(3)
    expect(done.log.at(-2)?.publicLog).toBe('cash1981 gained 3 culture from Archimedes')

    const removed = unwrap(removeTech(done, { playerId: CASH1981, techName: 'Code of Laws' }))
    expect(me(removed).stats.culture).toBe(0)
    expect(me(removed).archimedesCulture).toEqual({})
  })

  it('gives nothing while the card is hidden or when another player has the tech revealed', () => {
    const hidden = withCardInHand(firstCivGame(), 'Archimedes')
    const state = researching(hidden.state)
    const chosen = unwrap(chooseTech(state, { playerId: CASH1981, techName: 'Code of Laws' }))
    expect(me(finishResearch(chosen)).stats.culture).toBe(0)

    const otherKnows = unwrap(chooseTech(firstCivGame(), { playerId: KARANDRAS1, techName: 'Code of Laws' }))
    const revealedOther = unwrap(revealTech(otherKnows, { playerId: KARANDRAS1, techName: 'Code of Laws' }))
    const card = withCardInHand(revealedOther, 'Archimedes')
    const mine = researching(revealed(card.state, card.itemId))
    const after = unwrap(chooseTech(mine, { playerId: CASH1981, techName: 'Code of Laws' }))
    expect(me(finishResearch(after)).stats.culture).toBe(0)
  })

  it('ignores another player\'s hidden research, so the public total cannot leak it', () => {
    const hiddenResearch = unwrap(chooseTech(firstCivGame(), { playerId: KARANDRAS1, techName: 'Code of Laws' }))
    const card = withCardInHand(hiddenResearch, 'Archimedes')
    const state = researching(revealed(card.state, card.itemId))
    const after = unwrap(chooseTech(state, { playerId: CASH1981, techName: 'Code of Laws' }))
    expect(me(finishResearch(after)).stats.culture).toBe(3)
  })
})

describe('William Shakespeare', () => {
  const shakespeareTurn = (): GameState => {
    const base = advanceTurnWithMarkers()
    const card = withCardInHand(base, 'William Shakespeare')
    return revealed(card.state, card.itemId)
  }

  it('skips every consecutive occupied space, pays only for the landing and undoes', () => {
    const state = shakespeareTurn()
    const before = me(state).stats.culture
    expect(assistedAvailability(state, CASH1981, 'cultureAdvanceSkip')).toMatchObject({ status: 'ready' })

    const done = unwrap(
      performAssistedAction(state, { playerId: CASH1981, action: 'cultureAdvanceSkip', requestId: 'skip-1', at: AT }),
    )
    expect(cultureMarkerLevelOf(done, CASH1981)).toBe(3)
    expect(me(done).stats.culture).toBe(before - 3)
    expect(done.log.find((entry) => entry.assistedActionId === 'skip-1')?.publicLog).toContain('space 3')

    const undone = undoByVote(done, 'skip-1')
    expect(cultureMarkerLevelOf(undone, CASH1981)).toBe(0)
    expect(me(undone).stats.culture).toBe(before)
  })

  it('is not owned without the card and unavailable when the next space is free', () => {
    expect(assistedAvailability(advanceTurnWithMarkers(), CASH1981, 'cultureAdvanceSkip')).toMatchObject({
      status: 'not-owned',
      reason: 'You do not hold William Shakespeare.',
    })

    const hidden = withCardInHand(advanceTurnWithMarkers(), 'William Shakespeare')
    expect(assistedAvailability(hidden.state, CASH1981, 'cultureAdvanceSkip')).toMatchObject({
      status: 'unavailable',
      reason: 'Reveal William Shakespeare before using his ability.',
    })

    let free = withCivilization(firstCivGame(), 'Japanese')
    free = withMarkerAt(free, 0, 'Japanese')
    free = cityManagement(free)
    const card = withCardInHand(free, 'William Shakespeare')
    const revealedCard = revealed(card.state, card.itemId)
    expect(assistedAvailability(revealedCard, CASH1981, 'cultureAdvanceSkip')).toMatchObject({
      status: 'unavailable',
      reason: 'The next culture space has no other player on it, so there is nothing to skip.',
    })
  })
})

/** Cash on Japanese at step 0, two other markers on 1 and 2, City Management open. */
function advanceTurnWithMarkers(): GameState {
  let state = withCivilization(firstCivGame(), 'Japanese')
  state = withCivilization(state, 'Americans', KARANDRAS1)
  state = withCivilization(state, 'Chinese', ITCHI)
  state = withStats(state, { culture: 100, trade: 25 })
  state = withMarkerAt(state, 0, 'Japanese')
  state = withMarkerAt(state, 1, 'Americans', KARANDRAS1)
  state = withMarkerAt(state, 2, 'Chinese', ITCHI)
  return cityManagement(state)
}

describe('Louis Pasteur', () => {
  it('raises the effective stacking limit by 1 while revealed, and not while hidden', () => {
    const hidden = withCardInHand(firstCivGame(), 'Louis Pasteur')
    expect(stackingLimitOf(hidden.state, me(hidden.state))).toBe(me(hidden.state).stats.stacking)

    const state = revealed(hidden.state, hidden.itemId)
    expect(stackingLimitOf(state, me(state))).toBe(me(state).stats.stacking + 1)
  })
})

/** The America tile and a red city on B2. */
function scene(): GameState {
  let state = firstCivGame()
  const colors: Record<string, string> = {
    [CASH1981]: 'Red',
    [KARANDRAS1]: 'Blue',
    [ITCHI]: 'Green',
    [CHUL]: 'Yellow',
  }
  state = {
    ...state,
    players: state.players.map((candidate) => ({
      ...candidate,
      color: colors[candidate.playerId] ?? candidate.color,
      government: candidate.playerId === CASH1981 ? 'Monarchy' : candidate.government,
    })),
  }
  const slot = state.board.slots[0]
  if (slot === undefined) throw new Error('no board slot')
  const [x, y] = slotOrigin(state.board, slot)
  state = unwrap(placePiece(state, { playerId: CASH1981, assetId: 'tiles/america', x, y }))
  return put(state, 'cities/redcity2', 1, 1)
}

function put(state: GameState, assetId: string, column: number, row: number): GameState {
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`no asset ${assetId}`)
  return unwrap(
    placePiece(state, {
      playerId: CASH1981,
      assetId,
      x: column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2,
      y: mapTop(state.board) + row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2,
    }),
  )
}

describe('Michelangelo', () => {
  it('arms a 5-production wonder discount, shows it in Build, consumes it and restores it on undo', () => {
    let state = cityManagement(scene())
    const wonder = unwrap(drawWonderToBoard(state, CASH1981, 'ANCIENT_WONDERS'))
    state = wonder
    const card = withCardInHand(state, 'Michelangelo')
    state = card.state
    const before = buildOptionsOf(state, me(state))[0]
    const wonderBefore = before?.choices.find((choice) => choice.item.kind === 'wonder')
    if (wonderBefore === undefined) throw new Error('no wonder in the market')
    const baseCost = wonderBefore.cost

    const played = unwrap(play(state, 'michelangelo-1', card.itemId))
    expect(me(played).wonderDiscount).toBe(5)
    expect(played.log.at(-1)?.publicLog).toBe(
      'cash1981 played Michelangelo (city management) and discarded it, taking 5 production off their next wonder',
    )
    const after = buildOptionsOf(played, me(played))[0]
    const wonderAfter = after?.choices.find((choice) => choice.item.kind === 'wonder')
    expect(wonderAfter?.cost).toBe(Math.max(0, baseCost - 5))
    expect(wonderAfter?.costNote).toContain('5 less with Michelangelo')

    const city = placedCity(played)
    const target = wonderAfter?.squares[0]
    if (target === undefined) throw new Error('no wonder square')
    const payload: BuildPayload = { cityPieceId: city.id, item: { kind: 'wonder', assetId: wonderBefore.assetId }, target }
    const built = unwrap(
      performAssistedAction(played, {
        playerId: CASH1981,
        action: 'build',
        requestId: 'build-1',
        at: AT,
        payload,
      }),
    )
    expect(me(built).wonderDiscount).toBe(0)

    const undone = undoByVote(built, 'build-1')
    expect(me(undone).wonderDiscount).toBe(5)
  })
})

function placedCity(state: GameState) {
  const city = state.board.pieces.find((piece) => piece.category === 'city')
  if (city === undefined) throw new Error('no city')
  return city
}

describe('Thomas Edison', () => {
  it('grants a free tech from the named player, and refuses an unrelated one', () => {
    let state = firstCivGame()
    state = unwrap(chooseTech(state, { playerId: KARANDRAS1, techName: 'Code of Laws' }))
    state = unwrap(revealTech(state, { playerId: KARANDRAS1, techName: 'Code of Laws' }))
    const card = withCardInHand(state, 'Thomas Edison')
    state = card.state

    const played = unwrap(play(state, 'edison-1', card.itemId, { targets: [KARANDRAS1] }))
    const grant = me(played).techGrants.find((candidate) => candidate.source === 'Thomas Edison')
    expect(grant?.allowedTechNames).toEqual(['Code of Laws'])
    expect(played.log.at(-1)?.publicLog).toContain('another player knows (Code of Laws)')

    const wrong = unwrap(chooseTech(played, { playerId: CASH1981, techName: 'Pottery' }))
    const wrongReveal = unwrap(revealTech(wrong, { playerId: CASH1981, techName: 'Pottery' }))
    expect(me(wrongReveal).techGrants.find((candidate) => candidate.source === 'Thomas Edison')?.usedFor).toBeUndefined()

    const right = unwrap(chooseTech(played, { playerId: CASH1981, techName: 'Code of Laws' }))
    const rightReveal = unwrap(revealTech(right, { playerId: CASH1981, techName: 'Code of Laws' }))
    expect(me(rightReveal).techGrants.find((candidate) => candidate.source === 'Thomas Edison')?.usedFor).toBe('Code of Laws')
  })

  it('takes the grant back with the card when it has not been used', () => {
    let state = firstCivGame()
    state = unwrap(chooseTech(state, { playerId: KARANDRAS1, techName: 'Code of Laws' }))
    state = unwrap(revealTech(state, { playerId: KARANDRAS1, techName: 'Code of Laws' }))
    const card = withCardInHand(state, 'Thomas Edison')
    const played = unwrap(play(card.state, 'edison-2', card.itemId, { targets: [KARANDRAS1] }))
    const undone = undoByVote(played, 'edison-2')
    expect(me(undone).techGrants.some((grant) => grant.source === 'Thomas Edison')).toBe(false)
    expect(me(undone).items.some((item) => item.id === card.itemId)).toBe(true)
  })
})

describe('Mother Teresa', () => {
  const teresaTurn = (): ReturnType<typeof withCardInHand> => {
    let state = withCivilization(firstCivGame(), 'Japanese')
    state = withStats(state, { coinSources: { ...me(state).stats.coinSources, sheet: 1 } })
    state = withMarkerAt(state, 0, 'Japanese')
    const card = withCardInHand(state, 'Mother Teresa')
    return card
  }

  it('gives one chosen coin, advances one space for free and undoes both', () => {
    const card = teresaTurn()
    const done = unwrap(
      play(card.state, 'teresa-1', card.itemId, { targets: [KARANDRAS1], coinSource: 'sheet' }),
    )
    expect(me(done).stats.coinSources.sheet).toBe(0)
    expect(me(done, KARANDRAS1).stats.coinSources.sheet).toBe(1)
    expect(cultureMarkerLevelOf(done, CASH1981)).toBe(1)
    expect(done.log.find((entry) => entry.assistedActionId === 'teresa-1')?.publicLog).toContain(
      'gave their Sheet coin to Karandras1 and advanced one space for free',
    )

    const undone = undoByVote(done, 'teresa-1')
    expect(me(undone).stats.coinSources.sheet).toBe(1)
    expect(me(undone, KARANDRAS1).stats.coinSources.sheet).toBe(0)
    expect(cultureMarkerLevelOf(undone, CASH1981)).toBe(0)
    expect(me(undone).items.some((item) => item.id === card.itemId)).toBe(true)

    // The once-per-turn use is freed by the undo, so she can give again.
    const again = unwrap(
      play(undone, 'teresa-again', card.itemId, { targets: [KARANDRAS1], coinSource: 'sheet' }),
    )
    expect(me(again).stats.coinSources.sheet).toBe(0)
  })

  it('is used once per turn', () => {
    const card = teresaTurn()
    const done = unwrap(play(card.state, 'teresa-2', card.itemId, { targets: [KARANDRAS1], coinSource: 'sheet' }))
    expect(assistedAvailability(done, CASH1981, 'playCard').status).toBe('ready')
    const again = play(done, 'teresa-3', card.itemId, { targets: [KARANDRAS1], coinSource: 'sheet' })
    expect(again.ok).toBe(false)
  })
})

describe('Marie Curie', () => {
  it('arms a Uranium substitution, spends the substitute instead, and restores it on a returned token', () => {
    const card = withCardInHand(startOfTurn(), 'Marie Curie')
    const armed = unwrap(play(card.state, 'curie-1', card.itemId, { substitute: 'Wheat' }))
    expect(me(armed).curieSubstitute).toBe('Wheat')
    expect(armed.log.at(-1)?.publicLog).toContain('their next Uranium spend may use the resource they chose instead')
    expect(armed.log.at(-1)?.publicLog).not.toContain('Wheat')

    const wheat = withHutInHand(armed, 'Wheat')
    const spent = unwrap(spendResource(wheat.state, CASH1981, 'Uranium'))
    expect(spent.spent.resource).toBe('Wheat')
    expect(spent.spent.curieSubstitute).toBe('Wheat')
    expect(me(spent.state).curieSubstitute).toBeNull()

    const returned = unwrap(returnResource(spent.state, me(spent.state), spent.spent, null))
    expect(me(returned).curieSubstitute).toBe('Wheat')
  })
})

describe('hidden information', () => {
  it('keeps the new hand fields and the Edison tech list out of opponent and spectator views', () => {
    let state = firstCivGame()
    state = unwrap(chooseTech(state, { playerId: KARANDRAS1, techName: 'Code of Laws' }))
    state = unwrap(revealTech(state, { playerId: KARANDRAS1, techName: 'Code of Laws' }))
    const card = withCardInHand(state, 'Thomas Edison')
    const played = unwrap(play(card.state, 'edison-hidden', card.itemId, { targets: [KARANDRAS1] }))
    const armed: GameState = {
      ...played,
      players: played.players.map((candidate) =>
        candidate.playerId === CASH1981
          ? {
              ...candidate,
              archimedesCulture: { 'Code of Laws': 3 },
              wonderDiscount: 5,
              curieSubstitute: 'Wheat',
            }
          : candidate,
      ),
    }
    for (const viewerId of [KARANDRAS1, 'spectator']) {
      const view = toPlayerView(armed, viewerId)
      // A player's own view carries their own fields; what matters is the other player's projection.
      const json = viewerId === 'spectator' ? JSON.stringify(view) : JSON.stringify(view.opponents)
      for (const secret of ['archimedesCulture', 'wonderDiscount', 'curieSubstitute', 'allowedTechNames']) {
        expect(json).not.toContain(secret)
      }
    }
  })
})
