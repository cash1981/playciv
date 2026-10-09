/**
 * The assisted action contract across a reopened phase. `unmarkPhaseDone` already
 * exists (no vote, later phases untouched); these tests pin that an assisted
 * action's use, its request id and its effect are not reset when City Management
 * is marked done and then reopened.
 */

import { describe, expect, it } from 'vitest'

import { chooseTech, revealTech } from '../src/actions/player.js'
import { markPhasesDone, unmarkPhaseDone } from '../src/actions/turn.js'
import { assistedAvailability, performAssistedAction } from '../src/assisted.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { AssistedActionKind, GameState } from '../src/state.js'

import { player, withPieceInArea } from './assisted-fixture.js'
import { CASH1981, firstCivGame } from './fixture.js'

const press = (state: GameState, action: AssistedActionKind, requestId: string) =>
  performAssistedAction(state, { playerId: CASH1981, action, requestId })

const markCmDone = (state: GameState): GameState =>
  unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' }))

const reopenCm = (state: GameState): GameState =>
  unwrap(unmarkPhaseDone(state, { playerId: CASH1981, turnNumber: 1, phase: 'CM' }))

/** Chivalry and Currency revealed, City Management open, two incense pieces in the area. */
function twoCardsWithIncense(): GameState {
  let state = firstCivGame()
  for (const techName of ['Chivalry', 'Currency']) {
    state = unwrap(chooseTech(state, { playerId: CASH1981, techName }))
    state = unwrap(revealTech(state, { playerId: CASH1981, techName }))
  }
  state = unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))
  state = withPieceInArea(state, 'resources/incense').state
  return withPieceInArea(state, 'resources/incense').state
}

const incense = (state: GameState): number =>
  state.board.pieces.filter((piece) => piece.assetId === 'resources/incense').length

describe('a reopened City Management phase', () => {
  const usedChivalry = (): GameState => unwrap(press(twoCardsWithIncense(), 'chivalry', 'req-1'))

  it('is the wrong phase while it is done and open again once it is reopened', () => {
    const closed = markCmDone(usedChivalry())
    expect(assistedAvailability(closed, CASH1981, 'currency').status).toBe('wrong-phase')
    expect(assistedAvailability(reopenCm(closed), CASH1981, 'currency').status).toBe('ready')
  })

  it('keeps Chivalry used: the usage is not reset and a new requestId is refused', () => {
    const reopened = reopenCm(markCmDone(usedChivalry()))

    expect(player(reopened).playerTurns[0]?.usedActions).toContain('card:Chivalry')
    expect(assistedAvailability(reopened, CASH1981, 'chivalry').status).toBe('used')
    expect(unwrapErr(press(reopened, 'chivalry', 'req-2'))).toMatchObject({
      kind: 'ASSISTED_ACTION_REJECTED',
      status: 'used',
    })
  })

  it('treats the same requestId as a no-op and grants no second culture', () => {
    const once = usedChivalry()
    const reopened = reopenCm(markCmDone(once))

    const again = unwrap(press(reopened, 'chivalry', 'req-1'))

    expect(again).toBe(reopened)
    expect(player(again).stats.culture).toBe(player(once).stats.culture)
    expect(again.assistedActions).toHaveLength(1)
    expect(incense(again)).toBe(1)
    // The same id is also a no-op while the phase is closed
    const closed = markCmDone(once)
    expect(unwrap(press(closed, 'chivalry', 'req-1'))).toBe(closed)
  })

  it('a refused second press spends nothing and changes nothing', () => {
    const reopened = reopenCm(markCmDone(usedChivalry()))
    const snapshot = JSON.stringify(reopened)
    unwrapErr(press(reopened, 'chivalry', 'req-2'))
    expect(JSON.stringify(reopened)).toBe(snapshot)
    expect(incense(reopened)).toBe(1)
  })

  it('marking City Management done again changes only the phase flag and the log', () => {
    const reopened = reopenCm(markCmDone(usedChivalry()))
    const closedAgain = markCmDone(reopened)

    expect(player(closedAgain).stats).toEqual(player(reopened).stats)
    expect(player(closedAgain).playerTurns[0]?.usedActions).toEqual(
      player(reopened).playerTurns[0]?.usedActions,
    )
    expect(player(closedAgain).playerTurns[0]?.done.CM).toBe(true)
    expect(closedAgain.assistedActions).toEqual(reopened.assistedActions)
    expect(closedAgain.board).toEqual(reopened.board)
    expect(closedAgain.log.length).toBe(reopened.log.length + 1)
    // Still used, and now the wrong phase again
    expect(assistedAvailability(closedAgain, CASH1981, 'chivalry').status).toBe('wrong-phase')
    expect(unwrapErr(press(closedAgain, 'chivalry', 'req-2'))).toMatchObject({ status: 'wrong-phase' })
  })

  it('lets a card that is not used yet be used in the reopened phase, once', () => {
    const once = usedChivalry()
    const reopened = reopenCm(markCmDone(once))

    const both = unwrap(press(reopened, 'currency', 'req-currency'))

    expect(player(both).stats.culture).toBe(player(once).stats.culture + 3)
    expect(player(both).playerTurns[0]?.usedActions).toEqual(
      expect.arrayContaining(['card:Chivalry', 'card:Currency']),
    )
    expect(incense(both)).toBe(0)
    expect(both.assistedActions.map((record) => record.kind)).toEqual(['chivalry', 'currency'])
    expect(unwrapErr(press(both, 'currency', 'req-again'))).toMatchObject({ status: 'used' })
  })
})
