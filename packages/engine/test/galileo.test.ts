/**
 * Galileo Galilei (issue #302): the City Management card that moves every own
 * figure from one outer-edge square to an empty outer-edge square.
 */

import { describe, expect, it } from 'vitest'

import { movePiece, placePiece, undoLastBoardChange } from '../src/actions/board.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { performAssistedAction } from '../src/assisted.js'
import { mapCellOf } from '../src/blockade.js'
import { SQUARE_SIZE, createBoardForPlayers, findBoardAsset, mapTop } from '../src/board.js'
import {
  galileoDestinations,
  galileoFiguresAt,
  galileoSources,
  isOuterEdgeCell,
} from '../src/galileo.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'

import { player, startOfTurn, withCardInHand } from './assisted-fixture.js'
import { coverMap } from './cover-map.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1 } from './fixture.js'

const AT = '2026-10-27T10:00:00.000Z'

const cmTurn = (): GameState =>
  unwrap(markPhasesDone(startOfTurn(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))

/** Places a piece with its centre in the map square at `column`, `row`. */
function place(state: GameState, assetId: string, column: number, row: number): GameState {
  state = coverMap(state)
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`missing asset ${assetId}`)
  return unwrap(
    placePiece(state, {
      playerId: CASH1981,
      assetId,
      x: Math.round(column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2),
      y: Math.round(mapTop(state.board) + row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2),
    }),
  )
}

const play = (
  state: GameState,
  itemId: string,
  from: { readonly column: number; readonly row: number },
  to: { readonly column: number; readonly row: number },
) =>
  performAssistedAction(state, {
    playerId: CASH1981,
    action: 'playCard',
    requestId: 'req-galileo',
    at: AT,
    payload: { itemId, targets: [], from, to },
  })

const figuresIn = (state: GameState, column: number, row: number) =>
  state.board.pieces.filter((piece) => {
    if (piece.category !== 'figure') return false
    const cell = mapCellOf(state.board, piece)
    return cell?.column === column && cell.row === row
  })

const voted = (state: GameState, logId: string): GameState =>
  [KARANDRAS1, ITCHI, CHUL].reduce(
    (next, playerId) => unwrap(vote(next, { logId, playerId, vote: true, at: AT })),
    state,
  )

