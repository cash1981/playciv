/**
 * The Start of Turn actions through `POST /api/games/:gameId/actions`. The rules are in
 * `packages/engine/test/assisted-sot.test.ts`; this checks the route's own work: the
 * strict shape of `args`, the revision check, and what a second player sees.
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
    readonly government: string
    readonly stats: { readonly trade: number; readonly culture: number; readonly infra: number }
    readonly availableActions: readonly { action: string; phase: string; group: string; status: string; reason: string }[]
    readonly startOfTurn: {
      readonly government: { readonly status: string; readonly options: readonly { government: string; route: string }[] }
      readonly invest: { readonly status: string; readonly coins: readonly { key: string; coins: number }[] }
      readonly techGrants: readonly { id: string; source: string; level: number | null }[]
    } | null
  } | null
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

/** A started two-player game with the starter's Start of Turn open. */
async function table(tag: string) {
  const creator = await register(`sot-a-${tag}`)
  const created = await inject(app, {
    method: 'POST', url: '/api/games', headers: bearer(creator), payload: { name: 'SOT', numOfPlayers: 2 },
  })
  const gameId = (await created.json() as { id: string }).id
  const joiner = await register(`sot-b-${tag}`)
  await post(joiner, `/api/games/${gameId}/join`, {})
  const state = await repo.findGame(gameId)
  if (state === undefined) throw new Error('game missing')
  const starter = state.players.find((player) => player.yourTurn)?.username === `sot-a-${tag}` ? creator : joiner
  const other = starter === creator ? joiner : creator
  const starterId = (await view(gameId, starter)).you?.playerId as string
  return { gameId, starter, other, starterId }
}

const actions = (gameId: string) => `/api/games/${gameId}/actions`

/** Chooses and reveals a social policy for the starter through the routes. */
async function adopt(t: Awaited<ReturnType<typeof table>>, name: string): Promise<void> {
  expect((await post(t.starter, `/api/games/${t.gameId}/socialpolicy/choose`, { name })).status).toBe(200)
  expect((await post(t.starter, `/api/games/${t.gameId}/socialpolicies/reveal`, { name })).status).toBe(200)
}

describe('a social policy through the actions route', () => {
  it('lists the policy buttons in the Start of Turn tab and performs Pacifism once', async () => {
    const t = await table('pac')
    await adopt(t, 'Pacifism')
    const before = await view(t.gameId, t.starter)
    const entry = before.you?.availableActions.find((candidate) => candidate.action === 'pacifism')
    expect(entry).toMatchObject({ phase: 'SOT', group: 'Social policies', status: 'ready' })

    const response = await post(t.starter, actions(t.gameId), { action: 'pacifism', requestId: 'req-1', rev: before.rev })
    expect(response.status).toBe(200)
    const after = await response.json<View>()
    expect(after.you?.stats.culture).toBe(1)
    expect(after.assistedActions[0]).toMatchObject({ id: 'req-1', kind: 'pacifism', status: 'applied' })
    expect(after.you?.availableActions.find((candidate) => candidate.action === 'pacifism')?.status).toBe('used')

    const second = await post(t.starter, actions(t.gameId), { action: 'pacifism', requestId: 'req-2', rev: after.rev })
    expect(second.status).toBe(409)
    expect(await second.json()).toMatchObject({ error: 'ASSISTED_ACTION_REJECTED' })
  })

  it('gives 409 on a stale revision and changes nothing', async () => {
    const t = await table('stale')
    await adopt(t, 'Pacifism')
    const rev = (await view(t.gameId, t.starter)).rev
    const response = await post(t.starter, actions(t.gameId), { action: 'pacifism', requestId: 'req-1', rev: rev - 1 })
    expect(response.status).toBe(409)
    expect((await repo.findGame(t.gameId))?.assistedActions).toHaveLength(0)
  })

  it('refuses a player who has not adopted it, and gives the other player no buttons that name it', async () => {
    const t = await table('own')
    await adopt(t, 'Pacifism')
    const theirs = await view(t.gameId, t.other)
    const response = await post(t.other, actions(t.gameId), { action: 'pacifism', requestId: 'req-x', rev: theirs.rev })
    expect(response.status).toBe(400)
    expect(theirs.you?.availableActions.find((candidate) => candidate.action === 'pacifism')?.status).toBe('not-owned')
  })
})

