/**
 * Plays a recorded movement route back one square at a time (issue #362).
 *
 * A move reaches the other players as a board that already has the figure on its destination. The route is
 * stored on the `move` change, so when a newer board arrives (auto refresh, Forward, or Live after a replay)
 * the figure is shown stepping through the squares it entered instead of jumping. Nothing here changes the
 * board: the frames are a display override, and when they run out the real position is what is left.
 */

import { useLayoutEffect, useRef, useState } from 'react'

import { mapTop } from '@civ/engine'
import type { Board, BoardChange } from '@civ/engine'

/** Time spent on each square, and on the starting square before the figure sets off. */
export const MOVE_REPLAY_STEP_MS = 320

/** Only the newest moves are played when many arrive at once (for example Live after a long replay). */
export const MOVE_REPLAY_MAX_MOVES = 4

export interface MoveReplayFrame {
  readonly pieceId: string
  readonly x: number
  readonly y: number
  /** Set when the move was one of a group's: the figures of one group walk together. */
  readonly group?: string
}

type MoveChange = Extract<BoardChange, { readonly kind: 'move' }>

/**
 * The display positions of one recorded move: where it started, the centre of each square entered and the
 * recorded end. Fewer than two frames when the move has no route or the piece is gone.
 */
export function framesOfMove(board: Board, change: MoveChange, group?: string): readonly MoveReplayFrame[] {
  const piece = board.pieces.find((candidate) => candidate.id === change.pieceId)
  if (piece === undefined || change.route === undefined || change.route.length === 0) return []
  const top = mapTop(board)
  // The figure keeps its slot inside each square it passes (its offset at the destination), so the figures of one group,
  // which follow the same route, stay apart on every step instead of piling up on the square's centre
  const centred = (cell: { readonly column: number; readonly row: number }) => ({
    x: cell.column * board.squareSize + (board.squareSize - piece.width) / 2,
    y: top + cell.row * board.squareSize + (board.squareSize - piece.height) / 2,
  })
  const last = centred(change.route[change.route.length - 1] as { readonly column: number; readonly row: number })
  const offset = { x: change.to.x - last.x, y: change.to.y - last.y }
  const squares = change.route.slice(0, -1).map((cell) => {
    const centre = centred(cell)
    return { x: centre.x + offset.x, y: centre.y + offset.y }
  })
  return [change.from, ...squares, change.to].map(({ x, y }) => ({ pieceId: piece.id, x, y, ...(group === undefined ? {} : { group }) }))
}

/**
 * The moves added to the history between two boards, oldest first and limited to the newest few, each as its
 * frames. Empty when the history did not just grow (an undo, another game, a jump back, no change).
 */
export function moveReplaysBetween(
  previous: Board,
  next: Board,
  maxMoves = MOVE_REPLAY_MAX_MOVES,
): readonly (readonly MoveReplayFrame[])[] {
  const last = previous.history.at(-1)
  const known = last === undefined ? -1 : next.history.findIndex((entry) => entry.id === last.id)
  // A board that had no history yet gets every entry; a last entry that is gone (an undo) plays nothing.
  if (last !== undefined && known < 0) return []
  const moves = next.history
    .slice(known + 1)
    .flatMap((entry) => (entry.change.kind === 'move' && entry.change.route !== undefined ? [{ change: entry.change, group: entry.group }] : []))
  // Only the newest moves are played, but a group is never cut in half: when the cutoff falls inside one, all its figures play
  let from = Math.max(0, moves.length - maxMoves)
  while (from > 0 && moves[from]?.group !== undefined && moves[from - 1]?.group === moves[from]?.group) from -= 1
  return moves
    .slice(from)
    .map(({ change, group }) => framesOfMove(next, change, group))
    .filter((frames) => frames.length > 1)
}

/** True when the second board has the same history as the first: nothing was added, undone or redone. */
function sameHistory(a: Board, b: Board): boolean {
  return a.history.length === b.history.length && a.history.at(-1)?.id === b.history.at(-1)?.id
}

export interface MoveReplayPosition {
  readonly x: number
  readonly y: number
  /** False on the starting square (no animation, so the figure appears there), true for every step after it. */
  readonly glide: boolean
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

const NONE: ReadonlyMap<string, MoveReplayPosition> = new Map()

/**
 * The figures to draw somewhere other than their recorded position right now, by piece id. Every figure that
 * is still waiting for its turn is held on its starting square, so none shows on its destination first.
 * Pass the board being displayed; a change of `gameId` never animates.
 */
export function useMoveReplay(
  board: Board,
  gameId: string,
  stepMs = MOVE_REPLAY_STEP_MS,
): ReadonlyMap<string, MoveReplayPosition> {
  const previous = useRef<{ readonly gameId: string; readonly board: Board } | null>(null)
  const timers = useRef<number[]>([])
  const [positions, setPositions] = useState<ReadonlyMap<string, MoveReplayPosition>>(NONE)

  const clear = (): void => {
    for (const timer of timers.current) window.clearTimeout(timer)
    timers.current = []
  }

  useLayoutEffect(() => {
    const before = previous.current
    previous.current = { gameId, board }
    if (before === null || before.board === board) return
    if (before.gameId !== gameId) {
      clear()
      setPositions(NONE)
      return
    }
    // A reload that changed nothing on the board (a note, a trade) must not cut a replay short.
    if (sameHistory(before.board, board)) return
    clear()
    const moves = reducedMotion() ? [] : moveReplaysBetween(before.board, board)
    if (moves.length === 0) {
      setPositions(NONE)
      return
    }
    // Every figure starts on its origin before the browser paints; it then walks when its move comes up.
    const at = (move: readonly MoveReplayFrame[], index: number, glide: boolean): MoveReplayPosition => ({
      x: move[index]!.x,
      y: move[index]!.y,
      glide,
    })
    const initial = new Map<string, MoveReplayPosition>()
    for (const move of moves) if (!initial.has(move[0]!.pieceId)) initial.set(move[0]!.pieceId, at(move, 0, false))
    setPositions(initial)
    // The moves of one group walk at the same time, side by side; every other move waits for the one before it.
    const waves: (readonly MoveReplayFrame[])[][] = []
    for (const move of moves) {
      const group = move[0]!.group
      const wave = waves.at(-1)
      if (group !== undefined && wave !== undefined && wave[0]![0]!.group === group) wave.push(move)
      else waves.push([move])
    }
    // A figure is released to its real position only after its last move; until then it rests on the end of the previous one.
    const lastWaveOf = new Map<string, number>()
    for (const [waveIndex, wave] of waves.entries()) for (const move of wave) lastWaveOf.set(move[0]!.pieceId, waveIndex)
    let offset = 0
    for (const [waveIndex, wave] of waves.entries()) {
      const start = offset
      for (const move of wave) {
        const pieceId = move[0]!.pieceId
        move.forEach((_, index) => {
          if (index === 0 && start === 0) return
          timers.current.push(
            window.setTimeout(
              () => setPositions((current) => new Map(current).set(pieceId, at(move, index, index > 0))),
              start + index * stepMs,
            ),
          )
        })
      }
      offset += Math.max(...wave.map((move) => move.length)) * stepMs
      for (const move of wave) {
        const pieceId = move[0]!.pieceId
        if (lastWaveOf.get(pieceId) !== waveIndex) continue
        timers.current.push(
          window.setTimeout(
            () =>
              setPositions((current) => {
                const next = new Map(current)
                next.delete(pieceId)
                return next
              }),
            start + move.length * stepMs,
          ),
        )
      }
    }
  }, [board, gameId, stepMs])

  useLayoutEffect(() => clear, [])

  return positions
}
