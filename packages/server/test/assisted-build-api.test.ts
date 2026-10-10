/**
 * Build over HTTP (task `assisted-build`, issue #264 part 2): the same
 * `/actions` route as every assisted action, with a payload that names the city,
 * the building and the square. The rules are in
 * `packages/engine/test/assisted-build.test.ts`; these check the wiring, the
 * payload validation, the status codes, the undo vote and that no other client
 * ever receives `buildOptions`.
 *
 * The scene is the engine tests': the America tile in the first map slot and a
 * city of the starter's colour on B2, whose only grassland square is C2 (column
 * 2, row 1) and whose estimate is 5 production.
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
import type { BoardPiece, CivItem, GameState } from '@civ/engine'

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

/** The building choices only: figures and units are offered in the same list (task `assisted-units`). */
const buildingChoices = (city: CityOptionsJson | undefined): readonly BuildChoiceJson[] =>
  (city?.choices ?? []).filter((choice) => choice.item.kind === 'building')

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

interface BuildChoiceJson {
  readonly assetId: string
  readonly item: { readonly kind: string; readonly assetId?: string }
  readonly placement: string
  readonly label: string
  readonly cost: number
  readonly tradeToPay: number
  readonly squares: readonly { readonly column: number; readonly row: number; readonly label: string }[]
}

interface CityOptionsJson {
  readonly cityPieceId: string
  readonly label: string
  readonly status: string
  readonly reason: string
  readonly production: number
  readonly productionSource: string
  readonly choices: readonly BuildChoiceJson[]
  readonly unavailable: readonly { readonly assetId: string; readonly reason: string }[]
}

interface View {
  readonly rev: number
  readonly you: {
    readonly stats: { readonly trade: number }
    readonly buildOptions?: readonly CityOptionsJson[]
  } | null
  readonly opponents: readonly { readonly playerId: string }[]
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

const view = async (gameId: string, token?: string): Promise<View> =>
  (await inject(app, { url: `/api/games/${gameId}`, ...(token === undefined ? {} : { headers: bearer(token) }) })).json<View>()

const post = (token: string, url: string, payload: unknown) =>
  inject(app, { method: 'POST', url, headers: bearer(token), payload })

interface Table {
  readonly gameId: string
  readonly starter: string
  readonly other: string
  readonly starterId: string
  readonly starterName: string
  readonly cityId: string
}

interface TableOptions {
  readonly techs?: readonly string[]
  readonly trade?: number
  /** Leave City Management closed. */
  readonly closed?: boolean
  readonly americans?: boolean
  /** A Building Program marker on the city. */
  readonly marker?: boolean
}

/** A started two-player game: the starter has a city on B2 of America, the techs revealed and the trade in hand. */
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
  const starterPlayer = found?.players.find((player) => player.yourTurn)
  if (starterPlayer === undefined) throw new Error('nobody has the first turn')
  const starterId = starterPlayer.playerId

  if (options.closed !== true) {
    expect((await post(starter, `/api/games/${gameId}/turns/done`, { phase: 'TRADE' })).status).toBe(200)
  }

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
  if (options.marker === true) state = at('markers/Building Program', 1, 1)
  for (const techName of options.techs ?? []) {
    state = unwrap(revealTech(unwrap(chooseTech(state, { playerId: starterId, techName })), { playerId: starterId, techName }))
  }
  state = {
    ...state,
    players: state.players.map((player) =>
      player.playerId === starterId
        ? {
            ...player,
            government: 'Monarchy',
            stats: { ...player.stats, trade: options.trade ?? 0 },
            ...(options.americans === true
              ? { civilization: { kind: 'civ', name: 'Americans' } as unknown as CivItem }
              : {}),
          }
        : player,
    ),
  }
  await repo.saveGame(state)
  return { gameId, starter, other, starterId, starterName: starterPlayer.username, cityId }
}

const LIBRARY = 'buildings/library'
const UNIVERSITY = 'buildings/university'
const C2 = { column: 2, row: 1 }

