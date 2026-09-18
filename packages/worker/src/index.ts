/**
 * Cloudflare Worker for playciv.app — Stage 0 spike.
 *
 * Purpose: prove the two unknowns before porting the real API in Stage 1, and
 * serve the built SPA so the domain shows the app.
 *
 *   1. that the MongoDB driver reaches Atlas from workerd, and
 *   2. that `node:crypto` scrypt (used for password hashing) runs on workerd,
 *
 * The `/api/_spike/*` routes are diagnostic and temporary — they are removed
 * when the real API lands. This file is not meant to be merged to main as-is.
 *
 * Requests to `/api/*` are handled here; everything else is served from the
 * built SPA via the ASSETS binding.
 */

import { randomBytes, scrypt } from 'node:crypto'
import { promisify } from 'node:util'

import { MongoClient } from 'mongodb'

import { PLAYER_COLORS } from '@civ/engine'

interface Env {
  /** The built SPA (packages/web/dist), bound in wrangler.jsonc. */
  readonly ASSETS: Fetcher
  /** MongoDB Atlas connection string. Set as a Worker secret, not in config. */
  readonly MONGO_URL?: string
  /** Database name; defaults to "playciv" like the server. */
  readonly MONGO_DB?: string
  /** HMAC secret for session tokens. Present here only to confirm it is wired. */
  readonly TOKEN_SECRET?: string
}

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>

/** scrypt key length, matching the server's auth module. */
const KEY_LENGTH = 64

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Everything that is not the API is the SPA.
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request)
    }

    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        service: 'playciv-worker',
        // Proves the pure engine package bundles and runs on workerd.
        enginePlayerColors: PLAYER_COLORS.length,
        tokenSecretConfigured: env.TOKEN_SECRET !== undefined,
        time: new Date().toISOString(),
      })
    }

    if (url.pathname === '/api/_spike/scrypt') {
      const start = Date.now()
      const salt = randomBytes(16).toString('hex')
      const derived = await scryptAsync('spike-password', salt, KEY_LENGTH)
      return json({ ok: true, scryptWorks: derived.length === KEY_LENGTH, ms: Date.now() - start })
    }

    if (url.pathname === '/api/_spike/mongo') {
      if (env.MONGO_URL === undefined) {
        return json({ ok: false, error: 'MONGO_URL is not set as a Worker secret' }, 500)
      }
      const client = new MongoClient(env.MONGO_URL)
      try {
        await client.connect()
        const db = client.db(env.MONGO_DB ?? 'playciv')
        const ping = await db.command({ ping: 1 })
        const players = await db.collection('player').estimatedDocumentCount()
        return json({ ok: true, ping, players })
      } catch (error) {
        return json(
          { ok: false, error: error instanceof Error ? error.message : String(error) },
          500,
        )
      } finally {
        await client.close()
      }
    }

    return json({ ok: false, error: 'Not found' }, 404)
  },
}
