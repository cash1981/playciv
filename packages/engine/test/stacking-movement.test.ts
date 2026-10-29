/**
 * Stacking during figure movement (issue #302): own figures share a square up to
 * the stacking limit, which is absolute (rules 50 to 53); another player's
 * square is never an ending square here and is crossed only with Flight.
 */

import { describe, expect, it } from 'vitest'

import { placePiece, travelFigure } from '../src/actions/board.js'
import { mapCellOf } from '../src/blockade.js'
import { SQUARE_SIZE, findBoardAsset, mapTop } from '../src/board.js'
import type { BoardPiece } from '../src/board.js'
import { figureMovementOptions } from '../src/movement.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState, Playerhand } from '../src/state.js'

import { coverMap } from './cover-map.js'
import { CASH1981, KARANDRAS1, firstCivGame } from './fixture.js'

function game(stacking: number): GameState {
  const base = firstCivGame()
  const colours = ['Red', 'Blue', 'Green', 'Purple']
  return {
    ...base,
    players: base.players.map((player, index) => ({
      ...player,
      color: colours[index] ?? 'Yellow',
      stats: { ...player.stats, mvmt: '3', stacking },
    })),
  }
}

const playerOf = (state: GameState): Playerhand => {
  const player = state.players.find((candidate) => candidate.playerId === CASH1981)
  if (player === undefined) throw new Error('missing fixture player')
  return player
}

function place(state: GameState, assetId: string, column: number, row: number, playerId = CASH1981): GameState {
  state = coverMap(state)
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`missing asset ${assetId}`)
  return unwrap(
    placePiece(state, {
      playerId,
      assetId,
      x: Math.round(column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2),
      y: Math.round(mapTop(state.board) + row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2),
    }),
  )
}

const figures = (state: GameState): readonly BoardPiece[] =>
  state.board.pieces.filter((piece) => piece.category === 'figure')

function destinationsOf(state: GameState, piece: BoardPiece, flight = false) {
  const player = playerOf(state)
  const options = figureMovementOptions(
    state.board,
    {
      ...player,
      stackingLimit: player.stats.stacking,
      techsChosen: flight ? [{ name: 'Flight', hidden: false } as Playerhand['techsChosen'][number]] : player.techsChosen,
    },
    piece,
    1,
  )
  if (options === null) throw new Error('expected movement options')
  return options.destinations
}

describe('stacking on own figures', () => {
  it('lets a figure end on a square with room under the stacking limit', () => {
    let state = game(2)
    state = place(state, 'figures/redarmy', 1, 1)
    state = place(state, 'figures/redscout', 2, 1)
    const [mover] = figures(state)
    if (mover === undefined) throw new Error('no figure')

    expect(destinationsOf(state, mover)).toContainEqual(expect.objectContaining({ column: 2, row: 1, distance: 1 }))
  })

  it('closes a square that is already at the stacking limit', () => {
    let state = game(2)
    state = place(state, 'figures/redarmy', 1, 1)
    state = place(state, 'figures/redscout', 2, 1)
    state = place(state, 'figures/redarmy', 2, 1)
    const mover = figures(state)[0] as BoardPiece

    expect(destinationsOf(state, mover).some((cell) => cell.column === 2 && cell.row === 1)).toBe(false)
  })

  it('does not cross a full square either (rule 50)', () => {
    let state = game(1)
    state = place(state, 'figures/redarmy', 1, 1)
    state = place(state, 'figures/redscout', 2, 1)
    const mover = figures(state)[0] as BoardPiece

    // The square beyond is four steps around the stack, beyond a speed of 3, and not two straight on.
    expect(destinationsOf(state, mover).some((cell) => cell.column === 3 && cell.row === 1)).toBe(false)
  })

  it('crosses a square with room on the way', () => {
    let state = game(2)
    state = place(state, 'figures/redarmy', 1, 1)
    state = place(state, 'figures/redscout', 2, 1)
    const mover = figures(state)[0] as BoardPiece

    expect(destinationsOf(state, mover)).toContainEqual(expect.objectContaining({ column: 3, row: 1, distance: 2 }))
  })

  it('moves onto an own figure through the route and refuses a full square', () => {
    let state = game(2)
    state = place(state, 'figures/redarmy', 1, 1)
    state = place(state, 'figures/redscout', 2, 1)
    const mover = figures(state)[0] as BoardPiece

    const stacked = unwrap(travelFigure(state, { playerId: CASH1981, pieceId: mover.id, column: 2, row: 1 }))
    const cells = figures(stacked).map((piece) => mapCellOf(stacked.board, piece))
    expect(cells.filter((cell) => cell?.column === 2 && cell.row === 1)).toHaveLength(2)

    const full = place(stacked, 'figures/redarmy', 1, 3)
    const another = figures(full).at(-1) as BoardPiece
    expect(
      unwrapErr(travelFigure(full, { playerId: CASH1981, pieceId: another.id, column: 2, row: 1 })).kind,
    ).toBe('FIGURE_MOVE_ILLEGAL')
  })
})