const buildBody = (table: Table, requestId: string, rev: number, assetId = LIBRARY, target = C2, rush?: boolean) => ({
  action: 'build',
  requestId,
  rev,
  cityPieceId: table.cityId,
  item: { kind: 'building', assetId },
  target,
  ...(rush === undefined ? {} : { rush }),
})

const sendBuild = (table: Table, requestId: string, rev: number, assetId = LIBRARY, target = C2, rush?: boolean, token = table.starter) =>
  post(token, `/api/games/${table.gameId}/actions`, buildBody(table, requestId, rev, assetId, target, rush))

const stored = async (table: Table): Promise<GameState> => {
  const state = await repo.findGame(table.gameId)
  if (state === undefined) throw new Error('game missing')
  return state
}

const piecesOf = (state: GameState, assetId: string): readonly BoardPiece[] =>
  state.board.pieces.filter((piece) => piece.assetId === assetId)

const tradeOf = (state: GameState, table: Table): number =>
  state.players.find((player) => player.playerId === table.starterId)?.stats.trade ?? -1

describe('the build options in the projection', () => {
  it('the owner sees what each city can build, with the squares', async () => {
    const table = await buildTable('Options', { techs: ['Writing'] })
    const mine = await view(table.gameId, table.starter)
    const city = mine.you?.buildOptions?.[0]
    expect(city).toMatchObject({ cityPieceId: table.cityId, label: 'City B2', status: 'ready', production: 5, productionSource: 'estimate' })
    expect(buildingChoices(city)).toEqual([
      {
        assetId: LIBRARY,
        item: { kind: 'building', assetId: LIBRARY },
        placement: 'square',
        label: 'Library',
        cost: 5,
        tradeToPay: 0,
        squares: [{ ...C2, label: 'C2' }],
      },
    ])
    expect(city?.unavailable.find((entry) => entry.assetId === UNIVERSITY)?.reason).toBe('Needs Printing Press.')
  })

  it('outside City Management the city says so and offers nothing', async () => {
    const table = await buildTable('Closed', { techs: ['Writing'], closed: true })
    const city = (await view(table.gameId, table.starter)).you?.buildOptions?.[0]
    expect(city).toMatchObject({ status: 'wrong-phase', choices: [], unavailable: [] })
  })

  it('the other player and a spectator get no options of the starter\'s', async () => {
    const table = await buildTable('Hidden', { techs: ['Writing'] })
    const outsider = await register('Hidden-spectator')
    const asOther = await inject(app, { url: `/api/games/${table.gameId}`, headers: bearer(table.other) })
    const asSpectator = await inject(app, { url: `/api/games/${table.gameId}`, headers: bearer(outsider) })
    const anonymous = await inject(app, { url: `/api/games/${table.gameId}` })

    expect((await asOther.json<View>()).you?.buildOptions).toEqual([])
    for (const response of [asOther, asSpectator, anonymous]) {
      expect(response.status).toBe(200)
      expect(response.body).not.toContain('"choices"')
      expect(response.body).not.toContain('tradeToPay')
      expect(response.body).not.toContain('Needs Printing Press')
    }
    for (const response of [asSpectator, anonymous]) {
      expect(response.body).not.toContain('buildOptions')
      expect((await response.json<View>()).you).toBeNull()
    }
  })

  it('a chosen but unrevealed tech unlocks nothing for the owner and is not told to anyone else', async () => {
    const table = await buildTable('Unrevealed')
    expect((await post(table.starter, `/api/games/${table.gameId}/techs/choose`, { name: 'Writing' })).status).toBe(200)
    const mine = await view(table.gameId, table.starter)
    expect(buildingChoices(mine.you?.buildOptions?.[0])).toEqual([])
    expect(mine.you?.buildOptions?.[0]?.unavailable.find((entry) => entry.assetId === LIBRARY)?.reason).toBe(
      'Needs Writing. Writing is chosen but not revealed yet.',
    )
    const theirs = await inject(app, { url: `/api/games/${table.gameId}`, headers: bearer(table.other) })
    expect(theirs.body).not.toContain('chosen but not revealed')
  })

  it('a replayed revision shows no options, though the live state has them', async () => {
    const table = await buildTable('Replay', { techs: ['Writing'] })
    const ready = await view(table.gameId, table.starter)
    expect(buildingChoices(ready.you?.buildOptions?.[0])).toHaveLength(1)
    expect((await sendBuild(table, 'req-1', ready.rev)).status).toBe(200)

    const past = await inject(app, {
      url: `/api/games/${table.gameId}/revisions/${ready.rev}`,
      headers: bearer(table.starter),
    })
    expect(past.status).toBe(200)
    const replay = await past.json<{ view: View }>()
    expect(replay.view.board.pieces.some((piece) => piece.assetId === LIBRARY)).toBe(false)
    expect(replay.view.you?.buildOptions).toEqual([])
  })
})

