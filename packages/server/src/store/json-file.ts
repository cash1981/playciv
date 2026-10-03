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
import { migrateGameState } from '@civ/engine'

import { ratedHighscore, resultFromGame } from './rating.js'

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
interface Snapshot {
  readonly version: 1
  readonly players: readonly SnapshotPlayer[]
  readonly games: readonly GameState[]
  /** Old files hold rows without `kind` and the tags; `load` fills them in. */
  readonly chat: readonly StoredChatRow[]
  readonly revisions?: readonly GameRevision[]
  /** Per player and game: when they were last emailed and last opened it. */
  readonly gameMail?: Readonly<Record<string, GameMailStamps>>
  readonly highscore?: HighscoreResult
  /** The admin broadcast queue; recipients keep the order they were queued in. */
  readonly broadcasts?: readonly StoredBroadcast[]
  readonly broadcastRecipients?: readonly StoredBroadcastRecipient[]
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
}

export class JsonFileRepository implements Repository {
  private readonly players = new Map<string, StoredPlayer>()
  private readonly games = new Map<string, GameState>()
  private readonly revisions = new Map<string, GameRevision>()
  private readonly gameMail = new Map<string, GameMailStamps>()
  private readonly broadcasts = new Map<string, StoredBroadcast>()
  private readonly broadcastRecipients = new Map<string, StoredBroadcastRecipient>()
  private chat: ChatMessage[] = []
  private highscoreCache: HighscoreResult | undefined
  private highscoreGeneration = 0

  private readonly filePath: string | null
  private readonly debounceMs: number
  private timer: NodeJS.Timeout | undefined
  private writing: Promise<void> = Promise.resolve()

  constructor(options: JsonFileRepositoryOptions) {
    this.filePath = options.filePath
    this.debounceMs = options.debounceMs ?? 250
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
    for (const revision of snapshot.revisions ?? []) {
      const migrated = { ...revision, state: migrateGameState(revision.state) }
      this.revisions.set(this.revisionKey(revision.gameId, revision.revision), migrated)
    }
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

  async saveGame(game: GameState): Promise<void> {
    if (!game.active || this.games.get(game.id)?.active === false) this.invalidateHighscore()
    this.games.set(game.id, game)
    this.scheduleWrite()
  }

  async saveGameIfRevision(game: GameState, expectedRevision: number): Promise<boolean> {
    if (this.games.get(game.id)?.rev !== expectedRevision) return false
    if (!game.active || this.games.get(game.id)?.active === false) this.invalidateHighscore()
    this.games.set(game.id, game)
    this.scheduleWrite()
    return true
  }

  async saveGameWithRevision(
    game: GameState,
    revision: GameRevision,
    expectedRevision: number | null,
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
    this.games.set(game.id, game)
    this.revisions.set(revisionKey, revision)
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
    this.revisions.set(key, revision)
    this.scheduleWrite()
    return true
  }

  async listGameRevisions(gameId: string): Promise<readonly GameRevision[]> {
    return [...this.revisions.values()]
      .filter((revision) => revision.gameId === gameId)
      .sort((left, right) => left.revision - right.revision)
  }

  async listGameRevisionSummaries(gameId: string): Promise<readonly GameRevisionMetadata[]> {
    // In memory there is nothing to save by dropping `state`, but the method
    // exists so both stores answer the history route the same way.
    return (await this.listGameRevisions(gameId)).map((revision) => ({
      gameId: revision.gameId,
      revision: revision.revision,
      createdAt: revision.createdAt,
      actor: revision.actor,
      publicDescription: revision.publicDescription,
      privateDescriptions: revision.privateDescriptions,
      logIds: revision.logIds,
    }))
  }

  async findGameRevision(gameId: string, revision: number): Promise<GameRevision | undefined> {
    return this.revisions.get(this.revisionKey(gameId, revision))
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
      const revisions = [...this.revisions.values()].filter((entry) => entry.gameId === game.id)
      const newest = Math.max(...revisions.map((entry) => entry.revision))
      const removable = revisions.filter((entry) => entry.revision < newest)
      usage.push({
        gameId: game.id,
        name: game.name,
        revisions: revisions.length,
        removableRevisions: removable.length,
        // D1 sums the stored JSON text; this is the same text's size.
        removableBytes: removable.reduce(
          (sum, entry) => sum + Buffer.byteLength(JSON.stringify(entry.state), 'utf8'),
          0,
        ),
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
    const revisions = [...this.revisions.entries()].filter(([, entry]) => entry.gameId === gameId)
    const newest = Math.max(...revisions.map(([, entry]) => entry.revision))
    let removed = 0
    for (const [key, entry] of revisions) {
      if (entry.revision >= newest) continue
      this.revisions.delete(key)
      removed += 1
    }
    if (removed > 0) this.scheduleWrite()
    return { status: 'cleaned', removed }
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
}
