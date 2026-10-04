/**
 * The single chat migration (`docs/agents/tasks/single-chat.md`): the admin routes
 * that move the old Turn orders panel data of a game into the timeline (public
 * order versions) and into its owners' private notes (unpublished drafts). New in
 * the port; the rules are in `docs/agents/decisions.md`.
 */

import { appendLog, toPlayerView } from '@civ/engine'
import type { GameState } from '@civ/engine'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { App } from '../src/app.js'
import { createTestApp } from '../src/app.js'
import { copyLegacyOrders } from '../src/legacy-orders.js'
import type { Mailer, OutgoingEmail } from '../src/mail.js'
import { D1Repository } from '../src/store/d1.js'
import type { JsonFileRepository } from '../src/store/json-file.js'
import type { ChatMessage } from '../src/store/types.js'
import { createD1Adapter } from './d1-sqlite-adapter.js'
import { bearer, inject } from './helpers.js'
import { readMigrations } from './migrations.js'
import { savedOrder } from './saved-orders.js'

class FakeMailer implements Mailer {
  readonly sent: OutgoingEmail[] = []
  async send(email: OutgoingEmail): Promise<void> {
    this.sent.push(email)
  }
}

let app: App
let repo: JsonFileRepository
let mailer: FakeMailer

beforeEach(async () => {
  mailer = new FakeMailer()
  const created = await createTestApp({ mailer })
  app = created.app
  repo = created.repo
})

const post = (token: string, url: string, payload: unknown = {}) =>
  inject(app, { method: 'POST', url, headers: bearer(token), payload })

async function register(username: string): Promise<{ token: string; id: string }> {
  const response = await inject(app, {
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hemmelig', email: `${username}@example.com`, securityAnswer: 'writing' },
  })
  expect(response.status).toBe(201)
  const body = (await response.json()) as { token: string; player: { id: string } }
  return { token: body.token, id: body.player.id }
}

interface Table {
  readonly gameId: string
  readonly admin: string
  readonly players: readonly { readonly id: string; readonly username: string; readonly token: string }[]
}

async function twoPlayerGame(name: string): Promise<Table> {
  const a = await register(`${name}-a`)
  const gameId = (await (await post(a.token, '/api/games', { name, numOfPlayers: 2 })).json() as { id: string }).id
  const b = await register(`${name}-b`)
  expect((await post(b.token, `/api/games/${gameId}/join`)).status).toBe(200)
  const admin = await register(`${name}-admin`)
  await repo.updatePlayer(admin.id, { role: 'admin' })
  const game = await loadGame(gameId)
  const players = [a, b].map((account) => {
    const hand = game.players.find((player) => player.playerId === account.id)
    if (hand === undefined) throw new Error('player missing')
    return { id: account.id, username: hand.username, token: account.token }
  })
  return { gameId, admin: admin.token, players }
}

async function loadGame(gameId: string): Promise<GameState> {
  const game = await repo.findGame(gameId)
  if (game === undefined) throw new Error(`no game ${gameId}`)
  return game
}

/**
 * Writes drafts and published orders as the old Turn orders panel stored them, with
 * times of our choosing, and saves the game as the old code left it: orders not yet
 * copied to the timeline.
 */
async function classicOrders(
  gameId: string,
  orders: readonly { playerId: string; turn: number; phase: 'SOT' | 'TRADE' | 'CM' | 'MOVEMENT' | 'RESEARCH'; text: string; at?: string }[],
): Promise<void> {
  let state = await loadGame(gameId)
  for (const order of orders) {
    state = savedOrder(state, order.playerId, order.turn, order.phase, order.text, order.at)
  }
  await repo.saveGame({ ...state, legacyOrdersCopied: false })
}

const URL = '/api/admin/games/migrate-chat'

/** The real run: every game, or the named one. */
const migrate = (table: Table, gameId?: string) =>
  post(table.admin, URL, gameId === undefined ? {} : { gameId })

const dryRun = (table: Table) => inject(app, { method: 'GET', url: URL, headers: bearer(table.admin) })

const timeline = async (table: Table, extra = '') =>
  (await inject(app, { method: 'GET', url: `/api/games/${table.gameId}/chat${extra}`, headers: bearer(table.players[0]?.token ?? '') }))
    .json<{ messages: ChatMessage[]; hasMore: boolean }>()

const orderRows = async (gameId: string): Promise<readonly ChatMessage[]> =>
  (await repo.chatFor(gameId)).filter((row) => row.kind === 'order')

const noteOf = async (gameId: string, playerId: string): Promise<string | null | undefined> =>
  (await loadGame(gameId)).players.find((player) => player.playerId === playerId)?.gamenote

