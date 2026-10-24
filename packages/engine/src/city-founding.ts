/**
 * Whether a figure can found a city where it stands (base rulebook p. 13, plus the
 * Wisdom and Warfare and Fame and Fortune rules for city-states and relics).
 *
 * Pure and read-only. It collects every reason that applies, not only the first, so
 * the player sees what to fix in one look. The terrain data was read by eye from the
 * tile images, so a wrongly recorded square can block a legal city; the player then
 * places the city piece by hand, which stays a logged correction (the same stance as
 * for assisted Build).
 */

import { cityFootprintsOf, mapCellOf, pieceColorOf } from './blockade.js'
import { isMapCell, mapTop, whiteFigureCivilization } from './board.js'
import type { BoardPiece } from './board.js'
import { squareLabel } from './build-options.js'
import type { GameState, Playerhand } from './state.js'
import { terrainAt } from './terrain.js'

/** Cities a player may have: two, three once Irrigation is revealed (base rulebook p. 13). */
export const MAX_CITIES = 2
export const MAX_CITIES_WITH_IRRIGATION = 3

/** The most cities this player can have now. */
export const cityLimitOf = (player: Playerhand): number =>
  player.techsChosen.some((tech) => tech.name === 'Irrigation' && !tech.hidden)
    ? MAX_CITIES_WITH_IRRIGATION
    : MAX_CITIES

/** The player's city pieces on the board: a capital, a city or a metropolis is one each. */
export function ownCityPieces(state: GameState, player: Playerhand): readonly BoardPiece[] {
  const colour = player.color?.toLowerCase()
  return state.board.pieces.filter(
    (piece) => piece.category === 'city' && colour !== undefined && pieceColorOf(piece) === colour,
  )
}

interface Cell {
  readonly column: number
  readonly row: number
}

const sameCell = (a: Cell, b: Cell): boolean => a.column === b.column && a.row === b.row

/** The eight squares around a square, on the map or not. */
function neighbours(cell: Cell): readonly Cell[] {
  const cells: Cell[] = []
  for (let dRow = -1; dRow <= 1; dRow += 1) {
    for (let dColumn = -1; dColumn <= 1; dColumn += 1) {
      if (dRow !== 0 || dColumn !== 0) cells.push({ column: cell.column + dColumn, row: cell.row + dRow })
    }
  }
  return cells
}

/** Whether a figure piece is the player's own: their colour, or the white figure of their civilization. */
export function isOwnFigure(_state: GameState, player: Playerhand, piece: BoardPiece): boolean {
  if (piece.category !== 'figure') return false
  const white = whiteFigureCivilization(piece.assetId)
  if (white !== undefined) return white === player.civilization?.name
  const colour = player.color?.toLowerCase()
  return colour !== undefined && pieceColorOf(piece) === colour
}

/**
 * The figures that can found a city: the player's scouts on the map, and their armies
 * too under the Republic government ("your armies can build cities as though they were
 * scouts").
 */
export function foundingFiguresOf(state: GameState, player: Playerhand): readonly BoardPiece[] {
  return state.board.pieces.filter((piece) => {
    if (!isOwnFigure(state, player, piece) || mapCellOf(state.board, piece) === null) return false
    if (piece.assetId.endsWith('scout')) return true
    return piece.assetId.endsWith('army') && player.government === 'Republic'
  })
}

export interface FoundCityCheck {
  readonly ok: boolean
  /** Everything that stands in the way, as sentences. Empty when `ok`. */
  readonly reasons: readonly string[]
  /** The square, as numbers and as the label the line uses. */
  readonly cell: Cell | null
  readonly square: string
  /** Huts next to the square that a Zulu city explores at once (empty for everyone else). */
  readonly zuluHuts: readonly string[]
}

const HUT_ASSET = 'resources/hut'
const VILLAGE_ASSET = 'resources/village'

/**
 * Checks `figure` against the rules for a new city on its square. The number of cities
 * is checked here too, so the list is complete.
 */
