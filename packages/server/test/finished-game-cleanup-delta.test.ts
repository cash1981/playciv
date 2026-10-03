/**
 * The cleanup of a finished game when its newest revision is a delta (issue
 * #238). The cleanup deletes every revision but the newest, which is only safe
 * while that one is a full state: a delta needs its keyframe. So the newest is
 * rewritten as a keyframe first, in the same atomic step as the delete.
 */

import { endTurn } from '@civ/engine'
import type { GameState } from '@civ/engine'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createGameRevision, revisionSnapshot } from '../src/context.js'
import { REVISION_KEYFRAME_INTERVAL } from '../src/revision-delta.js'
import { D1Repository } from '../src/store/d1.js'
import { createD1Adapter } from './d1-sqlite-adapter.js'
import { readMigrations } from './migrations.js'
import { playRecordedGame } from './revision-fixtures.js'
import { saveRecordedGame, storeImplementations } from './revision-store-harness.js'
import type { StoreFixture } from './revision-store-harness.js'

const K = REVISION_KEYFRAME_INTERVAL
const ACTOR = { id: 'p1', username: 'Player1' }
const text = (value: unknown): string => JSON.stringify(value)

/** Plays a game, then saves one last revision that ends it (or not, for a running game). */
async function playedGame(fixture: Pick<StoreFixture, 'repo'>, steps: number, finished: boolean) {
  const game = playRecordedGame({ steps, name: `Cleanup ${steps} ${finished}` })
  await saveRecordedGame(fixture.repo, game)
  const live = game.steps.at(-1)?.after as GameState
  const ended = { ...live, rev: live.rev + 1, active: !finished, winner: finished ? 'Player1' : null }
  const revision = createGameRevision(live, ended, ACTOR, '2026-10-03T00:00:00.000Z', 'Game over')
  expect(await fixture.repo.saveGameWithRevision(ended, revision, live.rev, revisionSnapshot(live))).toBe(true)
  return { gameId: game.start.id, newest: ended.rev }
}

