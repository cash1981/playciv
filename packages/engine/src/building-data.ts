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

// ---------------------------------------------------------------------------
// Building a building (assisted Build)
// ---------------------------------------------------------------------------

/**
 * The buildings a player can ask to build, basic form before its upgrade, with
 * the name the log and the picker show. Not the artwork label: the manifest
 * calls them "Tradingpost", "Ironmine" and "Military dock".
 */
export const BUILDABLE_BUILDINGS: readonly { readonly assetId: string; readonly label: string }[] = [
  { assetId: 'buildings/harbor', label: 'Harbor' },
  { assetId: 'buildings/tradingpost', label: 'Trading Post' },
  { assetId: 'buildings/granary', label: 'Granary' },
  { assetId: 'buildings/aqueduct', label: 'Aqueduct' },
  { assetId: 'buildings/library', label: 'Library' },
  { assetId: 'buildings/university', label: 'University' },
  { assetId: 'buildings/market', label: 'Market' },
  { assetId: 'buildings/bank', label: 'Bank' },
  { assetId: 'buildings/temple', label: 'Temple' },
  { assetId: 'buildings/cathedral', label: 'Cathedral' },
  { assetId: 'buildings/barracks', label: 'Barracks' },
  { assetId: 'buildings/academy', label: 'Academy' },
  { assetId: 'buildings/workshop', label: 'Workshop' },
  { assetId: 'buildings/ironmine', label: 'Iron Mine' },
  { assetId: 'buildings/shipyard', label: 'Shipyard' },
  { assetId: 'buildings/militarydock', label: 'Military Dock' },
]

/** The asset ids of {@link BUILDABLE_BUILDINGS}, for a route that has to tell a known building from any string. */
export const BUILDABLE_BUILDING_IDS: readonly string[] = BUILDABLE_BUILDINGS.map((building) => building.assetId)

/** The display name of a buildable building, or `undefined` for any other asset id. */
export function buildingNameOf(assetId: string): string | undefined {
  return BUILDABLE_BUILDINGS.find((building) => building.assetId === assetId)?.label
}

/**
 * Which tech unlocks which buildings: the human's tech sheet, as written in
 * `web/src/views/techText.ts`. Military Science unlocks two, both of them
 * upgraded forms. A tech counts only once it is revealed.
 */
export const BUILDING_TECH_UNLOCKS: Readonly<Record<string, readonly string[]>> = {
  'Code of Laws': ['buildings/tradingpost'],
  Currency: ['buildings/market'],
  Metalworking: ['buildings/barracks'],
  Navigation: ['buildings/harbor'],
  Philosophy: ['buildings/temple'],
  Pottery: ['buildings/granary'],
  Writing: ['buildings/library'],
  Navy: ['buildings/shipyard'],
  Construction: ['buildings/workshop'],
  Engineering: ['buildings/aqueduct'],
  'Printing Press': ['buildings/university'],
  Banking: ['buildings/bank'],
  'Military Science': ['buildings/militarydock', 'buildings/academy'],
  Railroad: ['buildings/ironmine'],
  Theology: ['buildings/cathedral'],
}

/** The tech names that unlock a building, in the table's order. Empty for an id that is not a buildable building. */
export function techsUnlocking(assetId: string): readonly string[] {
  return Object.entries(BUILDING_TECH_UNLOCKS)
    .filter(([, buildings]) => buildings.includes(assetId))
    .map(([tech]) => tech)
}

/**
 * Basic form to upgraded form (base rules p. 22). Once the upgraded form is
 * unlocked only it can be built, and knowing its tech is enough.
 */
export const BUILDING_UPGRADES: Readonly<Record<string, string>> = {
  'buildings/granary': 'buildings/aqueduct',
  'buildings/library': 'buildings/university',
  'buildings/market': 'buildings/bank',
  'buildings/temple': 'buildings/cathedral',
  'buildings/barracks': 'buildings/academy',
  'buildings/workshop': 'buildings/ironmine',
  'buildings/shipyard': 'buildings/militarydock',
}

/** Market, Bank, Temple, Cathedral, Barracks and Academy: a city may hold only one of them in total (base rules p. 16 to 17). */
export const LIMITED_BUILDINGS: ReadonlySet<string> = new Set([
  'buildings/market',
  'buildings/bank',
  'buildings/temple',
  'buildings/cathedral',
  'buildings/barracks',
  'buildings/academy',
])