describe('the migrate-chat route', () => {
  it('writes one order row per revealed version, dated when it was revealed, oldest first', async () => {
    const table = await twoPlayerGame('copy')
    const [one, two] = table.players
    if (one === undefined || two === undefined) throw new Error('no players')
    await classicOrders(table.gameId, [
      { playerId: two.id, turn: 1, phase: 'TRADE', text: 'two trade', at: '2026-01-01T10:00:00.000Z' },
      { playerId: one.id, turn: 1, phase: 'SOT', text: 'one first', at: '2026-01-01T09:00:00.000Z' },
      // Edited and revealed again: both versions are in the history
      { playerId: one.id, turn: 1, phase: 'SOT', text: 'one second', at: '2026-01-01T11:00:00.000Z' },
      { playerId: one.id, turn: 2, phase: 'CM', text: 'one turn two', at: '2026-01-02T09:00:00.000Z' },
    ])
    const before = await loadGame(table.gameId)

    const response = await migrate(table)

    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({
      games: [{ id: table.gameId, orderRows: 4, drafts: 0 }],
      totalOrderRows: 4,
      skipped: 0,
      partial: null,
      remaining: 0,
    })
    const rows = await orderRows(table.gameId)
    expect(rows.map((row) => [row.username, row.turnNumber, row.phase, row.message, row.createdAt])).toEqual([
      [one.username, 1, 'SOT', 'one first', '2026-01-01T09:00:00.000Z'],
      [two.username, 1, 'TRADE', 'two trade', '2026-01-01T10:00:00.000Z'],
      [one.username, 1, 'SOT', 'one second', '2026-01-01T11:00:00.000Z'],
      [one.username, 2, 'CM', 'one turn two', '2026-01-02T09:00:00.000Z'],
    ])
    expect(rows.every((row) => row.kind === 'order' && row.gameId === table.gameId)).toBe(true)
    expect(rows[0]?.id).toBe(`legacy-${table.gameId}-1-${one.username}-SOT-0`)
    expect(rows[2]?.id).toBe(`legacy-${table.gameId}-1-${one.username}-SOT-1`)
    const after = await loadGame(table.gameId)
    expect(after.legacyOrdersCopied).toBe(true)
    // A guarded save: the revision moved on by one, and nothing else about the game changed
    expect(after.rev).toBe(before.rev + 1)
    expect(after.publicTurns).toEqual(before.publicTurns)
  })

  it('copies only public order versions: an unrevealed draft and a private note are not in the rows', async () => {
    const table = await twoPlayerGame('leak')
    const [one, two] = table.players
    if (one === undefined || two === undefined) throw new Error('no players')
    await classicOrders(table.gameId, [
      { playerId: one.id, turn: 1, phase: 'SOT', text: 'public order', at: '2026-01-01T09:00:00.000Z' },
      { playerId: one.id, turn: 1, phase: 'TRADE', text: 'SECRET-DRAFT' },
      // Edited after the reveal and not revealed again
      { playerId: one.id, turn: 1, phase: 'SOT', text: 'SECRET-EDIT' },
    ])
    expect((await post(one.token, `/api/games/${table.gameId}/note`, { note: 'SECRET-NOTE' })).status).toBe(200)

    expect((await migrate(table)).status).toBe(200)

    const rows = await repo.chatFor(table.gameId)
    expect(rows.map((row) => row.message)).toEqual(['public order'])
    expect(JSON.stringify(rows)).not.toContain('SECRET')
    expect(JSON.stringify(await timeline(table))).not.toContain('SECRET')
    // The other player sees none of it in their view of the game either
    const state = await loadGame(table.gameId)
    expect(JSON.stringify(toPlayerView(state, two.id))).not.toContain('SECRET')
    const seen = await inject(app, { method: 'GET', url: `/api/games/${table.gameId}`, headers: bearer(two.token) })
    expect(seen.body).not.toContain('SECRET')
  })

  it('moves an unpublished draft into its owner\'s private note, after the note that was there', async () => {
    const table = await twoPlayerGame('drafts')
    const [one, two] = table.players
    if (one === undefined || two === undefined) throw new Error('no players')
    await classicOrders(table.gameId, [
      { playerId: one.id, turn: 1, phase: 'SOT', text: 'public order', at: '2026-01-01T09:00:00.000Z' },
      { playerId: one.id, turn: 2, phase: 'TRADE', text: 'DRAFT-ONE' },
      { playerId: two.id, turn: 1, phase: 'CM', text: '   ' },
    ])
    expect((await post(one.token, `/api/games/${table.gameId}/note`, { note: 'my note' })).status).toBe(200)

    const response = await migrate(table)

    expect(JSON.parse(response.body)).toMatchObject({ games: [{ id: table.gameId, orderRows: 1, drafts: 1 }], totalDrafts: 1 })
    // After the note that was there, a revealed order is not copied into it, and a blank draft adds nothing
    expect(await noteOf(table.gameId, one.id)).toBe('my note\n\n### Turn 2, trade (unpublished draft)\n\nDRAFT-ONE')
    expect(await noteOf(table.gameId, two.id)).toBeNull()
    // The owner sees it as their private note, the other player does not see it anywhere
    const own = await inject(app, { method: 'GET', url: `/api/games/${table.gameId}`, headers: bearer(one.token) })
    expect(own.body).toContain('DRAFT-ONE')
    const other = await inject(app, { method: 'GET', url: `/api/games/${table.gameId}`, headers: bearer(two.token) })
    expect(other.body).not.toContain('DRAFT-ONE')
    expect(JSON.stringify(await repo.chatFor(table.gameId))).not.toContain('DRAFT-ONE')
    // Nothing public changed
    expect(JSON.stringify((await loadGame(table.gameId)).publicTurns)).not.toContain('DRAFT-ONE')
  })

  it('running it twice writes nothing the second time', async () => {
    const table = await twoPlayerGame('twice')
    const one = table.players[0]
    if (one === undefined) throw new Error('no player')
    await classicOrders(table.gameId, [
      { playerId: one.id, turn: 1, phase: 'SOT', text: 'once', at: '2026-01-01T09:00:00.000Z' },
      { playerId: one.id, turn: 1, phase: 'TRADE', text: 'a draft' },
    ])
    await migrate(table)
    const rows = (await repo.chatFor(table.gameId)).length
    const state = await loadGame(table.gameId)
    const writes = vi.spyOn(repo, 'saveGameIfRevision')
    const appended = vi.spyOn(repo, 'appendChat')

    const second = await migrate(table)

    expect(JSON.parse(second.body)).toMatchObject({ games: [], totalOrderRows: 0, totalDrafts: 0, remaining: 0 })
    expect(writes).not.toHaveBeenCalled()
    expect(appended).not.toHaveBeenCalled()
    expect((await repo.chatFor(table.gameId)).length).toBe(rows)
    expect(await loadGame(table.gameId)).toEqual(state)
    // The dry run has nothing left to list either
    expect(JSON.parse((await dryRun(table)).body)).toMatchObject({ games: [] })
  })

  it('migrates a finished game too', async () => {
    const table = await twoPlayerGame('finished')
    const one = table.players[0]
    if (one === undefined) throw new Error('no player')
    expect((await post(table.admin, `/api/games/${table.gameId}/end`, { winner: one.username })).status).toBe(200)
    await classicOrders(table.gameId, [{ playerId: one.id, turn: 1, phase: 'SOT', text: 'last orders', at: '2026-01-01T09:00:00.000Z' }])
    expect((await loadGame(table.gameId)).active).toBe(false)

    const response = await migrate(table)

    expect(JSON.parse(response.body)).toMatchObject({ games: [{ id: table.gameId, orderRows: 1 }] })
    expect((await orderRows(table.gameId)).map((row) => row.message)).toEqual(['last orders'])
    const after = await loadGame(table.gameId)
    expect(after.legacyOrdersCopied).toBe(true)
    expect(after.active).toBe(false)
    expect(after.winner).toBe(one.username)
  })

  it('sends no mail', async () => {
    const table = await twoPlayerGame('quiet')
    const one = table.players[0]
    if (one === undefined) throw new Error('no player')
    await classicOrders(table.gameId, [{ playerId: one.id, turn: 1, phase: 'SOT', text: 'order', at: '2026-01-01T09:00:00.000Z' }])
    mailer.sent.length = 0

    await migrate(table)

    expect((await orderRows(table.gameId)).length).toBe(1)
    expect(mailer.sent).toEqual([])
  })

  /**
   * An order revealed before versions were kept, as an imported game holds it: the
   * public turn has the text and is revealed, the history is empty. `logAt` adds the
   * reveal's own log line with that time.
   */
  async function bareReveal(
    table: Table,
    playerIndex: number,
    turn: number,
    phase: 'SOT' | 'TRADE' | 'CM' | 'MOVEMENT' | 'RESEARCH',
    text: string,
    logAt?: string,
  ): Promise<void> {
    const player = table.players[playerIndex]
    if (player === undefined) throw new Error('no player')
    let state = savedOrder(await loadGame(table.gameId), player.id, turn, phase, text, '2026-01-01T00:00:00.000Z')
    const erase = <T extends { readonly history: Record<string, readonly unknown[]> }>(value: T): T => ({
      ...value,
      history: { ...value.history, [phase]: [] },
    })
    state = {
      ...state,
      players: state.players.map((hand) => ({ ...hand, playerTurns: hand.playerTurns.map(erase) })),
      publicTurns: Object.fromEntries(Object.entries(state.publicTurns).map(([key, value]) => [key, erase(value)])),
    }
    if (logAt !== undefined) {
      const label = { SOT: 'start of turn', TRADE: 'trade', CM: 'city management', MOVEMENT: 'movement', RESEARCH: 'research' }[phase]
      const line = `Turn ${turn} - ${player.username} revealed ${label} phase`
      state = appendLog(state, { username: player.username, playerId: player.id, logType: 'REVEAL', privateLog: line, publicLog: line, createdAt: logAt })
    }
    await repo.saveGame({ ...state, legacyOrdersCopied: false })
  }

  it('copies an order revealed before versions were kept, dated from the reveal log line, and not twice', async () => {
    const table = await twoPlayerGame('old-save')
    const [one, two] = table.players
    if (one === undefined || two === undefined) throw new Error('no players')
    await bareReveal(table, 0, 3, 'CM', 'old city management', '2026-02-03T08:30:00.000Z')
    // A draft of the other player in the same game: never revealed, so never a row
    await classicOrders(table.gameId, [{ playerId: two.id, turn: 3, phase: 'TRADE', text: 'SECRET-DRAFT' }])
    const before = await loadGame(table.gameId)
    expect(JSON.parse((await dryRun(table)).body)).toMatchObject({ games: [{ id: table.gameId, orderRows: 1, drafts: 1 }], totalOrderRows: 1 })

    const response = await migrate(table)

    expect(JSON.parse(response.body)).toMatchObject({ games: [{ id: table.gameId, orderRows: 1, drafts: 1 }], totalOrderRows: 1 })
    const rows = await orderRows(table.gameId)
    expect(rows.map((row) => [row.username, row.turnNumber, row.phase, row.message, row.createdAt])).toEqual([
      [one.username, 3, 'CM', 'old city management', '2026-02-03T08:30:00.000Z'],
    ])
    expect(rows[0]?.id).toBe(`legacy-reveal-${table.gameId}-3-${one.username}-CM-0`)
    expect(JSON.stringify(await repo.chatFor(table.gameId))).not.toContain('SECRET-DRAFT')
    const after = await loadGame(table.gameId)
    expect(after.legacyOrdersCopied).toBe(true)
    expect(after.publicTurns).toEqual(before.publicTurns)

    // Running the copy again, even by hand, writes nothing
    expect(await copyLegacyOrders(repo, table.gameId, before)).toEqual({ written: 0, complete: true })
    expect(await orderRows(table.gameId)).toHaveLength(1)
  })

  it('dates a version-less order from the game when no log line names it, and from the epoch when the game has no date', async () => {
    const table = await twoPlayerGame('old-dates')
    await bareReveal(table, 0, 1, 'SOT', 'no log line')
    const state = await loadGame(table.gameId)
    await repo.saveGame({ ...state, createdAt: '2026-01-05T00:00:00.000Z' })

    await migrate(table)
    expect((await orderRows(table.gameId)).map((row) => row.createdAt)).toEqual(['2026-01-05T00:00:00.000Z'])

    const other = await twoPlayerGame('old-epoch')
    await bareReveal(other, 0, 1, 'SOT', 'no log line, no game date')
    await repo.saveGame({ ...(await loadGame(other.gameId)), createdAt: null })

    await migrate(other)
    expect((await orderRows(other.gameId)).map((row) => row.createdAt)).toEqual(['1970-01-01T00:00:00.000Z'])
  })

  it('does not copy a version-less order that the timeline already holds', async () => {
    const table = await twoPlayerGame('old-posted')
    const one = table.players[0]
    if (one === undefined) throw new Error('no player')
    await bareReveal(table, 0, 1, 'SOT', 'already posted', '2026-02-03T08:30:00.000Z')
    await repo.appendChat({
      id: 'posted-by-new-code',
      gameId: table.gameId,
      username: one.username,
      message: 'already posted',
      createdAt: '2026-03-01T00:00:00.000Z',
      kind: 'order',
      turnNumber: 1,
      phase: 'SOT',
    })

    await migrate(table)

    expect((await orderRows(table.gameId)).map((row) => row.id)).toEqual(['posted-by-new-code'])
  })

  it('never copies an unrevealed draft, even one beside a version-less reveal in the same turn', async () => {
    const table = await twoPlayerGame('old-draft')
    const one = table.players[0]
    if (one === undefined) throw new Error('no player')
    await bareReveal(table, 0, 1, 'SOT', 'public text', '2026-02-03T08:30:00.000Z')
    await classicOrders(table.gameId, [
      { playerId: one.id, turn: 1, phase: 'TRADE', text: 'SECRET-DRAFT' },
      // Edited after the reveal: only the public copy may be read
      { playerId: one.id, turn: 1, phase: 'SOT', text: 'SECRET-EDIT' },
    ])
    // classicOrders saved the SOT edit as private again; put the revealed text back in the public copy
    const state = await loadGame(table.gameId)
    const key = `1${one.username}`
    const turn = state.publicTurns[key]
    if (turn === undefined) throw new Error('no public turn')
    await repo.saveGame({
      ...state,
      publicTurns: { ...state.publicTurns, [key]: { ...turn, orders: { ...turn.orders, SOT: 'public text' }, revealed: { ...turn.revealed, SOT: true } } },
    })

    await migrate(table)

    const rows = await repo.chatFor(table.gameId)
    expect(rows.map((row) => row.message)).toEqual(['public text'])
    expect(JSON.stringify(rows)).not.toContain('SECRET')
  })

  it('leaves a game that is already in the single chat alone', async () => {
    const table = await twoPlayerGame('already')
    const one = table.players[0]
    if (one === undefined) throw new Error('no player')
    // A new game has its flag set; an order posted now is in the timeline once
    await post(one.token, `/api/games/${table.gameId}/turns/order`, { phase: 'SOT', markdown: 'posted' })
    const before = await loadGame(table.gameId)

    const response = await migrate(table)

    expect(JSON.parse(response.body)).toMatchObject({ games: [], remaining: 0 })
    expect(await loadGame(table.gameId)).toEqual(before)
    expect((await orderRows(table.gameId)).map((row) => row.message)).toEqual(['posted'])
  })

  it('does not write an order twice that was posted after the game was adopted', async () => {
    const table = await twoPlayerGame('adopted')
    const one = table.players[0]
    if (one === undefined) throw new Error('no player')
    await classicOrders(table.gameId, [{ playerId: one.id, turn: 1, phase: 'SOT', text: 'before', at: '2026-01-01T09:00:00.000Z' }])
    // Posted through the new route while the flag is still false: history and a row of its own
    await post(one.token, `/api/games/${table.gameId}/turns/order`, { phase: 'TRADE', markdown: 'after' })

    await migrate(table)

    expect((await orderRows(table.gameId)).map((row) => row.message).sort()).toEqual(['after', 'before'])
  })

  it('skips a game that changed while it was being migrated, writes no row twice, and finishes next time', async () => {
    const table = await twoPlayerGame('changed')
    const one = table.players[0]
    if (one === undefined) throw new Error('no player')
    await classicOrders(table.gameId, [
      { playerId: one.id, turn: 1, phase: 'SOT', text: 'order', at: '2026-01-01T09:00:00.000Z' },
      { playerId: one.id, turn: 1, phase: 'TRADE', text: 'a draft' },
    ])
    const refused = vi.spyOn(repo, 'saveGameIfRevision').mockResolvedValueOnce(false)

    const first = await migrate(table)

    expect(JSON.parse(first.body)).toMatchObject({ games: [], skipped: 1, remaining: 1 })
    expect((await loadGame(table.gameId)).legacyOrdersCopied).toBe(false)
    // Nothing of the draft reached the note, because the save that would carry it did not happen
    expect(await noteOf(table.gameId, one.id)).toBeFalsy()
    refused.mockRestore()

    const second = await migrate(table)

    expect(JSON.parse(second.body)).toMatchObject({ games: [{ id: table.gameId }], skipped: 0, remaining: 0 })
    expect((await orderRows(table.gameId)).map((row) => row.message)).toEqual(['order'])
    expect(await noteOf(table.gameId, one.id)).toContain('a draft')
  })

  it('a named game that changed meanwhile is a 409', async () => {
    const table = await twoPlayerGame('changed-named')
    const one = table.players[0]
    if (one === undefined) throw new Error('no player')
    await classicOrders(table.gameId, [{ playerId: one.id, turn: 1, phase: 'SOT', text: 'order', at: '2026-01-01T09:00:00.000Z' }])
    vi.spyOn(repo, 'saveGameIfRevision').mockResolvedValueOnce(false)

    const response = await migrate(table, table.gameId)

    expect(response.status).toBe(409)
    expect(JSON.parse(response.body)).toMatchObject({ error: 'CONFLICT' })
  })

  it('stops when the request has spent its calls, and the next request carries on without repeating rows', async () => {
    const table = await twoPlayerGame('budget')
    const one = table.players[0]
    if (one === undefined) throw new Error('no player')
    // 45 versions of one order: more than one request may write
    await classicOrders(
      table.gameId,
      Array.from({ length: 45 }, (_unused, index) => ({
        playerId: one.id,
        turn: 1,
        phase: 'SOT' as const,
        text: `version ${index}`,
        at: `2026-01-01T09:${String(index).padStart(2, '0')}:00.000Z`,
      })),
    )

    const first = JSON.parse((await migrate(table)).body) as { games: unknown[]; partial: string | null; remaining: number }

    expect(first).toMatchObject({ games: [], partial: table.gameId, remaining: 1 })
    expect(await orderRows(table.gameId)).toHaveLength(38)
    expect((await loadGame(table.gameId)).legacyOrdersCopied).toBe(false)

    const second = JSON.parse((await migrate(table)).body) as { games: { orderRows: number }[]; partial: string | null; remaining: number }

    expect(second).toMatchObject({ partial: null, remaining: 0 })
    expect(second.games[0]?.orderRows).toBe(7)
    const rows = await orderRows(table.gameId)
    expect(rows).toHaveLength(45)
    expect(new Set(rows.map((row) => row.id)).size).toBe(45)
    expect((await loadGame(table.gameId)).legacyOrdersCopied).toBe(true)
  })

  it('a named game is migrated alone, an unknown one is a 404, and an already migrated one is a no-op', async () => {
    const table = await twoPlayerGame('named')
    const other = await twoPlayerGame('named-other')
    const one = table.players[0]
    const two = other.players[0]
    if (one === undefined || two === undefined) throw new Error('no players')
    await classicOrders(table.gameId, [{ playerId: one.id, turn: 1, phase: 'SOT', text: 'mine', at: '2026-01-01T09:00:00.000Z' }])
    await classicOrders(other.gameId, [{ playerId: two.id, turn: 1, phase: 'SOT', text: 'theirs', at: '2026-01-01T09:00:00.000Z' }])

    expect(JSON.parse((await migrate(table, table.gameId)).body)).toMatchObject({ games: [{ id: table.gameId }], remaining: 0 })

    expect((await loadGame(other.gameId)).legacyOrdersCopied).toBe(false)
    expect(await orderRows(other.gameId)).toEqual([])
    expect((await migrate(table, 'missing')).status).toBe(404)
    expect(JSON.parse((await migrate(table, table.gameId)).body)).toMatchObject({ games: [], remaining: 0 })
  })

  it('is for admins, and wants a JSON object', async () => {
    const table = await twoPlayerGame('guard')
    const player = table.players[0]
    if (player === undefined) throw new Error('no player')
    expect((await inject(app, { method: 'POST', url: URL, payload: {} })).status).toBe(401)
    expect((await post(player.token, URL)).status).toBe(403)
    expect((await inject(app, { method: 'GET', url: URL, headers: bearer(player.token) })).status).toBe(403)
    expect((await post(table.admin, URL, [])).status).toBe(400)
    expect((await post(table.admin, URL, { gameId: 7 })).status).toBe(400)
    expect((await inject(app, { method: 'POST', url: URL, headers: bearer(table.admin) })).status).toBe(400)
  })

  it('leaves the paged timeline sensible for a game with three classic turns', async () => {
    const table = await twoPlayerGame('paging')
    const [one, two] = table.players
    if (one === undefined || two === undefined) throw new Error('no players')
    const phases = ['SOT', 'TRADE', 'CM', 'MOVEMENT', 'RESEARCH'] as const
    const orders = [1, 2, 3].flatMap((turn) =>
      [one, two].flatMap((player, seat) =>
        phases.map((phase, index) => ({
          playerId: player.id,
          turn,
          phase,
          text: `t${turn} ${player.username} ${phase}`,
          at: `2026-01-0${turn}T${String(9 + seat).padStart(2, '0')}:0${index}:00.000Z`,
        })),
      ),
    )
    // A second version of one order, so there are more rows than the minimum page
    orders.push({ playerId: one.id, turn: 3, phase: 'SOT', text: 'revised', at: '2026-01-03T20:00:00.000Z' })
    await classicOrders(table.gameId, orders)

    await migrate(table)

    const all = await repo.chatFor(table.gameId)
    expect(all.filter((row) => row.kind === 'order')).toHaveLength(31)
    // All three turns were finished, so the game is on turn 4 and nothing is tagged with
    // it yet: the page is the newest 30 rows, and one row is left for Load more
    const current = await timeline(table)
    expect(current.messages).toHaveLength(30)
    expect(current.hasMore).toBe(true)
    const first = current.messages[0]
    if (first === undefined) throw new Error('empty page')

    const seen = new Set(current.messages.map((row) => row.id))
    let cursor = current.hasMore ? first.id : undefined
    let guard = 0
    while (cursor !== undefined && guard < 10) {
      const older = await timeline(table, `?before=${cursor}`)
      for (const row of older.messages) {
        expect(seen.has(row.id)).toBe(false)
        seen.add(row.id)
      }
      cursor = older.hasMore ? older.messages[0]?.id : undefined
      guard += 1
    }
    // Paging back reaches every copied order exactly once, in a sensible order
    expect(all.filter((row) => row.kind === 'order').every((row) => seen.has(row.id))).toBe(true)
    expect(current.messages.map((row) => row.createdAt)).toEqual([...current.messages.map((row) => row.createdAt)].sort())
  })

  /** Marks the game as already moved, the way the old toggle left a game it switched to chat mode. */
  async function markCopied(gameId: string): Promise<void> {
    await repo.saveGame({ ...(await loadGame(gameId)), legacyOrdersCopied: true })
  }

  it('copies a version-less reveal into a game that is already marked moved, and only the rows', async () => {
    const table = await twoPlayerGame('flagged')
    const [one, two] = table.players
    if (one === undefined || two === undefined) throw new Error('no players')
    await classicOrders(table.gameId, [{ playerId: two.id, turn: 1, phase: 'TRADE', text: 'SECRET-DRAFT' }])
    await bareReveal(table, 0, 2, 'CM', 'missed reveal', '2026-02-03T08:30:00.000Z')
    await markCopied(table.gameId)
    const stored = await loadGame(table.gameId)

    // The dry run lists it with the rows it would write and no drafts
    expect(JSON.parse((await dryRun(table)).body)).toEqual({
      games: [{ id: table.gameId, name: 'flagged', active: true, orderRows: 1, drafts: 0 }],
      totalOrderRows: 1,
      totalDrafts: 0,
      unchecked: 0,
    })
    expect(await orderRows(table.gameId)).toEqual([])

    const saves = vi.spyOn(repo, 'saveGame')
    const guarded = vi.spyOn(repo, 'saveGameIfRevision')
    const response = await migrate(table)

    expect(JSON.parse(response.body)).toMatchObject({
      games: [{ id: table.gameId, orderRows: 1, drafts: 0 }],
      totalOrderRows: 1,
      totalDrafts: 0,
      partial: null,
      remaining: 0,
    })
    const rows = await orderRows(table.gameId)
    expect(rows.map((row) => [row.username, row.turnNumber, row.phase, row.message, row.createdAt])).toEqual([
      [one.username, 2, 'CM', 'missed reveal', '2026-02-03T08:30:00.000Z'],
    ])
    expect(rows[0]?.id).toBe(`legacy-reveal-${table.gameId}-2-${one.username}-CM-0`)
    // Only rows: no save, same revision, same flag, the draft is not moved into the note
    expect(saves).not.toHaveBeenCalled()
    expect(guarded).not.toHaveBeenCalled()
    expect(await loadGame(table.gameId)).toEqual(stored)
    expect(await noteOf(table.gameId, two.id)).toBeNull()
    expect(JSON.stringify(await repo.chatFor(table.gameId))).not.toContain('SECRET-DRAFT')

    // A second run copies nothing and the game is no longer listed, in either route
    const appended = vi.spyOn(repo, 'appendChat')
    const second = await migrate(table)
    expect(JSON.parse(second.body)).toMatchObject({ games: [], totalOrderRows: 0, remaining: 0, partial: null })
    expect(appended).not.toHaveBeenCalled()
    expect(JSON.parse((await dryRun(table)).body)).toMatchObject({ games: [], totalOrderRows: 0 })
    expect(await orderRows(table.gameId)).toHaveLength(1)
    // Naming the game gives the same answer
    expect(JSON.parse((await migrate(table, table.gameId)).body)).toMatchObject({ games: [] })
  })

  it('never lists a moved game that has no version-less orders, and does not read its chat', async () => {
    const table = await twoPlayerGame('flagged-clean')
    const one = table.players[0]
    if (one === undefined) throw new Error('no player')
    await classicOrders(table.gameId, [{ playerId: one.id, turn: 1, phase: 'SOT', text: 'versioned', at: '2026-01-01T09:00:00.000Z' }])
    expect((await migrate(table)).status).toBe(200)
    expect((await loadGame(table.gameId)).legacyOrdersCopied).toBe(true)
    const reads = vi.spyOn(repo, 'chatFor')
    const appended = vi.spyOn(repo, 'appendChat')

    expect(JSON.parse((await dryRun(table)).body)).toMatchObject({ games: [], totalOrderRows: 0, unchecked: 0 })
    expect(JSON.parse((await migrate(table)).body)).toMatchObject({ games: [], remaining: 0 })
    expect(JSON.parse((await migrate(table, table.gameId)).body)).toMatchObject({ games: [], remaining: 0 })

    expect(reads).not.toHaveBeenCalled()
    expect(appended).not.toHaveBeenCalled()
  })

  it('moves drafts only for a game that was not marked moved, in the same run as a marked one', async () => {
    const fresh = await twoPlayerGame('mixed-new')
    const marked = await twoPlayerGame('mixed-old')
    const freshOne = fresh.players[0]
    const markedOne = marked.players[0]
    if (freshOne === undefined || markedOne === undefined) throw new Error('no players')
    await classicOrders(fresh.gameId, [
      { playerId: freshOne.id, turn: 1, phase: 'SOT', text: 'fresh public', at: '2026-01-01T09:00:00.000Z' },
      { playerId: freshOne.id, turn: 1, phase: 'TRADE', text: 'FRESH-DRAFT' },
    ])
    await classicOrders(marked.gameId, [{ playerId: markedOne.id, turn: 1, phase: 'TRADE', text: 'MARKED-DRAFT' }])
    await bareReveal(marked, 0, 1, 'SOT', 'marked reveal', '2026-02-03T08:30:00.000Z')
    await markCopied(marked.gameId)

    const dry = JSON.parse((await dryRun(fresh)).body) as { games: { id: string; orderRows: number; drafts: number }[] }
    expect(dry.games.map((game) => [game.id, game.orderRows, game.drafts]).sort()).toEqual(
      [[fresh.gameId, 1, 1], [marked.gameId, 1, 0]].sort(),
    )

    const response = JSON.parse((await migrate(fresh)).body) as {
      games: { id: string; orderRows: number; drafts: number }[]
      totalDrafts: number
      remaining: number
    }

    expect(response.games.map((game) => [game.id, game.orderRows, game.drafts]).sort()).toEqual(
      [[fresh.gameId, 1, 1], [marked.gameId, 1, 0]].sort(),
    )
    expect(response.totalDrafts).toBe(1)
    expect(response.remaining).toBe(0)
    expect(await noteOf(fresh.gameId, freshOne.id)).toBe('### Turn 1, trade (unpublished draft)\n\nFRESH-DRAFT')
    expect((await loadGame(fresh.gameId)).legacyOrdersCopied).toBe(true)
    expect(await noteOf(marked.gameId, markedOne.id)).toBeNull()
    expect((await orderRows(marked.gameId)).map((row) => row.message)).toEqual(['marked reveal'])
    expect(JSON.stringify(await repo.chatFor(marked.gameId))).not.toContain('MARKED-DRAFT')
  })

  it('keeps within the call budget for moved games: the dry run reads at most 40 chats and counts the rest as unchecked', async () => {
    const table = await twoPlayerGame('budget')
    await bareReveal(table, 0, 1, 'SOT', 'text', '2026-02-03T08:30:00.000Z')
    await markCopied(table.gameId)
    const source = await loadGame(table.gameId)
    for (let index = 0; index < 42; index += 1) await repo.saveGame({ ...source, id: `${table.gameId}-copy-${index}` })
    const reads = vi.spyOn(repo, 'chatFor')

    const body = JSON.parse((await dryRun(table)).body) as { games: unknown[]; unchecked: number }

    // 43 moved games with a version-less order: 40 are read, 3 are left unchecked
    expect(reads).toHaveBeenCalledTimes(40)
    expect(body.games).toHaveLength(40)
    expect(body.unchecked).toBe(3)

    // The real run: a read and a row per game, 20 games in 40 calls, the rest is still remaining
    reads.mockClear()
    const appended = vi.spyOn(repo, 'appendChat')
    const run = JSON.parse((await migrate(table)).body) as { games: unknown[]; partial: string | null; remaining: number }
    expect(reads.mock.calls.length + appended.mock.calls.length).toBeLessThanOrEqual(40)
    expect(run.games).toHaveLength(20)
    expect(run.remaining).toBe(23)
  })
})

