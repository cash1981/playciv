/**
 * A. P. Giannini's free building over HTTP: the same `/actions` route as every assisted action. The
 * rules are in `packages/engine/test/great-person-giannini.test.ts`; these check the strict shape of
 * `args`, an accepted request and what another player sees.
 *
 * The scene: the America tile in the first map slot and a city of the starter's colour on B2, Writing
 * revealed, a coin on the sheet and Giannini faceup in the starter's hand. Start of Turn stays open.
 */

import type { App } from '../src/app.js'
import { beforeEach, describe, expect, it } from 'vitest'

import { SQUARE_SIZE, chooseTech, mapTop, placePiece, revealTech, slotOrigin, unwrap } from '@civ/engine'
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

interface View {
  readonly rev: number
  readonly you: {
    readonly startOfTurn: {
      readonly giannini: {
        readonly status: string
        readonly choices: readonly {
          readonly assetId: string
          readonly label: string
          readonly squares: readonly { readonly cityPieceId: string; readonly column: number; readonly row: number; readonly label: string }[]
        }[]
      } | null
    } | null
  } | null
  readonly board: { readonly pieces: readonly { readonly id: string; readonly assetId: string }[] }
  readonly assistedActions: readonly { id: string; kind: string; status: string; text: string }[]
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

async function table(name: string) {
  const creator = await register(`${name}-a`)
  const created = await inject(app, {
    method: 'POST', url: '/api/games', headers: bearer(creator), payload: { name, numOfPlayers: 2 },
  })
  const gameId = (await created.json() as { id: string }).id
  const joiner = await register(`${name}-b`)
  await post(joiner, `/api/games/${gameId}/join`, {})

  let state = await repo.findGame(gameId)
  if (state === undefined) throw new Error('game missing')
  const starterPlayer = state.players.find((player) => player.yourTurn)
  const starterId = starterPlayer?.playerId ?? ''
  const starter = starterPlayer?.username === `${name}-a` ? creator : joiner
  const other = starter === creator ? joiner : creator
  const colour = starterPlayer?.color
  if (colour === null || colour === undefined) throw new Error('the starter has no colour')

  const slot = state.board.slots[0]
  if (slot === undefined) throw new Error('board has no slots')
  const [x, y] = slotOrigin(state.board, slot)
  state = unwrap(placePiece(state, { playerId: starterId, assetId: 'tiles/america', x, y }))
  state = unwrap(placePiece(state, {
    playerId: starterId,
    assetId: `cities/${colour.toLowerCase()}city2`,
    x: 1 * SQUARE_SIZE + 4,
    y: mapTop(state.board) + 1 * SQUARE_SIZE + 4,
  }))
  const cityId = state.board.pieces.at(-1)?.id ?? ''
  state = unwrap(revealTech(unwrap(chooseTech(state, { playerId: starterId, techName: 'Writing' })), { playerId: starterId, techName: 'Writing' }))
  const card = state.items.find((item) => item.kind === 'greatperson' && 'name' in item && item.name === 'A. P. Giannini')
  if (card === undefined) throw new Error('no Giannini card in the deck')
  const found: GameState = state
  await repo.saveGame({
    ...found,
    items: found.items.filter((item) => item.id !== card.id),
    players: found.players.map((player) =>
      player.playerId === starterId
        ? {
            ...player,
            items: [...player.items, { ...card, hidden: false, ownerId: starterId }],
            stats: { ...player.stats, coinSources: { ...player.stats.coinSources, sheet: 1 } },
          }
        : player,
    ),
  })
  return { gameId, starter, other, cityId }
}

const actions = (gameId: string) => `/api/games/${gameId}/actions`

describe('A. P. Giannini through the actions route', () => {
  it('builds the free building after an invest, and shows his choices to nobody else', async () => {
    const t = await table('gia-ok')
    const before = await view(t.gameId, t.starter)
    expect(before.you?.startOfTurn?.giannini).toMatchObject({ status: 'unavailable', choices: [] })
    const invested = await post(t.starter, actions(t.gameId), {
      action: 'invest', requestId: 'req-1', rev: before.rev, args: { source: 'sheet', card: 'infra' },
    })
    expect(invested.status).toBe(200)
    const ready = await invested.json<View>()
    const library = ready.you?.startOfTurn?.giannini?.choices.find((choice) => choice.assetId === 'buildings/library')
    const square = library?.squares[0]
    expect(ready.you?.startOfTurn?.giannini?.status).toBe('ready')
    if (square === undefined) throw new Error('no square for the Library')

    const theirs = await view(t.gameId, t.other)
    expect(theirs.you?.startOfTurn?.giannini).toBeNull()
    expect(JSON.stringify(theirs)).not.toContain('cityLabel')

    const response = await post(t.starter, actions(t.gameId), {
      action: 'gianniniBuild',
      requestId: 'req-2',
      rev: ready.rev,
      args: { cityPieceId: square.cityPieceId, assetId: 'buildings/library', column: square.column, row: square.row },
    })
    expect(response.status).toBe(200)
    const after = await response.json<View>()
    expect(after.board.pieces.some((piece) => piece.assetId === 'buildings/library')).toBe(true)
    expect(after.assistedActions[1]).toMatchObject({ kind: 'gianniniBuild', status: 'applied' })
    expect(after.assistedActions[1]?.text).toMatch(/built a Library on [A-Z]\d+ for free with A\. P\. Giannini$/)
    expect(after.you?.startOfTurn?.giannini?.status).toBe('used')
  })

  it('refuses a malformed shape and changes nothing', async () => {
    const t = await table('gia-shape')
    const rev = (await view(t.gameId, t.starter)).rev
    const good = { cityPieceId: t.cityId, assetId: 'buildings/library', column: 2, row: 1 }
    const bad: unknown[] = [
      {},
      'x',
      { ...good, extra: true },
      { ...good, cityPieceId: '../etc' },
      { ...good, cityPieceId: undefined },
      { ...good, assetId: 'wonders/pyramids' },
      { ...good, assetId: 3 },
      { ...good, column: 1.5 },
      { ...good, column: -1 },
      { ...good, row: 1000 },
      { ...good, row: '1' },
    ]
    for (const args of bad) {
      const response = await post(t.starter, actions(t.gameId), {
        action: 'gianniniBuild', requestId: `req-${Math.random()}`, rev, args,
      })
      expect(response.status).toBe(400)
    }
    expect((await repo.findGame(t.gameId))?.assistedActions).toHaveLength(0)
  })

  it('refuses a well-formed request before an invest, with the reason', async () => {
    const t = await table('gia-early')
    const rev = (await view(t.gameId, t.starter)).rev
    const response = await post(t.starter, actions(t.gameId), {
      action: 'gianniniBuild',
      requestId: 'req-1',
      rev,
      args: { cityPieceId: t.cityId, assetId: 'buildings/library', column: 2, row: 1 },
    })
    expect(response.status).toBe(400)
    expect(JSON.stringify(await response.json())).toContain('Invest a coin')
    expect((await repo.findGame(t.gameId))?.board.pieces.some((piece) => piece.assetId === 'buildings/library')).toBe(false)
  })
})
