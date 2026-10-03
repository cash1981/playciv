/**
 * Both repositories behind one fixture, with a way to look at the stored rows
 * (kind, chain, size) that the `Repository` interface rightly does not offer.
 * D1 is read with SQL; the JSON store is flushed to a file and the file read,
 * which also exercises its on-disk format.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { GameState } from '@civ/engine'

import { createGameRevision, revisionSnapshot } from '../src/context.js'
import type { RevisionCodec } from '../src/revision-delta.js'
import { D1Repository } from '../src/store/d1.js'
import type { D1Database } from '../src/store/d1.js'
import { JsonFileRepository } from '../src/store/json-file.js'
import { utf8Length } from '../src/store/revision-chain.js'
import type { Repository } from '../src/store/types.js'
import { createD1Adapter } from './d1-sqlite-adapter.js'
import { readMigrations } from './migrations.js'
import type { RecordedGame } from './revision-fixtures.js'

export interface StoredRow {
  readonly revision: number
  readonly kind: string
  readonly baseRevision: number | null
  readonly sealed: boolean
  /** The size of the stored `state` text in bytes. */
  readonly bytes: number
}

export interface StoreFixture {
  readonly repo: Repository
  /** Raw SQL access; D1 only. */
  readonly db: D1Database | undefined
  rows(gameId: string): Promise<readonly StoredRow[]>
  close(): Promise<void>
}

export type StoreFactory = (options?: { codec?: RevisionCodec }) => Promise<StoreFixture>

export const storeImplementations: readonly [string, StoreFactory][] = [
  [
    'JsonFileRepository',
    async (options = {}) => {
      const directory = await mkdtemp(join(tmpdir(), 'civ-revisions-'))
      const filePath = join(directory, 'data.json')
      const repo = new JsonFileRepository({
        filePath,
        debounceMs: 60_000,
        ...(options.codec === undefined ? {} : { codec: options.codec }),
      })
      return {
        repo,
        db: undefined,
        async rows(gameId) {
          await repo.flush()
          const file = JSON.parse(await readFile(filePath, 'utf8')) as {
            revisions: {
              gameId: string
              revision: number
              kind?: string
              baseRevision?: number | null
              sealed?: boolean
              state: unknown
            }[]
          }
          return file.revisions
            .filter((row) => row.gameId === gameId)
            .sort((left, right) => left.revision - right.revision)
            .map((row) => ({
              revision: row.revision,
              kind: row.kind ?? 'full',
              baseRevision: row.baseRevision ?? null,
              sealed: row.sealed === true,
              bytes: utf8Length(JSON.stringify(row.state)),
            }))
        },
        async close() {
          await rm(directory, { recursive: true, force: true })
        },
      }
    },
  ],
  [
    'D1Repository',
    async (options = {}) => {
      const adapter = await createD1Adapter(readMigrations())
      const repo = new D1Repository(adapter.db, options.codec === undefined ? {} : { codec: options.codec })
      return {
        repo,
        db: adapter.db,
        async rows(gameId) {
          const result = await adapter.db
            .prepare(
              `SELECT revision, kind, base_revision, sealed, LENGTH(CAST(state AS BLOB)) AS bytes
               FROM game_revision WHERE game_id = ? ORDER BY revision`,
            )
            .bind(gameId)
            .all<{ revision: number; kind: string; base_revision: number | null; sealed: number; bytes: number }>()
          return result.results.map((row) => ({
            revision: row.revision,
            kind: row.kind,
            baseRevision: row.base_revision,
            sealed: row.sealed !== 0,
            bytes: row.bytes,
          }))
        },
        async close() {
          adapter.close()
        },
      }
    },
  ],
]

const ACTOR = { id: 'p1', username: 'Player1' }

/**
 * Writes a recorded game the way the routes do: the creation revision, then every
 * step through `saveGameWithRevision` with the state before the action as the
 * previous one, and private notes without a revision. Returns the revisions in
 * the order they were saved.
 */
export async function saveRecordedGame(
  repo: Repository,
  game: RecordedGame,
  options: { passPrevious?: boolean } = {},
): Promise<readonly { readonly revision: number; readonly state: GameState }[]> {
  const passPrevious = options.passPrevious ?? true
  const saved: { revision: number; state: GameState }[] = []
  const first = createGameRevision(undefined, game.start, ACTOR, '2026-10-01T00:00:00.000Z', 'Game created')
  if (!(await repo.saveGameWithRevision(game.start, first, null))) throw new Error('could not create the game')
  saved.push({ revision: first.revision, state: first.state })
  for (const step of game.steps) {
    if (step.revision === undefined) {
      if (!(await repo.saveGameIfRevision(step.after, step.before.rev, { notesOnly: true }))) {
        throw new Error(`could not save the note at rev ${step.before.rev}`)
      }
      continue
    }
    const ok = await repo.saveGameWithRevision(
      step.after,
      step.revision,
      step.before.rev,
      passPrevious ? revisionSnapshot(step.before) : undefined,
    )
    if (!ok) throw new Error(`could not save revision ${step.revision.revision}`)
    saved.push({ revision: step.revision.revision, state: step.revision.state })
  }
  return saved
}
