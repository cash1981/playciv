/**
 * Seedet PRNG. Java brukte `Collections.shuffle` og `RandomUtils` mot en global
 * kilde, som gjør trekk umulige å reprodusere. Her ligger tilstanden i
 * spilltilstanden, og hver funksjon returnerer neste tilstand.
 */

export type Rng = number

/** mulberry32 — liten, rask, god nok fordeling for kortstokker. */
function next(state: Rng): readonly [value: number, state: Rng] {
  const seed = (state + 0x6d2b79f5) | 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296
  return [value, seed]
}

/** Heltall i [0, bound). */
export function nextInt(state: Rng, bound: number): readonly [value: number, state: Rng] {
  if (bound <= 0) throw new Error(`nextInt krever bound > 0, fikk ${bound}`)
  const [value, nextState] = next(state)
  return [Math.floor(value * bound), nextState]
}

/** Heltall i [min, max), som Javas `RandomUtils.nextInt(min, max)`. */
export function nextIntBetween(
  state: Rng,
  min: number,
  max: number,
): readonly [value: number, state: Rng] {
  const [value, nextState] = nextInt(state, max - min)
  return [min + value, nextState]
}

/**
 * Fisher–Yates i samme retning som `java.util.Collections.shuffle`, som teller
 * ned og bytter mot `nextInt(i)`. Verdiene blir ikke like Javas — kildene er
 * forskjellige — men algoritmen er den samme, og resultatet er deterministisk
 * for en gitt seed.
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

/** Opaque id, brukt som stabil identitet per item-instans. */
export function nextId(state: Rng): readonly [id: string, state: Rng] {
  const [a, s1] = next(state)
  const [b, s2] = next(s1)
  const hi = Math.floor(a * 0x100000000).toString(16).padStart(8, '0')
  const lo = Math.floor(b * 0x100000000).toString(16).padStart(8, '0')
  return [`${hi}${lo}`, s2]
}

/** Lager en seed fra en tekststreng, slik at spill kan navngis reproduserbart. */
export function seedFrom(text: string): Rng {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash | 0
}
