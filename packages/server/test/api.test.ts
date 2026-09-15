/**
 * API tests that run against the app in memory through `fastify.inject`, with
 * no network involved.
 *
 * The last test plays a whole round: four players register, create and join a
 * game, draw cards, choose a technology, write turn orders, vote on an undo and
 * end the game.
 */

import type { FastifyInstance } from 'fastify'
import { beforeEach, describe, expect, it } from 'vitest'

import { createTestApp } from '../src/app.js'
import { JsonFileRepository } from '../src/store/json-file.js'

let app: FastifyInstance
let repo: JsonFileRepository

beforeEach(async () => {
  const created = await createTestApp()
  app = created.app
  repo = created.repo
})

async function register(username: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hemmelig', email: `${username}@example.com` },
  })
  expect(response.statusCode).toBe(201)
  return (response.json() as { token: string }).token
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

async function createGame(token: string, name: string, numOfPlayers = 4): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/games',
    headers: bearer(token),
    payload: { name, numOfPlayers },
  })
  expect(response.statusCode).toBe(201)
  return (response.json() as { id: string }).id
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

  const join = await app.inject({
    method: 'POST',
    url: `/api/games/${gameId}/join`,
    headers: bearer(other),
    payload: {},
  })
  expect(join.statusCode).toBe(200)

  const state = await repo.findGame(gameId)
  const starterName = state?.players.find((player) => player.yourTurn)?.username
  const starter = starterName === `${name}-a` ? creator : other

  return { gameId, starter, waiting: starter === creator ? other : creator }
}

describe('health', () => {
  it('answers ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' })
    expect(response.json()).toEqual({ status: 'ok' })
  })
})

describe('auth', () => {
  it('registers and logs in', async () => {
    await register('cash1981')

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'cash1981', password: 'hemmelig' },
    })
    expect(login.statusCode).toBe(200)
    expect((login.json() as { player: { username: string } }).player.username).toBe('cash1981')
  })

  it('refuses a wrong password', async () => {
    await register('cash1981')
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'cash1981', password: 'feil' },
    })
    expect(login.statusCode).toBe(401)
  })

  it('refuses an unknown user with the same answer as a wrong password', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'finnesikke', password: 'hemmelig' },
    })
    expect(login.statusCode).toBe(401)
  })

  it('the same username cannot be taken twice', async () => {
    await register('cash1981')
    const again = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'CASH1981', password: 'hemmelig' },
    })
    expect(again.statusCode).toBe(409)
  })

  it('never stores the password in the clear, and never sends the hash out', async () => {
    const token = await register('cash1981')
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(token) })

    expect(JSON.stringify(me.json())).not.toContain('hemmelig')
    expect(me.json()).not.toHaveProperty('passwordHash')

    const stored = await repo.findPlayerByUsername('cash1981')
    expect(stored?.passwordHash).not.toContain('hemmelig')
  })

  it('routes without a token give 401', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/games' })
    expect(response.statusCode).toBe(401)
  })

  it('an invalid token gives 401', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/games',
      headers: bearer('tull.tull'),
    })
    expect(response.statusCode).toBe(401)
  })
})

