// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBoard, mapTop } from '@civ/engine'
import type { Board, BoardHistoryEntry, BoardPiece } from '@civ/engine'

import { MOVE_REPLAY_STEP_MS, moveReplaysBetween, useMoveReplay } from './moveReplay.js'

const base = createBoard()
const SIZE = base.squareSize

const figure = (x: number, y: number): BoardPiece => ({
  id: 'army',
  assetId: 'army',
  path: 'figures/army.png',
  label: 'Army',
  category: 'figure',
  x,
  y,
  width: 20,
  height: 20,
  rotation: 0,
  placedBy: null,
})

const centre = (column: number, row: number): { x: number; y: number } => ({
  x: column * SIZE + (SIZE - 20) / 2,
  y: mapTop(base) + row * SIZE + (SIZE - 20) / 2,
})

const entry = (id: string, change: BoardHistoryEntry['change']): BoardHistoryEntry => ({
  id,
  at: null,
  playerId: 'p1',
  username: 'p1',
  description: id,
  change,
  logLength: 0,
})

/** A board after one move B6 -> B7 -> B8 (column 1, rows 5 to 7), with or without the recorded route. */
function afterMove(withRoute: boolean): { before: Board; after: Board } {
  const from = centre(1, 5)
  const to = centre(1, 7)
  const before: Board = { ...base, pieces: [figure(from.x, from.y)], history: [entry('h0', { kind: 'rotate', pieceId: 'army', from: 0, to: 0 })] }
  const move = entry('h1', {
    kind: 'move',
    pieceId: 'army',
    from,
    to,
    fromIndex: 0,
    ...(withRoute ? { route: [{ column: 1, row: 6 }, { column: 1, row: 7 }] } : {}),
  })
  return { before, after: { ...before, pieces: [figure(to.x, to.y)], history: [...before.history, move] } }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const flat = (board: Board, after: Board): { x: number; y: number }[] =>
  moveReplaysBetween(board, after).flatMap((move) => move.map(({ x, y }) => ({ x, y })))

/** Adds a second army, moved B1 -> B2 (column 1, rows 0 to 1), after the first one's move. */
function withSecondArmy(): { before: Board; after: Board } {
  const { before, after } = afterMove(true)
  const from = centre(1, 0)
  const to = centre(1, 1)
  const second = { ...figure(to.x, to.y), id: 'army2' }
  const move = entry('h2', {
    kind: 'move',
    pieceId: 'army2',
    from,
    to,
    fromIndex: 1,
    route: [{ column: 1, row: 1 }],
  })
  return {
    before: { ...before, pieces: [...before.pieces, { ...second, x: from.x, y: from.y }] },
    after: { ...after, pieces: [...after.pieces, second], history: [...after.history, move] },
  }
}

describe('moveReplaysBetween', () => {
  it('lists the start, each square entered and the end of a recorded route', () => {
    const { before, after } = afterMove(true)
    expect(flat(before, after)).toEqual([centre(1, 5), centre(1, 6), centre(1, 7)])
  })

  it('has nothing to play for a move without a recorded route, an undo or an unchanged history', () => {
    const plain = afterMove(false)
    expect(moveReplaysBetween(plain.before, plain.after)).toEqual([])
    const routed = afterMove(true)
    expect(moveReplaysBetween(routed.after, routed.before)).toEqual([])
    expect(moveReplaysBetween(routed.after, routed.after)).toEqual([])
  })

  it('plays the first move of a game, whose previous board had no history', () => {
    const { before, after } = afterMove(true)
    expect(flat({ ...before, history: [] }, { ...after, history: [after.history[1]!] })).toEqual([centre(1, 5), centre(1, 6), centre(1, 7)])
  })

  it('plays only the newest moves when many arrive at once', () => {
    const { before, after } = afterMove(true)
    const move = after.history[1]!
    const many: Board = { ...after, history: [...before.history, ...[1, 2, 3, 4, 5].map((n) => ({ ...move, id: `m${n}` }))] }
    expect(moveReplaysBetween(before, many, 2)).toHaveLength(2)
  })
})

describe('useMoveReplay', () => {
  it('steps through the route and then stops overriding the figure', () => {
    const { before, after } = afterMove(true)
    const { result, rerender } = renderHook(({ board }) => useMoveReplay(board, 'g1'), { initialProps: { board: before } })
    expect(result.current.size).toBe(0)

    rerender({ board: after })
    expect(result.current.get('army')).toMatchObject({ ...centre(1, 5), glide: false })
    act(() => void vi.advanceTimersByTime(MOVE_REPLAY_STEP_MS))
    expect(result.current.get('army')).toMatchObject({ ...centre(1, 6), glide: true })
    act(() => void vi.advanceTimersByTime(MOVE_REPLAY_STEP_MS))
    expect(result.current.get('army')).toMatchObject({ ...centre(1, 7), glide: true })
    act(() => void vi.advanceTimersByTime(MOVE_REPLAY_STEP_MS))
    expect(result.current.size).toBe(0)
  })

  it('holds a figure that waits its turn on its start square', () => {
    const { before, after } = withSecondArmy()
    const { result, rerender } = renderHook(({ board }) => useMoveReplay(board, 'g1'), { initialProps: { board: before } })
    rerender({ board: after })
    expect(result.current.get('army2')).toMatchObject({ ...centre(1, 0), glide: false })
    act(() => void vi.advanceTimersByTime(3 * MOVE_REPLAY_STEP_MS))
    // The first army is done; the second sets off from its own origin
    expect(result.current.has('army')).toBe(false)
    expect(result.current.get('army2')).toMatchObject({ ...centre(1, 0), glide: false })
    act(() => void vi.advanceTimersByTime(MOVE_REPLAY_STEP_MS))
    expect(result.current.get('army2')).toMatchObject({ ...centre(1, 1), glide: true })
    act(() => void vi.advanceTimersByTime(2 * MOVE_REPLAY_STEP_MS))
    expect(result.current.size).toBe(0)
  })

  it('walks the figures of one group move side by side instead of one after the other', () => {
    const { before, after } = withSecondArmy()
    const grouped: Board = {
      ...after,
      history: after.history.map((item) => (item.change.kind === 'move' ? { ...item, group: 'h1' } : item)),
    }
    const { result, rerender } = renderHook(({ board }) => useMoveReplay(board, 'g1'), { initialProps: { board: before } })
    rerender({ board: grouped })
    // First step: both leave their origin together (the first has 3 frames, the second 2)
    act(() => void vi.advanceTimersByTime(MOVE_REPLAY_STEP_MS))
    expect(result.current.get('army')).toMatchObject({ ...centre(1, 6), glide: true })
    expect(result.current.get('army2')).toMatchObject({ ...centre(1, 1), glide: true })
    // The shorter walk is done while the longer one goes on
    act(() => void vi.advanceTimersByTime(MOVE_REPLAY_STEP_MS))
    expect(result.current.has('army2')).toBe(false)
    expect(result.current.get('army')).toMatchObject({ ...centre(1, 7), glide: true })
    act(() => void vi.advanceTimersByTime(MOVE_REPLAY_STEP_MS))
    expect(result.current.size).toBe(0)
  })

  it('keeps the figures of one group apart on every step of a shared route', () => {
    const from = centre(1, 5)
    const slotA = { x: centre(1, 7).x - 10, y: centre(1, 7).y }
    const slotB = { x: centre(1, 7).x + 10, y: centre(1, 7).y }
    const route = [{ column: 1, row: 6 }, { column: 1, row: 7 }]
    const before: Board = { ...base, pieces: [figure(from.x - 10, from.y), { ...figure(from.x + 10, from.y), id: 'army2' }], history: [] }
    const move = (id: string, pieceId: string, to: { x: number; y: number }, start: { x: number; y: number }) =>
      ({ ...entry(id, { kind: 'move', pieceId, from: start, to, fromIndex: 0, route }), group: 'g1' })
    const after: Board = {
      ...before,
      pieces: [figure(slotA.x, slotA.y), { ...figure(slotB.x, slotB.y), id: 'army2' }],
      history: [move('m1', 'army', slotA, { x: from.x - 10, y: from.y }), move('m2', 'army2', slotB, { x: from.x + 10, y: from.y })],
    }
    const [first, second] = moveReplaysBetween(before, after)
    // The middle frame (the first square entered) differs between the two, by the same 20 px as at the destination
    expect(first?.[1]?.x).toBeDefined()
    expect((second?.[1]?.x ?? 0) - (first?.[1]?.x ?? 0)).toBe(20)
  })

  it('never cuts a group in half when more moves arrive than are played', () => {
    const from = centre(1, 0)
    const to = centre(1, 1)
    const route = [{ column: 1, row: 1 }]
    const mv = (id: string, group?: string) =>
      ({ ...entry(id, { kind: 'move', pieceId: 'army', from, to, fromIndex: 0, route }), ...(group === undefined ? {} : { group }) })
    const before: Board = { ...base, pieces: [figure(from.x, from.y)], history: [] }
    const after: Board = { ...before, pieces: [figure(to.x, to.y)], history: [mv('a', 'g'), mv('b', 'g'), mv('c'), mv('d'), mv('e')] }
    // maxMoves 4 would drop only 'a' and keep half of the group; the whole group is played instead
    expect(moveReplaysBetween(before, after, 4)).toHaveLength(5)
    // Without a group the cutoff stays where it is
    const plain: Board = { ...before, pieces: after.pieces, history: after.history.map(({ group: _group, ...item }) => item) as Board['history'] }
    expect(moveReplaysBetween(before, plain, 4)).toHaveLength(4)
  })

  it('lets a move after a group wait for the longest walk of the group', () => {
    const { before, after } = withSecondArmy()
    const again = entry('h3', { kind: 'move', pieceId: 'army2', from: centre(1, 1), to: centre(1, 2), fromIndex: 1, route: [{ column: 1, row: 2 }] })
    const grouped: Board = {
      ...after,
      pieces: after.pieces.map((p) => (p.id === 'army2' ? { ...p, ...centre(1, 2) } : p)),
      history: [...after.history.map((item) => (item.change.kind === 'move' ? { ...item, group: 'h1' } : item)), again],
    }
    const { result, rerender } = renderHook(({ board }) => useMoveReplay(board, 'g1'), { initialProps: { board: before } })
    rerender({ board: grouped })
    // The group's longest walk has 3 frames: army2's second move starts only after them
    act(() => void vi.advanceTimersByTime(2 * MOVE_REPLAY_STEP_MS))
    expect(result.current.get('army2')).toMatchObject({ ...centre(1, 1) })
    act(() => void vi.advanceTimersByTime(MOVE_REPLAY_STEP_MS))
    expect(result.current.get('army2')).toMatchObject({ ...centre(1, 1), glide: false })
    act(() => void vi.advanceTimersByTime(MOVE_REPLAY_STEP_MS))
    expect(result.current.get('army2')).toMatchObject({ ...centre(1, 2), glide: true })
  })

  it('keeps a figure that moves twice in one batch off its final square between the moves', () => {
    const { before, after } = withSecondArmy()
    // army moves B6 -> B8 (already in `after`), then army2 B1 -> B2, then army again B8 -> B9
    const again = entry('h3', {
      kind: 'move',
      pieceId: 'army',
      from: centre(1, 7),
      to: centre(1, 8),
      fromIndex: 0,
      route: [{ column: 1, row: 8 }],
    })
    const final: Board = {
      ...after,
      pieces: after.pieces.map((p) => (p.id === 'army' ? { ...p, ...centre(1, 8) } : p)),
      history: [...after.history, again],
    }
    const { result, rerender } = renderHook(({ board }) => useMoveReplay(board, 'g1'), { initialProps: { board: before } })
    rerender({ board: final })
    // Move 1 (3 frames), move 2 (2 frames), move 3 (2 frames): at the end of move 1 the figure rests on B8, not on B9
    act(() => void vi.advanceTimersByTime(3 * MOVE_REPLAY_STEP_MS))
    expect(result.current.get('army')).toMatchObject({ ...centre(1, 7) })
    act(() => void vi.advanceTimersByTime(2 * MOVE_REPLAY_STEP_MS))
    expect(result.current.get('army')).toMatchObject({ ...centre(1, 7), glide: false })
    act(() => void vi.advanceTimersByTime(MOVE_REPLAY_STEP_MS))
    expect(result.current.get('army')).toMatchObject({ ...centre(1, 8), glide: true })
    act(() => void vi.advanceTimersByTime(MOVE_REPLAY_STEP_MS))
    expect(result.current.size).toBe(0)
  })

  it('keeps playing when a reload brings a new board object with the same history', () => {
    const { before, after } = afterMove(true)
    const { result, rerender } = renderHook(({ board }) => useMoveReplay(board, 'g1'), { initialProps: { board: before } })
    rerender({ board: after })
    act(() => void vi.advanceTimersByTime(MOVE_REPLAY_STEP_MS))
    rerender({ board: { ...after } })
    expect(result.current.get('army')).toMatchObject({ ...centre(1, 6), glide: true })
    act(() => void vi.advanceTimersByTime(MOVE_REPLAY_STEP_MS))
    expect(result.current.get('army')).toMatchObject({ ...centre(1, 7) })
  })

  it('does not animate the first board, a move without a route or another game', () => {
    const plain = afterMove(false)
    const first = renderHook(({ board }) => useMoveReplay(board, 'g1'), { initialProps: { board: plain.before } })
    first.rerender({ board: plain.after })
    expect(first.result.current.size).toBe(0)

    const routed = afterMove(true)
    const other = renderHook(({ board, id }) => useMoveReplay(board, id), { initialProps: { board: routed.before, id: 'g1' } })
    other.rerender({ board: routed.after, id: 'g2' })
    expect(other.result.current.size).toBe(0)
  })

  it('does not animate an undo', () => {
    const { before, after } = afterMove(true)
    const { result, rerender } = renderHook(({ board }) => useMoveReplay(board, 'g1'), { initialProps: { board: after } })
    rerender({ board: before })
    expect(result.current.size).toBe(0)
  })
})
