/**
 * Gunpowder's `destroy` (issue #327): "destroy a building of your choice". The building is really removed from the board. Which
 * buildings may be chosen, from the public board alone (like `atomic-theory.ts`), so the browser lists what the engine accepts:
 * any building piece on a map square, whoever's, the player's own included. Not a wonder and not a city: their pieces have their
 * own categories. The owner is the colour of the one city whose outskirts hold the square (`pieceCityOwnerColor`); a building
 * outside every outskirts, or in those of two colours, has none.
 */

import { pieceCityOwnerColor, mapCellOf } from './blockade.js'
import { squareOf } from './board.js'
import type { GameState } from './state.js'

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