describe('games', () => {
  it('the creator becomes the first player', async () => {
    const token = await register('cash1981')
    const gameId = await createGame(token, 'First game')

    const game = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: bearer(token),
    })
    const view = game.json() as {
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
    const again = await app.inject({
      method: 'POST',
      url: '/api/games',
      headers: bearer(token),
      payload: { name: 'Duplikat', numOfPlayers: 4 },
    })
    expect(again.statusCode).toBe(409)
  })

  it('the game starts when the last player joins', async () => {
    const creator = await register('cash1981')
    const gameId = await createGame(creator, 'Startspill', 2)

    const other = await register('Karandras1')
    const join = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/join`,
      headers: bearer(other),
      payload: {},
    })
    expect(join.statusCode).toBe(200)

    const state = await repo.findGame(gameId)
    expect(state?.players.filter((player) => player.yourTurn)).toHaveLength(1)
  })

  it('a full game turns further players away', async () => {
    const creator = await register('cash1981')
    const gameId = await createGame(creator, 'Fullt', 2)
    await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/join`,
      headers: bearer(await register('Karandras1')),
      payload: {},
    })

    const third = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/join`,
      headers: bearer(await register('Itchi')),
      payload: {},
    })
    expect(third.statusCode).toBe(400)
    expect((third.json() as { error: string }).error).toBe('GAME_IS_FULL')
  })
})

describe('draws', () => {
  it('whoever has the turn may draw, and the card lands hidden in the hand', async () => {
    const creator = await register('cash1981')
    const gameId = await createGame(creator, 'Trekkspill', 2)
    const other = await register('Karandras1')
    await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/join`,
      headers: bearer(other),
      payload: {},
    })

    const state = await repo.findGame(gameId)
    const starter = state?.players.find((player) => player.yourTurn)
    const starterToken = starter?.username === 'cash1981' ? creator : other

    const drawn = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/draw/HUTS`,
      headers: bearer(starterToken),
      payload: {},
    })
    expect(drawn.statusCode).toBe(200)

    const view = drawn.json() as { you: { items: { sheetName: string; hidden: boolean }[] } }
    expect(view.you.items).toHaveLength(1)
    expect(view.you.items[0]?.sheetName).toBe('HUTS')
    expect(view.you.items[0]?.hidden).toBe(true)
  })

  it('whoever does not have the turn gets 403', async () => {
    const creator = await register('cash1981')
    const gameId = await createGame(creator, 'Turspill', 2)
    const other = await register('Karandras1')
    await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/join`,
      headers: bearer(other),
      payload: {},
    })

    const state = await repo.findGame(gameId)
    const waiting = state?.players.find((player) => !player.yourTurn)
    const waitingToken = waiting?.username === 'cash1981' ? creator : other

    const drawn = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/draw/HUTS`,
      headers: bearer(waitingToken),
      payload: {},
    })
    expect(drawn.statusCode).toBe(403)
    expect((drawn.json() as { error: string }).error).toBe('NOT_YOUR_TURN')
  })

  it('an unknown sheet name gives 400', async () => {
    const { gameId, starter: token } = await startedGame('Arkspill')
    const drawn = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/draw/SJAKKBRIKKER`,
      headers: bearer(token),
      payload: {},
    })
    expect(drawn.statusCode).toBe(400)
  })

  it('technologies cannot be drawn', async () => {
    const { gameId, starter: token } = await startedGame('Techspill')
    const drawn = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/draw/LEVEL_1_TECH`,
      headers: bearer(token),
      payload: {},
    })
    expect(drawn.statusCode).toBe(400)
    expect((drawn.json() as { error: string }).error).toBe('TECHS_ARE_CHOSEN_NOT_DRAWN')
  })
})

describe('hidden information over HTTP', () => {
  it('an opponent sees the number of cards, not their contents', async () => {
    const creator = await register('cash1981')
    const gameId = await createGame(creator, 'Skjultspill', 2)
    const other = await register('Karandras1')
    await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/join`,
      headers: bearer(other),
      payload: {},
    })

    const state = await repo.findGame(gameId)
    const starter = state?.players.find((player) => player.yourTurn)
    const starterToken = starter?.username === 'cash1981' ? creator : other
    const otherToken = starterToken === creator ? other : creator

    await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/draw/CULTURE_1`,
      headers: bearer(starterToken),
      payload: {},
    })

    // What the player who drew sees
    const own = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: bearer(starterToken),
    })
    const ownView = own.json() as { you: { items: { name: string }[] } }
    const cardName = ownView.you.items[0]?.name
    expect(cardName).toBeDefined()

    // What the opponent sees
    const theirs = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: bearer(otherToken),
    })
    const body = theirs.body
    expect(body).not.toContain(cardName as string)

    const theirView = theirs.json() as {
      opponents: { numberOfItemsInHand: number }[]
    }
    expect(theirView.opponents[0]?.numberOfItemsInHand).toBe(1)
  })

  it('the public log does not give the card away', async () => {
    const { gameId, starter: token } = await startedGame('Loggspill')
    await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/draw/CULTURE_1`,
      headers: bearer(token),
      payload: {},
    })

    const state = await repo.findGame(gameId)
    const card = state?.players[0]?.items[0]
    expect(card).toBeDefined()

    const log = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}/log/public`,
      headers: bearer(token),
    })
    expect(log.body).not.toContain((card as { name: string }).name)
    expect(log.body).toContain('CultureI')
  })
})

describe('storage', () => {
  it('games survive a new app against the same repository', async () => {
    const { gameId, starter: token } = await startedGame('Lagringsspill')

    // A fresh Fastify instance against the same repository, like a restart on the same data file
    const { createApp } = await import('../src/app.js')
    const restarted = await createApp({ repo, tokenSecret: 'test-secret' })

    const game = await restarted.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: bearer(token),
    })
    expect(game.statusCode).toBe(200)
    expect((game.json() as { name: string }).name).toBe('Lagringsspill')
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
      const join = await app.inject({
        method: 'POST',
        url: `/api/games/${gameId}/join`,
        headers: bearer(tokens[username] as string),
        payload: {},
      })
      expect(join.statusCode).toBe(200)
    }

    // Who starts is random, so find out
    let state = await repo.findGame(gameId)
    const starterName = state?.players.find((player) => player.yourTurn)?.username as string
    const starter = tokens[starterName] as string

    // Draw a civ card and reveal it
    const drawn = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/draw/CIV`,
      headers: bearer(starter),
      payload: {},
    })
    expect(drawn.statusCode).toBe(200)

    state = await repo.findGame(gameId)
    const civ = state?.players
      .find((player) => player.username === starterName)
      ?.items.find((item) => item.sheetName === 'CIV')
    expect(civ).toBeDefined()

    const revealed = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/items/reveal`,
      headers: bearer(starter),
      payload: { sheetName: 'CIV', itemNumber: civ?.itemNumber },
    })
    expect(revealed.statusCode).toBe(200)

    // The civilization gives starting units and a starting technology
    state = await repo.findGame(gameId)
    const hand = state?.players.find((player) => player.username === starterName)
    expect(hand?.civilization).not.toBeNull()
    expect(hand?.techsChosen.length).toBeGreaterThan(0)
    expect(hand?.items.filter((item) => item.kind === 'infantry').length).toBeGreaterThan(0)

    // Choose a technology
    const available = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}/techs/available`,
      headers: bearer(starter),
    })
    const firstTech = (available.json() as { name: string }[])[0]?.name as string
    const chosen = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/techs/choose`,
      headers: bearer(starter),
      payload: { name: firstTech },
    })
    expect(chosen.statusCode).toBe(200)

    // Write a turn order
    const turn = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/turns/update`,
      headers: bearer(starter),
      payload: { turnNumber: 1, phase: 'SOT', order: 'Build city at L4' },
    })
    expect(turn.statusCode).toBe(200)

    const publicTurns = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}/turns/public`,
      headers: bearer(tokens['Chul'] as string),
    })
    expect(publicTurns.body).toContain('Build city at L4')

    // Chat
    await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/chat`,
      headers: bearer(starter),
      payload: { message: 'good luck' },
    })
    const chat = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}/chat`,
      headers: bearer(tokens['Itchi'] as string),
    })
    expect((chat.json() as { message: string }[])[0]?.message).toBe('good luck')

    // Undo of the tech choice: start it and let everyone vote yes
    state = await repo.findGame(gameId)
    const techLog = state?.log.find((entry) => entry.logType === 'TECH')
    expect(techLog).toBeDefined()

    const initiated = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/undo/${techLog?.id}`,
      headers: bearer(starter),
      payload: {},
    })
    expect(initiated.statusCode).toBe(200)

    for (const username of ['cash1981', 'Karandras1', 'Itchi', 'Chul']) {
      if (username === starterName) continue
      const voted = await app.inject({
        method: 'POST',
        url: `/api/games/${gameId}/undo/${techLog?.id}/vote`,
        headers: bearer(tokens[username] as string),
        payload: { vote: true },
      })
      expect(voted.statusCode).toBe(200)
    }

    state = await repo.findGame(gameId)
    const afterUndo = state?.players.find((player) => player.username === starterName)
    // Only the starting technology from the civilization is left
    expect(afterUndo?.techsChosen.map((tech) => tech.name)).not.toContain(firstTech)

    // End the turn
    const ended = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/endturn`,
      headers: bearer(starter),
      payload: {},
    })
    expect(ended.statusCode).toBe(200)
    state = await repo.findGame(gameId)
    expect(state?.players.find((player) => player.yourTurn)?.username).not.toBe(starterName)

    // End the game
    const finished = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/end`,
      headers: bearer(creatorToken),
      payload: { winner: 'Itchi' },
    })
    expect(finished.statusCode).toBe(200)

    state = await repo.findGame(gameId)
    expect(state?.active).toBe(false)
    expect(state?.winner).toBe('Itchi')
  })
})

