/**
 * Galileo Galilei's map move (issue #302).
 *
 * "City Management: You may discard this card to choose a square on the outer
 * edge of the map. Move your figures in that square to any empty square on the
 * outer edge of the map. They cannot move again this turn."
 *
 * The human's reading: the source is any map square holding the player's
 * figures, and the destination is an empty outer-edge square. Every figure in
 * the source moves together. "Empty" follows the unofficial rules 61 to 63:
 * no figure, building, Great Person, wonder, city-state, city, hut, village or
 * relic token; a disaster or another resource token alone does not block it.
 * Rule 332 also allows a chosen source square that is itself on the outer edge,
 * to lock the figures without moving them. There is no stacking check at the
 * destination, and the destination may be water.
 */

import { cityCenterCells, mapCellOf } from './blockade.js'
import type { Cell } from './blockade.js'
import { columnLabel, isMapCell } from './board.js'
import type { Board, BoardPiece } from './board.js'
import { figureBelongsTo } from './movement.js'
import type { MovementPlayer } from './movement.js'

export const GALILEO_NAME = 'Galileo Galilei'

const HUT_AND_VILLAGE_ASSETS: ReadonlySet<string> = new Set(['resources/hut', 'resources/village'])
const BLOCKING_CATEGORIES: ReadonlySet<string> = new Set([
  'building',
  'wonder',
  'figure',
  'greatperson',
  'citystate',
  'city',
  'relic',
])

const keyOf = (cell: Cell): string => `${cell.column},${cell.row}`

/** A map square is on the edge when at least one cardinal neighbour is not a playable map square. */
export function isOuterEdgeCell(board: Board, cell: Cell): boolean {
  if (!isMapCell(board, cell.column, cell.row)) return false
  return (
    !isMapCell(board, cell.column, cell.row - 1) ||
    !isMapCell(board, cell.column - 1, cell.row) ||
    !isMapCell(board, cell.column + 1, cell.row) ||
    !isMapCell(board, cell.column, cell.row + 1)
  )
}

/** Every map square on the outer edge, in reading order. */
export function outerEdgeCells(board: Board): readonly Cell[] {
  const cells: Cell[] = []
  for (let row = 0; row < board.rows; row += 1) {
    for (let column = 0; column < board.columns; column += 1) {
      if (isOuterEdgeCell(board, { column, row })) cells.push({ column, row })
    }
  }
  return cells
}

/** The player's own figures whose centre is in `cell`. */
export function galileoFiguresAt(
  board: Board,
  player: MovementPlayer,
  cell: Cell,
): readonly BoardPiece[] {
  return board.pieces.filter((piece) => {
    if (piece.category !== 'figure' || !figureBelongsTo(player, piece)) return false
    const at = mapCellOf(board, piece)
    return at !== null && keyOf(at) === keyOf(cell)
  })
}

/** Whether `piece` keeps Galileo's destination from being empty, by the human's reading. */
export function galileoBlocksDestination(piece: BoardPiece): boolean {
  return BLOCKING_CATEGORIES.has(piece.category) || HUT_AND_VILLAGE_ASSETS.has(piece.assetId)
}

/** The map squares a blocking piece covers. A city uses the shared metropolis footprint. */
function pieceCells(board: Board, piece: BoardPiece): readonly Cell[] {
  if (piece.category === 'city') return cityCenterCells(board, piece) ?? []
  const at = mapCellOf(board, piece)
  return at === null ? [] : [at]
}

/** Whether `cell` is an edge square with none of the pieces that make a square non-empty. */
export function galileoDestinationAllowed(board: Board, cell: Cell): boolean {
  if (!isOuterEdgeCell(board, cell)) return false
  return !board.pieces.some(
    (piece) =>
      galileoBlocksDestination(piece) &&
      pieceCells(board, piece).some((at) => keyOf(at) === keyOf(cell)),
  )
}

/** The map squares holding at least one of the player's figures: Galileo's sources. */
export function galileoSources(board: Board, player: MovementPlayer): readonly Cell[] {
  const sources = new Map<string, Cell>()
  for (const piece of board.pieces) {
    if (piece.category !== 'figure' || !figureBelongsTo(player, piece)) continue
    const cell = mapCellOf(board, piece)
    if (cell !== null) sources.set(keyOf(cell), cell)
  }
  return [...sources.values()].sort((a, b) => a.row - b.row || a.column - b.column)
}

/**
 * The edge squares Galileo may move to, with a label ready for pickers. When the
 * chosen source is on the edge, it is also offered even though it holds the
 * figures: rule 332 lets Galileo pick the same square to lock them without moving.
 */
export function galileoDestinations(
  board: Board,
  source?: Cell,
): readonly (Cell & { readonly label: string })[] {
  return outerEdgeCells(board)
    .filter(
      (cell) =>
        galileoDestinationAllowed(board, cell) ||
        (source !== undefined &&
          isOuterEdgeCell(board, source) &&
          cell.column === source.column &&
          cell.row === source.row),
    )
    .map((cell) => ({ ...cell, label: `${columnLabel(cell.column)}${cell.row + 1}` }))
}
