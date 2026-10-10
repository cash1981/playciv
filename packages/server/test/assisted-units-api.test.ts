/**
 * Build for army and scout figures and military units over HTTP (task
 * `assisted-units`, issue #264 parts 3 and 4): the same `/actions` route as every
 * assisted action. The rules are in `packages/engine/test/assisted-units.test.ts`;
 * these check the payload validation, the status codes, that a retry or a stale
 * tab builds nothing twice, the undo vote, and that the card of a unit never
 * reaches another client.
 *
 * The scene is the build tests': the America tile in the first map slot and a
 * city of the starter's colour on B2, whose outskirts include the grassland
 * square C2 (column 2, row 1) and the water square C1, and whose estimate is 5
 * production. A unit of level 1 costs 5, an army 4 and a scout 6.
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
import type { BoardPiece, GameState, Item } from '@civ/engine'

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

interface BuildChoiceJson {
  readonly assetId: string
  readonly item: { readonly kind: string; readonly unitType?: string }
  readonly placement: string
  readonly label: string
  readonly cost: number
  readonly tradeToPay: number
  readonly squares: readonly { readonly column: number; readonly row: number; readonly label: string; readonly note?: string }[]
}

interface View {
  readonly rev: number
  readonly you: {
    readonly stats: { readonly trade: number }
    readonly items: readonly { readonly id: string }[]
    readonly buildOptions?: readonly {
      readonly cityPieceId: string
      readonly choices: readonly BuildChoiceJson[]
      readonly unavailable: readonly { readonly assetId: string; readonly reason: string }[]
    }[]
  } | null
  readonly numberOfItemsInDeck: number
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
  /** The starter's colour in lower case, as the figure asset ids have it. */
  readonly colour: string
}

interface TableOptions {
  readonly techs?: readonly string[]
  readonly trade?: number
  /** Leave City Management closed. */
  readonly closed?: boolean
  /** A hand set production for the city. */
  readonly production?: number
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
    board: {
      ...state.board,
      pieces: state.board.pieces.map((piece) =>
        piece.id === cityId && options.production !== undefined ? { ...piece, productionOverride: options.production } : piece,
      ),
    },
    players: state.players.map((player) =>
      player.playerId === starterId
        ? { ...player, government: 'Monarchy', stats: { ...player.stats, trade: options.trade ?? 0 } }
        : player,
    ),
  }
  await repo.saveGame(state)
  return { gameId, starter, other, starterId, starterName: starterPlayer.username, cityId, colour: colour.toLowerCase() }
}

const C2 = { column: 2, row: 1 }

type ItemBody = Record<string, unknown>

const ARMY: ItemBody = { kind: 'army' }
const SCOUT: ItemBody = { kind: 'scout' }
const unit = (unitType: string): ItemBody => ({ kind: 'unit', unitType })

/** The body of a build request; a figure gets its square, a unit none. */
const bodyFor = (table: Table, requestId: string, rev: number, item: ItemBody, extra: Record<string, unknown> = {}) => ({
  action: 'build',
  requestId,
  rev,
  cityPieceId: table.cityId,
  item,
  ...(item['kind'] === 'unit' ? {} : { target: C2 }),
  ...extra,
})

const send = (table: Table, requestId: string, rev: number, item: ItemBody, extra: Record<string, unknown> = {}, token = table.starter) =>
  post(token, `/api/games/${table.gameId}/actions`, bodyFor(table, requestId, rev, item, extra))

const stored = async (table: Table): Promise<GameState> => {
  const state = await repo.findGame(table.gameId)
  if (state === undefined) throw new Error('game missing')
  return state
}

const piecesOf = (state: GameState, assetId: string): readonly BoardPiece[] =>
  state.board.pieces.filter((piece) => piece.assetId === assetId)

const handOf = (state: GameState, table: Table): readonly Item[] =>
  state.players.find((player) => player.playerId === table.starterId)?.items ?? []

