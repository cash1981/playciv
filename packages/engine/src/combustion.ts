/**
 * Combustion's once-per-turn destruction (issue #327): "when one of your armies ends its movement on a
 * building, destroy that building. If one of your armies attacks a city with walls, the walls are destroyed
 * before the battle."
 *
 * Only the squares are worked out here: which of the player's armies stand on a building or on a walled
 * city. The engine does not trigger on a move and does not remove the piece (`assisted-combustion.ts` logs
 * the use; the player removes the building, or turns the city marker back to its unwalled side, by hand).
 */

import { cityCenterCells, mapCellOf, pieceColorOf } from './blockade.js'
import type { Cell } from './blockade.js'
import type { Board, BoardPiece } from './board.js'
import { squareLabel } from './build-options.js'
import { figuresAt, figureBelongsTo } from './movement.js'
import type { FigureOwner } from './movement.js'

export const COMBUSTION_NAME = 'Combustion'
export const COMBUSTION_USAGE_KEY = `card:${COMBUSTION_NAME}`

const sameCell = (a: Cell, b: Cell): boolean => a.column === b.column && a.row === b.row

/** What Combustion would destroy on a square: the walls of a city, or the building standing there. */
export interface CombustionTarget extends Cell {
  /** `true` for the walls of a walled city, `false` for a building. */
  readonly walls: boolean
  /** "the walls of the city on D4", "the Granary on D4". */
  readonly subject: string
}

/**
 * What an army of `owner` on `cell` can destroy with Combustion, or `undefined` when it has no army there or the
 * square holds no building and no walled city of another player. A walled city is checked first: an army attacking it destroys the
 * walls, and no building stands on a city's own square.
 */
export function combustionTargetAt(board: Board, owner: FigureOwner, cell: Cell): CombustionTarget | undefined {
  if (!figuresAt(board, owner, cell).some((piece) => piece.assetId.endsWith('army'))) return undefined
  const walled = board.pieces.find(
    (piece) =>
      piece.category === 'city' &&
      piece.assetId.includes('walled') &&
      // An army cannot attack its own city, so the owner's walls are never a target (the colour is read as everywhere else)
      !(owner.color !== null && pieceColorOf(piece) === owner.color.toLowerCase()) &&
      cityCenterCells(board, piece)?.some((centre) => sameCell(centre, cell)) === true,
  )
  if (walled !== undefined) return { ...cell, walls: true, subject: `the walls of ${walled.label} on ${squareLabel(cell)}` }
  const building = board.pieces.find(
    (piece) => piece.category === 'building' && sameCellOf(board, piece, cell),
  )
  return building === undefined ? undefined : { ...cell, walls: false, subject: `${building.label} on ${squareLabel(cell)}` }
}

const sameCellOf = (board: Board, piece: BoardPiece, cell: Cell): boolean => {
  const at = mapCellOf(board, piece)
  return at !== null && sameCell(at, cell)
}

/** Every square where an army of `owner` stands on something Combustion can destroy. */
export function combustionTargets(board: Board, owner: FigureOwner): readonly CombustionTarget[] {
  const seen = new Set<string>()
  const targets: CombustionTarget[] = []
  for (const piece of board.pieces) {
    if (!figureBelongsTo(owner, piece) || !piece.assetId.endsWith('army')) continue
    const cell = mapCellOf(board, piece)
    if (cell === null || seen.has(`${cell.column},${cell.row}`)) continue
    seen.add(`${cell.column},${cell.row}`)
    const target = combustionTargetAt(board, owner, cell)
    if (target !== undefined) targets.push(target)
  }
  return targets.sort((a, b) => a.row - b.row || a.column - b.column)
}
