/**
 * Board history, undo and replay.
 *
 * Every change to the board is recorded, which makes two things possible:
 * taking back the last change, and stepping through the whole game to see what
 * the others did. Replay rebuilds the pieces from an empty board, so the tests
 * here check that forwards and backwards agree at every step.
 */

import { describe, expect, it } from 'vitest'

import {
  bringToFront,
  clearBoard,
  movePiece,
  placePiece,
  removePiece,
  rotatePiece,
  sendToBack,
  undoLastBoardChange,
} from '../src/actions/board.js'
import { draw } from '../src/actions/draw.js'
import { piecesAtStep } from '../src/board.js'
import type { BoardPiece } from '../src/board.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'

import { CASH1981, KARANDRAS1, firstCivGame } from './fixture.js'

const place = (state: GameState, assetId: string, x: number, y: number): GameState =>
  unwrap(placePiece(state, { playerId: CASH1981, assetId, x, y }))

/** Pieces compared by what they are and where, ignoring nothing. */
const snapshot = (pieces: readonly BoardPiece[]): string => JSON.stringify(pieces)

/** Runs a sequence of changes and returns every intermediate board. */
function timeline(actions: readonly ((state: GameState) => GameState)[]): {
  readonly states: readonly GameState[]
  readonly final: GameState
} {
  const states: GameState[] = [firstCivGame()]
  for (const action of actions) {
    states.push(action(states.at(-1) as GameState))
  }
  return { states, final: states.at(-1) as GameState }
}

describe('recording', () => {
  it('a new board has no history', () => {
    expect(firstCivGame().board.history).toHaveLength(0)
  })

  it('placing a piece records who did it and where', () => {
    const state = place(firstCivGame(), 'figures/redarmy', 200, 300)
    const entry = state.board.history[0]

    expect(state.board.history).toHaveLength(1)
    expect(entry?.playerId).toBe(CASH1981)
    expect(entry?.username).toBe('cash1981')
    expect(entry?.change.kind).toBe('place')
    expect(entry?.description).toBe('cash1981 placed Red army at C4')
  })

  it('moving records both ends of the move', () => {
    let state = place(firstCivGame(), 'figures/redarmy', 200, 300)
    const piece = state.board.pieces[0] as BoardPiece

    state = unwrap(movePiece(state, { playerId: CASH1981, pieceId: piece.id, x: 800, y: 800 }))

    const entry = state.board.history.at(-1)
    expect(entry?.description).toBe('cash1981 moved Red army from C4 to I9')
    expect(entry?.change).toMatchObject({
      kind: 'move',
      from: { x: 200, y: 300 },
      to: { x: 800, y: 800 },
    })
  })

  it('turning, stacking and removing are all recorded', () => {
    let state = place(firstCivGame(), 'tiles/tile01', 0, 0)
    state = place(state, 'figures/redarmy', 100, 100)
    const tile = state.board.pieces.find((piece) => piece.category === 'tile') as BoardPiece

    state = unwrap(rotatePiece(state, { playerId: CASH1981, pieceId: tile.id }))
    state = unwrap(bringToFront(state, { playerId: CASH1981, pieceId: tile.id }))
    state = unwrap(sendToBack(state, { playerId: CASH1981, pieceId: tile.id }))
    state = unwrap(removePiece(state, { playerId: CASH1981, pieceId: tile.id }))

    expect(state.board.history.map((entry) => entry.change.kind)).toEqual([
      'place',
      'place',
      'rotate',
      'reorder',
      'reorder',
      'remove',
    ])
    expect(state.board.history.at(-1)?.description).toContain('removed Tile 01')
  })

  it('the timestamp comes from the caller, since the engine stays pure', () => {
    const at = '2026-09-15T10:00:00.000Z'
    const state = unwrap(
      placePiece(firstCivGame(), {
        playerId: CASH1981,
        assetId: 'markers/coin',
        x: 0,
        y: 0,
        at,
      }),
    )
    expect(state.board.history[0]?.at).toBe(at)
  })

  it('each entry remembers how long the game log was', () => {
    // Lets replay trim the log to what was known at the time
    let state = firstCivGame()
    state = place(state, 'markers/coin', 0, 0)
    const before = state.board.history[0]?.logLength

    state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'HUTS' }))
    state = place(state, 'markers/culture', 100, 0)

    expect(before).toBe(0)
    expect(state.board.history[1]?.logLength).toBeGreaterThan(0)
  })

  it('automatic placements are recorded too', () => {
    const state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'TILES' }))
    expect(state.board.history).toHaveLength(1)
    expect(state.board.history[0]?.change.kind).toBe('place')
  })
})