const tradeOf = (state: GameState, table: Table): number =>
  state.players.find((player) => player.playerId === table.starterId)?.stats.trade ?? -1

const revOf = async (table: Table): Promise<number> => (await view(table.gameId, table.starter)).rev

describe('the options in the projection', () => {
  it('the owner sees figures with squares and units with none, and each says how it is placed', async () => {
    const table = await buildTable('Options', { trade: 3 })
    const city = (await view(table.gameId, table.starter)).you?.buildOptions?.[0]
    const army = city?.choices.find((choice) => choice.item.kind === 'army')
    expect(army).toMatchObject({ assetId: `figures/${table.colour}army`, placement: 'square', label: 'Army figure', cost: 4, tradeToPay: 0 })
    expect(army?.squares.map((square) => square.label)).toContain('C2')
    expect(army?.squares.map((square) => square.label)).not.toContain('C1')
    expect(city?.choices.find((choice) => choice.item.kind === 'scout')).toMatchObject({ cost: 6, tradeToPay: 3 })
    expect(city?.choices.find((choice) => choice.item.unitType === 'infantry')).toEqual({
      assetId: 'units/infantry',
      item: { kind: 'unit', unitType: 'infantry' },
      placement: 'none',
      label: 'Infantry unit',
      cost: 5,
      tradeToPay: 0,
      squares: [],
    })
    expect(city?.unavailable.find((entry) => entry.assetId === 'units/aircraft')?.reason).toBe('Needs Flight.')
  })

  it('water shows up for a figure only with a water tech', async () => {
    const without = await buildTable('Dry')
    const dry = (await view(without.gameId, without.starter)).you?.buildOptions?.[0]
    expect(dry?.choices.find((choice) => choice.item.kind === 'army')?.squares.map((square) => square.label)).not.toContain('C1')
    const sailing = await buildTable('Wet', { techs: ['Sailing'] })
    const wet = (await view(sailing.gameId, sailing.starter)).you?.buildOptions?.[0]
    expect(wet?.choices.find((choice) => choice.item.kind === 'army')?.squares.map((square) => square.label)).toContain('C1')
  })

  it('the other player and a spectator see none of it', async () => {
    const table = await buildTable('Hidden', { trade: 3 })
    const outsider = await register('Hidden-spectator')
    for (const token of [table.other, outsider, undefined]) {
      const response = await inject(app, {
        url: `/api/games/${table.gameId}`,
        ...(token === undefined ? {} : { headers: bearer(token) }),
      })
      expect(response.status).toBe(200)
      expect(response.body).not.toContain('"placement"')
      expect(response.body).not.toContain('units/infantry')
      expect(response.body).not.toContain('Needs Flight')
    }
  })
})

