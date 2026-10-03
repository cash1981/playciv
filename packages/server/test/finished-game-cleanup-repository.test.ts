/**
 * The storage half of the admin cleanup of finished games: the dry run and the
 * guarded delete, against both implementations (the in-memory JSON repository
 * and `D1Repository` over a real SQLite engine with every migration applied).
 */

import { createGame } from '@civ/engine'
import type { GameState } from '@civ/engine'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createGameRevision } from '../src/context.js'
import { D1Repository } from '../src/store/d1.js'
import { JsonFileRepository } from '../src/store/json-file.js'
import type { Repository } from '../src/store/types.js'
import { createD1Adapter } from './d1-sqlite-adapter.js'
import type { D1Database } from '../src/store/d1.js'
import { readMigrations } from './migrations.js'

const schema = readMigrations()
const ACTOR = { id: 'p1', username: 'Alice' }

interface Fixture {
  readonly repo: Repository
  /** Raw access to the tables the cleanup must leave alone; D1 only. */
  readonly db: D1Database | undefined
  close(): void
}

const implementations: readonly [string, () => Promise<Fixture>][] = [
  [
    'JsonFileRepository',
    async () => ({
      repo: new JsonFileRepository({ filePath: null }),
      db: undefined,
      close: () => undefined,
    }),
  ],
  [
    'D1Repository',
    async () => {
      const adapter = await createD1Adapter(schema)
      return { repo: new D1Repository(adapter.db), db: adapter.db, close: () => adapter.close() }
    },
  ],
]

/** Saves a game with `count` revisions (0 to count - 1); the live game ends at `count - 1`. */
async function seed(
  repo: Repository,
  name: string,
  count: number,
  finished: boolean,
): Promise<GameState> {
  let live = createGame({ name, numOfPlayers: 2, seed: `${name}:seed` })
  let previous: GameState | undefined
  for (let index = 0; index < count; index++) {
    const last = index === count - 1
    live = { ...live, rev: index, active: !(finished && last), winner: finished && last ? 'Alice' : null }
    const revision = createGameRevision(previous, live, ACTOR, `2026-10-01T00:0${index}:00.000Z`, `Step ${index}`)
    const saved = await repo.saveGameWithRevision(live, revision, previous === undefined ? null : previous.rev)
    expect(saved).toBe(true)
    previous = live
  }
  return live
}

