/** Administrative account management. Roles are read from the current account
 * in storage on every request, so changing a role takes effect immediately. */

import { setChatOrders } from '@civ/engine'

import type { App } from '../app.js'
import type { AppContext } from '../context.js'
import { applyToGame, asRecord, currentPlayer, requireAdminWith, requireString } from '../context.js'
import { sendError } from '../errors.js'
import { copyLegacyOrders } from '../legacy-orders.js'
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

/** Both the skip list and the per-run limit of the email broadcast stop here. */
const MAX_BROADCAST_LIST = 5000

/** Recipients per daily run of the broadcast queue: Resend's free plan allows 100 mails a day in all. */
const DEFAULT_PER_RUN = 50
const MAX_PER_RUN = 100

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

/** The optional `exclude` list of both broadcast routes; `'invalid'` for a wrong shape. */
function readExclude(body: Record<string, unknown>): string[] | undefined | 'invalid' {
  const value = body['exclude']
  if (value === undefined) return undefined
  return isStringArray(value) && value.length <= MAX_BROADCAST_LIST ? value : 'invalid'
}

function enabledAdminCount(players: readonly StoredPlayer[]): number {
  return players.filter(isAdmin).length
}

export function registerAdminRoutes(app: App, context: AppContext): void {
  const admin = requireAdminWith(context)

  app.get('/api/admin/users', admin, async (c) => {
    const players = await context.repo.allPlayers()
    return c.json(
      [...players]
        .sort((a, b) => a.username.localeCompare(b.username))
        .map(toAdminUserDto),
    )
  })

  app.patch('/api/admin/users/:userId', admin, async (c) => {
    const userId = c.req.param('userId')
    const target = await context.repo.findPlayerById(userId)
    if (target === undefined) {
      return sendError(c, 404, 'USER_NOT_FOUND', `No user with id ${userId}`)
    }

    const body = asRecord(await c.req.json().catch(() => ({})))
    const roleValue = body['role']
    const role: UserRole | undefined =
      roleValue === undefined ? undefined : roleValue === 'user' || roleValue === 'admin' ? roleValue : undefined
    if (roleValue !== undefined && role === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'role must be user or admin')
    }

    const disabledValue = body['disabled']
    if (disabledValue !== undefined && typeof disabledValue !== 'boolean') {
      return sendError(c, 400, 'BAD_REQUEST', 'disabled must be a boolean')
    }
    const disabled = disabledValue as boolean | undefined

    let email: string | null | undefined
    if (hasField(body, 'email')) {
      if (body['email'] === null) email = null
      else if (typeof body['email'] === 'string') email = body['email'].trim() || null
      else return sendError(c, 400, 'BAD_REQUEST', 'email must be a string or null')
    }

    let username: string | undefined
    if (hasField(body, 'username')) {
      if (typeof body['username'] !== 'string') {
        return sendError(c, 400, 'BAD_REQUEST', 'username must be a string')
      }
      const trimmed = body['username'].trim()
      if (trimmed === '') {
        return sendError(c, 400, 'BAD_REQUEST', 'username must not be empty')
      }
      // Usernames are the login identity and are matched case-insensitively, so a
      // rename may only reuse a name if it is the target's own (e.g. a case fix).
      const clash = await context.repo.findPlayerByUsername(trimmed)
      if (clash !== undefined && clash.id !== target.id) {
        return sendError(c, 409, 'USERNAME_TAKEN', `Username ${trimmed} is already in use`)
      }
      username = trimmed
    }

    if (role === undefined && disabled === undefined && email === undefined && username === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'At least one user field is required')
    }

    const me = currentPlayer(c)
    const removesOwnAccess = target.id === me.id && (role === 'user' || disabled === true)
    if (removesOwnAccess) {
      return sendError(c, 409, 'SELF_LOCKOUT', 'You cannot disable or demote your own account')
    }

    const targetIsEnabledAdmin = isAdmin(target)
    const removesAdminAccess = targetIsEnabledAdmin && (role === 'user' || disabled === true)
    if (removesAdminAccess) {
      const players = await context.repo.allPlayers()
      if (enabledAdminCount(players) <= 1) {
        return sendError(c, 409, 'LAST_ADMIN', 'At least one enabled admin is required')
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
      return sendError(c, 404, 'USER_NOT_FOUND', `No user with id ${userId}`)
    }
    return c.json(toAdminUserDto(updated))
  })

  app.delete('/api/admin/users/:userId', admin, async (c) => {
    const userId = c.req.param('userId')
    const target = await context.repo.findPlayerById(userId)
    if (target === undefined) {
      return sendError(c, 404, 'USER_NOT_FOUND', `No user with id ${userId}`)
    }

    const me = currentPlayer(c)
    if (target.id === me.id) {
      return sendError(c, 409, 'SELF_LOCKOUT', 'You cannot delete your own account')
    }
    if (isAdmin(target)) {
      const players = await context.repo.allPlayers()
      if (enabledAdminCount(players) <= 1) {
        return sendError(c, 409, 'LAST_ADMIN', 'At least one enabled admin is required')
      }
    }

    const deleted = await context.repo.deletePlayer(target.id)
    if (!deleted) {
      return sendError(c, 404, 'USER_NOT_FOUND', `No user with id ${userId}`)
    }
    return c.body(null, 204)
  })

  /**
   * The admin email broadcast (issue #92). Java's `PUT /admin/mail` had the
   * body commented out and always answered 204; this is the reachable version,
   * with a Markdown body the server renders to HTML.
   */
  app.post('/api/admin/email/broadcast', admin, async (c) => {
    const body = asRecord(await c.req.json().catch(() => ({})))
    const subject = requireString(body, 'subject')
    const markdown = requireString(body, 'markdown')
    if (subject === undefined || markdown === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'subject and markdown are required')
    }

    // Same shape as the user PATCH route's `disabled`: a boolean when present.
    const includeValue = body['includeUnsubscribed']
    if (includeValue !== undefined && typeof includeValue !== 'boolean') {
      return sendError(c, 400, 'BAD_REQUEST', 'includeUnsubscribed must be a boolean')
    }

    const exclude = readExclude(body)
    if (exclude === 'invalid') {
      return sendError(
        c,
        400,
        'BAD_REQUEST',
        `exclude must be an array of at most ${MAX_BROADCAST_LIST} strings`,
      )
    }
    const limitValue = body['limit']
    if (
      limitValue !== undefined &&
      (typeof limitValue !== 'number' ||
        !Number.isInteger(limitValue) ||
        limitValue < 1 ||
        limitValue > MAX_BROADCAST_LIST)
    ) {
      return sendError(
        c,
        400,
        'BAD_REQUEST',
        `limit must be an integer from 1 to ${MAX_BROADCAST_LIST}`,
      )
    }

    const result = await context.notifications.broadcast({
      subject,
      markdown,
      includeUnsubscribed: includeValue === true,
      ...(exclude === undefined ? {} : { exclude }),
      ...(limitValue === undefined ? {} : { limit: limitValue }),
    })
    return c.json(result)
  })

  /**
   * The same broadcast spread over several days (the broadcast queue). The
   * recipients are fixed now; the daily job, or "send next batch now", sends
   * `perRun` of them at a time.
   */
  app.post('/api/admin/email/broadcast/queue', admin, async (c) => {
    const body = asRecord(await c.req.json().catch(() => ({})))
    const subject = requireString(body, 'subject')
    const markdown = requireString(body, 'markdown')
    if (subject === undefined || markdown === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'subject and markdown are required')
    }
    const includeValue = body['includeUnsubscribed']
    if (includeValue !== undefined && typeof includeValue !== 'boolean') {
      return sendError(c, 400, 'BAD_REQUEST', 'includeUnsubscribed must be a boolean')
    }
    const exclude = readExclude(body)
    if (exclude === 'invalid') {
      return sendError(
        c,
        400,
        'BAD_REQUEST',
        `exclude must be an array of at most ${MAX_BROADCAST_LIST} strings`,
      )
    }
    // `=== undefined`, not `??`: an explicit null is a wrong type, not the default.
    const perRunValue = body['perRun'] === undefined ? DEFAULT_PER_RUN : body['perRun']
    if (
      typeof perRunValue !== 'number' ||
      !Number.isInteger(perRunValue) ||
      perRunValue < 1 ||
      perRunValue > MAX_PER_RUN
    ) {
      return sendError(c, 400, 'BAD_REQUEST', `perRun must be an integer from 1 to ${MAX_PER_RUN}`)
    }

    const result = await context.notifications.queueBroadcast({
      subject,
      markdown,
      includeUnsubscribed: includeValue === true,
      perRun: perRunValue,
      ...(exclude === undefined ? {} : { exclude }),
    })
    if (!result.ok) {
      return result.reason === 'ALREADY_ACTIVE'
        ? sendError(c, 409, 'BROADCAST_ACTIVE', 'A broadcast is already queued; cancel it or let it finish')
        : sendError(c, 400, 'NO_RECIPIENTS', 'No account is eligible for this message')
    }
    return c.json(
      { queue: result.queue, skipped: result.skipped, rejected: result.rejected },
      201,
    )
  })

  app.get('/api/admin/email/broadcast/queue', admin, async (c) =>
    c.json({ queue: await context.notifications.queuedBroadcastStatus() }),
  )

  app.post('/api/admin/email/broadcast/queue/run', admin, async (c) => {
    const run = await context.notifications.runQueuedBroadcast(new Date())
    if (!run.ran) {
      return sendError(c, 409, 'NO_ACTIVE_BROADCAST', 'There is no queued broadcast to send')
    }
    return c.json({ run, queue: await context.notifications.queuedBroadcastStatus() })
  })

  /**
   * The owner's decision about rows a run left in `sending`: they may already
   * have been delivered, so only the admin can say they are safe to send again.
   */
  app.post('/api/admin/email/broadcast/queue/release-stuck', admin, async (c) => {
    const result = await context.notifications.releaseStuckQueuedRecipients()
    if (result === null) {
      return sendError(c, 409, 'NO_ACTIVE_BROADCAST', 'There is no queued broadcast to release rows in')
    }
    return c.json(result)
  })

  app.post('/api/admin/email/broadcast/queue/cancel', admin, async (c) => {
    const queue = await context.notifications.cancelQueuedBroadcast()
    if (queue === null) {
      return sendError(c, 409, 'NO_ACTIVE_BROADCAST', 'There is no queued broadcast to cancel')
    }
    return c.json({ queue })
  })

  /**
   * Switches chat orders (issue #215) on or off for one game. Only the admin
   * role may: it changes how the whole game is played, not just the caller's
   * view. The change is a setting, not a game move, so it makes no replay
   * checkpoint (the same choice as a private note).
   */
  app.post('/api/admin/games/:gameId/chat-orders', admin, async (c) => {
    const gameId = c.req.param('gameId')
    const enabled = asRecord(await c.req.json().catch(() => ({})))['enabled']
    if (typeof enabled !== 'boolean') {
      return sendError(c, 400, 'BAD_REQUEST', 'enabled must be a boolean')
    }
    // Switching on may place the start player marker, a board history entry
    const at = new Date().toISOString()
    return applyToGame(context, c, gameId, (state) => setChatOrders(state, enabled, at), undefined, {
      record: false,
      // The first switch-on copies the classic orders into the timeline. A
      // failure here must not undo the switch, and nobody is mailed about it.
      after: async ({ before, after }) => {
        if (before.legacyOrdersCopied || !after.legacyOrdersCopied) return
        try {
          await copyLegacyOrders(context.repo, gameId, after)
        } catch (error) {
          console.error('Copying the classic orders into the timeline failed', error)
        }
      },
    })
  })
}
