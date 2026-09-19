/**
 * Port of `resource/AuthResource.java`.
 *
 * Not ported: `/newpassword` and `/verify/{playerId}`, which emailed a
 * verification link. That needs a mail service and belongs with the rest of
 * the notification work.
 */

import type { App } from '../app.js'
import { hashPassword, needsUpgrade, newId, verifyPassword } from '../auth.js'
import type { AppContext } from '../context.js'
import { asRecord, authenticateWith, currentPlayer, requireString } from '../context.js'
import { sendError } from '../errors.js'
import type { StoredPlayer } from '../store/types.js'

/** The player as the client sees it. The password hash never leaves the server. */
export interface PlayerDto {
  readonly id: string
  readonly username: string
  readonly email: string | null
  readonly role: 'user' | 'admin'
  readonly disabled: boolean
  /** Opted out of notification email. Set through the unsubscribe link. */
  readonly disableEmail: boolean
}

export const toPlayerDto = (player: StoredPlayer): PlayerDto => ({
  id: player.id,
  username: player.username,
  email: player.email,
  role: player.role ?? 'user',
  disabled: player.disabled === true,
  disableEmail: player.disableEmail === true,
})

export function registerAuthRoutes(app: App, context: AppContext): void {
  const authenticate = authenticateWith(context)

  app.post('/api/auth/register', async (c) => {
    const body = asRecord(await c.req.json().catch(() => ({})))
    const username = requireString(body, 'username')
    const password = requireString(body, 'password')
    const email = requireString(body, 'email') ?? null

    if (username === undefined || password === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'username and password are required')
    }
    if (password.length < 4) {
      return sendError(c, 400, 'BAD_REQUEST', 'password must be at least 4 characters')
    }

    // Java: PlayerExistException, which became a 409 Conflict
    if ((await context.repo.findPlayerByUsername(username)) !== undefined) {
      return sendError(c, 409, 'PLAYER_EXISTS', `Username ${username} is taken`)
    }

    const player: StoredPlayer = {
      id: newId(),
      username,
      email,
      passwordHash: await hashPassword(password),
      createdAt: new Date().toISOString(),
      role: 'user',
      disabled: false,
    }
    await context.repo.createPlayer(player)

    return c.json(
      {
        token: context.tokens.sign(player.id),
        player: toPlayerDto(player),
      },
      201,
    )
  })

  app.post('/api/auth/login', async (c) => {
    const body = asRecord(await c.req.json().catch(() => ({})))
    const username = requireString(body, 'username')
    const password = requireString(body, 'password')

    if (username === undefined || password === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'username and password are required')
    }

    const player = await context.repo.findPlayerByUsername(username)
    // Check the password either way, so the timing does not reveal whether
    // the user exists
    const stored = player?.passwordHash ?? (await hashPassword('placeholder'))
    const valid = await verifyPassword(password, stored)

    if (player === undefined || !valid) {
      return sendError(c, 401, 'UNAUTHORIZED', 'Wrong username or password')
    }

    if (player.disabled === true) {
      return sendError(c, 403, 'ACCOUNT_DISABLED', 'This account is disabled')
    }

    // Old `playciv` accounts still carry an unsalted SHA-1 hash. Upgrade it to
    // scrypt now that we have the plaintext password, without ever failing the
    // login on a write error.
    if (needsUpgrade(player.passwordHash)) {
      try {
        await context.repo.updatePlayerPassword(player.id, await hashPassword(password))
      } catch (error) {
        console.warn('Failed to upgrade legacy password hash', error)
      }
    }

    return c.json({
      token: context.tokens.sign(player.id),
      player: toPlayerDto(player),
    })
  })

  /** Java: `/register/check/username`. */
  app.get('/api/auth/username-available', async (c) => {
    const username = c.req.query('username')
    if (typeof username !== 'string' || username.trim() === '') {
      return sendError(c, 400, 'BAD_REQUEST', 'username query parameter is required')
    }
    const existing = await context.repo.findPlayerByUsername(username)
    return c.json({ available: existing === undefined })
  })

  app.get('/api/auth/me', authenticate, async (c) => c.json(toPlayerDto(currentPlayer(c))))
}
