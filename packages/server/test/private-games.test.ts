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

    await register('priv-second')
    const created = await create(owner, {
      name: 'Secret table', numOfPlayers: 3, invitedUsernames: ['PRIV-FRIEND', 'priv-second'],
    })
    expect(created.status).toBe(201)
    const summary = (await created.json()) as { id: string; private: boolean }
    expect(summary.private).toBe(true)

    expect(mailer.sent.map((mail) => mail.to)).toEqual(['priv-friend@example.com', 'priv-second@example.com'])
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

    // The invited ids never reach a viewer, in the game or in the lobby lists.
    const stored = await repo.findGame(summary.id)
    const seated = new Set(stored?.players.map((player) => player.playerId))
    // Seated players' ids already appear in views; the invitee who has not joined must not.
    const ids = (stored?.invitedPlayerIds ?? []).filter((id) => !seated.has(id))
    expect(stored?.invitedPlayerIds).toHaveLength(3)
    expect(ids).toHaveLength(1)
    for (const url of [`/api/games/${summary.id}`, '/api/games', '/api/public/games']) {
      const body = (await inject(app, { url, headers: bearer(owner) })).body
      expect(body).not.toContain('invitedPlayerIds')
      for (const id of ids) expect(body).not.toContain(id)
    }
  })

  it('rejects an unknown invitee, an empty list and too many invitees', async () => {
    const owner = await register('priv-owner2')
    await register('priv-a')
    await register('priv-b')

    const unknown = await create(owner, { name: 'X1', numOfPlayers: 2, invitedUsernames: ['nobody-here'] })
    expect(unknown.status).toBe(400)
    const empty = await create(owner, { name: 'X2', numOfPlayers: 3, invitedUsernames: [] })
    expect(empty.status).toBe(400)
    const many = await create(owner, { name: 'X3', numOfPlayers: 2, invitedUsernames: ['priv-a', 'priv-b'] })
    expect(many.status).toBe(400)
    // Too few would leave a private game that can never fill up.
    const few = await create(owner, { name: 'X4', numOfPlayers: 4, invitedUsernames: ['priv-a', 'priv-b'] })
    expect(few.status).toBe(400)
    // Inviting yourself, or the same person twice, does not count as an invitee.
    const self = await create(owner, { name: 'X5', numOfPlayers: 3, invitedUsernames: ['priv-owner2', 'PRIV-A', 'priv-a'] })
    expect(self.status).toBe(400)
    // A malformed list must not quietly give a public game.
    for (const bad of ['priv-a', null, ['priv-a', 5], { 0: 'priv-a' }]) {
      const response = await create(owner, { name: 'X6', numOfPlayers: 2, invitedUsernames: bad })
      expect(response.status).toBe(400)
    }
    expect(await listed(owner, '/api/games')).toEqual([])
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

  it('searches usernames for the invite autocomplete', async () => {
    const owner = await register('srch-owner')
    await register('anna-s')
    await register('Joanna-s')
    await register('bob-s')
    const search = async (query: string, token: string | null = owner): Promise<string[]> => {
      const response = await inject(app, {
        url: `/api/players/search?q=${encodeURIComponent(query)}`,
        ...(token === null ? {} : { headers: bearer(token) }),
      })
      expect(response.status).toBe(token === null ? 401 : 200)
      return token === null ? [] : ((await response.json()) as { username: string }[]).map((hit) => hit.username)
    }

    // Starts-with first, then contains; case-insensitive.
    expect(await search('ANN')).toEqual(['anna-s', 'Joanna-s'])
    // Never the caller, and nothing for an empty query.
    expect(await search('srch')).toEqual([])
    expect(await search('  ')).toEqual([])
    await search('ann', null)

    // Usernames only: no email or id in the body.
    const raw = await inject(app, { url: '/api/players/search?q=bob', headers: bearer(owner) })
    expect(raw.body).not.toContain('@')
    expect(raw.body).not.toContain('"id"')
  })

  it('refuses a disabled account as an invitee', async () => {
    const owner = await register('dis-owner')
    await register('dis-friend')
    const friend = await repo.findPlayerByUsername('dis-friend')
    if (friend === undefined) throw new Error('no friend')
    await repo.updatePlayer(friend.id, { disabled: true })
    const response = await create(owner, { name: 'Dis', numOfPlayers: 2, invitedUsernames: ['dis-friend'] })
    expect(response.status).toBe(400)
  })
})
