/**
 * Currency through `POST /api/games/:gameId/actions`: the second incense card on
 * the same route as Chivalry. The rules are in
 * `packages/engine/test/assisted-cards.test.ts`; this checks the route accepts
 * the new action id and that nothing private reaches the other player.
 */

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
  readonly you: {
    readonly playerId: string
    readonly stats: { readonly culture: number }
    readonly availableActions?: readonly { action: string; label: string; status: string; reason: string }[]
  } | null
  readonly boardAreas: readonly { playerId: string; x: number; y: number }[]
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

/** A started two-player game: the starter has Currency revealed, City Management open and an incense piece. */
async function currencyTable() {
  const creator = await register('cur-a')
  const created = await inject(app, {
    method: 'POST', url: '/api/games', headers: bearer(creator), payload: { name: 'Cur', numOfPlayers: 2 },
  })
  const gameId = (await created.json() as { id: string }).id
  const joiner = await register('cur-b')
  await post(joiner, `/api/games/${gameId}/join`, {})

  const state = await repo.findGame(gameId)
  const starter = state?.players.find((player) => player.yourTurn)?.username === 'cur-a' ? creator : joiner
  const other = starter === creator ? joiner : creator
  const mine = await view(gameId, starter)
  const starterId = mine.you?.playerId as string

  expect((await post(starter, `/api/games/${gameId}/techs/choose`, { name: 'Currency' })).status).toBe(200)
  expect((await post(starter, `/api/games/${gameId}/techs/reveal`, { name: 'Currency' })).status).toBe(200)
  expect((await post(starter, `/api/games/${gameId}/turns/done`, { phase: 'TRADE' })).status).toBe(200)
  const area = mine.boardAreas.find((candidate) => candidate.playerId === starterId)
  if (area === undefined) throw new Error('no area for the starter')
  const placed = await post(starter, `/api/games/${gameId}/board/pieces`, {
    assetId: 'resources/incense', x: area.x + 20, y: area.y + 80,
  })
  expect(placed.status).toBe(200)
  return { gameId, starter, other, starterId }
}

const entryOf = (v: View, action: string) => v.you?.availableActions?.find((entry) => entry.action === action)

describe('POST /api/games/:gameId/actions with Currency', () => {
  it('performs Currency: 3 culture, the same route, the projection comes back', async () => {
    const table = await currencyTable()
    const before = await view(table.gameId, table.starter)
    expect(entryOf(before, 'currency')).toMatchObject({ status: 'ready', label: 'Currency' })

    const response = await post(table.starter, `/api/games/${table.gameId}/actions`, {
      action: 'currency', requestId: 'req-1', rev: before.rev,
    })

    expect(response.status).toBe(200)
    const after = await response.json<View>()
    expect(after.you?.stats.culture).toBe(3)
    expect(after.assistedActions[0]).toMatchObject({ id: 'req-1', kind: 'currency', status: 'applied' })
    expect(after.assistedActions[0]?.text).toMatch(/^cur-[ab] used Currency: spent 1 Incense and gained 3 culture$/)
    expect(entryOf(after, 'currency')?.status).toBe('used')

    // The same request id again is a no-op; a new one is refused
    const retry = await post(table.starter, `/api/games/${table.gameId}/actions`, {
      action: 'currency', requestId: 'req-1', rev: after.rev,
    })
    expect(retry.status).toBe(200)
    expect((await retry.json<View>()).you?.stats.culture).toBe(3)
    const second = await post(table.starter, `/api/games/${table.gameId}/actions`, {
      action: 'currency', requestId: 'req-2', rev: after.rev,
    })
    expect(second.status).toBe(409)
    expect(await second.json()).toMatchObject({ error: 'ASSISTED_ACTION_REJECTED' })
  })

  it('refuses the action for a player who does not have the tech', async () => {
    const table = await currencyTable()
    const theirs = await view(table.gameId, table.other)
    const response = await post(table.other, `/api/games/${table.gameId}/actions`, {
      action: 'currency', requestId: 'req-x', rev: theirs.rev,
    })
    // Only "used" is a conflict; the rest are bad requests, as for Chivalry
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'ASSISTED_ACTION_REJECTED' })
  })

  it('shows the other player nothing but the public line', async () => {
    const table = await currencyTable()
    const before = await view(table.gameId, table.starter)
    await post(table.starter, `/api/games/${table.gameId}/actions`, {
      action: 'currency', requestId: 'req-1', rev: before.rev,
    })

    const theirs = await view(table.gameId, table.other)
    expect(theirs.assistedActions).toHaveLength(1)
    // The culture advance is not tied to a card, so it answers with its own reason
    expect(theirs.you?.availableActions?.filter((entry) => entry.action !== 'cultureAdvance').every((entry) => entry.status === 'not-owned')).toBe(true)
    const json = JSON.stringify(theirs)
    expect(json).not.toContain('"effect"')
    expect(json).not.toContain('card:Currency')
    expect(json).not.toContain('usageKey')
  })
})