describe('building a figure over HTTP', () => {
  it('an army is put on the square, named in the public line, and the answer is the projection', async () => {
    const table = await buildTable('Army')
    const before = await view(table.gameId, table.starter)

    const response = await send(table, 'req-1', before.rev, ARMY)

    expect(response.status).toBe(200)
    const after = await response.json<View>()
    expect(after.rev).toBe(before.rev + 1)
    const pieces = after.board.pieces.filter((piece) => piece.assetId === `figures/${table.colour}army`)
    expect(pieces).toHaveLength(1)
    expect(after.assistedActions).toEqual([
      expect.objectContaining({
        id: 'req-1', kind: 'build', status: 'applied', text: `${table.starterName} built an army in City B2 on square C2`,
      }),
    ])
    const publicLog = await inject(app, { url: `/api/games/${table.gameId}/log/public`, headers: bearer(table.other) })
    expect(publicLog.body).toContain('built an army in City B2 on square C2')
  })

  it('a scout is a rush that needs the flag and pays the trade', async () => {
    const table = await buildTable('Scout', { trade: 5 })
    const rev = await revOf(table)

    const without = await send(table, 'req-1', rev, SCOUT)
    expect(without.status).toBe(400)
    expect(JSON.stringify(await without.json())).toContain('Confirm paying 3 trade')
    expect(piecesOf(await stored(table), `figures/${table.colour}scout`)).toEqual([])

    const rushed = await send(table, 'req-2', rev, SCOUT, { rush: true })
    expect(rushed.status).toBe(200)
    expect((await rushed.json<View>()).you?.stats.trade).toBe(2)
    expect(piecesOf(await stored(table), `figures/${table.colour}scout`)).toHaveLength(1)
  })

  it('water is refused without a tech and accepted with one', async () => {
    const dry = await buildTable('NoWater')
    const refused = await send(dry, 'req-1', await revOf(dry), ARMY, { target: { column: 2, row: 0 } })
    expect(refused.status).toBe(400)
    expect(JSON.stringify(await refused.json())).toContain('C1 is water')

    const wet = await buildTable('Water', { techs: ['Steam Power'] })
    const ok = await send(wet, 'req-1', await revOf(wet), ARMY, { target: { column: 2, row: 0 } })
    expect(ok.status).toBe(200)
  })

  it('a full square is refused with the stacking limit named', async () => {
    const table = await buildTable('Stack')
    expect((await send(table, 'req-1', await revOf(table), ARMY)).status).toBe(200)
    expect((await send(table, 'req-2', await revOf(table), ARMY)).status).toBe(200)
    const third = await send(table, 'req-3', await revOf(table), ARMY)
    expect(third.status).toBe(400)
    expect(JSON.stringify(await third.json())).toContain('stacking limit of 2')
    expect(piecesOf(await stored(table), `figures/${table.colour}army`)).toHaveLength(2)
  })

  it('uses up the Building Program marker', async () => {
    const table = await buildTable('Program', { marker: true })
    expect((await send(table, 'req-1', await revOf(table), ARMY)).status).toBe(200)
    expect(piecesOf(await stored(table), 'markers/Building Program')).toEqual([])
  })
})

