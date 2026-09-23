/**
 * Authentication.
 *
 * Java used HTTP Basic with unsalted SHA-1 (`DigestUtils.sha1Hex`) and a Guava
 * cache in front of Mongo. Here passwords are salted scrypt hashes, and an
 * HMAC-signed bearer token stands in for Basic on every request.
 *
 * The restored `playciv` database still has 553 accounts with the old SHA-1
 * hash. `verifyPassword` accepts both shapes so those accounts keep working;
 * `needsUpgrade` tells the login route when to rewrite one to scrypt.
 * Java: `PlayerAction.java:601` (`DigestUtils.sha1Hex(decodedPassword)`) and
 * `CivAuthenticator.java:51` (`player.getPassword().equals(sha1Hex(credentials))`).
 *
 * This is development grade: the token cannot be revoked, and the secret falls
 * back to a random value per start when it is not set.
 */

import { createHash, createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>

const KEY_LENGTH = 64

/**
 * A raw `sha1Hex` value: 40 hex characters, no `:` separator. Lowercase only
 * — `DigestUtils.sha1Hex` never emits uppercase, and Java's `String.equals`
 * in `CivAuthenticator` is case-sensitive, so this matches that exactly.
 */
const SHA1_HEX = /^[0-9a-f]{40}$/

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = await scryptAsync(password, salt, KEY_LENGTH)
  return `${salt}:${derived.toString('hex')}`
}

/** True for the legacy unsalted-SHA-1 shape; false for a scrypt `salt:hash`. */
export function needsUpgrade(stored: string): boolean {
  return SHA1_HEX.test(stored)
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (needsUpgrade(stored)) {
    const derived = createHash('sha1').update(password, 'utf8').digest('hex')
    const derivedBuffer = Buffer.from(derived, 'utf8')
    const expectedBuffer = Buffer.from(stored, 'utf8')
    return timingSafeEqual(derivedBuffer, expectedBuffer)
  }

  const [salt, expected] = stored.split(':')
  if (salt === undefined || expected === undefined) return false

  const derived = await scryptAsync(password, salt, KEY_LENGTH)
  const expectedBuffer = Buffer.from(expected, 'hex')
  if (expectedBuffer.length !== derived.length) return false

  return timingSafeEqual(derived, expectedBuffer)
}

/**
 * The old signup form's fixed security question — "What is China's starting
 * tech?", answered `writing` — turned into a server-side gate (issue #40).
 *
 * AngularJS: `RegisterController.js:37` compared the raw control value with
 * `toUpperCase()` against `"WRITING"`. There is deliberately no trimming here
 * either, so ` writing` is rejected exactly as the old client rejected it.
 */
export function isSecurityAnswer(answer: unknown): boolean {
  return typeof answer === 'string' && answer.toUpperCase() === 'WRITING'
}

export interface TokenPayload {
  readonly playerId: string
  readonly expiresAt: number
}

const base64url = (value: string): string =>
  Buffer.from(value, 'utf8').toString('base64url')

const fromBase64url = (value: string): string =>
  Buffer.from(value, 'base64url').toString('utf8')

export class TokenSigner {
  private readonly secret: string
  private readonly ttlMs: number

  constructor(secret: string, ttlMs = 30 * 24 * 60 * 60 * 1000) {
    this.secret = secret
    this.ttlMs = ttlMs
  }

  sign(playerId: string, now = Date.now()): string {
    const payload: TokenPayload = { playerId, expiresAt: now + this.ttlMs }
    const body = base64url(JSON.stringify(payload))
    return `${body}.${this.signature(body)}`
  }

  verify(token: string, now = Date.now()): TokenPayload | undefined {
    const [body, signature] = token.split('.')
    if (body === undefined || signature === undefined) return undefined

    const expected = this.signature(body)
    if (
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      return undefined
    }

    let payload: TokenPayload
    try {
      payload = JSON.parse(fromBase64url(body)) as TokenPayload
    } catch {
      return undefined
    }

    if (typeof payload.playerId !== 'string' || payload.expiresAt < now) return undefined
    return payload
  }

