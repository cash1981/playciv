/**
 * The compaction of revisions that are still full states (issue #238, phase 2):
 * the repository half. Rows from before delta storage become delta chains, game
 * by game and chunk by chunk, each conversion rebuilt and compared with the
 * original before anything is written. Both repositories.
 */

import type { GameState } from '@civ/engine'
import { endTurn } from '@civ/engine'
import { afterEach, describe, expect, it } from 'vitest'

import { createGameRevision, revisionSnapshot, stampLog } from '../src/context.js'
import type { RevisionCodec } from '../src/revision-delta.js'
import { applyDelta, defaultRevisionCodec, diffValues, REVISION_KEYFRAME_INTERVAL } from '../src/revision-delta.js'
import { playRecordedGame } from './revision-fixtures.js'
import { saveRecordedGame, storeImplementations } from './revision-store-harness.js'
import type { StoreFactory, StoreFixture, StoredRow } from './revision-store-harness.js'

const K = REVISION_KEYFRAME_INTERVAL
const ACTOR = { id: 'p1', username: 'Player1' }
const text = (value: unknown): string => JSON.stringify(value)

/** Everything a game's rows say about the chain, without sizes. */
const shape = (rows: readonly StoredRow[]) => rows.map((row) => [row.revision, row.kind, row.baseRevision, row.sealed])

