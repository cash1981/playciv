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

import type { GameState } from '@civ/engine'
import { migrateGameState } from '@civ/engine'

import type { ChatMessage, FinishedGame, Repository, StoredPlayer } from './types.js'

interface Snapshot {
  readonly version: 1
  readonly players: readonly StoredPlayer[]
  readonly games: readonly GameState[]
  readonly chat: readonly ChatMessage[]
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
  private chat: ChatMessage[] = []

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
    for (const player of snapshot.players) this.players.set(player.id, player)
    // Games saved before a field existed must be filled in before use
    for (const game of snapshot.games) this.games.set(game.id, migrateGameState(game))
    this.chat = [...snapshot.chat]
  }

  async createPlayer(player: StoredPlayer): Promise<void> {
    this.players.set(player.id, player)
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

  async saveGame(game: GameState): Promise<void> {
    this.games.set(game.id, game)
    this.scheduleWrite()
  }

  async findGame(id: string): Promise<GameState | undefined> {
    return this.games.get(id)
  }

  async allGames(): Promise<readonly GameState[]> {
    return [...this.games.values()]
  }

  async deleteGame(id: string): Promise<boolean> {
    const deleted = this.games.delete(id)
    if (deleted) this.scheduleWrite()
    return deleted
  }

  async appendChat(message: ChatMessage): Promise<void> {
    this.chat.push(message)
    this.scheduleWrite()
  }

  async chatFor(gameId: string | null): Promise<readonly ChatMessage[]> {
    return this.chat.filter((message) => message.gameId === gameId)
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
}
