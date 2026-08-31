/**
 * @civ/engine — ren domenelogikk for Civilization: The Board Game
 * (Fantasy Flight, med Fame and Fortune + Wisdom and Warfare).
 *
 * Ingen HTTP, ingen database, ingen UI. Alle reducere er rene funksjoner på
 * formen `(state, action) => Result<GameState, EngineError>`.
 */

export * from './result.js'
export * from './errors.js'
export * from './random.js'
export * from './sheet-name.js'
export * from './item.js'
export * from './state.js'
export * from './log.js'
export * from './gamedata.js'
export * from './create-game.js'
export * from './actions/draw.js'
