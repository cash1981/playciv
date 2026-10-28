/**
 * Figure movement on the map (issue #302).
 *
 * A player's own army or scout steps one map square north, west, south or east
 * at a time. Its travel speed is the total of the `mvmt` status expression plus
 * the bonuses the rules and faceup cards add. Water is entered only with a
 * revealed Sailing, Steam Power or Flight; England may cross it but not end
 * there.
 *
 * Nothing here is saved: the destinations are derived from the board and the
 * player every time. What is saved on the piece is how much of this turn's
 * allowance it has used and whether it is locked, in `BoardPiece.movement`.
 * The turn number makes a stale value fresh again on the next turn without a
 * reset step.
 */

import { pieceColorOf } from './blockade.js'
import type { Cell } from './blockade.js'
import type { Board, BoardPiece, PieceMovement } from './board.js'
import { columnLabel, isMapCell, mapTop, whiteFigureCivilization } from './board.js'
import { WATER_TECHS } from './build-options.js'
import { terrainAt } from './terrain.js'

/**
 * The parts of a player the movement rules read. Narrower than `Playerhand` so
 * the client can pass its own view of the seat without importing private fields.
 */
export interface MovementPlayer {
  readonly color: string | null
  readonly civilization: { readonly name: string } | null
  readonly stats: { readonly mvmt: string }
  readonly items: readonly {
    readonly kind: string
    readonly name?: string | null
    readonly hidden: boolean
  }[]
  readonly socialPolicies: readonly { readonly name: string; readonly hidden: boolean }[]
  readonly techsChosen: readonly { readonly name: string; readonly hidden: boolean }[]
  readonly government?: string
  readonly playerTurns: readonly {
    readonly turnNumber: number
    readonly usedActions: readonly string[]
  }[]
}

/** One square a figure can reach, and the cardinal distance to it. */
export interface MovementDestination extends Cell {
  readonly label: string
  readonly distance: number
}

/** What the board and the movement panel need to know about one figure. */
export interface FigureMovementOptions {
  readonly speed: number
  readonly used: number
  readonly remaining: number
  readonly locked: boolean
  readonly destinations: readonly MovementDestination[]
}

/** The turn value bookkeeping for a piece, or `null` when it has none. */
export const movementOf = (piece: BoardPiece, turnNumber: number): PieceMovement | null =>
  piece.movement?.turn === turnNumber ? piece.movement : null

/** The total of a Movement expression such as `3+1`. */
export function movementTotal(expression: string): number {
  return expression
    .split('+')
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part) && part >= 0)
    .reduce((total, part) => total + part, 0)
}

/** Whether the piece is this player's own army or scout: its colour, or the white figure of its civ. */
export function figureBelongsTo(player: MovementPlayer, piece: BoardPiece): boolean {
  if (piece.category !== 'figure') return false
  const white = whiteFigureCivilization(piece.assetId)
  if (white !== undefined) return player.civilization?.name === white
  return player.color !== null && pieceColorOf(piece) === player.color.toLowerCase()
}

const isArmy = (piece: BoardPiece): boolean => piece.assetId.endsWith('army')

/** A faceup Great Person card of the player. */
const hasFaceup = (player: MovementPlayer, name: string): boolean =>
  player.items.some((item) => item.kind === 'greatperson' && item.name === name && !item.hidden)

/** A revealed social policy of the player; a chosen but hidden one has no effect. */
const hasPolicy = (player: MovementPlayer, name: string): boolean =>
  player.socialPolicies.some((policy) => policy.name === name && !policy.hidden)

/** Under Anarchy, the player's social policies have no effect. */
const inAnarchy = (player: MovementPlayer): boolean => player.government === 'Anarchy'

/** A revealed tech of the player, the same visibility Build uses for water. */
const hasRevealedTech = (player: MovementPlayer, name: string): boolean =>
  player.techsChosen.some((tech) => tech.name === name && !tech.hidden)

/**
 * The player's travel speed: the status expression, plus Natural Religion for an
 * army (group movement is not implemented, so every army move is individual),
 * plus Henry Ford while his card is faceup, doubled by Captain James Cook for
 * this turn.
 */
export function travelSpeedOf(player: MovementPlayer, piece: BoardPiece, turnNumber: number): number {
  const expression = player.stats.mvmt
  let speed = movementTotal(expression)
  // Natural Religion is army-only, so the engine adds it to the player-wide base.
  // A `+` in the typed expression is the players' existing way of recording their
  // own bonuses (issue #102, `3+1`), so it already includes this one; adding it
  // again would double-count an older save.
  if (
    isArmy(piece) &&
    hasPolicy(player, 'Natural Religion') &&
    !inAnarchy(player) &&
    !expression.includes('+')
  ) {
    speed += 1
  }
  if (hasFaceup(player, 'Henry Ford')) speed += 1
  const cook = player.playerTurns
    .find((turn) => turn.turnNumber === turnNumber)
    ?.usedActions.includes('card:Captain James Cook')
  return cook === true ? speed * 2 : speed
}

/** How the player treats water: neither, crossing only (England), or crossing and ending. */
interface WaterAllowed {
  readonly cross: boolean
  readonly end: boolean
}

