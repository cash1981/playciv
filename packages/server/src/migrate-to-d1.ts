/**
 * One-off migration: read the restored `playciv` mongodump JSON export and
 * write a `dump.sql` that loads into Cloudflare D1.
 *
 * Usage (from `packages/server`):
 *
 *   pnpm --filter @civ/server migrate:d1
 *   pnpm --filter @civ/server migrate:d1 -- --dump "<dir>" --out dump.sql
 *
 * The dump directory defaults to `../../Civilization/database backup/mongo`
 * (gitignored). Load the result after applying the schema:
 *
 *   wrangler d1 migrations apply playciv --remote
 *   wrangler d1 execute playciv --remote --file=packages/server/dump.sql
 *
 * This script reads files and writes SQL; it never touches a database. The
 * mapping itself lives in `migrate/rows.ts` and is unit-tested there. Each SQL
 * statement must stay under D1's ~100 KB limit; large `pbf` documents are
 * chunked (see `pbfDocChunks`) for exactly that reason.
 */

import { appendFile, readFile, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { DumpDoc } from './migrate/rows.js'
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
} from './migrate/rows.js'
import { insertStatement } from './migrate/sql.js'

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

function flagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv[index + 1]
}

async function readCollection(dumpDir: string, name: string): Promise<DumpDoc[] | undefined> {
  const path = resolve(dumpDir, `playciv.${name}.json`)
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

async function main(): Promise<void> {
  const dumpDir = resolve(
    flagValue('--dump') ?? process.env['DUMP_DIR'] ?? '../../Civilization/database backup/mongo',
  )
  const out = resolve(flagValue('--out') ?? 'dump.sql')

  console.log(`Reading ${dumpDir}`)
  await writeFile(out, '')

  const counts = new Map<string, number>(TABLES.map((table) => [table, 0]))
  for (const collection of COLLECTIONS) {
    const docs = await readCollection(dumpDir, collection.name)
    if (docs === undefined) {
      console.log(`  ${collection.name.padEnd(14)} (absent)`)
      continue
    }

    let parts: string[] = []
    const flush = async (): Promise<void> => {
      if (parts.length === 0) return
      await appendFile(out, parts.join(''))
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
    console.log(`  ${collection.name.padEnd(14)} ${docs.length} docs`)
  }

  const size = (await stat(out)).size
  console.log(`\nWrote ${out} (${(size / 1024 / 1024).toFixed(1)} MB)`)
  console.log('Rows: ' + TABLES.map((table) => `${table}=${counts.get(table) ?? 0}`).join(', '))
}

await main()
