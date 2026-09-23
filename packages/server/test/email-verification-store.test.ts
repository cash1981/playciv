/**
 * Storage and admin actions for email verification (issue #42).
 *
 * `0004_email_verified_oauth.sql` grandfathers every existing row and leaves
 * later rows unverified; the `Repository` implementations round-trip the new
 * columns; a legacy JSON file with no flag is treated as verified. The admin
 * routes carry the status, verify manually and send the link.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { App } from '../src/app.js'
import { createTestApp } from '../src/app.js'
import type { Mailer, OutgoingEmail } from '../src/mail.js'
import { D1Repository } from '../src/store/d1.js'
import { JsonFileRepository } from '../src/store/json-file.js'
import { createD1Adapter } from './d1-sqlite-adapter.js'
import type { D1Adapter } from './d1-sqlite-adapter.js'
import { bearer, inject, verifyRecordedEmail } from './helpers.js'
import { readMigrationFiles, readMigrations } from './migrations.js'

class FakeMailer implements Mailer {
  readonly enabled = true
  readonly sent: OutgoingEmail[] = []

  async send(email: OutgoingEmail): Promise<void> {
    this.sent.push(email)
  }
}

const schema = readMigrations()

describe('migration 0004_email_verified_oauth', () => {
  it('grandfathers rows that exist before it and leaves later rows unverified', () => {
    const files = readMigrationFiles()
    const migration = files.find((file) => file.name.startsWith('0004'))
    if (migration === undefined) throw new Error('0004_email_verified_oauth.sql is missing')
    const before = files.filter((file) => file.name < migration.name)

    const db = new DatabaseSync(':memory:')
    try {
      for (const file of before) db.exec(file.sql)
      // A row that exists before the migration. `role`, `disabled` and
      // `disable_email` have defaults, so only the NOT NULL columns are given.
      db.prepare(
        `INSERT INTO player (id, username, username_lower, email, password, created_at)
         VALUES ('legacy', 'cash', 'cash', 'c@example.com', 'sha1', '')`,
      ).run()

      db.exec(migration.sql)

      expect(
        db.prepare(`SELECT email_verified, oauth_providers FROM player WHERE id = 'legacy'`).get(),
      ).toMatchObject({ email_verified: 1, oauth_providers: '[]' })

      // A row created after the migration keeps the default 0: only the
      // pre-existing accounts are grandfathered.
      db.prepare(
        `INSERT INTO player (id, username, username_lower, email, password, created_at)
         VALUES ('fresh', 'newbie', 'newbie', NULL, '', '')`,
      ).run()
      expect(
        db.prepare(`SELECT email_verified FROM player WHERE id = 'fresh'`).get(),
      ).toMatchObject({ email_verified: 0 })
    } finally {
      db.close()
    }
  })
})

describe('D1Repository email verification', () => {
  let adapter: D1Adapter
  let repo: D1Repository

  beforeEach(async () => {
    adapter = await createD1Adapter(schema)
    repo = new D1Repository(adapter.db)
  })

  afterEach(() => {
    adapter.close()
  })

  it('round-trips the verified flag and the provider identities', async () => {
    await repo.createPlayer({
      id: 'p1',
      username: 'Alice',
      email: 'alice@example.com',
      passwordHash: '',
      createdAt: '2020-01-01T00:00:00.000Z',
      emailVerified: false,
      oauthProviders: [{ provider: 'google', providerUserId: 'g-1' }],
    })

    const found = await repo.findPlayerById('p1')
    expect(found?.emailVerified).toBe(false)
    expect(found?.oauthProviders).toEqual([{ provider: 'google', providerUserId: 'g-1' }])

    const updated = await repo.updatePlayer('p1', {
      emailVerified: true,
      oauthProviders: [{ provider: 'discord', providerUserId: 'd-1' }],
    })
    expect(updated?.emailVerified).toBe(true)
    expect(updated?.oauthProviders).toEqual([{ provider: 'discord', providerUserId: 'd-1' }])
  })

  it('treats a missing verified flag as verified, like the JSON repository', async () => {
    await repo.createPlayer({
      id: 'legacy',
      username: 'legacy',
      email: null,
      passwordHash: '',
      createdAt: '2020-01-01T00:00:00.000Z',
    })

    const found = await repo.findPlayerById('legacy')
    expect(found?.emailVerified).toBe(true)
    expect(found?.oauthProviders).toEqual([])
  })
})

describe('JsonFileRepository email verification', () => {
  it('normalizes a legacy file: a missing flag means verified', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'civ-verify-'))
    const path = join(directory, 'state.json')
    try {
      await writeFile(
        path,
        JSON.stringify({
          version: 1,
          players: [
            {
              id: 'legacy-id',
              username: 'legacy',
              email: null,
              passwordHash: 'legacy-hash',
              createdAt: '2020-01-01T00:00:00.000Z',
            },
          ],
          games: [],
          chat: [],
        }),
        'utf8',
      )

      const repo = new JsonFileRepository({ filePath: path })
      await repo.load()
      expect(await repo.findPlayerById('legacy-id')).toMatchObject({
        emailVerified: true,
        oauthProviders: [],
      })

      // The normalized value survives a flush and reload.
      await repo.flush()
      const reloaded = new JsonFileRepository({ filePath: path })
      await reloaded.load()
      expect((await reloaded.findPlayerById('legacy-id'))?.emailVerified).toBe(true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('keeps an explicit unverified flag and normalizes the identities', async () => {
    const repo = new JsonFileRepository({ filePath: null })
    await repo.createPlayer({
      id: 'fresh',
      username: 'fresh',
      email: 'fresh@example.com',
      passwordHash: '',
      createdAt: '2020-01-01T00:00:00.000Z',
      emailVerified: false,
    })

    const found = await repo.findPlayerById('fresh')
    expect(found?.emailVerified).toBe(false)
    expect(found?.oauthProviders).toEqual([])
  })
})

describe('admin verification actions', () => {
  let app: App
  let repo: JsonFileRepository
  let mailer: FakeMailer

  beforeEach(async () => {
    mailer = new FakeMailer()
    const created = await createTestApp({ mailer, appOrigin: 'https://playciv.test' })
    app = created.app
    repo = created.repo
  })

  async function register(username: string): Promise<{ id: string; token: string }> {
    const response = await inject(app, {
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        username,
        password: 'secret',
        email: `${username}@example.com`,
        securityAnswer: 'writing',
      },
    })
    expect(response.status).toBe(201)
    const body = await response.json<{ token: string; player: { id: string } }>()
    // The admin routes below are writes, so the account has to be verified.
    await verifyRecordedEmail(app, mailer, `${username}@example.com`)
    return { id: body.player.id, token: body.token }
  }

  async function makeAdmin(username: string): Promise<{ id: string; token: string }> {
    const account = await register(username)
    await repo.updatePlayer(account.id, { role: 'admin' })
    return account
  }

  it('lists the status, verifies manually and clears it when the address changes', async () => {
    const admin = await makeAdmin('verify-admin')
    const target = await register('verify-target')
    await repo.updatePlayer(target.id, { emailVerified: false })

    const list = await inject(app, { url: '/api/admin/users', headers: bearer(admin.token) })
    const rows = await list.json<readonly { id: string; emailVerified: boolean }[]>()
    expect(rows.find((row) => row.id === target.id)?.emailVerified).toBe(false)

    const verified = await inject(app, {
      method: 'PATCH',
      url: `/api/admin/users/${target.id}`,
      headers: bearer(admin.token),
      payload: { emailVerified: true },
    })
    expect(verified.status).toBe(200)
    expect((await verified.json<{ emailVerified: boolean }>()).emailVerified).toBe(true)

    // A changed address is unproven, so it clears verification again.
    const moved = await inject(app, {
      method: 'PATCH',
      url: `/api/admin/users/${target.id}`,
      headers: bearer(admin.token),
      payload: { email: 'moved-target@example.com' },
    })
    expect(moved.status).toBe(200)
    const movedBody = await moved.json<{ email: string | null; emailVerified: boolean }>()
    expect(movedBody.email).toBe('moved-target@example.com')
    expect(movedBody.emailVerified).toBe(false)
  })

  it('sends the verification link, and refuses a non-admin', async () => {
    const admin = await makeAdmin('send-admin')
    const target = await register('send-target')
    await repo.updatePlayer(target.id, { emailVerified: false })
    mailer.sent.length = 0

    const sent = await inject(app, {
      method: 'POST',
      url: `/api/admin/users/${target.id}/send-verification`,
      headers: bearer(admin.token),
    })
    expect(sent.status).toBe(200)
    expect(await sent.json()).toEqual({ ok: true })
    expect(
      mailer.sent.some(
        (mail) =>
          mail.to === 'send-target@example.com' &&
          mail.subject === 'Please verify your email address',
      ),
    ).toBe(true)

    const user = await register('not-an-admin')
    expect(
      (
        await inject(app, {
          method: 'POST',
          url: `/api/admin/users/${target.id}/send-verification`,
          headers: bearer(user.token),
        })
      ).status,
    ).toBe(403)
    expect(
      (await inject(app, { url: '/api/admin/users', headers: bearer(user.token) })).status,
    ).toBe(403)
  })

  it('answers 404 for an unknown user', async () => {
    const admin = await makeAdmin('missing-admin')
    const response = await inject(app, {
      method: 'POST',
      url: '/api/admin/users/does-not-exist/send-verification',
      headers: bearer(admin.token),
    })
    expect(response.status).toBe(404)
  })
})
