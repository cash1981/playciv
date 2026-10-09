/**
 * The three incense cards on the one contract (Chivalry, Currency, Metal
 * Casting). Chivalry's own behaviour is pinned in `assisted.test.ts` and
 * `assisted-undo.test.ts`; this file proves the other two behave the same way
 * because they come from the same definition, and that the cards do not share a
 * use between them.
 */

import { describe, expect, it } from 'vitest'

import { chooseTech, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import {
  ASSISTED_ACTION_KINDS,
  ASSISTED_TECH_ACTIONS,
  assistedAvailability,
  availableActionsFor,
  isAssistedActionKind,
  performAssistedAction,
} from '../src/assisted.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { AssistedActionKind, GameState } from '../src/state.js'
import { toPlayerView } from '../src/state.js'

import { player, withHutInHand, withPieceInArea } from './assisted-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-10-09T10:00:00.000Z'

const CARDS = [
  ['chivalry', 'Chivalry', 5],
  ['currency', 'Currency', 3],
  ['metalCasting', 'Metal Casting', 7],
] as const satisfies readonly (readonly [AssistedActionKind, string, number])[]

/** The given techs chosen and revealed, Start of Turn and Trade done: City Management is open. */
function openTurn(...techNames: readonly string[]): GameState {
  let state = firstCivGame()
  for (const techName of techNames) {
    state = unwrap(chooseTech(state, { playerId: CASH1981, techName }))
    state = unwrap(revealTech(state, { playerId: CASH1981, techName }))
  }
  return unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))
}

const press = (state: GameState, action: AssistedActionKind, requestId: string) =>
  performAssistedAction(state, { playerId: CASH1981, action, requestId, at: AT })

const incensePieces = (state: GameState) =>
  state.board.pieces.filter((piece) => piece.assetId === 'resources/incense')

function undoByVote(state: GameState, requestId: string): GameState {
  const logId = state.log.find((entry) => entry.assistedActionId === requestId)?.id
  if (logId === undefined) throw new Error('no log line for the action')
  let next = unwrap(initiateUndo(state, { logId, playerId: CASH1981 }))
  for (const playerId of [KARANDRAS1, ITCHI, CHUL]) {
    next = unwrap(vote(next, { logId, playerId, vote: true, at: AT }))
  }
  return next
}

/** The parts of the state an action touches, in a form that survives an undo that re-adds a piece on top. */
function touched(state: GameState) {
  const hand = player(state)
  return {
    stats: hand.stats,
    turns: hand.playerTurns,
    items: hand.items,
    discarded: state.discardedItems,
    pieces: [...state.board.pieces].sort((a, b) => a.id.localeCompare(b.id)),
  }
}

describe('the registry and the tech map', () => {
  it('lists the three incense cards next to Democracy and Printing Press', () => {
    expect([...ASSISTED_ACTION_KINDS].sort()).toEqual([
      'chivalry',
      'currency',
      'democracy',
      'metalCasting',
      'printingPress',
    ])
    for (const [kind] of CARDS) expect(isAssistedActionKind(kind)).toBe(true)
  })

  it('maps each tech name to its action, and nothing else', () => {
    expect(Object.fromEntries(ASSISTED_TECH_ACTIONS)).toEqual({
      Chivalry: 'chivalry',
      Currency: 'currency',
      'Metal Casting': 'metalCasting',
      Democracy: 'democracy',
      'Printing Press': 'printingPress',
    })
    expect(ASSISTED_TECH_ACTIONS.get('Writing')).toBeUndefined()
  })

  it('the label of each card is the tech name', () => {
    const state = openTurn('Chivalry', 'Currency', 'Metal Casting')
    const labels = availableActionsFor(state, CASH1981).map((entry) => [entry.action, entry.label])
    for (const [kind, techName] of CARDS) expect(labels).toContainEqual([kind, techName])
  })
})

