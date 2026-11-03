/**
 * Mark Twain over HTTP (issue #301): `POST /api/games/:id/twain` cancels another player's city action and rewinds the
 * game to the stored revision before it. The rules are in `packages/engine/test/great-person-twain.test.ts`; these
 * check the wiring: the revision lookup, the refusal when somebody else has saved a revision since, and that the game
 * is saved as a new revision with the cancelled action on the record.
 */

import type { App } from '../src/app.js'
import { beforeEach, describe, expect, it } from 'vitest'

import { SQUARE_SIZE, mapTop, placePiece, slotOrigin, unwrap } from '@civ/engine'

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

interface View {
  readonly rev: number
  readonly assistedActions: readonly { id: string; kind: string; status: string; logId: string; text: string }[]
}

async function register(username: string): Promise<string> {
  const response = await inject(app, {
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'secret', email: `${username}@example.com`, securityAnswer: 'writing' },
  })
  expect(response.status).toBe(201)
  return (await response.json() as { token: string }).token
}

const view = async (gameId: string, token: string): Promise<View> =>
  (await inject(app, { url: `/api/games/${gameId}`, headers: bearer(token) })).json<View>()

const post = (token: string, url: string, payload: unknown) =>
  inject(app, { method: 'POST', url, headers: bearer(token), payload })

interface Table {
  readonly gameId: string
  readonly starter: string
  readonly other: string
  readonly starterId: string
  readonly otherId: string
  readonly cityId: string
  readonly twainId: string
}

/** A started two-player game: the starter has a city on B2 of America, City Management is open and the other player holds Mark Twain. */
async function table(name: string): Promise<Table> {
  const creator = await register(`${name}-a`)
  const created = await inject(app, { method: 'POST', url: '/api/games', headers: bearer(creator), payload: { name, numOfPlayers: 2 } })
  const gameId = (await created.json() as { id: string }).id
  const joiner = await register(`${name}-b`)
  await post(joiner, `/api/games/${gameId}/join`, {})

  const found = await repo.findGame(gameId)
  const starterPlayer = found?.players.find((player) => player.yourTurn)
  if (found === undefined || starterPlayer === undefined) throw new Error('nobody has the first turn')
  const starter = starterPlayer.username === `${name}-a` ? creator : joiner
  const other = starter === creator ? joiner : creator
  let state = await repo.findGame(gameId)
  if (state === undefined) throw new Error('game missing')
  const colour = state.players.find((player) => player.playerId === starterPlayer.playerId)?.color
  const slot = state.board.slots[0]
  if (colour === null || colour === undefined || slot === undefined) throw new Error('no colour or slot')
  const [x, y] = slotOrigin(state.board, slot)
  state = unwrap(placePiece(state, { playerId: starterPlayer.playerId, assetId: 'tiles/america', x, y }))
  state = unwrap(
    placePiece(state, {
      playerId: starterPlayer.playerId,
      assetId: `cities/${colour.toLowerCase()}city2`,
      x: 1 * SQUARE_SIZE + 4,
      y: mapTop(state.board) + 1 * SQUARE_SIZE + 4,
    }),
  )
  const cityId = state.board.pieces.at(-1)?.id ?? ''
  const otherPlayer = state.players.find((player) => player.playerId !== starterPlayer.playerId)
  const twain = state.items.find((item) => item.kind === 'greatperson' && item.name === 'Mark Twain')
  if (otherPlayer === undefined || twain === undefined) throw new Error('no Mark Twain card in the fixture')
  state = {
    ...state,
    items: state.items.filter((item) => item.id !== twain.id),
    players: state.players.map((player) =>
      player.playerId === otherPlayer.playerId ? { ...player, items: [...player.items, { ...twain, hidden: true, ownerId: otherPlayer.playerId }] } : player,
    ),
  }
  await repo.saveGame(state)
  // Through the route, so the history starts from the game with the city and the card in place
  expect((await post(starter, `/api/games/${gameId}/turns/done`, { phase: 'TRADE' })).status).toBe(200)
  return { gameId, starter, other, starterId: starterPlayer.playerId, otherId: otherPlayer.playerId, cityId, twainId: twain.id }
}