describe('the migrate-chat details', () => {
  it('counts only the drafts it would add: a section the note already holds is not counted, in the dry run or the report', async () => {
    const table = await twoPlayerGame('counted')
    const [one, two] = table.players
    if (one === undefined || two === undefined) throw new Error('no players')
    await classicOrders(table.gameId, [
      { playerId: one.id, turn: 1, phase: 'TRADE', text: 'ALREADY-THERE' },
      { playerId: one.id, turn: 2, phase: 'TRADE', text: 'NEW-ONE' },
      { playerId: two.id, turn: 1, phase: 'CM', text: 'THEIRS' },
    ])
    const note = '### Turn 1, trade (unpublished draft)\n\nALREADY-THERE'
    expect((await post(one.token, `/api/games/${table.gameId}/note`, { note })).status).toBe(200)

    expect(JSON.parse((await dryRun(table)).body)).toMatchObject({
      games: [{ id: table.gameId, orderRows: 0, drafts: 2 }],
      totalDrafts: 2,
    })

    const response = await migrate(table)

    expect(JSON.parse(response.body)).toMatchObject({ games: [{ id: table.gameId, drafts: 2 }], totalDrafts: 2 })
    expect(await noteOf(table.gameId, one.id)).toBe(`${note}\n\n### Turn 2, trade (unpublished draft)\n\nNEW-ONE`)
  })

  it('looks a game up by its trimmed id', async () => {
    const table = await twoPlayerGame('trimmed')
    const one = table.players[0]
    if (one === undefined) throw new Error('no player')
    await classicOrders(table.gameId, [{ playerId: one.id, turn: 1, phase: 'SOT', text: 'order', at: '2026-01-01T09:00:00.000Z' }])

    const response = await migrate(table, `  ${table.gameId}  `)

    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({ games: [{ id: table.gameId }], remaining: 0 })
    expect((await migrate(table, '   ')).status).toBe(400)
    const missing = await migrate(table, ' nobody ')
    expect(missing.status).toBe(404)
    expect(missing.body).toContain('No game with id nobody')
  })

  it('does not put a moved draft into any revision or into another player\'s view of the game', async () => {
    const table = await twoPlayerGame('revision-leak')
    const [one, two] = table.players
    if (one === undefined || two === undefined) throw new Error('no players')
    await classicOrders(table.gameId, [{ playerId: one.id, turn: 1, phase: 'TRADE', text: 'MOVED-DRAFT-TEXT' }])

    expect((await migrate(table)).status).toBe(200)
    expect(await noteOf(table.gameId, one.id)).toContain('MOVED-DRAFT-TEXT')

    // The owner reads the note in their own game view, nobody else does
    const ownView = await inject(app, { url: `/api/games/${table.gameId}`, headers: bearer(one.token) })
    expect(ownView.body).toContain('MOVED-DRAFT-TEXT')
    const otherView = await inject(app, { url: `/api/games/${table.gameId}`, headers: bearer(two.token) })
    expect(otherView.status).toBe(200)
    expect(otherView.body).not.toContain('MOVED-DRAFT-TEXT')

    // A revision taken after the move holds the draft in the owner's note, and its projection blanks every note
    // The next action in the game stores a revision of the state, with the moved note in it
    expect((await post(two.token, `/api/games/${table.gameId}/turns/order`, { phase: 'SOT', markdown: 'a later order' })).status).toBe(200)
    const list = await inject(app, { url: `/api/games/${table.gameId}/revisions`, headers: bearer(one.token) })
    const latest = (await list.json<{ revision: number }[]>()).at(-1)?.revision
    expect(latest).toBeDefined()
    const stored = await repo.findGameRevision(table.gameId, latest as number)
    expect(JSON.stringify(stored?.state)).toContain('MOVED-DRAFT-TEXT')
    // The owner's own view of the revision still lists their own old draft in `playerTurns`
    // (their data, as in the live view); the note, where the migration put it, is blanked
    const ownRevision = await inject(app, {
      url: `/api/games/${table.gameId}/revisions/${latest}`,
      headers: bearer(one.token),
    })
    const own = await ownRevision.json<{ view: { you: { gamenote: string | null; playerTurns: unknown } } }>()
    expect(own.view.you.gamenote).toBe('')
    expect(JSON.stringify({ ...own, view: { ...own.view, you: { ...own.view.you, playerTurns: [] } } })).not.toContain(
      'MOVED-DRAFT-TEXT',
    )
    // Nobody else gets it from a revision: another player, an admin who is not in the game, a visitor
    for (const token of [two.token, table.admin, undefined]) {
      const revision = await inject(app, {
        url: `/api/games/${table.gameId}/revisions/${latest}`,
        ...(token === undefined ? {} : { headers: bearer(token) }),
      })
      expect(revision.status).toBe(200)
      expect(revision.body).not.toContain('MOVED-DRAFT-TEXT')
    }
  })
})

