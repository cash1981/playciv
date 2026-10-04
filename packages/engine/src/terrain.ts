/**
 * Terrain of the map squares, and which buildings belong on which terrain.
 *
 * The terrain is not in any manifest: it lives only in the tile images, so
 * `data/tile-terrain.json` records it by hand, four rows of four names per tile
 * in the printed orientation. A tile on the board may be turned, so the lookup
 * undoes the rotation first.
 *
 * Only a warning is derived from this. Nothing here refuses a placement; the
 * rulebook table is a soft rule (issue #255).
 */

import tileTerrain from '../data/tile-terrain.json' with { type: 'json' }

import { TILE_SQUARES, findBoardAsset, mapTop } from './board.js'
import type { Board, BoardPiece } from './board.js'

export const TERRAINS = ['water', 'grassland', 'forest', 'mountain', 'desert'] as const

export type Terrain = (typeof TERRAINS)[number]

interface TileTerrainFile {
  readonly tiles: Readonly<Record<string, readonly (readonly Terrain[])[]>>
}

const TILE_TERRAIN: TileTerrainFile['tiles'] = (tileTerrain as TileTerrainFile).tiles

/** The 4 x 4 terrain grid of a tile asset in its printed orientation, if it has data. */
export function tileTerrainGrid(assetId: string): readonly (readonly Terrain[])[] | undefined {
  return TILE_TERRAIN[assetId]
}

const isTile = (piece: BoardPiece): boolean => piece.category === 'tile' || piece.category === 'civtile'

/**
 * The terrain of the printed square that ends up at (row, column) of the tile as
 * displayed, with `rotation` degrees clockwise. Turning the tile clockwise moves
 * its left column to the top, so the displayed square comes from:
 *   90:  (last - column, row)    180: (last - row, last - column)    270: (column, last - row)
 */
function printedSquare(
  row: number,
  column: number,
  rotation: BoardPiece['rotation'],
): readonly [row: number, column: number] {
  const last = TILE_SQUARES - 1
  switch (rotation) {
    case 90:
      return [last - column, row]
    case 180:
      return [last - row, last - column]
    case 270:
      return [column, last - row]
    default:
      return [row, column]
  }
}

/**
 * The terrain of the map square under board point (x, y). `null` when there is
 * no tile under it, the tile has no data (the tile back), or the point is not
 * on the map: like `squareOf`, a point in the hole or outside a stepped board,
 * where no slot covers it, has no terrain. When tiles overlap, the topmost one wins.
 */
export function terrainAt(board: Board, x: number, y: number): Terrain | null {
  const column = Math.floor(x / board.squareSize)
  const row = Math.floor((y - mapTop(board)) / board.squareSize)
  const onSlot = board.slots.some(
    (slot) =>
      column >= slot.x &&
      column < slot.x + TILE_SQUARES &&
      row >= slot.y &&
      row < slot.y + TILE_SQUARES,
  )
  if (!onSlot) return null

  // The list is the stacking order, so the last match is on top (no findLast in ES2022).
  const tile = [...board.pieces]
    .reverse()
    .find(
      (piece) =>
        isTile(piece) &&
        x >= piece.x &&
        x < piece.x + piece.width &&
        y >= piece.y &&
        y < piece.y + piece.height,
    )
  if (tile === undefined) return null

  const grid = TILE_TERRAIN[tile.assetId]
  if (grid === undefined) return null

  const [printedRow, printedColumn] = printedSquare(
    Math.floor((y - tile.y) / board.squareSize),
    Math.floor((x - tile.x) / board.squareSize),
    tile.rotation,
  )
  return grid[printedRow]?.[printedColumn] ?? null
}

const NOT_WATER: readonly Terrain[] = ['grassland', 'forest', 'mountain', 'desert']

/**
 * Where each building may stand, from the "Buildings, terrains allowed" table on
 * p. 16 of the base rulebook. The table has no row for the navy buildings; issue
 * #255 puts Shipyard and Military dock on water with the Harbor. "One per city"
 * is not checked.
 */
export const BUILDING_TERRAIN: Readonly<Record<string, readonly Terrain[]>> = {
  'buildings/harbor': ['water'],
  'buildings/shipyard': ['water'],
  'buildings/militarydock': ['water'],
  'buildings/tradingpost': ['desert'],
  'buildings/workshop': ['mountain'],
  'buildings/ironmine': ['mountain'],
  'buildings/library': ['grassland'],
  'buildings/university': ['grassland'],
  'buildings/granary': ['grassland'],
  'buildings/aqueduct': ['grassland'],
  'buildings/market': NOT_WATER,
  'buildings/bank': NOT_WATER,
  'buildings/temple': NOT_WATER,
  'buildings/cathedral': NOT_WATER,
  'buildings/barracks': NOT_WATER,
  'buildings/academy': NOT_WATER,
}

export interface TerrainWarning {
  /** The terrain the piece would stand on. */
  readonly terrain: Terrain
  readonly allowed: readonly Terrain[]
  /** A plain sentence, ready to show to a player. */
  readonly message: string
}

const describeAllowed = (allowed: readonly Terrain[]): string => {
  if (allowed.length === NOT_WATER.length && !allowed.includes('water')) return 'any terrain except water'
  return allowed.join(' or ')
}

const withArticle = (label: string): string => `${/^[aeiou]/i.test(label) ? 'An' : 'A'} ${label}`

/**
 * Whether a building whose centre is at (centreX, centreY) is on terrain its
 * rule does not allow. `null` when it is fine, when the terrain is unknown, or
 * when the asset has no rule (every piece that is not one of the listed buildings).
 */
export function terrainWarning(
  board: Board,
  assetId: string,
  centreX: number,
  centreY: number,
): TerrainWarning | null {
  const allowed = BUILDING_TERRAIN[assetId]
  if (allowed === undefined) return null

  const terrain = terrainAt(board, centreX, centreY)
  if (terrain === null || allowed.includes(terrain)) return null

  const label = findBoardAsset(assetId)?.label ?? assetId.split('/').at(-1) ?? assetId
  return {
    terrain,
    allowed,
    message: `${withArticle(label)} is meant for ${describeAllowed(allowed)}, but this square is ${terrain}.`,
  }
}
