/**
 * The assisted action route (issue #260): one POST for every action, guarded by
 * a request id and the game's revision, and the undo vote over HTTP.
 *
 * The rules are in `packages/engine/test/assisted*.test.ts`; these check the
 * wiring, the status codes and that nothing private reaches another client.
 */

import type { App } from '../src/app.js'
import { beforeEach, describe, expect, it } from 'vitest'

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
    readonly playerId: string
    readonly stats: { readonly culture: number }
    readonly items: readonly { readonly id: string }[]
    readonly availableActions?: readonly { action: string; status: string; reason: string }[]
  } | null
  readonly boardAreas: readonly { playerId: string; x: number; y: number }[]
  readonly board: { readonly pieces: readonly { id: string; assetId: string }[] }
  readonly assistedActions: readonly { id: string; status: string; logId: string; text: string }[]
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
}

/** A started two-player game. `starter` has Chivalry revealed, City Management open and an incense piece. */
async function chivalryTable(name: string, options: { readonly piece?: boolean; readonly trade?: boolean } = {}): Promise<Table> {
  const creator = await register(`${name}-a`)
  const created = await inject(app, {
    method: 'POST', url: '/api/games', headers: bearer(creator), payload: { name, numOfPlayers: 2 },
  })
  const gameId = (await created.json() as { id: string }).id
  const joiner = await register(`${name}-b`)
  await post(joiner, `/api/games/${gameId}/join`, {})

  const state = await repo.findGame(gameId)
  const starterName = state?.players.find((player) => player.yourTurn)?.username
  const starter = starterName === `${name}-a` ? creator : joiner
  const other = starter === creator ? joiner : creator

  const mine = await view(gameId, starter)
  const theirs = await view(gameId, other)
  const starterId = mine.you?.playerId as string
  const otherId = theirs.you?.playerId as string

  expect((await post(starter, `/api/games/${gameId}/techs/choose`, { name: 'Chivalry' })).status).toBe(200)
  expect((await post(starter, `/api/games/${gameId}/techs/reveal`, { name: 'Chivalry' })).status).toBe(200)
  if (options.trade !== false) {
    expect((await post(starter, `/api/games/${gameId}/turns/done`, { phase: 'TRADE' })).status).toBe(200)
  }
  if (options.piece !== false) {
    const area = mine.boardAreas.find((candidate) => candidate.playerId === starterId)
    if (area === undefined) throw new Error('no area for the starter')
    const placed = await post(starter, `/api/games/${gameId}/board/pieces`, {
      assetId: 'resources/incense', x: area.x + 20, y: area.y + 80,
    })
    expect(placed.status).toBe(200)
  }
  return { gameId, starter, other, starterId, otherId }
}

const chivalry = (table: Table, requestId: string, rev: number, token = table.starter) =>
  post(token, `/api/games/${table.gameId}/actions`, { action: 'chivalry', requestId, rev })

const incensePieces = (state: GameState | undefined) =>
  state?.board.pieces.filter((piece) => piece.assetId === 'resources/incense') ?? []

