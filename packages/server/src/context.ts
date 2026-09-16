/**
 * The bits every route builds on: the signed-in player, loading and saving a
 * game, and wrapping the engine `Result` in an HTTP response.
 */

import type { EngineError, GameState, PlayerView } from '@civ/engine'
import { toPlayerView } from '@civ/engine'
import type { FastifyReply, FastifyRequest } from 'fastify'

import type { TokenSigner } from './auth.js'
import { sendEngineError, sendError } from './errors.js'
import type { Repository, StoredPlayer } from './store/types.js'

export interface AppContext {
  readonly repo: Repository
  readonly tokens: TokenSigner
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `authenticate` once the Authorization header checks out. */
    player?: StoredPlayer
  }
}

/** Requires a valid bearer token and puts the player on the request. */
export function authenticateWith(context: AppContext) {
  return async function authenticate(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const header = request.headers.authorization
    if (header === undefined || !header.startsWith('Bearer ')) {
      await sendError(reply, 401, 'UNAUTHORIZED', 'Missing bearer token')
      return
    }

    const payload = context.tokens.verify(header.slice('Bearer '.length))
    if (payload === undefined) {
      await sendError(reply, 401, 'UNAUTHORIZED', 'Invalid or expired token')
      return
    }

    const player = await context.repo.findPlayerById(payload.playerId)
    if (player === undefined) {
      await sendError(reply, 401, 'UNAUTHORIZED', 'Unknown player')
      return
    }

    request.player = player
  }
}

/** The signed-in player. Only call this from routes running `authenticate`. */
export function currentPlayer(request: FastifyRequest): StoredPlayer {
  const player = request.player
  if (player === undefined) {
    throw new Error('currentPlayer called without the authenticate preHandler')
  }
  return player
}

/**
 * Runs an engine action against a stored game: load, call, save, and answer
 * with the player's own view of the new state.
 */
export async function applyToGame(
  context: AppContext,
  request: FastifyRequest,
  reply: FastifyReply,
  gameId: string,
  action: (state: GameState) => { ok: true; value: GameState } | { ok: false; error: EngineError },
): Promise<FastifyReply> {
  const game = await context.repo.findGame(gameId)
  if (game === undefined) {
    return sendError(reply, 404, 'GAME_NOT_FOUND', `No game with id ${gameId}`)
  }

  const result = action(game)
  if (!result.ok) return sendEngineError(reply, result.error)

  const now = new Date().toISOString()
  const previousLogIds = new Set(game.log.map((entry) => entry.id))
  const stamped: GameState = {
    ...result.value,
    log: result.value.log.map((entry) =>
      previousLogIds.has(entry.id) || entry.createdAt !== null
        ? entry
        : { ...entry, createdAt: now },
    ),
  }

  await context.repo.saveGame(stamped)
  return reply.send(toPlayerView(stamped, currentPlayer(request).id))
}

/** Reads a game and answers with the player's view, changing nothing. */
export async function readGame(
  context: AppContext,
  request: FastifyRequest,
  reply: FastifyReply,
  gameId: string,
  project: (state: GameState, viewerId: string) => unknown = toPlayerView,
): Promise<FastifyReply> {
  const game = await context.repo.findGame(gameId)
  if (game === undefined) {
    return sendError(reply, 404, 'GAME_NOT_FOUND', `No game with id ${gameId}`)
  }
  return reply.send(project(game, request.player?.id ?? ''))
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
