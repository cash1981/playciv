/**
 * @civ/engine — the domain logic for Civilization: The Board Game
 * (Fantasy Flight, with Fame and Fortune and Wisdom and Warfare).
 *
 * No HTTP, no database, no UI. Every reducer is a pure function of the shape
 * `(state, action) => Result<GameState, EngineError>`.
 */

export * from './result.js'
export * from './errors.js'
export * from './random.js'
export * from './sheet-name.js'
export * from './item.js'
export * from './coins.js'
export * from './board.js'
export * from './terrain.js'
export * from './migrate.js'
export * from './turn.js'
export * from './highscore.js'
export * from './undo.js'
export * from './state.js'
export * from './blockade.js'
export * from './build-item.js'
export * from './build-options.js'
export * from './limits.js'
export * from './assisted-techs.js'
export * from './building-data.js'
export * from './city-actions.js'
export * from './city-production.js'
export * from './combat-bonus.js'
export * from './culture-hand.js'
export * from './culture-track.js'
export * from './log.js'
export * from './assisted.js'
export { playableCardsOf } from './assisted-cards.js'
export {
  GOVERNMENT_UNLOCK_TECH,
  INVESTABLE_COIN_SOURCES,
  INVESTMENT_CARDS,
  canEnterAnarchy,
  governmentOptionsOf,
  isImmuneToAnarchy,
  unlockedGovernments,
} from './sot.js'
export type { GovernmentOption, InvestmentCardInfo } from './sot.js'
export { HARVESTABLE_RESOURCES } from './assisted-sot.js'
export { MAX_CITIES, MAX_CITIES_WITH_IRRIGATION, cityLimitOf, foundCityCheck } from './city-founding.js'
export { livePendingRewards } from './assisted-culture.js'
export * from './card-timing.js'
export { PHASE_REASON, openCityManagementTurn } from './assisted-core.js'
export type {
  AssistedAvailability,
  AssistedPayload,
  BlockedAvailability,
  AssignScoutPayload,
  ChooseRewardPayload,
  FoundCityPayload,
  GovernmentPayload,
  HarvestPayload,
  InvestPayload,
  PlayCardPayload,
  StartBuildingProgramPayload,
  UpgradeBuildingsPayload,
} from './assisted-core.js'
export * from './trade-offers.js'
export * from './gamedata.js'
export * from './create-game.js'
export * from './battle.js'
export * from './government.js'
export * from './actions/draw.js'
export * from './actions/player.js'
export * from './actions/undo.js'
export * from './actions/turn.js'
export * from './actions/game.js'
export * from './actions/board.js'
export * from './actions/arena.js'
