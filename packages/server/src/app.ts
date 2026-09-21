/**
 * The Hono app. Java: `CivilizationApplication` under Dropwizard.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'

import { ResetTokenSigner, TokenSigner } from './auth.js'
import type { AppContext, Variables } from './context.js'
import { sendError } from './errors.js'
import type { Mailer } from './mail.js'
import { noopMailer } from './mail.js'
import { DEFAULT_APP_ORIGIN, createNotifications } from './notifications.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerAdminRoutes } from './routes/admin.js'
import { registerArenaRoutes } from './routes/arena.js'
import { registerBoardRoutes } from './routes/board.js'
import { registerGameRoutes } from './routes/games.js'
import { registerNotificationRoutes } from './routes/notifications.js'
import { registerPlayRoutes } from './routes/play.js'
import { registerPublicRoutes } from './routes/public.js'
import { JsonFileRepository } from './store/json-file.js'
import type { Repository } from './store/types.js'

export interface CreateAppOptions {
  readonly repo: Repository
  readonly tokenSecret: string
  readonly logger?: boolean
  /** Origins the client may call from. `true` lets everything through. */
  readonly corsOrigin?: string | string[] | true
  /**
   * Outgoing email. Defaults to a no-op, so tests and local development never
   * reach a provider. The Node entry builds a Resend mailer from the
   * environment.
   */
  readonly mailer?: Mailer
  /** Absolute base URL of the web app, used in email links. */
  readonly appOrigin?: string
  /** Injectable clock for the notification cooldowns; for tests. */
  readonly now?: () => Date
}

export type App = Hono<{ Variables: Variables }>

export function createApp(options: CreateAppOptions): App {
  const app: App = new Hono<{ Variables: Variables }>()

  if (options.logger === true) {
    app.use('*', logger())
  }

  const corsOrigin = options.corsOrigin ?? true
  app.use(
    '/api/*',
    cors({
      origin: corsOrigin === true ? (origin) => origin ?? '*' : corsOrigin,
      credentials: true,
    }),
  )

  // Reject a malformed JSON body with 400 before any handler runs, as Fastify
  // did. Without this a bad body silently falls back to `{}` and a route whose
  // fields are all optional would mutate state from an invalid request. Empty
  // bodies and non-JSON requests are left alone (handlers default them to `{}`).
  app.use('/api/*', async (c, next) => {
    const contentType = c.req.header('content-type')
    if (contentType !== undefined && contentType.includes('application/json')) {
      try {
        // Hono caches the parsed result, so the handler's own c.req.json() reuses
        // this without re-reading the body stream.
        await c.req.json()
      } catch {
        return sendError(c, 400, 'INVALID_JSON', 'Request body is not valid JSON')
      }
    }
    await next()
  })

  const appOrigin = (options.appOrigin ?? DEFAULT_APP_ORIGIN).replace(/\/+$/, '')
  const context: AppContext = {
    repo: options.repo,
    tokens: new TokenSigner(options.tokenSecret),
    resetTokens: new ResetTokenSigner(options.tokenSecret),
    notifications: createNotifications({
      repo: options.repo,
      mailer: options.mailer ?? noopMailer,
      appOrigin,
      ...(options.now !== undefined ? { now: options.now } : {}),
    }),
    appOrigin,
  }

  // Answer unmatched routes and unhandled throws with the same { error, message }
  // shape every other error uses, so the client parser never chokes on plain text.
  app.notFound((c) => sendError(c, 404, 'NOT_FOUND', `No route for ${c.req.method} ${c.req.path}`))
  app.onError((error, c) => {
    console.error(error)
    return sendError(c, 500, 'INTERNAL_ERROR', 'Something went wrong')
  })

  app.get('/api/health', (c) => c.json({ status: 'ok' }))

  registerAuthRoutes(app, context)
  registerAdminRoutes(app, context)
  registerGameRoutes(app, context)
  registerPlayRoutes(app, context)
  registerArenaRoutes(app, context)
  registerBoardRoutes(app, context)
  registerPublicRoutes(app, context)
  registerNotificationRoutes(app, context)

  return app
}

export type TestAppOptions = Omit<CreateAppOptions, 'repo' | 'tokenSecret' | 'logger'>

/** Convenience for tests: an app backed by memory alone, with no file. */
export async function createTestApp(
  options: TestAppOptions = {},
): Promise<{
  app: App
  repo: JsonFileRepository
}> {
  const repo = new JsonFileRepository({ filePath: null })
  const app = createApp({ repo, tokenSecret: 'test-secret', logger: false, ...options })
  return { app, repo }
}
