/**
 * Chat orders (issue #215), slice 1: the admin switch, the order / done /
 * undone routes, the paged timeline and the chat row kinds. New in the port, so
 * there is no Java counterpart.
 */

import type { GameState, PlayerView } from '@civ/engine'
import { beforeEach, describe, expect, it } from 'vitest'

import type { App } from '../src/app.js'
import { createTestApp } from '../src/app.js'
import { timelinePage } from '../src/routes/games.js'
import { D1Repository } from '../src/store/d1.js'
import { JsonFileRepository } from '../src/store/json-file.js'
import type { ChatMessage } from '../src/store/types.js'
import { createD1Adapter } from './d1-sqlite-adapter.js'
import { bearer, inject } from './helpers.js'
import { readMigrations } from './migrations.js'

let app: App
let repo: JsonFileRepository

beforeEach(async () => {
  const created = await createTestApp()
  app = created.app
  repo = created.repo
})

async function register(username: string): Promise<string> {
  const response = await inject(app, {
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hemmelig', email: `${username}@example.com`, securityAnswer: 'writing' },
  })
  expect(response.status).toBe(201)
  return (await response.json() as { token: string }).token
}

async function registerAdmin(username: string): Promise<string> {
  const token = await register(username)
  const account = await repo.findPlayerByUsername(username)
  await repo.updatePlayer(account?.id as string, { role: 'admin' })
  return token
}

interface Started {
  readonly gameId: string
  /** Seat 1: it also holds the classic baton at the start, and is the turn holder once chat orders are on. */
  readonly seat1: string
  readonly seat2: string
  readonly name1: string
  readonly name2: string
}

async function startedGame(name: string): Promise<Started> {
  const seat1 = await register(`${name}-a`)
  const created = await inject(app, {
    method: 'POST',
    url: '/api/games',
    headers: bearer(seat1),
    payload: { name, numOfPlayers: 2 },
  })
  const gameId = (await created.json() as { id: string }).id
  const seat2 = await register(`${name}-b`)
  const join = await inject(app, { method: 'POST', url: `/api/games/${gameId}/join`, headers: bearer(seat2), payload: {} })
  expect(join.status).toBe(200)
  // The seats are shuffled when the last player joins, so look up who got seat 1
  const state = await repo.findGame(gameId)
  const first = state?.players.find((player) => player.playernumber === 1)?.username
  const swap = first !== `${name}-a`
  return {
    gameId,
    seat1: swap ? seat2 : seat1,
    seat2: swap ? seat1 : seat2,
    name1: swap ? `${name}-b` : `${name}-a`,
    name2: swap ? `${name}-a` : `${name}-b`,
  }
}

const post = (token: string, url: string, payload: unknown = {}) =>
  inject(app, { method: 'POST', url, headers: bearer(token), payload })

const get = (token: string, url: string) => inject(app, { method: 'GET', url, headers: bearer(token) })

async function chatOn(game: Started): Promise<void> {
  const admin = await registerAdmin(`admin-${game.gameId.slice(0, 6)}`)
  const response = await post(admin, `/api/admin/games/${game.gameId}/chat-orders`, { enabled: true })
  expect(response.status).toBe(200)
}

interface Timeline {
  readonly messages: readonly ChatMessage[]
  readonly hasMore: boolean
}

const timeline = async (token: string, gameId: string, query = ''): Promise<Timeline> =>
  (await get(token, `/api/games/${gameId}/chat${query}`)).json<Timeline>()

const row = (id: string, gameId: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  gameId,
  username: 'someone',
  message: id,
  createdAt: '2026-01-01T00:00:00.000Z',
  kind: 'chat',
  turnNumber: null,
  phase: null,
  ...over,
})

