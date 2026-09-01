/**
 * Port av `resource/AuthResource.java`.
 *
 * Ikke portert: `/newpassword` og `/verify/{playerId}`, som sendte e-post med
 * en verifiseringslenke. Det krever en e-posttjeneste og hører til når
 * utsending er på plass igjen.
 */

import type { FastifyInstance } from 'fastify'

import { hashPassword, newId, verifyPassword } from '../auth.js'
import type { AppContext } from '../context.js'
import { asRecord, authenticateWith, currentPlayer, requireString } from '../context.js'
import { sendError } from '../errors.js'
import type { StoredPlayer } from '../store/types.js'

/** Spilleren slik klienten ser den. Passordhashen forlater aldri serveren. */
export interface PlayerDto {
  readonly id: string
  readonly username: string
  readonly email: string | null
}

export const toPlayerDto = (player: StoredPlayer): PlayerDto => ({
  id: player.id,
  username: player.username,
  email: player.email,
})

export function registerAuthRoutes(app: FastifyInstance, context: AppContext): void {
  const authenticate = authenticateWith(context)

  app.post('/api/auth/register', async (request, reply) => {
    const body = asRecord(request.body)
    const username = requireString(body, 'username')
    const password = requireString(body, 'password')
    const email = requireString(body, 'email') ?? null

    if (username === undefined || password === undefined) {
      return sendError(reply, 400, 'BAD_REQUEST', 'username and password are required')
    }
    if (password.length < 4) {
      return sendError(reply, 400, 'BAD_REQUEST', 'password must be at least 4 characters')
    }

    // Java: PlayerExistException, som ble til 409 Conflict
    if ((await context.repo.findPlayerByUsername(username)) !== undefined) {
      return sendError(reply, 409, 'PLAYER_EXISTS', `Username ${username} is taken`)
    }

    const player: StoredPlayer = {
      id: newId(),
      username,
      email,
      passwordHash: await hashPassword(password),
      createdAt: new Date().toISOString(),
    }
    await context.repo.createPlayer(player)

    return reply.code(201).send({
      token: context.tokens.sign(player.id),
      player: toPlayerDto(player),
    })
  })

  app.post('/api/auth/login', async (request, reply) => {
    const body = asRecord(request.body)
    const username = requireString(body, 'username')
    const password = requireString(body, 'password')

    if (username === undefined || password === undefined) {
      return sendError(reply, 400, 'BAD_REQUEST', 'username and password are required')
    }

    const player = await context.repo.findPlayerByUsername(username)
    // Sjekk passordet uansett, så svartiden ikke røper om brukeren finnes
    const stored = player?.passwordHash ?? (await hashPassword('placeholder'))
    const valid = await verifyPassword(password, stored)

    if (player === undefined || !valid) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Wrong username or password')
    }

    return reply.send({
      token: context.tokens.sign(player.id),
      player: toPlayerDto(player),
    })
  })

  /** Java: `/register/check/username`. */
  app.get('/api/auth/username-available', async (request, reply) => {
    const username = (request.query as Record<string, unknown> | undefined)?.['username']
    if (typeof username !== 'string' || username.trim() === '') {
      return sendError(reply, 400, 'BAD_REQUEST', 'username query parameter is required')
    }
    const existing = await context.repo.findPlayerByUsername(username)
    return reply.send({ available: existing === undefined })
  })

  app.get('/api/auth/me', { preHandler: authenticate }, async (request, reply) =>
    reply.send(toPlayerDto(currentPlayer(request))),
  )
}
