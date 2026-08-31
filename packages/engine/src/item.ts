/**
 * Port av Item-hierarkiet i `no.asgari.civilization.server.model`.
 *
 * Java brukte arv (Item -> Unit -> Infantry) med Jackson-polymorfi. Her er det
 * en diskriminert union på `kind`, med samme diskriminatorverdier som Jacksons
 * `@JsonTypeName`, slik at gamle Mongo-dokumenter kan leses senere.
 *
 * `revealPublic` og `revealAll` er portert ordrett, inkludert særegenheter:
 * kulturkort avslører klassenavnet ("CultureI") og ikke arknavnet, GreatPerson
 * avslører typen sin, og Artillery avslører aldri nivånavnet slik Infantry og
 * Mounted gjør.
 */

import type { SheetName } from './sheet-name.js'
import { SHEET_LABEL, sheetOrdinal } from './sheet-name.js'

/** Java hadde `Level` med nivå 1-4 for units og 1-5 for tech. */
export const LEVEL_1 = 1
export const LEVEL_2 = 2
export const LEVEL_3 = 3
export const LEVEL_4 = 4
export const LEVEL_5 = 5

const PNG = '.png'

/** Felter alle items deler. Java: `Item extends Spreadsheet, Type`. */
interface ItemBase {
  /**
   * Stabil, ugjennomsiktig identitet per instans. Fantes ikke i Java, som
   * identifiserte items med verdi-likhet — det gjorde at to identiske
   * `Infantry 1.3` var «like», og `discardedItems.remove(item)` kunne fjerne
   * feil instans.
   */
  readonly id: string
  /**
   * Java: `itemNumber`. Løpenummer med tilfeldig startoffset per spill, brukt i
   * loggen så spillere kan referere til et kort uten å avsløre innholdet.
   */
  readonly itemNumber: number
  readonly sheetName: SheetName
  readonly description: string | null
  readonly used: boolean
  readonly hidden: boolean
  /** Java: `ownerId` — spilleren som eier itemet, null når det ligger i stokken. */
  readonly ownerId: string | null
}

export interface CivItem extends ItemBase {
  readonly kind: 'civ'
  readonly sheetName: 'CIV'
  readonly name: string
  readonly type: string | null
  readonly startingTech: TechItem
}

export interface CultureIItem extends ItemBase {
  readonly kind: 'cultureI'
  readonly sheetName: 'CULTURE_1'
  readonly name: string
  readonly type: string | null
}

export interface CultureIIItem extends ItemBase {
  readonly kind: 'cultureII'
  readonly sheetName: 'CULTURE_2'
  readonly name: string
  readonly type: string | null
}

export interface CultureIIIItem extends ItemBase {
  readonly kind: 'cultureIII'
  readonly sheetName: 'CULTURE_3'
  readonly name: string
  readonly type: string | null
}

export interface GreatPersonItem extends ItemBase {
  readonly kind: 'greatperson'
  readonly sheetName: 'GREAT_PERSON'
  readonly name: string
  /** Java: `type` er brikketypen, f.eks. "Artist or Thinker". */
  readonly type: string | null
}

export interface HutItem extends ItemBase {
  readonly kind: 'hut'
  readonly sheetName: 'HUTS'
  readonly name: string
  readonly type: string | null
}

export interface VillageItem extends ItemBase {
  readonly kind: 'village'
  readonly sheetName: 'VILLAGES'
  readonly name: string
  readonly type: string | null
}

export interface WonderItem extends ItemBase {
  readonly kind: 'wonder'
  readonly sheetName: 'ANCIENT_WONDERS' | 'MEDIEVAL_WONDERS' | 'MODERN_WONDERS'
  readonly name: string
  /** Java: `Wonder.ANCIENT` / `MEDIEVAL` / `MODERN`. */
  readonly type: 'Ancient' | 'Medieval' | 'Modern'
}

export interface TileItem extends ItemBase {
  readonly kind: 'tile'
  readonly sheetName: 'TILES'
  readonly name: string
  readonly type: string | null
}

export interface CitystateItem extends ItemBase {
  readonly kind: 'citystate'
  readonly sheetName: 'CITY_STATES'
  readonly name: string
  readonly type: string | null
}

