/**
 * Storage against the restored `playciv` MongoDB.
 *
 * Reuses the old `player` and `chat` collections so existing accounts and
 * chat history keep working. New games go into a fresh `game_state`
 * collection; the old `pbf` collection (Java's `PBF`) is read-only here and
 * used only as a highscore source — it is a completely different shape from
 * `GameState` and is never migrated or written to.
 *
 * `player._id` is an `ObjectId` for every pre-existing account and a string
 * UUID for accounts created here. `findPlayerById` has to match either shape,
 * because old `pbf.players[].playerId` values are ObjectId hex strings passed
 * around as plain strings elsewhere in this codebase.
 */

import type { Collection, Db } from 'mongodb'
import { MongoClient, ObjectId } from 'mongodb'

import type { GameState } from '@civ/engine'
import { migrateGameState } from '@civ/engine'

import type {
  ChatMessage,
  FinishedGame,
  PlayerUpdate,
  Repository,
  StoredPlayer,
} from './types.js'

/** Java: `Player`. Only the fields this repository reads or writes. */
interface PlayerDoc {
  readonly _id: string | ObjectId
  readonly username: string
  readonly email?: string | null
  readonly password: string
  readonly createdAt?: string
  readonly role?: StoredPlayer['role']
  readonly disabled?: boolean
}

/** Java: `Chat`. `pbfId` is `null` for lobby chat. */
interface ChatDoc {
  readonly _id: string | ObjectId
  readonly pbfId: string | null
  readonly username: string
  readonly message: string
  /** New documents. */
  readonly createdAt?: string
  /** Old documents: a Jackson `LocalDateTime` as `[y, mo, d, h, mi, s, nano]`. */
  readonly created?: readonly number[]
}

/**
 * Java: `PBF`, reduced to what highscore needs. Do not read the rest of this
 * document as a `GameState` — it is a completely different shape.
 */
interface PbfDoc {
  readonly active: boolean
  readonly winner?: string | null
  readonly numOfPlayers: number
  readonly players?: readonly { readonly username: string; readonly civilization?: { readonly name?: string } | null }[]
}

const PLAYER_COLLECTION = 'player'
const CHAT_COLLECTION = 'chat'
const GAME_COLLECTION = 'game_state'
const PBF_COLLECTION = 'pbf'

/** Java: `Chat.getCreatedInMillis` reading a Jackson `LocalDateTime` array. */
function isoFromLegacyCreated(created: readonly number[]): string | undefined {
  const [year, month, day, hour, minute, second, nano] = created
  if (year === undefined || month === undefined || day === undefined) return undefined
  const date = new Date(
    Date.UTC(year, month - 1, day, hour ?? 0, minute ?? 0, second ?? 0, Math.floor((nano ?? 0) / 1_000_000)),
  )
  return date.toISOString()
}

export class MongoRepository implements Repository {
  private readonly players: Collection<PlayerDoc>
  private readonly chat: Collection<ChatDoc>
  private readonly games: Collection<GameState & { _id: string }>
  private readonly pbf: Collection<PbfDoc>
  private readonly client: MongoClient | undefined

  constructor(db: Db, client?: MongoClient) {
    this.players = db.collection<PlayerDoc>(PLAYER_COLLECTION)
    this.chat = db.collection<ChatDoc>(CHAT_COLLECTION)
    this.games = db.collection<GameState & { _id: string }>(GAME_COLLECTION)
    this.pbf = db.collection<PbfDoc>(PBF_COLLECTION)
    this.client = client
  }

  /** Connects a new client and returns a repository backed by `dbName`. */
  static async connect(url: string, dbName: string): Promise<MongoRepository> {
    const client = new MongoClient(url)
    await client.connect()
    return new MongoRepository(client.db(dbName), client)
  }

  /** Closes the client this repository opened in `connect`, if any. */
  async close(): Promise<void> {
    await this.client?.close()
  }

  // ---------------------------------------------------------------------
  // Players
  // ---------------------------------------------------------------------

  async createPlayer(player: StoredPlayer): Promise<void> {
    await this.players.insertOne({
      _id: player.id,
      username: player.username,
      email: player.email,
      password: player.passwordHash,
      createdAt: player.createdAt,
      role: player.role === 'admin' ? 'admin' : 'user',
      disabled: player.disabled === true,
    })
  }

  async findPlayerById(id: string): Promise<StoredPlayer | undefined> {
    const filters: PlayerDoc['_id'][] = [id]
    if (ObjectId.isValid(id)) filters.push(new ObjectId(id))

    const doc = await this.players.findOne({ _id: { $in: filters } })
    return doc === null ? undefined : toStoredPlayer(doc)
  }

  async findPlayerByUsername(username: string): Promise<StoredPlayer | undefined> {
    // Java compared usernames case-insensitively at the Mongo layer too
    // (`DBQuery.is` on a lower-cased field did not exist, but the JSON
    // repository does a case-insensitive scan — match that here).
    const doc = await this.players.findOne({
      username: { $regex: `^${escapeRegExp(username)}$`, $options: 'i' },
    })
    return doc === null ? undefined : toStoredPlayer(doc)
  }

  async allPlayers(): Promise<readonly StoredPlayer[]> {
    const docs = await this.players.find().toArray()
    return docs.map(toStoredPlayer)
  }

