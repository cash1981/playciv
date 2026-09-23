/**
 * `D1Repository` against a real SQLite engine through the `node:sqlite` adapter.
 *
 * No workerd and no network: the adapter implements the same prepared-statement
 * API D1 exposes, and wraps `batch()` in a transaction so the guarded
 * compare-and-set writes are exercised the way they run in production.
 */

import { createGame, itemName, joinGame, toPlayerView } from '@civ/engine'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createApp } from '../src/app.js'
import type { App } from '../src/app.js'
import { createGameRevision } from '../src/context.js'
import { D1Repository } from '../src/store/d1.js'
import type { ChatMessage, GameRevision, StoredPlayer } from '../src/store/types.js'
import { createD1Adapter } from './d1-sqlite-adapter.js'
import type { D1Adapter } from './d1-sqlite-adapter.js'
import { bearer, inject } from './helpers.js'
import { readMigrations } from './migrations.js'

const schema = readMigrations()

const ACTOR = { id: 'p1', username: 'Alice' }

function fixtureGame(name = 'Repo fixture') {
  return createGame({ name, numOfPlayers: 2, seed: `${name}:seed` })
}

describe('D1Repository', () => {
  let adapter: D1Adapter
  let repo: D1Repository

  beforeEach(async () => {
    adapter = await createD1Adapter(schema)
    repo = new D1Repository(adapter.db)
  })

  afterEach(() => {
    adapter.close()
  })

  it('round-trips a player and finds the username case-insensitively', async () => {
    const player: StoredPlayer = {
      id: 'p1',
      username: 'Alice',
      email: 'alice@example.com',
      passwordHash: 'salt:hash',
      createdAt: '2020-01-01T00:00:00.000Z',
      role: 'admin',
      disabled: false,
    }
    await repo.createPlayer(player)

    const found = await repo.findPlayerById('p1')
    expect(found?.username).toBe('Alice')
    expect(found?.email).toBe('alice@example.com')
    expect(found?.passwordHash).toBe('salt:hash')
    expect(found?.role).toBe('admin')
    expect(found?.disabled).toBe(false)
    expect(found?.disableEmail).toBe(false)

    expect((await repo.findPlayerByUsername('alice'))?.id).toBe('p1')
    expect((await repo.findPlayerByUsername('ALICE'))?.id).toBe('p1')
    expect(await repo.findPlayerByUsername('nobody')).toBeUndefined()
    expect((await repo.allPlayers()).map((entry) => entry.id)).toEqual(['p1'])
  })

  it('updates and deletes a player', async () => {
    await repo.createPlayer({
      id: 'p1',
      username: 'Alice',
      email: null,
      passwordHash: 'hash',
      createdAt: '2020-01-01T00:00:00.000Z',
    })

    const updated = await repo.updatePlayer('p1', {
      username: 'Alicia',
      email: 'a@example.com',
      disabled: true,
      disableEmail: true,
    })
    expect(updated?.username).toBe('Alicia')
    expect(updated?.email).toBe('a@example.com')
    expect(updated?.disabled).toBe(true)
    expect(updated?.disableEmail).toBe(true)

    await repo.updatePlayerPassword('p1', 'new:hash')
    expect((await repo.findPlayerById('p1'))?.passwordHash).toBe('new:hash')
    // A rename updates the folded lookup column too.
    expect((await repo.findPlayerByUsername('alicia'))?.id).toBe('p1')

    expect(await repo.deletePlayer('p1')).toBe(true)
    expect(await repo.deletePlayer('p1')).toBe(false)
    expect(await repo.findPlayerById('p1')).toBeUndefined()
  })

  it('matches usernames with Unicode case, like the JSON repository', async () => {
    await repo.createPlayer({
      id: 'u-ase',
      username: 'Åse',
      email: null,
      passwordHash: 'hash',
      createdAt: '2020-01-01T00:00:00.000Z',
    })

    // SQLite's NOCASE would miss these; JavaScript's toLowerCase does not.
    expect((await repo.findPlayerByUsername('åse'))?.id).toBe('u-ase')
    expect((await repo.findPlayerByUsername('ÅSE'))?.id).toBe('u-ase')

    await repo.updatePlayer('u-ase', { username: 'Ändring' })
    expect((await repo.findPlayerByUsername('ändring'))?.id).toBe('u-ase')
    expect(await repo.findPlayerByUsername('Åse')).toBeUndefined()
  })

  it('saves a game and inserts exactly one revision for a new game', async () => {
    const game = fixtureGame()
    const revision = createGameRevision(undefined, game, ACTOR, '2020-01-01T00:00:00.000Z', 'Game created')

    expect(await repo.saveGameWithRevision(game, revision, null)).toBe(true)
    // The id is the primary key: a second insert loses.
    expect(await repo.saveGameWithRevision(game, revision, null)).toBe(false)

    expect((await repo.findGame(game.id))?.rev).toBe(0)
    expect((await repo.listGameRevisions(game.id)).map((entry) => entry.revision)).toEqual([0])
    expect((await repo.findGameRevision(game.id, 0))?.publicDescription).toBe('Game created')
  })

  it('lists revision metadata without the state snapshot', async () => {
    const game = fixtureGame()
    const baseline = createGameRevision(undefined, game, ACTOR, '2020-01-01T00:00:00.000Z', 'Game created')
    await repo.saveGameWithRevision(game, baseline, null)

    const prepare = vi.spyOn(adapter.db, 'prepare')
    const metadata = await repo.listGameRevisionSummaries(game.id)
    const sql = prepare.mock.calls.map(([query]) => query).join('\n')
    const [full] = await repo.listGameRevisions(game.id)

    // The history route renders the same fields it always did, minus the
    // snapshot, which is what tipped the Worker over its limit.
    expect(metadata).toHaveLength(1)
    expect(metadata[0]?.revision).toBe(full?.revision)
    expect(metadata[0]?.publicDescription).toBe(full?.publicDescription)
    expect(metadata[0]?.privateDescriptions).toEqual(full?.privateDescriptions)
    expect(metadata[0]?.logIds).toEqual(full?.logIds)
    expect(metadata[0]).not.toHaveProperty('state')

    // The regression guard: the summary query must not select the column at
    // all. A `state` key would be easy to drop in the mapper while the query
    // still read and parsed every snapshot.
    expect(sql).toMatch(/FROM game_revision/)
    expect(sql).not.toMatch(/\bstate\b/)
  })

  it('refuses a compare-and-set write from a stale revision', async () => {
    const game = fixtureGame()
    const baseline = createGameRevision(undefined, game, ACTOR, '2020-01-01T00:00:00.000Z', 'Game created')
    await repo.saveGameWithRevision(game, baseline, null)

    const next = { ...game, rev: 1 }
    const nextRevision = createGameRevision(game, next, ACTOR, '2020-01-01T00:01:00.000Z', 'Next')

    expect(await repo.saveGameWithRevision(next, nextRevision, 7)).toBe(false)
    expect((await repo.findGame(game.id))?.rev).toBe(0)
    expect(await repo.listGameRevisions(game.id)).toHaveLength(1)

    expect(await repo.saveGameWithRevision(next, nextRevision, 0)).toBe(true)
    expect((await repo.findGame(game.id))?.rev).toBe(1)
    expect((await repo.listGameRevisions(game.id)).map((entry) => entry.revision)).toEqual([0, 1])
  })

  it('saves a non-revisioned game only while the live revision is unchanged', async () => {
    const game = fixtureGame()
    await repo.saveGame(game)

    expect(await repo.saveGameIfRevision({ ...game, rev: 1 }, 0)).toBe(true)
    expect((await repo.findGame(game.id))?.rev).toBe(1)
    expect(await repo.saveGameIfRevision({ ...game, rev: 2 }, 0)).toBe(false)
    expect((await repo.findGame(game.id))?.rev).toBe(1)
  })

  it('creates at most one revision baseline and refuses once the game moved', async () => {
    const game = fixtureGame()
    const baseline = createGameRevision(undefined, game, ACTOR, '2020-01-01T00:00:00.000Z', 'History starts here')

    expect(await repo.ensureGameRevision(baseline, 0)).toBe(false)

    await repo.saveGame(game)
    expect(await repo.ensureGameRevision(baseline, 0)).toBe(true)
    expect(await repo.ensureGameRevision(baseline, 0)).toBe(true)
    expect(await repo.listGameRevisions(game.id)).toHaveLength(1)

    expect(await repo.ensureGameRevision(baseline, 3)).toBe(false)
  })

  it('lists every game and deletes a game with its revisions', async () => {
    const game = fixtureGame()
    const baseline = createGameRevision(undefined, game, ACTOR, '2020-01-01T00:00:00.000Z', 'Game created')
    await repo.saveGameWithRevision(game, baseline, null)

    expect((await repo.allGames()).map((entry) => entry.id)).toEqual([game.id])
    expect(await repo.deleteGame(game.id)).toBe(true)
    expect(await repo.findGame(game.id)).toBeUndefined()
    expect(await repo.listGameRevisions(game.id)).toEqual([])
    expect(await repo.deleteGame('missing')).toBe(false)
  })

  it('separates lobby chat from a game and keeps insertion order', async () => {
    const message = (id: string, gameId: string | null, at: string): ChatMessage => ({
      id,
      gameId,
      username: 'Alice',
      message: id,
      createdAt: at,
    })
    await repo.appendChat(message('l1', null, '2020-01-01T00:00:00.000Z'))
    await repo.appendChat(message('l2', null, '2020-01-01T00:00:01.000Z'))
    await repo.appendChat(message('g1', 'game-1', '2020-01-01T00:00:00.000Z'))
    await repo.appendChat(message('g2', 'game-1', '2020-01-01T00:00:00.000Z'))

    expect((await repo.chatFor(null)).map((entry) => entry.id)).toEqual(['l1', 'l2'])
    // Identical timestamps fall back to insertion order.
    expect((await repo.chatFor('game-1')).map((entry) => entry.id)).toEqual(['g1', 'g2'])
  })

  it('claims an email slot once per cooldown and lets only one caller win', async () => {
    const now = new Date('2020-01-01T00:00:00.000Z')
    expect(await repo.claimEmailSlot('scope', 1000, now)).toBe(true)
    expect(await repo.claimEmailSlot('scope', 1000, new Date(now.getTime() + 500))).toBe(false)
    expect(await repo.claimEmailSlot('scope', 1000, new Date(now.getTime() + 1001))).toBe(true)

    // A stamp in the future is not `< cutoff`, so it suppresses (Mongo's abs).
    expect(await repo.claimEmailSlot('future', 1000, now)).toBe(true)
    expect(await repo.claimEmailSlot('future', 1000, new Date(now.getTime() - 5000))).toBe(false)

    const claims = await Promise.all([
      repo.claimEmailSlot('race', 60_000, now),
      repo.claimEmailSlot('race', 60_000, now),
    ])
    expect(claims.filter(Boolean)).toHaveLength(1)
  })

  it('reads highscore sources from both the old pbf table and new games', async () => {
    await adapter.db
      .prepare(
        `INSERT INTO pbf (id, active, winner, num_of_players, players)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        'old-1',
        0,
        'Alice',
        4,
        JSON.stringify([
          { username: 'Alice', civName: 'Greeks' },
          { username: 'Bob', civName: null },
        ]),
      )
      .run()

    const base = createGame({ name: 'Finished D1 game', numOfPlayers: 2, seed: 'finished:seed' })
    const first = joinGame(base, { playerId: 'a', username: 'Alice', gameCreator: true })
    const second = first.ok ? joinGame(first.value, { playerId: 'b', username: 'Bob' }) : undefined
    if (second === undefined || !second.ok) throw new Error('fixture join failed')
    await repo.saveGame({ ...second.value, active: false, winner: 'Bob' })

    const summaries = await repo.finishedGamesForHighscore()
    expect(summaries).toHaveLength(2)
    expect(summaries.find((entry) => entry.winner === 'Alice')?.numOfPlayers).toBe(4)
    expect(summaries.find((entry) => entry.winner === 'Bob')?.players.map((p) => p.username)).toEqual([
      'Alice',
      'Bob',
    ])
    // An unfinished game is not a highscore source.
    const running = fixtureGame('Still running')
    await repo.saveGame(running)
    expect(await repo.finishedGamesForHighscore()).toHaveLength(2)
  })

  it('does not leak a stored hidden hand to another viewer', async () => {
    const base = createGame({ name: 'Hidden', numOfPlayers: 2, seed: 'Hidden:seed' })
    const first = joinGame(base, { playerId: 'a', username: 'Alice', gameCreator: true })
    const second = first.ok ? joinGame(first.value, { playerId: 'b', username: 'Bob' }) : undefined
    if (second === undefined || !second.ok) throw new Error('fixture join failed')

    const secret = second.value.items[0]
    if (secret === undefined) throw new Error('fixture has no items')
    const withHand = {
      ...second.value,
      players: second.value.players.map((player, index) =>
        index === 0 ? { ...player, items: [secret] } : player,
      ),
    }

    const revision = createGameRevision(undefined, withHand, ACTOR, '2020-01-01T00:00:00.000Z', 'Hand')
    await repo.saveGameWithRevision(withHand, revision, null)
    const stored = await repo.findGame(withHand.id)
    expect(stored).toBeDefined()

    const bob = withHand.players[1]
    if (stored === undefined || bob === undefined) throw new Error('fixture is incomplete')
    const bobView = JSON.stringify(toPlayerView(stored, bob.playerId))
    expect(bobView).not.toContain(itemName(secret))
  })
})

describe('D1Repository through the API', () => {
  let adapter: D1Adapter
  let app: App
  let repo: D1Repository

  beforeEach(async () => {
    adapter = await createD1Adapter(schema)
    repo = new D1Repository(adapter.db)
    app = createApp({
      repo,
      tokenSecret: 'test-secret',
      logger: false,
    })
  })

  afterEach(() => {
    adapter.close()
  })

  async function register(username: string): Promise<string> {
    const response = await inject(app, {
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        username,
        password: 'hemmelig',
        email: `${username}@example.com`,
        securityAnswer: 'writing',
      },
    })
    expect(response.status).toBe(201)
    return (await response.json<{ token: string }>()).token
  }

  it('serves registration, a game, its revision history and chat', async () => {
    const token = await register('d1-owner')

    const created = await inject(app, {
      method: 'POST',
      url: '/api/games',
      headers: bearer(token),
      payload: { name: 'D1 game', numOfPlayers: 2 },
    })
    expect(created.status).toBe(201)
    const gameId = (await created.json<{ id: string }>()).id

    const read = await inject(app, { url: `/api/games/${gameId}`, headers: bearer(token) })
    expect(read.status).toBe(200)

    const history = await inject(app, {
      url: `/api/games/${gameId}/revisions`,
      headers: bearer(token),
    })
    expect(history.status).toBe(200)
    const revisions = await history.json<GameRevision[]>()
    expect(revisions.map((entry) => entry.revision)).toEqual([0])

    const chat = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/chat`,
      headers: bearer(token),
      payload: { message: 'hello D1' },
    })
    expect(chat.status).toBe(201)
    expect((await repo.chatFor(gameId)).map((entry) => entry.message)).toContain('hello D1')

    expect((await inject(app, { url: '/api/highscore' })).status).toBe(200)

    const deleted = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/delete`,
      headers: bearer(token),
    })
    expect(deleted.status).toBe(204)
    expect((await inject(app, { url: `/api/games/${gameId}` })).status).toBe(404)
  })
})