describe('the admin switch', () => {
  it('an admin turns it on and off, and the view shows it', async () => {
    const game = await startedGame('switch')
    const admin = await registerAdmin('switch-admin')

    const on = await post(admin, `/api/admin/games/${game.gameId}/chat-orders`, { enabled: true })
    expect(on.status).toBe(200)
    expect((await repo.findGame(game.gameId))?.chatOrders).toBe(true)
    const view = (await get(game.seat2, `/api/games/${game.gameId}/state`)).json<PlayerView>()
    expect((await view).chatOrders).toBe(true)

    const off = await post(admin, `/api/admin/games/${game.gameId}/chat-orders`, { enabled: false })
    expect(off.status).toBe(200)
    expect((await repo.findGame(game.gameId))?.chatOrders).toBe(false)
  })

  it('a non-admin, even a player in the game, gets 403 and nothing changes', async () => {
    const game = await startedGame('switch-403')
    const response = await post(game.seat1, `/api/admin/games/${game.gameId}/chat-orders`, { enabled: true })
    expect(response.status).toBe(403)
    expect(JSON.parse(response.body)).toMatchObject({ error: 'ADMIN_REQUIRED' })
    expect((await repo.findGame(game.gameId))?.chatOrders).toBe(false)
  })

  it('needs a login, a boolean and an existing game', async () => {
    const game = await startedGame('switch-bad')
    const admin = await registerAdmin('switch-bad-admin')
    expect((await inject(app, { method: 'POST', url: `/api/admin/games/${game.gameId}/chat-orders`, payload: { enabled: true } })).status).toBe(401)
    expect((await post(admin, `/api/admin/games/${game.gameId}/chat-orders`, { enabled: 'yes' })).status).toBe(400)
    expect((await post(admin, '/api/admin/games/missing/chat-orders', { enabled: true })).status).toBe(404)
  })

  it('a new game has it off', async () => {
    const game = await startedGame('default-off')
    expect((await repo.findGame(game.gameId))?.chatOrders).toBe(false)
  })
})

describe('posting an order', () => {
  it('writes the engine state and an order row together', async () => {
    const game = await startedGame('order')
    await chatOn(game)

    const response = await post(game.seat2, `/api/games/${game.gameId}/turns/order`, { phase: 'movement', markdown: 'A6 to A5' })
    expect(response.status).toBe(200)

    const state = await repo.findGame(game.gameId) as GameState
    const turn = state.players.find((player) => player.username === game.name2)?.playerTurns[0]
    expect(turn?.turnNumber).toBe(1)
    expect(turn?.orders.MOVEMENT).toBe('A6 to A5')
    expect(turn?.revealed.MOVEMENT).toBe(true)
    expect(turn?.done.MOVEMENT).toBe(false)

    const rows = await repo.chatFor(game.gameId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'order', message: 'A6 to A5', turnNumber: 1, phase: 'MOVEMENT', username: game.name2 })
  })

  it('two orders for the same phase: both in history, the newest is the order, both in the timeline', async () => {
    const game = await startedGame('two-orders')
    await chatOn(game)
    for (const markdown of ['first plan', 'second plan']) {
      const response = await post(game.seat1, `/api/games/${game.gameId}/turns/order`, { phase: 'SOT', markdown, turnNumber: 1 })
      expect(response.status).toBe(200)
    }

    const turn = (await repo.findGame(game.gameId))?.players[0]?.playerTurns[0]
    expect(turn?.orders.SOT).toBe('second plan')
    expect(turn?.history.SOT.map((version) => version.markdown)).toEqual(['first plan', 'second plan'])

    const page = await timeline(game.seat2, game.gameId)
    expect(page.messages.map((message) => message.message)).toEqual(['first plan', 'second plan'])
    // The classic Turn orders panel reads the same data
    const publicTurns = await get(game.seat2, `/api/games/${game.gameId}/turns/public`)
    expect(publicTurns.body).toContain('second plan')
    expect(publicTurns.body).toContain('first plan')
  })

  it('defaults to the current turn and validates its input', async () => {
    const game = await startedGame('order-input')
    await chatOn(game)
    const url = `/api/games/${game.gameId}/turns/order`
    expect((await post(game.seat1, url, { phase: 'nonsense', markdown: 'x' })).status).toBe(400)
    expect((await post(game.seat1, url, { phase: 'SOT' })).status).toBe(400)
    expect((await post(game.seat1, url, { phase: 'SOT', markdown: '   ' })).status).toBe(400)
    expect((await post(game.seat1, url, { phase: 'SOT', markdown: 'x', turnNumber: 0 })).status).toBe(400)
    expect((await post(game.seat1, url, { phase: 'SOT', markdown: 'x', turnNumber: 1.5 })).status).toBe(400)
    expect(await repo.chatFor(game.gameId)).toEqual([])

    // Both players finish turn 1, so the default is turn 2
    for (const token of [game.seat1, game.seat2]) {
      await post(token, `/api/games/${game.gameId}/turns/done`, { phase: 'RESEARCH' })
    }
    expect((await post(game.seat1, url, { phase: 'SOT', markdown: 'next' })).status).toBe(200)
    expect((await repo.chatFor(game.gameId)).at(-1)).toMatchObject({ kind: 'order', turnNumber: 2 })
  })

  it('a stranger is refused and leaves no row behind', async () => {
    const game = await startedGame('order-stranger')
    await chatOn(game)
    const stranger = await register('order-stranger-x')
    const response = await post(stranger, `/api/games/${game.gameId}/turns/order`, { phase: 'SOT', markdown: 'hi' })
    expect(response.status).toBe(403)
    expect(await repo.chatFor(game.gameId)).toEqual([])
  })
})

