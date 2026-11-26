/**
 * The numbers of the cards and tech abilities that give a city hammers. A leaf module with no imports: the tech abilities
 * build their actions from it when they load, so it must not sit in an import cycle (`build-sources.ts` does).
 */

import type { AssistedActionKind } from './state.js'

/** The extra hammers one city produces this turn: the culture event's own number. */
export const WE_LOVE_HAMMERS: ReadonlyMap<string, number> = new Map([
  ['We Love the Despot Day!', 4],
  ['We Love the Queen Day!', 6],
  ['We Love the President Day!', 8],
])

export interface BoostSpec {
  readonly kind: AssistedActionKind
  readonly techName: string
  readonly amount: number
}

/** The four production boosts: one Wheat, one city produces this much extra this turn (the tech cards). */
export const PRODUCTION_BOOSTS: readonly BoostSpec[] = [
  { kind: 'animalHusbandry', techName: 'Animal Husbandry', amount: 3 },
  { kind: 'construction', techName: 'Construction', amount: 5 },
  { kind: 'banking', techName: 'Banking', amount: 7 },
  { kind: 'plastics', techName: 'Plastics', amount: 10 },
]