export interface TechItem extends ItemBase {
  readonly kind: 'tech'
  readonly sheetName: 'LEVEL_1_TECH' | 'LEVEL_2_TECH' | 'LEVEL_3_TECH' | 'LEVEL_4_TECH' | 'LEVEL_5_TECH'
  readonly name: string
  readonly type: string | null
  readonly level: 1 | 2 | 3 | 4 | 5
}

export interface SocialPolicyItem extends ItemBase {
  readonly kind: 'socialpolicy'
  readonly sheetName: 'SOCIAL_POLICY'
  readonly name: string
  readonly type: string | null
  /** Java: `flipside` — navnet på baksiden av kortet. */
  readonly flipside: string | null
}

/** Java: `Unit` — abstrakt basisklasse med angrep, helse og nivå. */
interface UnitBase extends ItemBase {
  readonly attack: number
  readonly health: number
  /**
   * Java satte aldri dette; `setLevel` kalles ingen steder i old-civ-rest, så
   * alle units i praksis har nivå 0. Feltet er portert fordi `revealPublic` og
   * `revealAll` grener på det, og oppgradering av units er utsatt arbeid.
   */
  readonly level: 0 | 1 | 2 | 3 | 4
  readonly killed: boolean
  readonly inBattle: boolean
}

export interface InfantryItem extends UnitBase {
  readonly kind: 'infantry'
  readonly sheetName: 'INFANTRY'
}

export interface ArtilleryItem extends UnitBase {
  readonly kind: 'artillery'
  readonly sheetName: 'ARTILLERY'
}

export interface MountedItem extends UnitBase {
  readonly kind: 'mounted'
  readonly sheetName: 'MOUNTED'
}

export interface AircraftItem extends UnitBase {
  readonly kind: 'aircraft'
  readonly sheetName: 'AIRCRAFT'
}

export type UnitItem = InfantryItem | ArtilleryItem | MountedItem | AircraftItem

export type Item =
  | CivItem
  | CultureIItem
  | CultureIIItem
  | CultureIIIItem
  | GreatPersonItem
  | HutItem
  | VillageItem
  | WonderItem
  | TileItem
  | CitystateItem
  | TechItem
  | SocialPolicyItem
  | UnitItem

export type ItemKind = Item['kind']

// ---------------------------------------------------------------------------
// Typevakter
// ---------------------------------------------------------------------------

const UNIT_KINDS = new Set<ItemKind>(['infantry', 'artillery', 'mounted', 'aircraft'])

export function isUnit(item: Item): item is UnitItem {
  return UNIT_KINDS.has(item.kind)
}

/**
 * Java: `Tradable` — et tomt markørgrensesnitt implementert av CultureI/II/III,
 * Hut og Village. Bare disse kan loot'es eller gis bort.
 */
const TRADABLE_KINDS = new Set<ItemKind>(['cultureI', 'cultureII', 'cultureIII', 'hut', 'village'])

export function isTradable(item: Item): boolean {
  return TRADABLE_KINDS.has(item.kind)
}

// ---------------------------------------------------------------------------
// Navn og typer
// ---------------------------------------------------------------------------

/** Java: `Type.getType()` returnerte klassens enkle navn. */
export function itemType(item: Item): string {
  switch (item.kind) {
    case 'infantry':
      return 'Infantry'
    case 'artillery':
      return 'Artillery'
    case 'mounted':
      return 'Mounted'
    case 'aircraft':
      return 'Aircraft'
    default:
      return item.type ?? ''
  }
}

/** Java: klassens enkle navn, som `revealPublic` bruker for flere typer. */
function simpleName(kind: ItemKind): string {
  switch (kind) {
    case 'civ':
      return 'Civ'
    case 'cultureI':
      return 'CultureI'
    case 'cultureII':
      return 'CultureII'
    case 'cultureIII':
      return 'CultureIII'
    case 'greatperson':
      return 'GreatPerson'
    case 'hut':
      return 'Hut'
    case 'village':
      return 'Village'
    case 'wonder':
      return 'Wonder'
    case 'tile':
      return 'Tile'
    case 'citystate':
      return 'Citystate'
    case 'tech':
      return 'Tech'
    case 'socialpolicy':
      return 'SocialPolicy'
    case 'infantry':
      return 'Infantry'
    case 'artillery':
      return 'Artillery'
    case 'mounted':
      return 'Mounted'
    case 'aircraft':
      return 'Aircraft'
  }
}