describe('changing government through the actions route', () => {
  it('lists the options for the viewer, performs the change and refuses a second one', async () => {
    const t = await table('gov')
    for (const path of ['choose', 'reveal']) {
      expect((await post(t.starter, `/api/games/${t.gameId}/techs/${path}`, { name: 'Chivalry' })).status).toBe(200)
    }
    const before = await view(t.gameId, t.starter)
    expect(before.you?.startOfTurn?.government.options).toEqual([
      expect.objectContaining({ government: 'Feudalism', route: 'direct' }),
    ])

    const response = await post(t.starter, actions(t.gameId), {
      action: 'switchGovernment', requestId: 'req-1', rev: before.rev, args: { government: 'Feudalism' },
    })
    expect(response.status).toBe(200)
    const after = await response.json<View>()
    expect(after.you?.government).toBe('Feudalism')
    expect(after.assistedActions[0]?.text).toBe(`${(await repo.findGame(t.gameId))?.players.find((p) => p.playerId === t.starterId)?.username} changed government from Despotism to Feudalism`)

    const again = await post(t.starter, actions(t.gameId), {
      action: 'switchGovernment', requestId: 'req-2', rev: after.rev, args: { government: 'Despotism' }, confirmedRepeat: true,
    })
    expect(again.status).toBe(409)
  })

  it('refuses a government the shape does not allow', async () => {
    const t = await table('govshape')
    const rev = (await view(t.gameId, t.starter)).rev
    for (const args of [{ government: 'Utopia' }, { government: 3 }, {}, { government: 'Anarchy', extra: true }, 'x']) {
      const response = await post(t.starter, actions(t.gameId), {
        action: 'switchGovernment', requestId: `req-${Math.random()}`, rev, args,
      })
      expect(response.status).toBe(400)
    }
  })

  it('does not show the starter’s choices to the other player, who has a view of their own', async () => {
    const t = await table('govpriv')
    // Only the starter has a coin on the sheet, so only the starter can invest one
    expect((await post(t.starter, `/api/games/${t.gameId}/players/${t.starterId}/coin`, { source: 'sheet', value: 2 })).status).toBe(200)
    const mine = await view(t.gameId, t.starter)
    expect(mine.you?.startOfTurn?.invest.coins).toEqual([{ key: 'sheet', coins: 2, label: 'Sheet' }])
    const theirs = await view(t.gameId, t.other)
    expect(theirs.you?.playerId).not.toBe(t.starterId)
    expect(theirs.you?.startOfTurn?.invest.coins).toEqual([])
    const opponents = (theirs as unknown as { opponents: readonly object[] }).opponents
    expect(JSON.stringify(opponents)).not.toContain('startOfTurn')
    expect(JSON.stringify(opponents)).not.toContain('availableActions')
  })
})

describe('a replayed revision', () => {
  it('has no Start of Turn choices and no playable card: none can be made from the past', async () => {
    const t = await table('replay')
    const live = await view(t.gameId, t.starter)
    expect(live.you?.startOfTurn).not.toBeNull()
    const past = await inject(app, { url: `/api/games/${t.gameId}/revisions/${live.rev}`, headers: bearer(t.starter) })
    expect(past.status).toBe(200)
    const replay = await past.json<{ view: { you: { startOfTurn: unknown; playableCards: unknown; availableActions: unknown } | null } }>()
    expect(replay.view.you?.startOfTurn).toBeNull()
    expect(replay.view.you?.playableCards).toEqual([])
    expect(replay.view.you?.availableActions).toEqual([])
  })
})

