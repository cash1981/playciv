/**
 * Chat orders (issue #215), slice 3 on the server: the turn row, the start
 * player marker through the admin switch, and the mail to a new turn holder.
 * New in the port, so there is no Java counterpart.
 */

import type { GameState, PlayerView } from '@civ/engine'
import { markPhasesDone, turnHolder, unwrap } from '@civ/engine'
import { beforeEach, describe, expect, it } from 'vitest'

import type { App } from '../src/app.js'
import { createTestApp } from '../src/app.js'
import type { Mailer, OutgoingEmail } from '../src/mail.js'
import { IN_GAME_COOLDOWN_MS, createNotifications } from '../src/notifications.js'
import type { JsonFileRepository } from '../src/store/json-file.js'
import type { ChatMessage } from '../src/store/types.js'
import { bearer, inject } from './helpers.js'

class FakeMailer implements Mailer {
  readonly sent: OutgoingEmail[] = []
  async send(email: OutgoingEmail): Promise<void> {
    this.sent.push(email)
  }
}

let app: App
let repo: JsonFileRepository
let mailer: FakeMailer
let now: Date

beforeEach(async () => {
  mailer = new FakeMailer()
  now = new Date('2026-09-29T12:00:00.000Z')
  const created = await createTestApp({ mailer, appOrigin: 'https://playciv.app', now: () => now })
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
  /** Tokens by seat: index 0 is seat 1. Seats are shuffled when the last player joins. */
  readonly seats: readonly { readonly token: string; readonly username: string; readonly id: string }[]
  readonly admin: string
}

async function threePlayerGame(name: string): Promise<Table> {
  const accounts = await Promise.all(['a', 'b', 'c'].map((letter) => register(`${name}-${letter}`)))
  const [first] = accounts
  if (first === undefined) throw new Error('no accounts')
  const created = await post(first.token, '/api/games', { name, numOfPlayers: 3 })
  const gameId = (await created.json() as { id: string }).id
  for (const account of accounts.slice(1)) {
    expect((await post(account.token, `/api/games/${gameId}/join`)).status).toBe(200)
  }
  const game = await loadGame(gameId)
  const seats = [...game.players]
    .sort((a, b) => a.playernumber - b.playernumber)
    .map((player) => {
      const account = accounts.find((candidate) => candidate.id === player.playerId)
      if (account === undefined) throw new Error('unknown seat')
      return { token: account.token, username: player.username, id: player.playerId }
    })
  const admin = await register(`${name}-admin`)
  const promoted = await repo.updatePlayer(admin.id, { role: 'admin' })
  expect(promoted).not.toBeUndefined()
  return { gameId, seats, admin: admin.token }
}

async function loadGame(gameId: string): Promise<GameState> {
  const game = await repo.findGame(gameId)
  if (game === undefined) throw new Error(`no game ${gameId}`)
  return game
}

const switchOn = async (table: Table): Promise<void> => {
  expect((await post(table.admin, `/api/admin/games/${table.gameId}/chat-orders`, { enabled: true })).status).toBe(200)
}

const done = (table: Table, seat: number, phase: string, turnNumber?: number) => {
  const who = table.seats[seat]
  if (who === undefined) throw new Error(`no seat ${seat}`)
  return post(who.token, `/api/games/${table.gameId}/turns/done`, {
    phase,
    ...(turnNumber === undefined ? {} : { turnNumber }),
  })
}

/** Everyone, in seat order, marks Research (and so everything) done. */
async function finishTurn(table: Table, turnNumber: number): Promise<void> {
  for (const seat of [0, 1, 2]) {
    expect((await done(table, seat, 'RESEARCH', turnNumber)).status).toBe(200)
  }
}

const rowsOf = (gameId: string): Promise<readonly ChatMessage[]> => repo.chatFor(gameId)

const markerOwner = (view: PlayerView): string | undefined => {
  const piece = view.board.pieces.find((candidate) => candidate.assetId === 'markers/startplayer')
  const area = view.boardAreas.find(
    (candidate) =>
      piece !== undefined &&
      piece.x + piece.width / 2 >= candidate.x &&
      piece.x + piece.width / 2 < candidate.x + candidate.width &&
      piece.y + piece.height / 2 >= candidate.y &&
      piece.y + piece.height / 2 < candidate.y + candidate.height,
  )
  return area?.username
}

describe('the admin switch and the start player marker', () => {
  it('switching on puts the marker in seat 1\'s area and names them as the starter', async () => {
    const table = await threePlayerGame('marker')
    const seat1 = table.seats[0]
    if (seat1 === undefined) throw new Error('no seat 1')
    expect((await loadGame(table.gameId)).board.pieces.some((piece) => piece.assetId === 'markers/startplayer')).toBe(false)

    await switchOn(table)

    const view = await (await inject(app, { method: 'GET', url: `/api/games/${table.gameId}`, headers: bearer(seat1.token) })).json<PlayerView>()
    expect(markerOwner(view)).toBe(seat1.username)
    expect(view.activeTurn?.startPlayer).toBe(seat1.username)
  })

  it('a game that never switches it on has no marker and no start player in the view', async () => {
    const table = await threePlayerGame('never-on')
    const seat2 = table.seats[1]
    if (seat2 === undefined) throw new Error('no seat 2')
    const view = await (await inject(app, { method: 'GET', url: `/api/games/${table.gameId}`, headers: bearer(seat2.token) })).json<PlayerView>()
    expect(view.board.pieces.some((piece) => piece.assetId === 'markers/startplayer')).toBe(false)
    expect(view.activeTurn).not.toHaveProperty('startPlayer')
  })
})

describe('the row that starts a turn', () => {
  it('is written when the last player finishes Research, tagged with the new turn', async () => {
    const table = await threePlayerGame('turn-row')
    await switchOn(table)
    const seat2 = table.seats[1]
    if (seat2 === undefined) throw new Error('no seat 2')

    await finishTurn(table, 1)

    const rows = await rowsOf(table.gameId)
    const dones = rows.filter((row) => row.turnNumber === 1)
    expect(dones).toHaveLength(3)
    const started = rows.filter((row) => row.turnNumber === 2)
    expect(started).toHaveLength(1)
    expect(started[0]).toMatchObject({
      kind: 'system',
      phase: 'SOT',
      message: `Turn 2: ${seat2.username} starts with the Start of turn phase`,
    })
    // It comes straight after the row that finished the turn
    expect(rows.at(-1)).toBe(started[0])
    expect(rows.at(-2)?.message).toContain('marked all phases up to research done')

    const view = await (await inject(app, { method: 'GET', url: `/api/games/${table.gameId}`, headers: bearer(seat2.token) })).json<PlayerView>()
    expect(view.activeTurn).toMatchObject({ turnNumber: 2, startPlayer: seat2.username })
    expect(markerOwner(view)).toBe(seat2.username)
  })

  it('takes the divider text from the engine line straight after the done line', async () => {
    const table = await threePlayerGame('turn-line')
    await switchOn(table)
    await finishTurn(table, 1)

    const lines = (await loadGame(table.gameId)).log.map((entry) => entry.publicLog)
    const lastDone = lines.findLastIndex((line) => line.includes('marked all phases up to research done'))
    const startLine = lines[lastDone + 1]
    expect(startLine).toMatch(/^Turn 2: .* starts with the Start of turn phase$/)
    // Nothing follows it, and the two rows are those two lines in that order
    expect(lines).toHaveLength(lastDone + 2)
    const rows = await rowsOf(table.gameId)
    expect(rows.at(-2)?.message).toBe(lines[lastDone])
    expect(rows.at(-1)?.message).toBe(startLine)
  })

  it('splits the paged timeline exactly at that row', async () => {
    const table = await threePlayerGame('turn-page')
    await switchOn(table)
    const seat1 = table.seats[0]
    if (seat1 === undefined) throw new Error('no seat 1')
    await post(seat1.token, `/api/games/${table.gameId}/chat`, { message: 'talk in turn 1' })
    await finishTurn(table, 1)
    await post(seat1.token, `/api/games/${table.gameId}/chat`, { message: 'talk in turn 2' })
    const page = (extra = '') =>
      inject(app, { method: 'GET', url: `/api/games/${table.gameId}/chat?paged=1${extra}`, headers: bearer(seat1.token) })
        .then((response) => response.json<{ messages: ChatMessage[]; hasMore: boolean }>())

    const current = await page()
    const divider = current.messages.find((row) => row.turnNumber === 2)
    expect(divider?.message).toMatch(/^Turn 2: .* starts with the Start of turn phase$/)
    expect(current.messages.at(-1)?.message).toBe('talk in turn 2')

    // The turn before ends right where the divider begins
    const before = await page(`&before=${divider?.id ?? ''}`)
    expect(before.messages.some((row) => row.turnNumber === 2)).toBe(false)
    expect(before.messages.at(-1)?.message).toContain('marked all phases up to research done')
    // Chat has no turn tag, so a turn's page begins at its first tagged row
    expect(before.messages.filter((row) => row.turnNumber === 1)).toHaveLength(3)
  })

  it('is not written a second time when Research is unmarked and marked again', async () => {
    const table = await threePlayerGame('turn-twice')
    await switchOn(table)
    await finishTurn(table, 1)
    const last = table.seats[2]
    if (last === undefined) throw new Error('no seat 3')

    expect((await post(last.token, `/api/games/${table.gameId}/turns/undone`, { phase: 'RESEARCH', turnNumber: 1 })).status).toBe(200)
    expect((await done(table, 2, 'RESEARCH', 1)).status).toBe(200)

    const rows = await rowsOf(table.gameId)
    expect(rows.filter((row) => row.turnNumber === 2)).toHaveLength(1)
    // Two dones by the last player, one unmark, all tagged turn 1
    expect(rows.filter((row) => row.message.includes('not done'))).toHaveLength(1)
  })

  it('is not written for a done that leaves the turn open', async () => {
    const table = await threePlayerGame('turn-open')
    await switchOn(table)
    expect((await done(table, 0, 'RESEARCH', 1)).status).toBe(200)
    expect((await rowsOf(table.gameId)).map((row) => row.turnNumber)).toEqual([1])
  })
})

describe('the mail to a new turn holder', () => {
  const mailsTo = (username: string): OutgoingEmail[] =>
    mailer.sent.filter((mail) => mail.to === `${username}@example.com`)

  it('goes to the new holder only, and only when the holder changes', async () => {
    const table = await threePlayerGame('holder-mail')
    await switchOn(table)
    const [one, two, three] = table.seats
    if (one === undefined || two === undefined || three === undefined) throw new Error('no seats')
    mailer.sent.length = 0

    // Seat 1 holds the turn; finishing Start of turn hands it to seat 2
    await done(table, 0, 'SOT')
    expect(mailsTo(two.username)).toHaveLength(1)
    expect(mailsTo(two.username)[0]).toMatchObject({ subject: 'It is your turn' })
    expect(mailsTo(two.username)[0]?.text).toContain('It is your turn: start of turn, turn 1')
    expect(mailsTo(two.username)[0]?.text).toContain(`https://playciv.app/game/${table.gameId}`)
    expect(mailer.sent).toHaveLength(1)

    // Seat 3 finishing it too leaves seat 2 the holder: no mail
    await done(table, 2, 'SOT')
    expect(mailer.sent).toHaveLength(1)

    // Seat 2 finishing hands the next phase to seat 1, who started the turn
    await done(table, 1, 'SOT')
    expect(mailsTo(one.username)).toHaveLength(1)
    expect(mailsTo(one.username)[0]?.text).toContain('It is your turn: trade, turn 1')
    expect(mailer.sent).toHaveLength(2)
  })

  it('names the next turn and its starter when the turn rolls over', async () => {
    const table = await threePlayerGame('holder-roll')
    await switchOn(table)
    const two = table.seats[1]
    if (two === undefined) throw new Error('no seat 2')
    await done(table, 0, 'RESEARCH', 1)
    await done(table, 1, 'RESEARCH', 1)
    // Seat 2 was mailed when seat 1 finished; let the 30 minute limit pass
    now = new Date(now.getTime() + IN_GAME_COOLDOWN_MS + 1)
    mailer.sent.length = 0

    await done(table, 2, 'RESEARCH', 1)

    // Turn 2 starts with seat 2, who was not the holder of turn 1's last phase (seat 3)
    expect(mailsTo(two.username)).toHaveLength(1)
    expect(mailsTo(two.username)[0]?.text).toContain('It is your turn: start of turn, turn 2')
  })

  it('shares the 30 minute limit of the other in-game mail', async () => {
    const table = await threePlayerGame('holder-throttle')
    await switchOn(table)
    const before = await loadGame(table.gameId)
    const after = unwrap(markPhasesDone(before, { playerId: table.seats[0]?.id ?? '', turnNumber: 1, upToPhase: 'SOT' }))
    const notifications = createNotifications({ repo, mailer, appOrigin: 'https://playciv.app', now: () => now })
    mailer.sent.length = 0

    await notifications.turnHolderChanged(before, after)
    await notifications.turnHolderChanged(before, after)
    expect(mailer.sent).toHaveLength(1)

    now = new Date(now.getTime() + IN_GAME_COOLDOWN_MS + 1)
    await notifications.turnHolderChanged(before, after)
    expect(mailer.sent).toHaveLength(2)
  })

  it('sends nothing when the holder is the same or chat orders is off', async () => {
    const table = await threePlayerGame('holder-none')
    const notifications = createNotifications({ repo, mailer, appOrigin: 'https://playciv.app', now: () => now })
    const off = await loadGame(table.gameId)
    mailer.sent.length = 0
    await notifications.turnHolderChanged(off, off)
    expect(mailer.sent).toHaveLength(0)

    await switchOn(table)
    const on = await loadGame(table.gameId)
    expect(turnHolder(on)?.playerId).toBe(table.seats[0]?.id)
    await notifications.turnHolderChanged(on, on)
    expect(mailer.sent).toHaveLength(0)
  })
})
