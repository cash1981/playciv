/**
 * Combustion's once-per-turn destruction (issue #327): "when one of your armies ends its movement on a
 * building, destroy that building. If one of your armies attacks a city with walls, the walls are destroyed
 * before the battle."
 *
 * Only the army is worked out here: which of the player's armies stand on a building or on another player's
 * walled city (the player chooses which army acts). The engine does not trigger on a move and does not remove
 * the piece (`assisted-combustion.ts` logs the use; the player removes the building, or turns the city marker back to its unwalled side, by hand).
 */

import { cityCenterCells, mapCellOf, pieceCityOwnerColor, pieceColorOf } from './blockade.js'
import type { Cell } from './blockade.js'
import type { BoardPiece } from './board.js'
import { squareLabel } from './build-options.js'
import { figureBelongsTo } from './movement.js'
import type { FigureOwner } from './movement.js'
import type { GameState } from './state.js'

export const COMBUSTION_NAME = 'Combustion'
export const COMBUSTION_USAGE_KEY = `card:${COMBUSTION_NAME}`

const sameCell = (a: Cell, b: Cell): boolean => a.column === b.column && a.row === b.row

/** What Combustion would destroy for one army: the walls of a city, or the building standing there. */
export interface CombustionTarget extends Cell {
  /** The army figure that acts. */
  readonly pieceId: string
  /** `true` for the walls of a walled city, `false` for a building. */
  readonly walls: boolean
  /** "the walls of the city on D4", "the Granary on D4". */
  readonly subject: string
}

type CombustionState = Pick<GameState, 'board' | 'players'>

/**
 * What the army `piece` of `owner` can destroy where it stands, or `undefined` when the piece is not an army of
 * the owner on a map square, or the square holds nothing Combustion may destroy. Walls come first: an army
 * attacking a walled city destroys the walls, and no building stands on a city's own square. Never the owner's
 * own: an army cannot attack its own city, and a building is the owner's when it stands in the outskirts of the
 * owner's city (a square in the footprint of exactly one colour's cities, `pieceCityOwnerColor`). A building
 * outside every city's outskirts, or in the outskirts of cities of two colours, belongs to nobody and may be
 * destroyed (human, 2026-11-13).
 */
export function combustionTargetFor(
  state: CombustionState,
  owner: FigureOwner,
  piece: BoardPiece,
): CombustionTarget | undefined {
  const { board } = state
  if (!figureBelongsTo(owner, piece) || !piece.assetId.endsWith('army')) return undefined
  const cell = mapCellOf(board, piece)
  if (cell === null) return undefined
  const colour = owner.color?.toLowerCase()
  const walled = board.pieces.find(
    (candidate) =>
      candidate.category === 'city' &&
      candidate.assetId.includes('walled') &&
      // The colour is read as everywhere else
      !(colour !== undefined && pieceColorOf(candidate) === colour) &&
      cityCenterCells(board, candidate)?.some((centre) => sameCell(centre, cell)) === true,
  )
  if (walled !== undefined) {
    return { ...cell, pieceId: piece.id, walls: true, subject: `the walls of ${walled.label} on ${squareLabel(cell)}` }
  }
  const building = board.pieces.find((candidate) => {
    if (candidate.category !== 'building') return false
    const at = mapCellOf(board, candidate)
    if (at === null || !sameCell(at, cell)) return false
    return colour === undefined || pieceCityOwnerColor(state, candidate) !== colour
  })
  return building === undefined
    ? undefined
    : { ...cell, pieceId: piece.id, walls: false, subject: `${building.label} on ${squareLabel(cell)}` }
}

/** One entry for each army of `owner` that stands on something Combustion can destroy, in board order. */
export function combustionTargets(state: CombustionState, owner: FigureOwner): readonly CombustionTarget[] {
  return state.board.pieces.flatMap((piece) => {
    const target = combustionTargetFor(state, owner, piece)
    return target === undefined ? [] : [target]
  })
}
