/**
 * CLI for the one-off MongoDB to D1 data migration.
 *
 * Usage (from `packages/server`):
 *
 *   pnpm --filter @civ/server migrate:d1
 *   pnpm --filter @civ/server migrate:d1 -- --dump "<dir>" --out dump.sql
 *
 * The dump directory defaults to `../../Civilization/database backup/mongo`
 * (gitignored). A missing directory or required collection exits non-zero and
 * leaves no output. Load the result after applying the schema:
 *
 *   wrangler d1 migrations apply playciv --remote
 *   wrangler d1 execute playciv --remote --file=packages/server/dump.sql
 *
 * The work lives in `migrate/run.ts` and is unit-tested there; this file only
 * parses arguments and reports the result.
 */

import { resolve } from 'node:path'

import { migrateDumpToSql } from './migrate/run.js'

function flagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv[index + 1]
}

try {
  const dumpDir = resolve(
    flagValue('--dump') ?? process.env['DUMP_DIR'] ?? '../../Civilization/database backup/mongo',
  )
  const out = resolve(flagValue('--out') ?? 'dump.sql')

  const result = await migrateDumpToSql({
    dumpDir,
    out,
    log: (message) => console.log(message),
  })

  console.log(`\nWrote ${result.out} (${(result.sizeBytes / 1024 / 1024).toFixed(1)} MB)`)
  console.log(
    'Rows: ' +
      Object.entries(result.rows)
        .map(([table, count]) => `${table}=${count}`)
        .join(', '),
  )
} catch (error) {
  console.error(`\nMigration failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
