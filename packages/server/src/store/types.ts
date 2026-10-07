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

import type { FinishedGame, GameState, HighscoreResult, TurnPhase } from '@civ/engine'
import { TURN_PHASES } from '@civ/engine'

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

/** What a timeline row is: someone talking, a turn order, or a line from the system. */
export type ChatKind = 'chat' | 'order' | 'system'

export interface ChatMessage {
  readonly id: string
  readonly gameId: string | null
  readonly username: string
  readonly message: string
  readonly createdAt: string
  /** Chat orders (issue #215). Rows from before it existed read as `chat`. */
  readonly kind: ChatKind
  /** The turn an order or system row belongs to; `null` for plain chat. */
  readonly turnNumber: number | null
  readonly phase: TurnPhase | null
}

/**
 * A chat row as it may arrive from storage or from a caller that only knows
 * plain chat: the timeline fields can be missing. Plain chat needs none of them.
 */
export type StoredChatRow = Omit<ChatMessage, 'kind' | 'turnNumber' | 'phase'> & {
  readonly kind?: string | null | undefined
  readonly turnNumber?: number | null | undefined
  readonly phase?: string | null | undefined
}

/**
 * Reads a stored chat row that may predate chat orders (issue #215): a missing
 * or unknown `kind` is plain chat and a missing tag is `null`. Every repository
 * passes rows through this, so the routes only ever see the full shape.
 */
export function normalizeChatMessage(row: StoredChatRow): ChatMessage {
  const kind: ChatKind = row.kind === 'order' || row.kind === 'system' ? row.kind : 'chat'
  return {
    id: row.id,
    gameId: row.gameId,
    username: row.username,
    message: row.message,
    createdAt: row.createdAt,
    kind,
    turnNumber: row.turnNumber ?? null,
    phase: TURN_PHASES.find((phase) => phase === row.phase) ?? null,
  }
}

/**
 * One immutable full-state checkpoint. Raw snapshots never leave the repository
 * layer. Storage may keep a revision as a delta against the one before it
 * (issue #238); `findGameRevision` and the lists always give the full `state`.
 */
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

/**
 * A revision without its snapshot. The history bar needs the metadata of every
 * revision but never a single `state`, and loading those snapshots was enough
 * to tip a Worker over its resource limit (see `listGameRevisionSummaries`).
 */
export type GameRevisionMetadata = Omit<GameRevision, 'state'>

export interface SaveGameOptions {
  /** The change is a private note only, which no revision snapshot carries. */
  readonly notesOnly?: boolean
}

/**
 * What the admin cleanup of a finished game would remove (everything but the
 * newest revision), counted without loading any snapshot.
 */
export interface FinishedGameRevisionUsage {
  readonly gameId: string
  readonly name: string
  readonly revisions: number
  readonly removableRevisions: number
  /** The serialised size of the revisions that would go, in bytes. */
  readonly removableBytes: number
}

/**
 * `active`, `not-found` and `changed` remove nothing; a finished game with one
 * revision is `cleaned` with `removed: 0`. `changed` means the game or its
 * history moved while the cleanup rebuilt the newest revision (an admin acted on
 * a finished game, or another run got there first); nothing was written and
 * trying again is safe.
 */
export type FinishedGameCleanup =
  | { readonly status: 'cleaned'; readonly removed: number }
  | { readonly status: 'active' }
  | { readonly status: 'not-found' }
  | { readonly status: 'changed' }

/**
 * What compacting one game's revision history would do (issue #238, phase 2),
 * counted from the rows without loading a state.
 */
export interface RevisionCompactionUsage {
  readonly gameId: string
  readonly name: string
  readonly active: boolean
  readonly revisions: number
  /**
   * Rows still stored as a full state from before delta storage that a
   * compaction would look at. The newest revision is not one of them: it is never
   * touched, so that a game being played is not disturbed.
   */
  readonly fullRevisions: number
  /** An estimate, in bytes: each row that becomes a delta is counted at a typical delta size. */
  readonly freeableBytes: number
  /**
   * What the next request would at least have to parse: the first row to handle,
   * counted twice when the state before it must be rebuilt. The caller's byte
   * budget decides from it whether another game is worth entering.
   */
  readonly nextChunkBytes: number
}

/**
 * The result of one compaction request for one game. `mismatch` names the first
 * revision whose rebuilt state differed from the stored one: nothing of that
 * request was written. `remaining` is what is left for another request.
 */
export type RevisionCompaction =
  | {
      readonly status: 'compacted'
      readonly converted: number
      readonly keyframes: number
      readonly freedBytes: number
      /** The state text parsed for this request, for the caller's budget. */
      readonly handledBytes: number
      /** The rows looked at, for the caller's row budget. */
      readonly handledRows: number
      readonly remaining: number
    }
  | {
      readonly status: 'mismatch'
      readonly revision: number
      /** What was parsed before the check failed: a failing game still spent its share. */
      readonly handledBytes: number
      readonly handledRows: number
    }
  | { readonly status: 'not-found' }

