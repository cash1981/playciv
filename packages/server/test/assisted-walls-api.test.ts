/**
 * City Walls and replacing a building over HTTP: the same `/actions` route as every assisted
 * action. The rules are in `packages/engine/test/assisted-walls.test.ts` and
 * `assisted-build.test.ts`; these check the payload validation, the projection, the status
 * codes and the undo vote.
 *
 * The scene is the build tests': the America tile in the first map slot and a city of the
 * starter's colour on B2, whose outskirts include the grassland square C2 (column 2, row 1).
 */

import type { App } from '../src/app.js'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  SQUARE_SIZE,
  chooseTech,
  mapTop,
  placePiece,
  revealTech,
  slotOrigin,
  unwrap,
} from '@civ/engine'
import type { BoardPiece, GameState } from '@civ/engine'

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
    readonly stats: { readonly trade: number }
    readonly buildOptions?: readonly {
      readonly cityPieceId: string
      readonly choices: readonly {
        readonly assetId: string
        readonly item: { readonly kind: string }
        readonly placement: string
        readonly cost: number
        readonly squares: readonly { readonly label: string; readonly note?: string; readonly replaces?: { readonly assetId: string; readonly label: string; readonly kind: string } }[]
      }[]
      readonly unavailable: readonly { readonly assetId: string; readonly reason: string }[]
    }[]
  } | null
  readonly board: { readonly pieces: readonly { readonly id: string; readonly assetId: string }[] }
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
  readonly cityId: string
  readonly colour: string
}

interface TableOptions {
  readonly techs?: readonly string[]
  readonly production?: number
  /** Pieces of the starter put on the map: asset id and square. */
  readonly pieces?: readonly (readonly [string, number, number])[]
}

/** A started two-player game: the starter has a city on B2 of America, the techs revealed and the production set. */
async function buildTable(name: string, options: TableOptions = {}): Promise<Table> {
  const creator = await register(`${name}-a`)
  const created = await inject(app, {
    method: 'POST', url: '/api/games', headers: bearer(creator), payload: { name, numOfPlayers: 2 },
  })
  const gameId = (await created.json() as { id: string }).id
  const joiner = await register(`${name}-b`)
  await post(joiner, `/api/games/${gameId}/join`, {})

  const found = await repo.findGame(gameId)
  const starter = found?.players.find((player) => player.yourTurn)?.username === `${name}-a` ? creator : joiner
  const other = starter === creator ? joiner : creator
  const starterId = found?.players.find((player) => player.yourTurn)?.playerId ?? ''
  expect((await post(starter, `/api/games/${gameId}/turns/done`, { phase: 'TRADE' })).status).toBe(200)

  let state = await repo.findGame(gameId)
  if (state === undefined) throw new Error('game missing')
  const colour = state.players.find((player) => player.playerId === starterId)?.color
  if (colour === null || colour === undefined) throw new Error('the starter has no colour')

  const slot = state.board.slots[0]
  if (slot === undefined) throw new Error('board has no slots')
  const [x, y] = slotOrigin(state.board, slot)
  state = unwrap(placePiece(state, { playerId: starterId, assetId: 'tiles/america', x, y }))
  const at = (assetId: string, column: number, row: number): GameState =>
    unwrap(placePiece(state as GameState, {
      playerId: starterId,
      assetId,
      x: column * SQUARE_SIZE + 4,
      y: mapTop((state as GameState).board) + row * SQUARE_SIZE + 4,
    }))
  state = at(`cities/${colour.toLowerCase()}city2`, 1, 1)
  const cityId = state.board.pieces.at(-1)?.id ?? ''
  for (const [assetId, column, row] of options.pieces ?? []) state = at(assetId, column, row)
  for (const techName of options.techs ?? []) {
    state = unwrap(revealTech(unwrap(chooseTech(state, { playerId: starterId, techName })), { playerId: starterId, techName }))
  }
  state = {
    ...state,
    board: {
      ...state.board,
      pieces: state.board.pieces.map((piece) =>
        piece.id === cityId && options.production !== undefined ? { ...piece, productionOverride: options.production } : piece,
      ),
    },
    players: state.players.map((player) =>
      player.playerId === starterId ? { ...player, government: 'Monarchy', stats: { ...player.stats, trade: 0 } } : player,
    ),
  }
  await repo.saveGame(state)
  return { gameId, starter, other, starterId, cityId, colour: colour.toLowerCase() }
}

const stored = async (table: Table): Promise<GameState> => {
  const state = await repo.findGame(table.gameId)
  if (state === undefined) throw new Error('game missing')
  return state
}

const cityPiece = (state: GameState, table: Table): BoardPiece =>
  state.board.pieces.find((piece) => piece.id === table.cityId) as BoardPiece

const send = (table: Table, requestId: string, rev: number, body: Record<string, unknown>) =>
  post(table.starter, `/api/games/${table.gameId}/actions`, { action: 'build', requestId, rev, cityPieceId: table.cityId, ...body })

const revOf = async (table: Table): Promise<number> => (await view(table.gameId, table.starter)).rev

/** The other player asks for the undo of the first assisted action and the starter votes yes: two players, so it passes. */
async function voteUndo(table: Table) {
  const logId = (await view(table.gameId, table.other)).assistedActions[0]?.logId as string
  expect((await post(table.other, `/api/games/${table.gameId}/undo/${logId}`, {})).status).toBe(200)
  return post(table.starter, `/api/games/${table.gameId}/undo/${logId}/vote`, { vote: true })
}

