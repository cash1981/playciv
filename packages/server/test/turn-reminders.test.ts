import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { GameState } from '@civ/engine'
import { activeTurnStatus } from '@civ/engine'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createGameRevision } from '../src/context.js'
import type { OutgoingEmail } from '../src/mail.js'
import { MailError } from '../src/mail.js'
import { D1Repository } from '../src/store/d1.js'
import { JsonFileRepository } from '../src/store/json-file.js'
import type { Repository } from '../src/store/types.js'
import { runDailyTurnReminders, TURN_REMINDER_WAIT_MS as WAIT } from '../src/turn-reminders.js'
import { createD1Adapter } from './d1-sqlite-adapter.js'
import type { D1Adapter } from './d1-sqlite-adapter.js'
import { readMigrations } from './migrations.js'
import { startGame } from './revision-fixtures.js'

const BASE = Date.parse('2026-10-01T00:00:00Z')
const due = new Date(BASE + WAIT + 1)

describe.each(['json', 'd1'] as const)('daily turn reminders: %s', (kind) => {
  let repo: Repository
  let adapter: D1Adapter | undefined
  let directory: string
  let file: string
  let game: GameState
  let holderId: string
  let mails: OutgoingEmail[]
  let clock: number

  const run = (now = due, enabled = true) => runDailyTurnReminders({
    repo, enabled, mailer: { send: async (mail) => { mails.push(mail) } },
    appOrigin: 'https://example.com/', sleep: async () => undefined,
  }, now)

  async function age(id = game.id, at: number | null = BASE) {
    if (adapter !== undefined) {
      await adapter.db.prepare('UPDATE game SET activity_at_ms = ? WHERE id = ?').bind(at, id).run()
    }
  }

  async function restart() {
    if (adapter !== undefined) repo = new D1Repository(adapter.db)
    else {
      await repo.flush()
      const restored = new JsonFileRepository({ filePath: file, now: () => new Date(clock) })
      await restored.load()
      repo = restored
    }
  }

  beforeEach(async () => {
    clock = BASE
    directory = await mkdtemp(join(tmpdir(), 'turn-reminders-'))
    file = join(directory, 'state.json')
    if (kind === 'd1') {
      adapter = await createD1Adapter(readMigrations())
      repo = new D1Repository(adapter.db)
    } else repo = new JsonFileRepository({ filePath: file, now: () => new Date(clock) })
    const started = startGame()
    game = { ...started, players: started.players.map((p) => ({ ...p, gamenote: 'PRIVATE_NOTE_SECRET' })),
      log: started.log.map((entry) => ({ ...entry, privateLog: 'PRIVATE_LOG_SECRET' })) }
    holderId = activeTurnStatus(game)?.playerId ?? ''
    expect(holderId).not.toBe('')
    for (const player of game.players) await repo.createPlayer({
      id: player.playerId, username: player.username, email: `${player.playerId}@example.com`,
      passwordHash: 'secret', createdAt: new Date(BASE).toISOString(),
    })
    await repo.saveGame(game)
    await age()
    mails = []
  })

  afterEach(async () => {
    await repo.flush()
    adapter?.close()
    adapter = undefined
    await rm(directory, { recursive: true, force: true })
  })

  it('requires strictly more than 72 hours, then sends once to the current holder', async () => {
    expect((await run(new Date(BASE + WAIT))).sent).toBe(0)
    expect((await run()).sent).toBe(1)
    expect(mails[0]?.to).toBe(`${holderId}@example.com`)
    expect(mails[0]?.text).toContain(`https://example.com/game/${game.id}`)
    expect(mails[0]?.text).toContain('/stop')
    expect((await run(new Date(BASE + WAIT * 2))).sent).toBe(0)
    expect(JSON.stringify(mails)).not.toContain('PRIVATE_NOTE_SECRET')
    expect(JSON.stringify(mails)).not.toContain('PRIVATE_LOG_SECRET')
    expect(JSON.stringify(mails)).not.toContain('secret')
  })

  it('keeps duplicate prevention across a repository restart and overlapping jobs', async () => {
    const results = await Promise.all([run(), run(), run()])
    expect(results.reduce((sum, result) => sum + result.sent, 0)).toBe(1)
    await restart()
    expect((await run()).sent).toBe(0)
  })

  it('does not count opening the game as activity or apply game-open mail holds', async () => {
    await repo.recordGameOpened(game.id, holderId, due)
    expect(await repo.claimGameEmail(game.id, holderId, WAIT, due)).toBe(true)
    expect((await run()).sent).toBe(1)
  })

  it.each([
    { disabled: true }, { disableEmail: true }, { email: null }, { email: '   ' },
  ])('skips account preference %j without consuming the reminder', async (changes) => {
    await repo.updatePlayer(holderId, changes)
    expect((await run()).claimed).toBe(0)
    await repo.updatePlayer(holderId, { disabled: false, disableEmail: false, email: 'restored@example.com' })
    expect((await run()).sent).toBe(1)
  })

  it('does not claim or send to an address changed after the account was read', async () => {
    const originalRead = repo.findPlayerById.bind(repo)
    const read = vi.spyOn(repo, 'findPlayerById').mockImplementationOnce(async (id) => {
      const stale = await originalRead(id)
      await repo.updatePlayer(id, { email: 'new-address@example.com' })
      return stale
    })
    expect(await run()).toEqual({ checked: 1, claimed: 0, sent: 0, failed: 0 })
    expect(mails).toHaveLength(0)
    read.mockRestore()
    expect((await run()).sent).toBe(1)
    expect(mails[0]?.to).toBe('new-address@example.com')
  })

  it('does not consume attempts when email configuration is missing', async () => {
    const scan = vi.spyOn(repo, 'idleTurnCandidates')
    expect((await run(due, false)).claimed).toBe(0)
    expect(scan).not.toHaveBeenCalled()
    expect((await run()).sent).toBe(1)
  })

  it('never mails finished games, lobby games or games without an active holder', async () => {
    await repo.saveGame({ ...game, active: false })
    await age()
    expect((await run()).sent).toBe(0)
    await repo.saveGame({ ...game, players: game.players.map((p) => ({ ...p, yourTurn: false })) })
    await age()
    expect((await run()).sent).toBe(0)
    await repo.saveGame({ ...game, players: [], withdrawnPlayers: game.players })
    await age()
    expect((await run()).sent).toBe(0)
  })

  it('starts legacy games at first observation instead of guessing from old logs', async () => {
    if (adapter !== undefined) await age(game.id, null)
    else {
      await repo.flush()
      const snapshot = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
      delete snapshot['activity']
      await writeFile(file, JSON.stringify(snapshot))
      const restored = new JsonFileRepository({ filePath: file, now: () => new Date(clock) })
      await restored.load()
      repo = restored
    }
    expect((await run()).sent).toBe(0)
    await restart()
    expect((await run(new Date(due.getTime() + WAIT))).sent).toBe(0)
    expect((await run(new Date(due.getTime() + WAIT + 1))).sent).toBe(1)
  })

  it('guards a stale candidate against live actions and changed preferences', async () => {
    const candidates = await repo.idleTurnCandidates(due, WAIT, 10)
    const candidate = candidates[0]
    expect(candidate).toBeDefined()
    if (candidate === undefined) return
    await repo.updatePlayer(holderId, { disableEmail: true })
    expect(await repo.claimTurnReminder(candidate, holderId, `${holderId}@example.com`, due, WAIT)).toBe(false)
    await repo.updatePlayer(holderId, { disableEmail: false })
    await repo.saveGameIfRevision({ ...game, rev: game.rev + 1 }, game.rev, { notesOnly: true })
    expect(await repo.claimTurnReminder(candidate, holderId, `${holderId}@example.com`, due, WAIT)).toBe(false)
  })

  it('resets for nonrevisioned and revisioned actions but not a rejected compare-and-set', async () => {
    expect((await run()).sent).toBe(1)
    clock = due.getTime()
    const changed = { ...game, rev: game.rev + 1 }
    expect(await repo.saveGameIfRevision(changed, game.rev + 99)).toBe(false)
    expect((await run()).sent).toBe(0)
    expect(await repo.saveGameIfRevision(changed, game.rev, { notesOnly: true })).toBe(true)
    if (adapter !== undefined) await age(game.id, clock)
    expect((await run()).sent).toBe(0)
    expect((await run(new Date(clock + WAIT + 1))).sent).toBe(1)
    clock += WAIT + 1
    const next = { ...changed, rev: changed.rev + 1 }
    const revision = createGameRevision(changed, next, { id: holderId, username: 'Player' }, new Date(clock).toISOString(), 'Action')
    expect(await repo.saveGameWithRevision(next, revision, changed.rev)).toBe(true)
    if (adapter !== undefined) await age(game.id, clock)
    expect((await run(new Date(clock + WAIT))).sent).toBe(0)
    expect((await run(new Date(clock + WAIT + 1))).sent).toBe(1)
  })

  it('bounds each scan and advances past ineligible accounts without starvation', async () => {
    await repo.updatePlayer(holderId, { disabled: true })
    for (let index = 0; index < 12; index++) {
      const copy = { ...game, id: `copy${String(index).padStart(2, '0')}` }
      await repo.saveGame(copy)
      await age(copy.id)
    }
    const first = await repo.idleTurnCandidates(due, WAIT, 10)
    expect(first).toHaveLength(10)
    const second = await repo.idleTurnCandidates(new Date(due.getTime() + 1), WAIT, 10)
    expect(second.some((candidate) => !first.some((earlier) => earlier.gameId === candidate.gameId))).toBe(true)
  })

  it('retries definite provider rejection but stops the run on quota failures', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const send = vi.fn(async () => { throw new MailError('Quota', 429, 'Quota') })
    const copy = { ...game, id: 'another-game' }
    await repo.saveGame(copy)
    await age(copy.id)
    const result = await runDailyTurnReminders({ repo, enabled: true, mailer: { send } }, due)
    expect(result.failed).toBe(1)
    expect(send).toHaveBeenCalledTimes(1)
    await restart()
    expect((await run()).sent).toBe(2)
    error.mockRestore()
  })

  it('releasing a stale rejected attempt never undoes a newer state claim', async () => {
    const [old] = await repo.idleTurnCandidates(due, WAIT, 10)
    expect(old).toBeDefined()
    if (old === undefined) return
    expect(await repo.claimTurnReminder(old, holderId, `${holderId}@example.com`, due, WAIT)).toBe(true)
    clock = due.getTime()
    await repo.saveGame({ ...game, rev: game.rev + 1 })
    await age(game.id, clock)
    const later = new Date(clock + WAIT + 1)
    const [next] = await repo.idleTurnCandidates(later, WAIT, 10)
    expect(next).toBeDefined()
    if (next === undefined) return
    expect(await repo.claimTurnReminder(next, holderId, `${holderId}@example.com`, later, WAIT)).toBe(true)
    await repo.releaseTurnReminder(old)
    expect(await repo.claimTurnReminder(next, holderId, `${holderId}@example.com`, later, WAIT)).toBe(false)
  })

  it('retains an attempted claim when a provider failure could have delivered the email', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await runDailyTurnReminders({
      repo, enabled: true, mailer: { send: async () => { throw new Error('Timeout') } },
    }, due)
    expect(result).toEqual({ checked: 1, claimed: 1, sent: 0, failed: 1 })
    await restart()
    expect((await run()).sent).toBe(0)
    error.mockRestore()
  })
})
