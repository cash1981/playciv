/**
 * The trade a tech of each level costs to research: 6, 11, 16, 21 and 27 for level V (Space Flight), from the old
 * client's tooltips. The Japanese card, "Require 3 less trade to research new techs of any level", takes 3 off every
 * level (human, 2026-11-24: display only, Space Flight too).
 *
 * This is the amount the game shows (the Tech tree) or checks (Nikola Tesla). Research spends no trade in the engine, and
 * Rationalism's own costs (`assisted-sot.ts`) are learning, not research: they get no discount from here.
 */

/** The base cost of researching a tech of level 1 to 5. */
const BASE_RESEARCH_TRADE: Readonly<Record<number, number>> = { 1: 6, 2: 11, 3: 16, 4: 21, 5: 27 }

/** Civilization card: "Require 3 less trade to research new techs of any level". */
export const JAPANESE_RESEARCH_DISCOUNT = 3

/** Whether the civilization gets the discount: the Japanese. */
export const hasResearchDiscount = (civilizationName: string | null | undefined): boolean => civilizationName === 'Japanese'

/**
 * The trade needed to research a tech of `level` for a player of `civilizationName`, or `null` for a level outside 1-5.
 * The discount never takes the cost below 0.
 */
export function researchTradeCostOf(level: number, civilizationName?: string | null): number | null {
  const base = Object.hasOwn(BASE_RESEARCH_TRADE, level) ? BASE_RESEARCH_TRADE[level] : undefined
  if (base === undefined) return null
  return hasResearchDiscount(civilizationName) ? Math.max(base - JAPANESE_RESEARCH_DISCOUNT, 0) : base
}
