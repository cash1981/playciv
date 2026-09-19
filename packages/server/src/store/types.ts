/**
 * The storage interface.
 *
 * Java used MongoJack with three collections — `player`, `pbf` and `gamelog` —
 * plus `chat`. The log now lives inside `GameState`, so what remains is
 * players, games and chat.
 *
 * The interface exists to keep the database out of the routes. There are two
 * implementations: `JsonFileRepository`, which holds everything in memory and
 * mirrors it to a JSON file (local development), and `D1Repository`, which runs
 * against Cloudflare D1 (production, on the Worker).
 */

import type { FinishedGame, GameState } from '@civ/engine'

export type { FinishedGame }

export type UserRole = 'user' | 'admin'

export interface StoredPlayer {
  readonly id: string
  readonly username: string
  readonly email: string | null
  /** A scrypt hash of the form `salt:hash`. Java used unsalted SHA-1. */
  readonly passwordHash: string
  readonly createdAt: string
  /** Optional only at the boundary for seed/legacy records; repositories normalize it. */
  readonly role?: UserRole
  readonly disabled?: boolean
  /**
   * Java `Player.disableEmail` — set by the unsubscribe link. Opted-in by
   * default; the legacy `player` documents already carry this field.
   */
  readonly disableEmail?: boolean
}

export interface PlayerUpdate {
  readonly username?: string
  readonly email?: string | null
  readonly role?: UserRole
  readonly disabled?: boolean
  readonly disableEmail?: boolean
}

export interface ChatMessage {
  readonly id: string
  readonly gameId: string | null
  readonly username: string
  readonly message: string
  readonly createdAt: string
}

/** One immutable full-state checkpoint. Raw snapshots never leave the repository layer. */
export interface GameRevision {
  readonly gameId: string
  readonly revision: number
  readonly createdAt: string
  readonly actor: { readonly playerId: string; readonly username: string }
  readonly publicDescription: string
  readonly privateDescriptions: Readonly<Record<string, string>>
  readonly logIds: readonly string[]
  readonly state: GameState
}

export type GameRevisionSummary = Omit<GameRevision, 'state' | 'privateDescriptions'> & {
  readonly privateDescription: string | null
}

export interface Repository {
  createPlayer(player: StoredPlayer): Promise<void>
  findPlayerById(id: string): Promise<StoredPlayer | undefined>
  findPlayerByUsername(username: string): Promise<StoredPlayer | undefined>
  allPlayers(): Promise<readonly StoredPlayer[]>
  /** Rewrites the stored hash, used to upgrade a legacy SHA-1 account on login. */
  updatePlayerPassword(id: string, passwordHash: string): Promise<void>
  updatePlayer(id: string, changes: PlayerUpdate): Promise<StoredPlayer | undefined>
  deletePlayer(id: string): Promise<boolean>

  saveGame(game: GameState): Promise<void>
  /** Saves a non-revisioned change only while the live game is unchanged. */
  saveGameIfRevision(game: GameState, expectedRevision: number): Promise<boolean>
  /**
   * Saves the live game and matching checkpoint only when the stored game is
   * still at `expectedRevision`. `null` means that the game must not exist.
   */
  saveGameWithRevision(
    game: GameState,
    revision: GameRevision,
    expectedRevision: number | null,
  ): Promise<boolean>
  /**
   * Adds a baseline only while the live game still exists at
   * `expectedRevision`. Returns false when it changed or was deleted.
   */
  ensureGameRevision(revision: GameRevision, expectedRevision: number): Promise<boolean>
  listGameRevisions(gameId: string): Promise<readonly GameRevision[]>
  findGameRevision(gameId: string, revision: number): Promise<GameRevision | undefined>
  findGame(id: string): Promise<GameState | undefined>
  allGames(): Promise<readonly GameState[]>
  deleteGame(id: string): Promise<boolean>

  appendChat(message: ChatMessage): Promise<void>
  chatFor(gameId: string | null): Promise<readonly ChatMessage[]>

  /**
   * Atomically claims a throttled-notification slot. Returns true when no send
   * has been recorded for `scope` within `waitMs` (and records `now`), false
   * while the cooldown is still active. Java kept these timestamps on
   * `Player.emailSent` (global, 3 h) and `Playerhand.emailSent` (per game,
   * 30 min); here it is a small keyed table so it survives a restart without
   * touching the engine state. Keys are built by `notifications.ts`.
   *
   * Must be atomic: two concurrent callers for the same scope must never both
   * receive true, or a chat burst sends more than the one mail the cooldown
   * promises.
   */
  claimEmailSlot(scope: string, waitMs: number, now: Date): Promise<boolean>

  /**
   * Finished, won games as a source for `highscore()`, roster included —
   * `attempts` needs to know who lost, not just who won. `D1Repository` reads
   * this from both the migrated old `pbf` table and the live `game` one;
   * `JsonFileRepository` derives it from `allGames()`.
   */
  finishedGamesForHighscore(): Promise<readonly FinishedGame[]>

  /** Flushes pending changes to disk. A no-op without file storage. */
  flush(): Promise<void>
}
