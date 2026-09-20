/**
 * Cloudflare Worker for playciv.app.
 *
 * Serves the built SPA (`packages/web/dist`) as static assets, and runs the
 * Hono API itself against the D1 binding for every `/api/*` request, so
 * `playciv.app` stays a single origin with no CORS and no second host. This
 * replaced the Render proxy when MongoDB was dropped — D1 queries run on
 * workerd, the MongoDB cursor queries never did. See `docs/agents/decisions.md`.
 *
 * `TOKEN_SECRET` is a runtime secret and required; without it the Worker fails
 * closed rather than handing every isolate a different random secret, which
 * would invalidate sessions on every request. Optional secrets:
 * `RESEND_API_KEY`, `MAIL_FROM`, `APP_ORIGIN`, `MAIL_BROADCAST_NEW_GAMES`.
 */

import type { App } from '@civ/server'
import { D1Repository, createApp, createResendMailer, noopMailer } from '@civ/server'

interface Env {
  /** The built SPA (packages/web/dist), bound in wrangler.jsonc. */
  readonly ASSETS: Fetcher
  /** The D1 database, bound in wrangler.jsonc. */
  readonly DB: D1Database
  /** HMAC secret for session tokens. Required. */
  readonly TOKEN_SECRET?: string
  /** Resend API key. Unset disables notification email, as Java's missing key did. */
  readonly RESEND_API_KEY?: string
  readonly MAIL_FROM?: string
  readonly APP_ORIGIN?: string
  readonly MAIL_BROADCAST_NEW_GAMES?: string
}

// One app per binding. An isolate handles many requests, and the routes are
// stateless, so rebuilding the Hono app on every request is wasted work. Keyed
// by the binding object because `env` itself is not guaranteed to be stable.
const apps = new WeakMap<D1Database, App>()

function buildApp(env: Env): App {
  const mailer =
    env.RESEND_API_KEY === undefined || env.RESEND_API_KEY === ''
      ? noopMailer
      : createResendMailer({
          apiKey: env.RESEND_API_KEY,
          from: env.MAIL_FROM ?? 'noreply@playciv.app',
        })
  return createApp({
    repo: new D1Repository(env.DB),
    tokenSecret: env.TOKEN_SECRET ?? '',
    mailer,
    ...(env.APP_ORIGIN !== undefined ? { appOrigin: env.APP_ORIGIN } : {}),
    broadcastNewGames: env.MAIL_BROADCAST_NEW_GAMES === 'true',
  })
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request)
    }

    if (env.TOKEN_SECRET === undefined || env.TOKEN_SECRET === '') {
      return Response.json(
        {
          error: 'TOKEN_SECRET_NOT_CONFIGURED',
          message: 'The Worker is missing its TOKEN_SECRET secret',
        },
        { status: 503 },
      )
    }

    let app = apps.get(env.DB)
    if (app === undefined) {
      app = buildApp(env)
      apps.set(env.DB, app)
    }
    return app.fetch(request, env, ctx)
  },
}
