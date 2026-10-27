/**
 * The passive and triggered Great Person effects that the game derives from a
 * revealed card, rather than applying when a card is played.
 *
 * A Great Person card is active only while it is faceup in its owner's hand and
 * at least one token of its type is on the map and not blockaded (FAQ 2.0). The
 * helpers here are the single place that decides that, so a new passive effect
 * cannot disagree with the card-play and Start of Turn checks.
 */

import { blockadedGreatPersonTypes } from './blockade.js'
import type { GreatPersonItem } from './item.js'
import type { GameState, Playerhand } from './state.js'

/** Whether `name` is a revealed Great Person whose type is not fully blockaded. */
export function activeGreatPerson(
  state: GameState,
  player: Playerhand,
  name: string,
): boolean {
  const card = player.items.find(
    (item): item is GreatPersonItem => item.kind === 'greatperson' && item.name === name,
  )
  if (card === undefined || card.hidden) return false
  return card.type === null || !blockadedGreatPersonTypes(state, player).includes(card.type)
}

/**
 * Louis Pasteur: "Your stacking limit is increased by 1." The manual stacking
 * number stays the player's bookkeeping; Build uses this effective value.
 */
export function stackingLimitOf(state: GameState, player: Playerhand): number {
  return player.stats.stacking + (activeGreatPerson(state, player, 'Louis Pasteur') ? 1 : 0)
}

/** The techs another player has revealed, for Thomas Edison's free research. */
export function revealedTechNamesOfOthers(state: GameState, playerId: string): readonly string[] {
  const names = new Set<string>()
  for (const candidate of state.players) {
    if (candidate.playerId === playerId) continue
    for (const tech of candidate.techsChosen) {
      if (!tech.hidden) names.add(tech.name)
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}
