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

import type { FinishedGame, GameState } from '@civ/engine'

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
}

export interface PlayerUpdate {
  readonly email?: string | null
  readonly role?: UserRole
  readonly disabled?: boolean
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
  /** Rewrites the stored hash, used to upgrade a legacy SHA-1 account on login. */
  updatePlayerPassword(id: string, passwordHash: string): Promise<void>
  updatePlayer(id: string, changes: PlayerUpdate): Promise<StoredPlayer | undefined>
  deletePlayer(id: string): Promise<boolean>

  saveGame(game: GameState): Promise<void>
  findGame(id: string): Promise<GameState | undefined>
  allGames(): Promise<readonly GameState[]>
  deleteGame(id: string): Promise<boolean>

  appendChat(message: ChatMessage): Promise<void>
  chatFor(gameId: string | null): Promise<readonly ChatMessage[]>

  /**
   * Finished, won games as a source for `highscore()`, roster included —
   * `attempts` needs to know who lost, not just who won. `MongoRepository`
   * reads this from both the old `pbf` collection and the new `game_state`
   * one; `JsonFileRepository` derives it from `allGames()`.
   */
  finishedGamesForHighscore(): Promise<readonly FinishedGame[]>

  /** Flushes pending changes to disk. A no-op without file storage. */
  flush(): Promise<void>
}
