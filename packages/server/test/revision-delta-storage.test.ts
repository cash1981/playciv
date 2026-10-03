/**
 * Delta storage for game revisions (issue #238, phase 1), against both
 * repositories: the in-memory JSON store and `D1Repository` over a real SQLite
 * engine with every migration applied. A revision is a keyframe or a delta
 * against the one before it; reading one still returns the full state.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { endTurn } from '@civ/engine'
import type { GameState } from '@civ/engine'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createGameRevision, revisionSnapshot, stampLog } from '../src/context.js'
import type { RevisionCodec } from '../src/revision-delta.js'
import { applyDelta, defaultRevisionCodec, diffValues, REVISION_KEYFRAME_INTERVAL } from '../src/revision-delta.js'
import { D1Repository } from '../src/store/d1.js'
import { JsonFileRepository } from '../src/store/json-file.js'
import { createD1Adapter } from './d1-sqlite-adapter.js'
import type { D1Adapter } from './d1-sqlite-adapter.js'
import { readMigrations } from './migrations.js'
import { playRecordedGame, startGame } from './revision-fixtures.js'
import type { RecordedGame } from './revision-fixtures.js'
import { saveRecordedGame, storeImplementations } from './revision-store-harness.js'
import type { StoreFixture } from './revision-store-harness.js'

const ACTOR = { id: 'p1', username: 'Player1' }
const K = REVISION_KEYFRAME_INTERVAL

/** The text storage would hold for a state, key order included. */
const text = (state: unknown): string => JSON.stringify(state)

/** One more recorded action by whoever holds the turn, saved like `applyToGame` does. */
async function saveNextTurn(fixture: Pick<StoreFixture, 'repo'>, live: GameState): Promise<GameState> {
  const result = endTurn(live)
  if (!result.ok) throw new Error(result.error.kind)
  const after = stampLog({ ...result.value, rev: live.rev + 1 }, '2026-10-02T00:00:00.000Z')
  const revision = createGameRevision(live, after, ACTOR, '2026-10-02T00:00:00.000Z', 'End turn')
  expect(await fixture.repo.saveGameWithRevision(after, revision, live.rev, revisionSnapshot(live))).toBe(true)
  return after
}

