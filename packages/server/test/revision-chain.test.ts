/**
 * The decisions the two repositories share about delta revisions (issue #238):
 * planning a compaction chunk, estimating what it frees, spotting a broken chain
 * and choosing between a keyframe and a delta for a new revision. Pure functions
 * on row metadata; the stores' tests cover them against real rows.
 */

import { describe, expect, it } from 'vitest'

import { REVISION_KEYFRAME_INTERVAL } from '../src/revision-delta.js'
import type { CompactionRow } from '../src/store/revision-chain.js'
import {
  ESTIMATED_DELTA_BYTES,
  chainBase,
  encodeRevision,
  firstBrokenRevision,
  netRemovableBytes,
  planCompaction,
  summarizeCompaction,
  utf8Length,
} from '../src/store/revision-chain.js'
import { defaultRevisionCodec } from '../src/revision-delta.js'
import type { GameState } from '@civ/engine'

const K = REVISION_KEYFRAME_INTERVAL
const legacy = (revision: number, bytes = 1000): CompactionRow => ({ revision, kind: 'full', baseRevision: null, bytes })
const keyframe = (revision: number, bytes = 1000): CompactionRow => ({ revision, kind: 'full', baseRevision: revision, bytes })
const delta = (revision: number, base: number, bytes = 10): CompactionRow => ({ revision, kind: 'delta', baseRevision: base, bytes })

describe('planCompaction', () => {
  it('leaves the newest row alone and takes the oldest legacy rows first', () => {
    const rows = [legacy(0), legacy(1), legacy(2), legacy(3)]
    expect(planCompaction(rows, 10)).toMatchObject({ todo: [0, 1, 2], previous: undefined, remaining: 0 })
    expect(planCompaction(rows, 2)).toMatchObject({ todo: [0, 1], remaining: 1 })
  })

  it('a game with a single row has nothing to do', () => {
    expect(planCompaction([legacy(5)], 10).todo).toEqual([])
    expect(planCompaction([], 10).todo).toEqual([])
  })

  it('resumes after the rows already converted and knows their chain', () => {
    const rows = [keyframe(0), delta(1, 0), delta(2, 0), legacy(3), legacy(4), legacy(5)]
    expect(planCompaction(rows, 10)).toMatchObject({ todo: [3, 4], previous: 2, chainBase: 0, chainRows: 3 })
  })

  it('keeps a legacy row a delta hangs on', () => {
    const rows = [legacy(0), legacy(1), delta(2, 1), delta(3, 1)]
    const plan = planCompaction(rows, 10)
    expect(plan.todo).toEqual([0, 1])
    expect([...plan.keep]).toEqual([1])
  })

  it('stops at the byte budget, but always takes one row', () => {
    const rows = [legacy(0, 400), legacy(1, 400), legacy(2, 400), legacy(3, 400), legacy(4, 400)]
    expect(planCompaction(rows, 10, 800).todo).toEqual([0, 1])
    expect(planCompaction(rows, 10, 1).todo).toEqual([0])
    // After a converted row the state before the first row counts once more.
    const resumed = [keyframe(0, 400), delta(1, 0), legacy(2, 400), legacy(3, 400), legacy(4, 400), legacy(5, 400)]
    expect(planCompaction(resumed, 10, 800)).toMatchObject({ todo: [2], bytes: 800 })
    expect(planCompaction(resumed, 10, 1200).todo).toEqual([2, 3])
  })
})

describe('summarizeCompaction', () => {
  it('counts the legacy rows and what turning the non-keyframes into deltas frees', () => {
    const rows = Array.from({ length: 2 * K + 1 }, (_, index) => legacy(index, 100_000))
    const summary = summarizeCompaction(rows)
    expect(summary.fullRevisions).toBe(2 * K)
    // Two rows are keyframes, the rest become deltas.
    expect(summary.freeableBytes).toBe((2 * K - 2) * (100_000 - ESTIMATED_DELTA_BYTES))
  })

  it('is zero for a game that is done', () => {
    expect(summarizeCompaction([keyframe(0), delta(1, 0), legacy(2)])).toEqual({ fullRevisions: 0, freeableBytes: 0 })
  })
})

