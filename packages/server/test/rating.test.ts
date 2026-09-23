import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createGame, joinGame } from '@civ/engine'

import { legacyRatedGame } from '../src/migrate/legacy-rating.js'
import { writeRatingBackfill } from '../src/migrate/rating-backfill.js'
import { JsonFileRepository } from '../src/store/json-file.js'
import { ratedHighscore, resultFromGame } from '../src/store/rating.js'
import { readMigrations } from './migrations.js'

const player = (username: string) => ({
  id: username, username, email: null, passwordHash: '', createdAt: '',
})

describe('legacy rating backfill', () => {
  it('imports the same game once when the generated SQL is rerun', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'civ-rating-'))
    const dump = join(directory, 'pbf.json')
    const sql = join(directory, 'rating.sql')
    const db = new DatabaseSync(':memory:')
    try {
      await writeFile(dump, JSON.stringify([{ _id: 'old-1', active: false, winner: 'Alice', players: [
        { username: 'Alice', playerId: 'a', items: [], techsChosen: [] },
        { username: 'Bob', playerId: 'b', items: [], techsChosen: [] },
      ] }]))
      expect(await writeRatingBackfill(dump, sql)).toBe(1)
      db.exec(readMigrations())
      const statement = await readFile(sql, 'utf8')
      db.exec(statement)
      db.exec(statement)
      expect(db.prepare(`SELECT COUNT(*) AS count FROM rated_result`).get()).toMatchObject({ count: 1 })
    } finally {
      db.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
  it('counts only reliably owned culture cards and printed coins', () => {
    const result = legacyRatedGame({
      _id: { $oid: '55227c5fe4b0acc8e3f26dad' }, active: false, winner: 'Alice',
      players: [
        { username: 'Alice', playerId: 'a', items: [], techsChosen: [] },
        { username: 'Bob', playerId: 'b', items: [{ cultureI: { ownerId: 'b', sheetName: 'CULTURE_1' } }],
          techsChosen: [{ tech: { name: 'Civil Service' } }, { tech: { name: 'Code of Laws' } }] },
        { username: 'Carol', playerId: 'c', items: [], techsChosen: [{ tech: { name: 'Pottery' } }] },
      ],
      discardedItems: [
        { cultureIII: { ownerId: 'b', sheetName: 'CULTURE_3' } },
        { cultureIII: { sheetName: 'CULTURE_3' } },
        { cultureII: { ownerId: 'a', sheetName: 'CULTURE_2' } },
      ],
    })
    expect(result?.participants).toEqual([
      { username: 'Alice', rank: 1 },
      { username: 'Bob', rank: 2 },
      { username: 'Carol', rank: 2 },
    ])
  })

  it('counts Adam Smith and printed tech coins but not possible Code of Laws or Pottery tokens', () => {
    const culture = (ownerId: string) => ({ cultureI: { ownerId, sheetName: 'CULTURE_1' } })
    const result = legacyRatedGame({ _id: 'coins', active: false, winner: 'Winner', discardedItems: [], players: [
      { username: 'Winner', playerId: 'w', items: [], techsChosen: [] },
      { username: 'Smith', playerId: 's', items: [culture('s'), { greatperson: { ownerId: 's', name: 'Adam Smith' } }], techsChosen: [{ tech: { name: 'Code of Laws' } }] },
      { username: 'Civil', playerId: 'c', items: [culture('c')], techsChosen: [{ tech: { name: 'Civil Service' } }] },
      { username: 'Pottery', playerId: 'p', items: [culture('p')], techsChosen: [{ tech: { name: 'Pottery' } }] },
    ] })
    expect(result?.participants).toEqual([
      { username: 'Winner', rank: 1 },
      { username: 'Smith', rank: 2 },
      { username: 'Civil', rank: 2 },
      { username: 'Pottery', rank: 4 },
    ])
  })

  it('preserves solo historical wins without a rating update', () => {
    const solo = legacyRatedGame({ _id: 'one', active: false, winner: 'Alice', players: [
      { username: 'Alice', playerId: 'a', items: [], techsChosen: [] },
    ] })
    expect(solo?.participants).toEqual([{ username: 'Alice', rank: 1 }])
    const score = ratedHighscore([{ numOfPlayers: 2, winner: 'Alice', players: [{ username: 'Alice', civName: null }] }], [player('Alice')], solo === null ? [] : [solo])
    expect(score.players.winners[0]?.totalWins).toBe(1)
    expect(score.ratings?.[0]?.games).toBe(0)
  })

  it('replays a tied multiplayer result deterministically without leaking source data', () => {
    const result = { id: 'pbf:one', sortKey: '2015', participants: [
      { username: 'Alice', rank: 1 }, { username: 'Bob', rank: 2 }, { username: 'Carol', rank: 2 },
    ] }
    const games = [{ numOfPlayers: 3, winner: 'Alice', players: ['Alice', 'Bob', 'Carol'].map((username) => ({ username, civName: null })) }]
    const players = ['Alice', 'Bob', 'Carol'].map(player)
    const first = ratedHighscore(games, players, [result])
    expect(ratedHighscore(games, players, [result])).toEqual(first)
    expect(first.ratings?.find((entry) => entry.username === 'Alice')?.rating).toBeGreaterThan(first.ratings?.find((entry) => entry.username === 'Bob')?.rating ?? 0)
  })

  it.each([2, 3, 4, 5])('rates a %i-player result', (count) => {
    const usernames = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve'].slice(0, count)
    const result = { id: `game:${count}`, sortKey: '2026', participants: usernames.map((username, index) => ({ username, rank: index + 1 })) }
    const games = [{ numOfPlayers: count, winner: 'Alice', players: usernames.map((username) => ({ username, civName: null })) }]
    const score = ratedHighscore(games, usernames.map(player), [result])
    expect(score.ratings).toHaveLength(count)
    expect(score.ratings?.every((entry) => entry.games === 1 && Number.isFinite(entry.rating) && entry.uncertainty > 0)).toBe(true)
  })
})

