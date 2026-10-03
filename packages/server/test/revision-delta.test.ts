/**
 * The delta codec for game revisions (issue #238, phase 1). New in the rewrite,
 * so there is no old-system counterpart. The one property everything rests on:
 * `apply(prev, diff(prev, next))` is `next`, key order included, for any two
 * JSON values. It is checked on random values, on hand picked awkward shapes and
 * on the consecutive states of a game played through the engine.
 */

import { describe, expect, it } from 'vitest'

import {
  applyDelta,
  defaultRevisionCodec,
  diffValues,
  REVISION_KEYFRAME_INTERVAL,
  sameJson,
} from '../src/revision-delta.js'
import { playRecordedGame } from './revision-fixtures.js'

/** What JSON storage does to a value: the delta and the state both go through it. */
function viaJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** Round trips `next` from `prev` through a stored (stringified) delta and demands the exact value back. */
function expectRoundTrip(prev: unknown, next: unknown): unknown {
  const delta = viaJson(diffValues(prev, next))
  const applied = applyDelta(prev, delta)
  if (!applied.ok) throw new Error(applied.reason)
  expect(JSON.stringify(applied.value)).toBe(JSON.stringify(next))
  expect(sameJson(applied.value, next, true)).toBe(true)
  return delta
}

describe('delta codec: shapes', () => {
  it('an append-only list stores only the tail', () => {
    const prev = { log: [{ id: 'a' }, { id: 'b' }], n: 1 }
    const next = { log: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], n: 1 }
    const delta = expectRoundTrip(prev, next)
    expect(JSON.stringify(delta)).not.toContain('"a"')
    expect(JSON.stringify(delta)).toContain('"c"')
  })

  it('taking one record out of the middle of a keyed list does not touch the rest', () => {
    const items = Array.from({ length: 229 }, (_, index) => ({ id: `item-${index}`, itemNumber: index, name: `Card ${index}` }))
    const prev = { items }
    const next = { items: [...items.slice(0, 100), ...items.slice(101)] }
    const delta = expectRoundTrip(prev, next)
    // One key, not 128 rewritten cards.
    expect(JSON.stringify(delta).length).toBeLessThan(100)
  })

  it('a keyed list tells added, removed and changed records apart', () => {
    const prev = { players: [{ playerId: 'a', coins: 1 }, { playerId: 'b', coins: 2 }, { playerId: 'c', coins: 3 }] }
    const next = {
      players: [{ playerId: 'a', coins: 1 }, { playerId: 'd', coins: 9 }, { playerId: 'c', coins: 4 }],
    }
    expectRoundTrip(prev, next)
  })

  it('a reordered keyed list is spelled out as a key order, not rewritten', () => {
    const items = Array.from({ length: 40 }, (_, index) => ({ id: `i${index}`, text: 'x'.repeat(50) }))
    const reordered = [...items].reverse()
    const delta = expectRoundTrip({ items }, { items: reordered })
    expect(JSON.stringify(delta).length).toBeLessThan(JSON.stringify(reordered).length / 4)
  })

  it('a reorder with additions and removals still round trips', () => {
    const prev = { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] }
    const next = { items: [{ id: 'z' }, { id: 'd' }, { id: 'a', extra: true }, { id: 'y' }] }
    expectRoundTrip(prev, next)
  })

  it('a nested change only mentions the path to it', () => {
    const prev = { a: { b: { c: [1, 2, 3], d: 'same' }, e: 'also same' } }
    const next = { a: { b: { c: [1, 2, 4], d: 'same' }, e: 'also same' } }
    const delta = expectRoundTrip(prev, next)
    expect(JSON.stringify(delta)).not.toContain('same')
  })

  it('keys are added and removed', () => {
    expectRoundTrip({ keep: 1, gone: 2 }, { keep: 1, fresh: 3 })
  })

  it('null, false, zero, empty strings, empty arrays and empty objects survive', () => {
    const prev = { a: null, b: 0, c: '', d: [], e: {}, f: false, g: [1], h: { x: 1 } }
    const next = { a: 0, b: null, c: [], d: {}, e: [], f: '', g: [], h: {} }
    expectRoundTrip(prev, next)
    expectRoundTrip(next, prev)
  })

  it('a value that changes type is replaced', () => {
    expectRoundTrip({ v: [1, 2] }, { v: { 0: 1, 1: 2 } })
    expectRoundTrip({ v: { a: 1 } }, { v: 'text' })
    expectRoundTrip({ v: null }, { v: { a: 1 } })
  })

  it('key order survives, also when keys only move', () => {
    const prev = { a: 1, b: 2, c: 3 }
    expectRoundTrip(prev, { c: 3, a: 1, b: 2 })
    expectRoundTrip(prev, { b: 2, a: 1, c: 3 })
    expectRoundTrip(prev, { c: 3, d: 4, a: 1 })
  })

  it('the same values give an empty delta that applies to itself', () => {
    const value = { a: [1, { b: 2 }], c: { d: null } }
    const delta = viaJson(diffValues(value, viaJson(value)))
    const applied = applyDelta(value, delta)
    expect(applied.ok && applied.value).toEqual(value)
    expect(JSON.stringify(delta).length).toBeLessThan(12)
  })

  it('a key whose name is __proto__ is an ordinary key', () => {
    const prev = JSON.parse('{"__proto__": {"x": 1}, "a": 1}') as unknown
    const next = JSON.parse('{"__proto__": {"x": 2}, "a": 1, "b": {"__proto__": 3}}') as unknown
    expectRoundTrip(prev, next)
    // Neither the delta nor the result polluted a prototype.
    expect(({} as Record<string, unknown>)['x']).toBeUndefined()
  })

  it('a key that is undefined counts as absent, as it does in JSON', () => {
    const prev = { a: 1, b: undefined }
    const next = { a: 1, c: undefined, d: 2 }
    const delta = viaJson(diffValues(prev, next))
    const applied = applyDelta(prev, delta)
    expect(applied.ok && JSON.stringify(applied.value)).toBe(JSON.stringify(next))
  })

  it('a duplicate key field falls back to positional diffing instead of corrupting', () => {
    const prev = { list: [{ id: 'a', n: 1 }, { id: 'a', n: 2 }] }
    const next = { list: [{ id: 'a', n: 2 }, { id: 'a', n: 1 }] }
    expectRoundTrip(prev, next)
  })

  it('a different length list without keys is replaced', () => {
    expectRoundTrip({ l: [[1], [2, 3]] }, { l: [[1], [2, 4], [5]] })
    expectRoundTrip({ l: ['a', 'b', 'c'] }, { l: ['a', 'c'] })
  })

  it('a delta that does not fit the value is refused, not applied', () => {
    const delta = viaJson(diffValues({ a: [1, 2] }, { a: [1, 2, 3] }))
    expect(applyDelta({ a: 'not a list' }, delta).ok).toBe(false)
    expect(applyDelta({ a: [1, 2] }, [99, 1]).ok).toBe(false)
    expect(applyDelta({ a: [1, 2] }, 'garbage').ok).toBe(false)
    expect(applyDelta(5, [1, {}]).ok).toBe(false)
  })

  it('does not change what it is given', () => {
    const prev = { a: { b: [1, 2] }, list: [{ id: 'x', v: 1 }] }
    const next = { a: { b: [1, 2, 3] }, list: [{ id: 'x', v: 2 }, { id: 'y', v: 3 }] }
    const prevCopy = viaJson(prev)
    const nextCopy = viaJson(next)
    const delta = viaJson(diffValues(prev, next))
    const deltaCopy = viaJson(delta)
    applyDelta(prev, delta)
    expect(prev).toEqual(prevCopy)
    expect(next).toEqual(nextCopy)
    expect(delta).toEqual(deltaCopy)
  })

  it('is deterministic', () => {
    const prev = { a: [{ id: 1, v: 1 }, { id: 2, v: 2 }], b: { c: 1 } }
    const next = { a: [{ id: 2, v: 3 }, { id: 3, v: 4 }], b: { c: 2, d: 3 } }
    expect(JSON.stringify(diffValues(prev, next))).toBe(JSON.stringify(diffValues(prev, next)))
  })

  it('exposes one keyframe interval', () => {
    expect(REVISION_KEYFRAME_INTERVAL).toBe(25)
    expect(defaultRevisionCodec.diff).toBe(diffValues)
  })
})

