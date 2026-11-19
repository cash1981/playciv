/**
 * The relics that give their ability as soon as an army has taken the marker: the Ark of the
 * Covenant, the School of Confucius and Attila's Village (`src/assisted-relics.ts`). Their
 * rules are in `docs/agents/decisions.md` ("Relic markers").
 */

import { describe, expect, it } from 'vitest'

import { removePiece, undoLastBoardChange } from '../src/actions/board.js'
import { travelFigureCollecting } from '../src/actions/token-collection.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { ASSISTED_ACTIONS, assistedAvailability, availableActionsFor, performAssistedAction } from '../src/assisted.js'
import { RELIC_ACTIONS } from '../src/assisted-relics.js'
import { BOARD_ASSETS } from '../src/board.js'
import { cultureMarkerOf } from '../src/culture-track.js'
import { claimsRelic } from '../src/relic-claims.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { AssistedActionKind, GameState } from '../src/state.js'

import { AT, me, put, sotTurn } from './sot-fixture.js'
import { topCards } from './culture-advance-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1 } from './fixture.js'

const ARK = 'relics/ark_of_the_covenant'
const ATTILA = 'relics/attilas_village'
const CONFUCIUS = 'relics/school_of_confucius'

const act = (state: GameState, action: AssistedActionKind, requestId = 'req-1') =>
  performAssistedAction(state, { playerId: CASH1981, action, requestId, at: AT })

const status = (state: GameState, action: AssistedActionKind) => assistedAvailability(state, CASH1981, action)

const step = (state: GameState): number | undefined => cultureMarkerOf(state, me(state))?.step

/** The army walks onto the relic and the player confirms: the marker leaves the board and what needs no choice is claimed. */
function armyTakes(state: GameState, assetId: string): GameState {
  const withTile = put(state, CASH1981, 'tiles/tile05', 0, 0)
  const placed = put(put(withTile, CASH1981, 'figures/redarmy', 3, 2), CASH1981, assetId, 3, 1)
  const army = placed.board.pieces.find((piece) => piece.assetId === 'figures/redarmy')
  if (army === undefined) throw new Error('no army')
  return unwrap(travelFigureCollecting(placed, { playerId: CASH1981, pieceId: army.id, column: 3, row: 1, collectToken: true }))
}

/** A relic taken off the map by hand, as the board history records an army's taking it, with nothing claimed. */
function relicRemoved(state: GameState, assetId: string): GameState {
  const placed = put(state, CASH1981, assetId, 8, 8)
  const piece = placed.board.pieces.find((candidate) => candidate.assetId === assetId)
  if (piece === undefined) throw new Error('no relic')
  return unwrap(removePiece(placed, { playerId: CASH1981, pieceId: piece.id }))
}

function undoByVote(state: GameState, requestId: string): GameState {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line for the action')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of [KARANDRAS1, ITCHI, CHUL]) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  return next
}

const keep = (state: GameState, requestId: string): GameState => {
  const reward = me(state).pendingRewards[0]
  if (reward === undefined) throw new Error('no reward waiting')
  return unwrap(
    performAssistedAction(state, {
      playerId: CASH1981,
      action: 'chooseReward',
      requestId,
      at: AT,
      payload: { rewardId: reward.id, itemId: reward.candidateIds[0] ?? '' },
    }),
  )
}

describe('the relic buttons', () => {
  it('are in no phase tab in particular, and offered to nobody who has not taken the marker', () => {
    expect(RELIC_ACTIONS.every((definition) => definition.phase === 'ANY' && definition.kind.startsWith('relic:'))).toBe(true)
    const actions = availableActionsFor(sotTurn(), CASH1981).filter((action) => action.action.startsWith('relic:'))
    expect(actions).toHaveLength(RELIC_ACTIONS.length)
    expect(actions.every((action) => action.status === 'not-owned')).toBe(true)
  })

  it('stay with the player who took the marker', () => {
    const taken = relicRemoved(sotTurn({ step: 9 }), ARK)
    const asOther = assistedAvailability(taken, KARANDRAS1, 'relic:ark')
    expect(asOther.status).toBe('not-owned')
  })
})

