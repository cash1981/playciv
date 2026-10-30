/**
 * What each wonder costs to produce and which era it belongs to, keyed by its board
 * asset id (`wonderAssetId`).
 *
 * Base rules p. 17: "The corresponding wonder card lists the production cost of the
 * wonder, along with a discounted cost that is available if the player knows the
 * specific tech listed on the wonder." The numbers are the `Cost` and `Discount`
 * columns of the Wonders sheet of the game data (`gamedata-faf-waw.json`), read once
 * into this table, and the era is the block of the sheet the wonder is in; the test
 * `wonder-data.test.ts` keeps the two in step. Where the sheet disagrees with the tech
 * cards (the tech reference sheet `public/help/Civ_Tech_FF-WW.-2.jpg`, which names the
 * wonder each tech discounts and its price), the cards win: {@link SHEET_CORRECTIONS}.
 *
 * The abilities are not here: building a wonder places it and names its owner, nothing
 * more (`build-options.ts`). Build checks the cost against the city's production and
 * rushes the rest with trade, as for a building.
 */

export type WonderEra = 'Ancient' | 'Medieval' | 'Modern'

/** The eras in the order the wonder deck is drawn: all the ancient wonders of a game first, then the medieval, then the modern. */
export const WONDER_ERAS: readonly WonderEra[] = ['Ancient', 'Medieval', 'Modern']

/** A game has four wonders of each era (setup, and again whenever a wonder is built and the next one is drawn into the market). */
export const WONDERS_PER_ERA = 4

export interface WonderData {
  readonly era: WonderEra
  /** Production needed without the tech. */
  readonly cost: number
  /** The cheaper price for a player who knows `tech`; absent when the wonder has none. */
  readonly discount?: { readonly tech: string; readonly cost: number }
}

const wonder = (era: WonderEra, cost: number, tech?: string, discountedCost?: number): WonderData =>
  tech === undefined || discountedCost === undefined
    ? { era, cost }
    : { era, cost, discount: { tech, cost: discountedCost } }

/**
 * Where the table differs from the sheet on purpose, with the reason. The sheet is
 * generated from a spreadsheet, so a wrong number there is corrected here until the
 * spreadsheet is.
 */
export const SHEET_CORRECTIONS: Readonly<Record<string, string>> = {
  'wonders/angkorwat': 'The sheet has 10 with Theology; the Philosophy tech card has Angkor Wat (15).',
}

export const WONDER_DATA: Readonly<Record<string, WonderData>> = {
  'wonders/chichenitza': wonder('Ancient', 15, 'Currency', 10), // Chichen Itza
  'wonders/statueofzeus': wonder('Ancient', 15), // Statue of Zeus
  'wonders/stonehenge': wonder('Ancient', 10), // Stonehenge
  'wonders/colossus': wonder('Ancient', 15, 'Metalworking', 10), // The Colossus
  'wonders/greatlighthouse': wonder('Ancient', 15, 'Navigation', 10), // The Great Lighthouse
  'wonders/greatwall': wonder('Ancient', 15, 'Masonry', 10), // The Great Wall
  'wonders/hanginggardens': wonder('Ancient', 15, 'Animal Husbandry', 10), // The Hanging Gardens
  'wonders/oracle': wonder('Ancient', 15, 'Code of Laws', 10), // The Oracle
  'wonders/pyramids': wonder('Ancient', 15, 'Pottery', 10), // The Pyramids
  'wonders/angkorwat': wonder('Medieval', 20, 'Philosophy', 15), // Angkor Wat
  'wonders/brandenburggate': wonder('Medieval', 15), // Brandenburg Gate
  'wonders/himejisamuraicastle': wonder('Medieval', 20, 'Monarchy', 15), // Himeji Samurai Castle
  "wonders/leonardo'sworkshop": wonder('Medieval', 20, 'Mathematics', 15), // Leonardo's Workshop
  'wonders/machupichu': wonder('Medieval', 20, 'Irrigation', 15), // Machu Pichu
  'wonders/notredame': wonder('Medieval', 20, 'Education', 15), // Notre-Dame
  'wonders/porcelaintower': wonder('Medieval', 20, 'Construction', 15), // Porcelain Tower
  'wonders/tajmahal': wonder('Medieval', 20, 'Chivalry', 15), // Taj Mahal
  'wonders/louvre': wonder('Medieval', 20, 'Printing Press', 15), // The Louvre
  'wonders/bigben': wonder('Modern', 25, 'Banking', 20), // Big Ben
  'wonders/cristoredentor': wonder('Modern', 25, 'Mass Media', 15), // Cristo Redentor
  'wonders/panamacanal': wonder('Modern', 25, 'Engineering', 20), // Panama Canal
  'wonders/statueofliberty': wonder('Modern', 25, 'Metal Casting', 20), // Statue of Liberty
  'wonders/sydneyoperahouse': wonder('Modern', 25), // Sydney Opera House
  'wonders/internet': wonder('Modern', 25, 'Computers', 15), // The Internet
  'wonders/kremlin': wonder('Modern', 25, 'Communism', 20), // The Kremlin
  'wonders/pentagon': wonder('Modern', 25, 'Ballistics', 15), // The Pentagon
  'wonders/unitednations': wonder('Modern', 20), // United Nations
}

/** How many wonder cards the deck holds of each era: the nine of the sheet. */
export const WONDERS_IN_ERA: Readonly<Record<WonderEra, number>> = {
  Ancient: Object.values(WONDER_DATA).filter((data) => data.era === 'Ancient').length,
  Medieval: Object.values(WONDER_DATA).filter((data) => data.era === 'Medieval').length,
  Modern: Object.values(WONDER_DATA).filter((data) => data.era === 'Modern').length,
}

/**
 * The culture icons printed on a wonder's marker, by era: one on an ancient wonder, two on
 * a medieval one and three on a modern one. Read by eye from the 27 marker images (the
 * icons are not in the sheet); the era rule holds for every one of them, and
 * `wonder-data.test.ts` lists each wonder's count. The marker gives them to the city whose
 * outskirts it stands in when that city is devoted to the arts, also when the wonder is
 * obsolete (base rules p. 27).
 */
export const WONDER_CULTURE: Readonly<Record<WonderEra, number>> = { Ancient: 1, Medieval: 2, Modern: 3 }

/** The culture on a wonder's marker, or `undefined` when the id is not a wonder in the table. */
export function wonderCultureOf(assetId: string): number | undefined {
  const data = wonderDataOf(assetId)
  return data === undefined ? undefined : WONDER_CULTURE[data.era]
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
