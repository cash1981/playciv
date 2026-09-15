/**
 * Port of `no.asgari.civilization.server.SheetName`.
 *
 * The Java enum had both a name (CIV) and a label ("Civ"), where the label is
 * the sheet tab in the spreadsheet. The order below matches Java exactly,
 * because `Item.compareTo` compares the enum ordinal.
 */

export const SHEET_NAME_ORDER = [
  'CIV',
  'CULTURE_1',
  'CULTURE_2',
  'CULTURE_3',
  'GREAT_PERSON',
  'INFANTRY',
  'ARTILLERY',
  'MOUNTED',
  'AIRCRAFT',
  'VILLAGES',
  'HUTS',
  'WONDERS',
  'ANCIENT_WONDERS',
  'MEDIEVAL_WONDERS',
  'MODERN_WONDERS',
  'TILES',
  'CITY_STATES',
  'LEVEL_1_TECH',
  'LEVEL_2_TECH',
  'LEVEL_3_TECH',
  'LEVEL_4_TECH',
  'LEVEL_5_TECH',
  'SOCIAL_POLICY',
] as const

export type SheetName = (typeof SHEET_NAME_ORDER)[number]

export const SHEET_LABEL: Readonly<Record<SheetName, string>> = {
  CIV: 'Civ',
  CULTURE_1: 'Culture I',
  CULTURE_2: 'Culture II',
  CULTURE_3: 'Culture III',
  GREAT_PERSON: 'Great Person',
  INFANTRY: 'Infantry',
  ARTILLERY: 'Artillery',
  MOUNTED: 'Mounted',
  AIRCRAFT: 'Aircraft',
  VILLAGES: 'Villages',
  HUTS: 'Huts',
  WONDERS: 'Wonders',
  ANCIENT_WONDERS: 'Ancient Wonders',
  MEDIEVAL_WONDERS: 'Medieval Wonders',
  MODERN_WONDERS: 'Modern Wonders',
  TILES: 'Tiles',
  CITY_STATES: 'City-states',
  LEVEL_1_TECH: 'Level 1 Tech',
  LEVEL_2_TECH: 'Level 2 Tech',
  LEVEL_3_TECH: 'Level 3 Tech',
  LEVEL_4_TECH: 'Level 4 Tech',
  LEVEL_5_TECH: 'Level 5 Tech',
  SOCIAL_POLICY: 'Social Policy',
}

/** The ordinal, so `compareTo` can be ported one to one. */
const ORDINAL: Readonly<Record<SheetName, number>> = Object.fromEntries(
  SHEET_NAME_ORDER.map((name, index) => [name, index]),
) as Record<SheetName, number>

export function sheetOrdinal(sheet: SheetName): number {
  return ORDINAL[sheet]
}

/** Java: `SheetName.SHEETS` — the whole enum. */
export const SHEETS: ReadonlySet<SheetName> = new Set(SHEET_NAME_ORDER)

/** Java: `SheetName.TECHS`. Techs are chosen, not drawn. */
export const TECHS: ReadonlySet<SheetName> = new Set<SheetName>([
  'LEVEL_1_TECH',
  'LEVEL_2_TECH',
  'LEVEL_3_TECH',
  'LEVEL_4_TECH',
  'LEVEL_5_TECH',
])

/** Java: `SheetName.UNITS`. */
export const UNITS: ReadonlySet<SheetName> = new Set<SheetName>([
  'AIRCRAFT',
  'ARTILLERY',
  'INFANTRY',
  'MOUNTED',
])

/** Java: `SheetName.CULTURE_CARD`. */
export const CULTURE_CARD: ReadonlySet<SheetName> = new Set<SheetName>([
  'CULTURE_1',
  'CULTURE_2',
  'CULTURE_3',
])

/** Java: `SheetName.ALL_WONDERS`. */
export const ALL_WONDERS: ReadonlySet<SheetName> = new Set<SheetName>([
  'ANCIENT_WONDERS',
  'MEDIEVAL_WONDERS',
  'MODERN_WONDERS',
])

/**
 * Java: `SheetName.SHUFFLABLE_ITEMS`.
 *
 * Only these can be reshuffled. Note that HUTS, VILLAGES, TILES, CITY_STATES
 * and wonders are NOT included — trying to reshuffle them is an error, not an
 * empty deck. That is not what you might expect, but it is what DrawAction.java
 * actually does, and Java is the reference.
 */
export const SHUFFLABLE_ITEMS: ReadonlySet<SheetName> = new Set<SheetName>([
  'AIRCRAFT',
  'ARTILLERY',
  'INFANTRY',
  'MOUNTED',
  'GREAT_PERSON',
  'CULTURE_1',
  'CULTURE_2',
  'CULTURE_3',
  'CIV',
])

const withoutWhitespace = (value: string): string => value.replace(/\s/g, '')

/**
 * Java: `SheetName.find(String)`.
 *
 * Looks first at the label with whitespace stripped and case ignored, so
 * "CIV" matches "Civ", then falls back to the enum name ("CULTURE_1").
 */
export function findSheetName(name: string): SheetName | undefined {
  const needle = withoutWhitespace(name)
  const byLabel = SHEET_NAME_ORDER.find(
    (sheet) => withoutWhitespace(SHEET_LABEL[sheet]).toLowerCase() === needle.toLowerCase(),
  )
  if (byLabel !== undefined) return byLabel

  const upper = name.toUpperCase()
  return SHEET_NAME_ORDER.find((sheet) => sheet === upper)
}
