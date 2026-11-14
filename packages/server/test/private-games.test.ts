/**
 * Private games (issue #348): the creator invites players by username, an email goes out, only they can join,
 * and nobody else sees the game in a lobby list. New in the port, so there is no Java counterpart.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import type { App } from '../src/app.js'
import { createTestApp } from '../src/app.js'
import type { Mailer, OutgoingEmail } from '../src/mail.js'
import type { JsonFileRepository } from '../src/store/json-file.js'
import { bearer, inject } from './helpers.js'

class FakeMailer implements Mailer {
  readonly sent: OutgoingEmail[] = []
  async send(email: OutgoingEmail): Promise<void> {
    this.sent.push(email)
  }
}

let app: App
let repo: JsonFileRepository
let mailer: FakeMailer

beforeEach(async () => {
  mailer = new FakeMailer()
  const created = await createTestApp({ mailer, appOrigin: 'https://playciv.app' })
  app = created.app
  repo = created.repo
})

async function register(username: string): Promise<string> {
  const response = await inject(app, {
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hemmelig', email: `${username}@example.com`, securityAnswer: 'writing' },
  })
  expect(response.status).toBe(201)
  return ((await response.json()) as { token: string }).token
}

const create = (token: string, payload: Record<string, unknown>) =>
  inject(app, { method: 'POST', url: '/api/games', headers: bearer(token), payload })

const join = (token: string, gameId: string) =>
  inject(app, { method: 'POST', url: `/api/games/${gameId}/join`, headers: bearer(token), payload: {} })

const listed = async (token: string | null, url: string): Promise<string[]> => {
  const response = await inject(app, { url, ...(token === null ? {} : { headers: bearer(token) }) })
  return ((await response.json()) as { name: string }[]).map((game) => game.name)
}

describe('private games', () => {
  it('mails the invited, lets only them join and hides the game from everyone else', async () => {
    const owner = await register('priv-owner')
    await register('priv-friend')
    const friend = await inject(app, {
      method: 'POST', url: '/api/auth/login', payload: { username: 'priv-friend', password: 'hemmelig' },
    })
    const friendToken = ((await friend.json()) as { token: string }).token
    const stranger = await register('priv-stranger')

    const created = await create(owner, {
      name: 'Secret table', numOfPlayers: 3, invitedUsernames: ['priv-friend'],
    })
    expect(created.status).toBe(201)
    const summary = (await created.json()) as { id: string; private: boolean }
    expect(summary.private).toBe(true)

    expect(mailer.sent.map((mail) => mail.to)).toEqual(['priv-friend@example.com'])
    expect(mailer.sent[0]?.text).toContain(`https://playciv.app/game/${summary.id}`)

    expect(await listed(friendToken, '/api/games')).toContain('Secret table')
    expect(await listed(owner, '/api/public/games')).toContain('Secret table')
    expect(await listed(stranger, '/api/games')).not.toContain('Secret table')
    expect(await listed(stranger, '/api/public/games')).not.toContain('Secret table')
    expect(await listed(null, '/api/public/games')).not.toContain('Secret table')

    const rejected = await join(stranger, summary.id)
    expect(rejected.status).toBe(403)
    expect(((await rejected.json()) as { error: string }).error).toBe('NOT_INVITED')

    expect((await join(friendToken, summary.id)).status).toBe(200)
    expect((await repo.findGame(summary.id))?.players).toHaveLength(2)
  })

  it('rejects an unknown invitee, an empty list and too many invitees', async () => {
    const owner = await register('priv-owner2')
    await register('priv-a')
    await register('priv-b')

    const unknown = await create(owner, { name: 'X1', numOfPlayers: 3, invitedUsernames: ['nobody-here'] })
    expect(unknown.status).toBe(400)
    const empty = await create(owner, { name: 'X2', numOfPlayers: 3, invitedUsernames: [] })
    expect(empty.status).toBe(400)
    const many = await create(owner, { name: 'X3', numOfPlayers: 2, invitedUsernames: ['priv-a', 'priv-b'] })
    expect(many.status).toBe(400)
    expect(mailer.sent).toHaveLength(0)
  })

  it('a game without invitees stays public', async () => {
    const owner = await register('pub-owner')
    const other = await register('pub-other')
    const created = await create(owner, { name: 'Open table', numOfPlayers: 3 })
    expect(((await created.json()) as { private: boolean }).private).toBe(false)
    expect(await listed(other, '/api/games')).toContain('Open table')
    expect((await join(other, ((await created.json()) as { id: string }).id)).status).toBe(200)
  })
})
