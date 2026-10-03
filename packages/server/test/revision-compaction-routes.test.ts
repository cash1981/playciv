/**
 * The admin routes of the revision compaction (issue #238, phase 2): a dry run
 * and a button, chunked to stay inside a Worker request. They answer counts and
 * names only; what is stored, a state or a delta, never leaves the repository.
 * Both repositories behind the same routes.
 */

import type { GameState } from '@civ/engine'
import { afterEach, describe, expect, it } from 'vitest'

import type { App } from '../src/app.js'
import { createApp } from '../src/app.js'
import { COMPACT_BYTES_PER_REQUEST, COMPACT_REVISIONS_PER_REQUEST } from '../src/routes/admin.js'
import type { RevisionCodec } from '../src/revision-delta.js'
import { applyDelta, diffValues } from '../src/revision-delta.js'
import { bearer, inject } from './helpers.js'
import { playRecordedGame } from './revision-fixtures.js'
import { saveRecordedGame, storeImplementations } from './revision-store-harness.js'
import type { StoreFactory, StoreFixture } from './revision-store-harness.js'

const text = (value: unknown): string => JSON.stringify(value)

interface Answer {
  games: ({ id: string; name: string } & (
    | { status: 'compacted'; converted: number; keyframes: number; freedBytes: number; remaining: number }
    | { status: 'mismatch'; revision: number }
  ))[]
  totalConverted: number
  totalBytes: number
  remaining: number
  remainingRevisions: number
}

interface DryRun {
  games: { id: string; name: string; active: boolean; revisions: number; fullRevisions: number; freeableBytes: number }[]
  totalRevisions: number
  totalBytes: number
}