describe('the migrate-chat dry run', () => {
  it('lists the games that need it with row and draft counts, and writes nothing', async () => {
    const table = await twoPlayerGame('dry')
    const migrated = await twoPlayerGame('dry-done')
    const one = table.players[0]
    if (one === undefined) throw new Error('no player')
    await classicOrders(table.gameId, [
      { playerId: one.id, turn: 1, phase: 'SOT', text: 'public', at: '2026-01-01T09:00:00.000Z' },
      { playerId: one.id, turn: 1, phase: 'TRADE', text: 'SECRET-DRAFT' },
    ])
    const stored = await loadGame(table.gameId)
    const writes = vi.spyOn(repo, 'saveGameIfRevision')
    const saves = vi.spyOn(repo, 'saveGame')
    const appended = vi.spyOn(repo, 'appendChat')

    const response = await dryRun(table)

    expect(response.status).toBe(200)
    const body = JSON.parse(response.body) as { games: { id: string }[] }
    expect(body).toEqual({
      games: [{ id: table.gameId, name: 'dry', active: true, orderRows: 1, drafts: 1 }],
      totalOrderRows: 1,
      totalDrafts: 1,
      unchecked: 0,
    })
    expect(body.games.map((game) => game.id)).not.toContain(migrated.gameId)
    // Counts and names only: no order or draft text leaves
    expect(response.body).not.toContain('SECRET-DRAFT')
    expect(response.body).not.toContain('public"')
    expect(writes).not.toHaveBeenCalled()
    expect(saves).not.toHaveBeenCalled()
    expect(appended).not.toHaveBeenCalled()
    expect(await loadGame(table.gameId)).toEqual(stored)
    expect(await repo.chatFor(table.gameId)).toEqual([])
  })
})