describe('POST /api/games/:gameId/actions', () => {
  it('performs Chivalry: culture, the piece gone, one record, and the projection comes back', async () => {
    const table = await chivalryTable('Once')
    const before = await view(table.gameId, table.starter)
    expect(before.you?.availableActions?.find((entry) => entry.action === 'chivalry')?.status).toBe('ready')

    const response = await chivalry(table, 'req-1', before.rev)

    expect(response.status).toBe(200)
    const after = await response.json<View>()
    expect(after.you?.stats.culture).toBe(5)
    expect(after.rev).toBe(before.rev + 1)
    expect(after.board.pieces.some((piece) => piece.assetId === 'resources/incense')).toBe(false)
    expect(after.assistedActions).toHaveLength(1)
    expect(after.assistedActions[0]).toMatchObject({ id: 'req-1', status: 'applied' })
    expect(after.assistedActions[0]?.text).toContain('used Chivalry')
    expect(after.you?.availableActions?.find((entry) => entry.action === 'chivalry')?.status).toBe('used')
    expect(incensePieces(await repo.findGame(table.gameId))).toHaveLength(0)
  })

  it('the same requestId again, even on the fresh rev, has one effect', async () => {
    const table = await chivalryTable('Retry')
    const first = await (await chivalry(table, 'req-1', (await view(table.gameId, table.starter)).rev)).json<View>()

    const retry = await chivalry(table, 'req-1', first.rev)

    expect(retry.status).toBe(200)
    const again = await retry.json<View>()
    expect(again.you?.stats.culture).toBe(5)
    expect(again.assistedActions).toHaveLength(1)
    expect((await repo.findGame(table.gameId))?.log.filter((entry) => entry.assistedActionId === 'req-1')).toHaveLength(1)
  })

  it('a retry with a known requestId stores nothing: same rev, same revisions, same log', async () => {
    const table = await chivalryTable('RetryStore')
    const first = await (await chivalry(table, 'req-1', (await view(table.gameId, table.starter)).rev)).json<View>()
    const stored = await repo.findGame(table.gameId)
    const revisionsBefore = (await repo.listGameRevisions(table.gameId)).length

    const retry = await chivalry(table, 'req-1', first.rev)

    expect(retry.status).toBe(200)
    const again = await retry.json<View>()
    expect(again.rev).toBe(first.rev)
    expect(again.you?.stats.culture).toBe(5)
    const after = await repo.findGame(table.gameId)
    expect(after?.rev).toBe(first.rev)
    expect(after?.log).toEqual(stored?.log)
    expect(after?.assistedActions).toEqual(stored?.assistedActions)
    expect((await repo.listGameRevisions(table.gameId)).length).toBe(revisionsBefore)
    // The next real write still goes through on that revision
    const logId = again.assistedActions[0]?.logId as string
    const next = await post(table.other, `/api/games/${table.gameId}/undo/${logId}`, {})
    expect(next.status).toBe(200)
    expect((await next.json<View>()).rev).toBe(first.rev + 1)
  })

  it('the same requestId from two tabs at once, on the same rev, has one effect', async () => {
    const table = await chivalryTable('SameId')
    const rev = (await view(table.gameId, table.starter)).rev

    const [a, b] = await Promise.all([chivalry(table, 'tab-1', rev), chivalry(table, 'tab-1', rev)])

    // One saves; the other either lost the race on the revision or found the id recorded
    expect([a.status, b.status].sort()).toEqual([200, 409])
    const stored = await repo.findGame(table.gameId)
    expect(stored?.assistedActions).toHaveLength(1)
    expect(stored?.log.filter((entry) => entry.assistedActionId === 'tab-1')).toHaveLength(1)
    expect(stored?.players.find((player) => player.playerId === table.starterId)?.stats.culture).toBe(5)
    expect(incensePieces(stored)).toHaveLength(0)
  })

  it('a second press with a new requestId is a 409 and spends nothing', async () => {
    const table = await chivalryTable('Twice')
    // A second incense piece, so only the once per turn limit can stop it
    const mine = await view(table.gameId, table.starter)
    const area = mine.boardAreas.find((candidate) => candidate.playerId === table.starterId)
    await post(table.starter, `/api/games/${table.gameId}/board/pieces`, {
      assetId: 'resources/incense', x: (area?.x ?? 0) + 20, y: (area?.y ?? 0) + 80,
    })
    const ready = await view(table.gameId, table.starter)
    expect((await chivalry(table, 'req-1', ready.rev)).status).toBe(200)

    const second = await chivalry(table, 'req-2', ready.rev + 1)

    expect(second.status).toBe(409)
    expect(await second.json()).toMatchObject({ error: 'ASSISTED_ACTION_REJECTED' })
    expect(incensePieces(await repo.findGame(table.gameId))).toHaveLength(1)
  })

  it('two parallel requests with the same rev have one effect', async () => {
    const table = await chivalryTable('Parallel')
    const mine = await view(table.gameId, table.starter)
    const area = mine.boardAreas.find((candidate) => candidate.playerId === table.starterId)
    await post(table.starter, `/api/games/${table.gameId}/board/pieces`, {
      assetId: 'resources/incense', x: (area?.x ?? 0) + 20, y: (area?.y ?? 0) + 80,
    })
    const rev = (await view(table.gameId, table.starter)).rev

    const [a, b] = await Promise.all([chivalry(table, 'tab-a', rev), chivalry(table, 'tab-b', rev)])

    expect([a.status, b.status].sort()).toEqual([200, 409])
    const stored = await repo.findGame(table.gameId)
    expect(stored?.assistedActions).toHaveLength(1)
    expect(stored?.players.find((player) => player.playerId === table.starterId)?.stats.culture).toBe(5)
  })

  it('a stale rev is a 409 and changes nothing', async () => {
    const table = await chivalryTable('Stale')
    const rev = (await view(table.gameId, table.starter)).rev

    const stale = await chivalry(table, 'req-1', rev - 1)

    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ error: 'CONFLICT' })
    const stored = await repo.findGame(table.gameId)
    expect(stored?.rev).toBe(rev)
    expect(stored?.assistedActions).toEqual([])
    expect(incensePieces(stored)).toHaveLength(1)
  })

  it('answers 400 for an unknown action, a missing requestId and a bad rev', async () => {
    const table = await chivalryTable('BadBody')
    const url = `/api/games/${table.gameId}/actions`
    const rev = (await view(table.gameId, table.starter)).rev

    const unknown = await post(table.starter, url, { action: 'wheat', requestId: 'x', rev })
    expect(unknown.status).toBe(400)
    expect(await unknown.json()).toMatchObject({ error: 'BAD_REQUEST' })
    expect((await post(table.starter, url, { requestId: 'x', rev })).status).toBe(400)
    expect((await post(table.starter, url, { action: 'chivalry', rev })).status).toBe(400)
    expect((await post(table.starter, url, { action: 'chivalry', requestId: '  ', rev })).status).toBe(400)
    expect((await post(table.starter, url, { action: 'chivalry', requestId: 'x', rev: 'soon' })).status).toBe(400)
    expect((await post(table.starter, url, { action: 'chivalry', requestId: 'x', rev: -1 })).status).toBe(400)
    expect((await inject(app, { method: 'POST', url, payload: { action: 'chivalry', requestId: 'x' } })).status).toBe(401)
    expect((await repo.findGame(table.gameId))?.assistedActions).toEqual([])
  })

  it('accepts a requestId of 1 to 64 characters from [A-Za-z0-9._:-] and refuses anything else', async () => {
    const table = await chivalryTable('RequestId')
    const url = `/api/games/${table.gameId}/actions`
    const rev = (await view(table.gameId, table.starter)).rev
    const bad = ['x'.repeat(65), 'has space', 'semi;colon', 'slash/id', 'quote"', 'åre', 'new\nline', ' lead']
    for (const requestId of bad) {
      const response = await post(table.starter, url, { action: 'chivalry', requestId, rev })
      expect(response.status, requestId).toBe(400)
      expect(await response.json()).toMatchObject({ error: 'BAD_REQUEST' })
    }
    expect((await post(table.starter, url, { action: 'chivalry', requestId: 7, rev })).status).toBe(400)
    expect((await repo.findGame(table.gameId))?.assistedActions).toEqual([])

    // The longest and the widest allowed id both work
    const id = `${'a'.repeat(30)}.${'B'.repeat(10)}_:-9${'z'.repeat(19)}`
    expect(id).toHaveLength(64)
    expect((await post(table.starter, url, { action: 'chivalry', requestId: id, rev })).status).toBe(200)
    expect((await repo.findGame(table.gameId))?.assistedActions[0]?.id).toBe(id)
  })

  it('works without a rev, for a caller that does not track revisions', async () => {
    const table = await chivalryTable('NoRev')
    const response = await post(table.starter, `/api/games/${table.gameId}/actions`, { action: 'chivalry', requestId: 'x' })
    expect(response.status).toBe(200)
  })

  it('refuses the wrong phase with a readable reason and no partial state', async () => {
    const table = await chivalryTable('WrongPhase', { trade: false })
    const rev = (await view(table.gameId, table.starter)).rev

    const response = await chivalry(table, 'req-1', rev)

    expect(response.status).toBe(400)
    const body = await response.json<{ error: string; message: string }>()
    expect(body.error).toBe('ASSISTED_ACTION_REJECTED')
    expect(body.message).toContain('City Management')
    const stored = await repo.findGame(table.gameId)
    expect(stored?.rev).toBe(rev)
    expect(incensePieces(stored)).toHaveLength(1)
  })

  it('refuses without a token to spend, and for a player who does not have the tech', async () => {
    const empty = await chivalryTable('NoToken', { piece: false })
    const refused = await chivalry(empty, 'req-1', (await view(empty.gameId, empty.starter)).rev)
    expect(refused.status).toBe(400)
    expect((await refused.json<{ message: string }>()).message).toContain('Incense')

    const table = await chivalryTable('NotOwned')
    const notOwned = await chivalry(table, 'req-1', (await view(table.gameId, table.other)).rev, table.other)
    expect(notOwned.status).toBe(400)
    expect((await notOwned.json<{ message: string }>()).message).toContain('do not have Chivalry')
  })

  it('refuses a player who is not in the game', async () => {
    const table = await chivalryTable('Outsider')
    const outsider = await register('assisted-outsider')
    const response = await chivalry(table, 'req-1', (await view(table.gameId, table.starter)).rev, outsider)
    expect(response.status).toBe(403)
  })

  it('uses an Incense hut in the hand first and keeps the piece', async () => {
    const table = await chivalryTable('Hut')
    const state = await repo.findGame(table.gameId)
    if (state === undefined) throw new Error('game missing')
    const hut = state.items.find((item) => item.kind === 'hut' && item.name === 'Incense')
    if (hut === undefined) throw new Error('no incense hut in the deck')
    await repo.saveGame({
      ...state,
      items: state.items.filter((item) => item.id !== hut.id),
      players: state.players.map((player) =>
        player.playerId === table.starterId
          ? { ...player, items: [...player.items, { ...hut, hidden: true, ownerId: table.starterId }] }
          : player,
      ),
    })

    const response = await chivalry(table, 'req-hut', (await view(table.gameId, table.starter)).rev)

    expect(response.status).toBe(200)
    const stored = await repo.findGame(table.gameId)
    expect(incensePieces(stored)).toHaveLength(1)
    expect(stored?.discardedItems.some((item) => item.id === hut.id)).toBe(true)
    expect(stored?.players.find((player) => player.playerId === table.starterId)?.items.some((item) => item.id === hut.id)).toBe(false)
  })

  it('the old coin purchase route still works and shares the use with the registry', async () => {
    const table = await chivalryTable('Coin', { piece: false })
    for (const [url, payload] of [
      [`/api/games/${table.gameId}/techs/choose`, { name: 'Democracy' }],
      [`/api/games/${table.gameId}/techs/reveal`, { name: 'Democracy' }],
      [`/api/games/${table.gameId}/players/${table.starterId}/stat`, { stat: 'trade', value: 6 }],
    ] as const) {
      expect((await post(table.starter, url, payload)).status).toBe(200)
    }

    const old = await post(table.starter, `/api/games/${table.gameId}/coin-purchase`, { source: 'democracy' })
    expect(old.status).toBe(200)
    const through = await post(table.starter, `/api/games/${table.gameId}/actions`, {
      action: 'democracy', requestId: 'again',
    })
    expect(through.status).toBe(409)
  })
})

