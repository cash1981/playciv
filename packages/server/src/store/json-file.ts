/**
 * An in-memory repository that mirrors itself to a JSON file.
 *
 * This stands in for MongoDB. Everything lives in Maps, and the whole lot is
 * written to disk after each change — debounced, and atomically through a
 * temporary file that is swapped in. Good enough for development and for
 * playing a round locally. No indexes, no concurrency control, no queries.
 *
 * Set `filePath` to `null` for a pure in-memory repository, as the tests do.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { GameState, HighscoreResult } from '@civ/engine'
import { gameHasStarted, migrateGameState } from '@civ/engine'

import type { RevisionCodec } from '../revision-delta.js'
import { defaultRevisionCodec } from '../revision-delta.js'
import { ratedHighscore, resultFromGame } from './rating.js'
import type { RevisionEncoding, RevisionKind, RevisionTail } from './revision-chain.js'
import type { CompactionRow } from './revision-chain.js'
import {
  chainBase,
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
  ChatMessage,
  FinishedGame,
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
  UserRole,
} from './types.js'

type SnapshotPlayer = Omit<StoredPlayer, 'role' | 'disabled'> & {
  readonly role?: UserRole
  readonly disabled?: boolean
}
interface GameActivity {
  readonly version: number
  readonly activityAt: number
  readonly remindedVersion?: number
  readonly checkedAt?: number
}
interface Snapshot {
  readonly activity?: Readonly<Record<string, GameActivity>>
  readonly version: 1
  readonly players: readonly SnapshotPlayer[]
  readonly games: readonly GameState[]
  /** Old files hold rows without `kind` and the tags; `load` fills them in. */
  readonly chat: readonly StoredChatRow[]
  readonly revisions?: readonly StoredRevisionFile[]
  /** Per player and game: when they were last emailed and last opened it. */
  readonly gameMail?: Readonly<Record<string, GameMailStamps>>
  readonly highscore?: HighscoreResult
  /** The admin broadcast queue; recipients keep the order they were queued in. */
  readonly broadcasts?: readonly StoredBroadcast[]
  readonly broadcastRecipients?: readonly StoredBroadcastRecipient[]
}

/**
 * A revision row as it is kept: the metadata of a `GameRevision`, and a `state`
 * that is the full state for a keyframe or the delta for a delta (issue #238),
 * the same two forms the D1 table holds.
 */
interface StoredRevision extends Omit<GameRevision, 'state'> {
  readonly kind: RevisionKind
  /** The keyframe the row's chain starts from; `null` for a row from before delta storage. */
  readonly baseRevision: number | null
  /** The live game moved on after this row without a new revision being recorded. */
  readonly sealed: boolean
  readonly state: unknown
}

/** A file written before delta storage has plain `GameRevision` rows. */
type StoredRevisionFile = Omit<StoredRevision, 'kind' | 'baseRevision' | 'sealed'> &
  Partial<Pick<StoredRevision, 'kind' | 'baseRevision' | 'sealed'>>

function toCompactionRow(row: StoredRevision): CompactionRow {
  return {
    revision: row.revision,
    kind: row.kind,
    baseRevision: row.baseRevision,
    bytes: utf8Length(JSON.stringify(row.state)),
  }
}

/** ISO timestamps; either may be missing until the event first happens. */
interface GameMailStamps {
  readonly emailedAt?: string
  readonly openedAt?: string
}

export interface JsonFileRepositoryOptions {
  /** The file state is mirrored to. `null` keeps everything in memory. */
  readonly filePath: string | null
  /** Milliseconds to wait before writing, so a burst of changes is one write. */
  readonly debounceMs?: number
  /** Injectable clock for timestamps of saved game changes. */
  readonly now?: () => Date
  /** How revisions are diffed and rebuilt. A seam for tests; the default is the real codec. */
  readonly codec?: RevisionCodec
}

export class JsonFileRepository implements Repository {
  private readonly players = new Map<string, StoredPlayer>()
  private readonly activity = new Map<string, GameActivity>()
  private readonly now: () => Date
  private readonly games = new Map<string, GameState>()
  private readonly revisions = new Map<string, StoredRevision>()
  private readonly gameMail = new Map<string, GameMailStamps>()
  private readonly broadcasts = new Map<string, StoredBroadcast>()
  private readonly broadcastRecipients = new Map<string, StoredBroadcastRecipient>()
  private chat: ChatMessage[] = []
  private highscoreCache: HighscoreResult | undefined
  private highscoreGeneration = 0