export type BroadcastStatus = 'active' | 'done' | 'cancelled'

/**
 * `sending` is a claimed row: a run took it and has not reported back. It is
 * released to `pending` only by a run that stopped before sending it; one left
 * behind by a crash stays `sending` and is never resent by itself, because the
 * mail may have been delivered.
 */
export type BroadcastRecipientStatus = 'pending' | 'sending' | 'sent' | 'failed'

/** A queued admin broadcast (the daily job sends it `perRun` recipients at a time). */
export interface StoredBroadcast {
  readonly id: string
  readonly subject: string
  readonly markdown: string
  readonly includeUnsubscribed: boolean
  readonly perRun: number
  readonly status: BroadcastStatus
  readonly createdAt: string
  readonly lastRunAt: string | null
}

export interface StoredBroadcastRecipient {
  readonly broadcastId: string
  readonly playerId: string
  readonly email: string
  readonly status: BroadcastRecipientStatus
  readonly sentAt: string | null
  readonly error: string | null
}

export type BroadcastCounts = Readonly<Record<BroadcastRecipientStatus, number>>

/** Server-only change marker; never part of GameState or a client projection. */
export interface TurnReminderCandidate {
  readonly gameId: string
  readonly version: number
  readonly activityAt: number
}

export interface Repository {
  /** Releases only a definite rejected attempt, and never a newer state claim. */
  releaseTurnReminder(candidate: TurnReminderCandidate): Promise<void>
  /** Bounded, fair scan; legacy games begin their idle clock on first observation. */
  idleTurnCandidates(now: Date, waitMs: number, limit: number): Promise<readonly TurnReminderCandidate[]>
  /** Claims once per unchanged state, guarded against writes and changed account preferences. */
  claimTurnReminder(candidate: TurnReminderCandidate, playerId: string, expectedEmail: string, now: Date, waitMs: number): Promise<boolean>

  createPlayer(player: StoredPlayer): Promise<void>
  findPlayerById(id: string): Promise<StoredPlayer | undefined>
  findPlayerByUsername(username: string): Promise<StoredPlayer | undefined>
  allPlayers(): Promise<readonly StoredPlayer[]>
  /** Rewrites the stored hash, used to upgrade a legacy SHA-1 account on login. */
  updatePlayerPassword(id: string, passwordHash: string): Promise<void>
  updatePlayer(id: string, changes: PlayerUpdate): Promise<StoredPlayer | undefined>
  deletePlayer(id: string): Promise<boolean>

