/**
 * Storage against Cloudflare D1 (SQLite).
 *
 * The shape is hybrid: flat columns for the fields the app queries and indexes,
 * and a JSON payload for the rest of each document. `Repository` always reads
 * and writes a whole `GameState`, so the state itself is not normalised — see
 * `docs/agents/tasks/issue-72-d1.md`.
 *
 * D1 has no interactive transactions between `await`s. Everything that needs
 * compare-and-set semantics is therefore one guarded statement, or one
 * `batch()` — which D1 runs as a single atomic transaction.
 *
 * The types below are the subset of the Workers `D1Database` binding this file
 * uses, spelled out so `@civ/server` does not have to depend on
 * `@cloudflare/workers-types`. The real binding is structurally assignable; the
 * test suite satisfies them with a Node `node:sqlite` adapter.
 */

import type { FinishedGame, GameState } from '@civ/engine'
import { migrateGameState } from '@civ/engine'

import type {
  ChatMessage,
  GameRevision,
  GameRevisionMetadata,
  PlayerUpdate,
  Repository,
  StoredPlayer,
} from './types.js'

export interface D1Result<T = unknown> {
  readonly results: T[]
  readonly success: boolean
  readonly meta: { readonly changes: number }
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = unknown>(colName: string): Promise<T | null>
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>
}

interface PlayerRow {
  readonly id: string
  readonly username: string
  /** `username` folded with JavaScript's Unicode-aware `toLowerCase`. */
  readonly username_lower: string
  readonly email: string | null
  readonly password: string
  readonly created_at: string
  readonly role: string
  readonly disabled: number
  readonly disable_email: number
}

interface GameStateRow {
  readonly state: string
}

interface RevisionRow {
  readonly game_id: string
  readonly revision: number
  readonly created_at: string
  readonly actor_id: string
  readonly actor_username: string
  readonly public_description: string
  readonly private_descriptions: string
  readonly log_ids: string
  readonly state: string
}

/** `RevisionRow` without the `state` snapshot, for the summary query. */
type RevisionMetadataRow = Omit<RevisionRow, 'state'>

interface ChatRow {
  readonly id: string
  readonly game_id: string | null
  readonly username: string
  readonly message: string
  readonly created_at: string
}

interface FinishedPbfRow {
  readonly num_of_players: number
  readonly winner: string
  readonly players: string
}

interface FinishedGameRow {
  readonly num_of_players: number
  readonly winner: string
  readonly state: string
}

interface OkRow {
  readonly ok: number
}

const PLAYER_SELECT = `SELECT id, username, username_lower, email, password, created_at,
                              role, disabled, disable_email
                       FROM player`

export class D1Repository implements Repository {
  private readonly db: D1Database

  constructor(db: D1Database) {
    this.db = db
  }

  // ---------------------------------------------------------------------
  // Players
  // ---------------------------------------------------------------------

