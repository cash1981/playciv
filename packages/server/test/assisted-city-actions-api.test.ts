/**
 * Start a Building Program and upgrade buildings over HTTP (task
 * `assisted-city-actions`): the same `/actions` route as every assisted action, with
 * a strictly parsed payload. The rules are in
 * `packages/engine/test/assisted-city-actions.test.ts`; these check the wiring, the
 * payload validation, the status codes, the undo vote, the replayed revision and that
 * no other client ever receives `cityActions` or `upgradeOptions`.
 *
 * The scene is the build tests': the America tile in the first map slot and a city of
 * the starter's colour on B2 (outskirts A1 to C3 without B2), the starter's techs
 * revealed and City Management open.
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

const MARKER = 'markers/Building Program'
const GRANARY = 'buildings/granary'
const AQUEDUCT = 'buildings/aqueduct'
const LIBRARY = 'buildings/library'
const UNIVERSITY = 'buildings/university'
const C2 = { column: 2, row: 1 }

interface CityActionJson {
  readonly cityPieceId: string
  readonly label: string
  readonly startBuildingProgram: { readonly status: string; readonly reason: string; readonly hasMarker: boolean }
}

interface UpgradeJson {
  readonly basicAssetId: string
  readonly upgradedAssetId: string
  readonly label: string
  readonly count: number
  readonly squares: readonly { readonly column: number; readonly row: number; readonly label: string }[]
}

interface View {
  readonly rev: number
  readonly you: {
    readonly cityActions?: readonly CityActionJson[]
    readonly upgradeOptions?: readonly UpgradeJson[]
  } | null
  readonly opponents: readonly { readonly playerId: string }[]
  readonly board: { readonly pieces: readonly { readonly id: string; readonly assetId: string }[] }
  readonly assistedActions: readonly { id: string; kind: string; label: string; status: string; logId: string; text: string }[]
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
  /** A tech chosen but left hidden. */
  readonly hiddenTechs?: readonly string[]
  /** Leave City Management closed. */
  readonly closed?: boolean
  /** A Building Program marker on the city. */
  readonly marker?: boolean
  /** Buildings of the starter, as asset id, column and row from 0. */
  readonly buildings?: readonly (readonly [string, number, number])[]
}

/** A started two-player game: the starter has a city on B2 of America, the techs revealed and the buildings in place. */
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
  if (options.marker === true) state = at(MARKER, 1, 1)
  for (const [assetId, column, row] of options.buildings ?? []) state = at(assetId, column, row)
  for (const techName of options.techs ?? []) {
    state = unwrap(revealTech(unwrap(chooseTech(state, { playerId: starterId, techName })), { playerId: starterId, techName }))
  }
  for (const techName of options.hiddenTechs ?? []) {
    state = unwrap(chooseTech(state, { playerId: starterId, techName }))
  }
  state = {
    ...state,
    players: state.players.map((player) =>
      player.playerId === starterId ? { ...player, government: 'Monarchy' } : player,
    ),
  }
  await repo.saveGame(state)
  return { gameId, starter, other, starterId, starterName: starterPlayer.username, cityId }
}

/** Two Granaries and a Library in the outskirts, Engineering and Printing Press revealed. */
const upgradeTable = (name: string, options: TableOptions = {}) =>
  buildTable(name, {
    techs: ['Engineering', 'Printing Press'],
    buildings: [[GRANARY, 0, 0], [LIBRARY, 0, 2], [GRANARY, 2, 1]],
    ...options,
  })

const actions = (table: Table) => `/api/games/${table.gameId}/actions`

const startBody = (table: Table, requestId: string, rev: number) => ({
  action: 'startBuildingProgram',
  requestId,
  rev,
  cityPieceId: table.cityId,
})

const upgradeBody = (requestId: string, rev: number, family?: string) => ({
  action: 'upgradeBuildings',
  requestId,
  rev,
  ...(family === undefined ? {} : { family }),
})

const sendStart = (table: Table, requestId: string, rev: number, token = table.starter) =>
  post(token, actions(table), startBody(table, requestId, rev))

