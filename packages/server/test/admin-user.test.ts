import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FastifyInstance } from 'fastify'
import { beforeEach, describe, expect, it } from 'vitest'

import { createTestApp } from '../src/app.js'
import type { JsonFileRepository } from '../src/store/json-file.js'

let app: FastifyInstance
let repo: JsonFileRepository

beforeEach(async () => {
  const created = await createTestApp()
  app = created.app
  repo = created.repo
})

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

async function register(username: string): Promise<{ id: string; token: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'secret', email: `${username}@example.com` },
  })
  expect(response.statusCode).toBe(201)
  const body = response.json() as { token: string; player: { id: string } }
  return { id: body.player.id, token: body.token }
}

async function makeAdmin(username: string): Promise<{ id: string; token: string }> {
  const account = await register(username)
  await repo.updatePlayer(account.id, { role: 'admin' })
  return account
}

describe('account access', () => {
  it('legacy JSON players default to an enabled user', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'civ-users-'))
    const path = join(directory, 'state.json')
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

    const { JsonFileRepository } = await import('../src/store/json-file.js')
    const legacy = new JsonFileRepository({ filePath: path })
    await legacy.load()
    expect(await legacy.findPlayerById('legacy-id')).toMatchObject({
      role: 'user',
      disabled: false,
    })
    await legacy.flush()
    await rm(directory, { recursive: true, force: true })
  })

  it('looks up the role from storage for an existing token', async () => {
    const account = await register('promoted-later')
    const denied = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: bearer(account.token),
    })
    expect(denied.statusCode).toBe(403)

    await repo.updatePlayer(account.id, { role: 'admin' })
    const allowed = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: bearer(account.token),
    })
    expect(allowed.statusCode).toBe(200)
  })

  it('only an admin can list users and the list has no password hashes', async () => {
    const user = await register('ordinary-user')
    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: bearer(user.token),
    })
    expect(forbidden.statusCode).toBe(403)

    const admin = await makeAdmin('account-admin')
    const listed = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: bearer(admin.token),
    })
    expect(listed.statusCode).toBe(200)
    expect(listed.body).not.toContain('passwordHash')
    expect(listed.body).not.toContain('secret')
  })

  it('an admin can disable, promote and delete another user', async () => {
    const admin = await makeAdmin('manager')
    const target = await register('managed')

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${target.id}`,
      headers: bearer(admin.token),
      payload: { role: 'admin', disabled: true },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json()).toMatchObject({ role: 'admin', disabled: true })

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'managed', password: 'secret' },
    })
    expect(login.statusCode).toBe(403)
    expect((login.json() as { error: string }).error).toBe('ACCOUNT_DISABLED')

    const disabledToken = target.token
    const blocked = await app.inject({
      method: 'GET',
      url: '/api/games',
      headers: bearer(disabledToken),
    })
    expect(blocked.statusCode).toBe(403)
    expect((blocked.json() as { error: string }).error).toBe('ACCOUNT_DISABLED')

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${target.id}`,
      headers: bearer(admin.token),
    })
    expect(deleted.statusCode).toBe(204)
    expect(await repo.findPlayerById(target.id)).toBeUndefined()
  })

  it('an admin role can end a game without being its creator', async () => {
    const creator = await register('game-owner')
    const admin = await makeAdmin('role-based-admin')
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      headers: bearer(creator.token),
      payload: { name: 'Role authorization game', numOfPlayers: 2 },
    })
    const gameId = (created.json() as { id: string }).id

    const ended = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/end`,
      headers: bearer(admin.token),
      payload: {},
    })
    expect(ended.statusCode).toBe(200)
    expect((await repo.findGame(gameId))?.active).toBe(false)
  })

  it('an admin can fix a username and email typo', async () => {
    const admin = await makeAdmin('editor-admin')
    const target = await register('mistyped')

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${target.id}`,
      headers: bearer(admin.token),
      payload: { username: 'corrected', email: 'corrected@example.com' },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json()).toMatchObject({ username: 'corrected', email: 'corrected@example.com' })

    // The renamed account logs in under its new username.
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'corrected', password: 'secret' },
    })
    expect(login.statusCode).toBe(200)
  })

  it('rejects a username already taken by another user', async () => {
    const admin = await makeAdmin('rename-admin')
    await register('taken-name')
    const target = await register('wants-rename')

    const conflict = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${target.id}`,
      headers: bearer(admin.token),
      payload: { username: 'taken-name' },
    })
    expect(conflict.statusCode).toBe(409)
    expect((conflict.json() as { error: string }).error).toBe('USERNAME_TAKEN')
  })

  it('lets a user keep its own name when only fixing the casing', async () => {
    const admin = await makeAdmin('casing-admin')
    const target = await register('lowercase')

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${target.id}`,
      headers: bearer(admin.token),
      payload: { username: 'LowerCase' },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json()).toMatchObject({ username: 'LowerCase' })
  })

  it('rejects an empty username', async () => {
    const admin = await makeAdmin('guard-admin')
    const target = await register('keeps-name')

    const rejected = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${target.id}`,
      headers: bearer(admin.token),
      payload: { username: '   ' },
    })
    expect(rejected.statusCode).toBe(400)
  })

  it('does not let the current admin lock or delete itself', async () => {
    const admin = await makeAdmin('self-protecting-admin')

    const disabled = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${admin.id}`,
      headers: bearer(admin.token),
      payload: { disabled: true },
    })
    expect(disabled.statusCode).toBe(409)
    expect((disabled.json() as { error: string }).error).toBe('SELF_LOCKOUT')

    const demoted = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${admin.id}`,
      headers: bearer(admin.token),
      payload: { role: 'user' },
    })
    expect(demoted.statusCode).toBe(409)

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${admin.id}`,
      headers: bearer(admin.token),
    })
    expect(deleted.statusCode).toBe(409)
    expect(await repo.findPlayerById(admin.id)).toBeDefined()
  })
})
