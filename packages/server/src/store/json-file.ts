/**
 * In-memory-repo som speiler seg til en JSON-fil.
 *
 * Dette står i stedet for MongoDB. Alt ligger i Map-er, og hele innholdet
 * skrives til disk etter hver endring — debounced, og atomisk via en midlertidig
 * fil som byttes inn. Det holder til utvikling og til å spille en runde lokalt.
 * Ingen indekser, ingen samtidighetskontroll, ingen spørrespråk.
 *
 * Sett `filePath` til `null` for et rent minne-repo, slik testene bruker.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { GameState } from '@civ/engine'

import type { ChatMessage, Repository, StoredPlayer } from './types.js'

interface Snapshot {
  readonly version: 1
  readonly players: readonly StoredPlayer[]
  readonly games: readonly GameState[]
  readonly chat: readonly ChatMessage[]
}

export interface JsonFileRepositoryOptions {
  /** Filen tilstanden speiles til. `null` gir et rent minne-repo. */
  readonly filePath: string | null
  /** Millisekunder å vente før skriving, så en serie endringer blir én skriving. */
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

  /** Leser inn eksisterende fil hvis den finnes. Kalles én gang ved oppstart. */
  async load(): Promise<void> {
    if (this.filePath === null) return

    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch (error) {
      // Første oppstart, ingen fil ennå
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }

    const snapshot = JSON.parse(raw) as Snapshot
    for (const player of snapshot.players) this.players.set(player.id, player)
    for (const game of snapshot.games) this.games.set(game.id, game)
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
    // Ikke hold prosessen i live for en ventende skriving
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

    // Serialiser skrivingene, så to raske endringer ikke overlapper
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(path), { recursive: true })
      const temporary = `${path}.tmp`
      await writeFile(temporary, JSON.stringify(snapshot, null, 2), 'utf8')
      // Bytt inn atomisk, så en avbrutt skriving ikke ødelegger filen
      await rename(temporary, path)
    })

    return this.writing
  }
}
