/**
 * The setup before turn 1 (issue #374): what a player does once their civilization is revealed, in the order they like.
 *
 * 1. Capital: one of the four central squares of the starting tile (the Chinese walled capital, the Indian metropolis on
 *    two central squares, a plain capital for everyone else), movable until setup is over.
 * 2. Figures: a colour army and scout in the capital's outskirts, and the Russian white army or the Spanish white scout.
 * 3. Social policy: the existing `chooseSocialPolicy`; this file only reports it.
 * 4. Great person (Americans): the assisted action `setupGreatPerson`, drawn like Philosophy's, kept through `chooseReward`.
 * 5. Starting trade: the trade icons in the capital's outskirts, counted as the Trade phase counts them.
 * 6. Government: forced by the civilization, an automatic row.
 * 7. Egypt's wonder: the free wonder dealt into Egypt's area, placed in the capital's outskirts.
 *
 * Step status is derived from the board and the hand, so a manual board edit cannot desync it. The record on the player
 * (`PlayerSetup`) holds only what cannot be derived: that setup is required and finished, the counted trade, and which
 * pieces setup placed (so that a solo undo can take exactly those back). Every reducer is pure.
 *
 * Hidden information: nothing here is projected to anyone but the owner (`PlayerViewSelf.setup`), and the public log lines
 * name no card.
 */

import { flipPieceUnchecked, movePieceUnchecked, placeUnchecked, removePiece, rotatePieceUnchecked } from './actions/board.js'
import { blocked, playerOf, withPlayerHand } from './assisted-core.js'
import type { BlockedAvailability } from './assisted-core.js'
import { countLinesIn } from './assisted-culture.js'
import { cityCenterCells, cityFootprintsOf, mapCellOf } from './blockade.js'
import {
  areaAt,
  areaSlotRegion,
  civTileAssetId,
  findBoardAsset,
  isMapCell,
  mapTop,
  nextFreeSlot,
  playerAreas,
  remainingBoardAssetCount,
  whiteFigureFor,
} from './board.js'
import type { BoardPiece, Rotation } from './board.js'
import { buildSquareRefusal, figureAssetIdOf, squareCentre, squareLabel } from './build-options.js'
import { foundCityCheck } from './city-founding.js'
import { rewardDrawCount } from './culture-track.js'
import type { EngineError } from './errors.js'
import { startingGovernmentFor } from './government.js'
import { anyGreatPersonMarkerLeft, stackingLimitOf } from './great-person-effects.js'
import { tradeCeilingOf } from './limits.js'
import { appendLog } from './log.js'
import { GROW_DIRECTIONS, metropolisGrowthsOf } from './metropolis.js'
import type { GrowDirection } from './metropolis.js'
import { occupancyOf } from './movement.js'
import { err, ok } from './result.js'
import type { Result } from './result.js'
import { capitalOf } from './sot.js'
import type { AssistedActionRecord, GameState, PlayerSetup, Playerhand, SetupPlacement } from './state.js'
import { tradeAroundCitiesOf } from './trade-collection.js'

type ActionResult = Result<GameState, EngineError>

const AMERICANS = 'Americans'
const EGYPTIANS = 'Egyptians'
const INDIANS = 'Indians'

/** The marker a civilization's capital is: the Chinese walled capital and the Indian metropolis, a plain capital for the rest. */
const CAPITAL_SUFFIX: Readonly<Record<string, string>> = {
  Chinese: 'capitalwalled2',
  Indians: 'metropolis2',
}

const CAPITAL_NAME: Readonly<Record<string, string>> = {
  Chinese: 'walled capital',
  Indians: 'metropolis',
}

export const SETUP_STEP_IDS = ['capital', 'figures', 'policy', 'greatPerson', 'trade', 'government', 'wonder'] as const
export type SetupStepId = (typeof SETUP_STEP_IDS)[number]

/** The figures of the figures step: the colour army and scout, and the civilization's white figure. */
export const SETUP_FIGURES = ['army', 'scout', 'white'] as const
export type SetupFigure = (typeof SETUP_FIGURES)[number]

export const isSetupFigure = (value: unknown): value is SetupFigure =>
  typeof value === 'string' && (SETUP_FIGURES as readonly string[]).includes(value)

/** The steps a player can take back alone. The great person is undone by a vote on its log line, like Philosophy. */
export type SetupUndoStep = 'capital' | 'figure' | 'trade' | 'wonder'

interface Cell {
  readonly column: number
  readonly row: number
}

const sameCell = (a: Cell, b: Cell): boolean => a.column === b.column && a.row === b.row

/** One square the map picker may offer. A metropolis covers two squares, so it carries the direction and the squares it covers. */
export interface SetupSquare {
  readonly column: number
  readonly row: number
  readonly label: string
  /** The Indian metropolis only: the neighbouring square it also covers lies in this direction. */
  readonly direction?: GrowDirection
  /** The Indian metropolis only: both squares, "C3 and D3". */
  readonly covers?: string
}

export type SetupStatus = 'done' | 'todo' | 'blocked' | 'auto'

/** One figure of the figures step. */
export interface SetupItemView {
  readonly id: SetupFigure
  readonly label: string
  readonly status: 'done' | 'todo' | 'blocked'
  readonly reason: string
  /** Where it may be placed now; empty unless `todo`. */
  readonly squares: readonly SetupSquare[]
  /** A figure setup placed and that is still on the map can be taken back alone. */
  readonly canUndo: boolean
}

export interface SetupStepView {
  readonly id: SetupStepId
  readonly label: string
  readonly status: SetupStatus
  readonly reason: string
  /**
   * The squares the map picker offers for this step: where the capital or the wonder may go, and for a capital that is
   * already placed (and was placed by setup) where it may be moved to. Empty for every other step; the figures have theirs in `items`.
   */
  readonly squares: readonly SetupSquare[]
  /** Whether the step can be taken back alone now (capital, a figure, trade, wonder). */
  readonly canUndo: boolean
  /** Why it cannot be taken back, when something else depends on it; `null` otherwise. */
  readonly undoReason: string | null
  /** The figures, for the figures step; empty for every other step. */
  readonly items: readonly SetupItemView[]
}

export interface SetupView {
  readonly steps: readonly SetupStepView[]
  /** Why Start of Turn cannot be marked done yet, for the End turn buttons; `null` when setup allows it. */
  readonly blocksTurn: string | null
}

// ---------------------------------------------------------------------------
// Reading the board
// ---------------------------------------------------------------------------

const colourOf = (player: Playerhand): string | undefined => player.color?.toLowerCase()

const isOnMap = (state: GameState, piece: BoardPiece): boolean => mapCellOf(state.board, piece) !== null

const pieceOf = (state: GameState, pieceId: string): BoardPiece | undefined =>
  state.board.pieces.find((piece) => piece.id === pieceId)

