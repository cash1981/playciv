/** One-time SQL import for already migrated D1 databases. */
import { readFile, writeFile } from 'node:fs/promises'

import { legacyRatedGame } from './legacy-rating.js'
import type { DumpDoc } from './rows.js'
import { sqlValue } from './sql.js'

export async function writeRatingBackfill(dumpPath: string, outPath: string): Promise<number> {
  const parsed: unknown = JSON.parse(await readFile(dumpPath, 'utf8'))
  if (!Array.isArray(parsed)) throw new Error('Legacy pbf dump must be a JSON array')
  const results = parsed.map((doc) => legacyRatedGame(doc as DumpDoc)).filter((result) => result !== null)
  const lines = results.map((result) =>
    `INSERT INTO rated_result (id, sort_key, participants) VALUES (${sqlValue(result.id)}, ${sqlValue(result.sortKey)}, ${sqlValue(JSON.stringify(result.participants))}) ON CONFLICT(id) DO UPDATE SET sort_key=excluded.sort_key, participants=excluded.participants;\n`,
  )
  await writeFile(outPath, lines.join(''), 'utf8')
  return results.length
}

if (process.argv[1]?.endsWith('rating-backfill.ts')) {
  const dump = process.argv[2]
  const out = process.argv[3]
  if (dump === undefined || out === undefined) {
    console.error('Usage: pnpm migrate:rating <playciv.pbf.json> <rating.sql>')
    process.exitCode = 1
  } else {
    writeRatingBackfill(dump, out).then((count) => console.log(`Wrote ${count} results to ${out}`)).catch((error: unknown) => {
      console.error(error)
      process.exitCode = 1
    })
  }
}