describe.each(storeImplementations)('compaction routes: %s', (_name, create) => {
  const fixtures: StoreFixture[] = []

  afterEach(async () => {
    for (const fixture of fixtures.splice(0)) await fixture.close()
  })

  interface Setup {
    readonly app: App
    readonly fixture: StoreFixture
    readonly admin: string
    readonly player: { id: string; token: string }
    readonly games: readonly { gameId: string; name: string; saved: readonly { revision: number; state: GameState }[] }[]
  }

  async function setup(steps: readonly number[], codec?: RevisionCodec): Promise<Setup> {
    const fixture = await (create as StoreFactory)(codec === undefined ? {} : { codec })
    fixtures.push(fixture)
    const games: Setup['games'][number][] = []
    for (const [index, count] of steps.entries()) {
      const name = `Legacy ${index}`
      const game = playRecordedGame({ steps: count, name, noteEvery: 11 })
      const saved = await saveRecordedGame(fixture.repo, game, { passPrevious: false })
      await fixture.makeLegacy(game.start.id, { sealNewest: false })
      games.push({ gameId: game.start.id, name, saved })
    }
    // `makeLegacy` may have replaced the JSON store: build the app on what the fixture has now.
    const app = createApp({ repo: fixture.repo, tokenSecret: 'test-secret', logger: false })
    const register = async (username: string) => {
      const response = await inject(app, {
        method: 'POST',
        url: '/api/auth/register',
        payload: { username, password: 'secret', email: `${username}@example.com`, securityAnswer: 'writing' },
      })
      expect(response.status).toBe(201)
      const body = await response.json<{ token: string; player: { id: string } }>()
      return { id: body.player.id, token: body.token }
    }
    const boss = await register('compact-boss')
    await fixture.repo.updatePlayer(boss.id, { role: 'admin' })
    const player = await register('compact-player')
    return { app, fixture, admin: boss.token, player, games }
  }

  const dryRun = (s: Setup, token = s.admin) =>
    inject(s.app, { url: '/api/admin/games/revisions/compact', headers: bearer(token) })
  const compact = (s: Setup, payload: unknown = {}, token = s.admin) =>
    inject(s.app, { method: 'POST', url: '/api/admin/games/revisions/compact', headers: bearer(token), payload })

  async function expectAllReadAsSaved(s: Setup) {
    for (const game of s.games) {
      for (const { revision, state } of game.saved) {
        expect(text((await s.fixture.repo.findGameRevision(game.gameId, revision))?.state), `${game.name} ${revision}`).toBe(
          text(state),
        )
      }
    }
  }

  it('is for admins: no token, and a plain player, are refused', async () => {
    const s = await setup([5])
    expect((await inject(s.app, { url: '/api/admin/games/revisions/compact' })).status).toBe(401)
    expect((await dryRun(s, s.player.token)).status).toBe(403)
    expect((await compact(s, {}, s.player.token)).status).toBe(403)
    expect((await inject(s.app, { method: 'POST', url: '/api/admin/games/revisions/compact', payload: {} })).status).toBe(401)
    // Nothing changed.
    expect((await s.fixture.rows(s.games[0]?.gameId ?? '')).every((row) => row.kind === 'full')).toBe(true)
  })

  it('the dry run lists the games with rows to convert, counts only', async () => {
    const s = await setup([30, 40])
    const response = await dryRun(s)
    expect(response.status).toBe(200)
    const body = await response.json<DryRun>()

    expect(body.games.map((game) => game.name).sort()).toEqual(['Legacy 0', 'Legacy 1'])
    const big = body.games.find((game) => game.name === 'Legacy 1')
    expect(big).toMatchObject({ active: true, revisions: 41, fullRevisions: 40 })
    expect(big?.freeableBytes).toBeGreaterThan(0)
    expect(body.totalRevisions).toBe(70)
    expect(body.totalBytes).toBe(body.games.reduce((sum, game) => sum + game.freeableBytes, 0))
    // Names and numbers: no state, no delta, no revision content.
    expect(Object.keys(body).sort()).toEqual(['games', 'totalBytes', 'totalRevisions'])
    for (const game of body.games) {
      expect(Object.keys(game).sort()).toEqual(['active', 'freeableBytes', 'fullRevisions', 'id', 'name', 'revisions'])
    }
    expect(response.body).not.toMatch(/players|"log"|privateLog|items/)
  })

  it('a game with nothing left to convert is not listed', async () => {
    const s = await setup([6])
    await compact(s)
    expect((await (await dryRun(s)).json<DryRun>()).games).toEqual([])
  })

  it('converts a bounded amount of state text per request and says how much is left', async () => {
    const s = await setup([60])
    const gameId = s.games[0]?.gameId ?? ''
    const sizes = (await s.fixture.rows(gameId)).slice(0, -1).map((row) => row.bytes)
    let next = 0
    let requests = 0
    let remainingRevisions = 60
    while (remainingRevisions > 0 && requests < 80) {
      const response = await compact(s)
      expect(response.status).toBe(200)
      const body = await response.json<Answer>()
      requests += 1
      const game = body.games[0]
      if (game?.status !== 'compacted') throw new Error('expected a compacted game')
      const handled = game.converted + game.keyframes
      expect(handled).toBeGreaterThanOrEqual(1)
      expect(handled).toBeLessThanOrEqual(COMPACT_REVISIONS_PER_REQUEST)
      // The request took what fits in the byte budget, the row before the first one counted, and no less.
      const take = (count: number) =>
        sizes.slice(next, next + count).reduce((sum, size) => sum + size, 0) + (next === 0 ? 0 : (sizes[next] ?? 0))
      expect(take(handled) <= COMPACT_BYTES_PER_REQUEST || handled === 1).toBe(true)
      if (body.remainingRevisions > 0 && handled < COMPACT_REVISIONS_PER_REQUEST) {
        expect(take(handled + 1)).toBeGreaterThan(COMPACT_BYTES_PER_REQUEST)
      }
      next += handled
      expect(body.remainingRevisions).toBe(remainingRevisions - handled)
      remainingRevisions = body.remainingRevisions
      expect(body.remaining).toBe(remainingRevisions > 0 ? 1 : 0)
      // Every press leaves the game readable.
      await expectAllReadAsSaved(s)
    }
    // More than one press was needed, and it ended.
    expect(requests).toBeGreaterThan(1)
    expect(remainingRevisions).toBe(0)

    // Finished: another press does nothing.
    const again = await (await compact(s)).json<Answer>()
    expect(again).toEqual({ games: [], totalConverted: 0, totalBytes: 0, remaining: 0, remainingRevisions: 0 })
  })

  it('several games share a request and all of them finish', async () => {
    const s = await setup([30, 40, 20])
    let left = 90
    let guard = 0
    while (left > 0 && guard++ < 60) {
      const body = await (await compact(s)).json<Answer>()
      const handled = body.games.reduce(
        (sum, game) => sum + (game.status === 'compacted' ? game.converted + game.keyframes : 0),
        0,
      )
      expect(handled).toBeGreaterThan(0)
      expect(body.remainingRevisions).toBe(left - handled)
      left = body.remainingRevisions
    }
    expect(left).toBe(0)
    await expectAllReadAsSaved(s)
    expect((await (await dryRun(s)).json<DryRun>()).games).toEqual([])
  })

  it('compacting one named game leaves the others alone', async () => {
    const s = await setup([20, 20])
    const [first, second] = s.games
    const secondBefore = await s.fixture.rows(second?.gameId ?? '')

    const body = await (await compact(s, { gameId: first?.gameId })).json<Answer>()

    expect(body.games.map((game) => game.id)).toEqual([first?.gameId])
    expect(body.games[0]).toMatchObject({ name: 'Legacy 0', status: 'compacted' })
    // 20 rows to handle, and the budget does not cover them all at once.
    const game = body.games[0]
    const handled = game?.status === 'compacted' ? game.converted + game.keyframes : 0
    expect(handled).toBeGreaterThan(0)
    expect(body.remainingRevisions).toBe(20 - handled)
    expect(body.remaining).toBe(body.remainingRevisions > 0 ? 1 : 0)
    expect(await s.fixture.rows(second?.gameId ?? '')).toEqual(secondBefore)
  })

  it('refuses a bad body and an unknown game', async () => {
    const s = await setup([5])
    expect((await compact(s, 'everything')).status).toBe(400)
    expect((await compact(s, [])).status).toBe(400)
    expect((await compact(s, { gameId: '' })).status).toBe(400)
    expect((await compact(s, { gameId: 7 })).status).toBe(400)
    const missing = await compact(s, { gameId: 'no-such-game' })
    expect(missing.status).toBe(404)
    const raw = await inject(s.app, {
      method: 'POST',
      url: '/api/admin/games/revisions/compact',
      headers: { ...bearer(s.admin), 'content-type': 'application/json' },
    })
    expect(raw.status).toBe(400)
  })

  it('a game that is being played keeps its newest revision as it was', async () => {
    const s = await setup([25])
    const gameId = s.games[0]?.gameId ?? ''
    const before = await s.fixture.rows(gameId)
    while ((await (await compact(s)).json<Answer>()).remaining > 0) {
      // keep pressing
    }
    const after = await s.fixture.rows(gameId)
    expect(after.at(-1)).toEqual(before.at(-1))
    expect(after.slice(0, -1).every((row) => row.baseRevision !== null)).toBe(true)
    await expectAllReadAsSaved(s)
  })

  describe('when a conversion does not check out', () => {
    const badCodec: RevisionCodec = { diff: (prev) => diffValues(prev, prev), apply: applyDelta }

    it('reports the game and revision, leaves its rows untouched, and still compacts the others', async () => {
      // One codec for all games, so make the other game pass by having nothing to convert in it.
      const s = await setup([20], badCodec)
      const gameId = s.games[0]?.gameId ?? ''
      const before = await s.fixture.rows(gameId)

      const response = await compact(s)

      expect(response.status).toBe(200)
      const body = await response.json<Answer>()
      expect(body.games).toEqual([
        { id: gameId, name: 'Legacy 0', status: 'mismatch', revision: before[1]?.revision },
      ])
      expect(body.totalConverted).toBe(0)
      expect(body.remaining).toBe(1)
      expect(await s.fixture.rows(gameId)).toEqual(before)
      await expectAllReadAsSaved(s)
    })
  })

  it('never lets the history of a compacted game leak a hand or a private log', async () => {
    const s = await setup([40])
    const gameId = s.games[0]?.gameId ?? ''
    const live = (await s.fixture.repo.findGame(gameId)) as GameState
    const secrets = new Set<string>()
    // Only what is still face down: a card that was revealed is public from then on.
    for (const player of live.players) for (const item of player.items) if (item.hidden) secrets.add(item.id)
    // A log line that says the same in public is not a secret.
    for (const entry of live.log) if (entry.privateLog.length > 12 && entry.privateLog !== entry.publicLog) secrets.add(entry.privateLog)
    expect(secrets.size).toBeGreaterThan(5)

    const answers: string[] = [(await dryRun(s)).body]
    while (true) {
      const response = await compact(s)
      answers.push(response.body)
      if ((JSON.parse(response.body) as Answer).remaining === 0) break
    }
    for (const body of answers) for (const secret of secrets) expect(body).not.toContain(secret)

    const numbers = (await s.fixture.repo.listGameRevisionSummaries(gameId)).map((row) => row.revision)
    for (const number of numbers) {
      const response = await inject(s.app, {
        url: `/api/games/${gameId}/revisions/${number}`,
        headers: bearer(s.player.token),
      })
      expect(response.status).toBe(200)
      for (const secret of secrets) expect(response.body, `revision ${number}`).not.toContain(secret)
      const view = (JSON.parse(response.body) as { view: { you: unknown; opponents: { items?: unknown }[] } }).view
      expect(view.you).toBeNull()
      for (const opponent of view.opponents) expect(opponent.items).toBeUndefined()
    }
  })
})
