/**
 * Port of the Item hierarchy in `no.asgari.civilization.server.model`.
 *
 * Java used inheritance (Item -> Unit -> Infantry) with Jackson polymorphism.
 * Here it is a discriminated union on `kind`, with the same discriminator
 * values as Jackson's `@JsonTypeName`, so old Mongo documents can be read later.
 *
 * `revealPublic` and `revealAll` are ported word for word, oddities included:
 * culture cards reveal the class name ("CultureI") rather than the sheet name,
 * GreatPerson reveals its type, and Artillery never reveals the level name the
 * way Infantry and Mounted do.
 */

import type { SheetName } from './sheet-name.js'
import { SHEET_LABEL, sheetOrdinal } from './sheet-name.js'

/** Java had `Level` with levels 1-4 for units and 1-5 for techs. */
export const LEVEL_1 = 1
export const LEVEL_2 = 2
export const LEVEL_3 = 3
export const LEVEL_4 = 4
export const LEVEL_5 = 5

const PNG = '.png'

/** Fields every item shares. Java: `Item extends Spreadsheet, Type`. */
interface ItemBase {
  /**
   * A stable, opaque identity per instance. Java had none: it identified items
   * by value equality, which made two identical `Infantry 1.3` "equal", so
   * `discardedItems.remove(item)` could take away the wrong one.
   */
  readonly id: string
  /**
   * Java: `itemNumber`. A running number with a random start offset per game,
   * used in the log so players can refer to a card without revealing it.
   */
  readonly itemNumber: number
  readonly sheetName: SheetName
  readonly description: string | null
  readonly used: boolean
  readonly hidden: boolean
  /** Java: `ownerId` — the owning player, null while the item is in the deck. */
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
  /** Java: `type` is the token kind, for example "Artist or Thinker". */
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
  /** Java: `flipside` — the name on the back of the card. */
  readonly flipside: string | null
}

/** Java: `Unit` — an abstract base class with attack, health and level. */
interface UnitBase extends ItemBase {
  readonly attack: number
  readonly health: number
  /**
   * Java never set this; `setLevel` is called nowhere in old-civ-rest, so in
   * practice every unit is level 0. The field is ported because `revealPublic`
   * and `revealAll` branch on it, and upgrading units is deferred work.
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
// Type guards
// ---------------------------------------------------------------------------

const UNIT_KINDS = new Set<ItemKind>(['infantry', 'artillery', 'mounted', 'aircraft'])

export function isUnit(item: Item): item is UnitItem {
  return UNIT_KINDS.has(item.kind)
}

/**
 * Java: `Tradable` — an empty marker interface implemented by CultureI/II/III,
 * Hut and Village. Only these can be looted or given away.
 */
const TRADABLE_KINDS = new Set<ItemKind>(['cultureI', 'cultureII', 'cultureIII', 'hut', 'village'])

export function isTradable(item: Item): boolean {
  return TRADABLE_KINDS.has(item.kind)
}

// ---------------------------------------------------------------------------
// Names and types
// ---------------------------------------------------------------------------

/** Java: `Type.getType()` returned the class's simple name. */
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

/** Java: the class's simple name, which `revealPublic` uses for several types. */
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
 * Java: `Unit.getName()` overrode the stored name with
 * `getType() + " " + attack + "." + health`, for example "Infantry 1.3".
 */
export function itemName(item: Item): string {
  if (isUnit(item)) return `${itemType(item)} ${item.attack}.${item.health}`
  return item.name
}

// ---------------------------------------------------------------------------
// Level names for units
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
 * Java: `toString()` on the Unit subclasses. The stat bonus is `level - 1`,
 * which follows from Java writing `attack + LEVEL_1` for level 2,
 * `attack + LEVEL_2` for level 3, and so on.
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
// Revealing
// ---------------------------------------------------------------------------

/**
 * Java: `Spreadsheet.revealPublic()` — "used to reveal hidden public
 * information about the item. Will not reveal the content, just the type."
 *
 * A warning: Wonder and SocialPolicy do reveal their name here. That is what
 * Java does. For SocialPolicy, Java compensated by never calling
 * `revealPublic` from the social-policy log line, writing "has chosen a hidden
 * social policy" instead. See `createAndSetLog` in log.ts.
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
    // Java: Artillery and Aircraft just return getType(), with no level lookup
    case 'artillery':
    case 'aircraft':
      return itemType(item)
  }
}

/** Java: `Spreadsheet.revealAll()` — reveals everything about the item. */
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
// Images
// ---------------------------------------------------------------------------

/**
 * Java: `Image.getImage()`. The file names point at the artwork under
 * `Civilization/Moderator/`. The rules are inconsistent in Java — Civ does not
 * strip spaces, culture cards strip exclamation marks, GreatPerson is prefixed
 * with "klein", and city-states use `description` rather than `name` — and are
 * ported as they are because the files on disk follow them.
 */
export function itemImage(item: Item): string | null {
  switch (item.kind) {
    // Java: Civ does not strip spaces. No civ name has one today.
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
      return `${item.name}${PNG}`.replace(/ /g, '')
    // The WaW social-policy files are lower case, unlike hut/village/tech
    // artwork above. `Expansionsim` is a typo in the spreadsheet data; the
    // file on disk is `expansionism.png`, so `tools/item-assets.ps1` copies
    // it in twice, once under each name.
    case 'socialpolicy':
      return `${item.name.toLowerCase().replace(/ /g, '')}${PNG}`
    case 'tile':
      return `tile${item.name}${PNG}`.replace(/ /g, '')
    // Java: city-states use description ("cs1"), because that sheet has the
    // name and the image reference in the opposite column order to the others.
    case 'citystate':
      return `${item.description ?? ''}${PNG}`.replace(/ /g, '')
    case 'infantry':
    case 'artillery':
    case 'mounted':
    case 'aircraft':
      return `${itemType(item)}${item.attack}.${item.health}${PNG}`.replace(/ /g, '')
    // Java left Wonder without an Image, so the old app showed wonders as text
    // even though the artwork exists. The files under Moderator/wonders are
    // lower case with no spaces and no leading "The", which all 27 names map
    // onto. Hyphens go too ("Notre-Dame"), apostrophes stay
    // ("Leonardo's Workshop").
    case 'wonder':
      return `${item.name.replace(/^The /, '').replace(/[ -]/g, '').toLowerCase()}${PNG}`
  }
}

// ---------------------------------------------------------------------------
// Ordering and equality
// ---------------------------------------------------------------------------

/**
 * Java: `compareTo` compared the sheet enum ordinal — except for GreatPerson,
 * which always returned 0.
 */
export function compareItems(a: Item, b: Item): number {
  if (a.kind === 'greatperson') return 0
  return sheetOrdinal(a.sheetName) - sheetOrdinal(b.sheetName)
}

/**
 * Identity based on `id`. Java used value equality through
 * `@EqualsAndHashCode`, which made two different `Infantry 1.3` instances
 * equal. That made removal from `discardedItems` unreliable. See
 * `itemValueEquals` for the Java semantics.
 */
export function itemEquals(a: Item, b: Item): boolean {
  return a.id === b.id
}

/**
 * Java's value equality, kept because some ported tests are expressed in it.
 * The fields per type follow the `@EqualsAndHashCode` annotations in
 * old-civ-rest.
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
    // exclude = ownerId, hidden, used (+ itemNumber for everything except Hut)
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
