/**
 * The board.
 *
 * Java had no board model, so there are no old tests to port. The geometry is
 * pinned against `4v4 Map Template.pptx`.
 */

import { describe, expect, it } from 'vitest'

import {
  bringToFront,
  movePiece,
  placePiece,
  removePiece,
  sendToBack,
} from '../src/actions/board.js'
import {
  AREA_LABEL_HEIGHT,
  BOARD_ASSETS,
  COLUMN_LABELS,
  DEFAULT_AREA_ROWS,
  DEFAULT_COLUMNS,
  DEFAULT_ROWS,
  CULTURE_TRACK,
  CULTURE_TRACK_SCALE,
  SQUARE_SIZE,
  WONDERS_AREA_ID,
  areaAt,
  areaBandTop,
  boardAssetLimit,
  boardAreas,
  boardHeight,
  boardWidth,
  createBoard,
  cultureTrackHeight,
  findBoardAsset,
  locationOf,
  mapHeight,
  mapTop,
  piecesAtStep,
  playerAreas,
  remainingBoardAssetCount,
  squareOf,
  wondersArea,
  wondersAreaWidth,
} from '../src/board.js'
import { migrateGameState } from '../src/migrate.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'

import { CASH1981, KARANDRAS1, firstCivGame } from './fixture.js'

const place = (state: GameState, assetId: string, x: number, y: number): GameState =>
  unwrap(placePiece(state, { playerId: CASH1981, assetId, x, y }))

describe('geometry', () => {
  it('is 16 by 16 squares, as in the four-player template', () => {
    expect(DEFAULT_COLUMNS).toBe(16)
    expect(DEFAULT_ROWS).toBe(16)
    expect(COLUMN_LABELS[0]).toBe('A')
    expect(COLUMN_LABELS.at(-1)).toBe('P')
  })

  it('a square is 94 pixels, a 375 pixel map tile divided by four', () => {
    expect(SQUARE_SIZE).toBe(94)
    // The template builds the board from 4 x 4 tiles of 375 x 375
    expect(Math.round(375 / 4)).toBe(SQUARE_SIZE)
  })

  it('the map is 1504 by 1504', () => {
    const board = createBoard()
    expect(boardWidth(board)).toBe(1504)
    expect(mapHeight(board)).toBe(1504)
  })

  it('the culture track sits above the map, a gap apart', () => {
    const board = createBoard()
    // The track is drawn the full width of the map, so its height follows from
    // its own aspect (216 / 2572 of 1504), stretched taller by CULTURE_TRACK_SCALE
    // so the band reads well (issue #22).
    const expected = Math.round(
      (boardWidth(board) * CULTURE_TRACK.height * CULTURE_TRACK_SCALE) / CULTURE_TRACK.width,
    )
    expect(cultureTrackHeight(board)).toBe(expected)
    expect(mapTop(board)).toBe(expected + SQUARE_SIZE)
  })

  it('the surface adds a gap and the player-area band below the map', () => {
    const board = createBoard()
    // track, gap, 1504 map, gap, four squares of player areas
    expect(areaBandTop(board)).toBe(mapTop(board) + 1504 + SQUARE_SIZE)
    expect(boardHeight(board)).toBe(areaBandTop(board) + DEFAULT_AREA_ROWS * SQUARE_SIZE)
  })

  it('a new game starts with an empty board', () => {
    expect(firstCivGame().board.pieces).toHaveLength(0)
  })
})