describe('what other clients receive', () => {
  it('another player and a spectator get no available actions of the actor and no effect data', async () => {
    const table = await chivalryTable('Leak')
    const state = await repo.findGame(table.gameId)
    if (state === undefined) throw new Error('game missing')
    const hut = state.items.find((item) => item.kind === 'hut' && item.name === 'Incense')
    if (hut === undefined) throw new Error('no incense hut in the deck')
    await repo.saveGame({
      ...state,
      items: state.items.filter((item) => item.id !== hut.id),
      players: state.players.map((player) =>
        player.playerId === table.starterId
          ? { ...player, items: [...player.items, { ...hut, hidden: true, ownerId: table.starterId }] }
          : player,
      ),
    })
    const done = await chivalry(table, 'req-1', (await view(table.gameId, table.starter)).rev)
    expect(done.status).toBe(200)
    const outsider = await register('leak-spectator')
    const logId = (await done.json<View>()).assistedActions[0]?.logId as string

    const asOther = await inject(app, { url: `/api/games/${table.gameId}`, headers: bearer(table.other) })
    const asSpectator = await inject(app, { url: `/api/games/${table.gameId}`, headers: bearer(outsider) })
    const anonymous = await inject(app, { url: `/api/games/${table.gameId}` })

    const otherView = await asOther.json<View>()
    // Their own button state, which says they do not have Chivalry
    expect(otherView.you?.availableActions?.filter((entry) => entry.action !== 'cultureAdvance').every((entry) => entry.status === 'not-owned')).toBe(true)
    for (const response of [asOther, asSpectator, anonymous]) {
      expect(response.status).toBe(200)
      expect(response.body).not.toContain(hut.id)
      expect(response.body).not.toContain('"effect"')
      expect(response.body).not.toContain('usageKey')
      expect(response.body).not.toContain('card:Chivalry')
      expect(response.body).not.toContain('"itemId"')
    }
    for (const response of [asSpectator, anonymous]) {
      expect(response.body).not.toContain('availableActions')
      expect((await response.json<View>()).you).toBeNull()
    }
    // The public summary is the same for everybody
    expect((await asSpectator.json<View>()).assistedActions[0]).toMatchObject({ id: 'req-1', logId })

    // The log endpoints and the pending undo list carry no hut identity either
    await post(table.other, `/api/games/${table.gameId}/undo/${logId}`, {})
    for (const url of [`/log/public`, `/log/private`, `/undo/pending`]) {
      const response = await inject(app, { url: `/api/games/${table.gameId}${url}`, headers: bearer(table.other) })
      expect(response.body).not.toContain(hut.id)
      expect(response.body).not.toContain('"effect"')
    }
  })
})

