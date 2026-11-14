/**
 * Monarchy's `obsolete` (issue #327): "obsolete 1 ancient wonder". The human (2026-11-13): it marks the chosen wonder disabled
 * on the owner list, as the hand-made disable does (`setWonderOwner` with `disable: true`, issue #306): the owner is cleared,
 * the piece stays and is drawn crossed out.
 *
 * Which wonders may be chosen, from the public board alone (like `atomic-theory.ts`), so the browser lists what the engine
 * accepts: a wonder of an allowed era (`wonder-data.ts`: ancient for Monarchy, ancient or medieval for Gunpowder) that a player owns and that is not already disabled. Any player's, the user's
 * own included. A wonder still in the market has no owner and is not a candidate.
 */

import type { Board } from './board.js'
import { wonderDataOf } from './wonder-data.js'
import type { WonderEra } from './wonder-data.js'

export interface ObsoletableWonder {
  readonly pieceId: string
  /** The wonder's name as the board labels it, "The Pyramids". */
  readonly label: string
  readonly ownerId: string
  readonly ownerUsername: string
}

/** The players that may own a wonder: id and name. */
export interface WonderOwner {
  readonly playerId: string
  readonly username: string
}

/** The wonders of the given eras (Monarchy: ancient; Gunpowder: ancient and medieval) owned by one of `owners` that are not disabled, in board order. */
export function obsoletableWondersOf(
  board: Pick<Board, 'pieces'>,
  owners: readonly WonderOwner[],
  eras: readonly WonderEra[] = ['Ancient'],
): readonly ObsoletableWonder[] {
  return board.pieces.flatMap((piece): readonly ObsoletableWonder[] => {
    if (piece.category !== 'wonder' || piece.disabled === true || !eras.some((era) => era === wonderDataOf(piece.assetId)?.era)) return []
    const owner = owners.find((candidate) => candidate.playerId === piece.ownerId)
    return owner === undefined ? [] : [{ pieceId: piece.id, label: piece.label, ownerId: owner.playerId, ownerUsername: owner.username }]
  })
}
