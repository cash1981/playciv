/**
 * The coin token piece (`markers/coin1`) and the Sheet counter: a coin marker put in a player's area adds a coin to
 * that player's Sheet, taking it out takes it off, and the board Undo and Redo keep the counter consistent.
 */

import { describe, expect, it } from 'vitest'

import { movePiece, placePiece, redoLastBoardChange, removePiece, undoLastBoardChange } from '../src/actions/board.js'
import { setCoinSource } from '../src/actions/player.js'
import { mapTop, playerAreas, wondersArea } from '../src/board.js'
import type { BoardPiece } from '../src/board.js'
import { COIN_MARKER_ASSET_ID } from '../src/coin-marker.js'
import { unwrap } from '../src/result.js'
import type { GameState } from '../src/state.js'

import { player } from './assisted-fixture.js'
import { CASH1981 as A, KARANDRAS1 as B, firstCivGame } from './fixture.js'

const sheetOf = (state: GameState, playerId: string): number => player(state, playerId).stats.coinSources.sheet

const areaPoint = (state: GameState, playerId: string): { x: number; y: number } => {
  const area = playerAreas(state.board, state.players).find((candidate) => candidate.playerId === playerId)
  if (area === undefined) throw new Error('no area')
  return { x: area.x + 40, y: area.y + 90 }
}
const mapPoint = (state: GameState) => ({ x: 30, y: mapTop(state.board) + 30 })

function putCoin(state: GameState, at: { x: number; y: number }): { state: GameState; piece: BoardPiece } {
  const placed = unwrap(placePiece(state, { playerId: A, assetId: COIN_MARKER_ASSET_ID, x: at.x, y: at.y }))
  const piece = placed.board.pieces.at(-1)
  if (piece === undefined || piece.assetId !== COIN_MARKER_ASSET_ID) throw new Error('not placed')
  return { state: placed, piece }
}
const moveTo = (state: GameState, pieceId: string, at: { x: number; y: number }) =>
  unwrap(movePiece(state, { playerId: A, pieceId, x: at.x, y: at.y }))