// ---------------------------------------------------------------------------
// Random values
// ---------------------------------------------------------------------------

/** A seeded generator, so a failing case can be replayed. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Random = () => number

const pick = <T>(random: Random, values: readonly T[]): T => values[Math.floor(random() * values.length)] as T
const int = (random: Random, below: number): number => Math.floor(random() * below)

const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'log', 'items', 'players', 'hand', 'x', 'y', '1', '2', '10', '__proto__', '']

function scalar(random: Random): unknown {
  return pick(random, [
    null,
    true,
    false,
    0,
    1,
    -3,
    2.5,
    '',
    'text',
    'a longer text with spaces',
    int(random, 100),
    pick(random, WORDS),
  ])
}

function randomValue(random: Random, depth: number): unknown {
  const kind = int(random, depth <= 0 ? 1 : 7)
  if (kind === 0) return scalar(random)
  if (kind <= 2) {
    // A plain object.
    const result: Record<string, unknown> = {}
    const size = int(random, 5)
    for (let index = 0; index < size; index++) {
      Object.defineProperty(result, pick(random, WORDS), {
        value: randomValue(random, depth - 1),
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
    return result
  }
  if (kind <= 4) {
    // A list of scalars or of anything.
    return Array.from({ length: int(random, 6) }, () => randomValue(random, depth - 1))
  }
  // A list of keyed records, the shape of the deck, hands and the log.
  const field = pick(random, ['id', 'playerId', 'itemNumber'] as const)
  const used = new Set<string | number>()
  const records: unknown[] = []
  const size = int(random, 8)
  for (let index = 0; index < size; index++) {
    const key: string | number = field === 'itemNumber' ? int(random, 30) : `${field}-${int(random, 30)}`
    if (used.has(key)) continue
    used.add(key)
    records.push({ [field]: key, value: randomValue(random, depth - 1), flag: random() < 0.5 })
  }
  return records
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** A changed copy of `value`: one to three random edits somewhere inside it. */
function mutate(random: Random, value: unknown, depth = 4): unknown {
  if (Array.isArray(value)) {
    const copy = value.slice()
    const operation = int(random, 7)
    if (operation === 0 && copy.length > 0) {
      copy.splice(int(random, copy.length), 1) // drop one, possibly from the middle
    } else if (operation === 1) {
      copy.push(randomValue(random, 2)) // append
    } else if (operation === 2 && copy.length > 1) {
      copy.reverse() // reorder
    } else if (operation === 3 && copy.length > 0) {
      copy.splice(int(random, copy.length + 1), 0, randomValue(random, 2)) // insert
    } else if (operation === 4) {
      return randomValue(random, 2) // replace the list by anything
    } else if (copy.length > 0 && depth > 0) {
      const index = int(random, copy.length)
      copy[index] = mutate(random, copy[index], depth - 1)
    }
    return copy
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
    const result: Record<string, unknown> = {}
    const operation = int(random, 6)
    const target = entries.length > 0 ? int(random, entries.length) : -1
    let handled = false
    entries.forEach(([key, child], index) => {
      let next = child
      if (index === target) {
        handled = true
        if (operation === 0) return // delete the key
        if (operation === 1) next = scalar(random)
        else if (operation === 2 && depth > 0) next = mutate(random, child, depth - 1)
        else if (operation === 3) {
          // Move the key to the end by re-adding it below.
          Object.defineProperty(result, key, { value: child, enumerable: true, writable: true, configurable: true })
          return
        }
      }
      Object.defineProperty(result, key, { value: next, enumerable: true, writable: true, configurable: true })
    })
    if (operation === 4 || !handled) {
      Object.defineProperty(result, pick(random, WORDS), { value: randomValue(random, 2), enumerable: true, writable: true, configurable: true })
    }
    return result
  }
  return maybeScalar(random, value)
}

