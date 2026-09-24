/**
 * Board history, undo and shared state over HTTP.
 *
 * The engine tests cover the rules; these check that the routes wire them up
 * and that two players really see the same board.
 */

import type { App } from '../src/app.js'
import { beforeEach, describe, expect, it } from 'vitest'

import { createTestApp } from '../src/app.js'
import { JsonFileRepository } from '../src/store/json-file.js'
import { inject } from './helpers.js'

let app: App
let repo: JsonFileRepository

beforeEach(async () => {
  const created = await createTestApp()
  app = created.app
  repo = created.repo
})

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

async function register(username: string): Promise<string> {
  const response = await inject(app, {
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      username,
      password: 'secret',
      email: `${username}@example.com`,
      securityAnswer: 'writing',
    },
  })
  expect(response.status).toBe(201)
  return (await response.json() as { token: string }).token
}

/** A started two-player game, and the token of whoever got the first turn. */
async function startedGame(
  name: string,
): Promise<{ gameId: string; starter: string; waiting: string }> {
  const creator = await register(`${name}-a`)
  const created = await inject(app, {
    method: 'POST',
    url: '/api/games',
    headers: bearer(creator),
    payload: { name, numOfPlayers: 2 },
  })
  const gameId = (await created.json() as { id: string }).id

  const other = await register(`${name}-b`)
  await inject(app, {
    method: 'POST',
    url: `/api/games/${gameId}/join`,
    headers: bearer(other),
    payload: {},
  })

  const state = await repo.findGame(gameId)
  const starterName = state?.players.find((player) => player.yourTurn)?.username
  const starter = starterName === `${name}-a` ? creator : other
  return { gameId, starter, waiting: starter === creator ? other : creator }
}

const place = (gameId: string, token: string, assetId: string, x: number, y: number) =>
  inject(app, {
    method: 'POST',
    url: `/api/games/${gameId}/board/pieces`,
    headers: bearer(token),
    payload: { assetId, x, y },
  })

describe('player areas', () => {
  it('the view carries one area per player plus the shared Wonders area, below the map', async () => {
    const { gameId, starter } = await startedGame('Areas')
    const view = await inject(app, {
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: bearer(starter),
    })

    const areas = (await view.json() as { boardAreas: { username: string; y: number }[] }).boardAreas
    // Two players, then the shared Wonders area at the right.
    expect(areas).toHaveLength(3)
    expect(areas.at(-1)?.username).toBe('Wonders')
    // The two-player map is 8 rows of 94, so the band starts below the map at 752
    expect(areas.every((area) => area.y > 752)).toBe(true)
  })

  it('a piece dropped in an area tidies into a slot', async () => {
    const { gameId, starter } = await startedGame('Tidy')
    const view = await inject(app, {
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: bearer(starter),
    })
    const area = (await view.json() as { boardAreas: { x: number; y: number }[] }).boardAreas[0]
    if (area === undefined) throw new Error('no area')

    // Drop two huts at the same untidy spot
    await place(gameId, starter, 'resources/hut', area.x + 37, area.y + 61)
    const second = await place(gameId, starter, 'resources/hut', area.x + 37, area.y + 61)

    const pieces = (await second.json() as { board: { pieces: { x: number }[] } }).board.pieces
    expect(pieces).toHaveLength(2)
    expect(pieces[0]?.x).not.toBe(pieces[1]?.x)
  })

  it('rejects a placement once a two-player resource supply is exhausted', async () => {
    const { gameId, starter } = await startedGame('Supply')
    await place(gameId, starter, 'resources/wheat', 0, 0)
    await place(gameId, starter, 'resources/wheat', 0, 0)

    const exhausted = await place(gameId, starter, 'resources/wheat', 0, 0)
    expect(exhausted.status).toBe(409)
    expect((await exhausted.json() as { error: string }).error).toBe('BOARD_ASSET_LIMIT_REACHED')
  })
})

describe('history over HTTP', () => {
  it('sets a wonder owner through the public board route and records it in history', async () => {
    const { gameId, starter } = await startedGame('WonderOwner')
    const placed = await place(gameId, starter, 'wonders/internet', 1300, 1800)
    const piece = (await placed.json() as { board: { pieces: { id: string }[] } }).board.pieces[0]
    expect(piece).toBeDefined()
    if (piece === undefined) throw new Error('The placed wonder should be on the board')
    const state = await repo.findGame(gameId)
    expect(state).toBeDefined()
    if (state === undefined) throw new Error('The game should be stored')
    const firstPlayer = state.players[0]
    expect(firstPlayer).toBeDefined()
    if (firstPlayer === undefined) throw new Error('The game should have a player')
    const ownerId = firstPlayer.playerId
    const response = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/board/pieces/${piece.id}/owner`,
      headers: bearer(starter),
      payload: { ownerId },
    })
    expect(response.status).toBe(200)
    const view = await response.json() as { board: { pieces: { id: string; ownerId?: string }[]; history: { change: { kind: string } }[] } }
    expect(view.board.pieces.find((candidate) => candidate.id === piece.id)?.ownerId).toBe(ownerId)
    expect(view.board.history.at(-1)?.change.kind).toBe('owner')
  })

  it('records every change with a description and a timestamp', async () => {
    const { gameId, starter } = await startedGame('History')
    await place(gameId, starter, 'figures/redarmy', 200, 300)

    const history = await inject(app, {
      method: 'GET',
      url: `/api/games/${gameId}/board/history`,
      headers: bearer(starter),
    })

    const entries = await history.json() as { description: string; at: string }[]
    expect(entries).toHaveLength(1)
    expect(entries[0]?.description).toContain('placed Red army')
    // The server supplies the timestamp; the engine stays pure
    expect(Date.parse(entries[0]?.at ?? '')).not.toBeNaN()
  })

  it('both players see the same history', async () => {
    const { gameId, starter, waiting } = await startedGame('Shared')
    await place(gameId, starter, 'markers/coin1', 100, 100)

    const theirs = await inject(app, {
      method: 'GET',
      url: `/api/games/${gameId}/board/history`,
      headers: bearer(waiting),
    })
    expect(await theirs.json()).toHaveLength(1)
  })

  it('a move records where it came from and went to', async () => {
    const { gameId, starter } = await startedGame('Moves')
    const placed = await place(gameId, starter, 'figures/redarmy', 100, 100)
    const piece = (await placed.json() as { board: { pieces: { id: string }[] } }).board.pieces[0]
    if (piece === undefined) throw new Error('no piece')

    const moved = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/board/pieces/${piece.id}/move`,
      headers: bearer(starter),
      payload: { x: 700, y: 800 },
    })

    const history = (await moved.json() as { board: { history: { description: string }[] } }).board
      .history
    expect(history).toHaveLength(2)
    expect(history[1]?.description).toMatch(/moved Red army from .+ to .+/)
  })
})