describe('City Walls over HTTP', () => {
  it('are in the owner\'s options with no square, and say what is missing without Masonry', async () => {
    const without = await buildTable('NoMasonry')
    const city = (await view(without.gameId, without.starter)).you?.buildOptions?.[0]
    expect(city?.choices.find((choice) => choice.item.kind === 'walls')).toBeUndefined()
    expect(city?.unavailable.find((entry) => entry.assetId === 'walls')?.reason).toBe('Needs Masonry.')

    const table = await buildTable('Masonry', { techs: ['Masonry'], production: 7 })
    const walls = (await view(table.gameId, table.starter)).you?.buildOptions?.[0]?.choices.find((choice) => choice.item.kind === 'walls')
    expect(walls).toEqual({ assetId: 'walls', item: { kind: 'walls' }, placement: 'none', label: 'City Walls', cost: 7, tradeToPay: 0, squares: [] })
  })

  it('are in nobody else\'s view: the other player and a spectator see no walls option and no replacement note', async () => {
    const table = await buildTable('Private', { techs: ['Masonry', 'Writing'], production: 7, pieces: [['buildings/granary', 2, 1]] })
    expect(JSON.stringify((await view(table.gameId, table.starter)).you?.buildOptions)).toContain('City Walls')
    const outsider = await register('Private-spectator')
    for (const token of [table.other, outsider]) {
      const response = await inject(app, { url: `/api/games/${table.gameId}`, headers: bearer(token) })
      expect(response.status).toBe(200)
      expect(response.body).not.toContain('City Walls')
      expect(response.body).not.toContain('Replaces your')
      expect(response.body).not.toContain('"placement"')
    }
  })

  it('turn the city marker over, name it in the public line, and the vote undo turns it back', async () => {
    const table = await buildTable('Flip', { techs: ['Masonry'], production: 7 })
    const response = await send(table, 'req-1', await revOf(table), { item: { kind: 'walls' } })
    expect(response.status).toBe(200)
    const after = await response.json<View>()
    expect(after.board.pieces.find((piece) => piece.id === table.cityId)?.assetId).toBe(`cities/${table.colour}citywalled2`)
    expect(after.assistedActions[0]).toMatchObject({ kind: 'build', status: 'applied' })
    expect(after.assistedActions[0]?.text).toContain('built City Walls in City B2, turning the city marker over to its walled side')
    expect(cityPiece(await stored(table), table).productionOverride).toBe(7)

    expect((await voteUndo(table)).status).toBe(200)
    expect(cityPiece(await stored(table), table).assetId).toBe(`cities/${table.colour}city2`)
  })

  it('take no target and no other field, and are refused without Masonry', async () => {
    const table = await buildTable('Refused', { techs: ['Masonry'], production: 7 })
    const rev = await revOf(table)
    const target = await send(table, 'req-1', rev, { item: { kind: 'walls' }, target: { column: 2, row: 1 } })
    expect(target.status).toBe(400)
    expect(JSON.stringify(await target.json())).toContain('City Walls have no target')
    const extra = await send(table, 'req-2', rev, { item: { kind: 'walls', assetId: 'cities/redcitywalled2' } })
    expect(extra.status).toBe(400)
    expect(cityPiece(await stored(table), table).assetId).toBe(`cities/${table.colour}city2`)

    const bare = await buildTable('BareRefused')
    const refused = await send(bare, 'req-1', await revOf(bare), { item: { kind: 'walls' } })
    expect(refused.status).toBe(400)
    expect(JSON.stringify(await refused.json())).toContain('Needs Masonry.')
  })
})

describe('replacing a building over HTTP', () => {
  it('the square says what it replaces, the build takes the old building off, and the vote undo puts it back', async () => {
    const table = await buildTable('Replace', { techs: ['Writing'], production: 5, pieces: [['buildings/granary', 2, 1]] })
    const library = (await view(table.gameId, table.starter)).you?.buildOptions?.[0]?.choices.find((choice) => choice.assetId === 'buildings/library')
    expect(library?.squares).toEqual([
      {
        column: 2,
        row: 1,
        label: 'C2',
        note: 'Replaces your Granary, which is taken off the board and goes back to the supply.',
        replaces: { assetId: 'buildings/granary', label: 'Granary', kind: 'building' },
      },
    ])

    const response = await send(table, 'req-1', await revOf(table), {
      item: { kind: 'building', assetId: 'buildings/library' },
      target: { column: 2, row: 1 },
    })
    expect(response.status).toBe(200)
    const after = await response.json<View>()
    expect(after.board.pieces.some((piece) => piece.assetId === 'buildings/granary')).toBe(false)
    expect(after.board.pieces.some((piece) => piece.assetId === 'buildings/library')).toBe(true)
    expect(after.assistedActions[0]?.text).toContain('built a Library in City B2 on square C2, replacing the Granary')

    expect((await voteUndo(table)).status).toBe(200)
    const undone = await stored(table)
    expect(undone.board.pieces.some((piece) => piece.assetId === 'buildings/granary')).toBe(true)
    expect(undone.board.pieces.some((piece) => piece.assetId === 'buildings/library')).toBe(false)
  })
})
