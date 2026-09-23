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

import type {
  ChatMessage,
  FinishedGame,
  GameRevision,
  GameRevisionMetadata,
  PlayerUpdate,
  Repository,
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
  readonly chat: readonly ChatMessage[]
  readonly revisions?: readonly GameRevision[]
  /** Java's two `emailSent` timestamps, kept as one keyed table. */
  readonly emailSent?: Readonly<Record<string, string>>
  readonly highscore?: HighscoreResult
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
  private readonly emailSent = new Map<string, string>()
  private chat: ChatMessage[] = []
  private highscoreCache: HighscoreResult | undefined

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
    this.chat = [...snapshot.chat]
    this.highscoreCache = snapshot.highscore
    for (const [scope, at] of Object.entries(snapshot.emailSent ?? {})) {
      this.emailSent.set(scope, at)
    }
  }

  async createPlayer(player: StoredPlayer): Promise<void> {
    this.highscoreCache = undefined
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
    if (changes.username !== undefined) this.highscoreCache = undefined
    this.scheduleWrite()
    return updated
  }

  async deletePlayer(id: string): Promise<boolean> {
    const deleted = this.players.delete(id)
    if (deleted) { this.highscoreCache = undefined; this.scheduleWrite() }
    return deleted
  }

  async saveGame(game: GameState): Promise<void> {
    if (!game.active || this.games.get(game.id)?.active === false) this.highscoreCache = undefined
    this.games.set(game.id, game)
    this.scheduleWrite()
  }

  async saveGameIfRevision(game: GameState, expectedRevision: number): Promise<boolean> {
    if (this.games.get(game.id)?.rev !== expectedRevision) return false
    if (!game.active || this.games.get(game.id)?.active === false) this.highscoreCache = undefined
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
    if (!game.active || current?.active === false) this.highscoreCache = undefined
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
    if (deleted) {
      this.highscoreCache = undefined
      for (const [key, revision] of this.revisions) {
        if (revision.gameId === id) this.revisions.delete(key)
      }
      this.scheduleWrite()
    }
    return deleted
  }

  async appendChat(message: ChatMessage): Promise<void> {
    this.chat.push(message)
    this.scheduleWrite()
  }

  async chatFor(gameId: string | null): Promise<readonly ChatMessage[]> {
    return this.chat.filter((message) => message.gameId === gameId)
  }

  async claimEmailSlot(scope: string, waitMs: number, now: Date): Promise<boolean> {
    // No `await` between the read and the write: JavaScript runs this body
    // synchronously until the first await, so two concurrent callers cannot
    // both pass the check. Do not reintroduce an await here.
    const last = this.emailSent.get(scope)
    if (last !== undefined) {
      const lastMs = Date.parse(last)
      // Java `CivUtil.shouldSend`: send only once the wait has fully elapsed;
      // it used `Math.abs`, so a future stamp also suppresses.
      if (!Number.isNaN(lastMs) && Math.abs(now.getTime() - lastMs) <= waitMs) return false
    }
    this.emailSent.set(scope, now.toISOString())
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
    if (this.highscoreCache !== undefined) return this.highscoreCache
    const results = [...this.games.values()].map(resultFromGame).filter((result) => result !== null)
    this.highscoreCache = ratedHighscore(await this.finishedGamesForHighscore(), await this.allPlayers(), results)
    this.scheduleWrite()
    return this.highscoreCache
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
      emailSent: Object.fromEntries(this.emailSent),
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
