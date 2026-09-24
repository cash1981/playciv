/**
 * Map tiles on the board: corners, orientation and automatic placement.
 *
 * The starting tile of a civilization belongs in the corner of its player with
 * the arrow pointing inwards, and a drawn exploration tile turns up by itself.
 */

import { describe, expect, it } from 'vitest'

import { movePiece, placePiece, rotatePiece, undoLastBoardChange } from '../src/actions/board.js'
import { draw } from '../src/actions/draw.js'
import { endTurn, revealItem } from '../src/actions/player.js'
import { createGame } from '../src/create-game.js'
import {
  SQUARE_SIZE,
  TILE_SQUARES,
  civTileAssetId,
  createBoard,
  createBoardForPlayers,
  findBoardAsset,
  firstFreeSlot,
  locationOf,
  mapTop,
  nearestSlotOrigin,
  squareOf,
  startingCorner,
  tileAssetIdForNumber,
} from '../src/board.js'
import type { BoardPiece } from '../src/board.js'
import { unwrap } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { findPlayer } from '../src/state.js'

import { CASH1981, firstCivGame } from './fixture.js'

/** A stand-in piece for the geometry helpers, which only read its rectangle. */
const pieceAt = (x: number, y: number, category: BoardPiece['category'] = 'figure'): BoardPiece => ({
  id: `${category}-${x}-${y}`,
  assetId: '',
  path: '',
  label: '',
  category,
  x,
  y,
  width: SQUARE_SIZE,
  height: SQUARE_SIZE,
  rotation: 0,
  placedBy: null,
})

const tileAt = (x: number, y: number): BoardPiece => pieceAt(x, y, 'tile')

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
    // Every raw image has the arrow on the bottom edge pointing up, so the top
    // two corners turn a half step to point it down at the middle and the
    // bottom two stay put to point it up
    expect(startingCorner(board, 1)).toEqual({ x: 0, y: top, rotation: 180 })
    expect(startingCorner(board, 2)).toEqual({ x: 1128, y: top, rotation: 180 })
    expect(startingCorner(board, 3)).toEqual({ x: 1128, y: top + 1128, rotation: 0 })
    expect(startingCorner(board, 4)).toEqual({ x: 0, y: top + 1128, rotation: 0 })
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

  it('puts the two-player board in opposite corners, arrows along the long axis', () => {
    // The two-player board is 16 x 8 — two block rows — so player 2 sits in the
    // south-east corner (M5-P8). The arrows run along the long axis and point at
    // each other: east out of the north-west, west out of the south-east.
    const twoPlayer = createBoard(16, 8)
    const twoPlayerTop = mapTop(twoPlayer)
    expect(startingCorner(twoPlayer, 1)).toEqual({ x: 0, y: twoPlayerTop, rotation: 90 })
    expect(startingCorner(twoPlayer, 2)).toEqual({
      x: 1128,
      y: twoPlayerTop + 376,
      rotation: 270,
    })
  })
})

describe('the stepped three-player board', () => {
  const board = createBoardForPlayers(3)
  const top = mapTop(board)

  it('is the ten-slot pyramid from the rulebook', () => {
    expect(board.columns).toBe(16)
    expect(board.rows).toBe(16)
    expect(board.slotStep).toBe(TILE_SQUARES / 2)
    expect(board.slots).toHaveLength(10)
    // Four rows of 4, 3, 2 and 1 slots, each stepped half a tile across
    expect(board.slots.filter((slot) => slot.y === 0).map((slot) => slot.x)).toEqual([6])
    expect(board.slots.filter((slot) => slot.y === 4).map((slot) => slot.x)).toEqual([4, 8])
    expect(board.slots.filter((slot) => slot.y === 8).map((slot) => slot.x)).toEqual([2, 6, 10])
    expect(board.slots.filter((slot) => slot.y === 12).map((slot) => slot.x)).toEqual([
      0, 4, 8, 12,
    ])
  })

  it('seats the players at the top and the two bottom corners, clockwise', () => {
    expect(startingCorner(board, 1)).toEqual({ x: 6 * SQUARE_SIZE, y: top, rotation: 180 })
    expect(startingCorner(board, 2)).toEqual({
      x: 12 * SQUARE_SIZE,
      y: top + 12 * SQUARE_SIZE,
      rotation: 270,
    })
    expect(startingCorner(board, 3)).toEqual({ x: 0, y: top + 12 * SQUARE_SIZE, rotation: 90 })
  })

  it('does not snap a tile dropped outside the steps', () => {
    // The board is 16 x 16, but the top corners are not on the map
    expect(nearestSlotOrigin(board, 0, top)).toBeUndefined()
    expect(nearestSlotOrigin(board, 12 * SQUARE_SIZE, top)).toBeUndefined()
    expect(nearestSlotOrigin(board, 6 * SQUARE_SIZE + 40, top + 40)).toEqual([
      6 * SQUARE_SIZE,
      top,
    ])
  })
})