describe('the manifest', () => {
  it('has pieces in all eleven categories', () => {
    const categories = new Set(BOARD_ASSETS.map((asset) => asset.category))
    expect([...categories].sort()).toEqual([
      'building',
      'city',
      'citystate',
      'civtile',
      'figure',
      'greatperson',
      'leader',
      'marker',
      'resource',
      'tile',
      'wonder',
    ])
  })

  it('has the five neutral city-states', () => {
    const cityStates = BOARD_ASSETS.filter((asset) => asset.category === 'citystate')
    expect(cityStates).toHaveLength(5)
    for (const id of ['cs1', 'cs2', 'cs3', 'cs4', 'cs5']) {
      expect(findBoardAsset(`city-states/${id}`)).toBeDefined()
    }
    // Kept within one square so a city-state sits on the map like a city.
    expect(cityStates.every((asset) => asset.width <= 94 && asset.height <= 94)).toBe(true)
  })

  it('has an army and a scout in all five player colours', () => {
    for (const colour of ['blue', 'green', 'purple', 'red', 'yellow']) {
      expect(findBoardAsset(`figures/${colour}army`)).toBeDefined()
      expect(findBoardAsset(`figures/${colour}scout`)).toBeDefined()
    }
  })

  it('has no white army (removed as unused, issue #26)', () => {
    expect(findBoardAsset('figures/whitearmy')).toBeUndefined()
  })

  it('has the six resources', () => {
    for (const name of ['hut', 'village', 'wheat', 'iron', 'silk', 'incense']) {
      expect(findBoardAsset(`resources/${name}`)).toBeDefined()
    }
  })

  it('uses the physical supply count for every building type', () => {
    const expected: Readonly<Record<string, number>> = {
      'buildings/market': 5,
      'buildings/bank': 5,
      'buildings/temple': 5,
      'buildings/cathedral': 5,
      'buildings/barracks': 5,
      'buildings/academy': 5,
      'buildings/granary': 6,
      'buildings/aqueduct': 6,
      'buildings/library': 6,
      'buildings/university': 6,
      'buildings/workshop': 6,
      'buildings/harbor': 10,
      'buildings/tradingpost': 6,
      'buildings/shipyard': 5,
      'buildings/ironmine': 6,
    }
    for (const [assetId, limit] of Object.entries(expected)) {
      const asset = findBoardAsset(assetId)
      if (asset === undefined) throw new Error(`${assetId} missing from manifest`)
      expect(boardAssetLimit(asset, 4), assetId).toBe(limit)
    }
  })

  it('gives every piece a positive size', () => {
    expect(BOARD_ASSETS.every((asset) => asset.width > 0 && asset.height > 0)).toBe(true)
  })

  it('makes cities and buildings about one square across', () => {
    const city = findBoardAsset('cities/redcity2')
    expect(city?.width).toBeGreaterThan(SQUARE_SIZE * 0.8)
    expect(city?.width).toBeLessThan(SQUARE_SIZE * 1.1)
  })
})

