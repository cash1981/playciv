/**
 * What a build creates, and when two of them are the same.
 *
 * A leaf module on purpose: it imports nothing at runtime, so the web can use
 * `sameBuildItem` through the package root without pulling the assisted action
 * machinery (`assisted.ts`, `build-options.ts` and what they import) into the
 * browser bundle. Keep it that way.
 */

/** The four kinds of military unit card. */
export const UNIT_TYPES = ['infantry', 'artillery', 'mounted', 'aircraft'] as const
export type UnitType = (typeof UNIT_TYPES)[number]

/** An item that is put on a map square: a building, an army figure or a scout figure. */
export type PlacedBuildItem =
  | { readonly kind: 'building'; readonly assetId: string }
  | { readonly kind: 'army' }
  | { readonly kind: 'scout' }

/** A military unit: a private card drawn into the hand, with no square. */
export interface UnitBuildItem {
  readonly kind: 'unit'
  readonly unitType: UnitType
}

/**
 * What a build creates. A figure carries no asset id: its artwork depends on the
 * player's colour, which the engine reads off the player.
 */
export type BuildItem = PlacedBuildItem | UnitBuildItem

/** Whether two items are the same thing to build. */
export function sameBuildItem(a: BuildItem, b: BuildItem): boolean {
  if (a.kind === 'building') return b.kind === 'building' && a.assetId === b.assetId
  if (a.kind === 'unit') return b.kind === 'unit' && a.unitType === b.unitType
  return a.kind === b.kind
}
