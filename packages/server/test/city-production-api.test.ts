/**
 * The typed city production over HTTP: POST /api/games/:id/board/pieces/:pieceId/production.
 *
 * The engine tests cover the rules; these check the route's auth, validation,
 * revision handling and that every player's view carries the result.
 */

import { SQUARE_SIZE, mapTop } from '@civ/engine'
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

interface CityView {
  readonly pieceId: string
  readonly estimate: number
  readonly override: number | null
  readonly effective: number
}

interface ViewJson {
  readonly rev: number
  readonly you: { readonly cities: readonly CityView[] } | null
  readonly opponents: readonly { readonly username: string; readonly cities: readonly CityView[] }[]
  readonly board: {
    readonly pieces: readonly { readonly id: string; readonly category: string; readonly productionOverride?: number }[]
    readonly history: readonly { readonly change: { readonly kind: string }; readonly description: string }[]
  }
}

/** A started two-player game, with a city of the starter's colour on B2 and a building next to it. */
async function gameWithCity(name: string): Promise<{
  gameId: string
  starter: string
  starterName: string
  waiting: string
  cityId: string
  buildingId: string
}> {
  const creator = await register(`${name}-a`)
  const created = await inject(app, {
    method: 'POST',
    url: '/api/games',
    headers: bearer(creator),
    payload: { name, numOfPlayers: 2 },
  })
  const gameId = (await created.json() as { id: string }).id
  const other = await register(`${name}-b`)
  await inject(app, { method: 'POST', url: `/api/games/${gameId}/join`, headers: bearer(other), payload: {} })

  const state = await repo.findGame(gameId)
  if (state === undefined) throw new Error('no game')
  const starterPlayer = state.players.find((player) => player.yourTurn)
  if (starterPlayer === undefined || starterPlayer.color === null) throw new Error('no starter with a colour')
  const starter = starterPlayer.username === `${name}-a` ? creator : other
  const waiting = starter === creator ? other : creator

  const top = mapTop(state.board)
  const placeAt = async (assetId: string, column: number, row: number): Promise<string> => {
    const response = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/board/pieces`,
      headers: bearer(starter),
      payload: { assetId, x: column * SQUARE_SIZE + 4, y: top + row * SQUARE_SIZE + 4 },
    })
    expect(response.status).toBe(200)
    const pieces = (await response.json() as ViewJson).board.pieces
    const id = pieces.at(-1)?.id
    if (id === undefined) throw new Error('nothing was placed')
    return id
  }
  const cityId = await placeAt(`cities/${starterPlayer.color.toLowerCase()}city2`, 1, 1)
  const buildingId = await placeAt('buildings/workshop', 3, 3)
  return { gameId, starter, starterName: starterPlayer.username, waiting, cityId, buildingId }
}

const setProduction = (
  gameId: string,
  token: string | undefined,
  pieceId: string,
  payload: unknown,
) =>
  inject(app, {
    method: 'POST',
    url: `/api/games/${gameId}/board/pieces/${pieceId}/production`,
    ...(token === undefined ? {} : { headers: bearer(token) }),
    payload,
  })

const errorOf = async (response: { json: <T>() => Promise<T> }): Promise<string> =>
  (await response.json<{ error: string }>()).error

describe('POST /board/pieces/:pieceId/production', () => {
  it('needs a signed-in player', async () => {
    const { gameId, cityId } = await gameWithCity('NoToken')
    expect((await setProduction(gameId, undefined, cityId, { production: 5 })).status).toBe(401)
  })

  it('refuses someone who is not in the game', async () => {
    const { gameId, cityId } = await gameWithCity('Outsider')
    const outsider = await register('Outsider-c')
    const response = await setProduction(gameId, outsider, cityId, { production: 5 })
    expect(response.status).toBe(403)
    expect(await errorOf(response)).toBe('NO_ACCESS')
    expect((await repo.findGame(gameId))?.board.pieces.find((piece) => piece.id === cityId)).not.toHaveProperty('productionOverride')
  })

  it('sets the number and every player sees it, with the estimate beside it', async () => {
    const { gameId, starter, waiting, starterName, cityId } = await gameWithCity('SetIt')

    const response = await setProduction(gameId, starter, cityId, { production: 11 })
    expect(response.status).toBe(200)
    const view = await response.json() as ViewJson
    const own = view.you?.cities.find((city) => city.pieceId === cityId)
    expect(own).toMatchObject({ override: 11, effective: 11 })
    expect(typeof own?.estimate).toBe('number')
    expect(own?.estimate).not.toBe(11)
    expect(view.board.pieces.find((piece) => piece.id === cityId)?.productionOverride).toBe(11)
    expect(view.board.history.at(-1)?.change.kind).toBe('productionOverride')

    // The other player is not the owner, may still set it, and sees the city under the opponent.
    const seen = await inject(app, { method: 'GET', url: `/api/games/${gameId}`, headers: bearer(waiting) })
    const theirView = await seen.json() as ViewJson
    expect(theirView.opponents.find((opponent) => opponent.username === starterName)?.cities[0]).toMatchObject({
      pieceId: cityId,
      override: 11,
      effective: 11,
    })

    const persisted = await repo.findGame(gameId)
    expect(persisted?.board.pieces.find((piece) => piece.id === cityId)?.productionOverride).toBe(11)

    const byOther = await setProduction(gameId, waiting, cityId, { production: 0 })
    expect(byOther.status).toBe(200)
    expect((await byOther.json() as ViewJson).opponents[0]?.cities[0]?.override).toBe(0)
  })

  it('removes the number with null, and the piece loses the field', async () => {
    const { gameId, starter, cityId } = await gameWithCity('ClearIt')
    await setProduction(gameId, starter, cityId, { production: 11 })

    const response = await setProduction(gameId, starter, cityId, { production: null })
    expect(response.status).toBe(200)
    const view = await response.json() as ViewJson
    const city = view.you?.cities.find((candidate) => candidate.pieceId === cityId)
    expect(city?.override).toBeNull()
    expect(city?.effective).toBe(city?.estimate)
    expect(view.board.pieces.find((piece) => piece.id === cityId)).not.toHaveProperty('productionOverride')
    expect((await repo.findGame(gameId))?.board.pieces.find((piece) => piece.id === cityId)).not.toHaveProperty('productionOverride')
  })

  it('refuses a piece that is not a city, and one that does not exist', async () => {
    const { gameId, starter, buildingId } = await gameWithCity('NotCity')
    const building = await setProduction(gameId, starter, buildingId, { production: 5 })
    expect(building.status).toBe(400)
    expect(await errorOf(building)).toBe('PIECE_NOT_A_CITY')

    const missing = await setProduction(gameId, starter, 'no-such-piece', { production: 5 })
    expect(missing.status).toBe(404)
    expect(await errorOf(missing)).toBe('BOARD_PIECE_NOT_FOUND')
  })

  it.each([
    ['negative', -1],
    ['above 99', 100],
    ['a fraction', 2.5],
  ])('refuses a number that is %s', async (_label, production) => {
    const { gameId, starter, cityId } = await gameWithCity('BadNumber')
    const response = await setProduction(gameId, starter, cityId, { production })
    expect(response.status).toBe(400)
    expect(await errorOf(response)).toBe('INVALID_PRODUCTION_OVERRIDE')
    expect((await repo.findGame(gameId))?.board.pieces.find((piece) => piece.id === cityId)).not.toHaveProperty('productionOverride')
  })

  it.each([
    ['missing', {}],
    ['text', { production: '5' }],
    ['a boolean', { production: true }],
  ])('refuses a body where production is %s', async (_label, payload) => {
    const { gameId, starter, cityId } = await gameWithCity('BadBody')
    const response = await setProduction(gameId, starter, cityId, payload)
    expect(response.status).toBe(400)
    expect(await errorOf(response)).toBe('BAD_REQUEST')
  })

  it('answers a stale revision with 409 and changes nothing', async () => {
    const { gameId, starter, cityId } = await gameWithCity('Stale')
    const rev = (await repo.findGame(gameId))?.rev ?? 0

    const stale = await setProduction(gameId, starter, cityId, { production: 7, rev: rev - 1 })
    expect(stale.status).toBe(409)
    expect(await errorOf(stale)).toBe('CONFLICT')
    const after = await repo.findGame(gameId)
    expect(after?.rev).toBe(rev)
    expect(after?.board.pieces.find((piece) => piece.id === cityId)).not.toHaveProperty('productionOverride')

    const fresh = await setProduction(gameId, starter, cityId, { production: 7, rev })
    expect(fresh.status).toBe(200)
    expect((await repo.findGame(gameId))?.rev).toBe(rev + 1)
  })

  it('setting the number a city already has changes nothing, not even the revision', async () => {
    const { gameId, starter, cityId } = await gameWithCity('SameValue')
    await setProduction(gameId, starter, cityId, { production: 4 })
    const before = await repo.findGame(gameId)

    const again = await setProduction(gameId, starter, cityId, { production: 4 })
    expect(again.status).toBe(200)
    const after = await repo.findGame(gameId)
    expect(after?.rev).toBe(before?.rev)
    expect(after?.board.history).toHaveLength(before?.board.history.length ?? -1)
  })

  it('is taken back by the board undo, which restores the earlier value', async () => {
    const { gameId, starter, cityId } = await gameWithCity('UndoIt')
    await setProduction(gameId, starter, cityId, { production: 4 })
    await setProduction(gameId, starter, cityId, { production: 9 })

    const undone = await inject(app, {
      method: 'POST',
      url: `/api/games/${gameId}/board/undo`,
      headers: bearer(starter),
      payload: {},
    })
    expect(undone.status).toBe(200)
    expect((await undone.json() as ViewJson).you?.cities[0]?.override).toBe(4)
  })
})
