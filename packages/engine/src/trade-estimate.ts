/**
 * A guess at the trade a player should have in the Trade phase, for the Trade box to start from.
 *
 * It is the trade around their cities (`city-production.ts`), plus the trade their Start of Turn
 * abilities gave this turn, plus the coins they hold: trade kept in the Research phase of an
 * earlier turn is kept as coins. The human gave the sum. It is never a complete count (see the
 * notes on each city), it cannot go above the trade track (`tradeCeilingOf`), and a player always
 * types the number that counts. Read from the player's own records, so it is only ever projected
 * to the player it is about.
 */

import { cityProductionsOf } from './city-production.js'
import { coinSourcesOf, totalCoins } from './coins.js'
import { tradeCeilingOf } from './limits.js'
import type { GameState, Playerhand } from './state.js'
import { TRADE_SET_KEY, turnStatus } from './turn.js'

export interface TradeEstimate {
  /** The trade icons and buildings around the player's cities. */
  readonly cities: number
  /** The trade the player's Start of Turn abilities gave this turn (the ones not undone). */
  readonly startOfTurn: number
  /** Every coin the player holds. */
  readonly coins: number
  /** The most trade the player may hold. */
  readonly ceiling: number
  /** The three added up, held to the ceiling. */
  readonly total: number
  /** Whether the player's trade has been set this turn, from any panel, so the guess is no longer the number to show. */
  readonly set: boolean
}

export function tradeEstimateOf(state: GameState, player: Playerhand): TradeEstimate {
  const turn = turnStatus(state).currentTurn
  const cities = cityProductionsOf(state, player).reduce((sum, city) => sum + city.trade.outskirts, 0)
  const startOfTurn = state.assistedActions
    .filter(
      (record) =>
        record.playerId === player.playerId &&
        record.turnNumber === turn &&
        record.phase === 'SOT' &&
        record.status === 'applied' &&
        record.effect.kind === 'statGain',
    )
    .reduce((sum, record) => sum + (record.effect.kind === 'statGain' ? record.effect.trade : 0), 0)
  const coins = Math.max(totalCoins(coinSourcesOf(state, player)), 0)
  const ceiling = tradeCeilingOf(player.civilization?.name)
  const set = player.playerTurns.some((candidate) => candidate.turnNumber === turn && candidate.usedActions.includes(TRADE_SET_KEY))
  return { cities, startOfTurn, coins, ceiling, total: Math.min(ceiling, cities + startOfTurn + coins), set }
}