describe('building a unit over HTTP', () => {
  it('the card goes to the hand, the board is unchanged and the public line has the type only', async () => {
    const table = await buildTable('Unit')
    const before = await stored(table)
    const top = before.items.find((item) => item.sheetName === 'MOUNTED') as Item

    const response = await send(table, 'req-1', before.rev, unit('mounted'))

    expect(response.status).toBe(200)
    const after = await response.json<View>()
    expect(after.you?.items.map((item) => item.id)).toContain(top.id)
    expect(after.numberOfItemsInDeck).toBe(before.items.length - 1)
    expect(after.board.pieces).toHaveLength(before.board.pieces.length)
    expect(after.assistedActions).toEqual([
      expect.objectContaining({ kind: 'build', text: `${table.starterName} built a mounted unit in City B2` }),
    ])
    const state = await stored(table)
    expect(state.board.history).toEqual(before.board.history)
    expect(handOf(state, table).find((item) => item.id === top.id)).toMatchObject({ hidden: true, ownerId: table.starterId })
  })

  it('the card is in nobody else\'s view, nor in the public log, nor in the record', async () => {
    const table = await buildTable('Secret')
    const before = await stored(table)
    const top = before.items.find((item) => item.sheetName === 'INFANTRY') as Item
    expect((await send(table, 'req-1', before.rev, unit('infantry'))).status).toBe(200)

    const outsider = await register('Secret-spectator')
    for (const token of [table.other, outsider, undefined]) {
      const response = await inject(app, {
        url: `/api/games/${table.gameId}`,
        ...(token === undefined ? {} : { headers: bearer(token) }),
      })
      expect(response.body).not.toContain(top.id)
      expect(response.body).not.toContain('"effect"')
      expect(response.body).not.toContain('"card"')
      expect(response.body).toContain('built an infantry unit in City B2')
    }
    const publicLog = await inject(app, { url: `/api/games/${table.gameId}/log/public`, headers: bearer(table.other) })
    expect(publicLog.body).toContain('built an infantry unit in City B2')
    expect(publicLog.body).not.toContain(top.id)
    // The owner reads it in their own hand
    expect(JSON.stringify((await view(table.gameId, table.starter)).you?.items)).toContain(top.id)
  })

  it('a rush pays the trade', async () => {
    const table = await buildTable('UnitRush', { trade: 9, production: 2 })
    const rev = await revOf(table)
    const without = await send(table, 'req-1', rev, unit('artillery'))
    expect(without.status).toBe(400)
    expect(JSON.stringify(await without.json())).toContain('Confirm paying 9 trade')
    const rushed = await send(table, 'req-2', rev, unit('artillery'), { rush: true })
    expect(rushed.status).toBe(200)
    expect((await rushed.json<View>()).you?.stats.trade).toBe(0)
  })

  it('aircraft need a revealed Flight', async () => {
    const without = await buildTable('NoFlight', { trade: 30 })
    const refused = await send(without, 'req-1', await revOf(without), unit('aircraft'), { rush: true })
    expect(refused.status).toBe(400)
    expect(JSON.stringify(await refused.json())).toContain('Needs Flight')
    const flying = await buildTable('Flight', { techs: ['Flight'], trade: 30 })
    const ok = await send(flying, 'req-1', await revOf(flying), unit('aircraft'), { rush: true })
    expect(ok.status).toBe(200)
    expect((await ok.json<View>()).you?.stats.trade).toBe(9)
  })

  it('an empty deck is refused with the reason, and nothing is drawn', async () => {
    const table = await buildTable('Empty')
    const state = await stored(table)
    await repo.saveGame({
      ...state,
      items: state.items.filter((item) => item.sheetName !== 'INFANTRY'),
      discardedItems: state.discardedItems.filter((item) => item.sheetName !== 'INFANTRY'),
    })
    const response = await send(table, 'req-1', await revOf(table), unit('infantry'))
    expect(response.status).toBe(400)
    expect(JSON.stringify(await response.json())).toContain('No infantry unit cards left')
    expect(handOf(await stored(table), table)).toEqual(handOf(state, table))
  })
})

describe('requests', () => {
  it('a retry of a unit build with the same request id draws once and creates no revision', async () => {
    const table = await buildTable('Retry')
    const rev = await revOf(table)
    const first = await send(table, 'req-1', rev, unit('infantry'))
    expect(first.status).toBe(200)
    const settled = await first.json<View>()

    const retry = await send(table, 'req-1', settled.rev, unit('infantry'))
    expect(retry.status).toBe(200)
    expect((await retry.json<View>()).rev).toBe(settled.rev)
    const state = await stored(table)
    expect(state.assistedActions).toHaveLength(1)
    expect(handOf(state, table).filter((item) => item.sheetName === 'INFANTRY')).toHaveLength(1)
  })

  it('a retry of a figure build builds once', async () => {
    const table = await buildTable('RetryFigure')
    const first = await send(table, 'req-1', await revOf(table), ARMY)
    const settled = await first.json<View>()
    expect((await send(table, 'req-1', settled.rev, ARMY)).status).toBe(200)
    expect(piecesOf(await stored(table), `figures/${table.colour}army`)).toHaveLength(1)
  })

  it('two parallel presses with the same request id have one effect', async () => {
    const table = await buildTable('Parallel')
    const rev = await revOf(table)
    const [first, second] = await Promise.all([send(table, 'req-1', rev, unit('infantry')), send(table, 'req-1', rev, unit('infantry'))])
    expect([first.status, second.status]).toContain(200)
    for (const status of [first.status, second.status]) expect([200, 409]).toContain(status)
    expect(handOf(await stored(table), table).filter((item) => item.sheetName === 'INFANTRY')).toHaveLength(1)
  })

  it('a stale rev is a 409 and builds nothing', async () => {
    const table = await buildTable('Stale')
    const rev = await revOf(table)
    for (const item of [ARMY, unit('infantry')]) {
      const stale = await send(table, `req-${String(item['kind'])}`, rev - 1, item)
      expect(stale.status).toBe(409)
      expect(await stale.json()).toMatchObject({ error: 'CONFLICT' })
    }
    const state = await stored(table)
    expect(piecesOf(state, `figures/${table.colour}army`)).toEqual([])
    expect(handOf(state, table).filter((item) => item.sheetName === 'INFANTRY')).toEqual([])
  })

  it('outside City Management it is a 400 with the phase reason for both kinds, and a stranger gets 403', async () => {
    const table = await buildTable('Phase', { closed: true })
    const rev = await revOf(table)
    for (const item of [ARMY, unit('infantry')]) {
      const closed = await send(table, `req-${String(item['kind'])}`, rev, item)
      expect(closed.status).toBe(400)
      expect(await closed.json()).toMatchObject({
        error: 'ASSISTED_ACTION_REJECTED',
        message: 'Only available during your open City Management phase.',
      })
    }
    const outsider = await register('Phase-spectator')
    expect((await send(table, 'req-x', rev, unit('infantry'), {}, outsider)).status).toBe(403)
    const state = await stored(table)
    expect(piecesOf(state, `figures/${table.colour}army`)).toEqual([])
    expect(handOf(state, table)).toEqual([])
  })

  it('the other player cannot build with the starter\'s city', async () => {
    const table = await buildTable('Theirs')
    const response = await send(table, 'req-1', await revOf(table), unit('infantry'), {}, table.other)
    expect(response.status).toBe(400)
    expect((await stored(table)).assistedActions).toEqual([])
  })
})

