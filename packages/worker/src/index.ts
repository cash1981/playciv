/**
 * Cloudflare Worker for playciv.app.
 *
 * Serves the API through the same Hono app as the Node server
 * (`@civ/server`), backed by MongoDB, and falls back to the built SPA
 * (`packages/web/dist`) for everything else via the ASSETS binding.
 */

import { createApp, MongoRepository } from '@civ/server'

interface Env {
  /** The built SPA (packages/web/dist), bound in wrangler.jsonc. */
  readonly ASSETS: Fetcher
  /** MongoDB Atlas connection string. Set as a Worker secret, not in config. */
  readonly MONGO_URL?: string
  /** Database name; defaults to "playciv" like the server. */
  readonly MONGO_DB?: string
  /** HMAC secret for session tokens. */
  readonly TOKEN_SECRET?: string
}

let appPromise: Promise<ReturnType<typeof createApp>> | undefined

async function getApp(env: Env): Promise<ReturnType<typeof createApp>> {
  if (appPromise === undefined) {
    appPromise = (async () => {
      if (env.MONGO_URL === undefined) throw new Error('MONGO_URL is not configured')
      // Fail closed: an empty HMAC secret would let anyone forge bearer tokens
      // for any player and read their hidden hand. The Node entry generates a
      // random one; a Worker must be given a real secret.
      if (env.TOKEN_SECRET === undefined || env.TOKEN_SECRET === '') {
        throw new Error('TOKEN_SECRET is not configured')
      }
      const repo = await MongoRepository.connect(env.MONGO_URL, env.MONGO_DB ?? 'playciv')
      return createApp({ repo, tokenSecret: env.TOKEN_SECRET, corsOrigin: true })
    })()
    // A failed first connection must not poison the isolate for its whole life:
    // clear the cache so the next request retries instead of replaying the error.
    appPromise.catch(() => {
      appPromise = undefined
    })
  }
  return appPromise
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request)
    }

    const app = await getApp(env)
    return app.fetch(request, env, ctx)
  },
}
