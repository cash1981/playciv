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

export const newId = (): string => randomUUID()
