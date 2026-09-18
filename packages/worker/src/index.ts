/**
 * Cloudflare Worker for playciv.app.
 *
 * Serves the built SPA (`packages/web/dist`) as static assets, and proxies
 * every `/api/*` request to the Node server (`@civ/server`) running on a
 * separate host, so `playciv.app` stays a single origin with no CORS.
 *
 * The API does not run here: the MongoDB driver's cursor queries hang on the
 * Workers runtime (a `find().toArray()` never returns and the request is
 * cancelled), so the API lives on a Node host that talks to MongoDB Atlas. See
 * `docs/agents/decisions.md`.
 *
 * `API_ORIGIN` is the Node server's base URL (e.g. https://playciv-api.onrender.com),
 * set as a Worker variable in the Cloudflare dashboard.
 */

interface Env {
  /** The built SPA (packages/web/dist), bound in wrangler.jsonc. */
  readonly ASSETS: Fetcher
  /** Base URL of the Node API server. */
  readonly API_ORIGIN?: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request)
    }

    if (env.API_ORIGIN === undefined || env.API_ORIGIN === '') {
      return Response.json(
        { error: 'API_ORIGIN_NOT_CONFIGURED', message: 'The API origin is not configured' },
        { status: 503 },
      )
    }

    const target = env.API_ORIGIN.replace(/\/$/, '') + url.pathname + url.search

    // Drop the inbound Host header so the upstream host routes by its own name;
    // read the body up front to avoid streaming/duplex quirks on small JSON.
    const headers = new Headers(request.headers)
    headers.delete('host')

    const init: RequestInit = { method: request.method, headers }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = await request.arrayBuffer()
    }

    return fetch(target, init)
  },
}
