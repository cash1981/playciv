/**
 * A Great Person placed on a building, a wonder or another Great Person replaces it (base rules
 * p. 18, as described on p. 17). The board does it when the marker lands: the old piece is taken off
 * as the history entry after the move (a building is removed, a wonder is destroyed, another Great
 * Person is held in reserve, which is the player's own area), so the board Undo gives it back one step
 * at a time. It happens only on a square in the outskirts of a city of the player who placed the marker.
 *
 * The scene is `assisted-gather.test.ts`'s: Cash is Red, the America tile lies in the first map slot
 * and a red city stands on B2, whose outskirts are A1, B1, C1, A2, C2, A3, B3 and C3.
 */

import { describe, expect, it } from 'vitest'

import { movePiece, placePiece, redoLastBoardChange, setWonderOwner, undoLastBoardChange } from '../src/actions/board.js'
import { mapCellOf } from '../src/blockade.js'
import { SQUARE_SIZE, areaAt, boardAreas, findBoardAsset, mapTop, playerAreas, slotOrigin } from '../src/board.js'
import type { BoardPiece } from '../src/board.js'
import { unwrap } from '../src/result.js'
import type { GameState } from '../src/state.js'

import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

function game(): GameState {
  const colors: Record<string, string> = { [CASH1981]: 'Red', [KARANDRAS1]: 'Blue', [ITCHI]: 'Green', [CHUL]: 'Yellow' }
  const state = firstCivGame()
  return { ...state, players: state.players.map((p) => ({ ...p, color: colors[p.playerId] ?? p.color })) }
}

const xOf = (assetId: string, column: number): number => {
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`no asset ${assetId}`)
  return column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2
}
const yOf = (state: GameState, assetId: string, row: number): number => {
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`no asset ${assetId}`)
  return mapTop(state.board) + row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2
}

/** Places a piece centred in a map square, as the player given. */
function put(state: GameState, assetId: string, column: number, row: number, playerId = CASH1981): GameState {
  return unwrap(placePiece(state, { playerId, assetId, x: xOf(assetId, column), y: yOf(state, assetId, row) }))
}

/** The America tile and a red city on B2. */
function scene(): GameState {
  const state = game()
  const slot = state.board.slots[0]
  if (slot === undefined) throw new Error('board has no slots')
  const [x, y] = slotOrigin(state.board, slot)
  return put(unwrap(placePiece(state, { playerId: CASH1981, assetId: 'tiles/america', x, y })), 'cities/redcity2', 1, 1)
}

const lastOf = (state: GameState, assetId: string): BoardPiece => {
  const found = [...state.board.pieces].reverse().find((piece) => piece.assetId === assetId)
  if (found === undefined) throw new Error(`no ${assetId}`)
  return found
}
const piecesOf = (state: GameState, assetId: string): readonly BoardPiece[] =>
  state.board.pieces.filter((piece) => piece.assetId === assetId)
const cellOf = (state: GameState, piece: BoardPiece) => mapCellOf(state.board, piece)
const areaOwnerOf = (state: GameState, piece: BoardPiece): string | undefined =>
  areaAt(boardAreas(state.board, state.players), piece.x + piece.width / 2, piece.y + piece.height / 2)?.playerId

/** A marker in Cash's own area, as the assisted draw leaves it. */
function inArea(state: GameState, assetId: string): GameState {
  const area = playerAreas(state.board, state.players).find((candidate) => candidate.playerId === CASH1981)
  if (area === undefined) throw new Error('no area')
  return unwrap(placePiece(state, { playerId: CASH1981, assetId, x: area.x + 20, y: area.y + 36 }))
}

const moveTo = (state: GameState, piece: BoardPiece, column: number, row: number, playerId = CASH1981): GameState =>
  unwrap(movePiece(state, { playerId, pieceId: piece.id, x: xOf(piece.assetId, column), y: yOf(state, piece.assetId, row) }))

