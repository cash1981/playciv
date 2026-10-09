/**
 * Orders as the old Turn orders panel left them in a saved game. Nothing in the
 * engine writes a draft or publishes a phase that way any more, but games saved
 * before the single chat still hold data of that shape (`orders`, `revealed`,
 * `done`, `history` and the masked public copy), and the load-time adoption and
 * the timeline read it. These tests build that data directly.
 */

import type { GameState } from '../src/state.js'
import { findPlayer, withPlayer } from '../src/state.js'
import { createPlayerTurn, publicTurn, publicTurnKey, sameTurn } from '../src/turn.js'
import type { PlayerTurn, TurnPhase } from '../src/turn.js'

/**
 * Saves `order` as the player's order for a phase. Without `publishedAt` it is an
 * unpublished draft: kept in the player's own turn, masked in the public copy. With
 * it, the phase is published and done and the version goes into `history`.
 * Saving over a published phase makes it private again but keeps the history, as
 * the old panel did.
 */
export function savedOrder(
  state: GameState,
  playerId: string,
  turnNumber: number,
  phase: TurnPhase,
  order: string,
  publishedAt?: string,
): GameState {
  const player = findPlayer(state, playerId)
  if (player === undefined) throw new Error(`no player ${playerId}`)
  const existing = player.playerTurns.find((turn) => turn.turnNumber === turnNumber)
  const base = existing ?? createPlayerTurn(player.username, turnNumber)
  const draft: PlayerTurn = {
    ...base,
    orders: { ...base.orders, [phase]: order },
    revealed: { ...base.revealed, [phase]: false },
  }
  const turn: PlayerTurn =
    publishedAt === undefined
      ? draft
      : {
          ...draft,
          revealed: { ...draft.revealed, [phase]: true },
          done: { ...draft.done, [phase]: true },
          history: {
            ...draft.history,
            [phase]: [...draft.history[phase], { markdown: order, at: publishedAt }],
          },
        }
  const playerTurns =
    existing === undefined
      ? [...player.playerTurns, turn]
      : player.playerTurns.map((candidate) => (sameTurn(candidate, turn) ? turn : candidate))
  return {
    ...withPlayer(state, { ...player, playerTurns }),
    publicTurns: { ...state.publicTurns, [publicTurnKey(turn)]: publicTurn(turn) },
  }
}