describe('undo over HTTP', () => {
  it('another player asks, the actor votes yes, and the action is reversed', async () => {
    const table = await chivalryTable('Undo')
    const pieceBefore = incensePieces(await repo.findGame(table.gameId))[0]
    expect((await chivalry(table, 'req-1', (await view(table.gameId, table.starter)).rev)).status).toBe(200)
    const logId = (await view(table.gameId, table.other)).assistedActions[0]?.logId as string

    const asked = await post(table.other, `/api/games/${table.gameId}/undo/${logId}`, {})
    expect(asked.status).toBe(200)
    const pending = await inject(app, { url: `/api/games/${table.gameId}/undo/pending`, headers: bearer(table.starter) })
    expect(await pending.json()).toEqual([
      expect.objectContaining({ id: logId, votesRequired: 2, votesCast: 1 }),
    ])

    const voted = await post(table.starter, `/api/games/${table.gameId}/undo/${logId}/vote`, { vote: true })
    expect(voted.status).toBe(200)

    const after = await voted.json<View>()
    expect(after.you?.stats.culture).toBe(0)
    expect(after.assistedActions[0]?.status).toBe('undone')
    const stored = await repo.findGame(table.gameId)
    expect(incensePieces(stored)[0]).toMatchObject({ id: pieceBefore?.id, x: pieceBefore?.x, y: pieceBefore?.y })
    expect(stored?.players.find((player) => player.playerId === table.starterId)?.playerTurns[0]?.usedActions).not.toContain('card:Chivalry')
    expect(stored?.log.at(-1)?.publicLog).toContain('was undone')

    // Undoing twice is refused, and the action can be done again with a new requestId
    const twice = await post(table.other, `/api/games/${table.gameId}/undo/${logId}`, {})
    expect(twice.status).toBe(409)
    const again = await chivalry(table, 'req-2', (await view(table.gameId, table.starter)).rev)
    expect(again.status).toBe(200)
    expect((await again.json<View>()).you?.stats.culture).toBe(5)
  })

  it('one no leaves the action in place', async () => {
    const table = await chivalryTable('UndoNo')
    expect((await chivalry(table, 'req-1', (await view(table.gameId, table.starter)).rev)).status).toBe(200)
    const logId = (await view(table.gameId, table.other)).assistedActions[0]?.logId as string

    await post(table.other, `/api/games/${table.gameId}/undo/${logId}`, {})
    const refused = await post(table.starter, `/api/games/${table.gameId}/undo/${logId}/vote`, { vote: false })

    expect(refused.status).toBe(200)
    const after = await refused.json<View>()
    expect(after.you?.stats.culture).toBe(5)
    expect(after.assistedActions[0]?.status).toBe('applied')
    expect(incensePieces(await repo.findGame(table.gameId))).toHaveLength(0)
  })
})