describe('the payload', () => {
  async function refused(name: string, mutate: (body: Record<string, unknown>) => Record<string, unknown>, item: ItemBody = ARMY): Promise<string> {
    const table = await buildTable(name)
    const rev = await revOf(table)
    const response = await post(table.starter, `/api/games/${table.gameId}/actions`, mutate({ ...bodyFor(table, 'req-1', rev, item) }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'BAD_REQUEST' })
    const state = await stored(table)
    expect(piecesOf(state, `figures/${table.colour}army`)).toEqual([])
    expect(handOf(state, table)).toEqual([])
    return JSON.stringify(await response.json())
  }

  it('takes only the known item shapes', async () => {
    await refused('KindUnknown', (body) => ({ ...body, item: { kind: 'navy' } }))
    await refused('KindNumber', (body) => ({ ...body, item: { kind: 7 } }))
    await refused('ItemString', (body) => ({ ...body, item: 'army' }))
    await refused('ItemArray', (body) => ({ ...body, item: ['army'] }))
  })

  it('a unit needs a known unit type', async () => {
    const unitBody = (item: Record<string, unknown>) => (body: Record<string, unknown>) => ({ ...body, item })
    await refused('NoType', unitBody({ kind: 'unit' }), unit('infantry'))
    await refused('TypeUnknown', unitBody({ kind: 'unit', unitType: 'navy' }), unit('infantry'))
    await refused('TypeUpper', unitBody({ kind: 'unit', unitType: 'Infantry' }), unit('infantry'))
    await refused('TypeNumber', unitBody({ kind: 'unit', unitType: 1 }), unit('infantry'))
    await refused('TypeArray', unitBody({ kind: 'unit', unitType: ['infantry'] }), unit('infantry'))
  })

  it('an item takes no extra field, whatever its kind', async () => {
    await refused('ArmyAsset', (body) => ({ ...body, item: { kind: 'army', assetId: 'figures/redarmy' } }))
    await refused('ScoutType', (body) => ({ ...body, item: { kind: 'scout', unitType: 'infantry' } }))
    await refused('UnitAsset', (body) => ({ ...body, item: { kind: 'unit', unitType: 'infantry', assetId: 'units/infantry' } }), unit('infantry'))
    await refused('BuildingExtra', (body) => ({ ...body, item: { kind: 'building', assetId: 'buildings/library', cost: 0 } }))
    await refused('ArmyLevel', (body) => ({ ...body, item: { kind: 'army', level: 4 } }))
  })

  it('a unit takes no target, and says why', async () => {
    const message = await refused('UnitTarget', (body) => ({ ...body, target: C2 }), unit('infantry'))
    expect(message).toContain('a unit has no target')
    await refused('UnitBadTarget', (body) => ({ ...body, target: 'anywhere' }), unit('infantry'))
    await refused('UnitNullTarget', (body) => ({ ...body, target: null }), unit('infantry'))
  })

  it('a figure needs a target of whole numbers from 0 to 63', async () => {
    await refused('ArmyNoTarget', ({ target: _gone, ...rest }) => rest)
    await refused('ScoutNoTarget', ({ target: _gone, ...rest }) => rest, SCOUT)
    await refused('ArmyFraction', (body) => ({ ...body, target: { column: 1.5, row: 1 } }))
    await refused('ArmyNegative', (body) => ({ ...body, target: { column: -1, row: 1 } }))
    await refused('ArmyHuge', (body) => ({ ...body, target: { column: 64, row: 1 } }))
    await refused('ArmyString', (body) => ({ ...body, target: { column: '2', row: '1' } }))
  })

  it('rush is a boolean for a unit too', async () => {
    await refused('UnitStringRush', (body) => ({ ...body, rush: 'true' }), unit('infantry'))
    await refused('ArmyNumberRush', (body) => ({ ...body, rush: 1 }))
  })

  it('the building shape still works as before', async () => {
    const table = await buildTable('Building', { techs: ['Writing'] })
    const ok = await send(table, 'req-1', await revOf(table), { kind: 'building', assetId: 'buildings/library' })
    expect(ok.status).toBe(200)
    expect(piecesOf(await stored(table), 'buildings/library')).toHaveLength(1)
  })
})

