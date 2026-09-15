/**
 * A seeded PRNG. Java used `Collections.shuffle` and `RandomUtils` against a
 * global source, which makes draws impossible to reproduce. Here the state
 * lives in the game state, and every function returns the next state.
 */

export type Rng = number

/** mulberry32 — small, fast, and even enough for shuffling cards. */
function next(state: Rng): readonly [value: number, state: Rng] {
  const seed = (state + 0x6d2b79f5) | 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296
  return [value, seed]
}

/** An integer in [0, bound). */
export function nextInt(state: Rng, bound: number): readonly [value: number, state: Rng] {
  if (bound <= 0) throw new Error(`nextInt needs bound > 0, got ${bound}`)
  const [value, nextState] = next(state)
  return [Math.floor(value * bound), nextState]
}

/** An integer in [min, max), like Java's `RandomUtils.nextInt(min, max)`. */
export function nextIntBetween(
  state: Rng,
  min: number,
  max: number,
): readonly [value: number, state: Rng] {
  const [value, nextState] = nextInt(state, max - min)
  return [min + value, nextState]
}

/**
 * Fisher–Yates in the same direction as `java.util.Collections.shuffle`, which
 * counts down and swaps against `nextInt(i)`. The values differ from Java —
 * the sources differ — but the algorithm is the same, and the result is
 * deterministic for a given seed.
 */
export function shuffle<T>(items: readonly T[], state: Rng): readonly [items: T[], state: Rng] {
  const result = [...items]
  let rng = state
  for (let i = result.length; i > 1; i--) {
    const [j, nextState] = nextInt(rng, i)
    rng = nextState
    const a = result[i - 1] as T
    const b = result[j] as T
    result[i - 1] = b
    result[j] = a
  }
  return [result, rng]
}

/** An opaque id, used as the stable identity of one item instance. */
export function nextId(state: Rng): readonly [id: string, state: Rng] {
  const [a, s1] = next(state)
  const [b, s2] = next(s1)
  const hi = Math.floor(a * 0x100000000).toString(16).padStart(8, '0')
  const lo = Math.floor(b * 0x100000000).toString(16).padStart(8, '0')
  return [`${hi}${lo}`, s2]
}

/** Makes a seed from a string, so a game can be named reproducibly. */
export function seedFrom(text: string): Rng {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash | 0
}
