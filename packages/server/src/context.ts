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
import type { GameRevision, Repository, StoredPlayer } from './store/types.js'

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

export function createGameRevision(
  before: GameState | undefined,
  state: GameState,
  actor: StoredPlayer,
  createdAt: string,
  fallbackDescription: string,
): GameRevision {
  const previousIds = new Set(before?.log.map((entry) => entry.id) ?? [])
  const entries = state.log.filter((entry) => !previousIds.has(entry.id))
  const publicDescription = entries
    .map((entry) => entry.publicLog)
    .filter((description) => description !== '')
    .join(' · ') || fallbackDescription
  const privateDescriptions: Record<string, string> = {}
  for (const entry of entries) {
    if (entry.playerId === null || entry.privateLog === '') continue
    privateDescriptions[entry.playerId] = [privateDescriptions[entry.playerId], entry.privateLog]
      .filter((description): description is string => description !== undefined && description !== '')
      .join(' · ')
  }
  return {
    gameId: state.id,
    revision: state.rev,
    createdAt,
    actor: { playerId: actor.id, username: actor.username },
    publicDescription,
    privateDescriptions,
    logIds: entries.map((entry) => entry.id),
    // Private planning notes are deliberately outside revision capture. Blank
    // both active and withdrawn hands before the immutable snapshot is stored.
    state: {
      ...state,
      players: state.players.map((player) => ({ ...player, gamenote: '' })),
      withdrawnPlayers: state.withdrawnPlayers.map((player) => ({ ...player, gamenote: '' })),
    },
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
  revisionOptions: { readonly record?: boolean; readonly description?: string } = {},
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
  const now = new Date().toISOString()
  const stamped = stampLog({ ...result.value, rev: game.rev + 1 }, now)

  if (revisionOptions.record === false) {
    await context.repo.saveGame(stamped)
  } else {
    const actor = currentPlayer(c)
    await context.repo.ensureGameRevision(
      createGameRevision(undefined, game, actor, now, 'History starts here'),
    )
    const saved = await context.repo.saveGameWithRevision(
      stamped,
      createGameRevision(
        game,
        stamped,
        actor,
        now,
        revisionOptions.description ?? 'Game state updated',
      ),
      game.rev,
    )
    if (!saved) {
      return sendError(
        c,
        409,
        'CONFLICT',
        `Game was modified concurrently (expected rev ${game.rev}). Reload and retry.`,
      )
    }
  }
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