describe('investing through the actions route', () => {
  async function withCoin(t: Awaited<ReturnType<typeof table>>): Promise<void> {
    const response = await post(t.starter, `/api/games/${t.gameId}/players/${t.starterId}/coin`, { source: 'sheet', value: 2 })
    expect(response.status).toBe(200)
  }

  it('invests the coin and puts the marker on the card', async () => {
    const t = await table('inv')
    await withCoin(t)
    const before = await view(t.gameId, t.starter)
    expect(before.you?.startOfTurn?.invest).toMatchObject({ status: 'ready', coins: [{ key: 'sheet', coins: 2 }] })
    const response = await post(t.starter, actions(t.gameId), {
      action: 'invest', requestId: 'req-1', rev: before.rev, args: { source: 'sheet', card: 'infra' },
    })
    expect(response.status).toBe(200)
    const after = await response.json<View>()
    expect(after.you?.stats.infra).toBe(1)
    expect(after.you?.startOfTurn?.invest.status).toBe('used')
    expect(after.assistedActions[0]?.text).toMatch(/invested a coin in Infrastructure \(1 marker on it\)$/)
  })

  it('refuses a malformed or unknown card and source', async () => {
    const t = await table('invshape')
    await withCoin(t)
    const rev = (await view(t.gameId, t.starter)).rev
    for (const args of [{ source: 'sheet', card: 'gold' }, { source: '', card: 'infra' }, { card: 'infra' }, { source: 'sheet' }]) {
      const response = await post(t.starter, actions(t.gameId), {
        action: 'invest', requestId: `req-${Math.random()}`, rev, args,
      })
      expect(response.status).toBe(400)
    }
    const printed = await post(t.starter, actions(t.gameId), {
      action: 'invest', requestId: 'req-p', rev, args: { source: 'bank', card: 'infra' },
    })
    expect(printed.status).toBe(400)
    expect((await repo.findGame(t.gameId))?.assistedActions).toHaveLength(0)
  })
})

describe('Feudalism through the actions route', () => {
  it('refuses the harvest for a player who is not governed by Feudalism, and a malformed body', async () => {
    const t = await table('feud')
    const rev = (await view(t.gameId, t.starter)).rev
    const notFeudal = await post(t.starter, actions(t.gameId), {
      action: 'feudalismHarvest', requestId: 'req-1', rev, args: { cityPieceId: 'c1', resource: 'Silk' },
    })
    expect(notFeudal.status).toBe(400)
    const bad = await post(t.starter, actions(t.gameId), {
      action: 'feudalismHarvest', requestId: 'req-2', rev, args: { resource: 'Silk' },
    })
    expect(bad.status).toBe(400)
  })
})

