/**
 * Terrain of the map squares, and the buildings that belong on each (issue #255).
 */

import { describe, expect, it } from 'vitest'

import tileTerrain from '../data/tile-terrain.json' with { type: 'json' }

import {
  BOARD_ASSETS,
  ROTATIONS,
  SQUARE_SIZE,
  TILE_SQUARES,
  areaBandTop,
  boardAssetsByCategory,
  boardWidth,
  createBoard,
  createBoardForPlayers,
  mapHeight,
  mapTop,
  slotOrigin,
  wondersArea,
} from '../src/board.js'
import type { Board, BoardPiece, Rotation } from '../src/board.js'
import { BUILDING_TERRAIN, TERRAINS, terrainAt, terrainWarning, tileTerrainGrid } from '../src/terrain.js'
import type { Terrain } from '../src/terrain.js'

const tilePiece = (
  assetId: string,
  x: number,
  y: number,
  rotation: Rotation = 0,
  category: BoardPiece['category'] = 'tile',
): BoardPiece => ({
  id: `${assetId}-${x}-${y}-${rotation}`,
  assetId,
  path: `${assetId}.png`,
  label: assetId,
  category,
  x,
  y,
  width: TILE_SQUARES * SQUARE_SIZE,
  height: TILE_SQUARES * SQUARE_SIZE,
  rotation,
  placedBy: null,
})

/** A four-player board with the given tiles in its first slot (or where they say). */
const boardWith = (...pieces: readonly BoardPiece[]): Board => ({ ...createBoard(), pieces })

const originOfFirstSlot = (board: Board): readonly [number, number] => {
  const slot = board.slots[0]
  if (slot === undefined) throw new Error('board has no slots')
  return slotOrigin(board, slot)
}

/** Centre of the displayed square (row, column) of a tile whose corner is (x, y). */
const centreOf = (x: number, y: number, row: number, column: number): readonly [number, number] => [
  x + column * SQUARE_SIZE + SQUARE_SIZE / 2,
  y + row * SQUARE_SIZE + SQUARE_SIZE / 2,
]

type Grid = readonly (readonly Terrain[])[]

/** Turns a grid a quarter turn clockwise: the left column becomes the top row. */
const turnClockwise = (grid: Grid): Grid =>
  grid.map((_, row) => grid.map((__, column) => (grid[grid.length - 1 - column] as readonly Terrain[])[row] as Terrain))

const turned = (grid: Grid, rotation: Rotation): Grid => {
  let result = grid
  for (let quarter = 0; quarter < rotation / 90; quarter++) result = turnClockwise(result)
  return result
}

