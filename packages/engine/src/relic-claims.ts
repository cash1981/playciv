/**
 * Which assisted actions claim each relic's ability, by the board asset id of its marker. A leaf
 * module, so the board's Undo can tell a claimed relic without importing the assisted actions.
 * Atlantis and the Seven Cities of Gold are in `assisted-abilities.ts`, the others in
 * `assisted-relics.ts`.
 */

const CLAIM_PREFIXES: Readonly<Record<string, string>> = {
  'relics/atlantis': 'sot:atlantis',
  'relics/seven_cities_of_gold': 'sot:sevenCities:',
  'relics/ark_of_the_covenant': 'relic:ark',
  'relics/school_of_confucius': 'relic:confucius',
  'relics/attilas_village': 'relic:attila:',
}

/** Whether an assisted action of this kind claims the ability of the relic with this marker. */
export function claimsRelic(assetId: string, kind: string): boolean {
  const prefix = CLAIM_PREFIXES[assetId]
  return prefix !== undefined && kind.startsWith(prefix)
}
