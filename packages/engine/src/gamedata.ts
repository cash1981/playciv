/**
 * Port of `no.asgari.civilization.server.excel.ItemReader`, without Apache POI.
 *
 * The input is `data/gamedata-faf-waw.json`, which `tools/xlsx-to-json.ps1`
 * builds from the original spreadsheet. The JSON is a raw cell dump that
 * reproduces POI's `Cell.toString()`, precisely so the filters below can be
 * ported word for word.
 *
 * De fire filtrene i Java var:
 *   notEmptyPredicate        — the cell is not empty
 *   notRandomPredicate       — the cell is not the RAND() formula
 *   rowNotZeroPredicate      — skip the header row
 *   columnIndexZeroPredicate — column A only
 *
 * Java flattened EVERY cell in the sheet first and only then filtered on
 * column index. That compacts each column independently: if a row has no
 * description, the description list slips against the name list. `column()`
 * below reproduces that behaviour rather than pairing row by row.
 */

import type {
  AircraftItem,
  ArtilleryItem,
  CitystateItem,
  CivItem,
  CultureIItem,
  CultureIIItem,
  CultureIIIItem,
  GreatPersonItem,
  HutItem,
  InfantryItem,
  Item,
  MountedItem,
  SocialPolicyItem,
  TechItem,
  TileItem,
  UnitItem,
  VillageItem,
  WonderItem,
} from './item.js'
import { LEVEL_1, LEVEL_5 } from './item.js'
import type { Rng } from './random.js'
import { nextId, shuffle } from './random.js'
import { SHEET_LABEL } from './sheet-name.js'

/** The shape of the JSON file tools/xlsx-to-json.ps1 writes. */
export interface GameDataFile {
  readonly gameType: string
  readonly source: string
  readonly sheets: Readonly<Record<string, readonly (readonly string[])[]>>
}

const RAND = 'RAND()'

/**
 * Column `index` from a sheet, without the header row, empty cells and RAND().
 * `trim` applies to the wonders sheet, where Java used
 * `!p.toString().trim().isEmpty()` while the other sheets used
 * `!cell.toString().isEmpty()`.
 */
function column(
  sheet: readonly (readonly string[])[],
  index: number,
  options: { readonly trim?: boolean } = {},
): string[] {
  const isEmpty = options.trim === true
    ? (text: string) => text.trim() === ''
    : (text: string) => text === ''

  return sheet
    .slice(1)
    .map((row) => row[index] ?? '')
    .filter((text) => !isEmpty(text) && text !== RAND)
}

function sheetOf(data: GameDataFile, label: string): readonly (readonly string[])[] {
  const sheet = data.sheets[label]
  if (sheet === undefined) throw new Error(`Regnearket mangler arket "${label}"`)
  return sheet
}

/**
 * Java: `ItemReader.split` — `Splitter.onPattern(",|\\.")`. POI hands the cell
 * "1.3" over as the string "1.3" (a numeric cell), which splits into attack 1
 * and health 3.
 */
function splitAttackHealth(text: string): readonly [attack: number, health: number] {
  const parts = text.split(/[,.]/).map((part) => part.trim()).filter((part) => part !== '')
  const attack = Number(parts[0])
  const health = Number(parts[1])
  if (!Number.isFinite(attack) || !Number.isFinite(health)) {
    throw new Error(`Could not read attack and health from "${text}"`)
  }
  return [attack, health]
}

/**
 * Builds items and hands out ids and itemNumbers. `itemNumber` is a running
 * number with a random start offset per game, as in Java
 * (`RandomUtils.nextInt(1, 20)`), so the number does not give the card away.
 */
class ItemBuilder {
  private rng: Rng
  private counter: number

  constructor(rng: Rng, startCounter: number) {
    this.rng = rng
    this.counter = startCounter
  }

  /** Java: `itemCounter.incrementAndGet()`. */
  nextItemNumber(): number {
    this.counter += 1
    return this.counter
  }

  nextId(): string {
    const [id, rng] = nextId(this.rng)
    this.rng = rng
    return id
  }

  shuffle<T>(items: readonly T[]): T[] {
    const [shuffled, rng] = shuffle(items, this.rng)
    this.rng = rng
    return shuffled
  }

  get state(): readonly [rng: Rng, counter: number] {
    return [this.rng, this.counter]
  }
}

