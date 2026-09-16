/**
 * Port of `PBF` and `Playerhand`.
 *
 * PBF stood for "play by forum" and was the Mongo document for a game. The
 * `mapLink` and `assetLink` fields are deliberately left out — they pointed at
 * a Google Presentation and a Google Spreadsheet in an iframe, and are going
 * away.
 */

import type { Item, SocialPolicyItem, TechItem, UnitItem, CivItem } from './item.js'
import type { Rng } from './random.js'
import type { Board, BoardArea } from './board.js'
import { playerAreas } from './board.js'
import type { PlayerTurn } from './turn.js'
import type { Undo } from './undo.js'

export type GameType = 'WAW'

/** Java: `Playerhand.green()` and friends. */
export const PLAYER_COLORS = ['Green', 'Yellow', 'Purple', 'Red', 'Blue'] as const
export type PlayerColor = (typeof PLAYER_COLORS)[number]

export interface Playerhand {
  readonly playerId: string
  readonly username: string
  readonly email: string | null
  readonly color: string | null
  readonly playernumber: number
  readonly gameCreator: boolean
  /** Java: `yourTurn` — only one player has this set at a time. */
  readonly yourTurn: boolean
  /** Java: `civilization` — the chosen civilization. */
  readonly civilization: CivItem | null
  /** A hidden hand. Only the owner should see the contents. */
  readonly items: readonly Item[]
  readonly techsChosen: readonly TechItem[]
  /** Java: at most three barbarian units at a time. */
  readonly barbarians: readonly UnitItem[]
  readonly battlehand: readonly UnitItem[]
  readonly socialPolicies: readonly SocialPolicyItem[]
  /** Java: `playerTurns` — the player's own turn orders, private until shared. */
  readonly playerTurns: readonly PlayerTurn[]
  /** Java: `gamenote` — the player's private note about the game. */
  readonly gamenote: string | null
}

/** Java: `GameLog.LogType`. */
export type LogType =
  | 'TRADE_BETWEEN_PLAYERS'
  | 'BATTLE'
  | 'ITEM'
  | 'TECH'
  | 'REMOVED_TECH'
  | 'SHUFFLE'
  | 'DISCARD'
  | 'WITHDRAW'
  | 'JOIN'
  | 'REVEAL'
  | 'UNDO'
  | 'SOCIAL_POLICY'
  | 'REMOVED_SOCIAL_POLICY'
  | 'VOTE'
  | 'SETUP'
  | 'SOT'
  | 'TRADE'
  | 'CM'
  | 'MOVEMENT'
  | 'RESEARCH'

/**
 * Java: `GameLog`. Java stored the whole item on the log document and let the
 * resource layer filter it; that was the security hole noted in todo.txt. Here
 * the item sits on its own field that the `publicLog` projection never touches.
 */
export interface GameLogEntry {
  readonly id: string
  readonly username: string
  readonly logType: LogType | null
  /** Full information. Only ever shown to whoever made the draw. */
  readonly privateLog: string
  /** What everyone may see. Never reveals the contents of a hidden item. */
  readonly publicLog: string
  /**
   * The item the draw was about, if any. Java: `GameLog.draw.item`. For the
   * private view and undo only — never send this out in a public projection.
   */
  readonly item: Item | null
  /** Java: `GameLog.draw.playerId` — whose draw it is. */
  readonly playerId: string | null
  /**
   * Java: `GameLog.draw.undo`. Set when someone has asked to undo this log
   * entry. The undo hangs off the log entry because it is the action being
   * taken back, not the item.
   */
  readonly undo: Undo | null
  /** ISO timestamp assigned by the server when this entry is persisted. */
  readonly createdAt: string | null
}

