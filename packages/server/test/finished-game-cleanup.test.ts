/**
 * The admin cleanup of finished games (issue #238, phase 4): a dry run and a
 * button that drops every revision but the newest of a finished game. New in the
 * rewrite, so there is no old-system counterpart; the safety test pins down what
 * must not change for the people who read a game afterwards.
 */

import { createGame as newGame } from '@civ/engine'
import type { GameState } from '@civ/engine'
import { beforeEach, describe, expect, it } from 'vitest'

import type { App } from '../src/app.js'
import { createTestApp } from '../src/app.js'
import { createGameRevision } from '../src/context.js'
import { JsonFileRepository } from '../src/store/json-file.js'
import { bearer, inject } from './helpers.js'

let app: App
let repo: JsonFileRepository

beforeEach(async () => {
  const created = await createTestApp()
  app = created.app
  repo = created.repo
})

async function register(username: string): Promise<{ id: string; token: string }> {
  const response = await inject(app, {
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'secret', email: `${username}@example.com`, securityAnswer: 'writing' },
  })
  expect(response.status).toBe(201)
  const body = await response.json<{ token: string; player: { id: string } }>()
  return { id: body.player.id, token: body.token }
}

async function makeAdmin(username: string): Promise<string> {
  const account = await register(username)
  await repo.updatePlayer(account.id, { role: 'admin' })
  return account.token
}

/** A game with `count` revisions saved straight to storage; the last one ends it when `finished`. */
async function seed(name: string, count: number, finished: boolean): Promise<GameState> {
  let live = newGame({ name, numOfPlayers: 2, seed: `${name}:seed` })
  let previous: GameState | undefined
  for (let index = 0; index < count; index++) {
    const last = index === count - 1
    live = { ...live, rev: index, active: !(finished && last), winner: finished && last ? 'Alice' : null }
    const revision = createGameRevision(
      previous,
      live,
      { id: 'p1', username: 'Alice' },
      `2026-10-01T00:0${index % 10}:00.000Z`,
      `Step ${index}`,
    )
    expect(await repo.saveGameWithRevision(live, revision, previous === undefined ? null : previous.rev)).toBe(true)
    previous = live
  }
  return live
}

const get = (token: string | undefined) =>
  inject(app, {
    url: '/api/admin/games/cleanup',
    ...(token === undefined ? {} : { headers: bearer(token) }),
  })

const clean = (token: string | undefined, payload: unknown = {}) =>
  inject(app, {
    method: 'POST',
    url: '/api/admin/games/cleanup',
    ...(token === undefined ? {} : { headers: bearer(token) }),
    payload,
  })

interface CleanupAnswer {
  games: { id: string; name: string; removedRevisions: number; removedBytes: number }[]
  totalRevisions: number
  totalBytes: number
  remaining: number
}

interface DryRun {
  games: { id: string; name: string; revisions: number; removableRevisions: number; removableBytes: number }[]
  totalRevisions: number
  totalBytes: number
}

