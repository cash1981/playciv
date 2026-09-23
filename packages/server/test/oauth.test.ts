/**
 * Social login (issue #121).
 *
 * Google, Facebook and Discord through OAuth 2.0 with PKCE S256. No network is
 * contacted: the provider's token and userinfo endpoints are stubbed on the
 * global `fetch`, and the app runs against the in-memory repository like every
 * other server test. The provider table is exported so the userinfo parsers can
 * be pinned directly.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { App, CreateAppOptions } from '../src/app.js'
import { createTestApp } from '../src/app.js'
import { OAuthStateSigner, PendingRegistrationSigner } from '../src/auth.js'
import type { Mailer, OutgoingEmail } from '../src/mail.js'
import { PROVIDERS } from '../src/oauth.js'
import type { JsonFileRepository } from '../src/store/json-file.js'
import { bearer, inject } from './helpers.js'

class FakeMailer implements Mailer {
  readonly enabled = true
  readonly sent: OutgoingEmail[] = []

  async send(email: OutgoingEmail): Promise<void> {
    this.sent.push(email)
  }
}

const APP_ORIGIN = 'https://playciv.test'
const TOKEN_SECRET = 'test-secret'

const CONFIGURED = {
  google: { clientId: 'google-id', clientSecret: 'google-secret' },
  discord: { clientId: 'discord-id', clientSecret: 'discord-secret' },
} satisfies NonNullable<CreateAppOptions['providers']>

afterEach(() => {
  vi.unstubAllGlobals()
})

async function oauthApp(
  providers: NonNullable<CreateAppOptions['providers']> = CONFIGURED,
): Promise<{ app: App; repo: JsonFileRepository; mailer: FakeMailer }> {
  const mailer = new FakeMailer()
  const created = await createTestApp({ mailer, appOrigin: APP_ORIGIN, providers })
  return { app: created.app, repo: created.repo, mailer }
}

const signState = (provider: string): string =>
  new OAuthStateSigner(TOKEN_SECRET).sign({ provider, codeVerifier: 'verifier-1' })

const callbackUrl = (provider: string, state: string, code = 'auth-code'): string =>
  `/api/auth/oauth/${provider}/callback?code=${code}&state=${encodeURIComponent(state)}`

function tokenFromFragment(location: string, name: 'token' | 'pending'): string {
  const marker = `#${name}=`
  const index = location.indexOf(marker)
  if (index === -1) throw new Error(`no ${name} in ${location}`)
  return location.slice(index + marker.length)
}

/** Stubs the token and userinfo endpoints of one provider. */
function stubProvider(provider: 'google' | 'discord', userinfo: unknown, tokenStatus = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url === PROVIDERS[provider].tokenUrl) {
        return tokenStatus === 200
          ? Response.json({ access_token: 'token-1' })
          : new Response('nope', { status: tokenStatus })
      }
      if (url === PROVIDERS[provider].userinfoUrl) return Response.json(userinfo)
      throw new Error(`unexpected fetch: ${url}`)
    }),
  )
}

describe('provider listing and start (issue #121)', () => {
  it('lists only the providers that are configured', async () => {
    const { app } = await oauthApp({ google: CONFIGURED.google })
    const response = await inject(app, { url: '/api/auth/providers' })
    expect(await response.json()).toEqual([{ id: 'google', displayName: 'Google' }])
  })

  it('lists nothing when no provider is configured', async () => {
    const { app } = await createTestApp({ appOrigin: APP_ORIGIN })
    expect(await (await inject(app, { url: '/api/auth/providers' })).json()).toEqual([])
  })

  it('redirects to the provider with PKCE S256 and a signed state', async () => {
    const { app } = await oauthApp()
    const response = await inject(app, { url: '/api/auth/oauth/google' })
    expect(response.status).toBe(302)

    const location = new URL(response.headers['location'] ?? '')
    expect(`${location.origin}${location.pathname}`).toBe(PROVIDERS.google.authorizeUrl)
    expect(location.searchParams.get('client_id')).toBe('google-id')
    expect(location.searchParams.get('redirect_uri')).toBe(
      `${APP_ORIGIN}/api/auth/oauth/google/callback`,
    )
    expect(location.searchParams.get('response_type')).toBe('code')
    expect(location.searchParams.get('scope')).toBe('openid email profile')
    expect(location.searchParams.get('code_challenge_method')).toBe('S256')
    expect(location.searchParams.get('code_challenge')).not.toBeNull()

    const state = location.searchParams.get('state') ?? ''
    const payload = new OAuthStateSigner(TOKEN_SECRET).verify(state)
    expect(payload?.provider).toBe('google')
    expect(payload?.codeVerifier).toBeTruthy()
  })

  it('answers 404 for an unconfigured or unknown provider', async () => {
    const { app } = await oauthApp({ google: CONFIGURED.google })
    expect((await inject(app, { url: '/api/auth/oauth/facebook' })).status).toBe(404)
    expect((await inject(app, { url: '/api/auth/oauth/github' })).status).toBe(404)
  })
})