describe.each(implementations)('finished game cleanup storage: %s', (_name, create) => {
  let fixture: Fixture
  let repo: Repository

  beforeEach(async () => {
    fixture = await create()
    repo = fixture.repo
  })

  afterEach(() => {
    fixture.close()
  })

  const revisionNumbers = async (gameId: string) =>
    (await repo.listGameRevisionSummaries(gameId)).map((entry) => entry.revision)

  it('the dry run lists only finished games and counts everything except the newest revision', async () => {
    const done = await seed(repo, 'Done', 4, true)
    await seed(repo, 'Running', 5, false)

    const usage = await repo.finishedGameRevisionUsage()

    expect(usage.map((entry) => entry.gameId)).toEqual([done.id])
    const [entry] = usage
    expect(entry).toMatchObject({ gameId: done.id, name: 'Done', revisions: 4, removableRevisions: 3 })
    const all = await repo.listGameRevisions(done.id)
    const expectedBytes = all
      .slice(0, 3)
      .reduce((sum, revision) => sum + Buffer.byteLength(JSON.stringify(revision.state), 'utf8'), 0)
    expect(entry?.removableBytes).toBe(expectedBytes)
    expect(expectedBytes).toBeGreaterThan(0)
  })

  it('the dry run lists the largest game first and can be narrowed to one game', async () => {
    const small = await seed(repo, 'Small', 2, true)
    const large = await seed(repo, 'Large', 5, true)

    expect((await repo.finishedGameRevisionUsage()).map((entry) => entry.gameId)).toEqual([
      large.id,
      small.id,
    ])
    expect((await repo.finishedGameRevisionUsage(small.id)).map((entry) => entry.gameId)).toEqual([small.id])
    expect(await repo.finishedGameRevisionUsage('missing')).toEqual([])
  })

  it('the delete keeps exactly the newest revision, removes the rest, and a second call removes nothing', async () => {
    const done = await seed(repo, 'Done', 5, true)

    expect(await repo.deleteOldGameRevisions(done.id)).toEqual({ status: 'cleaned', removed: 4 })
    expect(await revisionNumbers(done.id)).toEqual([4])
    expect((await repo.findGameRevision(done.id, 4))?.state.rev).toBe(4)

    expect(await repo.deleteOldGameRevisions(done.id)).toEqual({ status: 'cleaned', removed: 0 })
    expect(await revisionNumbers(done.id)).toEqual([4])
    expect((await repo.finishedGameRevisionUsage(done.id))[0]).toMatchObject({
      revisions: 1,
      removableRevisions: 0,
      removableBytes: 0,
    })
  })

  it('the delete refuses a running game and an unknown game and removes nothing', async () => {
    const running = await seed(repo, 'Running', 4, false)

    expect(await repo.deleteOldGameRevisions(running.id)).toEqual({ status: 'active' })
    expect(await repo.deleteOldGameRevisions('missing')).toEqual({ status: 'not-found' })
    expect(await revisionNumbers(running.id)).toEqual([0, 1, 2, 3])
  })

  it("the delete touches only that game's rows", async () => {
    const first = await seed(repo, 'First', 3, true)
    const second = await seed(repo, 'Second', 3, true)
    const secondBefore = await repo.listGameRevisions(second.id)

    await repo.deleteOldGameRevisions(first.id)

    expect(await revisionNumbers(first.id)).toEqual([2])
    expect(await repo.listGameRevisions(second.id)).toEqual(secondBefore)
  })

  it('game, chat, game_mail and rated_result are unchanged after a delete', async () => {
    const done = await seed(repo, 'Done', 4, true)
    await repo.appendChat({
      id: 'c1',
      gameId: done.id,
      username: 'Alice',
      message: 'gg',
      createdAt: '2026-10-01T01:00:00.000Z',
    })
    await repo.recordGameOpened(done.id, 'p1', new Date('2026-10-01T02:00:00.000Z'))
    const readSide = async () => ({
      game: await repo.findGame(done.id),
      chat: await repo.chatFor(done.id),
      highscore: await repo.cachedHighscore(),
      ...(fixture.db === undefined ? {} : await rawRows(fixture.db, done.id)),
    })
    if (fixture.db !== undefined) {
      await fixture.db
        .prepare(`INSERT INTO rated_result (id, sort_key, participants) VALUES (?, ?, ?)`)
        .bind('legacy-1', '2020', JSON.stringify([{ username: 'Alice', rank: 1 }]))
        .run()
    }
    const before = await readSide()

    await repo.deleteOldGameRevisions(done.id)

    expect(await readSide()).toEqual(before)
    if (fixture.db !== undefined) {
      // The rows are really there to be compared, not an empty set equal to itself.
      expect(before).toMatchObject({ ratedResults: 1, gameMail: 1 })
    }
  })
})

async function rawRows(db: D1Database, gameId: string) {
  const count = async (query: string, ...values: unknown[]) =>
    (await db.prepare(query).bind(...values).first<{ n: number }>())?.n ?? -1
  return {
    ratedResults: await count(`SELECT COUNT(*) AS n FROM rated_result`),
    gameMail: await count(`SELECT COUNT(*) AS n FROM game_mail WHERE game_id = ?`, gameId),
    generation: await db.prepare(`SELECT version FROM highscore_generation`).first<{ version: number }>(),
    gameRow: await db
      .prepare(`SELECT rev, active, winner, state FROM game WHERE id = ?`)
      .bind(gameId)
      .first(),
  }
}
