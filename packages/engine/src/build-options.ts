/**
 * What a player can build with each of their cities (assisted Build, part 2 of
 * #264: buildings; figures and units follow).
 *
 * For every city on the map: whether the player may build now, the production the
 * city has, and the buildings split in two lists. `choices` holds only buildings
 * that can be built right now, each with the legal squares and any trade to pay;
 * `unavailable` holds every other known building with a plain reason, so the
 * picker can explain itself and nothing is hidden by silence.
 *
 * Derived from the board, the player's revealed techs and their trade, never
 * stored. It depends on unrevealed techs, so it belongs to the viewer's own
 * projection and to nobody else's. `apply` of the `build` action recomputes it
 * from the fresh state, so the projection and the action cannot disagree.
 *
 * Import cycle with `assisted.ts`, on purpose and as there: that file builds the
 * action from this one, this one asks it whether City Management is open. Both
 * only call each other inside functions, never while the modules load.
 */

import { PHASE_REASON, openCityManagementTurn } from './assisted.js'
import { cityFootprintsOf, mapCellOf } from './blockade.js'
import type { Cell, CityFootprintView } from './blockade.js'
import {
  BUILDABLE_BUILDINGS,
  BUILDING_UPGRADES,
  LIMITED_BUILDINGS,
  buildingDataOf,
  buildingNameOf,
  techsUnlocking,
} from './building-data.js'
import { boardAssetLimit, columnLabel, findBoardAsset, isMapCell, mapTop, remainingBoardAssetCount } from './board.js'
import type { Board } from './board.js'
import { cityProductionsOf } from './city-production.js'
import type { CityProduction } from './city-production.js'
import type { GameState, Playerhand } from './state.js'
import { BUILDING_TERRAIN, terrainAt } from './terrain.js'
import type { Terrain } from './terrain.js'

/** The Building Program marker (Wisdom and Warfare p. 7), as `city-production.ts` names it. */
export const BUILDING_PROGRAM_ASSET_ID = 'markers/Building Program'

/** What a build creates. Parts 3 and 4 add `figure` and `unit` kinds to this union. */
export type BuildItem = { readonly kind: 'building'; readonly assetId: string }

/** A map square as column and row numbers, zero based from the map's top left corner. */
export interface BuildTarget {
  readonly column: number
  readonly row: number
}

/** What the `build` assisted action carries. */
export interface BuildPayload {
  readonly cityPieceId: string
  readonly item: BuildItem
  readonly target: BuildTarget
  /**
   * The player agrees to pay trade for the missing production. Needed exactly
   * when the choice has `tradeToPay` above 0; with nothing to pay it changes nothing.
   */
  readonly rush?: boolean
}

export interface BuildSquare extends BuildTarget {
  /** The square's label, for example "D5". */
  readonly label: string
}

export interface BuildChoice {
  readonly assetId: string
  readonly label: string
  /** Production the building costs. */
  readonly cost: number
  /** Trade the player pays to cover what the city's production lacks. 0 when the production is enough. */
  readonly tradeToPay: number
  /** Every square the building may be put on, in reading order. Never empty. */
  readonly squares: readonly BuildSquare[]
}

export interface BuildUnavailable {
  readonly assetId: string
  readonly label: string
  /** A plain sentence, ready to show. */
  readonly reason: string
}

/** Where the production figure comes from; `building-program` is the doubled outskirts of a city with the marker. */
export type BuildProductionSource = 'override' | 'building-program' | 'estimate'

export interface CityBuildOptions {
  readonly cityPieceId: string
  /** For example "Capital D5", as the production figure labels it. */
  readonly label: string
  /** `wrong-phase` outside the player's open City Management phase; `reason` says why. */
  readonly status: 'ready' | 'wrong-phase'
  readonly reason: string
  /** The production the city has to build with. */
  readonly production: number
  readonly productionSource: BuildProductionSource
  /** Empty unless `status` is `ready`. */
  readonly choices: readonly BuildChoice[]
  /** Empty unless `status` is `ready`. */
  readonly unavailable: readonly BuildUnavailable[]
}

// ---------------------------------------------------------------------------
// Rush
// ---------------------------------------------------------------------------

/** Base rules p. 15: every 3 trade lowers the shortfall by 1 production. */
export const TRADE_PER_RUSH_STEP = 3

const AMERICANS = 'Americans'

/**
 * The trade it takes to cover a production shortfall. Paid in whole steps of 3
 * and never more than needed. A step is worth 1 production, or 2 for the
 * Americans, so their shortfall is halved and rounded up first (3 missing is 2
 * steps, 6 trade, since one step only covers 2).
 */