describe.each(storeImplementations)('delta revisions: %s', (_name, create) => {
  let fixture: StoreFixture
  let game: RecordedGame

  beforeEach(async () => {
    fixture = await create()
  })

  afterEach(async () => {
    await fixture.close()
  })

  game = playRecordedGame({ steps: 70, players: 3, noteEvery: 11 })

  it('a long game reads back exactly as it was saved, with a keyframe every K revisions', async () => {
    const saved = await saveRecordedGame(fixture.repo, game)
    const gameId = game.start.id
    const rows = await fixture.rows(gameId)

    // More than two keyframe intervals.
    expect(saved).toHaveLength(71)
    expect(rows).toHaveLength(71)
    rows.forEach((row, index) => {
      const keyframe = rows[index - (index % K)]
      expect(row.kind, `row ${index}`).toBe(index % K === 0 ? 'full' : 'delta')
      expect(row.baseRevision, `row ${index}`).toBe(keyframe?.revision)
    })

    for (const { revision, state } of saved) {
      const read = await fixture.repo.findGameRevision(gameId, revision)
      expect(text(read?.state), `revision ${revision}`).toBe(text(state))
    }
    const listed = await fixture.repo.listGameRevisions(gameId)
    expect(listed.map((entry) => text(entry.state))).toEqual(saved.map((entry) => text(entry.state)))
  })

  it('most rows are deltas and a delta is a small fraction of a keyframe', async () => {
    await saveRecordedGame(fixture.repo, game)
    const rows = await fixture.rows(game.start.id)
    const keyframes = rows.filter((row) => row.kind === 'full')
    const deltas = rows.filter((row) => row.kind === 'delta')

    expect(deltas.length).toBeGreaterThanOrEqual(rows.length - Math.ceil(rows.length / K))
    const average = (list: readonly { bytes: number }[]) => list.reduce((sum, row) => sum + row.bytes, 0) / list.length
    expect(average(deltas)).toBeLessThan(average(keyframes) / 20)
    const stored = rows.reduce((sum, row) => sum + row.bytes, 0)
    const asFullStates = (await fixture.repo.listGameRevisions(game.start.id)).reduce(
      (sum, entry) => sum + text(entry.state).length,
      0,
    )
    expect(stored).toBeLessThan(asFullStates / 4)
  })

  it('a private note between two revisions does not break the chain', async () => {
    await saveRecordedGame(fixture.repo, game)
    const rows = await fixture.rows(game.start.id)
    // `noteEvery: 11` put notes in the game, and the keyframes still sit every K rows.
    expect(game.steps.some((step) => step.revision === undefined)).toBe(true)
    expect(rows.filter((row) => row.sealed)).toEqual([])
    expect(rows.filter((row) => row.kind === 'full')).toHaveLength(Math.ceil(rows.length / K))
  })

  it('without the previous state every revision is a keyframe and reads the same', async () => {
    const small = playRecordedGame({ steps: 8 })
    const saved = await saveRecordedGame(fixture.repo, small, { passPrevious: false })
    const rows = await fixture.rows(small.start.id)
    expect(rows.every((row) => row.kind === 'full' && row.baseRevision === row.revision)).toBe(true)
    for (const { revision, state } of saved) {
      expect(text((await fixture.repo.findGameRevision(small.start.id, revision))?.state)).toBe(text(state))
    }
  })

  it('a write against an old game revision is refused and leaves no row behind', async () => {
    const small = playRecordedGame({ steps: 5 })
    await saveRecordedGame(fixture.repo, small)
    const before = await fixture.rows(small.start.id)
    const live = small.steps.at(-1)?.after as GameState

    const result = endTurn(live)
    if (!result.ok) throw new Error('fixture cannot end the turn')
    const next = stampLog({ ...result.value, rev: live.rev + 1 }, '2026-10-02T00:00:00.000Z')
    const revision = createGameRevision(live, next, ACTOR, '2026-10-02T00:00:00.000Z', 'late')

    // Someone else already moved on: the expected revision is not the stored one.
    expect(await fixture.repo.saveGameWithRevision(next, revision, live.rev - 1, revisionSnapshot(live))).toBe(false)
    expect(await fixture.rows(small.start.id)).toEqual(before)
    expect((await fixture.repo.findGame(small.start.id))?.rev).toBe(live.rev)

    // The first of two writers from the same base wins, the second loses.
    expect(await fixture.repo.saveGameWithRevision(next, revision, live.rev, revisionSnapshot(live))).toBe(true)
    expect(await fixture.repo.saveGameWithRevision(next, revision, live.rev, revisionSnapshot(live))).toBe(false)
    expect(await fixture.rows(small.start.id)).toHaveLength(before.length + 1)
  })

  it('the baseline from ensureGameRevision is a keyframe and the next revision hangs on it', async () => {
    const live = startGame({ name: 'Baseline' })
    await fixture.repo.saveGame(live)
    const baseline = createGameRevision(undefined, live, ACTOR, '2026-10-02T00:00:00.000Z', 'History starts here')
    expect(await fixture.repo.ensureGameRevision(baseline, live.rev)).toBe(true)
    expect(await fixture.rows(live.id)).toEqual([
      expect.objectContaining({ revision: live.rev, kind: 'full', baseRevision: live.rev }),
    ])

    const after = await saveNextTurn(fixture, live)
    const rows = await fixture.rows(live.id)
    expect(rows.map((row) => row.kind)).toEqual(['full', 'delta'])
    expect(rows[1]?.baseRevision).toBe(live.rev)
    expect(text((await fixture.repo.findGameRevision(live.id, after.rev))?.state)).toBe(
      text(revisionSnapshot(after)),
    )
  })

  it('a change that is not a private note seals the revision and the next one is a keyframe', async () => {
    const small = playRecordedGame({ steps: 4 })
    await saveRecordedGame(fixture.repo, small)
    const live = small.steps.at(-1)?.after as GameState

    // An admin setting: saved without a revision, and not just a note.
    const switched = { ...live, rev: live.rev + 1, chatOrders: true }
    expect(await fixture.repo.saveGameIfRevision(switched, live.rev)).toBe(true)
    expect((await fixture.rows(live.id)).at(-1)?.sealed).toBe(true)

    const after = await saveNextTurn(fixture, switched)
    const rows = await fixture.rows(live.id)
    expect(rows.at(-1)).toMatchObject({ revision: after.rev, kind: 'full', sealed: false })
    // The keyframe carries the setting a delta against the old row would have lost.
    expect((await fixture.repo.findGameRevision(live.id, after.rev))?.state.chatOrders).toBe(true)

    // And the revision after that is an ordinary delta again.
    await saveNextTurn(fixture, after)
    expect((await fixture.rows(live.id)).at(-1)?.kind).toBe('delta')
  })

  it('overwriting the live game seals the newest revision too', async () => {
    const small = playRecordedGame({ steps: 3 })
    await saveRecordedGame(fixture.repo, small)
    const live = small.steps.at(-1)?.after as GameState
    const rewritten = { ...live, name: 'Renamed by hand' }
    await fixture.repo.saveGame(rewritten)

    const after = await saveNextTurn(fixture, rewritten)
    expect((await fixture.rows(live.id)).at(-1)).toMatchObject({ revision: after.rev, kind: 'full' })
    expect((await fixture.repo.findGameRevision(live.id, after.rev))?.state.name).toBe('Renamed by hand')
  })

  it('a note that saveGameIfRevision refuses seals nothing', async () => {
    const small = playRecordedGame({ steps: 3 })
    await saveRecordedGame(fixture.repo, small)
    const live = small.steps.at(-1)?.after as GameState
    expect(await fixture.repo.saveGameIfRevision({ ...live, rev: live.rev + 1 }, live.rev - 1)).toBe(false)
    expect((await fixture.rows(live.id)).some((row) => row.sealed)).toBe(false)
  })
})

