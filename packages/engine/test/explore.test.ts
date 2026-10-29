/**
 * Map-tile discovery (issue #302): fog cannot be walked onto, a figure next to
 * it may spend 1 movement to explore, and the drawn tile lands in that slot.
 */

import { describe, expect, it } from 'vitest'

import { placePiece, travelFigure, undoLastBoardChange } from '../src/actions/board.js'
import { exploreSquare } from '../src/actions/explore.js'
import { SQUARE_SIZE, findBoardAsset, mapTop } from '../src/board.js'
import type { BoardPiece } from '../src/board.js'
import { isExploredCell, isUnexploredCell } from '../src/explore.js'
import { figureMovementOptions, movementOf } from '../src/movement.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState, Playerhand } from '../src/state.js'

import { CASH1981, firstCivGame } from './fixture.js'

function game(): GameState {
  const base = firstCivGame()
  const colours = ['Red', 'Blue', 'Green', 'Purple']
  return {
    ...base,
    players: base.players.map((player, index) => ({
      ...player,
      color: colours[index] ?? 'Yellow',
      stats: { ...player.stats, mvmt: '3', stacking: 2 },
    })),
  }
}

const playerOf = (state: GameState): Playerhand => {
  const player = state.players.find((candidate) => candidate.playerId === CASH1981)
  if (player === undefined) throw new Error('missing fixture player')
  return player
}

