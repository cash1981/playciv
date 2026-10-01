/**
 * Chat orders (issue #215): starting a turn.
 *
 * A turn starts when `turnStatus.currentTurn` gets ahead of the last turn that
 * has a starter. That can happen in more than one way: the last player marks
 * Research done, a classic reveal sets `done`, or a withdrawal removes the one
 * player who held the turn back. So the roll-over is a catch-up that every such
 * action calls, and not a step inside one of them.
 */

import { appendLog } from '../log.js'
import type { GameState } from '../state.js'
import { bySeat, seatAfter, startPlayerOf, turnStatus } from '../turn.js'
import { placeStartMarker } from './board.js'

/**
 * Starts every turn between the newest one with a starter and the current turn,
 * one seat of rotation each. Nothing when chat orders is off.
 *
 * `turnStarters` is the guard, so unmarking a Research and marking it again, which
 * moves `currentTurn` back and forth, never rotates twice, and an unmark never
 * rolls a started turn back. A jump of more than one turn (everybody marked turn 2
 * done before the last player finished turn 1) rotates once per turn and leaves no
 * gap in the record.
 *
 * Each turn is a public log line and a normal board history entry for the marker,
 * made in the name of `actorId`, or of the new start player when there is no actor
 * to name (a withdrawal). The caller has checked access.
 */
export function startMissingTurns(
  state: GameState,
  actorId: string | undefined,
  at: string | undefined,
): GameState {
  if (!state.chatOrders) return state
  const current = turnStatus(state).currentTurn
  const started = Object.keys(state.turnStarters).reduce(
    (best, key) => Math.max(best, Number(key)),
    state.chatOrdersStartTurn,
  )
  let next = state
  for (let turnNumber = started + 1; turnNumber <= current; turnNumber += 1) {
    next = startTurn(next, turnNumber, actorId, at)
  }
  return next
}

function startTurn(
  state: GameState,
  turnNumber: number,
  actorId: string | undefined,
  at: string | undefined,
): GameState {
  if (state.turnStarters[turnNumber] !== undefined) return state

  const current = startPlayerOf(state)
  const starter =
    current === undefined ? undefined : seatAfter(bySeat(state.players), current.playernumber)
  if (starter === undefined) return state

  // Log first, so the board history entry counts the line as known at the time
  const logged = appendLog(state, {
    username: 'System',
    publicLog: `Turn ${turnNumber}: ${starter.username} starts with the Start of turn phase`,
  })
  const moved = placeStartMarker(logged, starter, actorId ?? starter.playerId, at)
  return {
    ...moved,
    startPlayerId: starter.playerId,
    turnStarters: { ...moved.turnStarters, [turnNumber]: starter.username },
  }
}