describe('callback (issue #121)', () => {
  it('refuses a forged or provider-mismatched state', async () => {
    const { app } = await oauthApp()
    const forged = await inject(app, { url: '/api/auth/oauth/google/callback?code=x&state=forged' })
    expect(forged.headers['location']).toContain('error=oauth_state')

    const mismatched = await inject(app, { url: callbackUrl('discord', signState('google')) })
    expect(mismatched.headers['location']).toContain('error=oauth_state')
  })

  it('reports a refused prompt as oauth_denied and a failed exchange as oauth_failed', async () => {
    const { app } = await oauthApp()

    const denied = await inject(app, {
      url: '/api/auth/oauth/google/callback?error=access_denied',
    })
    expect(denied.headers['location']).toContain('error=oauth_denied')

    stubProvider('google', {}, 500)
    const failed = await inject(app, { url: callbackUrl('google', signState('google')) })
    expect(failed.headers['location']).toContain('error=oauth_failed')
  })

  it('signs in an already-linked identity', async () => {
    const { app, repo } = await oauthApp()
    await repo.createPlayer({
      id: 'linked',
      username: 'linked',
      email: 'linked@example.com',
      passwordHash: '',
      createdAt: '2020-01-01T00:00:00.000Z',
      emailVerified: true,
      oauthProviders: [{ provider: 'google', providerUserId: 'g-1' }],
    })

    stubProvider('google', { sub: 'g-1', email: 'linked@example.com', email_verified: true })
    const response = await inject(app, { url: callbackUrl('google', signState('google')) })

    const token = tokenFromFragment(response.headers['location'] ?? '', 'token')
    const me = await inject(app, { url: '/api/auth/me', headers: bearer(token) })
    expect((await me.json<{ id: string }>()).id).toBe('linked')
  })

  it('links a unique verified email to an existing account', async () => {
    const { app, repo } = await oauthApp()
    await repo.createPlayer({
      id: 'owner',
      username: 'owner',
      email: 'owner@example.com',
      passwordHash: '',
      createdAt: '2020-01-01T00:00:00.000Z',
      emailVerified: true,
    })

    stubProvider('google', { sub: 'g-2', email: 'owner@example.com', email_verified: true })
    const response = await inject(app, { url: callbackUrl('google', signState('google')) })

    const token = tokenFromFragment(response.headers['location'] ?? '', 'token')
    const me = await inject(app, { url: '/api/auth/me', headers: bearer(token) })
    expect((await me.json<{ id: string }>()).id).toBe('owner')
    expect((await repo.findPlayerById('owner'))?.oauthProviders).toEqual([
      { provider: 'google', providerUserId: 'g-2' },
    ])
  })

  it('auto-links a stored address that has surrounding whitespace', async () => {
    const { app, repo } = await oauthApp()
    // A migrated or admin-set address can carry surrounding whitespace; the
    // link match trims the stored value before comparing.
    await repo.createPlayer({
      id: 'spaced',
      username: 'spaced',
      email: '  spaced@example.com  ',
      passwordHash: '',
      createdAt: '2020-01-01T00:00:00.000Z',
      emailVerified: true,
    })

    stubProvider('google', { sub: 'g-spaced', email: 'spaced@example.com', email_verified: true })
    const response = await inject(app, { url: callbackUrl('google', signState('google')) })

    const token = tokenFromFragment(response.headers['location'] ?? '', 'token')
    const me = await inject(app, { url: '/api/auth/me', headers: bearer(token) })
    expect((await me.json<{ id: string }>()).id).toBe('spaced')
    expect((await repo.findPlayerById('spaced'))?.oauthProviders).toEqual([
      { provider: 'google', providerUserId: 'g-spaced' },
    ])
  })

  it('does not link an address the provider calls unverified', async () => {
    const { app, repo } = await oauthApp()
    await repo.createPlayer({
      id: 'owner',
      username: 'owner',
      email: 'owner@example.com',
      passwordHash: '',
      createdAt: '2020-01-01T00:00:00.000Z',
      emailVerified: true,
    })

    stubProvider('google', { sub: 'g-3', email: 'owner@example.com', email_verified: false })
    const response = await inject(app, { url: callbackUrl('google', signState('google')) })

    expect(response.headers['location']).toContain('#pending=')
    expect((await repo.findPlayerById('owner'))?.oauthProviders ?? []).toEqual([])
  })

  it('refuses to link when two accounts share the verified address', async () => {
    const { app, repo } = await oauthApp()
    for (const id of ['a', 'b']) {
      await repo.createPlayer({
        id,
        username: id,
        email: 'dup@example.com',
        passwordHash: '',
        createdAt: '2020-01-01T00:00:00.000Z',
        emailVerified: true,
      })
    }

    stubProvider('google', { sub: 'g-4', email: 'dup@example.com', email_verified: true })
    const response = await inject(app, { url: callbackUrl('google', signState('google')) })
    expect(response.headers['location']).toContain('error=oauth_duplicate_email')
  })
})