export function foundCityCheck(state: GameState, player: Playerhand, figure: BoardPiece): FoundCityCheck {
  const cell = mapCellOf(state.board, figure)
  if (cell === null) {
    return { ok: false, reasons: ['That figure is not on the map.'], cell: null, square: '', zuluHuts: [] }
  }
  const square = squareLabel(cell)
  const reasons: string[] = []
  const board = state.board

  const limit = cityLimitOf(player)
  const have = ownCityPieces(state, player).length
  if (have >= limit) {
    reasons.push(
      limit === MAX_CITIES
        ? `You have ${have} cities, the most you can have without Irrigation.`
        : `You have ${have} cities, the most you can have.`,
    )
  }

  const centreTerrain = terrainAt(
    board,
    (cell.column + 0.5) * board.squareSize,
    mapTop(board) + (cell.row + 0.5) * board.squareSize,
  )
  if (centreTerrain === 'water') reasons.push(`${square} is a water square.`)

  // Eight revealed squares around it: not on the edge of the map, not next to a facedown tile
  const around = neighbours(cell)
  const unrevealed = around.filter(
    (neighbour) =>
      !isMapCell(board, neighbour.column, neighbour.row) ||
      terrainAt(
        board,
        (neighbour.column + 0.5) * board.squareSize,
        mapTop(board) + (neighbour.row + 0.5) * board.squareSize,
      ) === null,
  )
  if (unrevealed.length > 0) {
    reasons.push(`${square} is at the edge of the map or next to a facedown tile: a city needs eight revealed squares around it.`)
  }

  const piecesAt = (target: Cell): readonly BoardPiece[] =>
    board.pieces.filter((piece) => {
      const at = mapCellOf(board, piece)
      return at !== null && sameCell(at, target)
    })

  // Huts and villages next to it (a Zulu city may stand next to huts, never next to villages)
  const isZulu = player.civilization?.name === 'Zulu'
  const huts: string[] = []
  const villages: string[] = []
  for (const neighbour of [cell, ...around]) {
    for (const piece of piecesAt(neighbour)) {
      if (piece.assetId === HUT_ASSET) huts.push(squareLabel(neighbour))
      if (piece.assetId === VILLAGE_ASSET) villages.push(squareLabel(neighbour))
    }
  }
  if (villages.length > 0) {
    reasons.push(`A village is next to ${square} (${villages.join(', ')}). Take it first.`)
  }
  if (huts.length > 0 && !isZulu) {
    reasons.push(`A hut is next to ${square} (${huts.join(', ')}). Take it first.`)
  }

  // An enemy figure next to it (friendly figures may stand next to it or on it)
  const enemies = [...new Set(
    around.flatMap((neighbour) =>
      piecesAt(neighbour)
        .filter((piece) => piece.category === 'figure' && !isOwnFigure(state, player, piece))
        .map(() => squareLabel(neighbour)),
    ),
  )]
  if (enemies.length > 0) reasons.push(`An enemy figure is next to ${square} (${enemies.join(', ')}).`)

  // Three squares or more from every other city, diagonals included: the outskirts must not overlap
  const colours = [...new Set(
    board.pieces.filter((piece) => piece.category === 'city').flatMap((piece) => {
      const colour = pieceColorOf(piece)
      return colour === undefined ? [] : [colour]
    }),
  )]
  const close: string[] = []
  for (const colour of colours) {
    for (const footprint of cityFootprintsOf(state, colour)) {
      for (const centre of footprint.centers) {
        if (Math.max(Math.abs(centre.column - cell.column), Math.abs(centre.row - cell.row)) < 3) {
          close.push(squareLabel(centre))
        }
      }
    }
  }
  if (close.length > 0) {
    reasons.push(`${square} is less than three squares from the city at ${[...new Set(close)].join(', ')}.`)
  }

  // Relics and city-states next to it. A city may be built on a city-state square, not beside one.
  if (around.some((neighbour) => piecesAt(neighbour).some((piece) => piece.category === 'relic'))) {
    reasons.push(`A relic is next to ${square}. No city may be built next to a relic.`)
  }
  if (around.some((neighbour) => piecesAt(neighbour).some((piece) => piece.category === 'citystate'))) {
    reasons.push(`A city-state is next to ${square}. No city may be built next to a city-state.`)
  }

  // Whatever was built on the square would have to be overbuilt; the player clears it first
  const occupier = piecesAt(cell).find(
    (piece) => piece.category === 'building' || piece.category === 'wonder' || piece.category === 'greatperson',
  )
  if (occupier !== undefined) {
    reasons.push(`A building, wonder or great person stands on ${square}. Clear it first.`)
  }

  return {
    ok: reasons.length === 0,
    reasons,
    cell,
    square,
    zuluHuts: isZulu ? [...new Set(huts)] : [],
  }
}