/** Everything read out of the spreadsheet, shuffled. Java: the `ItemReader` fields. */
export interface Deck {
  readonly civs: readonly CivItem[]
  readonly cultureI: readonly CultureIItem[]
  readonly cultureII: readonly CultureIIItem[]
  readonly cultureIII: readonly CultureIIIItem[]
  readonly greatPersons: readonly GreatPersonItem[]
  readonly huts: readonly HutItem[]
  readonly villages: readonly VillageItem[]
  readonly tiles: readonly TileItem[]
  readonly cityStates: readonly CitystateItem[]
  readonly ancientWonders: readonly WonderItem[]
  readonly medievalWonders: readonly WonderItem[]
  readonly modernWonders: readonly WonderItem[]
  readonly infantry: readonly InfantryItem[]
  readonly artillery: readonly ArtilleryItem[]
  readonly mounted: readonly MountedItem[]
  readonly aircraft: readonly AircraftItem[]
  readonly techs: readonly TechItem[]
  readonly socialPolicies: readonly SocialPolicyItem[]
  readonly rng: Rng
  readonly itemCounter: number
}

const TECH_SHEET_BY_LEVEL = {
  1: 'LEVEL_1_TECH',
  2: 'LEVEL_2_TECH',
  3: 'LEVEL_3_TECH',
  4: 'LEVEL_4_TECH',
  5: 'LEVEL_5_TECH',
} as const

/** Java: `Tech.getSheetName()` — the sheet name follows from the level. */
export function techSheetName(level: 1 | 2 | 3 | 4 | 5): TechItem['sheetName'] {
  return TECH_SHEET_BY_LEVEL[level]
}

