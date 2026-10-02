/**
 * The culture hand size, derived from what a player has rather than typed in.
 * Like `combatBonusOf`, it is computed each time it is read, so it follows the
 * techs, coins, Great Person and EftA investment and cannot drift out of step.
 *
 * The values come from the human's table; there is no old system behind them,
 * since the old status sheet was typed in by hand.
 */

import { totalCoins } from './coins.js'
import type { Playerhand } from './state.js'

/** What every player holds before any card raises it, and the floor. */
export const BASE_CULTURE_HAND_SIZE = 2

/** Techs that add one card each, by printed tech name. */
const TECH_BONUS: ReadonlyMap<string, number> = new Map([
  ['Pottery', 1],
  ['Civil Service', 1],
  ['Theology', 1],
])

const COMPUTERS = 'Computers'
/** Computers adds one card for every five coins the player has. */
const COINS_PER_COMPUTERS_CARD = 5

const VALMIKI = 'Valmiki'
const VALMIKI_BONUS = 2

/** Endowment for the Arts, Level I: from the first investment, nothing more. */
const EFTA_BONUS = 1

/**
 * A player's culture hand size, never below {@link BASE_CULTURE_HAND_SIZE}.
 *
 * Only revealed cards count, for the owner as well as everyone else (the
 * human's rule): a hidden tech or Great Person gives nothing until it is
 * revealed, so the number can never show another player what is still hidden.
 * Valmiki's +2 goes again when the card is discarded, because it then leaves the
 * player's items. The coin total and the EftA investment are public already.
 */
export function cultureHandSizeOf(player: Playerhand): number {
  let size = BASE_CULTURE_HAND_SIZE

  for (const tech of player.techsChosen) {
    if (tech.hidden) continue
    size += TECH_BONUS.get(tech.name) ?? 0
    if (tech.name === COMPUTERS) {
      size += Math.floor(Math.max(totalCoins(player.stats.coinSources), 0) / COINS_PER_COMPUTERS_CARD)
    }
  }

  const valmiki = player.items.some(
    (item) => item.kind === 'greatperson' && item.name === VALMIKI && !item.hidden,
  )
  if (valmiki) size += VALMIKI_BONUS

  if (player.stats.efta >= 1) size += EFTA_BONUS

  return Math.max(size, BASE_CULTURE_HAND_SIZE)
}
