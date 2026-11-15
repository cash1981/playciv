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

/**
 * The techs that raise a unit type's level, from the Military Unit table of the
 * tech reference sheet (`public/help/Civ_Tech_FF-WW.-1.jpg`): Logistics gives
 * level II of all three.
 */
export const UNIT_LEVEL_TECHS: Readonly<Record<Exclude<UnitType, 'aircraft'>, Readonly<Record<string, number>>>> = {
  infantry: { Democracy: 2, Logistics: 2, Gunpowder: 3, 'Replacement Parts': 4 },
  artillery: { Mathematics: 2, Logistics: 2, 'Metal Casting': 3, Ballistics: 4 },
  mounted: { Chivalry: 2, Logistics: 2, Railroad: 3, Combustion: 4 },
}

/** The highest level of a unit type that the techs in `known` give, 1 without any. */
export function unitLevelFromTechs(unitType: Exclude<UnitType, 'aircraft'>, known: Iterable<string>): number {
  const levels = UNIT_LEVEL_TECHS[unitType]
  let level = 1
  for (const tech of known) if (Object.hasOwn(levels, tech)) level = Math.max(level, levels[tech] ?? 1)
  return level
}

/**
 * An item that is put on a map square: a building, a wonder from the market, an army
 * figure or a scout figure. A wonder's `assetId` is the wonder's own board asset.
 */
export type PlacedBuildItem =
  | { readonly kind: 'building'; readonly assetId: string }
  | { readonly kind: 'wonder'; readonly assetId: string }
  | { readonly kind: 'army' }
  | { readonly kind: 'scout' }

/** A military unit: a private card drawn into the hand, with no square. */
export interface UnitBuildItem {
  readonly kind: 'unit'
  readonly unitType: UnitType
}

/**
 * City Walls (base rules p. 17): a building that stands in the city centre, so no square is
 * picked. Building them turns the city marker over to its walled side; nothing new is placed.
 */
export interface WallsBuildItem {
  readonly kind: 'walls'
}

/** An item with no square to pick: a military unit (a card) or City Walls (the city marker turned over). */
export type SquarelessBuildItem = UnitBuildItem | WallsBuildItem

/**
 * What a build creates. A figure carries no asset id: its artwork depends on the
 * player's colour, which the engine reads off the player.
 */
export type BuildItem = PlacedBuildItem | SquarelessBuildItem

/** Whether two items are the same thing to build. */
export function sameBuildItem(a: BuildItem, b: BuildItem): boolean {
  if (a.kind === 'building' || a.kind === 'wonder') return b.kind === a.kind && a.assetId === b.assetId
  if (a.kind === 'unit') return b.kind === 'unit' && a.unitType === b.unitType
  return a.kind === b.kind
}