describe('building over HTTP', () => {
  it('places the building, answers with the projection and logs one public line', async () => {
    const table = await buildTable('Build', { techs: ['Writing'] })
    const before = await view(table.gameId, table.starter)

    const response = await sendBuild(table, 'req-1', before.rev)

    expect(response.status).toBe(200)
    const after = await response.json<View>()
    expect(after.rev).toBe(before.rev + 1)
    expect(after.board.pieces.filter((piece) => piece.assetId === LIBRARY)).toHaveLength(1)
    // The square is used, so the Library has no square left and is no choice any more
    const city = after.you?.buildOptions?.[0]
    expect(buildingChoices(city)).toEqual([])
    expect(city?.unavailable.find((entry) => entry.assetId === LIBRARY)?.reason).toMatch(/^No legal square\./)
    expect(after.assistedActions).toEqual([
      expect.objectContaining({
        id: 'req-1', kind: 'build', status: 'applied', text: `${table.starterName} built a Library in City B2 on square C2`,
      }),
    ])
    const publicLog = await inject(app, { url: `/api/games/${table.gameId}/log/public`, headers: bearer(table.other) })
    expect(publicLog.body).toContain('built a Library in City B2 on square C2')
  })

  it('a rush pays the trade and needs the flag', async () => {
    const table = await buildTable('Rush', { techs: ['Printing Press'], trade: 12 })
    const rev = (await view(table.gameId, table.starter)).rev

    const without = await sendBuild(table, 'req-1', rev, UNIVERSITY)
    expect(without.status).toBe(400)
    expect(JSON.stringify(await without.json())).toContain('Confirm paying 9 trade')
    expect(tradeOf(await stored(table), table)).toBe(12)

    const rushed = await sendBuild(table, 'req-2', rev, UNIVERSITY, C2, true)
    expect(rushed.status).toBe(200)
    expect((await rushed.json<View>()).you?.stats.trade).toBe(3)
  })

  it('the Americans pay 6 trade for the same shortfall', async () => {
    const table = await buildTable('Americans', { techs: ['Printing Press'], trade: 12, americans: true })
    const options = (await view(table.gameId, table.starter)).you?.buildOptions?.[0]
    expect(options?.choices.find((choice) => choice.assetId === UNIVERSITY)?.tradeToPay).toBe(6)
    const rushed = await sendBuild(table, 'req-1', (await view(table.gameId, table.starter)).rev, UNIVERSITY, C2, true)
    expect((await rushed.json<View>()).you?.stats.trade).toBe(6)
  })

  it('uses up the Building Program marker', async () => {
    const table = await buildTable('Program', { techs: ['Writing'], marker: true })
    const mine = await view(table.gameId, table.starter)
    expect(mine.you?.buildOptions?.[0]).toMatchObject({ production: 10, productionSource: 'building-program' })
    const response = await sendBuild(table, 'req-1', mine.rev)
    expect(response.status).toBe(200)
    expect(piecesOf(await stored(table), 'markers/Building Program')).toEqual([])
  })

  it('a retry with the same request id builds once and creates no revision', async () => {
    const table = await buildTable('Retry', { techs: ['Writing'] })
    const rev = (await view(table.gameId, table.starter)).rev
    const first = await sendBuild(table, 'req-1', rev)
    expect(first.status).toBe(200)
    const settled = await first.json<View>()

    // A tab that missed the answer retries with the revision it saw
    const retry = await sendBuild(table, 'req-1', settled.rev)
    expect(retry.status).toBe(200)
    expect((await retry.json<View>()).rev).toBe(settled.rev)
    const state = await stored(table)
    expect(piecesOf(state, LIBRARY)).toHaveLength(1)
    expect(state.assistedActions).toHaveLength(1)
  })

  it('two parallel presses with the same request id have one effect', async () => {
    const table = await buildTable('Parallel', { techs: ['Writing'] })
    const rev = (await view(table.gameId, table.starter)).rev
    const [first, second] = await Promise.all([sendBuild(table, 'req-1', rev), sendBuild(table, 'req-1', rev)])
    for (const status of [first.status, second.status]) expect([200, 409]).toContain(status)
    expect([first.status, second.status]).toContain(200)
    expect(piecesOf(await stored(table), LIBRARY)).toHaveLength(1)
  })

  it('a stale rev is a 409 and builds nothing', async () => {
    const table = await buildTable('Stale', { techs: ['Writing'] })
    const rev = (await view(table.gameId, table.starter)).rev
    const stale = await sendBuild(table, 'req-1', rev - 1)
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ error: 'CONFLICT' })
    expect(piecesOf(await stored(table), LIBRARY)).toEqual([])
  })

  it('a second build on the same square is refused with the reason, and the board is unchanged', async () => {
    const table = await buildTable('Taken', { techs: ['Writing'] })
    const rev = (await view(table.gameId, table.starter)).rev
    const first = await (await sendBuild(table, 'req-1', rev)).json<View>()
    const second = await sendBuild(table, 'req-2', first.rev)
    expect(second.status).toBe(400)
    expect(await second.json()).toMatchObject({
      error: 'ASSISTED_ACTION_REJECTED',
      message: expect.stringContaining('No legal square'),
    })
    expect(piecesOf(await stored(table), LIBRARY)).toHaveLength(1)
  })

  it('a wrong square names what is wrong with it', async () => {
    const table = await buildTable('Square', { techs: ['Writing', 'Currency'] })
    const rev = (await view(table.gameId, table.starter)).rev
    const response = await sendBuild(table, 'req-1', rev, LIBRARY, { column: 0, row: 0 })
    expect(response.status).toBe(400)
    expect(JSON.stringify(await response.json())).toContain('A1 is mountain, and a Library needs grassland')
  })

  it('outside City Management it is a 400 with the phase reason, and a stranger gets 403', async () => {
    const table = await buildTable('Phase', { techs: ['Writing'], closed: true })
    const rev = (await view(table.gameId, table.starter)).rev
    const closed = await sendBuild(table, 'req-1', rev)
    expect(closed.status).toBe(400)
    expect(await closed.json()).toMatchObject({
      error: 'ASSISTED_ACTION_REJECTED',
      message: 'Only available during your open City Management phase.',
    })

    const outsider = await register('Phase-spectator')
    const forbidden = await sendBuild(table, 'req-2', rev, LIBRARY, C2, undefined, outsider)
    expect(forbidden.status).toBe(403)
    expect(piecesOf(await stored(table), LIBRARY)).toEqual([])
  })

  it('the other player cannot build with the starter\'s city', async () => {
    const table = await buildTable('Theirs', { techs: ['Writing'] })
    const rev = (await view(table.gameId, table.starter)).rev
    const response = await sendBuild(table, 'req-1', rev, LIBRARY, C2, undefined, table.other)
    expect(response.status).toBe(400)
    expect(piecesOf(await stored(table), LIBRARY)).toEqual([])
  })
})

