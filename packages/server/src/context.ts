/**
 * The bits every route builds on: the signed-in player, loading and saving a
 * game, and wrapping the engine `Result` in an HTTP response.
 */

import type { EngineError, GameState, PlayerView } from '@civ/engine'
import { hasUserAccess, toPlayerView } from '@civ/engine'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'

import type { TokenSigner } from './auth.js'
import { sendEngineError, sendError } from './errors.js'
import type { Repository, StoredPlayer } from './store/types.js'

export interface AppContext {
  readonly repo: Repository
  readonly tokens: TokenSigner
}

/** The Hono context variables set once `authenticate` has run. */
export type Variables = { player: StoredPlayer }

/** Requires a valid bearer token and puts the player on the context. */
export function authenticateWith(context: AppContext) {
  return createMiddleware<{ Variables: Variables }>(async (c, next) => {
    const header = c.req.header('authorization')
    if (header === undefined || !header.startsWith('Bearer ')) {
      return sendError(c, 401, 'UNAUTHORIZED', 'Missing bearer token')
    }

    const payload = context.tokens.verify(header.slice('Bearer '.length))
    if (payload === undefined) {
      return sendError(c, 401, 'UNAUTHORIZED', 'Invalid or expired token')
    }

    const player = await context.repo.findPlayerById(payload.playerId)
    if (player === undefined) {
      return sendError(c, 401, 'UNAUTHORIZED', 'Unknown player')
    }

    if (player.disabled === true) {
      return sendError(c, 403, 'ACCOUNT_DISABLED', 'This account is disabled')
    }

    c.set('player', player)
    await next()
  })
}

/** Requires a valid, currently enabled account with the persisted admin role. */
export function requireAdminWith(context: AppContext) {
  const authenticate = authenticateWith(context)
  return createMiddleware<{ Variables: Variables }>(async (c, next) => {
    const result = await authenticate(c, async () => undefined)
    if (result !== undefined) return result
    if (currentPlayer(c).role !== 'admin') {
      return sendError(c, 403, 'ADMIN_REQUIRED', 'Only admins may manage users')
    }
    await next()
  })
}

/** The signed-in player. Only call this from routes running `authenticate`. */
export function currentPlayer(c: Context<{ Variables: Variables }>): StoredPlayer {
  const player = c.get('player')
  if (player === undefined) {
    throw new Error('currentPlayer called without the authenticate middleware')
  }
  return player
}

/**
 * Stamps every log entry that has no timestamp yet with `now`. The engine is
 * pure and cannot call the clock itself, so it appends entries with
 * `createdAt: null`; the server is the one place allowed to know the time.
 * Entries that already carry a timestamp are left untouched.
 */
export function stampLog(state: GameState, now: string): GameState {
  return {
    ...state,
    log: state.log.map((entry) =>
      entry.createdAt === null ? { ...entry, createdAt: now } : entry,
    ),
  }
}

/**
 * Requires the caller to be a player in the game before anything else runs.
 * The engine's `endTurn` deliberately lets anyone with the turn pass it on
 * (Java's authorisation lived in the resource layer), so membership is
 * enforced here, at the route.
 */
export async function requireMembership(
  context: AppContext,
  c: Context<{ Variables: Variables }>,
  gameId: string,
): Promise<GameState | Response> {
  const game = await context.repo.findGame(gameId)
  if (game === undefined) {
    return sendError(c, 404, 'GAME_NOT_FOUND', `No game with id ${gameId}`)
  }
  if (!hasUserAccess(game, currentPlayer(c).id)) {
    return sendError(c, 403, 'NO_ACCESS', 'User is not player of this game')
  }
  return game
}

/**
 * Runs an engine action against a stored game: load, call, save, and answer
 * with the player's own view of the new state.
 *
 * `clientRev` is optional. When supplied, it must match the stored game's
 * `rev` counter; if it does not, a 409 Conflict is returned before the action
 * runs. This prevents last-write-wins data loss when two players act on the
 * same object simultaneously (most relevant to the battle arena).
 *
 * `rev` is always incremented on every successful write.
 */
export async function applyToGame(
  context: AppContext,
  c: Context<{ Variables: Variables }>,
  gameId: string,
  action: (state: GameState) => { ok: true; value: GameState } | { ok: false; error: EngineError },
  clientRev?: number,
): Promise<Response> {
  const game = await context.repo.findGame(gameId)
  if (game === undefined) {
    return sendError(c, 404, 'GAME_NOT_FOUND', `No game with id ${gameId}`)
  }

  if (clientRev !== undefined && clientRev !== game.rev) {
    return sendError(
      c,
      409,
      'CONFLICT',
      `Game was modified concurrently (expected rev ${clientRev}, got ${game.rev}). Reload and retry.`,
    )
  }

  const result = action(game)
  if (!result.ok) return sendEngineError(c, result.error)

  // Increment rev on every successful write.
  const stamped = stampLog({ ...result.value, rev: game.rev + 1 }, new Date().toISOString())

  await context.repo.saveGame(stamped)
  return c.json(toPlayerView(stamped, currentPlayer(c).id))
}

/** Reads a game and answers with the player's view, changing nothing. */
export async function readGame(
  context: AppContext,
  c: Context<{ Variables: Variables }>,
  gameId: string,
  project: (state: GameState, viewerId: string) => unknown = toPlayerView,
): Promise<Response> {
  const game = await context.repo.findGame(gameId)
  if (game === undefined) {
    return sendError(c, 404, 'GAME_NOT_FOUND', `No game with id ${gameId}`)
  }
  return c.json(project(game, c.get('player')?.id ?? ''))
}

export type { PlayerView }

// ---------------------------------------------------------------------------
// Small validation helpers, so the routes need no schemas
// ---------------------------------------------------------------------------

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

export function requireString(
  body: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = body[key]
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

export function optionalString(
  body: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = body[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

export function optionalNumber(
  body: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = body[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return undefined
}
