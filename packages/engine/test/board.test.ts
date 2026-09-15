/**
 * Brettet.
 *
 * Java hadde ingen brettmodell, så det finnes ingen gamle tester å porte.
 * Geometrien er låst mot `4v4 Map Template.pptx`.
 */

import { describe, expect, it } from 'vitest'

import {
  bringToFront,
  clearBoard,
  movePiece,
  placePiece,
  removePiece,
  sendToBack,
} from '../src/actions/board.js'
import {
  BOARD_ASSETS,
  COLUMN_LABELS,
  DEFAULT_COLUMNS,
  DEFAULT_ROWS,
  SQUARE_SIZE,
  boardHeight,
  boardWidth,
  findBoardAsset,
  squareOf,
} from '../src/board.js'
import { createBoard } from '../src/board.js'
import { migrateGameState } from '../src/migrate.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'

import { CASH1981, KARANDRAS1, firstCivGame } from './fixture.js'

const place = (state: GameState, assetId: string, x: number, y: number): GameState =>
  unwrap(placePiece(state, { playerId: CASH1981, assetId, x, y }))

describe('geometri', () => {
  it('er 16 x 16 ruter, som malen for fire spillere', () => {
    expect(DEFAULT_COLUMNS).toBe(16)
    expect(DEFAULT_ROWS).toBe(16)
    expect(COLUMN_LABELS[0]).toBe('A')
    expect(COLUMN_LABELS.at(-1)).toBe('P')
  })

  it('ruten er 94 piksler, altså et 375-piksels map-tile delt på fire', () => {
    expect(SQUARE_SIZE).toBe(94)
    // Malen setter sammen brettet av 4 x 4 tiles på 375 x 375
    expect(Math.round(375 / 4)).toBe(SQUARE_SIZE)
  })

  it('brettflaten er 1504 x 1504', () => {
    const board = createBoard()
    expect(boardWidth(board)).toBe(1504)
    expect(boardHeight(board)).toBe(1504)
  })

  it('nye spill starter med tomt brett', () => {
    expect(firstCivGame().board.pieces).toHaveLength(0)
  })
})

describe('manifestet', () => {
  it('har brikker i alle sju kategorier', () => {
    const categories = new Set(BOARD_ASSETS.map((asset) => asset.category))
    expect([...categories].sort()).toEqual([
      'building',
      'city',
      'civtile',
      'figure',
      'marker',
      'resource',
      'tile',
    ])
  })

  it('inneholder army og scout i alle fem spillerfarger', () => {
    for (const colour of ['blue', 'green', 'purple', 'red', 'yellow']) {
      expect(findBoardAsset(`figures/${colour}army`)).toBeDefined()
      expect(findBoardAsset(`figures/${colour}scout`)).toBeDefined()
    }
    // Barbarer bruker den hvite hæren, og har ingen scout
    expect(findBoardAsset('figures/whitearmy')).toBeDefined()
  })

  it('inneholder de seks ressursene', () => {
    for (const name of ['hut', 'village', 'wheat', 'iron', 'silk', 'incense']) {
      expect(findBoardAsset(`resources/${name}`)).toBeDefined()
    }
  })

  it('har positive størrelser på alle brikker', () => {
    expect(BOARD_ASSETS.every((asset) => asset.width > 0 && asset.height > 0)).toBe(true)
  })

  it('byer og bygninger er omtrent én rute store', () => {
    const city = findBoardAsset('cities/redcity2')
    expect(city?.width).toBeGreaterThan(SQUARE_SIZE * 0.8)
    expect(city?.width).toBeLessThan(SQUARE_SIZE * 1.1)
  })
})

