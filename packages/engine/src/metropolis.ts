/**
 * Growing the capital into a metropolis (Agriculture): where the second city square can go, and why a direction cannot.
 *
 * A metropolis covers two city squares along its long axis: the capital's own square and the neighbouring square north,
 * west, east or south of it. This module only works out which of the four neighbours is legal and where the marker's
 * pixels then lie; the action itself is `assisted-agriculture.ts`. Pure and read-only, and it reads the public board only,
 * so the web works out the same list from the projection.
 *
 * The rules it follows are the Agriculture rulings 116 to 128 and the founding rules already in `city-founding.ts`:
 * - The new squares are the capital's square plus the neighbour, and every square around the neighbour must be on the map
 *   and revealed (as for any city), the neighbour not water.
 * - No hut (except for the Zulu, ruling 108), village or city-state in the new outskirts or on the new square (ruling 118),
 *   and no other city's centre within three squares of the new square, so the outskirts do not overlap (ruling 118).
 *   An unclaimed relic in the new outskirts also stops growth (human, 2026-11-16).
 * - No enemy figure on the new square (ruling 120). An enemy figure in the outskirts does not stop it (ruling 121).
 * Friendly figures move together to a valid neighbouring outskirts square (122); buildings and wonders are destroyed,
 * and Great Persons go into reserve (125 to 127).
 */

import { cityCenterCells, mapCellOf, pieceColorOf } from './blockade.js'
import type { Cell } from './blockade.js'
import { findBoardAsset, isMapCell, mapTop } from './board.js'
import type { Board, BoardPiece, Rotation } from './board.js'
import { squareLabel, WATER_TECHS } from './build-options.js'
import { isOwnFigure } from './city-founding.js'
import { figuresAt, occupancyOf } from './movement.js'
import type { GameState, Playerhand } from './state.js'
import { terrainAt } from './terrain.js'

export const GROW_DIRECTIONS = ['north', 'west', 'east', 'south'] as const
export type GrowDirection = (typeof GROW_DIRECTIONS)[number]

export const isGrowDirection = (value: unknown): value is GrowDirection =>
  typeof value === 'string' && (GROW_DIRECTIONS as readonly string[]).includes(value)

const STEP: Readonly<Record<GrowDirection, Cell>> = {
  north: { column: 0, row: -1 },
  west: { column: -1, row: 0 },
  east: { column: 1, row: 0 },
  south: { column: 0, row: 1 },
}

/** One direction the capital could grow in: the second city square, the marker's new look, and what stands in the way. */
export interface MetropolisGrowth {
  readonly direction: GrowDirection
  readonly ok: boolean
  /** Everything that stands in the way, as sentences. Empty when `ok`. */
  readonly reasons: readonly string[]
  /** The second city square, numbers and label (it may be off the map). */
  readonly cell: Cell
  readonly square: string
  /** The metropolis marker: the asset (walled when the capital is), where its centre lies and its turn. */
  readonly assetId: string
  readonly centre: { readonly x: number; readonly y: number }
  readonly rotation: Rotation
  /** Huts a Zulu metropolis has in its new outskirts (explored by hand); empty for everyone else. */
  readonly zuluHuts: readonly string[]
  readonly overbuilt: readonly BoardPiece[]
}

type Scene = Pick<GameState, 'board' | 'players'>
type Grower = Pick<Playerhand, 'color' | 'civilization'>

const HUT_ASSET = 'resources/hut'
const VILLAGE_ASSET = 'resources/village'

/** The asset of the metropolis that replaces a capital marker, walled when the capital is (`cities/redcapitalwalled2` to `cities/redmetropoliswalled2`). */
export const metropolisAssetIdOf = (capitalAssetId: string): string | undefined =>
  capitalAssetId.includes('capital') ? capitalAssetId.replace('capital', 'metropolis') : undefined

/**
 * The player's capital marker on the map, the one that can still grow: not a metropolis, which is the capital grown, and not a
 * marker off the map. `undefined` when there is none.
 */
export function growableCapital(scene: Scene, grower: Pick<Playerhand, 'color'>): BoardPiece | undefined {
  const colour = grower.color?.toLowerCase()
  if (colour === undefined) return undefined
  return scene.board.pieces.find(
    (piece) =>
      piece.category === 'city' &&
      pieceColorOf(piece) === colour &&
      piece.assetId.includes('capital') &&
      mapCellOf(scene.board, piece) !== null,
  )
}

