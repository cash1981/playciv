/**
 * API tests that run against the app in memory through `app.request`, with
 * no network involved.
 *
 * The last test plays a whole round: four players register, create and join a
 * game, draw cards, choose a technology, write turn orders, vote on an undo and
 * end the game.
 */

import type { App } from '../src/app.js'
import type { Db } from 'mongodb'
import { beforeEach, describe, expect, it } from 'vitest'

import { itemName } from '@civ/engine'
import { createTestApp } from '../src/app.js'
import { JsonFileRepository } from '../src/store/json-file.js'
import { MongoRepository } from '../src/store/mongo.js'
import { inject } from './helpers.js'

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
    payload: {
      username,
      password: 'hemmelig',
      email: `${username}@example.com`,
      securityAnswer: 'writing',
    },
  })
  expect(response.status).toBe(201)
  return (await response.json() as { token: string }).token
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

async function createGame(token: string, name: string, numOfPlayers = 4): Promise<string> {
  const response = await inject(app, {
    method: 'POST',
    url: '/api/games',
    headers: bearer(token),
    payload: { name, numOfPlayers },
  })
  expect(response.status).toBe(201)
  return (await response.json() as { id: string }).id
}

/**
 * A started two-player game, and the token of whoever got the turn.
 *
 * Java allows 2 to 5 players (`@Min(2) @Max(5)`), and who begins is settled by
 * a shuffle when the last player joins — so the starter has to be looked up
 * rather than assumed.
 */
async function startedGame(
  name: string,
): Promise<{ gameId: string; starter: string; waiting: string }> {
  const creator = await register(`${name}-a`)
  const gameId = await createGame(creator, name, 2)
  const other = await register(`${name}-b`)

  const join = await inject(app, {
    method: 'POST',
    url: `/api/games/${gameId}/join`,
    headers: bearer(other),
    payload: {},
  })
  expect(join.status).toBe(200)

  const state = await repo.findGame(gameId)
  const starterName = state?.players.find((player) => player.yourTurn)?.username
  const starter = starterName === `${name}-a` ? creator : other

  return { gameId, starter, waiting: starter === creator ? other : creator }
}

describe('health', () => {
  it('answers ok', async () => {
    const response = await inject(app, { method: 'GET', url: '/api/health' })
    expect(await response.json()).toEqual({ status: 'ok' })
  })
})

describe('public landing endpoints', () => {
  it('serve anonymous public data without hidden game information', async () => {
    const { gameId, starter } = await startedGame('Public landing')
    const drawn = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/draw/CULTURE_1`,
      headers: bearer(starter),
      payload: {},
    })
    expect(drawn.status).toBe(200)

    const state = await repo.findGame(gameId)
    const card = state?.players.find((player) => player.yourTurn)?.items[0]
    expect(card).toBeDefined()
    const cardName = card === undefined ? undefined : itemName(card)
    const drawLog = state?.log.find(
      (entry) => entry.item !== null && itemName(entry.item) === cardName,
    )
    expect(drawLog?.privateLog).toBeTruthy()

    const [games, scores, chat] = await Promise.all([
      inject(app, { method: 'GET', url: '/api/public/games' }),
      inject(app, { method: 'GET', url: '/api/highscore' }),
      inject(app, { method: 'GET', url: '/api/chat' }),
    ])

    for (const response of [games, scores, chat]) {
      expect(response.status).toBe(200)
      expect(response.body).not.toContain('"items"')
      expect(response.body).not.toContain('"privateLog"')
      expect(response.body).not.toContain(cardName as string)
      expect(response.body).not.toContain(drawLog?.privateLog as string)
    }

    const authenticatedGames = await inject(app, {
      method: 'GET',
      url: '/api/public/games',
      headers: bearer(starter),
    })
    const matchingGame = (await authenticatedGames.json() as { id: string; youAreIn: boolean }[])
      .find((game) => game.id === gameId)
    expect(matchingGame?.youAreIn).toBe(true)
  })

  it('limits anonymous lobby chat to the latest two weeks and 50 messages', async () => {
    const now = Date.now()
    await repo.appendChat({
      id: 'old-chat',
      gameId: null,
      username: 'old-user',
      message: 'too old',
      createdAt: new Date(now - 15 * 24 * 60 * 60 * 1000).toISOString(),
    })
    for (let index = 0; index < 51; index += 1) {
      await repo.appendChat({
        id: `recent-chat-${index}`,
        gameId: null,
        username: 'recent-user',
        message: `recent ${index}`,
        createdAt: new Date(now - (50 - index) * 1000).toISOString(),
      })
    }

    const response = await inject(app, { method: 'GET', url: '/api/chat' })
    expect(response.status).toBe(200)
    const messages = await response.json() as { message: string }[]
    expect(messages).toHaveLength(50)
    expect(messages[0]?.message).toBe('recent 0')
    expect(messages.at(-1)?.message).toBe('recent 49')
    expect(response.body).not.toContain('too old')
  })
})

describe('auth', () => {
  it('registers and logs in', async () => {
    await register('cash1981')

    const login = await inject(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'cash1981', password: 'hemmelig' },
    })
    expect(login.status).toBe(200)
    expect((await login.json() as { player: { username: string } }).player.username).toBe('cash1981')
  })

  it('refuses a wrong password', async () => {
    await register('cash1981')
    const login = await inject(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'cash1981', password: 'feil' },
    })
    expect(login.status).toBe(401)
  })

  it('refuses an unknown user with the same answer as a wrong password', async () => {
    const login = await inject(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'finnesikke', password: 'hemmelig' },
    })
    expect(login.status).toBe(401)
  })

  it('the same username cannot be taken twice', async () => {
    await register('cash1981')
    const again = await inject(app, {
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'CASH1981', password: 'hemmelig', securityAnswer: 'writing' },
    })
    expect(again.status).toBe(409)
  })

  it('never stores the password in the clear, and never sends the hash out', async () => {
    const token = await register('cash1981')
    const me = await inject(app, { method: 'GET', url: '/api/auth/me', headers: bearer(token) })

    expect(JSON.stringify(await me.json())).not.toContain('hemmelig')
    expect(await me.json()).not.toHaveProperty('passwordHash')

    const stored = await repo.findPlayerByUsername('cash1981')
    expect(stored?.passwordHash).not.toContain('hemmelig')
  })

  it('routes without a token give 401', async () => {
    const response = await inject(app, { method: 'GET', url: '/api/games' })
    expect(response.status).toBe(401)
  })

  it('an invalid token gives 401', async () => {
    const response = await inject(app, {
      method: 'GET',
      url: '/api/games',
      headers: bearer('tull.tull'),
    })
    expect(response.status).toBe(401)
  })
})

describe('games', () => {
  it('the creator becomes the first player', async () => {
    const token = await register('cash1981')
    const gameId = await createGame(token, 'First game')

    const game = await inject(app, {
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: bearer(token),
    })
    const view = await game.json() as {
      you: { username: string; gameCreator: boolean; color: string | null } | null
    }
    expect(view.you?.username).toBe('cash1981')
    expect(view.you?.gameCreator).toBe(true)
    // Java created the game and then joined the creator, which is what hands
    // out a colour. Seating them directly left the creator without one, and a
    // player with no colour has no leader marker for the culture track.
    expect(view.you?.color).toBe('Green')
  })

  it('two games cannot share a name', async () => {
    const token = await register('cash1981')
    await createGame(token, 'Duplikat')
    const again = await inject(app, {
      method: 'POST',
      url: '/api/games',
      headers: bearer(token),
      payload: { name: 'Duplikat', numOfPlayers: 4 },
    })
    expect(again.status).toBe(409)
  })

  it('the game starts when the last player joins', async () => {
    const creator = await register('cash1981')
    const gameId = await createGame(creator, 'Startspill', 2)

    const other = await register('Karandras1')
    const join = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/join`,
      headers: bearer(other),
      payload: {},
    })
    expect(join.status).toBe(200)

    const state = await repo.findGame(gameId)
    expect(state?.players.filter((player) => player.yourTurn)).toHaveLength(1)
  })

  it('the creator can delete an active game', async () => {
    const creator = await register('delete-creator-active')
    const gameId = await createGame(creator, 'Delete active')

    const deleted = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/delete`,
      headers: bearer(creator),
      payload: {},
    })

    expect(deleted.status).toBe(204)
    expect(await repo.findGame(gameId)).toBeUndefined()
  })

  it('the creator can delete an ended game', async () => {
    const creator = await register('delete-creator-ended')
    const gameId = await createGame(creator, 'Delete ended')
    const ended = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/end`,
      headers: bearer(creator),
      payload: {},
    })
    expect(ended.status).toBe(200)

    const deleted = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/delete`,
      headers: bearer(creator),
      payload: {},
    })

    expect(deleted.status).toBe(204)
    expect(await repo.findGame(gameId)).toBeUndefined()
  })

  it('admin can open and delete a game without joining it', async () => {
    const creator = await register('delete-admin-creator')
    const admin = await register('admin')
    const adminPlayer = await repo.findPlayerByUsername('admin')
    expect(adminPlayer).toBeDefined()
    await repo.updatePlayer(adminPlayer?.id as string, { role: 'admin' })
    const gameId = await createGame(creator, 'Delete by admin')

    const opened = await inject(app, {
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: bearer(admin),
    })
    expect(opened.status).toBe(200)
    expect((await opened.json() as { you: unknown }).you).toBeNull()

    const deleted = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/delete`,
      headers: bearer(admin),
      payload: {},
    })

    expect(deleted.status).toBe(204)
    expect(await repo.findGame(gameId)).toBeUndefined()
  })

  it('a non-owner cannot delete a game and the game remains', async () => {
    const creator = await register('delete-owner')
    const other = await register('delete-other')
    const gameId = await createGame(creator, 'Delete forbidden')

    const forbidden = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/delete`,
      headers: bearer(other),
      payload: {},
    })

    expect(forbidden.status).toBe(403)
    expect(await repo.findGame(gameId)).toBeDefined()
  })

  it('deleting a missing game returns 404', async () => {
    const token = await register('delete-missing')
    const response = await inject(app, {
      method: 'POST',
      url: '/api/games/missing/delete',
      headers: bearer(token),
      payload: {},
    })

    expect(response.status).toBe(404)
  })

  it('a full game turns further players away', async () => {
    const creator = await register('cash1981')
    const gameId = await createGame(creator, 'Fullt', 2)
    await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/join`,
      headers: bearer(await register('Karandras1')),
      payload: {},
    })

    const third = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/join`,
      headers: bearer(await register('Itchi')),
      payload: {},
    })
    expect(third.status).toBe(400)
    expect((await third.json() as { error: string }).error).toBe('GAME_IS_FULL')
  })

  /**
   * A withdrawn player is no longer `hasUserAccess` (issue #79's bug report):
   * they should still be able to look at the game and its history afterwards,
   * the same read-only way any other non-member can (issue #81), rather than
   * getting a 403 from routes that used to require membership.
   */
  it('lets a withdrawn player keep viewing the game, read-only', async () => {
    const creator = await register('withdraw-owner')
    const gameId = await createGame(creator, 'Withdraw and watch', 2)
    const leaver = await register('withdraw-leaver')
    await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/join`,
      headers: bearer(leaver),
      payload: {},
    })

    const withdrawn = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/withdraw`,
      headers: bearer(leaver),
      payload: {},
    })
    expect(withdrawn.status).toBe(200)

    for (const url of [
      `/api/games/${gameId}`,
      `/api/games/${gameId}/revisions`,
    ]) {
      const response = await inject(app, { url, headers: bearer(leaver) })
      expect(response.status).toBe(200)
    }
    const view = await (await inject(app, {
      url: `/api/games/${gameId}`,
      headers: bearer(leaver),
    })).json() as { you: unknown }
    expect(view.you).toBeNull()
  })

  /** issue #81: watching a game needs no account at all. */
  it('lets an anonymous visitor read a game and its history, but not act on it', async () => {
    const creator = await register('spectate-owner')
    const gameId = await createGame(creator, 'Spectate me', 2)

    const game = await inject(app, { url: `/api/games/${gameId}` })
    expect(game.status).toBe(200)
    expect((await game.json() as { you: unknown }).you).toBeNull()

    const revisions = await inject(app, { url: `/api/games/${gameId}/revisions` })
    expect(revisions.status).toBe(200)

    const withdraw = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/withdraw`,
      payload: {},
    })
    expect(withdraw.status).toBe(401)
  })

  /**
   * A present-but-bad token must not be silently downgraded to "no account":
   * that would hide a real player's expired session behind what looks like
   * their own game turning read-only (issue #81 review finding).
   */
  it('still gives 401 for a garbled token on a read-only route, rather than treating it as a spectator', async () => {
    const creator = await register('badtoken-owner')
    const gameId = await createGame(creator, 'Bad token', 2)

    const response = await inject(app, {
      url: `/api/games/${gameId}`,
      headers: bearer('tull.tull'),
    })
    expect(response.status).toBe(401)
  })
})

