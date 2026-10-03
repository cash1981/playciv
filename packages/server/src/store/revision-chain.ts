/**
 * What both repositories share about delta revisions (issue #238): when a new
 * revision is a keyframe and when a delta, and how a revision is rebuilt from
 * its chain. The stores only differ in where the rows live.
 *
 * A chain is one keyframe (`kind = 'full'`) followed by deltas, each against the
 * row before it. Rows from before delta storage are keyframes whose
 * `base_revision` is `NULL`; a keyframe's base is its own number.
 */

import type { GameState } from '@civ/engine'
import { migrateGameState } from '@civ/engine'

import type { RevisionCodec } from '../revision-delta.js'
import { MAX_DELTA_SHARE, REVISION_KEYFRAME_INTERVAL, sameJson } from '../revision-delta.js'

export type RevisionKind = 'full' | 'delta'

/** What a write needs to know about the newest stored revision. Never a state. */
export interface RevisionTail {
  readonly revision: number
  /** The keyframe the newest row's chain starts from (its own number for a keyframe). */
  readonly baseRevision: number
  /** The live game moved on after this revision without recording it. */
  readonly sealed: boolean
  /** Rows from that keyframe up to and including the newest one. */
  readonly chainRows: number
}

/** How a new revision is stored. `json` is the serialised delta. */
export type RevisionEncoding =
  | { readonly kind: 'full'; readonly baseRevision: number }
  | { readonly kind: 'delta'; readonly baseRevision: number; readonly json: string }

export interface EncodeInput {
  /** The new revision's number and state. */
  readonly revision: number
  readonly state: GameState
  /** The state of the newest stored revision, when the caller has it. */
  readonly previous: GameState | undefined
  /** The newest stored row. `undefined` for the first revision of a game. */
  readonly tail: RevisionTail | undefined
  readonly codec: RevisionCodec
  /** Size in bytes of a full state, to compare the delta with. */
  readonly fullBytes: () => number | undefined
}

/** A chain longer than K rows starts over with a keyframe. */
export function chainIsFull(chainRows: number): boolean {
  return chainRows >= REVISION_KEYFRAME_INTERVAL
}

/**
 * Chooses between a keyframe and a delta for a new revision. A keyframe whenever
 * there is any doubt, so a codec bug costs space and never correctness:
 *
 * - there is no previous state or no earlier revision to be a delta against;
 * - the live game changed after the newest revision without recording it;
 * - the chain already has K rows;
 * - the delta, applied to the previous state, does not give the new state back
 *   (key order included), or is more than half the size of a full state.
 *
 * The delta is checked after a trip through JSON, which is what storage does to
 * it.
 */
export function encodeRevision(input: EncodeInput): RevisionEncoding {
  const keyframe: RevisionEncoding = { kind: 'full', baseRevision: input.revision }
  const { tail, previous } = input
  if (previous === undefined || tail === undefined) return keyframe
  if (tail.sealed || tail.revision >= input.revision || chainIsFull(tail.chainRows)) return keyframe

  const json = JSON.stringify(input.codec.diff(previous, input.state))
  const applied = input.codec.apply(previous, JSON.parse(json) as unknown)
  if (!applied.ok || !sameJson(applied.value, input.state, true)) return keyframe

  const full = input.fullBytes()
  if (full !== undefined && utf8Length(json) > full * MAX_DELTA_SHARE) return keyframe
  return { kind: 'delta', baseRevision: tail.baseRevision, json }
}

/** The size JSON text takes in storage. */
export function utf8Length(text: string): number {
  let bytes = 0
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4
      index += 1
    } else bytes += 3
  }
  return bytes
}

/** One stored row of a chain, its payload already parsed from JSON. */
export interface ChainRow {
  readonly revision: number
  readonly kind: RevisionKind
  /** `null` for a row from before delta storage. */
  readonly baseRevision: number | null
  /** The state of a keyframe as stored, or the delta of a delta row. */
  readonly payload: unknown
}

export type RebuildResult =
  | { readonly ok: true; readonly state: GameState }
  | { readonly ok: false; readonly reason: string }

/**
 * Rebuilds the state of the last row of `rows`, which must be one keyframe
 * followed by the deltas up to the revision wanted, oldest first. Anything that
 * does not hang together (a delta without its keyframe, a delta that does not
 * fit) is an error, never a wrong state.
 *
 * The keyframe goes through `prepare` first (the stores pass `migrateGameState`
 * for rows read from storage): a delta was computed against a migrated state, so
 * it has to be applied to one.
 */
