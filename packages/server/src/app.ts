/**
 * The Fastify app. Java: `CivilizationApplication` under Dropwizard.
 */

import cors from '@fastify/cors'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

import { TokenSigner } from './auth.js'
import type { AppContext } from './context.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerBoardRoutes } from './routes/board.js'
import { registerGameRoutes } from './routes/games.js'
import { registerPlayRoutes } from './routes/play.js'
import { JsonFileRepository } from './store/json-file.js'
import type { Repository } from './store/types.js'

export interface CreateAppOptions {
  readonly repo: Repository
  readonly tokenSecret: string
  readonly logger?: boolean
  /** Origins the client may call from. `true` lets everything through. */
  // Not readonly string[]: @fastify/cors wants a mutable array
  readonly corsOrigin?: string | string[] | true
}

export async function createApp(options: CreateAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false })

  await app.register(cors, {
    origin: options.corsOrigin ?? true,
    credentials: true,
  })

  const context: AppContext = {
    repo: options.repo,
    tokens: new TokenSigner(options.tokenSecret),
  }

  app.get('/api/health', async () => ({ status: 'ok' }))

  registerAuthRoutes(app, context)
  registerGameRoutes(app, context)
  registerPlayRoutes(app, context)
  registerBoardRoutes(app, context)

  return app
}

/** Convenience for tests: an app backed by memory alone, with no file. */
export async function createTestApp(): Promise<{
  app: FastifyInstance
  repo: JsonFileRepository
}> {
  const repo = new JsonFileRepository({ filePath: null })
  const app = await createApp({ repo, tokenSecret: 'test-secret', logger: false })
  return { app, repo }
}
