/**
 * Port of the game-list part of `resource/GameResource.java`: create, list,
 * join, withdraw, end, chat.
 */

import type { GameState } from '@civ/engine'
import {
  allRevealedItems,
  createGame,
  endGame,
  joinGame,
  toPlayerView,
  withdrawFromGame,
} from '@civ/engine'
import type { FastifyInstance } from 'fastify'

import { newId } from '../auth.js'
import type { AppContext } from '../context.js'
import {
  applyToGame,
  asRecord,
  authenticateWith,
  currentPlayer,
  optionalNumber,
  optionalString,
  readGame,
  requireString,
  stampLog,
} from '../context.js'
import { sendEngineError, sendError } from '../errors.js'
import type { ChatMessage } from '../store/types.js'

/** The summary the game list shows. Java: `PbfDTO`. */
export interface GameSummary {
  readonly id: string
  readonly name: string
  readonly gameType: string
  readonly numOfPlayers: number
  readonly active: boolean
  readonly winner: string | null
  readonly players: readonly { readonly username: string; readonly color: string | null }[]
  readonly nameOfUsersTurn: string
  readonly youAreIn: boolean
}

/** The public lobby summary. It deliberately has no viewer-specific fields. */
export interface PublicGameSummary {
  readonly id: string
  readonly name: string
  readonly gameType: string
  readonly numOfPlayers: number
  readonly active: boolean
  readonly winner: string | null
  readonly players: readonly { readonly username: string; readonly color: string | null }[]
  readonly nameOfUsersTurn: string
}

function toSummary(game: GameState, viewerId: string): GameSummary {
  return {
    id: game.id,
    name: game.name,
    gameType: game.gameType,
    numOfPlayers: game.numOfPlayers,
    active: game.active,
    winner: game.winner,
    players: game.players.map((player) => ({
      username: player.username,
      color: player.color,
    })),
    nameOfUsersTurn: game.players.find((player) => player.yourTurn)?.username ?? '',
    youAreIn: game.players.some((player) => player.playerId === viewerId),
  }
}

export function toPublicSummary(game: GameState): PublicGameSummary {
  return {
    id: game.id,
    name: game.name,
    gameType: game.gameType,
    numOfPlayers: game.numOfPlayers,
    active: game.active,
    winner: game.winner,
    players: game.players.map((player) => ({
      username: player.username,
      color: player.color,
    })),
    nameOfUsersTurn: game.players.find((player) => player.yourTurn)?.username ?? '',
  }
}

