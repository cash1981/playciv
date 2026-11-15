/**
 * Agriculture over HTTP (issue #354): the payload is a strict `{ direction }`, the engine decides which direction is legal
 * (rules in `packages/engine/test/assisted-agriculture.test.ts`), the line is public and the vote undo turns the marker back.
 */

import { SQUARE_SIZE, chooseTech, mapTop, placePiece, revealTech, slotOrigin, unwrap } from '@civ/engine'
import type { BoardPiece, GameState } from '@civ/engine'
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

interface View {
  readonly rev: number
  readonly you: { readonly availableActions?: readonly { action: string; status: string; reason: string; group: string }[] } | null
  readonly board: { readonly pieces: readonly { readonly id: string; readonly assetId: string; readonly x: number; readonly y: number }[] }
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

const post = (token: string, url: string, payload: unknown) => inject(app, { method: 'POST', url, headers: bearer(token), payload })
const view = async (gameId: string, token: string): Promise<View> =>
  (await inject(app, { url: `/api/games/${gameId}`, headers: bearer(token) })).json<View>()
const entryOf = (v: View) => v.you?.availableActions?.find((entry) => entry.action === 'agriculture')

interface Table {
  readonly gameId: string
  readonly starter: string
  readonly other: string
  readonly starterId: string
  readonly capitalId: string
  readonly colour: string
}

/** A started two-player game: the starter has a capital on D4 of an 8 x 8 map corner and Agriculture revealed (or not). */
async function table(name: string, options: { readonly agriculture?: boolean; readonly extra?: readonly (readonly [string, number, number])[] } = {}): Promise<Table> {
  const creator = await register(`${name}-a`)
  const created = await inject(app, { method: 'POST', url: '/api/games', headers: bearer(creator), payload: { name, numOfPlayers: 2 } })
  const gameId = (await created.json() as { id: string }).id
  const joiner = await register(`${name}-b`)
  await post(joiner, `/api/games/${gameId}/join`, {})
  const found = await repo.findGame(gameId)
  const starter = found?.players.find((player) => player.yourTurn)?.username === `${name}-a` ? creator : joiner
  const other = starter === creator ? joiner : creator
  const starterId = found?.players.find((player) => player.yourTurn)?.playerId ?? ''

  let state = await repo.findGame(gameId)
  if (state === undefined) throw new Error('game missing')
  const colour = state.players.find((player) => player.playerId === starterId)?.color?.toLowerCase()
  if (colour === undefined) throw new Error('the starter has no colour')
  const lay = (slotIndex: number, assetId: string): void => {
    const slot = (state as GameState).board.slots[slotIndex]
    if (slot === undefined) throw new Error('no slot')
    const [x, y] = slotOrigin((state as GameState).board, slot)
    state = unwrap(placePiece(state as GameState, { playerId: starterId, assetId, x, y }))
  }
  lay(0, 'tiles/tile12')
  lay(1, 'tiles/tile23b')
  lay(4, 'tiles/america')
  lay(5, 'tiles/china')
  const at = (assetId: string, column: number, row: number): GameState =>
    unwrap(placePiece(state as GameState, { playerId: starterId, assetId, x: column * SQUARE_SIZE + 4, y: mapTop((state as GameState).board) + row * SQUARE_SIZE + 4 }))
  state = at(`cities/${colour}capital2`, 3, 3)
  const capitalId = state.board.pieces.at(-1)?.id ?? ''
  for (const [assetId, column, row] of options.extra ?? []) state = at(assetId, column, row)
  if (options.agriculture !== false) {
    state = unwrap(revealTech(unwrap(chooseTech(state, { playerId: starterId, techName: 'Agriculture' })), { playerId: starterId, techName: 'Agriculture' }))
  }
  await repo.saveGame(state)
  return { gameId, starter, other, starterId, capitalId, colour }
}

const send = (t: Table, requestId: string, rev: number, args: unknown, token = t.starter) =>
  post(token, `/api/games/${t.gameId}/actions`, { action: 'agriculture', requestId, rev, ...(args === undefined ? {} : { args }) })

describe('Agriculture over HTTP', () => {
  it('is ready for the owner with a Cities button, and nobody else is offered it', async () => {
    const t = await table('Agri')
    const mine = entryOf(await view(t.gameId, t.starter))
    expect(mine).toMatchObject({ status: 'ready', group: 'Cities' })
    expect(entryOf(await view(t.gameId, t.other))?.status).toBe('not-owned')
  })

  it('takes a strict direction: anything else is a 400 and changes nothing', async () => {
    const t = await table('AgriArgs')
    const rev = (await view(t.gameId, t.starter)).rev
    for (const args of [undefined, {}, { direction: 'up' }, { direction: 7 }, { direction: 'east', extra: 1 }, [], 'east']) {
      expect((await send(t, 'req-bad', rev, args)).status, JSON.stringify(args)).toBe(400)
    }
    expect((await repo.findGame(t.gameId))?.assistedActions).toHaveLength(0)
  })

  it('turns the capital over to the metropolis, names it in the public line, and the vote undo turns it back', async () => {
    const t = await table('AgriGrow')
    const response = await send(t, 'req-1', (await view(t.gameId, t.starter)).rev, { direction: 'east' })
    expect(response.status).toBe(200)
    const after = await response.json<View>()
    const grown = after.board.pieces.find((piece) => piece.id === t.capitalId)
    expect(grown?.assetId).toBe(`cities/${t.colour}metropolis2`)
    expect(after.assistedActions[0]?.text).toMatch(/used Agriculture: grew their capital on D4 into a metropolis: D4 and E4 to the east are its two city squares$/)
    // The other player sees the same public line and the metropolis on the board
    const seen = await view(t.gameId, t.other)
    expect(seen.board.pieces.find((piece) => piece.id === t.capitalId)?.assetId).toBe(`cities/${t.colour}metropolis2`)
    // Once: the capital marker is gone, so it is no longer offered and another request is refused
    expect(entryOf(after)).toMatchObject({ status: 'unavailable', reason: 'Your capital is already a metropolis.' })
    const again = await send(t, 'req-2', after.rev, { direction: 'west' })
    expect(again.status).toBe(400)
    expect(await again.json()).toMatchObject({ error: 'ASSISTED_ACTION_REJECTED' })

    const logId = after.assistedActions[0]?.logId as string
    expect((await post(t.other, `/api/games/${t.gameId}/undo/${logId}`, {})).status).toBe(200)
    expect((await post(t.starter, `/api/games/${t.gameId}/undo/${logId}/vote`, { vote: true })).status).toBe(200)
    const undone = (await repo.findGame(t.gameId)) as GameState
    const piece = undone.board.pieces.find((candidate) => candidate.id === t.capitalId) as BoardPiece
    expect(piece.assetId).toBe(`cities/${t.colour}capital2`)
    expect(entryOf(await view(t.gameId, t.starter))?.status).toBe('ready')
  })

  it('refuses an illegal direction with the reason, as a 400, and keeps the capital', async () => {
    const t = await table('AgriBlocked', { extra: [['figures/bluearmy', 4, 3]] })
    // A blue army stands on E4: an enemy's, or the starter's own when they are blue; the direction is refused either way
    const rev = (await view(t.gameId, t.starter)).rev
    const response = await send(t, 'req-1', rev, { direction: 'east' })
    expect(response.status).toBe(400)
    const body = await response.json<{ error: string; reason?: string; message?: string }>()
    expect(body.error).toBe('ASSISTED_ACTION_REJECTED')
    expect(JSON.stringify(body)).toMatch(/cannot grow east/)
    const state = (await repo.findGame(t.gameId)) as GameState
    expect(state.board.pieces.find((piece) => piece.id === t.capitalId)?.assetId).toBe(`cities/${t.colour}capital2`)
  })

  it('is refused without Agriculture revealed', async () => {
    const t = await table('AgriNone', { agriculture: false })
    expect(entryOf(await view(t.gameId, t.starter))?.status).toBe('not-owned')
    const response = await send(t, 'req-1', (await view(t.gameId, t.starter)).rev, { direction: 'east' })
    expect(response.status).toBe(400)
  })
})
