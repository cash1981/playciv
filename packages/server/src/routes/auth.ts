/**
 * Port of `resource/AuthResource.java`.
 *
 * `/newpassword` and `/verify/{token}` (issue #37) use a signed, expiring link
 * instead of Java's `verify/{playerId}` and its plaintext `Player.newPassword`.
 * See `docs/agents/tasks/issue-37-password-reset.md` and `decisions.md`.
 */

import type { App } from '../app.js'
import { hashPassword, needsUpgrade, newId, verifyPassword } from '../auth.js'
import type { AppContext } from '../context.js'
import { asRecord, authenticateWith, currentPlayer, requireString } from '../context.js'
import { sendError } from '../errors.js'
import type { StoredPlayer } from '../store/types.js'

/** The same shape the old client's `ng-pattern` accepted. */
const EMAIL_SHAPE = /\S+@\S+\.\S+/

const INVALID_RESET_HTML =
  '<html>This password reset link is invalid or has expired. ' +
  'Please request a new one.</html>'

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

  /**
   * Java `AuthResource.newPassword` / `PlayerAction.newPassword(ForgotpassDTO)`.
   *
   * The link carries a signed hash of the wanted password instead of Java's
   * plaintext `Player.newPassword`, and it expires. A known and an unknown
   * address answer identically, so the endpoint cannot be used to enumerate
   * accounts (Java answered 404 for an unknown email).
   */
  app.put('/api/auth/newpassword', async (c) => {
    const body = asRecord(await c.req.json().catch(() => ({})))
    const email = requireString(body, 'email')
    const newpassword = requireString(body, 'newpassword')

    if (email === undefined || newpassword === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'email and newpassword are required')
    }
    if (!EMAIL_SHAPE.test(email)) {
      return sendError(c, 400, 'BAD_REQUEST', 'email is not a valid address')
    }
    if (newpassword.length < 4) {
      return sendError(c, 400, 'BAD_REQUEST', 'password must be at least 4 characters')
    }

    const wanted = email.trim().toLowerCase()
    const player = (await context.repo.allPlayers()).find(
      (candidate) => candidate.email !== null && candidate.email.toLowerCase() === wanted,
    )

    if (player !== undefined && player.email !== null) {
      const passwordHash = await hashPassword(newpassword)
      const token = context.resetTokens.sign({ playerId: player.id, passwordHash })
      await context.notifications.passwordReset(
        player.email,
        `${context.appOrigin}/api/auth/verify/${token}`,
      )
    }

    // Deliberately the same answer either way.
    return c.json({ ok: true })
  })

  /**
   * Java `AuthResource.verifyPassword`. The token carries the hash to install,
   * so there is no stored pending password to consume.
   */
  app.get('/api/auth/verify/:token', async (c) => {
    const payload = context.resetTokens.verify(c.req.param('token'))
    if (payload === undefined) {
      return c.html(INVALID_RESET_HTML, 404)
    }

    const player = await context.repo.findPlayerById(payload.playerId)
    if (player === undefined) {
      return c.html(INVALID_RESET_HTML, 404)
    }

    await context.repo.updatePlayerPassword(payload.playerId, payload.passwordHash)
    // Java's confirmation page, on our own origin.
    return c.html(
      '<html>Your password was correctly changed. ' +
        `<a href="${context.appOrigin}">Try to login again </a></html>`,
    )
  })
}