function waterRulesOf(player: MovementPlayer): WaterAllowed {
  const tech = WATER_TECHS.some((name) => hasRevealedTech(player, name))
  if (tech) return { cross: true, end: true }
  // England's navy: "English figures may cross water, but may not end their movement in it."
  return player.civilization?.name === 'England' ? { cross: true, end: false } : { cross: false, end: false }
}

/** The centre of a map cell, for the terrain lookup. */
const centreOf = (board: Board, cell: Cell): readonly [number, number] => [
  cell.column * board.squareSize + board.squareSize / 2,
  mapTop(board) + cell.row * board.squareSize + board.squareSize / 2,
]

const keyOf = (cell: Cell): string => `${cell.column},${cell.row}`

/** The map squares holding a piece that matches `wanted`. */
function pieceSquares(board: Board, wanted: (piece: BoardPiece) => boolean): ReadonlySet<string> {
  const squares = new Set<string>()
  for (const piece of board.pieces) {
    if (!wanted(piece)) continue
    const column = Math.floor((piece.x + piece.width / 2) / board.squareSize)
    const row = Math.floor((piece.y + piece.height / 2 - mapTop(board)) / board.squareSize)
    if (isMapCell(board, column, row)) squares.add(`${column},${row}`)
  }
  return squares
}

/** The squares occupied by figures: another figure is not a destination in this slice. */
const figureSquares = (board: Board): ReadonlySet<string> =>
  pieceSquares(board, (piece) => piece.category === 'figure')

/** The resource markers a figure must stop on: it may not walk past a hut or village without Flight. */
const HUT_AND_VILLAGE_ASSETS: ReadonlySet<string> = new Set(['resources/hut', 'resources/village'])

const hutAndVillageSquares = (board: Board): ReadonlySet<string> =>
  pieceSquares(board, (piece) => HUT_AND_VILLAGE_ASSETS.has(piece.assetId))

/**
 * The movement options for one of the player's figures, or `null` when the
 * piece is not their figure on the map.
 */
export function figureMovementOptions(
  board: Board,
  player: MovementPlayer,
  piece: BoardPiece,
  turnNumber: number,
): FigureMovementOptions | null {
  if (!figureBelongsTo(player, piece)) return null
  const start: Cell = {
    column: Math.floor((piece.x + piece.width / 2) / board.squareSize),
    row: Math.floor((piece.y + piece.height / 2 - mapTop(board)) / board.squareSize),
  }
  if (!isMapCell(board, start.column, start.row)) return null

  const saved = movementOf(piece, turnNumber)
  const used = saved?.used ?? 0
  const locked = saved?.locked ?? false
  const speed = travelSpeedOf(player, piece, turnNumber)
  const remaining = Math.max(0, speed - used)
  if (locked || remaining === 0) return { speed, used, remaining, locked, destinations: [] }

  const water = waterRulesOf(player)
  const flight = hasRevealedTech(player, 'Flight')
  const occupied = figureSquares(board)
  const mustStop = flight ? new Set<string>() : hutAndVillageSquares(board)
  const distances = new Map<string, number>([[keyOf(start), 0]])
  const queue: Cell[] = [start]
  const destinations: MovementDestination[] = []

  while (queue.length > 0) {
    const cell = queue.shift() as Cell
    const distance = distances.get(keyOf(cell)) ?? 0
    if (distance > 0) {
      const [x, y] = centreOf(board, cell)
      const terrain = terrainAt(board, x, y)
      const waterHere = terrain === 'water'
      const mayEndHere = waterHere ? water.end : true
      if (mayEndHere && !occupied.has(keyOf(cell))) {
        destinations.push({
          column: cell.column,
          row: cell.row,
          label: `${columnLabel(cell.column)}${cell.row + 1}`,
          distance,
        })
      }
    }
    if (distance >= speed) continue
    // A hut or village ends the move: the figure may land there but not pass it.
    // A revealed Flight flies over, so it neither stops nor blocks the squares beyond.
    if (distance > 0 && mustStop.has(keyOf(cell))) continue
    for (const [dc, dr] of [[0, -1], [-1, 0], [1, 0], [0, 1]] as const) {
      const next = { column: cell.column + dc, row: cell.row + dr }
      if (!isMapCell(board, next.column, next.row)) continue
      // Another figure's square is not walked through: contact is left to the
      // player (battle, loot, stacking), instead of silently skipping it.
      if (occupied.has(keyOf(next))) continue
      const [x, y] = centreOf(board, next)
      if (terrainAt(board, x, y) === 'water' && !water.cross) continue
      if (distances.has(keyOf(next))) continue
      distances.set(keyOf(next), distance + 1)
      queue.push(next)
    }
  }

  destinations.sort((a, b) => a.distance - b.distance || a.row - b.row || a.column - b.column)
  return { speed, used, remaining, locked, destinations }
}

/** The option for exactly `cell`, or `undefined` when it is not a legal destination. */
export function destinationTo(
  options: FigureMovementOptions,
  cell: Cell,
): MovementDestination | undefined {
  return options.destinations.find(
    (candidate) => candidate.column === cell.column && candidate.row === cell.row,
  )
}
