/**
 * `GameState.createdAt`, so the old list view's "Created" column has a source.
 * There is no Java counterpart: the old client showed `PBF.created`, which the
 * rewrite never carried across. The server stamps the timestamp; the engine is
 * pure and only stores what it is given.
 *
 * Also the board each player count is dealt: the rulebooks draw four different
 * maps, so this is where the shape is pinned to the player count.
 */

import { describe, expect, it } from 'vitest'

import { createBoard, TILE_SQUARES } from '../src/board.js'
import { createGame } from '../src/create-game.js'
import { migrateGameState } from '../src/migrate.js'
import { placePiece } from '../src/actions/board.js'
import { unwrap } from '../src/result.js'
import type { GameState } from '../src/state.js'

const STAMP = '2026-09-20T12:00:00.000Z'

const PLAYER = 'player-one'

const game = (numOfPlayers: number): GameState =>
  createGame({
    name: 'shapes',
    numOfPlayers,
    seed: 'shapes',
    players: [{ playerId: PLAYER, username: 'one' }],
  })

describe('createGame createdAt', () => {
  it('stores the timestamp it is given', () => {
    const state = createGame({
      name: 'stamped',
      numOfPlayers: 4,
      seed: 'stamped',
      createdAt: STAMP,
    })

    expect(state.createdAt).toBe(STAMP)
  })

  it('defaults to null when it is not given', () => {
    const state = createGame({ name: 'unstamped', numOfPlayers: 4, seed: 'unstamped' })

    expect(state.createdAt).toBeNull()
  })
})

describe('migrateGameState createdAt', () => {
  it('defaults a game saved before the field existed to null', () => {
    const state = createGame({
      name: 'older',
      numOfPlayers: 4,
      seed: 'older',
      createdAt: STAMP,
    })
    const { createdAt: _createdAt, ...without } = state

    const migrated = migrateGameState(without as unknown as GameState)

    expect(migrated.createdAt).toBeNull()
  })

  it('keeps an existing createdAt', () => {
    const state = createGame({
      name: 'current',
      numOfPlayers: 4,
      seed: 'current',
      createdAt: STAMP,
    })

    expect(migrateGameState(state).createdAt).toBe(STAMP)
  })
})

describe('the board each player count gets', () => {
  it('gives one and four players the full 16 x 16 rectangle', () => {
    for (const numOfPlayers of [1, 4]) {
      const board = game(numOfPlayers).board
      expect([board.columns, board.rows], `${numOfPlayers} players`).toEqual([16, 16])
      expect(board.slots).toHaveLength(16)
      expect(board.slotStep).toBe(TILE_SQUARES)
    }
  })

  it('gives two players the half-height 16 x 8 rectangle', () => {
    const board = game(2).board
    expect([board.columns, board.rows]).toEqual([16, 8])
    expect(board.slots).toHaveLength(8)
    expect(board.slotStep).toBe(TILE_SQUARES)
  })

  it('gives three players the stepped pyramid', () => {
    const board = game(3).board
    expect([board.columns, board.rows]).toEqual([16, 16])
    expect(board.slots).toHaveLength(10)
    expect(board.slotStep).toBe(TILE_SQUARES / 2)
    expect(board.startSlots).toHaveLength(3)
  })

  it('gives five players the holed 28 x 18 map with five starts', () => {
    const board = game(5).board
    expect([board.columns, board.rows]).toEqual([28, 18])
    expect(board.slots).toHaveLength(22)
    expect(board.slotStep).toBe(TILE_SQUARES / 2)
    expect(board.startSlots).toHaveLength(5)
  })
})

describe('migrateGameState board shape', () => {
  /** A board as saved before the shape existed: columns and rows, no slots. */
  const withoutShape = (state: GameState): GameState => {
    const { slots: _slots, slotStep: _slotStep, startSlots: _startSlots, ...older } = state.board
    return { ...state, board: older as unknown as GameState['board'] }
  }

  it('fills a rectangle shape into a board saved without one', () => {
    const migrated = migrateGameState(withoutShape(game(4)))

    expect(migrated.board.slots).toEqual(createBoard(16, 16).slots)
    expect(migrated.board.slotStep).toBe(TILE_SQUARES)
    expect(migrated.board.startSlots).toEqual(createBoard(16, 16).startSlots)
  })

  it('keeps the pieces exactly where they were', () => {
    const placed = unwrap(
      placePiece(game(4), {
        playerId: PLAYER,
        assetId: 'figures/redarmy',
        x: 376,
        y: 0,
      }),
    )
    const migrated = migrateGameState(withoutShape(placed))

    expect(migrated.board.pieces).toEqual(placed.board.pieces)
  })
})