describe('the public log offers the undo to every player in the game', () => {
  it('canUndo is true for any player on the applied line, false for others outside the game and after the undo', async () => {
    const table = await chivalryTable('LogUndo')
    expect((await chivalry(table, 'req-1', (await view(table.gameId, table.starter)).rev)).status).toBe(200)
    const spectator = await register('logundo-spectator')
    type Line = { assistedActionId?: string; canUndo?: boolean }
    const logOf = async (token?: string) => {
      const response = await inject(app, {
        url: `/api/games/${table.gameId}/log/public`,
        ...(token === undefined ? {} : { headers: bearer(token) }),
      })
      return (await response.json<readonly Line[]>()).filter((line) => line.assistedActionId === 'req-1')
    }

    // Anyone at the table can ask: the actor and the other player
    expect((await logOf(table.starter))[0]?.canUndo).toBe(true)
    expect((await logOf(table.other))[0]?.canUndo).toBe(true)
    // A logged-in user who is not in the game, and a viewer with no account
    expect((await logOf(spectator))[0]?.canUndo).toBe(false)
    expect((await logOf())[0]?.canUndo).toBe(false)

    // Once the vote has been asked for, no second request is offered
    const logId = (await view(table.gameId, table.other)).assistedActions[0]?.logId as string
    expect((await post(table.other, `/api/games/${table.gameId}/undo/${logId}`, {})).status).toBe(200)
    expect((await logOf(table.starter))[0]?.canUndo).toBe(false)
    expect((await logOf(table.other))[0]?.canUndo).toBe(false)

    // And not after the undo has gone through
    await post(table.starter, `/api/games/${table.gameId}/undo/${logId}/vote`, { vote: true })
    for (const token of [table.starter, table.other, spectator, undefined]) {
      expect((await logOf(token))[0]?.canUndo).toBe(false)
    }
  })
})