describe('firstBrokenRevision', () => {
  it('accepts a chain that hangs together', () => {
    expect(firstBrokenRevision([keyframe(0), delta(1, 0), delta(2, 0), keyframe(3), delta(4, 3), legacy(9)])).toBeUndefined()
  })

  it('finds a delta whose keyframe is missing or not the one before it', () => {
    expect(firstBrokenRevision([delta(1, 0), keyframe(2)])).toBe(1)
    expect(firstBrokenRevision([keyframe(0), delta(1, 0), legacy(2), delta(3, 0)])).toBe(3)
  })
})

describe('small helpers', () => {
  it('chainBase reads an old row as its own keyframe', () => {
    expect(chainBase({ revision: 4, baseRevision: null })).toBe(4)
    expect(chainBase({ revision: 4, baseRevision: 2 })).toBe(2)
  })

  it('netRemovableBytes never goes below zero', () => {
    expect(netRemovableBytes(100, 30)).toBe(70)
    expect(netRemovableBytes(100, 300)).toBe(0)
    expect(netRemovableBytes(100, -5)).toBe(100)
  })

  it('utf8Length counts bytes, not characters', () => {
    for (const text of ['abc', 'blåbær', 'Ω≈ç', '😀 emoji', '']) {
      expect(utf8Length(text)).toBe(new TextEncoder().encode(text).length)
    }
  })
})

describe('encodeRevision', () => {
  const state = (n: number) => ({ rev: n, log: [], big: 'x'.repeat(100) }) as unknown as GameState
  const base = {
    codec: defaultRevisionCodec,
    fullBytes: () => 1000 as number | undefined,
  }

  it('is a keyframe without a previous state or an earlier revision', () => {
    expect(encodeRevision({ ...base, revision: 1, state: state(1), previous: undefined, tail: undefined })).toEqual({
      kind: 'full',
      baseRevision: 1,
    })
    expect(
      encodeRevision({ ...base, revision: 1, state: state(1), previous: state(0), tail: undefined }),
    ).toMatchObject({ kind: 'full' })
  })

  it('is a delta against an ordinary chain, hanging on its keyframe', () => {
    const tail = { revision: 0, baseRevision: 0, sealed: false, chainRows: 1 }
    const encoded = encodeRevision({ ...base, revision: 1, state: state(1), previous: state(0), tail })
    expect(encoded).toMatchObject({ kind: 'delta', baseRevision: 0 })
  })

  it('is a keyframe after a seal, and when the chain already has K rows', () => {
    const tail = { revision: 0, baseRevision: 0, sealed: false, chainRows: 1 }
    const input = { ...base, revision: 1, state: state(1), previous: state(0) }
    expect(encodeRevision({ ...input, tail: { ...tail, sealed: true } })).toMatchObject({ kind: 'full' })
    expect(encodeRevision({ ...input, tail: { ...tail, chainRows: K - 1 } })).toMatchObject({ kind: 'delta' })
    expect(encodeRevision({ ...input, tail: { ...tail, chainRows: K } })).toMatchObject({ kind: 'full' })
  })

  it('is a keyframe when the newest stored revision is not older than the new one', () => {
    const tail = { revision: 3, baseRevision: 0, sealed: false, chainRows: 2 }
    expect(encodeRevision({ ...base, revision: 3, state: state(3), previous: state(2), tail })).toMatchObject({ kind: 'full' })
  })

  it('is a keyframe when the delta is more than half a full state, and a delta when it is not', () => {
    const tail = { revision: 0, baseRevision: 0, sealed: false, chainRows: 1 }
    const input = { ...base, revision: 1, state: state(1), previous: state(0), tail }
    // The delta is a few bytes ({"rev":1}); a "full state" of 10 bytes makes that more than half.
    expect(encodeRevision({ ...input, fullBytes: () => 10 })).toMatchObject({ kind: 'full' })
    expect(encodeRevision({ ...input, fullBytes: () => 1000 })).toMatchObject({ kind: 'delta' })
    // An unknown size leaves the verified delta alone.
    expect(encodeRevision({ ...input, fullBytes: () => undefined })).toMatchObject({ kind: 'delta' })
  })
})
