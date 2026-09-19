/**
 * The migration CLI core. These cover the failure modes a wrong `--dump` would
 * otherwise turn into a silent, empty dump.
 */

import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { migrateDumpToSql } from '../src/migrate/run.js'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'civ-migrate-'))
  dirs.push(dir)
  return dir
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function writeDump(dir: string, name: string, docs: readonly unknown[]): Promise<void> {
  await writeFile(join(dir, `playciv.${name}.json`), JSON.stringify(docs), 'utf8')
}

const OID = '55223c74e4b00485f8dd926e'

async function writeMinimalDump(dir: string): Promise<void> {
  await writeDump(dir, 'player', [
    { _id: { $oid: OID }, username: 'Åse', password: 'hash', role: 'user', disabled: false },
  ])
  await writeDump(dir, 'pbf', [
    {
      _id: { $oid: '55227c5fe4b0acc8e3f26dad' },
      numOfPlayers: 2,
      active: false,
      winner: 'Åse',
      players: [{ username: 'Åse', civilization: { name: 'Greeks' } }],
    },
  ])
}

describe('migrateDumpToSql', () => {
  it('refuses a missing dump directory and leaves the output untouched', async () => {
    const dir = await tempDir()
    const out = join(dir, 'dump.sql')
    await writeFile(out, 'PREVIOUS', 'utf8')

    await expect(
      migrateDumpToSql({ dumpDir: join(dir, 'does-not-exist'), out }),
    ).rejects.toThrow(/Dump directory not found/)
    expect(await readFile(out, 'utf8')).toBe('PREVIOUS')
    expect(await exists(`${out}.tmp`)).toBe(false)
  })

  it('refuses a directory without the required collections', async () => {
    const dir = await tempDir()
    const out = join(dir, 'dump.sql')
    // Only `player` exists; `pbf` is required.
    await writeDump(dir, 'player', [{ _id: { $oid: OID }, username: 'cash' }])

    await expect(migrateDumpToSql({ dumpDir: dir, out })).rejects.toThrow(
      /Missing required collection file/,
    )
    expect(await exists(out)).toBe(false)
    expect(await exists(`${out}.tmp`)).toBe(false)
  })

  it('maps a valid dump to SQL and folds usernames in JavaScript', async () => {
    const dir = await tempDir()
    const out = join(dir, 'dump.sql')
    await writeMinimalDump(dir)

    const result = await migrateDumpToSql({ dumpDir: dir, out })

    expect(result.rows['player']).toBe(1)
    expect(result.rows['pbf']).toBe(1)
    expect(result.rows['pbf_doc']).toBeGreaterThanOrEqual(1)

    const sql = await readFile(out, 'utf8')
    expect(sql).toContain(`INSERT INTO player`)
    expect(sql).toContain(`'Åse'`)
    expect(sql).toContain(`'åse'`)
    // The old, deliberately dropped collections are never emitted.
    expect(sql).not.toContain('INSERT INTO chat')
    expect(sql).not.toContain('INSERT INTO gamelog')
    expect(sql).not.toContain('INSERT INTO tournament')
    expect(await exists(`${out}.tmp`)).toBe(false)
  })
})