  private signature(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url')
  }
}

/** What a password-reset link carries. Never the plaintext password. */
export interface ResetTokenPayload {
  readonly playerId: string
  /** The scrypt hash to install once the link is opened. */
  readonly passwordHash: string
  readonly expiresAt: number
}

const RESET_KEY_LABEL = 'password-reset'

/**
 * Signs a password-reset link (issue #37). Deliberately uses a key *derived*
 * from the session secret rather than the secret itself: `TokenSigner.verify`
 * accepts any signed body carrying a `playerId` and a future `expiresAt`, which
 * this payload also has, so sharing the key would let a reset link authenticate
 * as the user. `ttlMs` defaults to one hour.
 */
export class ResetTokenSigner {
  private readonly key: string
  private readonly ttlMs: number

  constructor(secret: string, ttlMs = 60 * 60 * 1000) {
    this.key = createHmac('sha256', secret).update(RESET_KEY_LABEL).digest('hex')
    this.ttlMs = ttlMs
  }

  sign(
    payload: { readonly playerId: string; readonly passwordHash: string },
    now = Date.now(),
  ): string {
    const body = base64url(JSON.stringify({ ...payload, expiresAt: now + this.ttlMs }))
    return `${body}.${this.signature(body)}`
  }

  verify(token: string, now = Date.now()): ResetTokenPayload | undefined {
    const [body, signature] = token.split('.')
    if (body === undefined || signature === undefined) return undefined

    const expected = this.signature(body)
    if (
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      return undefined
    }

    let payload: ResetTokenPayload
    try {
      payload = JSON.parse(fromBase64url(body)) as ResetTokenPayload
    } catch {
      return undefined
    }

    if (
      typeof payload.playerId !== 'string' ||
      typeof payload.passwordHash !== 'string' ||
      payload.expiresAt < now
    ) {
      return undefined
    }
    return payload
  }

  private signature(body: string): string {
    return createHmac('sha256', this.key).update(body).digest('base64url')
  }
}

// ---------------------------------------------------------------------------
// Derived-key link and token signers
// ---------------------------------------------------------------------------

/**
 * The signature machinery the signers below share. Each kind of token derives
 * its own key from the session secret, so a token minted for one purpose cannot
 * be replayed as another even when their payloads overlap. A plain
 * `TokenSigner` would accept any signed body with a `playerId` and a future
 * `expiresAt`, which is exactly what these payloads carry.
 */
function derivedKey(secret: string, label: string): string {
  return createHmac('sha256', secret).update(label).digest('hex')
}