describe('terrainAt', () => {
  // England has no symmetry under any quarter turn, so a wrong mapping shows up.
  const tileId = 'tiles/England'
  const printed = tileTerrainGrid(tileId) as Grid

  it('England really is asymmetric, so the rotation tests below can fail', () => {
    const grids = ROTATIONS.map((rotation) => JSON.stringify(turned(printed, rotation)))
    expect(new Set(grids).size).toBe(4)
  })

  it('turned 90 degrees clockwise, the displayed top left is the printed bottom left', () => {
    // A fixed anchor for the direction of the turn, read from tile-terrain.json
    // (England, bottom row, first square), so the loop below does not only repeat the formula.
    expect((tileTerrain.tiles['tiles/England'] as string[][])[3]?.[0]).toBe('grassland')
    const empty = createBoard()
    const [tileX, tileY] = originOfFirstSlot(empty)
    const board = boardWith(tilePiece(tileId, tileX, tileY, 90, 'civtile'))
    const [x, y] = centreOf(tileX, tileY, 0, 0)
    expect(terrainAt(board, x, y)).toBe('grassland')
    // Turned the other way it is the printed top right, which is water.
    const other = boardWith(tilePiece(tileId, tileX, tileY, 270, 'civtile'))
    expect(terrainAt(other, x, y)).toBe('water')
  })

  for (const rotation of ROTATIONS) {
    it(`reads every square of a tile turned ${rotation} degrees`, () => {
      const empty = createBoard()
      const [tileX, tileY] = originOfFirstSlot(empty)
      const board = boardWith(tilePiece(tileId, tileX, tileY, rotation, 'civtile'))
      const expected = turned(printed, rotation)

      for (let row = 0; row < TILE_SQUARES; row++) {
        for (let column = 0; column < TILE_SQUARES; column++) {
          const [x, y] = centreOf(tileX, tileY, row, column)
          expect(terrainAt(board, x, y), `row ${row}, column ${column}`).toBe(expected[row]?.[column])
        }
      }
    })
  }

  it('finds the square from any point inside it, not only its centre', () => {
    const empty = createBoard()
    const [tileX, tileY] = originOfFirstSlot(empty)
    const board = boardWith(tilePiece(tileId, tileX, tileY))
    const edge = SQUARE_SIZE - 1

    expect(terrainAt(board, tileX, tileY)).toBe(printed[0]?.[0])
    expect(terrainAt(board, tileX + edge, tileY + edge)).toBe(printed[0]?.[0])
    expect(terrainAt(board, tileX + SQUARE_SIZE, tileY)).toBe(printed[0]?.[1])
    expect(terrainAt(board, tileX + 4 * SQUARE_SIZE - 1, tileY + 4 * SQUARE_SIZE - 1)).toBe(printed[3]?.[3])
  })

  it('uses the tile on top when two overlap', () => {
    const empty = createBoard()
    const [tileX, tileY] = originOfFirstSlot(empty)
    // Aztec and England differ in the top left square (forest against water),
    // so the answer says which of the two was read.
    const aztec = tileTerrainGrid('tiles/Aztec') as Grid
    const england = printed
    expect(aztec[0]?.[0]).not.toBe(england[0]?.[0])

    const [x, y] = centreOf(tileX, tileY, 0, 0)
    const aztecOnTop = boardWith(tilePiece(tileId, tileX, tileY), tilePiece('tiles/Aztec', tileX, tileY))
    const englandOnTop = boardWith(tilePiece('tiles/Aztec', tileX, tileY), tilePiece(tileId, tileX, tileY))
    expect(terrainAt(aztecOnTop, x, y)).toBe(aztec[0]?.[0])
    expect(terrainAt(englandOnTop, x, y)).toBe(england[0]?.[0])
  })

  it('knows nothing about a point with no tile under it', () => {
    const empty = createBoard()
    const [tileX, tileY] = originOfFirstSlot(empty)
    const board = boardWith(tilePiece(tileId, tileX, tileY))

    // The next slot to the right has no tile.
    const [x, y] = centreOf(tileX + TILE_SQUARES * SQUARE_SIZE, tileY, 0, 0)
    expect(terrainAt(board, x, y)).toBeNull()
    expect(terrainAt(empty, x, y)).toBeNull()
  })

  it('knows nothing about the tile back, which has no data', () => {
    const empty = createBoard()
    const [tileX, tileY] = originOfFirstSlot(empty)
    const board = boardWith(tilePiece('tiles/tileback', tileX, tileY))
    const [x, y] = centreOf(tileX, tileY, 1, 1)
    expect(terrainAt(board, x, y)).toBeNull()
  })

  it('knows nothing about a point off the map, even where a tile lies', () => {
    const empty = createBoard()
    const top = mapTop(empty)
    // A tile dragged above the map, over the culture track, and another past the right edge.
    const aboveMap = boardWith(tilePiece(tileId, 0, top - 2 * SQUARE_SIZE))
    expect(terrainAt(aboveMap, SQUARE_SIZE, top - SQUARE_SIZE)).toBeNull()
    expect(terrainAt(aboveMap, SQUARE_SIZE, top + SQUARE_SIZE)).not.toBeNull()

    const pastRight = boardWith(tilePiece(tileId, boardWidth(empty) - 2 * SQUARE_SIZE, top))
    expect(terrainAt(pastRight, boardWidth(empty) + 10, top + SQUARE_SIZE)).toBeNull()

    const belowMap = boardWith(tilePiece(tileId, 0, top + mapHeight(empty) - 2 * SQUARE_SIZE))
    expect(terrainAt(belowMap, SQUARE_SIZE, top + mapHeight(empty) + 10)).toBeNull()
  })

  it('knows nothing about the hole of a shaped board, as squareOf does not', () => {
    const shaped = createBoardForPlayers(5)
    // A square no slot covers: the shaped boards are not rectangles.
    let hole: readonly [number, number] | undefined
    for (let row = 0; row < shaped.rows; row++) {
      for (let column = 0; column < shaped.columns; column++) {
        const covered = shaped.slots.some(
          (slot) =>
            column >= slot.x && column < slot.x + TILE_SQUARES && row >= slot.y && row < slot.y + TILE_SQUARES,
        )
        if (!covered && hole === undefined) hole = [column, row]
      }
    }
    if (hole === undefined) throw new Error('the five-player board has no hole')

    // A tile left lying in the hole, which has no slot to snap to.
    const x = hole[0] * SQUARE_SIZE
    const y = mapTop(shaped) + hole[1] * SQUARE_SIZE
    const board: Board = { ...shaped, pieces: [tilePiece(tileId, x, y)] }
    expect(terrainAt(board, x + SQUARE_SIZE / 2, y + SQUARE_SIZE / 2)).toBeNull()
  })
})