  private readonly filePath: string | null
  private readonly debounceMs: number
  private readonly codec: RevisionCodec
  private timer: NodeJS.Timeout | undefined
  private writing: Promise<void> = Promise.resolve()

  constructor(options: JsonFileRepositoryOptions) {
    this.now = options.now ?? (() => new Date())
    this.filePath = options.filePath
    this.debounceMs = options.debounceMs ?? 250
    this.codec = options.codec ?? defaultRevisionCodec
  }

  /** Reads an existing file when there is one. Called once at startup. */
  async load(): Promise<void> {
    if (this.filePath === null) return

    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch (error) {
      // First start, no file yet
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }

    const snapshot = JSON.parse(raw) as Snapshot
    for (const [id, activity] of Object.entries(snapshot.activity ?? {})) this.activity.set(id, activity)
    let normalizedPlayers = false
    for (const player of snapshot.players) {
      normalizedPlayers ||= player.role === undefined || player.disabled === undefined
      this.players.set(player.id, {
        ...player,
        role: player.role === 'admin' ? 'admin' : 'user',
        disabled: player.disabled === true,
        disableEmail: player.disableEmail === true,
      })
    }
    if (normalizedPlayers) this.scheduleWrite()
    // Games saved before a field existed must be filled in before use
    for (const game of snapshot.games) this.games.set(game.id, migrateGameState(game))
    const fromOldFile = new Set<string>()
    for (const revision of snapshot.revisions ?? []) {
      const kind: RevisionKind = revision.kind === 'delta' ? 'delta' : 'full'
      if (revision.kind === undefined) fromOldFile.add(revision.gameId)
      const row: StoredRevision = {
        ...revision,
        kind,
        baseRevision: revision.baseRevision ?? null,
        sealed: revision.sealed === true,
        // Only a keyframe is a game state; a delta is not migrated.
        state: kind === 'full' ? migrateGameState(revision.state as GameState) : revision.state,
      }
      this.revisions.set(this.revisionKey(revision.gameId, revision.revision), row)
    }
    // Like migration 0006 for D1: what wrote an old file did not track changes the
    // history does not record, so the next revision of each of its games is a keyframe.
    for (const gameId of fromOldFile) this.sealNewest(gameId)
    // Rows saved before chat orders (issue #215) have no kind or tags
    this.chat = snapshot.chat.map(normalizeChatMessage)
    this.highscoreCache = snapshot.highscore
    for (const [key, stamps] of Object.entries(snapshot.gameMail ?? {})) {
      this.gameMail.set(key, stamps)
    }
    for (const broadcast of snapshot.broadcasts ?? []) this.broadcasts.set(broadcast.id, broadcast)
    for (const recipient of snapshot.broadcastRecipients ?? []) {
      this.broadcastRecipients.set(this.recipientKey(recipient.broadcastId, recipient.playerId), recipient)
    }
  }

  async createPlayer(player: StoredPlayer): Promise<void> {
    this.invalidateHighscore()
    this.players.set(player.id, {
      ...player,
      role: player.role === 'admin' ? 'admin' : 'user',
      disabled: player.disabled === true,
      disableEmail: player.disableEmail === true,
    })
    this.scheduleWrite()
  }

  async findPlayerById(id: string): Promise<StoredPlayer | undefined> {
    return this.players.get(id)
  }

  async findPlayerByUsername(username: string): Promise<StoredPlayer | undefined> {
    const wanted = username.toLowerCase()
    for (const player of this.players.values()) {
      if (player.username.toLowerCase() === wanted) return player
    }
    return undefined
  }

  async allPlayers(): Promise<readonly StoredPlayer[]> {
    return [...this.players.values()]
  }

  async updatePlayerPassword(id: string, passwordHash: string): Promise<void> {
    const player = this.players.get(id)
    if (player === undefined) return
    this.players.set(id, { ...player, passwordHash })
    this.scheduleWrite()
  }

  async updatePlayer(id: string, changes: PlayerUpdate): Promise<StoredPlayer | undefined> {
    const player = this.players.get(id)
    if (player === undefined) return undefined
    const updated = { ...player, ...changes }
    this.players.set(id, updated)
    if (changes.username !== undefined) this.invalidateHighscore()
    this.scheduleWrite()
    return updated
  }