/** The board. New in this port — Java had no board model. */
describe('board', () => {
  it('the catalogue of piece types is available', async () => {
    const token = await register('brettkatalog')
    const response = await app.inject({
      method: 'GET',
      url: '/api/board/assets',
      headers: bearer(token),
    })

    const assets = response.json() as { id: string; category: string }[]
    expect(response.statusCode).toBe(200)
    expect(assets.length).toBeGreaterThan(50)
    expect(assets.some((asset) => asset.id === 'figures/redarmy')).toBe(true)
    expect(assets.some((asset) => asset.id === 'resources/wheat')).toBe(true)
  })

  it('a new game has an empty 16 by 16 board', async () => {
    const { gameId, starter } = await startedGame('Brettspill')
    const response = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}/board`,
      headers: bearer(starter),
    })

    expect(response.json()).toEqual({
      columns: 16,
      rows: 16,
      squareSize: 94,
      areaRows: 4,
      pieces: [],
      history: [],
    })
  })

  it('places a piece and gives it back in the view of the player', async () => {
    const { gameId, starter } = await startedGame('Brikkespill')
    const response = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/board/pieces`,
      headers: bearer(starter),
      payload: { assetId: 'figures/redarmy', x: 200, y: 300 },
    })

    expect(response.statusCode).toBe(200)
    const view = response.json() as { board: { pieces: { label: string; x: number }[] } }
    expect(view.board.pieces).toHaveLength(1)
    expect(view.board.pieces[0]?.label).toBe('Red army')
    expect(view.board.pieces[0]?.x).toBe(200)
  })

  it('refuses a piece type that does not exist', async () => {
    const { gameId, starter } = await startedGame('Ukjentbrikke')
    const response = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/board/pieces`,
      headers: bearer(starter),
      payload: { assetId: '../../../etc/passwd', x: 0, y: 0 },
    })

    expect(response.statusCode).toBe(400)
    expect((response.json() as { error: string }).error).toBe('BOARD_ASSET_NOT_FOUND')
  })

  it('both players see the same board', async () => {
    const { gameId, starter, waiting } = await startedGame('Deltbrett')
    await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/board/pieces`,
      headers: bearer(starter),
      payload: { assetId: 'cities/redcity2', x: 500, y: 500 },
    })

    const theirs = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}/board`,
      headers: bearer(waiting),
    })
    expect((theirs.json() as { pieces: unknown[] }).pieces).toHaveLength(1)
  })

  it('the other player can move a piece, and it ends up on top', async () => {
    const { gameId, starter, waiting } = await startedGame('Flyttbrett')
    for (const assetId of ['figures/redarmy', 'figures/bluearmy']) {
      await app.inject({
        method: 'POST',
        url: `/api/games/${gameId}/board/pieces`,
        headers: bearer(starter),
        payload: { assetId, x: 100, y: 100 },
      })
    }

    const board = await repo.findGame(gameId)
    const bottom = board?.board.pieces[0]
    if (bottom === undefined) throw new Error('no piece')

    const moved = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/board/pieces/${bottom.id}/move`,
      headers: bearer(waiting),
      payload: { x: 700, y: 800 },
    })

    expect(moved.statusCode).toBe(200)
    const view = moved.json() as { board: { pieces: { id: string; x: number }[] } }
    expect(view.board.pieces.at(-1)?.id).toBe(bottom.id)
    expect(view.board.pieces.at(-1)?.x).toBe(700)
  })

  it('clears the board', async () => {
    const { gameId, starter } = await startedGame('Tombrett')
    await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/board/pieces`,
      headers: bearer(starter),
      payload: { assetId: 'markers/coin', x: 10, y: 10 },
    })

    const cleared = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/board/clear`,
      headers: bearer(starter),
      payload: {},
    })
    expect((cleared.json() as { board: { pieces: unknown[] } }).board.pieces).toHaveLength(0)
  })
})