export function registerGameRoutes(app: FastifyInstance, context: AppContext): void {
  const authenticate = authenticateWith(context)
  const auth = { preHandler: authenticate }

  app.get('/api/games', auth, async (request, reply) => {
    const games = await context.repo.allGames()
    const me = currentPlayer(request).id
    return reply.send(
      [...games]
        .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
        .map((game) => toSummary(game, me)),
    )
  })

  /** Java: `GameResource.createGame` with `CreateNewGameDTO`. */
  app.post('/api/games', auth, async (request, reply) => {
    const body = asRecord(request.body)
    const name = requireString(body, 'name')
    const numOfPlayers = optionalNumber(body, 'numOfPlayers') ?? 4
    const color = optionalString(body, 'color')

    if (name === undefined) {
      return sendError(reply, 400, 'BAD_REQUEST', 'name is required')
    }
    if (numOfPlayers < 2 || numOfPlayers > 5) {
      return sendError(reply, 400, 'BAD_REQUEST', 'numOfPlayers must be between 2 and 5')
    }

    const existing = await context.repo.allGames()
    // Java had a unique index on pbf.name
    if (existing.some((game) => game.name.toLowerCase() === name.toLowerCase())) {
      return sendError(reply, 409, 'GAME_EXISTS', `A game named ${name} already exists`)
    }

    const me = currentPlayer(request)
    // Java: @Min(2) @Max(5) on CreateNewGameDTO.numOfPlayers
    const empty = createGame({
      name,
      numOfPlayers,
      // The seed decides the shuffle and the itemNumbers. A random id per game
      // keeps two games with the same name from getting the same deck.
      seed: `${name}:${newId()}`,
      players: [],
    })

    // Java: createNewGame finished with joinGame(..., gameCreator = true).
    // Going through joinGame rather than seating the creator directly is what
    // gives them a colour, and it calls startIfAllPlayers, without which a
    // two-seat game would never start.
    const joined = joinGame(empty, {
      playerId: me.id,
      username: me.username,
      ...(me.email !== null ? { email: me.email } : {}),
      ...(color !== undefined ? { color } : {}),
      gameCreator: true,
    })
    if (!joined.ok) return sendEngineError(reply, joined.error)

    // `joinGame` is called directly rather than through `applyToGame`, so the
    // "joined / game started" log entries never pass through the stamping
    // there and would otherwise keep `createdAt: null` forever.
    const stamped = stampLog(joined.value, new Date().toISOString())

    await context.repo.saveGame(stamped)
    return reply.code(201).send(toSummary(stamped, me.id))
  })

  app.get('/api/games/:gameId', auth, async (request, reply) => {
    const { gameId } = request.params as { gameId: string }
    return readGame(context, request, reply, gameId)
  })

  /** Java: `GameResource.joinGame`. */
  app.post('/api/games/:gameId/join', auth, async (request, reply) => {
    const { gameId } = request.params as { gameId: string }
    const color = optionalString(asRecord(request.body), 'color')
    const me = currentPlayer(request)

    return applyToGame(context, request, reply, gameId, (state) =>
      joinGame(state, {
        playerId: me.id,
        username: me.username,
        ...(me.email !== null ? { email: me.email } : {}),
        ...(color !== undefined ? { color } : {}),
      }),
    )
  })

  app.post('/api/games/:gameId/withdraw', auth, async (request, reply) => {
    const { gameId } = request.params as { gameId: string }
    return applyToGame(context, request, reply, gameId, (state) =>
      withdrawFromGame(state, currentPlayer(request).id),
    )
  })

  app.post('/api/games/:gameId/end', auth, async (request, reply) => {
    const { gameId } = request.params as { gameId: string }
    const winner = optionalString(asRecord(request.body), 'winner')
    const me = currentPlayer(request)

    return applyToGame(context, request, reply, gameId, (state) =>
      endGame(state, {
        playerId: me.id,
        // The engine still carries Java's username-shaped admin escape hatch;
        // authorization is decided here from the persisted role.
        username: me.role === 'admin' ? 'admin' : me.username,
        ...(winner !== undefined ? { winner } : {}),
      }),
    )
  })

  app.post('/api/games/:gameId/delete', auth, async (request, reply) => {
    const { gameId } = request.params as { gameId: string }
    const game = await context.repo.findGame(gameId)
    if (game === undefined) {
      return sendError(reply, 404, 'GAME_NOT_FOUND', `No game with id ${gameId}`)
    }

    const me = currentPlayer(request)
    const isCreator = game.players.some(
      (player) => player.playerId === me.id && player.gameCreator,
    )
    if (!isCreator && me.role !== 'admin') {
      return sendError(reply, 403, 'NO_ACCESS', 'Only the game creator or admin can delete a game')
    }

    const deleted = await context.repo.deleteGame(gameId)
    if (!deleted) {
      return sendError(reply, 404, 'GAME_NOT_FOUND', `No game with id ${gameId}`)
    }
    return reply.code(204).send()
  })

  /** Java: `GameAction.getAllRevealedItems` — what the iframe spreadsheet showed. */
  app.get('/api/games/:gameId/revealed', auth, async (request, reply) => {
    const { gameId } = request.params as { gameId: string }
    return readGame(context, request, reply, gameId, (state) => allRevealedItems(state))
  })

  /**
   * Sorts newest first by timestamp, then by the entry's original position in
   * `state.log` (a later position is newer — the engine appends
   * chronologically). The index tiebreak matters because a stable sort on
   * `createdAt` alone reads oldest-first for same-second or legacy-null
   * entries: `Array.prototype.sort` keeps their relative order, which is the
   * insertion order, i.e. oldest first.
   */
  function newestFirst<T extends { readonly createdAt: string | null }>(
    entries: readonly T[],
  ): T[] {
    return entries
      .map((entry, index) => ({ entry, index }))
      .sort(
        (a, b) =>
          (b.entry.createdAt ?? '').localeCompare(a.entry.createdAt ?? '') || b.index - a.index,
      )
      .map(({ entry }) => entry)
  }

  /** Java: `/{pbfId}/publiclog`. */
  app.get('/api/games/:gameId/log/public', auth, async (request, reply) => {
    const { gameId } = request.params as { gameId: string }
    return readGame(context, request, reply, gameId, (state) =>
      newestFirst(
        state.log
          .filter((entry) => entry.publicLog !== '')
          .map((entry) => ({
            id: entry.id,
            username: entry.username,
            logType: entry.logType,
            message: entry.publicLog,
            createdAt: entry.createdAt,
            hasUndo: entry.undo !== null,
          })),
      ),
    )
  })

  /** Java: `/{pbfId}/privatelog` — the player's own entries only. */
  app.get('/api/games/:gameId/log/private', auth, async (request, reply) => {
    const { gameId } = request.params as { gameId: string }
    return readGame(context, request, reply, gameId, (state, viewerId) =>
      newestFirst(
        state.log
          .filter((entry) => entry.playerId === viewerId && entry.privateLog !== '')
          .map((entry) => ({
            id: entry.id,
            username: entry.username,
            logType: entry.logType,
            message: entry.privateLog,
            createdAt: entry.createdAt,
            hasUndo: entry.undo !== null,
            canUndo: entry.item !== null && entry.undo === null,
          })),
      ),
    )
  })

  // -------------------------------------------------------------------------
  // Chat. Java stored this in its own Mongo collection rather than on the
  // game, and it carries no game rules — so it lives here, not in the engine.
  // -------------------------------------------------------------------------

  app.get('/api/games/:gameId/chat', auth, async (request, reply) => {
    const { gameId } = request.params as { gameId: string }
    return reply.send(await context.repo.chatFor(gameId))
  })

  app.post('/api/games/:gameId/chat', auth, async (request, reply) => {
    const { gameId } = request.params as { gameId: string }
    const message = requireString(asRecord(request.body), 'message')
    if (message === undefined) {
      return sendError(reply, 400, 'BAD_REQUEST', 'message is required')
    }

    const game = await context.repo.findGame(gameId)
    if (game === undefined) {
      return sendError(reply, 404, 'GAME_NOT_FOUND', `No game with id ${gameId}`)
    }

    const me = currentPlayer(request)
    const entry: ChatMessage = {
      id: newId(),
      gameId,
      username: me.username,
      message,
      createdAt: new Date().toISOString(),
    }
    await context.repo.appendChat(entry)
    return reply.code(201).send(entry)
  })

  /** Java: `/publicchat` — posting remains authenticated. */
  app.post('/api/chat', auth, async (request, reply) => {
    const message = requireString(asRecord(request.body), 'message')
    if (message === undefined) {
      return sendError(reply, 400, 'BAD_REQUEST', 'message is required')
    }
    const entry: ChatMessage = {
      id: newId(),
      gameId: null,
      username: currentPlayer(request).username,
      message,
      createdAt: new Date().toISOString(),
    }
    await context.repo.appendChat(entry)
    return reply.code(201).send(entry)
  })

  /** Exposed so the client does not have to derive it from the player view. */
  app.get('/api/games/:gameId/state', auth, async (request, reply) => {
    const { gameId } = request.params as { gameId: string }
    const game = await context.repo.findGame(gameId)
    if (game === undefined) {
      return sendError(reply, 404, 'GAME_NOT_FOUND', `No game with id ${gameId}`)
    }
    return reply.send(toPlayerView(game, currentPlayer(request).id))
  })
}