describe('draws', () => {
  it('whoever has the turn may draw, and the card lands hidden in the hand', async () => {
    const creator = await register('cash1981')
    const gameId = await createGame(creator, 'Trekkspill', 2)
    const other = await register('Karandras1')
    await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/join`,
      headers: bearer(other),
      payload: {},
    })

    const state = await repo.findGame(gameId)
    const starter = state?.players.find((player) => player.yourTurn)
    const starterToken = starter?.username === 'cash1981' ? creator : other

    const drawn = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/draw/HUTS`,
      headers: bearer(starterToken),
      payload: {},
    })
    expect(drawn.status).toBe(200)

    const view = await drawn.json() as { you: { items: { sheetName: string; hidden: boolean }[] } }
    expect(view.you.items).toHaveLength(1)
    expect(view.you.items[0]?.sheetName).toBe('HUTS')
    expect(view.you.items[0]?.hidden).toBe(true)
  })

  it('whoever does not have the turn gets 403', async () => {
    const creator = await register('cash1981')
    const gameId = await createGame(creator, 'Turspill', 2)
    const other = await register('Karandras1')
    await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/join`,
      headers: bearer(other),
      payload: {},
    })

    const state = await repo.findGame(gameId)
    const waiting = state?.players.find((player) => !player.yourTurn)
    const waitingToken = waiting?.username === 'cash1981' ? creator : other

    const drawn = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/draw/HUTS`,
      headers: bearer(waitingToken),
      payload: {},
    })
    expect(drawn.status).toBe(403)
    expect((await drawn.json() as { error: string }).error).toBe('NOT_YOUR_TURN')
  })

  it('an unknown sheet name gives 400', async () => {
    const { gameId, starter: token } = await startedGame('Arkspill')
    const drawn = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/draw/SJAKKBRIKKER`,
      headers: bearer(token),
      payload: {},
    })
    expect(drawn.status).toBe(400)
  })

  it('technologies cannot be drawn', async () => {
    const { gameId, starter: token } = await startedGame('Techspill')
    const drawn = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/draw/LEVEL_1_TECH`,
      headers: bearer(token),
      payload: {},
    })
    expect(drawn.status).toBe(400)
    expect((await drawn.json() as { error: string }).error).toBe('TECHS_ARE_CHOSEN_NOT_DRAWN')
  })

  it('a drawn wonder lands on the shared board, not in the hand', async () => {
    const { gameId, starter: token } = await startedGame('Underspill')
    const drawn = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/draw/ANCIENT_WONDERS`,
      headers: bearer(token),
      payload: {},
    })
    expect(drawn.status).toBe(200)

    const view = await drawn.json() as {
      you: { items: unknown[] }
      board: { pieces: { category: string }[] }
      boardAreas: { username: string }[]
    }
    // Not in the hand
    expect(view.you.items).toHaveLength(0)
    // On the board, in the shared Wonders area
    expect(view.board.pieces.filter((piece) => piece.category === 'wonder')).toHaveLength(1)
    expect(view.boardAreas.some((area) => area.username === 'Wonders')).toBe(true)
  })

  it('a wonder draw is turn-gated like any other draw', async () => {
    // A wonder goes to the board rather than the hand, but drawing one is still
    // a draw: the player who does not have the turn is refused.
    const { gameId, waiting: token } = await startedGame('Underspill2')
    const drawn = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/draw/ANCIENT_WONDERS`,
      headers: bearer(token),
      payload: {},
    })
    expect(drawn.status).toBe(403)
    expect((await drawn.json() as { error: string }).error).toBe('NOT_YOUR_TURN')
  })
})