/** The asset of the player's capital marker, or `undefined` for a player with no colour. */
function capitalAssetIdOf(player: Playerhand): string | undefined {
  const colour = colourOf(player)
  if (colour === undefined) return undefined
  return `cities/${colour}${CAPITAL_SUFFIX[player.civilization?.name ?? ''] ?? 'capital2'}`
}

/** The placement of a slot that is still there: the piece is on the map. A piece taken off by hand leaves a stale entry, which counts for nothing. */
function placementOf(state: GameState, setup: PlayerSetup, slot: SetupPlacement['slot']): SetupPlacement | undefined {
  const entry = setup.placed.find((candidate) => candidate.slot === slot)
  if (entry === undefined) return undefined
  const piece = pieceOf(state, entry.pieceId)
  return piece !== undefined && isOnMap(state, piece) ? entry : undefined
}

/** The four central squares of the player's starting tile that are on the map; empty while the tile is not on it. */
function centralCellsOf(state: GameState, player: Playerhand): readonly Cell[] {
  const tileAsset = player.civilization === null ? undefined : civTileAssetId(player.civilization.name)
  const tile = tileAsset === undefined ? undefined : state.board.pieces.find((piece) => piece.assetId === tileAsset)
  if (tile === undefined) return []
  const size = state.board.squareSize
  const column0 = Math.round(tile.x / size)
  const row0 = Math.round((tile.y - mapTop(state.board)) / size)
  const cells: Cell[] = []
  for (let row = 1; row <= 2; row += 1) {
    for (let column = 1; column <= 2; column += 1) cells.push({ column: column0 + column, row: row0 + row })
  }
  return cells.every((cell) => isMapCell(state.board, cell.column, cell.row)) ? cells : []
}

const withoutPiece = (state: GameState, pieceId: string): GameState => ({
  ...state,
  board: { ...state.board, pieces: state.board.pieces.filter((piece) => piece.id !== pieceId) },
})

/** A piece standing where the city goes, for the founding check, which locates the cell from it. Never put on the board. */
function stand(state: GameState, colour: string, cell: Cell): BoardPiece {
  const centre = squareCentre(state.board, cell)
  return {
    id: 'setup-capital-check',
    assetId: figureAssetIdOf(colour, 'scout'),
    path: '',
    label: 'check',
    category: 'figure',
    x: centre.x - 5,
    y: centre.y - 5,
    width: 10,
    height: 10,
    rotation: 0,
    placedBy: null,
  }
}

const inOwnArea = (state: GameState, player: Playerhand, piece: BoardPiece): boolean =>
  areaAt(playerAreas(state.board, state.players), piece.x + piece.width / 2, piece.y + piece.height / 2)?.playerId === player.playerId

interface CapitalPlan {
  readonly assetId: string
  /** Where the marker's centre goes and how it lies. */
  readonly centre: { readonly x: number; readonly y: number }
  readonly rotation: Rotation
  /** The squares it covers: one, or two for the metropolis. */
  readonly covers: readonly Cell[]
}

/**
 * Whether the capital may stand on `cell` (and for the Indians' metropolis also on the neighbour in `direction`), judged on
 * `base`, which must not hold the player's old capital. The squares are the central ones of the starting tile, and the
 * founding rules apply: land, revealed squares around, no other city close, nothing built on it.
 */
function planCapital(base: GameState, player: Playerhand, cell: Cell, direction: GrowDirection | undefined): Result<CapitalPlan, string> {
  const colour = colourOf(player)
  const assetId = capitalAssetIdOf(player)
  const asset = assetId === undefined ? undefined : findBoardAsset(assetId)
  if (colour === undefined || assetId === undefined || asset === undefined) return err('Your capital marker has no artwork to put on the board.')
  const central = centralCellsOf(base, player)
  if (central.length === 0) return err('Your starting tile is not on the map, so the capital has no central square to stand on.')
  if (!Number.isInteger(cell.column) || !Number.isInteger(cell.row) || !central.some((candidate) => sameCell(candidate, cell))) {
    return err(`That square is not one of the four central squares of your starting tile (${central.map(squareLabel).join(', ')}).`)
  }
  const label = squareLabel(cell)
  const check = foundCityCheck(base, player, stand(base, colour, cell))
  if (!check.ok) return err(`The capital cannot stand on ${label}: ${check.reasons.join(' ')}`)

  if (player.civilization?.name !== INDIANS) {
    if (direction !== undefined) return err('A capital covers one square; only the Indians choose a direction for their metropolis.')
    return ok({ assetId, centre: squareCentre(base.board, cell), rotation: 0, covers: [cell] })
  }

  if (direction === undefined) return err('The Indian metropolis covers two squares: choose which neighbouring central square it also covers.')
  const capitalAsset = findBoardAsset(`cities/${colour}capital2`)
  if (capitalAsset === undefined) return err('The capital marker has no artwork to put on the board.')
  const centre = squareCentre(base.board, cell)
  const growth = metropolisGrowthsOf(base, player, {
    ...stand(base, colour, cell),
    id: 'setup-capital-check',
    assetId: capitalAsset.id,
    path: capitalAsset.path,
    category: 'city',
    x: centre.x - capitalAsset.width / 2,
    y: centre.y - capitalAsset.height / 2,
    width: capitalAsset.width,
    height: capitalAsset.height,
  }).find((candidate) => candidate.direction === direction)
  if (growth === undefined) return err('The metropolis cannot be laid out there.')
  if (!central.some((candidate) => sameCell(candidate, growth.cell))) {
    return err(`The metropolis would cover ${growth.square}, which is not one of the four central squares of your starting tile.`)
  }
  if (!growth.ok) return err(`The metropolis cannot cover ${label} and ${growth.square}: ${growth.reasons.join(' ')}`)
  if (growth.assetId !== assetId) return err('The metropolis marker does not match your colour.')
  return ok({ assetId, centre: growth.centre, rotation: growth.rotation, covers: [cell, growth.cell] })
}

/** Every square the capital may be put on now, judged on `base`: one entry per square, or per pair of squares for the metropolis. */
function capitalSquaresOf(base: GameState, player: Playerhand): { readonly squares: readonly SetupSquare[]; readonly reasons: readonly string[] } {
  const central = centralCellsOf(base, player)
  if (central.length === 0) return { squares: [], reasons: ['Your starting tile is not on the map.'] }
  const squares: SetupSquare[] = []
  const reasons: string[] = []
  if (player.civilization?.name !== INDIANS) {
    for (const cell of central) {
      const plan = planCapital(base, player, cell, undefined)
      if (plan.ok) squares.push({ column: cell.column, row: cell.row, label: squareLabel(cell) })
      else reasons.push(plan.error)
    }
    return { squares, reasons }
  }
  // Each pair of neighbouring central squares once: the left one east, the upper one south
  for (const cell of central) {
    for (const direction of ['east', 'south'] as const) {
      const plan = planCapital(base, player, cell, direction)
      if (!plan.ok) {
        reasons.push(plan.error)
        continue
      }
      const labels = plan.value.covers.map(squareLabel)
      squares.push({ column: cell.column, row: cell.row, label: labels.join(' and '), direction, covers: labels.join(' and ') })
    }
  }
  return { squares, reasons }
}