describe('the five-player board with the hole', () => {
  const board = createBoardForPlayers(5)
  const top = mapTop(board)

  it('is the 28 x 18 map with twenty-two slots and a hole in the middle', () => {
    expect(board.columns).toBe(28)
    expect(board.rows).toBe(18)
    expect(board.slotStep).toBe(TILE_SQUARES / 2)
    expect(board.slots).toHaveLength(22)
    // The hole is one tile wide and one and a half tall: x 12..16, y 8..14
    for (const slot of board.slots) {
      const coversHole =
        slot.x < 16 && slot.x + TILE_SQUARES > 12 && slot.y < 14 && slot.y + TILE_SQUARES > 8
      expect(coversHole, `slot ${slot.x},${slot.y} covers the hole`).toBe(false)
    }
    // The bottom row is half a tile offset and closes the hole
    expect(board.slots.filter((slot) => slot.y === 14).map((slot) => slot.x)).toEqual([
      2, 6, 10, 14, 18, 22,
    ])
  })

  it('seats five players clockwise from the top', () => {
    expect(startingCorner(board, 1)).toEqual({
      x: 12 * SQUARE_SIZE,
      y: top + 4 * SQUARE_SIZE,
      rotation: 180,
    })
    expect(startingCorner(board, 2)).toEqual({
      x: 24 * SQUARE_SIZE,
      y: top + 6 * SQUARE_SIZE,
      rotation: 270,
    })
    expect(startingCorner(board, 3)).toEqual({
      x: 18 * SQUARE_SIZE,
      y: top + 14 * SQUARE_SIZE,
      rotation: 0,
    })
    expect(startingCorner(board, 4)).toEqual({
      x: 6 * SQUARE_SIZE,
      y: top + 14 * SQUARE_SIZE,
      rotation: 0,
    })
    expect(startingCorner(board, 5)).toEqual({
      x: 0,
      y: top + 6 * SQUARE_SIZE,
      rotation: 90,
    })

    // The point of the fix: no two starting tiles share a slot any more
    const seats = [1, 2, 3, 4, 5].map((playernumber) => startingCorner(board, playernumber))
    expect(new Set(seats.map((seat) => `${seat.x},${seat.y}`)).size).toBe(5)
  })

  it('does not snap a tile into the hole or off the map', () => {
    // Dead centre of the hole
    expect(
      nearestSlotOrigin(board, 14 * SQUARE_SIZE, top + 11 * SQUARE_SIZE),
    ).toBeUndefined()
    // Outside the bounding box
    expect(nearestSlotOrigin(board, -SQUARE_SIZE, top)).toBeUndefined()
    // The start slot at the top of the map still snaps
    expect(
      nearestSlotOrigin(board, 12 * SQUARE_SIZE + 40, top + 4 * SQUARE_SIZE + 40),
    ).toEqual([12 * SQUARE_SIZE, top + 4 * SQUARE_SIZE])
  })

  it('leaves a tile dropped over the hole where it was dropped', () => {
    const state = place(
      { ...firstCivGame(), board },
      'tiles/tile01',
      14 * SQUARE_SIZE,
      top + 11 * SQUARE_SIZE,
    )
    const tile = state.board.pieces[0]
    expect([tile?.x, tile?.y]).toEqual([14 * SQUARE_SIZE, top + 11 * SQUARE_SIZE])
  })

  it('draws exploration tiles into free slots, never into the hole', () => {
    expect(firstFreeSlot(board)).toEqual([12 * SQUARE_SIZE, top])

    const taken: typeof board = {
      ...board,
      pieces: [tileAt(12 * SQUARE_SIZE, top), tileAt(8 * SQUARE_SIZE, top + 2 * SQUARE_SIZE)],
    }
    expect(firstFreeSlot(taken)).toEqual([16 * SQUARE_SIZE, top + 2 * SQUARE_SIZE])
  })

  it('says a piece in the hole is off the board', () => {
    const inHole = pieceAt(14 * SQUARE_SIZE, top + 10 * SQUARE_SIZE)
    expect(squareOf(board, inHole)).toBeNull()
    expect(locationOf(board, [], inHole)).toBe('off the board')

    // A playable square still carries its template name
    expect(squareOf(board, pieceAt(12 * SQUARE_SIZE, top + 4 * SQUARE_SIZE))).toBe('M5')
  })
})

