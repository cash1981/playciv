/**
 * Map-tiles på brettet: hjørner, orientering og automatisk plassering.
 *
 * Sivilisasjonens startbrett skal ligge i spillerens hjørne med pilen inn mot
 * midten, og et trukket utforskningsbrett skal dukke opp av seg selv.
 */

import { describe, expect, it } from 'vitest'

import { placePiece, rotatePiece } from '../src/actions/board.js'
import { draw } from '../src/actions/draw.js'
import { revealItem } from '../src/actions/player.js'
import {
  SQUARE_SIZE,
  TILE_SQUARES,
  civTileAssetId,
  createBoard,
  findBoardAsset,
  firstFreeBlock,
  startingCorner,
  tileAssetIdForNumber,
} from '../src/board.js'
import { unwrap } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { findPlayer } from '../src/state.js'

import { CASH1981, firstCivGame } from './fixture.js'

const place = (state: GameState, assetId: string, x: number, y: number): GameState =>
  unwrap(placePiece(state, { playerId: CASH1981, assetId, x, y }))

describe('map-tiles i manifestet', () => {
  it('har ett startbrett per sivilisasjon i regnearket', () => {
    const civs = firstCivGame().items.filter((item) => item.kind === 'civ')
    expect(civs).toHaveLength(16)

    for (const civ of civs) {
      const assetId = civTileAssetId(civ.name)
      expect(assetId, `mangler startbrett for ${civ.name}`).toBeDefined()
      expect(findBoardAsset(assetId as string)).toBeDefined()
    }
  })

  it('dekker nøyaktig 4 × 4 ruter', () => {
    const tile = findBoardAsset('tiles/japan')
    expect(tile?.width).toBe(TILE_SQUARES * SQUARE_SIZE)
    expect(tile?.height).toBe(TILE_SQUARES * SQUARE_SIZE)
  })

  it('finner utforskningsbrett på nummer, på tvers av filnavn-suffiksene', () => {
    // Filene heter tile01, tile15a, tile22b og Tile26b
    expect(tileAssetIdForNumber(1)).toBe('tiles/tile01')
    expect(tileAssetIdForNumber(15)).toBe('tiles/tile15a')
    expect(tileAssetIdForNumber(22)).toBe('tiles/tile22b')
    expect(tileAssetIdForNumber(27)).toBe('tiles/Tile27b')
  })

  it('dekker alle tile-numrene i regnearket', () => {
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

  it('gir de fire hjørnene med pilen inn mot midten', () => {
    // Ubehandlet bilde har pilen ned og hovedstadsikonet øverst til venstre,
    // så rotasjon med klokka flytter begge rundt kanten samtidig
    expect(startingCorner(board, 1)).toEqual({ x: 0, y: 0, rotation: 0 })
    expect(startingCorner(board, 2)).toEqual({ x: 1128, y: 0, rotation: 90 })
    expect(startingCorner(board, 3)).toEqual({ x: 1128, y: 1128, rotation: 180 })
    expect(startingCorner(board, 4)).toEqual({ x: 0, y: 1128, rotation: 270 })
  })

  it('spiller 1 dekker A1 til D4', () => {
    const corner = startingCorner(board, 1)
    expect([corner.x, corner.y]).toEqual([0, 0])
    // Fire ruter à 94 piksler
    expect(TILE_SQUARES * SQUARE_SIZE).toBe(376)
  })

  it('spiller 5 deler hjørne med spiller 1', () => {
    // Malen har fire hjørner; flere spillere må dele
    expect(startingCorner(board, 5)).toEqual(startingCorner(board, 1))
  })
})

describe('firstFreeBlock', () => {
  it('starter i øvre venstre luke', () => {
    expect(firstFreeBlock(createBoard())).toEqual([0, 0])
  })

  it('hopper over luker der det alt ligger et brett', () => {
    let state = firstCivGame()
    state = place(state, 'tiles/tile01', 0, 0)
    expect(firstFreeBlock(state.board)).toEqual([376, 0])

    state = place(state, 'tiles/tile02', 376, 0)
    expect(firstFreeBlock(state.board)).toEqual([752, 0])
  })

  it('bryr seg ikke om vanlige brikker', () => {
    const state = place(firstCivGame(), 'figures/redarmy', 10, 10)
    expect(firstFreeBlock(state.board)).toEqual([0, 0])
  })
})

describe('rotasjon', () => {
  it('nye brikker ligger urotert', () => {
    const state = place(firstCivGame(), 'figures/redarmy', 100, 100)
    expect(state.board.pieces[0]?.rotation).toBe(0)
  })

  it('rotatePiece snur et kvart trinn med klokka, og går rundt', () => {
    let state = place(firstCivGame(), 'tiles/tile01', 0, 0)
    const piece = state.board.pieces[0]
    if (piece === undefined) throw new Error('ingen brikke')

    for (const expected of [90, 180, 270, 0]) {
      state = unwrap(rotatePiece(state, { playerId: CASH1981, pieceId: piece.id }))
      expect(state.board.pieces[0]?.rotation).toBe(expected)
    }
  })

  it('en bestemt retning kan settes direkte', () => {
    let state = place(firstCivGame(), 'tiles/tile01', 0, 0)
    const piece = state.board.pieces[0]
    if (piece === undefined) throw new Error('ingen brikke')

    state = unwrap(rotatePiece(state, { playerId: CASH1981, pieceId: piece.id, rotation: 180 }))
    expect(state.board.pieces[0]?.rotation).toBe(180)
  })

  it('rotering flytter ikke brikken i stabelen', () => {
    let state = firstCivGame()
    state = place(state, 'figures/redarmy', 100, 100)
    state = place(state, 'figures/bluearmy', 100, 100)

    const bottom = state.board.pieces[0]
    if (bottom === undefined) throw new Error('ingen brikke')

    state = unwrap(rotatePiece(state, { playerId: CASH1981, pieceId: bottom.id }))
    expect(state.board.pieces[0]?.id).toBe(bottom.id)
  })
})

describe('automatisk plassering', () => {
  it('map-tiles legger seg under de andre brikkene', () => {
    let state = firstCivGame()
    state = place(state, 'figures/redarmy', 50, 50)
    state = place(state, 'tiles/tile01', 0, 0)

    // Ellers ville brettet dekket figuren som står på det
    expect(state.board.pieces[0]?.category).toBe('tile')
    expect(state.board.pieces.at(-1)?.category).toBe('figure')
  })

  it('et trukket tile havner på brettet', () => {
    const after = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'TILES' }))

    const tiles = after.board.pieces.filter((piece) => piece.category === 'tile')
    expect(tiles).toHaveLength(1)
    expect([tiles[0]?.x, tiles[0]?.y]).toEqual([0, 0])

    // Brikken skal svare til kortet som havnet i hånden
    const drawn = findPlayer(after, CASH1981)?.items.at(-1)
    if (drawn?.kind !== 'tile') throw new Error('trakk ikke et tile')
    expect(tiles[0]?.assetId).toBe(tileAssetIdForNumber(Number(drawn.name)))
  })

  it('flere trukne tiles fyller lukene etter tur', () => {
    let state = firstCivGame()
    for (let i = 0; i < 3; i++) {
      state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'TILES' }))
    }

    // Tiles legges nederst i stabelen, så listen er i omvendt rekkefølge av
    // plasseringen. Det som betyr noe er hvilke luker som er fylt.
    const tiles = state.board.pieces.filter((piece) => piece.category === 'tile')
    expect(tiles.map((tile) => tile.x).sort((a, b) => a - b)).toEqual([0, 376, 752])
    expect(tiles.every((tile) => tile.y === 0)).toBe(true)
  })

  it('andre trekk rører ikke brettet', () => {
    const after = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'HUTS' }))
    expect(after.board.pieces).toHaveLength(0)
  })

  it('å avsløre en sivilisasjon legger startbrettet i spillerens hjørne', () => {
    let state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'CIV' }))
    const civ = findPlayer(state, CASH1981)?.items.find((item) => item.kind === 'civ')
    if (civ?.kind !== 'civ') throw new Error('ingen civ i hånden')

    state = unwrap(
      revealItem(state, { playerId: CASH1981, sheetName: 'CIV', itemNumber: civ.itemNumber }),
    )

    const civTiles = state.board.pieces.filter((piece) => piece.category === 'civtile')
    expect(civTiles).toHaveLength(1)
    // cash1981 er spiller 1 i fixturen, altså øvre venstre luke
    expect([civTiles[0]?.x, civTiles[0]?.y]).toEqual([0, 0])
    expect(civTiles[0]?.rotation).toBe(0)
    expect(civTiles[0]?.assetId).toBe(civTileAssetId(civ.name))
  })

  it('startbrettet legges ikke ut to ganger', () => {
    let state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'CIV' }))
    const civ = findPlayer(state, CASH1981)?.items.find((item) => item.kind === 'civ')
    if (civ?.kind !== 'civ') throw new Error('ingen civ i hånden')

    state = unwrap(
      revealItem(state, { playerId: CASH1981, sheetName: 'CIV', itemNumber: civ.itemNumber }),
    )
    const before = state.board.pieces.filter((piece) => piece.category === 'civtile').length

    // Avsløringen trakk startenheter, som kan ha trukket flere civ-kort;
    // uansett skal ikke det samme startbrettet dukke opp igjen
    expect(before).toBe(1)
  })
})