describe('marking phases done and not done', () => {
  it('marks several phases at once, writes one system row, and the view follows', async () => {
    const game = await startedGame('done')
    await chatOn(game)

    const response = await post(game.seat1, `/api/games/${game.gameId}/turns/done`, { phase: 'CM' })
    expect(response.status).toBe(200)
    const view = await response.json<PlayerView>()
    expect(view.you?.playerTurns[0]?.done).toEqual({ SOT: true, TRADE: true, CM: true, MOVEMENT: false, RESEARCH: false })
    // Seat 2 has not done Start of turn, so that is the earliest open phase and seat 2 holds the turn
    expect(view.activeTurn).toMatchObject({ username: game.name2, phase: 'SOT', turnNumber: 1 })
    expect(view.activeTurn?.waitingFor).toEqual([
      { username: game.name1, phase: 'MOVEMENT' },
      { username: game.name2, phase: 'SOT' },
    ])

    const rows = await repo.chatFor(game.gameId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: 'system',
      turnNumber: 1,
      phase: 'CM',
      message: `Turn 1 - ${game.name1} marked all phases up to city management done`,
    })
  })

  it('marking again changes nothing and writes no second row', async () => {
    const game = await startedGame('done-twice')
    await chatOn(game)
    const url = `/api/games/${game.gameId}/turns/done`
    await post(game.seat1, url, { phase: 'TRADE' })
    const revBefore = (await repo.findGame(game.gameId))?.rev
    expect((await post(game.seat1, url, { phase: 'SOT' })).status).toBe(200)
    expect(await repo.chatFor(game.gameId)).toHaveLength(1)
    // The write still counts as a revision (applyToGame always bumps it)
    expect((await repo.findGame(game.gameId))?.rev).toBe((revBefore ?? 0) + 1)
  })

  it('unmarks one phase without touching later ones, and writes a system row', async () => {
    const game = await startedGame('undone')
    await chatOn(game)
    await post(game.seat2, `/api/games/${game.gameId}/turns/done`, { phase: 'MOVEMENT', turnNumber: 1 })

    const response = await post(game.seat2, `/api/games/${game.gameId}/turns/undone`, { phase: 'trade', turnNumber: 1 })
    expect(response.status).toBe(200)
    const view = await response.json<PlayerView>()
    expect(view.you?.playerTurns[0]?.done).toEqual({ SOT: true, TRADE: false, CM: true, MOVEMENT: true, RESEARCH: false })

    const last = (await repo.chatFor(game.gameId)).at(-1)
    expect(last).toMatchObject({ kind: 'system', phase: 'TRADE', message: `Turn 1 - ${game.name2} marked trade phase not done` })
  })

  it('unmarking in a turn the player has nothing in is a 404', async () => {
    const game = await startedGame('undone-404')
    await chatOn(game)
    const response = await post(game.seat1, `/api/games/${game.gameId}/turns/undone`, { phase: 'SOT', turnNumber: 3 })
    expect(response.status).toBe(404)
    expect(await repo.chatFor(game.gameId)).toEqual([])
  })

  it('does not need to be the players turn', async () => {
    const game = await startedGame('done-any-time')
    await chatOn(game)
    // Seat 2 has neither the baton nor the turn, and can still mark
    const response = await post(game.seat2, `/api/games/${game.gameId}/turns/done`, { phase: 'SOT' })
    expect(response.status).toBe(200)
  })
})