  async deletePlayer(id: string): Promise<boolean> {
    const deleted = this.players.delete(id)
    if (deleted) { this.invalidateHighscore(); this.scheduleWrite() }
    return deleted
  }

  private recordActivity(game: GameState): void {
    if (JSON.stringify(this.games.get(game.id)) === JSON.stringify(game)) return
    this.activity.set(game.id, {
      version: (this.activity.get(game.id)?.version ?? 0) + 1,
      activityAt: this.now().getTime(),
    })
  }

  async releaseTurnReminder(candidate: TurnReminderCandidate): Promise<void> {
    const activity = this.activity.get(candidate.gameId)
    if (activity?.version !== candidate.version || activity.activityAt !== candidate.activityAt ||
      activity.remindedVersion !== candidate.version) return
    const { remindedVersion: _remindedVersion, ...rest } = activity
    this.activity.set(candidate.gameId, rest)
    this.scheduleWrite()
    await this.flush()
  }

  async idleTurnCandidates(now: Date, waitMs: number, limit: number): Promise<readonly TurnReminderCandidate[]> {
    const eligible: TurnReminderCandidate[] = []
    for (const game of this.games.values()) {
      if (!game.active || !gameHasStarted(game)) continue
      let activity = this.activity.get(game.id)
      if (activity === undefined) {
        activity = { version: 0, activityAt: now.getTime() }
        this.activity.set(game.id, activity)
        this.scheduleWrite()
      }
      if (activity.activityAt < now.getTime() - waitMs && activity.remindedVersion !== activity.version) {
        eligible.push({ gameId: game.id, version: activity.version, activityAt: activity.activityAt })
      }
    }
    eligible.sort((a, b) => (this.activity.get(a.gameId)?.checkedAt ?? 0) -
      (this.activity.get(b.gameId)?.checkedAt ?? 0) || a.gameId.localeCompare(b.gameId))
    const candidates = eligible.slice(0, limit)
    for (const candidate of candidates) {
      const activity = this.activity.get(candidate.gameId)
      if (activity !== undefined) this.activity.set(candidate.gameId, { ...activity, checkedAt: now.getTime() })
    }
    this.scheduleWrite()
    return candidates
  }

  async claimTurnReminder(candidate: TurnReminderCandidate, playerId: string, expectedEmail: string, now: Date, waitMs: number): Promise<boolean> {
    const activity = this.activity.get(candidate.gameId)
    const game = this.games.get(candidate.gameId)
    const player = this.players.get(playerId)
    if (game?.active !== true || activity === undefined || activity.version !== candidate.version ||
      activity.activityAt !== candidate.activityAt || activity.remindedVersion === activity.version ||
      activity.activityAt >= now.getTime() - waitMs || player === undefined || player.disabled === true ||
      player.disableEmail === true || player.email !== expectedEmail || !player.email?.trim()) return false
    this.activity.set(candidate.gameId, { ...activity, remindedVersion: activity.version })
    this.scheduleWrite()
    // Persist the claim before contacting a provider, so a restart cannot resend.
    await this.flush()
    return true
  }

  async saveGame(game: GameState): Promise<void> {
    if (!game.active || this.games.get(game.id)?.active === false) this.invalidateHighscore()
    this.recordActivity(game)
    this.games.set(game.id, game)
    // Replaced wholesale: the newest revision no longer describes the game.
    this.sealNewest(game.id)
    this.scheduleWrite()
  }

  async saveGameIfRevision(
    game: GameState,
    expectedRevision: number,
    options: SaveGameOptions = {},
  ): Promise<boolean> {
    if (this.games.get(game.id)?.rev !== expectedRevision) return false
    if (!game.active || this.games.get(game.id)?.active === false) this.invalidateHighscore()
    this.recordActivity(game)
    this.games.set(game.id, game)
    if (options.notesOnly !== true) this.sealNewest(game.id)
    this.scheduleWrite()
    return true
  }

