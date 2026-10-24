/**
 * The resource, trade and culture icons printed on the map squares.
 *
 * Like the terrain, they live only in the tile images, so `data/tile-icons.json`
 * records them by hand: the four resources (wheat, silk, incense, iron), the trade
 * icons and the culture icon of a natural wonder (base rules p. 7). Production and
 * coin icons are not here: production comes from the terrain and the building table,
 * and the coin icons are not read by anything yet.
 *
 * The squares are in the printed orientation and the lookup undoes the rotation, the
 * same as `terrain.ts`. A tile with no entry has not been read, so its squares are
 * unknown, which is not the same as having no icons.
 */

import tileIcons from '../data/tile-icons.json' with { type: 'json' }

import { mapTop } from './board.js'
import type { Board } from './board.js'
import { tileSquareAt } from './terrain.js'

export const RESOURCE_KINDS = ['wheat', 'silk', 'incense', 'iron'] as const

export type ResourceKind = (typeof RESOURCE_KINDS)[number]

interface IconEntry {
  readonly row: number
  readonly column: number
  readonly resource?: ResourceKind
  readonly culture?: number
  readonly trade?: number
}

const TILE_ICONS = (tileIcons as unknown as { readonly tiles: Readonly<Record<string, readonly IconEntry[]>> }).tiles

/** What one square holds. */
export interface SquareIcons {
  /** The resource icon, when the square has one. A square holds at most one. */
  readonly resource: ResourceKind | undefined
  /** Culture icons: 1 on a natural wonder, 0 elsewhere. */
  readonly culture: number
  /** Trade icons printed on the square: 1 or 0 in the data read so far. */
  readonly trade: number
}

/** The title-case name of a resource: "Wheat", as the log and the buttons say it. */
export const resourceName = (resource: ResourceKind): string => resource.charAt(0).toUpperCase() + resource.slice(1)

/**
 * The icons of the map square under board point (x, y). `null` when the point is not
 * on the map, there is no tile under it, or the tile's icons have not been read.
 */
export function squareIconsAt(board: Board, x: number, y: number): SquareIcons | null {
  const square = tileSquareAt(board, x, y)
  if (square === null) return null
  const entries = TILE_ICONS[square.assetId]
  if (entries === undefined) return null
  const here = entries.filter((entry) => entry.row === square.row && entry.column === square.column)
  return {
    resource: here.find((entry) => entry.resource !== undefined)?.resource,
    culture: here.reduce((total, entry) => total + (entry.culture ?? 0), 0),
    trade: here.reduce((total, entry) => total + (entry.trade ?? 0), 0),
  }
}

/** The icons of a map square given as column and row, as `squareIconsAt`. */
export const squareIconsOfCell = (board: Board, cell: { readonly column: number; readonly row: number }): SquareIcons | null =>
  squareIconsAt(
    board,
    (cell.column + 0.5) * board.squareSize,
    mapTop(board) + (cell.row + 0.5) * board.squareSize,
  )
