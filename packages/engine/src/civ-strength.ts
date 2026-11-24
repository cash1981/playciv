/**
 * Strength a civilization card adds to one of its player's units in the arena.
 *
 * Strength is the wounds a unit deals (`ArenaUnit.attack`, "Strength and Health" in Wisdom and Warfare). Unlike
 * `combat-bonus.ts`, which is a bonus for a whole side, this is per unit and is fixed when the unit is placed.
 */

import type { UnitItem } from './item.js'
import type { Playerhand } from './state.js'

/** Civilization card: "Japanese infantry units have +1 in strength". */
const JAPANESE_INFANTRY_STRENGTH = 1

/**
 * The strength `player`'s civilization adds to `unit` at every level: 1 for a Japanese player's infantry, else 0.
 * Only the player's own army counts: callers pass 0 themselves for a barbarian unit the player merely controls.
 */
export function civilizationAttackBonus(player: Pick<Playerhand, 'civilization'>, unit: Pick<UnitItem, 'kind'>): number {
  return player.civilization?.name === 'Japanese' && unit.kind === 'infantry' ? JAPANESE_INFANTRY_STRENGTH : 0
}
