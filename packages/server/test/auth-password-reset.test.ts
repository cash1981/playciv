/**
 * Password reset (issue #37). Ports `AuthResource.newPassword` /
 * `verifyPassword` and `PlayerAction.newPassword(ForgotpassDTO)`, but with a
 * signed, expiring link instead of Java's plaintext `Player.newPassword` and
 * its public `verify/{playerId}` link. See
 * `docs/agents/tasks/issue-37-password-reset.md` and `decisions.md`.
 */

import { describe, expect, it } from 'vitest'

import type { App } from '../src/app.js'
import { createTestApp } from '../src/app.js'
import { ResetTokenSigner } from '../src/auth.js'
import type { Mailer, OutgoingEmail } from '../src/mail.js'
import { bearer, inject } from './helpers.js'

class FakeMailer implements Mailer {
  readonly sent: OutgoingEmail[] = []

  async send(email: OutgoingEmail): Promise<void> {
    this.sent.push(email)
  }
}

const APP_ORIGIN = 'https://example.test'

async function setup(): Promise<{ app: App; mailer: FakeMailer }> {
  const mailer = new FakeMailer()
  const { app } = await createTestApp({ mailer, appOrigin: APP_ORIGIN })
  return { app, mailer }
}

async function register(
  app: App,
  username: string,
  email: string,
): Promise<{ readonly token: string; readonly id: string }> {
  const response = await inject(app, {
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hemmelig', email },
  })
  expect(response.status).toBe(201)
  const body = await response.json<{ readonly token: string; readonly player: { readonly id: string } }>()
  return { token: body.token, id: body.player.id }
}

/** The reset token is the last path segment of the emailed link. */
function tokenFrom(text: string): string {
  const match = /\/api\/auth\/verify\/(\S+)/.exec(text)
  if (match?.[1] === undefined) throw new Error(`no reset link in: ${text}`)
  return match[1]
}

describe('password reset (issue #37)', () => {
  it('mails a signed link that applies the new password', async () => {
    const { app, mailer } = await setup()
    await register(app, 'reset-owner', 'cash@playciv.com')

    const requested = await inject(app, {
      method: 'PUT',
      url: '/api/auth/newpassword',
      payload: { email: 'cash@playciv.com', newpassword: 'nyttpassord' },
    })
    expect(requested.status).toBe(200)
    expect(mailer.sent).toHaveLength(1)

    const mail = mailer.sent[0]
    expect(mail?.to).toBe('cash@playciv.com')
    expect(mail?.subject).toBe('Please verify your email')
    expect(mail?.text).toContain('Your password was requested to be changed.')
    expect(mail?.text).toContain('please press this link: ')
    // A transactional mail must not carry the unsubscribe link.
    expect(mail?.text).not.toContain('unsubscribe')

    const token = tokenFrom(mail?.text ?? '')
    const verified = await inject(app, { url: `/api/auth/verify/${token}` })
    expect(verified.status).toBe(200)
    expect(verified.body).toContain('Your password was correctly changed')

    const oldLogin = await inject(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'reset-owner', password: 'hemmelig' },
    })
    expect(oldLogin.status).toBe(401)

    const newLogin = await inject(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'reset-owner', password: 'nyttpassord' },
    })
    expect(newLogin.status).toBe(200)

    // The token is idempotent: replaying it re-installs the same hash.
    const replay = await inject(app, { url: `/api/auth/verify/${token}` })
    expect(replay.status).toBe(200)

    // And it is not a session token: the reset key is separate.
    const asBearer = await inject(app, { url: '/api/auth/me', headers: bearer(token) })
    expect(asBearer.status).toBe(401)
  })

  it('answers 200 and sends nothing for an unknown email', async () => {
    const { app, mailer } = await setup()

    const response = await inject(app, {
      method: 'PUT',
      url: '/api/auth/newpassword',
      payload: { email: 'nobody@example.com', newpassword: 'nyttpassord' },
    })
    expect(response.status).toBe(200)
    expect(mailer.sent).toHaveLength(0)
  })

  it('rejects a malformed, expired or orphan token, and validates input', async () => {
    const { app } = await setup()
    const { id } = await register(app, 'expired-owner', 'expired@example.com')

    expect((await inject(app, { url: '/api/auth/verify/nonsense' })).status).toBe(404)
    expect((await inject(app, { url: '/api/auth/verify/a.b' })).status).toBe(404)

    // A token signed with the real key but already expired.
    const expired = new ResetTokenSigner('test-secret', -1_000).sign(
      { playerId: id, passwordHash: 'salt:hash' },
      Date.now(),
    )
    expect((await inject(app, { url: `/api/auth/verify/${expired}` })).status).toBe(404)

    // A valid token for a player that no longer exists.
    const orphan = new ResetTokenSigner('test-secret').sign({
      playerId: 'missing-player',
      passwordHash: 'salt:hash',
    })
    expect((await inject(app, { url: `/api/auth/verify/${orphan}` })).status).toBe(404)

    const empty = await inject(app, { method: 'PUT', url: '/api/auth/newpassword', payload: {} })
    expect(empty.status).toBe(400)
    const badEmail = await inject(app, {
      method: 'PUT',
      url: '/api/auth/newpassword',
      payload: { email: 'not-an-email', newpassword: 'nyttpassord' },
    })
    expect(badEmail.status).toBe(400)
    const shortPassword = await inject(app, {
      method: 'PUT',
      url: '/api/auth/newpassword',
      payload: { email: 'x@y.z', newpassword: 'abc' },
    })
    expect(shortPassword.status).toBe(400)
  })

  it('sends even when the account opted out, and matches the address case-insensitively', async () => {
    const { app, mailer } = await setup()
    const { id } = await register(app, 'opted-out', 'Opted@Example.com')

    // The unsubscribe link flips `disableEmail`, as it does for game mail.
    expect((await inject(app, { url: `/api/admin/email/notification/${id}/stop` })).status).toBe(200)

    const response = await inject(app, {
      method: 'PUT',
      url: '/api/auth/newpassword',
      payload: { email: 'opted@example.com', newpassword: 'nyttpassord' },
    })
    expect(response.status).toBe(200)
    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0]?.to).toBe('Opted@Example.com')
  })
})