  async updatePlayerPassword(id: string, passwordHash: string): Promise<void> {
    const filters: PlayerDoc['_id'][] = [id]
    if (ObjectId.isValid(id)) filters.push(new ObjectId(id))
    await this.players.updateOne({ _id: { $in: filters } }, { $set: { password: passwordHash } })
  }

  async updatePlayer(id: string, changes: PlayerUpdate): Promise<StoredPlayer | undefined> {
    const filters: PlayerDoc['_id'][] = [id]
    if (ObjectId.isValid(id)) filters.push(new ObjectId(id))

    const set: Record<string, unknown> = {}
    if (changes.username !== undefined) set['username'] = changes.username
    if (changes.email !== undefined) set['email'] = changes.email
    if (changes.role !== undefined) set['role'] = changes.role
    if (changes.disabled !== undefined) set['disabled'] = changes.disabled
    await this.players.updateOne({ _id: { $in: filters } }, { $set: set })
    return this.findPlayerById(id)
  }

  async deletePlayer(id: string): Promise<boolean> {
    const filters: PlayerDoc['_id'][] = [id]
    if (ObjectId.isValid(id)) filters.push(new ObjectId(id))
    const result = await this.players.deleteOne({ _id: { $in: filters } })
    return result.deletedCount > 0
  }

  // ---------------------------------------------------------------------
  // Games — `game_state` only, never `pbf`
  // ---------------------------------------------------------------------

  async saveGame(game: GameState): Promise<void> {
    // Mongo takes the `_id` from the filter on an upsert insert; the
    // replacement document itself must not repeat it.
    await this.games.replaceOne({ _id: game.id }, game, { upsert: true })
  }

  async findGame(id: string): Promise<GameState | undefined> {
    const doc = await this.games.findOne({ _id: id })
    return doc === null ? undefined : migrateGameState(stripMongoId(doc))
  }

  async allGames(): Promise<readonly GameState[]> {
    const docs = await this.games.find().toArray()
    return docs.map((doc) => migrateGameState(stripMongoId(doc)))
  }

  async deleteGame(id: string): Promise<boolean> {
    const result = await this.games.deleteOne({ _id: id })
    return result.deletedCount > 0
  }

  // ---------------------------------------------------------------------
  // Chat
  // ---------------------------------------------------------------------

  async appendChat(message: ChatMessage): Promise<void> {
    await this.chat.insertOne({
      _id: message.id,
      pbfId: message.gameId,
      username: message.username,
      message: message.message,
      createdAt: message.createdAt,
    })
  }

  async chatFor(gameId: string | null): Promise<readonly ChatMessage[]> {
    // No `.sort()` at the Mongo level: old `_id`s are ObjectIds (chronological)
    // and new ones are UUIDs (not), so the only reliable order is the
    // `createdAt` sort done below, in memory, after both shapes are mapped.
    const docs = await this.chat.find({ pbfId: gameId }).toArray()
    return docs
      .map((doc): ChatMessage | undefined => {
        const createdAt =
          doc.createdAt ?? (doc.created !== undefined ? isoFromLegacyCreated(doc.created) : undefined)
        if (createdAt === undefined) return undefined
        return {
          id: doc._id.toString(),
          gameId: doc.pbfId,
          username: doc.username,
          message: doc.message,
          createdAt,
        }
      })
      .filter((message): message is ChatMessage => message !== undefined)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  // ---------------------------------------------------------------------
  // Highscore
  // ---------------------------------------------------------------------

  async finishedGamesForHighscore(): Promise<readonly FinishedGame[]> {
    const [oldGames, newGames] = await Promise.all([
      this.pbf.find({ active: false, winner: { $exists: true, $ne: null } }).toArray(),
      this.games.find({ active: false, winner: { $exists: true, $ne: null } }).toArray(),
    ])

    const summaries: FinishedGame[] = []

    for (const pbf of oldGames) {
      if (pbf.winner === null || pbf.winner === undefined || pbf.winner === '') continue
      summaries.push({
        numOfPlayers: pbf.numOfPlayers,
        winner: pbf.winner,
        players: (pbf.players ?? []).map((player) => ({
          username: player.username,
          civName: player.civilization?.name ?? null,
        })),
      })
    }

    for (const game of newGames) {
      if (game.winner === null || game.winner === '') continue
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

  /** No-op: every write above goes straight to Mongo. */
  async flush(): Promise<void> {
    // Nothing to flush; there is no in-memory buffer to mirror.
  }
}

function toStoredPlayer(doc: PlayerDoc): StoredPlayer {
  return {
    id: doc._id.toString(),
    username: doc.username,
    email: doc.email ?? null,
    passwordHash: doc.password,
    createdAt: doc.createdAt ?? objectIdTimestamp(doc._id),
    role: doc.role === 'admin' ? 'admin' : 'user',
    disabled: doc.disabled === true,
  }
}

function objectIdTimestamp(id: string | ObjectId): string {
  return typeof id === 'string' ? new Date(0).toISOString() : id.getTimestamp().toISOString()
}

function stripMongoId(doc: GameState & { _id: string }): GameState {
  const { _id, ...game } = doc
  return game
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
