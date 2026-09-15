/**
 * The culture track and its leader markers.
 *
 * Neither Java nor the AngularJS app had either, so there is no reference
 * behaviour to port. The track is a marker only: the engine knows where a
 * marker sits and nothing about what it costs to advance or what happens at a
 * threshold, because those rules are not in the ported source.
 */

import { describe, expect, it } from 'vitest'

import { movePiece, placePiece } from '../src/actions/board.js'
import { draw } from '../src/actions/draw.js'
import { revealItem } from '../src/actions/player.js'
import type { BoardPiece } from '../src/board.js'
import {
  CULTURE_TRACK_CELLS,
  createBoard,
  cultureCellCenter,
  cultureStepOf,
  cultureTrackHeight,
  findBoardAsset,
  inCultureBand,
  leaderAssetId,
  locationOf,
  mapTop,
  playerAreas,
} from '../src/board.js'
import { unwrap } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { findPlayer } from '../src/state.js'

import { CASH1981, KARANDRAS1, firstCivGame } from './fixture.js'

const place = (state: GameState, assetId: string, x: number, y: number): GameState =>
  unwrap(placePiece(state, { playerId: CASH1981, assetId, x, y }))

describe('the track', () => {
  const board = createBoard()

  it('has 27 spaces, matching the artwork', () => {
    expect(CULTURE_TRACK_CELLS).toBe(27)
  })

  it('sits above the map and is a band, not a row of squares', () => {
    expect(cultureTrackHeight(board)).toBeGreaterThan(0)
    expect(mapTop(board)).toBeGreaterThan(cultureTrackHeight(board))
    expect(inCultureBand(board, 0)).toBe(true)
    expect(inCultureBand(board, cultureTrackHeight(board) - 1)).toBe(true)
    expect(inCultureBand(board, cultureTrackHeight(board))).toBe(false)
    expect(inCultureBand(board, mapTop(board))).toBe(false)
  })

  it('the spaces run left to right without overlapping', () => {
    const centres = Array.from({ length: CULTURE_TRACK_CELLS }, (_, index) =>
      cultureCellCenter(board, index + 1).x,
    )
    const sorted = [...centres].sort((a, b) => a - b)

    expect(centres).toEqual(sorted)
    expect(new Set(centres).size).toBe(CULTURE_TRACK_CELLS)
  })

  it('Start and Culture Victory stay clear of the first and last space', () => {
    // The panels at either end are not spaces, so no marker belongs on them
    const first = cultureCellCenter(board, 1).x
    const last = cultureCellCenter(board, CULTURE_TRACK_CELLS).x
    expect(first).toBeGreaterThan(0)
    expect(last).toBeLessThan(1504)
  })

  it('a step outside the track is pulled back to an end', () => {
    expect(cultureCellCenter(board, 0)).toEqual(cultureCellCenter(board, 1))
    expect(cultureCellCenter(board, 99)).toEqual(
      cultureCellCenter(board, CULTURE_TRACK_CELLS),
    )
  })
})

describe('cultureStepOf', () => {
  const board = createBoard()

  it('reads the space back from a marker placed on its centre', () => {
    for (const step of [1, 7, 14, 21, 27]) {
      const centre = cultureCellCenter(board, step)
      const piece = { x: centre.x - 23, y: 10, width: 46, height: 35 } as BoardPiece
      expect(cultureStepOf(board, piece)).toBe(step)
    }
  })

  it('is null for pieces below the track', () => {
    const piece = { x: 0, y: mapTop(board), width: 46, height: 35 } as BoardPiece
    expect(cultureStepOf(board, piece)).toBeNull()
  })
})

