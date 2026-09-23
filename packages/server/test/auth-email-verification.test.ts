/**
 * Account email verification (issue #42).
 *
 * A password account must prove control of its address: with a live mailer it
 * starts unverified and may only read until the link is opened; with no mailer
 * (local development, or a missing RESEND_API_KEY) it starts verified and the
 * link is printed instead. The verification token has its own signing key,
 * separate from the session and password-reset tokens.
 */

import { describe, expect, it, vi } from 'vitest'

import type { App } from '../src/app.js'
import { createTestApp } from '../src/app.js'
import { EmailVerifyTokenSigner, ResetTokenSigner, verifyPassword } from '../src/auth.js'
import type { Mailer, OutgoingEmail } from '../src/mail.js'
import type { JsonFileRepository } from '../src/store/json-file.js'
import { bearer, inject, verificationLinkFrom, verifyRecordedEmail } from './helpers.js'

class FakeMailer implements Mailer {
  readonly enabled = true
  readonly sent: OutgoingEmail[] = []

  async send(email: OutgoingEmail): Promise<void> {
    this.sent.push(email)
  }
}

const APP_ORIGIN = 'https://playciv.test'
const TOKEN_SECRET = 'test-secret'

async function liveApp(): Promise<{ app: App; repo: JsonFileRepository; mailer: FakeMailer }> {
  const mailer = new FakeMailer()
  const created = await createTestApp({ mailer, appOrigin: APP_ORIGIN })
  return { app: created.app, repo: created.repo, mailer }
}

interface Registered {
  readonly token: string
  readonly id: string
  readonly emailVerified: boolean
}

async function register(
  app: App,
  username: string,
  email: string = `${username}@example.com`,
): Promise<Registered> {
  const response = await inject(app, {
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hemmelig', email, securityAnswer: 'writing' },
  })
  expect(response.status).toBe(201)
  const body = await response.json<{
    token: string
    player: { id: string; emailVerified: boolean }
  }>()
  return { token: body.token, id: body.player.id, emailVerified: body.player.emailVerified }
}

