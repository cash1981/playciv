/**
 * A game played through the HTTP API with delta storage underneath (issue #238).
 * What a client reads must not change, and the hidden information must not leak
 * through a revision that is stored as a delta: a delta holds the full private
 * state of what changed (the drawn card, the private log line), so no route may
 * ever return one, and a spectator reading an old revision still gets no hands.
 */

import type { GameState } from '@civ/engine'
import { itemName } from '@civ/engine'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { App } from '../src/app.js'
import { createApp, createTestApp } from '../src/app.js'
import { D1Repository } from '../src/store/d1.js'
import type { Repository } from '../src/store/types.js'
import { createD1Adapter } from './d1-sqlite-adapter.js'
import type { D1Adapter } from './d1-sqlite-adapter.js'
import { bearer, inject } from './helpers.js'
import { readMigrations } from './migrations.js'

interface Account {
  readonly id: string
  readonly token: string
}

interface Harness {
  readonly app: App
  readonly repo: Repository
  /** The raw stored `state` text of every delta row of a game; D1 only. */
  deltaTexts(gameId: string): Promise<readonly string[]>
  close(): void
}

const backends: readonly [string, () => Promise<Harness>][] = [
  [
    'JsonFileRepository',
    async () => {
      const { app, repo } = await createTestApp()
      return { app, repo, deltaTexts: async () => [], close: () => undefined }
    },
  ],
  [
    'D1Repository',
    async () => {
      const adapter: D1Adapter = await createD1Adapter(readMigrations())
      const repo = new D1Repository(adapter.db)
      const app = createApp({ repo, tokenSecret: 'test-secret', logger: false })
      return {
        app,
        repo,
        async deltaTexts(gameId) {
          const rows = await adapter.db
            .prepare(`SELECT state FROM game_revision WHERE game_id = ? AND kind = 'delta' ORDER BY revision`)
            .bind(gameId)
            .all<{ state: string }>()
          return rows.results.map((row) => row.state)
        },
        close: () => adapter.close(),
      }
    },
  ],
]