describe('an ended game', () => {
  it('refuses orders and done markers for players and still lets an admin act', async () => {
    const game = await startedGame('ended')
    await chatOn(game)
    await post(game.seat1, `/api/games/${game.gameId}/turns/done`, { phase: 'SOT' })
    const ended = await post(game.seat1, `/api/games/${game.gameId}/end`, { winner: game.name2 })
    expect(ended.status).toBe(200)
    const revision = (await repo.findGame(game.gameId))?.rev
    const rowsBefore = (await repo.chatFor(game.gameId)).length

    for (const [path, payload] of [
      ['turns/order', { phase: 'SOT', markdown: 'too late' }],
      ['turns/done', { phase: 'TRADE' }],
      ['turns/undone', { phase: 'SOT' }],
    ] as const) {
      const response = await post(game.seat2, `/api/games/${game.gameId}/${path}`, payload)
      expect(response.status).toBe(409)
      expect(JSON.parse(response.body)).toMatchObject({ error: 'GAME_ENDED' })
    }
    expect((await repo.findGame(game.gameId))?.rev).toBe(revision)
    expect(await repo.chatFor(game.gameId)).toHaveLength(rowsBefore)

    // The admin role can still switch the setting
    const admin = await registerAdmin('ended-admin')
    expect((await post(admin, `/api/admin/games/${game.gameId}/chat-orders`, { enabled: false })).status).toBe(200)
  })
})

describe('GET /chat with chat orders off', () => {
  it('is the plain array it has always been, with only plain chat in it', async () => {
    const game = await startedGame('classic-chat')
    await post(game.seat1, `/api/games/${game.gameId}/chat`, { message: 'hello' })
    // Rows a game with chat orders on would have written, present while it is off
    await repo.appendChat(row('o1', game.gameId, { kind: 'order', turnNumber: 1, phase: 'SOT', message: 'an order' }))
    await repo.appendChat(row('s1', game.gameId, { kind: 'system', turnNumber: 1, phase: 'SOT', message: 'a system line' }))

    const response = await get(game.seat2, `/api/games/${game.gameId}/chat`)
    const body = await response.json<Record<string, unknown>[]>()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(1)
    expect(Object.keys(body[0] ?? {})).toEqual(['id', 'gameId', 'username', 'message', 'createdAt'])
    expect(body[0]).toMatchObject({ message: 'hello', username: game.name1 })
  })

  it('switching chat orders off shows the chat again and loses no rows', async () => {
    const game = await startedGame('roundtrip')
    await chatOn(game)
    await post(game.seat1, `/api/games/${game.gameId}/chat`, { message: 'talk' })
    await post(game.seat1, `/api/games/${game.gameId}/turns/order`, { phase: 'SOT', markdown: 'order' })
    const admin = await registerAdmin('roundtrip-admin')
    await post(admin, `/api/admin/games/${game.gameId}/chat-orders`, { enabled: false })
    expect(await (await get(game.seat2, `/api/games/${game.gameId}/chat`)).json<{ message: string }[]>()).toHaveLength(1)
    await post(admin, `/api/admin/games/${game.gameId}/chat-orders`, { enabled: true })
    expect((await timeline(game.seat2, game.gameId)).messages.map((message) => message.message)).toEqual(['talk', 'order'])
  })
})

describe('GET /chat with chat orders on', () => {
  it('answers a page with hasMore, and a chat row is kind chat with no tags', async () => {
    const game = await startedGame('page-shape')
    await chatOn(game)
    const posted = await post(game.seat1, `/api/games/${game.gameId}/chat`, { message: 'hi' })
    expect(await posted.json()).toMatchObject({ kind: 'chat', turnNumber: null, phase: null })

    const page = await timeline(game.seat2, game.gameId)
    expect(page.hasMore).toBe(false)
    expect(page.messages).toHaveLength(1)
    expect(page.messages[0]).toMatchObject({ kind: 'chat', message: 'hi', turnNumber: null, phase: null })
  })

  it('returns the whole current turn, and before= returns the previous turn', async () => {
    const game = await startedGame('paging')
    await chatOn(game)
    // Turn 1: 40 rows, turn 2: 45 rows, all far more than the 30 minimum
    for (let index = 0; index < 40; index += 1) {
      await repo.appendChat(row(`t1-${index}`, game.gameId, { kind: 'order', turnNumber: 1, phase: 'SOT' }))
    }
    // Finish turn 1 for both, so the current turn is 2 (writes 2 system rows into turn 1)
    for (const token of [game.seat1, game.seat2]) {
      await post(token, `/api/games/${game.gameId}/turns/done`, { phase: 'RESEARCH', turnNumber: 1 })
    }
    for (let index = 0; index < 45; index += 1) {
      await repo.appendChat(row(`t2-${index}`, game.gameId, { kind: 'order', turnNumber: 2, phase: 'SOT' }))
    }

    const current = await timeline(game.seat1, game.gameId)
    expect(current.messages).toHaveLength(45)
    expect(current.messages.every((message) => message.turnNumber === 2)).toBe(true)
    expect(current.hasMore).toBe(true)

    const first = current.messages[0]?.id as string
    const previous = await timeline(game.seat1, game.gameId, `?before=${first}`)
    // 40 seeded rows plus the two done rows
    expect(previous.messages).toHaveLength(42)
    expect(previous.messages.every((message) => message.turnNumber === 1)).toBe(true)
    expect(previous.hasMore).toBe(false)

    const missing = await get(game.seat1, `/api/games/${game.gameId}/chat?before=nope`)
    expect(missing.status).toBe(400)
  })

  it('a young turn still gets at least the 30 newest rows', async () => {
    const game = await startedGame('min-page')
    await chatOn(game)
    for (let index = 0; index < 50; index += 1) {
      await repo.appendChat(row(`old-${index}`, game.gameId))
    }
    await repo.appendChat(row('order-now', game.gameId, { kind: 'order', turnNumber: 1, phase: 'SOT' }))

    const page = await timeline(game.seat1, game.gameId)
    expect(page.messages).toHaveLength(30)
    expect(page.messages.at(-1)?.id).toBe('order-now')
    expect(page.hasMore).toBe(true)
  })
})

