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

import type { FinishedGame, GameState, HighscoreResult, RatedGame } from '@civ/engine'
import { migrateGameState } from '@civ/engine'

import type { RevisionCodec } from '../revision-delta.js'
import { defaultRevisionCodec, sameJson } from '../revision-delta.js'
import { ratedHighscore, resultFromGame } from './rating.js'
import type { ChainRow, RevisionEncoding, RevisionTail } from './revision-chain.js'
import type { CompactionRow } from './revision-chain.js'
import {
  compactChunk,
  encodeRevision,
  firstBrokenRevision,
  netRemovableBytes,
  planCompaction,
  rebuildState,
  summarizeCompaction,
  utf8Length,
} from './revision-chain.js'
import { normalizeChatMessage } from './types.js'
import type {
  BroadcastCounts,
  BroadcastRecipientStatus,
  BroadcastStatus,
  ChatMessage,
  FinishedGameCleanup,
  FinishedGameRevisionUsage,
  GameRevision,
  GameRevisionMetadata,
  PlayerUpdate,
  Repository,
  RevisionCompaction,
  RevisionCompactionUsage,
  SaveGameOptions,
  TurnReminderCandidate,
  StoredBroadcast,
  StoredBroadcastRecipient,
  StoredChatRow,
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
  /** `full` or `delta` (issue #238). */
  readonly kind: string
  /** The keyframe the row's chain starts from; `NULL` on rows from before delta storage. */
  readonly base_revision: number | null
  /** The full state for a keyframe, the delta JSON for a delta. */
  readonly state: string
}

/** `RevisionRow` without the `state` snapshot, for the summary query. */
type RevisionMetadataRow = Omit<RevisionRow, 'state' | 'kind' | 'base_revision'>

/** The newest revision of a game as a write needs it: no `state`. */
interface RevisionTailRow {
  readonly revision: number
  readonly base_revision: number
  readonly sealed: number
  readonly chain_rows: number
  /** The size of the chain's keyframe, to judge a delta against. */
  readonly base_bytes: number | null
}

interface ChatRow {
  readonly id: string
  readonly game_id: string | null
  readonly username: string
  readonly message: string
  readonly created_at: string
  readonly kind: string
  readonly turn_number: number | null
  readonly phase: string | null
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

interface CompactionRowRecord {
  readonly game_id: string
  readonly revision: number
  readonly kind: string
  readonly base_revision: number | null
  readonly bytes: number
}

interface RevisionUsageRow {
  readonly id: string
  readonly name: string | null
  readonly revisions: number
  readonly removable_revisions: number
  readonly removable_bytes: number
  readonly newest_kind: string | null
  readonly newest_bytes: number | null
  readonly keyframe_bytes: number | null
}

interface BroadcastRow {
  readonly id: string
  readonly subject: string
  readonly markdown: string
  readonly include_unsubscribed: number
  readonly per_run: number
  readonly status: string
  readonly created_at: string
  readonly last_run_at: string | null
}

interface BroadcastRecipientRow {
  readonly broadcast_id: string
  readonly player_id: string
  readonly email: string
  readonly status: string
  readonly sent_at: string | null
  readonly error: string | null
  /** Only present on a claim's `RETURNING`, to restore the queued order. */
  readonly seq?: number
}

/**
 * Recipients per insert statement. A recipient list travels as one JSON
 * parameter (`json_each`), which keeps a queue of hundreds to a few statements
 * instead of one per row; the chunk keeps each parameter well under D1's size
 * limits.
 */
const BROADCAST_INSERT_CHUNK = 500

const BROADCAST_SELECT = `SELECT id, subject, markdown, include_unsubscribed, per_run, status,
                                 created_at, last_run_at
                          FROM broadcast`

const RECIPIENT_SELECT = `SELECT broadcast_id, player_id, email, status, sent_at, error
                          FROM broadcast_recipient`

interface OkRow {
  readonly ok: number
}

const PLAYER_SELECT = `SELECT id, username, username_lower, email, password, created_at,
                              role, disabled, disable_email
                       FROM player`

export interface D1RepositoryOptions {
  /** How revisions are diffed and rebuilt. A seam for tests; the default is the real codec. */
  readonly codec?: RevisionCodec
}

export class D1Repository implements Repository {
  private readonly db: D1Database
  private readonly codec: RevisionCodec

