/**
 * The dump-to-D1 mapping and SQL emitter. Pure functions plus one end-to-end
 * check that the generated statements load into a real SQLite database with the
 * committed schema.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { DumpDoc } from '../src/migrate/rows.js'
import {
  createdAtFromObjectId,
  emailSentRow,
  gameRow,
  normalizeExtendedJson,
  oidOf,
  PBF_DOC_CHUNK_SIZE,
  pbfDocChunks,
  pbfRow,
  playerRow,
  revisionRow,
} from '../src/migrate/rows.js'
import { insertStatement, sqlValue } from '../src/migrate/sql.js'
import { createD1Adapter } from './d1-sqlite-adapter.js'
import type { D1Adapter } from './d1-sqlite-adapter.js'
import { readMigrations } from './migrations.js'

const schema = readMigrations()

const OID = '55223c74e4b00485f8dd926e'

const playerDoc: DumpDoc = {
  _id: { $oid: OID },
  username: 'cash',
  email: 'shervin@asgari.no',
  disableEmail: true,
  password: 'fc1c:deadbeef',
  emailSent: [2017, 11, 14, 12, 9, 40, 143_000_000],
  gameIds: [],
  role: 'admin',
  disabled: false,
}

const pbfDoc: DumpDoc = {
  _id: { $oid: '55227c5fe4b0acc8e3f26dad' },
  name: 'PBF beta test',
  numOfPlayers: 2,
  active: false,
  winner: 'cash',
  players: [
    { username: 'cash', civilization: { name: 'Greeks' } },
    { username: 'bob' },
  ],
}

const gameDoc: DumpDoc = {
  _id: { $oid: OID },
  id: 'game-1',
  rev: 7,
  active: false,
  winner: 'cash',
  numOfPlayers: 2,
  players: [{ username: 'cash' }],
}

const revisionDoc: DumpDoc = {
  _id: 'game-1:7',
  gameId: 'game-1',
  revision: 7,
  createdAt: '2020-01-01T00:00:00.000Z',
  actor: { playerId: 'p1', username: 'cash' },
  publicDescription: 'drew',
  privateDescriptions: { p1: 'you drew X' },
  logIds: ['l1'],
  state: { id: 'game-1', rev: 7 },
}

describe('dump mapping', () => {
  it('normalises extended JSON and reads ObjectIds', () => {
    expect(oidOf({ $oid: OID })).toBe(OID)
    expect(oidOf('plain')).toBe('plain')
    expect(oidOf(42)).toBeNull()
    expect(normalizeExtendedJson({ _id: { $oid: OID }, x: [{ $oid: 'a' }] })).toEqual({
      _id: OID,
      x: ['a'],
    })
  })

  it('derives a legacy creation time from the ObjectId', () => {
    // 0x55223c74 = 1428307060 seconds.
    expect(createdAtFromObjectId(OID)).toBe('2015-04-06T07:57:40.000Z')
    expect(createdAtFromObjectId('not-an-object-id')).toBe('1970-01-01T00:00:00.000Z')
  })

  it('maps a player and applies role/disabled defaults', () => {
    expect(playerRow(playerDoc)).toEqual({
      id: OID,
      username: 'cash',
      username_lower: 'cash',
      email: 'shervin@asgari.no',
      password: 'fc1c:deadbeef',
      created_at: '2015-04-06T07:57:40.000Z',
      role: 'admin',
      disabled: 0,
      disable_email: 1,
      // Migrated accounts are grandfathered verified (issue #42); the import
      // writes this explicitly because it is a fresh INSERT after migration
      // 0004's default of 0.
      email_verified: 1,
    })
    expect(playerRow({ _id: 'u1', username: 'Åse' })).toMatchObject({
      username: 'Åse',
      // Unicode folding here, not SQLite's ASCII-only lower().
      username_lower: 'åse',
      role: 'user',
      disabled: 0,
      disable_email: 0,
      email: null,
      email_verified: 1,
    })
  })

  it('maps a pbf game with its highscore roster', () => {
    const row = pbfRow(pbfDoc)
    expect(row.id).toBe('55227c5fe4b0acc8e3f26dad')
    expect(row.active).toBe(0)
    expect(row.winner).toBe('cash')
    expect(row.num_of_players).toBe(2)
    expect(JSON.parse(row.players)).toEqual([
      { username: 'cash', civName: 'Greeks' },
      { username: 'bob', civName: null },
    ])
  })

  it('keeps the full pbf document in chunks under the statement limit', () => {
    const chunks = pbfDocChunks(pbfDoc)
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    expect(chunks.map((chunk) => chunk.seq)).toEqual([...Array(chunks.length).keys()])
    for (const chunk of chunks) {
      expect(chunk.pbf_id).toBe('55227c5fe4b0acc8e3f26dad')
      expect(chunk.chunk.length).toBeLessThanOrEqual(PBF_DOC_CHUNK_SIZE)
    }
    const reassembled = chunks.map((chunk) => chunk.chunk).join('')
    expect(JSON.parse(reassembled)['_id']).toBe('55227c5fe4b0acc8e3f26dad')
    expect(reassembled).toContain('PBF beta test')
  })

  it('maps an empty-winner game and a revision', () => {
    const game = gameRow(gameDoc)
    expect(game.rev).toBe(7)
    expect(game.active).toBe(0)
    expect(JSON.parse(game.state)).not.toHaveProperty('_id')
    expect(JSON.parse(game.state)['id']).toBe('game-1')

    const revision = revisionRow(revisionDoc)
    expect(revision.game_id).toBe('game-1')
    expect(JSON.parse(revision.private_descriptions)).toEqual({ p1: 'you drew X' })
    expect(JSON.parse(revision.log_ids)).toEqual(['l1'])
  })

  it('maps an email-slot row', () => {
    expect(emailSentRow({ _id: 'p1:game-1', at: '2020-01-01T00:00:00.000Z' })).toEqual({
      scope: 'p1:game-1',
      at: '2020-01-01T00:00:00.000Z',
    })
  })

  it('escapes SQL literals', () => {
    expect(sqlValue("O'Brien")).toBe("'O''Brien'")
    expect(sqlValue(null)).toBe('NULL')
    expect(sqlValue(3)).toBe('3')
    expect(sqlValue(true)).toBe('1')
    expect(insertStatement('player', { id: 'x', username: "O'Brien" })).toBe(
      "INSERT INTO player (id, username) VALUES ('x', 'O''Brien');\n",
    )
  })
})

describe('generated SQL loads into the committed schema', () => {
  let adapter: D1Adapter

  beforeEach(async () => {
    adapter = await createD1Adapter(schema)
  })

  afterEach(() => {
    adapter.close()
  })

  it('inserts every mapped row and the highscore query sees the old games', async () => {
    const statements = [
      insertStatement('player', playerRow(playerDoc)),
      insertStatement('pbf', pbfRow(pbfDoc)),
      ...pbfDocChunks(pbfDoc).map((row) => insertStatement('pbf_doc', row)),
      insertStatement('game', gameRow(gameDoc)),
      insertStatement('game_revision', revisionRow(revisionDoc)),
      insertStatement('email_sent', emailSentRow({ _id: 's', at: '2020-01-01T00:00:00.000Z' })),
    ]
    for (const statement of statements) {
      await adapter.db.prepare(statement.trim()).run()
    }

    const count = async (table: string): Promise<number> => {
      const row = await adapter.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>()
      return row?.n ?? -1
    }
    expect(await count('player')).toBe(1)
    expect(await count('pbf')).toBe(1)
    expect(await count('pbf_doc')).toBe(pbfDocChunks(pbfDoc).length)
    expect(await count('game')).toBe(1)
    expect(await count('game_revision')).toBe(1)
    expect(await count('email_sent')).toBe(1)

    // The old data that was deliberately dropped has no tables to land in.
    for (const dropped of ['gamelog', 'tournament']) {
      await expect(
        adapter.db.prepare(`SELECT COUNT(*) AS n FROM ${dropped}`).first(),
      ).rejects.toThrow()
    }

    // The highscore index query can see the migrated pbf row.
    const finished = await adapter.db
      .prepare(`SELECT winner FROM pbf WHERE active = 0 AND winner IS NOT NULL`)
      .first<{ winner: string }>()
    expect(finished?.winner).toBe('cash')
  })
})