export function rushTradeCost(shortfall: number, civilizationName: string | null | undefined): number {
  if (!Number.isFinite(shortfall) || shortfall <= 0) return 0
  const perStep = civilizationName === AMERICANS ? 2 : 1
  return Math.ceil(shortfall / perStep) * TRADE_PER_RUSH_STEP
}

// ---------------------------------------------------------------------------
// The board, read once
// ---------------------------------------------------------------------------

const PIECE_COLOURS = ['blue', 'green', 'purple', 'red', 'yellow'] as const

const keyOf = (cell: Cell): string => `${cell.column},${cell.row}`

const squareLabel = (cell: Cell): string => `${columnLabel(cell.column)}${cell.row + 1}`

/** The centre of a map square in board coordinates: where a building is put. */
export function squareCentre(board: Board, cell: Cell): { readonly x: number; readonly y: number } {
  return {
    x: (cell.column + 0.5) * board.squareSize,
    y: mapTop(board) + (cell.row + 0.5) * board.squareSize,
  }
}

interface Scene {
  readonly state: GameState
  /** Every city centre on the map, of every colour: a metropolis has two. */
  readonly centres: ReadonlySet<string>
  /** The label of what stands on a square and keeps a building off it: a building, a wonder, a Great Person or a city-state. */
  readonly occupiers: ReadonlyMap<string, string>
  /** The terrain of each square asked about, so the sixteen buildings of a city do not each search the board. */
  readonly terrain: Map<string, Terrain | null>
}

function sceneOf(state: GameState): Scene {
  const centres = new Set<string>()
  for (const colour of PIECE_COLOURS) {
    for (const footprint of cityFootprintsOf(state, colour)) {
      for (const centre of footprint.centers) centres.add(keyOf(centre))
    }
  }
  const occupiers = new Map<string, string>()
  for (const piece of state.board.pieces) {
    if (
      piece.category !== 'building' &&
      piece.category !== 'wonder' &&
      piece.category !== 'greatperson' &&
      piece.category !== 'citystate'
    ) {
      continue
    }
    const cell = mapCellOf(state.board, piece)
    if (cell !== null && !occupiers.has(keyOf(cell))) occupiers.set(keyOf(cell), piece.label)
  }
  return { state, centres, occupiers, terrain: new Map() }
}

function terrainOf(scene: Scene, cell: Cell): Terrain | null {
  const key = keyOf(cell)
  const known = scene.terrain.get(key)
  if (known !== undefined) return known
  const centre = squareCentre(scene.state.board, cell)
  const found = terrainAt(scene.state.board, centre.x, centre.y)
  scene.terrain.set(key, found)
  return found
}

// ---------------------------------------------------------------------------
// Squares
// ---------------------------------------------------------------------------

type SquareProblem =
  | { readonly kind: 'centre' }
  | { readonly kind: 'occupied'; readonly by: string }
  | { readonly kind: 'blockaded' }
  | { readonly kind: 'unknown-terrain' }
  | { readonly kind: 'wrong-terrain'; readonly terrain: Terrain }

/**
 * Why a building cannot go on a map square, or `undefined` when it can. The
 * order is the order the reasons are given in: something that makes the square
 * unusable for every building comes before the terrain, which is about this one.
 */
function squareProblem(
  scene: Scene,
  footprint: CityFootprintView,
  assetId: string,
  cell: Cell,
): SquareProblem | undefined {
  if (scene.centres.has(keyOf(cell))) return { kind: 'centre' }
  const by = scene.occupiers.get(keyOf(cell))
  if (by !== undefined) return { kind: 'occupied', by }
  // Base rules p. 27: a building cannot be placed in a blockaded square
  if (footprint.hasEnemyFigureAt(cell)) return { kind: 'blockaded' }
  const terrain = terrainOf(scene, cell)
  if (terrain === null) return { kind: 'unknown-terrain' }
  const allowed = BUILDING_TERRAIN[assetId] ?? []
  if (!allowed.includes(terrain)) return { kind: 'wrong-terrain', terrain }
  return undefined
}

const describeAllowed = (allowed: readonly Terrain[]): string =>
  allowed.length === 4 && !allowed.includes('water') ? 'any terrain except water' : allowed.join(' or ')

/** The squares of a city's outskirts that are on the map, in reading order. A city at the edge has outskirts off the map, which are not squares at all. */
function mapOutskirts(board: Board, footprint: CityFootprintView): readonly Cell[] {
  return footprint.outskirts
    .filter((cell) => isMapCell(board, cell.column, cell.row))
    .sort((a, b) => a.row - b.row || a.column - b.column)
}