function place(state: GameState, assetId: string, column: number, row: number): GameState {
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

/** One explored tile in the top-left slot (squares A1 to D4); everything else is fog. */
const withStartTile = (state: GameState): GameState =>
  unwrap(placePiece(state, { playerId: CASH1981, assetId: 'tiles/tile05', x: 0, y: mapTop(state.board) }))

const armyOf = (state: GameState): BoardPiece => {
  const piece = state.board.pieces.find((candidate) => candidate.category === 'figure')
  if (piece === undefined) throw new Error('no figure on the board')
  return piece
}

const tilesOn = (state: GameState): number => state.board.pieces.filter((piece) => piece.category === 'tile').length

const optionsOf = (state: GameState, turn = 1) => {
  const options = figureMovementOptions(state.board, { ...playerOf(state), stackingLimit: 2 }, armyOf(state), turn)
  if (options === null) throw new Error('expected movement options')
  return options
}

describe('fog', () => {
  it('is a slot with no tile under it', () => {
    const state = withStartTile(game())
    expect(isExploredCell(state.board, { column: 3, row: 3 })).toBe(true)
    expect(isUnexploredCell(state.board, { column: 4, row: 3 })).toBe(true)
  })

  it('is not walked onto, but a figure next to it may explore it', () => {
    const state = place(withStartTile(game()), 'figures/redarmy', 3, 1)
    const options = optionsOf(state)

    expect(options.destinations.some((cell) => cell.column === 4)).toBe(false)
    expect(options.explore).toEqual([expect.objectContaining({ column: 4, row: 1, label: 'E2', distance: 1 })])
  })

  it('offers nothing to explore from the middle of a tile', () => {
    const state = place(withStartTile(game()), 'figures/redarmy', 1, 1)
    expect(optionsOf(state).explore).toHaveLength(0)
  })
})

describe('exploreSquare', () => {
  it('spends 1 movement, lays the drawn tile in that slot and leaves the figure free to move', () => {
    const state = place(withStartTile(game()), 'figures/redarmy', 3, 1)
    const figure = armyOf(state)
    const explored = unwrap(
      exploreSquare(state, { playerId: CASH1981, pieceId: figure.id, column: 4, row: 1 }),
    )

    expect(tilesOn(explored)).toBe(2)
    expect(isExploredCell(explored.board, { column: 4, row: 1 })).toBe(true)
    expect(movementOf(armyOf(explored), 1)).toMatchObject({ used: 1, locked: false })
    const [x, y] = [4 * SQUARE_SIZE, mapTop(explored.board)]
    expect(explored.board.pieces.some((piece) => piece.category === 'tile' && piece.x === x && piece.y === y)).toBe(true)

    const after = optionsOf(explored)
    expect(after.remaining).toBe(2)
    // The new tile is walkable now.
    expect(after.destinations).toContainEqual(expect.objectContaining({ column: 4, row: 1, distance: 1 }))
  })

  it('keeps the whole speed: after exploring, travel cannot go past what is left', () => {
    const state = place(withStartTile(game()), 'figures/redarmy', 3, 3)
    const explored = unwrap(
      exploreSquare(state, { playerId: CASH1981, pieceId: armyOf(state).id, column: 4, row: 3 }),
    )
    // Speed 3, 1 spent: nothing farther than 2 squares is offered, and the route refuses it
    expect(Math.max(...optionsOf(explored).destinations.map((cell) => cell.distance))).toBe(2)
    expect(
      unwrapErr(travelFigure(explored, { playerId: CASH1981, pieceId: armyOf(explored).id, column: 6, row: 3 })).kind,
    ).toBe('FIGURE_MOVE_ILLEGAL')
    const travelled = unwrap(
      travelFigure(explored, { playerId: CASH1981, pieceId: armyOf(explored).id, column: 5, row: 3 }),
    )
    expect(movementOf(armyOf(travelled), 1)).toMatchObject({ used: 3, locked: true })
  })

  it('may explore after the figure has travelled to the edge', () => {
    const state = place(withStartTile(game()), 'figures/redarmy', 1, 1)
    const travelled = unwrap(travelFigure(state, { playerId: CASH1981, pieceId: armyOf(state).id, column: 3, row: 1 }))
    // Speed 3: 2 spent, still free to move or explore
    expect(movementOf(armyOf(travelled), 1)).toMatchObject({ used: 2, locked: false })

    const explored = unwrap(
      exploreSquare(travelled, { playerId: CASH1981, pieceId: armyOf(travelled).id, column: 4, row: 1 }),
    )
    expect(movementOf(armyOf(explored), 1)).toMatchObject({ used: 3, locked: false })
  })

  it('moves, explores and moves again within the speed, then is locked', () => {
    const state = place(withStartTile(game()), 'figures/redarmy', 2, 3)
    const id = armyOf(state).id
    const moved = unwrap(travelFigure(state, { playerId: CASH1981, pieceId: id, column: 3, row: 3 }))
    const explored = unwrap(exploreSquare(moved, { playerId: CASH1981, pieceId: id, column: 4, row: 3 }))
    expect(movementOf(armyOf(explored), 1)).toMatchObject({ used: 2, locked: false })

    const again = unwrap(travelFigure(explored, { playerId: CASH1981, pieceId: id, column: 4, row: 3 }))
    expect(movementOf(armyOf(again), 1)).toMatchObject({ used: 3, locked: true })
  })

  it('cannot explore once the movement has ended on a hut', () => {
    let state = place(withStartTile(game()), 'figures/redarmy', 2, 3)
    state = place(state, 'resources/hut', 3, 3)
    const id = armyOf(state).id
    const ended = unwrap(travelFigure(state, { playerId: CASH1981, pieceId: id, column: 3, row: 3 }))
    expect(movementOf(armyOf(ended), 1)).toMatchObject({ used: 1, locked: true })
    expect(
      unwrapErr(exploreSquare(ended, { playerId: CASH1981, pieceId: id, column: 4, row: 3 })).kind,
    ).toBe('FIGURE_MOVE_ILLEGAL')
  })

  it('needs movement left', () => {
    const state = place(withStartTile(game()), 'figures/redarmy', 0, 3)
    const travelled = unwrap(travelFigure(state, { playerId: CASH1981, pieceId: armyOf(state).id, column: 3, row: 3 }))
    // 3 squares of a speed of 3: nothing left for the tile.
    const refused = unwrapErr(
      exploreSquare(travelled, { playerId: CASH1981, pieceId: armyOf(travelled).id, column: 4, row: 3 }),
    )
    expect(refused.kind).toBe('FIGURE_MOVE_ILLEGAL')
  })

  it('refuses a square that is not next to the figure, or already explored', () => {
    const state = place(withStartTile(game()), 'figures/redarmy', 2, 1)
    const id = armyOf(state).id
    expect(unwrapErr(exploreSquare(state, { playerId: CASH1981, pieceId: id, column: 4, row: 1 })).kind).toBe(
      'FIGURE_MOVE_ILLEGAL',
    )
    expect(unwrapErr(exploreSquare(state, { playerId: CASH1981, pieceId: id, column: 1, row: 1 })).kind).toBe(
      'FIGURE_MOVE_ILLEGAL',
    )
  })

  it('refuses a figure a card has locked this turn', () => {
    let state = place(withStartTile(game()), 'figures/redarmy', 3, 1)
    state = {
      ...state,
      board: {
        ...state.board,
        pieces: state.board.pieces.map((piece) =>
          piece.category === 'figure'
            ? { ...piece, movement: { turn: 1, used: 0, locked: true, reason: 'galileo' as const } }
            : piece,
        ),
      },
    }
    const refused = unwrapErr(
      exploreSquare(state, { playerId: CASH1981, pieceId: armyOf(state).id, column: 4, row: 1 }),
    )
    expect(refused.kind).toBe('FIGURE_MOVE_ILLEGAL')
  })

  it('is taken back by two board Undos: the tile first, then the movement', () => {
    const state = place(withStartTile(game()), 'figures/redarmy', 3, 1)
    const explored = unwrap(
      exploreSquare(state, { playerId: CASH1981, pieceId: armyOf(state).id, column: 4, row: 1 }),
    )
    const noTile = unwrap(undoLastBoardChange(explored, CASH1981))
    expect(tilesOn(noTile)).toBe(1)
    expect(movementOf(armyOf(noTile), 1)).toMatchObject({ used: 1 })

    const refunded = unwrap(undoLastBoardChange(noTile, CASH1981))
    expect(movementOf(armyOf(refunded), 1)).toBeNull()
  })

  it("refuses another player's figure", () => {
    const state = place(withStartTile(game()), 'figures/bluearmy', 3, 1)
    const refused = unwrapErr(
      exploreSquare(state, { playerId: CASH1981, pieceId: armyOf(state).id, column: 4, row: 1 }),
    )
    expect(refused.kind).toBe('FIGURE_MOVE_ILLEGAL')
  })
})