/** The empty squares of the capital's outskirts where `figure` may be placed now, in reading order. */
function figureSquaresOf(state: GameState, player: Playerhand, kind: 'army' | 'scout'): readonly SetupSquare[] {
  const colour = colourOf(player)
  const capital = capitalOf(state, player)
  if (colour === undefined || capital === undefined) return []
  const footprint = cityFootprintsOf(state, colour).find((candidate) => candidate.piece.id === capital.id)
  if (footprint === undefined) return []
  const limit = stackingLimitOf(state, player)
  const occupancy = occupancyOf(state.board, player)
  return [...footprint.outskirts]
    .filter((cell) => isMapCell(state.board, cell.column, cell.row))
    .sort((a, b) => a.row - b.row || a.column - b.column)
    .filter((cell) => {
      // The white scout is not counted by Build's own stacking check, so the player's whole stack is counted here
      if ((occupancy.own.get(`${cell.column},${cell.row}`) ?? 0) >= limit) return false
      return buildSquareRefusal(state, player, capital.id, { kind }, cell) === undefined
    })
    .map((cell) => ({ column: cell.column, row: cell.row, label: squareLabel(cell) }))
}

/** The wonder piece Egypt was dealt that still lies in the player's area, or the one already on the map. */
function wonderPiecesOf(state: GameState, player: Playerhand): { readonly waiting: BoardPiece | undefined; readonly placed: BoardPiece | undefined } {
  const own = state.board.pieces.filter((piece) => piece.category === 'wonder' && piece.ownerId === player.playerId)
  return { waiting: own.find((piece) => !isOnMap(state, piece)), placed: own.find((piece) => isOnMap(state, piece)) }
}

