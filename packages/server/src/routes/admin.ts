/** Administrative account management. Roles are read from the current account
 * in storage on every request, so changing a role takes effect immediately. */

import type { FastifyInstance } from 'fastify'

import type { AppContext } from '../context.js'
import { asRecord, currentPlayer, requireAdminWith } from '../context.js'
import { sendError } from '../errors.js'
import { toPlayerDto } from './auth.js'
import type { PlayerUpdate, StoredPlayer, UserRole } from '../store/types.js'

export type AdminUserDto = ReturnType<typeof toPlayerDto> & {
  readonly createdAt: string
}

function toAdminUserDto(player: StoredPlayer): AdminUserDto {
  return {
    ...toPlayerDto(player),
    createdAt: player.createdAt,
  }
}

function isAdmin(player: StoredPlayer): boolean {
  return player.role === 'admin' && player.disabled !== true
}

function hasField(body: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, field)
}

function enabledAdminCount(players: readonly StoredPlayer[]): number {
  return players.filter(isAdmin).length
}

export function registerAdminRoutes(app: FastifyInstance, context: AppContext): void {
  const admin = { preHandler: requireAdminWith(context) }

  app.get('/api/admin/users', admin, async (_request, reply) => {
    const players = await context.repo.allPlayers()
    return reply.send(
      [...players]
        .sort((a, b) => a.username.localeCompare(b.username))
        .map(toAdminUserDto),
    )
  })

  app.patch('/api/admin/users/:userId', admin, async (request, reply) => {
    const { userId } = request.params as { userId: string }
    const target = await context.repo.findPlayerById(userId)
    if (target === undefined) {
      return sendError(reply, 404, 'USER_NOT_FOUND', `No user with id ${userId}`)
    }

    const body = asRecord(request.body)
    const roleValue = body['role']
    const role: UserRole | undefined =
      roleValue === undefined ? undefined : roleValue === 'user' || roleValue === 'admin' ? roleValue : undefined
    if (roleValue !== undefined && role === undefined) {
      return sendError(reply, 400, 'BAD_REQUEST', 'role must be user or admin')
    }

    const disabledValue = body['disabled']
    if (disabledValue !== undefined && typeof disabledValue !== 'boolean') {
      return sendError(reply, 400, 'BAD_REQUEST', 'disabled must be a boolean')
    }
    const disabled = disabledValue as boolean | undefined

    let email: string | null | undefined
    if (hasField(body, 'email')) {
      if (body['email'] === null) email = null
      else if (typeof body['email'] === 'string') email = body['email'].trim() || null
      else return sendError(reply, 400, 'BAD_REQUEST', 'email must be a string or null')
    }

    let username: string | undefined
    if (hasField(body, 'username')) {
      if (typeof body['username'] !== 'string') {
        return sendError(reply, 400, 'BAD_REQUEST', 'username must be a string')
      }
      const trimmed = body['username'].trim()
      if (trimmed === '') {
        return sendError(reply, 400, 'BAD_REQUEST', 'username must not be empty')
      }
      // Usernames are the login identity and are matched case-insensitively, so a
      // rename may only reuse a name if it is the target's own (e.g. a case fix).
      const clash = await context.repo.findPlayerByUsername(trimmed)
      if (clash !== undefined && clash.id !== target.id) {
        return sendError(reply, 409, 'USERNAME_TAKEN', `Username ${trimmed} is already in use`)
      }
      username = trimmed
    }

    if (role === undefined && disabled === undefined && email === undefined && username === undefined) {
      return sendError(reply, 400, 'BAD_REQUEST', 'At least one user field is required')
    }

    const me = currentPlayer(request)
    const removesOwnAccess = target.id === me.id && (role === 'user' || disabled === true)
    if (removesOwnAccess) {
      return sendError(reply, 409, 'SELF_LOCKOUT', 'You cannot disable or demote your own account')
    }

    const targetIsEnabledAdmin = isAdmin(target)
    const removesAdminAccess = targetIsEnabledAdmin && (role === 'user' || disabled === true)
    if (removesAdminAccess) {
      const players = await context.repo.allPlayers()
      if (enabledAdminCount(players) <= 1) {
        return sendError(reply, 409, 'LAST_ADMIN', 'At least one enabled admin is required')
      }
    }

    const changes: PlayerUpdate = {
      ...(username !== undefined ? { username } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(role !== undefined ? { role } : {}),
      ...(disabled !== undefined ? { disabled } : {}),
    }
    const updated = await context.repo.updatePlayer(target.id, changes)
    if (updated === undefined) {
      return sendError(reply, 404, 'USER_NOT_FOUND', `No user with id ${userId}`)
    }
    return reply.send(toAdminUserDto(updated))
  })

  app.delete('/api/admin/users/:userId', admin, async (request, reply) => {
    const { userId } = request.params as { userId: string }
    const target = await context.repo.findPlayerById(userId)
    if (target === undefined) {
      return sendError(reply, 404, 'USER_NOT_FOUND', `No user with id ${userId}`)
    }

    const me = currentPlayer(request)
    if (target.id === me.id) {
      return sendError(reply, 409, 'SELF_LOCKOUT', 'You cannot delete your own account')
    }
    if (isAdmin(target)) {
      const players = await context.repo.allPlayers()
      if (enabledAdminCount(players) <= 1) {
        return sendError(reply, 409, 'LAST_ADMIN', 'At least one enabled admin is required')
      }
    }

    const deleted = await context.repo.deletePlayer(target.id)
    if (!deleted) {
      return sendError(reply, 404, 'USER_NOT_FOUND', `No user with id ${userId}`)
    }
    return reply.code(204).send()
  })
}