const sendUpgrade = (table: Table, requestId: string, rev: number, family?: string, token = table.starter) =>
  post(token, actions(table), upgradeBody(requestId, rev, family))

const stored = async (table: Table): Promise<GameState> => {
  const state = await repo.findGame(table.gameId)
  if (state === undefined) throw new Error('game missing')
  return state
}

const piecesOf = (state: GameState, assetId: string): readonly BoardPiece[] =>
  state.board.pieces.filter((piece) => piece.assetId === assetId)

const revOf = async (table: Table): Promise<number> => (await view(table.gameId, table.starter)).rev

// ---------------------------------------------------------------------------
// The projection
// ---------------------------------------------------------------------------

describe('the city actions in the projection', () => {
  it('the owner sees the Building Program option of each city and the families to upgrade', async () => {
    const table = await upgradeTable('Options')
    const mine = await view(table.gameId, table.starter)
    expect(mine.you?.cityActions).toEqual([
      {
        cityPieceId: table.cityId,
        label: 'City B2',
        startBuildingProgram: { status: 'ready', reason: 'Ready to start a Building Program.', hasMarker: false },
      },
    ])
    expect(mine.you?.upgradeOptions).toEqual([
      expect.objectContaining({
        basicAssetId: GRANARY,
        upgradedAssetId: AQUEDUCT,
        label: 'Granary to Aqueduct',
        count: 2,
        squares: [
          { column: 0, row: 0, label: 'A1' },
          { column: 2, row: 1, label: 'C2' },
        ],
      }),
      expect.objectContaining({ label: 'Library to University', count: 1, squares: [{ column: 0, row: 2, label: 'A3' }] }),
    ])
  })

  it('outside City Management the Building Program says wrong-phase, and the upgrade stays on offer', async () => {
    const table = await upgradeTable('Closed', { closed: true })
    const mine = await view(table.gameId, table.starter)
    expect(mine.you?.cityActions?.[0]?.startBuildingProgram).toMatchObject({
      status: 'wrong-phase',
      reason: 'Only available during your open City Management phase.',
    })
    expect(mine.you?.upgradeOptions).toHaveLength(2)
  })

  it('a city with the marker says so', async () => {
    const table = await buildTable('Marked', { marker: true })
    expect((await view(table.gameId, table.starter)).you?.cityActions?.[0]?.startBuildingProgram).toEqual({
      status: 'unavailable',
      reason: 'This city already has a Building Program marker.',
      hasMarker: true,
    })
  })

  it('the other player and a spectator get none of the starter\'s', async () => {
    const table = await upgradeTable('Hidden')
    const outsider = await register('Hidden-spectator')
    const asOther = await inject(app, { url: `/api/games/${table.gameId}`, headers: bearer(table.other) })
    const asSpectator = await inject(app, { url: `/api/games/${table.gameId}`, headers: bearer(outsider) })
    const anonymous = await inject(app, { url: `/api/games/${table.gameId}` })

    const theirs = await asOther.json<View>()
    // These two lines describe the other player's own, empty self view; the leak protection is the serialisation checks below
    expect(theirs.you?.cityActions).toEqual([])
    expect(theirs.you?.upgradeOptions).toEqual([])
    for (const response of [asOther, asSpectator, anonymous]) {
      expect(response.status).toBe(200)
      expect(response.body).not.toContain('startBuildingProgram')
      expect(response.body).not.toContain('Granary to Aqueduct')
      expect(response.body).not.toContain('upgradedLabel')
      expect(response.body).not.toContain('hasMarker')
    }
    for (const response of [asSpectator, anonymous]) {
      expect(response.body).not.toContain('cityActions')
      expect(response.body).not.toContain('upgradeOptions')
      expect((await response.json<View>()).you).toBeNull()
    }
  })

  it('a chosen but unrevealed tech unlocks nothing for the owner and is not told to anyone else', async () => {
    const table = await buildTable('Unrevealed', {
      hiddenTechs: ['Engineering'],
      buildings: [[GRANARY, 0, 0]],
    })
    expect((await view(table.gameId, table.starter)).you?.upgradeOptions).toEqual([])
    const theirs = await inject(app, { url: `/api/games/${table.gameId}`, headers: bearer(table.other) })
    expect(theirs.body).not.toContain('Granary to Aqueduct')
    expect((await sendUpgrade(table, 'up-1', await revOf(table))).status).toBe(400)
    expect(piecesOf(await stored(table), AQUEDUCT)).toEqual([])
  })

  it('a replayed revision shows neither, though the live state has them', async () => {
    const table = await upgradeTable('Replay')
    const ready = await view(table.gameId, table.starter)
    expect(ready.you?.upgradeOptions).toHaveLength(2)
    expect((await sendStart(table, 'start-1', ready.rev)).status).toBe(200)

    const past = await inject(app, {
      url: `/api/games/${table.gameId}/revisions/${ready.rev}`,
      headers: bearer(table.starter),
    })
    expect(past.status).toBe(200)
    const replay = await past.json<{ view: View }>()
    expect(replay.view.board.pieces.some((piece) => piece.assetId === MARKER)).toBe(false)
    expect(replay.view.you?.cityActions).toEqual([])
    expect(replay.view.you?.upgradeOptions).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Start a Building Program
// ---------------------------------------------------------------------------

describe('starting a Building Program over HTTP', () => {
  it('places the marker, answers with the projection and logs one public line', async () => {
    const table = await buildTable('Start')
    const before = await view(table.gameId, table.starter)

    const response = await sendStart(table, 'start-1', before.rev)

    expect(response.status).toBe(200)
    const after = await response.json<View>()
    expect(after.rev).toBe(before.rev + 1)
    expect(after.board.pieces.filter((piece) => piece.assetId === MARKER)).toHaveLength(1)
    expect(after.you?.cityActions?.[0]?.startBuildingProgram).toMatchObject({ status: 'unavailable', hasMarker: true })
    expect(after.assistedActions).toEqual([
      expect.objectContaining({
        id: 'start-1',
        kind: 'startBuildingProgram',
        label: 'Start Building Program',
        status: 'applied',
        text: `${table.starterName} started a Building Program in City B2`,
      }),
    ])
    const publicLog = await inject(app, { url: `/api/games/${table.gameId}/log/public`, headers: bearer(table.other) })
    expect(publicLog.body).toContain('started a Building Program in City B2')
  })

  it('the next build uses the doubled figure', async () => {
    const table = await buildTable('Doubled', { techs: ['Writing'] })
    const response = await sendStart(table, 'start-1', await revOf(table))
    expect(response.status).toBe(200)
    const state = await stored(table)
    const marker = piecesOf(state, MARKER)[0]
    expect(marker).toBeDefined()
    const build = await post(table.starter, actions(table), {
      action: 'build',
      requestId: 'build-1',
      rev: await revOf(table),
      cityPieceId: table.cityId,
      item: { kind: 'building', assetId: LIBRARY },
      target: C2,
    })
    expect(build.status).toBe(200)
    expect(piecesOf(await stored(table), MARKER)).toEqual([])
  })

  it('a retry with the same request id starts once and creates no revision', async () => {
    const table = await buildTable('Retry')
    const first = await sendStart(table, 'start-1', await revOf(table))
    expect(first.status).toBe(200)
    const settled = await first.json<View>()

    const retry = await sendStart(table, 'start-1', settled.rev)
    expect(retry.status).toBe(200)
    expect((await retry.json<View>()).rev).toBe(settled.rev)
    const state = await stored(table)
    expect(piecesOf(state, MARKER)).toHaveLength(1)
    expect(state.assistedActions).toHaveLength(1)
  })

  it('a stale rev is a 409 and starts nothing', async () => {
    const table = await buildTable('Stale')
    const stale = await sendStart(table, 'start-1', (await revOf(table)) - 1)
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ error: 'CONFLICT' })
    expect(piecesOf(await stored(table), MARKER)).toEqual([])
  })

  it('a second start in the same city is refused with the reason, and nothing changes', async () => {
    const table = await buildTable('Twice')
    const first = await (await sendStart(table, 'start-1', await revOf(table))).json<View>()
    const second = await sendStart(table, 'start-2', first.rev)
    expect(second.status).toBe(400)
    expect(await second.json()).toMatchObject({
      error: 'ASSISTED_ACTION_REJECTED',
      message: expect.stringContaining('already has a Building Program marker'),
    })
    expect(piecesOf(await stored(table), MARKER)).toHaveLength(1)
  })

  it('a marker already on the city is refused', async () => {
    const table = await buildTable('Placed', { marker: true })
    const response = await sendStart(table, 'start-1', await revOf(table))
    expect(response.status).toBe(400)
    expect(piecesOf(await stored(table), MARKER)).toHaveLength(1)
  })

  it('outside City Management it is a 400 with the phase reason, and a stranger gets 403', async () => {
    const table = await buildTable('Phase', { closed: true })
    const rev = await revOf(table)
    const closed = await sendStart(table, 'start-1', rev)
    expect(closed.status).toBe(400)
    expect(await closed.json()).toMatchObject({
      error: 'ASSISTED_ACTION_REJECTED',
      message: 'Only available during your open City Management phase.',
    })

    const outsider = await register('Phase-spectator')
    expect((await sendStart(table, 'start-2', rev, outsider)).status).toBe(403)
    expect(piecesOf(await stored(table), MARKER)).toEqual([])
  })

  it('the other player cannot start one on the starter\'s city', async () => {
    const table = await buildTable('Theirs')
    const response = await sendStart(table, 'start-1', await revOf(table), table.other)
    expect(response.status).toBe(400)
    expect(piecesOf(await stored(table), MARKER)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Upgrade buildings
// ---------------------------------------------------------------------------

describe('upgrading buildings over HTTP', () => {
  it('flips every family, answers with the projection and logs one public line', async () => {
    const table = await upgradeTable('Upgrade')
    const before = await view(table.gameId, table.starter)

    const response = await sendUpgrade(table, 'up-1', before.rev)

    expect(response.status).toBe(200)
    const after = await response.json<View>()
    expect(after.rev).toBe(before.rev + 1)
    const types = (assetId: string) => after.board.pieces.filter((piece) => piece.assetId === assetId).length
    expect([types(GRANARY), types(AQUEDUCT), types(LIBRARY), types(UNIVERSITY)]).toEqual([0, 2, 0, 1])
    expect(after.you?.upgradeOptions).toEqual([])
    expect(after.assistedActions).toEqual([
      expect.objectContaining({
        id: 'up-1',
        kind: 'upgradeBuildings',
        label: 'Upgrade buildings',
        status: 'applied',
        text: `${table.starterName} upgraded 2 Granaries to Aqueducts at A1 and C2; 1 Library to University at A3`,
      }),
    ])
    const publicLog = await inject(app, { url: `/api/games/${table.gameId}/log/public`, headers: bearer(table.other) })
    expect(publicLog.body).toContain('upgraded 2 Granaries to Aqueducts at A1 and C2')
  })

  it('flips one family when it is named', async () => {
    const table = await upgradeTable('Family')
    const response = await sendUpgrade(table, 'up-1', await revOf(table), LIBRARY)
    expect(response.status).toBe(200)
    const state = await stored(table)
    expect(piecesOf(state, UNIVERSITY)).toHaveLength(1)
    expect(piecesOf(state, GRANARY)).toHaveLength(2)
    expect((await response.json<View>()).you?.upgradeOptions?.map((option) => option.basicAssetId)).toEqual([GRANARY])
  })

  it('works with City Management closed', async () => {
    const table = await upgradeTable('NoPhase', { closed: true })
    const response = await sendUpgrade(table, 'up-1', await revOf(table))
    expect(response.status).toBe(200)
    expect(piecesOf(await stored(table), AQUEDUCT)).toHaveLength(2)
  })

  it('a retry with the same request id flips once and creates no revision', async () => {
    const table = await upgradeTable('RetryUp')
    const first = await sendUpgrade(table, 'up-1', await revOf(table))
    expect(first.status).toBe(200)
    const settled = await first.json<View>()
    const retry = await sendUpgrade(table, 'up-1', settled.rev)
    expect(retry.status).toBe(200)
    expect((await retry.json<View>()).rev).toBe(settled.rev)
    const state = await stored(table)
    expect(piecesOf(state, AQUEDUCT)).toHaveLength(2)
    expect(state.assistedActions).toHaveLength(1)
  })

  it('two parallel presses with the same request id have one effect', async () => {
    const table = await upgradeTable('ParallelUp')
    const rev = await revOf(table)
    const [first, second] = await Promise.all([sendUpgrade(table, 'up-1', rev), sendUpgrade(table, 'up-1', rev)])
    for (const status of [first.status, second.status]) expect([200, 409]).toContain(status)
    expect([first.status, second.status]).toContain(200)
    expect(piecesOf(await stored(table), AQUEDUCT)).toHaveLength(2)
  })

  it('a stale rev is a 409 and flips nothing', async () => {
    const table = await upgradeTable('StaleUp')
    const stale = await sendUpgrade(table, 'up-1', (await revOf(table)) - 1)
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ error: 'CONFLICT' })
    expect(piecesOf(await stored(table), AQUEDUCT)).toEqual([])
  })

  it('a second press with a new request id finds nothing to flip and is refused', async () => {
    const table = await upgradeTable('Again')
    const first = await (await sendUpgrade(table, 'up-1', await revOf(table))).json<View>()
    const second = await sendUpgrade(table, 'up-2', first.rev)
    expect(second.status).toBe(400)
    expect(await second.json()).toMatchObject({
      error: 'ASSISTED_ACTION_REJECTED',
      message: 'No basic building of yours stands in the outskirts of your cities with its upgrade unlocked.',
    })
    expect(piecesOf(await stored(table), AQUEDUCT)).toHaveLength(2)
  })

  it('a family whose tech is not revealed is refused, naming the building', async () => {
    const table = await upgradeTable('NoTech', { techs: ['Engineering'] })
    const response = await sendUpgrade(table, 'up-1', await revOf(table), LIBRARY)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: 'ASSISTED_ACTION_REJECTED',
      message: 'You have not revealed the tech of the University, so the Library cannot be upgraded.',
    })
  })

  it('without a revealed tech nothing is flipped', async () => {
    const table = await buildTable('NothingRevealed', { buildings: [[GRANARY, 0, 0]] })
    const response = await sendUpgrade(table, 'up-1', await revOf(table))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ message: 'None of your revealed techs unlocks an upgraded building.' })
  })

  it('a stranger gets 403, and the other player flips nothing of the starter\'s', async () => {
    const table = await upgradeTable('Strangers')
    const outsider = await register('Strangers-spectator')
    const rev = await revOf(table)
    expect((await sendUpgrade(table, 'up-1', rev, undefined, outsider)).status).toBe(403)
    // The other player has revealed no tech, so there is nothing for them to flip
    expect((await sendUpgrade(table, 'up-2', rev, undefined, table.other)).status).toBe(400)
    expect(piecesOf(await stored(table), AQUEDUCT)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The payload
// ---------------------------------------------------------------------------

describe('the payload', () => {
  async function refusedStart(name: string, mutate: (body: Record<string, unknown>) => Record<string, unknown>): Promise<string> {
    const table = await buildTable(name)
    const rev = await revOf(table)
    const response = await post(table.starter, actions(table), mutate({ ...startBody(table, 'start-1', rev) }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'BAD_REQUEST' })
    expect(piecesOf(await stored(table), MARKER)).toEqual([])
    return JSON.stringify(await response.json())
  }

  async function refusedUpgrade(name: string, mutate: (body: Record<string, unknown>) => Record<string, unknown>): Promise<string> {
    const table = await upgradeTable(name)
    const rev = await revOf(table)
    const response = await post(table.starter, actions(table), mutate({ ...upgradeBody('up-1', rev) }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'BAD_REQUEST' })
    expect(piecesOf(await stored(table), AQUEDUCT)).toEqual([])
    return JSON.stringify(await response.json())
  }

  it('startBuildingProgram needs a city piece id of plain characters', async () => {
    await refusedStart('NoCity', ({ cityPieceId: _gone, ...rest }) => rest)
    await refusedStart('OddCity', (body) => ({ ...body, cityPieceId: 'a city' }))
    await refusedStart('LongCity', (body) => ({ ...body, cityPieceId: 'x'.repeat(65) }))
    await refusedStart('NumberCity', (body) => ({ ...body, cityPieceId: 12 }))
    await refusedStart('EmptyCity', (body) => ({ ...body, cityPieceId: '' }))
  })

  it('startBuildingProgram takes no other field', async () => {
    for (const [name, extra] of [
      ['Item', { item: { kind: 'army' } }],
      ['Target', { target: C2 }],
      ['Rush', { rush: true }],
      ['Family', { family: GRANARY }],
      ['Unknown', { colour: 'red' }],
    ] as const) {
      expect(await refusedStart(`Extra${name}`, (body) => ({ ...body, ...extra }))).toContain('startBuildingProgram takes only cityPieceId')
    }
  })

  it('upgradeBuildings takes a family that is a basic building with an upgraded form, or none', async () => {
    await refusedUpgrade('NumberFamily', (body) => ({ ...body, family: 7 }))
    await refusedUpgrade('NullFamily', (body) => ({ ...body, family: null }))
    await refusedUpgrade('ArrayFamily', (body) => ({ ...body, family: [GRANARY] }))
    await refusedUpgrade('UnknownFamily', (body) => ({ ...body, family: 'buildings/castle' }))
    await refusedUpgrade('UpgradedFamily', (body) => ({ ...body, family: AQUEDUCT }))
    await refusedUpgrade('SingleForm', (body) => ({ ...body, family: 'buildings/harbor' }))
    await refusedUpgrade('Prototype', (body) => ({ ...body, family: 'constructor' }))
    await refusedUpgrade('EmptyFamily', (body) => ({ ...body, family: '' }))
  })

  it('upgradeBuildings takes no other field', async () => {
    for (const [name, extra] of [
      ['City', { cityPieceId: 'city-1' }],
      ['Item', { item: { kind: 'building', assetId: GRANARY } }],
      ['Target', { target: C2 }],
      ['Rush', { rush: false }],
      ['Unknown', { all: true }],
    ] as const) {
      expect(await refusedUpgrade(`Extra${name}`, (body) => ({ ...body, ...extra }))).toContain('upgradeBuildings takes only an optional family')
    }
  })

  it('upgradeBuildings with no payload at all is every family', async () => {
    const table = await upgradeTable('NoPayload')
    const response = await post(table.starter, actions(table), { action: 'upgradeBuildings', requestId: 'up-1', rev: await revOf(table) })
    expect(response.status).toBe(200)
    expect(piecesOf(await stored(table), AQUEDUCT)).toHaveLength(2)
  })

  it('the envelope fields are still checked: rev, request id and confirmedRepeat', async () => {
    const table = await upgradeTable('Envelope')
    for (const body of [
      { ...upgradeBody('up-1', 0), rev: 'x' },
      { ...upgradeBody('up-1', 0), rev: -1 },
      { ...upgradeBody('a b', 0) },
      { ...upgradeBody('up-1', 0), confirmedRepeat: 'true' },
    ]) {
      const response = await post(table.starter, actions(table), body)
      expect(response.status).toBe(400)
    }
    expect(piecesOf(await stored(table), AQUEDUCT)).toEqual([])
  })

  it('the payload fields of the other actions are still refused on any other action', async () => {
    const table = await upgradeTable('Stray')
    const rev = await revOf(table)
    for (const extra of [{ cityPieceId: table.cityId }, { item: { kind: 'building', assetId: LIBRARY } }, { target: C2 }, { rush: true }]) {
      const response = await post(table.starter, actions(table), { action: 'cultureAdvance', requestId: 'req-1', rev, ...extra })
      expect(response.status).toBe(400)
      expect(JSON.stringify(await response.json())).toContain('only belong to build')
    }
    // family belongs to upgradeBuildings only
    const other = await post(table.starter, actions(table), { action: 'cultureAdvance', requestId: 'req-2', rev, family: GRANARY })
    expect(other.status).toBe(400)
    // a complete, valid body plus the stray field is refused because of that field, and nothing runs
    const complete = {
      build: {
        action: 'build',
        requestId: 'req-2',
        rev,
        cityPieceId: table.cityId,
        item: { kind: 'building', assetId: LIBRARY },
        target: C2,
      },
      startBuildingProgram: startBody(table, 'req-2', rev),
    }
    for (const [action, body] of Object.entries(complete)) {
      const refused = await post(table.starter, actions(table), { ...body, family: GRANARY })
      expect(refused.status).toBe(400)
      expect(JSON.stringify(await refused.json())).toContain(`${action} takes only`)
    }
    // an unknown field is refused on build the same way
    const unknown = await post(table.starter, actions(table), { ...complete.build, all: true })
    expect(unknown.status).toBe(400)
    expect(JSON.stringify(await unknown.json())).toContain('not all')
    const stray = await post(table.starter, actions(table), { action: 'cultureAdvance', requestId: 'req-3', rev, family: GRANARY })
    expect(JSON.stringify(await stray.json())).toContain('family only belongs to upgradeBuildings')
    // the reward fields belong to chooseReward only, also on the new actions
    for (const body of [startBody(table, 'req-4', rev), upgradeBody('req-5', rev)]) {
      const response = await post(table.starter, actions(table), { ...body, rewardId: 'req-1' })
      expect(response.status).toBe(400)
      expect(JSON.stringify(await response.json())).toContain('only belong to chooseReward')
    }
    const state = await stored(table)
    expect(piecesOf(state, AQUEDUCT)).toEqual([])
    expect(piecesOf(state, MARKER)).toEqual([])
  })

  it('build still wants its own payload and ignores nothing', async () => {
    const table = await upgradeTable('BuildStill')
    const rev = await revOf(table)
    const noItem = await post(table.starter, actions(table), { action: 'build', requestId: 'req-1', rev, cityPieceId: table.cityId })
    expect(noItem.status).toBe(400)
    expect(JSON.stringify(await noItem.json())).toContain('item must be')
  })
})

// ---------------------------------------------------------------------------
// Undo over HTTP
// ---------------------------------------------------------------------------

describe('undo over HTTP', () => {
  const logIdOf = async (table: Table, index = 0): Promise<string> =>
    (await view(table.gameId, table.other)).assistedActions[index]?.logId as string

  const undoVote = async (table: Table, logId: string) => {
    expect((await post(table.other, `/api/games/${table.gameId}/undo/${logId}`, {})).status).toBe(200)
    return post(table.starter, `/api/games/${table.gameId}/undo/${logId}/vote`, { vote: true })
  }

  it('a start is undone by the vote, and the marker leaves again', async () => {
    const table = await buildTable('UndoStart')
    expect((await sendStart(table, 'start-1', await revOf(table))).status).toBe(200)

    const voted = await undoVote(table, await logIdOf(table))
    expect(voted.status).toBe(200)

    const after = await voted.json<View>()
    expect(after.assistedActions[0]?.status).toBe('undone')
    expect(after.board.pieces.some((piece) => piece.assetId === MARKER)).toBe(false)
    expect(after.you?.cityActions?.[0]?.startBuildingProgram.status).toBe('ready')
    expect((await stored(table)).log.at(-1)?.publicLog).toBe(
      `System: ${table.starterName}'s Building Program in City B2 was undone: the marker was removed`,
    )
  })

  it('a start cannot be undone while a build has used the marker up, and can after the build is undone', async () => {
    const table = await buildTable('UndoOrder', { techs: ['Writing'] })
    expect((await sendStart(table, 'start-1', await revOf(table))).status).toBe(200)
    const build = await post(table.starter, actions(table), {
      action: 'build',
      requestId: 'build-1',
      rev: await revOf(table),
      cityPieceId: table.cityId,
      item: { kind: 'building', assetId: LIBRARY },
      target: C2,
    })
    expect(build.status).toBe(200)

    const startLog = await logIdOf(table, 0)
    const refused = await undoVote(table, startLog)
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ error: 'ASSISTED_UNDO_BLOCKED' })
    const blocked = await stored(table)
    expect(blocked.assistedActions.map((record) => record.status)).toEqual(['applied', 'applied'])
    expect(piecesOf(blocked, LIBRARY)).toHaveLength(1)

    // The vote stays open: undo the build first, which puts the marker back, then the start vote goes through
    const buildLog = await logIdOf(table, 1)
    expect((await undoVote(table, buildLog)).status).toBe(200)
    const retried = await post(table.starter, `/api/games/${table.gameId}/undo/${startLog}/vote`, { vote: true })
    expect(retried.status).toBe(200)
    const after = await stored(table)
    expect(piecesOf(after, LIBRARY)).toEqual([])
    expect(piecesOf(after, MARKER)).toEqual([])
    expect(after.assistedActions.map((record) => record.status)).toEqual(['undone', 'undone'])
  })

  it('an upgrade is undone by the vote, and the basic buildings return', async () => {
    const table = await upgradeTable('UndoUp')
    const before = await stored(table)
    expect((await sendUpgrade(table, 'up-1', await revOf(table))).status).toBe(200)

    const voted = await undoVote(table, await logIdOf(table))
    expect(voted.status).toBe(200)

    const after = await stored(table)
    expect(after.assistedActions[0]?.status).toBe('undone')
    expect(piecesOf(after, AQUEDUCT)).toEqual([])
    expect(piecesOf(after, UNIVERSITY)).toEqual([])
    const key = (piece: BoardPiece): string => `${piece.id}@${piece.x},${piece.y}`
    expect(after.board.pieces.map(key).sort()).toEqual(before.board.pieces.map(key).sort())
    expect(after.log.at(-1)?.publicLog).toBe(
      `System: ${table.starterName}'s upgrade of 2 Granaries to Aqueducts at A1 and C2; 1 Library to University at A3 was undone: the basic buildings were put back`,
    )
    expect((await voted.json<View>()).you?.upgradeOptions).toHaveLength(2)
  })

  it('an upgrade is refused with a 409 when a flipped piece has been moved, and nothing changes', async () => {
    const table = await upgradeTable('UndoMoved')
    expect((await sendUpgrade(table, 'up-1', await revOf(table))).status).toBe(200)
    const piece = piecesOf(await stored(table), AQUEDUCT)[0] as BoardPiece
    const moved = await post(table.other, `/api/games/${table.gameId}/board/pieces/${piece.id}/move`, {
      x: 3 * SQUARE_SIZE + 4,
      y: mapTop((await stored(table)).board) + 3 * SQUARE_SIZE + 4,
    })
    expect(moved.status).toBe(200)

    const refused = await undoVote(table, await logIdOf(table))
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ error: 'ASSISTED_UNDO_BLOCKED' })
    const after = await stored(table)
    expect(after.assistedActions[0]?.status).toBe('applied')
    expect(piecesOf(after, AQUEDUCT)).toHaveLength(2)
    expect(piecesOf(after, GRANARY)).toEqual([])
  })

  it('the board Undo cannot take back the marker or a flip alone, and answers 409', async () => {
    const table = await upgradeTable('BoardUndo')
    expect((await sendStart(table, 'start-1', await revOf(table))).status).toBe(200)
    const started = await stored(table)
    const refusedStart = await post(table.starter, `/api/games/${table.gameId}/board/undo`, {})
    expect(refusedStart.status).toBe(409)
    expect(await refusedStart.json()).toMatchObject({ error: 'BOARD_UNDO_ASSISTED' })
    expect((await stored(table)).rev).toBe(started.rev)

    expect((await sendUpgrade(table, 'up-1', await revOf(table))).status).toBe(200)
    const upgraded = await stored(table)
    const refusedUpgrade = await post(table.starter, `/api/games/${table.gameId}/board/undo`, {})
    expect(refusedUpgrade.status).toBe(409)
    expect(await refusedUpgrade.json()).toMatchObject({ error: 'BOARD_UNDO_ASSISTED' })
    const after = await stored(table)
    expect(after.rev).toBe(upgraded.rev)
    expect(piecesOf(after, AQUEDUCT)).toHaveLength(2)
    expect(piecesOf(after, MARKER)).toHaveLength(1)
  })
})