export function rebuildState(
  rows: readonly ChainRow[],
  codec: RevisionCodec,
  prepare: (stored: GameState) => GameState = migrateGameState,
): RebuildResult {
  const first = rows[0]
  if (first === undefined) return { ok: false, reason: 'No revision to rebuild' }
  if (first.kind !== 'full') {
    return { ok: false, reason: `Revision ${first.revision} is a delta without its keyframe` }
  }
  let state = prepare(first.payload as GameState)
  for (const row of rows.slice(1)) {
    if (row.kind !== 'delta' || row.baseRevision !== first.revision) {
      return { ok: false, reason: `Revision ${row.revision} does not belong to the chain of ${first.revision}` }
    }
    const applied = codec.apply(state, row.payload)
    if (!applied.ok) return { ok: false, reason: `Revision ${row.revision}: ${applied.reason}` }
    state = applied.value as GameState
  }
  return { ok: true, state }
}

/** The keyframe a row's chain starts from: its stored base, or itself for an old row. */
export function chainBase(row: { readonly revision: number; readonly baseRevision: number | null }): number {
  return row.baseRevision ?? row.revision
}

/**
 * What a cleanup frees: the bytes of every row but the newest, less what writing
 * the newest back as a keyframe adds (`growth`, positive only when the newest is
 * a delta). Never negative.
 */
export function netRemovableBytes(removableBytes: number, growth: number): number {
  return Math.max(0, removableBytes - Math.max(0, growth))
}

// ---------------------------------------------------------------------------
// Compaction: turning rows from before delta storage into chains
// ---------------------------------------------------------------------------

/** What the dry run assumes a delta weighs (the issue measured an average of 2.5 KB on a real game). */
export const ESTIMATED_DELTA_BYTES = 3000

/** One row as the compaction plans with it: metadata and size, never the state. */
export interface CompactionRow {
  readonly revision: number
  readonly kind: RevisionKind
  readonly baseRevision: number | null
  /** The size of the stored `state` text in bytes. */
  readonly bytes: number
}

/** A row from before delta storage that has not been looked at yet. */
function isLegacy(row: CompactionRow): boolean {
  return row.kind === 'full' && row.baseRevision === null
}

export interface CompactionPlan {
  /** The legacy revisions to handle now, oldest first; at most the cap. */
  readonly todo: readonly number[]
  /** The row before the first of `todo`, whose state the first delta is against. */
  readonly previous: number | undefined
  /** The keyframe `previous`'s chain starts from. */
  readonly chainBase: number | undefined
  /** Rows from that keyframe up to and including `previous`. */
  readonly chainRows: number
  /** Legacy rows a delta row already hangs on: they must stay keyframes. */
  readonly keep: ReadonlySet<number>
  /** The state text to be parsed for `todo`, the state before the first row included. */
  readonly bytes: number
  /** Legacy rows left for a later request. */
  readonly remaining: number
}

/**
 * Plans one chunk of a game's compaction from its rows (oldest first). The
 * newest row is never touched: a game that is being played writes its next
 * revision against it, so converting it would pull the keyframe out from under
 * that write. Rows a delta already hangs on stay as they are for the same reason.
 */
export function planCompaction(
  rows: readonly CompactionRow[],
  max: number,
  maxBytes = Number.POSITIVE_INFINITY,
): CompactionPlan {
  const newest = rows.at(-1)?.revision
  const keep = new Set<number>()
  for (const row of rows) {
    if (row.kind === 'delta' && row.baseRevision !== null) keep.add(row.baseRevision)
  }
  const legacy = rows.filter((row) => isLegacy(row) && row.revision !== newest)
  // The work is parsing and comparing states, so it grows with their size: take
  // rows until `maxBytes` of state text is reached, but always at least one, or a
  // game of very large states could never be compacted. The state before the
  // first row has to be rebuilt from its own chain (a keyframe and its deltas, in
  // all about one state of text) and counts as one more of the first row's size.
  const todo: number[] = []
  let bytes = 0
  for (const row of legacy) {
    if (todo.length >= Math.max(0, max)) break
    const hasPrevious = todo.length === 0 && rows[0]?.revision !== row.revision
    const next = bytes + row.bytes + (hasPrevious ? row.bytes : 0)
    if (todo.length > 0 && next > maxBytes) break
    bytes = next
    todo.push(row.revision)
  }

  let previous: number | undefined
  let chainBase: number | undefined
  let chainRows = 0
  const first = todo[0]
  if (first !== undefined) {
    for (const row of rows) {
      if (row.revision >= first) break
      previous = row.revision
      if (row.kind === 'delta') {
        chainRows += 1
      } else {
        chainBase = row.revision
        chainRows = 1
      }
    }
  }
  return { todo, previous, chainBase, chainRows, keep, bytes, remaining: legacy.length - todo.length }
}

