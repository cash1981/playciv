/**
 * How many social policies a player may hold (Wisdom and Warfare rulebook p. 10, "Social Policies", issue #378).
 *
 * The maximum is the number of the civilization's built cities; the French may hold one more. It is derived from the board,
 * never stored, so a manual city, a conquest, a nuke or an undo of the city moves it without any bookkeeping. A lost city can
 * leave a player holding more than the maximum: that is shown as `held > maximum`, not refused (the player returns one by
 * hand with `removeSocialPolicy`).
 */

import { ownCityPieces } from './city-founding.js'
import type { GameState, Playerhand } from './state.js'

const FRENCH = 'French'

export interface SocialPolicySlots {
  /** The most policies the player may hold now. */
  readonly maximum: number
  /** The policies the player holds. */
  readonly held: number
  /** How many more the player may adopt; 0 at or over the maximum. */
  readonly free: number
}

/**
 * The policy maximum of a player: their built cities, and one more for the French. Until setup is finished it is at least one
 * city, so the starting policy can be chosen before the capital is placed (step 1 of Player Setup). A player whose setup is
 * finished is held to the cities they really have, so losing the last one leaves no slot. A game saved before setup existed
 * has no setup record and keeps the floor.
 */
export function socialPolicyMaximumOf(state: GameState, player: Playerhand): number {
  const cities = ownCityPieces(state, player).length
  const counted = player.setup?.finished === true ? cities : Math.max(1, cities)
  return counted + (player.civilization?.name === FRENCH ? 1 : 0)
}

/** The policies a player adopts in setup: one, and one more for the French. */
export const startingSocialPolicies = (player: Playerhand): number => (player.civilization?.name === FRENCH ? 2 : 1)

export function socialPolicySlots(state: GameState, player: Playerhand): SocialPolicySlots {
  const maximum = socialPolicyMaximumOf(state, player)
  const held = player.socialPolicies.length
  return { maximum, held, free: Math.max(0, maximum - held) }
}