describe.each(storeImplementations)('a broken codec costs space, not correctness: %s', (_name, create) => {
  const game = playRecordedGame({ steps: 12 })
  let fixture: StoreFixture | undefined

  afterEach(async () => {
    await fixture?.close()
  })

  async function run(codec: RevisionCodec): Promise<readonly string[]> {
    fixture = await create({ codec })
    const saved = await saveRecordedGame(fixture.repo, game)
    for (const { revision, state } of saved) {
      expect(text((await fixture.repo.findGameRevision(game.start.id, revision))?.state)).toBe(text(state))
    }
    return (await fixture.rows(game.start.id)).map((row) => row.kind)
  }

  it('a delta that does not give the new state back is replaced by a keyframe', async () => {
    const kinds = await run({
      // Says "nothing changed" about everything: wrong whenever something did.
      diff: (prev) => diffValues(prev, prev),
      apply: applyDelta,
    })
    expect(kinds.every((kind) => kind === 'full')).toBe(true)
  })

  it('a delta that cannot be applied is replaced by a keyframe', async () => {
    const kinds = await run({ diff: diffValues, apply: () => ({ ok: false, reason: 'broken' }) })
    expect(kinds.every((kind) => kind === 'full')).toBe(true)
  })

  it('a delta that is correct but more than half the state is replaced by a keyframe', async () => {
    const kinds = await run({
      // Replacing the whole state is a valid delta and the largest one.
      diff: (_prev, next) => [0, next],
      apply: defaultRevisionCodec.apply,
    })
    expect(kinds.every((kind) => kind === 'full')).toBe(true)
  })

  it('a codec that throws is replaced by a keyframe too', async () => {
    const kinds = await run({
      diff: () => {
        throw new Error('codec bug')
      },
      apply: applyDelta,
    })
    expect(kinds.every((kind) => kind === 'full')).toBe(true)
  })

  it('a codec that is fine is used', async () => {
    const kinds = await run(defaultRevisionCodec)
    expect(kinds.filter((kind) => kind === 'delta').length).toBeGreaterThan(8)
  })
})

