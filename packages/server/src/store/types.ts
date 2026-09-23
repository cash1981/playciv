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

import type { FinishedGame, GameState, HighscoreResult } from '@civ/engine'

export type { FinishedGame }

export type UserRole = 'user' | 'admin'

/**
 * The social providers the app signs in with. Apple is deliberately absent:
 * it needs a paid Apple Developer Program membership, which the owner refused.
 * Adding one later is a new entry in the provider table in `oauth.ts`.
 */
export type ProviderId = 'google' | 'facebook' | 'discord'

/** One provider identity linked to an account. Stored as JSON text in D1. */
export interface OAuthIdentity {
  readonly provider: ProviderId
  readonly providerUserId: string
}

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
  /**
   * Whether the account has proven control of its address. Optional at the
   * boundary because the ~554 migrated records predate the field; a missing
   * value means **verified**, since those accounts are grandfathered. New
   * records always carry it explicitly, so a forgotten `false` on a fresh
   * account is a review finding rather than a silent bypass.
   */
  readonly emailVerified?: boolean
  /** Provider identities linked to this account; missing means none. */
  readonly oauthProviders?: readonly OAuthIdentity[]
}

export interface PlayerUpdate {
  readonly username?: string
  readonly email?: string | null
  readonly role?: UserRole
  readonly disabled?: boolean
  readonly disableEmail?: boolean
  readonly emailVerified?: boolean
  readonly oauthProviders?: readonly OAuthIdentity[]
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

/**
 * A revision without its snapshot. The history bar needs the metadata of every
 * revision but never a single `state`, and loading those snapshots was enough
 * to tip a Worker over its resource limit (see `listGameRevisionSummaries`).
 */
export type GameRevisionMetadata = Omit<GameRevision, 'state'>

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
  /**
   * The metadata of every revision, oldest first, without the `state` each one
   * carries. The history bar only ever needs the descriptions and the actor, so
   * loading and parsing the snapshots would be pure waste — and for a game with
   * many revisions it was enough to trip the Worker's resource limit.
   */
  listGameRevisionSummaries(gameId: string): Promise<readonly GameRevisionMetadata[]>
  findGameRevision(gameId: string, revision: number): Promise<GameRevision | undefined>
  /** Reads the live change marker without loading the serialized game. */
  findGameRevisionCounter(gameId: string): Promise<number | undefined>
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
   * 30 min); the rewrite keeps only the per-game scope — the global one belonged
   * to the removed new-game broadcast — in a small keyed table so it survives a
   * restart without touching the engine state. Keys are built by
   * `notifications.ts`.
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
  /** Returns the durable complete response, rebuilding only after a relevant write. */
  cachedHighscore(): Promise<HighscoreResult>

  /** Flushes pending changes to disk. A no-op without file storage. */
  flush(): Promise<void>
}