  async saveGameWithRevision(
    game: GameState,
    revision: GameRevision,
    expectedRevision: number | null,
    previous?: GameState,
  ): Promise<boolean> {
    const current = this.games.get(game.id)
    const revisionKey = this.revisionKey(revision.gameId, revision.revision)
    if (
      (expectedRevision === null ? current !== undefined : current?.rev !== expectedRevision)
      || this.revisions.has(revisionKey)
    ) {
      return false
    }
    if (!game.active || current?.active === false) this.invalidateHighscore()
    this.recordActivity(game)
    this.games.set(game.id, game)
    const encoding =
      expectedRevision === null || previous === undefined
        ? undefined
        : this.encodeRevision(revision, previous)
    this.revisions.set(revisionKey, this.toRow(revision, encoding))
    this.scheduleWrite()
    return true
  }

  async ensureGameRevision(
    revision: GameRevision,
    expectedRevision: number,
  ): Promise<boolean> {
    if (this.games.get(revision.gameId)?.rev !== expectedRevision) return false
    if ([...this.revisions.values()].some((entry) => entry.gameId === revision.gameId)) return true
    const key = this.revisionKey(revision.gameId, revision.revision)
    this.revisions.set(key, this.toRow(revision, undefined))
    this.scheduleWrite()
    return true
  }

  async listGameRevisions(gameId: string): Promise<readonly GameRevision[]> {
    const revisions: GameRevision[] = []
    let current: GameState | undefined
    let keyframe: number | undefined
    for (const row of this.rowsOf(gameId)) {
      if (row.kind === 'full') {
        keyframe = row.revision
        current = row.state as GameState
      } else {
        const applied =
          current === undefined || row.baseRevision !== keyframe
            ? undefined
            : this.codec.apply(current, row.state)
        if (applied === undefined || !applied.ok) {
          throw new Error(`Revision ${row.revision} of game ${gameId} cannot be rebuilt`)
        }
        current = applied.value as GameState
      }
      revisions.push(this.toGameRevision(row, current))
    }
    return revisions
  }

  async listGameRevisionSummaries(gameId: string): Promise<readonly GameRevisionMetadata[]> {
    // In memory there is nothing to save by dropping `state`, but the method
    // exists so both stores answer the history route the same way.
    return this.rowsOf(gameId).map((row) => ({
      gameId: row.gameId,
      revision: row.revision,
      createdAt: row.createdAt,
      actor: row.actor,
      publicDescription: row.publicDescription,
      privateDescriptions: row.privateDescriptions,
      logIds: row.logIds,
    }))
  }

  async findGameRevision(gameId: string, revision: number): Promise<GameRevision | undefined> {
    const row = this.revisions.get(this.revisionKey(gameId, revision))
    if (row === undefined) return undefined
    const state = await this.rebuildRow(gameId, revision)
    if (state === undefined) throw new Error(`Revision ${revision} of game ${gameId} cannot be rebuilt`)
    return this.toGameRevision(row, state)
  }

  /**
   * The full state of one revision: the nearest keyframe at or below it and every
   * row up to it, applied in order. `undefined` when the chain does not hold
   * together.
   */
  private async rebuildRow(gameId: string, revision: number): Promise<GameState | undefined> {
    const rows = this.rowsOf(gameId)
    const index = rows.findIndex((row) => row.revision === revision)
    if (index < 0) return undefined
    let start = index
    while (start > 0 && rows[start]?.kind !== 'full') start -= 1
    const rebuilt = rebuildState(
      rows.slice(start, index + 1).map((entry) => ({
        revision: entry.revision,
        kind: entry.kind,
        baseRevision: entry.baseRevision,
        payload: entry.state,
      })),
      this.codec,
      (state) => state,
    )
    return rebuilt.ok ? rebuilt.state : undefined
  }

  async findGame(id: string): Promise<GameState | undefined> {
    return this.games.get(id)
  }

  async findGameRevisionCounter(id: string): Promise<number | undefined> {
    return this.games.get(id)?.rev
  }

  async allGames(): Promise<readonly GameState[]> {
    return [...this.games.values()]
  }

  async deleteGame(id: string): Promise<boolean> {
    this.activity.delete(id)
    const deleted = this.games.delete(id)
    // Like D1, drop the mail stamps whether or not the game row existed.
    for (const key of this.gameMail.keys()) {
      if (key.startsWith(`${id}:`)) this.gameMail.delete(key)
    }
    if (deleted) {
      this.invalidateHighscore()
      for (const [key, revision] of this.revisions) {
        if (revision.gameId === id) this.revisions.delete(key)
      }
    }
    this.scheduleWrite()
    return deleted
  }