  /** Overwrites the live game. The next revision of the game is a keyframe. */
  saveGame(game: GameState): Promise<void>
  /**
   * Saves a non-revisioned change only while the live game is unchanged. Unless
   * `options.notesOnly` says the change touches nothing but private notes (which
   * revision snapshots blank), the next revision is stored as a keyframe: the
   * live game then differs from the newest revision in a way a delta against it
   * would not carry.
   */
  saveGameIfRevision(
    game: GameState,
    expectedRevision: number,
    options?: SaveGameOptions,
  ): Promise<boolean>
  /**
   * Saves the live game and matching checkpoint only when the stored game is
   * still at `expectedRevision`. `null` means that the game must not exist.
   *
   * `previous` is the snapshot of the newest stored revision, which the caller
   * already holds: the live game before the action, notes blanked
   * (`revisionSnapshot`). With it the checkpoint can be stored as a delta; without
   * it, or whenever a delta would not be safe, it is a keyframe. The store
   * checks the delta before writing (it must give the new state back) and the
   * chain at write time (the newest row and its keyframe are still the ones the
   * delta was made for), but it cannot check that `previous` really is what is
   * stored: that is the contract with the caller, kept by `saveGameIfRevision`
   * sealing the chain after any change that a revision would not record.
   */
  saveGameWithRevision(
    game: GameState,
    revision: GameRevision,
    expectedRevision: number | null,
    previous?: GameState,
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
  /**
   * Every finished game (`active = 0`) with how many revisions it holds and how
   * much the cleanup would free, largest first. `gameId` narrows it to one
   * game. Never loads a snapshot into memory: D1 sums `LENGTH(state)` in SQL.
   */
  finishedGameRevisionUsage(gameId?: string): Promise<readonly FinishedGameRevisionUsage[]>
  /**
   * Removes every revision of a finished game except the newest, which keeps the
   * history view and "Live" a snapshot to read. When the newest is a delta it is
   * first rewritten as a keyframe (it would not survive losing its chain), in the
   * same atomic step as the delete. Refuses a running or unknown game and
   * touches nothing but that game's `game_revision` rows. Safe to repeat: a
   * second call removes 0.
   */
  deleteOldGameRevisions(gameId: string): Promise<FinishedGameCleanup>
  /**
   * Every game with how many of its revisions are still full states from before
   * delta storage and roughly what turning them into deltas frees. `gameId`
   * narrows it to one game. Reads sizes only, never a state.
   */
  revisionCompactionUsage(gameId?: string): Promise<readonly RevisionCompactionUsage[]>
  /**
   * Converts up to `maxRevisions` of a game's oldest full-state revisions, and no
   * more than about `maxBytes` of state text (at least one row), into a delta
   * chain (keeping a keyframe every K rows). Each conversion is rebuilt
   * from the new representation and compared with the original before anything
   * is written; the first mismatch writes nothing and answers `mismatch`. The
   * newest revision and any row a delta hangs on are left alone, so a game that
   * is being played is safe. Repeating it changes nothing once it is done.
   */
  compactGameRevisions(
    gameId: string,
    maxRevisions: number,
    maxBytes?: number,
  ): Promise<RevisionCompaction>

  /** Plain chat may leave out `kind` and the tags; they are stored as `chat` and `null`. */
  appendChat(message: StoredChatRow): Promise<void>
  chatFor(gameId: string | null): Promise<readonly ChatMessage[]>

  /**
   * Notes that a member of the game has loaded it (issue #217). Callers pass
   * members only; spectators and admins must not re-arm someone else's mail.
   *
   * Changes the stored row only when that changes what `claimGameEmail` would
   * answer: the first visit, or the first visit since the last email. A tab that
   * keeps reloading the game leaves it untouched.
   */
  recordGameOpened(gameId: string, playerId: string, now: Date): Promise<void>

  /**
   * Atomically claims the right to email `playerId` about `gameId` (issue
   * #217). Returns true and records `now` as the last email when
   *
   * - no email has been recorded for this player and game, or
   * - the player has opened the game since the last email, or
   * - the player has never opened the game and the last email is more than
   *   `fallbackWaitMs` old (Java's 30 minute `shouldSendEmailInGame`).
   *
   * Otherwise returns false and records nothing. A last-email stamp in the
   * future suppresses.
   *
   * Must be atomic: two concurrent callers for the same player and game must
   * never both receive true, or a chat burst sends more than one mail.
   */
  claimGameEmail(
    gameId: string,
    playerId: string,
    fallbackWaitMs: number,
    now: Date,
  ): Promise<boolean>

  /**
   * Stores a queued broadcast and its recipients (all `pending`, in the order
   * given) in one step. Returns false and stores nothing when a broadcast is
   * already `active`: there is at most one at a time, and the check and the
   * insert must not be separable.
   */
  createBroadcast(
    broadcast: StoredBroadcast,
    recipients: readonly { readonly playerId: string; readonly email: string }[],
  ): Promise<boolean>
  /** The `active` broadcast, or failing that the most recently created one. */
  currentBroadcast(): Promise<StoredBroadcast | undefined>
  /**
   * Atomically takes up to `limit` `pending` recipients, oldest first, and sets
   * them `sending`. Two overlapping calls never return the same row, and a
   * broadcast that is not `active` yields none. A crash after this call leaves
   * the rows `sending`, never `pending`.
   */
  claimBroadcastRecipients(
    broadcastId: string,
    limit: number,
  ): Promise<readonly StoredBroadcastRecipient[]>
  /** Marks claimed (`sending`) recipients `sent`. Other rows are left alone. */
  markBroadcastRecipientsSent(
    broadcastId: string,
    playerIds: readonly string[],
    sentAt: string,
  ): Promise<void>
  /** Marks claimed (`sending`) recipients `failed`, each with its reason. */
  markBroadcastRecipientsFailed(
    broadcastId: string,
    failures: readonly { readonly playerId: string; readonly error: string }[],
  ): Promise<void>
  /** Puts claimed (`sending`) recipients back to `pending`: a run stopped before sending them. */
  releaseBroadcastRecipients(broadcastId: string, playerIds: readonly string[]): Promise<void>
  /**
   * Puts every `sending` recipient of an `active` broadcast back to `pending`
   * and returns how many. Only for the owner's decision about stuck rows, which
   * may have been delivered; a run releases its own rows by id instead.
   */
  releaseStuckBroadcastRecipients(broadcastId: string): Promise<number>
  /** Ends an `active` broadcast. Returns false when it was not active (already done or cancelled). */
  finishBroadcast(broadcastId: string, status: 'done' | 'cancelled'): Promise<boolean>
  recordBroadcastRun(broadcastId: string, at: string): Promise<void>
  broadcastCounts(broadcastId: string): Promise<BroadcastCounts>
  /** The recipients in one status, in the order they were queued. */
  listBroadcastRecipients(
    broadcastId: string,
    status: BroadcastRecipientStatus,
  ): Promise<readonly StoredBroadcastRecipient[]>

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
