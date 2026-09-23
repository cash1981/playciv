/**
 * Social login through Google, Facebook and Discord (issue #121).
 *
 * OAuth 2.0 authorization code with PKCE S256. The identity is read from the
 * provider's userinfo endpoint called over TLS with the token from the code
 * exchange — no `id_token` parsing or JWKS validation. Google's userinfo is the
 * standard OIDC endpoint, and a locally validated id_token would add a JWT
 * verifier for no security gain here. See `docs/agents/decisions.md`.
 *
 * Apple is deliberately not shipped: it needs a paid Apple Developer Program
 * membership. Adding it is a new entry in `PROVIDERS` and two environment
 * variables, nothing more.
 */

import { createHash, randomBytes } from 'node:crypto'

import type { Context } from 'hono'

import type { App } from './app.js'
import { isSecurityAnswer, newId } from './auth.js'
import type { AppContext, ProviderCredentials } from './context.js'
import { asRecord, requireString } from './context.js'
import { sendError } from './errors.js'
import { toPlayerDto } from './routes/auth.js'
import type { OAuthIdentity, ProviderId, StoredPlayer } from './store/types.js'
import { sendVerificationEmail } from './verification.js'

/** A provider's endpoints and how to read an identity from its userinfo. */
interface ProviderDefinition {
  readonly displayName: string
  readonly authorizeUrl: string
  readonly tokenUrl: string
  readonly userinfoUrl: string
  readonly scope: string
  /**
   * Reads the identity out of a userinfo response. `emailVerified` is false
   * when the provider says the address is not confirmed, or when there is no
   * address at all — Facebook only ever exposes a confirmed primary address, so
   * a returned one counts as verified.
   */
  readonly identity: (body: unknown) => ProviderIdentity | undefined
}

interface ProviderIdentity {
  readonly providerUserId: string
  readonly email: string | null
  readonly emailVerified: boolean
}

const PROVIDER_IDS = ['google', 'facebook', 'discord'] as const

const optionalEmail = (record: Record<string, unknown>): string | null => {
  const email = record['email']
  return typeof email === 'string' && email !== '' ? email : null
}

export const PROVIDERS: Readonly<Record<ProviderId, ProviderDefinition>> = {
  google: {
    displayName: 'Google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userinfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
    identity: (body) => {
      const record = asRecord(body)
      const id = record['sub']
      if (typeof id !== 'string' || id === '') return undefined
      return {
        providerUserId: id,
        email: optionalEmail(record),
        emailVerified: record['email_verified'] === true,
      }
    },
  },
  facebook: {
    displayName: 'Facebook',
    authorizeUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
    userinfoUrl: 'https://graph.facebook.com/v21.0/me?fields=id,name,email',
    scope: 'email public_profile',
    identity: (body) => {
      const record = asRecord(body)
      const id = record['id']
      if (typeof id !== 'string' || id === '') return undefined
      const email = optionalEmail(record)
      // Facebook exposes only a confirmed primary address; its presence is the
      // verification. It has no `email_verified` field to read.
      return { providerUserId: id, email, emailVerified: email !== null }
    },
  },
  discord: {
    displayName: 'Discord',
    authorizeUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userinfoUrl: 'https://discord.com/api/users/@me',
    scope: 'identify email',
    identity: (body) => {
      const record = asRecord(body)
      const id = record['id']
      if (typeof id !== 'string' || id === '') return undefined
      return {
        providerUserId: id,
        email: optionalEmail(record),
        emailVerified: record['verified'] === true,
      }
    },
  },
}

const isProviderId = (value: string): value is ProviderId =>
  (PROVIDER_IDS as readonly string[]).includes(value)

const callbackUrl = (context: AppContext, provider: ProviderId): string =>
  `${context.appOrigin}/api/auth/oauth/${provider}/callback`