describe('placePiece', () => {
  it('puts the piece on the board at the size from the manifest', () => {
    const state = place(firstCivGame(), 'figures/redarmy', 200, 300)
    const piece = state.board.pieces[0]

    expect(state.board.pieces).toHaveLength(1)
    expect(piece?.assetId).toBe('figures/redarmy')
    expect(piece?.path).toBe('figures/redarmy.png')
    expect(piece?.label).toBe('Red army')
    expect(piece?.width).toBe(33)
    expect(piece?.height).toBe(51)
    expect(piece?.x).toBe(200)
    expect(piece?.y).toBe(300)
    expect(piece?.placedBy).toBe(CASH1981)
  })

  it('rejects a piece that is not in the manifest', () => {
    const error = unwrapErr(
      placePiece(firstCivGame(), { playerId: CASH1981, assetId: '../../etc/passwd', x: 0, y: 0 }),
    )
    expect(error).toEqual({ kind: 'BOARD_ASSET_NOT_FOUND', assetId: '../../etc/passwd' })
  })

  it('rejects a player who is not in the game', () => {
    const error = unwrapErr(
      placePiece(firstCivGame(), { playerId: 'nobody', assetId: 'figures/redarmy', x: 0, y: 0 }),
    )
    expect(error).toEqual({ kind: 'NO_ACCESS', playerId: 'nobody' })
  })

  it('shares five pieces between an upgrade family', () => {
    let state = firstCivGame()
    for (let index = 0; index < 3; index++) state = place(state, 'buildings/barracks', 0, 0)
    for (let index = 0; index < 2; index++) state = place(state, 'buildings/academy', 0, 0)

    const academy = findBoardAsset('buildings/academy')
    if (academy === undefined) throw new Error('academy missing from manifest')
    expect(remainingBoardAssetCount(academy, state.board.pieces, state.numOfPlayers)).toBe(0)
    expect(unwrapErr(placePiece(state, {
      playerId: CASH1981,
      assetId: 'buildings/barracks',
      x: 0,
      y: 0,
    }))).toEqual({ kind: 'BOARD_ASSET_LIMIT_REACHED', assetId: 'buildings/barracks', limit: 5 })
  })

  it('gives Harbor its physical supply of ten', () => {
    let state = firstCivGame()
    for (let index = 0; index < 10; index++) state = place(state, 'buildings/harbor', 0, 0)
    expect(unwrapErr(placePiece(state, {
      playerId: CASH1981,
      assetId: 'buildings/harbor',
      x: 0,
      y: 0,
    }))).toEqual({ kind: 'BOARD_ASSET_LIMIT_REACHED', assetId: 'buildings/harbor', limit: 10 })
  })

  it('limits each resource except hut and village to the number of players', () => {
    for (const assetId of ['resources/wheat', 'resources/iron', 'resources/silk', 'resources/incense']) {
      let state = firstCivGame()
      for (let index = 0; index < 4; index++) state = place(state, assetId, 0, 0)
      expect(unwrapErr(placePiece(state, {
        playerId: CASH1981,
        assetId,
        x: 0,
        y: 0,
      })), assetId).toEqual({ kind: 'BOARD_ASSET_LIMIT_REACHED', assetId, limit: 4 })
    }
  })

  it('leaves huts and villages unlimited (issue #116)', () => {
    for (const assetId of ['resources/hut', 'resources/village']) {
      const asset = findBoardAsset(assetId)
      if (asset === undefined) throw new Error(`${assetId} missing from manifest`)

      // The two-player board is where the bug showed as "Hut (2)".
      expect(boardAssetLimit(asset, 2), assetId).toBeUndefined()

      let state: GameState = { ...firstCivGame(), numOfPlayers: 2 }
      for (let index = 0; index < 6; index++) state = place(state, assetId, 0, 0)
      expect(state.board.pieces, assetId).toHaveLength(6)
      expect(
        remainingBoardAssetCount(asset, state.board.pieces, state.numOfPlayers),
        assetId,
      ).toBeUndefined()
    }
  })

  it('limits each Great Person type to three and removal restores one', () => {
    let state = firstCivGame()
    for (let index = 0; index < 3; index++) state = place(state, 'great people/artist', 0, 0)
    const artist = findBoardAsset('great people/artist')
    if (artist === undefined) throw new Error('artist missing from manifest')
    expect(remainingBoardAssetCount(artist, state.board.pieces, state.numOfPlayers)).toBe(0)

    const piece = state.board.pieces[0]
    if (piece === undefined) throw new Error('artist was not placed')
    state = unwrap(removePiece(state, { playerId: CASH1981, pieceId: piece.id }))
    expect(remainingBoardAssetCount(artist, state.board.pieces, state.numOfPlayers)).toBe(1)
  })

  it('clamps the position to the surface', () => {
    const state = place(firstCivGame(), 'figures/redarmy', -500, 99999)
    const piece = state.board.pieces[0]
    const surface = boardHeight(createBoard())

    expect(piece?.x).toBe(0)
    // Half the piece may hang over the bottom edge
    expect(piece?.y).toBe(surface - 51 / 2)
  })

  it('gives every piece its own id', () => {
    let state = firstCivGame()
    state = place(state, 'figures/redarmy', 0, 0)
    state = place(state, 'figures/redarmy', 0, 0)

    const ids = state.board.pieces.map((piece) => piece.id)
    expect(new Set(ids).size).toBe(2)
  })
})

