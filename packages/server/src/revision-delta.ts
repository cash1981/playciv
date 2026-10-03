/**
 * Delta codec for game revisions (issue #238).
 *
 * A revision used to be a full `GameState`. Most of that state is the same from
 * one action to the next (two append-only lists, the deck, the other players'
 * hands), so a revision is now either a keyframe (the full state) or a delta
 * against the revision before it. This module only turns two JSON values into
 * a delta and back; it knows nothing about storage and has no dependencies, so
 * it runs on Workers and on Node alike.
 *
 * Pure and deterministic: the same two values always give the same delta, and
 * `applyDelta(prev, diffValues(prev, next))` is `next` again, key order
 * included. Neither function mutates its input. The result of `applyDelta`
 * shares every untouched subtree with `prev`, so callers must not mutate it
 * either.
 *
 * Why not RFC 6902 (`fast-json-patch`): it addresses arrays by index, so taking
 * one card out of a 229 item deck would rewrite every card after it. The array
 * encodings below follow the shape of the data instead: append-only lists store
 * the tail, lists of keyed records (`id`, `playerId`, `itemNumber`) store what
 * was removed, changed and added, and the rest falls back to a positional or a
 * whole-array replacement.
 *
 * The delta is plain JSON made of tagged arrays, never of objects, so no key of
 * the game state can be mistaken for a field of the delta.
 */

/** Keyframe cadence: a chain is one keyframe followed by at most K - 1 deltas. */
export const REVISION_KEYFRAME_INTERVAL = 25

/** A delta is written only while it is at most this share of the full state. */
export const MAX_DELTA_SHARE = 0.5

const REPLACE = 0
const OBJECT = 1
const APPEND = 2
const KEYED = 3
const ELEMENTS = 4

type KeyValue = string | number
type Patches = { readonly [key: string]: DeltaNode }

/** `[0, value]` replaces the value (also how a key is set for the first time). */
type ReplaceNode = readonly [typeof REPLACE, unknown]
/**
 * `[1, sets, deletes, order?]`: `sets` maps a key to the delta of its value,
 * `deletes` lists removed keys, and `order` (only when it differs from "old keys
 * in their order, then new keys in the order of `sets`") is the final key order.
 */
type ObjectNode =
  | readonly [typeof OBJECT, Patches]
  | readonly [typeof OBJECT, Patches, readonly string[]]
  | readonly [typeof OBJECT, Patches, readonly string[], readonly string[]]
/** `[2, tail]`: the old array is a prefix of the new one. */
type AppendNode = readonly [typeof APPEND, readonly unknown[]]
/**
 * `[3, field, removed, changed, added, order?]`: records matched by `field`.
 * `removed` lists keys, `changed` maps a key to the delta of its record. Without
 * `order`, `added` is `[index, record]` pairs by final index, applied in
 * ascending order. With `order` (the final key list), `added` is the records.
 */
type KeyedNode =
  | readonly [typeof KEYED, string, readonly KeyValue[], Patches, readonly (readonly [number, unknown])[]]
  | readonly [typeof KEYED, string, readonly KeyValue[], Patches, readonly unknown[], readonly KeyValue[]]
/** `[4, changes]`: same length, `changes` maps an index to the delta of that element. */
type ElementsNode = readonly [typeof ELEMENTS, Patches]

export type DeltaNode = ReplaceNode | ObjectNode | AppendNode | KeyedNode | ElementsNode

/** A delta of a whole value. It is JSON: `JSON.stringify` it to store it. */
export type Delta = DeltaNode

export type ApplyResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string }

/** Which fields identify the records of a list, in the order they are tried. */
const KEY_FIELDS = ['id', 'playerId', 'itemNumber'] as const

const FAIL = Symbol('delta does not fit the value')
type Failed = typeof FAIL

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(target: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key)
}

/**
 * Assigns an own property. `target[key] = value` would set the prototype for the
 * key `__proto__`, which `JSON.parse` can produce as a plain key.
 */
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === '__proto__') {
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    })
  } else {
    target[key] = value
  }
}

/** The keys JSON would write: an `undefined` value is the same as an absent key. */
function jsonKeys(value: Record<string, unknown>): string[] {
  const keys: string[] = []
  for (const key of Object.keys(value)) {
    if (value[key] !== undefined) keys.push(key)
  }
  return keys
}