/** Back into the SPA with a fragment the client reads once and then clears. */
const redirectToClient = (c: Context, context: AppContext, fragment: string): Response =>
  c.redirect(`${context.appOrigin}/auth/callback#${fragment}`, 302)

/**
 * Trades the authorization code for an access token. PKCE is on for every
 * provider, so the verifier from the signed state is required to complete it.
 */
async function exchangeCode(
  definition: ProviderDefinition,
  config: ProviderCredentials,
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<string> {
  const response = await fetch(definition.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code_verifier: codeVerifier,
    }),
  })
  if (!response.ok) throw new Error(`Token exchange failed (${response.status})`)
  const body = asRecord(await response.json())
  const accessToken = body['access_token']
  if (typeof accessToken !== 'string' || accessToken === '') {
    throw new Error('Token exchange returned no access_token')
  }
  return accessToken
}

async function fetchUserinfo(
  definition: ProviderDefinition,
  accessToken: string,
): Promise<unknown> {
  const response = await fetch(definition.userinfoUrl, {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new Error(`Userinfo request failed (${response.status})`)
  return response.json()
}

export function registerOAuthRoutes(app: App, context: AppContext): void {
  /** Only providers with both credentials are listed, so nothing dead is shown. */
  app.get('/api/auth/providers', (c) =>
    c.json(
      PROVIDER_IDS.filter((id) => context.providers[id] !== undefined).map((id) => ({
        id,
        displayName: PROVIDERS[id].displayName,
      })),
    ),
  )

  app.get('/api/auth/oauth/:provider', (c) => {
    const id = c.req.param('provider')
    if (!isProviderId(id)) {
      return sendError(c, 404, 'NOT_FOUND', `Unknown provider ${id}`)
    }
    const config = context.providers[id]
    if (config === undefined) {
      return sendError(c, 404, 'NOT_FOUND', `Provider ${id} is not configured`)
    }

    const definition = PROVIDERS[id]
    // 32 random bytes base64url: 43 characters, inside PKCE's 43–128 range.
    const codeVerifier = randomBytes(32).toString('base64url')
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
    const state = context.oauthStates.sign({ provider: id, codeVerifier })

    const authorize = new URL(definition.authorizeUrl)
    authorize.searchParams.set('client_id', config.clientId)
    authorize.searchParams.set('redirect_uri', callbackUrl(context, id))
    authorize.searchParams.set('response_type', 'code')
    authorize.searchParams.set('scope', definition.scope)
    authorize.searchParams.set('state', state)
    authorize.searchParams.set('code_challenge', codeChallenge)
    authorize.searchParams.set('code_challenge_method', 'S256')
    return c.redirect(authorize.toString(), 302)
  })

  app.get('/api/auth/oauth/:provider/callback', async (c) => {
    const id = c.req.param('provider')
    // A refused prompt comes back as `?error=...`, with no code to exchange.
    if (c.req.query('error') !== undefined) {
      return redirectToClient(c, context, 'error=oauth_denied')
    }
    if (!isProviderId(id)) {
      return redirectToClient(c, context, 'error=oauth_failed')
    }
    const config = context.providers[id]
    if (config === undefined) {
      return redirectToClient(c, context, 'error=oauth_failed')
    }

    const code = c.req.query('code')
    const state = c.req.query('state')
    if (code === undefined || state === undefined) {
      return redirectToClient(c, context, 'error=oauth_failed')
    }
    const statePayload = context.oauthStates.verify(state)
    if (statePayload === undefined || statePayload.provider !== id) {
      return redirectToClient(c, context, 'error=oauth_state')
    }

    const definition = PROVIDERS[id]
    let userinfo: unknown
    try {
      const accessToken = await exchangeCode(
        definition,
        config,
        code,
        statePayload.codeVerifier,
        callbackUrl(context, id),
      )
      userinfo = await fetchUserinfo(definition, accessToken)
    } catch {
      return redirectToClient(c, context, 'error=oauth_failed')
    }

    const identity = definition.identity(userinfo)
    if (identity === undefined) {
      return redirectToClient(c, context, 'error=oauth_failed')
    }

    const players = await context.repo.allPlayers()

    // 1. The provider identity is already linked: sign that account in.
    const linked = players.find((player) =>
      (player.oauthProviders ?? []).some(
        (entry) => entry.provider === id && entry.providerUserId === identity.providerUserId,
      ),
    )
    if (linked !== undefined) {
      return redirectToClient(c, context, `token=${context.tokens.sign(linked.id)}`)
    }

    // 2/3. No link, but a verified address matches existing accounts. Exactly
    // one is auto-linked; two or more are ambiguous, so an admin has to help.
    if (identity.email !== null && identity.emailVerified) {
      const wanted = identity.email.trim().toLowerCase()
      const matches = players.filter(
        (player) => player.email !== null && player.email.toLowerCase() === wanted,
      )
      if (matches.length > 1) {
        return redirectToClient(c, context, 'error=oauth_duplicate_email')
      }
      const match = matches[0]
      if (match !== undefined) {
        await context.repo.updatePlayer(match.id, {
          oauthProviders: [
            ...(match.oauthProviders ?? []),
            { provider: id, providerUserId: identity.providerUserId },
          ],
        })
        return redirectToClient(c, context, `token=${context.tokens.sign(match.id)}`)
      }
    }

    // 4. Otherwise the user picks a username first; the account row is only
    // created in the completion step, so an abandoned signup leaves nothing.
    const pending = context.pendingRegistrations.sign({
      provider: id,
      providerUserId: identity.providerUserId,
      email: identity.email,
      emailVerified: identity.emailVerified,
    })
    return redirectToClient(c, context, `pending=${pending}`)
  })

  /**
   * The completion step for a first provider login: a username and the old
   * security question, exactly as register asks them.
   */
  app.post('/api/auth/complete-registration', async (c) => {
    const body = asRecord(await c.req.json().catch(() => ({})))
    const pending = requireString(body, 'pending')
    const username = requireString(body, 'username')
    if (pending === undefined || username === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'pending and username are required')
    }

    const registration = context.pendingRegistrations.verify(pending)
    if (registration === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'The pending registration is invalid or has expired')
    }

    if (!isSecurityAnswer(body['securityAnswer'])) {
      return sendError(c, 400, 'WRONG_SECURITY_ANSWER', 'Wrong answer to the security question')
    }

    if ((await context.repo.findPlayerByUsername(username)) !== undefined) {
      return sendError(c, 409, 'USERNAME_TAKEN', `Username ${username} is taken`)
    }

    // The address may have been taken since the provider said it was verified.
    if (registration.email !== null) {
      const wanted = registration.email.trim().toLowerCase()
      const taken = (await context.repo.allPlayers()).some(
        (player) => player.email !== null && player.email.toLowerCase() === wanted,
      )
      if (taken) {
        return sendError(c, 409, 'EMAIL_TAKEN', `Email ${registration.email} is already in use`)
      }
    }

    // The pending token is signed by this server, so the provider id inside it
    // is one the table knows; the signer keeps it a plain string so the pure
    // auth module does not depend on the store types.
    const identity: OAuthIdentity = {
      provider: registration.provider as ProviderId,
      providerUserId: registration.providerUserId,
    }
    const player: StoredPlayer = {
      id: newId(),
      username,
      email: registration.email,
      // No password for a social-only account; `verifyPassword` returns false
      // for the empty value, so a password login simply fails.
      passwordHash: '',
      createdAt: new Date().toISOString(),
      role: 'user',
      disabled: false,
      emailVerified: registration.emailVerified,
      oauthProviders: [identity],
    }
    await context.repo.createPlayer(player)

    if (!player.emailVerified) {
      await sendVerificationEmail(context, player)
    }

    return c.json({
      token: context.tokens.sign(player.id),
      player: toPlayerDto(player),
    })
  })
}
