/**
 * The admin broadcast queue's storage (repository methods for the daily job),
 * run against both implementations: the in-memory JSON repository and
 * `D1Repository` over a real SQLite engine, as the other repository tests do.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { D1Repository } from '../src/store/d1.js'
import { JsonFileRepository } from '../src/store/json-file.js'
import type { Repository, StoredBroadcast } from '../src/store/types.js'
import { createD1Adapter } from './d1-sqlite-adapter.js'
import { readMigrations } from './migrations.js'

const schema = readMigrations()

function broadcast(id: string, overrides: Partial<StoredBroadcast> = {}): StoredBroadcast {
  return {
    id,
    subject: 'News',
    markdown: 'Hello',
    includeUnsubscribed: false,
    perRun: 50,
    status: 'active',
    createdAt: `2026-10-0${id.length}T17:00:00.000Z`,
    lastRunAt: null,
    ...overrides,
  }
}

const people = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    playerId: `p${String(index).padStart(3, '0')}`,
    email: `p${index}@example.com`,
  }))

interface Fixture {
  readonly repo: Repository
  close(): void
}

const implementations: readonly [string, () => Promise<Fixture>][] = [
  [
    'JsonFileRepository',
    async () => ({ repo: new JsonFileRepository({ filePath: null }), close: () => undefined }),
  ],
  [
    'D1Repository',
    async () => {
      const adapter = await createD1Adapter(schema)
      return { repo: new D1Repository(adapter.db), close: () => adapter.close() }
    },
  ],
]

describe.each(implementations)('broadcast queue storage: %s', (_name, create) => {
  let fixture: Fixture
  let repo: Repository

  beforeEach(async () => {
    fixture = await create()
    repo = fixture.repo
  })

  afterEach(() => {
    fixture.close()
  })

  it('stores a broadcast with its recipients, all pending, in the order given', async () => {
    expect(await repo.createBroadcast(broadcast('a'), people(3))).toBe(true)

    expect(await repo.currentBroadcast()).toEqual(broadcast('a'))
    expect(await repo.broadcastCounts('a')).toEqual({ pending: 3, sending: 0, sent: 0, failed: 0 })
    const pending = await repo.listBroadcastRecipients('a', 'pending')
    expect(pending.map((row) => row.playerId)).toEqual(['p000', 'p001', 'p002'])
    expect(pending[0]).toEqual({
      broadcastId: 'a',
      playerId: 'p000',
      email: 'p0@example.com',
      status: 'pending',
      sentAt: null,
      error: null,
    })
  })

  it('stores more recipients than one insert chunk holds, in order', async () => {
    expect(await repo.createBroadcast(broadcast('a'), people(1200))).toBe(true)

    expect((await repo.broadcastCounts('a')).pending).toBe(1200)
    const claimed = await repo.claimBroadcastRecipients('a', 1200)
    expect(claimed.map((row) => row.playerId)).toEqual(people(1200).map((row) => row.playerId))
  })

  it('refuses a second active broadcast and stores none of its recipients', async () => {
    await repo.createBroadcast(broadcast('a'), people(2))

    expect(await repo.createBroadcast(broadcast('bb'), people(5))).toBe(false)

    expect((await repo.currentBroadcast())?.id).toBe('a')
    expect(await repo.broadcastCounts('bb')).toEqual({ pending: 0, sending: 0, sent: 0, failed: 0 })
  })

  it('accepts a new broadcast once the old one is finished', async () => {
    await repo.createBroadcast(broadcast('a'), people(1))
    expect(await repo.finishBroadcast('a', 'done')).toBe(true)

    expect(await repo.createBroadcast(broadcast('bb'), people(1))).toBe(true)
    expect((await repo.currentBroadcast())?.id).toBe('bb')
  })

  it('answers the latest broadcast when none is active, and nothing when there is none', async () => {
    expect(await repo.currentBroadcast()).toBeUndefined()

    await repo.createBroadcast(broadcast('a'), people(1))
    await repo.finishBroadcast('a', 'cancelled')
    expect((await repo.currentBroadcast())?.status).toBe('cancelled')

    await repo.createBroadcast(broadcast('bb'), people(1))
    await repo.finishBroadcast('bb', 'done')
    expect((await repo.currentBroadcast())?.id).toBe('bb')
  })

  it('claims at most N pending recipients, oldest first, and marks them sending', async () => {
    await repo.createBroadcast(broadcast('a'), people(5))

    const first = await repo.claimBroadcastRecipients('a', 2)
    expect(first.map((row) => row.playerId)).toEqual(['p000', 'p001'])
    expect(first.every((row) => row.status === 'sending')).toBe(true)

    const second = await repo.claimBroadcastRecipients('a', 10)
    expect(second.map((row) => row.playerId)).toEqual(['p002', 'p003', 'p004'])
    expect(await repo.claimBroadcastRecipients('a', 10)).toEqual([])
    expect(await repo.broadcastCounts('a')).toEqual({ pending: 0, sending: 5, sent: 0, failed: 0 })
  })

  it('hands no recipient to two claims issued at the same time (SQLite itself is synchronous, so this checks the claim, not real parallelism)', async () => {
    await repo.createBroadcast(broadcast('a'), people(7))

    const [one, two] = await Promise.all([
      repo.claimBroadcastRecipients('a', 5),
      repo.claimBroadcastRecipients('a', 5),
    ])

    const ids = [...one, ...two].map((row) => row.playerId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toHaveLength(7)
  })

  it('yields no claims for a done or cancelled broadcast', async () => {
    await repo.createBroadcast(broadcast('a'), people(3))
    await repo.finishBroadcast('a', 'cancelled')
    expect(await repo.claimBroadcastRecipients('a', 10)).toEqual([])

    await repo.createBroadcast(broadcast('bb'), people(3))
    await repo.finishBroadcast('bb', 'done')
    expect(await repo.claimBroadcastRecipients('bb', 10)).toEqual([])
    expect((await repo.broadcastCounts('bb')).pending).toBe(3)
  })

  it('marks claimed recipients sent or failed with a reason', async () => {
    await repo.createBroadcast(broadcast('a'), people(4))
    await repo.claimBroadcastRecipients('a', 3)

    await repo.markBroadcastRecipientsSent('a', ['p000'], '2026-10-04T17:00:00.000Z')
    await repo.markBroadcastRecipientsFailed('a', [
      { playerId: 'p001', error: 'Invalid `to` field.' },
      { playerId: 'p002', error: 'unsubscribed since queueing' },
    ])

    expect(await repo.broadcastCounts('a')).toEqual({ pending: 1, sending: 0, sent: 1, failed: 2 })
    const [sent] = await repo.listBroadcastRecipients('a', 'sent')
    expect(sent?.sentAt).toBe('2026-10-04T17:00:00.000Z')
    const failed = await repo.listBroadcastRecipients('a', 'failed')
    expect(failed.map((row) => [row.playerId, row.error])).toEqual([
      ['p001', 'Invalid `to` field.'],
      ['p002', 'unsubscribed since queueing'],
    ])
  })

  it('only marks rows that are claimed, so a pending row cannot be marked sent', async () => {
    await repo.createBroadcast(broadcast('a'), people(2))

    await repo.markBroadcastRecipientsSent('a', ['p000'], '2026-10-04T17:00:00.000Z')
    await repo.markBroadcastRecipientsFailed('a', [{ playerId: 'p001', error: 'x' }])

    expect(await repo.broadcastCounts('a')).toEqual({ pending: 2, sending: 0, sent: 0, failed: 0 })
  })

  it('releases only the rows it is given back to pending', async () => {
    await repo.createBroadcast(broadcast('a'), people(3))
    await repo.claimBroadcastRecipients('a', 3)

    await repo.releaseBroadcastRecipients('a', ['p001'])

    expect(await repo.broadcastCounts('a')).toEqual({ pending: 1, sending: 2, sent: 0, failed: 0 })
    // The released row can be claimed again; the others stay claimed.
    expect((await repo.claimBroadcastRecipients('a', 10)).map((row) => row.playerId)).toEqual(['p001'])
  })

  it('releases every stuck row of an active broadcast, and only those', async () => {
    await repo.createBroadcast(broadcast('a'), people(5))
    await repo.claimBroadcastRecipients('a', 3)
    await repo.markBroadcastRecipientsSent('a', ['p000'], '2026-10-04T17:00:00.000Z')

    expect(await repo.releaseStuckBroadcastRecipients('a')).toBe(2)

    expect(await repo.broadcastCounts('a')).toEqual({ pending: 4, sending: 0, sent: 1, failed: 0 })
    // Nothing left to release.
    expect(await repo.releaseStuckBroadcastRecipients('a')).toBe(0)
  })

  it('releases nothing for a broadcast that is not active', async () => {
    await repo.createBroadcast(broadcast('a'), people(2))
    await repo.claimBroadcastRecipients('a', 2)
    await repo.finishBroadcast('a', 'cancelled')

    expect(await repo.releaseStuckBroadcastRecipients('a')).toBe(0)
    expect((await repo.broadcastCounts('a')).sending).toBe(2)
  })

  it('finishes a broadcast only while it is active', async () => {
    await repo.createBroadcast(broadcast('a'), people(1))

    expect(await repo.finishBroadcast('a', 'cancelled')).toBe(true)
    expect(await repo.finishBroadcast('a', 'done')).toBe(false)
    expect((await repo.currentBroadcast())?.status).toBe('cancelled')
  })

  it('records when the last run happened', async () => {
    await repo.createBroadcast(broadcast('a'), people(1))

    await repo.recordBroadcastRun('a', '2026-10-04T17:00:01.000Z')

    expect((await repo.currentBroadcast())?.lastRunAt).toBe('2026-10-04T17:00:01.000Z')
  })

  it('counts an empty broadcast as all zeros', async () => {
    await repo.createBroadcast(broadcast('a'), [])
    expect(await repo.broadcastCounts('a')).toEqual({ pending: 0, sending: 0, sent: 0, failed: 0 })
  })
})

describe('broadcast queue storage: JSON file round trip', () => {
  it('survives a restart, claimed rows included', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'civ-queue-'))
    try {
      const filePath = join(directory, 'civ.json')
      const before = new JsonFileRepository({ filePath })
      await before.createBroadcast(broadcast('a'), people(3))
      await before.claimBroadcastRecipients('a', 1)
      await before.flush()

      const after = new JsonFileRepository({ filePath })
      await after.load()

      expect((await after.currentBroadcast())?.id).toBe('a')
      expect(await after.broadcastCounts('a')).toEqual({ pending: 2, sending: 1, sent: 0, failed: 0 })
      expect((await after.claimBroadcastRecipients('a', 5)).map((row) => row.playerId)).toEqual([
        'p001',
        'p002',
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