describe('admin cleanup of finished games', () => {
  it('is for admins only, on both routes', async () => {
    const user = await register('plain-user')
    const done = await seed('Done', 3, true)

    expect((await get(user.token)).status).toBe(403)
    expect((await clean(user.token)).status).toBe(403)
    expect((await get(undefined)).status).toBe(401)
    expect((await clean(undefined)).status).toBe(401)
    expect(await repo.listGameRevisions(done.id)).toHaveLength(3)
  })

  it('the dry run lists finished games with something to remove, largest first, with totals', async () => {
    const admin = await makeAdmin('boss')
    const small = await seed('Small', 2, true)
    const large = await seed('Large', 4, true)
    await seed('Running', 6, false)
    await seed('Single', 1, true)

    const response = await get(admin)

    expect(response.status).toBe(200)
    const body = await response.json<DryRun>()
    expect(body.games.map((game) => game.id)).toEqual([large.id, small.id])
    expect(body.games[0]).toMatchObject({ name: 'Large', revisions: 4, removableRevisions: 3 })
    expect(body.totalRevisions).toBe(4)
    expect(body.totalBytes).toBe(body.games.reduce((total, game) => total + game.removableBytes, 0))
    expect(body.totalBytes).toBeGreaterThan(0)
    // Counts and names only: nothing of a game's state travels with the list.
    expect(Object.keys(body.games[0] ?? {}).sort()).toEqual([
      'id',
      'name',
      'removableBytes',
      'removableRevisions',
      'revisions',
    ])
    expect(await repo.listGameRevisions(large.id)).toHaveLength(4)
  })

  it('cleans one finished game and says what went; a second run removes nothing', async () => {
    const admin = await makeAdmin('boss')
    const done = await seed('Done', 4, true)
    const other = await seed('Other', 3, true)
    const before = (await get(admin).then((r) => r.json<DryRun>())).games.find((game) => game.id === done.id)

    const first = await clean(admin, { gameId: done.id })

    expect(first.status).toBe(200)
    const answer = await first.json<CleanupAnswer>()
    expect(answer).toEqual({
      games: [{ id: done.id, name: 'Done', removedRevisions: 3, removedBytes: before?.removableBytes }],
      totalRevisions: 3,
      totalBytes: before?.removableBytes,
      remaining: 0,
    })
    expect((await repo.listGameRevisions(done.id)).map((revision) => revision.revision)).toEqual([3])
    expect(await repo.listGameRevisions(other.id)).toHaveLength(3)

    const second = await (await clean(admin, { gameId: done.id })).json<CleanupAnswer>()
    expect(second.totalRevisions).toBe(0)
    expect(second.totalBytes).toBe(0)
    expect(second.games).toEqual([{ id: done.id, name: 'Done', removedRevisions: 0, removedBytes: 0 }])
  })

  it('answers 409 GAME_ACTIVE for a running game and 404 for an unknown one', async () => {
    const admin = await makeAdmin('boss')
    const running = await seed('Running', 4, false)

    const active = await clean(admin, { gameId: running.id })
    expect(active.status).toBe(409)
    expect(await active.json<{ error: string }>()).toMatchObject({ error: 'GAME_ACTIVE' })
    expect(await repo.listGameRevisions(running.id)).toHaveLength(4)

    const missing = await clean(admin, { gameId: 'no-such-game' })
    expect(missing.status).toBe(404)
    expect(await missing.json<{ error: string }>()).toMatchObject({ error: 'GAME_NOT_FOUND' })
  })

  it('refuses a body that is not an object instead of reading it as "every game"', async () => {
    const admin = await makeAdmin('boss')
    const done = await seed('Done', 3, true)

    for (const payload of [{ gameId: 5 }, { gameId: '' }, 'all', [], null]) {
      expect((await clean(admin, payload)).status).toBe(400)
    }
    const noBody = await inject(app, {
      method: 'POST',
      url: '/api/admin/games/cleanup',
      headers: bearer(admin),
    })
    expect(noBody.status).toBe(400)
    expect(await repo.listGameRevisions(done.id)).toHaveLength(3)
  })

  it('the all-games run handles at most 20 games per request and reports what remains', async () => {
    const admin = await makeAdmin('boss')
    for (let index = 0; index < 22; index++) await seed(`Game ${String(index).padStart(2, '0')}`, 2, true)
    await seed('Running', 3, false)

    const first = await (await clean(admin)).json<CleanupAnswer>()
    expect(first.games).toHaveLength(20)
    expect(first.totalRevisions).toBe(20)
    expect(first.remaining).toBe(2)

    const second = await (await clean(admin)).json<CleanupAnswer>()
    expect(second.games).toHaveLength(2)
    expect(second.remaining).toBe(0)

    const third = await (await clean(admin)).json<CleanupAnswer>()
    expect(third).toEqual({ games: [], totalRevisions: 0, totalBytes: 0, remaining: 0 })
    expect((await get(admin).then((r) => r.json<DryRun>())).games).toEqual([])
    // The running game was never touched.
    const running = (await repo.allGames()).find((game) => game.name === 'Running')
    expect(await repo.listGameRevisions(running?.id ?? '')).toHaveLength(3)
  })
})

