import type { SheetName } from './sheet-name.js'

/**
 * The errors the engine can return. Java threw `WebApplicationException` with
 * an HTTP status straight from the domain logic; here errors are plain data
 * and the HTTP mapping belongs in the server package.
 */
export type EngineError =
  /** Java: `PlayerAction.cannotFindPlayer()` — 404 */
  | { readonly kind: 'PLAYER_NOT_FOUND'; readonly playerId: string }
  /** Java: `BaseAction.cannotFindItem()` — 404 */
  | { readonly kind: 'ITEM_NOT_FOUND'; readonly sheetName?: SheetName }
  /** Java: `BaseAction.checkYourTurn` — 403 "Its not your turn!" */
  | { readonly kind: 'NOT_YOUR_TURN'; readonly playerId: string }
  /**
   * Java: `DrawAction.draw` returned `Optional.empty()` and logged a warning.
   * Techs are chosen, not drawn.
   */
  | { readonly kind: 'TECHS_ARE_CHOSEN_NOT_DRAWN'; readonly sheetName: SheetName }
  /** Java: `reshuffleItems` threw `IllegalArgumentException` */
  | { readonly kind: 'NOT_SHUFFLABLE'; readonly sheetName: SheetName }
  /** Java: `NoMoreItemsException` — 410 Gone */
  | { readonly kind: 'NO_MORE_ITEMS'; readonly what: string }
  /** Java: 412 "Cannot draw more barbarians until they are discarded" */
  | { readonly kind: 'BARBARIANS_NOT_DISCARDED'; readonly playerId: string }
  /** Java: 404 "You have nothing to draw" */
  | { readonly kind: 'NOTHING_TO_LOOT'; readonly playerId: string }
  /** Java: 406 "Item is not lootable" */
  | { readonly kind: 'ITEM_NOT_LOOTABLE'; readonly itemId: string }
  /** Java: `SecurityCheck.hasUserAccess` was false — 403 */
  | { readonly kind: 'NO_ACCESS'; readonly playerId: string }
  /** Java logged a warning and returned null */
  | { readonly kind: 'TECH_ALREADY_CHOSEN'; readonly techName: string }
  /** Java logged a warning and returned null */
  | { readonly kind: 'SOCIAL_POLICY_ALREADY_CHOSEN'; readonly name: string }
  /** Java: 400 — you cannot hold both sides of the same card */
  | {
      readonly kind: 'SOCIAL_POLICY_FLIPSIDE_TAKEN'
      readonly name: string
      readonly flipside: string
    }
  /** Java: 304 Not Modified "Item already revealed" */
  | { readonly kind: 'ITEM_ALREADY_REVEALED'; readonly name: string }
  /** Java: 400 "Civilization already chosen" */
  | { readonly kind: 'CIVILIZATION_ALREADY_CHOSEN'; readonly playerId: string }
  | { readonly kind: 'LOG_ENTRY_NOT_FOUND'; readonly logId: string }
  /** Java: 400 "Cannot initiate a undo. Its already been initiated" */
  | { readonly kind: 'UNDO_ALREADY_INITIATED'; readonly logId: string }
  /** Java: 412 "This item cannot be undone. Nothing to undo." */
  | { readonly kind: 'UNDO_NOT_INITIATED'; readonly logId: string }
  /** The log entry carries no item, so there is nothing to undo */
  | { readonly kind: 'NOTHING_TO_UNDO'; readonly logId: string }
  /** Java: 400 "Cannot join the game. Its full!" */
  | { readonly kind: 'GAME_IS_FULL'; readonly numOfPlayers: number }
  /** Java: 400 "Cannot join the game. You have already joined!" */
  | { readonly kind: 'ALREADY_JOINED'; readonly playerId: string }
  /** Java: 403 "As game creator, you must end game not withdraw from it" */
  | { readonly kind: 'GAME_CREATOR_MUST_END_GAME'; readonly playerId: string }
  /** Java: 403 "Only game creator can end game" */
  | { readonly kind: 'ONLY_GAME_CREATOR_CAN_END_GAME'; readonly playerId: string }
  | { readonly kind: 'TURN_NOT_FOUND'; readonly turnNumber: number }
  /** Every colour is taken */
  | { readonly kind: 'NO_COLOR_AVAILABLE' }
  /** The piece does not exist in board-assets.json */
  | { readonly kind: 'BOARD_ASSET_NOT_FOUND'; readonly assetId: string }
  /** The physical supply for this board asset has been exhausted. */
  | { readonly kind: 'BOARD_ASSET_LIMIT_REACHED'; readonly assetId: string; readonly limit: number }
  | { readonly kind: 'BOARD_PIECE_NOT_FOUND'; readonly pieceId: string }
  /** The board history is empty, so there is nothing to take back */
  | { readonly kind: 'NOTHING_TO_UNDO_ON_BOARD' }
  /** `endTurn` was called but no player has the turn yet — the game has not started */
  | { readonly kind: 'GAME_NOT_STARTED' }
  /** Java has no equivalent — `setPlayerStat` (issue #43) got a key outside `PlayerStats` */
  | { readonly kind: 'UNKNOWN_STAT'; readonly stat: string }
  /** `setPlayerStat` (issue #43) got a value that is not an allowed integer */
  | { readonly kind: 'INVALID_STAT_VALUE'; readonly value: number }
  /** `setPlayerGovernment` got a value outside the Wisdom and Warfare cards. */
  | { readonly kind: 'UNKNOWN_GOVERNMENT'; readonly government: string }
  /** A battle is already active — only one at a time is allowed */
  | { readonly kind: 'BATTLE_ALREADY_ACTIVE' }
  /** An arena action was attempted but no battle is active */
  | { readonly kind: 'NO_BATTLE_ACTIVE' }
  /** The player is not a participant in the current battle */
  | { readonly kind: 'NOT_IN_THIS_BATTLE'; readonly playerId: string }
  /** The unit is already in the arena (already `inBattle`) */
  | { readonly kind: 'UNIT_ALREADY_IN_BATTLE'; readonly unitId: string }
  /** No arena unit with the given id was found */
  | { readonly kind: 'ARENA_UNIT_NOT_FOUND'; readonly arenaUnitId: string }
  /** An arena stat value is not a non-negative integer */
  | { readonly kind: 'INVALID_ARENA_STAT_VALUE'; readonly value: number }
  /** A player cannot initiate a battle against themselves */
  | { readonly kind: 'CANNOT_BATTLE_YOURSELF'; readonly playerId: string }
  /** That position is already occupied on this side */
  | { readonly kind: 'ARENA_POSITION_OCCUPIED' }

