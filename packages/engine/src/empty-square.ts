/**
 * The "empty square" rule from the unofficial rules 61 to 63, shared by the
 * movement cards and Galileo Galilei.
 *
 * A square is not empty when it holds a figure, building, Great Person, wonder,
 * city-state, city, hut, village or relic token. A disaster alone, or another
 * resource token such as wheat, does not block it. A metropolis covers both
 * squares of its artwork, not only the one under its centre.
 */

import { cityCenterCells, mapCellOf } from './blockade.js'
import type { Cell } from './blockade.js'
import type { Board, BoardPiece } from './board.js'

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

/** Whether this piece keeps a square from being empty. */
export function blocksEmptySquare(piece: BoardPiece): boolean {
  return BLOCKING_CATEGORIES.has(piece.category) || HUT_AND_VILLAGE_ASSETS.has(piece.assetId)
}

/** The map squares a blocking piece covers. A city uses the shared metropolis footprint. */
export function blockingCells(board: Board, piece: BoardPiece): readonly Cell[] {
  if (piece.category === 'city') return cityCenterCells(board, piece) ?? []
  const at = mapCellOf(board, piece)
  return at === null ? [] : [at]
}

/** Whether `cell` has none of the pieces that make a square non-empty. */
export function isEmptySquare(board: Board, cell: Cell): boolean {
  return !board.pieces.some(
    (piece) =>
      blocksEmptySquare(piece) &&
      blockingCells(board, piece).some((at) => keyOf(at) === keyOf(cell)),
  )
}