describe('the board history and the replay', () => {
  it('the board Undo cannot take back the spent piece, and answers 409', async () => {
    const table = await chivalryTable('BoardUndo')
    expect((await chivalry(table, 'req-1', (await view(table.gameId, table.starter)).rev)).status).toBe(200)
    const before = await repo.findGame(table.gameId)

    const refused = await post(table.starter, `/api/games/${table.gameId}/board/undo`, {})

    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ error: 'BOARD_UNDO_ASSISTED' })
    const after = await repo.findGame(table.gameId)
    expect(after?.rev).toBe(before?.rev)
    expect(incensePieces(after)).toHaveLength(0)
    expect(after?.players.find((player) => player.playerId === table.starterId)?.stats.culture).toBe(5)
  })

  it('a replayed revision shows no ready button, though the live state has one', async () => {
    const table = await chivalryTable('Replay')
    const ready = await view(table.gameId, table.starter)
    expect(ready.you?.availableActions?.find((entry) => entry.action === 'chivalry')?.status).toBe('ready')
    expect((await chivalry(table, 'req-1', ready.rev)).status).toBe(200)

    const past = await inject(app, {
      url: `/api/games/${table.gameId}/revisions/${ready.rev}`,
      headers: bearer(table.starter),
    })

    expect(past.status).toBe(200)
    const replay = await past.json<{ view: View }>()
    // It is the state before the press, so the piece is still on the board ...
    expect(replay.view.board.pieces.some((piece) => piece.assetId === 'resources/incense')).toBe(true)
    // ... and still no button
    expect(replay.view.you?.availableActions).toEqual([])
  })
})

