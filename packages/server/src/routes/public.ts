/**
 * Routes that need no bearer token. The response types deliberately contain
 * only information the lobby already exposes to every visitor.
 */

import type { Context } from 'hono'

import type { App } from '../app.js'
import type { AppContext, Variables } from '../context.js'
import { toPublicSummary } from './games.js'

async function optionalViewerId(
  c: Context<{ Variables: Variables }>,
  context: AppContext,
): Promise<string | undefined> {
  const header = c.req.header('authorization')
  if (header === undefined || !header.startsWith('Bearer ')) return undefined
  const payload = context.tokens.verify(header.slice('Bearer '.length))
  if (payload === undefined) return undefined
  const player = await context.repo.findPlayerById(payload.playerId)
  return player?.disabled === true ? undefined : player?.id
}

// The lobby chat window is ~3 months. The old client showed 14 days capped at
// 50 messages; the web pager now bounds what is displayed, so the route returns
// every message in the window, newest first.
const PUBLIC_CHAT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000

export function registerPublicRoutes(app: App, context: AppContext): void {
  app.get('/api/public/games', async (c) => {
    const games = await context.repo.allGames()
    const viewerId = await optionalViewerId(c, context)
    return c.json(
      [...games]
        .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
        .map((game) => toPublicSummary(game, viewerId)),
    )
  })

  app.get('/api/highscore', async (c) => {
    return c.json(await context.repo.cachedHighscore())
  })

  app.get('/api/chat', async (c) => {
    const cutoff = Date.now() - PUBLIC_CHAT_MAX_AGE_MS
    const messages = await context.repo.chatFor(null)
    return c.json(
      messages
        .filter((message) => Date.parse(message.createdAt) >= cutoff)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    )
  })
}
