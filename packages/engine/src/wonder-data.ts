/**
 * What each wonder costs to produce, keyed by its board asset id (`wonderAssetId`).
 *
 * Base rules p. 17: "The corresponding wonder card lists the production cost of the
 * wonder, along with a discounted cost that is available if the player knows the
 * specific tech listed on the wonder." The numbers are the `Cost` and `Discount`
 * columns of the Wonders sheet of the game data (`gamedata-faf-waw.json`), read once
 * into this table; the test `wonder-data.test.ts` keeps the two in step. Two rows
 * look odd next to their era (Angkor Wat drops from 20 to 10, the United Nations
 * costs 20 and has no discount): they are as the sheet has them.
 *
 * Only the market wonders can be built, and the abilities are not here: building a
 * wonder places it and names its owner, nothing more (`build-options.ts`).
 */

export interface WonderData {
  /** Production needed without the tech. */
  readonly cost: number
  /** The cheaper price for a player who knows `tech`; absent when the wonder has none. */
  readonly discount?: { readonly tech: string; readonly cost: number }
}

const wonder = (cost: number, tech?: string, discountedCost?: number): WonderData =>
  tech === undefined || discountedCost === undefined ? { cost } : { cost, discount: { tech, cost: discountedCost } }

export const WONDER_DATA: Readonly<Record<string, WonderData>> = {
  'wonders/chichenitza': wonder(15, 'Currency', 10), // Chichen Itza
  'wonders/statueofzeus': wonder(15), // Statue of Zeus
  'wonders/stonehenge': wonder(10), // Stonehenge
  'wonders/colossus': wonder(15, 'Metalworking', 10), // The Colossus
  'wonders/greatlighthouse': wonder(15, 'Navigation', 10), // The Great Lighthouse
  'wonders/greatwall': wonder(15, 'Masonry', 10), // The Great Wall
  'wonders/hanginggardens': wonder(15, 'Animal Husbandry', 10), // The Hanging Gardens
  'wonders/oracle': wonder(15, 'Code of Laws', 10), // The Oracle
  'wonders/pyramids': wonder(15, 'Pottery', 10), // The Pyramids
  'wonders/angkorwat': wonder(20, 'Theology', 10), // Angkor Wat
  'wonders/brandenburggate': wonder(15), // Brandenburg Gate
  'wonders/himejisamuraicastle': wonder(20, 'Monarchy', 15), // Himeji Samurai Castle
  "wonders/leonardo'sworkshop": wonder(20, 'Mathematics', 15), // Leonardo's Workshop
  'wonders/machupichu': wonder(20, 'Irrigation', 15), // Machu Pichu
  'wonders/notredame': wonder(20, 'Education', 15), // Notre-Dame
  'wonders/porcelaintower': wonder(20, 'Construction', 15), // Porcelain Tower
  'wonders/tajmahal': wonder(20, 'Chivalry', 15), // Taj Mahal
  'wonders/louvre': wonder(20, 'Printing Press', 15), // The Louvre
  'wonders/bigben': wonder(25, 'Banking', 20), // Big Ben
  'wonders/cristoredentor': wonder(25, 'Mass Media', 15), // Cristo Redentor
  'wonders/panamacanal': wonder(25, 'Engineering', 20), // Panama Canal
  'wonders/statueofliberty': wonder(25, 'Metal Casting', 20), // Statue of Liberty
  'wonders/sydneyoperahouse': wonder(25), // Sydney Opera House
  'wonders/internet': wonder(25, 'Computers', 15), // The Internet
  'wonders/kremlin': wonder(25, 'Communism', 20), // The Kremlin
  'wonders/pentagon': wonder(25, 'Ballistics', 15), // The Pentagon
  'wonders/unitednations': wonder(20), // United Nations
}

/** Every wonder asset id in the table: what a `build` request may name as a wonder. */
export const WONDER_ASSET_IDS: readonly string[] = Object.keys(WONDER_DATA)

/** The data for a wonder asset id, or `undefined` when the id is not a wonder in the table. */
export function wonderDataOf(assetId: string): WonderData | undefined {
  return Object.hasOwn(WONDER_DATA, assetId) ? WONDER_DATA[assetId] : undefined
}

/**
 * What the wonder costs this player: the discounted price when they know the tech
 * (`known` is the set of their revealed techs), else the printed cost.
 */
export function wonderCostFor(data: WonderData, known: ReadonlySet<string>): number {
  return data.discount !== undefined && known.has(data.discount.tech) ? data.discount.cost : data.cost
}