describe('outer edge squares', () => {
  it('uses any square with own figures as a source and only the border as a destination', () => {
    const state = place(place(cmTurn(), 'figures/redarmy', 0, 5), 'figures/redarmy', 8, 8)
    const sources = galileoSources(state.board, player(state))
    expect(sources).toContainEqual({ column: 0, row: 5 })
    expect(sources).toContainEqual({ column: 8, row: 8 })
    const destinations = galileoDestinations(state.board)
    expect(destinations).toContainEqual(expect.objectContaining({ column: 0, row: 0, label: 'A1' }))
    expect(destinations.some((cell) => cell.column === 8 && cell.row === 8)).toBe(false)
    // The destination picker does not add an interior source as a same-square option.
    expect(
      galileoDestinations(state.board, { column: 8, row: 8 }).some(
        (cell) => cell.column === 8 && cell.row === 8,
      ),
    ).toBe(false)
  })

  it('treats the rim of a stepped board and of the five-player hole as edge', () => {
    const pyramid = createBoardForPlayers(3)
    expect(isOuterEdgeCell(pyramid, { column: 6, row: 2 })).toBe(true)
    expect(isOuterEdgeCell(pyramid, { column: 7, row: 2 })).toBe(false)

    const hole = createBoardForPlayers(5)
    expect(isOuterEdgeCell(hole, { column: 11, row: 8 })).toBe(true)
    expect(isOuterEdgeCell(hole, { column: 9, row: 7 })).toBe(false)
  })

  it('counts both edge squares of a horizontal or vertical metropolis as non-empty', () => {
    const base = cmTurn()
    const horizontal = unwrap(
      placePiece(base, {
        playerId: CASH1981,
        assetId: 'cities/redmetropolis2',
        x: 9,
        y: mapTop(base.board) + 6,
      }),
    )
    const flat = galileoDestinations(horizontal.board)
    expect(flat.some((cell) => cell.column === 0 && cell.row === 0)).toBe(false)
    expect(flat.some((cell) => cell.column === 1 && cell.row === 0)).toBe(false)

    const vertical = unwrap(
      placePiece(base, {
        playerId: CASH1981,
        assetId: 'cities/redmetropolis2',
        x: 0,
        y: mapTop(base.board) + 53,
        rotation: 90,
      }),
    )
    const upright = galileoDestinations(vertical.board)
    expect(upright.some((cell) => cell.column === 0 && cell.row === 0)).toBe(false)
    expect(upright.some((cell) => cell.column === 0 && cell.row === 1)).toBe(false)
  })

  it('does not offer a square with a building, wonder, figure, hut or village', () => {
    const base = cmTurn()
    const target = { column: 0, row: 2 }
    for (const assetId of [
      'buildings/temple',
      'wonders/internet',
      'figures/redarmy',
      'great people/artist',
      'city-states/cs1',
      'cities/bluecapital2',
      'relics/ark_of_the_covenant',
      'resources/hut',
      'resources/village',
    ]) {
      const blocked = place(base, assetId, target.column, target.row)
      expect(galileoDestinations(blocked.board).some((cell) => cell.column === 0 && cell.row === 2)).toBe(false)
    }
  })

  it('still offers a square with another resource marker or only a disaster', () => {
    const withWheat = place(cmTurn(), 'resources/wheat', 0, 2)
    expect(galileoDestinations(withWheat.board)).toContainEqual(
      expect.objectContaining({ column: 0, row: 2 }),
    )
    const withDisaster = place(cmTurn(), 'disasters/drought', 0, 2)
    expect(galileoDestinations(withDisaster.board)).toContainEqual(
      expect.objectContaining({ column: 0, row: 2 }),
    )
  })

  it('offers the chosen source itself, so rule 332 can lock the figures in place', () => {
    const state = place(cmTurn(), 'figures/redarmy', 0, 0)
    expect(galileoDestinations(state.board)).not.toContainEqual(
      expect.objectContaining({ column: 0, row: 0 }),
    )
    expect(galileoDestinations(state.board, { column: 0, row: 0 })).toContainEqual(
      expect.objectContaining({ column: 0, row: 0 }),
    )
  })

  it('offers water on the edge, since the card names no terrain', () => {
    const state = place(cmTurn(), 'tiles/tile05', 0, 0)
    expect(galileoDestinations(state.board)).toContainEqual(
      expect.objectContaining({ column: 0, row: 0 }),
    )
  })
})