describe('loot', () => {
  it.each(['CULTURE_1', 'CULTURE_2', 'CULTURE_3'] as const)(
    'maps Culture Card to a combined pool containing %s',
    async (sheetName) => {
      // Java: `DrawResourceTest.testLooting` sends the literal Culture Card,
      // which `DrawResource.loot` maps to `SheetName.CULTURE_CARD`.
      const { gameId, starter } = await startedGame(`Loot combined ${sheetName}`)
      const before = await repo.findGame(gameId)
      const from = before?.players.find((player) => player.yourTurn)
      const to = before?.players.find((player) => !player.yourTurn)
      expect(from).toBeDefined()
      expect(to).toBeDefined()

      const drawn = await inject(app, {
        method: 'POST',
        url: `/api/games/${gameId}/draw/${sheetName}`,
        headers: bearer(starter),
        payload: {},
      })
      expect(drawn.status).toBe(200)

      const looted = await inject(app, {
        method: 'POST',
        url: `/api/games/${gameId}/loot/CULTURE_CARD/${to?.playerId ?? ''}`,
        headers: bearer(starter),
        payload: {},
      })
      expect(looted.status).toBe(200)

      const after = await repo.findGame(gameId)
      const fromAfter = after?.players.find((player) => player.playerId === from?.playerId)
      const toAfter = after?.players.find((player) => player.playerId === to?.playerId)
      expect(fromAfter?.items.filter((item) => item.sheetName === sheetName)).toHaveLength(0)
      expect(toAfter?.items.filter((item) => item.sheetName === sheetName)).toHaveLength(1)
    },
  )

  it('accepts explicit culture sheets as singleton loot pools', async () => {
    const { gameId, starter } = await startedGame('Loot explicit culture')
    const before = await repo.findGame(gameId)
    const from = before?.players.find((player) => player.yourTurn)
    const to = before?.players.find((player) => !player.yourTurn)
    expect(from).toBeDefined()
    expect(to).toBeDefined()

    for (const sheetName of ['CULTURE_1', 'CULTURE_2', 'CULTURE_3'] as const) {
      const drawn = await inject(app, {
        method: 'POST',
        url: `/api/games/${gameId}/draw/${sheetName}`,
        headers: bearer(starter),
        payload: {},
      })
      expect(drawn.status).toBe(200)
    }

    const looted = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/loot/CULTURE_1/${to?.playerId ?? ''}`,
      headers: bearer(starter),
      payload: {},
    })
    expect(looted.status).toBe(200)

    const after = await repo.findGame(gameId)
    const fromAfter = after?.players.find((player) => player.playerId === from?.playerId)
    const toAfter = after?.players.find((player) => player.playerId === to?.playerId)
    expect(fromAfter?.items.filter((item) => item.sheetName === 'CULTURE_1')).toHaveLength(0)
    expect(fromAfter?.items.filter((item) => item.sheetName === 'CULTURE_2')).toHaveLength(1)
    expect(fromAfter?.items.filter((item) => item.sheetName === 'CULTURE_3')).toHaveLength(1)
    expect(toAfter?.items.filter((item) => item.sheetName === 'CULTURE_1')).toHaveLength(1)
    expect(toAfter?.items.filter((item) => item.sheetName === 'CULTURE_2')).toHaveLength(0)
    expect(toAfter?.items.filter((item) => item.sheetName === 'CULTURE_3')).toHaveLength(0)
  })

  it('passes a valid non-lootable sheet to the reducer', async () => {
    // Java: `DrawResourceTest.testThatYouCannotLootInvalidItem` expects 406.
    const { gameId, starter } = await startedGame('Loot artillery')
    const before = await repo.findGame(gameId)
    const to = before?.players.find((player) => !player.yourTurn)
    expect(to).toBeDefined()

    const drawn = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/draw/ARTILLERY`,
      headers: bearer(starter),
      payload: {},
    })
    expect(drawn.status).toBe(200)

    const looted = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/loot/ARTILLERY/${to?.playerId ?? ''}`,
      headers: bearer(starter),
      payload: {},
    })
    expect(looted.status).toBe(406)
    expect(await looted.json()).toMatchObject({ error: 'ITEM_NOT_LOOTABLE' })
  })

  it('returns 404 for an unknown loot sheet', async () => {
    // Java: `DrawResourceTest.testThatYouCannotDrawInvalidSheet` expects 404.
    const { gameId, starter } = await startedGame('Loot unknown')
    const before = await repo.findGame(gameId)
    const to = before?.players.find((player) => !player.yourTurn)
    expect(to).toBeDefined()

    const response = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/loot/foobar/${to?.playerId ?? ''}`,
      headers: bearer(starter),
      payload: {},
    })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: 'ITEM_NOT_FOUND',
      message: 'Could not find item foobar',
    })
  })

  it('keeps Huts and Villages as separate loot pools', async () => {
    const { gameId, starter } = await startedGame('Loot tokens')
    const before = await repo.findGame(gameId)
    const from = before?.players.find((player) => player.yourTurn)
    const to = before?.players.find((player) => !player.yourTurn)
    expect(from).toBeDefined()
    expect(to).toBeDefined()

    for (const sheetName of ['HUTS', 'VILLAGES'] as const) {
      const drawn = await inject(app, {
        method: 'POST',
        url: `/api/games/${gameId}/draw/${sheetName}`,
        headers: bearer(starter),
        payload: {},
      })
      expect(drawn.status).toBe(200)
    }

    const looted = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/loot/HUTS/${to?.playerId ?? ''}`,
      headers: bearer(starter),
      payload: {},
    })
    expect(looted.status).toBe(200)

    const after = await repo.findGame(gameId)
    const fromAfter = after?.players.find((player) => player.playerId === from?.playerId)
    const toAfter = after?.players.find((player) => player.playerId === to?.playerId)
    expect(fromAfter?.items.filter((item) => item.sheetName === 'HUTS')).toHaveLength(0)
    expect(fromAfter?.items.filter((item) => item.sheetName === 'VILLAGES')).toHaveLength(1)
    expect(toAfter?.items.filter((item) => item.sheetName === 'HUTS')).toHaveLength(1)
    expect(toAfter?.items.filter((item) => item.sheetName === 'VILLAGES')).toHaveLength(0)
  })
})

describe('hidden information over HTTP', () => {
  it('an opponent sees the number of cards, not their contents', async () => {
    const creator = await register('cash1981')
    const gameId = await createGame(creator, 'Skjultspill', 2)
    const other = await register('Karandras1')
    await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/join`,
      headers: bearer(other),
      payload: {},
    })

    const state = await repo.findGame(gameId)
    const starter = state?.players.find((player) => player.yourTurn)
    const starterToken = starter?.username === 'cash1981' ? creator : other
    const otherToken = starterToken === creator ? other : creator

    await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/draw/CULTURE_1`,
      headers: bearer(starterToken),
      payload: {},
    })

    // What the player who drew sees
    const own = await inject(app, {
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: bearer(starterToken),
    })
    const ownView = await own.json() as { you: { items: { name: string }[] } }
    const cardName = ownView.you.items[0]?.name
    expect(cardName).toBeDefined()

    // What the opponent sees
    const theirs = await inject(app, {
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: bearer(otherToken),
    })
    const body = theirs.body
    expect(body).not.toContain(cardName as string)

    const theirView = await theirs.json() as {
      opponents: { numberOfItemsInHand: number }[]
    }
    expect(theirView.opponents[0]?.numberOfItemsInHand).toBe(1)
  })

  it('the public log does not give the card away', async () => {
    const { gameId, starter: token } = await startedGame('Loggspill')
    await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/draw/CULTURE_1`,
      headers: bearer(token),
      payload: {},
    })

    const state = await repo.findGame(gameId)
    const card = state?.players[0]?.items[0]
    expect(card).toBeDefined()

    const log = await inject(app, {
      method: 'GET',
      url: `/api/games/${gameId}/log/public`,
      headers: bearer(token),
    })
    expect(log.body).not.toContain((card as { name: string }).name)
    expect(log.body).toContain('CultureI')
  })
})

