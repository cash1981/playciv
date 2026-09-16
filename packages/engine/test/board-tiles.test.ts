/**
 * Map tiles on the board: corners, orientation and automatic placement.
 *
 * The starting tile of a civilization belongs in the corner of its player with
 * the arrow pointing inwards, and a drawn exploration tile turns up by itself.
 */

import { describe, expect, it } from 'vitest'

import { movePiece, placePiece, rotatePiece, undoLastBoardChange } from '../src/actions/board.js'
import { draw } from '../src/actions/draw.js'
import { revealItem } from '../src/actions/player.js'
import {
  SQUARE_SIZE,
  TILE_SQUARES,
  civTileAssetId,
  createBoard,
  findBoardAsset,
  firstFreeBlock,
  mapTop,
  nearestBlockOrigin,
  startingCorner,
  tileAssetIdForNumber,
} from '../src/board.js'
import { unwrap } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { findPlayer } from '../src/state.js'

import { CASH1981, firstCivGame } from './fixture.js'

const place = (state: GameState, assetId: string, x: number, y: number): GameState =>
  unwrap(placePiece(state, { playerId: CASH1981, assetId, x, y }))

describe('map tiles in the manifest', () => {
  it('holds one starting tile per civilization in the spreadsheet', () => {
    const civs = firstCivGame().items.filter((item) => item.kind === 'civ')
    expect(civs).toHaveLength(16)

    for (const civ of civs) {
      const assetId = civTileAssetId(civ.name)
      expect(assetId, `mangler startbrett for ${civ.name}`).toBeDefined()
      expect(findBoardAsset(assetId as string)).toBeDefined()
    }
  })

  it('covers exactly 4 by 4 squares', () => {
    const tile = findBoardAsset('tiles/japan')
    expect(tile?.width).toBe(TILE_SQUARES * SQUARE_SIZE)
    expect(tile?.height).toBe(TILE_SQUARES * SQUARE_SIZE)
  })

  it('finds exploration tiles by number, across the filename suffixes', () => {
    // The files are named tile01, tile15a, tile22b and Tile26b
    expect(tileAssetIdForNumber(1)).toBe('tiles/tile01')
    expect(tileAssetIdForNumber(15)).toBe('tiles/tile15a')
    expect(tileAssetIdForNumber(22)).toBe('tiles/tile22b')
    expect(tileAssetIdForNumber(27)).toBe('tiles/Tile27b')
  })

  it('covers every tile number in the spreadsheet', () => {
    const tiles = firstCivGame().items.filter((item) => item.kind === 'tile')
    expect(tiles).toHaveLength(27)
    for (const tile of tiles) {
      expect(
        tileAssetIdForNumber(Number(tile.name)),
        `mangler bilde for tile ${tile.name}`,
      ).toBeDefined()
    }
  })
})

describe('startingCorner', () => {
  const board = createBoard()
  // The map hangs below the culture track, so every row is offset by mapTop
  const top = mapTop(board)

  it('gives the four corners with the arrow pointing inwards', () => {
    // The raw image has the arrow pointing down and the capital icon in the
    // top left, so turning clockwise moves both around the edge together
    expect(startingCorner(board, 1)).toEqual({ x: 0, y: top, rotation: 0 })
    expect(startingCorner(board, 2)).toEqual({ x: 1128, y: top, rotation: 90 })
    expect(startingCorner(board, 3)).toEqual({ x: 1128, y: top + 1128, rotation: 180 })
    expect(startingCorner(board, 4)).toEqual({ x: 0, y: top + 1128, rotation: 270 })
  })

  it('player 1 covers A1 to D4', () => {
    const corner = startingCorner(board, 1)
    expect([corner.x, corner.y]).toEqual([0, top])
    // Four squares of 94 pixels
    expect(TILE_SQUARES * SQUARE_SIZE).toBe(376)
  })

  it('player 5 shares a corner with player 1', () => {
    // The template has four corners, so more players have to share
    expect(startingCorner(board, 5)).toEqual(startingCorner(board, 1))
  })
})