describe('stacking', () => {
  it('new pieces land on top', () => {
    let state = firstCivGame()
    state = place(state, 'figures/redarmy', 100, 100)
    state = place(state, 'figures/bluearmy', 100, 100)

    // The order of pieces IS the stacking order
    expect(state.board.pieces.map((piece) => piece.assetId)).toEqual([
      'figures/redarmy',
      'figures/bluearmy',
    ])
  })

  it('bringToFront moves the piece to the end of the list', () => {
    let state = firstCivGame()
    state = place(state, 'figures/redarmy', 100, 100)
    state = place(state, 'figures/bluearmy', 100, 100)

    const bottom = state.board.pieces[0]
    if (bottom === undefined) throw new Error('no piece')

    state = unwrap(bringToFront(state, { playerId: CASH1981, pieceId: bottom.id }))
    expect(state.board.pieces.at(-1)?.id).toBe(bottom.id)
    expect(state.board.pieces).toHaveLength(2)
  })

  it('sendToBack moves the piece to the start of the list', () => {
    let state = firstCivGame()
    state = place(state, 'figures/redarmy', 100, 100)
    state = place(state, 'figures/bluearmy', 100, 100)

    const top = state.board.pieces.at(-1)
    if (top === undefined) throw new Error('no piece')

    state = unwrap(sendToBack(state, { playerId: CASH1981, pieceId: top.id }))
    expect(state.board.pieces[0]?.id).toBe(top.id)
    expect(state.board.pieces).toHaveLength(2)
  })

  it('several pieces can share one square', () => {
    let state = firstCivGame()
    for (const asset of ['figures/redarmy', 'figures/redarmy', 'figures/redscout']) {
      state = place(state, asset, 300, 300)
    }
    const squares = state.board.pieces.map((piece) => squareOf(state.board, piece))
    expect(new Set(squares).size).toBe(1)
    expect(state.board.pieces).toHaveLength(3)
  })
})

describe('movePiece', () => {
  it('moves the piece and brings it to the top', () => {
    let state = firstCivGame()
    state = place(state, 'figures/redarmy', 100, 100)
    state = place(state, 'figures/bluearmy', 400, 400)

    const first = state.board.pieces[0]
    if (first === undefined) throw new Error('no piece')

    state = unwrap(movePiece(state, { playerId: CASH1981, pieceId: first.id, x: 800, y: 800 }))

    const moved = state.board.pieces.at(-1)
    expect(moved?.id).toBe(first.id)
    expect(moved?.x).toBe(800)
    expect(moved?.y).toBe(800)
  })

  it('keeps map tiles behind other pieces when a tile is moved', () => {
    let state = firstCivGame()
    state = place(state, 'tiles/tile01', 100, 100)
    state = place(state, 'cities/bluecity2', 120, 120)
    const tile = state.board.pieces.find((piece) => piece.category === 'tile')
    if (tile === undefined) throw new Error('no tile')

    state = unwrap(movePiece(state, { playerId: CASH1981, pieceId: tile.id, x: 800, y: 800 }))

    expect(state.board.pieces[0]?.id).toBe(tile.id)
    expect(state.board.pieces.at(-1)?.category).toBe('city')
  })

  it('another player can move a piece you put down', () => {
    // A deliberate choice: everyone may move everything, as at a real table
    let state = place(firstCivGame(), 'figures/redarmy', 100, 100)
    const piece = state.board.pieces[0]
    if (piece === undefined) throw new Error('no piece')

    state = unwrap(movePiece(state, { playerId: KARANDRAS1, pieceId: piece.id, x: 500, y: 500 }))
    expect(state.board.pieces[0]?.x).toBe(500)
    expect(state.board.pieces[0]?.placedBy).toBe(CASH1981)
  })

  it('an unknown piece gives BOARD_PIECE_NOT_FOUND', () => {
    const error = unwrapErr(
      movePiece(firstCivGame(), { playerId: CASH1981, pieceId: 'no-such-piece', x: 0, y: 0 }),
    )
    expect(error).toEqual({ kind: 'BOARD_PIECE_NOT_FOUND', pieceId: 'no-such-piece' })
  })
})

describe('removing', () => {
  it('removePiece takes the piece away', () => {
    let state = place(firstCivGame(), 'figures/redarmy', 100, 100)
    const piece = state.board.pieces[0]
    if (piece === undefined) throw new Error('no piece')

    state = unwrap(removePiece(state, { playerId: CASH1981, pieceId: piece.id }))
    expect(state.board.pieces).toHaveLength(0)
  })

})