describe('undo', () => {
  it('takes back the last change and drops it from the history', () => {
    const before = firstCivGame()
    const after = place(before, 'figures/redarmy', 200, 300)
    const undone = unwrap(undoLastBoardChange(after, CASH1981))

    expect(undone.board.pieces).toHaveLength(0)
    expect(undone.board.history).toHaveLength(0)
  })

  it('restores the exact position after a move', () => {
    let state = place(firstCivGame(), 'figures/redarmy', 200, 300)
    const original = snapshot(state.board.pieces)
    const piece = state.board.pieces[0] as BoardPiece

    state = unwrap(movePiece(state, { playerId: CASH1981, pieceId: piece.id, x: 900, y: 900 }))
    state = unwrap(undoLastBoardChange(state, CASH1981))

    expect(snapshot(state.board.pieces)).toBe(original)
  })

  it('restores the stacking order after bring to front', () => {
    let state = firstCivGame()
    state = place(state, 'figures/redarmy', 100, 100)
    state = place(state, 'figures/bluearmy', 100, 100)
    state = place(state, 'figures/greenarmy', 100, 100)
    const original = snapshot(state.board.pieces)

    const bottom = state.board.pieces[0] as BoardPiece
    state = unwrap(bringToFront(state, { playerId: CASH1981, pieceId: bottom.id }))
    expect(snapshot(state.board.pieces)).not.toBe(original)

    state = unwrap(undoLastBoardChange(state, CASH1981))
    expect(snapshot(state.board.pieces)).toBe(original)
  })

  it('puts a removed piece back where it was in the stack', () => {
    let state = firstCivGame()
    state = place(state, 'figures/redarmy', 100, 100)
    state = place(state, 'figures/bluearmy', 100, 100)
    state = place(state, 'figures/greenarmy', 100, 100)
    const original = snapshot(state.board.pieces)

    const middle = state.board.pieces[1] as BoardPiece
    state = unwrap(removePiece(state, { playerId: CASH1981, pieceId: middle.id }))
    state = unwrap(undoLastBoardChange(state, CASH1981))

    expect(snapshot(state.board.pieces)).toBe(original)
  })

  it('brings the whole board back after a clear', () => {
    let state = firstCivGame()
    for (let i = 0; i < 4; i++) state = place(state, 'markers/coin', i * 100, 0)
    const original = snapshot(state.board.pieces)

    state = unwrap(clearBoard(state, { playerId: CASH1981 }))
    expect(state.board.pieces).toHaveLength(0)

    state = unwrap(undoLastBoardChange(state, CASH1981))
    expect(snapshot(state.board.pieces)).toBe(original)
  })

  it('undoes a turn', () => {
    let state = place(firstCivGame(), 'tiles/tile01', 0, 0)
    const piece = state.board.pieces[0] as BoardPiece

    state = unwrap(rotatePiece(state, { playerId: CASH1981, pieceId: piece.id, rotation: 270 }))
    expect(state.board.pieces[0]?.rotation).toBe(270)

    state = unwrap(undoLastBoardChange(state, CASH1981))
    expect(state.board.pieces[0]?.rotation).toBe(0)
  })

  it('another player can undo your change', () => {
    // Everyone may move everything, so everyone may take it back
    const state = place(firstCivGame(), 'figures/redarmy', 200, 300)
    const undone = unwrap(undoLastBoardChange(state, KARANDRAS1))
    expect(undone.board.pieces).toHaveLength(0)
  })

  it('an empty history gives NOTHING_TO_UNDO_ON_BOARD', () => {
    expect(unwrapErr(undoLastBoardChange(firstCivGame(), CASH1981))).toEqual({
      kind: 'NOTHING_TO_UNDO_ON_BOARD',
    })
  })

  it('repeated undo walks all the way back to an empty board', () => {
    let state = firstCivGame()
    state = place(state, 'figures/redarmy', 100, 100)
    state = place(state, 'markers/coin', 300, 300)
    const piece = state.board.pieces[0] as BoardPiece
    state = unwrap(movePiece(state, { playerId: CASH1981, pieceId: piece.id, x: 700, y: 700 }))
    state = unwrap(rotatePiece(state, { playerId: CASH1981, pieceId: piece.id }))

    while (state.board.history.length > 0) {
      state = unwrap(undoLastBoardChange(state, CASH1981))
    }
    expect(state.board.pieces).toHaveLength(0)
  })
})