function maybeScalar(random: Random, value: unknown): unknown {
  return random() < 0.7 ? scalar(random) : value
}

/** Every node kind a delta used, `object-order` and `keyed-order` being the two with an explicit key order. */
function collectKinds(node: unknown, kinds: Set<string>): void {
  if (!Array.isArray(node)) return
  const names = ['replace', 'object', 'append', 'keyed', 'elements']
  kinds.add(names[node[0] as number] as string)
  if (node[0] === 1 && node.length === 4) kinds.add('object-order')
  if (node[0] === 3 && node.length === 6) kinds.add('keyed-order')
  const children = node[0] === 3 ? node[3] : node[0] === 1 || node[0] === 4 ? node[1] : {}
  for (const child of Object.values(children as object)) collectKinds(child, kinds)
}

describe('delta codec: random values', () => {
  it('apply(prev, diff(prev, next)) is next for thousands of random pairs', () => {
    const random = mulberry32(0xc1d)
    const kinds = new Set<string>()
    for (let round = 0; round < 3000; round++) {
      const prev = clone(randomValue(random, 4))
      let next = prev
      const edits = 1 + int(random, 3)
      for (let edit = 0; edit < edits; edit++) next = mutate(random, next)
      next = clone(next)
      collectKinds(expectRoundTrip(prev, next), kinds)
    }
    // The generator must reach every encoding, or the property says little.
    expect([...kinds].sort()).toEqual(
      ['append', 'elements', 'keyed', 'keyed-order', 'object', 'object-order', 'replace'].sort(),
    )
  })

  it('two unrelated random values also round trip', () => {
    const random = mulberry32(0xbeef)
    for (let round = 0; round < 1000; round++) {
      expectRoundTrip(clone(randomValue(random, 4)), clone(randomValue(random, 4)))
    }
  })

  it('a chain of deltas rebuilds every state in order', () => {
    const random = mulberry32(42)
    let state = clone(randomValue(random, 4))
    const keyframe = state
    const deltas: unknown[] = []
    const states: unknown[] = []
    for (let step = 0; step < 60; step++) {
      const next = clone(mutate(random, state))
      deltas.push(viaJson(diffValues(state, next)))
      states.push(next)
      state = next
    }
    let rebuilt: unknown = keyframe
    deltas.forEach((delta, index) => {
      const applied = applyDelta(rebuilt, delta)
      if (!applied.ok) throw new Error(applied.reason)
      rebuilt = applied.value
      expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(states[index]))
    })
  })
})

