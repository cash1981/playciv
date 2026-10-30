/**
 * What a player can build with each of their cities (assisted Build, parts 2 to 4
 * of #264: buildings, army and scout figures, and military units; and wonders from
 * the market).
 *
 * For every city on the map: whether the player may build now, the production the
 * city has, and what can be built split in two lists. `choices` holds only items
 * that can be built right now: a building or a figure with the legal squares, a
 * unit with none (it is a private card), each with any trade to pay; `unavailable`
 * holds every other known item with a plain reason, so the picker can explain
 * itself and nothing is hidden by silence.
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

import { PHASE_REASON, openCityManagementTurn } from './assisted-core.js'
import { UNIT_TYPES, unitLevelFromTechs } from './build-item.js'
import type { BuildItem, PlacedBuildItem, SquarelessBuildItem, UnitType } from './build-item.js'
import { cityFootprintsOf, cityStateHolderColour, mapCellOf, pieceColorOf } from './blockade.js'
import type { Cell, CityFootprintView } from './blockade.js'
import {
  BUILDABLE_BUILDINGS,
  BUILDING_UPGRADES,
  LIMITED_BUILDINGS,
  buildingDataOf,
  buildingNameOf,
  techsUnlocking,
} from './building-data.js'
import {
  WHITE_ARMY_ID,
  boardAssetLimit,
  columnLabel,
  findBoardAsset,
  isInWondersArea,
  isMapCell,
  mapTop,
  remainingBoardAssetCount,
} from './board.js'
import type { Board, BoardPiece } from './board.js'
import { cityProductionsOf } from './city-production.js'
import type { CityProduction } from './city-production.js'
import { SHUFFLABLE_ITEMS } from './sheet-name.js'
import type { SheetName } from './sheet-name.js'
import type { GameState, Playerhand } from './state.js'
import { BUILDING_TERRAIN, CATEGORY_TERRAIN, describeAllowed, terrainAt } from './terrain.js'
import type { Terrain } from './terrain.js'
import { wonderCostFor, wonderDataOf } from './wonder-data.js'
import { stackingLimitOf } from './great-person-effects.js'
import { capitalOf } from './sot.js'

/** A map square as column and row numbers, zero based from the map's top left corner. */
export interface BuildTarget {
  readonly column: number
  readonly row: number
}

interface BuildPayloadBase {
  readonly cityPieceId: string
  /**
   * The player agrees to pay trade for the missing production. Needed exactly
   * when the choice has `tradeToPay` above 0; with nothing to pay it changes nothing.
   */
  readonly rush?: boolean
}

/**
 * What the `build` assisted action carries. A building or a figure needs the
 * square it goes on; a unit and City Walls have none, and a target sent with one is refused.
 */
export type BuildPayload =
  | (BuildPayloadBase & { readonly item: PlacedBuildItem; readonly target: BuildTarget })
  | (BuildPayloadBase & { readonly item: SquarelessBuildItem; readonly target?: undefined })

/** What a building or wonder put on a square takes the place of (base rules p. 17, and p. 18 for a Great Person, which goes back to the player's area). */
export interface ReplacedPiece {
  readonly assetId: string
  /** "Library", "The Colossus", "Artist": the name the log uses. */
  readonly label: string
  readonly kind: 'building' | 'wonder' | 'greatperson'
}

export interface BuildSquare extends BuildTarget {
  /** The square's label, for example "D5". */
  readonly label: string
  /** Something to tell the player about this square before they pick it: an army put in a square where an enemy figure stands, which is not automated, or the building or wonder the item replaces. Absent for a plain square. */
  readonly note?: string
  /** The player's own building, wonder or Great Person on the square, which the item replaces: it is taken off the square first. Absent for an empty square and for a figure. */
  readonly replaces?: ReplacedPiece
}

export interface BuildChoice {
  /**
   * A stable key for lists: the asset id of a building or a figure (the figure's
   * is of the player's colour), `units/<type>` for a unit, which has no asset, and `walls` for City Walls.
   * Send `item` back to the action, never this.
   */
  readonly assetId: string
  /** What the choice builds, in the shape the `build` payload takes. */
  readonly item: BuildItem
  /** `square` for a building or a figure, which the player puts on a highlighted square; `none` for a unit, which is a private card, and for City Walls, which turn the city marker over. */
  readonly placement: 'square' | 'none'
  readonly label: string
  /** Production the item costs. */
  readonly cost: number
  /** Only for a wonder with a discount: the other price, for example "15 without Metalworking". Shown next to the cost so the player sees why it is what it is. */
  readonly costNote?: string
  /** Trade the player pays to cover what the city's production lacks. 0 when the production is enough. */
  readonly tradeToPay: number
  /** Every square the item may be put on, in reading order. Never empty when `placement` is `square`, always empty when it is `none`. */
  readonly squares: readonly BuildSquare[]
}

export interface BuildUnavailable {
  /** The same key as `BuildChoice.assetId`. */
  readonly assetId: string
  readonly item: BuildItem
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

const keyOf = (cell: Cell): string => `${cell.column},${cell.row}`

/** A map square's label, for example "D5". */
export const squareLabel = (cell: Cell): string => `${columnLabel(cell.column)}${cell.row + 1}`

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
  /** What stands on each square: buildings, wonders, Great People and city-states. A building, wonder or Great Person can be replaced by a new building or wonder; a city-state keeps it off. */
  readonly standing: ReadonlyMap<string, readonly BoardPiece[]>
  /** The squares of city-states, which keep a figure off as well. */
  readonly cityStates: ReadonlySet<string>
  /** "hut" or "village" for each square holding such a marker. */
  readonly markers: ReadonlyMap<string, string>
  /** Every figure on the map, by square. */
  readonly figures: ReadonlyMap<string, readonly BoardPiece[]>
  /** The terrain of each square asked about, so the sixteen buildings of a city do not each search the board. */
  readonly terrain: Map<string, Terrain | null>
}

