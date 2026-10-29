/**
 * Map-tile discovery (issue #302).
 *
 * A map square is explored when a tile lies under it; a slot with no tile is
 * unexplored, drawn as fog on the board. Nobody walks onto fog: a figure on a
 * square next to it may spend 1 movement to explore, which draws the next tile
 * from the deck and lays it in that slot (turned any way by hand afterwards).
 * Exploring neither moves the figure nor locks it, so it may explore and then
 * travel, or travel to the edge and then explore, with the speed it has left.
 *
 * Nothing is saved: explored squares and the squares a figure may explore from
 * are derived from the board every time.
 */

import type { Cell } from './blockade.js'
import type { Board, BoardSlot } from './board.js'
import { TILE_SQUARES, isMapCell, mapTop } from './board.js'
import { tileSquareAt } from './terrain.js'

const keyOf = (cell: Cell): string => `${cell.column},${cell.row}`

/** The board point at the centre of a map square, for the tile lookup. */
const centreOf = (board: Board, cell: Cell): readonly [number, number] => [
  cell.column * board.squareSize + board.squareSize / 2,
  mapTop(board) + cell.row * board.squareSize + board.squareSize / 2,
]

/** Whether a tile (the tile back included) lies under the map square. Off the map is not explored. */
export function isExploredCell(board: Board, cell: Cell): boolean {
  if (!isMapCell(board, cell.column, cell.row)) return false
  const [x, y] = centreOf(board, cell)
  return tileSquareAt(board, x, y) !== null
}

/** A playable map square with no tile under it: fog. */
export const isUnexploredCell = (board: Board, cell: Cell): boolean =>
  isMapCell(board, cell.column, cell.row) && !isExploredCell(board, cell)

/** The squares a tile laid in `slot` would cover. */
function slotCells(slot: BoardSlot): readonly Cell[] {
  const cells: Cell[] = []
  for (let row = slot.y; row < slot.y + TILE_SQUARES; row += 1) {
    for (let column = slot.x; column < slot.x + TILE_SQUARES; column += 1) cells.push({ column, row })
  }
  return cells
}

/**
 * The slot a tile explored at `cell` is laid in: the first slot, in board order,
 * that covers the square and has no tile under any of its squares. `undefined`
 * when the square is already explored or off the map. Every map square belongs
 * to exactly one slot (the stepped boards stagger their slots without overlap).
 */
export function explorationSlotFor(board: Board, cell: Cell): BoardSlot | undefined {
  if (!isUnexploredCell(board, cell)) return undefined
  return board.slots.find((slot) => {
    const cells = slotCells(slot)
    return (
      cells.some((candidate) => keyOf(candidate) === keyOf(cell)) &&
      cells.every((candidate) => !isExploredCell(board, candidate))
    )
  })
}

/** The unexplored squares directly north, west, east or south of `from` that a tile could be laid on. */
export function exploreTargetsFrom(board: Board, from: Cell): readonly Cell[] {
  const targets: Cell[] = []
  for (const [dc, dr] of [[0, -1], [-1, 0], [1, 0], [0, 1]] as const) {
    const next = { column: from.column + dc, row: from.row + dr }
    if (explorationSlotFor(board, next) !== undefined) targets.push(next)
  }
  return targets
}