/**
 * Deep equality as `JSON.stringify` sees it. `ordered` also compares the order of
 * the keys; the diff itself does not need that (it records order separately),
 * the verification of a delta does.
 */
export function sameJson(left: unknown, right: unknown, ordered = false): boolean {
  if (left === right) return true
  if (Array.isArray(left)) {
    if (!Array.isArray(right) || left.length !== right.length) return false
    for (let index = 0; index < left.length; index++) {
      if (!sameJson(left[index], right[index], ordered)) return false
    }
    return true
  }
  if (isObject(left)) {
    if (!isObject(right)) return false
    const leftKeys = jsonKeys(left)
    const rightKeys = jsonKeys(right)
    if (leftKeys.length !== rightKeys.length) return false
    for (let index = 0; index < leftKeys.length; index++) {
      const key = leftKeys[index] as string
      if (ordered) {
        if (key !== rightKeys[index]) return false
      } else if (!hasOwn(right, key) || right[key] === undefined) {
        return false
      }
      if (!sameJson(left[key], right[key], ordered)) return false
    }
    return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/** The delta that turns `prev` into `next`; `undefined` when they are equal. */
function diffNode(prev: unknown, next: unknown): DeltaNode | undefined {
  // Identity is the fast path that matters: the engine builds a new state by
  // spreading the old one, so every untouched subtree is the same object.
  if (prev === next) return undefined
  if (Array.isArray(prev) && Array.isArray(next)) return diffArray(prev, next)
  if (isObject(prev) && isObject(next)) return diffObject(prev, next)
  return [REPLACE, next]
}

function diffObject(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): DeltaNode | undefined {
  const sets: Record<string, DeltaNode> = {}
  let touched = false
  const nextKeys = jsonKeys(next)
  const added: string[] = []
  for (const key of nextKeys) {
    const nextValue = next[key]
    if (!hasOwn(prev, key) || prev[key] === undefined) {
      setOwn(sets, key, [REPLACE, nextValue])
      added.push(key)
      touched = true
      continue
    }
    const child = diffNode(prev[key], nextValue)
    if (child !== undefined) {
      setOwn(sets, key, child)
      touched = true
    }
  }

  const deletes: string[] = []
  const survivors: string[] = []
  for (const key of jsonKeys(prev)) {
    if (hasOwn(next, key) && next[key] !== undefined) survivors.push(key)
    else deletes.push(key)
  }

  // `apply` writes the surviving keys in their old order, then the new keys in
  // the order of `sets`. Anything else needs the final order spelled out.
  const expected = survivors.concat(added)
  let sameOrder = expected.length === nextKeys.length
  for (let index = 0; sameOrder && index < expected.length; index++) {
    if (expected[index] !== nextKeys[index]) sameOrder = false
  }

  if (!touched && deletes.length === 0 && sameOrder) return undefined
  if (!sameOrder) return [OBJECT, sets, deletes, nextKeys]
  return deletes.length === 0 ? [OBJECT, sets] : [OBJECT, sets, deletes]
}

function diffArray(prev: readonly unknown[], next: readonly unknown[]): DeltaNode | undefined {
  // Append-only lists (`log`, `board.history`): store the tail, nothing else.
  if (next.length >= prev.length) {
    let prefix = true
    for (let index = 0; prefix && index < prev.length; index++) {
      if (prev[index] !== next[index] && !sameJson(prev[index], next[index])) prefix = false
    }
    if (prefix) {
      return next.length === prev.length ? undefined : [APPEND, next.slice(prev.length)]
    }
  }

  const field = keyFieldOf(prev, next)
  if (field !== undefined) return diffKeyed(prev, next, field)

  if (prev.length === next.length) {
    const changes: Record<string, DeltaNode> = {}
    let changed = false
    for (let index = 0; index < next.length; index++) {
      const child = diffNode(prev[index], next[index])
      if (child !== undefined) {
        setOwn(changes, String(index), child)
        changed = true
      }
    }
    return changed ? [ELEMENTS, changes] : undefined
  }

  return [REPLACE, next]
}

/**
 * The first of `KEY_FIELDS` that identifies every record of both lists: each
 * element is an object with that field as a string or number, all of one type,
 * and no value occurs twice in a list. `undefined` when there is none.
 */
function keyFieldOf(prev: readonly unknown[], next: readonly unknown[]): string | undefined {
  if (prev.length === 0 || next.length === 0) return undefined
  for (const field of KEY_FIELDS) {
    const type = keyType(prev[0], field)
    if (type === undefined) continue
    if (uniqueKeys(prev, field, type) && uniqueKeys(next, field, type)) return field
  }
  return undefined
}

function keyType(element: unknown, field: string): 'string' | 'number' | undefined {
  if (!isObject(element) || !hasOwn(element, field)) return undefined
  const value = element[field]
  return typeof value === 'string' ? 'string' : typeof value === 'number' ? 'number' : undefined
}

function uniqueKeys(list: readonly unknown[], field: string, type: 'string' | 'number'): boolean {
  const seen = new Set<unknown>()
  for (const element of list) {
    if (keyType(element, field) !== type) return false
    const value = (element as Record<string, unknown>)[field]
    if (seen.has(value)) return false
    seen.add(value)
  }
  return true
}

function diffKeyed(
  prev: readonly unknown[],
  next: readonly unknown[],
  field: string,
): DeltaNode | undefined {
  const keyOf = (element: unknown): KeyValue => (element as Record<string, KeyValue>)[field] as KeyValue
  const prevByKey = new Map<KeyValue, unknown>()
  for (const element of prev) prevByKey.set(keyOf(element), element)
  const nextKeys = new Set<KeyValue>()
  for (const element of next) nextKeys.add(keyOf(element))

  const removed: KeyValue[] = []
  for (const element of prev) {
    if (!nextKeys.has(keyOf(element))) removed.push(keyOf(element))
  }

  const changed: Record<string, DeltaNode> = {}
  let touched = false
  const added: [number, unknown][] = []
  for (let index = 0; index < next.length; index++) {
    const element = next[index]
    const key = keyOf(element)
    if (!prevByKey.has(key)) {
      added.push([index, element])
      continue
    }
    const child = diffNode(prevByKey.get(key), element)
    if (child !== undefined) {
      setOwn(changed, String(key), child)
      touched = true
    }
  }

  // Whether the records that stay keep their relative order.
  const survivorKeys: KeyValue[] = []
  for (const element of prev) {
    if (nextKeys.has(keyOf(element))) survivorKeys.push(keyOf(element))
  }
  const keptKeys: KeyValue[] = []
  for (const element of next) {
    if (prevByKey.has(keyOf(element))) keptKeys.push(keyOf(element))
  }
  let sameOrder = survivorKeys.length === keptKeys.length
  for (let index = 0; sameOrder && index < survivorKeys.length; index++) {
    if (survivorKeys[index] !== keptKeys[index]) sameOrder = false
  }

  if (!touched && removed.length === 0 && added.length === 0 && sameOrder) return undefined
  if (sameOrder) return [KEYED, field, removed, changed, added]
  return [KEYED, field, removed, changed, added.map(([, element]) => element), next.map(keyOf)]
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

function applyNode(prev: unknown, node: unknown): unknown {
  if (!Array.isArray(node)) return FAIL
  switch (node[0]) {
    case REPLACE:
      return node.length === 2 ? node[1] : FAIL
    case OBJECT:
      return applyObject(prev, node)
    case APPEND:
      return applyAppend(prev, node)
    case KEYED:
      return applyKeyed(prev, node)
    case ELEMENTS:
      return applyElements(prev, node)
    default:
      return FAIL
  }
}

function applyObject(prev: unknown, node: readonly unknown[]): unknown {
  const sets = node[1]
  const deletes = node[2] ?? []
  const order = node[3]
  if (!isObject(prev) || !isObject(sets) || !Array.isArray(deletes)) return FAIL
  const deleted = new Set<unknown>(deletes)

  const result: Record<string, unknown> = {}
  for (const key of jsonKeys(prev)) {
    if (deleted.has(key)) continue
    if (hasOwn(sets, key)) {
      const value = applyNode(prev[key], sets[key])
      if (value === FAIL) return FAIL
      setOwn(result, key, value)
    } else {
      setOwn(result, key, prev[key])
    }
  }
  for (const key of Object.keys(sets)) {
    if (hasOwn(prev, key) && prev[key] !== undefined && !deleted.has(key)) continue
    const value = applyNode(undefined, sets[key])
    if (value === FAIL) return FAIL
    setOwn(result, key, value)
  }

  if (order === undefined) return result
  if (!Array.isArray(order) || order.length !== Object.keys(result).length) return FAIL
  const ordered: Record<string, unknown> = {}
  for (const key of order) {
    if (typeof key !== 'string' || !hasOwn(result, key)) return FAIL
    setOwn(ordered, key, result[key])
  }
  return ordered
}

function applyAppend(prev: unknown, node: readonly unknown[]): unknown {
  const tail = node[1]
  if (!Array.isArray(prev) || !Array.isArray(tail)) return FAIL
  return prev.concat(tail)
}

function applyElements(prev: unknown, node: readonly unknown[]): unknown {
  const changes = node[1]
  if (!Array.isArray(prev) || !isObject(changes)) return FAIL
  const result = prev.slice()
  for (const key of Object.keys(changes)) {
    const index = Number(key)
    if (!Number.isInteger(index) || index < 0 || index >= result.length) return FAIL
    const value = applyNode(result[index], changes[key])
    if (value === FAIL) return FAIL
    result[index] = value
  }
  return result
}

function applyKeyed(prev: unknown, node: readonly unknown[]): unknown {
  const [, field, removed, changed, added, order] = node
  if (
    !Array.isArray(prev) ||
    typeof field !== 'string' ||
    !Array.isArray(removed) ||
    !isObject(changed) ||
    !Array.isArray(added)
  ) {
    return FAIL
  }
  const keyOf = (element: unknown): string | Failed => {
    if (!isObject(element)) return FAIL
    const key = element[field]
    return typeof key === 'string' || typeof key === 'number' ? String(key) : FAIL
  }
  const removedKeys = new Set<string>(removed.map(String))

  const kept: unknown[] = []
  for (const element of prev) {
    const key = keyOf(element)
    if (key === FAIL) return FAIL
    if (removedKeys.has(key)) continue
    if (hasOwn(changed, key)) {
      const value = applyNode(element, changed[key])
      if (value === FAIL) return FAIL
      kept.push(value)
    } else {
      kept.push(element)
    }
  }

  if (order === undefined) {
    const result = kept.slice()
    for (const entry of added) {
      if (!Array.isArray(entry) || entry.length !== 2) return FAIL
      const index: unknown = entry[0]
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > result.length) {
        return FAIL
      }
      result.splice(index, 0, entry[1])
    }
    return result
  }

  if (!Array.isArray(order)) return FAIL
  const byKey = new Map<string, unknown>()
  for (const element of kept.concat(added)) {
    const key = keyOf(element)
    if (key === FAIL) return FAIL
    byKey.set(key, element)
  }
  if (order.length !== byKey.size) return FAIL
  const result: unknown[] = []
  for (const key of order) {
    const element = byKey.get(String(key))
    if (element === undefined) return FAIL
    result.push(element)
  }
  return result
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** The delta that turns `prev` into `next`. An empty delta when they are equal. */
export function diffValues(prev: unknown, next: unknown): Delta {
  const node = diffNode(prev, next)
  if (node !== undefined) return node
  if (Array.isArray(prev)) return [ELEMENTS, {}]
  if (isObject(prev)) return [OBJECT, {}]
  return [REPLACE, next]
}

/** `prev` with `delta` applied, or the reason the delta does not fit it. */
export function applyDelta(prev: unknown, delta: unknown): ApplyResult<unknown> {
  const value = applyNode(prev, delta)
  return value === FAIL
    ? { ok: false, reason: 'The delta does not fit the revision it was applied to' }
    : { ok: true, value }
}

/**
 * How the stores diff and apply. A seam so a test can hand a store a broken
 * codec and watch the write fall back to a keyframe.
 */
export interface RevisionCodec {
  diff(prev: unknown, next: unknown): Delta
  apply(prev: unknown, delta: unknown): ApplyResult<unknown>
}

export const defaultRevisionCodec: RevisionCodec = {
  diff: diffValues,
  apply: applyDelta,
}