/** The resource markers that stand for a hut and a village on the map. */
const HUT_ASSET_ID = 'resources/hut'
const VILLAGE_ASSET_ID = 'resources/village'

function sceneOf(state: GameState): Scene {
  const centres = new Set<string>()
  // The colours come off the pieces, so no list of player colours is kept here
  const colours = new Set<string>()
  for (const piece of state.board.pieces) {
    const colour = piece.category === 'city' ? pieceColorOf(piece) : undefined
    if (colour !== undefined) colours.add(colour)
  }
  for (const colour of colours) {
    for (const footprint of cityFootprintsOf(state, colour)) {
      for (const centre of footprint.centers) centres.add(keyOf(centre))
    }
  }
  const standing = new Map<string, BoardPiece[]>()
  const cityStates = new Set<string>()
  const markers = new Map<string, string>()
  const figures = new Map<string, BoardPiece[]>()
  for (const piece of state.board.pieces) {
    const marker =
      piece.assetId === HUT_ASSET_ID ? 'hut' : piece.assetId === VILLAGE_ASSET_ID ? 'village' : undefined
    if (
      piece.category !== 'building' &&
      piece.category !== 'wonder' &&
      piece.category !== 'greatperson' &&
      piece.category !== 'citystate' &&
      piece.category !== 'figure' &&
      marker === undefined
    ) {
      continue
    }
    const cell = mapCellOf(state.board, piece)
    if (cell === null) continue
    const key = keyOf(cell)
    if (piece.category === 'figure') {
      figures.set(key, [...(figures.get(key) ?? []), piece])
    } else if (marker !== undefined) {
      if (!markers.has(key)) markers.set(key, marker)
    } else {
      if (piece.category === 'citystate') cityStates.add(key)
      standing.set(key, [...(standing.get(key) ?? []), piece])
    }
  }
  return { state, centres, standing, cityStates, markers, figures, terrain: new Map() }
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
  /** A wonder of another player's: only a player's own building or wonder may be replaced. */
  | { readonly kind: 'foreign'; readonly by: string }
  /** The city already has its one wonder or limited building, and a new one may only replace that. */
  | { readonly kind: 'limit'; readonly what: string; readonly holder: string }
  | { readonly kind: 'blockaded' }
  | { readonly kind: 'unknown-terrain' }
  | { readonly kind: 'wrong-terrain'; readonly terrain: Terrain; readonly name: string; readonly allowed: readonly Terrain[] }
  | { readonly kind: 'city-state' }
  | { readonly kind: 'marker'; readonly marker: string }
  | { readonly kind: 'water' }
  | { readonly kind: 'full'; readonly count: number; readonly limit: number }

/** Where a building or wonder may go on a square: nowhere (the problem), or there, taking the place of `replaces` when something of the player's stands on it. */
type Placement = { readonly problem: SquareProblem } | { readonly replaces?: BoardPiece }

/**
 * Whether a building or wonder can go on a map square and what it takes the place of. The
 * order is the order the reasons are given in: something that makes the square unusable
 * for every building comes before the terrain, which is about this one. A square with a
 * building, wonder or Great Person of the player's own is usable (base rules p. 17 and 18: it is
 * replaced, if the new piece can stand there once the old one is gone); a city-state or another
 * player's wonder keeps it off.
 */
function placementOf(
  scene: Scene,
  footprint: CityFootprintView,
  rules: PlacementRules,
  cell: Cell,
  playerId: string,
): Placement {
  if (scene.centres.has(keyOf(cell))) return { problem: { kind: 'centre' } }
  const standing = scene.standing.get(keyOf(cell)) ?? []
  const blocker = standing.find((piece) => piece.category === 'citystate')
  // One piece is replaced; old data with two on a square is left alone
  if (blocker !== undefined || standing.length > 1) {
    return { problem: { kind: 'occupied', by: (blocker === undefined ? standing : [blocker]).map((piece) => piece.label).join(' and ') } }
  }
  const here = standing[0]
  if (here?.category === 'wonder' && here.ownerId !== undefined && here.ownerId !== null && here.ownerId !== playerId) {
    return { problem: { kind: 'foreign', by: here.label } }
  }
  // Base rules p. 27: buildings and wonders cannot be placed in a blockaded square
  if (footprint.hasEnemyFigureAt(cell)) return { problem: { kind: 'blockaded' } }
  const terrain = terrainOf(scene, cell)
  if (terrain === null) return { problem: { kind: 'unknown-terrain' } }
  if (!rules.allowed.includes(terrain)) {
    return { problem: { kind: 'wrong-terrain', terrain, name: rules.name, allowed: rules.allowed } }
  }
  return here === undefined ? {} : { replaces: here }
}

/** The name a building, wonder or Great Person goes by in a sentence: "Library", "The Colossus", "Artist". */
const pieceNameOf = (piece: BoardPiece): string =>
  piece.category === 'building' ? (buildingNameOf(piece.assetId) ?? piece.label) : piece.label

/** What a square tells the player when the new piece replaces one of theirs. */
function replaceNoteOf(piece: BoardPiece): string {
  if (piece.category === 'wonder') {
    return `Replaces ${pieceNameOf(piece).replace(/^The /, 'the ')}, which is destroyed and cannot be built again for the rest of the game.`
  }
  if (piece.category === 'greatperson') {
    return `Replaces your ${pieceNameOf(piece)} (Great Person), which goes back to your player area and can be placed again at the start of a turn.`
  }
  return `Replaces your ${pieceNameOf(piece)}, which is taken off the board and goes back to the supply.`
}

function squareOf(cell: Cell, replaces: BoardPiece | undefined): BuildSquare {
  const base = { column: cell.column, row: cell.row, label: squareLabel(cell) }
  if (replaces === undefined) return base
  return {
    ...base,
    note: replaceNoteOf(replaces),
    replaces: {
      assetId: replaces.assetId,
      label: pieceNameOf(replaces),
      kind: replaces.category === 'wonder' ? 'wonder' : replaces.category === 'greatperson' ? 'greatperson' : 'building',
    },
  }
}

/**
 * The wonder or limited building a city already holds, when the item is one of those: a city may
 * hold only one of each, so a new one can only take its place.
 */
interface OnlyReplacing {
  readonly piece: BoardPiece
  /** "wonder" or "limited building": the noun the reasons use. */
  readonly what: string
}

/** The squares an item may go on, each with what it replaces, and the reason for every other square of the outskirts. */
function placedSquaresOf(
  scene: Scene,
  footprint: CityFootprintView,
  rules: PlacementRules,
  outskirts: readonly Cell[],
  playerId: string,
  only: OnlyReplacing | undefined,
): { readonly squares: readonly BuildSquare[]; readonly problems: ReadonlyMap<string, SquareProblem> } {
  const squares: BuildSquare[] = []
  const problems = new Map<string, SquareProblem>()
  for (const cell of outskirts) {
    const placement = placementOf(scene, footprint, rules, cell, playerId)
    if ('problem' in placement) {
      problems.set(keyOf(cell), placement.problem)
    } else if (only !== undefined && placement.replaces?.id !== only.piece.id) {
      // The city already has its one wonder or limited building: a new one may only take its place
      problems.set(keyOf(cell), { kind: 'limit', what: only.what, holder: pieceNameOf(only.piece) })
    } else {
      squares.push(squareOf(cell, placement.replaces))
    }
  }
  return { squares, problems }
}

/** What decides where a building or a wonder may stand: the terrains, and the noun the reasons use. */
interface PlacementRules {
  /** "Library", "wonder": follows "a" in the reasons. */
  readonly name: string
  readonly allowed: readonly Terrain[]
}

/** A building has its own terrain; every wonder goes on any terrain but water (base rules p. 17). */
function placementRulesOf(item: { readonly kind: 'building' | 'wonder'; readonly assetId: string }): PlacementRules {
  return item.kind === 'wonder'
    ? { name: 'wonder', allowed: CATEGORY_TERRAIN.wonder ?? [] }
    : { name: buildingNameOf(item.assetId) ?? 'building', allowed: BUILDING_TERRAIN[item.assetId] ?? [] }
}

/** The techs that let a figure end its movement in water (base rules p. 15; `techText.ts`). */
export const WATER_TECHS: readonly string[] = ['Sailing', 'Steam Power', 'Flight']

/** What the figure rules need to know about the player, read once. */
interface FigureRules {
  readonly kind: 'army' | 'scout'
  /** Lower case, as `pieceColorOf` gives it. */
  readonly colour: string
  /** The Russian player's white army stands with their own figures. */
  readonly russian: boolean
  /** Total figures, armies and scouts together, that may share a square (`stats.stacking`). */
  readonly stacking: number
  /** A revealed Sailing, Steam Power or Flight. */
  readonly water: boolean
}

const RUSSIANS = 'Russians'

function figureRulesOf(
  state: GameState,
  player: Playerhand,
  kind: 'army' | 'scout',
  techs: TechView,
): FigureRules | undefined {
  if (player.color === null) return undefined
  return {
    kind,
    colour: player.color.toLowerCase(),
    russian: player.civilization?.name === RUSSIANS,
    stacking: stackingLimitOf(state, player),
    water: WATER_TECHS.some((tech) => techs.revealed.has(tech)),
  }
}

const isFriendlyFigure = (piece: BoardPiece, rules: FigureRules): boolean =>
  pieceColorOf(piece) === rules.colour || (rules.russian && piece.assetId === WHITE_ARMY_ID)

/**
 * Why an army or a scout cannot be put on a map square, or `undefined` when it
 * can. Blockade is the one rule that differs: a scout is refused, an army is
 * allowed (the caller flags it with `enemyFigureNoteOf`).
 */
function figureSquareProblem(
  scene: Scene,
  footprint: CityFootprintView,
  rules: FigureRules,
  cell: Cell,
  held: ReadonlySet<string>,
): SquareProblem | undefined {
  const key = keyOf(cell)
  if (scene.centres.has(key)) return { kind: 'centre' }
  if (scene.cityStates.has(key) && !held.has(key)) return { kind: 'city-state' }
  // Base rules p. 15, 19: scouts cannot enter such a square. What an army does there is not in the rulebook, so Build leaves it to the player
  const marker = scene.markers.get(key)
  if (marker !== undefined) return { kind: 'marker', marker }
  const terrain = terrainOf(scene, cell)
  if (terrain === null) return { kind: 'unknown-terrain' }
  if (terrain === 'water' && !rules.water) return { kind: 'water' }
  const count = (scene.figures.get(key) ?? []).filter((piece) => isFriendlyFigure(piece, rules)).length
  if (count >= rules.stacking) return { kind: 'full', count, limit: rules.stacking }
  // Base rules p. 27: a scout cannot be placed in a blockaded square
  if (rules.kind === 'scout' && footprint.hasEnemyFigureAt(cell)) return { kind: 'blockaded' }
  return undefined
}

/**
 * An army put in a square where an enemy figure stands. The rulebook settles what
 * happens when an army moves there (loot from scouts, a battle against an army) but
 * not placement by production, so Build does not decide the outcome: it only says
 * so. Battles and loot are not automated.
 */
const ENEMY_FIGURE_NOTE = 'An enemy figure stands here. Placing the army here is not automated: resolve any battle or loot by hand.'

const enemyFigureNoteOf = (footprint: CityFootprintView, rules: FigureRules, cell: Cell): string | undefined =>
  rules.kind === 'army' && footprint.hasEnemyFigureAt(cell) ? ENEMY_FIGURE_NOTE : undefined

/** The squares of a city's outskirts that are on the map, in reading order. A city at the edge has outskirts off the map, which are not squares at all. */
function mapOutskirts(board: Board, footprint: CityFootprintView): readonly Cell[] {
  return footprint.outskirts
    .filter((cell) => isMapCell(board, cell.column, cell.row))
    .sort((a, b) => a.row - b.row || a.column - b.column)
}

/**
 * The squares of the city-states the player holds when the city is their capital (a metropolis
 * counts), else none. A held city-state is part of the capital's outskirts (W&W p. 9, issue
 * #319), so a figure may be built there; buildings and wonders still may not. Holding is
 * `cityStateHolderColour`, as for Brandenburg Gate.
 */
function heldCityStatesOf(scene: Scene, player: Playerhand, footprint: CityFootprintView, colour: string): readonly Cell[] {
  if (capitalOf(scene.state, player)?.id !== footprint.piece.id) return []
  const cells: Cell[] = []
  for (const piece of scene.state.board.pieces) {
    if (piece.category !== 'citystate') continue
    const cell = mapCellOf(scene.state.board, piece)
    if (cell !== null && cityStateHolderColour(scene.state, piece) === colour) cells.push(cell)
  }
  return cells
}

/** Where a city may put a figure: its outskirts on the map and the city-states held by a capital, in reading order. */
function figureSquaresOf(
  scene: Scene,
  player: Playerhand,
  footprint: CityFootprintView,
  colour: string,
): { readonly cells: readonly Cell[]; readonly held: ReadonlySet<string> } {
  const outskirts = mapOutskirts(scene.state.board, footprint)
  const held = heldCityStatesOf(scene, player, footprint, colour)
  const known = new Set(outskirts.map(keyOf))
  const cells = [...outskirts, ...held.filter((cell) => !known.has(keyOf(cell)))]
    .sort((a, b) => a.row - b.row || a.column - b.column)
  return { cells, held: new Set(held.map(keyOf)) }
}

const WATER_TECH_TEXT = 'a revealed Sailing, Steam Power or Flight'

function describeProblem(cell: Cell, problem: SquareProblem): string {
  const square = squareLabel(cell)
  switch (problem.kind) {
    case 'centre':
      return `${square} is a city centre.`
    case 'occupied':
      return `${square} is already taken: ${problem.by} stands there.`
    case 'foreign':
      return `${square} holds ${problem.by}, which belongs to another player and cannot be replaced.`
    case 'limit':
      return `${square} cannot be used: ${problem.holder} is the city's one ${problem.what}, and a new one can only replace it.`
    case 'blockaded':
      return `${square} is blockaded by an enemy figure.`
    case 'unknown-terrain':
      return `The terrain of ${square} is not known.`
    case 'wrong-terrain':
      return `${square} is ${problem.terrain}, and a ${problem.name} needs ${describeAllowed(problem.allowed)}.`
    case 'city-state':
      return `${square} is a city-state square.`
    case 'marker':
      return `${square} has a ${problem.marker} marker. The rules do not say how a figure is placed there, so Build leaves it to you: place the figure by hand.`
    case 'water':
      return `${square} is water, and a figure may stand in water only with ${WATER_TECH_TEXT}.`
    case 'full':
      if (problem.limit <= 0) return `${square} cannot hold a figure: your stacking limit is ${problem.limit}.`
      return `${square} already holds ${problem.count} of your figures, which is your stacking limit of ${problem.limit}.`
  }
}

const plural = (count: number, singular: string, many: string): string =>
  `${count} ${count === 1 ? singular : many}`

/** The reason an item has no legal square at all, counted by kind. `intro` ends the lead sentence, for example "A Library needs grassland". */
function noSquareReason(intro: string | null, problems: readonly SquareProblem[]): string {
  if (problems.length === 0) return 'The city has no outskirts square on the map.'
  const count = (kind: SquareProblem['kind']): number => problems.filter((problem) => problem.kind === kind).length
  const parts: string[] = []
  const wrong = count('wrong-terrain')
  const taken = count('occupied')
  const foreign = count('foreign')
  const limit = problems.find((problem) => problem.kind === 'limit')
  const limited = count('limit')
  const blockaded = count('blockaded')
  const unknown = count('unknown-terrain')
  const centres = count('centre')
  const cityStates = count('city-state')
  const markers = count('marker')
  const water = count('water')
  const full = count('full')
  if (wrong > 0) parts.push(`${plural(wrong, 'square has', 'squares have')} the wrong terrain`)
  if (taken > 0) parts.push(`${plural(taken, 'square is', 'squares are')} taken`)
  if (foreign > 0) parts.push(`${plural(foreign, 'square holds', 'squares hold')} another player's wonder, which cannot be replaced`)
  if (limited > 0 && limit?.kind === 'limit') {
    parts.push(`${plural(limited, 'square is', 'squares are')} not allowed because the city already has its one ${limit.what}, ${limit.holder}, which a new one can only replace`)
  }
  if (blockaded > 0) parts.push(`${plural(blockaded, 'square is', 'squares are')} blockaded`)
  if (unknown > 0) parts.push(`${plural(unknown, 'square has', 'squares have')} unknown terrain`)
  if (centres > 0) parts.push(`${plural(centres, 'square is', 'squares are')} a city centre`)
  if (cityStates > 0) parts.push(`${plural(cityStates, 'square is', 'squares are')} a city-state`)
  if (markers > 0) parts.push(`${plural(markers, 'square has', 'squares have')} a hut or village marker, which Build leaves for you to place by hand`)
  if (water > 0) parts.push(`${plural(water, 'square is', 'squares are')} water, which needs ${WATER_TECH_TEXT}`)
  if (full > 0) parts.push(`${plural(full, 'square is', 'squares are')} full to the stacking limit`)
  return `No legal square. ${intro === null ? '' : `${intro}: `}${parts.join(', ')}.`
}

const placementIntro = (rules: PlacementRules): string => `A ${rules.name} needs ${describeAllowed(rules.allowed)}`

/**
 * Why `cell` is not a legal square for the item in this city, as a sentence,
 * or `undefined` when it is legal (or the city is not the player's). The action
 * uses it to say what changed when a square was taken in between.
 */
export function buildSquareRefusal(
  state: GameState,
  player: Playerhand,
  cityPieceId: string,
  item: PlacedBuildItem,
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
  const scene = sceneOf(state)
  const figure = item.kind === 'army' || item.kind === 'scout' ? figureSquaresOf(scene, player, footprint, player.color.toLowerCase()) : undefined
  const inOutskirts = (figure?.cells ?? footprint.outskirts).some((candidate) => keyOf(candidate) === keyOf(cell))
  if (!inOutskirts) return `${square} is not in the outskirts of that city.`
  if (item.kind === 'building' || item.kind === 'wonder') {
    const { problems } = placedSquaresOf(
      scene,
      footprint,
      placementRulesOf(item),
      mapOutskirts(state.board, footprint),
      player.playerId,
      onlyReplacingOf(scene, mapOutskirts(state.board, footprint), item),
    )
    const problem = problems.get(keyOf(cell))
    return problem === undefined ? undefined : describeProblem(cell, problem)
  }
  const rules = figureRulesOf(state, player, item.kind, techViewOf(player))
  if (rules === undefined) return undefined
  const problem = figureSquareProblem(scene, footprint, rules, cell, figure?.held ?? new Set())
  return problem === undefined ? undefined : describeProblem(cell, problem)
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

function needsReason(techs: TechView, needed: readonly string[]): string {
  const waiting = needed.filter((tech) => techs.hidden.has(tech))
  return waiting.length > 0
    ? `Needs ${needed.join(' or ')}. ${waiting.join(' and ')} ${waiting.length === 1 ? 'is' : 'are'} chosen but not revealed yet.`
    : `Needs ${needed.join(' or ')}.`
}

const unlockReason = (techs: TechView, assetId: string): string => needsReason(techs, techsUnlocking(assetId))

/** The first piece of a category (and, for a building, a test) standing in the city's outskirts, whoever's it is. */
function pieceIn(scene: Scene, outskirts: readonly Cell[], wanted: (piece: BoardPiece) => boolean): BoardPiece | undefined {
  const keys = new Set(outskirts.map(keyOf))
  return scene.state.board.pieces.find((piece) => {
    if (!wanted(piece)) return false
    const cell = mapCellOf(scene.state.board, piece)
    return cell !== null && keys.has(keyOf(cell))
  })
}

/** The first limited building standing in the city's outskirts, whoever's it is. */
const limitedBuildingIn = (scene: Scene, outskirts: readonly Cell[]): BoardPiece | undefined =>
  pieceIn(scene, outskirts, (piece) => piece.category === 'building' && LIMITED_BUILDINGS.has(piece.assetId))

/** The first wonder standing in the city's outskirts, whoever's it is: a city holds one. */
const wonderIn = (scene: Scene, outskirts: readonly Cell[]): BoardPiece | undefined =>
  pieceIn(scene, outskirts, (piece) => piece.category === 'wonder')

/**
 * What a new building or wonder may only replace in this city (base rules p. 17: a city holds one
 * wonder and one limited building, and a replaced piece is removed before the new one is placed):
 * the wonder for a wonder, the limited building for a limited one. `undefined` when the city has
 * none, or the item is neither.
 */
function onlyReplacingOf(
  scene: Scene,
  outskirts: readonly Cell[],
  item: { readonly kind: 'building' | 'wonder'; readonly assetId: string },
): OnlyReplacing | undefined {
  if (item.kind === 'wonder') {
    const piece = wonderIn(scene, outskirts)
    return piece === undefined ? undefined : { piece, what: 'wonder' }
  }
  if (!LIMITED_BUILDINGS.has(item.assetId)) return undefined
  const piece = limitedBuildingIn(scene, outskirts)
  return piece === undefined ? undefined : { piece, what: 'limited building' }
}

/** Whether two buildings come from one supply: the basic and the upgraded form of a building share it. */
const sameSupply = (a: string, b: string): boolean =>
  a === b || BUILDING_UPGRADES[a] === b || BUILDING_UPGRADES[b] === a

// ---------------------------------------------------------------------------
// Figures and units
// ---------------------------------------------------------------------------

/** The key of City Walls in a list of choices: it has no asset of its own. */
const WALLS_KEY = 'walls'
/** Masonry lets a player build City Walls for 7 production (the tech card, `techText.ts`). */
const WALLS_TECH = 'Masonry'
const WALLS_COST = 7

/**
 * The asset id of a city marker's walled side (`cities/bluecity2` to `cities/bluecitywalled2`), or
 * `undefined` when the marker is already walled.
 */
export function walledAssetIdOf(cityAssetId: string): string | undefined {
  if (cityAssetId.includes('walled')) return undefined
  // The trailing digits are found by walking back from the end, not by a regular expression, so a long id costs no more than its length
  let digits = cityAssetId.length
  while (digits > 0 && cityAssetId.charCodeAt(digits - 1) >= 48 && cityAssetId.charCodeAt(digits - 1) <= 57) digits -= 1
  return digits === cityAssetId.length ? cityAssetId : `${cityAssetId.slice(0, digits)}walled${cityAssetId.slice(digits)}`
}

/** Base rules p. 15 to 17: an army figure costs 4 production, a scout figure 6. */
const FIGURE_COST = { army: 4, scout: 6 } as const

/** Aircraft always cost 12 and need Flight; the three other units cost by the player's level. */
const AIRCRAFT_COST = 12
const AIRCRAFT_TECH = 'Flight'

const UNIT_SHEET: Readonly<Record<UnitType, SheetName>> = {
  infantry: 'INFANTRY',
  artillery: 'ARTILLERY',
  mounted: 'MOUNTED',
  aircraft: 'AIRCRAFT',
}

/** The deck a unit type is drawn from. */
export const unitSheetOf = (unitType: UnitType): SheetName => UNIT_SHEET[unitType]

/**
 * The level the player has for a unit type, 1 to 4: the higher of the status value
 * in `stats` (hand-set, so a value outside the range or a fraction is read as the
 * nearest level) and the level the revealed techs give. Aircraft have none.
 */
function unitLevelOf(player: Playerhand, unitType: Exclude<UnitType, 'aircraft'>, techs: TechView): number {
  const raw = player.stats[unitType]
  const fromStats = Number.isFinite(raw) ? Math.min(4, Math.max(1, Math.floor(raw))) : 1
  return Math.max(fromStats, unitLevelFromTechs(unitType, techs.revealed))
}

/** Level 1 costs 5, level 2 costs 7, level 3 costs 9, level 4 costs 11 (base rules p. 15 to 17). */
const unitCostOfLevel = (level: number): number => 3 + 2 * level

/** The asset id of a player's figure; the colour is part of it. */
export const figureAssetIdOf = (colour: string, kind: 'army' | 'scout'): string => `figures/${colour}${kind}`

/** The noun a log line and a label use: "army", "scout", "mounted unit", "Library". */
export function buildItemName(item: BuildItem): string {
  switch (item.kind) {
    case 'building':
      return buildingNameOf(item.assetId) ?? item.assetId
    case 'wonder':
      return findBoardAsset(item.assetId)?.label ?? item.assetId
    case 'army':
    case 'scout':
      return item.kind
    case 'unit':
      return `${item.unitType} unit`
    case 'walls':
      return 'City Walls'
  }
}

/**
 * Whether the deck holds a card of the sheet, or the discard pile can be
 * reshuffled into one. This is the Draw button's own test (`draw`: a card in the
 * deck, else `reshuffleItems`, which needs a shuffleable sheet and a discarded
 * card), asked without drawing.
 */
export function unitCardAvailable(state: GameState, sheetName: SheetName): boolean {
  return (
    state.items.some((item) => item.sheetName === sheetName) ||
    (SHUFFLABLE_ITEMS.has(sheetName) && state.discardedItems.some((item) => item.sheetName === sheetName))
  )
}

/** The part of a production check every item shares: what the city has against what the item costs. */
type Payment = { readonly tradeToPay: number } | { readonly short: string }

function paymentFor(
  cost: number,
  costText: string,
  city: CityProduction,
  production: { readonly value: number; readonly source: BuildProductionSource },
  player: Playerhand,
): Payment {
  const shortfall = Math.max(0, cost - production.value)
  const tradeToPay = rushTradeCost(shortfall, player.civilization?.name)
  if (tradeToPay <= player.stats.trade) return { tradeToPay }
  return {
    short:
      `${costText} and ${city.label} has ${production.value} (${SOURCE_TEXT[production.source]}). ` +
      `Covering the missing ${shortfall} takes ${tradeToPay} trade and you have ${player.stats.trade}. ` +
      'If the city makes more than that, set its production by hand on the city.',
  }
}

/**
 * The wonders a city can produce (base rules p. 17: "the wonders that are faceup in
 * the market"): the wonder pieces in the shared Wonders area that nobody owns. The
 * market is that area, as `drawWonderToBoard` fills it. A wonder in a player's own
 * area (Egypt's start wonder) or on the map is not in the market. By name, so the order
 * does not depend on how the pieces were dropped.
 */
export function marketWondersOf(board: Board, pieces: readonly BoardPiece[]): readonly BoardPiece[] {
  return pieces
    .filter((piece) => piece.category === 'wonder' && isInWondersArea(board, piece) && (piece.ownerId ?? null) === null)
    .sort((a, b) => nameOfWonder(a).localeCompare(nameOfWonder(b)))
}

/** A wonder's label without the leading "The", so "The Colossus" sorts under C. */
const nameOfWonder = (piece: BoardPiece): string => piece.label.replace(/^The /, '')

/** What does not depend on the city, worked out once per call: the wonders in the market, the card supply of each unit type and the figures left in the box. */
interface SharedSupply {
  /** The wonders faceup in the market: on the board in the shared Wonders area and owned by nobody, by name. */
  readonly market: readonly BoardPiece[]
  readonly unitCards: Readonly<Record<UnitType, boolean>>
  readonly figures: Readonly<Record<'army' | 'scout', { readonly asset: ReturnType<typeof findBoardAsset>; readonly remaining: number | undefined }>>
}

function sharedSupplyOf(state: GameState, colour: string): SharedSupply {
  const figureOf = (kind: 'army' | 'scout') => {
    const asset = findBoardAsset(figureAssetIdOf(colour, kind))
    return {
      asset,
      remaining: asset === undefined ? undefined : remainingBoardAssetCount(asset, state.board.pieces, state.numOfPlayers),
    }
  }
  return {
    market: marketWondersOf(state.board, state.board.pieces),
    unitCards: {
      infantry: unitCardAvailable(state, UNIT_SHEET.infantry),
      artillery: unitCardAvailable(state, UNIT_SHEET.artillery),
      mounted: unitCardAvailable(state, UNIT_SHEET.mounted),
      aircraft: unitCardAvailable(state, UNIT_SHEET.aircraft),
    },
    figures: { army: figureOf('army'), scout: figureOf('scout') },
  }
}

function optionsForCity(
  scene: Scene,
  player: Playerhand,
  footprint: CityFootprintView,
  city: CityProduction,
  open: boolean,
  shared: SharedSupply,
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
  const choices: BuildChoice[] = []
  const unavailable: BuildUnavailable[] = []

  for (const { assetId, label } of BUILDABLE_BUILDINGS) {
    const item: BuildItem = { kind: 'building', assetId }
    const skip = (reason: string): void => {
      unavailable.push({ assetId, item, label, reason })
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
    const rules = placementRulesOf({ kind: 'building', assetId })
    const placed = placedSquaresOf(scene, footprint, rules, outskirts, player.playerId, onlyReplacingOf(scene, outskirts, item))
    // With none left in the supply, a building can still replace one of the same supply: it goes back before the new one is placed (base rules p. 17)
    const remaining = remainingBoardAssetCount(asset, state.board.pieces, state.numOfPlayers)
    const soldOut = remaining !== undefined && remaining <= 0
    const squares = soldOut
      ? placed.squares.filter((square) => square.replaces?.kind === 'building' && sameSupply(square.replaces.assetId, assetId))
      : placed.squares
    if (soldOut && squares.length === 0) {
      const shared = Object.hasOwn(BUILDING_UPGRADES, assetId) || Object.values(BUILDING_UPGRADES).includes(assetId)
      skip(
        `None left in the supply: all ${boardAssetLimit(asset, state.numOfPlayers) ?? 0} are on the board` +
          (shared ? ' (the basic and the upgraded form share one supply).' : '.') +
          ' One of yours of the same kind can be replaced, but none stands in this city.',
      )
      continue
    }
    if (squares.length === 0) {
      skip(noSquareReason(placementIntro(rules), [...placed.problems.values()]))
      continue
    }

    const payment = paymentFor(data.cost, `Costs ${data.cost} production`, city, production, player)
    if ('short' in payment) {
      skip(payment.short)
      continue
    }
    choices.push({ assetId, item, placement: 'square', label, cost: data.cost, tradeToPay: payment.tradeToPay, squares })
  }

  // City Walls (base rules p. 17, Masonry): a building in the city centre. They turn the city marker over, so no square is picked
  {
    const item: BuildItem = { kind: 'walls' }
    const label = 'City Walls'
    const skip = (reason: string): void => {
      unavailable.push({ assetId: WALLS_KEY, item, label, reason })
    }
    const walled = walledAssetIdOf(footprint.piece.assetId)
    if (!techs.revealed.has(WALLS_TECH)) {
      skip(needsReason(techs, [WALLS_TECH]))
    } else if (walled === undefined) {
      skip(`${city.label} already has City Walls. A city may have only one.`)
    } else if (findBoardAsset(walled) === undefined) {
      skip('The walled city marker is not in the game data.')
    } else {
      const payment = paymentFor(WALLS_COST, `Costs ${WALLS_COST} production`, city, production, player)
      if ('short' in payment) skip(payment.short)
      else choices.push({ assetId: WALLS_KEY, item, placement: 'none', label, cost: WALLS_COST, tradeToPay: payment.tradeToPay, squares: [] })
    }
  }

  // Wonders from the market: one per city, on any terrain but water; a second one replaces the first
  for (const piece of shared.market) {
    const item = { kind: 'wonder', assetId: piece.assetId } as const
    const label = piece.label
    const skip = (reason: string): void => {
      unavailable.push({ assetId: piece.assetId, item, label, reason })
    }
    const data = wonderDataOf(piece.assetId)
    if (data === undefined) {
      skip('This wonder is not in the game data.')
      continue
    }

    const rules = placementRulesOf(item)
    const { squares, problems } = placedSquaresOf(scene, footprint, rules, outskirts, player.playerId, onlyReplacingOf(scene, outskirts, item))
    if (squares.length === 0) {
      skip(noSquareReason(placementIntro(rules), [...problems.values()]))
      continue
    }

    // Checked against the city's production and rushed with trade like any other build;
    // hammers from cards and Great Persons count through a production set by hand
    const baseCost = wonderCostFor(data, techs.revealed)
    const discount = data.discount
    const discountNote =
      discount === undefined
        ? undefined
        : baseCost === discount.cost
          ? `${data.cost} without ${discount.tech}`
          : `${discount.cost} with ${discount.tech}`
    const michelangeloOff = Math.min(player.wonderDiscount, baseCost)
    const cost = baseCost - michelangeloOff
    const notes = [
      ...(discountNote === undefined ? [] : [discountNote]),
      ...(michelangeloOff > 0 ? [`${michelangeloOff} less with Michelangelo`] : []),
    ]
    const costNote = notes.length === 0 ? undefined : notes.join('; ')
    const payment = paymentFor(cost, `Costs ${cost} production`, city, production, player)
    if ('short' in payment) {
      skip(payment.short)
      continue
    }
    choices.push({
      assetId: piece.assetId,
      item,
      placement: 'square',
      label,
      cost,
      ...(costNote === undefined ? {} : { costNote }),
      tradeToPay: payment.tradeToPay,
      squares,
    })
  }

  // Army and scout figures: put on a square of the outskirts like a building
  const figureSquares = player.color === null ? undefined : figureSquaresOf(scene, player, footprint, player.color.toLowerCase())
  for (const kind of ['army', 'scout'] as const) {
    const item: BuildItem = { kind }
    const label = kind === 'army' ? 'Army figure' : 'Scout figure'
    const rules = figureRulesOf(state, player, kind, techs)
    if (rules === undefined) continue
    const assetId = figureAssetIdOf(rules.colour, kind)
    const skip = (reason: string): void => {
      unavailable.push({ assetId, item, label, reason })
    }

    const { asset, remaining } = shared.figures[kind]
    if (asset === undefined) {
      skip('This figure is not in the game data.')
      continue
    }
    if (remaining !== undefined && remaining <= 0) {
      skip(`None left in the supply: all ${boardAssetLimit(asset, state.numOfPlayers) ?? 0} ${kind === 'army' ? 'armies' : 'scouts'} of your colour are on the board.`)
      continue
    }

    const squares: BuildSquare[] = []
    const problems: SquareProblem[] = []
    const { cells, held } = figureSquares ?? { cells: [], held: new Set<string>() }
    for (const cell of cells) {
      const problem = figureSquareProblem(scene, footprint, rules, cell, held)
      if (problem !== undefined) {
        problems.push(problem)
        continue
      }
      const note = enemyFigureNoteOf(footprint, rules, cell)
      squares.push({
        column: cell.column,
        row: cell.row,
        label: squareLabel(cell),
        ...(note === undefined ? {} : { note }),
      })
    }
    if (squares.length === 0) {
      skip(noSquareReason(null, problems))
      continue
    }

    const cost = FIGURE_COST[kind]
    const payment = paymentFor(cost, `Costs ${cost} production`, city, production, player)
    if ('short' in payment) {
      skip(payment.short)
      continue
    }
    choices.push({ assetId, item, placement: 'square', label, cost, tradeToPay: payment.tradeToPay, squares })
  }

  // Military units: a private card, no square
  for (const unitType of UNIT_TYPES) {
    const item: BuildItem = { kind: 'unit', unitType }
    const assetId = `units/${unitType}`
    const label = `${unitType.charAt(0).toUpperCase()}${unitType.slice(1)} unit`
    const skip = (reason: string): void => {
      unavailable.push({ assetId, item, label, reason })
    }

    if (unitType === 'aircraft' && !techs.revealed.has(AIRCRAFT_TECH)) {
      skip(needsReason(techs, [AIRCRAFT_TECH]))
      continue
    }
    if (!shared.unitCards[unitType]) {
      skip(`No ${unitType} unit cards left in the deck or the discard pile.`)
      continue
    }

    let cost = AIRCRAFT_COST
    let costText = `Costs ${cost} production`
    if (unitType !== 'aircraft') {
      const level = unitLevelOf(player, unitType, techs)
      cost = unitCostOfLevel(level)
      costText = `Costs ${cost} production (${unitType} level ${level})`
    }
    const payment = paymentFor(cost, costText, city, production, player)
    if ('short' in payment) {
      skip(payment.short)
      continue
    }
    choices.push({ assetId, item, placement: 'none', label, cost, tradeToPay: payment.tradeToPay, squares: [] })
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
  const shared = sharedSupplyOf(state, player.color.toLowerCase())
  return footprints.flatMap((footprint) => {
    const city = productions.find((candidate) => candidate.pieceId === footprint.piece.id)
    return city === undefined ? [] : [optionsForCity(scene, player, footprint, city, open, shared)]
  })
}
