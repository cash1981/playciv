/**
 * The combat bonus (issue #197), derived from what a player has rather than
 * typed in. Like `cityCountOf` and `cultureMarkerLevelOf`, it is computed from
 * the board and the hand each time it is read, so it recalculates by itself
 * whenever a building, general, wonder, investment, government or civilization
 * changes and cannot drift out of step.
 *
 * Each source and its value come from the human (issue #197); there is no old
 * system behind them, since the old status sheet was typed in by hand.
 */

import { isInWondersArea } from './board.js'
import type { GameState, Playerhand } from './state.js'

/** Building asset ids that add to the combat bonus, and by how much. */
const BUILDING_BONUS: Readonly<Record<string, number>> = {
  'buildings/barracks': 2,
  // The Shipyard is the navy building on the board; there is no asset called Navy.
  'buildings/shipyard': 2,
  'buildings/academy': 4,
}

const GENERAL_ASSET_ID = 'great people/general'
const GENERAL_BONUS = 4
/** Each pair of Military investments (MIC) is worth 4, up to 6 investments. */
const MIC_INVESTMENTS_PER_STEP = 2
const MIC_MAX_INVESTMENTS = 6
const MIC_STEP_BONUS = 4
const FUNDAMENTALISM_BONUS = 4
const FRENCH_BONUS = 2
const STATUE_OF_ZEUS_ASSET_ID = 'wonders/statueofzeus'
const STATUE_OF_ZEUS_BONUS = 6

/**
 * A player's combat bonus. Buildings and generals are attributed by `placedBy`
 * (see `buildingCountOf` in `state.ts` for why); the Statue of Zeus counts only
 * for its explicit owner while it sits in the Wonders area.
 */
export function combatBonusOf(state: GameState, player: Playerhand): number {
  let bonus = 0

  for (const piece of state.board.pieces) {
    if (piece.placedBy === player.playerId) {
      bonus += BUILDING_BONUS[piece.assetId] ?? 0
      if (piece.assetId === GENERAL_ASSET_ID) bonus += GENERAL_BONUS
    }
    if (
      piece.assetId === STATUE_OF_ZEUS_ASSET_ID &&
      (piece.ownerId ?? null) === player.playerId &&
      isInWondersArea(state.board, piece)
    ) {
      bonus += STATUE_OF_ZEUS_BONUS
    }
  }

  const investments = Math.min(Math.max(player.stats.mic, 0), MIC_MAX_INVESTMENTS)
  bonus += Math.floor(investments / MIC_INVESTMENTS_PER_STEP) * MIC_STEP_BONUS

  if (player.government === 'Fundamentalism') bonus += FUNDAMENTALISM_BONUS
  if (player.civilization?.name === 'French') bonus += FRENCH_BONUS

  return bonus
}
