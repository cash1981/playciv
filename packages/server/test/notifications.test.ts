/**
 * Email notifications (issue #30). Ports of Java's `SendEmail` call sites:
 * `PlayerAction.endTurn`, `GameAction.{createNewGame,joinGame,endGame,
 * deleteGame,addChat}` and `TurnAction.update*`.
 *
 * Every test drives the app through `app.request` with a fake mailer, so no
 * provider is ever contacted. The one exception is the new-game broadcast: the
 * route fires it in the background, so that test calls the notification service
 * directly to avoid racing it.
 */

import type { GameState } from '@civ/engine'
import type { App } from '../src/app.js'
import { beforeEach, describe, expect, it } from 'vitest'

import { createTestApp } from '../src/app.js'
import type { Mailer, OutgoingEmail } from '../src/mail.js'
import {
  GLOBAL_COOLDOWN_MS,
  IN_GAME_COOLDOWN_MS,
  createNotifications,
} from '../src/notifications.js'
import type { JsonFileRepository } from '../src/store/json-file.js'
import { inject, bearer } from './helpers.js'

class FakeMailer implements Mailer {
  readonly sent: OutgoingEmail[] = []
  fail = false

  async send(email: OutgoingEmail): Promise<void> {
    if (this.fail) throw new Error('provider is down')
    this.sent.push(email)
  }

  subjects(subject: string): OutgoingEmail[] {
    return this.sent.filter((mail) => mail.subject === subject)
  }
}

let app: App
let repo: JsonFileRepository
let mailer: FakeMailer
let now: Date

beforeEach(async () => {
  mailer = new FakeMailer()
  now = new Date('2026-09-19T12:00:00.000Z')
  const created = await createTestApp({
    mailer,
    appOrigin: 'https://playciv.app',
    now: () => now,
  })
  app = created.app
  repo = created.repo
})

async function register(username: string): Promise<{ token: string; id: string }> {
  const response = await inject(app, {
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hemmelig', email: `${username}@example.com` },
  })
  expect(response.status).toBe(201)
  const body = (await response.json()) as { token: string; player: { id: string } }
  return { token: body.token, id: body.player.id }
}

async function createGame(token: string, name: string, numOfPlayers = 3): Promise<string> {
  const response = await inject(app, {
    method: 'POST',
    url: '/api/games',
    headers: bearer(token),
    payload: { name, numOfPlayers },
  })
  expect(response.status).toBe(201)
  return ((await response.json()) as { id: string }).id
}

async function join(token: string, gameId: string): Promise<void> {
  const response = await inject(app, {
    method: 'POST',
    url: `/api/games/${gameId}/join`,
    headers: bearer(token),
    payload: {},
  })
  expect(response.status).toBe(200)
}

async function loadGame(gameId: string): Promise<GameState> {
  const state = await repo.findGame(gameId)
  if (state === undefined) throw new Error(`game ${gameId} not found`)
  return state
}

/** A started two-player game: the creator plus one joiner. */
async function startedGame(
  name: string,
): Promise<{ gameId: string; starter: { token: string; id: string }; waiting: string }> {
  const creator = await register(`${name}-a`)
  const gameId = await createGame(creator.token, name, 2)
  const other = await register(`${name}-b`)
  await join(other.token, gameId)

  const state = await loadGame(gameId)
  const waitingName = state.players.find((player) => !player.yourTurn)?.username
  if (waitingName === undefined) throw new Error('no waiting player')

  return { gameId, starter: creator, waiting: waitingName }
}

