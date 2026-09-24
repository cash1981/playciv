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
  movePiece,
  placePiece,
  redoLastBoardChange,
  removePiece,
  rotatePiece,
  sendToBack,
  undoLastBoardChange,
} from '../src/actions/board.js'
import { draw } from '../src/actions/draw.js'
import { mapTop, piecesAtStep } from '../src/board.js'
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
    const top = mapTop(firstCivGame().board)
    const state = place(firstCivGame(), 'figures/redarmy', 200, top + 300)
    const entry = state.board.history[0]

    expect(state.board.history).toHaveLength(1)
    expect(entry?.playerId).toBe(CASH1981)
    expect(entry?.username).toBe('cash1981')
    expect(entry?.change.kind).toBe('place')
    expect(entry?.description).toBe('cash1981 placed Red army at C4')
  })

  it('moving records both ends of the move', () => {
    const top = mapTop(firstCivGame().board)
    let state = place(firstCivGame(), 'figures/redarmy', 200, top + 300)
    const piece = state.board.pieces[0] as BoardPiece

    state = unwrap(
      movePiece(state, { playerId: CASH1981, pieceId: piece.id, x: 800, y: top + 800 }),
    )

    const entry = state.board.history.at(-1)
    expect(entry?.description).toBe('cash1981 moved Red army from C4 to I9')
    expect(entry?.change).toMatchObject({
      kind: 'move',
      from: { x: 200, y: top + 300 },
      to: { x: 800, y: top + 800 },
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
        assetId: 'markers/coin1',
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
    state = place(state, 'markers/coin1', 0, 0)
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

  it('undoes a turn', () => {
    let state = place(firstCivGame(), 'tiles/tile01', 0, 0)
    const piece = state.board.pieces[0] as BoardPiece

    state = unwrap(rotatePiece(state, { playerId: CASH1981, pieceId: piece.id, rotation: 270 }))
    expect(state.board.pieces[0]?.rotation).toBe(270)

    state = unwrap(undoLastBoardChange(state, CASH1981))
    expect(state.board.pieces[0]?.rotation).toBe(0)
  })

  it('another player cannot undo your change', () => {
    // Everyone may move everything, but only your own moves are yours to undo
    const state = place(firstCivGame(), 'figures/redarmy', 200, 300)
    expect(unwrapErr(undoLastBoardChange(state, KARANDRAS1))).toEqual({
      kind: 'BOARD_UNDO_NOT_YOURS',
    })
    expect(state.board.pieces).toHaveLength(1)
  })

  it('an empty history gives NOTHING_TO_UNDO_ON_BOARD', () => {
    expect(unwrapErr(undoLastBoardChange(firstCivGame(), CASH1981))).toEqual({
      kind: 'NOTHING_TO_UNDO_ON_BOARD',
    })
  })

  it('repeated undo by the same player walks all the way back to an empty board', () => {
    let state = firstCivGame()
    state = place(state, 'figures/redarmy', 100, 100)
    state = place(state, 'markers/coin1', 300, 300)
    const piece = state.board.pieces[0] as BoardPiece
    state = unwrap(movePiece(state, { playerId: CASH1981, pieceId: piece.id, x: 700, y: 700 }))
    state = unwrap(rotatePiece(state, { playerId: CASH1981, pieceId: piece.id }))

    while (state.board.history.length > 0) {
      state = unwrap(undoLastBoardChange(state, CASH1981))
    }
    expect(state.board.pieces).toHaveLength(0)
  })

  it('stops when another player has since put their own change on top', () => {
    let state = place(firstCivGame(), 'figures/redarmy', 100, 100)
    state = unwrap(placePiece(state, { playerId: KARANDRAS1, assetId: 'figures/bluearmy', x: 200, y: 200 }))

    expect(unwrapErr(undoLastBoardChange(state, CASH1981))).toEqual({
      kind: 'BOARD_UNDO_NOT_YOURS',
    })
    expect(state.board.pieces).toHaveLength(2)

    // But its own author can still take it back
    const undone = unwrap(undoLastBoardChange(state, KARANDRAS1))
    expect(undone.board.pieces).toHaveLength(1)
  })
})

describe('redo', () => {
  it('brings back the change that undo just took away', () => {
    const state = place(firstCivGame(), 'figures/redarmy', 200, 300)
    const undone = unwrap(undoLastBoardChange(state, CASH1981))
    const redone = unwrap(redoLastBoardChange(undone, CASH1981))

    expect(snapshot(redone.board.pieces)).toBe(snapshot(state.board.pieces))
    expect(redone.board.history).toHaveLength(1)
    expect(redone.board.redo).toHaveLength(0)
  })

  it('is available to any player, not only whoever undid it', () => {
    const state = place(firstCivGame(), 'figures/redarmy', 200, 300)
    const undone = unwrap(undoLastBoardChange(state, CASH1981))
    const redone = unwrap(redoLastBoardChange(undone, KARANDRAS1))

    expect(redone.board.pieces).toHaveLength(1)
  })

  it('an empty redo stack gives NOTHING_TO_REDO_ON_BOARD', () => {
    expect(unwrapErr(redoLastBoardChange(firstCivGame(), CASH1981))).toEqual({
      kind: 'NOTHING_TO_REDO_ON_BOARD',
    })
  })

  it('is cleared by any further change, even from another player', () => {
    let state = place(firstCivGame(), 'figures/redarmy', 200, 300)
    state = unwrap(undoLastBoardChange(state, CASH1981))
    expect(state.board.redo).toHaveLength(1)

    state = unwrap(
      placePiece(state, { playerId: KARANDRAS1, assetId: 'figures/bluearmy', x: 0, y: 0 }),
    )
    expect(state.board.redo).toHaveLength(0)
    expect(unwrapErr(redoLastBoardChange(state, CASH1981))).toEqual({
      kind: 'NOTHING_TO_REDO_ON_BOARD',
    })
  })

  it('chains several undos and redos back and forth', () => {
    let state = firstCivGame()
    state = place(state, 'figures/redarmy', 100, 100)
    state = place(state, 'markers/coin1', 300, 300)
    const afterBoth = snapshot(state.board.pieces)

    state = unwrap(undoLastBoardChange(state, CASH1981))
    state = unwrap(undoLastBoardChange(state, CASH1981))
    expect(state.board.pieces).toHaveLength(0)

    state = unwrap(redoLastBoardChange(state, CASH1981))
    state = unwrap(redoLastBoardChange(state, CASH1981))
    expect(snapshot(state.board.pieces)).toBe(afterBoth)
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