describe('the Ark of the Covenant', () => {
  it('advances once for free the moment an army takes it, and the second advance is a button', () => {
    const before = sotTurn({ step: 9, culture: 0, trade: 0 })
    const taken = armyTakes(before, ARK)
    expect(step(taken)).toBe((step(before) ?? 0) + 1)
    expect(me(taken).stats).toMatchObject({ culture: 0, trade: 0 })
    expect(status(taken, 'relic:ark')).toMatchObject({ status: 'ready' })

    const second = unwrap(act(taken, 'relic:ark', 'req-2'))
    expect(step(second)).toBe((step(before) ?? 0) + 2)
    expect(me(second).stats).toMatchObject({ culture: 0, trade: 0 })
    expect(status(second, 'relic:ark').status).toBe('unavailable')
    expect(unwrapErr(act(second, 'relic:ark', 'req-3')).kind).toBe('ASSISTED_ACTION_REJECTED')
  })

  it('goes one advance at a time: with Mysticism a card is chosen before the second advance', () => {
    const taken = armyTakes(sotTurn({ step: 9, techs: ['Mysticism'] }), ARK)
    expect(me(taken).pendingRewards).toHaveLength(1)
    expect(status(taken, 'relic:ark')).toMatchObject({
      status: 'unavailable',
      reason: expect.stringContaining('Choose the card to keep'),
    })
    const chosen = keep(taken, 'req-choose')
    expect(status(chosen, 'relic:ark').status).toBe('ready')
  })

  it('keeps the culture hand limit: a hand over its size stops the advance and leaves the button with the reason', () => {
    const base = sotTurn({ step: 9 })
    const cards = topCards(base, 'CULTURE_1', 3).map((item) => ({ ...item, ownerId: CASH1981, hidden: true }))
    const ids = new Set(cards.map((card) => card.id))
    const full: GameState = {
      ...base,
      items: base.items.filter((item) => !ids.has(item.id)),
      players: base.players.map((player) => (player.playerId === CASH1981 ? { ...player, items: [...player.items, ...cards] } : player)),
    }
    const taken = armyTakes(full, ARK)
    expect(taken.board.pieces.some((piece) => piece.assetId === ARK)).toBe(false)
    expect(step(taken)).toBe(step(full))
    expect(status(taken, 'relic:ark')).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('culture hand size') })
  })

  it('takes an advance back by the vote, and the advance can be made again', () => {
    const before = sotTurn({ step: 9 })
    const taken = armyTakes(before, ARK)
    const requestId = taken.assistedActions.find((record) => record.kind === 'relic:ark')?.id
    if (requestId === undefined) throw new Error('the army did not claim the advance')
    const undone = undoByVote(taken, requestId)
    expect(step(undone)).toBe(step(before))
    expect(status(undone, 'relic:ark').status).toBe('ready')
  })
})

describe('the School of Confucius', () => {
  const drawn = (state: GameState): number => me(state).pendingRewards[0]?.candidateIds.length ?? 0

  it('draws two Great Persons the moment an army takes it, and one is kept with its marker', () => {
    const taken = armyTakes(sotTurn(), CONFUCIUS)
    expect(drawn(taken)).toBe(2)
    expect(status(taken, 'relic:confucius').status).toBe('unavailable')
    const kept = keep(taken, 'req-choose')
    expect(me(kept).pendingRewards).toEqual([])
    expect(kept.log.some((entry) => entry.publicLog.includes('great person marker into reserve'))).toBe(true)
  })

  it('draws a card more for Organized Religion, and for the Greeks, and the two stack', () => {
    expect(drawn(armyTakes(sotTurn({ policies: ['Organized Religion'] }), CONFUCIUS))).toBe(3)
    expect(drawn(armyTakes(sotTurn({ civ: 'Greeks' }), CONFUCIUS))).toBe(3)
    expect(drawn(armyTakes(sotTurn({ civ: 'Greeks', policies: ['Organized Religion'] }), CONFUCIUS))).toBe(4)
  })

  it('does not count an Organized Religion that is not revealed', () => {
    expect(drawn(armyTakes(sotTurn({ hiddenPolicies: ['Organized Religion'] }), CONFUCIUS))).toBe(2)
  })

  it('puts the cards back on undo, and the marker with them', () => {
    const base = sotTurn()
    const taken = armyTakes(base, CONFUCIUS)
    const kept = keep(taken, 'req-choose')
    const requestId = kept.assistedActions.find((record) => record.kind === 'relic:confucius')?.id
    if (requestId === undefined) throw new Error('the army did not claim the Great Persons')
    const undone = undoByVote(kept, requestId)
    expect(me(undone).items).toHaveLength(me(base).items.length)
    expect(undone.board.pieces.filter((piece) => piece.category === 'greatperson')).toHaveLength(
      base.board.pieces.filter((piece) => piece.category === 'greatperson').length,
    )
    expect(status(undone, 'relic:confucius').status).toBe('ready')
  })

  it('keeps the other players out of the cards: the public line names the numbers only', () => {
    const taken = armyTakes(sotTurn(), CONFUCIUS)
    const candidates = me(taken).pendingRewards[0]?.candidateIds ?? []
    const names = me(taken).items.filter((item) => candidates.includes(item.id)).map((item) => ('name' in item ? item.name : ''))
    const publicText = taken.log.map((entry) => entry.publicLog).join('\n')
    for (const name of names) expect(publicText).not.toContain(name)
  })
})