describe('global game revisions', () => {
  it('lets only one of two mutations from the same revision commit', async () => {
    const { gameId, starter } = await startedGame('Revision race')
    const before = await repo.findGame(gameId)
    expect(before).toBeDefined()
    if (before === undefined) throw new Error('started game was not stored')

    const originalSave = repo.saveGameWithRevision.bind(repo)
    let arrivals = 0
    let release: (() => void) | undefined
    const bothArrived = new Promise<void>((resolve) => { release = resolve })
    repo.saveGameWithRevision = async (...args) => {
      arrivals += 1
      if (arrivals === 2) release?.()
      await bothArrived
      return originalSave(...args)
    }

    const responses = await Promise.all([
      inject(app, {
        method: 'POST',
        url: `/api/games/${gameId}/endturn`,
        headers: bearer(starter),
        payload: {},
      }),
      inject(app, {
        method: 'POST',
        url: `/api/games/${gameId}/endturn`,
        headers: bearer(starter),
        payload: {},
      }),
    ])

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
    const after = await repo.findGame(gameId)
    expect(after?.rev).toBe(before.rev + 1)
    const revisions = await repo.listGameRevisions(gameId)
    expect(revisions.filter((revision) => revision.revision === before.rev + 1)).toHaveLength(1)
  })

  it('does not let a private note overwrite a concurrent shared mutation', async () => {
    const { gameId, starter } = await startedGame('Note revision race')
    const before = await repo.findGame(gameId)
    expect(before).toBeDefined()
    if (before === undefined) throw new Error('started game was not stored')

    const originalPrivateSave = repo.saveGameIfRevision.bind(repo)
    const originalSharedSave = repo.saveGameWithRevision.bind(repo)
    let arrivals = 0
    let release: (() => void) | undefined
    const bothArrived = new Promise<void>((resolve) => { release = resolve })
    const waitForBoth = async (): Promise<void> => {
      arrivals += 1
      if (arrivals === 2) release?.()
      await bothArrived
    }
    repo.saveGameIfRevision = async (...args) => {
      await waitForBoth()
      return originalPrivateSave(...args)
    }
    repo.saveGameWithRevision = async (...args) => {
      await waitForBoth()
      return originalSharedSave(...args)
    }

    const [note, shared] = await Promise.all([
      inject(app, {
        method: 'POST',
        url: `/api/games/${gameId}/note`,
        headers: bearer(starter),
        payload: { note: 'must not replace the turn change' },
      }),
      inject(app, {
        method: 'POST',
        url: `/api/games/${gameId}/endturn`,
        headers: bearer(starter),
        payload: {},
      }),
    ])

    expect([note.status, shared.status].sort()).toEqual([200, 409])
    expect((await repo.findGame(gameId))?.rev).toBe(before.rev + 1)
    if (shared.status === 200) {
      const latest = (await repo.listGameRevisions(gameId)).at(-1)
      expect(latest?.revision).toBe(before.rev + 1)
      expect(latest?.state.players.find((player) => player.yourTurn)?.playerId)
        .not.toBe(before.players.find((player) => player.yourTurn)?.playerId)
    }
  })

  it('refuses revisioned Mongo writes without a transaction-capable client', async () => {
    const creator = await register('mongo-transaction-owner')
    const gameId = await createGame(creator, 'Mongo transaction requirement', 2)
    const game = await repo.findGame(gameId)
    const revision = (await repo.listGameRevisions(gameId))[0]
    expect(game).toBeDefined()
    expect(revision).toBeDefined()
    if (game === undefined || revision === undefined) throw new Error('game fixture was not stored')

    const db = { collection: () => ({}) } as unknown as Db
    const mongo = new MongoRepository(db)
    await expect(mongo.saveGameWithRevision(game, revision, game.rev)).rejects.toThrow(
      'revisioned writes require a transaction-capable MongoClient',
    )
    await expect(mongo.deleteGame(game.id)).rejects.toThrow(
      'revisioned writes require a transaction-capable MongoClient',
    )
  })

  it('stores creation and exactly one revision for each shared mutation, but not notes or chat', async () => {
    const creator = await register('revision-owner')
    const gameId = await createGame(creator, 'Revision ledger', 2)

    const initial = await repo.listGameRevisions(gameId)
    expect(initial.map((entry) => entry.revision)).toEqual([0])

    await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/note`,
      headers: bearer(creator),
      payload: { note: 'private planning only' },
    })
    await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/chat`,
      headers: bearer(creator),
      payload: { message: 'outside history' },
    })
    const afterPrivateWrites = await repo.listGameRevisions(gameId)
    expect(afterPrivateWrites).toHaveLength(1)
    expect(JSON.stringify(afterPrivateWrites)).not.toContain('private planning only')

    const other = await register('revision-other')
    const joined = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/join`,
      headers: bearer(other),
      payload: {},
    })
    expect(joined.status).toBe(200)

    const revisions = await repo.listGameRevisions(gameId)
    expect(revisions).toHaveLength(2)
    expect(JSON.stringify(revisions)).not.toContain('private planning only')
    expect(revisions[1]?.revision).toBe((await repo.findGame(gameId))?.rev)
    expect(revisions[1]?.state.players).toHaveLength(2)
  })

  it('authorizes against current membership and projects each historical viewer separately', async () => {
    const creator = await register('history-alice')
    const gameId = await createGame(creator, 'Private history', 2)
    const other = await register('history-bob')
    await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/join`,
      headers: bearer(other),
      payload: {},
    })
    const outsider = await register('history-mallory')
    const state = await repo.findGame(gameId)
    const owner = state?.players.find((entry) => entry.yourTurn)
    expect(owner).toBeDefined()
    const ownerToken = owner?.username === 'history-alice' ? creator : other
    const viewerToken = ownerToken === creator ? other : creator

    const drawn = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/draw/CULTURE_1`,
      headers: bearer(ownerToken),
      payload: {},
    })
    expect(drawn.status).toBe(200)
    const afterDraw = await repo.findGame(gameId)
    const secretCard = afterDraw?.players.find((entry) => entry.yourTurn)?.items[0]
    const secretLog = afterDraw?.log.find((entry) => entry.item?.id === secretCard?.id)?.privateLog
    expect(secretCard).toBeDefined()
    expect(secretLog).toBeTruthy()

    const availableTechs = await inject(app, {
      url: `/api/games/${gameId}/techs/available`,
      headers: bearer(ownerToken),
    })
    const secretTech = (await availableTechs.json<{ name: string }[]>())[0]?.name
    expect(secretTech).toBeDefined()
    expect((await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/techs/choose`,
      headers: bearer(ownerToken),
      payload: { name: secretTech },
    })).status).toBe(200)
    const policies = await inject(app, {
      url: `/api/games/${gameId}/socialpolicies`,
      headers: bearer(ownerToken),
    })
    const secretPolicy = (await policies.json<{ name: string }[]>())[0]?.name
    expect(secretPolicy).toBeDefined()
    expect((await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/socialpolicy/choose`,
      headers: bearer(ownerToken),
      payload: { name: secretPolicy },
    })).status).toBe(200)
    const withSecrets = await repo.findGame(gameId)
    const secretOwner = withSecrets?.players.find((entry) => entry.playerId === owner?.playerId)
    const secretTechId = secretOwner?.techsChosen[0]?.id
    const secretPolicyId = secretOwner?.socialPolicies[0]?.id
    expect(secretTechId).toBeDefined()
    expect(secretPolicyId).toBeDefined()

    const list = await inject(app, {
      url: `/api/games/${gameId}/revisions`,
      headers: bearer(ownerToken),
    })
    expect(list.status).toBe(200)
    expect(list.body).not.toContain('"state"')
    expect(list.body).not.toContain('privateDescriptions')
    const summaries = await list.json<{ revision: number }[]>()
    const latest = summaries.at(-1)?.revision
    expect(latest).toBeDefined()

    const own = await inject(app, {
      url: `/api/games/${gameId}/revisions/${latest}`,
      headers: bearer(ownerToken),
    })
    const otherView = await inject(app, {
      url: `/api/games/${gameId}/revisions/${latest}`,
      headers: bearer(viewerToken),
    })
    expect(own.status).toBe(200)
    expect(otherView.status).toBe(200)
    expect(own.body).toContain(secretCard?.id as string)
    expect(own.body).toContain(secretLog as string)
    expect(otherView.body).not.toContain(secretCard?.id as string)
    expect(otherView.body).not.toContain(secretLog as string)
    expect(otherView.body).not.toContain('private planning only')
    const ownPayload = await own.json<{
      view: { you: { techsChosen: { id: string }[]; socialPolicies: { id: string }[] } }
    }>()
    expect(ownPayload.view.you.techsChosen[0]?.id).toBe(secretTechId)
    expect(ownPayload.view.you.socialPolicies[0]?.id).toBe(secretPolicyId)
    const otherPayload = await otherView.json<{
      view: { opponents: Record<string, unknown>[] }
    }>()
    const opaqueOwner = otherPayload.view.opponents.find(
      (entry) => entry['playerId'] === owner?.playerId,
    )
    expect(opaqueOwner).toBeDefined()
    expect(opaqueOwner).not.toHaveProperty('techsChosen')
    expect(opaqueOwner).not.toHaveProperty('socialPolicies')

    // A non-member is a spectator, not an intruder (issue #81): the routes
    // answer 200, projected the same way an opponent's view already is above.
    for (const url of [
      `/api/games/${gameId}/revisions`,
      `/api/games/${gameId}/revisions/${latest}`,
    ]) {
      const spectator = await inject(app, { url, headers: bearer(outsider) })
      expect(spectator.status).toBe(200)
      expect(spectator.body).not.toContain(secretCard?.id as string)
      expect(spectator.body).not.toContain(secretLog as string)
    }
    const anonymous = await inject(app, { url: `/api/games/${gameId}/revisions/${latest}` })
    expect(anonymous.status).toBe(200)
    expect(anonymous.body).not.toContain(secretCard?.id as string)
    expect(anonymous.body).not.toContain(secretLog as string)
    const anonymousPayload = await anonymous.json<{ view: { you: unknown } }>()
    expect(anonymousPayload.view.you).toBeNull()
  })

  it('creates a reliable baseline for an older game and deletes revisions with the game', async () => {
    const creator = await register('baseline-owner')
    const gameId = await createGame(creator, 'Baseline game', 2)
    const stored = await repo.findGame(gameId)
    expect(stored).toBeDefined()
    if (stored === undefined) throw new Error('created game was not stored')
    await repo.deleteGame(gameId)
    await repo.saveGame({ ...stored, rev: 7 })

    const listed = await inject(app, {
      url: `/api/games/${gameId}/revisions`,
      headers: bearer(creator),
    })
    expect(listed.status).toBe(200)
    expect((await listed.json<{ revision: number }[]>()).map((entry) => entry.revision)).toEqual([7])

    const deleted = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/delete`,
      headers: bearer(creator),
      payload: {},
    })
    expect(deleted.status).toBe(204)
    expect(await repo.listGameRevisions(gameId)).toEqual([])
  })

  it('does not recreate a baseline after the game is concurrently deleted', async () => {
    const creator = await register('baseline-delete-owner')
    const gameId = await createGame(creator, 'Baseline delete race', 2)
    const stored = await repo.findGame(gameId)
    expect(stored).toBeDefined()
    if (stored === undefined) throw new Error('created game was not stored')
    await repo.deleteGame(gameId)
    await repo.saveGame({ ...stored, rev: 9 })

    const originalEnsure = repo.ensureGameRevision.bind(repo)
    let resume: (() => void) | undefined
    let entered: (() => void) | undefined
    const ensureEntered = new Promise<void>((resolve) => { entered = resolve })
    const mayResume = new Promise<void>((resolve) => { resume = resolve })
    repo.ensureGameRevision = async (...args) => {
      entered?.()
      await mayResume
      return originalEnsure(...args)
    }

    const listing = inject(app, {
      url: `/api/games/${gameId}/revisions`,
      headers: bearer(creator),
    })
    await ensureEntered
    expect(await repo.deleteGame(gameId)).toBe(true)
    resume?.()

    expect((await listing).status).toBe(404)
    expect(await repo.listGameRevisions(gameId)).toEqual([])
  })
})