  async finishedGameRevisionUsage(
    gameId?: string,
  ): Promise<readonly FinishedGameRevisionUsage[]> {
    const usage: FinishedGameRevisionUsage[] = []
    for (const game of this.games.values()) {
      if (game.active || (gameId !== undefined && game.id !== gameId)) continue
      const rows = this.rowsOf(game.id)
      const newest = rows.at(-1)
      const removable = rows.filter((entry) => entry.revision < (newest?.revision ?? -1))
      // D1 sums the stored JSON text; this is the same text's size.
      const bytes = (row: StoredRevision) => utf8Length(JSON.stringify(row.state))
      const keyframe = newest === undefined ? undefined : rows.find((row) => row.revision === chainBase(newest))
      const growth =
        newest?.kind === 'delta' && keyframe !== undefined ? bytes(keyframe) - bytes(newest) : 0
      usage.push({
        gameId: game.id,
        name: game.name,
        revisions: rows.length,
        removableRevisions: removable.length,
        removableBytes: netRemovableBytes(removable.reduce((sum, row) => sum + bytes(row), 0), growth),
      })
    }
    return usage.sort(
      (left, right) =>
        right.removableBytes - left.removableBytes || left.gameId.localeCompare(right.gameId),
    )
  }

  async deleteOldGameRevisions(gameId: string): Promise<FinishedGameCleanup> {
    const game = this.games.get(gameId)
    if (game === undefined) return { status: 'not-found' }
    if (game.active) return { status: 'active' }
    const rows = this.rowsOf(gameId)
    const newest = rows.at(-1)
    if (newest === undefined) return { status: 'cleaned', removed: 0 }

    if (newest.kind === 'delta') {
      // The newest revision would not survive losing its chain: keep it as a keyframe.
      const rebuilt = await this.rebuildRow(gameId, newest.revision)
      if (rebuilt === undefined) return { status: 'changed' }
      this.revisions.set(this.revisionKey(gameId, newest.revision), {
        ...newest,
        kind: 'full',
        baseRevision: newest.revision,
        // Whether the live game moved past this row is not a matter of how the row is stored.
        sealed: newest.sealed,
        state: rebuilt,
      })
    }
    let removed = 0
    for (const row of rows) {
      if (row.revision >= newest.revision) continue
      this.revisions.delete(this.revisionKey(gameId, row.revision))
      removed += 1
    }
    this.scheduleWrite()
    return { status: 'cleaned', removed }
  }

  async revisionCompactionUsage(gameId?: string): Promise<readonly RevisionCompactionUsage[]> {
    return [...this.games.values()]
      .filter((game) => gameId === undefined || game.id === gameId)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((game) => {
        const rows = this.rowsOf(game.id)
        return {
          gameId: game.id,
          name: game.name,
          active: game.active,
          revisions: rows.length,
          ...summarizeCompaction(rows.map(toCompactionRow)),
        }
      })
  }