describe('a coin marker and the Sheet counter', () => {
  it('adds a coin when the marker is placed in a player area, and nothing on the map or in another kind of area', () => {
    const base = firstCivGame()
    expect(sheetOf(putCoin(base, areaPoint(base, A)).state, A)).toBe(sheetOf(base, A) + 1)
    expect(sheetOf(putCoin(base, areaPoint(base, A)).state, B)).toBe(sheetOf(base, B))
    expect(sheetOf(putCoin(base, mapPoint(base)).state, A)).toBe(sheetOf(base, A))
    const wonders = wondersArea(base.board)
    const inWonders = putCoin(base, { x: wonders.x + 30, y: wonders.y + 90 })
    expect(player(inWonders.state, A).stats.coinSources).toEqual(player(base, A).stats.coinSources)
  })

  it('does not count another piece in the area', () => {
    const base = firstCivGame()
    const at = areaPoint(base, A)
    const wheat = unwrap(placePiece(base, { playerId: A, assetId: 'resources/wheat', x: at.x, y: at.y }))
    expect(sheetOf(wheat, A)).toBe(sheetOf(base, A))
  })

  it('takes the coin off when the marker leaves the area, by a move or by removing it, never below 0', () => {
    const base = firstCivGame()
    const { state, piece } = putCoin(base, areaPoint(base, A))
    expect(sheetOf(moveTo(state, piece.id, mapPoint(state)), A)).toBe(sheetOf(base, A))
    expect(sheetOf(unwrap(removePiece(state, { playerId: A, pieceId: piece.id })), A)).toBe(sheetOf(base, A))
    // The player lowered the Sheet by hand first: the counter stops at 0
    const lowered = unwrap(setCoinSource(state, { editorPlayerId: A, targetPlayerId: A, source: 'sheet', value: 0 }))
    expect(sheetOf(unwrap(removePiece(lowered, { playerId: A, pieceId: piece.id })), A)).toBe(0)
  })

  it('moves the coin between the Sheets when the marker goes to another area, and does nothing inside one area', () => {
    const base = firstCivGame()
    const { state, piece } = putCoin(base, areaPoint(base, A))
    const toB = moveTo(state, piece.id, areaPoint(state, B))
    expect(sheetOf(toB, A)).toBe(sheetOf(base, A))
    expect(sheetOf(toB, B)).toBe(sheetOf(base, B) + 1)
    const within = areaPoint(state, A)
    const nudged = moveTo(state, piece.id, { x: within.x + 10, y: within.y + 10 })
    expect(sheetOf(nudged, A)).toBe(sheetOf(state, A))
    const fromMap = putCoin(base, mapPoint(base))
    expect(sheetOf(moveTo(fromMap.state, fromMap.piece.id, areaPoint(base, A)), A)).toBe(sheetOf(base, A) + 1)
  })

  it('keeps the counter consistent through the board Undo and Redo', () => {
    const base = firstCivGame()
    const { state, piece } = putCoin(base, areaPoint(base, A))
    const undone = unwrap(undoLastBoardChange(state, A))
    expect(sheetOf(undone, A)).toBe(sheetOf(base, A))
    const redone = unwrap(redoLastBoardChange(undone, A))
    expect(sheetOf(redone, A)).toBe(sheetOf(base, A) + 1)
    // A move to the other area, undone and redone
    const moved = moveTo(redone, piece.id, areaPoint(base, B))
    const back = unwrap(undoLastBoardChange(moved, A))
    expect([sheetOf(back, A), sheetOf(back, B)]).toEqual([sheetOf(base, A) + 1, sheetOf(base, B)])
    const again = unwrap(redoLastBoardChange(back, A))
    expect([sheetOf(again, A), sheetOf(again, B)]).toEqual([sheetOf(base, A), sheetOf(base, B) + 1])
    // A removal, undone
    const removed = unwrap(removePiece(again, { playerId: A, pieceId: piece.id }))
    expect(sheetOf(removed, B)).toBe(sheetOf(base, B))
    expect(sheetOf(unwrap(undoLastBoardChange(removed, A)), B)).toBe(sheetOf(base, B) + 1)
  })

  it('undoes only what was really applied when the Sheet had been lowered by hand', () => {
    const base = firstCivGame()
    const { state, piece } = putCoin(base, areaPoint(base, A))
    const lowered = unwrap(setCoinSource(state, { editorPlayerId: A, targetPlayerId: A, source: 'sheet', value: 0 }))
    const removed = unwrap(removePiece(lowered, { playerId: A, pieceId: piece.id }))
    // Nothing could be taken (the counter was 0), so the undo gives nothing back either
    expect(sheetOf(unwrap(undoLastBoardChange(removed, A)), A)).toBe(0)
    // ... and a Redo takes nothing either: Undo then Redo returns the exact Sheet
    const redone = unwrap(redoLastBoardChange(unwrap(undoLastBoardChange(removed, A)), A))
    expect(sheetOf(redone, A)).toBe(0)
    // A placement undone when the Sheet had been lowered by hand: the Undo is clamped at 0, and the Redo then adds nothing
    const placedThenLowered = unwrap(setCoinSource(state, { editorPlayerId: A, targetPlayerId: A, source: 'sheet', value: 0 }))
    const undoneClamped = unwrap(undoLastBoardChange(placedThenLowered, A))
    expect(sheetOf(undoneClamped, A)).toBe(0)
    expect(sheetOf(unwrap(redoLastBoardChange(undoneClamped, A)), A)).toBe(0)
    // Lowered to 1 of 2 by hand: the removal takes the one that is there, and Undo then Redo ends where it began
    const two = unwrap(setCoinSource(putCoin(base, areaPoint(base, A)).state, { editorPlayerId: A, targetPlayerId: A, source: 'sheet', value: 0 }))
    const placed = putCoin(two, areaPoint(base, A))
    expect(sheetOf(placed.state, A)).toBe(1)
    const gone = unwrap(removePiece(placed.state, { playerId: A, pieceId: placed.piece.id }))
    expect(sheetOf(gone, A)).toBe(0)
    const back = unwrap(undoLastBoardChange(gone, A))
    expect(sheetOf(back, A)).toBe(1)
    expect(sheetOf(unwrap(redoLastBoardChange(back, A)), A)).toBe(0)
  })

  it('leaves the manual Sheet editing alone', () => {
    const base = firstCivGame()
    expect(sheetOf(unwrap(setCoinSource(base, { editorPlayerId: A, targetPlayerId: A, source: 'sheet', value: 3 })), A)).toBe(3)
  })

  it('does not count a coin marker that was already in an area before the change (no migration)', () => {
    const base = firstCivGame()
    const { state, piece } = putCoin(base, areaPoint(base, A))
    // A saved game from before the sync: the marker sits in the area, its history entry carries no Sheet change
    const old: GameState = {
      ...state,
      players: state.players.map((candidate) =>
        candidate.playerId === A ? { ...candidate, stats: { ...candidate.stats, coinSources: { ...candidate.stats.coinSources, sheet: sheetOf(base, A) } } } : candidate,
      ),
      board: { ...state.board, history: state.board.history.map(({ sheet: _sheet, ...entry }) => entry) },
    }
    expect(sheetOf(unwrap(undoLastBoardChange(old, A)), A)).toBe(sheetOf(base, A))
    expect(piece.id).toBeDefined()
  })
})