describe('tile-terrain.json', () => {
  const tiles = (tileTerrain as { tiles: Record<string, unknown> }).tiles
  const tileAssets = BOARD_ASSETS.filter(
    (asset) => asset.category === 'tile' || asset.category === 'civtile',
  )

  it('has a 4 x 4 grid of valid terrain names for every tile except the tile back', () => {
    for (const asset of tileAssets) {
      if (asset.id === 'tiles/tileback') continue
      const grid = tiles[asset.id]
      expect(Array.isArray(grid), `${asset.id} has no entry`).toBe(true)
      expect(grid as unknown[], asset.id).toHaveLength(TILE_SQUARES)
      for (const row of grid as unknown[]) {
        expect(row as unknown[], asset.id).toHaveLength(TILE_SQUARES)
        for (const terrain of row as unknown[]) {
          expect(TERRAINS as readonly unknown[], `${asset.id}: ${String(terrain)}`).toContain(terrain)
        }
      }
    }
  })

  it('has no entry for the tile back, and none for an id that is not a tile asset', () => {
    expect(tiles['tiles/tileback']).toBeUndefined()
    const ids = new Set(tileAssets.map((asset) => asset.id))
    for (const id of Object.keys(tiles)) {
      expect(ids.has(id), `${id} is not a tile or civtile asset`).toBe(true)
    }
  })
})

describe('BUILDING_TERRAIN', () => {
  const allowedFor = (id: string): readonly Terrain[] | undefined => BUILDING_TERRAIN[`buildings/${id}`]

  it('puts the harbor and the navy buildings on water only', () => {
    for (const id of ['harbor', 'shipyard', 'militarydock']) expect(allowedFor(id), id).toEqual(['water'])
  })

  it('puts the trading post on desert only', () => {
    expect(allowedFor('tradingpost')).toEqual(['desert'])
  })

  it('puts the workshop and the iron mine on mountain only', () => {
    for (const id of ['workshop', 'ironmine']) expect(allowedFor(id), id).toEqual(['mountain'])
  })

  it('puts the library, university, granary and aqueduct on grassland only', () => {
    for (const id of ['library', 'university', 'granary', 'aqueduct']) {
      expect(allowedFor(id), id).toEqual(['grassland'])
    }
  })

  it('lets the market, bank, temple, cathedral, barracks and academy stand anywhere but water', () => {
    for (const id of ['market', 'bank', 'temple', 'cathedral', 'barracks', 'academy']) {
      const allowed = allowedFor(id)
      expect([...(allowed ?? [])].sort(), id).toEqual(['desert', 'forest', 'grassland', 'mountain'])
    }
  })

  it('has a rule for every building in the manifest, and only for buildings that exist', () => {
    const ids = boardAssetsByCategory('building').map((asset) => asset.id).sort()
    expect(Object.keys(BUILDING_TERRAIN).sort()).toEqual(ids)
  })
})