describe('moving a marker', () => {
  it('snaps to the nearest space when dropped on the track', () => {
    const board = createBoard()
    const target = cultureCellCenter(board, 12)

    let state = place(firstCivGame(), 'leaders/japanese_red', 0, 0)
    const piece = state.board.pieces[0] as BoardPiece

    // Dropped a little off centre, on purpose
    state = unwrap(
      movePiece(state, {
        playerId: CASH1981,
        pieceId: piece.id,
        x: target.x - piece.width / 2 + 9,
        y: 4,
      }),
    )

    const moved = state.board.pieces.at(-1) as BoardPiece
    expect(cultureStepOf(state.board, moved)).toBe(12)
    expect(moved.x).toBe(Math.round(target.x - piece.width / 2))
  })

  it('two markers on the same space are stepped apart rather than hidden', () => {
    const board = createBoard()
    const centre = cultureCellCenter(board, 5)

    let state = place(firstCivGame(), 'leaders/japanese_red', 0, 0)
    state = place(state, 'leaders/caesar_blue', 0, 0)

    for (const piece of [...state.board.pieces]) {
      state = unwrap(
        movePiece(state, {
          playerId: CASH1981,
          pieceId: piece.id,
          x: centre.x - piece.width / 2,
          y: 4,
        }),
      )
    }

    const [first, second] = state.board.pieces
    expect(cultureStepOf(state.board, first as BoardPiece)).toBe(5)
    expect(cultureStepOf(state.board, second as BoardPiece)).toBe(5)
    expect(first?.y).not.toBe(second?.y)
  })

  it('the log line names the space', () => {
    const board = createBoard()
    const areas = playerAreas(board, firstCivGame().players)
    const target = cultureCellCenter(board, 9)

    let state = place(firstCivGame(), 'leaders/japanese_red', 0, 0)
    const piece = state.board.pieces[0] as BoardPiece
    state = unwrap(
      movePiece(state, {
        playerId: CASH1981,
        pieceId: piece.id,
        x: target.x - piece.width / 2,
        y: 4,
      }),
    )

    const moved = state.board.pieces.at(-1) as BoardPiece
    expect(locationOf(state.board, areas, moved)).toBe('culture 9')
    expect(state.board.history.at(-1)?.description).toBe(
      "cash1981 moved Japanese (Red) from culture 1 to culture 9",
    )
  })
})

describe('leaderAssetId', () => {
  it('pairs every civilization with a leader, in every player colour', () => {
    const civs = firstCivGame().items.filter((item) => item.kind === 'civ')
    expect(civs).toHaveLength(16)

    for (const civ of civs) {
      for (const colour of ['Blue', 'Green', 'Purple', 'Red', 'Yellow']) {
        const assetId = leaderAssetId(civ.name, colour)
        expect(assetId, `${civ.name} in ${colour}`).toBeDefined()
        expect(findBoardAsset(assetId as string), assetId).toBeDefined()
      }
    }
  })

  it('has no leader for white, which is the barbarian colour', () => {
    expect(leaderAssetId('Japanese', 'White')).toBeUndefined()
  })

  it('is undefined for a civilization it does not know', () => {
    expect(leaderAssetId('Atlanteans', 'Red')).toBeUndefined()
  })
})

describe('choosing a civilization', () => {
  /** Draws a civ for a player and reveals it. */
  function chooseCiv(start: GameState, playerId: string): GameState {
    const drawn = unwrap(draw(start, { playerId, sheetName: 'CIV' }))
    const civ = findPlayer(drawn, playerId)?.items.find((item) => item.kind === 'civ')
    if (civ?.kind !== 'civ') throw new Error('no civ in the hand')
    return unwrap(
      revealItem(drawn, { playerId, sheetName: 'CIV', itemNumber: civ.itemNumber }),
    )
  }

  it('puts the matching leader on the first space', () => {
    const state = chooseCiv(firstCivGame(), CASH1981)

    const player = findPlayer(state, CASH1981)
    const markers = state.board.pieces.filter((piece) => piece.category === 'leader')
    expect(markers).toHaveLength(1)

    const marker = markers[0] as BoardPiece
    expect(cultureStepOf(state.board, marker)).toBe(1)
    // cash1981 plays Red in the fixture
    expect(marker.assetId).toBe(
      leaderAssetId((player?.civilization?.name ?? '') as string, 'Red'),
    )
  })

  it('records the placement in the board history like any other piece', () => {
    const state = chooseCiv(firstCivGame(), CASH1981)
    const entry = state.board.history.find((candidate) =>
      candidate.description.includes('culture 1'),
    )
    expect(entry?.change.kind).toBe('place')
    expect(entry?.playerId).toBe(CASH1981)
  })

  it('a second player lands on the same space without covering the first', () => {
    let state = chooseCiv(firstCivGame(), CASH1981)
    // Karandras1 needs the turn before the reveal can draw starting units
    state = { ...state, players: state.players.map((player) => ({ ...player, yourTurn: player.playerId === KARANDRAS1 })) }
    state = chooseCiv(state, KARANDRAS1)

    const markers = state.board.pieces.filter((piece) => piece.category === 'leader')
    expect(markers).toHaveLength(2)
    expect(markers.every((marker) => cultureStepOf(state.board, marker) === 1)).toBe(true)
    expect(new Set(markers.map((marker) => marker.y)).size).toBe(2)
  })
})