export function describeError(error: EngineError): string {
  switch (error.kind) {
    case 'PLAYER_NOT_FOUND':
      return 'Could not find player'
    case 'ITEM_NOT_FOUND':
      return 'Could not find item'
    case 'NOT_YOUR_TURN':
      return 'Its not your turn!'
    case 'TECHS_ARE_CHOSEN_NOT_DRAWN':
      return 'Drawing of techs is not possible. Techs are supposed to be chosen, not drawn.'
    case 'NOT_SHUFFLABLE':
      return `Tried to reshuffle ${error.sheetName} but not a shufflable type`
    case 'NO_MORE_ITEMS':
      return `No more ${error.what} to draw`
    case 'BARBARIANS_NOT_DISCARDED':
      return 'Cannot draw more barbarians until they are discarded'
    case 'NOTHING_TO_LOOT':
      return 'You have nothing to draw'
    case 'ITEM_NOT_LOOTABLE':
      return 'Item is not lootable'
    case 'NO_ACCESS':
      return 'User is not player of this game'
    case 'TECH_ALREADY_CHOSEN':
      return `Player tried to add same tech as they had: ${error.techName}`
    case 'SOCIAL_POLICY_ALREADY_CHOSEN':
      return `Player tried to add same social policy as they had: ${error.name}`
    case 'SOCIAL_POLICY_FLIPSIDE_TAKEN':
      return `Player tried to add a social policy on same flipside: ${error.flipside}`
    case 'ITEM_ALREADY_REVEALED':
      return 'Item already revealed'
    case 'CIVILIZATION_ALREADY_CHOSEN':
      return 'Civilization already chosen'
    case 'LOG_ENTRY_NOT_FOUND':
      return 'Could not find game log entry'
    case 'UNDO_ALREADY_INITIATED':
      return 'Cannot initiate a undo. Its already been initiated'
    case 'UNDO_NOT_INITIATED':
      return 'This item cannot be undone. Nothing to undo.'
    case 'NOTHING_TO_UNDO':
      return 'The log entry has no item to undo'
    case 'GAME_IS_FULL':
      return 'Cannot join the game. Its full!'
    case 'ALREADY_JOINED':
      return 'Cannot join the game. You have already joined!'
    case 'GAME_CREATOR_MUST_END_GAME':
      return 'As game creator, you must end game not withdraw from it'
    case 'ONLY_GAME_CREATOR_CAN_END_GAME':
      return 'Only game creator can end game'
    case 'TURN_NOT_FOUND':
      return `Could not find turn ${error.turnNumber}`
    case 'NO_COLOR_AVAILABLE':
      return 'No colors left to assign'
    case 'BOARD_ASSET_NOT_FOUND':
      return `Unknown board piece: ${error.assetId}`
    case 'BOARD_ASSET_LIMIT_REACHED':
      return `No ${error.assetId} pieces remain available`
    case 'BOARD_PIECE_NOT_FOUND':
      return `No piece on the board with id ${error.pieceId}`
    case 'NOTHING_TO_UNDO_ON_BOARD':
      return 'There is no board change to undo'
    case 'GAME_NOT_STARTED':
      return 'The game has not started yet, so there is no turn to end'
    case 'UNKNOWN_STAT':
      return `Unknown player stat: ${error.stat}`
    case 'INVALID_STAT_VALUE':
      return `Player stat must be a whole number; only Combat may be negative, got ${error.value}`
    case 'UNKNOWN_GOVERNMENT':
      return `Unknown government: ${error.government}`
    case 'BATTLE_ALREADY_ACTIVE':
      return 'A battle is already in progress'
    case 'NO_BATTLE_ACTIVE':
      return 'No battle is currently active'
    case 'NOT_IN_THIS_BATTLE':
      return 'Player is not a participant in the current battle'
    case 'UNIT_ALREADY_IN_BATTLE':
      return 'This unit is already in the arena'
    case 'ARENA_UNIT_NOT_FOUND':
      return `No arena unit with id ${error.arenaUnitId}`
    case 'INVALID_ARENA_STAT_VALUE':
      return `Arena stat must be a non-negative whole number, got ${error.value}`
    case 'CANNOT_BATTLE_YOURSELF':
      return 'You cannot initiate a battle against yourself'
    case 'ARENA_POSITION_OCCUPIED':
      return 'That position is already occupied on this side'
  }
}
