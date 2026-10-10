/**
 * The culture track as a ladder of spaces, with what an advance costs and what it
 * rewards. New in this port, no old-system counterpart: the human gave the rules
 * on 2026-10-09 (see `docs/agents/tasks/assisted-play-contract.md`, part 2b).
 *
 * `board.ts` knows where a marker sits; this file knows what the space means.
 * Pure and read-only, in the same style as `culture-hand.ts`: a revealed tech, a
 * revealed social policy and the civilization are read off the player each time,
 * so the numbers follow the cards and cannot drift. A hidden card gives nothing,
 * so a cost or a draw count can never show what the owner has not revealed.
 */

import { CULTURE_VICTORY_STEP, cultureStepOf, leaderAssetId } from './board.js'
import type { BoardPiece } from './board.js'
import { coinSourcesOf, totalCoins } from './coins.js'
import type { GameState, Playerhand } from './state.js'

/** What sits on a space: a culture event card, or a Great Person. */
export type CultureSpaceKind = 'event' | 'greatPerson'

export type CultureLevel = 1 | 2 | 3

export interface CultureSpace {
  /** 1 to 21. Space 21 is the Culture Victory panel. */
  readonly step: number
  readonly kind: CultureSpaceKind
  /** The section of the track: 1 to 7, 8 to 14 and 15 to 21. A Great Person space is in a section too. */
  readonly level: CultureLevel
}

/** The Great Person spaces. Every other space is a culture event. */
export const GREAT_PERSON_STEPS: readonly number[] = [3, 7, 12, 18]

/** Spaces in one section of the track. */
const SECTION_SIZE = 7

const levelOfStep = (step: number): CultureLevel => (step <= SECTION_SIZE ? 1 : step <= 2 * SECTION_SIZE ? 2 : 3)

/** Spaces 1 to 21 in order. */
export const CULTURE_LADDER: readonly CultureSpace[] = Array.from(
  { length: CULTURE_VICTORY_STEP },
  (_, index): CultureSpace => {
    const step = index + 1
    return {
      step,
      kind: GREAT_PERSON_STEPS.includes(step) ? 'greatPerson' : 'event',
      level: levelOfStep(step),
    }
  },
)

/** The space at `step`, or `undefined` for Start (0) and anything outside the track. */
export function cultureSpaceAt(step: number): CultureSpace | undefined {
  return CULTURE_LADDER[step - 1]
}

export interface CultureAdvanceCost {
  readonly culture: number
  readonly trade: number
}

/** Base cost by the level of the space moved to. A Great Person space costs what its section costs. */
const BASE_COST: Readonly<Record<CultureLevel, CultureAdvanceCost>> = {
  1: { culture: 3, trade: 0 },
  2: { culture: 5, trade: 3 },
  3: { culture: 7, trade: 6 },
}

/** Endowment for the Arts: from this many investments, this much off the culture cost. */
const EFTA_DISCOUNTS: readonly (readonly [investments: number, off: number])[] = [
  [4, 2],
  [2, 1],
]

const ECOLOGY = 'Ecology'
/** Ecology: 1 less trade for every 3 coins. The line is the printed card text, not a ruling from the human. */
const COINS_PER_ECOLOGY_TRADE = 3

const MYSTICISM = 'Mysticism'
const ORGANIZED_RELIGION = 'Organized Religion'
const GREEKS = 'Greeks'

const hasRevealedTech = (player: Playerhand, name: string): boolean =>
  player.techsChosen.some((tech) => tech.name === name && !tech.hidden)

const hasRevealedPolicy = (player: Playerhand, name: string): boolean =>
  player.socialPolicies.some((policy) => policy.name === name && !policy.hidden)

/**
 * What advancing onto `step` costs this player. Level 1 is 3 culture, level 2 is 5
 * culture and 3 trade, level 3 is 7 culture and 6 trade. Endowment for the Arts
 * (`stats.efta` counts the investments) takes 1 off the culture with 2 or more and
 * 2 off with 4 or more, at every level. A revealed Ecology takes 1 off the trade
 * for every 3 coins the player has. Neither goes below 0. A step outside the
 * ladder costs nothing, since there is nothing to advance to.
 */
export function cultureAdvanceCost(
  state: GameState,
  player: Playerhand,
  step: number,
): CultureAdvanceCost {
  const space = cultureSpaceAt(step)
  if (space === undefined) return { culture: 0, trade: 0 }
  const base = BASE_COST[space.level]

  const eftaOff = EFTA_DISCOUNTS.find(([investments]) => player.stats.efta >= investments)?.[1] ?? 0
  const ecologyOff = hasRevealedTech(player, ECOLOGY)
    ? Math.floor(Math.max(totalCoins(coinSourcesOf(state, player)), 0) / COINS_PER_ECOLOGY_TRADE)
    : 0

  return {
    culture: Math.max(0, base.culture - eftaOff),
    trade: Math.max(0, base.trade - ecologyOff),
  }
}

/**
 * How many cards an advance to a space of this kind draws, of which the player keeps
 * one. A culture event draws 1, plus 1 with Mysticism revealed. A Great Person space
 * draws 1, plus 1 for a revealed Organized Religion, plus 1 for the Greeks; the
 * extras stack.
 */
export function rewardDrawCount(
  _state: GameState,
  player: Playerhand,
  kind: CultureSpaceKind,
): number {
  // `_state` is not read today; it is in the signature so a rule that depends on the board needs no new call sites.
  if (kind === 'event') return 1 + (hasRevealedTech(player, MYSTICISM) ? 1 : 0)
  return (
    1 +
    (hasRevealedPolicy(player, ORGANIZED_RELIGION) ? 1 : 0) +
    (player.civilization?.name === GREEKS ? 1 : 0)
  )
}

/** A player's leader marker on the board, and the space it stands on. */
export interface CultureMarker {
  readonly piece: BoardPiece
  /** 0 is Start, 1 to 21 the spaces, 21 the Culture Victory panel. */
  readonly step: number
}

/**
 * The player's leader piece and where it sits on the track, or `undefined` when it
 * has not been placed (no civilization or colour, no such piece) or is off the
 * track. The one place that decides what "the marker" is: `cultureMarkerLevelOf`
 * and the advance both use it.
 */
export function cultureMarkerOf(state: GameState, player: Playerhand): CultureMarker | undefined {
  if (player.civilization === null || player.color === null) return undefined
  const assetId = leaderAssetId(player.civilization.name, player.color)
  if (assetId === undefined) return undefined
  const piece = state.board.pieces.find((candidate) => candidate.assetId === assetId)
  if (piece === undefined) return undefined
  const step = cultureStepOf(state.board, piece)
  return step === null ? undefined : { piece, step }
}
