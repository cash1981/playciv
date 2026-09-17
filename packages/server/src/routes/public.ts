/**
 * Routes that need no bearer token. The response types deliberately contain
 * only information the lobby already exposes to every visitor.
 */

import { highscore } from '@civ/engine'
import type { FastifyInstance } from 'fastify'

import type { AppContext } from '../context.js'
import { toPublicSummary } from './games.js'

export function registerPublicRoutes(app: FastifyInstance, context: AppContext): void {
  app.get('/api/public/games', async (_request, reply) => {
    const games = await context.repo.allGames()
    return reply.send(
      [...games]
        .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
        .map(toPublicSummary),
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

  app.get('/api/chat', async (_request, reply) => reply.send(await context.repo.chatFor(null)))
}
