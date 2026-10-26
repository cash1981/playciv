/**
 * The trade the Trade tab starts from.
 *
 * The engine resets trade to the coins a player keeps when the next turn's
 * Start of Turn begins, then Start of Turn abilities add to it. When the player
 * marks Start of Turn done and Trade opens, the trade around their cities is
 * added once and stored; the tab then shows that stored number and never counts
 * the cities again. This module still guesses for a turn where the collection
 * has not happened yet (an old save already in Trade): the trade the player has
 * plus the trade around their cities, held to the trade track.
 *
 * The city count is never complete (see the notes on each city), and a player
 * always types the number that counts. Read from the player's own records, so it
 * is only ever projected to the player it is about.
 */

import { tradeCeilingOf } from './limits.js'
import { tradeAroundCitiesOf } from './trade-collection.js'
import type { GameState, Playerhand } from './state.js'
import { TRADE_SET_KEY, turnStatus } from './turn.js'

export interface TradeEstimate {
  /** The trade the player has before the city trade is added, as far as the stored number shows. */
  readonly current: number
  /** The trade icons and buildings around the player's cities. */
  readonly cities: number
  /** Whether the city trade has already been added to the player's stored trade this turn. */
  readonly collected: boolean
  /** The most trade the player may hold. */
  readonly ceiling: number
  /** The stored trade once it is set (by the collection or by hand), or the guess before that. */
  readonly total: number
  /** Whether the trade has been set this turn, by the collection or from a panel, so there is no guess to show. */
  readonly set: boolean
}

export function tradeEstimateOf(state: GameState, player: Playerhand): TradeEstimate {
  const turnNumber = turnStatus(state).currentTurn
  const turn = player.playerTurns.find((candidate) => candidate.turnNumber === turnNumber)
  const collectedAmount = turn?.tradeCollected
  const collected = collectedAmount !== undefined
  const cities = tradeAroundCitiesOf(state, player)
  const ceiling = tradeCeilingOf(player.civilization?.name)
  const set = collected || (turn?.usedActions.includes(TRADE_SET_KEY) ?? false)
  const current = collected ? Math.max(0, player.stats.trade - collectedAmount) : player.stats.trade
  return {
    current,
    cities,
    collected,
    ceiling,
    total: set ? player.stats.trade : Math.min(ceiling, current + cities),
    set,
  }
}