describe('a Great Person placed on a building', () => {
  it('replaces it when it is dropped from the palette: the building is gone and the history says why', () => {
    const state = put(put(scene(), 'buildings/temple', 0, 2), 'great people/artist', 0, 2)
    expect(piecesOf(state, 'buildings/temple')).toEqual([])
    expect(cellOf(state, lastOf(state, 'great people/artist'))).toEqual({ column: 0, row: 2 })
    // The move is one entry and the removal the next, so each can be undone on its own
    const [placed, removed] = state.board.history.slice(-2)
    expect(placed?.change.kind).toBe('place')
    expect(removed?.change.kind).toBe('remove')
    expect(removed?.description).toContain('removed Temple from')
    expect(removed?.description).toContain('replaced by Artist')
  })

  it('replaces it when the marker is moved from the player area onto the square', () => {
    let state = put(scene(), 'buildings/library', 2, 1)
    state = inArea(state, 'great people/builder')
    const person = lastOf(state, 'great people/builder')
    expect(areaOwnerOf(state, person)).toBe(CASH1981)
    state = moveTo(state, person, 2, 1)
    expect(piecesOf(state, 'buildings/library')).toEqual([])
    expect(cellOf(state, lastOf(state, 'great people/builder'))).toEqual({ column: 2, row: 1 })
  })

  it('the board Undo gives the building back first and then moves the marker back, and Redo goes forward again', () => {
    let state = put(scene(), 'buildings/temple', 0, 2)
    const temple = lastOf(state, 'buildings/temple')
    state = put(state, 'great people/artist', 0, 2)

    state = unwrap(undoLastBoardChange(state, CASH1981))
    expect(piecesOf(state, 'buildings/temple')).toEqual([temple])
    expect(piecesOf(state, 'great people/artist')).toHaveLength(1)

    state = unwrap(undoLastBoardChange(state, CASH1981))
    expect(piecesOf(state, 'great people/artist')).toEqual([])

    state = unwrap(redoLastBoardChange(state, CASH1981))
    state = unwrap(redoLastBoardChange(state, CASH1981))
    expect(piecesOf(state, 'buildings/temple')).toEqual([])
    expect(piecesOf(state, 'great people/artist')).toHaveLength(1)
  })

  it('and taking the marker off again does not bring the building back', () => {
    let state = put(put(scene(), 'buildings/temple', 0, 2), 'great people/artist', 0, 2)
    state = moveTo(state, lastOf(state, 'great people/artist'), 3, 3)
    expect(piecesOf(state, 'buildings/temple')).toEqual([])
  })

  it('destroys a wonder of the player, owned or not, and leaves another player\'s wonder alone', () => {
    let state = put(scene(), 'wonders/stonehenge', 0, 2)
    state = put(state, 'great people/artist', 0, 2)
    expect(piecesOf(state, 'wonders/stonehenge')).toEqual([])

    let owned = put(scene(), 'wonders/pyramids', 2, 1)
    owned = unwrap(setWonderOwner(owned, { playerId: CASH1981, pieceId: lastOf(owned, 'wonders/pyramids').id, ownerId: CASH1981 }))
    expect(piecesOf(put(owned, 'great people/artist', 2, 1), 'wonders/pyramids')).toEqual([])

    let theirs = put(scene(), 'wonders/oracle', 0, 0)
    theirs = unwrap(setWonderOwner(theirs, { playerId: CASH1981, pieceId: lastOf(theirs, 'wonders/oracle').id, ownerId: KARANDRAS1 }))
    expect(piecesOf(put(theirs, 'great people/artist', 0, 0), 'wonders/oracle')).toHaveLength(1)
  })

  it('holds another Great Person in reserve: it goes to the player\'s own area', () => {
    let state = put(scene(), 'great people/builder', 0, 2)
    const first = lastOf(state, 'great people/builder')
    state = put(state, 'great people/artist', 0, 2)
    const held = piecesOf(state, 'great people/builder')
    expect(held).toHaveLength(1)
    expect((held[0] as BoardPiece).id).toBe(first.id)
    expect(cellOf(state, held[0] as BoardPiece)).toBeNull()
    expect(areaOwnerOf(state, held[0] as BoardPiece)).toBe(CASH1981)
    expect(cellOf(state, lastOf(state, 'great people/artist'))).toEqual({ column: 0, row: 2 })
  })

  it('a marker that stays on its square replaces nothing: nudging or re-dropping it leaves a building beside it', () => {
    // A building dropped on a Great Person by hand stays, and so does it when the person is then straightened
    let state = put(put(scene(), 'great people/artist', 0, 2), 'buildings/temple', 0, 2)
    const person = lastOf(state, 'great people/artist')
    state = unwrap(movePiece(state, { playerId: CASH1981, pieceId: person.id, x: person.x + 6, y: person.y, snap: false }))
    state = moveTo(state, lastOf(state, 'great people/artist'), 0, 2)
    expect(piecesOf(state, 'buildings/temple')).toHaveLength(1)

    // The same after the board Undo gave a building back and kept the marker
    let undone = put(put(scene(), 'buildings/library', 2, 1), 'great people/builder', 2, 1)
    undone = unwrap(undoLastBoardChange(undone, CASH1981))
    expect(piecesOf(undone, 'buildings/library')).toHaveLength(1)
    undone = moveTo(undone, lastOf(undone, 'great people/builder'), 2, 1)
    expect(piecesOf(undone, 'buildings/library')).toHaveLength(1)
  })

  it('a marker moved from another square, or from the player area, still replaces', () => {
    let state = put(put(scene(), 'great people/artist', 3, 3), 'buildings/temple', 0, 2)
    state = moveTo(state, lastOf(state, 'great people/artist'), 0, 2)
    expect(piecesOf(state, 'buildings/temple')).toEqual([])
  })

  it('does nothing outside the outskirts of the player\'s own cities', () => {
    // D4 is not in the outskirts of the city on B2
    const state = put(put(scene(), 'buildings/temple', 3, 3), 'great people/artist', 3, 3)
    expect(piecesOf(state, 'buildings/temple')).toHaveLength(1)
    // And not for another player's move: Blue has no city here
    const other = put(put(scene(), 'buildings/temple', 0, 2), 'great people/artist', 0, 2, KARANDRAS1)
    expect(piecesOf(other, 'buildings/temple')).toHaveLength(1)
  })

  it('does nothing for any other piece, and nothing on an empty square', () => {
    const army = put(put(scene(), 'buildings/temple', 0, 2), 'figures/redarmy', 0, 2)
    expect(piecesOf(army, 'buildings/temple')).toHaveLength(1)
    const empty = put(scene(), 'great people/artist', 0, 2)
    expect(empty.board.history.at(-1)?.change.kind).toBe('place')
  })

  it('a building put on a Great Person by hand is left alone: Build is how it replaces one', () => {
    const state = put(put(scene(), 'great people/artist', 0, 2), 'buildings/temple', 0, 2)
    expect(piecesOf(state, 'great people/artist')).toHaveLength(1)
    expect(piecesOf(state, 'buildings/temple')).toHaveLength(1)
  })
})