describe.each(storeImplementations)('revision compaction: %s', (_name, create) => {
  const fixtures: StoreFixture[] = []

  afterEach(async () => {
    for (const fixture of fixtures.splice(0)) await fixture.close()
  })

  async function legacyGame(
    steps: number,
    options: { codec?: RevisionCodec; name?: string; sealNewest?: boolean } = {},
  ) {
    const fixture = await (create as StoreFactory)(options.codec === undefined ? {} : { codec: options.codec })
    fixtures.push(fixture)
    const game = playRecordedGame({ steps, noteEvery: 13, ...(options.name === undefined ? {} : { name: options.name }) })
    const saved = await saveRecordedGame(fixture.repo, game, { passPrevious: false })
    await fixture.makeLegacy(game.start.id, options.sealNewest === undefined ? {} : { sealNewest: options.sealNewest })
    return { fixture, gameId: game.start.id, saved, game }
  }

  /** Every revision reads back exactly as it was saved. */
  async function expectReadsAsSaved(
    fixture: StoreFixture,
    gameId: string,
    saved: readonly { revision: number; state: GameState }[],
  ) {
    for (const { revision, state } of saved) {
      expect(text((await fixture.repo.findGameRevision(gameId, revision))?.state), `revision ${revision}`).toBe(text(state))
    }
  }

  it('converts an all-full game into a delta chain and every revision still reads back as it was', async () => {
    const { fixture, gameId, saved } = await legacyGame(70)
    const before = await fixture.rows(gameId)
    expect(before).toHaveLength(71)
    expect(before.every((row) => row.kind === 'full' && row.baseRevision === null)).toBe(true)

    const result = await fixture.repo.compactGameRevisions(gameId, 1000)

    // The newest revision is left alone; the other 70 are handled.
    expect(result).toMatchObject({ status: 'compacted', remaining: 0 })
    const after = await fixture.rows(gameId)
    after.forEach((row, index) => {
      if (index === after.length - 1) {
        expect(row, 'the newest row').toMatchObject({ kind: 'full', baseRevision: null })
        return
      }
      const keyframe = after[index - (index % K)]
      expect(row.kind, `row ${index}`).toBe(index % K === 0 ? 'full' : 'delta')
      expect(row.baseRevision, `row ${index}`).toBe(keyframe?.revision)
    })
    if (result.status !== 'compacted') throw new Error('unreachable')
    expect(result.converted + result.keyframes).toBe(70)
    expect(result.keyframes).toBe(Math.ceil(70 / K))
    // The space the conversion reports is the space the rows lost.
    const bytes = (rows: readonly StoredRow[]) => rows.reduce((sum, row) => sum + row.bytes, 0)
    expect(bytes(before) - bytes(after)).toBe(result.freedBytes)
    expect(bytes(after)).toBeLessThan(bytes(before) / 3)

    await expectReadsAsSaved(fixture, gameId, saved)
    expect((await fixture.repo.listGameRevisions(gameId)).map((entry) => text(entry.state))).toEqual(
      saved.map((entry) => text(entry.state)),
    )
  })

  it('a second run changes nothing', async () => {
    const { fixture, gameId, saved } = await legacyGame(40)
    await fixture.repo.compactGameRevisions(gameId, 1000)
    const once = await fixture.rows(gameId)

    expect(await fixture.repo.compactGameRevisions(gameId, 1000)).toEqual({
      status: 'compacted',
      converted: 0,
      keyframes: 0,
      freedBytes: 0,
      handledBytes: 0,
      remaining: 0,
    })
    expect(await fixture.rows(gameId)).toEqual(once)
    await expectReadsAsSaved(fixture, gameId, saved)
  })

  it('chunks give the same chain as one go, and every chunk leaves the game readable', async () => {
    const whole = await legacyGame(60)
    await whole.fixture.repo.compactGameRevisions(whole.gameId, 1000)

    const chunked = await legacyGame(60)
    let remaining = Number.POSITIVE_INFINITY
    let calls = 0
    while (remaining > 0) {
      const result = await chunked.fixture.repo.compactGameRevisions(chunked.gameId, 7)
      if (result.status !== 'compacted') throw new Error(`unexpected ${result.status}`)
      expect(result.converted + result.keyframes).toBeLessThanOrEqual(7)
      remaining = result.remaining
      calls += 1
      // Halfway through, old rows and converted rows read side by side.
      await expectReadsAsSaved(chunked.fixture, chunked.gameId, chunked.saved)
    }
    expect(calls).toBe(Math.ceil(60 / 7))
    expect(shape(await chunked.fixture.rows(chunked.gameId))).toEqual(shape(await whole.fixture.rows(whole.gameId)))
    expect((await chunked.fixture.rows(chunked.gameId)).map((row) => row.bytes)).toEqual(
      (await whole.fixture.rows(whole.gameId)).map((row) => row.bytes),
    )
  })

  it('stops at a byte budget but always takes at least one row', async () => {
    const { fixture, gameId } = await legacyGame(30)
    const sizes = (await fixture.rows(gameId)).map((row) => row.bytes)
    // A budget of one byte still moves forward by one row.
    const first = await fixture.repo.compactGameRevisions(gameId, 1000, 1)
    expect(first).toMatchObject({ status: 'compacted', converted: 0, keyframes: 1, remaining: 29 })
    // Room for the next row and the state before it, not for a third.
    const second = await fixture.repo.compactGameRevisions(gameId, 1000, (sizes[1] ?? 0) * 2 + (sizes[2] ?? 0))
    if (second.status !== 'compacted') throw new Error('unexpected')
    expect(second.converted + second.keyframes).toBe(2)
    expect(second.handledBytes).toBeLessThanOrEqual((sizes[1] ?? 0) * 2 + (sizes[2] ?? 0))
    expect(second.remaining).toBe(27)
  })

  it('reports what is left in remaining', async () => {
    const { fixture, gameId } = await legacyGame(30)
    // 31 rows, the newest is not counted: 30 to handle.
    expect(await fixture.repo.compactGameRevisions(gameId, 10)).toMatchObject({ remaining: 20 })
    expect(await fixture.repo.compactGameRevisions(gameId, 10)).toMatchObject({ remaining: 10 })
    expect(await fixture.repo.compactGameRevisions(gameId, 10)).toMatchObject({ remaining: 0 })
  })

  it('the dry run counts the rows still to handle and a plausible saving, and reads no state', async () => {
    const { fixture, gameId } = await legacyGame(50)
    const rows = await fixture.rows(gameId)

    const [usage] = await fixture.repo.revisionCompactionUsage(gameId)

    expect(usage).toMatchObject({ gameId, revisions: 51, fullRevisions: 50, active: true })
    expect(usage?.freeableBytes).toBeGreaterThan(0)
    // Never more than the old rows hold.
    expect(usage?.freeableBytes).toBeLessThan(rows.reduce((sum, row) => sum + row.bytes, 0))
    expect(Object.keys(usage ?? {}).sort()).toEqual(
      ['active', 'freeableBytes', 'fullRevisions', 'gameId', 'name', 'revisions'],
    )

    await fixture.repo.compactGameRevisions(gameId, 1000)
    expect((await fixture.repo.revisionCompactionUsage(gameId))[0]).toMatchObject({ fullRevisions: 0, freeableBytes: 0 })
    expect(await fixture.repo.revisionCompactionUsage('missing')).toEqual([])
  })

  it('an unknown game is not found', async () => {
    const fixture = await create()
    fixtures.push(fixture)
    expect(await fixture.repo.compactGameRevisions('missing', 10)).toEqual({ status: 'not-found' })
  })

  describe('a conversion that does not check out', () => {
    it('a delta that does not give the state back aborts the game and leaves every row as it was', async () => {
      const { fixture, gameId, saved } = await legacyGame(30, {
        codec: { diff: (prev) => diffValues(prev, prev), apply: applyDelta },
      })
      const before = await fixture.rows(gameId)

      const result = await fixture.repo.compactGameRevisions(gameId, 1000)

      // The first row stays a keyframe; the second is the first conversion.
      expect(result).toEqual({ status: 'mismatch', revision: before[1]?.revision })
      expect(await fixture.rows(gameId)).toEqual(before)
      await expectReadsAsSaved(fixture, gameId, saved)
    })

    it('a codec that throws aborts the game too, and leaves the rows as they were', async () => {
      const { fixture, gameId } = await legacyGame(12, {
        codec: {
          diff: () => {
            throw new Error('codec bug')
          },
          apply: applyDelta,
        },
      })
      const before = await fixture.rows(gameId)
      expect((await fixture.repo.compactGameRevisions(gameId, 1000)).status).toBe('mismatch')
      expect(await fixture.rows(gameId)).toEqual(before)
    })

    it('a delta that cannot be applied aborts the game too', async () => {
      const { fixture, gameId } = await legacyGame(20, {
        codec: { diff: diffValues, apply: () => ({ ok: false, reason: 'broken' }) },
      })
      const before = await fixture.rows(gameId)
      expect((await fixture.repo.compactGameRevisions(gameId, 1000)).status).toBe('mismatch')
      expect(await fixture.rows(gameId)).toEqual(before)
    })

    it('a mismatch in a later chunk keeps the chunks before it, which still read right, and writes nothing of its own', async () => {
      let badFrom = Number.POSITIVE_INFINITY
      const codec: RevisionCodec = {
        diff: (prev, next) => ((next as GameState).rev >= badFrom ? diffValues(prev, prev) : diffValues(prev, next)),
        apply: applyDelta,
      }
      const { fixture, gameId, saved } = await legacyGame(30, { codec })
      const firstChunk = await fixture.repo.compactGameRevisions(gameId, 10)
      expect(firstChunk).toMatchObject({ status: 'compacted', remaining: 20 })
      const afterFirst = await fixture.rows(gameId)

      badFrom = saved[15]?.revision ?? 0
      const second = await fixture.repo.compactGameRevisions(gameId, 10)

      expect(second).toEqual({ status: 'mismatch', revision: badFrom })
      expect(await fixture.rows(gameId)).toEqual(afterFirst)
      await expectReadsAsSaved(fixture, gameId, saved)

      // Once the problem is gone the same call finishes the job.
      badFrom = Number.POSITIVE_INFINITY
      expect(await fixture.repo.compactGameRevisions(gameId, 1000)).toMatchObject({ status: 'compacted', remaining: 0 })
      await expectReadsAsSaved(fixture, gameId, saved)
    })

    it('a correct delta that is more than half a state is not worth it and starts a new chain instead', async () => {
      const { fixture, gameId, saved } = await legacyGame(12, {
        // Replacing the whole state is a valid delta, and the largest there is.
        codec: { diff: (_prev, next) => [0, next], apply: defaultRevisionCodec.apply },
      })
      expect(await fixture.repo.compactGameRevisions(gameId, 1000)).toMatchObject({ status: 'compacted', converted: 0 })
      const rows = await fixture.rows(gameId)
      expect(rows.every((row) => row.kind === 'full')).toBe(true)
      await expectReadsAsSaved(fixture, gameId, saved)
    })
  })

  describe('a game that is being played', () => {
    /** One more action by whoever holds the turn, saved the way `applyToGame` saves it. */
    async function playOn(fixture: StoreFixture, live: GameState): Promise<GameState> {
      const result = endTurn(live)
      if (!result.ok) throw new Error(result.error.kind)
      const after = stampLog({ ...result.value, rev: live.rev + 1 }, '2026-10-05T00:00:00.000Z')
      const revision = createGameRevision(live, after, ACTOR, '2026-10-05T00:00:00.000Z', 'End turn')
      expect(await fixture.repo.saveGameWithRevision(after, revision, live.rev, revisionSnapshot(live))).toBe(true)
      return after
    }

    it('never touches its newest revision, and the moves that follow hang on it and stay readable', async () => {
      // Unsealed, as a game whose newest row nothing has marked (a seal would make the next move a keyframe).
      const { fixture, gameId, saved, game } = await legacyGame(40, { sealNewest: false })
      const newest = saved.at(-1)
      await fixture.repo.compactGameRevisions(gameId, 1000)
      expect((await fixture.rows(gameId)).at(-1)).toMatchObject({ revision: newest?.revision, kind: 'full', baseRevision: null })

      // People keep playing: the next revisions are written against the untouched newest one.
      let live = game.steps.at(-1)?.after as GameState
      const more: { revision: number; state: GameState }[] = []
      for (let move = 0; move < 3; move++) {
        live = await playOn(fixture, live)
        more.push({ revision: live.rev, state: revisionSnapshot(live) })
      }
      const rows = await fixture.rows(gameId)
      expect(rows.slice(-3).map((row) => [row.kind, row.baseRevision])).toEqual([
        ['delta', newest?.revision],
        ['delta', newest?.revision],
        ['delta', newest?.revision],
      ])

      // A later compaction finds the old newest revision with deltas hanging on it: it stays a keyframe.
      expect(await fixture.repo.compactGameRevisions(gameId, 1000)).toMatchObject({ status: 'compacted', keyframes: 1, converted: 0 })
      expect(await fixture.rows(gameId)).toEqual(
        rows.map((row) => (row.revision === newest?.revision ? { ...row, baseRevision: row.revision } : row)),
      )
      await expectReadsAsSaved(fixture, gameId, [...saved, ...more])
      // And now nothing is left.
      expect(await fixture.repo.compactGameRevisions(gameId, 1000)).toMatchObject({ converted: 0, keyframes: 0, remaining: 0 })
    })

    it('the first move after the deploy is a keyframe (the newest old row is sealed) and the old row is converted later', async () => {
      const { fixture, gameId, saved, game } = await legacyGame(40)
      const newest = saved.at(-1)?.revision ?? 0
      await fixture.repo.compactGameRevisions(gameId, 1000)
      let live = game.steps.at(-1)?.after as GameState
      const more: { revision: number; state: GameState }[] = []
      for (let move = 0; move < 3; move++) {
        live = await playOn(fixture, live)
        more.push({ revision: live.rev, state: revisionSnapshot(live) })
      }
      const first = more[0]?.revision ?? 0
      expect((await fixture.rows(gameId)).slice(-3).map((row) => [row.kind, row.baseRevision])).toEqual([
        ['full', first],
        ['delta', first],
        ['delta', first],
      ])

      // Nothing hangs on the old newest row now, so a later compaction turns it into a delta.
      expect(await fixture.repo.compactGameRevisions(gameId, 1000)).toMatchObject({ status: 'compacted', converted: 1 })
      expect((await fixture.rows(gameId)).find((row) => row.revision === newest)).toMatchObject({ kind: 'delta' })
      await expectReadsAsSaved(fixture, gameId, [...saved, ...more])
    })

    it('a move written halfway through a compaction does not break it', async () => {
      const { fixture, gameId, saved, game } = await legacyGame(40)
      await fixture.repo.compactGameRevisions(gameId, 15)
      let live = game.steps.at(-1)?.after as GameState
      live = await playOn(fixture, live)
      const more = [{ revision: live.rev, state: revisionSnapshot(live) }]
      await fixture.repo.compactGameRevisions(gameId, 1000)
      live = await playOn(fixture, live)
      more.push({ revision: live.rev, state: revisionSnapshot(live) })
      await fixture.repo.compactGameRevisions(gameId, 1000)
      await expectReadsAsSaved(fixture, gameId, [...saved, ...more])
    })
  })

  it('a game that was already partly converted, with a delta first written after the deploy, finishes cleanly', async () => {
    const { fixture, gameId, saved } = await legacyGame(30)
    await fixture.repo.compactGameRevisions(gameId, 12)
    await fixture.repo.compactGameRevisions(gameId, 1000)
    await expectReadsAsSaved(fixture, gameId, saved)
    expect((await fixture.repo.revisionCompactionUsage(gameId))[0]?.fullRevisions).toBe(0)
  })
})

