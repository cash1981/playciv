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
  CULTURE_TRACK,
  CULTURE_TRACK_CELLS,
  CULTURE_TRACK_SCALE,
  CULTURE_VICTORY_STEP,
  boardWidth,
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

  it('is drawn taller than its bare aspect ratio, so it reads well (issue #22)', () => {
    const aspectHeight = (boardWidth(board) * CULTURE_TRACK.height) / CULTURE_TRACK.width
    expect(CULTURE_TRACK_SCALE).toBeGreaterThan(1)
    expect(cultureTrackHeight(board)).toBe(Math.round(aspectHeight * CULTURE_TRACK_SCALE))
    expect(cultureTrackHeight(board)).toBeGreaterThan(aspectHeight)
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
    // The grey spaces sit between the START and Culture Victory end panels
    const first = cultureCellCenter(board, 1).x
    const last = cultureCellCenter(board, CULTURE_TRACK_CELLS).x
    expect(first).toBeGreaterThan(0)
    expect(last).toBeLessThan(1504)
  })

  it('step 0 is START, distinct from space 1', () => {
    expect(cultureCellCenter(board, 0)).not.toEqual(cultureCellCenter(board, 1))
  })

  it('a step outside the track is pulled back to an end', () => {
    expect(cultureCellCenter(board, -5)).toEqual(cultureCellCenter(board, 0))
    // The last position is Culture Victory, not the last grey space
    expect(cultureCellCenter(board, 99)).toEqual(
      cultureCellCenter(board, CULTURE_VICTORY_STEP),
    )
  })

  it('Culture Victory is the last position, past the last space', () => {
    expect(CULTURE_VICTORY_STEP).toBe(CULTURE_TRACK_CELLS + 1)
    const victory = cultureCellCenter(board, CULTURE_VICTORY_STEP).x
    const lastSpace = cultureCellCenter(board, CULTURE_TRACK_CELLS).x
    expect(victory).toBeGreaterThan(lastSpace)
    expect(victory).toBeLessThan(1504)
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

  it('reads START back from a marker placed on its centre', () => {
    const centre = cultureCellCenter(board, 0)
    const piece = { x: centre.x - 23, y: 10, width: 46, height: 35 } as BoardPiece
    expect(cultureStepOf(board, piece)).toBe(0)
  })

  it('is null for pieces below the track', () => {
    const piece = { x: 0, y: mapTop(board), width: 46, height: 35 } as BoardPiece
    expect(cultureStepOf(board, piece)).toBeNull()
  })
})

describe('moving a marker', () => {
  it('keeps the exact drop position on the track — markers are not snapped', () => {
    const board = createBoard()
    const target = cultureCellCenter(board, 12)

    let state = place(firstCivGame(), 'leaders/japanese_red', 0, 0)
    const piece = state.board.pieces[0] as BoardPiece

    // Dropped a little off the centre of space 12, on purpose.
    const dropX = Math.round(target.x - piece.width / 2 + 9)
    state = unwrap(
      movePiece(state, { playerId: CASH1981, pieceId: piece.id, x: dropX, y: 4 }),
    )

    const moved = state.board.pieces.at(-1) as BoardPiece
    // The marker stays exactly where it was dropped, rather than snapping to the
    // cell centre ...
    expect(moved.x).toBe(dropX)
    expect(moved.y).toBe(4)
    // ... but the nearest space is still read off its position for the log.
    expect(cultureStepOf(state.board, moved)).toBe(12)
  })

  it('two markers can share a space at different spots, without being moved apart', () => {
    const board = createBoard()
    const centre = cultureCellCenter(board, 5)

    let state = place(firstCivGame(), 'leaders/japanese_red', 0, 0)
    state = place(state, 'leaders/caesar_blue', 0, 0)
    const [a, b] = state.board.pieces as [BoardPiece, BoardPiece]

    // Drop both near space 5, but at different x — the player's choice.
    const ax = Math.round(centre.x - a.width / 2)
    const bx = Math.round(centre.x - b.width / 2 + 18)
    state = unwrap(movePiece(state, { playerId: CASH1981, pieceId: a.id, x: ax, y: 4 }))
    state = unwrap(movePiece(state, { playerId: CASH1981, pieceId: b.id, x: bx, y: 4 }))

    const movedA = state.board.pieces.find((p) => p.id === a.id) as BoardPiece
    const movedB = state.board.pieces.find((p) => p.id === b.id) as BoardPiece
    // Both read as space 5 for the log ...
    expect(cultureStepOf(state.board, movedA)).toBe(5)
    expect(cultureStepOf(state.board, movedB)).toBe(5)
    // ... and each kept exactly where it was put, rather than being lane-stepped.
    expect(movedA.x).toBe(ax)
    expect(movedB.x).toBe(bx)
    expect(movedA.y).toBe(4)
    expect(movedB.y).toBe(4)
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
      "cash1981 moved Japanese (Red) from culture START to culture 9",
    )
  })

  it('a marker can be moved onto Culture Victory', () => {
    const board = createBoard()
    const areas = playerAreas(board, firstCivGame().players)
    const target = cultureCellCenter(board, CULTURE_VICTORY_STEP)

    let state = place(firstCivGame(), 'leaders/japanese_red', 0, 0)
    const piece = state.board.pieces[0] as BoardPiece
    const dropX = Math.round(target.x - piece.width / 2)
    state = unwrap(
      movePiece(state, { playerId: CASH1981, pieceId: piece.id, x: dropX, y: 4 }),
    )

    const moved = state.board.pieces.at(-1) as BoardPiece
    expect(moved.x).toBe(dropX)
    expect(cultureStepOf(state.board, moved)).toBe(CULTURE_VICTORY_STEP)
    expect(locationOf(state.board, areas, moved)).toBe('culture victory')
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

  it('puts the matching leader on START', () => {
    const state = chooseCiv(firstCivGame(), CASH1981)

    const player = findPlayer(state, CASH1981)
    const markers = state.board.pieces.filter((piece) => piece.category === 'leader')
    expect(markers).toHaveLength(1)

    const marker = markers[0] as BoardPiece
    expect(cultureStepOf(state.board, marker)).toBe(0)
    // cash1981 plays Red in the fixture
    expect(marker.assetId).toBe(
      leaderAssetId((player?.civilization?.name ?? '') as string, 'Red'),
    )
  })

  it('records the placement in the board history like any other piece', () => {
    const state = chooseCiv(firstCivGame(), CASH1981)
    const entry = state.board.history.find((candidate) =>
      candidate.description.includes('culture START'),
    )
    expect(entry?.change.kind).toBe('place')
    expect(entry?.playerId).toBe(CASH1981)
  })

  it('a second player lands on START without covering the first', () => {
    let state = chooseCiv(firstCivGame(), CASH1981)
    // Karandras1 needs the turn before the reveal can draw starting units
    state = { ...state, players: state.players.map((player) => ({ ...player, yourTurn: player.playerId === KARANDRAS1 })) }
    state = chooseCiv(state, KARANDRAS1)

    const markers = state.board.pieces.filter((piece) => piece.category === 'leader')
    expect(markers).toHaveLength(2)
    expect(markers.every((marker) => cultureStepOf(state.board, marker) === 0)).toBe(true)
    expect(new Set(markers.map((marker) => marker.y)).size).toBe(2)
  })
})