describe('revealed and discarded items feed', () => {
  interface RevealedEntryDto {
    readonly item: { readonly id: string; readonly sheetName: string }
    readonly username: string | null
    readonly revealed: boolean
    readonly discarded: boolean
  }
  interface RevealedPageDto {
    readonly items: RevealedEntryDto[]
    readonly total: number
    readonly page: number
    readonly size: number
  }

  async function drawAndReveal(gameId: string, token: string, sheetName: string): Promise<void> {
    await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/draw/${sheetName}`,
      headers: bearer(token),
      payload: {},
    })
    const state = await repo.findGame(gameId)
    const item = state?.players
      .flatMap((player) => player.items)
      .find((candidate) => candidate.sheetName === sheetName && candidate.hidden)
    if (item === undefined) throw new Error(`no hidden ${sheetName} to reveal`)
    await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/items/reveal`,
      headers: bearer(token),
      payload: { sheetName, itemNumber: item.itemNumber },
    })
  }

  it('pages the feed server-side and names the revealing player', async () => {
    const { gameId, starter } = await startedGame('Avslørt')
    const me = await inject(app, { method: 'GET', url: `/api/games/${gameId}`, headers: bearer(starter) })
    const myName = (await me.json() as { you: { username: string } }).you.username

    await drawAndReveal(gameId, starter, 'CULTURE_1')
    await drawAndReveal(gameId, starter, 'HUTS')

    const first = await inject(app, {
      method: 'GET',
      url: `/api/games/${gameId}/revealed?page=1&size=1`,
      headers: bearer(starter),
    })
    expect(first.status).toBe(200)
    const firstPage = await first.json() as RevealedPageDto
    expect(firstPage.total).toBe(2)
    expect(firstPage.size).toBe(1)
    expect(firstPage.page).toBe(1)
    expect(firstPage.items).toHaveLength(1)
    expect(firstPage.items[0]?.revealed).toBe(true)
    expect(firstPage.items[0]?.username).toBe(myName)

    const second = await inject(app, {
      method: 'GET',
      url: `/api/games/${gameId}/revealed?page=2&size=1`,
      headers: bearer(starter),
    })
    const secondPage = await second.json() as RevealedPageDto
    expect(secondPage.items).toHaveLength(1)
    expect(secondPage.items[0]?.item.id).not.toBe(firstPage.items[0]?.item.id)
  })

  it('does not leak a hidden hand card', async () => {
    const { gameId, starter } = await startedGame('Skjult')
    await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/draw/CULTURE_1`,
      headers: bearer(starter),
      payload: {},
    })
    const state = await repo.findGame(gameId)
    const card = state?.players.flatMap((player) => player.items).find((item) => item.hidden)
    expect(card).toBeDefined()

    const response = await inject(app, {
      method: 'GET',
      url: `/api/games/${gameId}/revealed`,
      headers: bearer(starter),
    })
    const page = await response.json() as RevealedPageDto
    expect(page.total).toBe(0)
    expect(response.body).not.toContain((card as { name: string }).name)
  })

  it('clamps an oversized page size', async () => {
    const { gameId, starter } = await startedGame('Tak')
    const response = await inject(app, {
      method: 'GET',
      url: `/api/games/${gameId}/revealed?size=9999`,
      headers: bearer(starter),
    })
    expect((await response.json() as RevealedPageDto).size).toBe(100)
  })
})

describe('storage', () => {
  it('games survive a new app against the same repository', async () => {
    const { gameId, starter: token } = await startedGame('Lagringsspill')

    // A fresh Hono app against the same repository, like a restart on the same data file
    const { createApp } = await import('../src/app.js')
    const restarted = createApp({ repo, tokenSecret: 'test-secret' })

    const game = await inject(restarted, {
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: bearer(token),
    })
    expect(game.status).toBe(200)
    expect((await game.json() as { name: string }).name).toBe('Lagringsspill')
  })
})

describe('turn membership', () => {
  it('a non-member gets 403 from endturn, a member still succeeds', async () => {
    const { gameId, starter } = await startedGame('Utenforspill')
    const outsider = await register('Utenforspill-outsider')

    const blocked = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/endturn`,
      headers: bearer(outsider),
      payload: {},
    })
    expect(blocked.status).toBe(403)
    expect((await blocked.json() as { error: string }).error).toBe('NO_ACCESS')

    const allowed = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/endturn`,
      headers: bearer(starter),
      payload: {},
    })
    expect(allowed.status).toBe(200)
  })

  it('a non-member gets 403 from taketurn, a member still succeeds', async () => {
    const { gameId, waiting } = await startedGame('Overta')
    const outsider = await register('Overta-outsider')

    const blocked = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/taketurn`,
      headers: bearer(outsider),
      payload: {},
    })
    expect(blocked.status).toBe(403)
    expect((await blocked.json() as { error: string }).error).toBe('NO_ACCESS')

    const allowed = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/taketurn`,
      headers: bearer(waiting),
      payload: {},
    })
    expect(allowed.status).toBe(200)
  })

  it('ending a turn before the game has started gives 409, not a misleading 404', async () => {
    const creator = await register('Ikkestartet')
    const gameId = await createGame(creator, 'Ikke startet', 2)

    const response = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/endturn`,
      headers: bearer(creator),
      payload: {},
    })
    expect(response.status).toBe(409)
    expect((await response.json() as { error: string }).error).toBe('GAME_NOT_STARTED')
  })
})

describe('log timestamps and order', () => {
  it('every log entry has a timestamp right after the game is created', async () => {
    const { gameId, starter } = await startedGame('Tidsstempel')

    const log = await inject(app, {
      method: 'GET',
      url: `/api/games/${gameId}/log/public`,
      headers: bearer(starter),
    })
    expect(log.status).toBe(200)
    const entries = await log.json() as { createdAt: string | null }[]
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.every((entry) => entry.createdAt !== null)).toBe(true)
  })

  it('reads newest-first even when two entries share a timestamp', async () => {
    const { gameId, starter } = await startedGame('Sammetid')

    const state = await repo.findGame(gameId)
    if (state === undefined) throw new Error('game not found')
    expect(state.log.length).toBeGreaterThanOrEqual(2)

    // Force every entry to the same timestamp, as if they had all landed in
    // the same second. A stable sort on the timestamp alone would then read
    // them back in insertion (oldest-first) order.
    const sameInstant = '2026-01-01T00:00:00.000Z'
    const stamped = {
      ...state,
      log: state.log.map((entry) => ({ ...entry, createdAt: sameInstant })),
    }
    await repo.saveGame(stamped)

    const log = await inject(app, {
      method: 'GET',
      url: `/api/games/${gameId}/log/public`,
      headers: bearer(starter),
    })
    const entries = await log.json() as { id: string }[]
    const expectedNewestFirst = state.log
      .filter((entry) => entry.publicLog !== '')
      .map((entry) => entry.id)
      .reverse()
    expect(entries.map((entry) => entry.id)).toEqual(expectedNewestFirst)
  })
})