describe('firstFreeBlock', () => {
  it('starts in the top left slot', () => {
    const board = createBoard()
    expect(firstFreeBlock(board)).toEqual([0, mapTop(board)])
  })

  it('skips slots that already hold a tile', () => {
    let state = firstCivGame()
    const top = mapTop(state.board)

    state = place(state, 'tiles/tile01', 0, top)
    expect(firstFreeBlock(state.board)).toEqual([376, top])

    state = place(state, 'tiles/tile02', 376, top)
    expect(firstFreeBlock(state.board)).toEqual([752, top])
  })

  it('pays no attention to ordinary pieces', () => {
    const board = createBoard()
    const state = place(firstCivGame(), 'figures/redarmy', 10, mapTop(board) + 10)
    expect(firstFreeBlock(state.board)).toEqual([0, mapTop(board)])
  })
})

describe('snapping a moved tile to the grid', () => {
  it('a tile dropped off-grid on the map lands on the nearest block origin', () => {
    let state = place(firstCivGame(), 'tiles/tile01', 0, mapTop(createBoard()))
    const piece = state.board.pieces[0]
    if (piece === undefined) throw new Error('no piece')

    // 40 pixels off both axes: within half a block of column 1, row 1
    const target = { x: 376 + 40, y: mapTop(state.board) + 376 + 40 }
    state = unwrap(movePiece(state, { playerId: CASH1981, pieceId: piece.id, x: target.x, y: target.y }))

    const moved = state.board.pieces[0]
    expect([moved?.x, moved?.y]).toEqual(nearestBlockOrigin(state.board, target.x, target.y))
  })

  it('an ordinary piece dropped off-grid on the map keeps its exact coordinates', () => {
    let state = place(firstCivGame(), 'figures/redarmy', 0, mapTop(createBoard()))
    const piece = state.board.pieces[0]
    if (piece === undefined) throw new Error('no piece')

    const target = { x: 376 + 40, y: mapTop(state.board) + 376 + 40 }
    state = unwrap(movePiece(state, { playerId: CASH1981, pieceId: piece.id, x: target.x, y: target.y }))

    const moved = state.board.pieces[0]
    expect([moved?.x, moved?.y]).toEqual([target.x, target.y])
  })

  it('undo restores the tile to its position before the snapped move', () => {
    let state = place(firstCivGame(), 'tiles/tile01', 0, mapTop(createBoard()))
    const piece = state.board.pieces[0]
    if (piece === undefined) throw new Error('no piece')
    const before = { x: piece.x, y: piece.y }

    const target = { x: 376 + 40, y: mapTop(state.board) + 376 + 40 }
    state = unwrap(movePiece(state, { playerId: CASH1981, pieceId: piece.id, x: target.x, y: target.y }))
    // The move did snap, otherwise the test would not exercise undo of a snap
    expect([state.board.pieces[0]?.x, state.board.pieces[0]?.y]).not.toEqual([target.x, target.y])

    state = unwrap(undoLastBoardChange(state, CASH1981))
    expect([state.board.pieces[0]?.x, state.board.pieces[0]?.y]).toEqual([before.x, before.y])
  })
})

describe('rotation', () => {
  it('new pieces lie unrotated', () => {
    const state = place(firstCivGame(), 'figures/redarmy', 100, 100)
    expect(state.board.pieces[0]?.rotation).toBe(0)
  })

  it('rotatePiece turns a quarter step clockwise, and wraps around', () => {
    let state = place(firstCivGame(), 'tiles/tile01', 0, 0)
    const piece = state.board.pieces[0]
    if (piece === undefined) throw new Error('no piece')

    for (const expected of [90, 180, 270, 0]) {
      state = unwrap(rotatePiece(state, { playerId: CASH1981, pieceId: piece.id }))
      expect(state.board.pieces[0]?.rotation).toBe(expected)
    }
  })

  it('a given direction can be set outright', () => {
    let state = place(firstCivGame(), 'tiles/tile01', 0, 0)
    const piece = state.board.pieces[0]
    if (piece === undefined) throw new Error('no piece')

    state = unwrap(rotatePiece(state, { playerId: CASH1981, pieceId: piece.id, rotation: 180 }))
    expect(state.board.pieces[0]?.rotation).toBe(180)
  })

  it('rotating leaves the piece where it is in the stack', () => {
    let state = firstCivGame()
    state = place(state, 'figures/redarmy', 100, 100)
    state = place(state, 'figures/bluearmy', 100, 100)

    const bottom = state.board.pieces[0]
    if (bottom === undefined) throw new Error('no piece')

    state = unwrap(rotatePiece(state, { playerId: CASH1981, pieceId: bottom.id }))
    expect(state.board.pieces[0]?.id).toBe(bottom.id)
  })
})