describe('your turn', () => {
  it('emails the next player with Java\'s subject and link when a turn ends', async () => {
    const { gameId, starter, waiting } = await startedGame('turn')
    mailer.sent.length = 0

    const response = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/endturn`,
      headers: bearer(starter.token),
      payload: {},
    })
    expect(response.status).toBe(200)

    expect(mailer.sent).toHaveLength(1)
    const mail = mailer.sent[0]
    expect(mail?.to).toBe(`${waiting}@example.com`)
    expect(mail?.subject).toBe('It is your turn')
    expect(mail?.text).toContain(`It's your turn to play in turn!`)
    expect(mail?.text).toContain(`https://playciv.app/game/${gameId}`)
    // Issue #30 puts the unsubscribe link on every mail, including this one.
    expect(mail?.text).toContain('/api/admin/email/notification/')
  })

  it('sends nothing on the take-turn button', async () => {
    const { gameId, starter } = await startedGame('take')
    mailer.sent.length = 0

    const response = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/taketurn`,
      headers: bearer(starter.token),
      payload: {},
    })
    expect(response.status).toBe(200)
    expect(mailer.sent).toHaveLength(0)
  })

  it('a failing provider never fails the turn', async () => {
    const { gameId, starter } = await startedGame('broken')
    mailer.sent.length = 0
    mailer.fail = true

    const response = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/endturn`,
      headers: bearer(starter.token),
      payload: {},
    })
    expect(response.status).toBe(200)
    mailer.fail = false
  })
})

describe('join, end and delete', () => {
  it('emails the other players when someone joins', async () => {
    const creator = await register('join-mail-a')
    const gameId = await createGame(creator.token, 'join mail', 3)
    mailer.sent.length = 0

    const other = await register('join-mail-b')
    await join(other.token, gameId)

    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0]?.to).toBe('join-mail-a@example.com')
    expect(mailer.sent[0]?.subject).toBe('Game update')
    expect(mailer.sent[0]?.text).toContain('join-mail-b joined join mail.')
  })

  it('emails every player when the game ends', async () => {
    const { gameId, starter } = await startedGame('ended')
    mailer.sent.length = 0

    const response = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/end`,
      headers: bearer(starter.token),
      payload: {},
    })
    expect(response.status).toBe(200)

    const ended = mailer.subjects('Game ended')
    expect(ended).toHaveLength(2)
    expect(ended.map((mail) => mail.to).sort()).toEqual([
      'ended-a@example.com',
      'ended-b@example.com',
    ])
    expect(ended[0]?.text).toContain('ended has ended. I hope you enjoyed playing.')
  })

  it('emails every player when the game is deleted', async () => {
    const { gameId, starter } = await startedGame('deleted')
    mailer.sent.length = 0

    const response = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/delete`,
      headers: bearer(starter.token),
      payload: {},
    })
    expect(response.status).toBe(204)
    expect(mailer.subjects('Game deleted')).toHaveLength(2)
  })
})

describe('chat', () => {
  it('emails the other players, at most once per 30 minutes for the same game', async () => {
    const creator = await register('chat-a')
    const gameId = await createGame(creator.token, 'chat mail', 3)
    const other = await register('chat-b')
    await join(other.token, gameId)
    mailer.sent.length = 0

    const post = (message: string) =>
      inject(app, {
        method: 'POST',
        url: `/api/games/${gameId}/chat`,
        headers: bearer(creator.token),
        payload: { message },
      })

    await post('first message')
    expect(mailer.subjects('New Chat')).toHaveLength(1)
    expect(mailer.subjects('New Chat')[0]?.to).toBe('chat-b@example.com')
    expect(mailer.subjects('New Chat')[0]?.text).toContain('first message')

    // Still inside the window: Java's `shouldSendEmailInGame` suppresses it.
    await post('second message')
    expect(mailer.subjects('New Chat')).toHaveLength(1)

    now = new Date(now.getTime() + IN_GAME_COOLDOWN_MS + 60_000)
    await post('third message')
    expect(mailer.subjects('New Chat')).toHaveLength(2)
  })
})