describe('arena rev guard', () => {
  it('initiateBattle with a stale rev returns 409', async () => {
    const { gameId, starter } = await startedGame('Rev-guard')

    const response = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/battle/arena/initiate`,
      headers: bearer(starter),
      payload: { opponentId: 'barbarians', rev: 9999 },
    })
    expect(response.status).toBe(409)
    expect((await response.json() as { error: string }).error).toBe('CONFLICT')
  })
})

describe('arena place and rotate', () => {
  it('places a unit and rotates it 90 degrees through the API', async () => {
    const { gameId, starter, waiting } = await startedGame('Arena-rotate')

    const drawn = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/draw/INFANTRY`,
      headers: bearer(starter),
      payload: {},
    })
    expect(drawn.status).toBe(200)

    const battlehand = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/battle/draw`,
      headers: bearer(starter),
      payload: { numberOfUnits: 1 },
    })
    expect(battlehand.status).toBe(200)
    const battlehandView = await battlehand.json() as {
      rev: number
      you: { battlehand: { id: string; attack: number; health: number }[] }
    }
    const unit = battlehandView.you.battlehand[0]!

    // initiateBattle takes the opponent's playerId, not their token.
    const waitingView = await inject(app, {
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: bearer(waiting),
    })
    const waitingId = (await waitingView.json() as { you: { playerId: string } }).you.playerId

    const initiated = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/battle/arena/initiate`,
      headers: bearer(starter),
      payload: { opponentId: waitingId, rev: battlehandView.rev },
    })
    expect(initiated.status).toBe(200)
    const initiatedView = await initiated.json() as { rev: number }

    const placed = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/battle/arena/place`,
      headers: bearer(starter),
      payload: {
        unitId: unit.id,
        side: 'attacker',
        position: 0,
        attack: unit.attack,
        health: unit.health,
        rev: initiatedView.rev,
      },
    })
    expect(placed.status).toBe(200)
    const placedView = await placed.json() as {
      rev: number
      battle: { arena: { id: string; rotation: number }[] }
    }
    const arenaUnitId = placedView.battle.arena[0]!.id
    expect(placedView.battle.arena[0]!.rotation).toBe(0)

    const rotated = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/battle/arena/${arenaUnitId}/rotate`,
      headers: bearer(starter),
      payload: { rev: placedView.rev },
    })
    expect(rotated.status).toBe(200)
    const rotatedView = await rotated.json() as {
      battle: { arena: { rotation: number; attack: number; health: number }[] }
    }
    // Counter-clockwise: the first press goes to 270°, not 90° (issue #68).
    expect(rotatedView.battle.arena[0]!.rotation).toBe(270)
    expect(rotatedView.battle.arena[0]!.attack).toBe(unit.attack + 1)
    expect(rotatedView.battle.arena[0]!.health).toBe(unit.health + 1)
  })

  it('moves a placed unit, undoes a kill, and returns a unit to hand through the API', async () => {
    const { gameId, starter, waiting } = await startedGame('Arena-move')

    await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/draw/INFANTRY`,
      headers: bearer(starter),
      payload: {},
    })
    await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/draw/ARTILLERY`,
      headers: bearer(starter),
      payload: {},
    })
    const battlehand = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/battle/draw`,
      headers: bearer(starter),
      payload: { numberOfUnits: 2 },
    })
    const battlehandView = await battlehand.json() as {
      rev: number
      you: { battlehand: { id: string; attack: number; health: number }[] }
    }
    const [unitA, unitB] = battlehandView.you.battlehand

    const waitingView = await inject(app, {
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: bearer(waiting),
    })
    const waitingId = (await waitingView.json() as { you: { playerId: string } }).you.playerId

    const initiated = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/battle/arena/initiate`,
      headers: bearer(starter),
      payload: { opponentId: waitingId, rev: battlehandView.rev },
    })
    const initiatedView = await initiated.json() as { rev: number }

    const placedA = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/battle/arena/place`,
      headers: bearer(starter),
      payload: { unitId: unitA!.id, side: 'attacker', position: 0, attack: unitA!.attack, health: unitA!.health, rev: initiatedView.rev },
    })
    const placedAView = await placedA.json() as { rev: number; battle: { arena: { id: string }[] } }
    const arenaUnitAId = placedAView.battle.arena[0]!.id

    const placedB = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/battle/arena/place`,
      headers: bearer(starter),
      payload: { unitId: unitB!.id, side: 'attacker', position: 1, attack: unitB!.attack, health: unitB!.health, rev: placedAView.rev },
    })
    const placedBView = await placedB.json() as { rev: number; battle: { arena: { id: string; position: number }[] } }
    const arenaUnitBId = placedBView.battle.arena.find((u) => u.id !== arenaUnitAId)!.id

    // Move A to front #2.
    const moved = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/battle/arena/${arenaUnitAId}/move`,
      headers: bearer(starter),
      payload: { position: 2, rev: placedBView.rev },
    })
    expect(moved.status).toBe(200)
    const movedView = await moved.json() as { rev: number; battle: { arena: { id: string; position: number }[] } }
    expect(movedView.battle.arena.find((u) => u.id === arenaUnitAId)!.position).toBe(2)

    // Kill A, then undo the kill — it stays in the arena throughout.
    const killed = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/battle/arena/${arenaUnitAId}/kill`,
      headers: bearer(starter),
      payload: { rev: movedView.rev },
    })
    const killedView = await killed.json() as {
      rev: number
      battle: { arena: { id: string; killed: boolean }[] }
      battleSummary: { side: string; unitCount: number }[]
    }
    expect(killedView.battle.arena).toHaveLength(2)
    expect(killedView.battle.arena.find((u) => u.id === arenaUnitAId)!.killed).toBe(true)
    // The killed unit no longer counts toward the living total.
    expect(killedView.battleSummary.find((s) => s.side === 'attacker')!.unitCount).toBe(1)

    const undone = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/battle/arena/${arenaUnitAId}/kill`,
      headers: bearer(starter),
      payload: { rev: killedView.rev },
    })
    const undoneView = await undone.json() as { rev: number; battle: { arena: { id: string; killed: boolean }[] } }
    expect(undoneView.battle.arena.find((u) => u.id === arenaUnitAId)!.killed).toBe(false)

    // Return B to hand — undoes its placement.
    const returned = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/battle/arena/${arenaUnitBId}/return`,
      headers: bearer(starter),
      payload: { rev: undoneView.rev },
    })
    expect(returned.status).toBe(200)
    const returnedView = await returned.json() as {
      rev: number
      battle: { arena: { id: string }[] }
      you: { battlehand: { id: string; inBattle: boolean }[] }
    }
    expect(returnedView.battle.arena).toHaveLength(1)
    expect(returnedView.you.battlehand.find((u) => u.id === unitB!.id)?.inBattle).toBe(false)

    // Kill A again and end the battle: A's card returns to hand too, not
    // discarded — killing never auto-discards (issue #75).
    const killedAgain = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/battle/arena/${arenaUnitAId}/kill`,
      headers: bearer(starter),
      payload: { rev: returnedView.rev },
    })
    const killedAgainView = await killedAgain.json() as { rev: number }

    const ended = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/battle/arena/end`,
      headers: bearer(starter),
      payload: { rev: killedAgainView.rev },
    })
    expect(ended.status).toBe(200)
    const endedView = await ended.json() as {
      battle: unknown
      you: { battlehand: { id: string; inBattle: boolean }[]; items: { id: string; inBattle?: boolean }[] }
    }
    expect(endedView.battle).toBeNull()
    expect(endedView.you.battlehand.find((u) => u.id === unitA!.id)?.inBattle).toBe(false)
    expect(endedView.you.items.find((u) => u.id === unitA!.id)?.inBattle).toBe(false)
  })

  it('lets a new unit reinforce a front a killed unit still holds', async () => {
    const { gameId, starter, waiting } = await startedGame('Arena-reinforce')

    await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/draw/INFANTRY`,
      headers: bearer(starter),
      payload: {},
    })
    await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/draw/ARTILLERY`,
      headers: bearer(starter),
      payload: {},
    })
    const battlehand = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/battle/draw`,
      headers: bearer(starter),
      payload: { numberOfUnits: 2 },
    })
    const battlehandView = await battlehand.json() as {
      rev: number
      you: { battlehand: { id: string; attack: number; health: number }[] }
    }
    const [fallen, reinforcement] = battlehandView.you.battlehand

    const waitingView = await inject(app, {
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: bearer(waiting),
    })
    const waitingId = (await waitingView.json() as { you: { playerId: string } }).you.playerId

    const initiated = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/battle/arena/initiate`,
      headers: bearer(starter),
      payload: { opponentId: waitingId, rev: battlehandView.rev },
    })
    const initiatedView = await initiated.json() as { rev: number }

    const placedFallen = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/battle/arena/place`,
      headers: bearer(starter),
      payload: {
        unitId: fallen!.id, side: 'attacker', position: 0,
        attack: fallen!.attack, health: fallen!.health, rev: initiatedView.rev,
      },
    })
    const placedFallenView = await placedFallen.json() as { rev: number; battle: { arena: { id: string }[] } }
    const fallenArenaId = placedFallenView.battle.arena[0]!.id

    const killed = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/battle/arena/${fallenArenaId}/kill`,
      headers: bearer(starter),
      payload: { rev: placedFallenView.rev },
    })
    const killedView = await killed.json() as { rev: number }

    // Reinforce the same front (position 0) with a second unit.
    const reinforced = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/battle/arena/place`,
      headers: bearer(starter),
      payload: {
        unitId: reinforcement!.id, side: 'attacker', position: 0,
        attack: reinforcement!.attack, health: reinforcement!.health, rev: killedView.rev,
      },
    })
    expect(reinforced.status).toBe(200)
    const reinforcedView = await reinforced.json() as {
      rev: number
      battle: { arena: { id: string; unit: { id: string }; killed: boolean; position: number }[] }
      you: { battlehand: { id: string; inBattle: boolean }[]; items: { id: string; inBattle?: boolean }[] }
    }

    // One live unit on that front — the fallen one is gone, not stacked.
    expect(reinforcedView.battle.arena).toHaveLength(1)
    expect(reinforcedView.battle.arena[0]!.unit.id).toBe(reinforcement!.id)
    expect(reinforcedView.battle.arena[0]!.position).toBe(0)
    expect(reinforcedView.battle.arena[0]!.killed).toBe(false)

    // The fallen card stays locked (not discarded, not yet back in hand)
    // for the rest of the battle — reinforcing a front does not free up
    // what it displaces (issue #75's chosen design).
    expect(reinforcedView.you.battlehand.find((u) => u.id === fallen!.id)?.inBattle).toBe(true)
    expect(reinforcedView.you.items.find((u) => u.id === fallen!.id)?.inBattle).toBe(true)

    // Ending the battle finally frees it, same as any other unit.
    const ended = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/battle/arena/end`,
      headers: bearer(starter),
      payload: { rev: reinforcedView.rev },
    })
    expect(ended.status).toBe(200)
    const endedView = await ended.json() as {
      you: { battlehand: { id: string; inBattle: boolean }[] }
    }
    expect(endedView.you.battlehand.find((u) => u.id === fallen!.id)?.inBattle).toBe(false)
  })
})

