/**
 * Starting a turn (issue #215).
 *
 * A turn starts when `turnStatus.currentTurn` gets ahead of the last turn that
 * has a starter. That can happen in more than one way: the last player marks
 * Research done, or a withdrawal removes the one player who held the turn back.
 * So the roll-over is a catch-up that every such action calls, and not a step
 * inside one of them.
 */

import { coinSourcesOf, totalCoins } from '../coins.js'
import { tradeCeilingOf } from '../limits.js'
import { appendLog } from '../log.js'
import { collectTradeForTurn } from '../trade-collection.js'
import { payArchimedesAfterResearch } from '../archimedes.js'
import type { GameState, Playerhand } from '../state.js'
import type { PlayerTurn } from '../turn.js'
import { bySeat, publicTurn, publicTurnKey, sameTurn, seatAfter, startPlayerOf, turnStatus } from '../turn.js'
import { placeStartMarker } from './board.js'

/**
 * Starts every turn between the newest one with a starter and the current turn,
 * one seat of rotation each.
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

/**
 * A player who chose a tech during the ending turn's Research phase used their
 * trade: when the next turn's Start of Turn begins, their trade goes down to
 * their coin total (and never above the trade track). A player who only ended
 * Research without choosing a tech keeps the trade they had. Start of Turn can
 * then add to it.
 */
function resetTradeToCoins(state: GameState, endingTurn: number): GameState {
  const players = state.players.map((player) => {
    const researched = Object.values(player.researchTurns).includes(endingTurn)
    if (!researched) return player
    const ceiling = tradeCeilingOf(player.civilization?.name)
    const coins = Math.max(totalCoins(coinSourcesOf(state, player)), 0)
    const trade = Math.min(ceiling, coins)
    return player.stats.trade === trade
      ? player
      : { ...player, stats: { ...player.stats, trade } }
  })
  return players.some((player, index) => player !== state.players[index]) ? { ...state, players } : state
}

/**
 * A player may have marked the new turn's phases before the turn started (a
 * client acting ahead). Their Start of Turn is already done, so collect the city
 * trade now, after the reset, instead of losing it because the phase transition
 * already happened while the previous turn was current.
 */
function collectAheadTrade(state: GameState, turnNumber: number): GameState {
  let next = state
  for (const candidate of state.players) {
    const player = next.players.find((entry) => entry.playerId === candidate.playerId)
    if (player === undefined) continue
    const turn = player.playerTurns.find((entry) => entry.turnNumber === turnNumber)
    if (turn === undefined || turn.done.SOT !== true || turn.tradeCollected !== undefined) continue
    const collected = collectTradeForTurn(next, player, turn)
    if (collected.turn === turn) continue
    next = withCollectedTurn(next, player, collected)
  }
  return next
}

function withCollectedTurn(
  state: GameState,
  player: Playerhand,
  collected: { readonly player: Playerhand; readonly turn: PlayerTurn },
): GameState {
  return {
    ...state,
    players: state.players.map((entry) =>
      entry.playerId === player.playerId
        ? {
            ...collected.player,
            playerTurns: entry.playerTurns.map((turn) => (sameTurn(turn, collected.turn) ? collected.turn : turn)),
          }
        : entry,
    ),
    publicTurns: { ...state.publicTurns, [publicTurnKey(collected.turn)]: publicTurn(collected.turn) },
  }
}

function startTurn(
  state: GameState,
  turnNumber: number,
  actorId: string | undefined,
  at: string | undefined,
): GameState {
  if (state.turnStarters[turnNumber] !== undefined) return state

  const reset = collectAheadTrade(resetTradeToCoins(state, turnNumber - 1), turnNumber)
  const current = startPlayerOf(reset)
  const starter =
    current === undefined ? undefined : seatAfter(bySeat(reset.players), current.playernumber)
  if (starter === undefined) return reset

  // Archimedes waits for the whole table to finish Research, so a hidden choice
  // made by another player cannot be inferred from a missing +3.
  const paid = payArchimedesAfterResearch(reset, turnNumber - 1, at)
  // Log first, so the board history entry counts the line as known at the time
  const logged = appendLog(paid, {
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