describe('turn-phase updates', () => {
  it("emails the others with Java's subject and excludes the author", async () => {
    const creator = await register('phase-a')
    const gameId = await createGame(creator.token, 'phase mail', 3)
    const other = await register('phase-b')
    await join(other.token, gameId)
    mailer.sent.length = 0

    const response = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/turns/update`,
      headers: bearer(creator.token),
      payload: { phase: 'SOT', turnNumber: 1, order: 'build a temple' },
    })
    expect(response.status).toBe(200)

    const mails = mailer.subjects('Start of turn updated')
    expect(mails).toHaveLength(1)
    expect(mails[0]?.to).toBe('phase-b@example.com')
    // Java's start-of-turn body put the newline before the colon.
    expect(mails[0]?.text).toContain(
      'phase-a has updated start of turn with the following order\n:build a temple.',
    )
  })

  it('uses the trade subject and body for the trade phase', async () => {
    const creator = await register('trade-a')
    const gameId = await createGame(creator.token, 'trade mail', 3)
    const other = await register('trade-b')
    await join(other.token, gameId)
    mailer.sent.length = 0

    await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/turns/update`,
      headers: bearer(creator.token),
      payload: { phase: 'TRADE', turnNumber: 1, order: 'trade silk' },
    })

    const mails = mailer.subjects('Trade updated')
    expect(mails).toHaveLength(1)
    expect(mails[0]?.text).toContain(
      'trade-a has updated trade with the following order:\ntrade silk.',
    )
  })
})

describe('unsubscribe', () => {
  it('stops every notification once the stop link is followed', async () => {
    const { gameId, starter, waiting } = await startedGame('unsub')
    const state = await loadGame(gameId)
    const waitingPlayer = state.players.find((player) => player.username === waiting)
    if (waitingPlayer === undefined) throw new Error('no waiting player')

    // No Authorization header: the link in a mail cannot carry a token.
    const stop = await inject(app, {
      method: 'GET',
      url: `/api/admin/email/notification/${waitingPlayer.playerId}/stop`,
    })
    expect(stop.status).toBe(200)
    expect(stop.body).toContain('no longer get anymore emails')

    mailer.sent.length = 0
    await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/endturn`,
      headers: bearer(starter.token),
      payload: {},
    })
    expect(mailer.sent).toHaveLength(0)

    const start = await inject(app, {
      method: 'GET',
      url: `/api/admin/email/notification/${waitingPlayer.playerId}/start`,
    })
    expect(start.status).toBe(200)
    expect((await repo.findPlayerById(waitingPlayer.playerId))?.disableEmail).toBe(false)
  })

  it('answers 400 for an unknown player', async () => {
    const response = await inject(app, {
      method: 'GET',
      url: '/api/admin/email/notification/does-not-exist/stop',
    })
    expect(response.status).toBe(400)
  })
})

describe('new-game broadcast', () => {
  it('is off unless it is switched on', async () => {
    const creator = await register('broadcast-off')
    await createGame(creator.token, 'broadcast off', 3)
    // The route fires this in the background; being off, it resolves with
    // nothing, so a short tick is enough to prove no mail appears.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(mailer.subjects('New Civilization game created')).toHaveLength(0)
  })

  it('emails every account, throttled to once per three hours', async () => {
    const creator = await register('broadcast-on-a')
    await register('broadcast-on-b')
    const gameId = await createGame(creator.token, 'broadcast on', 3)
    const state = await loadGame(gameId)

    const broadcastMailer = new FakeMailer()
    const notifications = createNotifications({
      repo,
      mailer: broadcastMailer,
      appOrigin: 'https://playciv.app',
      broadcastNewGames: true,
      now: () => now,
    })

    await notifications.gameCreated(state)
    expect(broadcastMailer.subjects('New Civilization game created')).toHaveLength(2)
    expect(broadcastMailer.sent[0]?.text).toContain(
      'A new game by the name broadcast on was just created!',
    )

    // Inside the three-hour global window, Java suppressed it per account.
    await notifications.gameCreated(state)
    expect(broadcastMailer.subjects('New Civilization game created')).toHaveLength(2)

    now = new Date(now.getTime() + GLOBAL_COOLDOWN_MS + 60_000)
    await notifications.gameCreated(state)
    expect(broadcastMailer.subjects('New Civilization game created')).toHaveLength(4)
  })
})