  async compactGameRevisions(
    gameId: string,
    maxRevisions: number,
    maxBytes = Number.POSITIVE_INFINITY,
  ): Promise<RevisionCompaction> {
    if (!this.games.has(gameId)) return { status: 'not-found' }
    const rows = this.rowsOf(gameId)
    const plan = planCompaction(rows.map(toCompactionRow), maxRevisions, maxBytes)
    if (plan.todo.length === 0) {
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

    let previousState: GameState | undefined
    if (plan.previous !== undefined) {
      previousState = await this.rebuildRow(gameId, plan.previous)
      if (previousState === undefined) {
        return { status: 'mismatch', revision: plan.previous, handledBytes: plan.bytes, handledRows: plan.todo.length }
      }
    }
    const outcome = compactChunk({
      plan,
      previousState,
      // Rows are kept migrated already (`load`), so these are the states a read gives.
      states: plan.todo.map((revision) => {
        const row = rows.find((entry) => entry.revision === revision) as StoredRevision
        return { revision, state: row.state as GameState, bytes: utf8Length(JSON.stringify(row.state)) }
      }),
      codec: this.codec,
    })
    if (!outcome.ok) {
      return { status: 'mismatch', revision: outcome.revision, handledBytes: plan.bytes, handledRows: plan.todo.length }
    }

    let converted = 0
    let keyframes = 0
    let freedBytes = 0
    for (const step of outcome.steps) {
      const row = rows.find((entry) => entry.revision === step.revision) as StoredRevision
      if (step.kind === 'delta') {
        this.revisions.set(this.revisionKey(gameId, step.revision), {
          ...row,
          kind: 'delta',
          baseRevision: step.baseRevision,
          state: JSON.parse(step.json) as unknown,
        })
        converted += 1
        freedBytes += step.savedBytes
      } else {
        this.revisions.set(this.revisionKey(gameId, step.revision), { ...row, baseRevision: step.revision })
        keyframes += 1
      }
    }
    const broken = firstBrokenRevision(this.rowsOf(gameId).map(toCompactionRow))
    if (broken !== undefined) {
      return { status: 'mismatch', revision: broken, handledBytes: plan.bytes, handledRows: plan.todo.length }
    }
    this.scheduleWrite()
    return {
      status: 'compacted',
      converted,
      keyframes,
      freedBytes,
      handledBytes: plan.bytes,
      handledRows: plan.todo.length,
      remaining: plan.remaining,
    }
  }

  async appendChat(message: StoredChatRow): Promise<void> {
    this.chat.push(normalizeChatMessage(message))
    this.scheduleWrite()
  }

  async chatFor(gameId: string | null): Promise<readonly ChatMessage[]> {
    return this.chat.filter((message) => message.gameId === gameId)
  }

  async recordGameOpened(gameId: string, playerId: string, now: Date): Promise<void> {
    const key = `${gameId}:${playerId}`
    const stamps = this.gameMail.get(key)
    // Only a visit that changes the answer is stored: the first one, or the
    // first since the last email.
    if (
      stamps !== undefined &&
      stamps.openedAt !== undefined &&
      (stamps.emailedAt === undefined || stamps.openedAt > stamps.emailedAt)
    ) {
      return
    }
    this.gameMail.set(key, { ...stamps, openedAt: now.toISOString() })
    this.scheduleWrite()
  }

  async claimGameEmail(
    gameId: string,
    playerId: string,
    fallbackWaitMs: number,
    now: Date,
  ): Promise<boolean> {
    // No `await` between the read and the write: JavaScript runs this body
    // synchronously until the first await, so two concurrent callers cannot
    // both pass the check. Do not reintroduce an await here.
    const key = `${gameId}:${playerId}`
    const stamps = this.gameMail.get(key)
    if (stamps?.emailedAt !== undefined) {
      const seenSince =
        stamps.openedAt !== undefined && stamps.openedAt > stamps.emailedAt
      if (!seenSince) {
        // Held until the game is opened. Without a single visit on record the
        // 30 minute wait stands in. Only a stamp strictly older than the wait
        // lets a mail through, so a stamp in the future suppresses, as in D1.
        if (stamps.openedAt !== undefined) return false
        const lastMs = Date.parse(stamps.emailedAt)
        if (!Number.isNaN(lastMs) && !(lastMs < now.getTime() - fallbackWaitMs)) return false
      }
    }
    this.gameMail.set(key, { ...stamps, emailedAt: now.toISOString() })
    this.scheduleWrite()
    return true
  }

  async finishedGamesForHighscore(): Promise<readonly FinishedGame[]> {
    const summaries: FinishedGame[] = []
    for (const game of this.games.values()) {
      if (game.active || game.winner === null || game.winner === '') continue
      summaries.push({
        numOfPlayers: game.numOfPlayers,
        winner: game.winner,
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
      if (this.highscoreCache !== undefined) return this.highscoreCache
      const generation = this.highscoreGeneration
      const games = await this.finishedGamesForHighscore()
      const players = await this.allPlayers()
      const results = [...this.games.values()].map(resultFromGame).filter((result) => result !== null)
      const response = ratedHighscore(games, players, results)
      if (generation !== this.highscoreGeneration) continue
      this.highscoreCache = response
      this.scheduleWrite()
      return response
    }
  }

  private invalidateHighscore(): void {
    this.highscoreGeneration++
    this.highscoreCache = undefined
  }

  // ---------------------------------------------------------------------
  // Admin broadcast queue
  // ---------------------------------------------------------------------

  private recipientKey(broadcastId: string, playerId: string): string {
    return `${broadcastId}:${playerId}`
  }

  private recipientsOf(broadcastId: string): StoredBroadcastRecipient[] {
    return [...this.broadcastRecipients.values()].filter(
      (recipient) => recipient.broadcastId === broadcastId,
    )
  }

  async createBroadcast(
    broadcast: StoredBroadcast,
    recipients: readonly { readonly playerId: string; readonly email: string }[],
  ): Promise<boolean> {
    if ([...this.broadcasts.values()].some((existing) => existing.status === 'active')) return false
    this.broadcasts.set(broadcast.id, broadcast)
    for (const recipient of recipients) {
      this.broadcastRecipients.set(this.recipientKey(broadcast.id, recipient.playerId), {
        broadcastId: broadcast.id,
        playerId: recipient.playerId,
        email: recipient.email,
        status: 'pending',
        sentAt: null,
        error: null,
      })
    }
    this.scheduleWrite()
    return true
  }

  async currentBroadcast(): Promise<StoredBroadcast | undefined> {
    const all = [...this.broadcasts.values()]
    return all.find((broadcast) => broadcast.status === 'active') ?? all[all.length - 1]
  }

  async claimBroadcastRecipients(
    broadcastId: string,
    limit: number,
  ): Promise<readonly StoredBroadcastRecipient[]> {
    if (this.broadcasts.get(broadcastId)?.status !== 'active') return []
    // No await between the read and the write, so two callers cannot interleave.
    const claimed: StoredBroadcastRecipient[] = []
    for (const recipient of this.recipientsOf(broadcastId)) {
      if (claimed.length >= limit) break
      if (recipient.status !== 'pending') continue
      const taken = { ...recipient, status: 'sending' as const }
      this.broadcastRecipients.set(this.recipientKey(broadcastId, recipient.playerId), taken)
      claimed.push(taken)
    }
    if (claimed.length > 0) this.scheduleWrite()
    return claimed
  }

  /** Moves the claimed (`sending`) rows among `playerIds` to `status`. */
  private moveClaimed(
    broadcastId: string,
    playerIds: readonly string[],
    change: (recipient: StoredBroadcastRecipient) => StoredBroadcastRecipient,
  ): void {
    for (const playerId of playerIds) {
      const key = this.recipientKey(broadcastId, playerId)
      const recipient = this.broadcastRecipients.get(key)
      if (recipient?.status === 'sending') this.broadcastRecipients.set(key, change(recipient))
    }
    this.scheduleWrite()
  }

  async markBroadcastRecipientsSent(
    broadcastId: string,
    playerIds: readonly string[],
    sentAt: string,
  ): Promise<void> {
    this.moveClaimed(broadcastId, playerIds, (recipient) => ({
      ...recipient,
      status: 'sent',
      sentAt,
      error: null,
    }))
  }

  async markBroadcastRecipientsFailed(
    broadcastId: string,
    failures: readonly { readonly playerId: string; readonly error: string }[],
  ): Promise<void> {
    const reasons = new Map(failures.map((failure) => [failure.playerId, failure.error]))
    this.moveClaimed(
      broadcastId,
      failures.map((failure) => failure.playerId),
      (recipient) => ({
        ...recipient,
        status: 'failed',
        error: reasons.get(recipient.playerId) ?? null,
      }),
    )
  }

  async releaseBroadcastRecipients(
    broadcastId: string,
    playerIds: readonly string[],
  ): Promise<void> {
    this.moveClaimed(broadcastId, playerIds, (recipient) => ({ ...recipient, status: 'pending' }))
  }

  async releaseStuckBroadcastRecipients(broadcastId: string): Promise<number> {
    if (this.broadcasts.get(broadcastId)?.status !== 'active') return 0
    let released = 0
    for (const [key, recipient] of this.broadcastRecipients) {
      if (recipient.broadcastId === broadcastId && recipient.status === 'sending') {
        this.broadcastRecipients.set(key, { ...recipient, status: 'pending' })
        released += 1
      }
    }
    if (released > 0) this.scheduleWrite()
    return released
  }

  async finishBroadcast(broadcastId: string, status: 'done' | 'cancelled'): Promise<boolean> {
    const broadcast = this.broadcasts.get(broadcastId)
    if (broadcast?.status !== 'active') return false
    this.broadcasts.set(broadcastId, { ...broadcast, status })
    this.scheduleWrite()
    return true
  }

  async recordBroadcastRun(broadcastId: string, at: string): Promise<void> {
    const broadcast = this.broadcasts.get(broadcastId)
    if (broadcast === undefined) return
    this.broadcasts.set(broadcastId, { ...broadcast, lastRunAt: at })
    this.scheduleWrite()
  }

  async broadcastCounts(broadcastId: string): Promise<BroadcastCounts> {
    const counts: Record<BroadcastRecipientStatus, number> = {
      pending: 0,
      sending: 0,
      sent: 0,
      failed: 0,
    }
    for (const recipient of this.recipientsOf(broadcastId)) counts[recipient.status] += 1
    return counts
  }

  async listBroadcastRecipients(
    broadcastId: string,
    status: BroadcastRecipientStatus,
  ): Promise<readonly StoredBroadcastRecipient[]> {
    return this.recipientsOf(broadcastId).filter((recipient) => recipient.status === status)
  }

  async flush(): Promise<void> {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    await this.write()
  }

  private scheduleWrite(): void {
    if (this.filePath === null) return
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.write()
    }, this.debounceMs)
    // Do not keep the process alive for a pending write
    this.timer.unref?.()
  }

  private async write(): Promise<void> {
    const path = this.filePath
    if (path === null) return

    const snapshot: Snapshot = {
      version: 1,
      players: [...this.players.values()],
      games: [...this.games.values()],
      activity: Object.fromEntries(this.activity),
      chat: this.chat,
      revisions: [...this.revisions.values()],
      gameMail: Object.fromEntries(this.gameMail),
      broadcasts: [...this.broadcasts.values()],
      broadcastRecipients: [...this.broadcastRecipients.values()],
      ...(this.highscoreCache === undefined ? {} : { highscore: this.highscoreCache }),
    }

    // Serialise the writes, so two quick changes cannot overlap
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(path), { recursive: true })
      const temporary = `${path}.tmp`
      await writeFile(temporary, JSON.stringify(snapshot, null, 2), 'utf8')
      // Swap in atomically, so an interrupted write cannot corrupt the file
      await rename(temporary, path)
    })

    return this.writing
  }

  private revisionKey(gameId: string, revision: number): string {
    return `${gameId}:${revision}`
  }

  /** A game's rows, oldest first. */
  private rowsOf(gameId: string): StoredRevision[] {
    return [...this.revisions.values()]
      .filter((row) => row.gameId === gameId)
      .sort((left, right) => left.revision - right.revision)
  }

  private sealNewest(gameId: string): void {
    const newest = this.rowsOf(gameId).at(-1)
    if (newest === undefined || newest.sealed) return
    this.revisions.set(this.revisionKey(gameId, newest.revision), { ...newest, sealed: true })
  }

  /** Same decision as D1: a delta only against a safe, unsealed chain that is not yet K rows long. */
  private encodeRevision(revision: GameRevision, previous: GameState): RevisionEncoding | undefined {
    const newest = this.rowsOf(revision.gameId).at(-1)
    if (newest === undefined) return undefined
    const base = chainBase(newest)
    const tail: RevisionTail = {
      revision: newest.revision,
      baseRevision: base,
      sealed: newest.sealed,
      chainRows: this.rowsOf(revision.gameId).filter((row) => row.revision >= base).length,
    }
    return encodeRevision({
      revision: revision.revision,
      state: revision.state,
      previous,
      tail,
      codec: this.codec,
      // What a keyframe of this revision would take; D1 uses its chain's keyframe.
      fullBytes: () => utf8Length(JSON.stringify(revision.state)),
    })
  }

  private toRow(revision: GameRevision, encoding: RevisionEncoding | undefined): StoredRevision {
    const { state, ...metadata } = revision
    if (encoding === undefined || encoding.kind === 'full') {
      return { ...metadata, kind: 'full', baseRevision: revision.revision, sealed: false, state }
    }
    return {
      ...metadata,
      kind: 'delta',
      baseRevision: encoding.baseRevision,
      sealed: false,
      state: JSON.parse(encoding.json) as unknown,
    }
  }

  private toGameRevision(row: StoredRevision, state: GameState): GameRevision {
    return {
      gameId: row.gameId,
      revision: row.revision,
      createdAt: row.createdAt,
      actor: row.actor,
      publicDescription: row.publicDescription,
      privateDescriptions: row.privateDescriptions,
      logIds: row.logIds,
      state,
    }
  }
}
