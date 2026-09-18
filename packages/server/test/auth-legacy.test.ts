/**
 * Java counterpart: `CivAuthenticatorTest` and `PlayerActionTest` around
 * `DigestUtils.sha1Hex`. No Mongo needed — the legacy-hash detection is pure,
 * and the login-upgrade path is exercised against `JsonFileRepository`.
 */

import { createHash } from 'node:crypto'

import type { App } from '../src/app.js'
import { beforeEach, describe, expect, it } from 'vitest'

import { createTestApp } from '../src/app.js'
import { hashPassword, needsUpgrade, verifyPassword } from '../src/auth.js'
import type { JsonFileRepository } from '../src/store/json-file.js'
import type { StoredPlayer } from '../src/store/types.js'
import { inject } from './helpers.js'

const sha1Hex = (value: string): string => createHash('sha1').update(value, 'utf8').digest('hex')

describe('needsUpgrade', () => {
  it('is true for a raw SHA-1 hex string', () => {
    expect(needsUpgrade(sha1Hex('hunter2'))).toBe(true)
  })

  it('is false for a scrypt salt:hash string', async () => {
    expect(needsUpgrade(await hashPassword('hunter2'))).toBe(false)
  })
})

describe('verifyPassword', () => {
  it('accepts the legacy SHA-1 shape', async () => {
    expect(await verifyPassword('hunter2', sha1Hex('hunter2'))).toBe(true)
  })

  it('rejects a wrong password against a SHA-1 hash', async () => {
    expect(await verifyPassword('wrong', sha1Hex('hunter2'))).toBe(false)
  })

  it('accepts the current scrypt shape', async () => {
    expect(await verifyPassword('hunter2', await hashPassword('hunter2'))).toBe(true)
  })

  it('rejects a wrong password against a scrypt hash', async () => {
    expect(await verifyPassword('wrong', await hashPassword('hunter2'))).toBe(false)
  })
})

describe('login upgrades a legacy account', () => {
  let app: App
  let repo: JsonFileRepository

  beforeEach(async () => {
    const created = await createTestApp()
    app = created.app
    repo = created.repo
  })

  async function seedLegacyPlayer(username: string, password: string): Promise<StoredPlayer> {
    const player: StoredPlayer = {
      id: 'legacy-1',
      username,
      email: `${username}@example.com`,
      passwordHash: sha1Hex(password),
      createdAt: new Date(0).toISOString(),
    }
    await repo.createPlayer(player)
    return player
  }

  it('rewrites the stored hash to scrypt on a successful login', async () => {
    await seedLegacyPlayer('cash1981', 'oldpassword')

    const response = await inject(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'cash1981', password: 'oldpassword' },
    })
    expect(response.status).toBe(200)

    const stored = await repo.findPlayerById('legacy-1')
    expect(stored?.passwordHash).not.toBe(sha1Hex('oldpassword'))
    expect(needsUpgrade(stored?.passwordHash ?? '')).toBe(false)
  })

  it('still logs in with the same password after the upgrade', async () => {
    await seedLegacyPlayer('cash1981', 'oldpassword')

    await inject(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'cash1981', password: 'oldpassword' },
    })

    const second = await inject(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'cash1981', password: 'oldpassword' },
    })
    expect(second.status).toBe(200)
  })

  it('does not upgrade the hash on a failed login', async () => {
    await seedLegacyPlayer('cash1981', 'oldpassword')

    const response = await inject(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'cash1981', password: 'wrong' },
    })
    expect(response.status).toBe(401)

    const stored = await repo.findPlayerById('legacy-1')
    expect(needsUpgrade(stored?.passwordHash ?? '')).toBe(true)
  })
})