/** What a chunk did to one row. A delta says how many bytes it saved. */
export type CompactionStep =
  | { readonly revision: number; readonly kind: 'full' }
  | { readonly revision: number; readonly kind: 'delta'; readonly baseRevision: number; readonly json: string; readonly savedBytes: number }

export type CompactionOutcome =
  | { readonly ok: true; readonly steps: readonly CompactionStep[] }
  | { readonly ok: false; readonly revision: number }

/**
 * Decides and checks a chunk. Each row to convert is diffed against the one
 * before it, and the delta is applied to the chain's own rebuilt state (not to
 * the original) and compared with the original, key order included. The first
 * mismatch aborts the whole chunk: nothing has been written yet, so the game is
 * left as it was.
 *
 * `states` are the legacy rows in `plan.todo` order, already migrated, with the
 * size of their stored text; `previousState` is the state of `plan.previous`.
 */
export function compactChunk(input: {
  readonly plan: CompactionPlan
  readonly previousState: GameState | undefined
  readonly states: readonly { readonly revision: number; readonly state: GameState; readonly bytes: number }[]
  readonly codec: RevisionCodec
}): CompactionOutcome {
  const steps: CompactionStep[] = []
  let chainBase = input.plan.chainBase
  let chainRows = input.plan.chainRows
  // The state the chain rebuilds for the row before, and the original it must equal.
  let rebuilt = input.previousState
  let original = input.previousState

  for (const row of input.states) {
    if (
      rebuilt === undefined ||
      original === undefined ||
      chainBase === undefined ||
      input.plan.keep.has(row.revision) ||
      chainIsFull(chainRows)
    ) {
      steps.push({ revision: row.revision, kind: 'full' })
      chainBase = row.revision
      chainRows = 1
      rebuilt = row.state
      original = row.state
      continue
    }

    const json = JSON.stringify(input.codec.diff(original, row.state))
    const applied = input.codec.apply(rebuilt, JSON.parse(json) as unknown)
    if (!applied.ok || !sameJson(applied.value, row.state, true)) return { ok: false, revision: row.revision }
    const deltaBytes = utf8Length(json)
    if (deltaBytes > row.bytes * MAX_DELTA_SHARE) {
      // Correct but not worth it (a reshuffle, say): this row starts a new chain.
      steps.push({ revision: row.revision, kind: 'full' })
      chainBase = row.revision
      chainRows = 1
      rebuilt = row.state
      original = row.state
      continue
    }
    steps.push({
      revision: row.revision,
      kind: 'delta',
      baseRevision: chainBase,
      json,
      savedBytes: row.bytes - deltaBytes,
    })
    chainRows += 1
    rebuilt = applied.value as GameState
    original = row.state
  }
  return { ok: true, steps }
}

/**
 * What the dry run says about a game, from its rows alone: how many legacy rows a
 * compaction would look at, and roughly what it frees, assuming every row that is
 * not a keyframe becomes a delta of `ESTIMATED_DELTA_BYTES`.
 */
export function summarizeCompaction(rows: readonly CompactionRow[]): {
  readonly fullRevisions: number
  readonly freeableBytes: number
} {
  const plan = planCompaction(rows, Number.POSITIVE_INFINITY)
  const bytes = new Map(rows.map((row) => [row.revision, row.bytes]))
  let chainRows = plan.chainRows
  let chained = plan.chainBase !== undefined
  let freeable = 0
  for (const revision of plan.todo) {
    if (!chained || plan.keep.has(revision) || chainIsFull(chainRows)) {
      chained = true
      chainRows = 1
      continue
    }
    chainRows += 1
    freeable += Math.max(0, (bytes.get(revision) ?? 0) - ESTIMATED_DELTA_BYTES)
  }
  return { fullRevisions: plan.todo.length, freeableBytes: freeable }
}

/**
 * The first delta whose chain is broken, or `undefined` when every delta hangs on
 * the keyframe right before its run of deltas. A check on metadata only, used
 * after a compaction in which some rows did not change as planned.
 */
export function firstBrokenRevision(rows: readonly CompactionRow[]): number | undefined {
  let keyframe: number | undefined
  for (const row of rows) {
    if (row.kind === 'full') {
      keyframe = row.revision
    } else if (keyframe === undefined || row.baseRevision !== keyframe) {
      return row.revision
    }
  }
  return undefined
}
