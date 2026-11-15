/**
 * Gunpowder's `destroy` (issue #327): "destroy a building of your choice". The building is really removed from the board. Which
 * buildings may be chosen, from the public board alone (like `atomic-theory.ts`), so the browser lists what the engine accepts:
 * any building piece on a map square, whoever's, the player's own included. Not a wonder and not a city: their pieces have their
 * own categories. The owner is the colour of the one city whose outskirts hold the square (`pieceCityOwnerColor`); a building
 * outside every outskirts, or in those of two colours, has none.
 */

import { cityCenterCells, pieceCityOwnerColor, mapCellOf } from './blockade.js'
import { placeBack, restoreSupplyBlock } from './assisted-core.js'
import { squareOf } from './board.js'
import type { BoardPiece } from './board.js'
import { err, ok } from './result.js'
import type { Result } from './result.js'
import type { GameState, Playerhand } from './state.js'

export interface DestroyableBuilding {
  readonly pieceId: string
  /** The building's name as the board labels it, "Library". */
  readonly label: string
  /** The map square, "K10". */
  readonly square: string
  /** The player whose city's outskirts hold it, or `null`. */
  readonly ownerUsername: string | null
}

/** The players that own cities: name and colour. */
export interface BuildingOwner {
  readonly username: string
  readonly color: string | null
}

/** Every building on a map square, in board order, with the player whose outskirts it stands in. */
export function destroyableBuildingsOf(
  state: Pick<GameState, 'board' | 'players'>,
  owners: readonly BuildingOwner[],
): readonly DestroyableBuilding[] {
  return state.board.pieces.flatMap((piece): readonly DestroyableBuilding[] => {
    if (piece.category !== 'building' || mapCellOf(state.board, piece) === null) return []
    const colour = pieceCityOwnerColor(state, piece)
    const owner = colour === undefined ? undefined : owners.find((candidate) => candidate.color?.toLowerCase() === colour)
    return [{ pieceId: piece.id, label: piece.label, square: squareOf(state.board, piece) ?? '', ownerUsername: owner?.username ?? null }]
  })
}

/**
 * Puts a building that an ability destroyed (Gunpowder, Combustion) back exactly as it stood. `Err` is a sentence for the player
 * and nothing is changed: the piece is on the board again, another building, wonder, city or city-state now stands on its square
 * (a square holds one; other overlaps are not checked, limitations.md), or the place it freed in the supply has been used by
 * another build since.
 */
export function restoreDestroyedBuilding(
  state: GameState,
  player: Playerhand,
  building: { readonly piece: BoardPiece; readonly label: string; readonly square: string },
  at: string | null,
): Result<GameState, string> {
  if (state.board.pieces.some((piece) => piece.id === building.piece.id)) {
    return err(`${building.label} is on the board again, so the destruction cannot be taken back.`)
  }
  const where = mapCellOf(state.board, building.piece)
  const taken = where !== null && state.board.pieces.some((piece) => {
    if (piece.category === 'city') return (cityCenterCells(state.board, piece) ?? []).some((cell) => cell.column === where.column && cell.row === where.row)
    if (piece.category !== 'building' && piece.category !== 'wonder' && piece.category !== 'citystate') return false
    const cell = mapCellOf(state.board, piece)
    return cell !== null && cell.column === where.column && cell.row === where.row
  })
  if (taken) return err(`A building, wonder, city or city-state now stands on ${building.square}, so ${building.label} cannot be put back.`)
  const supply = restoreSupplyBlock(state, [building.piece])
  if (supply !== undefined) return err(supply)
  return ok(placeBack(state, player, building.piece, at))
}