/**
 * Java: `Unit.getName()` overstyrte det lagrede navnet med
 * `getType() + " " + attack + "." + health`, f.eks. "Infantry 1.3".
 */
export function itemName(item: Item): string {
  if (isUnit(item)) return `${itemType(item)} ${item.attack}.${item.health}`
  return item.name
}

// ---------------------------------------------------------------------------
// Nivånavn for units
// ---------------------------------------------------------------------------

const INFANTRY_LEVEL_NAMES = ['Infantry', 'Spearmen', 'Pikemen', 'Riflemen', 'Modern Infantry'] as const
const ARTILLERY_LEVEL_NAMES = ['Artillery', 'Archer', 'Cannon', 'Catapult', 'Mobile Artillery'] as const
const MOUNTED_LEVEL_NAMES = ['Mounted', 'Horsemen', 'Knight', 'Cavalry', 'Tank'] as const

function unitLevelNames(unit: UnitItem): readonly string[] | null {
  switch (unit.kind) {
    case 'infantry':
      return INFANTRY_LEVEL_NAMES
    case 'artillery':
      return ARTILLERY_LEVEL_NAMES
    case 'mounted':
      return MOUNTED_LEVEL_NAMES
    case 'aircraft':
      return null
  }
}

/**
 * Java: `toString()` på Unit-subklassene. Statsbonusen er `level - 1`, som
 * følger av at Java skrev `attack + LEVEL_1` for nivå 2, `attack + LEVEL_2` for
 * nivå 3, og så videre.
 */
function unitToString(unit: UnitItem): string {
  const names = unitLevelNames(unit)
  if (names === null || unit.level === 0) {
    return `${itemType(unit)} ${unit.attack}.${unit.health}`
  }
  const bonus = unit.level - 1
  return `${names[unit.level] ?? itemType(unit)} ${unit.attack + bonus}.${unit.health + bonus}`
}

// ---------------------------------------------------------------------------
// Avsløring
// ---------------------------------------------------------------------------

/**
 * Java: `Spreadsheet.revealPublic()` — «avslører skjult offentlig informasjon
 * om itemet. Avslører ikke innholdet, bare typen.»
 *
 * Advarsel: Wonder og SocialPolicy avslører navnet sitt her. Det er hva Java
 * gjør. For SocialPolicy kompenserte Java ved at logglinjen for valg av
 * sosialpolitikk aldri kalte `revealPublic`, men skrev «has chosen a hidden
 * social policy». Se `createAndSetLog` i log.ts.
 */
export function revealPublic(item: Item): string {
  switch (item.kind) {
    case 'civ':
    case 'cultureI':
    case 'cultureII':
    case 'cultureIII':
    case 'hut':
    case 'village':
      return simpleName(item.kind)
    case 'greatperson':
      return item.type ?? ''
    case 'wonder':
    case 'socialpolicy':
      return item.name
    case 'tile':
      return `Tile ${item.name}`
    case 'citystate':
      return `City state: ${item.name}`
    case 'tech':
      return SHEET_LABEL[item.sheetName]
    case 'infantry':
    case 'mounted': {
      const names = unitLevelNames(item)
      return names?.[item.level] ?? itemType(item)
    }
    // Java: Artillery og Aircraft returnerer bare getType(), uten nivåoppslag
    case 'artillery':
    case 'aircraft':
      return itemType(item)
  }
}

/** Java: `Spreadsheet.revealAll()` — avslører alt om itemet. */
export function revealAll(item: Item): string {
  switch (item.kind) {
    case 'civ':
      return `Civ : ${item.name}`
    case 'cultureI':
    case 'cultureII':
    case 'cultureIII':
    case 'wonder':
    case 'tech':
    case 'socialpolicy':
      return item.name
    case 'greatperson':
      return `${item.name} ${item.type ?? ''}`
    case 'hut':
      return `Hut: ${item.name}`
    case 'village':
      return `Village: ${item.name}`
    case 'tile':
      return `Tile ${item.name}`
    case 'citystate':
      return `City state: ${item.name}`
    case 'infantry':
    case 'artillery':
    case 'mounted':
    case 'aircraft':
      return unitToString(item)
  }
}

// ---------------------------------------------------------------------------
// Bilder
// ---------------------------------------------------------------------------