describe('squareOf', () => {
  it('works out the square from the centre of the piece', () => {
    const state = place(firstCivGame(), 'cities/redcity2', 0, mapTop(createBoard()))
    const piece = state.board.pieces[0]
    if (piece === undefined) throw new Error('no piece')

    // 85 x 83 with its top left on the first row of the map is inside A1
    expect(squareOf(state.board, piece)).toBe('A1')
  })

  it('reaches P16 in the opposite corner', () => {
    const board = createBoard()
    const state = place(firstCivGame(), 'markers/coin', 1504 - 60, mapTop(board) + 1504 - 60)
    const piece = state.board.pieces[0]
    if (piece === undefined) throw new Error('no piece')
    expect(squareOf(state.board, piece)).toBe('P16')
  })

  it('is null below the map, where the player areas are', () => {
    const board = createBoard()
    const state = place(firstCivGame(), 'markers/coin', 100, areaBandTop(board) + 50)
    const piece = state.board.pieces[0]
    if (piece === undefined) throw new Error('no piece')
    expect(squareOf(state.board, piece)).toBeNull()
  })
})

describe('player areas', () => {
  const board = createBoard()

  it('gives one equal-width area per player, in player-number order', () => {
    const areas = playerAreas(board, firstCivGame().players)

    expect(areas.map((area) => area.username)).toEqual([
      'cash1981',
      'Karandras1',
      'Itchi',
      'Chul',
    ])
    expect(new Set(areas.map((area) => area.width)).size).toBe(1)
    expect(areas.every((area) => area.y === areaBandTop(board))).toBe(true)
  })

  it('leaves room at the right for the Wonders area', () => {
    const areas = playerAreas(board, firstCivGame().players)
    const last = areas.at(-1)
    if (last === undefined) throw new Error('no areas')
    // The player areas stop short of the map's right edge by the width of the
    // Wonders area (plus a gutter), rather than filling it.
    expect(last.x + last.width).toBeLessThan(boardWidth(board) - wondersAreaWidth(board))
  })

  it('together with the Wonders area, spans the width of the map', () => {
    const areas = boardAreas(board, firstCivGame().players)
    const last = areas.at(-1)
    if (last === undefined) throw new Error('no areas')
    // The last area is the Wonders area, pinned to the map's right edge.
    expect(last.playerId).toBe(WONDERS_AREA_ID)
    expect(last.x + last.width).toBeCloseTo(boardWidth(board), 0)
    expect(last.width).toBe(wondersAreaWidth(board))
    expect(wondersArea(board).x + wondersArea(board).width).toBeCloseTo(boardWidth(board), 0)
  })

  it('has no areas before anyone has joined', () => {
    expect(playerAreas(board, [])).toEqual([])
    expect(boardAreas(board, [])).toEqual([])
  })

  it('areaAt finds the area a point falls in', () => {
    const areas = playerAreas(board, firstCivGame().players)
    const second = areas[1]
    if (second === undefined) throw new Error('no area')

    expect(areaAt(areas, second.x + 5, second.y + 5)?.username).toBe('Karandras1')
    // Above the band is the map, not an area
    expect(areaAt(areas, 100, 100)).toBeUndefined()
  })

  it('tidies a dropped piece into the next free slot', () => {
    const areas = playerAreas(board, firstCivGame().players)
    const mine = areas[0]
    if (mine === undefined) throw new Error('no area')

    let state = firstCivGame()
    // Drop three huts at the same messy spot inside the area
    for (let i = 0; i < 3; i++) {
      state = place(state, 'resources/hut', mine.x + 30, mine.y + AREA_LABEL_HEIGHT + 20)
    }

    const positions = state.board.pieces.map((piece) => [piece.x, piece.y])
    // They line up instead of piling on top of each other
    expect(new Set(positions.map(String)).size).toBe(3)
    expect(positions).toEqual([
      [mine.x, mine.y + AREA_LABEL_HEIGHT],
      [mine.x + SQUARE_SIZE, mine.y + AREA_LABEL_HEIGHT],
      [mine.x + SQUARE_SIZE * 2, mine.y + AREA_LABEL_HEIGHT],
    ])
  })

  it('tidies a piece dragged from the map into an area', () => {
    const areas = playerAreas(board, firstCivGame().players)
    const mine = areas[0]
    if (mine === undefined) throw new Error('no area')

    let state = place(firstCivGame(), 'resources/hut', 400, 400)
    const piece = state.board.pieces[0]
    if (piece === undefined) throw new Error('no piece')

    state = unwrap(
      movePiece(state, {
        playerId: CASH1981,
        pieceId: piece.id,
        x: mine.x + 40,
        y: mine.y + AREA_LABEL_HEIGHT + 40,
      }),
    )

    expect([state.board.pieces[0]?.x, state.board.pieces[0]?.y]).toEqual([
      mine.x,
      mine.y + AREA_LABEL_HEIGHT,
    ])
  })

  it('leaves pieces on the map exactly where they are dropped', () => {
    const state = place(firstCivGame(), 'resources/hut', 437, 291)
    expect([state.board.pieces[0]?.x, state.board.pieces[0]?.y]).toEqual([437, 291])
  })

  it('locationOf names the area a piece sits in', () => {
    const areas = playerAreas(board, firstCivGame().players)
    const mine = areas[0]
    if (mine === undefined) throw new Error('no area')

    const state = place(firstCivGame(), 'resources/hut', mine.x + 10, mine.y + 40)
    const piece = state.board.pieces[0]
    if (piece === undefined) throw new Error('no piece')

    expect(locationOf(state.board, areas, piece)).toBe("cash1981's area")
  })

  it('locationOf names the square for pieces on the map', () => {
    const areas = playerAreas(board, firstCivGame().players)
    const state = place(firstCivGame(), 'markers/coin', 0, mapTop(board))
    const piece = state.board.pieces[0]
    if (piece === undefined) throw new Error('no piece')

    expect(locationOf(state.board, areas, piece)).toBe('A1')
  })

  it('locationOf names the culture space for markers on the track', () => {
    const areas = playerAreas(board, firstCivGame().players)
    // x 0 is nearest the START panel, not space 1 — see issue #4
    const state = place(firstCivGame(), 'markers/coin', 0, 0)
    const piece = state.board.pieces[0]
    if (piece === undefined) throw new Error('no piece')

    expect(locationOf(state.board, areas, piece)).toBe('culture START')
  })
})

