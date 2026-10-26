/**
 * Adding the trade around a player's cities to their stored trade, once per
 * turn, and taking that addition back when Start of Turn is reopened.
 *
 * The caller decides that Trade is starting (the phase transition in
 * `actions/turn.ts`, or a turn that was marked ahead before it began in
 * `actions/new-turn.ts`). A trade number set by hand is an override and is
 * never added to, so an early guess cannot be counted twice.
 */

import { cityProductionsOf } from './city-production.js'
import { tradeCeilingOf } from './limits.js'
import type { GameState, Playerhand } from './state.js'
import type { PlayerTurn } from './turn.js'
import { TRADE_SET_KEY } from './turn.js'

/** The trade around a player's cities, the figure Trade collects when that phase starts. */
export function tradeAroundCitiesOf(state: GameState, player: Playerhand): number {
  return cityProductionsOf(state, player).reduce((sum, city) => sum + city.trade.outskirts, 0)
}

/**
 * Adds the city trade to a turn that has not collected it yet. The amount that
 * actually went in is recorded, never negative: trade already above the track is
 * left alone instead of being pulled down, so shutting Start of Turn again
 * cannot send it back up past the ceiling.
 */
export function collectTradeForTurn(
  state: GameState,
  player: Playerhand,
  turn: PlayerTurn,
): { readonly player: Playerhand; readonly turn: PlayerTurn } {
  if (turn.tradeCollected !== undefined) return { player, turn }
  if (turn.usedActions.includes(TRADE_SET_KEY)) return { player, turn }

  const ceiling = tradeCeilingOf(player.civilization?.name)
  const after = Math.min(ceiling, player.stats.trade + tradeAroundCitiesOf(state, player))
  const amount = Math.max(0, after - player.stats.trade)
  return {
    player: { ...player, stats: { ...player.stats, trade: player.stats.trade + amount } },
    turn: { ...turn, tradeCollected: amount },
  }
}

/** Takes back the recorded addition, leaving a trade number the player edited later alone. */
export function undoTradeCollection(
  player: Playerhand,
  turn: PlayerTurn,
): { readonly player: Playerhand; readonly turn: PlayerTurn } {
  if (turn.tradeCollected === undefined) return { player, turn }
  const { tradeCollected, ...rest } = turn
  return {
    player: { ...player, stats: { ...player.stats, trade: Math.max(0, player.stats.trade - tradeCollected) } },
    turn: rest,
  }
}
