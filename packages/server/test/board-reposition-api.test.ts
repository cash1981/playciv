/**
 * Putting a figure a Build placed on another square, over HTTP: the route, the own-view list of
 * squares (nobody else's view has one), the status codes and the build's undo after the move.
 * The rules are in `packages/engine/test/build-reposition.test.ts`.
 *
 * The scene is the Build API tests': the America tile in the first slot and a city of the starter's
 * colour on B2, whose outskirts are A1, B1, C1 (water), A2, C2, A3, B3 and C3.
 */

import type { App } from '../src/app.js'
import { beforeEach, describe, expect, it } from 'vitest'

import { SQUARE_SIZE, mapTop, placePiece, slotOrigin, unwrap } from '@civ/engine'
import type { GameState } from '@civ/engine'

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
const post = (token: string, url: string, payload: unknown) => inject(app, { method: 'POST', url, headers: bearer(token), payload })

async function register(username: string): Promise<string> {
  const response = await inject(app, {
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'secret', email: `${username}@example.com`, securityAnswer: 'writing' },
  })
  expect(response.status).toBe(201)
  return (await response.json() as { token: string }).token
}

interface View {
  readonly rev: number
  readonly you: {
    readonly stats: { readonly trade: number }
    readonly repositionableFigures?: readonly { readonly pieceId: string; readonly squares: readonly { readonly label: string }[] }[]
  } | null
  readonly board: { readonly pieces: readonly { readonly id: string; readonly assetId: string; readonly x: number; readonly y: number }[] }
  readonly assistedActions: readonly { readonly id: string; readonly status: string }[]
}

const view = async (gameId: string, token: string): Promise<View> =>
  (await inject(app, { url: `/api/games/${gameId}`, headers: bearer(token) })).json<View>()

/** A started two-player game, the starter in City Management with a city on B2 of America and 5 trade. */
async function table(name: string) {
  const creator = await register(`${name}-a`)
  const created = await inject(app, { method: 'POST', url: '/api/games', headers: bearer(creator), payload: { name, numOfPlayers: 2 } })
  const gameId = (await created.json() as { id: string }).id
  const joiner = await register(`${name}-b`)
  await post(joiner, `/api/games/${gameId}/join`, {})
  const found = await repo.findGame(gameId)
  const starterPlayer = found?.players.find((player) => player.yourTurn)
  if (starterPlayer === undefined) throw new Error('nobody has the first turn')
  const starter = starterPlayer.username === `${name}-a` ? creator : joiner
  const other = starter === creator ? joiner : creator
  expect((await post(starter, `/api/games/${gameId}/turns/done`, { phase: 'TRADE' })).status).toBe(200)

  let state = await repo.findGame(gameId)
  if (state === undefined) throw new Error('game missing')
  const colour = state.players.find((player) => player.playerId === starterPlayer.playerId)?.color
  if (colour === null || colour === undefined) throw new Error('the starter has no colour')
  const slot = state.board.slots[0]
  if (slot === undefined) throw new Error('board has no slots')
  const [x, y] = slotOrigin(state.board, slot)
  state = unwrap(placePiece(state, { playerId: starterPlayer.playerId, assetId: 'tiles/america', x, y }))
  const placed: GameState = unwrap(
    placePiece(state, {
      playerId: starterPlayer.playerId,
      assetId: `cities/${colour.toLowerCase()}city2`,
      x: SQUARE_SIZE + 4,
      y: mapTop(state.board) + SQUARE_SIZE + 4,
    }),
  )
  const cityId = placed.board.pieces.at(-1)?.id ?? ''
  await repo.saveGame({
    ...placed,
    players: placed.players.map((player) =>
      player.playerId === starterPlayer.playerId
        ? { ...player, government: 'Monarchy', stats: { ...player.stats, trade: 5 } }
        : player,
    ),
  })
  return { gameId, starter, other, cityId, colour: colour.toLowerCase() }
}

const B3 = { column: 1, row: 2 }

describe('POST /api/games/:gameId/board/pieces/:pieceId/reposition', () => {
  it('moves a built army to another square of the city, for free, and refuses once City Management is over', async () => {
    const { gameId, starter, other, cityId, colour } = await table('Repos')
    const before = await view(gameId, starter)
    const built = await post(starter, `/api/games/${gameId}/actions`, {
      action: 'build', requestId: 'req-1', rev: before.rev, cityPieceId: cityId, item: { kind: 'army' }, target: B3,
    })
    expect(built.status).toBe(200)

    const mine = await view(gameId, starter)
    const army = mine.board.pieces.find((piece) => piece.assetId === `figures/${colour}army`)
    if (army === undefined) throw new Error('no army')
    const offered = mine.you?.repositionableFigures ?? []
    expect(offered.map((entry) => entry.pieceId)).toEqual([army.id])
    expect(offered[0]?.squares.map((square) => square.label)).toEqual(['A1', 'B1', 'A2', 'C2', 'A3', 'C3'])
    // Only the owner's own view carries the list
    expect((await view(gameId, other)).you?.repositionableFigures).toEqual([])
    expect((await (await inject(app, { url: `/api/games/${gameId}` })).json<View>()).you ?? null).toBeNull()

    // Not the owner, and not a square the build offered
    expect((await post(other, `/api/games/${gameId}/board/pieces/${army.id}/reposition`, { column: 2, row: 1 })).status).toBe(400)
    expect((await post(starter, `/api/games/${gameId}/board/pieces/${army.id}/reposition`, { column: 2, row: 0 })).status).toBe(400)
    expect((await post(starter, `/api/games/${gameId}/board/pieces/${army.id}/reposition`, { column: 'x', row: 0 })).status).toBe(400)

    const moved = await post(starter, `/api/games/${gameId}/board/pieces/${army.id}/reposition`, { column: 2, row: 1 })
    expect(moved.status).toBe(200)
    const after = await moved.json<View>()
    const there = after.board.pieces.find((piece) => piece.id === army.id)
    expect(Math.floor((there?.x ?? 0) / SQUARE_SIZE)).toBe(2)
    expect(after.you?.stats.trade).toBe(mine.you?.stats.trade)

    // The build is still one applied action (its undo from the new square is tested in the engine)
    expect((await repo.findGame(gameId))?.assistedActions.map((action) => action.status)).toEqual(['applied'])

    // After End turn for City Management the figure stays
    expect((await post(starter, `/api/games/${gameId}/turns/done`, { phase: 'CM' })).status).toBe(200)
    expect((await post(starter, `/api/games/${gameId}/board/pieces/${army.id}/reposition`, { column: 0, row: 0 })).status).toBe(400)
    expect((await view(gameId, starter)).you?.repositionableFigures).toEqual([])
  })
})