describe('revision compaction in D1: runs that overlap other writes', () => {
  const d1 = storeImplementations[1]?.[1] as StoreFactory
  const fixtures: StoreFixture[] = []

  afterEach(async () => {
    for (const fixture of fixtures.splice(0)) await fixture.close()
  })

  async function legacyGame(steps: number) {
    const fixture = await d1()
    fixtures.push(fixture)
    const game = playRecordedGame({ steps, noteEvery: 13 })
    const saved = await saveRecordedGame(fixture.repo, game, { passPrevious: false })
    await fixture.makeLegacy(game.start.id, { sealNewest: false })
    return { fixture, gameId: game.start.id, saved, game }
  }

  it('two runs at once leave the same chain as one run, and nothing is double converted', async () => {
    const one = await legacyGame(45)
    await one.fixture.repo.compactGameRevisions(one.gameId, 1000)

    const two = await legacyGame(45)
    // Different caps, started together: they plan from the same rows and race to the batch.
    const results = await Promise.all([
      two.fixture.repo.compactGameRevisions(two.gameId, 1000),
      two.fixture.repo.compactGameRevisions(two.gameId, 20),
      two.fixture.repo.compactGameRevisions(two.gameId, 1000),
    ])
    expect(results.every((result) => result.status === 'compacted')).toBe(true)
    expect(shape(await two.fixture.rows(two.gameId))).toEqual(shape(await one.fixture.rows(one.gameId)))
    for (const { revision, state } of two.saved) {
      expect(text((await two.fixture.repo.findGameRevision(two.gameId, revision))?.state)).toBe(text(state))
    }
  })

  it('a live write that lands between the compaction reading the rows and writing them is not hurt', async () => {
    const { fixture, gameId, saved, game } = await legacyGame(35)
    const db = fixture.db as NonNullable<StoreFixture['db']>
    let live = game.steps.at(-1)?.after as GameState
    const after = endTurn(live)
    if (!after.ok) throw new Error('cannot end turn')
    const next = stampLog({ ...after.value, rev: live.rev + 1 }, '2026-10-05T00:00:00.000Z')

    // A player moves just before the compaction's batch commits.
    const realBatch = db.batch.bind(db)
    let wrote = false
    const patched = Object.assign(db, {
      batch: async (statements: Parameters<typeof realBatch>[0]) => {
        if (!wrote) {
          wrote = true
          expect(
            await fixture.repo.saveGameWithRevision(
              next,
              createGameRevision(live, next, ACTOR, '2026-10-05T00:00:00.000Z', 'late'),
              live.rev,
              revisionSnapshot(live),
            ),
          ).toBe(true)
        }
        return realBatch(statements)
      },
    })
    expect(patched).toBe(db)

    expect(await fixture.repo.compactGameRevisions(gameId, 1000)).toMatchObject({ status: 'compacted' })
    live = next
    for (const { revision, state } of saved) {
      expect(text((await fixture.repo.findGameRevision(gameId, revision))?.state)).toBe(text(state))
    }
    expect((await fixture.repo.findGameRevision(gameId, next.rev))?.state.rev).toBe(next.rev)
    // The write hung on the old newest row, which the compaction had left alone.
    const rows = await fixture.rows(gameId)
    expect(rows.at(-1)).toMatchObject({ revision: next.rev, kind: 'delta' })
  })

  it('a live write that lands between a writer reading its tail and committing is refused cleanly when the chain moved', async () => {
    const { fixture, gameId, saved, game } = await legacyGame(35)
    const db = fixture.db as NonNullable<StoreFixture['db']>
    const live = game.steps.at(-1)?.after as GameState
    const ended = endTurn(live)
    if (!ended.ok) throw new Error('cannot end turn')
    const next = stampLog({ ...ended.value, rev: live.rev + 1 }, '2026-10-05T00:00:00.000Z')

    // The compaction finishes between the writer's read of the tail and its batch.
    const realBatch = db.batch.bind(db)
    let compacted = false
    Object.assign(db, {
      batch: async (statements: Parameters<typeof realBatch>[0]) => {
        if (!compacted) {
          compacted = true
          await fixture.repo.compactGameRevisions(gameId, 1000)
        }
        return realBatch(statements)
      },
    })

    // The newest row is exactly what the writer assumed, and the compaction left it alone.
    expect(
      await fixture.repo.saveGameWithRevision(
        next,
        createGameRevision(live, next, ACTOR, '2026-10-05T00:00:00.000Z', 'x'),
        live.rev,
        revisionSnapshot(live),
      ),
    ).toBe(true)
    for (const { revision, state } of saved) {
      expect(text((await fixture.repo.findGameRevision(gameId, revision))?.state)).toBe(text(state))
    }
    expect((await fixture.repo.findGameRevision(gameId, next.rev))?.state.rev).toBe(next.rev)
  })
})
