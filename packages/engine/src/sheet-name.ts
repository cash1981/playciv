/**
 * Port av `no.asgari.civilization.server.SheetName`.
 *
 * Java-enumet hadde både et navn (CIV) og en etikett ("Civ"), der etiketten er
 * arkfanen i regnearket. Rekkefølgen under er identisk med Java, fordi
 * `Item.compareTo` sammenligner enum-ordinal.
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

/** Ordinal, slik at `compareTo` kan porteres 1:1. */
const ORDINAL: Readonly<Record<SheetName, number>> = Object.fromEntries(
  SHEET_NAME_ORDER.map((name, index) => [name, index]),
) as Record<SheetName, number>

export function sheetOrdinal(sheet: SheetName): number {
  return ORDINAL[sheet]
}

/** Java: `SheetName.SHEETS` — hele enumet. */
export const SHEETS: ReadonlySet<SheetName> = new Set(SHEET_NAME_ORDER)

/** Java: `SheetName.TECHS`. Teknologier velges, de trekkes ikke. */
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
 * Kun disse kan reshuffles. Merk at HUTS, VILLAGES, TILES, CITY_STATES og
 * wonders IKKE er med — forsøk på å reshuffle dem er en feil, ikke en tom
 * stokk. Det avviker fra hva man kanskje ville forvente, men er hva
 * DrawAction.java faktisk gjør, og Java er fasit.
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
 * Slår først opp mot etiketten med mellomrom fjernet og uten hensyn til
 * store/små bokstaver ("CIV" treffer "Civ"), og faller så tilbake på
 * enum-navnet ("CULTURE_1").
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
