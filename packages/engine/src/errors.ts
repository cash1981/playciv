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
  /**
   * No old-system counterpart: `discardRandomGreatPerson` found no Great Person
   * of the requested type in the acting player's hand.
   */
  | { readonly kind: 'NOTHING_TO_DISCARD'; readonly playerId: string; readonly type: string }
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
  | { readonly kind: 'INVALID_PLAYER_COLOR'; readonly color: string }
  | { readonly kind: 'PLAYER_COLOR_TAKEN'; readonly color: string }
  | { readonly kind: 'WITHDRAWN_PLAYER_COLOR_MISMATCH'; readonly color: string | null }
  /** The piece does not exist in board-assets.json */
  | { readonly kind: 'BOARD_ASSET_NOT_FOUND'; readonly assetId: string }
  /** The physical supply for this board asset has been exhausted. */
  | { readonly kind: 'BOARD_ASSET_LIMIT_REACHED'; readonly assetId: string; readonly limit: number }
  /** Only the Russian player may place the white army (issue #204) */
  | { readonly kind: 'BOARD_ASSET_RUSSIA_ONLY'; readonly assetId: string }
  | { readonly kind: 'BOARD_PIECE_NOT_FOUND'; readonly pieceId: string }
  | { readonly kind: 'UNKNOWN_WONDER_OWNER'; readonly playerId: string }
  /** The board history is empty, so there is nothing to take back */
  | { readonly kind: 'NOTHING_TO_UNDO_ON_BOARD' }
  /** The board's last change belongs to someone else, not the caller */
  | { readonly kind: 'BOARD_UNDO_NOT_YOURS' }
  /**
   * The board's last change is the removal of a piece an assisted action spent.
   * Only the undo vote on that action's log line may put it back.
   */
  | { readonly kind: 'BOARD_UNDO_ASSISTED' }
  /** Nothing has been undone since the last board change, so there is nothing to redo */
  | { readonly kind: 'NOTHING_TO_REDO_ON_BOARD' }
  /** The game has not started: there is no player to the left of the caller yet (barbarians) */
  | { readonly kind: 'GAME_NOT_STARTED' }
  /** Java has no equivalent — `setPlayerStat` (issue #43) got a key outside `PlayerStats` */
  | { readonly kind: 'UNKNOWN_STAT'; readonly stat: string }
  /** `setPlayerStat` (issue #197) was asked to set a stat the engine calculates (Combat) */
  | { readonly kind: 'STAT_NOT_EDITABLE'; readonly stat: string }
  /**
   * `setPlayerStat` (issue #43) got a value the stat does not allow: a
   * non-integer or negative number, or — for Movement (issue #102) — a string
   * that is not a `base(+bonus)*` expression.
   */
  | { readonly kind: 'INVALID_STAT_VALUE'; readonly value: number | string }
  /** `setCoinSource` got a source key outside the reference sheet's rows */
  | { readonly kind: 'UNKNOWN_COIN_SOURCE'; readonly source: string }
  /** `setCoinSource` was asked to set a row derived from current game state. */
  | { readonly kind: 'COIN_SOURCE_NOT_EDITABLE'; readonly source: string }
  /**
   * `setCoinSource` got a value the source does not allow: not a whole number,
   * negative, or above the printed limit (`max` is `null` when unlimited).
   */
  | { readonly kind: 'INVALID_COIN_VALUE'; readonly value: number; readonly max: number | null }
  /** A once-per-turn coin purchase could not be completed atomically. */
  | {
      readonly kind: 'COIN_PURCHASE_REJECTED'
      readonly source: 'democracy' | 'printingPress'
      readonly reason: 'TECH_NOT_REVEALED' | 'PHASE_CLOSED' | 'ALREADY_USED' | 'INSUFFICIENT_RESOURCES' | 'AT_CAPACITY'
    }
  /**
   * An assisted action could not be performed. `status` is the same word the
   * projection shows (`used`, `needs-resource`, `wrong-phase`, `not-owned`,
   * `unavailable`) and `reason` is the sentence for the player.
   */
  | {
      readonly kind: 'ASSISTED_ACTION_REJECTED'
      readonly action: string
      readonly status: 'used' | 'needs-resource' | 'wrong-phase' | 'not-owned' | 'unavailable'
      readonly reason: string
    }
  /** The assisted action behind this log line has already been undone. */
  | { readonly kind: 'ASSISTED_ACTION_ALREADY_UNDONE'; readonly logId: string }
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
    case 'NOTHING_TO_DISCARD':
      return `You have no ${error.type} great person to discard`
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
    case 'INVALID_PLAYER_COLOR':
      return `Unsupported player color: ${error.color}`
    case 'PLAYER_COLOR_TAKEN':
      return `Player color is already taken: ${error.color}`
    case 'WITHDRAWN_PLAYER_COLOR_MISMATCH':
      return `A replacement player must keep the withdrawn player's color: ${error.color}`
    case 'BOARD_ASSET_NOT_FOUND':
      return `Unknown board piece: ${error.assetId}`
    case 'BOARD_ASSET_LIMIT_REACHED':
      return `No ${error.assetId} pieces remain available`
    case 'BOARD_ASSET_RUSSIA_ONLY':
      return 'Only the Russian player can place the white army'
    case 'BOARD_PIECE_NOT_FOUND':
      return `No piece on the board with id ${error.pieceId}`
    case 'UNKNOWN_WONDER_OWNER':
      return `No player in this game with id ${error.playerId}`
    case 'NOTHING_TO_UNDO_ON_BOARD':
      return 'There is no board change to undo'
    case 'BOARD_UNDO_NOT_YOURS':
      return 'The last board change was made by someone else'
    case 'BOARD_UNDO_ASSISTED':
      return 'The last board change was made by an assisted action. Ask for an undo vote on its log line instead'
    case 'NOTHING_TO_REDO_ON_BOARD':
      return 'There is no undone board change to redo'
    case 'GAME_NOT_STARTED':
      return 'The game has not started yet'
    case 'UNKNOWN_STAT':
      return `Unknown player stat: ${error.stat}`
    case 'STAT_NOT_EDITABLE':
      return `The ${error.stat} stat is calculated automatically and cannot be edited`
    case 'INVALID_STAT_VALUE':
      return `Player stat must be a whole number of zero or more, got ${error.value}`
    case 'UNKNOWN_COIN_SOURCE':
      return `Unknown coin source: ${error.source}`
    case 'COIN_SOURCE_NOT_EDITABLE':
      return `The ${error.source} coin source is calculated from the board and cannot be edited`
    case 'INVALID_COIN_VALUE':
      return error.max === null
        ? `Coin count must be a whole number of zero or more, got ${error.value}`
        : `Coin count must be a whole number between 0 and ${error.max}, got ${error.value}`
    case 'COIN_PURCHASE_REJECTED':
      return {
        TECH_NOT_REVEALED: 'Reveal the matching technology before using this purchase.',
        PHASE_CLOSED: 'This purchase is only available during your open City Management phase.',
        ALREADY_USED: 'This purchase has already been used this turn.',
        INSUFFICIENT_RESOURCES: 'You do not have enough trade or culture for this purchase.',
        AT_CAPACITY: 'This coin source is already at its capacity.',
      }[error.reason]
    case 'ASSISTED_ACTION_REJECTED':
      return error.reason
    case 'ASSISTED_ACTION_ALREADY_UNDONE':
      return 'This action has already been undone'
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