describe('the payload', () => {
  async function refused(name: string, mutate: (body: Record<string, unknown>) => Record<string, unknown>): Promise<string> {
    const table = await buildTable(name, { techs: ['Writing'] })
    const rev = (await view(table.gameId, table.starter)).rev
    const response = await post(table.starter, `/api/games/${table.gameId}/actions`, mutate({ ...buildBody(table, 'req-1', rev) }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'BAD_REQUEST' })
    expect(piecesOf(await stored(table), LIBRARY)).toEqual([])
    return JSON.stringify(await response.json())
  }

  it('needs a city piece id of plain characters', async () => {
    await refused('NoCity', ({ cityPieceId: _gone, ...rest }) => rest)
    await refused('OddCity', (body) => ({ ...body, cityPieceId: 'a city' }))
    await refused('LongCity', (body) => ({ ...body, cityPieceId: 'x'.repeat(65) }))
    await refused('NumberCity', (body) => ({ ...body, cityPieceId: 12 }))
  })

  it('needs a building item with a known asset id', async () => {
    await refused('NoItem', ({ item: _gone, ...rest }) => rest)
    await refused('FigureItem', (body) => ({ ...body, item: { kind: 'figure', assetId: LIBRARY } }))
    await refused('UnknownAsset', (body) => ({ ...body, item: { kind: 'building', assetId: 'buildings/castle' } }))
    await refused('NotABuilding', (body) => ({ ...body, item: { kind: 'building', assetId: 'figures/redarmy' } }))
    await refused('NumberAsset', (body) => ({ ...body, item: { kind: 'building', assetId: 7 } }))
    await refused('ArrayItem', (body) => ({ ...body, item: [LIBRARY] }))
  })

  it('needs a target of whole numbers from 0 to 63', async () => {
    await refused('NoTarget', ({ target: _gone, ...rest }) => rest)
    await refused('FractionTarget', (body) => ({ ...body, target: { column: 1.5, row: 1 } }))
    await refused('NegativeTarget', (body) => ({ ...body, target: { column: -1, row: 1 } }))
    await refused('HugeTarget', (body) => ({ ...body, target: { column: 64, row: 1 } }))
    await refused('StringTarget', (body) => ({ ...body, target: { column: '2', row: '1' } }))
    await refused('MissingRow', (body) => ({ ...body, target: { column: 2 } }))
  })

  it('takes rush only as a boolean', async () => {
    await refused('StringRush', (body) => ({ ...body, rush: 'true' }))
    await refused('NumberRush', (body) => ({ ...body, rush: 1 }))
  })

  it('the build fields belong to build only, and the reward fields to chooseReward only', async () => {
    const table = await buildTable('Stray', { techs: ['Writing'] })
    const rev = (await view(table.gameId, table.starter)).rev
    for (const extra of [{ cityPieceId: table.cityId }, { item: { kind: 'building', assetId: LIBRARY } }, { target: C2 }, { rush: true }]) {
      const response = await post(table.starter, `/api/games/${table.gameId}/actions`, {
        action: 'cultureAdvance', requestId: 'req-1', rev, ...extra,
      })
      expect(response.status).toBe(400)
      expect(JSON.stringify(await response.json())).toContain('only belong to build')
    }
    const reward = await post(table.starter, `/api/games/${table.gameId}/actions`, {
      ...buildBody(table, 'req-2', rev), rewardId: 'req-1',
    })
    expect(reward.status).toBe(400)
    expect(JSON.stringify(await reward.json())).toContain('only belong to chooseReward')
    // chooseReward is unchanged: it still wants both ids
    const choose = await post(table.starter, `/api/games/${table.gameId}/actions`, {
      action: 'chooseReward', requestId: 'req-3', rev, rewardId: 'req-1',
    })
    expect(choose.status).toBe(400)
    expect(piecesOf(await stored(table), LIBRARY)).toEqual([])
  })
})