function describeProblem(cell: Cell, assetId: string, problem: SquareProblem): string {
  const square = squareLabel(cell)
  switch (problem.kind) {
    case 'centre':
      return `${square} is a city centre.`
    case 'occupied':
      return `${square} is already taken: ${problem.by} stands there.`
    case 'blockaded':
      return `${square} is blockaded by an enemy figure.`
    case 'unknown-terrain':
      return `The terrain of ${square} is not known.`
    case 'wrong-terrain':
      return `${square} is ${problem.terrain}, and a ${buildingNameOf(assetId) ?? 'building'} needs ${describeAllowed(BUILDING_TERRAIN[assetId] ?? [])}.`
  }
}

const plural = (count: number, singular: string, many: string): string =>
  `${count} ${count === 1 ? singular : many}`

/** The reason a building has no legal square at all, counted by kind. */
function noSquareReason(assetId: string, problems: readonly SquareProblem[]): string {
  if (problems.length === 0) return 'The city has no outskirts square on the map.'
  const count = (kind: SquareProblem['kind']): number => problems.filter((problem) => problem.kind === kind).length
  const parts: string[] = []
  const wrong = count('wrong-terrain')
  const taken = count('occupied')
  const blockaded = count('blockaded')
  const unknown = count('unknown-terrain')
  const centres = count('centre')
  if (wrong > 0) parts.push(`${plural(wrong, 'square has', 'squares have')} the wrong terrain`)
  if (taken > 0) parts.push(`${plural(taken, 'square is', 'squares are')} taken`)
  if (blockaded > 0) parts.push(`${plural(blockaded, 'square is', 'squares are')} blockaded`)
  if (unknown > 0) parts.push(`${plural(unknown, 'square has', 'squares have')} unknown terrain`)
  if (centres > 0) parts.push(`${plural(centres, 'square is', 'squares are')} a city centre`)
  const needs = describeAllowed(BUILDING_TERRAIN[assetId] ?? [])
  return `No legal square. A ${buildingNameOf(assetId) ?? 'building'} needs ${needs}: ${parts.join(', ')}.`
}

/**
 * Why `cell` is not a legal square for the building in this city, as a sentence,
 * or `undefined` when it is legal (or the city is not the player's). The action
 * uses it to say what changed when a square was taken in between.
 */
export function buildSquareRefusal(
  state: GameState,
  player: Playerhand,
  cityPieceId: string,
  assetId: string,
  cell: Cell,
): string | undefined {
  if (player.color === null) return undefined
  const footprint = cityFootprintsOf(state, player.color.toLowerCase()).find(
    (candidate) => candidate.piece.id === cityPieceId,
  )
  if (footprint === undefined) return undefined
  // A label only for a plain square: the engine is called with whatever a client sent, and a label of a huge column is a long loop
  const plain = (value: number): boolean => Number.isInteger(value) && value >= 0 && value < 1000
  const square = plain(cell.column) && plain(cell.row) ? squareLabel(cell) : 'That square'
  if (!isMapCell(state.board, cell.column, cell.row)) return `${square} is not on the map.`
  if (!footprint.outskirts.some((candidate) => keyOf(candidate) === keyOf(cell))) {
    return `${square} is not in the outskirts of that city.`
  }
  const problem = squareProblem(sceneOf(state), footprint, assetId, cell)
  return problem === undefined ? undefined : describeProblem(cell, assetId, problem)
}

// ---------------------------------------------------------------------------
// The options
// ---------------------------------------------------------------------------

/** The production a city builds with: the hand set number, else the Building Program figure, else the estimate. */
function productionOf(city: CityProduction): { readonly value: number; readonly source: BuildProductionSource } {
  if (city.override !== null) return { value: city.override, source: 'override' }
  if (city.withBuildingProgram !== null) return { value: city.withBuildingProgram, source: 'building-program' }
  return { value: city.estimate, source: 'estimate' }
}

const SOURCE_TEXT: Readonly<Record<BuildProductionSource, string>> = {
  override: 'the number you set by hand',
  'building-program': 'doubled by the Building Program',
  estimate: 'the estimate',
}

interface TechView {
  readonly revealed: ReadonlySet<string>
  readonly hidden: ReadonlySet<string>
}

function techViewOf(player: Playerhand): TechView {
  const revealed = new Set<string>()
  const hidden = new Set<string>()
  for (const tech of player.techsChosen) (tech.hidden ? hidden : revealed).add(tech.name)
  return { revealed, hidden }
}

const isUnlocked = (techs: TechView, assetId: string): boolean =>
  techsUnlocking(assetId).some((tech) => techs.revealed.has(tech))

function unlockReason(techs: TechView, assetId: string): string {
  const needed = techsUnlocking(assetId)
  const waiting = needed.filter((tech) => techs.hidden.has(tech))
  return waiting.length > 0
    ? `Needs ${needed.join(' or ')}. ${waiting.join(' and ')} is chosen but not revealed yet.`
    : `Needs ${needed.join(' or ')}.`
}