describe('playing Galileo Galilei', () => {
  it('moves every own figure together and locks them', () => {
    const { state: initial, itemId } = withCardInHand(cmTurn(), 'Galileo Galilei')
    let state = place(initial, 'figures/redarmy', 0, 0)
    state = place(state, 'figures/redarmy', 0, 0)
    const before = figuresIn(state, 0, 0)
    expect(before).toHaveLength(2)
    expect(galileoFiguresAt(state.board, player(state), { column: 0, row: 0 })).toHaveLength(2)

    const played = unwrap(play(state, itemId, { column: 0, row: 0 }, { column: 0, row: 2 }))

    expect(figuresIn(played, 0, 2)).toHaveLength(2)
    expect(figuresIn(played, 0, 0)).toHaveLength(0)
    for (const figure of figuresIn(played, 0, 2)) {
      expect(figure.movement).toMatchObject({ turn: 1, locked: true })
    }
    expect(played.discardedItems.some((item) => 'name' in item && item.name === 'Galileo Galilei')).toBe(true)
    expect(played.log.at(-1)?.publicLog).toContain('moved 2 figures from A1 to A3')
  })

  it('can pick the source square itself to lock the figures in place (rule 332)', () => {
    const { state, itemId } = withCardInHand(cmTurn(), 'Galileo Galilei')
    const withFigures = place(state, 'figures/redarmy', 0, 0)
    const played = unwrap(play(withFigures, itemId, { column: 0, row: 0 }, { column: 0, row: 0 }))
    expect(figuresIn(played, 0, 0)).toHaveLength(1)
    expect(figuresIn(played, 0, 0)[0]?.movement).toMatchObject({ turn: 1, locked: true })
  })

  it('keeps the board Undo out of the card and lets the vote undo the whole move', () => {
    const { state, itemId } = withCardInHand(cmTurn(), 'Galileo Galilei')
    const withFigures = place(place(state, 'figures/redarmy', 0, 0), 'figures/redarmy', 0, 0)
    const original = figuresIn(withFigures, 0, 0)
    const played = unwrap(play(withFigures, itemId, { column: 0, row: 0 }, { column: 0, row: 2 }))

    const refused = unwrapErr(undoLastBoardChange(played, CASH1981))
    expect(refused.kind).toBe('BOARD_UNDO_ASSISTED')

    const record = played.assistedActions.at(-1)
    if (record === undefined) throw new Error('missing assisted record')
    const undone = voted(unwrap(initiateUndo(played, { logId: record.logId, playerId: CASH1981 })), record.logId)

    expect(figuresIn(undone, 0, 0)).toHaveLength(2)
    expect(figuresIn(undone, 0, 2)).toHaveLength(0)
    for (const figure of figuresIn(undone, 0, 0)) {
      expect(figure.movement).toBeUndefined()
    }
    expect(player(undone).items.some((item) => 'name' in item && item.name === 'Galileo Galilei')).toBe(true)
    expect(original).toHaveLength(2)
    // The reverse moves are the floor: board Undo cannot step into the forward moves and teleport them again.
    expect(unwrapErr(undoLastBoardChange(undone, CASH1981)).kind).toBe('NOTHING_TO_UNDO_ON_BOARD')
  })

  it('refuses the undo after one of the moved figures was moved again', () => {
    const { state, itemId } = withCardInHand(cmTurn(), 'Galileo Galilei')
    const withFigures = place(place(state, 'figures/redarmy', 0, 0), 'figures/redarmy', 0, 0)
    const played = unwrap(play(withFigures, itemId, { column: 0, row: 0 }, { column: 0, row: 2 }))
    const movedPiece = figuresIn(played, 0, 2)[0]
    if (movedPiece === undefined) throw new Error('missing moved figure')
    const strayed = unwrap(
      movePiece(played, {
        playerId: CASH1981,
        pieceId: movedPiece.id,
        x: SQUARE_SIZE * 5,
        y: mapTop(played.board) + SQUARE_SIZE * 5,
      }),
    )
    const record = strayed.assistedActions.at(-1)
    if (record === undefined) throw new Error('missing assisted record')
    let next = unwrap(initiateUndo(strayed, { logId: record.logId, playerId: CASH1981 }))
    let last = null as ReturnType<typeof vote> | null
    for (const playerId of [KARANDRAS1, ITCHI, CHUL]) {
      last = vote(next, { logId: record.logId, playerId, vote: true, at: AT })
      if (!last.ok) break
      next = last.value
    }
    expect(last?.ok).toBe(false)
    expect(last?.ok === false ? last.error.kind : null).toBe('ASSISTED_UNDO_BLOCKED')
  })

  it('moves from an interior source to an edge destination', () => {
    const { state, itemId } = withCardInHand(cmTurn(), 'Galileo Galilei')
    const withFigures = place(state, 'figures/redarmy', 8, 8)
    const played = unwrap(play(withFigures, itemId, { column: 8, row: 8 }, { column: 0, row: 2 }))
    expect(figuresIn(played, 0, 2)).toHaveLength(1)
    expect(figuresIn(played, 8, 8)).toHaveLength(0)
  })

  it('refuses a source without a figure and a blocked destination', () => {
    const { state, itemId } = withCardInHand(cmTurn(), 'Galileo Galilei')
    const withFigures = place(state, 'figures/redarmy', 0, 0)
    const noSource = unwrapErr(play(withFigures, itemId, { column: 0, row: 2 }, { column: 0, row: 3 }))
    expect(noSource.kind).toBe('ASSISTED_ACTION_REJECTED')

    const blocked = place(withFigures, 'resources/hut', 0, 2)
    const noDestination = unwrapErr(play(blocked, itemId, { column: 0, row: 0 }, { column: 0, row: 2 }))
    expect(noDestination.kind).toBe('ASSISTED_ACTION_REJECTED')
  })

  it('refuses a destination that is not on the outer edge', () => {
    const { state, itemId } = withCardInHand(cmTurn(), 'Galileo Galilei')
    const withFigures = place(state, 'figures/redarmy', 8, 8)
    const refused = unwrapErr(play(withFigures, itemId, { column: 8, row: 8 }, { column: 8, row: 9 }))
    expect(refused.kind).toBe('ASSISTED_ACTION_REJECTED')

    // Rule 332's same-square lock needs the source itself to be on the edge.
    const sameSquare = unwrapErr(play(withFigures, itemId, { column: 8, row: 8 }, { column: 8, row: 8 }))
    expect(sameSquare.kind).toBe('ASSISTED_ACTION_REJECTED')
  })
})