describe('registration requires a verified email (issue #42)', () => {
  it('requires an address of the right shape and creates no account without one', async () => {
    const { app, repo } = await liveApp()

    const missing = await inject(app, {
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'no-mail', password: 'hemmelig', securityAnswer: 'writing' },
    })
    expect(missing.status).toBe(400)

    const malformed = await inject(app, {
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        username: 'bad-mail',
        password: 'hemmelig',
        email: 'not-an-address',
        securityAnswer: 'writing',
      },
    })
    expect(malformed.status).toBe(400)
    expect((await malformed.json<{ error: string }>()).error).toBe('BAD_REQUEST')

    expect(await repo.allPlayers()).toHaveLength(0)
  })

  it('rejects a second account with the same address, case-insensitively and trimmed', async () => {
    const { app, repo } = await liveApp()
    await register(app, 'first', 'One@Example.com')

    const second = await inject(app, {
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        username: 'second',
        password: 'hemmelig',
        email: '  one@example.com  ',
        securityAnswer: 'writing',
      },
    })
    expect(second.status).toBe(409)
    expect((await second.json<{ error: string }>()).error).toBe('EMAIL_TAKEN')
    expect(await repo.findPlayerByUsername('second')).toBeUndefined()
  })

  it('with a live mailer the account starts unverified and the link verifies it', async () => {
    const { app, repo, mailer } = await liveApp()
    const account = await register(app, 'verify-me')
    expect(account.emailVerified).toBe(false)

    const me = await inject(app, { url: '/api/auth/me', headers: bearer(account.token) })
    expect((await me.json<{ emailVerified: boolean }>()).emailVerified).toBe(false)

    const mail = mailer.sent.find((candidate) => candidate.to === 'verify-me@example.com')
    expect(mail?.subject).toBe('Please verify your email address')
    expect(mail?.text).toContain(`${APP_ORIGIN}/api/auth/verify-email/`)
    // Transactional mail: no unsubscribe footer.
    expect(mail?.text).not.toContain('unsubscribe')

    const token = verificationLinkFrom(mailer.sent, 'verify-me@example.com')
    const verified = await inject(app, { url: `/api/auth/verify-email/${token}` })
    expect(verified.status).toBe(200)
    expect(verified.body).toContain('Your email address is verified')

    expect((await repo.findPlayerById(account.id))?.emailVerified).toBe(true)
    const after = await inject(app, { url: '/api/auth/me', headers: bearer(account.token) })
    expect((await after.json<{ emailVerified: boolean }>()).emailVerified).toBe(true)
  })

  it('answers the HTML 404 page for an invalid, expired or orphan token', async () => {
    const { app } = await liveApp()
    const account = await register(app, 'expiry')

    expect((await inject(app, { url: '/api/auth/verify-email/nonsense' })).status).toBe(404)
    expect((await inject(app, { url: '/api/auth/verify-email/a.b' })).status).toBe(404)

    const expired = new EmailVerifyTokenSigner(TOKEN_SECRET, -1_000).sign(
      { playerId: account.id },
      Date.now(),
    )
    const expiredResponse = await inject(app, { url: `/api/auth/verify-email/${expired}` })
    expect(expiredResponse.status).toBe(404)
    expect(expiredResponse.body).toContain('invalid or has expired')

    const orphan = new EmailVerifyTokenSigner(TOKEN_SECRET).sign({ playerId: 'missing-player' })
    expect((await inject(app, { url: `/api/auth/verify-email/${orphan}` })).status).toBe(404)
  })

  it('lets an unverified account read, refuses its writes, and allows resend', async () => {
    const { app, mailer } = await liveApp()
    const account = await register(app, 'gated')

    expect((await inject(app, { url: '/api/auth/me', headers: bearer(account.token) })).status).toBe(200)
    expect((await inject(app, { url: '/api/games', headers: bearer(account.token) })).status).toBe(200)

    const refused = await inject(app, {
      method: 'POST',
      url: '/api/games',
      headers: bearer(account.token),
      payload: { name: 'gated game', numOfPlayers: 2 },
    })
    expect(refused.status).toBe(403)
    expect((await refused.json<{ error: string }>()).error).toBe('EMAIL_NOT_VERIFIED')

    // The resend route is the one write an unverified account may make.
    const resend = await inject(app, {
      method: 'POST',
      url: '/api/auth/verify-email/resend',
      headers: bearer(account.token),
      payload: {},
    })
    expect(resend.status).toBe(200)
    expect(await resend.json()).toEqual({ ok: true })

    // Opening the newest link lifts the gate.
    const token = verificationLinkFrom(mailer.sent, 'gated@example.com')
    expect((await inject(app, { url: `/api/auth/verify-email/${token}` })).status).toBe(200)

    const created = await inject(app, {
      method: 'POST',
      url: '/api/games',
      headers: bearer(account.token),
      payload: { name: 'gated game', numOfPlayers: 2 },
    })
    expect(created.status).toBe(201)
  })

  it('resend stores a new address unverified and refuses one already in use', async () => {
    const { app, repo, mailer } = await liveApp()
    const first = await register(app, 'resend-owner')
    const other = await register(app, 'resend-other', 'other@example.com')
    await verifyRecordedEmail(app, mailer, 'resend-owner@example.com')

    const taken = await inject(app, {
      method: 'POST',
      url: '/api/auth/verify-email/resend',
      headers: bearer(first.token),
      payload: { email: 'other@example.com' },
    })
    expect(taken.status).toBe(409)

    const moved = await inject(app, {
      method: 'POST',
      url: '/api/auth/verify-email/resend',
      headers: bearer(first.token),
      payload: { email: 'moved@example.com' },
    })
    expect(moved.status).toBe(200)

    const stored = await repo.findPlayerById(first.id)
    expect(stored?.email).toBe('moved@example.com')
    expect(stored?.emailVerified).toBe(false)

    const mail = mailer.sent.at(-1)
    expect(mail?.to).toBe('moved@example.com')
    expect(mail?.subject).toBe('Please verify your email address')

    // The other account keeps its address.
    expect((await repo.findPlayerById(other.id))?.email).toBe('other@example.com')
  })

  it('without a mailer registration marks the account verified and prints the link', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const created = await createTestApp()
      const account = await register(created.app, 'no-mailer')
      expect(account.emailVerified).toBe(true)
      expect((await created.repo.findPlayerById(account.id))?.emailVerified).toBe(true)

      const link = warn.mock.calls
        .map((call) => String(call[0]))
        .find((message) => message.includes('/api/auth/verify-email/'))
      expect(link).toBeDefined()
      expect(link).toContain('RESEND_API_KEY')
    } finally {
      warn.mockRestore()
    }
  })

  it('keeps the verification token separate from session and reset tokens', async () => {
    const { app, mailer } = await liveApp()
    const account = await register(app, 'tokens')
    const verificationToken = verificationLinkFrom(mailer.sent, 'tokens@example.com')

    // A verification token is neither a session token nor a reset token.
    expect(
      (await inject(app, { url: '/api/auth/me', headers: bearer(verificationToken) })).status,
    ).toBe(401)
    expect((await inject(app, { url: `/api/auth/verify/${verificationToken}` })).status).toBe(404)

    // A session token is not a verification token.
    expect(
      (await inject(app, { url: `/api/auth/verify-email/${account.token}` })).status,
    ).toBe(404)

    // A reset token is not a verification token either.
    const resetToken = new ResetTokenSigner(TOKEN_SECRET).sign({
      playerId: account.id,
      passwordHash: 'salt:hash',
    })
    expect((await inject(app, { url: `/api/auth/verify-email/${resetToken}` })).status).toBe(404)
  })

  it('the password-reset link also marks the address verified', async () => {
    const { app, repo, mailer } = await liveApp()
    const account = await register(app, 'reset-verifies')

    const requested = await inject(app, {
      method: 'PUT',
      url: '/api/auth/newpassword',
      payload: { email: 'reset-verifies@example.com', newpassword: 'nyttpassord' },
    })
    expect(requested.status).toBe(200)

    const resetMail = mailer.sent.find((mail) => mail.subject === 'Please verify your email')
    const token = /\/api\/auth\/verify\/(\S+)/.exec(resetMail?.text ?? '')?.[1]
    expect(token).toBeDefined()

    expect((await inject(app, { url: `/api/auth/verify/${token}` })).status).toBe(200)
    expect((await repo.findPlayerById(account.id))?.emailVerified).toBe(true)
  })

  it('the empty password of a social account is never a login', async () => {
    // `passwordHash: ''` is how a social-only account stores "no password";
    // `verifyPassword` has no `salt:hash` to split, so it always returns false.
    expect(await verifyPassword('whatever', '')).toBe(false)
    expect(await verifyPassword('', '')).toBe(false)
  })

  it('does not expose provider identities on the player DTO', async () => {
    const { app, repo } = await liveApp()
    const account = await register(app, 'hidden-info')
    await repo.updatePlayer(account.id, {
      oauthProviders: [{ provider: 'discord', providerUserId: 'secret-provider-id' }],
    })

    const me = await inject(app, { url: '/api/auth/me', headers: bearer(account.token) })
    expect(me.body).not.toContain('oauthProviders')
    expect(me.body).not.toContain('secret-provider-id')
  })
})