describe('completion (issue #121)', () => {
  async function startPending(
    app: App,
    userinfo: unknown,
  ): Promise<string> {
    stubProvider('google', userinfo)
    const response = await inject(app, { url: callbackUrl('google', signState('google')) })
    return tokenFromFragment(response.headers['location'] ?? '', 'pending')
  }

  it('rejects a wrong answer and a taken username, then creates a verified account', async () => {
    const { app, repo } = await oauthApp()
    const pending = await startPending(app, {
      sub: 'g-new',
      email: 'new@example.com',
      email_verified: true,
    })

    const wrong = await inject(app, {
      method: 'POST',
      url: '/api/auth/complete-registration',
      payload: { pending, username: 'social-new', securityAnswer: 'the wheel' },
    })
    expect(wrong.status).toBe(400)
    expect((await wrong.json<{ error: string }>()).error).toBe('WRONG_SECURITY_ANSWER')

    await repo.createPlayer({
      id: 'taken',
      username: 'social-new',
      email: 'taken@example.com',
      passwordHash: '',
      createdAt: '2020-01-01T00:00:00.000Z',
      emailVerified: true,
    })
    const taken = await inject(app, {
      method: 'POST',
      url: '/api/auth/complete-registration',
      payload: { pending, username: 'social-new', securityAnswer: 'writing' },
    })
    expect(taken.status).toBe(409)
    expect((await taken.json<{ error: string }>()).error).toBe('USERNAME_TAKEN')

    const done = await inject(app, {
      method: 'POST',
      url: '/api/auth/complete-registration',
      payload: { pending, username: 'social-ok', securityAnswer: 'writing' },
    })
    expect(done.status).toBe(200)
    const body = await done.json<{
      token: string
      player: { id: string; email: string | null; emailVerified: boolean }
    }>()
    expect(body.player.email).toBe('new@example.com')
    expect(body.player.emailVerified).toBe(true)
    expect(body.player).not.toHaveProperty('passwordHash')

    const created = await repo.findPlayerById(body.player.id)
    expect(created?.passwordHash).toBe('')
    expect(created?.oauthProviders).toEqual([{ provider: 'google', providerUserId: 'g-new' }])
    expect(created?.emailVerified).toBe(true)

    // A password login on a social-only account simply fails.
    const login = await inject(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'social-ok', password: 'whatever' },
    })
    expect(login.status).toBe(401)
  })

  it('refuses completion when the address was taken in the meantime', async () => {
    const { app, repo } = await oauthApp()
    const pending = await startPending(app, {
      sub: 'g-race',
      email: 'raced@example.com',
      email_verified: true,
    })

    await repo.createPlayer({
      id: 'racer',
      username: 'racer',
      email: 'raced@example.com',
      passwordHash: '',
      createdAt: '2020-01-01T00:00:00.000Z',
      emailVerified: true,
    })

    const done = await inject(app, {
      method: 'POST',
      url: '/api/auth/complete-registration',
      payload: { pending, username: 'racer-new', securityAnswer: 'writing' },
    })
    expect(done.status).toBe(409)
    expect((await done.json<{ error: string }>()).error).toBe('EMAIL_TAKEN')
  })

  it('rejects an invalid or expired pending token', async () => {
    const { app } = await oauthApp()

    const nonsense = await inject(app, {
      method: 'POST',
      url: '/api/auth/complete-registration',
      payload: { pending: 'nonsense', username: 'x', securityAnswer: 'writing' },
    })
    expect(nonsense.status).toBe(400)

    const expired = new PendingRegistrationSigner(TOKEN_SECRET, -1_000).sign(
      {
        provider: 'google',
        providerUserId: 'g',
        email: 'e@x.y',
        emailVerified: true,
      },
      Date.now(),
    )
    const response = await inject(app, {
      method: 'POST',
      url: '/api/auth/complete-registration',
      payload: { pending: expired, username: 'x', securityAnswer: 'writing' },
    })
    expect(response.status).toBe(400)
  })

  it('completes an unverified provider account unverified and mails the link', async () => {
    const { app, repo, mailer } = await oauthApp()

    // Discord reports `verified: false`, so the account is not auto-verified
    // and a verification mail goes out.
    stubProvider('discord', { id: 'd-1', email: 'unverified@example.com', verified: false })
    const pendingResponse = await inject(app, {
      url: callbackUrl('discord', signState('discord')),
    })
    const pending = tokenFromFragment(pendingResponse.headers['location'] ?? '', 'pending')

    const done = await inject(app, {
      method: 'POST',
      url: '/api/auth/complete-registration',
      payload: { pending, username: 'discord-user', securityAnswer: 'writing' },
    })
    expect(done.status).toBe(200)

    expect((await repo.findPlayerByUsername('discord-user'))?.emailVerified).toBe(false)
    expect(mailer.sent.some((mail) => mail.subject === 'Please verify your email address')).toBe(true)
  })

  it('verifies a social account when there is no mailer, instead of locking it out', async () => {
    // The default no-op mailer means email delivery is disabled: an unverified
    // provider identity must still land verified, because no link could reach it.
    const { app, repo } = await createTestApp({ appOrigin: APP_ORIGIN, providers: CONFIGURED })

    stubProvider('discord', { id: 'd-nomail', email: 'nomail@example.com', verified: false })
    const pendingResponse = await inject(app, {
      url: callbackUrl('discord', signState('discord')),
    })
    const pending = tokenFromFragment(pendingResponse.headers['location'] ?? '', 'pending')

    const done = await inject(app, {
      method: 'POST',
      url: '/api/auth/complete-registration',
      payload: { pending, username: 'no-mailer-user', securityAnswer: 'writing' },
    })
    expect(done.status).toBe(200)

    expect((await repo.findPlayerByUsername('no-mailer-user'))?.emailVerified).toBe(true)
  })
})

