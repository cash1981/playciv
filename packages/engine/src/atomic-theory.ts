/**
 * Atomic Theory's nuke (issue #327): "Nuke — Movement: nuke a non-capital city. The city, along with all buildings,
 * wonders, figures and great people in its outskirts, is destroyed."
 *
 * Which cities may be nuked, and what each would take with it, from the public board alone (like `combustion.ts`), so the
 * browser lists the same targets the engine accepts. The reading of the card (human, 2026-11-13, "Nuke = Uranium"):
 *
 * - A target is any city of any player, the player's own included (human, 2026-11-13: the point may be to kill the many enemy
 *   figures standing around it); what stands in its outskirts is destroyed whoever owns it, so the player's own buildings,
 *   wonders, figures and great persons go too.
 * - Not a capital: the capital marker, or the metropolis, which only a capital grows into (`capitalOf` in `sot.ts`).
 * - Destroyed with the city piece: every building, wonder, figure and Great Person marker on a square of its outskirts, and the
 *   caravan, fortification and Building Program markers on its centre. A figure standing on the city's centre square is not
 *   in the outskirts and stays, as does anything else (resource tokens, huts, city-states, disaster tokens).
 */

import { cityFootprintsOf, mapCellOf, pieceColorOf } from './blockade.js'
import { squareOf } from './board.js'
import type { BoardPiece } from './board.js'
import type { GameState } from './state.js'

/** What the card destroys in the outskirts. */
const DESTROYED_CATEGORIES: ReadonlySet<string> = new Set(['building', 'wonder', 'figure', 'greatperson'])
/** The markers that belong to the city itself: the caravan or fortification, and the Building Program. */
const CITY_MARKERS: ReadonlySet<string> = new Set(['markers/caravan', 'markers/fortification', 'markers/Building Program'])

export interface NukeTarget {
  readonly pieceId: string
  /** "City F6", "Metropolis B2" or "Capital D5" as the board names it, with its square. */
  readonly label: string
  readonly ownerId: string
  readonly ownerUsername: string
  /** The city is the viewer's own. */
  readonly own: boolean
  /** Everything the nuke removes besides the city itself, in the order it is removed, with the square each stands on. */
  readonly destroyed: readonly { readonly pieceId: string; readonly label: string; readonly square: string | null }[]
}

/** The players that own cities: their id, name and colour. */
export interface NukeOwner {
  readonly playerId: string
  readonly username: string
  readonly color: string | null
}

const kindOf = (piece: BoardPiece): string =>
  piece.assetId.includes('metropolis') ? 'Metropolis' : piece.assetId.includes('capital') ? 'Capital' : 'City'

/** Order of removal: what stands around first, markers, the city last. */
const ORDER = ['figure', 'greatperson', 'wonder', 'building', 'marker'] as const

/**
 * The cities the viewer may nuke now, in board order: every city that is not a capital, their own included. `owners` lists
 * every player. A city whose colour no player has is nobody's and is left out.
 */
export function nukeTargetsOf(
  state: Pick<GameState, 'board' | 'players'>,
  viewerId: string,
  owners: readonly NukeOwner[],
): readonly NukeTarget[] {
  const { board } = state
  return owners.flatMap((owner): readonly NukeTarget[] => {
    const colour = owner.color?.toLowerCase()
    if (colour === undefined) return []
    const footprints = cityFootprintsOf(state, colour)
    // The capital: the capital marker, else the metropolis
    const capital =
      footprints.find((footprint) => footprint.piece.assetId.includes('capital')) ??
      footprints.find((footprint) => footprint.piece.assetId.includes('metropolis'))
    return footprints.flatMap((footprint): readonly NukeTarget[] => {
      const { piece } = footprint
      if (piece.id === capital?.piece.id || pieceColorOf(piece) !== colour) return []
      const outskirts = new Set(footprint.outskirts.map((cell) => `${cell.column},${cell.row}`))
      const centres = new Set(footprint.centers.map((cell) => `${cell.column},${cell.row}`))
      const around = board.pieces.filter((other) => {
        const cell = mapCellOf(board, other)
        if (cell === null) return false
        const key = `${cell.column},${cell.row}`
        return (DESTROYED_CATEGORIES.has(other.category) && outskirts.has(key)) || (CITY_MARKERS.has(other.assetId) && centres.has(key))
      })
      const destroyed = ORDER.flatMap((category) => around.filter((other) => other.category === category)).map((other) => ({
        pieceId: other.id,
        label: other.label,
        square: squareOf(board, other),
      }))
      return [
        {
          pieceId: piece.id,
          label: `${kindOf(piece)} ${squareOf(board, piece) ?? ''}`.trim(),
          ownerId: owner.playerId,
          ownerUsername: owner.username,
          own: owner.playerId === viewerId,
          destroyed,
        },
      ]
    })
  })
}

/** The same for the engine: the owners are the game's players. */
export const nukeTargetsFor = (state: GameState, viewerId: string): readonly NukeTarget[] =>
  nukeTargetsOf(state, viewerId, state.players.map((player) => ({ playerId: player.playerId, username: player.username, color: player.color })))