describe('undo over HTTP', () => {
  const logIdOf = async (table: Table): Promise<string> =>
    (await view(table.gameId, table.other)).assistedActions[0]?.logId as string

  it('another player asks, the builder votes yes, and the building leaves again', async () => {
    const table = await buildTable('Undo', { techs: ['Writing'] })
    expect((await sendBuild(table, 'req-1', (await view(table.gameId, table.starter)).rev)).status).toBe(200)
    const logId = await logIdOf(table)

    expect((await post(table.other, `/api/games/${table.gameId}/undo/${logId}`, {})).status).toBe(200)
    const voted = await post(table.starter, `/api/games/${table.gameId}/undo/${logId}/vote`, { vote: true })
    expect(voted.status).toBe(200)

    const after = await voted.json<View>()
    expect(after.assistedActions[0]?.status).toBe('undone')
    expect(after.board.pieces.some((piece) => piece.assetId === LIBRARY)).toBe(false)
    // It can be built again
    expect(buildingChoices(after.you?.buildOptions?.[0]).map((choice) => choice.assetId)).toEqual([LIBRARY])
    expect((await stored(table)).log.at(-1)?.publicLog).toBe(`System: ${table.starterName}'s Library on C2 was undone: the building was removed`)
  })

  it('refunds the trade and puts the marker back', async () => {
    const table = await buildTable('UndoAll', { techs: ['Printing Press'], trade: 12, marker: true })
    const before = await stored(table)
    const marker = piecesOf(before, 'markers/Building Program')[0]
    // The marker doubles the outskirts to 10, so the 8 University needs no trade; set a hand number to force a rush
    const city = before.board.pieces.find((piece) => piece.id === table.cityId)
    expect(city).toBeDefined()
    await repo.saveGame({
      ...before,
      board: {
        ...before.board,
        pieces: before.board.pieces.map((piece) => (piece.id === table.cityId ? { ...piece, productionOverride: 5 } : piece)),
      },
    })
    expect((await sendBuild(table, 'req-1', (await view(table.gameId, table.starter)).rev, UNIVERSITY, C2, true)).status).toBe(200)
    expect(tradeOf(await stored(table), table)).toBe(3)
    expect(piecesOf(await stored(table), 'markers/Building Program')).toEqual([])

    const logId = await logIdOf(table)
    await post(table.other, `/api/games/${table.gameId}/undo/${logId}`, {})
    const voted = await post(table.starter, `/api/games/${table.gameId}/undo/${logId}/vote`, { vote: true })
    expect(voted.status).toBe(200)

    const after = await stored(table)
    expect(tradeOf(after, table)).toBe(12)
    expect(piecesOf(after, UNIVERSITY)).toEqual([])
    expect(piecesOf(after, 'markers/Building Program')).toEqual([expect.objectContaining({ id: marker?.id, x: marker?.x, y: marker?.y })])
  })

  it('is refused with a 409 when the building has been moved, and nothing changes', async () => {
    const table = await buildTable('UndoMoved', { techs: ['Writing'] })
    expect((await sendBuild(table, 'req-1', (await view(table.gameId, table.starter)).rev)).status).toBe(200)
    const piece = piecesOf(await stored(table), LIBRARY)[0] as BoardPiece
    const moved = await post(table.other, `/api/games/${table.gameId}/board/pieces/${piece.id}/move`, {
      x: 3 * SQUARE_SIZE + 4,
      y: mapTop((await stored(table)).board) + 3 * SQUARE_SIZE + 4,
    })
    expect(moved.status).toBe(200)

    const logId = await logIdOf(table)
    await post(table.other, `/api/games/${table.gameId}/undo/${logId}`, {})
    const refused = await post(table.starter, `/api/games/${table.gameId}/undo/${logId}/vote`, { vote: true })
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ error: 'ASSISTED_UNDO_BLOCKED' })
    const after = await stored(table)
    expect(after.assistedActions[0]?.status).toBe('applied')
    expect(piecesOf(after, LIBRARY)).toHaveLength(1)
  })

  it('the board Undo cannot take back the placed building, and answers 409', async () => {
    const table = await buildTable('BoardUndo', { techs: ['Writing'] })
    expect((await sendBuild(table, 'req-1', (await view(table.gameId, table.starter)).rev)).status).toBe(200)
    const before = await stored(table)

    const refused = await post(table.starter, `/api/games/${table.gameId}/board/undo`, {})

    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ error: 'BOARD_UNDO_ASSISTED' })
    const after = await stored(table)
    expect(after.rev).toBe(before.rev)
    expect(piecesOf(after, LIBRARY)).toHaveLength(1)
  })
})