describe('terrainWarning', () => {
  // Aztec has every terrain; each is found by search so a corrected square does not break the test.
  const tileId = 'tiles/Aztec'
  const grid = tileTerrainGrid(tileId) as Grid
  const empty = createBoard()
  const [tileX, tileY] = originOfFirstSlot(empty)
  const board = boardWith(tilePiece(tileId, tileX, tileY))

  const squareWith = (terrain: Terrain): readonly [number, number] => {
    for (let row = 0; row < TILE_SQUARES; row++) {
      const column = grid[row]?.indexOf(terrain) ?? -1
      if (column >= 0) return centreOf(tileX, tileY, row, column)
    }
    throw new Error(`${tileId} has no ${terrain} square`)
  }
  // `building` is a name under buildings/, or a path starting with ../ for another folder.
  const warn = (building: string, terrain: Terrain) => {
    const [x, y] = squareWith(terrain)
    const id = building.startsWith('../') ? building.slice(3) : `buildings/${building}`
    return terrainWarning(board, id, x, y)
  }

  it('says nothing for a building on terrain its rule allows', () => {
    expect(warn('harbor', 'water')).toBeNull()
    expect(warn('shipyard', 'water')).toBeNull()
    expect(warn('militarydock', 'water')).toBeNull()
    expect(warn('tradingpost', 'desert')).toBeNull()
    expect(warn('workshop', 'mountain')).toBeNull()
    expect(warn('ironmine', 'mountain')).toBeNull()
    for (const id of ['library', 'university', 'granary', 'aqueduct']) expect(warn(id, 'grassland'), id).toBeNull()
    for (const id of ['market', 'bank', 'temple', 'cathedral', 'barracks', 'academy']) {
      for (const terrain of ['grassland', 'forest', 'mountain', 'desert'] as const) {
        expect(warn(id, terrain), `${id} on ${terrain}`).toBeNull()
      }
    }
  })

  it('warns about a Library on forest, with the terrain it was on and the ones it wants', () => {
    const warning = warn('library', 'forest')
    expect(warning).toEqual({
      terrain: 'forest',
      allowed: ['grassland'],
      message: 'A Library is meant for grassland, but this square is forest.',
    })
  })

  it('warns about every rule group on a terrain outside it', () => {
    expect(warn('harbor', 'grassland')?.terrain).toBe('grassland')
    expect(warn('shipyard', 'desert')).not.toBeNull()
    expect(warn('militarydock', 'forest')).not.toBeNull()
    expect(warn('tradingpost', 'water')).not.toBeNull()
    expect(warn('workshop', 'grassland')).not.toBeNull()
    expect(warn('ironmine', 'water')).not.toBeNull()
    for (const id of ['university', 'granary', 'aqueduct']) expect(warn(id, 'mountain'), id).not.toBeNull()
  })

  it('warns about a Market, and the other upgrades of its group, on water', () => {
    for (const id of ['market', 'bank', 'temple', 'cathedral', 'barracks', 'academy']) {
      expect(warn(id, 'water'), id).not.toBeNull()
    }
    expect(warn('market', 'water')?.message).toBe(
      'A Market is meant for any terrain except water, but this square is water.',
    )
    // "An" before a vowel.
    expect(warn('academy', 'water')?.message).toBe(
      'An Academy is meant for any terrain except water, but this square is water.',
    )
  })

  it('says nothing where the terrain is unknown', () => {
    const [x, y] = centreOf(tileX + TILE_SQUARES * SQUARE_SIZE, tileY, 0, 0)
    expect(terrainWarning(board, 'buildings/library', x, y)).toBeNull()
    const back = boardWith(tilePiece('tiles/tileback', tileX, tileY))
    expect(terrainWarning(back, 'buildings/library', ...centreOf(tileX, tileY, 0, 0))).toBeNull()
  })

  it('says nothing for a piece with no rule', () => {
    const [x, y] = squareWith('water')
    expect(terrainWarning(board, 'nonsense', x, y)).toBeNull()
    // Only buildings, wonders and Great People have a rule; every other category is free.
    const ruled = new Set(['building', 'wonder', 'greatperson'])
    for (const asset of BOARD_ASSETS.filter((candidate) => !ruled.has(candidate.category))) {
      expect(terrainWarning(board, asset.id, x, y), asset.id).toBeNull()
    }
  })

  it('warns about a wonder on water, by name, and not on any other terrain', () => {
    expect(warn('../wonders/pyramids', 'water')).toEqual({
      terrain: 'water',
      allowed: ['grassland', 'forest', 'mountain', 'desert'],
      message: 'The Pyramids is meant for any terrain except water, but this square is water.',
    })
    // A wonder without "The" in its name reads the same way.
    expect(warn('../wonders/bigben', 'water')?.message).toBe(
      'Big Ben is meant for any terrain except water, but this square is water.',
    )
    for (const terrain of ['grassland', 'forest', 'mountain', 'desert'] as const) {
      expect(warn('../wonders/pyramids', terrain), terrain).toBeNull()
    }
  })

  it('warns about every wonder and every Great Person on water, with no id list', () => {
    const [x, y] = squareWith('water')
    for (const asset of [...boardAssetsByCategory('wonder'), ...boardAssetsByCategory('greatperson')]) {
      expect(terrainWarning(board, asset.id, x, y)?.terrain, asset.id).toBe('water')
    }
  })

  it('warns about a Great Person on water, and not on desert', () => {
    expect(warn('../great people/general', 'water')?.message).toBe(
      'A General is meant for any terrain except water, but this square is water.',
    )
    expect(warn('../great people/general', 'desert')).toBeNull()
    expect(warn('../great people/artist', 'water')?.message).toBe(
      'An Artist is meant for any terrain except water, but this square is water.',
    )
  })

  it('never warns about a wonder in the Wonders area or any piece in a player area', () => {
    // A water tile left lying under those areas must not matter either: they are not map squares.
    const area = wondersArea(board)
    const inWondersArea: readonly [number, number] = [area.x + area.width / 2, area.y + area.height / 2]
    const inPlayerBand: readonly [number, number] = [SQUARE_SIZE * 2, areaBandTop(board) + SQUARE_SIZE]
    const stray = boardWith(
      tilePiece(tileId, inWondersArea[0] - SQUARE_SIZE, inWondersArea[1] - SQUARE_SIZE),
      tilePiece(tileId, inPlayerBand[0] - SQUARE_SIZE, inPlayerBand[1] - SQUARE_SIZE),
    )
    for (const id of ['wonders/pyramids', 'great people/general', 'buildings/market', 'buildings/library']) {
      expect(terrainWarning(board, id, ...inWondersArea), id).toBeNull()
      expect(terrainWarning(board, id, ...inPlayerBand), id).toBeNull()
      expect(terrainWarning(stray, id, ...inWondersArea), id).toBeNull()
      expect(terrainWarning(stray, id, ...inPlayerBand), id).toBeNull()
    }
  })
})