describe('replay', () => {
  /** The same sequence used by several tests below. */
  const sequence = [
    (state: GameState) => place(state, 'tiles/tile01', 0, 0),
    (state: GameState) => place(state, 'figures/redarmy', 100, 100),
    (state: GameState) => place(state, 'resources/wheat', 300, 300),
    (state: GameState) =>
      unwrap(
        movePiece(state, {
          playerId: CASH1981,
          pieceId: state.board.pieces[1]?.id as string,
          x: 600,
          y: 600,
        }),
      ),
    (state: GameState) =>
      unwrap(
        rotatePiece(state, {
          playerId: CASH1981,
          pieceId: state.board.pieces[0]?.id as string,
          rotation: 180,
        }),
      ),
    (state: GameState) =>
      unwrap(
        sendToBack(state, {
          playerId: CASH1981,
          pieceId: state.board.pieces.at(-1)?.id as string,
        }),
      ),
  ]

  it('step 0 is the empty board the game started from', () => {
    const { final } = timeline(sequence)
    expect(piecesAtStep(final.board.history, 0)).toHaveLength(0)
  })

  it('the last step matches the board as it stands now', () => {
    const { final } = timeline(sequence)
    expect(snapshot(piecesAtStep(final.board.history, final.board.history.length))).toBe(
      snapshot(final.board.pieces),
    )
  })

  it('every intermediate step matches how the board actually looked', () => {
    const { states, final } = timeline(sequence)

    // states[0] is before any change, so step N lines up with states[N]
    for (let step = 0; step <= final.board.history.length; step++) {
      expect(
        snapshot(piecesAtStep(final.board.history, step)),
        `step ${step} does not match`,
      ).toBe(snapshot((states[step] as GameState).board.pieces))
    }
  })

  it('stepping past the end is the same as the end', () => {
    const { final } = timeline(sequence)
    expect(snapshot(piecesAtStep(final.board.history, 999))).toBe(
      snapshot(final.board.pieces),
    )
  })

  it('a negative step is the same as the start', () => {
    const { final } = timeline(sequence)
    expect(piecesAtStep(final.board.history, -5)).toHaveLength(0)
  })

  it('survives a clear in the middle of the sequence', () => {
    const { states, final } = timeline([
      ...sequence,
      (state: GameState) => unwrap(clearBoard(state, { playerId: CASH1981 })),
      (state: GameState) => place(state, 'markers/coin', 50, 50),
    ])

    for (let step = 0; step <= final.board.history.length; step++) {
      expect(snapshot(piecesAtStep(final.board.history, step))).toBe(
        snapshot((states[step] as GameState).board.pieces),
      )
    }
  })
})

describe('purity', () => {
  it('recording a change does not mutate the input state', () => {
    const before = place(firstCivGame(), 'figures/redarmy', 100, 100)
    const frozen = JSON.stringify(before)

    const piece = before.board.pieces[0] as BoardPiece
    unwrap(movePiece(before, { playerId: CASH1981, pieceId: piece.id, x: 500, y: 500 }))

    expect(JSON.stringify(before)).toBe(frozen)
  })
})