/**
 * Java: `Image.getImage()`. Filnavnene peker på grafikken under
 * `Civilization/Moderator/`. Reglene er inkonsistente i Java (Civ fjerner ikke
 * mellomrom, kulturkort stripper utropstegn, GreatPerson prefikses med
 * "klein", bystater bruker `description` og ikke `name`), og er portert som de
 * er fordi filnavnene på disk følger dem.
 */
export function itemImage(item: Item): string | null {
  switch (item.kind) {
    // Java: Civ fjerner ikke mellomrom. Ingen civ-navn har mellomrom i dag.
    case 'civ':
      return `${item.name}${PNG}`
    case 'cultureI':
    case 'cultureII':
    case 'cultureIII':
      return `${item.name.replace(/!/g, '')}${PNG}`.replace(/ /g, '')
    case 'greatperson':
      return `klein${item.name}${PNG}`.replace(/ /g, '')
    case 'hut':
    case 'village':
    case 'tech':
    case 'socialpolicy':
      return `${item.name}${PNG}`.replace(/ /g, '')
    case 'tile':
      return `tile${item.name}${PNG}`.replace(/ /g, '')
    // Java: bystater bruker description ("cs1"), fordi arket har navn og
    // bildereferanse i motsatt kolonnerekkefølge av de andre arkene.
    case 'citystate':
      return `${item.description ?? ''}${PNG}`.replace(/ /g, '')
    case 'infantry':
    case 'artillery':
    case 'mounted':
    case 'aircraft':
      return `${itemType(item)}${item.attack}.${item.health}${PNG}`.replace(/ /g, '')
    // Java: Wonder implementerer ikke Image
    case 'wonder':
      return null
  }
}

// ---------------------------------------------------------------------------
// Sortering og likhet
// ---------------------------------------------------------------------------

/**
 * Java: `compareTo` sammenlignet arkets enum-ordinal — bortsett fra
 * GreatPerson, som alltid returnerte 0.
 */
export function compareItems(a: Item, b: Item): number {
  if (a.kind === 'greatperson') return 0
  return sheetOrdinal(a.sheetName) - sheetOrdinal(b.sheetName)
}

/**
 * Identitet basert på `id`. Java brukte verdi-likhet via `@EqualsAndHashCode`,
 * som betyr at to forskjellige `Infantry 1.3`-instanser var like. Det gjorde
 * fjerning fra `discardedItems` upålitelig. Se `itemValueEquals` for
 * Java-semantikken.
 */
export function itemEquals(a: Item, b: Item): boolean {
  return a.id === b.id
}

/**
 * Javas verdi-likhet, beholdt fordi noen porterte tester uttrykker seg i den.
 * Feltene per type følger `@EqualsAndHashCode`-annotasjonene i old-civ-rest.
 */
export function itemValueEquals(a: Item, b: Item): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    // of = {"name", "description", "type"}
    case 'civ':
    case 'cultureI':
    case 'cultureII':
    case 'cultureIII':
    case 'citystate': {
      const other = b as typeof a
      return a.name === other.name && a.description === other.description && a.type === other.type
    }
    // of = {"name", "type"}
    case 'greatperson': {
      const other = b as typeof a
      return a.name === other.name && a.type === other.type
    }
    // of = {"name"}
    case 'tech':
    case 'socialpolicy': {
      const other = b as typeof a
      return a.name === other.name
    }
    // exclude = ownerId, hidden, used (+ itemNumber for alle utenom Hut)
    case 'hut': {
      const other = b as typeof a
      return (
        a.name === other.name &&
        a.type === other.type &&
        a.description === other.description &&
        a.itemNumber === other.itemNumber
      )
    }
    case 'village':
    case 'wonder':
    case 'tile': {
      const other = b as typeof a
      return a.name === other.name && a.type === other.type && a.description === other.description
    }
    // exclude = ownerId, hidden, used, itemNumber
    case 'infantry':
    case 'artillery':
    case 'mounted': {
      const other = b as typeof a
      return (
        a.level === other.level &&
        a.attack === other.attack &&
        a.health === other.health &&
        a.killed === other.killed &&
        a.inBattle === other.inBattle
      )
    }
    // of = {"attack", "health", "sheetName"}
    case 'aircraft': {
      const other = b as typeof a
      return a.attack === other.attack && a.health === other.health
    }
  }
}