it('credits a discarded owned culture III card in a newly finished game', () => {
  const base = createGame({ name: 'Culture result', numOfPlayers: 3, seed: 'culture-result' })
  const alice = joinGame(base, { playerId: 'a', username: 'Alice', gameCreator: true })
  const bob = alice.ok ? joinGame(alice.value, { playerId: 'b', username: 'Bob' }) : undefined
  const carol = bob?.ok ? joinGame(bob.value, { playerId: 'c', username: 'Carol' }) : undefined
  if (carol === undefined || !carol.ok) throw new Error('fixture join failed')
  const third = carol.value.items.find((item) => item.kind === 'cultureIII')
  const first = carol.value.items.find((item) => item.kind === 'cultureI')
  if (third === undefined || first === undefined) throw new Error('culture cards missing')
  const game = {
    ...carol.value, active: false, winner: 'Alice',
    discardedItems: [{ ...third, ownerId: 'b' }],
    players: carol.value.players.map((player) => player.username === 'Carol'
      ? { ...player, items: [{ ...first, ownerId: 'c' }] }
      : player),
  }
  expect(resultFromGame(game)?.participants).toEqual([
    { username: 'Alice', rank: 1 },
    { username: 'Bob', rank: 2 },
    { username: 'Carol', rank: 3 },
  ])
})

it('does not cache an old JSON highscore after a concurrent game finish', async () => {
  const repo = new JsonFileRepository({ filePath: null })
  await repo.createPlayer(player('Alice'))
  await repo.createPlayer(player('Bob'))
  const base = createGame({ name: 'Concurrent rating', numOfPlayers: 2, seed: 'concurrent-rating' })
  const alice = joinGame(base, { playerId: 'a', username: 'Alice', gameCreator: true })
  const bob = alice.ok ? joinGame(alice.value, { playerId: 'b', username: 'Bob' }) : undefined
  if (bob === undefined || !bob.ok) throw new Error('fixture join failed')
  await repo.saveGame(bob.value)

  let release = (): void => undefined
  let captured = (): void => undefined
  const hold = new Promise<void>((resolve) => { release = resolve })
  const snapshotTaken = new Promise<void>((resolve) => { captured = resolve })
  const original = repo.finishedGamesForHighscore.bind(repo)
  vi.spyOn(repo, 'finishedGamesForHighscore').mockImplementationOnce(async () => {
    const old = await original()
    captured()
    await hold
    return old
  })

  const pending = repo.cachedHighscore()
  await snapshotTaken
  await repo.saveGame({ ...bob.value, active: false, winner: 'Alice' })
  release()
  expect((await pending).players.totalNumberOfGames).toBe(1)
  expect((await repo.cachedHighscore()).players.totalNumberOfGames).toBe(1)
  vi.restoreAllMocks()
})