export interface GameState {
  readonly id: string
  readonly name: string
  readonly gameType: GameType
  readonly numOfPlayers: number
  readonly active: boolean
  readonly winner: string | null
  /** The deck. Java: `PBF.items`. */
  readonly items: readonly Item[]
  /** Java: `PBF.discardedItems` — what a reshuffle draws back from. */
  readonly discardedItems: readonly Item[]
  readonly players: readonly Playerhand[]
  /** Java: `withdrawnPlayers` — the hands of players who have withdrawn. */
  readonly withdrawnPlayers: readonly Playerhand[]
  /** Techs are chosen rather than drawn, so everyone sees the whole list. */
  readonly techs: readonly TechItem[]
  readonly socialPolicies: readonly SocialPolicyItem[]
  /**
   * Java: `publicTurns`, keyed on `turnNumber + username`. Turn orders become
   * public the moment they are updated.
   */
  readonly publicTurns: Readonly<Record<string, PlayerTurn>>
  readonly log: readonly GameLogEntry[]
  /** The board and the pieces on it. Every player sees the whole board. */
  readonly board: Board
  readonly rng: Rng
  /** The next `itemNumber`. Java: `ItemReader.itemCounter`, a global AtomicInteger. */
  readonly itemCounter: number
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function findPlayer(state: GameState, playerId: string): Playerhand | undefined {
  return state.players.find((player) => player.playerId === playerId)
}

/** Java: `PBF.getNameOfUsersTurn()`. */
export function nameOfPlayersTurn(state: GameState): string {
  return state.players.find((player) => player.yourTurn)?.username ?? ''
}

export function findPlayerByUsername(
  state: GameState,
  username: string,
): Playerhand | undefined {
  return state.players.find((player) => player.username === username)
}

/** Java: `misc.SecurityCheck.hasUserAccess` — is the player in this game. */
export function hasUserAccess(state: GameState, playerId: string): boolean {
  return state.players.some((player) => player.playerId === playerId)
}

export function findLogEntry(state: GameState, logId: string): GameLogEntry | undefined {
  return state.log.find((entry) => entry.id === logId)
}

/** Replaces one log entry and leaves the rest alone. */
export function withLogEntry(state: GameState, entry: GameLogEntry): GameState {
  return {
    ...state,
    log: state.log.map((existing) => (existing.id === entry.id ? entry : existing)),
  }
}

/** Replaces one player hand and leaves the rest alone. */
export function withPlayer(state: GameState, player: Playerhand): GameState {
  return {
    ...state,
    players: state.players.map((existing) =>
      existing.playerId === player.playerId ? player : existing,
    ),
  }
}

// ---------------------------------------------------------------------------
// Projections — what a given player gets to see
// ---------------------------------------------------------------------------

/** What other players see of a hand: counts, not contents. */
export interface OpaquePlayerhand {
  readonly playerId: string
  readonly username: string
  readonly color: string | null
  readonly playernumber: number
  readonly gameCreator: boolean
  readonly yourTurn: boolean
  /** The civilization is public as soon as it has been revealed. */
  readonly civilization: CivItem | null
  readonly numberOfItemsInHand: number
  readonly numberOfTechsChosen: number
  readonly numberOfBarbarians: number
  readonly numberOfSocialPolicies: number
  /** The battlehand is revealed explicitly in battle, so it is shown as it is. */
  readonly battlehand: readonly UnitItem[]
  /**
   * Revealed techs only. Java: `getTechsForAllPlayers` filtered on
   * `!isHidden()`, which is how the tech pyramid becomes public.
   */
  readonly revealedTechs: readonly TechItem[]
  /**
   * The turn orders that have been shared. `gamenote` and `playerTurns` are
   * private and do not appear here.
   */
  readonly publicTurns: readonly PlayerTurn[]
}

function opaque(state: GameState, player: Playerhand): OpaquePlayerhand {
  return {
    playerId: player.playerId,
    username: player.username,
    color: player.color,
    playernumber: player.playernumber,
    gameCreator: player.gameCreator,
    yourTurn: player.yourTurn,
    civilization: player.civilization,
    numberOfItemsInHand: player.items.length,
    numberOfTechsChosen: player.techsChosen.length,
    numberOfBarbarians: player.barbarians.length,
    numberOfSocialPolicies: player.socialPolicies.length,
    battlehand: player.battlehand,
    revealedTechs: player.techsChosen.filter((tech) => !tech.hidden),
    publicTurns: Object.values(state.publicTurns).filter(
      (turn) => turn.username === player.username,
    ),
  }
}

/** One log entry as everyone may see it. The item contents are gone. */
export interface PublicLogEntry {
  readonly id: string
  readonly username: string
  readonly logType: LogType | null
  readonly publicLog: string
}

export function toPublicLog(entry: GameLogEntry): PublicLogEntry {
  return {
    id: entry.id,
    username: entry.username,
    logType: entry.logType,
    publicLog: entry.publicLog,
  }
}

/**
 * The game state seen by one player: their own hand in the clear, the others'
 * as counts, the deck as a count only, and a log where other people's draws
 * appear in public form alone.
 */
export interface PlayerView {
  readonly id: string
  readonly name: string
  readonly gameType: GameType
  readonly numOfPlayers: number
  readonly active: boolean
  readonly winner: string | null
  readonly numberOfItemsInDeck: number
  readonly numberOfDiscardedItems: number
  readonly you: Playerhand | null
  readonly opponents: readonly OpaquePlayerhand[]
  readonly techs: readonly TechItem[]
  /** The board is public — everyone sees the same pieces. */
  readonly board: Board
  /** Derived from the player list, so it cannot drift out of step. */
  readonly boardAreas: readonly BoardArea[]
  readonly log: readonly (PublicLogEntry | GameLogEntry)[]
}

export function toPlayerView(state: GameState, viewerId: string): PlayerView {
  const you = findPlayer(state, viewerId) ?? null
  return {
    id: state.id,
    name: state.name,
    gameType: state.gameType,
    numOfPlayers: state.numOfPlayers,
    active: state.active,
    winner: state.winner,
    numberOfItemsInDeck: state.items.length,
    numberOfDiscardedItems: state.discardedItems.length,
    you,
    opponents: state.players
      .filter((player) => player.playerId !== viewerId)
      .map((player) => opaque(state, player)),
    techs: state.techs,
    board: state.board,
    boardAreas: playerAreas(state.board, state.players),
    log: state.log.map((entry) =>
      entry.playerId === viewerId ? entry : toPublicLog(entry),
    ),
  }
}