describe('migration', () => {
  it('gives an old saved game an empty board', () => {
    const { board: _board, ...withoutBoard } = firstCivGame()
    const migrated = migrateGameState(withoutBoard as GameState)

    expect(migrated.board.columns).toBe(16)
    expect(migrated.board.pieces).toHaveLength(0)
    expect(migrated.board.history).toHaveLength(0)
  })

  it('leaves an existing board alone', () => {
    const state = place(firstCivGame(), 'figures/redarmy', 100, 100)
    expect(migrateGameState(state).board.pieces).toHaveLength(1)
  })

  it('turns pieces that predate the history into history entries', () => {
    // Otherwise stepping back would make them vanish, since replay rebuilds
    // the board from empty
    let state = place(firstCivGame(), 'figures/redarmy', 100, 100)
    state = place(state, 'markers/coin', 400, 400)
    const older = { ...state, board: { ...state.board, history: undefined } }

    const migrated = migrateGameState(older as unknown as GameState)
    expect(migrated.board.history).toHaveLength(2)
    expect(migrated.board.history[0]?.username).toBe('System')
    expect(piecesAtStep(migrated.board.history, 2)).toHaveLength(2)
    expect(piecesAtStep(migrated.board.history, 0)).toHaveLength(0)
  })
})

describe('purity', () => {
  it('placePiece does not mutate the input state', () => {
    const before = firstCivGame()
    const snapshot = JSON.stringify(before)

    place(before, 'figures/redarmy', 100, 100)

    expect(JSON.stringify(before)).toBe(snapshot)
  })
})
