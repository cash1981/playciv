/**
 * Routes that need no bearer token. Just the highscore for now — Java served
 * it from `GameResource.getPlayerHighScore` / `getCivHighscore`, both public.
 */

import { highscore } from '@civ/engine'
import type { FastifyInstance } from 'fastify'

import type { AppContext } from '../context.js'

export function registerPublicRoutes(app: FastifyInstance, context: AppContext): void {
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
}