/** The empty squares of the capital's outskirts where the wonder may stand, in reading order. */
function wonderSquaresOf(state: GameState, player: Playerhand, wonder: BoardPiece): readonly SetupSquare[] {
  const colour = colourOf(player)
  const capital = capitalOf(state, player)
  if (colour === undefined || capital === undefined) return []
  const footprint = cityFootprintsOf(state, colour).find((candidate) => candidate.piece.id === capital.id)
  if (footprint === undefined) return []
  const standing = (cell: Cell): boolean =>
    state.board.pieces.some((piece) => {
      if (piece.category !== 'building' && piece.category !== 'wonder' && piece.category !== 'greatperson') return false
      const at = mapCellOf(state.board, piece)
      return at !== null && sameCell(at, cell)
    })
  return [...footprint.outskirts]
    .filter((cell) => isMapCell(state.board, cell.column, cell.row))
    .sort((a, b) => a.row - b.row || a.column - b.column)
    .filter((cell) => !standing(cell) && buildSquareRefusal(state, player, capital.id, { kind: 'wonder', assetId: wonder.assetId }, cell) === undefined)
    .map((cell) => ({ column: cell.column, row: cell.row, label: squareLabel(cell) }))
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** The applied setup great person of the player, if there is one. */
function greatPersonRecordOf(state: GameState, playerId: string): AssistedActionRecord | undefined {
  return state.assistedActions.find((record) => record.kind === 'setupGreatPerson' && record.playerId === playerId && record.status === 'applied')
}

const rewardPending = (player: Playerhand, record: AssistedActionRecord): boolean =>
  player.pendingRewards.some((reward) => reward.id === record.id || reward.id.startsWith(`${record.id}:`))

/** Whether the colour (or white) figure is on the map: a figure placed by hand counts as done. */
function figureOnMap(state: GameState, player: Playerhand, figure: SetupFigure): boolean {
  const assetId = figureAssetOf(player, figure)
  return assetId !== undefined && state.board.pieces.some((piece) => piece.category === 'figure' && piece.assetId === assetId && isOnMap(state, piece))
}

function figureAssetOf(player: Playerhand, figure: SetupFigure): string | undefined {
  if (figure === 'white') return player.civilization === null ? undefined : whiteFigureFor(player.civilization.name)
  const colour = colourOf(player)
  return colour === undefined ? undefined : figureAssetIdOf(colour, figure)
}

/** The figures this civilization places: the colour army and scout, and a white figure for the Russians and the Spanish. */
function figuresOf(player: Playerhand): readonly SetupFigure[] {
  return player.civilization !== null && whiteFigureFor(player.civilization.name) !== undefined ? ['army', 'scout', 'white'] : ['army', 'scout']
}

const FIGURE_LABEL: Readonly<Record<'army' | 'scout', string>> = { army: 'Army', scout: 'Scout' }

function figureLabelOf(player: Playerhand, figure: SetupFigure): string {
  if (figure !== 'white') return FIGURE_LABEL[figure]
  return player.civilization?.name === 'Russians' ? 'White army (Russians)' : 'White scout (Spanish)'
}

/** The figure as a sentence names it: "army", "white scout". */
function figureNounOf(player: Playerhand, figure: SetupFigure): string {
  return figure === 'white' ? `white ${whiteKindOf(player)}` : figure
}

/** What needs the capital and is still done: a capital cannot be taken back while any of it stands. */
const dependentsOf = (state: GameState, setup: PlayerSetup): readonly string[] => [
  ...(setup.trade === undefined ? [] : ['the starting trade']),
  ...(SETUP_FIGURES.some((slot) => placementOf(state, setup, slot) !== undefined) ? ['the figures'] : []),
  ...(placementOf(state, setup, 'wonder') === undefined ? [] : ["Egypt's wonder"]),
]

const STEP: Readonly<Record<GrowDirection, Cell>> = {
  north: { column: 0, row: -1 },
  west: { column: -1, row: 0 },
  east: { column: 1, row: 0 },
  south: { column: 0, row: 1 },
}

/** Whether a capital square offered for a move is where the capital already stands: the same squares, in either order. */
function isCurrentCapital(square: SetupSquare, current: readonly Cell[]): boolean {
  const second = square.direction === undefined ? undefined : { column: square.column + STEP[square.direction].column, row: square.row + STEP[square.direction].row }
  const covers = second === undefined ? [square] : [square, second]
  return covers.length === current.length && covers.every((cell) => current.some((other) => sameCell(other, cell)))
}

const NOT_STARTED = 'Place your capital first.'

function figureItemView(state: GameState, player: Playerhand, setup: PlayerSetup, figure: SetupFigure): SetupItemView {
  const label = figureLabelOf(player, figure)
  const noun = figureNounOf(player, figure)
  const canUndo = placementOf(state, setup, figure) !== undefined
  const base = { id: figure, label, canUndo }
  if (figureOnMap(state, player, figure)) return { ...base, status: 'done', reason: `${label} is on the map.`, squares: [] }
  if (capitalOf(state, player) === undefined) return { ...base, status: 'blocked', reason: NOT_STARTED, squares: [] }
  const supply = figureSupplyBlock(state, player, figure)
  if (supply !== undefined) return { ...base, status: 'blocked', reason: supply, squares: [] }
  const squares = figureSquaresOf(state, player, figure === 'white' ? whiteKindOf(player) : figure)
  if (squares.length === 0) return { ...base, status: 'blocked', reason: `No square in the outskirts of your capital can take the ${noun}.`, squares: [] }
  return { ...base, status: 'todo', reason: `Place the ${noun} in the outskirts of your capital.`, squares }
}

/** The kind of the white figure: the Russians' is an army, the Spanish' a scout. */
const whiteKindOf = (player: Playerhand): 'army' | 'scout' => (player.civilization?.name === 'Russians' ? 'army' : 'scout')

/** Why the figure has nothing to place, or `undefined`: a colour figure needs supply, the white one a piece (in the area or in the supply). */
function figureSupplyBlock(state: GameState, player: Playerhand, figure: SetupFigure): string | undefined {
  const assetId = figureAssetOf(player, figure)
  const asset = assetId === undefined ? undefined : findBoardAsset(assetId)
  if (asset === undefined) return 'That figure has no artwork to put on the board.'
  if (figure === 'white' && state.board.pieces.some((piece) => piece.assetId === asset.id)) return undefined
  if ((remainingBoardAssetCount(asset, state.board.pieces, state.numOfPlayers) ?? 1) <= 0) return `No ${asset.label.toLowerCase()} is left in the supply.`
  return undefined
}

/** The steps the gate needs done, with the label it names them by. */
function requiredSteps(player: Playerhand): readonly { readonly id: SetupStepId; readonly label: string }[] {
  const civ = player.civilization?.name
  return [
    { id: 'capital', label: 'capital' },
    { id: 'figures', label: 'figures' },
    { id: 'policy', label: 'social policy' },
    ...(civ === AMERICANS ? [{ id: 'greatPerson' as const, label: 'great person' }] : []),
    { id: 'trade', label: 'starting trade' },
    ...(civ === EGYPTIANS ? [{ id: 'wonder' as const, label: "Egypt's wonder" }] : []),
  ]
}

/** Whether each step is done now, read from the board and the hand. */
function stepDone(state: GameState, player: Playerhand, setup: PlayerSetup, id: SetupStepId): boolean {
  switch (id) {
    case 'capital':
      return capitalOf(state, player) !== undefined
    case 'figures':
      return figuresOf(player).every((figure) => figureOnMap(state, player, figure))
    case 'policy':
      return player.socialPolicies.length >= 1
    case 'greatPerson': {
      const record = greatPersonRecordOf(state, player.playerId)
      return record !== undefined && !rewardPending(player, record)
    }
    case 'trade':
      return setup.trade !== undefined
    case 'government':
      return true
    case 'wonder':
      return wonderPiecesOf(state, player).placed !== undefined
  }
}

/** The sentence that stops Start of Turn, or `undefined` when setup is finished or not required (or the player has no setup). */
export function setupGateOf(state: GameState, player: Playerhand): string | undefined {
  const setup = player.setup
  if (setup === undefined || !setup.required || setup.finished) return undefined
  const missing = requiredSteps(player).filter((step) => !stepDone(state, player, setup, step.id)).map((step) => step.label)
  if (missing.length === 0) return undefined
  return `Finish your setup before Start of Turn can be marked done: still to do: ${missing.join(', ')}. Open the Setup tab.`
}

/** Whether the player has made any setup progress that the reveal undo would leave behind (pieces on the map, counted trade, a great person). */
export function setupStarted(state: GameState, player: Playerhand): boolean {
  const setup = player.setup
  if (setup === undefined) return false
  return (
    setup.trade !== undefined ||
    setup.placed.some((entry) => placementOf(state, setup, entry.slot) !== undefined) ||
    greatPersonRecordOf(state, player.playerId) !== undefined
  )
}

/**
 * The setup as the owner sees it, or `null` when there is none to show: a player of a game saved before setup, a setup
 * that is finished, or a player with no civilization.
 */
export function setupViewOf(state: GameState, player: Playerhand): SetupView | null {
  const setup = player.setup
  if (setup === undefined || !setup.required || setup.finished || player.civilization === null) return null
  const civ = player.civilization.name
  const steps: SetupStepView[] = []

  // 1. Capital
  const capital = capitalOf(state, player)
  const capitalPlaced = placementOf(state, setup, 'capital')
  const dependents = dependentsOf(state, setup)
  const capitalName = CAPITAL_NAME[civ] ?? 'capital'
  if (capital !== undefined) {
    const label = (cityCenterCells(state.board, capital) ?? []).map(squareLabel).join(' and ')
    // Judged as `setCapital` will: with what depends on the capital lifted back and the capital itself off the map
    const lifted = capitalPlaced === undefined ? undefined : resetDependents(state, player.playerId, undefined).state
    const liftedPlayer = lifted === undefined ? undefined : playerOf(lifted, player.playerId)
    const moves = lifted === undefined || liftedPlayer === undefined ? undefined : capitalSquaresOf(withoutPiece(lifted, capital.id), liftedPlayer)
    steps.push({
      id: 'capital',
      label: 'Capital',
      status: 'done',
      reason:
        `Your ${capitalName} is on ${label}.` +
        (capitalPlaced === undefined ? ' It was not placed by setup, so move it by hand.' : dependents.length > 0 ? ' Moving it lifts back the dependent steps.' : ''),
      squares: (moves?.squares ?? []).filter((square) => !isCurrentCapital(square, cityCenterCells(state.board, capital) ?? [])),
      canUndo: capitalPlaced !== undefined && dependents.length === 0,
      undoReason: capitalPlaced === undefined ? 'The capital was not placed by setup.' : dependents.length > 0 ? `Take back ${dependents.join(', ')} first.` : null,
      items: [],
    })
  } else {
    const options = capitalSquaresOf(state, player)
    steps.push({
      id: 'capital',
      label: 'Capital',
      status: options.squares.length === 0 ? 'blocked' : 'todo',
      reason:
        options.squares.length === 0
          ? (options.reasons[0] ?? 'No central square can take the capital.')
          : `Place your ${capitalName} on one of the four central squares of your starting tile.`,
      squares: options.squares,
      canUndo: false,
      undoReason: null,
      items: [],
    })
  }

  // 2. Figures
  const items = figuresOf(player).map((figure) => figureItemView(state, player, setup, figure))
  const figuresDone = items.every((item) => item.status === 'done')
  steps.push({
    id: 'figures',
    label: 'Figures',
    status: figuresDone ? 'done' : capital === undefined ? 'blocked' : items.some((item) => item.status === 'todo') ? 'todo' : 'blocked',
    reason: figuresDone
      ? 'Your figures are on the map.'
      : capital === undefined
        ? NOT_STARTED
        : (items.find((item) => item.status !== 'done')?.reason ?? ''),
    squares: [],
    canUndo: items.some((item) => item.canUndo),
    undoReason: null,
    items,
  })

  // 3. Social policy
  const policies = player.socialPolicies.length
  steps.push({
    id: 'policy',
    label: 'Social policy',
    status: policies >= 1 ? 'done' : 'todo',
    reason: policies >= 1 ? 'You have a social policy.' : 'Choose your starting social policy in the Social policy panel.',
    squares: [],
    canUndo: false,
    undoReason: null,
    items: [],
  })

  // 4. Great person (Americans)
  if (civ === AMERICANS) {
    const record = greatPersonRecordOf(state, player.playerId)
    const block = greatPersonBlock(state, player)
    let status: SetupStatus = 'todo'
    let reason = 'Draw your great person.'
    if (record !== undefined) {
      const pending = rewardPending(player, record)
      status = pending ? 'todo' : 'done'
      reason = pending ? 'Choose which great person card to keep.' : 'You have drawn your great person; place its marker by hand.'
    } else if (block !== undefined) {
      status = 'blocked'
      reason = block.reason
    } else {
      reason = `Draw ${rewardDrawCount(state, player, 'greatPerson')} great person ${rewardDrawCount(state, player, 'greatPerson') === 1 ? 'card' : 'cards'} and keep one.`
    }
    steps.push({
      id: 'greatPerson',
      label: 'Great person',
      status,
      reason,
      squares: [],
      canUndo: false,
      undoReason: record === undefined ? null : 'A drawn great person is taken back by an undo vote on its log line.',
      items: [],
    })
  }

  // 5. Starting trade
  const tradeDone = setup.trade !== undefined
  steps.push({
    id: 'trade',
    label: 'Starting trade',
    status: tradeDone ? 'done' : capital === undefined ? 'blocked' : 'todo',
    reason: tradeDone
      ? `${setup.trade ?? 0} trade was counted around your capital.`
      : capital === undefined
        ? NOT_STARTED
        : 'Count the trade icons in the outskirts of your capital.',
    squares: [],
    canUndo: tradeDone,
    undoReason: null,
    items: [],
  })

  // 6. Government
  const government = startingGovernmentFor(civ)
  steps.push({
    id: 'government',
    label: 'Government',
    status: 'auto',
    reason: `${civ} start with ${government}.`,
    squares: [],
    canUndo: false,
    undoReason: null,
    items: [],
  })

  // 7. Egypt's wonder
  if (civ === EGYPTIANS) {
    const { waiting, placed } = wonderPiecesOf(state, player)
    const wonderPlaced = placementOf(state, setup, 'wonder')
    if (placed !== undefined) {
      steps.push({
        id: 'wonder',
        label: "Egypt's wonder",
        status: 'done',
        reason: `${placed.label} is on ${squareLabel(mapCellOf(state.board, placed) ?? { column: 0, row: 0 })}.`,
        squares: [],
        canUndo: wonderPlaced !== undefined,
        undoReason: wonderPlaced === undefined ? 'The wonder was not placed by setup.' : null,
        items: [],
      })
    } else {
      const squares = waiting === undefined || capital === undefined ? [] : wonderSquaresOf(state, player, waiting)
      steps.push({
        id: 'wonder',
        label: "Egypt's wonder",
        status: waiting === undefined || capital === undefined || squares.length === 0 ? 'blocked' : 'todo',
        reason:
          waiting === undefined
            ? "Egypt's wonder is not in your area."
            : capital === undefined
              ? NOT_STARTED
              : squares.length === 0
                ? 'No empty square in the outskirts of your capital can take the wonder.'
                : `Place ${waiting.label} on an empty square in the outskirts of your capital.`,
        squares,
        canUndo: false,
        undoReason: null,
        items: [],
      })
    }
  }

  return { steps, blocksTurn: setupGateOf(state, player) ?? null }
}

// ---------------------------------------------------------------------------
// Reducers
// ---------------------------------------------------------------------------

interface Held {
  readonly player: Playerhand
  readonly setup: PlayerSetup
}

const refuse = (step: string, reason: string): EngineError => ({ kind: 'SETUP_REFUSED', step, reason })

/** The player and their open setup, or the error: no access, no civilization, no setup, or setup already over. */
function held(state: GameState, playerId: string, step: string): Result<Held, EngineError> {
  const player = playerOf(state, playerId)
  if (player === undefined) return err({ kind: 'NO_ACCESS', playerId })
  if (player.civilization === null) return err(refuse(step, 'Reveal your civilization first.'))
  const setup = player.setup
  if (setup === undefined || !setup.required) return err(refuse(step, 'You have no setup to do.'))
  if (setup.finished) return err(refuse(step, 'Setup is over: Start of Turn has been marked done.'))
  return ok({ player, setup })
}

/**
 * Writes what a setup step did into the state: the board history entries it made (so the board Undo leaves them alone), the
 * change to the setup record, and one public line that names no card.
 */
function commit(
  before: GameState,
  after: GameState,
  playerId: string,
  patch: (setup: PlayerSetup) => PlayerSetup,
  text: string,
  at: string | undefined,
): GameState {
  const ids = after.board.history.slice(before.board.history.length).map((entry) => entry.id)
  const holder = playerOf(after, playerId)
  if (holder?.setup === undefined) return after
  const patched = patch(holder.setup)
  const stored = withPlayerHand(after, { ...holder, setup: { ...patched, historyIds: [...patched.historyIds, ...ids] } })
  const logged = appendLog(stored, {
    username: holder.username,
    playerId,
    logType: 'SETUP',
    publicLog: `${holder.username} ${text}`,
    privateLog: '',
    createdAt: at ?? null,
  })
  return countLinesIn(logged, ids)
}

const withPlacement = (setup: PlayerSetup, entry: SetupPlacement): PlayerSetup => ({
  ...setup,
  placed: [...setup.placed.filter((candidate) => candidate.slot !== entry.slot), entry],
})

const withoutPlacement = (setup: PlayerSetup, slot: SetupPlacement['slot']): PlayerSetup => ({
  ...setup,
  placed: setup.placed.filter((candidate) => candidate.slot !== slot),
})

const stamp = (at: string | undefined): { readonly at?: string } => (at === undefined ? {} : { at })

/** Puts a piece in the player's own area, in its next free slot, upright. `undefined` when the area or the piece is gone. */
function returnToArea(state: GameState, player: Playerhand, pieceId: string, at: string | undefined): GameState | undefined {
  const piece = pieceOf(state, pieceId)
  const area = playerAreas(state.board, state.players).find((candidate) => candidate.playerId === player.playerId)
  if (piece === undefined || area === undefined) return undefined
  const region = areaSlotRegion(area)
  const [x, y] = nextFreeSlot(state.board, area, state.board.pieces.filter((other) => other.id !== pieceId), { x: region.x, y: region.y })
  const moved = movePieceUnchecked(state, { playerId: player.playerId, pieceId, x, y, snap: false, ...stamp(at) })
  if (moved === undefined) return undefined
  const turned = pieceOf(moved, pieceId)?.rotation === 0 ? moved : rotatePieceUnchecked(moved, { playerId: player.playerId, pieceId, rotation: 0, ...stamp(at) })
  return turned ?? moved
}

/** Takes a piece setup placed off the map: a piece it created is removed, one that came from the area goes back there. */
function lift(state: GameState, player: Playerhand, entry: SetupPlacement, at: string | undefined): GameState {
  if (entry.created) {
    const removed = removePiece(state, { playerId: player.playerId, pieceId: entry.pieceId, ...stamp(at) })
    return removed.ok ? removed.value : state
  }
  return returnToArea(state, player, entry.pieceId, at) ?? state
}

/** Takes back the counted trade as far as it is there (never below 0). */
function takeBackTrade(state: GameState, playerId: string, amount: number): GameState {
  const holder = playerOf(state, playerId)
  if (holder === undefined) return state
  return withPlayerHand(state, { ...holder, stats: { ...holder.stats, trade: Math.max(0, holder.stats.trade - amount) } })
}

/**
 * Lifts back everything that needs the capital: the counted trade is undone, and the figures and Egypt's wonder setup placed
 * go back to the area. Pieces the player placed by hand are left where they are. Returns the new state, the setup record
 * without them, and what was undone as words.
 */
function resetDependents(state: GameState, playerId: string, at: string | undefined): { readonly state: GameState; readonly lifted: readonly string[] } {
  let next = state
  const lifted: string[] = []
  const holder = playerOf(next, playerId)
  const setup = holder?.setup
  if (holder === undefined || setup === undefined) return { state, lifted }
  if (setup.trade !== undefined) {
    next = takeBackTrade(next, playerId, setup.trade)
    lifted.push('the starting trade')
  }
  for (const entry of setup.placed) {
    if (entry.slot === 'capital' || placementOf(state, setup, entry.slot) === undefined) continue
    next = lift(next, holder, entry, at)
    lifted.push(entry.slot === 'wonder' ? "Egypt's wonder" : entry.slot === 'white' ? 'the white figure' : `the ${entry.slot}`)
  }
  const current = playerOf(next, playerId)
  if (current?.setup === undefined) return { state: next, lifted }
  const { trade: _trade, ...rest } = current.setup
  void _trade
  const cleared: PlayerSetup = { ...rest, placed: current.setup.placed.filter((entry) => entry.slot === 'capital') }
  return { state: withPlayerHand(next, { ...current, setup: cleared }), lifted }
}

export interface SetCapitalInput {
  readonly playerId: string
  readonly column: number
  readonly row: number
  /** The Indians only: the neighbouring central square the metropolis also covers. */
  readonly direction?: GrowDirection
  readonly at?: string
}

/**
 * Places the capital on a central square of the starting tile, or moves it to another one. Moving lifts back what needs the
 * capital (the counted trade, the figures and the wonder setup placed). A capital marker already lying in the player's area
 * (a reveal made before setup existed) is moved onto the map instead of making a second one.
 */
export function setCapital(state: GameState, input: SetCapitalInput): ActionResult {
  const access = held(state, input.playerId, 'capital')
  if (!access.ok) return access
  const { player, setup } = access.value
  const cell: Cell = { column: input.column, row: input.row }
  const capital = capitalOf(state, player)
  const entry = placementOf(state, setup, 'capital')
  if (capital !== undefined && entry === undefined) {
    return err(refuse('capital', 'Your capital was not placed by setup, so setup cannot move it. Move it by hand.'))
  }

  // A repeat of the same request changes nothing
  if (capital !== undefined) {
    const wanted = planCapital(withoutPiece(state, capital.id), player, cell, input.direction)
    if (wanted.ok) {
      const here = cityCenterCells(state.board, capital) ?? []
      if (here.length === wanted.value.covers.length && wanted.value.covers.every((target) => here.some((square) => sameCell(square, target)))) return ok(state)
    }
  }

  // The old capital is lifted first (with what depends on it), so the new square is judged as if it were not there
  let working = state
  let lifted: readonly string[] = []
  if (capital !== undefined && entry !== undefined) {
    const reset = resetDependents(state, player.playerId, input.at)
    working = lift(reset.state, player, entry, input.at)
    lifted = reset.lifted
  }
  const base = playerOf(working, player.playerId)
  if (base === undefined) return err({ kind: 'NO_ACCESS', playerId: input.playerId })
  const plan = planCapital(working, base, cell, input.direction)
  if (!plan.ok) return err(refuse('capital', plan.error))
  const asset = findBoardAsset(plan.value.assetId)
  if (asset === undefined) return err(refuse('capital', 'Your capital marker has no artwork to put on the board.'))

  // A marker of this asset lying in the player's own area is reused, as one piece is all the supply holds
  const waiting = working.board.pieces.find((piece) => piece.assetId === asset.id && !isOnMap(working, piece) && inOwnArea(working, base, piece))
  let placed: GameState
  let pieceId: string
  if (waiting !== undefined) {
    const flipped = flipPieceUnchecked(working, {
      playerId: player.playerId,
      pieceId: waiting.id,
      assetId: asset.id,
      centre: plan.value.centre,
      rotation: plan.value.rotation,
      ...stamp(input.at),
    })
    if (flipped === undefined) return err(refuse('capital', 'The capital marker could not be placed.'))
    placed = flipped
    pieceId = waiting.id
  } else {
    if ((remainingBoardAssetCount(asset, working.board.pieces, working.numOfPlayers) ?? 1) <= 0) {
      return err(refuse('capital', `No ${asset.label.toLowerCase()} is left in the supply.`))
    }
    const made = placeUnchecked(working, {
      playerId: player.playerId,
      assetId: asset.id,
      x: plan.value.centre.x - asset.width / 2,
      y: plan.value.centre.y - asset.height / 2,
      rotation: plan.value.rotation,
      ...stamp(input.at),
    })
    const madeEntry = made?.board.history.at(-1)
    if (made === undefined || madeEntry === undefined || madeEntry.change.kind !== 'place') return err(refuse('capital', 'The capital marker could not be placed.'))
    placed = made
    pieceId = madeEntry.change.piece.id
  }

  // The marker must cover exactly the squares that were chosen, or the city would stand somewhere else
  const landed = pieceOf(placed, pieceId)
  const centres = landed === undefined ? [] : (cityCenterCells(placed.board, landed) ?? [])
  if (centres.length !== plan.value.covers.length || !plan.value.covers.every((target) => centres.some((square) => sameCell(square, target)))) {
    return err(refuse('capital', 'The capital marker did not land on the chosen squares.'))
  }

  const name = CAPITAL_NAME[base.civilization?.name ?? ''] ?? 'capital'
  const where = plan.value.covers.map(squareLabel).join(' and ')
  const text =
    capital === undefined
      ? `placed their ${name} on ${where} in setup`
      : `moved their ${name} to ${where} in setup` + (lifted.length === 0 ? '' : `; ${lifted.join(', ')} went back`)
  return ok(
    commit(
      state,
      placed,
      player.playerId,
      (current) => withPlacement(current, { slot: 'capital', pieceId, created: waiting === undefined }),
      text,
      input.at,
    ),
  )
}

export interface PlaceSetupFigureInput {
  readonly playerId: string
  readonly figure: SetupFigure
  readonly column: number
  readonly row: number
  readonly at?: string
}

/** Places one figure (the colour army or scout, or the civilization's white figure) in the outskirts of the capital. */
export function placeSetupFigure(state: GameState, input: PlaceSetupFigureInput): ActionResult {
  const access = held(state, input.playerId, 'figures')
  if (!access.ok) return access
  const { player, setup } = access.value
  if (!figuresOf(player).includes(input.figure)) return err(refuse('figures', 'Your civilization has no white figure to place.'))
  const label = figureNounOf(player, input.figure)
  const cell: Cell = { column: input.column, row: input.row }
  const where = squareLabel(cell)

  const entry = placementOf(state, setup, input.figure)
  if (figureOnMap(state, player, input.figure)) {
    // A repeat of the same request changes nothing
    const piece = entry === undefined ? undefined : pieceOf(state, entry.pieceId)
    const at = piece === undefined ? null : mapCellOf(state.board, piece)
    if (at !== null && sameCell(at, cell)) return ok(state)
    return err(refuse('figures', `Your ${label} is already on the map. Take it back first to place it elsewhere.`))
  }
  if (capitalOf(state, player) === undefined) return err(refuse('figures', NOT_STARTED))
  const supply = figureSupplyBlock(state, player, input.figure)
  if (supply !== undefined) return err(refuse('figures', supply))
  if (!Number.isInteger(cell.column) || !Number.isInteger(cell.row) || cell.column < 0 || cell.row < 0) return err(refuse('figures', 'Choose a square on the map.'))
  const allowed = figureSquaresOf(state, player, input.figure === 'white' ? whiteKindOf(player) : input.figure)
  if (!allowed.some((square) => square.column === cell.column && square.row === cell.row)) {
    const capital = capitalOf(state, player)
    const kind = input.figure === 'white' ? whiteKindOf(player) : input.figure
    const why = capital === undefined ? undefined : buildSquareRefusal(state, player, capital.id, { kind }, cell)
    return err(refuse('figures', why ?? `The ${label} cannot be placed on ${where}: it must stand on a legal square in the outskirts of your capital, within your stacking limit.`))
  }

  const assetId = figureAssetOf(player, input.figure)
  const asset = assetId === undefined ? undefined : findBoardAsset(assetId)
  if (asset === undefined) return err(refuse('figures', 'That figure has no artwork to put on the board.'))
  const centre = squareCentre(state.board, cell)
  const x = centre.x - asset.width / 2
  const y = centre.y - asset.height / 2

  // The white figure lies in the player's area from the reveal: it is moved. A colour figure is made from the supply
  const waiting = input.figure === 'white' ? state.board.pieces.find((piece) => piece.assetId === asset.id && !isOnMap(state, piece)) : undefined
  let placed: GameState | undefined
  let pieceId: string | undefined
  if (waiting !== undefined) {
    placed = movePieceUnchecked(state, { playerId: player.playerId, pieceId: waiting.id, x, y, snap: false, ...stamp(input.at) })
    pieceId = waiting.id
  } else {
    placed = placeUnchecked(state, { playerId: player.playerId, assetId: asset.id, x, y, ...stamp(input.at) })
    const made = placed?.board.history.at(-1)
    pieceId = made?.change.kind === 'place' ? made.change.piece.id : undefined
  }
  const landedPiece = placed === undefined || pieceId === undefined ? undefined : pieceOf(placed, pieceId)
  const landed = placed === undefined || landedPiece === undefined ? null : mapCellOf(placed.board, landedPiece)
  if (placed === undefined || pieceId === undefined || landed === null || !sameCell(landed, cell)) {
    return err(refuse('figures', `The ${label} could not be placed on ${where}.`))
  }
  const placedId = pieceId
  return ok(
    commit(
      state,
      placed,
      player.playerId,
      (current) => withPlacement(current, { slot: input.figure, pieceId: placedId, created: waiting === undefined }),
      `placed their ${label} on ${where} in setup`,
      input.at,
    ),
  )
}

export interface SetupAtInput {
  readonly playerId: string
  readonly at?: string
}

/**
 * Counts the trade icons around the capital as the Trade phase counts them (capped by the trade track) and adds it to the
 * player's trade, recording the amount so an undo takes back exactly it. It does not touch turn 1's own trade collection.
 */
export function countSetupTrade(state: GameState, input: SetupAtInput): ActionResult {
  const access = held(state, input.playerId, 'trade')
  if (!access.ok) return access
  const { player, setup } = access.value
  // A repeat of the same request changes nothing
  if (setup.trade !== undefined) return ok(state)
  if (capitalOf(state, player) === undefined) return err(refuse('trade', NOT_STARTED))
  const ceiling = tradeCeilingOf(player.civilization?.name)
  const after = Math.min(ceiling, player.stats.trade + tradeAroundCitiesOf(state, player))
  const amount = Math.max(0, after - player.stats.trade)
  const counted = withPlayerHand(state, { ...player, stats: { ...player.stats, trade: player.stats.trade + amount } })
  return ok(commit(state, counted, player.playerId, (current) => ({ ...current, trade: amount }), `counted ${amount} trade around their capital in setup`, input.at))
}

export interface PlaceSetupWonderInput {
  readonly playerId: string
  readonly column: number
  readonly row: number
  readonly at?: string
}

/** Egypt's free wonder, from the player's area onto an empty square in the outskirts of the capital. */
export function placeSetupWonder(state: GameState, input: PlaceSetupWonderInput): ActionResult {
  const access = held(state, input.playerId, 'wonder')
  if (!access.ok) return access
  const { player, setup } = access.value
  if (player.civilization?.name !== EGYPTIANS) return err(refuse('wonder', 'Only the Egyptians place a free wonder in setup.'))
  const cell: Cell = { column: input.column, row: input.row }
  const { waiting, placed: onMap } = wonderPiecesOf(state, player)
  if (onMap !== undefined) {
    const at = mapCellOf(state.board, onMap)
    if (placementOf(state, setup, 'wonder')?.pieceId === onMap.id && at !== null && sameCell(at, cell)) return ok(state)
    return err(refuse('wonder', `${onMap.label} is already on the map. Take it back first to place it elsewhere.`))
  }
  if (waiting === undefined) return err(refuse('wonder', "Egypt's wonder is not in your area."))
  if (capitalOf(state, player) === undefined) return err(refuse('wonder', NOT_STARTED))
  if (!Number.isInteger(cell.column) || !Number.isInteger(cell.row) || cell.column < 0 || cell.row < 0) return err(refuse('wonder', 'Choose a square on the map.'))
  if (!wonderSquaresOf(state, player, waiting).some((square) => square.column === cell.column && square.row === cell.row)) {
    return err(refuse('wonder', `${waiting.label} cannot be placed on ${squareLabel(cell)}: it needs an empty land square in the outskirts of your capital.`))
  }
  const centre = squareCentre(state.board, cell)
  const moved = movePieceUnchecked(state, {
    playerId: player.playerId,
    pieceId: waiting.id,
    x: centre.x - waiting.width / 2,
    y: centre.y - waiting.height / 2,
    snap: false,
    ...stamp(input.at),
  })
  const piece = moved === undefined ? undefined : pieceOf(moved, waiting.id)
  const landed = moved === undefined || piece === undefined ? null : mapCellOf(moved.board, piece)
  if (moved === undefined || landed === null || !sameCell(landed, cell)) return err(refuse('wonder', `${waiting.label} could not be placed on ${squareLabel(cell)}.`))
  return ok(
    commit(
      state,
      moved,
      player.playerId,
      (current) => withPlacement(current, { slot: 'wonder', pieceId: waiting.id, created: false }),
      `placed ${waiting.label} on ${squareLabel(cell)} in setup`,
      input.at,
    ),
  )
}

export interface UndoSetupInput {
  readonly playerId: string
  readonly step: SetupUndoStep
  /** For `figure`: which one. */
  readonly figure?: SetupFigure
  readonly at?: string
}

/**
 * Takes one setup step back alone (a single player acting by themselves, as with the board Undo). A step that is not done
 * is left as it is (the state itself comes back, so a retry of an undo that went through answers the same). The capital cannot go
 * while the trade, the figures or the wonder that need it are still done; moving the capital lifts them itself.
 */
export function undoSetupStep(state: GameState, input: UndoSetupInput): ActionResult {
  const access = held(state, input.playerId, input.step)
  if (!access.ok) return access
  const { player, setup } = access.value
  switch (input.step) {
    case 'capital': {
      const entry = placementOf(state, setup, 'capital')
      // Nothing to take back changes nothing, so a retry of an undo that went through answers the same
      if (entry === undefined) {
        return capitalOf(state, player) === undefined ? ok(state) : err(refuse('capital', 'Your capital was not placed by setup, so setup cannot take it back.'))
      }
      const dependents = dependentsOf(state, setup)
      if (dependents.length > 0) return err(refuse('capital', `Take back ${dependents.join(', ')} first: they need the capital.`))
      const lifted = lift(state, player, entry, input.at)
      return ok(commit(state, lifted, player.playerId, (current) => withoutPlacement(current, 'capital'), 'took their capital back in setup', input.at))
    }
    case 'figure': {
      if (input.figure === undefined || !isSetupFigure(input.figure)) return err(refuse('figures', 'Say which figure to take back: army, scout or white.'))
      const entry = placementOf(state, setup, input.figure)
      if (entry === undefined) {
        return figureOnMap(state, player, input.figure) ? err(refuse('figures', 'That figure was not placed by setup, so setup cannot take it back.')) : ok(state)
      }
      const lifted = lift(state, player, entry, input.at)
      const label = figureNounOf(player, input.figure)
      return ok(commit(state, lifted, player.playerId, (current) => withoutPlacement(current, input.figure as SetupFigure), `took their ${label} back in setup`, input.at))
    }
    case 'trade': {
      if (setup.trade === undefined) return ok(state)
      const amount = setup.trade
      const back = takeBackTrade(state, player.playerId, amount)
      return ok(
        commit(
          state,
          back,
          player.playerId,
          (current) => {
            const { trade: _trade, ...rest } = current
            void _trade
            return rest
          },
          `took back the ${amount} trade counted in setup`,
          input.at,
        ),
      )
    }
    case 'wonder': {
      const entry = placementOf(state, setup, 'wonder')
      if (entry === undefined) {
        return wonderPiecesOf(state, player).placed === undefined ? ok(state) : err(refuse('wonder', 'The wonder was not placed by setup, so setup cannot take it back.'))
      }
      const lifted = lift(state, player, entry, input.at)
      return ok(commit(state, lifted, player.playerId, (current) => withoutPlacement(current, 'wonder'), "took Egypt's wonder back in setup", input.at))
    }
  }
}

/**
 * The gate lets Start of Turn through: record that setup is finished, so a later manual board edit cannot close it again.
 * Nothing changes for a player with no open setup.
 */
export function finishSetup(state: GameState, playerId: string, at: string | undefined): GameState {
  const player = playerOf(state, playerId)
  if (player?.setup === undefined || !player.setup.required || player.setup.finished) return state
  const stored = withPlayerHand(state, { ...player, setup: { ...player.setup, finished: true } })
  return appendLog(stored, {
    username: player.username,
    playerId,
    logType: 'SETUP',
    publicLog: `${player.username} finished setup`,
    privateLog: '',
    createdAt: at ?? null,
  })
}

// ---------------------------------------------------------------------------
// The great person (Americans): its rules; the assisted action itself is in `assisted-setup.ts`
// ---------------------------------------------------------------------------

/** Why the setup great person cannot be drawn now, or `undefined` when it can. */
export function greatPersonBlock(state: GameState, player: Playerhand): BlockedAvailability | undefined {
  if (player.civilization?.name !== AMERICANS) return blocked('not-owned', 'Only the Americans draw a great person in setup.')
  const setup = player.setup
  if (setup === undefined || !setup.required) return blocked('unavailable', 'You have no setup to do.')
  if (setup.finished) return blocked('unavailable', 'Setup is over: Start of Turn has been marked done.')
  if (greatPersonRecordOf(state, player.playerId) !== undefined) return blocked('used', 'You have already drawn your setup great person.')
  // The draw counts a revealed Organized Religion (two cards), and a hidden policy must not be guessed from the count
  if (player.socialPolicies.length === 0) return blocked('unavailable', 'Choose your social policy first: Organized Religion would draw a second great person card.')
  if (player.socialPolicies.some((policy) => policy.hidden)) {
    return blocked('unavailable', 'Reveal your social policy first: a revealed Organized Religion draws a second great person card.')
  }
  if (!anyGreatPersonMarkerLeft(state)) return blocked('unavailable', 'No Great Person marker is left, so no great person can be gained.')
  return undefined
}

/** Directions in the order the metropolis picker offers them; kept here so the web and the server agree on the names. */
export const SETUP_DIRECTIONS: readonly GrowDirection[] = GROW_DIRECTIONS

export const isSetupDirection = (value: unknown): value is GrowDirection =>
  typeof value === 'string' && (GROW_DIRECTIONS as readonly string[]).includes(value)