describe('using a card again after the player confirmed it', () => {
  /** Chivalry used once, and a second incense piece waiting in the area, so only the once per turn rule is in the way. */
  async function usedOnce(name: string): Promise<{ table: Table; rev: number }> {
    const table = await chivalryTable(name)
    const mine = await view(table.gameId, table.starter)
    const area = mine.boardAreas.find((candidate) => candidate.playerId === table.starterId)
    await post(table.starter, `/api/games/${table.gameId}/board/pieces`, {
      assetId: 'resources/incense', x: (area?.x ?? 0) + 20, y: (area?.y ?? 0) + 80,
    })
    const ready = await view(table.gameId, table.starter)
    expect((await chivalry(table, 'req-1', ready.rev)).status).toBe(200)
    return { table, rev: ready.rev + 1 }
  }
  const again = (table: Table, rev: number, confirmedRepeat: unknown) =>
    post(table.starter, `/api/games/${table.gameId}/actions`, {
      action: 'chivalry', requestId: 'req-2', rev, confirmedRepeat,
    })

  it('applies a second use when confirmedRepeat is true, with the line and the record saying so', async () => {
    const { table, rev } = await usedOnce('RepeatYes')

    const response = await again(table, rev, true)

    expect(response.status).toBe(200)
    const after = await response.json<View & { assistedActions: readonly { id: string; confirmedRepeat?: boolean; text: string }[] }>()
    expect(after.you?.stats.culture).toBe(10)
    expect(after.assistedActions.map((record) => record.id)).toEqual(['req-1', 'req-2'])
    expect(after.assistedActions[1]?.confirmedRepeat).toBe(true)
    expect(after.assistedActions[1]?.text).toContain('used again, confirmed by the player')
    expect(after.assistedActions[0]?.confirmedRepeat).toBeUndefined()
    expect(after.you?.availableActions?.find((entry) => entry.action === 'chivalry')?.status).toBe('used')
    const stored = await repo.findGame(table.gameId)
    expect(incensePieces(stored)).toHaveLength(0)
    expect(stored?.players.find((player) => player.playerId === table.starterId)?.playerTurns[0]?.usedActions).toEqual([
      'card:Chivalry',
    ])
  })

  it('stays a 409 without the flag, and with the flag set to false', async () => {
    const { table, rev } = await usedOnce('RepeatNo')

    const without = await post(table.starter, `/api/games/${table.gameId}/actions`, {
      action: 'chivalry', requestId: 'req-2', rev,
    })
    expect(without.status).toBe(409)
    expect(await without.json()).toMatchObject({ error: 'ASSISTED_ACTION_REJECTED' })
    expect((await again(table, rev, false)).status).toBe(409)
    expect(incensePieces(await repo.findGame(table.gameId))).toHaveLength(1)
  })

  it('answers 400 for a confirmedRepeat that is not a boolean, and changes nothing', async () => {
    const { table, rev } = await usedOnce('RepeatBad')
    for (const value of ['true', 1, 'yes', null, {}]) {
      const response = await again(table, rev, value)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: 'BAD_REQUEST' })
    }
    const stored = await repo.findGame(table.gameId)
    expect(stored?.assistedActions).toHaveLength(1)
    expect(incensePieces(stored)).toHaveLength(1)
  })

  it('does not lift any other refusal: no token left is still a 409', async () => {
    const table = await chivalryTable('RepeatEmpty')
    const rev = (await view(table.gameId, table.starter)).rev
    expect((await chivalry(table, 'req-1', rev)).status).toBe(200)

    const response = await again(table, rev + 1, true)

    expect(response.status).toBe(400)
    expect((await response.json<{ message: string }>()).message).toContain('Incense')
    expect((await repo.findGame(table.gameId))?.assistedActions).toHaveLength(1)
  })

  it('the old coin-purchase route has no override', async () => {
    const table = await chivalryTable('RepeatLegacy', { piece: false })
    for (const [url, payload] of [
      [`/api/games/${table.gameId}/techs/choose`, { name: 'Democracy' }],
      [`/api/games/${table.gameId}/techs/reveal`, { name: 'Democracy' }],
      [`/api/games/${table.gameId}/players/${table.starterId}/stat`, { stat: 'trade', value: 12 }],
    ] as const) {
      expect((await post(table.starter, url, payload)).status).toBe(200)
    }
    expect((await post(table.starter, `/api/games/${table.gameId}/coin-purchase`, { source: 'democracy' })).status).toBe(200)

    const second = await post(table.starter, `/api/games/${table.gameId}/coin-purchase`, {
      source: 'democracy', confirmedRepeat: true,
    })

    expect(second.status).toBe(409)
  })

  it('an undo of the repeat leaves the card used for the first use', async () => {
    const { table, rev } = await usedOnce('RepeatUndo')
    const done = await (await again(table, rev, true)).json<View>()
    const logId = done.assistedActions[1]?.logId as string
    expect((await post(table.other, `/api/games/${table.gameId}/undo/${logId}`, {})).status).toBe(200)

    const voted = await post(table.starter, `/api/games/${table.gameId}/undo/${logId}/vote`, { vote: true })

    expect(voted.status).toBe(200)
    const after = await voted.json<View>()
    expect(after.you?.stats.culture).toBe(5)
    expect(after.assistedActions.map((record) => record.status)).toEqual(['applied', 'undone'])
    expect(after.you?.availableActions?.find((entry) => entry.action === 'chivalry')?.status).toBe('used')
  })

  it('another player sees the repeat flag and no effect data', async () => {
    const { table, rev } = await usedOnce('RepeatLeak')
    await again(table, rev, true)

    const theirs = await inject(app, { url: `/api/games/${table.gameId}`, headers: bearer(table.other) })
    const text = JSON.stringify(await theirs.json())

    expect(text).toContain('"confirmedRepeat":true')
    expect(text).not.toContain('"effect"')
    expect(text).not.toContain('usageKey')
    expect(text).not.toContain('card:Chivalry')
    expect(text).not.toContain('has already been used this turn')
  })
})