describe('timelinePage', () => {
  const rows = (turns: readonly (number | null)[]): readonly ChatMessage[] =>
    turns.map((turnNumber, index) => row(`r${index}`, 'g', { turnNumber }))

  it('starts at the first row of the current turn when that is more than 30 rows back from the end', () => {
    const many = rows([null, 1, 1, ...Array.from({ length: 35 }, () => 2)])
    const page = timelinePage(many, 2, undefined)
    expect(page?.messages).toHaveLength(35)
    expect(page?.hasMore).toBe(true)
  })

  it('an empty timeline is an empty page', () => {
    expect(timelinePage([], 1, undefined)).toEqual({ messages: [], hasMore: false })
  })

  it('walks back one turn at a time and ends at the first row', () => {
    const many = rows([null, 1, 1, 2, 2, 3])
    const turn3 = timelinePage(many, 3, undefined)
    // fewer than 30 rows in all, so the page is everything
    expect(turn3).toEqual({ messages: many, hasMore: false })

    expect(timelinePage(many, 3, 'r5')?.messages.map((message) => message.id)).toEqual(['r3', 'r4'])
    expect(timelinePage(many, 3, 'r3')?.messages.map((message) => message.id)).toEqual(['r1', 'r2'])
    const last = timelinePage(many, 3, 'r1')
    expect(last?.messages.map((message) => message.id)).toEqual(['r0'])
    expect(last?.hasMore).toBe(false)
    expect(timelinePage(many, 3, 'r0')).toEqual({ messages: [], hasMore: false })
  })
})

describe('chat row kinds in storage', () => {
  it('the JSON store reads an old file with rows that have no kind', async () => {
    const created = await createTestApp()
    // A repository over a file holding an old-format chat row
    const { mkdtemp, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const directory = await mkdtemp(join(tmpdir(), 'civ-chat-'))
    const path = join(directory, 'state.json')
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        players: [],
        games: [],
        chat: [{ id: 'old', gameId: 'g', username: 'a', message: 'old row', createdAt: '2020-01-01T00:00:00.000Z' }],
      }),
      'utf8',
    )
    const legacy = new JsonFileRepository({ filePath: path })
    await legacy.load()
    expect(await legacy.chatFor('g')).toEqual([
      { id: 'old', gameId: 'g', username: 'a', message: 'old row', createdAt: '2020-01-01T00:00:00.000Z', kind: 'chat', turnNumber: null, phase: null },
    ])
    await legacy.flush()
    expect(created.repo).toBeDefined()
  })

  it('D1 reads a row written before the migration as chat, and round-trips the new kinds', async () => {
    const adapter = await createD1Adapter(readMigrations())
    try {
      const d1 = new D1Repository(adapter.db)
      // The column list an old release used: the new columns take their defaults
      await adapter.db
        .prepare(`INSERT INTO chat (id, game_id, username, message, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind('old', 'g', 'a', 'old row', '2020-01-01T00:00:00.000Z')
        .run()
      await d1.appendChat(row('new', 'g', { kind: 'order', turnNumber: 4, phase: 'CM', message: 'an order', createdAt: '2020-01-01T12:00:00.000Z' }))
      // Plain chat with no timeline fields, as older callers send it
      await d1.appendChat({ id: 'plain', gameId: 'g', username: 'a', message: 'plain', createdAt: '2020-01-02T00:00:00.000Z' })

      const rows = await d1.chatFor('g')
      expect(rows.map((entry) => [entry.id, entry.kind, entry.turnNumber, entry.phase])).toEqual([
        ['old', 'chat', null, null],
        ['new', 'order', 4, 'CM'],
        ['plain', 'chat', null, null],
      ])
    } finally {
      adapter.close()
    }
  })

  it('an unknown kind or phase in a stored row reads as chat and no phase', async () => {
    const adapter = await createD1Adapter(readMigrations())
    try {
      await adapter.db
        .prepare(`INSERT INTO chat (id, game_id, username, message, created_at, kind, phase) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind('odd', 'g', 'a', 'x', '2020-01-01T00:00:00.000Z', 'weird', 'NOPE')
        .run()
      expect((await new D1Repository(adapter.db).chatFor('g'))[0]).toMatchObject({ kind: 'chat', phase: null })
    } finally {
      adapter.close()
    }
  })
})