describe("Attila's Village", () => {
  const units = (state: GameState): number => me(state).items.filter((item) => ['infantry', 'artillery', 'mounted', 'aircraft'].includes(item.kind)).length

  it('is a free unit card of the type chosen, twice, and the claim is not made by the move', () => {
    const base = sotTurn()
    const taken = armyTakes(base, ATTILA)
    expect(taken.assistedActions.some((record) => record.kind.startsWith('relic:'))).toBe(false)
    expect(status(taken, 'relic:attila:infantry').status).toBe('ready')

    const first = unwrap(act(taken, 'relic:attila:infantry', 'req-1'))
    const second = unwrap(act(first, 'relic:attila:mounted', 'req-2'))
    expect(units(second)).toBe(units(base) + 2)
    expect(status(second, 'relic:attila:artillery').status).toBe('unavailable')
    expect(unwrapErr(act(second, 'relic:attila:infantry', 'req-3')).kind).toBe('ASSISTED_ACTION_REJECTED')
  })

  it('offers aircraft only with Flight', () => {
    const taken = armyTakes(sotTurn(), ATTILA)
    expect(status(taken, 'relic:attila:aircraft').status).toBe('not-owned')
    const withFlight = armyTakes(sotTurn({ techs: ['Flight'] }), ATTILA)
    expect(status(withFlight, 'relic:attila:aircraft').status).toBe('ready')
  })

  it('puts the card back on undo', () => {
    const taken = armyTakes(sotTurn(), ATTILA)
    const used = unwrap(act(taken, 'relic:attila:infantry'))
    const undone = undoByVote(used, 'req-1')
    expect(units(undone)).toBe(units(taken))
    expect(status(undone, 'relic:attila:infantry').status).toBe('ready')
  })

  it('keeps the card private: the public line says the type only', () => {
    const used = unwrap(act(armyTakes(sotTurn(), ATTILA), 'relic:attila:infantry'))
    const line = used.log.find((entry) => entry.assistedActionId === 'req-1')
    expect(line?.publicLog).toContain('a free infantry unit')
  })
})

describe('the board Undo of a claimed relic', () => {
  const markerBack = (state: GameState, assetId: string) => state.board.pieces.some((piece) => piece.assetId === assetId)

  it.each([
    ['the School of Confucius, claimed by the move', CONFUCIUS, undefined],
    ["Attila's Village, claimed from its button", ATTILA, 'relic:attila:infantry'],
    ['Atlantis, claimed in Start of Turn', 'relics/atlantis', 'sot:atlantis'],
  ] as const)('leaves the marker off the map while %s stands, and puts it back once the claim is undone', (_name, assetId, button) => {
    const taken = armyTakes(sotTurn(), assetId)
    const claimed = button === undefined ? taken : unwrap(act(taken, button, 'req-claim'))
    const claim = claimed.assistedActions.find((record) => record.status === 'applied')
    if (claim === undefined) throw new Error('nothing was claimed')
    expect(unwrapErr(undoLastBoardChange(claimed, CASH1981)).kind).toBe('BOARD_UNDO_ASSISTED')

    const released = unwrap(undoLastBoardChange(undoByVote(claimed, claim.id), CASH1981))
    expect(markerBack(released, assetId)).toBe(true)
  })

  it('names a claim for every relic on the board', () => {
    const relics = BOARD_ASSETS.filter((asset) => asset.category === 'relic')
    expect(relics).toHaveLength(5)
    for (const relic of relics) {
      expect(ASSISTED_ACTIONS.some((definition) => claimsRelic(relic.id, definition.kind)), relic.id).toBe(true)
    }
  })
})