describe('provider userinfo parsing', () => {
  it('reads Google and Discord identities', () => {
    expect(PROVIDERS.google.identity({ sub: 'g', email: 'g@x.y', email_verified: true })).toEqual({
      providerUserId: 'g',
      email: 'g@x.y',
      emailVerified: true,
    })
    expect(PROVIDERS.google.identity({ sub: 'g', email: 'g@x.y', email_verified: false })).toEqual({
      providerUserId: 'g',
      email: 'g@x.y',
      emailVerified: false,
    })
    expect(PROVIDERS.discord.identity({ id: 'd', email: 'd@x.y', verified: true })).toEqual({
      providerUserId: 'd',
      email: 'd@x.y',
      emailVerified: true,
    })
  })

  it('treats a returned Facebook address as verified and a missing one as unverified', () => {
    expect(PROVIDERS.facebook.identity({ id: 'f-1', email: 'f@example.com' })).toEqual({
      providerUserId: 'f-1',
      email: 'f@example.com',
      emailVerified: true,
    })
    expect(PROVIDERS.facebook.identity({ id: 'f-2' })).toEqual({
      providerUserId: 'f-2',
      email: null,
      emailVerified: false,
    })
  })

  it('rejects a userinfo body without a provider id', () => {
    expect(PROVIDERS.google.identity({ email: 'g@x.y' })).toBeUndefined()
    expect(PROVIDERS.facebook.identity({ name: 'no id' })).toBeUndefined()
  })
})