/** A whole round through the API, as a smoke test for the entire stack. */
describe('a whole round', () => {
  it('four players play through setup, draws, turns and an undo', async () => {
    const tokens: Record<string, string> = {}
    for (const username of ['cash1981', 'Karandras1', 'Itchi', 'Chul']) {
      tokens[username] = await register(username)
    }
    const creatorToken = tokens['cash1981'] as string

    const gameId = await createGame(creatorToken, 'Full runde', 4)
    for (const username of ['Karandras1', 'Itchi', 'Chul']) {
      const join = await inject(app, {
        method: 'POST',
        url: `/api/games/${gameId}/join`,
        headers: bearer(tokens[username] as string),
        payload: {},
      })
      expect(join.status).toBe(200)
    }

    // Who starts is random, so find out
    let state = await repo.findGame(gameId)
    const starterName = state?.players.find((player) => player.yourTurn)?.username as string
    const starter = tokens[starterName] as string

    // Draw a civ card and reveal it
    const drawn = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/draw/CIV`,
      headers: bearer(starter),
      payload: {},
    })
    expect(drawn.status).toBe(200)

    state = await repo.findGame(gameId)
    const civ = state?.players
      .find((player) => player.username === starterName)
      ?.items.find((item) => item.sheetName === 'CIV')
    expect(civ).toBeDefined()

    const revealed = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/items/reveal`,
      headers: bearer(starter),
      payload: { sheetName: 'CIV', itemNumber: civ?.itemNumber },
    })
    expect(revealed.status).toBe(200)

    // The civilization gives starting units and a starting technology
    state = await repo.findGame(gameId)
    const hand = state?.players.find((player) => player.username === starterName)
    expect(hand?.civilization).not.toBeNull()
    expect(hand?.techsChosen.length).toBeGreaterThan(0)
    expect(hand?.items.filter((item) => item.kind === 'infantry').length).toBeGreaterThan(0)

    // Choose a technology
    const available = await inject(app, {
      method: 'GET',
      url: `/api/games/${gameId}/techs/available`,
      headers: bearer(starter),
    })
    const firstTech = (await available.json() as { name: string }[])[0]?.name as string
    const chosen = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/techs/choose`,
      headers: bearer(starter),
      payload: { name: firstTech },
    })
    expect(chosen.status).toBe(200)

    // Write a turn order
    const turn = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/turns/update`,
      headers: bearer(starter),
      payload: { turnNumber: 1, phase: 'SOT', order: 'Build city at L4' },
    })
    expect(turn.status).toBe(200)

    const publicTurns = await inject(app, {
      method: 'GET',
      url: `/api/games/${gameId}/turns/public`,
      headers: bearer(tokens['Chul'] as string),
    })
    expect(publicTurns.body).toContain('Build city at L4')

    // Chat
    await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/chat`,
      headers: bearer(starter),
      payload: { message: 'good luck' },
    })
    const chat = await inject(app, {
      method: 'GET',
      url: `/api/games/${gameId}/chat`,
      headers: bearer(tokens['Itchi'] as string),
    })
    expect((await chat.json() as { message: string }[])[0]?.message).toBe('good luck')

    // Undo of the tech choice: start it and let everyone vote yes
    state = await repo.findGame(gameId)
    const techLog = state?.log.find((entry) => entry.logType === 'TECH')
    expect(techLog).toBeDefined()

    const initiated = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/undo/${techLog?.id}`,
      headers: bearer(starter),
      payload: {},
    })
    expect(initiated.status).toBe(200)

    for (const username of ['cash1981', 'Karandras1', 'Itchi', 'Chul']) {
      if (username === starterName) continue
      const voted = await inject(app, {
        method: 'POST',
        url: `/api/games/${gameId}/undo/${techLog?.id}/vote`,
        headers: bearer(tokens[username] as string),
        payload: { vote: true },
      })
      expect(voted.status).toBe(200)
    }

    state = await repo.findGame(gameId)
    const afterUndo = state?.players.find((player) => player.username === starterName)
    // Only the starting technology from the civilization is left
    expect(afterUndo?.techsChosen.map((tech) => tech.name)).not.toContain(firstTech)

    // End the turn
    const ended = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/endturn`,
      headers: bearer(starter),
      payload: {},
    })
    expect(ended.status).toBe(200)
    state = await repo.findGame(gameId)
    expect(state?.players.find((player) => player.yourTurn)?.username).not.toBe(starterName)

    // End the game
    const finished = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/end`,
      headers: bearer(creatorToken),
      payload: { winner: 'Itchi' },
    })
    expect(finished.status).toBe(200)

    state = await repo.findGame(gameId)
    expect(state?.active).toBe(false)
    expect(state?.winner).toBe('Itchi')
  })
})