  constructor(db: D1Database, options: D1RepositoryOptions = {}) {
    this.db = db
    this.codec = options.codec ?? defaultRevisionCodec
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

  async releaseTurnReminder(candidate: TurnReminderCandidate): Promise<void> {
    await this.db.prepare(`UPDATE game SET reminder_version = NULL
      WHERE id = ? AND activity_version = ? AND activity_at_ms = ? AND reminder_version = ?`)
      .bind(candidate.gameId, candidate.version, candidate.activityAt, candidate.version).run()
  }

  async idleTurnCandidates(now: Date, waitMs: number, limit: number): Promise<readonly TurnReminderCandidate[]> {
    const started = `EXISTS (SELECT 1 FROM json_each(game.state, '$.players') p
      WHERE json_extract(p.value, '$.yourTurn') = 1)
      OR EXISTS (SELECT 1 FROM json_each(game.state, '$.withdrawnPlayers') p
      WHERE json_extract(p.value, '$.yourTurn') = 1)`
    await this.db.prepare(`UPDATE game SET activity_at_ms = ? WHERE id IN
      (SELECT id FROM game WHERE active = 1 AND activity_at_ms IS NULL AND (${started}) LIMIT 100)`)
      .bind(now.getTime()).run()
    const rows = await this.db.prepare(`UPDATE game SET reminder_checked_at_ms = ? WHERE id IN
      (SELECT id FROM game WHERE active = 1 AND activity_at_ms < ?
       AND (reminder_version IS NULL OR reminder_version <> activity_version)
       AND (${started}) ORDER BY reminder_checked_at_ms ASC, id ASC LIMIT ?)
      RETURNING id, activity_version, activity_at_ms`)
      .bind(now.getTime(), now.getTime() - waitMs, limit).all<{
        id: string; activity_version: number; activity_at_ms: number
      }>()
    return rows.results.map((row) => ({ gameId: row.id, version: row.activity_version, activityAt: row.activity_at_ms }))
  }

  async claimTurnReminder(candidate: TurnReminderCandidate, playerId: string, expectedEmail: string, now: Date, waitMs: number): Promise<boolean> {
    const result = await this.db.prepare(`UPDATE game SET reminder_version = activity_version
      WHERE id = ? AND active = 1 AND activity_version = ? AND activity_at_ms = ?
      AND activity_at_ms < ? AND (reminder_version IS NULL OR reminder_version <> activity_version)
      AND EXISTS (SELECT 1 FROM player WHERE id = ? AND disabled = 0 AND disable_email = 0
        AND email = ? AND TRIM(email) <> '')`)
      .bind(candidate.gameId, candidate.version, candidate.activityAt, now.getTime() - waitMs, playerId, expectedEmail).run()
    return changes(result) > 0
  }

  async saveGame(game: GameState): Promise<void> {
    // The game is replaced wholesale, so the newest revision no longer describes
    // it: seal it, and the next revision starts a new chain.
    await this.db.batch([
      this.db
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
        .bind(...gameParams(game)),
      this.db.prepare(SEAL_NEWEST).bind(game.id, game.id),
    ])
  }

  async saveGameIfRevision(
    game: GameState,
    expectedRevision: number,
    options: SaveGameOptions = {},
  ): Promise<boolean> {
    const update = this.db
      .prepare(
        `UPDATE game SET rev = ?, active = ?, winner = ?, num_of_players = ?, state = ?
         WHERE id = ? AND rev = ?`,
      )
      .bind(...gameStateParams(game), game.id, expectedRevision)
    if (options.notesOnly === true) return changes(await update.run()) > 0

    // Anything but a private note leaves the live game different from the newest
    // revision in a way the next delta would not carry. Seal that revision in the
    // same transaction; the guard makes it a no-op when the update did not apply.
    const results = await this.db.batch([
      update,
      this.db
        .prepare(
          `${SEAL_NEWEST} AND EXISTS (SELECT 1 FROM game WHERE id = ? AND rev = ?)`,
        )
        .bind(game.id, game.id, game.id, game.rev),
    ])
    const first = results[0]
    return first !== undefined && changes(first) > 0
  }

  async saveGameWithRevision(
    game: GameState,
    revision: GameRevision,
    expectedRevision: number | null,
    previous?: GameState,
  ): Promise<boolean> {
    const { encoding, tail } = await this.encodeRevision(revision, expectedRevision, previous)
    const insertRevision = this.db
      .prepare(
        `INSERT INTO game_revision
           (game_id, revision, created_at, actor_id, actor_username,
            public_description, private_descriptions, log_ids, state, kind, base_revision)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM game WHERE id = ? AND rev = ?)`,
      )
      .bind(...revisionParams(revision, encoding), revision.gameId, revision.revision)

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

      // A delta is only as good as the chain it was computed against. The same
      // statement that wins the compare-and-set also checks that the keyframe it
      // hangs on is still a keyframe and the revision before it still the newest
      // (a cleanup or a compaction may have run since the tail was read); if not,
      // nothing is written and the caller sees a conflict, like any lost race.
      const chainGuard =
        encoding.kind === 'delta' && tail !== undefined
          ? ` AND EXISTS (SELECT 1 FROM game_revision WHERE game_id = ? AND revision = ? AND kind = 'full')
              AND (SELECT MAX(revision) FROM game_revision WHERE game_id = ?) = ?`
          : ''
      const updateGame = this.db
        .prepare(
          `UPDATE game SET rev = ?, active = ?, winner = ?, num_of_players = ?, state = ?
           WHERE id = ? AND rev = ?${chainGuard}`,
        )
        .bind(
          ...gameStateParams(game),
          game.id,
          expectedRevision,
          ...(chainGuard === '' || tail === undefined
            ? []
            : [game.id, tail.baseRevision, game.id, tail.revision]),
        )
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

  /**
   * Chooses the stored form of a new revision. Reads only the newest row's
   * metadata, never a state: the previous state comes from the caller.
   */
  private async encodeRevision(
    revision: GameRevision,
    expectedRevision: number | null,
    previous: GameState | undefined,
  ): Promise<{ encoding: RevisionEncoding; tail: RevisionTail | undefined }> {
    const keyframe: RevisionEncoding = { kind: 'full', baseRevision: revision.revision }
    if (expectedRevision === null || previous === undefined) return { encoding: keyframe, tail: undefined }
    const row = await this.db
      .prepare(
        `SELECT p.revision AS revision,
                COALESCE(p.base_revision, p.revision) AS base_revision,
                p.sealed AS sealed,
                (SELECT COUNT(*) FROM game_revision c
                  WHERE c.game_id = p.game_id AND c.revision >= COALESCE(p.base_revision, p.revision)) AS chain_rows,
                (SELECT LENGTH(CAST(k.state AS BLOB)) FROM game_revision k
                  WHERE k.game_id = p.game_id AND k.revision = COALESCE(p.base_revision, p.revision)) AS base_bytes
         FROM game_revision p
         WHERE p.game_id = ?
         ORDER BY p.revision DESC
         LIMIT 1`,
      )
      .bind(revision.gameId)
      .first<RevisionTailRow>()
    if (row === null) return { encoding: keyframe, tail: undefined }
    const tail: RevisionTail = {
      revision: row.revision,
      baseRevision: row.base_revision,
      sealed: row.sealed !== 0,
      chainRows: row.chain_rows,
    }
    const encoding = encodeRevision({
      revision: revision.revision,
      state: revision.state,
      previous,
      tail,
      codec: this.codec,
      fullBytes: () => row.base_bytes ?? undefined,
    })
    return { encoding, tail }
  }

  async ensureGameRevision(
    revision: GameRevision,
    expectedRevision: number,
  ): Promise<boolean> {
    // Best-effort baseline: insert one only while the live game is still at the
    // expected revision and it has no history yet. `OR IGNORE` makes a losing
    // race a no-op instead of an error; the read below then decides. The
    // baseline is always a keyframe.
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO game_revision
           (game_id, revision, created_at, actor_id, actor_username,
            public_description, private_descriptions, log_ids, state, kind, base_revision)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM game WHERE id = ? AND rev = ?)
           AND NOT EXISTS (SELECT 1 FROM game_revision WHERE game_id = ?)`,
      )
      .bind(
        ...revisionParams(revision, { kind: 'full', baseRevision: revision.revision }),
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
    // Oldest first, each state rebuilt from the one before it.
    const revisions: GameRevision[] = []
    let keyframe: number | undefined
    let current: GameState | undefined
    for (const row of rows.results) {
      if (row.kind !== 'delta') {
        keyframe = row.revision
        current = parseGame(row.state)
      } else {
        if (current === undefined || row.base_revision !== keyframe) {
          throw new Error(`Revision ${row.revision} of game ${gameId} has no keyframe`)
        }
        const applied = this.codec.apply(current, JSON.parse(row.state) as unknown)
        if (!applied.ok) throw new Error(`Revision ${row.revision} of game ${gameId}: ${applied.reason}`)
        current = applied.value as GameState
      }
      revisions.push(toGameRevision(row, current))
    }
    return revisions
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
    const state = await this.readRevisionChain(gameId, revision)
    return state === undefined ? undefined : toGameRevision(state.row, state.state)
  }

  /**
   * Rebuilds one revision: a single query for the keyframe at or below it and
   * every row between (a chain is at most K rows long), then the deltas in order.
   */
  private async readRevisionChain(
    gameId: string,
    revision: number,
  ): Promise<{ row: RevisionRow; state: GameState } | undefined> {
    const rows = await this.db
      .prepare(
        `${REVISION_SELECT}
         WHERE game_id = ? AND revision <= ?
           AND revision >= COALESCE(
             (SELECT MAX(revision) FROM game_revision WHERE game_id = ? AND revision <= ? AND kind = 'full'), ?)
         ORDER BY revision ASC`,
      )
      // With no keyframe at all, start at the revision itself: one delta row, which
      // the rebuild refuses, instead of every row from the start of the game.
      .bind(gameId, revision, gameId, revision, revision)
      .all<RevisionRow>()
    const last = rows.results.at(-1)
    if (last === undefined || last.revision !== revision) return undefined
    const rebuilt = rebuildState(rows.results.map(toChainRow), this.codec)
    if (!rebuilt.ok) throw new Error(`Revision ${revision} of game ${gameId}: ${rebuilt.reason}`)
    return { row: last, state: rebuilt.state }
  }

  async findGame(id: string): Promise<GameState | undefined> {
    const row = await this.db
      .prepare(`SELECT state FROM game WHERE id = ?`)
      .bind(id)
      .first<GameStateRow>()
    return row === null ? undefined : parseGame(row.state)
  }

  async findGameRevisionCounter(id: string): Promise<number | undefined> {
    const row = await this.db.prepare(`SELECT rev FROM game WHERE id = ?`).bind(id).first<{ rev: number }>()
    return row?.rev
  }

  async allGames(): Promise<readonly GameState[]> {
    const rows = await this.db.prepare(`SELECT state FROM game`).all<GameStateRow>()
    return rows.results.map((row) => parseGame(row.state))
  }

  async deleteGame(id: string): Promise<boolean> {
    const results = await this.db.batch([
      this.db.prepare(`DELETE FROM game_revision WHERE game_id = ?`).bind(id),
      this.db.prepare(`DELETE FROM game_mail WHERE game_id = ?`).bind(id),
      this.db.prepare(`DELETE FROM game WHERE id = ?`).bind(id),
    ])
    const game = results[2]
    return game !== undefined && changes(game) > 0
  }

  async finishedGameRevisionUsage(
    gameId?: string,
  ): Promise<readonly FinishedGameRevisionUsage[]> {
    // The sizes are summed inside SQLite: no snapshot reaches the Worker. The
    // CAST makes LENGTH count bytes, not characters. The name is read out of the
    // live game's JSON for the same reason. When the newest revision is a delta
    // the cleanup has to write it back as a keyframe, which costs about as much
    // as the chain's keyframe; the three newest_* columns let the dry run say so.
    const rows = await this.db
      .prepare(
        `SELECT g.id AS id,
                json_extract(g.state, '$.name') AS name,
                COUNT(r.revision) AS revisions,
                COALESCE(SUM(CASE WHEN r.revision < m.newest THEN 1 ELSE 0 END), 0) AS removable_revisions,
                COALESCE(SUM(CASE WHEN r.revision < m.newest THEN LENGTH(CAST(r.state AS BLOB)) ELSE 0 END), 0)
                  AS removable_bytes,
                (SELECT kind FROM game_revision n WHERE n.game_id = g.id AND n.revision = m.newest) AS newest_kind,
                (SELECT LENGTH(CAST(n.state AS BLOB)) FROM game_revision n
                  WHERE n.game_id = g.id AND n.revision = m.newest) AS newest_bytes,
                (SELECT LENGTH(CAST(k.state AS BLOB)) FROM game_revision n
                  JOIN game_revision k ON k.game_id = n.game_id AND k.revision = COALESCE(n.base_revision, n.revision)
                  WHERE n.game_id = g.id AND n.revision = m.newest) AS keyframe_bytes
         FROM game g
         LEFT JOIN (SELECT game_id, MAX(revision) AS newest FROM game_revision GROUP BY game_id) m
           ON m.game_id = g.id
         LEFT JOIN game_revision r ON r.game_id = g.id
         WHERE g.active = 0 AND (? IS NULL OR g.id = ?)
         GROUP BY g.id, m.newest
         ORDER BY removable_bytes DESC, g.id ASC`,
      )
      .bind(gameId ?? null, gameId ?? null)
      .all<RevisionUsageRow>()
    return rows.results.map((row) => ({
      gameId: row.id,
      name: row.name ?? '',
      revisions: row.revisions,
      removableRevisions: row.removable_revisions,
      removableBytes: netRemovableBytes(
        row.removable_bytes,
        row.newest_kind === 'delta' ? (row.keyframe_bytes ?? 0) - (row.newest_bytes ?? 0) : 0,
      ),
    }))
  }

  async deleteOldGameRevisions(gameId: string): Promise<FinishedGameCleanup> {
    const state = await this.db
      .prepare(
        `SELECT g.active AS active, g.rev AS rev,
                (SELECT MAX(revision) FROM game_revision WHERE game_id = g.id) AS newest,
                (SELECT kind FROM game_revision n WHERE n.game_id = g.id
                  AND n.revision = (SELECT MAX(revision) FROM game_revision WHERE game_id = g.id)) AS newest_kind
         FROM game g WHERE g.id = ?`,
      )
      .bind(gameId)
      .first<{ active: number; rev: number; newest: number | null; newest_kind: string | null }>()
    if (state === null) return { status: 'not-found' }
    if (state.active !== 0) return { status: 'active' }
    if (state.newest === null) return { status: 'cleaned', removed: 0 }

    if (state.newest_kind !== 'delta') {
      // The newest revision is a keyframe: everything below it goes. The bound is
      // the revision read above, not "the current newest", so a revision written
      // meanwhile (an admin can still act on a finished game) keeps the keyframe
      // it hangs on. One statement, so the finished check and the delete cannot
      // be separated.
      const result = await this.db
        .prepare(
          `DELETE FROM game_revision
           WHERE game_id = ? AND revision < ?
             AND EXISTS (SELECT 1 FROM game WHERE id = ? AND active = 0)`,
        )
        .bind(gameId, state.newest, gameId)
        .run()
      return { status: 'cleaned', removed: changes(result) }
    }

    // The newest revision is a delta: deleting the rows below it would destroy
    // the chain it is built from. Rebuild it, write it back as a keyframe and
    // delete the rest in one batch. Both statements are guarded by the live
    // game still being finished and unchanged, and the delete by the newest row
    // being a keyframe, so a half done cleanup is not possible.
    const rebuilt = await this.readRevisionChain(gameId, state.newest)
    if (rebuilt === undefined) return { status: 'changed' }
    const keyframe = JSON.stringify(rebuilt.state)
    // What is about to be stored must read back as the state that was rebuilt.
    if (!sameJson(JSON.parse(keyframe) as unknown, rebuilt.state, true)) return { status: 'changed' }
    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE game_revision SET state = ?, kind = 'full', base_revision = revision
           WHERE game_id = ? AND revision = ? AND kind = 'delta'
             AND EXISTS (SELECT 1 FROM game WHERE id = ? AND active = 0 AND rev = ?)`,
        )
        .bind(keyframe, gameId, state.newest, gameId, state.rev),
      this.db
        .prepare(
          `DELETE FROM game_revision
           WHERE game_id = ? AND revision < ?
             AND EXISTS (SELECT 1 FROM game_revision WHERE game_id = ? AND revision = ? AND kind = 'full')
             AND EXISTS (SELECT 1 FROM game WHERE id = ? AND active = 0)`,
        )
        .bind(gameId, state.newest, gameId, state.newest, gameId),
    ])
    const [converted, deleted] = results
    if (converted === undefined || deleted === undefined) return { status: 'changed' }
    // The delete only runs once the newest row is a keyframe. If the rewrite did
    // not apply (another cleanup already did it) but the delete did, the game is
    // cleaned; if neither did, the game moved and nothing was written.
    if (changes(converted) === 0 && changes(deleted) === 0) return { status: 'changed' }
    return { status: 'cleaned', removed: changes(deleted) }
  }

  async revisionCompactionUsage(gameId?: string): Promise<readonly RevisionCompactionUsage[]> {
    // Sizes and kinds only: LENGTH(CAST(.. AS BLOB)) counts bytes without the
    // Worker ever seeing a state. The name comes out of the live row's JSON.
    const games = await this.db
      .prepare(
        `SELECT id, json_extract(state, '$.name') AS name, active
         FROM game WHERE (? IS NULL OR id = ?) ORDER BY id`,
      )
      .bind(gameId ?? null, gameId ?? null)
      .all<{ id: string; name: string | null; active: number }>()
    const rows = await this.db
      .prepare(
        `SELECT game_id, revision, kind, base_revision, LENGTH(CAST(state AS BLOB)) AS bytes
         FROM game_revision WHERE (? IS NULL OR game_id = ?) ORDER BY game_id, revision`,
      )
      .bind(gameId ?? null, gameId ?? null)
      .all<CompactionRowRecord>()
    const byGame = new Map<string, CompactionRow[]>()
    for (const row of rows.results) {
      const list = byGame.get(row.game_id) ?? []
      list.push(toCompactionRow(row))
      byGame.set(row.game_id, list)
    }
    return games.results.map((game) => {
      const gameRows = byGame.get(game.id) ?? []
      return {
        gameId: game.id,
        name: game.name ?? '',
        active: game.active !== 0,
        revisions: gameRows.length,
        ...summarizeCompaction(gameRows),
      }
    })
  }

  async compactGameRevisions(
    gameId: string,
    maxRevisions: number,
    maxBytes = Number.POSITIVE_INFINITY,
  ): Promise<RevisionCompaction> {
    const game = await this.db.prepare(`SELECT 1 AS ok FROM game WHERE id = ?`).bind(gameId).first<OkRow>()
    if (game === null) return { status: 'not-found' }

    const rows = await this.compactionRows(gameId)
    const plan = planCompaction(rows, maxRevisions, maxBytes)
    const first = plan.todo[0]
    const last = plan.todo.at(-1)
    if (first === undefined || last === undefined) {
      return {
        status: 'compacted',
        converted: 0,
        keyframes: 0,
        freedBytes: 0,
        handledBytes: 0,
        handledRows: 0,
        remaining: plan.remaining,
      }
    }

    // The state of the row before the first one to convert, rebuilt from its own
    // chain (it may be a delta from an earlier request), then the legacy rows.
    let previousState: GameState | undefined
    if (plan.previous !== undefined) {
      try {
        previousState = (await this.readRevisionChain(gameId, plan.previous))?.state
      } catch {
        previousState = undefined
      }
      if (previousState === undefined) {
        return { status: 'mismatch', revision: plan.previous, handledBytes: plan.bytes, handledRows: plan.todo.length }
      }
    }
    const legacy = await this.db
      .prepare(
        `SELECT revision, state FROM game_revision
         WHERE game_id = ? AND revision >= ? AND revision <= ? AND kind = 'full' AND base_revision IS NULL
         ORDER BY revision`,
      )
      .bind(gameId, first, last)
      .all<{ revision: number; state: string }>()
    if (legacy.results.map((row) => row.revision).join() !== plan.todo.join()) {
      // Another run (or a cleanup) changed these rows since they were listed: do nothing now.
      return {
        status: 'compacted',
        converted: 0,
        keyframes: 0,
        freedBytes: 0,
        // The rows were read even though nothing was converted.
        handledBytes: plan.bytes,
        handledRows: plan.todo.length,
        remaining: plan.remaining + plan.todo.length,
      }
    }
    const outcome = compactChunk({
      plan,
      previousState,
      states: legacy.results.map((row) => ({
        revision: row.revision,
        state: parseGame(row.state),
        bytes: utf8Length(row.state),
      })),
      codec: this.codec,
    })
    if (!outcome.ok) {
      return { status: 'mismatch', revision: outcome.revision, handledBytes: plan.bytes, handledRows: plan.todo.length }
    }

    // One batch, so the chunk is written or not at all. A repeated or overlapping
    // run finds the rows already converted and its guards change nothing.
    const results = await this.db.batch(
      outcome.steps.map((step) =>
        step.kind === 'delta'
          ? this.db
              .prepare(
                `UPDATE game_revision SET state = ?, kind = 'delta', base_revision = ?
                 WHERE game_id = ? AND revision = ? AND kind = 'full' AND base_revision IS NULL
                   AND revision < (SELECT MAX(revision) FROM game_revision WHERE game_id = ?)
                   AND NOT EXISTS (SELECT 1 FROM game_revision WHERE game_id = ? AND base_revision = ?)`,
              )
              .bind(step.json, step.baseRevision, gameId, step.revision, gameId, gameId, step.revision)
          : this.db
              .prepare(
                `UPDATE game_revision SET base_revision = revision
                 WHERE game_id = ? AND revision = ? AND kind = 'full' AND base_revision IS NULL`,
              )
              .bind(gameId, step.revision),
      ),
    )
    let converted = 0
    let keyframes = 0
    let freedBytes = 0
    let unapplied = 0
    outcome.steps.forEach((step, index) => {
      const result = results[index]
      if (result === undefined || changes(result) === 0) {
        unapplied += 1
      } else if (step.kind === 'delta') {
        converted += 1
        freedBytes += step.savedBytes
      } else {
        keyframes += 1
      }
    })
    if (unapplied > 0) {
      // Rows changed under us. Nothing is wrong unless the chain itself is now broken.
      const broken = firstBrokenRevision(await this.compactionRows(gameId))
      if (broken !== undefined) {
        return { status: 'mismatch', revision: broken, handledBytes: plan.bytes, handledRows: plan.todo.length }
      }
    }
    return {
      status: 'compacted',
      converted,
      keyframes,
      freedBytes,
      handledBytes: plan.bytes,
      handledRows: plan.todo.length,
      remaining: plan.remaining + unapplied,
    }
  }

  private async compactionRows(gameId: string): Promise<CompactionRow[]> {
    const rows = await this.db
      .prepare(
        `SELECT game_id, revision, kind, base_revision, LENGTH(CAST(state AS BLOB)) AS bytes
         FROM game_revision WHERE game_id = ? ORDER BY revision`,
      )
      .bind(gameId)
      .all<CompactionRowRecord>()
    return rows.results.map(toCompactionRow)
  }

  // ---------------------------------------------------------------------
  // Chat
  // ---------------------------------------------------------------------

  async appendChat(row: StoredChatRow): Promise<void> {
    const message = normalizeChatMessage(row)
    await this.db
      .prepare(
        `INSERT INTO chat (id, game_id, username, message, created_at, kind, turn_number, phase)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        message.id,
        message.gameId,
        message.username,
        message.message,
        message.createdAt,
        message.kind,
        message.turnNumber,
        message.phase,
      )
      .run()
  }

  async chatFor(gameId: string | null): Promise<readonly ChatMessage[]> {
    // `IS ?` handles the lobby's NULL. `rowid` is the insertion-order tiebreak,
    // matching the Mongo sort's stability for messages sharing a timestamp.
    const rows = await this.db
      .prepare(
        `SELECT id, game_id, username, message, created_at, kind, turn_number, phase
         FROM chat WHERE game_id IS ? ORDER BY created_at ASC, rowid ASC`,
      )
      .bind(gameId)
      .all<ChatRow>()
    return rows.results.map((row) => normalizeChatMessage({
      id: row.id,
      gameId: row.game_id,
      username: row.username,
      message: row.message,
      createdAt: row.created_at,
      kind: row.kind,
      turnNumber: row.turn_number,
      phase: row.phase,
    }))
  }

  // ---------------------------------------------------------------------
  // Game email hold
  // ---------------------------------------------------------------------

  async recordGameOpened(gameId: string, playerId: string, now: Date): Promise<void> {
    // The WHERE keeps repeated loads from changing the row: only the first
    // visit, or the first since the last email, does. The statement itself
    // still runs on every load.
    await this.db
      .prepare(
        `INSERT INTO game_mail (game_id, player_id, opened_at) VALUES (?, ?, ?)
         ON CONFLICT(game_id, player_id) DO UPDATE SET opened_at = excluded.opened_at
         WHERE game_mail.opened_at IS NULL
            OR (game_mail.emailed_at IS NOT NULL AND game_mail.opened_at <= game_mail.emailed_at)`,
      )
      .bind(gameId, playerId, now.toISOString())
      .run()
  }

  async claimGameEmail(
    gameId: string,
    playerId: string,
    fallbackWaitMs: number,
    now: Date,
  ): Promise<boolean> {
    const at = now.toISOString()
    const cutoff = new Date(now.getTime() - fallbackWaitMs).toISOString()
    // One statement, so only one of two concurrent callers can change the row.
    // A future stamp is not `< cutoff`, so it suppresses (Java's `Math.abs`
    // did too, within the wait).
    const result = await this.db
      .prepare(
        `INSERT INTO game_mail (game_id, player_id, emailed_at) VALUES (?, ?, ?)
         ON CONFLICT(game_id, player_id) DO UPDATE SET emailed_at = excluded.emailed_at
         WHERE game_mail.emailed_at IS NULL
            OR game_mail.opened_at > game_mail.emailed_at
            OR (game_mail.opened_at IS NULL AND game_mail.emailed_at < ?)`,
      )
      .bind(gameId, playerId, at, cutoff)
      .run()
    return changes(result) > 0
  }

  // ---------------------------------------------------------------------
  // Admin broadcast queue
  // ---------------------------------------------------------------------

  async createBroadcast(
    broadcast: StoredBroadcast,
    recipients: readonly { readonly playerId: string; readonly email: string }[],
  ): Promise<boolean> {
    const statements = [
      this.db
        .prepare(
          `INSERT INTO broadcast
             (id, subject, markdown, include_unsubscribed, per_run, status, created_at, last_run_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          broadcast.id,
          broadcast.subject,
          broadcast.markdown,
          broadcast.includeUnsubscribed ? 1 : 0,
          broadcast.perRun,
          broadcast.status,
          broadcast.createdAt,
          broadcast.lastRunAt,
        ),
    ]
    for (let at = 0; at < recipients.length; at += BROADCAST_INSERT_CHUNK) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO broadcast_recipient (broadcast_id, player_id, email, status)
             SELECT ?, json_extract(value, '$.playerId'), json_extract(value, '$.email'), 'pending'
             FROM json_each(?)`,
          )
          .bind(broadcast.id, JSON.stringify(recipients.slice(at, at + BROADCAST_INSERT_CHUNK))),
      )
    }
    try {
      // One batch, so a refused queue leaves no recipients behind. The partial
      // unique index on `status = 'active'` is what refuses a second queue.
      await this.db.batch(statements)
      return true
    } catch (error) {
      if (isUniqueViolation(error)) return false
      throw error
    }
  }

  async currentBroadcast(): Promise<StoredBroadcast | undefined> {
    const row = await this.db
      .prepare(`${BROADCAST_SELECT} ORDER BY status = 'active' DESC, created_at DESC, rowid DESC LIMIT 1`)
      .first<BroadcastRow>()
    return row === null ? undefined : toStoredBroadcast(row)
  }

  async claimBroadcastRecipients(
    broadcastId: string,
    limit: number,
  ): Promise<readonly StoredBroadcastRecipient[]> {
    // One statement, so two overlapping runs cannot both take a row: SQLite
    // evaluates the sub-select and the update together, and D1 runs writes one
    // at a time. The rows end up `sending`, so a crash after this point leaves
    // them claimed rather than free to be sent again.
    const result = await this.db
      .prepare(
        `UPDATE broadcast_recipient SET status = 'sending'
         WHERE broadcast_id = ? AND status = 'pending'
           AND rowid IN (
             SELECT rowid FROM broadcast_recipient
             WHERE broadcast_id = ? AND status = 'pending'
             ORDER BY rowid LIMIT ?)
           AND EXISTS (SELECT 1 FROM broadcast WHERE id = ? AND status = 'active')
         RETURNING rowid AS seq, broadcast_id, player_id, email, status, sent_at, error`,
      )
      .bind(broadcastId, broadcastId, limit, broadcastId)
      .all<BroadcastRecipientRow>()
    // RETURNING does not promise an order.
    return [...result.results]
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
      .map(toStoredBroadcastRecipient)
  }

  async markBroadcastRecipientsSent(
    broadcastId: string,
    playerIds: readonly string[],
    sentAt: string,
  ): Promise<void> {
    if (playerIds.length === 0) return
    await this.db
      .prepare(
        `UPDATE broadcast_recipient SET status = 'sent', sent_at = ?, error = NULL
         WHERE broadcast_id = ? AND status = 'sending'
           AND player_id IN (SELECT value FROM json_each(?))`,
      )
      .bind(sentAt, broadcastId, JSON.stringify(playerIds))
      .run()
  }

  async markBroadcastRecipientsFailed(
    broadcastId: string,
    failures: readonly { readonly playerId: string; readonly error: string }[],
  ): Promise<void> {
    if (failures.length === 0) return
    const json = JSON.stringify(failures)
    await this.db
      .prepare(
        `UPDATE broadcast_recipient SET status = 'failed',
           error = (SELECT json_extract(f.value, '$.error') FROM json_each(?) AS f
                    WHERE json_extract(f.value, '$.playerId') = broadcast_recipient.player_id)
         WHERE broadcast_id = ? AND status = 'sending'
           AND player_id IN (SELECT json_extract(value, '$.playerId') FROM json_each(?))`,
      )
      .bind(json, broadcastId, json)
      .run()
  }

  async releaseBroadcastRecipients(
    broadcastId: string,
    playerIds: readonly string[],
  ): Promise<void> {
    if (playerIds.length === 0) return
    await this.db
      .prepare(
        `UPDATE broadcast_recipient SET status = 'pending'
         WHERE broadcast_id = ? AND status = 'sending'
           AND player_id IN (SELECT value FROM json_each(?))`,
      )
      .bind(broadcastId, JSON.stringify(playerIds))
      .run()
  }

  async releaseStuckBroadcastRecipients(broadcastId: string): Promise<number> {
    const result = await this.db
      .prepare(
        `UPDATE broadcast_recipient SET status = 'pending'
         WHERE broadcast_id = ? AND status = 'sending'
           AND EXISTS (SELECT 1 FROM broadcast WHERE id = ? AND status = 'active')`,
      )
      .bind(broadcastId, broadcastId)
      .run()
    return changes(result)
  }

  async finishBroadcast(broadcastId: string, status: 'done' | 'cancelled'): Promise<boolean> {
    const result = await this.db
      .prepare(`UPDATE broadcast SET status = ? WHERE id = ? AND status = 'active'`)
      .bind(status, broadcastId)
      .run()
    return changes(result) > 0
  }

  async recordBroadcastRun(broadcastId: string, at: string): Promise<void> {
    await this.db
      .prepare(`UPDATE broadcast SET last_run_at = ? WHERE id = ?`)
      .bind(at, broadcastId)
      .run()
  }

  async broadcastCounts(broadcastId: string): Promise<BroadcastCounts> {
    const rows = await this.db
      .prepare(
        `SELECT status, COUNT(*) AS total FROM broadcast_recipient
         WHERE broadcast_id = ? GROUP BY status`,
      )
      .bind(broadcastId)
      .all<{ status: string; total: number }>()
    const counts: Record<BroadcastRecipientStatus, number> = {
      pending: 0,
      sending: 0,
      sent: 0,
      failed: 0,
    }
    for (const row of rows.results) {
      if (Object.hasOwn(counts, row.status)) {
        counts[row.status as BroadcastRecipientStatus] = row.total
      }
    }
    return counts
  }

  async listBroadcastRecipients(
    broadcastId: string,
    status: BroadcastRecipientStatus,
  ): Promise<readonly StoredBroadcastRecipient[]> {
    const rows = await this.db
      .prepare(`${RECIPIENT_SELECT} WHERE broadcast_id = ? AND status = ? ORDER BY rowid`)
      .bind(broadcastId, status)
      .all<BroadcastRecipientRow>()
    return rows.results.map(toStoredBroadcastRecipient)
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

  async cachedHighscore(): Promise<HighscoreResult> {
    for (;;) {
      const current = await this.db.prepare(
        `SELECT g.version, c.response FROM highscore_generation g
         LEFT JOIN highscore_cache c ON c.key = 'all' AND c.version = g.version
         WHERE g.id = 1`,
      ).first<{ version: number; response: string | null }>()
      if (current === null) throw new Error('Missing highscore generation row')
      if (current.response !== null) return JSON.parse(current.response) as HighscoreResult
      const [games, players, old, live] = await Promise.all([
        this.finishedGamesForHighscore(),
        this.allPlayers(),
        this.db.prepare(`SELECT id, sort_key, participants FROM rated_result ORDER BY sort_key, id`).all<{ id: string; sort_key: string; participants: string }>(),
        this.db.prepare(
          `SELECT state FROM game WHERE active = 0 AND winner IS NOT NULL AND winner <> ''`,
        ).all<GameStateRow>(),
      ])
      const results: RatedGame[] = old.results.map((row) => ({
        id: row.id, sortKey: row.sort_key,
        participants: JSON.parse(row.participants) as RatedGame['participants'],
      }))
      for (const row of live.results) {
        const result = resultFromGame(parseGame(row.state))
        if (result !== null) results.push(result)
      }
      const response = ratedHighscore(games, players, results)
      const saved = await this.db.prepare(
        `INSERT INTO highscore_cache (key, version, response)
         SELECT 'all', version, ? FROM highscore_generation WHERE id = 1 AND version = ?
         ON CONFLICT(key) DO UPDATE SET version = excluded.version, response = excluded.response`,
      ).bind(JSON.stringify(response), current.version).run()
      if (changes(saved) > 0) return response
      // A write advanced the generation while we calculated: read and rebuild.
    }
  }

  /** No-op: every write above goes straight to D1. */
  async flush(): Promise<void> {
    // Nothing to flush; there is no in-memory buffer to mirror.
  }
}

const REVISION_SELECT = `SELECT game_id, revision, created_at, actor_id, actor_username,
                                public_description, private_descriptions, log_ids,
                                kind, base_revision, state
                         FROM game_revision`

/**
 * Marks a game's newest revision as followed by a change it does not describe.
 * Append a guard with `AND ...` and bind the game id twice, then the guard's own
 * values.
 */
const SEAL_NEWEST = `UPDATE game_revision SET sealed = 1
                     WHERE game_id = ?
                       AND revision = (SELECT MAX(revision) FROM game_revision WHERE game_id = ?)`

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

/** The values of an insert into `game_revision`, in column order. */
function revisionParams(revision: GameRevision, encoding: RevisionEncoding): readonly unknown[] {
  return [
    revision.gameId,
    revision.revision,
    revision.createdAt,
    revision.actor.playerId,
    revision.actor.username,
    revision.publicDescription,
    JSON.stringify(revision.privateDescriptions),
    JSON.stringify(revision.logIds),
    encoding.kind === 'delta' ? encoding.json : JSON.stringify(revision.state),
    encoding.kind,
    encoding.baseRevision,
  ]
}

function toStoredBroadcast(row: BroadcastRow): StoredBroadcast {
  const status: BroadcastStatus =
    row.status === 'done' || row.status === 'cancelled' ? row.status : 'active'
  return {
    id: row.id,
    subject: row.subject,
    markdown: row.markdown,
    includeUnsubscribed: row.include_unsubscribed === 1,
    perRun: row.per_run,
    status,
    createdAt: row.created_at,
    lastRunAt: row.last_run_at,
  }
}

function toStoredBroadcastRecipient(row: BroadcastRecipientRow): StoredBroadcastRecipient {
  const status: BroadcastRecipientStatus =
    row.status === 'sending' || row.status === 'sent' || row.status === 'failed'
      ? row.status
      : 'pending'
  return {
    broadcastId: row.broadcast_id,
    playerId: row.player_id,
    email: row.email,
    status,
    sentAt: row.sent_at,
    error: row.error,
  }
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

function toCompactionRow(row: CompactionRowRecord): CompactionRow {
  return {
    revision: row.revision,
    kind: row.kind === 'delta' ? 'delta' : 'full',
    baseRevision: row.base_revision,
    bytes: row.bytes,
  }
}

/** A stored row as the chain code sees it, its payload parsed. */
function toChainRow(row: RevisionRow): ChainRow {
  return {
    revision: row.revision,
    kind: row.kind === 'delta' ? 'delta' : 'full',
    baseRevision: row.base_revision,
    payload: JSON.parse(row.state) as unknown,
  }
}

/** `state` is the rebuilt full state: the row's own `state` column may be a delta. */
function toGameRevision(row: RevisionRow, state: GameState): GameRevision {
  return {
    gameId: row.game_id,
    revision: row.revision,
    createdAt: row.created_at,
    actor: { playerId: row.actor_id, username: row.actor_username },
    publicDescription: row.public_description,
    privateDescriptions: JSON.parse(row.private_descriptions) as Record<string, string>,
    logIds: JSON.parse(row.log_ids) as string[],
    state,
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
