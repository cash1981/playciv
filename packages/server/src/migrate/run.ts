/**
 * The migration core: read a `playciv` mongodump JSON directory and write a
 * `dump.sql`. Kept out of `migrate-to-d1.ts` so it can be tested directly with
 * temporary directories instead of spawning a process.
 *
 * A missing dump directory or a missing required collection throws before the
 * output is touched, and the output is only moved into place on success, so a
 * typo can never leave an empty dump behind.
 */

import { appendFile, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { DumpDoc } from './rows.js'
import {
  chatRow,
  emailSentRow,
  gameRow,
  gamelogRow,
  pbfDocChunks,
  pbfRow,
  playerRow,
  revisionRow,
  tournamentRow,
} from './rows.js'
import { insertStatement } from './sql.js'

/** One row to insert, tagged with its table. */
interface Insert {
  readonly table: string
  readonly row: object
}

/** Most collections map one document to one row. */
function one(table: string, row: object): readonly Insert[] {
  return [{ table, row }]
}

interface Collection {
  /** File suffix: `playciv.<name>.json`. */
  readonly name: string
  readonly map: (doc: DumpDoc) => readonly Insert[]
}

const COLLECTIONS: readonly Collection[] = [
  { name: 'player', map: (doc) => one('player', playerRow(doc)) },
  { name: 'game_state', map: (doc) => one('game', gameRow(doc)) },
  { name: 'game_revision', map: (doc) => one('game_revision', revisionRow(doc)) },
  { name: 'chat', map: (doc) => one('chat', chatRow(doc)) },
  { name: 'email_sent', map: (doc) => one('email_sent', emailSentRow(doc)) },
  {
    name: 'pbf',
    map: (doc) => [
      { table: 'pbf', row: pbfRow(doc) },
      ...pbfDocChunks(doc).map((row) => ({ table: 'pbf_doc', row })),
    ],
  },
  { name: 'gamelog', map: (doc) => one('gamelog', gamelogRow(doc)) },
  { name: 'tournament', map: (doc) => one('tournament', tournamentRow(doc)) },
]

/**
 * Without these there is nothing meaningful to migrate. The new collections
 * (`game_state`, `game_revision`, `email_sent`) may legitimately be absent from
 * an old export, and `gamelog`/`tournament` are archival, so those stay
 * optional.
 */
export const REQUIRED_COLLECTIONS = ['player', 'pbf', 'chat'] as const

const TABLES = [
  'player',
  'game',
  'game_revision',
  'chat',
  'email_sent',
  'pbf',
  'pbf_doc',
  'gamelog',
  'tournament',
] as const

const STATEMENTS_PER_FLUSH = 5000

function collectionPath(dumpDir: string, name: string): string {
  return resolve(dumpDir, `playciv.${name}.json`)
}

export interface MigrationOptions {
  readonly dumpDir: string
  readonly out: string
  /** Progress lines; defaults to silence, so tests stay quiet. */
  readonly log?: (message: string) => void
}

export interface MigrationResult {
  readonly out: string
  readonly sizeBytes: number
  readonly rows: Readonly<Record<string, number>>
}

async function assertDumpDirectory(dumpDir: string): Promise<void> {
  let info
  try {
    info = await stat(dumpDir)
  } catch {
    throw new Error(`Dump directory not found: ${dumpDir}`)
  }
  if (!info.isDirectory()) {
    throw new Error(`Dump path is not a directory: ${dumpDir}`)
  }
}

async function assertRequiredCollections(dumpDir: string): Promise<void> {
  for (const name of REQUIRED_COLLECTIONS) {
    const path = collectionPath(dumpDir, name)
    try {
      await stat(path)
    } catch {
      throw new Error(`Missing required collection file: ${path}`)
    }
  }
}

async function readCollection(dumpDir: string, name: string): Promise<DumpDoc[] | undefined> {
  const path = collectionPath(dumpDir, name)
  try {
    await stat(path)
  } catch {
    return undefined
  }
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!Array.isArray(parsed)) {
    throw new Error(`${path} is not a JSON array of documents`)
  }
  return parsed as DumpDoc[]
}

export async function migrateDumpToSql(options: MigrationOptions): Promise<MigrationResult> {
  const log = options.log ?? ((): void => undefined)
  const { dumpDir, out } = options

  // Fail before touching `out`: a typo in the dump path must not leave an
  // empty dump. The output is written to a sibling temporary file and renamed
  // into place only once every collection has been mapped.
  await assertDumpDirectory(dumpDir)
  await assertRequiredCollections(dumpDir)

  const temporary = `${out}.tmp`
  log(`Reading ${dumpDir}`)
  await writeFile(temporary, '')

  const counts = new Map<string, number>(TABLES.map((table) => [table, 0]))
  try {
    for (const collection of COLLECTIONS) {
      const docs = await readCollection(dumpDir, collection.name)
      if (docs === undefined) {
        log(`  ${collection.name.padEnd(14)} (absent)`)
        continue
      }

      let parts: string[] = []
      const flush = async (): Promise<void> => {
        if (parts.length === 0) return
        await appendFile(temporary, parts.join(''))
        parts = []
      }
      for (const doc of docs) {
        for (const insert of collection.map(doc)) {
          parts.push(insertStatement(insert.table, insert.row))
          counts.set(insert.table, (counts.get(insert.table) ?? 0) + 1)
        }
        if (parts.length >= STATEMENTS_PER_FLUSH) await flush()
      }
      await flush()
      log(`  ${collection.name.padEnd(14)} ${docs.length} docs`)
    }

    const total = [...counts.values()].reduce((sum, count) => sum + count, 0)
    if (total === 0) {
      throw new Error(`No rows were mapped from ${dumpDir}; refusing to write an empty dump`)
    }

    await rename(temporary, out)
    return { out, sizeBytes: (await stat(out)).size, rows: Object.fromEntries(counts) }
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}