const sameCell = (a: Cell, b: Cell): boolean => a.column === b.column && a.row === b.row

function around(cell: Cell): readonly Cell[] {
  const cells: Cell[] = []
  for (let row = -1; row <= 1; row += 1) {
    for (let column = -1; column <= 1; column += 1) cells.push({ column: cell.column + column, row: cell.row + row })
  }
  return cells
}

/** The centre of a square, in board pixels. */
const centreOf = (board: Board, cell: Cell): { readonly x: number; readonly y: number } => ({
  x: (cell.column + 0.5) * board.squareSize,
  y: mapTop(board) + (cell.row + 0.5) * board.squareSize,
})

const terrainOfCell = (board: Board, cell: Cell) => {
  const centre = centreOf(board, cell)
  return terrainAt(board, centre.x, centre.y)
}

/** Valid outskirts squares adjacent to the growing square, for the entire displaced group (ruling 122). */
export function metropolisFigureTargets(
  board: Board,
  grower: Grower & Pick<Playerhand, 'techsChosen'>,
  capital: BoardPiece,
  second: Cell,
  stackingLimit: number,
  forbidden: readonly Cell[] = [],
): readonly (Cell & { readonly label: string })[] {
  const figures = figuresAt(board, grower, second)
  if (figures.length === 0) return []
  const home = mapCellOf(board, capital)
  const occupancy = occupancyOf(board, grower)
  const water = grower.techsChosen.some((tech) => !tech.hidden && WATER_TECHS.includes(tech.name))
  const scout = figures.some((piece) => piece.assetId.endsWith('scout'))
  return around(second)
    .filter((cell) => {
      if (sameCell(cell, second) || (home !== null && sameCell(cell, home))) return false
      if (!isMapCell(board, cell.column, cell.row) || forbidden.some((other) => sameCell(cell, other))) return false
      const terrain = terrainOfCell(board, cell)
      if (terrain === null || (terrain === 'water' && !water)) return false
      const key = `${cell.column},${cell.row}`
      if ((occupancy.own.get(key) ?? 0) + figures.length > stackingLimit) return false
      if (scout && occupancy.foreign.has(key)) return false
      return !board.pieces.some((piece) => {
        const at = mapCellOf(board, piece)
        if (at === null || !sameCell(at, cell)) return false
        return piece.category === 'city' || piece.category === 'citystate' || piece.category === 'relic' ||
          piece.assetId === HUT_ASSET || piece.assetId === VILLAGE_ASSET
      })
    })
    .map((cell) => ({ ...cell, label: squareLabel(cell) }))
}

/**
 * Where the metropolis marker lies when the second square is `second`: its centre on the boundary between the two squares,
 * one pixel towards the capital's square so that the capital's square stays the anchor (`cityCenterCells` reads the square
 * that holds the centre first). Everything that is kept on the anchor centre, such as a Building Program marker, and the
 * name of the city ("Metropolis B3") stay where they were.
 */
function layOut(board: Board, capitalCell: Cell, direction: GrowDirection): { readonly x: number; readonly y: number; readonly rotation: Rotation } {
  const size = board.squareSize
  const top = mapTop(board)
  const here = centreOf(board, capitalCell)
  switch (direction) {
    case 'east':
      return { x: (capitalCell.column + 1) * size - 1, y: here.y, rotation: 0 }
    case 'west':
      return { x: capitalCell.column * size, y: here.y, rotation: 0 }
    case 'south':
      return { x: here.x, y: top + (capitalCell.row + 1) * size - 1, rotation: 90 }
    case 'north':
      return { x: here.x, y: top + capitalCell.row * size, rotation: 90 }
  }
}

/**
 * The four directions the capital could grow in, in `GROW_DIRECTIONS` order, each with the reasons it cannot. Empty when the
 * piece is not a capital marker on the map.
 */
