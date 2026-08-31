/**
 * Port av `no.asgari.civilization.server.excel.ItemReader`, uten Apache POI.
 *
 * Inndata er `data/gamedata-faf-waw.json`, som `tools/xlsx-to-json.ps1` lager
 * fra det opprinnelige regnearket. JSON-en er en rå celle-dump som gjengir
 * POIs `Cell.toString()`, nettopp så filtrene under kan porteres ordrett.
 *
 * De fire filtrene i Java var:
 *   notEmptyPredicate        — cellen er ikke tom
 *   notRandomPredicate       — cellen er ikke formelen RAND()
 *   rowNotZeroPredicate      — hopp over overskriftsraden
 *   columnIndexZeroPredicate — kun kolonne A
 *
 * Java flatet ut ALLE celler i arket først og filtrerte deretter på
 * kolonneindeks. Det betyr at hver kolonne komprimeres uavhengig: mangler en
 * rad beskrivelse, forskyves beskrivelseslisten i forhold til navnelisten.
 * `column()` under gjengir den oppførselen, ikke en radvis paring.
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

/** Formen på JSON-filen tools/xlsx-to-json.ps1 skriver. */
export interface GameDataFile {
  readonly gameType: string
  readonly source: string
  readonly sheets: Readonly<Record<string, readonly (readonly string[])[]>>
}

const RAND = 'RAND()'

/**
 * Kolonne `index` fra et ark, uten overskriftsrad, tomme celler og RAND().
 * `trim` gjelder wonders-arket, der Java brukte `!p.toString().trim().isEmpty()`
 * mens de andre arkene brukte `!cell.toString().isEmpty()`.
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
 * Java: `ItemReader.split` — `Splitter.onPattern(",|\\.")`. Cellen "1.3" kommer
 * fra POI som strengen "1.3" (numerisk celle), og splittes til angrep 1,
 * helse 3.
 */
function splitAttackHealth(text: string): readonly [attack: number, health: number] {
  const parts = text.split(/[,.]/).map((part) => part.trim()).filter((part) => part !== '')
  const attack = Number(parts[0])
  const health = Number(parts[1])
  if (!Number.isFinite(attack) || !Number.isFinite(health)) {
    throw new Error(`Kunne ikke lese angrep/helse fra "${text}"`)
  }
  return [attack, health]
}

/**
 * Bygger items og deler ut id og itemNumber. `itemNumber` er et løpenummer med
 * tilfeldig startoffset per spill, som i Java (`RandomUtils.nextInt(1, 20)`),
 * slik at nummeret ikke avslører hvilket kort det er.
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

/** Alt som leses ut av regnearket, stokket. Java: feltene på `ItemReader`. */
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

/** Java: `Tech.getSheetName()` — arknavnet følger av nivået. */
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
    // Java: alle items starter skjult
    hidden: true,
    ownerId: null,
  })

  // --- Civ: kolonne A navn, B starting tech, C beskrivelse ---
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
      // Java: startteknologien får sitt itemNumber her, og overskrives ikke
      // senere fordi den ikke ligger i pbf.items
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

  // --- Kulturkort: kolonne A navn, B beskrivelse ---
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

  // --- Great Person: kolonne A navn, B brikketype, C beskrivelse ---
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

  // --- Huts og Villages: kun kolonne A, ingen beskrivelse ---
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

  // --- Tiles: numeriske celler, "1.0" blir "1" ---
  const tiles = build.shuffle(
    column(sheetOf(data, SHEET_LABEL.TILES), 0).map((text): TileItem => ({
      ...base('TILES', null),
      sheetName: 'TILES',
      kind: 'tile',
      name: String(Math.trunc(Number(text))),
      type: null,
    })),
  )

  // --- City-states: kolonne A er effekten, B er bildereferansen ("cs1") ---
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

  // --- Wonders: ett ark med tre blokker, delt av rader som selv heter
  //     "Medieval Wonders" / "Modern Wonders" ---
  const wonders = readWonders(data, build, base)

  // --- Units: kun kolonne A. Kolonne B-D er statistikk for oppgraderte
  //     nivåer, og Java leser dem ikke ---
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
          // Java kaller aldri setLevel, så alle units starter på nivå 0
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

  // --- Tech: nivå 1-4 fra ark, nivå 5 er kun Space Flight, lagt til i kode ---
  const techs = readTechs(data, base)

  // --- Social Policy: kolonne A navn, B beskrivelse, C bakside ---
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

/**
 * Java: `extractShuffledWondersFromExcel`. Arket har ni ancient wonders, så en
 * rad som heter "Medieval Wonders", ni medieval, en rad "Modern Wonders", og
 * ni modern. Java polled navn til det traff et navn som inneholder "wonders",
 * og forkastet både det navnet og beskrivelsen på samme posisjon.
 */
function readWonders(
  data: GameDataFile,
  build: ItemBuilder,
  base: BaseFn,
): Pick<Deck, 'ancientWonders' | 'medievalWonders' | 'modernWonders'> {
  const sheet = sheetOf(data, SHEET_LABEL.WONDERS)
  const names = column(sheet, 0, { trim: true })
  const descriptions = column(sheet, 1, { trim: true })
  const separator = SHEET_LABEL.WONDERS.toLowerCase()

  let cursor = 0
  const takeBlock = (
    type: WonderItem['type'],
    sheetName: WonderItem['sheetName'],
    stopAtSeparator: boolean,
  ): WonderItem[] => {
    const block: WonderItem[] = []
    while (cursor < names.length) {
      const name = names[cursor] as string
      const description = descriptions[cursor] ?? null
      cursor += 1
      if (stopAtSeparator && name.toLowerCase().includes(separator)) break
      block.push({
        ...base(sheetName, description),
        sheetName,
        kind: 'wonder',
        name,
        type,
      })
    }
    return build.shuffle(block)
  }

  return {
    ancientWonders: takeBlock('Ancient', 'ANCIENT_WONDERS', true),
    medievalWonders: takeBlock('Medieval', 'MEDIEVAL_WONDERS', true),
    // Java tok resten uten å se etter skilletegn
    modernWonders: takeBlock('Modern', 'MODERN_WONDERS', false),
  }
}

/**
 * Java: `getTechsFromExcel`. Teknologier stokkes ikke — spilleren velger selv —
 * men sorteres på nivå. Nivå 5 finnes ikke som ark; Java la til Space Flight
 * som en statisk singleton, noe som betød delt muterbar tilstand mellom spill.
 * Her lages en ny instans per spill.
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

  // Java: Collections.sort er stabil, så rekkefølgen innen et nivå beholdes
  return techs.sort((a, b) => a.level - b.level)
}