describe('delta revisions in D1: the SQL', () => {
  let adapter: D1Adapter
  let repo: D1Repository
  const game = playRecordedGame({ steps: 30, noteEvery: 7 })

  beforeEach(async () => {
    adapter = await createD1Adapter(readMigrations())
    repo = new D1Repository(adapter.db)
  })

  afterEach(() => {
    adapter.close()
  })

  it('listing the history never selects the state column, deltas or not', async () => {
    await saveRecordedGame(repo, game)
    const prepare = vi.spyOn(adapter.db, 'prepare')
    const summaries = await repo.listGameRevisionSummaries(game.start.id)
    const sql = prepare.mock.calls.map(([query]) => query).join('\n')

    expect(summaries).toHaveLength(31)
    expect(sql).toMatch(/FROM game_revision/)
    expect(sql).not.toMatch(/\bstate\b/)
  })

  it('reading a revision is one query whose rows are the keyframe and the deltas after it', async () => {
    await saveRecordedGame(repo, game)
    const prepare = vi.spyOn(adapter.db, 'prepare')
    const read = await repo.findGameRevision(game.start.id, game.steps.filter((s) => s.revision).at(-1)?.after.rev ?? 0)
    expect(read).toBeDefined()
    expect(prepare).toHaveBeenCalledTimes(1)
  })

  it('a write reads the metadata of the newest row and never a state', async () => {
    const live = playRecordedGame({ steps: 3 }).steps.at(-1)?.after as GameState
    await repo.saveGame(live)
    const created = createGameRevision(undefined, live, ACTOR, '2026-10-02T00:00:00.000Z', 'baseline')
    await repo.ensureGameRevision(created, live.rev)

    const result = endTurn(live)
    if (!result.ok) throw new Error('fixture cannot end the turn')
    const after = stampLog({ ...result.value, rev: live.rev + 1 }, '2026-10-02T00:00:00.000Z')
    const prepare = vi.spyOn(adapter.db, 'prepare')
    await repo.saveGameWithRevision(
      after,
      createGameRevision(live, after, ACTOR, '2026-10-02T00:00:00.000Z', 'x'),
      live.rev,
      revisionSnapshot(live),
    )
    const queries = prepare.mock.calls.map(([query]) => query)
    // The tail query and the batch: nothing that loads a state.
    expect(queries).toHaveLength(3)
    const selects = queries.filter((query) => /^\s*SELECT/i.test(query))
    expect(selects).toHaveLength(1)
    expect(selects[0]).toMatch(/LENGTH\(CAST\(k\.state AS BLOB\)\)/)
    expect(selects[0]).not.toMatch(/SELECT[^()]*\bstate\b[^()]*FROM/)
  })

  it('a row from before delta storage is a keyframe the next delta hangs on', async () => {
    const small = playRecordedGame({ steps: 3 })
    const live = small.start
    await repo.saveGame(live)
    const legacy = createGameRevision(undefined, live, ACTOR, '2026-10-02T00:00:00.000Z', 'legacy')
    // The columns the table had before migration 0006: kind and base_revision take their defaults.
    await adapter.db
      .prepare(
        `INSERT INTO game_revision (game_id, revision, created_at, actor_id, actor_username,
           public_description, private_descriptions, log_ids, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(live.id, live.rev, legacy.createdAt, 'p1', 'Player1', 'legacy', '{}', '[]', text(legacy.state))
      .run()
    expect(await fixture(adapter, live.id)).toEqual([{ revision: live.rev, kind: 'full', base_revision: null }])

    const result = endTurn(live)
    if (!result.ok) throw new Error('cannot end turn')
    const next = stampLog({ ...result.value, rev: live.rev + 1 }, '2026-10-02T00:00:00.000Z')
    expect(
      await repo.saveGameWithRevision(
        next,
        createGameRevision(live, next, ACTOR, '2026-10-02T00:00:00.000Z', 'x'),
        live.rev,
        revisionSnapshot(live),
      ),
    ).toBe(true)
    expect(await fixture(adapter, live.id)).toEqual([
      { revision: live.rev, kind: 'full', base_revision: null },
      { revision: next.rev, kind: 'delta', base_revision: live.rev },
    ])
    expect(text((await repo.findGameRevision(live.id, live.rev))?.state)).toBe(text(legacy.state))
    expect((await repo.findGameRevision(live.id, next.rev))?.state.rev).toBe(next.rev)
  })

  it('refuses the write when the keyframe it hangs on changed after the tail was read', async () => {
    const small = playRecordedGame({ steps: 3 })
    await saveRecordedGame(repo, small)
    const live = small.steps.at(-1)?.after as GameState
    const result = endTurn(live)
    if (!result.ok) throw new Error('cannot end turn')
    const next = stampLog({ ...result.value, rev: live.rev + 1 }, '2026-10-02T00:00:00.000Z')
    const revision = createGameRevision(live, next, ACTOR, '2026-10-02T00:00:00.000Z', 'x')
    const rowsBefore = await fixture(adapter, live.id)

    // A cleanup or compaction slips in between the read of the tail and the batch.
    const realBatch = adapter.db.batch.bind(adapter.db)
    vi.spyOn(adapter.db, 'batch').mockImplementationOnce(async (statements) => {
      await adapter.db.prepare(`DELETE FROM game_revision WHERE game_id = ? AND revision < ?`).bind(live.id, live.rev).run()
      return realBatch(statements)
    })

    expect(await repo.saveGameWithRevision(next, revision, live.rev, revisionSnapshot(live))).toBe(false)
    // The live game did not advance and no revision was added.
    expect((await repo.findGame(live.id))?.rev).toBe(live.rev)
    expect((await fixture(adapter, live.id)).length).toBeLessThan(rowsBefore.length)
    expect((await fixture(adapter, live.id)).some((row) => row.revision === next.rev)).toBe(false)
  })

  it('refuses to read a delta whose keyframe is gone instead of guessing', async () => {
    const small = playRecordedGame({ steps: 6 })
    await saveRecordedGame(repo, small)
    // What the old stop-gap SQL (delete the oldest rows) would now do to a chain.
    await adapter.db.prepare(`DELETE FROM game_revision WHERE kind = 'full'`).run()
    await expect(repo.findGameRevision(small.start.id, 3)).rejects.toThrow(/keyframe/)
  })
})

async function fixture(adapter: D1Adapter, gameId: string) {
  const rows = await adapter.db
    .prepare(`SELECT revision, kind, base_revision FROM game_revision WHERE game_id = ? ORDER BY revision`)
    .bind(gameId)
    .all<{ revision: number; kind: string; base_revision: number | null }>()
  return rows.results
}

describe('delta revisions in the JSON file store: the file', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'civ-json-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('deltas survive a restart and read back as saved', async () => {
    const filePath = join(directory, 'data.json')
    const small = playRecordedGame({ steps: 30 })
    const first = new JsonFileRepository({ filePath, debounceMs: 60_000 })
    const saved = await saveRecordedGame(first, small)
    await first.flush()

    const second = new JsonFileRepository({ filePath })
    await second.load()
    for (const { revision, state } of saved) {
      expect(text((await second.findGameRevision(small.start.id, revision))?.state)).toBe(text(state))
    }
  })

  it('a file from before delta storage still loads; its newest row is sealed, so a keyframe comes next, then deltas', async () => {
    const filePath = join(directory, 'data.json')
    const live = startGame({ name: 'Legacy file' })
    const legacy = createGameRevision(undefined, live, ACTOR, '2026-10-02T00:00:00.000Z', 'legacy')
    // The old shape: whole `GameRevision`s, no kind, base or seal.
    await writeFile(
      filePath,
      JSON.stringify({ version: 1, players: [], games: [live], chat: [], revisions: [legacy] }),
      'utf8',
    )
    const repo = new JsonFileRepository({ filePath, debounceMs: 60_000 })
    await repo.load()
    expect(text((await repo.findGameRevision(live.id, live.rev))?.state)).toBe(text(legacy.state))

    const result = endTurn(live)
    if (!result.ok) throw new Error('cannot end turn')
    const next = stampLog({ ...result.value, rev: live.rev + 1 }, '2026-10-02T00:00:00.000Z')
    expect(
      await repo.saveGameWithRevision(
        next,
        createGameRevision(live, next, ACTOR, '2026-10-02T00:00:00.000Z', 'x'),
        live.rev,
        revisionSnapshot(live),
      ),
    ).toBe(true)
    const afterNext = await saveNextTurn({ repo }, next)
    await repo.flush()
    const file = JSON.parse(await readFile(filePath, 'utf8')) as { revisions: { kind?: string; baseRevision?: number | null }[] }
    expect(file.revisions.map((row) => [row.kind, row.baseRevision])).toEqual([
      ['full', null],
      ['full', next.rev],
      ['delta', next.rev],
    ])
    expect((await repo.findGameRevision(live.id, afterNext.rev))?.state.rev).toBe(afterNext.rev)
  })
})