describe('social policy removal', () => {
  it('removes only the owner\'s chosen policy and logs a hidden removal', async () => {
    const { gameId, starter, waiting } = await startedGame('Remove policy')
    const available = await inject(app, {
      method: 'GET',
      url: `/api/games/${gameId}/socialpolicies`,
      headers: bearer(starter),
    })
    const policy = (await available.json() as { name: string }[])[0]
    if (policy === undefined) throw new Error('no social policy')

    const chosen = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/socialpolicy/choose`,
      headers: bearer(starter),
      payload: { name: policy.name },
    })
    expect(chosen.status).toBe(200)

    const forbidden = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/socialpolicy/remove`,
      headers: bearer(waiting),
      payload: { name: policy.name },
    })
    expect(forbidden.status).toBe(404)

    const removed = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/socialpolicy/remove`,
      headers: bearer(starter),
      payload: { name: policy.name },
    })
    expect(removed.status).toBe(200)

    const view = await removed.json() as { you?: { socialPolicies: { name: string }[] } }
    expect(view.you?.socialPolicies.some((candidate) => candidate.name === policy.name)).toBe(false)

    const state = await repo.findGame(gameId)
    expect(state?.socialPolicies.some((candidate) => candidate.name === policy.name)).toBe(true)
    const log = state?.log.at(-1)
    expect(log?.logType).toBe('REMOVED_SOCIAL_POLICY')
    expect(log?.publicLog).toContain('has removed a hidden social policy')
    expect(log?.publicLog).not.toContain(policy.name)
  })
})

/** The board. New in this port — Java had no board model. */
describe('board', () => {
  it('the catalogue of piece types is available', async () => {
    const token = await register('brettkatalog')
    const response = await inject(app, {
      method: 'GET',
      url: '/api/board/assets',
      headers: bearer(token),
    })

    const assets = await response.json() as { id: string; category: string }[]
    expect(response.status).toBe(200)
    expect(assets.length).toBeGreaterThan(50)
    expect(assets.some((asset) => asset.id === 'figures/redarmy')).toBe(true)
    expect(assets.some((asset) => asset.id === 'resources/wheat')).toBe(true)
  })

  it('a new two-player game has an empty 16 by 8 board', async () => {
    const { gameId, starter } = await startedGame('Brettspill')
    const response = await inject(app, {
      method: 'GET',
      url: `/api/games/${gameId}/board`,
      headers: bearer(starter),
    })

    expect(await response.json()).toEqual({
      columns: 16,
      rows: 8,
      squareSize: 94,
      areaRows: 4,
      pieces: [],
      history: [],
    })
  })

  it('places a piece and gives it back in the view of the player', async () => {
    const { gameId, starter } = await startedGame('Brikkespill')
    const response = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/board/pieces`,
      headers: bearer(starter),
      payload: { assetId: 'figures/redarmy', x: 200, y: 300 },
    })

    expect(response.status).toBe(200)
    const view = await response.json() as { board: { pieces: { label: string; x: number }[] } }
    expect(view.board.pieces).toHaveLength(1)
    expect(view.board.pieces[0]?.label).toBe('Red army')
    expect(view.board.pieces[0]?.x).toBe(200)
  })

  it('refuses a piece type that does not exist', async () => {
    const { gameId, starter } = await startedGame('Ukjentbrikke')
    const response = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/board/pieces`,
      headers: bearer(starter),
      payload: { assetId: '../../../etc/passwd', x: 0, y: 0 },
    })

    expect(response.status).toBe(400)
    expect((await response.json() as { error: string }).error).toBe('BOARD_ASSET_NOT_FOUND')
  })

  it('both players see the same board', async () => {
    const { gameId, starter, waiting } = await startedGame('Deltbrett')
    await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/board/pieces`,
      headers: bearer(starter),
      payload: { assetId: 'cities/redcity2', x: 500, y: 500 },
    })

    const theirs = await inject(app, {
      method: 'GET',
      url: `/api/games/${gameId}/board`,
      headers: bearer(waiting),
    })
    expect((await theirs.json() as { pieces: unknown[] }).pieces).toHaveLength(1)
  })

  it('the other player can move a piece, and it ends up on top', async () => {
    const { gameId, starter, waiting } = await startedGame('Flyttbrett')
    for (const assetId of ['figures/redarmy', 'figures/bluearmy']) {
      await inject(app, {
        method: 'POST',
        url: `/api/games/${gameId}/board/pieces`,
        headers: bearer(starter),
        payload: { assetId, x: 100, y: 100 },
      })
    }

    const board = await repo.findGame(gameId)
    const bottom = board?.board.pieces[0]
    if (bottom === undefined) throw new Error('no piece')

    const moved = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/board/pieces/${bottom.id}/move`,
      headers: bearer(waiting),
      payload: { x: 700, y: 800 },
    })

    expect(moved.status).toBe(200)
    const view = await moved.json() as { board: { pieces: { id: string; x: number }[] } }
    expect(view.board.pieces.at(-1)?.id).toBe(bottom.id)
    expect(view.board.pieces.at(-1)?.x).toBe(700)
  })

})

describe('player stats (#43)', () => {
  interface StatView {
    you: { playerId: string; stats: { coins: number; trade: number } }
    opponents: { playerId: string; stats: { coins: number } }[]
  }

  async function ids(gameId: string, token: string): Promise<{ me: string; other: string }> {
    const response = await inject(app, { method: 'GET', url: `/api/games/${gameId}`, headers: bearer(token) })
    const view = await response.json() as StatView
    const other = view.opponents[0]
    if (other === undefined) throw new Error('expected an opponent in the game')
    return { me: view.you.playerId, other: other.playerId }
  }

  it('lets a member set another player and their own stat', async () => {
    const { gameId, starter } = await startedGame('Stats')
    const { me, other } = await ids(gameId, starter)

    const setOther = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/players/${other}/stat`,
      headers: bearer(starter),
      payload: { stat: 'coins', value: 5 },
    })
    expect(setOther.status).toBe(200)
    const afterOther = await setOther.json() as StatView
    expect(afterOther.opponents.find((o) => o.playerId === other)?.stats.coins).toBe(5)

    const setMine = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/players/${me}/stat`,
      headers: bearer(starter),
      payload: { stat: 'trade', value: 3 },
    })
    expect(setMine.status).toBe(200)
    expect((await setMine.json() as StatView).you.stats.trade).toBe(3)
  })

  it('refuses a non-member', async () => {
    const { gameId, starter } = await startedGame('StatsGuard')
    const { other } = await ids(gameId, starter)
    const outsider = await register('stats-outsider')

    const denied = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/players/${other}/stat`,
      headers: bearer(outsider),
      payload: { stat: 'coins', value: 1 },
    })
    expect(denied.status).toBe(403)
    expect((await denied.json() as { error: string }).error).toBe('NO_ACCESS')
  })

  it('rejects an unknown stat', async () => {
    const { gameId, starter } = await startedGame('StatsUnknown')
    const { other } = await ids(gameId, starter)

    const rejected = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/players/${other}/stat`,
      headers: bearer(starter),
      payload: { stat: 'gold', value: 1 },
    })
    expect(rejected.status).toBe(400)
    expect((await rejected.json() as { error: string }).error).toBe('UNKNOWN_STAT')
  })

  it('rejects a negative value', async () => {
    const { gameId, starter } = await startedGame('StatsNegative')
    const { other } = await ids(gameId, starter)

    const rejected = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/players/${other}/stat`,
      headers: bearer(starter),
      payload: { stat: 'coins', value: -3 },
    })
    expect(rejected.status).toBe(400)
    expect((await rejected.json() as { error: string }).error).toBe('INVALID_STAT_VALUE')
  })
})

describe('player governments (#43)', () => {
  interface GovernmentView {
    you: { playerId: string; government: string }
    opponents: { playerId: string; government: string }[]
    log: { publicLog: string }[]
  }

  async function ids(gameId: string, token: string): Promise<{ me: string; other: string }> {
    const response = await inject(app, {
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: bearer(token),
    })
    const view = await response.json() as GovernmentView
    const other = view.opponents[0]
    if (other === undefined) throw new Error('expected an opponent in the game')
    return { me: view.you.playerId, other: other.playerId }
  }

  it('lets a member set another player government and returns the public update', async () => {
    const { gameId, starter } = await startedGame('Governments')
    const { other } = await ids(gameId, starter)

    const response = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/players/${other}/government`,
      headers: bearer(starter),
      payload: { government: 'Monarchy' },
    })

    expect(response.status).toBe(200)
    const view = await response.json() as GovernmentView
    expect(view.opponents.find((player) => player.playerId === other)?.government).toBe('Monarchy')
    expect(view.log.at(-1)?.publicLog).toContain('government to Monarchy')
  })

  it('refuses a non-member', async () => {
    const { gameId, starter } = await startedGame('GovernmentGuard')
    const { other } = await ids(gameId, starter)
    const outsider = await register('government-outsider')

    const response = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/players/${other}/government`,
      headers: bearer(outsider),
      payload: { government: 'Republic' },
    })

    expect(response.status).toBe(403)
    expect((await response.json() as { error: string }).error).toBe('NO_ACCESS')
  })

  it('rejects a value outside the replacement government cards', async () => {
    const { gameId, starter } = await startedGame('GovernmentUnknown')
    const { other } = await ids(gameId, starter)

    const response = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/players/${other}/government`,
      headers: bearer(starter),
      payload: { government: 'Empire' },
    })

    expect(response.status).toBe(400)
    expect((await response.json() as { error: string }).error).toBe('UNKNOWN_GOVERNMENT')
  })
})

describe('HTTP error mapping', () => {
  it('answers 304 with an empty body when an item is already revealed', async () => {
    const { gameId, starter } = await startedGame('AlleredeAvslort')
    await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/draw/HUTS`,
      headers: bearer(starter),
      payload: {},
    })
    const state = await repo.findGame(gameId)
    const hut = state?.players
      .flatMap((player) => player.items)
      .find((item) => item.sheetName === 'HUTS' && item.hidden)
    if (hut === undefined) throw new Error('no hidden hut to reveal')

    const first = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/items/reveal`,
      headers: bearer(starter),
      payload: { sheetName: 'HUTS', itemNumber: hut.itemNumber },
    })
    expect(first.status).toBe(200)

    // Revealing it again: the engine returns ITEM_ALREADY_REVEALED → 304, which
    // must carry no body (a 304 with a body throws when the Response is built).
    const second = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/items/reveal`,
      headers: bearer(starter),
      payload: { sheetName: 'HUTS', itemNumber: hut.itemNumber },
    })
    expect(second.status).toBe(304)
    expect(second.body).toBe('')
  })

  it('rejects a malformed JSON body with 400 before the handler runs', async () => {
    const { gameId, starter } = await startedGame('UgyldigJson')
    const res = await app.request(`/api/games/${gameId}/draw/HUTS`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${starter}` },
      body: '{ not valid json',
    })
    expect(res.status).toBe(400)
    expect((await res.json() as { error: string }).error).toBe('INVALID_JSON')
  })

  it('answers an unknown route with a JSON error body', async () => {
    const res = await inject(app, { method: 'GET', url: '/api/does-not-exist' })
    expect(res.status).toBe(404)
    expect((await res.json() as { error: string }).error).toBe('NOT_FOUND')
  })
})
