/**
 * The storage interface.
 *
 * Java used MongoJack with three collections — `player`, `pbf` and `gamelog` —
 * plus `chat`. The log now lives inside `GameState`, so what remains is
 * players, games and chat.
 *
 * The interface exists to keep Mongo out of the routes. The only implementation
 * today is `JsonFileRepository`, which holds everything in memory and mirrors
 * it to a JSON file. A Mongo implementation can sit beside it without the
 * routes changing.
 */

import type { GameState } from '@civ/engine'

export interface StoredPlayer {
  readonly id: string
  readonly username: string
  readonly email: string | null
  /** A scrypt hash of the form `salt:hash`. Java used unsalted SHA-1. */
  readonly passwordHash: string
  readonly createdAt: string
}

export interface ChatMessage {
  readonly id: string
  readonly gameId: string | null
  readonly username: string
  readonly message: string
  readonly createdAt: string
}

export interface Repository {
  createPlayer(player: StoredPlayer): Promise<void>
  findPlayerById(id: string): Promise<StoredPlayer | undefined>
  findPlayerByUsername(username: string): Promise<StoredPlayer | undefined>
  allPlayers(): Promise<readonly StoredPlayer[]>

  saveGame(game: GameState): Promise<void>
  findGame(id: string): Promise<GameState | undefined>
  allGames(): Promise<readonly GameState[]>
  deleteGame(id: string): Promise<boolean>

  appendChat(message: ChatMessage): Promise<void>
  chatFor(gameId: string | null): Promise<readonly ChatMessage[]>

  /** Flushes pending changes to disk. A no-op without file storage. */
  flush(): Promise<void>
}
