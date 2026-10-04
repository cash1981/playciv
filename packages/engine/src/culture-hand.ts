/**
 * The culture hand size, derived from what a player has rather than typed in.
 * Like `combatBonusOf`, it is computed each time it is read, so it follows the
 * techs, coins, Great Person and EftA investment and cannot drift out of step.
 *
 * The values come from the human's table; there is no old system behind them,
 * since the old status sheet was typed in by hand.
 */

import { blockadedGreatPersonTypes, isOwnWonderBlockaded } from './blockade.js'
import { coinSourcesOf, totalCoins } from './coins.js'
import type { GameState, Playerhand } from './state.js'

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

/**
 * Cristo Redentor, a Modern Wonder: "Your culture hand size is increased by 4."
 * Like the Statue of Zeus for combat, it counts only for its explicit owner,
 * wherever the piece sits, and stops while an enemy figure blockades it. The board is public, so this reveals nothing.
 */
const CRISTO_REDENTOR_ASSET_ID = 'wonders/cristoredentor'
const CRISTO_REDENTOR_BONUS = 4

/** Endowment for the Arts, Level I: from the first investment, nothing more. */
const EFTA_BONUS = 1

/**
 * A player's culture hand size, never below {@link BASE_CULTURE_HAND_SIZE}.
 *
 * Only revealed cards count, for the owner as well as everyone else (the
 * human's rule): a hidden tech or Great Person gives nothing until it is
 * revealed, so the number can never show another player what is still hidden.
 * Valmiki's +2 goes again when the card is discarded, because it then leaves the
 * player's items. The coin total, the EftA investment and the wonders on the
 * board are public already. The coin total includes the derived Great People
 * coins (issue #241), which follow the blockade.
 */
export function cultureHandSizeOf(state: GameState, player: Playerhand): number {
  let size = BASE_CULTURE_HAND_SIZE

  for (const tech of player.techsChosen) {
    if (tech.hidden) continue
    size += TECH_BONUS.get(tech.name) ?? 0
    if (tech.name === COMPUTERS) {
      size += Math.floor(Math.max(totalCoins(coinSourcesOf(state, player)), 0) / COINS_PER_COMPUTERS_CARD)
    }
  }

  const valmiki = player.items.some(
    (item) => item.kind === 'greatperson' && item.name === VALMIKI && !item.hidden,
  )
  // Like the other Great Person abilities, a tracked Artist or Thinker token
  // keeps Valmiki usable unless every such token is blockaded. With no tracked
  // token, retain the existing compatibility behavior (issue #241).
  if (valmiki && !blockadedGreatPersonTypes(state, player).includes('Artist or Thinker')) {
    size += VALMIKI_BONUS
  }

  if (player.stats.efta >= 1) size += EFTA_BONUS

  const cristoRedentor = state.board.pieces.some(
    (piece) => piece.assetId === CRISTO_REDENTOR_ASSET_ID && piece.ownerId === player.playerId,
  )
  // A blockaded wonder's ability cannot be used (base rulebook p. 27, issue #241).
  if (cristoRedentor && !isOwnWonderBlockaded(state, player, CRISTO_REDENTOR_ASSET_ID)) {
    size += CRISTO_REDENTOR_BONUS
  }

  return Math.max(size, BASE_CULTURE_HAND_SIZE)
}