/** The first limited building standing in the city's outskirts, whoever's it is. */
function limitedBuildingIn(scene: Scene, outskirts: readonly Cell[]): string | undefined {
  const keys = new Set(outskirts.map(keyOf))
  const found = scene.state.board.pieces.find((piece) => {
    if (piece.category !== 'building' || !LIMITED_BUILDINGS.has(piece.assetId)) return false
    const cell = mapCellOf(scene.state.board, piece)
    return cell !== null && keys.has(keyOf(cell))
  })
  return found === undefined ? undefined : (buildingNameOf(found.assetId) ?? found.label)
}

function optionsForCity(
  scene: Scene,
  player: Playerhand,
  footprint: CityFootprintView,
  city: CityProduction,
  open: boolean,
): CityBuildOptions {
  const production = productionOf(city)
  const base = {
    cityPieceId: city.pieceId,
    label: city.label,
    production: production.value,
    productionSource: production.source,
  }
  if (!open) {
    return { ...base, status: 'wrong-phase', reason: PHASE_REASON, choices: [], unavailable: [] }
  }

  const { state } = scene
  const techs = techViewOf(player)
  const outskirts = mapOutskirts(state.board, footprint)
  const limited = limitedBuildingIn(scene, outskirts)
  const choices: BuildChoice[] = []
  const unavailable: BuildUnavailable[] = []

  for (const { assetId, label } of BUILDABLE_BUILDINGS) {
    const skip = (reason: string): void => {
      unavailable.push({ assetId, label, reason })
    }

    const upgrade = BUILDING_UPGRADES[assetId]
    if (upgrade !== undefined && isUnlocked(techs, upgrade)) {
      skip(`Replaced by the ${buildingNameOf(upgrade) ?? 'upgraded building'}, which you have unlocked. Only the upgraded form can be built now.`)
      continue
    }
    if (!isUnlocked(techs, assetId)) {
      skip(unlockReason(techs, assetId))
      continue
    }

    const asset = findBoardAsset(assetId)
    const data = buildingDataOf(assetId)
    if (asset === undefined || data === undefined) {
      skip('This building is not in the game data.')
      continue
    }
    const remaining = remainingBoardAssetCount(asset, state.board.pieces, state.numOfPlayers)
    if (remaining !== undefined && remaining <= 0) {
      const shared = assetId in BUILDING_UPGRADES || Object.values(BUILDING_UPGRADES).includes(assetId)
      skip(
        `None left in the supply: all ${boardAssetLimit(asset, state.numOfPlayers) ?? 0} are on the board` +
          (shared ? ' (the basic and the upgraded form share one supply).' : '.'),
      )
      continue
    }
    if (LIMITED_BUILDINGS.has(assetId) && limited !== undefined) {
      skip(
        `${city.label} already has a ${limited}. A city may hold only one of Market, Bank, Temple, Cathedral, Barracks and Academy.`,
      )
      continue
    }

    const squares: BuildSquare[] = []
    const problems: SquareProblem[] = []
    for (const cell of outskirts) {
      const problem = squareProblem(scene, footprint, assetId, cell)
      if (problem === undefined) squares.push({ column: cell.column, row: cell.row, label: squareLabel(cell) })
      else problems.push(problem)
    }
    if (squares.length === 0) {
      skip(noSquareReason(assetId, problems))
      continue
    }

    const shortfall = Math.max(0, data.cost - production.value)
    const tradeToPay = rushTradeCost(shortfall, player.civilization?.name)
    if (tradeToPay > player.stats.trade) {
      skip(
        `Costs ${data.cost} production and ${city.label} has ${production.value} (${SOURCE_TEXT[production.source]}). ` +
          `Covering the missing ${shortfall} takes ${tradeToPay} trade and you have ${player.stats.trade}. ` +
          'If the city makes more than that, set its production by hand on the city.',
      )
      continue
    }
    choices.push({ assetId, label, cost: data.cost, tradeToPay, squares })
  }

  return { ...base, status: 'ready', reason: 'Ready to build.', choices, unavailable }
}

/**
 * One entry per city of the player on the map, in board order. Empty for a
 * player without a colour or a city. The viewer's own view only: it reads
 * unrevealed techs to say what is "chosen but not revealed yet".
 */
export function buildOptionsOf(state: GameState, player: Playerhand): readonly CityBuildOptions[] {
  if (player.color === null) return []
  const footprints = cityFootprintsOf(state, player.color.toLowerCase())
  if (footprints.length === 0) return []

  const productions = cityProductionsOf(state, player)
  const open = openCityManagementTurn(state, player) !== undefined
  const scene = sceneOf(state)
  return footprints.flatMap((footprint) => {
    const city = productions.find((candidate) => candidate.pieceId === footprint.piece.id)
    return city === undefined ? [] : [optionsForCity(scene, player, footprint, city, open)]
  })
}