export function readDeck(data: GameDataFile, rng: Rng, startCounter: number): Deck {
  const build = new ItemBuilder(rng, startCounter)

  const base = (sheetName: Item['sheetName'], description: string | null) => ({
    id: build.nextId(),
    itemNumber: 0,
    sheetName,
    description,
    used: false,
    // Java: every item starts hidden
    hidden: true,
    ownerId: null,
  })

  // --- Civ: column A name, B starting tech, C description ---
  const civSheet = sheetOf(data, SHEET_LABEL.CIV)
  const civNames = column(civSheet, 0)
  const civStartingTechs = column(civSheet, 1)
  const civDescriptions = column(civSheet, 2)
  const civs = build.shuffle(
    civNames.map((name, i): CivItem => ({
      ...base('CIV', civDescriptions[i] ?? null),
      sheetName: 'CIV',
      kind: 'civ',
      name,
      type: null,
      // Java: the starting tech gets its itemNumber here and is not overwritten
      // later, because it does not sit in pbf.items
      startingTech: {
        id: build.nextId(),
        itemNumber: build.nextItemNumber(),
        sheetName: techSheetName(LEVEL_1),
        kind: 'tech',
        name: civStartingTechs[i] ?? '',
        type: null,
        description: null,
        level: LEVEL_1,
        used: false,
        hidden: true,
        ownerId: null,
      },
    })),
  )

  // --- Culture cards: column A name, B description ---
  const cultureISheet = sheetOf(data, SHEET_LABEL.CULTURE_1)
  const cultureIDescriptions = column(cultureISheet, 1)
  const cultureI = build.shuffle(
    column(cultureISheet, 0).map((name, i): CultureIItem => ({
      ...base('CULTURE_1', cultureIDescriptions[i] ?? null),
      sheetName: 'CULTURE_1',
      kind: 'cultureI',
      name,
      type: null,
    })),
  )

  const cultureIISheet = sheetOf(data, SHEET_LABEL.CULTURE_2)
  const cultureIIDescriptions = column(cultureIISheet, 1)
  const cultureII = build.shuffle(
    column(cultureIISheet, 0).map((name, i): CultureIIItem => ({
      ...base('CULTURE_2', cultureIIDescriptions[i] ?? null),
      sheetName: 'CULTURE_2',
      kind: 'cultureII',
      name,
      type: null,
    })),
  )

  const cultureIIISheet = sheetOf(data, SHEET_LABEL.CULTURE_3)
  const cultureIIIDescriptions = column(cultureIIISheet, 1)
  const cultureIII = build.shuffle(
    column(cultureIIISheet, 0).map((name, i): CultureIIIItem => ({
      ...base('CULTURE_3', cultureIIIDescriptions[i] ?? null),
      sheetName: 'CULTURE_3',
      kind: 'cultureIII',
      name,
      type: null,
    })),
  )

  // --- Great Person: column A name, B token kind, C description ---
  const gpSheet = sheetOf(data, SHEET_LABEL.GREAT_PERSON)
  const gpTypes = column(gpSheet, 1)
  const gpDescriptions = column(gpSheet, 2)
  const greatPersons = build.shuffle(
    column(gpSheet, 0).map((name, i): GreatPersonItem => ({
      ...base('GREAT_PERSON', gpDescriptions[i] ?? null),
      sheetName: 'GREAT_PERSON',
      kind: 'greatperson',
      name,
      type: gpTypes[i] ?? null,
    })),
  )

  // --- Huts and Villages: column A only, no description ---
  const huts = build.shuffle(
    column(sheetOf(data, SHEET_LABEL.HUTS), 0).map((name): HutItem => ({
      ...base('HUTS', null),
      sheetName: 'HUTS',
      kind: 'hut',
      name,
      type: null,
    })),
  )

  const villages = build.shuffle(
    column(sheetOf(data, SHEET_LABEL.VILLAGES), 0).map((name): VillageItem => ({
      ...base('VILLAGES', null),
      sheetName: 'VILLAGES',
      kind: 'village',
      name,
      type: null,
    })),
  )

  // --- Tiles: numeric cells, so "1.0" becomes "1" ---
  const tiles = build.shuffle(
    column(sheetOf(data, SHEET_LABEL.TILES), 0).map((text): TileItem => ({
      ...base('TILES', null),
      sheetName: 'TILES',
      kind: 'tile',
      name: String(Math.trunc(Number(text))),
      type: null,
    })),
  )

  // --- City-states: column A is the effect, B the image reference ("cs1") ---
  const csSheet = sheetOf(data, SHEET_LABEL.CITY_STATES)
  const csDescriptions = column(csSheet, 1)
  const cityStates = build.shuffle(
    column(csSheet, 0).map((name, i): CitystateItem => ({
      ...base('CITY_STATES', csDescriptions[i] ?? null),
      sheetName: 'CITY_STATES',
      kind: 'citystate',
      name,
      type: null,
    })),
  )

  // --- Wonders: one sheet in three blocks, separated by rows that are
  //     themselves called "Medieval Wonders" and "Modern Wonders" ---
  const wonders = readWonders(data, build, base)

  // --- Units: column A only. Columns B to D hold the stats for upgraded
  //     levels, and Java never reads them ---
  const readUnits = <T extends UnitItem>(
    label: string,
    sheetName: T['sheetName'],
    kind: T['kind'],
  ): T[] =>
    build.shuffle(
      column(sheetOf(data, label), 0).map((text) => {
        const [attack, health] = splitAttackHealth(text)
        return {
          ...base(sheetName, null),
          sheetName,
          kind,
          attack,
          health,
          // Java never calls setLevel, so every unit starts at level 0
          level: 0,
          killed: false,
          inBattle: false,
        } as T
      }),
    )

  const infantry = readUnits<InfantryItem>(SHEET_LABEL.INFANTRY, 'INFANTRY', 'infantry')
  const artillery = readUnits<ArtilleryItem>(SHEET_LABEL.ARTILLERY, 'ARTILLERY', 'artillery')
  const mounted = readUnits<MountedItem>(SHEET_LABEL.MOUNTED, 'MOUNTED', 'mounted')
  const aircraft = readUnits<AircraftItem>(SHEET_LABEL.AIRCRAFT, 'AIRCRAFT', 'aircraft')

  // --- Techs: levels 1-4 from sheets; level 5 is Space Flight alone, added in code ---
  const techs = readTechs(data, base)

  // --- Social Policy: column A name, B description, C flipside ---
  const spSheet = sheetOf(data, SHEET_LABEL.SOCIAL_POLICY)
  const spDescriptions = column(spSheet, 1)
  const spFlipsides = column(spSheet, 2)
  const socialPolicies = build.shuffle(
    column(spSheet, 0).map((name, i): SocialPolicyItem => ({
      ...base('SOCIAL_POLICY', spDescriptions[i] ?? null),
      sheetName: 'SOCIAL_POLICY',
      kind: 'socialpolicy',
      name,
      type: null,
      flipside: spFlipsides[i] ?? null,
    })),
  )

  const [finalRng, finalCounter] = build.state
  return {
    civs,
    cultureI,
    cultureII,
    cultureIII,
    greatPersons,
    huts,
    villages,
    tiles,
    cityStates,
    ...wonders,
    infantry,
    artillery,
    mounted,
    aircraft,
    techs,
    socialPolicies,
    rng: finalRng,
    itemCounter: finalCounter,
  }
}

