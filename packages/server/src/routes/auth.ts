/**
 * Port of `resource/AuthResource.java`.
 *
 * `/newpassword` and `/verify/{token}` (issue #37) use a signed, expiring link
 * instead of Java's `verify/{playerId}` and its plaintext `Player.newPassword`.
 * See `docs/agents/tasks/issue-37-password-reset.md` and `decisions.md`.
 */

import type { App } from '../app.js'
import { hashPassword, isSecurityAnswer, needsUpgrade, newId, verifyPassword } from '../auth.js'
import type { AppContext } from '../context.js'
import { asRecord, authenticateWith, currentPlayer, requireString } from '../context.js'
import { sendError } from '../errors.js'
import type { StoredPlayer } from '../store/types.js'
import { sendVerificationEmail } from '../verification.js'

/** The same shape the old client's `ng-pattern` accepted. */
const EMAIL_SHAPE = /\S+@\S+\.\S+/

const INVALID_RESET_HTML =
  '<html>This password reset link is invalid or has expired. ' +
  'Please request a new one.</html>'

const INVALID_VERIFY_HTML =
  '<html>This email verification link is invalid or has expired. ' +
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
  /**
   * False until the account opens its verification link (issue #42). A missing
   * stored value means a grandfathered, verified account.
   */
  readonly emailVerified: boolean
}

export const toPlayerDto = (player: StoredPlayer): PlayerDto => ({
  id: player.id,
  username: player.username,
  email: player.email,
  role: player.role ?? 'user',
  disabled: player.disabled === true,
  disableEmail: player.disableEmail === true,
  emailVerified: player.emailVerified !== false,
})

/**
 * Email uniqueness for new and changed addresses (issue #42). Case-insensitive
 * and trimmed, scanning `allPlayers` the way the password-reset route already
 * looks up an address; at ~554 accounts that is fine and needs no index.
 * `exceptId` lets an account keep its own address.
 */
async function emailInUse(
  context: AppContext,
  address: string,
  exceptId?: string,
): Promise<boolean> {
  const wanted = address.trim().toLowerCase()
  return (await context.repo.allPlayers()).some(
    (player) =>
      player.id !== exceptId &&
      player.email !== null &&
      player.email.trim().toLowerCase() === wanted,
  )
}

export function registerAuthRoutes(app: App, context: AppContext): void {
  const authenticate = authenticateWith(context)
  // The resend route is the one write an unverified account may make: it is how
  // it asks for a new link (issue #42).
  const authenticateUnverified = authenticateWith(context, { allowUnverified: true })

  app.post('/api/auth/register', async (c) => {
    const body = asRecord(await c.req.json().catch(() => ({})))
    const username = requireString(body, 'username')
    const password = requireString(body, 'password')
    const email = requireString(body, 'email')

    if (username === undefined || password === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'username and password are required')
    }
    if (password.length < 4) {
      return sendError(c, 400, 'BAD_REQUEST', 'password must be at least 4 characters')
    }

    // Issue #42: the account is verified through this address, so it is now
    // required and must look like one.
    if (email === undefined || !EMAIL_SHAPE.test(email)) {
      return sendError(c, 400, 'BAD_REQUEST', 'a valid email address is required')
    }

    // Issue #40: the old gate lived only in the AngularJS client, so a direct
    // POST skipped it. Old client: growl.error('Wrong answer to the security
    // question')
    if (!isSecurityAnswer(body['securityAnswer'])) {
      return sendError(c, 400, 'WRONG_SECURITY_ANSWER', 'Wrong answer to the security question')
    }

    // Java: PlayerExistException, which became a 409 Conflict
    if ((await context.repo.findPlayerByUsername(username)) !== undefined) {
      return sendError(c, 409, 'PLAYER_EXISTS', `Username ${username} is taken`)
    }

    const address = email.trim()
    if (await emailInUse(context, address)) {
      return sendError(c, 409, 'EMAIL_TAKEN', `Email ${address} is already in use`)
    }

    // With no way to send the link, the account starts verified and the link is
    // printed instead; with a live mailer it starts unverified and the link is
    // mailed (issue #42).
    const emailDeliveryEnabled = context.notifications.emailDeliveryEnabled
    const player: StoredPlayer = {
      id: newId(),
      username,
      email: address,
      passwordHash: await hashPassword(password),
      createdAt: new Date().toISOString(),
      role: 'user',
      disabled: false,
      emailVerified: !emailDeliveryEnabled,
      oauthProviders: [],
    }
    await context.repo.createPlayer(player)

    await sendVerificationEmail(context, player)

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
   * Opening the link proves control of the address (issue #42). No client route
   * is needed: the server answers its own HTML page, in the style of the reset
   * page below.
   */
  app.get('/api/auth/verify-email/:token', async (c) => {
    const payload = context.verifyTokens.verify(c.req.param('token'))
    if (payload === undefined) {
      return c.html(INVALID_VERIFY_HTML, 404)
    }

    const player = await context.repo.findPlayerById(payload.playerId)
    if (player === undefined) {
      return c.html(INVALID_VERIFY_HTML, 404)
    }

    await context.repo.updatePlayer(payload.playerId, { emailVerified: true })
    return c.html(
      '<html>Your email address is verified. ' +
        `<a href="${context.appOrigin}">Continue </a></html>`,
    )
  })

  /**
   * Re-sends the verification link (issue #42), optionally to a new address
   * that is stored unverified — it is unproven until the link is opened.
   * Answers `{ ok: true }` even when a send fails, like every other mail path,
   * and is the one write an unverified account is allowed to make.
   */
  app.post('/api/auth/verify-email/resend', authenticateUnverified, async (c) => {
    const me = currentPlayer(c)
    const body = asRecord(await c.req.json().catch(() => ({})))

    if (body['email'] !== undefined) {
      const address = requireString(body, 'email')
      if (address === undefined || !EMAIL_SHAPE.test(address)) {
        return sendError(c, 400, 'BAD_REQUEST', 'email is not a valid address')
      }
      const trimmed = address.trim()
      if (await emailInUse(context, trimmed, me.id)) {
        return sendError(c, 409, 'EMAIL_TAKEN', `Email ${trimmed} is already in use`)
      }
      await context.repo.updatePlayer(me.id, { email: trimmed, emailVerified: false })
    }

    // Reload, so a just-changed address is the one the link goes to.
    const player = (await context.repo.findPlayerById(me.id)) ?? me
    await sendVerificationEmail(context, player)
    return c.json({ ok: true })
  })

  /**
   * Java `AuthResource.verifyPassword`. The token carries the hash to install,
   * so there is no stored pending password to consume. Opening the reset link
   * also proves control of the address, so it verifies the account too.
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
    await context.repo.updatePlayer(payload.playerId, { emailVerified: true })
    // Java's confirmation page, on our own origin.
    return c.html(
      '<html>Your password was correctly changed. ' +
        `<a href="${context.appOrigin}">Try to login again </a></html>`,
    )
  })
}