describe.each(CARDS)('%s (%s, %i culture)', (kind, techName, culture) => {
  const usageKey = `card:${techName}`
  const ready = (): { state: GameState; pieceId: string } => {
    const { state, piece } = withPieceInArea(openTurn(techName), 'resources/incense')
    return { state, pieceId: piece.id }
  }

  it('is ready with the tech revealed, City Management open and an incense piece', () => {
    expect(assistedAvailability(ready().state, CASH1981, kind)).toMatchObject({ status: 'ready' })
  })

  it('spends the piece, gains the culture, writes the usage key, one record and one public line', () => {
    const { state, pieceId } = ready()
    const done = unwrap(press(state, kind, 'req-1'))

    expect(player(done).stats.culture).toBe(player(state).stats.culture + culture)
    expect(done.board.pieces.some((piece) => piece.id === pieceId)).toBe(false)
    expect(player(done).playerTurns[0]?.usedActions).toContain(usageKey)
    expect(done.assistedActions).toHaveLength(1)
    expect(done.assistedActions[0]).toMatchObject({
      id: 'req-1',
      kind,
      playerId: CASH1981,
      turnNumber: 1,
      phase: 'CM',
      usageKey,
      status: 'applied',
      effect: { kind, culture, spent: { kind: 'piece', resource: 'Incense', piece: { id: pieceId } } },
    })
    const lines = done.log.filter((entry) => entry.assistedActionId === 'req-1')
    expect(lines).toHaveLength(1)
    expect(lines[0]?.publicLog).toBe(
      `cash1981 used ${techName}: spent 1 Incense and gained ${culture} culture`,
    )
  })

  it('is once per turn: a new requestId is refused and spends nothing, the same one is a no-op', () => {
    const two = withPieceInArea(ready().state, 'resources/incense').state
    const once = unwrap(press(two, kind, 'req-a'))

    expect(assistedAvailability(once, CASH1981, kind).status).toBe('used')
    expect(unwrapErr(press(once, kind, 'req-b'))).toMatchObject({
      kind: 'ASSISTED_ACTION_REJECTED',
      status: 'used',
    })
    expect(unwrap(press(once, kind, 'req-a'))).toBe(once)
    expect(incensePieces(once)).toHaveLength(1)
    expect(player(once).stats.culture).toBe(culture)
  })

  it('needs an incense token, and changes nothing without one', () => {
    const state = openTurn(techName)
    const snapshot = JSON.stringify(state)
    expect(assistedAvailability(state, CASH1981, kind).status).toBe('needs-resource')
    expect(unwrapErr(press(state, kind, 'req-none'))).toMatchObject({ status: 'needs-resource' })
    expect(JSON.stringify(state)).toBe(snapshot)
  })

  it('is the wrong phase once City Management is done, or before Trade is', () => {
    const closed = unwrap(
      markPhasesDone(ready().state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' }),
    )
    expect(assistedAvailability(closed, CASH1981, kind).status).toBe('wrong-phase')
    expect(unwrapErr(press(closed, kind, 'r'))).toMatchObject({ status: 'wrong-phase' })

    let early = firstCivGame()
    early = unwrap(chooseTech(early, { playerId: CASH1981, techName }))
    early = unwrap(revealTech(early, { playerId: CASH1981, techName }))
    early = withPieceInArea(early, 'resources/incense').state
    expect(assistedAvailability(early, CASH1981, kind).status).toBe('wrong-phase')
  })

  it('is not owned without the tech, and unavailable while it is hidden', () => {
    const without = withPieceInArea(
      unwrap(markPhasesDone(firstCivGame(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' })),
      'resources/incense',
    ).state
    expect(assistedAvailability(without, CASH1981, kind).status).toBe('not-owned')

    let hidden = unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName }))
    hidden = withPieceInArea(
      unwrap(markPhasesDone(hidden, { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' })),
      'resources/incense',
    ).state
    const availability = assistedAvailability(hidden, CASH1981, kind)
    expect(availability.status).toBe('unavailable')
    expect(availability.reason).toContain(`Reveal ${techName}`)
  })

  it('uses an Incense hut in the hand first and leaves the piece', () => {
    const withPiece = ready()
    const withHut = withHutInHand(withPiece.state, 'Incense')
    const done = unwrap(press(withHut.state, kind, 'req-hut'))

    expect(done.board.pieces.some((piece) => piece.id === withPiece.pieceId)).toBe(true)
    expect(player(done).items.some((item) => item.id === withHut.hutId)).toBe(false)
    expect(done.discardedItems.find((item) => item.id === withHut.hutId)?.hidden).toBe(true)
    expect(done.assistedActions[0]?.effect).toMatchObject({
      spent: { kind: 'hut', itemId: withHut.hutId },
    })
    expect(player(done).stats.culture).toBe(culture)
  })

  it('an undo vote restores the piece, the culture and the use exactly', () => {
    const { state } = ready()
    const done = unwrap(press(state, kind, 'req-1'))
    const undone = undoByVote(done, 'req-1')

    expect(touched(undone)).toEqual(touched(state))
    expect(undone.assistedActions[0]?.status).toBe('undone')
    expect(undone.log.at(-1)?.publicLog).toBe(
      `System: cash1981's ${techName} was undone: ${culture} culture removed and the Incense token returned`,
    )
    // The use is free again, so it can be done once more with a new request id
    expect(assistedAvailability(undone, CASH1981, kind).status).toBe('ready')
    expect(player(unwrap(press(undone, kind, 'req-2'))).stats.culture).toBe(culture)
  })

  it('an undo vote puts the exact hut back in the hand', () => {
    const { state, hutId } = withHutInHand(ready().state, 'Incense')
    const undone = undoByVote(unwrap(press(state, kind, 'req-1')), 'req-1')

    expect(touched(undone)).toEqual(touched(state))
    expect(player(undone).items.some((item) => item.id === hutId)).toBe(true)
  })

  it('does not leak the effect or the hut into another player\'s view', () => {
    const { state, hutId } = withHutInHand(ready().state, 'Incense')
    const done = unwrap(press(state, kind, 'req-leak'))
    for (const viewerId of [KARANDRAS1, ITCHI, CHUL, '']) {
      const json = JSON.stringify(toPlayerView(done, viewerId))
      expect(json).not.toContain('"effect"')
      expect(json).not.toContain('usageKey')
      expect(json).not.toContain(hutId)
    }
  })
})

describe('the cards do not share a use', () => {
  it('Currency and Chivalry are both used in one turn, each once, each spending its own incense', () => {
    let state = openTurn('Chivalry', 'Currency')
    state = withPieceInArea(state, 'resources/incense').state
    state = withPieceInArea(state, 'resources/incense').state

    const first = unwrap(press(state, 'currency', 'req-currency'))
    // Chivalry is still ready after Currency was used
    expect(assistedAvailability(first, CASH1981, 'chivalry').status).toBe('ready')
    const both = unwrap(press(first, 'chivalry', 'req-chivalry'))

    expect(player(both).stats.culture).toBe(3 + 5)
    expect(incensePieces(both)).toHaveLength(0)
    expect(player(both).playerTurns[0]?.usedActions).toEqual(
      expect.arrayContaining(['card:Currency', 'card:Chivalry']),
    )
    expect(both.assistedActions.map((record) => record.kind)).toEqual(['currency', 'chivalry'])
    // Each is now used up, whichever request id comes next
    expect(unwrapErr(press(both, 'currency', 'again-1'))).toMatchObject({ status: 'used' })
    expect(unwrapErr(press(both, 'chivalry', 'again-2'))).toMatchObject({ status: 'used' })
  })

  it('with one incense only the first card gets it, the second needs a resource', () => {
    const state = withPieceInArea(openTurn('Chivalry', 'Currency'), 'resources/incense').state
    const first = unwrap(press(state, 'currency', 'req-1'))
    expect(assistedAvailability(first, CASH1981, 'chivalry').status).toBe('needs-resource')
    expect(unwrapErr(press(first, 'chivalry', 'req-2'))).toMatchObject({ status: 'needs-resource' })
  })

  it('undoing one card leaves the other card, its culture and its use alone', () => {
    let state = openTurn('Chivalry', 'Currency')
    state = withPieceInArea(state, 'resources/incense').state
    state = withPieceInArea(state, 'resources/incense').state
    const both = unwrap(press(unwrap(press(state, 'currency', 'req-currency')), 'chivalry', 'req-chivalry'))

    const undone = undoByVote(both, 'req-currency')

    expect(player(undone).stats.culture).toBe(5)
    expect(player(undone).playerTurns[0]?.usedActions).toEqual(['card:Chivalry'])
    expect(assistedAvailability(undone, CASH1981, 'currency').status).toBe('ready')
    expect(assistedAvailability(undone, CASH1981, 'chivalry').status).toBe('used')
    expect(incensePieces(undone)).toHaveLength(1)
  })
})