describe('undo over HTTP', () => {
  it('takes back the last change', async () => {
    const { gameId, starter } = await startedGame('Undo')
    await place(gameId, starter, 'figures/redarmy', 200, 300)

    const undone = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/board/undo`,
      headers: bearer(starter),
      payload: {},
    })

    const board = (await undone.json() as { board: { pieces: unknown[]; history: unknown[] } }).board
    expect(undone.status).toBe(200)
    expect(board.pieces).toHaveLength(0)
    expect(board.history).toHaveLength(0)
  })

  it('the other player cannot undo your change', async () => {
    const { gameId, starter, waiting } = await startedGame('UndoOther')
    const placed = await place(gameId, starter, 'figures/redarmy', 200, 300)

    const undone = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/board/undo`,
      headers: bearer(waiting),
      payload: {},
    })
    expect(undone.status).toBe(403)
    expect((await undone.json() as { error: string }).error).toBe('BOARD_UNDO_NOT_YOURS')
    expect((await placed.json() as { board: { pieces: unknown[] } }).board.pieces).toHaveLength(1)
  })

  it('an empty history gives 412', async () => {
    const { gameId, starter } = await startedGame('NothingToUndo')
    const undone = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/board/undo`,
      headers: bearer(starter),
      payload: {},
    })

    expect(undone.status).toBe(412)
    expect((await undone.json() as { error: string }).error).toBe('NOTHING_TO_UNDO_ON_BOARD')
  })
})

describe('redo over HTTP', () => {
  it('brings back the change undo just took away', async () => {
    const { gameId, starter } = await startedGame('Redo')
    await place(gameId, starter, 'figures/redarmy', 200, 300)
    await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/board/undo`,
      headers: bearer(starter),
      payload: {},
    })

    const redone = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/board/redo`,
      headers: bearer(starter),
      payload: {},
    })

    const board = (await redone.json() as { board: { pieces: unknown[]; history: unknown[] } }).board
    expect(redone.status).toBe(200)
    expect(board.pieces).toHaveLength(1)
    expect(board.history).toHaveLength(1)
  })

  it('is available to the other player too', async () => {
    const { gameId, starter, waiting } = await startedGame('RedoOther')
    await place(gameId, starter, 'figures/redarmy', 200, 300)
    await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/board/undo`,
      headers: bearer(starter),
      payload: {},
    })

    const redone = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/board/redo`,
      headers: bearer(waiting),
      payload: {},
    })
    expect(redone.status).toBe(200)
  })

  it('is cleared by a further change and gives 412', async () => {
    const { gameId, starter } = await startedGame('RedoCleared')
    await place(gameId, starter, 'figures/redarmy', 200, 300)
    await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/board/undo`,
      headers: bearer(starter),
      payload: {},
    })
    await place(gameId, starter, 'figures/bluearmy', 400, 400)

    const redone = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/board/redo`,
      headers: bearer(starter),
      payload: {},
    })

    expect(redone.status).toBe(412)
    expect((await redone.json() as { error: string }).error).toBe('NOTHING_TO_REDO_ON_BOARD')
  })
})

describe('rotation over HTTP', () => {
  it('turns a quarter step when no angle is given', async () => {
    const { gameId, starter } = await startedGame('Rotate')
    const placed = await place(gameId, starter, 'tiles/tile01', 0, 0)
    const piece = (await placed.json() as { board: { pieces: { id: string }[] } }).board.pieces[0]
    if (piece === undefined) throw new Error('no piece')

    const turned = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/board/pieces/${piece.id}/rotate`,
      headers: bearer(starter),
      payload: {},
    })
    const pieces = (await turned.json() as { board: { pieces: { rotation: number }[] } }).board.pieces
    expect(pieces[0]?.rotation).toBe(90)
  })

  it('rejects an angle that is not a quarter turn', async () => {
    const { gameId, starter } = await startedGame('BadAngle')
    const placed = await place(gameId, starter, 'tiles/tile01', 0, 0)
    const piece = (await placed.json() as { board: { pieces: { id: string }[] } }).board.pieces[0]
    if (piece === undefined) throw new Error('no piece')

    const turned = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/board/pieces/${piece.id}/rotate`,
      headers: bearer(starter),
      payload: { rotation: 45 },
    })
    expect(turned.status).toBe(400)
  })
})