describe.each(storeImplementations)('cleanup of a finished game with delta revisions: %s', (_name, create) => {
  let fixture: StoreFixture

  beforeEach(async () => {
    fixture = await create()
  })

  afterEach(async () => {
    await fixture.close()
  })

  it('a newest revision that is a delta becomes the one keyframe, equal to what it read as before', async () => {
    const { gameId, newest } = await playedGame(fixture, 40, true)
    const before = await fixture.rows(gameId)
    expect(before.at(-1)?.kind).toBe('delta')
    const original = await fixture.repo.findGameRevision(gameId, newest)
    expect(original).toBeDefined()

    const result = await fixture.repo.deleteOldGameRevisions(gameId)

    expect(result).toEqual({ status: 'cleaned', removed: before.length - 1 })
    const after = await fixture.rows(gameId)
    expect(after).toEqual([
      // Whether the live game moved past the row is not changed by how the row is stored.
      expect.objectContaining({ revision: newest, kind: 'full', baseRevision: newest, sealed: before.at(-1)?.sealed }),
    ])
    const read = await fixture.repo.findGameRevision(gameId, newest)
    expect(text(read)).toBe(text(original))
    expect((await fixture.repo.listGameRevisionSummaries(gameId)).map((row) => row.revision)).toEqual([newest])
    expect((await fixture.repo.listGameRevisions(gameId)).map((row) => text(row.state))).toEqual([text(original?.state)])
  })

  it('a sealed newest revision stays sealed, so the next revision is a keyframe that carries the unrecorded change', async () => {
    const { gameId, newest } = await playedGame(fixture, 30, true)
    expect((await fixture.rows(gameId)).at(-1)?.kind).toBe('delta')
    // An admin setting on the finished game: saved without a revision, not just a note.
    const live = (await fixture.repo.findGame(gameId)) as GameState
    const switched = { ...live, rev: live.rev + 1, chatOrders: true }
    expect(await fixture.repo.saveGameIfRevision(switched, live.rev)).toBe(true)
    expect((await fixture.rows(gameId)).at(-1)?.sealed).toBe(true)

    expect(await fixture.repo.deleteOldGameRevisions(gameId)).toMatchObject({ status: 'cleaned' })
    expect(await fixture.rows(gameId)).toEqual([
      expect.objectContaining({ revision: newest, kind: 'full', baseRevision: newest, sealed: true }),
    ])

    // The next recorded revision must not be a delta against a row that lacks the setting.
    const result = endTurn(switched)
    if (!result.ok) throw new Error(result.error.kind)
    const after = { ...result.value, rev: switched.rev + 1 }
    expect(
      await fixture.repo.saveGameWithRevision(
        after,
        createGameRevision(switched, after, ACTOR, '2026-10-03T00:00:00.000Z', 'later'),
        switched.rev,
        revisionSnapshot(switched),
      ),
    ).toBe(true)
    expect((await fixture.rows(gameId)).at(-1)).toMatchObject({ revision: after.rev, kind: 'full', sealed: false })
    expect((await fixture.repo.findGameRevision(gameId, after.rev))?.state.chatOrders).toBe(true)
  })

  it('a second run changes nothing', async () => {
    const { gameId } = await playedGame(fixture, 30, true)
    await fixture.repo.deleteOldGameRevisions(gameId)
    const once = await fixture.rows(gameId)

    expect(await fixture.repo.deleteOldGameRevisions(gameId)).toEqual({ status: 'cleaned', removed: 0 })
    expect(await fixture.rows(gameId)).toEqual(once)
  })

  it('a newest revision that is already a keyframe is left as it is', async () => {
    // Creation plus K - 1 steps and the ending revision make row K, which starts a new keyframe.
    const { gameId, newest } = await playedGame(fixture, K - 1, true)
    const before = await fixture.rows(gameId)
    expect(before.at(-1)).toMatchObject({ kind: 'full', revision: newest })
    const original = await fixture.repo.findGameRevision(gameId, newest)

    expect(await fixture.repo.deleteOldGameRevisions(gameId)).toEqual({ status: 'cleaned', removed: before.length - 1 })
    expect(await fixture.rows(gameId)).toHaveLength(1)
    expect(text(await fixture.repo.findGameRevision(gameId, newest))).toBe(text(original))
  })

  it('a running game is refused and nothing is rewritten', async () => {
    const { gameId } = await playedGame(fixture, 30, false)
    const before = await fixture.rows(gameId)

    expect(await fixture.repo.deleteOldGameRevisions(gameId)).toEqual({ status: 'active' })
    expect(await fixture.rows(gameId)).toEqual(before)
    expect(await fixture.repo.deleteOldGameRevisions('missing')).toEqual({ status: 'not-found' })
  })

  it('another finished game in the same store is not touched', async () => {
    const first = await playedGame(fixture, 30, true)
    const other = await playedGame(fixture, 28, true)
    const otherBefore = await fixture.rows(other.gameId)
    const otherRevision = await fixture.repo.findGameRevision(other.gameId, other.newest)

    await fixture.repo.deleteOldGameRevisions(first.gameId)

    expect(await fixture.rows(other.gameId)).toEqual(otherBefore)
    expect(text(await fixture.repo.findGameRevision(other.gameId, other.newest))).toBe(text(otherRevision))
  })

  it('the dry run counts what is freed net of the keyframe the newest revision becomes', async () => {
    const { gameId } = await playedGame(fixture, 40, true)
    const rows = await fixture.rows(gameId)
    const newest = rows.at(-1)
    const keyframe = rows.find((row) => row.revision === newest?.baseRevision)
    const below = rows.slice(0, -1).reduce((sum, row) => sum + row.bytes, 0)
    expect(newest?.kind).toBe('delta')

    const [usage] = await fixture.repo.finishedGameRevisionUsage(gameId)

    expect(usage).toMatchObject({ gameId, revisions: rows.length, removableRevisions: rows.length - 1 })
    expect(usage?.removableBytes).toBe(below - ((keyframe?.bytes ?? 0) - (newest?.bytes ?? 0)))
    expect(usage?.removableBytes).toBeGreaterThan(0)
  })

  it('deleting the whole game takes every row of its chain with it', async () => {
    const { gameId } = await playedGame(fixture, 30, true)
    expect(await fixture.repo.deleteGame(gameId)).toBe(true)
    expect(await fixture.rows(gameId)).toEqual([])
    expect(await fixture.repo.listGameRevisions(gameId)).toEqual([])
  })
})

