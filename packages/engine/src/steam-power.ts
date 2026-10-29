/**
 * Steam Power's City Management ability (issue #302).
 *
 * "Move all of your figures in one square to any water square on the map. These
 * figures may not move again this turn." The Silk it costs is spent by the
 * assisted action (`assisted-steam-power.ts`). The rules summary (193 to 199) adds:
 * a source that is itself a water square may name the same square to lock the
 * figures where they are; armies teleported onto a water square holding enemy
 * figures fight there (the battle stays manual), while a scout never attacks, so
 * a group with a scout may not land on enemy figures; and Brandenburg Gate's
 * outskirts and the stacking limit still apply (rules 50 and 212).
 */

import { mapCellOf } from './blockade.js'
import type { Cell } from './blockade.js'
import type { Board, BoardPiece } from './board.js'
import { columnLabel, isMapCell, mapTop } from './board.js'
import { isExploredCell } from './explore.js'
import { canCultureMoveFigure, figureBelongsTo, figuresAt, occupancyOf } from './movement.js'
import type { FigureOwner } from './movement.js'
import { terrainAt } from './terrain.js'

export const STEAM_POWER_NAME = 'Steam Power'
export const STEAM_POWER_USAGE_KEY = 'card:Steam Power'

const keyOf = (cell: Cell): string => `${cell.column},${cell.row}`

const isScout = (piece: BoardPiece): boolean => piece.assetId.endsWith('scout')

/** The figures Steam Power can move from `cell`: the owner's, and not already moved by Galileo or Steam Power this turn. */
export const steamPowerFiguresAt = (
  board: Board,
  owner: FigureOwner,
  cell: Cell,
  turnNumber: number,
): readonly BoardPiece[] =>
  figuresAt(board, owner, cell).filter((piece) => canCultureMoveFigure(piece, turnNumber))

/** The squares with at least one figure Steam Power can move. */
export function steamPowerSources(board: Board, owner: FigureOwner, turnNumber: number): readonly Cell[] {
  const sources = new Map<string, Cell>()
  for (const piece of board.pieces) {
    if (!figureBelongsTo(owner, piece) || !canCultureMoveFigure(piece, turnNumber)) continue
    const cell = mapCellOf(board, piece)
    if (cell !== null) sources.set(keyOf(cell), cell)
  }
  return [...sources.values()].sort((a, b) => a.row - b.row || a.column - b.column)
}

/** Every explored water square on the map. */
export function waterCells(board: Board): readonly Cell[] {
  const cells: Cell[] = []
  for (let row = 0; row < board.rows; row += 1) {
    for (let column = 0; column < board.columns; column += 1) {
      if (!isMapCell(board, column, row) || !isExploredCell(board, { column, row })) continue
      const terrain = terrainAt(
        board,
        column * board.squareSize + board.squareSize / 2,
        mapTop(board) + row * board.squareSize + board.squareSize / 2,
      )
      if (terrain === 'water') cells.push({ column, row })
    }
  }
  return cells
}

/**
 * The water squares `figures`, standing on `from`, may be teleported to. `stackingLimit` is the
 * owner's effective limit; `forbiddenCells` are the Brandenburg Gate outskirts of other players.
 */
export function steamPowerDestinations(
  board: Board,
  owner: FigureOwner,
  stackingLimit: number,
  figures: readonly BoardPiece[],
  from: Cell,
  forbiddenCells: readonly Cell[] = [],
): readonly (Cell & { readonly label: string })[] {
  if (figures.length === 0) return []
  const occupancy = occupancyOf(board, owner)
  const forbidden = new Set(forbiddenCells.map(keyOf))
  const hasScout = figures.some(isScout)
  return waterCells(board)
    .filter((cell) => {
      const key = keyOf(cell)
      if (key === keyOf(from)) return true
      if (forbidden.has(key)) return false
      if (hasScout && occupancy.foreign.has(key)) return false
      return (occupancy.own.get(key) ?? 0) + figures.length <= Math.max(1, stackingLimit)
    })
    .map((cell) => ({ ...cell, label: `${columnLabel(cell.column)}${cell.row + 1}` }))
}
