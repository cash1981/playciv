/**
 * What each building gives and costs, keyed by its board asset id.
 *
 * The values are the human's table (the city-production brief); the printed
 * numbers on the piece art are not in any manifest. Each row is one asset, so a
 * basic building and its upgrade are two rows (Workshop and Iron Mine). The
 * Barracks and Academy trade value is as the human typed it and is waiting for
 * confirmation: this table is the one place to change it.
 *
 * City production reads only `production` for now. The other icons and the
 * cost are here so the Build part can share the same table.
 */

export interface BuildingData {
  /** Production icons the building gives to its city. It replaces the terrain's own icons. */
  readonly production: number
  readonly trade: number
  readonly culture: number
  readonly coin: number
  /** Production needed to build it. */
  readonly cost: number
  /** What it adds to the combat bonus (Barracks, Shipyard and their upgrades). */
  readonly combatBonus: number
}

const row = (
  production: number,
  trade: number,
  culture: number,
  coin: number,
  cost: number,
  combatBonus = 0,
): BuildingData => ({ production, trade, culture, coin, cost, combatBonus })

export const BUILDING_DATA: Readonly<Record<string, BuildingData>> = {
  'buildings/harbor': row(1, 2, 0, 0, 7),
  'buildings/tradingpost': row(0, 2, 1, 0, 7),
  'buildings/workshop': row(3, 0, 0, 0, 7),
  'buildings/ironmine': row(4, 0, 0, 0, 10),
  'buildings/library': row(0, 1, 1, 0, 5),
  'buildings/university': row(0, 2, 2, 0, 8),
  'buildings/granary': row(1, 1, 0, 0, 5),
  'buildings/aqueduct': row(2, 2, 0, 0, 8),
  'buildings/market': row(1, 1, 1, 0, 7),
  'buildings/temple': row(0, 0, 2, 0, 7),
  'buildings/cathedral': row(0, 0, 3, 0, 10),
  'buildings/barracks': row(0, 2, 0, 0, 7, 2),
  'buildings/academy': row(0, 2, 0, 0, 10, 4),
  'buildings/shipyard': row(2, 0, 0, 0, 5, 2),
  'buildings/militarydock': row(2, 0, 0, 0, 10, 4),
  'buildings/bank': row(1, 1, 1, 1, 10),
}

/** The data for a building asset id, or `undefined` when the id is not a building in the table. */
export function buildingDataOf(assetId: string): BuildingData | undefined {
  return Object.hasOwn(BUILDING_DATA, assetId) ? BUILDING_DATA[assetId] : undefined
}