describe('cleanup of a delta game in D1: it cannot leave a half state', () => {
  it('a change of the live game between the rebuild and the write leaves every row as it was', async () => {
    const adapter = await createD1Adapter(readMigrations())
    try {
      const repo = new D1Repository(adapter.db)
      const game = playRecordedGame({ steps: 30 })
      await saveRecordedGame(repo, game)
      const live = game.steps.at(-1)?.after as GameState
      const ended = { ...live, rev: live.rev + 1, active: false, winner: 'Player1' }
      await repo.saveGameWithRevision(
        ended,
        createGameRevision(live, ended, ACTOR, '2026-10-03T00:00:00.000Z', 'Game over'),
        live.rev,
        revisionSnapshot(live),
      )
      const rows = async () =>
        (await adapter.db.prepare(`SELECT revision, kind, base_revision, state FROM game_revision ORDER BY revision`).all()).results
      const before = await rows()

      // An admin acts on the finished game after the cleanup has read it.
      const realBatch = adapter.db.batch.bind(adapter.db)
      vi.spyOn(adapter.db, 'batch').mockImplementationOnce(async (statements) => {
        await adapter.db.prepare(`UPDATE game SET rev = rev + 1 WHERE id = ?`).bind(game.start.id).run()
        return realBatch(statements)
      })

      expect(await repo.deleteOldGameRevisions(game.start.id)).toEqual({ status: 'changed' })
      expect(await rows()).toEqual(before)

      // Trying again works.
      expect(await repo.deleteOldGameRevisions(game.start.id)).toMatchObject({ status: 'cleaned' })
      expect(await rows()).toHaveLength(1)
    } finally {
      adapter.close()
    }
  })

  it('a revision written between the read and the delete keeps the keyframe it hangs on', async () => {
    const adapter = await createD1Adapter(readMigrations())
    try {
      const repo = new D1Repository(adapter.db)
      // Creation plus K - 1 steps and the ending revision: the newest is a keyframe.
      const { gameId, newest } = await playedGame({ repo }, K - 1, true)
      const live = (await repo.findGame(gameId)) as GameState
      const kinds = async () =>
        (await adapter.db.prepare(`SELECT revision, kind FROM game_revision ORDER BY revision`).all<{ revision: number; kind: string }>()).results
      expect((await kinds()).at(-1)).toEqual({ revision: newest, kind: 'full' })

      // An admin acts on the finished game just as the delete is about to run.
      const next = { ...live, rev: live.rev + 1, name: 'Touched by an admin' }
      const realPrepare = adapter.db.prepare.bind(adapter.db)
      let injected = false
      vi.spyOn(adapter.db, 'prepare').mockImplementation((query) => {
        const statement = realPrepare(query)
        if (injected || !/^\s*DELETE FROM game_revision/.test(query)) return statement
        return {
          ...statement,
          bind: (...values: unknown[]) => {
            const bound = statement.bind(...values)
            return {
              ...bound,
              run: async () => {
                injected = true
                await repo.saveGameWithRevision(
                  next,
                  createGameRevision(live, next, ACTOR, '2026-10-04T00:00:00.000Z', 'late'),
                  live.rev,
                  revisionSnapshot(live),
                )
                return bound.run()
              },
            }
          },
        } as unknown as ReturnType<typeof realPrepare>
      })

      expect(await repo.deleteOldGameRevisions(gameId)).toMatchObject({ status: 'cleaned' })
      expect(injected).toBe(true)
      // The old keyframe stayed, and the revision written meanwhile is a delta that still reads.
      expect((await kinds()).map((row) => `${row.revision}:${row.kind}`)).toEqual([`${newest}:full`, `${next.rev}:delta`])
      expect((await repo.findGameRevision(gameId, next.rev))?.state.name).toBe('Touched by an admin')
    } finally {
      adapter.close()
    }
  })
})