describe('copyLegacyOrders on the D1 store', () => {
  it('writes the rows in time order, and a second run writes none', async () => {
    const adapter = await createD1Adapter(readMigrations())
    try {
      const d1 = new D1Repository(adapter.db)
      const created = await createTestApp()
      const table = await (async () => {
        // A real game state to copy from, built on the JSON store
        repo = created.repo
        app = created.app
        return twoPlayerGame('d1')
      })()
      const one = table.players[0]
      if (one === undefined) throw new Error('no player')
      await classicOrders(table.gameId, [
        { playerId: one.id, turn: 1, phase: 'TRADE', text: 'later', at: '2026-01-01T10:00:00.000Z' },
        { playerId: one.id, turn: 1, phase: 'SOT', text: 'earlier', at: '2026-01-01T09:00:00.000Z' },
      ])
      const state = await loadGame(table.gameId)
      await d1.appendChat({ id: 'talk', gameId: table.gameId, username: 'x', message: 'chat', createdAt: '2026-01-01T09:30:00.000Z' })

      expect(await copyLegacyOrders(d1, table.gameId, state)).toEqual({ written: 2, complete: true })
      expect(await copyLegacyOrders(d1, table.gameId, state)).toEqual({ written: 0, complete: true })

      const rows = await d1.chatFor(table.gameId)
      expect(rows.map((row) => [row.kind, row.message, row.turnNumber, row.phase])).toEqual([
        ['order', 'earlier', 1, 'SOT'],
        ['chat', 'chat', null, null],
        ['order', 'later', 1, 'TRADE'],
      ])
    } finally {
      adapter.close()
    }
  })
})