function signExpiring(
  key: string,
  payload: Record<string, unknown>,
  ttlMs: number,
  now: number,
): string {
  const body = base64url(JSON.stringify({ ...payload, expiresAt: now + ttlMs }))
  return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`
}

function verifyExpiring<T>(
  key: string,
  token: string,
  parse: (raw: Record<string, unknown>) => T | undefined,
): T | undefined {
  const [body, signature] = token.split('.')
  if (body === undefined || signature === undefined) return undefined

  const expected = createHmac('sha256', key).update(body).digest('base64url')
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return undefined
  }

  let raw: unknown
  try {
    raw = JSON.parse(fromBase64url(body))
  } catch {
    return undefined
  }
  if (typeof raw !== 'object' || raw === null) return undefined
  return parse(raw as Record<string, unknown>)
}

/** What an email-verification link carries. The player id, nothing else. */
export interface EmailVerifyTokenPayload {
  readonly playerId: string
  readonly expiresAt: number
}

const EMAIL_VERIFY_KEY_LABEL = 'email-verification'

/**
 * Signs the "verify your email" link (issue #42). Modelled on
 * `ResetTokenSigner` and using its own key label, so a verification token
 * cannot authenticate as a session token or complete a password reset even
 * though all three carry a `playerId`. `ttlMs` defaults to 24 hours.
 */
export class EmailVerifyTokenSigner {
  private readonly key: string
  private readonly ttlMs: number

  constructor(secret: string, ttlMs = 24 * 60 * 60 * 1000) {
    this.key = derivedKey(secret, EMAIL_VERIFY_KEY_LABEL)
    this.ttlMs = ttlMs
  }

  sign(payload: { readonly playerId: string }, now = Date.now()): string {
    return signExpiring(this.key, payload, this.ttlMs, now)
  }

  verify(token: string, now = Date.now()): EmailVerifyTokenPayload | undefined {
    return verifyExpiring(this.key, token, (raw) => {
      const playerId = raw['playerId']
      const expiresAt = raw['expiresAt']
      if (typeof playerId !== 'string') return undefined
      if (typeof expiresAt !== 'number' || expiresAt < now) return undefined
      return { playerId, expiresAt }
    })
  }
}

/** The PKCE verifier and the provider carried from start to callback. */
export interface OAuthStatePayload {
  readonly provider: string
  readonly codeVerifier: string
  readonly expiresAt: number
}

const OAUTH_STATE_KEY_LABEL = 'oauth-state'

/**
 * Signs the OAuth `state` (issue #121). Self-contained — no cookie, the same
 * idea as the reset link — and short lived. The callback refuses a state signed
 * for a different provider than the one in the path. `ttlMs` defaults to 10
 * minutes.
 */
export class OAuthStateSigner {
  private readonly key: string
  private readonly ttlMs: number

  constructor(secret: string, ttlMs = 10 * 60 * 1000) {
    this.key = derivedKey(secret, OAUTH_STATE_KEY_LABEL)
    this.ttlMs = ttlMs
  }

  sign(
    payload: { readonly provider: string; readonly codeVerifier: string },
    now = Date.now(),
  ): string {
    return signExpiring(this.key, payload, this.ttlMs, now)
  }

  verify(token: string, now = Date.now()): OAuthStatePayload | undefined {
    return verifyExpiring(this.key, token, (raw) => {
      const provider = raw['provider']
      const codeVerifier = raw['codeVerifier']
      const expiresAt = raw['expiresAt']
      if (typeof provider !== 'string' || typeof codeVerifier !== 'string') return undefined
      if (typeof expiresAt !== 'number' || expiresAt < now) return undefined
      return { provider, codeVerifier, expiresAt }
    })
  }
}

/** A provider identity held until the user picks a username (issue #121). */
export interface PendingRegistrationPayload {
  readonly provider: string
  readonly providerUserId: string
  readonly email: string | null
  readonly emailVerified: boolean
  readonly expiresAt: number
}

const PENDING_REGISTRATION_KEY_LABEL = 'oauth-pending'

/**
 * Signs the pending-registration token handed to the SPA after a first provider
 * login. The account row is only created in the completion step, so an
 * abandoned signup leaves nothing behind. `ttlMs` defaults to 15 minutes.
 */
export class PendingRegistrationSigner {
  private readonly key: string
  private readonly ttlMs: number

  constructor(secret: string, ttlMs = 15 * 60 * 1000) {
    this.key = derivedKey(secret, PENDING_REGISTRATION_KEY_LABEL)
    this.ttlMs = ttlMs
  }

  sign(
    payload: {
      readonly provider: string
      readonly providerUserId: string
      readonly email: string | null
      readonly emailVerified: boolean
    },
    now = Date.now(),
  ): string {
    return signExpiring(this.key, payload, this.ttlMs, now)
  }

  verify(token: string, now = Date.now()): PendingRegistrationPayload | undefined {
    return verifyExpiring(this.key, token, (raw) => {
      const provider = raw['provider']
      const providerUserId = raw['providerUserId']
      const email = raw['email']
      const emailVerified = raw['emailVerified']
      const expiresAt = raw['expiresAt']
      if (typeof provider !== 'string' || typeof providerUserId !== 'string') return undefined
      if (email !== null && typeof email !== 'string') return undefined
      if (typeof emailVerified !== 'boolean') return undefined
      if (typeof expiresAt !== 'number' || expiresAt < now) return undefined
      return { provider, providerUserId, email, emailVerified, expiresAt }
    })
  }
}

export const newId = (): string => randomUUID()
