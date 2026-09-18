import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { App } from '../src/app.js'
import { beforeEach, describe, expect, it } from 'vitest'

import { createTestApp } from '../src/app.js'
import type { JsonFileRepository } from '../src/store/json-file.js'
import { inject } from './helpers.js'

let app: App
let repo: JsonFileRepository

beforeEach(async () => {
  const created = await createTestApp()
  app = created.app
  repo = created.repo
})

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

async function register(username: string): Promise<{ id: string; token: string }> {
  const response = await inject(app, {
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'secret', email: `${username}@example.com` },
  })
  expect(response.status).toBe(201)
  const body = await response.json() as { token: string; player: { id: string } }
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
    const denied = await inject(app, {
      method: 'GET',
      url: '/api/admin/users',
      headers: bearer(account.token),
    })
    expect(denied.status).toBe(403)

    await repo.updatePlayer(account.id, { role: 'admin' })
    const allowed = await inject(app, {
      method: 'GET',
      url: '/api/admin/users',
      headers: bearer(account.token),
    })
    expect(allowed.status).toBe(200)
  })

  it('only an admin can list users and the list has no password hashes', async () => {
    const user = await register('ordinary-user')
    const forbidden = await inject(app, {
      method: 'GET',
      url: '/api/admin/users',
      headers: bearer(user.token),
    })
    expect(forbidden.status).toBe(403)

    const admin = await makeAdmin('account-admin')
    const listed = await inject(app, {
      method: 'GET',
      url: '/api/admin/users',
      headers: bearer(admin.token),
    })
    expect(listed.status).toBe(200)
    expect(listed.body).not.toContain('passwordHash')
    expect(listed.body).not.toContain('secret')
  })

  it('an admin can disable, promote and delete another user', async () => {
    const admin = await makeAdmin('manager')
    const target = await register('managed')

    const updated = await inject(app, {
      method: 'PATCH',
      url: `/api/admin/users/${target.id}`,
      headers: bearer(admin.token),
      payload: { role: 'admin', disabled: true },
    })
    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject({ role: 'admin', disabled: true })

    const login = await inject(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'managed', password: 'secret' },
    })
    expect(login.status).toBe(403)
    expect((await login.json() as { error: string }).error).toBe('ACCOUNT_DISABLED')

    const disabledToken = target.token
    const blocked = await inject(app, {
      method: 'GET',
      url: '/api/games',
      headers: bearer(disabledToken),
    })
    expect(blocked.status).toBe(403)
    expect((await blocked.json() as { error: string }).error).toBe('ACCOUNT_DISABLED')

    const deleted = await inject(app, {
      method: 'DELETE',
      url: `/api/admin/users/${target.id}`,
      headers: bearer(admin.token),
    })
    expect(deleted.status).toBe(204)
    expect(await repo.findPlayerById(target.id)).toBeUndefined()
  })

  it('an admin role can end a game without being its creator', async () => {
    const creator = await register('game-owner')
    const admin = await makeAdmin('role-based-admin')
    const created = await inject(app, {
      method: 'POST',
      url: '/api/games',
      headers: bearer(creator.token),
      payload: { name: 'Role authorization game', numOfPlayers: 2 },
    })
    const gameId = (await created.json() as { id: string }).id

    const ended = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/end`,
      headers: bearer(admin.token),
      payload: {},
    })
    expect(ended.status).toBe(200)
    expect((await repo.findGame(gameId))?.active).toBe(false)
  })

  it('an admin can fix a username and email typo', async () => {
    const admin = await makeAdmin('editor-admin')
    const target = await register('mistyped')

    const updated = await inject(app, {
      method: 'PATCH',
      url: `/api/admin/users/${target.id}`,
      headers: bearer(admin.token),
      payload: { username: 'corrected', email: 'corrected@example.com' },
    })
    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject({ username: 'corrected', email: 'corrected@example.com' })

    // The renamed account logs in under its new username.
    const login = await inject(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'corrected', password: 'secret' },
    })
    expect(login.status).toBe(200)
  })

  it('rejects a username already taken by another user', async () => {
    const admin = await makeAdmin('rename-admin')
    await register('taken-name')
    const target = await register('wants-rename')

    const conflict = await inject(app, {
      method: 'PATCH',
      url: `/api/admin/users/${target.id}`,
      headers: bearer(admin.token),
      payload: { username: 'taken-name' },
    })
    expect(conflict.status).toBe(409)
    expect((await conflict.json() as { error: string }).error).toBe('USERNAME_TAKEN')
  })

  it('lets a user keep its own name when only fixing the casing', async () => {
    const admin = await makeAdmin('casing-admin')
    const target = await register('lowercase')

    const updated = await inject(app, {
      method: 'PATCH',
      url: `/api/admin/users/${target.id}`,
      headers: bearer(admin.token),
      payload: { username: 'LowerCase' },
    })
    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject({ username: 'LowerCase' })
  })

  it('rejects an empty username', async () => {
    const admin = await makeAdmin('guard-admin')
    const target = await register('keeps-name')

    const rejected = await inject(app, {
      method: 'PATCH',
      url: `/api/admin/users/${target.id}`,
      headers: bearer(admin.token),
      payload: { username: '   ' },
    })
    expect(rejected.status).toBe(400)
  })

  it('does not let the current admin lock or delete itself', async () => {
    const admin = await makeAdmin('self-protecting-admin')

    const disabled = await inject(app, {
      method: 'PATCH',
      url: `/api/admin/users/${admin.id}`,
      headers: bearer(admin.token),
      payload: { disabled: true },
    })
    expect(disabled.status).toBe(409)
    expect((await disabled.json() as { error: string }).error).toBe('SELF_LOCKOUT')

    const demoted = await inject(app, {
      method: 'PATCH',
      url: `/api/admin/users/${admin.id}`,
      headers: bearer(admin.token),
      payload: { role: 'user' },
    })
    expect(demoted.status).toBe(409)

    const deleted = await inject(app, {
      method: 'DELETE',
      url: `/api/admin/users/${admin.id}`,
      headers: bearer(admin.token),
    })
    expect(deleted.status).toBe(409)
    expect(await repo.findPlayerById(admin.id)).toBeDefined()
  })
})
