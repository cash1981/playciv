/**
 * Lagringsgrensesnittet.
 *
 * Java brukte MongoJack med tre samlinger: `player`, `pbf` og `gamelog`, pluss
 * `chat`. Loggen ligger nå inne i `GameState`, så det som gjenstår er spillere,
 * spill og chat.
 *
 * Grensesnittet finnes for å holde Mongo ute av rutene. Den eneste
 * implementasjonen i dag er `JsonFileRepository`, som holder alt i minnet og
 * speiler det til en JSON-fil. En Mongo-implementasjon kan legges ved siden av
 * uten at rutene endres.
 */

import type { GameState } from '@civ/engine'

export interface StoredPlayer {
  readonly id: string
  readonly username: string
  readonly email: string | null
  /** scrypt-hash på formen `salt:hash`. Java brukte usaltet SHA-1. */
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

  /** Skriver ventende endringer til disk. Ingen effekt uten fillagring. */
  flush(): Promise<void>
}