  async createPlayer(player: StoredPlayer): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO player (id, username, username_lower, email, password, created_at, role, disabled, disable_email)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        player.id,
        player.username,
        player.username.toLowerCase(),
        player.email,
        player.passwordHash,
        player.createdAt,
        player.role === 'admin' ? 'admin' : 'user',
        player.disabled === true ? 1 : 0,
        player.disableEmail === true ? 1 : 0,
      )
      .run()
  }

  async findPlayerById(id: string): Promise<StoredPlayer | undefined> {
    const row = await this.db
      .prepare(`${PLAYER_SELECT} WHERE id = ?`)
      .bind(id)
      .first<PlayerRow>()
    return row === null ? undefined : toStoredPlayer(row)
  }

  async findPlayerByUsername(username: string): Promise<StoredPlayer | undefined> {
    // Fold with JavaScript's `toLowerCase`, not SQLite's ASCII-only NOCASE, so
    // this matches the JSON repository for `Åse` / `åse` too. Old accounts may
    // collide on case; the first is returned, as the JSON scan does.
    const row = await this.db
      .prepare(`${PLAYER_SELECT} WHERE username_lower = ? LIMIT 1`)
      .bind(username.toLowerCase())
      .first<PlayerRow>()
    return row === null ? undefined : toStoredPlayer(row)
  }

  async allPlayers(): Promise<readonly StoredPlayer[]> {
    const rows = await this.db.prepare(`${PLAYER_SELECT} ORDER BY id`).all<PlayerRow>()
    return rows.results.map(toStoredPlayer)
  }

  async updatePlayerPassword(id: string, passwordHash: string): Promise<void> {
    await this.db
      .prepare(`UPDATE player SET password = ? WHERE id = ?`)
      .bind(passwordHash, id)
      .run()
  }

  async updatePlayer(id: string, changes: PlayerUpdate): Promise<StoredPlayer | undefined> {
    const sets: string[] = []
    const values: unknown[] = []
    if (changes.username !== undefined) {
      sets.push('username = ?')
      values.push(changes.username)
      sets.push('username_lower = ?')
      values.push(changes.username.toLowerCase())
    }
    if (changes.email !== undefined) {
      sets.push('email = ?')
      values.push(changes.email)
    }
    if (changes.role !== undefined) {
      sets.push('role = ?')
      values.push(changes.role)
    }
    if (changes.disabled !== undefined) {
      sets.push('disabled = ?')
      values.push(changes.disabled ? 1 : 0)
    }
    if (changes.disableEmail !== undefined) {
      sets.push('disable_email = ?')
      values.push(changes.disableEmail ? 1 : 0)
    }
    if (sets.length > 0) {
      await this.db
        .prepare(`UPDATE player SET ${sets.join(', ')} WHERE id = ?`)
        .bind(...values, id)
        .run()
    }
    return this.findPlayerById(id)
  }

  async deletePlayer(id: string): Promise<boolean> {
    const result = await this.db.prepare(`DELETE FROM player WHERE id = ?`).bind(id).run()
    return changes(result) > 0
  }

  // ---------------------------------------------------------------------
  // Games and revisions
  // ---------------------------------------------------------------------

  async saveGame(game: GameState): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO game (id, rev, active, winner, num_of_players, state)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           rev = excluded.rev,
           active = excluded.active,
           winner = excluded.winner,
           num_of_players = excluded.num_of_players,
           state = excluded.state`,
      )
      .bind(...gameParams(game))
      .run()
  }

  async saveGameIfRevision(game: GameState, expectedRevision: number): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE game SET rev = ?, active = ?, winner = ?, num_of_players = ?, state = ?
         WHERE id = ? AND rev = ?`,
      )
      .bind(...gameStateParams(game), game.id, expectedRevision)
      .run()
    return changes(result) > 0
  }

  async saveGameWithRevision(
    game: GameState,
    revision: GameRevision,
    expectedRevision: number | null,
  ): Promise<boolean> {
    const insertRevision = this.db
      .prepare(
        `INSERT INTO game_revision
           (game_id, revision, created_at, actor_id, actor_username,
            public_description, private_descriptions, log_ids, state)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM game WHERE id = ? AND rev = ?)`,
      )
      .bind(...revisionParams(revision), revision.gameId, revision.revision)

    try {
      if (expectedRevision === null) {
        // A plain INSERT (no OR IGNORE): a duplicate id aborts the batch and
        // rolls the revision insert back with it.
        const insertGame = this.db
          .prepare(
            `INSERT INTO game (id, rev, active, winner, num_of_players, state)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(...gameParams(game))
        await this.db.batch([insertGame, insertRevision])
        return true
      }

      const updateGame = this.db
        .prepare(
          `UPDATE game SET rev = ?, active = ?, winner = ?, num_of_players = ?, state = ?
           WHERE id = ? AND rev = ?`,
        )
        .bind(...gameStateParams(game), game.id, expectedRevision)
      const results = await this.db.batch([updateGame, insertRevision])
      // The revision insert is guarded by `game.rev = revision.revision`, so it
      // only ran if the update did; the update's own row count is the answer.
      const first = results[0]
      return first !== undefined && changes(first) > 0
    } catch (error) {
      if (isUniqueViolation(error)) return false
      throw error
    }
  }

  async ensureGameRevision(
    revision: GameRevision,
    expectedRevision: number,
  ): Promise<boolean> {
    // Best-effort baseline: insert one only while the live game is still at the
    // expected revision and it has no history yet. `OR IGNORE` makes a losing
    // race a no-op instead of an error; the read below then decides.
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO game_revision
           (game_id, revision, created_at, actor_id, actor_username,
            public_description, private_descriptions, log_ids, state)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM game WHERE id = ? AND rev = ?)
           AND NOT EXISTS (SELECT 1 FROM game_revision WHERE game_id = ?)`,
      )
      .bind(
        ...revisionParams(revision),
        revision.gameId,
        expectedRevision,
        revision.gameId,
      )
      .run()

    const row = await this.db
      .prepare(`SELECT 1 AS ok FROM game WHERE id = ? AND rev = ?`)
      .bind(revision.gameId, expectedRevision)
      .first<OkRow>()
    return row !== null
  }

  async listGameRevisions(gameId: string): Promise<readonly GameRevision[]> {
    const rows = await this.db
      .prepare(`${REVISION_SELECT} WHERE game_id = ? ORDER BY revision ASC`)
      .bind(gameId)
      .all<RevisionRow>()
    return rows.results.map(toGameRevision)
  }

  async listGameRevisionSummaries(gameId: string): Promise<readonly GameRevisionMetadata[]> {
    // Deliberately not `REVISION_SELECT`: the `state` column is the whole game
    // state of the revision, and selecting it made this route read and parse
    // every snapshot just to build the history list.
    const rows = await this.db
      .prepare(`${REVISION_METADATA_SELECT} WHERE game_id = ? ORDER BY revision ASC`)
      .bind(gameId)
      .all<RevisionMetadataRow>()
    return rows.results.map(toGameRevisionMetadata)
  }

  async findGameRevision(gameId: string, revision: number): Promise<GameRevision | undefined> {
    const row = await this.db
      .prepare(`${REVISION_SELECT} WHERE game_id = ? AND revision = ?`)
      .bind(gameId, revision)
      .first<RevisionRow>()
    return row === null ? undefined : toGameRevision(row)
  }

  async findGame(id: string): Promise<GameState | undefined> {
    const row = await this.db
      .prepare(`SELECT state FROM game WHERE id = ?`)
      .bind(id)
      .first<GameStateRow>()
    return row === null ? undefined : parseGame(row.state)
  }

  async allGames(): Promise<readonly GameState[]> {
    const rows = await this.db.prepare(`SELECT state FROM game`).all<GameStateRow>()
    return rows.results.map((row) => parseGame(row.state))
  }

  async deleteGame(id: string): Promise<boolean> {
    const results = await this.db.batch([
      this.db.prepare(`DELETE FROM game_revision WHERE game_id = ?`).bind(id),
      this.db.prepare(`DELETE FROM game WHERE id = ?`).bind(id),
    ])
    const game = results[1]
    return game !== undefined && changes(game) > 0
  }

  // ---------------------------------------------------------------------
  // Chat
  // ---------------------------------------------------------------------

  async appendChat(message: ChatMessage): Promise<void> {
    await this.db
      .prepare(`INSERT INTO chat (id, game_id, username, message, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(message.id, message.gameId, message.username, message.message, message.createdAt)
      .run()
  }

  async chatFor(gameId: string | null): Promise<readonly ChatMessage[]> {
    // `IS ?` handles the lobby's NULL. `rowid` is the insertion-order tiebreak,
    // matching the Mongo sort's stability for messages sharing a timestamp.
    const rows = await this.db
      .prepare(
        `SELECT id, game_id, username, message, created_at
         FROM chat WHERE game_id IS ? ORDER BY created_at ASC, rowid ASC`,
      )
      .bind(gameId)
      .all<ChatRow>()
    return rows.results.map((row) => ({
      id: row.id,
      gameId: row.game_id,
      username: row.username,
      message: row.message,
      createdAt: row.created_at,
    }))
  }

  // ---------------------------------------------------------------------
  // Notification throttles
  // ---------------------------------------------------------------------

  async claimEmailSlot(scope: string, waitMs: number, now: Date): Promise<boolean> {
    const at = now.toISOString()
    const cutoff = new Date(now.getTime() - waitMs).toISOString()
    // One statement, so only one of two concurrent callers can change the row.
    // A future stamp is not `< cutoff`, so it suppresses — matching Mongo's
    // `Math.abs` behaviour.
    const result = await this.db
      .prepare(
        `INSERT INTO email_sent (scope, at) VALUES (?, ?)
         ON CONFLICT(scope) DO UPDATE SET at = excluded.at
         WHERE email_sent.at < ?`,
      )
      .bind(scope, at, cutoff)
      .run()
    return changes(result) > 0
  }

  // ---------------------------------------------------------------------
  // Highscore
  // ---------------------------------------------------------------------

  async finishedGamesForHighscore(): Promise<readonly FinishedGame[]> {
    const [oldGames, newGames] = await Promise.all([
      this.db
        .prepare(
          `SELECT num_of_players, winner, players FROM pbf
           WHERE active = 0 AND winner IS NOT NULL AND winner <> ''`,
        )
        .all<FinishedPbfRow>(),
      this.db
        .prepare(
          `SELECT num_of_players, winner, state FROM game
           WHERE active = 0 AND winner IS NOT NULL AND winner <> ''`,
        )
        .all<FinishedGameRow>(),
    ])

    const summaries: FinishedGame[] = []
    for (const row of oldGames.results) {
      summaries.push({
        numOfPlayers: row.num_of_players,
        winner: row.winner,
        players: JSON.parse(row.players) as FinishedGame['players'],
      })
    }
    for (const row of newGames.results) {
      const game = parseGame(row.state)
      summaries.push({
        numOfPlayers: game.numOfPlayers,
        winner: row.winner,
        players: game.players.map((player) => ({
          username: player.username,
          civName: player.civilization?.name ?? null,
        })),
      })
    }
    return summaries
  }

  /** No-op: every write above goes straight to D1. */
  async flush(): Promise<void> {
    // Nothing to flush; there is no in-memory buffer to mirror.
  }
}

const REVISION_SELECT = `SELECT game_id, revision, created_at, actor_id, actor_username,
                                public_description, private_descriptions, log_ids, state
                         FROM game_revision`

/**
 * `REVISION_SELECT` minus `state`. Kept as its own statement so the summary
 * query can never accidentally pull the snapshots back in.
 */
const REVISION_METADATA_SELECT = `SELECT game_id, revision, created_at, actor_id, actor_username,
                                         public_description, private_descriptions, log_ids
                                  FROM game_revision`

function gameParams(game: GameState): readonly unknown[] {
  return [game.id, ...gameStateParams(game)]
}

/** The mutable columns, in the order the UPDATEs bind them (no id). */
function gameStateParams(game: GameState): readonly unknown[] {
  return [game.rev, game.active ? 1 : 0, game.winner, game.numOfPlayers, JSON.stringify(game)]
}

function revisionParams(revision: GameRevision): readonly unknown[] {
  return [
    revision.gameId,
    revision.revision,
    revision.createdAt,
    revision.actor.playerId,
    revision.actor.username,
    revision.publicDescription,
    JSON.stringify(revision.privateDescriptions),
    JSON.stringify(revision.logIds),
    JSON.stringify(revision.state),
  ]
}

function changes(result: D1Result<unknown>): number {
  return result.meta.changes
}

function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /UNIQUE constraint failed|constraint failed/i.test(message)
}

function parseGame(state: string): GameState {
  return migrateGameState(JSON.parse(state) as GameState)
}

function toStoredPlayer(row: PlayerRow): StoredPlayer {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    passwordHash: row.password,
    createdAt: row.created_at,
    role: row.role === 'admin' ? 'admin' : 'user',
    disabled: row.disabled !== 0,
    disableEmail: row.disable_email !== 0,
  }
}

function toGameRevision(row: RevisionRow): GameRevision {
  return {
    gameId: row.game_id,
    revision: row.revision,
    createdAt: row.created_at,
    actor: { playerId: row.actor_id, username: row.actor_username },
    publicDescription: row.public_description,
    privateDescriptions: JSON.parse(row.private_descriptions) as Record<string, string>,
    logIds: JSON.parse(row.log_ids) as string[],
    state: parseGame(row.state),
  }
}

function toGameRevisionMetadata(row: RevisionMetadataRow): GameRevisionMetadata {
  return {
    gameId: row.game_id,
    revision: row.revision,
    createdAt: row.created_at,
    actor: { playerId: row.actor_id, username: row.actor_username },
    publicDescription: row.public_description,
    privateDescriptions: JSON.parse(row.private_descriptions) as Record<string, string>,
    logIds: JSON.parse(row.log_ids) as string[],
  }
}