const startProgram = async (t: Table, requestId: string) =>
  post(t.starter, `/api/games/${t.gameId}/actions`, {
    action: 'startBuildingProgram',
    requestId,
    rev: (await view(t.gameId, t.starter)).rev,
    cityPieceId: t.cityId,
  })

const logIdOf = async (t: Table, requestId: string): Promise<string> => {
  const record = (await view(t.gameId, t.starter)).assistedActions.find((action) => action.id === requestId)
  if (record === undefined) throw new Error('no such action')
  return record.logId
}

describe('Mark Twain over HTTP', () => {
  it('rewinds to the stored revision before the action and keeps the city action on the record as cancelled', async () => {
    const t = await table('Rewind')
    expect((await startProgram(t, 'sp-1')).status).toBe(200)
    const logId = await logIdOf(t, 'sp-1')
    const before = await repo.findGame(t.gameId)
    expect(before?.board.pieces.some((piece) => piece.assetId === 'markers/Building Program')).toBe(true)

    const response = await post(t.other, `/api/games/${t.gameId}/twain`, { logId })
    const answer = response.status === 200 ? '' : JSON.stringify(await response.json())
    expect([response.status, answer]).toEqual([200, ''])

    const after = await repo.findGame(t.gameId)
    // The Building Program marker the action placed is gone, the action stays as cancelled and Twain is discarded
    expect(after?.board.pieces.some((piece) => piece.assetId === 'markers/Building Program')).toBe(false)
    expect(after?.assistedActions.map((record) => record.status)).toEqual(['cancelled'])
    expect(after?.players.find((player) => player.playerId === t.otherId)?.items.some((item) => item.id === t.twainId)).toBe(false)
    expect(after?.discardedItems.some((item) => item.id === t.twainId)).toBe(true)
    expect(after?.log.at(-1)?.publicLog).toContain('cancelled the city action of')
    // It is a new revision of the game, never the old counter reused
    expect(after?.rev).toBe((before?.rev ?? 0) + 1)
    const seen = await view(t.gameId, t.starter)
    expect(seen.assistedActions.map((action) => action.status)).toEqual(['cancelled'])
  })

  it('is refused when somebody else has saved a revision since the action, and changes nothing', async () => {
    const t = await table('Erase')
    expect((await startProgram(t, 'sp-1')).status).toBe(200)
    const logId = await logIdOf(t, 'sp-1')
    // The other player acts after it: a rewind would erase their action
    expect((await post(t.other, `/api/games/${t.gameId}/techs/choose`, { name: 'Pottery' })).status).toBe(200)
    const rev = (await repo.findGame(t.gameId))?.rev

    const response = await post(t.other, `/api/games/${t.gameId}/twain`, { logId })
    expect(response.status).toBe(409)
    expect(JSON.stringify(await response.json())).toContain('Another player has acted since')
    expect((await repo.findGame(t.gameId))?.rev).toBe(rev)
  })

  it('is refused for a player without the card, for one\'s own action and for an unknown line', async () => {
    const t = await table('Refuse')
    expect((await startProgram(t, 'sp-1')).status).toBe(200)
    const logId = await logIdOf(t, 'sp-1')
    // The starter has no Mark Twain card, and it is their own action in any case
    expect((await post(t.starter, `/api/games/${t.gameId}/twain`, { logId })).status).toBe(400)
    expect((await post(t.other, `/api/games/${t.gameId}/twain`, { logId: 'nope' })).status).toBe(400)
    expect((await post(t.other, `/api/games/${t.gameId}/twain`, {})).status).toBe(400)
    const stale = await post(t.other, `/api/games/${t.gameId}/twain`, { logId, rev: 0 })
    expect(stale.status).toBe(409)
    expect((await repo.findGame(t.gameId))?.assistedActions.map((record) => record.status)).toEqual(['applied'])
  })
})