describe('a cleaned game reads the same afterwards', () => {
  /** A real two-player game: someone draws a card, they chat, then it ends. */
  async function playedFinishedGame() {
    const alice = await register('clean-alice')
    const bob = await register('clean-bob')
    const spectator = await register('clean-mallory')
    const created = await inject(app, {
      method: 'POST',
      url: '/api/games',
      headers: bearer(alice.token),
      payload: { name: 'Played game', numOfPlayers: 2 },
    })
    expect(created.status).toBe(201)
    const gameId = (await created.json<{ id: string }>()).id
    expect((await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/join`,
      headers: bearer(bob.token),
      payload: {},
    })).status).toBe(200)

    const started = await repo.findGame(gameId)
    const owner = started?.players.find((entry) => entry.yourTurn)
    const ownerAccount = owner?.username === 'clean-alice' ? alice : bob
    expect((await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/draw/CULTURE_1`,
      headers: bearer(ownerAccount.token),
      payload: {},
    })).status).toBe(200)
    for (const [token, message] of [[alice.token, 'good game'], [bob.token, 'well played']] as const) {
      expect((await inject(app, {
        method: 'POST',
        url: `/api/games/${gameId}/chat`,
        headers: bearer(token),
        payload: { message },
      })).status).toBe(201)
    }

    const drawn = await repo.findGame(gameId)
    if (drawn === undefined) throw new Error('game vanished')
    const secretCard = drawn.players.find((entry) => entry.yourTurn)?.items[0]
    const secretLog = drawn.log.find((entry) => entry.item?.id === secretCard?.id)?.privateLog
    expect(secretCard).toBeDefined()
    expect(secretLog).toBeTruthy()

    // Nothing in the server ends a game yet, so the finish is saved as a move.
    const ended = { ...drawn, rev: drawn.rev + 1, active: false, winner: 'clean-alice' }
    expect(await repo.saveGameWithRevision(
      ended,
      createGameRevision(drawn, ended, { id: alice.id, username: 'clean-alice' }, '2026-10-02T00:00:00.000Z', 'Game over'),
      drawn.rev,
    )).toBe(true)
    return { gameId, alice, bob, spectator, secretCardId: secretCard?.id ?? '', secretLog: secretLog ?? '' }
  }

  it('leaves the highscore, the game view, the chat and the history as they were', async () => {
    const admin = await makeAdmin('boss')
    const { gameId, alice, bob, spectator, secretCardId, secretLog } = await playedFinishedGame()
    expect((await repo.listGameRevisions(gameId)).length).toBeGreaterThan(3)

    const read = async () => {
      const newest = (await repo.listGameRevisions(gameId)).at(-1)?.revision ?? -1
      const url = (path: string) => `/api/games/${gameId}${path}`
      const history = await inject(app, { url: url('/revisions'), headers: bearer(spectator.token) })
      const final = await inject(app, { url: url(`/revisions/${newest}`), headers: bearer(spectator.token) })
      return {
        highscore: (await inject(app, { url: '/api/highscore' })).body,
        viewAlice: (await inject(app, { url: url(''), headers: bearer(alice.token) })).body,
        viewBob: (await inject(app, { url: url(''), headers: bearer(bob.token) })).body,
        viewSpectator: (await inject(app, { url: url(''), headers: bearer(spectator.token) })).body,
        chat: (await inject(app, { url: url('/chat'), headers: bearer(spectator.token) })).body,
        historyStatus: history.status,
        history: history.body,
        finalStatus: final.status,
        final: final.body,
      }
    }

    const before = await read()
    expect(before.highscore).toContain('clean-alice')
    expect(before.chat).toContain('well played')
    // Before the cleanup the history lists every move.
    expect((JSON.parse(before.history) as unknown[]).length).toBeGreaterThan(3)

    const answer = await (await clean(admin, { gameId })).json<CleanupAnswer>()
    expect(answer.totalRevisions).toBeGreaterThan(0)
    expect(await repo.listGameRevisions(gameId)).toHaveLength(1)

    const after = await read()
    expect(after.highscore).toBe(before.highscore)
    expect(after.viewAlice).toBe(before.viewAlice)
    expect(after.viewBob).toBe(before.viewBob)
    expect(after.viewSpectator).toBe(before.viewSpectator)
    expect(after.chat).toBe(before.chat)
    // The same final snapshot, projected for the same viewer.
    expect(after.finalStatus).toBe(200)
    expect(after.final).toBe(before.final)

    // The history now has the one entry that is left, and still hides what it hid.
    expect(after.historyStatus).toBe(200)
    expect(JSON.parse(after.history) as unknown[]).toHaveLength(1)
    for (const body of [after.history, after.final, after.viewSpectator]) {
      expect(body).not.toContain(secretCardId)
      expect(body).not.toContain(secretLog)
    }
    const ownFinal = await inject(app, {
      url: `/api/games/${gameId}/revisions/${(await repo.listGameRevisions(gameId))[0]?.revision}`,
      headers: bearer(alice.token),
    })
    expect(ownFinal.status).toBe(200)
  })

  it('opening a cleaned game does not create a second baseline revision', async () => {
    const admin = await makeAdmin('boss')
    const { gameId, alice, spectator } = await playedFinishedGame()
    await clean(admin, { gameId })
    const kept = await repo.listGameRevisions(gameId)
    expect(kept).toHaveLength(1)

    const newest = kept[0]?.revision
    for (const token of [alice.token, spectator.token]) {
      expect((await inject(app, { url: `/api/games/${gameId}`, headers: bearer(token) })).status).toBe(200)
      expect((await inject(app, { url: `/api/games/${gameId}/revisions`, headers: bearer(token) })).status).toBe(200)
      expect((await inject(app, { url: `/api/games/${gameId}/revisions/${newest}`, headers: bearer(token) })).status).toBe(200)
    }

    const after = await repo.listGameRevisions(gameId)
    expect(after).toHaveLength(1)
    expect(after).toEqual(kept)
  })
})