type BaseFn = (sheetName: Item['sheetName'], description: string | null) => {
  id: string
  itemNumber: number
  sheetName: Item['sheetName']
  description: string | null
  used: boolean
  hidden: boolean
  ownerId: null
}

/** One wonder's name, era and printed text, independent of any game's deck. */
export interface WonderReference {
  readonly name: string
  readonly description: string | null
  readonly type: WonderItem['type']
}

const WONDER_SHEET_NAME: Record<WonderItem['type'], WonderItem['sheetName']> = {
  Ancient: 'ANCIENT_WONDERS',
  Medieval: 'MEDIEVAL_WONDERS',
  Modern: 'MODERN_WONDERS',
}

/**
 * Java: `extractShuffledWondersFromExcel`. The sheet holds nine ancient
 * wonders, then a row called "Medieval Wonders", nine medieval, a row "Modern
 * Wonders", and nine modern. Java polled names until it hit one containing
 * "wonders", discarding both that name and the description beside it.
 *
 * This reads every wonder once, in print order, with no shuffling and no
 * item ids — the shape a player-aid reference wants. `readWonders` below
 * turns the same rows into the shuffled, id-bearing deck.
 */
export function wonderReference(data: GameDataFile): readonly WonderReference[] {
  const sheet = sheetOf(data, SHEET_LABEL.WONDERS)
  const names = column(sheet, 0, { trim: true })
  const descriptions = column(sheet, 1, { trim: true })
  const separator = SHEET_LABEL.WONDERS.toLowerCase()

  let cursor = 0
  const takeBlock = (type: WonderItem['type'], stopAtSeparator: boolean): WonderReference[] => {
    const block: WonderReference[] = []
    while (cursor < names.length) {
      const name = names[cursor] as string
      const description = descriptions[cursor] ?? null
      cursor += 1
      if (stopAtSeparator && name.toLowerCase().includes(separator)) break
      block.push({ name, description, type })
    }
    return block
  }

  return [
    ...takeBlock('Ancient', true),
    ...takeBlock('Medieval', true),
    // Java took the rest without looking for a separator
    ...takeBlock('Modern', false),
  ]
}

function readWonders(
  data: GameDataFile,
  build: ItemBuilder,
  base: BaseFn,
): Pick<Deck, 'ancientWonders' | 'medievalWonders' | 'modernWonders'> {
  const toItem = (entry: WonderReference): WonderItem => {
    const sheetName = WONDER_SHEET_NAME[entry.type]
    return {
      ...base(sheetName, entry.description),
      sheetName,
      kind: 'wonder',
      name: entry.name,
      type: entry.type,
    }
  }

  const entries = wonderReference(data)
  const byType = (type: WonderItem['type']): WonderItem[] =>
    entries.filter((entry) => entry.type === type).map(toItem)

  return {
    ancientWonders: build.shuffle(byType('Ancient')),
    medievalWonders: build.shuffle(byType('Medieval')),
    modernWonders: build.shuffle(byType('Modern')),
  }
}

/**
 * Java: `getTechsFromExcel`. Techs are not shuffled — the player picks — but
 * they are sorted by level. Level 5 has no sheet; Java added Space Flight as a
 * static singleton, which meant shared mutable state between games. Here a
 * fresh instance is made per game.
 */
function readTechs(data: GameDataFile, base: BaseFn): TechItem[] {
  const levels: readonly (1 | 2 | 3 | 4)[] = [1, 2, 3, 4]
  const techs: TechItem[] = []

  for (const level of levels) {
    const sheetName = techSheetName(level)
    for (const name of column(sheetOf(data, SHEET_LABEL[sheetName]), 0)) {
      techs.push({
        ...base(sheetName, null),
        sheetName,
        kind: 'tech',
        name,
        type: null,
        level,
      })
    }
  }

  techs.push({
    ...base(techSheetName(LEVEL_5), null),
    sheetName: techSheetName(LEVEL_5),
    kind: 'tech',
    name: 'Space Flight',
    type: null,
    level: LEVEL_5,
  })

  // Java: Collections.sort is stable, so the order within a level is kept
  return techs.sort((a, b) => a.level - b.level)
}
