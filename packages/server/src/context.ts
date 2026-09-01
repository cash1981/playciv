/**
 * Fellesfunksjoner rutene bygger på: innlogget spiller, henting og lagring av
 * spill, og innpakning av motorens `Result` i et HTTP-svar.
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
    /** Satt av `authenticate` når Authorization-hodet holder mål. */
    player?: StoredPlayer
  }
}

/** Krever et gyldig bearer-token og legger spilleren på forespørselen. */
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

/** Den innloggede spilleren. Kall kun i ruter som kjører `authenticate`. */
export function currentPlayer(request: FastifyRequest): StoredPlayer {
  const player = request.player
  if (player === undefined) {
    throw new Error('currentPlayer kalt uten authenticate-preHandler')
  }
  return player
}

/**
 * Kjører en motorhandling mot et lagret spill: hent, kall, lagre, svar med
 * spillerens eget syn på den nye tilstanden.
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

  await context.repo.saveGame(result.value)
  return reply.send(toPlayerView(result.value, currentPlayer(request).id))
}

/** Leser et spill og svarer med spillerens syn, uten å endre noe. */
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
// Små valideringshjelpere, så rutene slipper skjemaer
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
