/**
 * Routes that need no bearer token. The response types deliberately contain
 * only information the lobby already exposes to every visitor.
 */

import { highscore } from '@civ/engine'
import type { FastifyInstance, FastifyRequest } from 'fastify'

import type { AppContext } from '../context.js'
import { toPublicSummary } from './games.js'

async function optionalViewerId(request: FastifyRequest, context: AppContext): Promise<string | undefined> {
  const header = request.headers.authorization
  if (header === undefined || !header.startsWith('Bearer ')) return undefined
  const payload = context.tokens.verify(header.slice('Bearer '.length))
  if (payload === undefined) return undefined
  const player = await context.repo.findPlayerById(payload.playerId)
  return player?.disabled === true ? undefined : player?.id
}

const PUBLIC_CHAT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

export function registerPublicRoutes(app: FastifyInstance, context: AppContext): void {
  app.get('/api/public/games', async (request, reply) => {
    const games = await context.repo.allGames()
    const viewerId = await optionalViewerId(request, context)
    return reply.send(
      [...games]
        .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
        .map((game) => toPublicSummary(game, viewerId)),
    )
  })

  app.get('/api/highscore', async (_request, reply) => {
    const [games, players] = await Promise.all([
      context.repo.finishedGamesForHighscore(),
      context.repo.allPlayers(),
    ])
    return reply.send(
      highscore(
        games,
        players.map((player) => player.username),
      ),
    )
  })

  app.get('/api/chat', async (_request, reply) => {
    const cutoff = Date.now() - PUBLIC_CHAT_MAX_AGE_MS
    const messages = await context.repo.chatFor(null)
    return reply.send(
      messages
        .filter((message) => Date.parse(message.createdAt) >= cutoff)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(-50),
    )
  })
}
