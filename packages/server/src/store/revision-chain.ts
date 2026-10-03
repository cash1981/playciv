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