describe('another player\'s figures', () => {
  it('lets an army land on them, ends the move there and does not cross them without Flight', () => {
    let state = game(3)
    state = place(state, 'figures/redarmy', 1, 1)
    state = place(state, 'figures/bluearmy', 2, 1, KARANDRAS1)
    const mover = figures(state)[0] as BoardPiece

    const cells = destinationsOf(state, mover)
    expect(cells.find((cell) => cell.column === 2 && cell.row === 1)).toMatchObject({ distance: 1, contact: true })
    // The square beyond is not reached through the enemy square: only around it, which is too far
    expect(cells.some((cell) => cell.column === 3 && cell.row === 1)).toBe(false)
  })

  it('crosses them with Flight (rule 52) and may also land on them', () => {
    let state = game(3)
    state = place(state, 'figures/redarmy', 1, 1)
    state = place(state, 'figures/bluearmy', 2, 1, KARANDRAS1)
    const mover = figures(state)[0] as BoardPiece

    const cells = destinationsOf(state, mover, true)
    expect(cells.find((cell) => cell.column === 2 && cell.row === 1)?.contact).toBe(true)
    expect(cells.find((cell) => cell.column === 3 && cell.row === 1)?.distance).toBe(2)
  })

  it('never lets a scout attack (rule 431): it cannot land on them', () => {
    let state = game(3)
    state = place(state, 'figures/redscout', 1, 1)
    state = place(state, 'figures/bluearmy', 2, 1, KARANDRAS1)
    const mover = figures(state)[0] as BoardPiece

    expect(destinationsOf(state, mover).some((cell) => cell.column === 2 && cell.row === 1)).toBe(false)
    expect(destinationsOf(state, mover).some((cell) => cell.column === 3 && cell.row === 1)).toBe(false)
    const flying = destinationsOf(state, mover, true)
    expect(flying.some((cell) => cell.column === 2 && cell.row === 1)).toBe(false)
    expect(flying.find((cell) => cell.column === 3 && cell.row === 1)?.distance).toBe(2)
  })

  it('travels onto them through the route, and logs that the battle is settled by hand', () => {
    let state = game(3)
    state = place(state, 'figures/redarmy', 1, 1)
    state = place(state, 'figures/bluearmy', 2, 1, KARANDRAS1)
    const mover = figures(state)[0] as BoardPiece

    const moved = unwrap(travelFigure(state, { playerId: CASH1981, pieceId: mover.id, column: 2, row: 1 }))
    expect(moved.board.history.at(-1)?.description).toContain('settle the battle and loot by hand')
    expect(
      unwrapErr(travelFigure(state, { playerId: CASH1981, pieceId: mover.id, column: 3, row: 1 })).kind,
    ).toBe('FIGURE_MOVE_ILLEGAL')
  })

  it('does not count them against your stacking limit (rule 51)', () => {
    let state = game(1)
    state = place(state, 'figures/redarmy', 1, 1)
    state = place(state, 'figures/bluearmy', 2, 1, KARANDRAS1)
    state = place(state, 'figures/bluescout', 2, 1, KARANDRAS1)
    state = place(state, 'figures/bluearmy', 2, 1, KARANDRAS1)
    const mover = figures(state)[0] as BoardPiece

    // Three enemy figures on a square, a limit of 1 for the mover: Flight still crosses it
    expect(destinationsOf(state, mover, true).find((cell) => cell.column === 3 && cell.row === 1)?.distance).toBe(2)
  })
})