describe('out-of-turn draws through the API', () => {
  it('with chat orders on, the non-holder needs confirmedOutOfTurn and the holder does not', async () => {
    const game = await startedGame('draws-on')
    await chatOn(game)
    const url = `/api/games/${game.gameId}/draw/CIV`

    const refused = await post(game.seat2, url)
    expect(refused.status).toBe(403)
    expect(JSON.parse(refused.body)).toMatchObject({ error: 'NOT_YOUR_TURN' })
    expect((await post(game.seat2, url, { confirmedOutOfTurn: 'true' })).status).toBe(403)
    expect((await post(game.seat2, url, { confirmedOutOfTurn: true })).status).toBe(200)

    // Seat 1 is the holder, whether or not it also has the classic baton
    expect((await post(game.seat1, url)).status).toBe(200)
  })

  it('with chat orders off it is refused as before, confirmation or not', async () => {
    const game = await startedGame('draws-off')
    const url = `/api/games/${game.gameId}/draw/CIV`
    expect((await post(game.seat2, url, { confirmedOutOfTurn: true })).status).toBe(403)
    expect((await post(game.seat2, url)).status).toBe(403)
    expect((await post(game.seat1, url)).status).toBe(200)
  })

  it('a wonder draw follows the same rule', async () => {
    const game = await startedGame('wonder-on')
    await chatOn(game)
    const url = `/api/games/${game.gameId}/draw/ANCIENT_WONDERS`
    expect((await post(game.seat2, url)).status).toBe(403)
    expect((await post(game.seat2, url, { confirmedOutOfTurn: true })).status).toBe(200)
  })
})

describe('hidden information with chat orders on', () => {
  it('an opponent sees flags and published orders but not the private log, note or an unpublished draft', async () => {
    const game = await startedGame('leak')
    await chatOn(game)
    await post(game.seat1, `/api/games/${game.gameId}/draw/CULTURE_1`)
    await post(game.seat1, `/api/games/${game.gameId}/note`, { note: 'NOTE-SECRET' })
    await post(game.seat1, `/api/games/${game.gameId}/turns/update`, { turnNumber: 1, phase: 'CM', order: 'DRAFT-SECRET' })
    await post(game.seat1, `/api/games/${game.gameId}/turns/order`, { phase: 'SOT', markdown: 'public order' })
    await post(game.seat1, `/api/games/${game.gameId}/turns/done`, { phase: 'SOT' })

    const state = await repo.findGame(game.gameId)
    const privateLog = state?.log.find((entry) => entry.item !== null)?.privateLog
    expect(privateLog).toBeTruthy()

    const seen = await get(game.seat2, `/api/games/${game.gameId}/state`)
    expect(seen.body).not.toContain('NOTE-SECRET')
    expect(seen.body).not.toContain('DRAFT-SECRET')
    expect(seen.body).not.toContain(privateLog as string)
    const view = JSON.parse(seen.body) as PlayerView
    expect(view.chatOrders).toBe(true)
    expect(view.activeTurn?.waitingFor?.length).toBeGreaterThan(0)
    expect(seen.body).toContain('public order')

    // Neither does the timeline carry them
    const page = await timeline(game.seat2, game.gameId)
    expect(JSON.stringify(page)).not.toContain('NOTE-SECRET')
    expect(JSON.stringify(page)).not.toContain('DRAFT-SECRET')
    expect(JSON.stringify(page)).not.toContain(privateLog as string)
  })
})
