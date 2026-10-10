/**
 * Limits the web shows and the engine enforces.
 *
 * A leaf module on purpose, with no imports: the web reads these through the
 * package root, and a number must not drag the reducers into the browser bundle.
 */

/** The largest production a player may type in for a city. */
export const MAX_PRODUCTION_OVERRIDE = 99