describe('wonder, Great Person, tech, hut and relic abilities through the actions route', () => {
  /** The starter owns a Panama Canal on the map, placed and assigned through the board routes. */
  async function withPanama(t: Awaited<ReturnType<typeof table>>): Promise<string> {
    const placed = await post(t.starter, `/api/games/${t.gameId}/board/pieces`, { assetId: 'wonders/panamacanal', x: 600, y: 600 })
    expect(placed.status).toBe(200)
    const piece = (await repo.findGame(t.gameId))?.board.pieces.find((candidate) => candidate.assetId === 'wonders/panamacanal')
    if (piece === undefined) throw new Error('the wonder was not placed')
    const owned = await post(t.starter, `/api/games/${t.gameId}/board/pieces/${piece.id}/owner`, { ownerId: t.starterId })
    expect(owned.status).toBe(200)
    return piece.id
  }

  it('lists the ability as ready for the owner only, performs it, and refuses a second press', async () => {
    const t = await table('wonder')
    const pieceId = await withPanama(t)
    const before = await view(t.gameId, t.starter)
    expect(before.you?.availableActions.find((candidate) => candidate.action === 'sot:panamaCanal')).toMatchObject({
      phase: 'SOT', group: 'Wonders', status: 'ready',
    })
    const theirs = await view(t.gameId, t.other)
    expect(theirs.you?.availableActions.find((candidate) => candidate.action === 'sot:panamaCanal')?.status).toBe('not-owned')

    const response = await post(t.starter, actions(t.gameId), { action: 'sot:panamaCanal', requestId: 'req-1', rev: before.rev })
    expect(response.status).toBe(200)
    const after = await response.json<View>()
    expect(after.assistedActions[0]).toMatchObject({ id: 'req-1', kind: 'sot:panamaCanal', status: 'applied' })
    expect((await repo.findGame(t.gameId))?.board.pieces.find((piece) => piece.id === pieceId)?.coinTokens).toBe(1)

    const second = await post(t.starter, actions(t.gameId), { action: 'sot:panamaCanal', requestId: 'req-2', rev: after.rev })
    expect(second.status).toBe(409)
    // The coin is the action's own: the board's Undo leaves it to the vote
    const refused = await post(t.starter, `/api/games/${t.gameId}/board/undo`, {})
    expect(await refused.json()).toMatchObject({ error: 'BOARD_UNDO_ASSISTED' })
  })

  it('refuses an ability the player does not hold, an unknown ability, and an args body', async () => {
    const t = await table('wonder2')
    const rev = (await view(t.gameId, t.starter)).rev
    const none = await post(t.starter, actions(t.gameId), { action: 'sot:stonehenge', requestId: 'req-1', rev })
    expect(none.status).toBe(400)
    expect(await none.json()).toMatchObject({ error: 'ASSISTED_ACTION_REJECTED' })
    const unknown = await post(t.starter, actions(t.gameId), { action: 'sot:nothing', requestId: 'req-2', rev })
    expect(unknown.status).toBe(400)
    const withArgs = await post(t.starter, actions(t.gameId), { action: 'sot:stonehenge', requestId: 'req-3', rev, args: { x: 1 } })
    expect(withArgs.status).toBe(400)
    expect((await repo.findGame(t.gameId))?.assistedActions).toHaveLength(0)
  })
})

describe('cities and scouts through the actions route', () => {
  it('refuses a malformed foundCity and assignScout before the engine sees it', async () => {
    const t = await table('city')
    const rev = (await view(t.gameId, t.starter)).rev
    const send = (action: string, args: unknown) =>
      post(t.starter, actions(t.gameId), { action, requestId: `req-${Math.random()}`, rev, args })
    for (const args of [{}, { figurePieceId: 'bad id!' }, { figurePieceId: 'a', extra: 1 }, 'x']) {
      expect((await send('foundCity', args)).status).toBe(400)
    }
    for (const args of [{}, { scoutPieceId: 's1' }, { scoutPieceId: 's1', cityPieceId: 3 }, { scoutPieceId: 's1', cityPieceId: 'c1', extra: 1 }]) {
      expect((await send('assignScout', args)).status).toBe(400)
    }
    expect((await repo.findGame(t.gameId))?.assistedActions).toHaveLength(0)
  })

  it('answers a well formed request for a figure that does not exist with the engine reason', async () => {
    const t = await table('city2')
    const rev = (await view(t.gameId, t.starter)).rev
    const response = await post(t.starter, actions(t.gameId), {
      action: 'foundCity', requestId: 'req-1', rev, args: { figurePieceId: 'nothing' },
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'ASSISTED_ACTION_REJECTED' })
    const none = await post(t.starter, actions(t.gameId), {
      action: 'assignScout', requestId: 'req-2', rev, args: { scoutPieceId: 's1', cityPieceId: null },
    })
    expect(none.status).toBe(400)
  })

  it('gives the starter the scouts section and the city limit, and the other player a view of their own', async () => {
    const t = await table('city3')
    const mine = await view(t.gameId, t.starter)
    expect(mine.you?.startOfTurn).toMatchObject({
      cityLimit: { have: 0, max: 2 },
      scouts: [],
      cities: [],
      scoutsNow: { status: 'ready' },
    })
    // The other player is not in their Start of Turn: their own view says so, and holds nothing of the starter's
    const theirs = await view(t.gameId, t.other)
    expect(theirs.you?.playerId).not.toBe(t.starterId)
    expect(theirs.you?.startOfTurn).toMatchObject({ cityLimit: { have: 0, max: 2 }, scouts: [], cities: [] })
  })
})
