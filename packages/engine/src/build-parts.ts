/**
 * The parts of a recorded build: one item, or two when Engineering split the production (the human's decision of
 * 2026-11-15). A leaf module: types only, so every place that looks into a build's pieces can share it.
 */
import type { AssistedEffect, BuildEffectOne } from './state.js'

/** The item effects of a `build` record, the first and then Engineering's second; empty for any other effect. */
export function buildPartsOf(effect: AssistedEffect): readonly BuildEffectOne[] {
  if (effect.kind !== 'build') return []
  return effect.engineering === undefined ? [effect] : [effect, effect.engineering.second]
}