describe('undo over HTTP', () => {
  const logIdOf = async (table: Table): Promise<string> =>
    (await view(table.gameId, table.other)).assistedActions[0]?.logId as string

  async function voteUndo(table: Table) {
    const logId = await logIdOf(table)
    expect((await post(table.other, `/api/games/${table.gameId}/undo/${logId}`, {})).status).toBe(200)
    return post(table.starter, `/api/games/${table.gameId}/undo/${logId}/vote`, { vote: true })
  }

  it('a figure leaves again when the vote passes', async () => {
    const table = await buildTable('UndoArmy')
    expect((await send(table, 'req-1', await revOf(table), ARMY)).status).toBe(200)

    const voted = await voteUndo(table)

    expect(voted.status).toBe(200)
    const after = await voted.json<View>()
    expect(after.assistedActions[0]?.status).toBe('undone')
    expect(after.board.pieces.some((piece) => piece.assetId === `figures/${table.colour}army`)).toBe(false)
    expect((await stored(table)).log.at(-1)?.publicLog).toBe(`System: ${table.starterName}'s army on C2 was undone: the figure was removed`)
  })

  it('a unit goes back to the deck with its card, and the trade is refunded', async () => {
    const table = await buildTable('UndoUnit', { trade: 9, production: 2, marker: true })
    const before = await stored(table)
    const top = before.items.find((item) => item.sheetName === 'MOUNTED') as Item
    const marker = piecesOf(before, 'markers/Building Program')[0]
    expect((await send(table, 'req-1', before.rev, unit('mounted'), { rush: true })).status).toBe(200)
    const built = await stored(table)
    expect(handOf(built, table).some((item) => item.id === top.id)).toBe(true)
    expect(tradeOf(built, table)).toBe(0)
    expect(piecesOf(built, 'markers/Building Program')).toEqual([])

    const voted = await voteUndo(table)

    expect(voted.status).toBe(200)
    const after = await stored(table)
    expect(handOf(after, table).some((item) => item.id === top.id)).toBe(false)
    expect(after.items.some((item) => item.id === top.id)).toBe(true)
    expect(after.items).toHaveLength(before.items.length)
    expect(tradeOf(after, table)).toBe(9)
    expect(piecesOf(after, 'markers/Building Program')).toEqual([expect.objectContaining({ id: marker?.id })])
    expect((await view(table.gameId, table.other)).assistedActions[0]?.status).toBe('undone')
    // The card does not appear in anybody else's view after the undo either
    const theirs = await inject(app, { url: `/api/games/${table.gameId}`, headers: bearer(table.other) })
    expect(theirs.body).not.toContain(top.id)
  })

  it('is refused with a 409 when the figure has been moved, and nothing changes', async () => {
    const table = await buildTable('UndoMoved')
    expect((await send(table, 'req-1', await revOf(table), ARMY)).status).toBe(200)
    const piece = piecesOf(await stored(table), `figures/${table.colour}army`)[0] as BoardPiece
    const moved = await post(table.other, `/api/games/${table.gameId}/board/pieces/${piece.id}/move`, {
      x: 3 * SQUARE_SIZE + 4,
      y: mapTop((await stored(table)).board) + 3 * SQUARE_SIZE + 4,
    })
    expect(moved.status).toBe(200)

    const refusedVote = await voteUndo(table)

    expect(refusedVote.status).toBe(409)
    expect(await refusedVote.json()).toMatchObject({ error: 'ASSISTED_UNDO_BLOCKED' })
    const after = await stored(table)
    expect(after.assistedActions[0]?.status).toBe('applied')
    expect(piecesOf(after, `figures/${table.colour}army`)).toHaveLength(1)
  })

  it('is refused with a 409 when the unit card has left the hand', async () => {
    const table = await buildTable('UndoGone')
    expect((await send(table, 'req-1', await revOf(table), unit('infantry'))).status).toBe(200)
    const built = await stored(table)
    const card = handOf(built, table).find((item) => item.sheetName === 'INFANTRY') as Item
    await repo.saveGame({
      ...built,
      players: built.players.map((player) =>
        player.playerId === table.starterId ? { ...player, items: player.items.filter((item) => item.id !== card.id) } : player,
      ),
    })

    const refusedVote = await voteUndo(table)

    expect(refusedVote.status).toBe(409)
    expect(await refusedVote.json()).toMatchObject({ error: 'ASSISTED_UNDO_BLOCKED' })
    expect((await stored(table)).assistedActions[0]?.status).toBe('applied')
  })

  it('the board Undo cannot take back the placed figure, and answers 409', async () => {
    const table = await buildTable('BoardUndo')
    expect((await send(table, 'req-1', await revOf(table), ARMY)).status).toBe(200)
    const before = await stored(table)

    const refusedUndo = await post(table.starter, `/api/games/${table.gameId}/board/undo`, {})

    expect(refusedUndo.status).toBe(409)
    expect(await refusedUndo.json()).toMatchObject({ error: 'BOARD_UNDO_ASSISTED' })
    const after = await stored(table)
    expect(after.rev).toBe(before.rev)
    expect(piecesOf(after, `figures/${table.colour}army`)).toHaveLength(1)
  })

  it('the board Undo cannot take back the marker a unit used up', async () => {
    const table = await buildTable('BoardUndoUnit', { marker: true })
    expect((await send(table, 'req-1', await revOf(table), unit('infantry'))).status).toBe(200)
    const refusedUndo = await post(table.starter, `/api/games/${table.gameId}/board/undo`, {})
    expect(refusedUndo.status).toBe(409)
    expect(await refusedUndo.json()).toMatchObject({ error: 'BOARD_UNDO_ASSISTED' })
    expect(piecesOf(await stored(table), 'markers/Building Program')).toEqual([])
  })
})