describe('firstFreeSlot', () => {
  it('starts in the top left slot', () => {
    const board = createBoard()
    expect(firstFreeSlot(board)).toEqual([0, mapTop(board)])
  })

  it('skips slots that already hold a tile', () => {
    let state = firstCivGame()
    const top = mapTop(state.board)

    state = place(state, 'tiles/tile01', 0, top)
    expect(firstFreeSlot(state.board)).toEqual([376, top])

    state = place(state, 'tiles/tile02', 376, top)
    expect(firstFreeSlot(state.board)).toEqual([752, top])
  })

  it('pays no attention to ordinary pieces', () => {
    const board = createBoard()
    const state = place(firstCivGame(), 'figures/redarmy', 10, mapTop(board) + 10)
    expect(firstFreeSlot(state.board)).toEqual([0, mapTop(board)])
  })
})

describe('snapping a moved tile to the grid', () => {
  it('a tile dropped off-grid on the map lands on the nearest slot origin', () => {
    let state = place(firstCivGame(), 'tiles/tile01', 0, mapTop(createBoard()))
    const piece = state.board.pieces[0]
    if (piece === undefined) throw new Error('no piece')

    // 40 pixels off both axes: within half a block of column 1, row 1
    const target = { x: 376 + 40, y: mapTop(state.board) + 376 + 40 }
    state = unwrap(movePiece(state, { playerId: CASH1981, pieceId: piece.id, x: target.x, y: target.y }))

    const moved = state.board.pieces[0]
    expect([moved?.x, moved?.y]).toEqual(nearestSlotOrigin(state.board, target.x, target.y))
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
    // The top left slot points its arrow down at the middle
    expect(civTiles[0]?.rotation).toBe(180)
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

describe('revealing civilizations, one player at a time (issue #171)', () => {
  // The unit-level tests above cover `startingCorner` in isolation; this
  // exercises the actual reveal flow a game goes through, to prove the fix
  // holds end to end rather than only in the helper it happens to call.
  const playersFor = (numOfPlayers: number) =>
    Array.from({ length: numOfPlayers }, (_unused, index) => ({
      playerId: `player-${index + 1}`,
      username: `Player ${index + 1}`,
      color: 'Red',
      yourTurn: index === 0,
    }))

  it.each([3, 5])(
    'seats every player at a distinct starting tile in a %i-player game',
    (numOfPlayers) => {
      let state = createGame({
        name: `${numOfPlayers}p game`,
        numOfPlayers,
        seed: `issue-171-${numOfPlayers}p`,
        players: playersFor(numOfPlayers),
      })

      for (let turn = 0; turn < numOfPlayers; turn++) {
        const current = state.players.find((player) => player.yourTurn)
        if (current === undefined) throw new Error('no current player')

        state = unwrap(draw(state, { playerId: current.playerId, sheetName: 'CIV' }))
        const civ = findPlayer(state, current.playerId)?.items.find((item) => item.kind === 'civ')
        if (civ?.kind !== 'civ') throw new Error('no civ in the hand')

        state = unwrap(
          revealItem(state, {
            playerId: current.playerId,
            sheetName: 'CIV',
            itemNumber: civ.itemNumber,
          }),
        )

        if (turn < numOfPlayers - 1) state = unwrap(endTurn(state))
      }

      const civTiles = state.board.pieces.filter((piece) => piece.category === 'civtile')
      expect(civTiles).toHaveLength(numOfPlayers)

      // The reported bug: every player after the first landed on player
      // one's slot. A set-size check on (x, y) alone would still pass if two
      // tiles merely landed a few squares apart and visibly overlapped, so
      // this checks the tiles' rectangles do not overlap at all.
      const tileSize = TILE_SQUARES * SQUARE_SIZE
      for (let a = 0; a < civTiles.length; a++) {
        for (let b = a + 1; b < civTiles.length; b++) {
          const first = civTiles[a] as BoardPiece
          const second = civTiles[b] as BoardPiece
          const disjoint =
            first.x + tileSize <= second.x ||
            second.x + tileSize <= first.x ||
            first.y + tileSize <= second.y ||
            second.y + tileSize <= first.y
          expect(disjoint, `${first.assetId} and ${second.assetId} overlap`).toBe(true)
        }
      }
    },
  )
})