export function metropolisGrowthsOf(scene: Scene, grower: Grower, capital: BoardPiece): readonly MetropolisGrowth[] {
  const board = scene.board
  const capitalCell = mapCellOf(board, capital)
  const assetId = metropolisAssetIdOf(capital.assetId)
  const asset = assetId === undefined ? undefined : findBoardAsset(assetId)
  if (capitalCell === null || assetId === undefined || asset === undefined) return []
  const isZulu = grower.civilization?.name === 'Zulu'

  const piecesAt = (target: Cell): readonly BoardPiece[] =>
    board.pieces.filter((piece) => {
      const at = mapCellOf(board, piece)
      return at !== null && sameCell(at, target)
    })
  const otherCities = board.pieces.filter((piece) => piece.category === 'city' && piece.id !== capital.id)

  return GROW_DIRECTIONS.map((direction): MetropolisGrowth => {
    const step = STEP[direction]
    const second = { column: capitalCell.column + step.column, row: capitalCell.row + step.row }
    const square = squareLabel(second)
    const reasons: string[] = []
    const lay = layOut(board, capitalCell, direction)

    // The marker has to lie on exactly the capital's square and the second one, or the city would be somewhere else
    const placed = { ...capital, assetId, x: lay.x - asset.width / 2, y: lay.y - asset.height / 2, width: asset.width, height: asset.height, rotation: lay.rotation }
    const centres = cityCenterCells(board, placed) ?? []
    if (centres.length !== 2 || !centres.some((cell) => sameCell(cell, capitalCell)) || !centres.some((cell) => sameCell(cell, second))) {
      reasons.push('The metropolis marker would not lie on the capital and the square to the ' + direction + '.')
    }

    // As for any city: the square is land and all eight squares around it are on the map and revealed
    const ring = around(second)
    if (isMapCell(board, second.column, second.row) && terrainOfCell(board, second) === 'water') {
      reasons.push(`${square} is a water square.`)
    }
    if (ring.some((cell) => !isMapCell(board, cell.column, cell.row) || terrainOfCell(board, cell) === null)) {
      reasons.push(`${square} is at the edge of the map or next to a facedown tile: a metropolis needs the squares around both its city squares on the map and revealed.`)
    }

    // The squares the metropolis adds to the capital's: the new city square and the outskirts around it that the capital did not have
    const oldRing = around(capitalCell)
    const added = ring.filter((cell) => !oldRing.some((old) => sameCell(old, cell)))
    const looked = [second, ...added]

    const huts: string[] = []
    const villages: string[] = []
    const cityStates: string[] = []
    const relics: string[] = []
    for (const cell of looked) {
      for (const piece of piecesAt(cell)) {
        if (piece.assetId === HUT_ASSET) huts.push(squareLabel(cell))
        if (piece.assetId === VILLAGE_ASSET) villages.push(squareLabel(cell))
        if (piece.category === 'citystate') cityStates.push(squareLabel(cell))
        if (piece.category === 'relic') relics.push(squareLabel(cell))
      }
    }
    if (villages.length > 0) reasons.push(`A village would stand in the new outskirts (${villages.join(', ')}). Take it first.`)
    if (huts.length > 0 && !isZulu) reasons.push(`A hut would stand in the new outskirts (${huts.join(', ')}). Take it first.`)
    if (cityStates.length > 0) reasons.push(`A city-state would stand in the new outskirts (${cityStates.join(', ')}).`)
    if (relics.length > 0) reasons.push(`A relic would stand in the new outskirts (${relics.join(', ')}).`)

    // The outskirts of another city must not overlap: no other city centre within three squares of the new square
    const close = otherCities.flatMap((piece) =>
      (cityCenterCells(board, piece) ?? []).filter(
        (centre) => Math.max(Math.abs(centre.column - second.column), Math.abs(centre.row - second.row)) < 3,
      ),
    )
    if (close.length > 0) {
      reasons.push(`${square} is less than three squares from the city at ${[...new Set(close.map(squareLabel))].join(', ')}, so their outskirts would overlap.`)
    }

    // Friendly figures and overbuilt pieces are handled by the action; enemy figures forbid growth.
    const onSquare = piecesAt(second)
    if (onSquare.some((piece) => piece.category === 'figure' && !isOwnFigure(scene, grower, piece))) {
      reasons.push(`An enemy figure stands on ${square}.`)
    }
    return {
      direction,
      ok: reasons.length === 0,
      reasons,
      cell: second,
      square,
      assetId,
      centre: { x: lay.x, y: lay.y },
      rotation: lay.rotation,
      zuluHuts: isZulu ? [...new Set(huts)] : [],
      overbuilt: onSquare.filter((piece) => piece.category === 'building' || piece.category === 'wonder' || piece.category === 'greatperson'),
    }
  })
}