// ---------------------------------------------------------------------------
// Real states
// ---------------------------------------------------------------------------

describe('delta codec: states recorded from a game played through the engine', () => {
  const game = playRecordedGame({ steps: 140, players: 3, noteEvery: 9 })

  it('every consecutive pair of saved states round trips', () => {
    expect(game.steps.length).toBeGreaterThan(140)
    for (const step of game.steps) expectRoundTrip(step.before, step.after)
  })

  it('every consecutive pair of revision snapshots round trips', () => {
    let previous = game.start
    let count = 0
    for (const step of game.steps) {
      if (step.revision === undefined) continue
      expectRoundTrip(previous, step.revision.state)
      previous = step.revision.state
      count += 1
    }
    expect(count).toBe(140)
  })

  it('states several actions apart round trip as well', () => {
    const states = [game.start, ...game.steps.map((step) => step.after)]
    for (let index = 0; index + 7 < states.length; index += 3) {
      expectRoundTrip(states[index], states[index + 7])
    }
  })

  it('a delta is a small fraction of the state it describes', () => {
    const sizes = game.steps.map((step) => JSON.stringify(diffValues(step.before, step.after)).length)
    const last = game.steps.at(-1)
    const fullSize = JSON.stringify(last?.after).length
    const average = sizes.reduce((sum, size) => sum + size, 0) / sizes.length
    // A real action touches a log entry, a hand and maybe the board: a few percent at most.
    expect(average).toBeLessThan(fullSize / 20)
    expect(Math.max(...sizes)).toBeLessThan(fullSize / 4)
  })
})
