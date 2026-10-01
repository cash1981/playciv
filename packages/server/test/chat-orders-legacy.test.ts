/**
 * Chat orders (issue #215): the classic turn orders are copied into the timeline
 * the first time chat orders is switched on. New in the port; the rules are in
 * `docs/agents/decisions.md`.
 */

import { revealTurnOrder, updateTurn, unwrap } from '@civ/engine'
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

/** Writes and reveals orders the classic way, with times of our choosing. */
async function classicOrders(
  gameId: string,
  orders: readonly { playerId: string; turn: number; phase: 'SOT' | 'TRADE' | 'CM' | 'MOVEMENT' | 'RESEARCH'; text: string; at?: string }[],
): Promise<void> {
  let state = await loadGame(gameId)
  for (const order of orders) {
    state = unwrap(updateTurn(state, { playerId: order.playerId, turnNumber: order.turn, phase: order.phase, order: order.text }))
    if (order.at !== undefined) {
      state = unwrap(revealTurnOrder(state, { playerId: order.playerId, turnNumber: order.turn, phase: order.phase, at: order.at }))
    }
  }
  await repo.saveGame(state)
}

const setChatOrders = (table: Table, enabled: boolean) =>
  post(table.admin, `/api/admin/games/${table.gameId}/chat-orders`, { enabled })

const timeline = async (table: Table, extra = '') =>
  (await inject(app, { method: 'GET', url: `/api/games/${table.gameId}/chat?paged=1${extra}`, headers: bearer(table.players[0]?.token ?? '') }))
    .json<{ messages: ChatMessage[]; hasMore: boolean }>()

const orderRows = async (gameId: string): Promise<readonly ChatMessage[]> =>
  (await repo.chatFor(gameId)).filter((row) => row.kind === 'order')

describe('copying the classic orders on the first switch-on', () => {
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
    expect((await setChatOrders(table, true)).status).toBe(200)

    const rows = await orderRows(table.gameId)
    // Oldest first. (The JSON store lists rows as written; D1 sorts by time, see below.)
    expect(rows.map((row) => [row.username, row.turnNumber, row.phase, row.message, row.createdAt])).toEqual([
      [one.username, 1, 'SOT', 'one first', '2026-01-01T09:00:00.000Z'],
      [two.username, 1, 'TRADE', 'two trade', '2026-01-01T10:00:00.000Z'],
      [one.username, 1, 'SOT', 'one second', '2026-01-01T11:00:00.000Z'],
      [one.username, 2, 'CM', 'one turn two', '2026-01-02T09:00:00.000Z'],
    ])
    expect(rows.every((row) => row.kind === 'order')).toBe(true)
    expect(rows.every((row) => row.gameId === table.gameId)).toBe(true)
    expect(rows[0]?.id).toBe(`legacy-${table.gameId}-1-${one.username}-SOT-0`)
    expect(rows[2]?.id).toBe(`legacy-${table.gameId}-1-${one.username}-SOT-1`)
    expect((await loadGame(table.gameId)).legacyOrdersCopied).toBe(true)
  })

  it('copies nothing again when it is switched off and on', async () => {
    const table = await twoPlayerGame('twice')
    const one = table.players[0]
    if (one === undefined) throw new Error('no player')
    await classicOrders(table.gameId, [{ playerId: one.id, turn: 1, phase: 'SOT', text: 'once', at: '2026-01-01T09:00:00.000Z' }])

    await setChatOrders(table, true)
    expect(await orderRows(table.gameId)).toHaveLength(1)
    await setChatOrders(table, false)
    // An order revealed while it was off is not picked up either: the copy is one time
    await classicOrders(table.gameId, [{ playerId: one.id, turn: 1, phase: 'TRADE', text: 'later', at: '2026-01-03T09:00:00.000Z' }])
    await setChatOrders(table, true)
    await setChatOrders(table, true)

    expect((await orderRows(table.gameId)).map((row) => row.message)).toEqual(['once'])
  })

  it('never copies a draft that was not revealed, or a private note', async () => {
    const table = await twoPlayerGame('leak')
    const one = table.players[0]
    if (one === undefined) throw new Error('no player')
    await classicOrders(table.gameId, [
      { playerId: one.id, turn: 1, phase: 'SOT', text: 'public order', at: '2026-01-01T09:00:00.000Z' },
      { playerId: one.id, turn: 1, phase: 'TRADE', text: 'SECRET-DRAFT' },
      // Edited after the reveal and not revealed again
      { playerId: one.id, turn: 1, phase: 'SOT', text: 'SECRET-EDIT' },
    ])
    expect((await post(one.token, `/api/games/${table.gameId}/note`, { note: 'SECRET-NOTE' })).status).toBe(200)

    await setChatOrders(table, true)

    const rows = await repo.chatFor(table.gameId)
    expect(rows.map((row) => row.message)).toEqual(['public order'])
    expect(JSON.stringify(rows)).not.toContain('SECRET')
    const page = await timeline(table)
    expect(JSON.stringify(page)).not.toContain('SECRET')
  })

  it('sends no mail', async () => {
    const table = await twoPlayerGame('quiet')
    const one = table.players[0]
    if (one === undefined) throw new Error('no player')
    await classicOrders(table.gameId, [{ playerId: one.id, turn: 1, phase: 'SOT', text: 'order', at: '2026-01-01T09:00:00.000Z' }])
    mailer.sent.length = 0

    await setChatOrders(table, true)

    expect((await orderRows(table.gameId)).length).toBe(1)
    expect(mailer.sent).toEqual([])
  })

  it('copies nothing from an order revealed before versions were kept', async () => {
    const table = await twoPlayerGame('old-save')
    const one = table.players[0]
    if (one === undefined) throw new Error('no player')
    await classicOrders(table.gameId, [{ playerId: one.id, turn: 1, phase: 'SOT', text: 'old', at: '2026-01-01T09:00:00.000Z' }])
    const state = await loadGame(table.gameId)
    const key = `1${one.username}`
    const turn = state.publicTurns[key]
    if (turn === undefined) throw new Error('no public turn')
    await repo.saveGame({ ...state, publicTurns: { ...state.publicTurns, [key]: { ...turn, history: { ...turn.history, SOT: [] } } } })

    expect((await setChatOrders(table, true)).status).toBe(200)

    expect(await orderRows(table.gameId)).toEqual([])
  })

  it('does not fail the switch when the copy fails, and says so in the log', async () => {
    const table = await twoPlayerGame('fails')
    const one = table.players[0]
    if (one === undefined) throw new Error('no player')
    await classicOrders(table.gameId, [{ playerId: one.id, turn: 1, phase: 'SOT', text: 'order', at: '2026-01-01T09:00:00.000Z' }])
    vi.spyOn(repo, 'appendChat').mockRejectedValue(new Error('timeline is down'))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await setChatOrders(table, true)

    expect(response.status).toBe(200)
    expect((await loadGame(table.gameId)).chatOrders).toBe(true)
    expect(logged).toHaveBeenCalled()
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

    await setChatOrders(table, true)

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
      const older = await timeline(table, `&before=${cursor}`)
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

      expect(await copyLegacyOrders(d1, table.gameId, state)).toBe(2)
      expect(await copyLegacyOrders(d1, table.gameId, state)).toBe(0)

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
