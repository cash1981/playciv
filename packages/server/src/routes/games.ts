/**
 * Port av spillistedelen av `resource/GameResource.java`: opprett, list, bli
 * med, trekk seg, avslutt, chat.
 */

import type { GameState } from '@civ/engine'
import {
  allRevealedItems,
  createGame,
  endGame,
  joinGame,
  startIfAllPlayers,
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
} from '../context.js'
import { sendError } from '../errors.js'
import type { ChatMessage } from '../store/types.js'

/** Sammendraget spillisten viser. Java: `PbfDTO`. */
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

  /** Java: `GameResource.createGame` med `CreateNewGameDTO`. */
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
    // Java hadde en unik indeks på pbf.name
    if (existing.some((game) => game.name.toLowerCase() === name.toLowerCase())) {
      return sendError(reply, 409, 'GAME_EXISTS', `A game named ${name} already exists`)
    }

    const me = currentPlayer(request)
    // Java: @Min(2) @Max(5) på CreateNewGameDTO.numOfPlayers
    const created = createGame({
      name,
      numOfPlayers,
      // Seeden avgjør stokking og itemNumber. En tilfeldig id per spill gjør at
      // to spill med samme navn ikke får samme kortstokk.
      seed: `${name}:${newId()}`,
      players: [
        {
          playerId: me.id,
          username: me.username,
          ...(me.email !== null ? { email: me.email } : {}),
          ...(color !== undefined ? { color } : {}),
          gameCreator: true,
        },
      ],
    })

    // Java: createNewGame avsluttet med joinGame(..., gameCreator = true), som
    // kaller startIfAllPlayers. Uten det ville et spill med plass til én aldri
    // startet.
    const game = startIfAllPlayers(created)

    await context.repo.saveGame(game)
    return reply.code(201).send(toSummary(game, me.id))
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
        username: me.username,
        ...(winner !== undefined ? { winner } : {}),
      }),
    )
  })

  /** Java: `GameAction.getAllRevealedItems` — det regnearket i iframe viste. */
  app.get('/api/games/:gameId/revealed', auth, async (request, reply) => {
    const { gameId } = request.params as { gameId: string }
    return readGame(context, request, reply, gameId, (state) => allRevealedItems(state))
  })

  /** Java: `/{pbfId}/publiclog`. */
  app.get('/api/games/:gameId/log/public', auth, async (request, reply) => {
    const { gameId } = request.params as { gameId: string }
    return readGame(context, request, reply, gameId, (state) =>
      state.log
        .filter((entry) => entry.publicLog !== '')
        .map((entry) => ({
          id: entry.id,
          username: entry.username,
          logType: entry.logType,
          message: entry.publicLog,
          hasUndo: entry.undo !== null,
        })),
    )
  })

  /** Java: `/{pbfId}/privatelog` — kun spillerens egne poster. */
  app.get('/api/games/:gameId/log/private', auth, async (request, reply) => {
    const { gameId } = request.params as { gameId: string }
    return readGame(context, request, reply, gameId, (state, viewerId) =>
      state.log
        .filter((entry) => entry.playerId === viewerId && entry.privateLog !== '')
        .map((entry) => ({
          id: entry.id,
          username: entry.username,
          logType: entry.logType,
          message: entry.privateLog,
          hasUndo: entry.undo !== null,
          canUndo: entry.item !== null && entry.undo === null,
        })),
    )
  })

  // -------------------------------------------------------------------------
  // Chat. Java lagret dette i sin egen Mongo-samling, ikke på spillet, og det
  // har ingen spillregler — derfor ligger det her og ikke i motoren.
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

  /** Java: `/publicchat` — lobbyen, uten tilknytning til et spill. */
  app.get('/api/chat', auth, async (_request, reply) =>
    reply.send(await context.repo.chatFor(null)),
  )

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

  /** Eksponert så klienten slipper å utlede den fra spillerens syn. */
  app.get('/api/games/:gameId/state', auth, async (request, reply) => {
    const { gameId } = request.params as { gameId: string }
    const game = await context.repo.findGame(gameId)
    if (game === undefined) {
      return sendError(reply, 404, 'GAME_NOT_FOUND', `No game with id ${gameId}`)
    }
    return reply.send(toPlayerView(game, currentPlayer(request).id))
  })
}
