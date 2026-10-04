/**
 * Migration 0006 (delta revisions, issue #238) on a database that already holds
 * revisions: every old row stays a valid keyframe, and the newest row of each
 * game is sealed, so the first revision written after the deploy is a keyframe.
 */

import { readFileSync, readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const directory = new URL('../../worker/migrations/', import.meta.url)
const files = readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()

const read = (name: string): string => readFileSync(new URL(name, directory), 'utf8')

describe('migration 0006', () => {
  it('keeps old rows as keyframes and seals the newest row of each game', async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(':memory:')
    const before = files.filter((name) => name < '0006')
    for (const name of before) db.exec(read(name))

    const insert = db.prepare(
      `INSERT INTO game_revision (game_id, revision, created_at, actor_id, actor_username,
         public_description, private_descriptions, log_ids, state) VALUES (?, ?, 't', 'a', 'A', 'd', '{}', '[]', '{}')`,
    )
    for (const [game, revision] of [['g1', 0], ['g1', 1], ['g1', 5], ['g2', 3], ['g3', 0], ['g3', 7]] as const) {
      insert.run(game, revision)
    }

    db.exec(read('0006_revision_delta.sql'))

    const rows = db
      .prepare('SELECT game_id, revision, kind, base_revision, sealed FROM game_revision ORDER BY game_id, revision')
      .all() as { game_id: string; revision: number; kind: string; base_revision: number | null; sealed: number }[]
    expect(rows.every((row) => row.kind === 'full' && row.base_revision === null)).toBe(true)
    expect(rows.filter((row) => row.sealed === 1).map((row) => `${row.game_id}:${row.revision}`)).toEqual([
      'g1:5',
      'g2:3',
      'g3:7',
    ])
    db.close()
  })
})