describe('automatic placement', () => {
  it('map tiles settle underneath the other pieces', () => {
    let state = firstCivGame()
    state = place(state, 'figures/redarmy', 50, 50)
    state = place(state, 'tiles/tile01', 0, 0)

    // Otherwise the tile would cover the figure standing on it
    expect(state.board.pieces[0]?.category).toBe('tile')
    expect(state.board.pieces.at(-1)?.category).toBe('figure')
  })

  it('a drawn tile lands on the board', () => {
    const after = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'TILES' }))

    const tiles = after.board.pieces.filter((piece) => piece.category === 'tile')
    expect(tiles).toHaveLength(1)
    expect([tiles[0]?.x, tiles[0]?.y]).toEqual([0, mapTop(after.board)])

    // The piece has to match the card that landed in the hand
    const drawn = findPlayer(after, CASH1981)?.items.at(-1)
    if (drawn?.kind !== 'tile') throw new Error('drew something other than a tile')
    expect(tiles[0]?.assetId).toBe(tileAssetIdForNumber(Number(drawn.name)))
  })

  it('several drawn tiles fill the slots in turn', () => {
    let state = firstCivGame()
    for (let i = 0; i < 3; i++) {
      state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'TILES' }))
    }

    // Tiles go to the bottom of the stack, so the list runs the opposite way
    // to the placement. What matters is which slots are filled.
    const tiles = state.board.pieces.filter((piece) => piece.category === 'tile')
    expect(tiles.map((tile) => tile.x).sort((a, b) => a - b)).toEqual([0, 376, 752])
    expect(tiles.every((tile) => tile.y === mapTop(state.board))).toBe(true)
  })

  it('other draws leave the board alone', () => {
    const after = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'HUTS' }))
    expect(after.board.pieces).toHaveLength(0)
  })

  it('revealing a civilization puts its starting tile in the corner of the player', () => {
    let state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'CIV' }))
    const civ = findPlayer(state, CASH1981)?.items.find((item) => item.kind === 'civ')
    if (civ?.kind !== 'civ') throw new Error('no civ in the hand')

    state = unwrap(
      revealItem(state, { playerId: CASH1981, sheetName: 'CIV', itemNumber: civ.itemNumber }),
    )

    const civTiles = state.board.pieces.filter((piece) => piece.category === 'civtile')
    expect(civTiles).toHaveLength(1)
    // cash1981 is player 1 in the fixture, so the top left slot
    expect([civTiles[0]?.x, civTiles[0]?.y]).toEqual([0, mapTop(state.board)])
    expect(civTiles[0]?.rotation).toBe(0)
    expect(civTiles[0]?.assetId).toBe(civTileAssetId(civ.name))
  })

  it('the starting tile is not laid out twice', () => {
    let state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'CIV' }))
    const civ = findPlayer(state, CASH1981)?.items.find((item) => item.kind === 'civ')
    if (civ?.kind !== 'civ') throw new Error('no civ in the hand')

    state = unwrap(
      revealItem(state, { playerId: CASH1981, sheetName: 'CIV', itemNumber: civ.itemNumber }),
    )
    const before = state.board.pieces.filter((piece) => piece.category === 'civtile').length

    // The reveal drew starting units, which may have drawn further civ cards.
    // Either way the same starting tile must not turn up again.
    expect(before).toBe(1)
  })
})