describe('placePiece', () => {
  it('legger brikken på brettet med størrelse fra manifestet', () => {
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

  it('avviser en brikketype som ikke finnes i manifestet', () => {
    const error = unwrapErr(
      placePiece(firstCivGame(), { playerId: CASH1981, assetId: '../../etc/passwd', x: 0, y: 0 }),
    )
    expect(error).toEqual({ kind: 'BOARD_ASSET_NOT_FOUND', assetId: '../../etc/passwd' })
  })

  it('avviser en spiller som ikke er med i spillet', () => {
    const error = unwrapErr(
      placePiece(firstCivGame(), { playerId: 'ingen', assetId: 'figures/redarmy', x: 0, y: 0 }),
    )
    expect(error).toEqual({ kind: 'NO_ACCESS', playerId: 'ingen' })
  })

  it('klemmer posisjonen innenfor brettet', () => {
    const state = place(firstCivGame(), 'figures/redarmy', -500, 99999)
    const piece = state.board.pieces[0]

    expect(piece?.x).toBe(0)
    // Halve brikken får stikke utenfor nedre kant
    expect(piece?.y).toBe(1504 - 51 / 2)
  })

  it('hver brikke får sin egen id', () => {
    let state = firstCivGame()
    state = place(state, 'figures/redarmy', 0, 0)
    state = place(state, 'figures/redarmy', 0, 0)

    const ids = state.board.pieces.map((piece) => piece.id)
    expect(new Set(ids).size).toBe(2)
  })
})

describe('stabling', () => {
  it('nye brikker legger seg øverst', () => {
    let state = firstCivGame()
    state = place(state, 'figures/redarmy', 100, 100)
    state = place(state, 'figures/bluearmy', 100, 100)

    // Rekkefølgen i pieces ER z-rekkefølgen
    expect(state.board.pieces.map((piece) => piece.assetId)).toEqual([
      'figures/redarmy',
      'figures/bluearmy',
    ])
  })

  it('bringToFront flytter brikken sist i listen', () => {
    let state = firstCivGame()
    state = place(state, 'figures/redarmy', 100, 100)
    state = place(state, 'figures/bluearmy', 100, 100)

    const bottom = state.board.pieces[0]
    if (bottom === undefined) throw new Error('ingen brikke')

    state = unwrap(bringToFront(state, { playerId: CASH1981, pieceId: bottom.id }))
    expect(state.board.pieces.at(-1)?.id).toBe(bottom.id)
    expect(state.board.pieces).toHaveLength(2)
  })

  it('sendToBack flytter brikken først i listen', () => {
    let state = firstCivGame()
    state = place(state, 'figures/redarmy', 100, 100)
    state = place(state, 'figures/bluearmy', 100, 100)

    const top = state.board.pieces.at(-1)
    if (top === undefined) throw new Error('ingen brikke')

    state = unwrap(sendToBack(state, { playerId: CASH1981, pieceId: top.id }))
    expect(state.board.pieces[0]?.id).toBe(top.id)
    expect(state.board.pieces).toHaveLength(2)
  })

  it('flere brikker kan ligge i samme rute', () => {
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
  it('flytter brikken og legger den øverst', () => {
    let state = firstCivGame()
    state = place(state, 'figures/redarmy', 100, 100)
    state = place(state, 'figures/bluearmy', 400, 400)

    const first = state.board.pieces[0]
    if (first === undefined) throw new Error('ingen brikke')

    state = unwrap(movePiece(state, { playerId: CASH1981, pieceId: first.id, x: 800, y: 800 }))

    const moved = state.board.pieces.at(-1)
    expect(moved?.id).toBe(first.id)
    expect(moved?.x).toBe(800)
    expect(moved?.y).toBe(800)
  })

  it('en annen spiller kan flytte en brikke du la ut', () => {
    // Bevisst valg: alle kan flytte alt, som ved et fysisk bord
    let state = place(firstCivGame(), 'figures/redarmy', 100, 100)
    const piece = state.board.pieces[0]
    if (piece === undefined) throw new Error('ingen brikke')

    state = unwrap(movePiece(state, { playerId: KARANDRAS1, pieceId: piece.id, x: 500, y: 500 }))
    expect(state.board.pieces[0]?.x).toBe(500)
    expect(state.board.pieces[0]?.placedBy).toBe(CASH1981)
  })

  it('ukjent brikke gir BOARD_PIECE_NOT_FOUND', () => {
    const error = unwrapErr(
      movePiece(firstCivGame(), { playerId: CASH1981, pieceId: 'finnes-ikke', x: 0, y: 0 }),
    )
    expect(error).toEqual({ kind: 'BOARD_PIECE_NOT_FOUND', pieceId: 'finnes-ikke' })
  })
})

describe('fjerning', () => {
  it('removePiece tar brikken vekk', () => {
    let state = place(firstCivGame(), 'figures/redarmy', 100, 100)
    const piece = state.board.pieces[0]
    if (piece === undefined) throw new Error('ingen brikke')

    state = unwrap(removePiece(state, { playerId: CASH1981, pieceId: piece.id }))
    expect(state.board.pieces).toHaveLength(0)
  })

  it('clearBoard tømmer alt', () => {
    let state = firstCivGame()
    for (let i = 0; i < 5; i++) state = place(state, 'markers/coin', i * 100, 100)

    state = unwrap(clearBoard(state, CASH1981))
    expect(state.board.pieces).toHaveLength(0)
  })
})

describe('squareOf', () => {
  it('regner ut ruten fra brikkens midtpunkt', () => {
    const state = place(firstCivGame(), 'cities/redcity2', 0, 0)
    const piece = state.board.pieces[0]
    if (piece === undefined) throw new Error('ingen brikke')

    // 85 x 83 med venstre topp i origo har midtpunkt inne i A1
    expect(squareOf(state.board, piece)).toBe('A1')
  })

  it('treffer P16 i motsatt hjørne', () => {
    const state = place(firstCivGame(), 'markers/coin', 1504 - 60, 1504 - 60)
    const piece = state.board.pieces[0]
    if (piece === undefined) throw new Error('ingen brikke')
    expect(squareOf(state.board, piece)).toBe('P16')
  })
})

describe('migrering', () => {
  it('gir et gammelt lagret spill et tomt brett', () => {
    const { board: _board, ...withoutBoard } = firstCivGame()
    const migrated = migrateGameState(withoutBoard as GameState)

    expect(migrated.board.columns).toBe(16)
    expect(migrated.board.pieces).toHaveLength(0)
  })

  it('lar et eksisterende brett stå urørt', () => {
    const state = place(firstCivGame(), 'figures/redarmy', 100, 100)
    expect(migrateGameState(state).board.pieces).toHaveLength(1)
  })
})

describe('renhet', () => {
  it('placePiece muterer ikke inn-tilstanden', () => {
    const before = firstCivGame()
    const snapshot = JSON.stringify(before)

    place(before, 'figures/redarmy', 100, 100)

    expect(JSON.stringify(before)).toBe(snapshot)
  })
})
