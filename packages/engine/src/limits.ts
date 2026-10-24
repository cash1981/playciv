/**
 * Limits the web shows and the engine enforces.
 *
 * A leaf module on purpose, with no imports: the web reads these through the
 * package root, and a number must not drag the reducers into the browser bundle.
 */

/** The largest production a player may type in for a city. */
export const MAX_PRODUCTION_OVERRIDE = 99

/** The largest culture a player may type in when devoting a city to the arts. */
export const MAX_DEVOTE_CULTURE = 99

/** The trade track ends at 27. */
export const TRADE_CEILING = 27

/** The Japanese are the exception: their trade track ends at 25 (the human). */
const JAPANESE_TRADE_CEILING = 25

/** The most trade a player of this civilization may hold: 25 for the Japanese, 27 for everyone else. */
export const tradeCeilingOf = (civilizationName: string | null | undefined): number =>
  civilizationName === 'Japanese' ? JAPANESE_TRADE_CEILING : TRADE_CEILING