describe.each(backends)('revision history of a played game: %s', (_name, create) => {
  let harness: Harness

  beforeEach(async () => {
    harness = await create()
  })

  afterEach(() => {
    harness.close()
  })


  async function register(username: string): Promise<Account> {
    const response = await inject(harness.app, {
      method: 'POST',
      url: '/api/auth/register',
      payload: { username, password: 'secret', email: `${username}@example.com`, securityAnswer: 'writing' },
    })
    expect(response.status).toBe(201)
    const body = await response.json<{ token: string; player: { id: string } }>()
    return { id: body.player.id, token: body.token }
  }

  const post = (token: string, url: string, payload: unknown = {}) =>
    inject(harness.app, { method: 'POST', url, headers: bearer(token), payload })

  /** Two players take turns drawing, writing a private note and passing the turn. */
  async function play() {
    const alice = await register('delta-alice')
    const bob = await register('delta-bob')
    const spectator = await register('delta-mallory')
    const created = await post(alice.token, '/api/games', { name: 'Delta game', numOfPlayers: 2 })
    expect(created.status).toBe(201)
    const gameId = (await created.json<{ id: string }>()).id
    expect((await post(bob.token, `/api/games/${gameId}/join`)).status).toBe(200)

    const sheets = ['CULTURE_1', 'INFANTRY', 'CULTURE_2', 'ARTILLERY', 'MOUNTED', 'CULTURE_3']
    for (let round = 0; round < 14; round++) {
      const live = (await harness.repo.findGame(gameId)) as GameState
      const holder = live.players.find((player) => player.yourTurn)
      const account = holder?.username === 'delta-alice' ? alice : bob
      expect((await post(account.token, `/api/games/${gameId}/draw/${sheets[round % sheets.length]}`)).status).toBe(200)
      expect((await post(account.token, `/api/games/${gameId}/note`, { note: `SECRET-NOTE-${round}` })).status).toBe(200)
      expect((await post(account.token, `/api/games/${gameId}/draw/${sheets[(round + 1) % sheets.length]}`)).status).toBe(200)
      expect((await post(account.token, `/api/games/${gameId}/endturn`)).status).toBe(200)
    }
    return { gameId, alice, bob, spectator }
  }

  it('stores the game as deltas and still reads every revision as it was saved', async () => {
    const { gameId } = await play()
    const deltas = await harness.deltaTexts(gameId)
    // 14 rounds of three recorded actions, a keyframe every 25 rows. Only D1 can show its rows.
    if (_name === 'D1Repository') expect(deltas.length).toBeGreaterThan(30)
    const all = await harness.repo.listGameRevisions(gameId)
    expect(all.length).toBeGreaterThan(40)
    for (const revision of all) {
      const read = await harness.repo.findGameRevision(gameId, revision.revision)
      expect(JSON.stringify(read?.state)).toBe(JSON.stringify(revision.state))
      // Private notes never reach a revision, deltas or not.
      expect(JSON.stringify(read?.state)).not.toContain('SECRET-NOTE')
    }
  })

  it('a spectator reading an old revision gets no hands, no private log and no notes', async () => {
    const { gameId, spectator } = await play()
    const live = (await harness.repo.findGame(gameId)) as GameState
    const secrets: string[] = []
    for (const player of live.players) {
      for (const item of player.items) secrets.push(item.id, itemName(item))
    }
    for (const entry of live.log) if (entry.privateLog !== '') secrets.push(entry.privateLog)
    expect(secrets.length).toBeGreaterThan(10)

    const list = await inject(harness.app, { url: `/api/games/${gameId}/revisions`, headers: bearer(spectator.token) })
    expect(list.status).toBe(200)
    const numbers = (JSON.parse(list.body) as { revision: number }[]).map((row) => row.revision)
    expect(numbers.length).toBeGreaterThan(40)

    // Every revision, a delta in the middle of a chain included.
    for (const number of numbers) {
      const response = await inject(harness.app, {
        url: `/api/games/${gameId}/revisions/${number}`,
        headers: bearer(spectator.token),
      })
      expect(response.status, `revision ${number}`).toBe(200)
      // `itemName` can be a name several cards share; the ids and log lines are unique.
      for (const secret of secrets.filter((value) => value.length > 12)) {
        expect(response.body, `revision ${number} leaks ${secret}`).not.toContain(secret)
      }
      expect(response.body).not.toContain('SECRET-NOTE')
      const view = (JSON.parse(response.body) as { view: { you: unknown; opponents: { items?: unknown }[] } }).view
      expect(view.you).toBeNull()
      // Opponents are counts only, never a hand.
      for (const player of view.opponents) expect(player.items).toBeUndefined()
    }
  })

  it('a player reading an old revision sees only their own hand', async () => {
    const { gameId, alice, bob } = await play()
    const live = (await harness.repo.findGame(gameId)) as GameState
    const handIds = (name: string) => live.players.find((player) => player.username === name)?.items.map((item) => item.id) ?? []
    const aliceIds = handIds('delta-alice')
    const bobIds = handIds('delta-bob')
    expect(aliceIds.length).toBeGreaterThan(0)
    expect(bobIds.length).toBeGreaterThan(0)

    const newest = (await harness.repo.listGameRevisionSummaries(gameId)).at(-1)?.revision ?? 0
    const asAlice = await inject(harness.app, { url: `/api/games/${gameId}/revisions/${newest}`, headers: bearer(alice.token) })
    const asBob = await inject(harness.app, { url: `/api/games/${gameId}/revisions/${newest}`, headers: bearer(bob.token) })
    for (const id of aliceIds) {
      expect(asAlice.body).toContain(id)
      expect(asBob.body).not.toContain(id)
    }
    for (const id of bobIds) {
      expect(asBob.body).toContain(id)
      expect(asAlice.body).not.toContain(id)
    }
  })

  it('no route returns a stored delta', async () => {
    const { gameId, alice, spectator } = await play()
    const deltas = await harness.deltaTexts(gameId)
    const numbers = (await harness.repo.listGameRevisionSummaries(gameId)).map((row) => row.revision)
    const urls = [
      `/api/games/${gameId}`,
      `/api/games/${gameId}/revisions`,
      `/api/games/${gameId}/chat`,
      `/api/games/${gameId}/turns/public`,
      ...numbers.map((number) => `/api/games/${gameId}/revisions/${number}`),
    ]
    for (const token of [alice.token, spectator.token]) {
      for (const url of urls) {
        const response = await inject(harness.app, { url, headers: bearer(token) })
        for (const delta of deltas) expect(response.body, url).not.toContain(delta)
        expect(response.body, url).not.toMatch(/base_?[rR]evision|"kind":"delta"|"sealed"/)
      }
    }
  })

  it('an admin setting saved without a revision makes the next revision a keyframe that carries it', async () => {
    const { gameId, alice } = await play()
    const adminAccount = await register('delta-boss')
    await harness.repo.updatePlayer(adminAccount.id, { role: 'admin' })
    const before = await harness.repo.listGameRevisionSummaries(gameId)

    const switched = await post(adminAccount.token, `/api/admin/games/${gameId}/chat-orders`, { enabled: true })
    expect(switched.status).toBe(200)
    // The setting is not a move, so it adds no revision.
    expect(await harness.repo.listGameRevisionSummaries(gameId)).toHaveLength(before.length)

    expect((await post(alice.token, `/api/games/${gameId}/players/${alice.id}/stat`, { stat: 'trade', value: 3 })).status).toBe(200)
    const after = await harness.repo.listGameRevisionSummaries(gameId)
    expect(after).toHaveLength(before.length + 1)
    const newest = after.at(-1)?.revision ?? 0
    // A delta against the old newest revision would have lost the setting.
    expect((await harness.repo.findGameRevision(gameId, newest))?.state.chatOrders).toBe(true)
    expect((await harness.repo.findGameRevision(gameId, before.at(-1)?.revision ?? 0))?.state.chatOrders).toBe(false)
  })
})
