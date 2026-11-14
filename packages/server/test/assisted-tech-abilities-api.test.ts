/**
 * The resource abilities of the techs (issue #327, slice 2) through the routes: each takes strict `args`, and
 * Philosophy's drawn card and Monarchy's victim hand stay private. The rules are in
 * `packages/engine/test/assisted-tech-abilities.test.ts`.
 */

import { SQUARE_SIZE, mapTop } from '@civ/engine'
import type { ResourcePaymentOption } from '@civ/engine'
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
    readonly color: string | null
    readonly stats: { readonly trade: number; readonly coinSources: Record<string, number> }
    readonly items: readonly { readonly id: string; readonly kind: string; readonly name?: string }[]
    readonly availableActions?: readonly {
      action: string; status: string; reason: string
      readonly payment?: { readonly cost: readonly (string | null)[]; readonly options: readonly ResourcePaymentOption[] }
    }[]
  } | null
  readonly opponents: readonly { readonly playerId: string; readonly stats: { readonly trade: number; readonly coinSources: Record<string, number> } }[]
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

/** A started two-player game; the starter has revealed `tech` and holds the given resource pieces in their area. */
async function table(tag: string, tech: string, pieces: readonly string[]) {
  const creator = await register(`ta-a-${tag}`)
  const created = await inject(app, {
    method: 'POST', url: '/api/games', headers: bearer(creator), payload: { name: 'TA', numOfPlayers: 2 },
  })
  const gameId = (await created.json() as { id: string }).id
  const joiner = await register(`ta-b-${tag}`)
  await post(joiner, `/api/games/${gameId}/join`, {})
  const state = await repo.findGame(gameId)
  const starter = state?.players.find((player) => player.yourTurn)?.username === `ta-a-${tag}` ? creator : joiner
  const other = starter === creator ? joiner : creator
  const mine = await view(gameId, starter)
  const starterId = mine.you?.playerId as string
  const otherId = (await view(gameId, other)).you?.playerId as string

  expect((await post(starter, `/api/games/${gameId}/techs/choose`, { name: tech })).status).toBe(200)
  expect((await post(starter, `/api/games/${gameId}/techs/reveal`, { name: tech })).status).toBe(200)
  const area = mine.boardAreas.find((candidate) => candidate.playerId === starterId)
  if (area === undefined) throw new Error('no area for the starter')
  for (const [index, assetId] of pieces.entries()) {
    const placed = await post(starter, `/api/games/${gameId}/board/pieces`, { assetId, x: area.x + 20 + index * 60, y: area.y + 80 })
    expect(placed.status).toBe(200)
  }
  return { gameId, starter, other, starterId, otherId, color: mine.you?.color ?? 'Red' }
}

/** Moves a hut of this name from the deck into a player's hand (there are no Spy or Uranium pieces to drop on the board). */
async function giveHut(gameId: string, playerId: string, name: string): Promise<number> {
  const state = await repo.findGame(gameId)
  const hut = state?.items.find((item) => item.kind === 'hut' && item.name === name)
  if (state === undefined || hut === undefined) throw new Error(`no ${name} hut in the deck`)
  await repo.saveGame({
    ...state,
    items: state.items.filter((item) => item.id !== hut.id),
    players: state.players.map((player) =>
      player.playerId === playerId ? { ...player, items: [...player.items, { ...hut, hidden: true, ownerId: playerId }] } : player,
    ),
  })
  return hut.itemNumber
}

async function giveGift(gameId: string, playerId: string): Promise<string> {
  const state = await repo.findGame(gameId)
  const card = state?.items.find((item) => item.kind.startsWith('culture') && 'name' in item && item.name === 'A Generous Gift')
  if (state === undefined || card === undefined) throw new Error('no A Generous Gift in the deck')
  await repo.saveGame({
    ...state,
    items: state.items.filter((item) => item.id !== card.id),
    players: state.players.map((player) => player.playerId === playerId
      ? { ...player, items: [...player.items, { ...card, ownerId: playerId, hidden: true }] }
      : player),
  })
  return card.id
}

const actions = (gameId: string) => `/api/games/${gameId}/actions`
const entryOf = (v: View, action: string) => v.you?.availableActions?.find((entry) => entry.action === action)
const doneThrough = async (t: { gameId: string; starter: string }, phase: 'SOT' | 'TRADE' | 'CM' | 'MOVEMENT') =>
  expect((await post(t.starter, `/api/games/${t.gameId}/turns/done`, { phase })).status).toBe(200)

describe('resources through args: Pottery, Philosophy and Education', () => {
  it.each([false, true])('native village Iron and Uranium pay through the shared API and remove village icons (explicit=%s)', async (explicit) => {
    const t = await table(`village-${explicit}`, 'Pottery', ['resources/village', 'resources/village', 'resources/hut'])
    const state = await repo.findGame(t.gameId)
    if (state === undefined) throw new Error('missing game')
    const resources = ['Iron', 'Uranium'].map((name) => {
      const item = state.items.find((candidate) => candidate.kind === 'village' && candidate.name === name)
      if (item === undefined) throw new Error(`missing ${name} village`)
      return item
    })
    await repo.saveGame({
      ...state,
      items: state.items.filter((item) => !resources.some((held) => held.id === item.id)),
      players: state.players.map((holder) => holder.playerId === t.starterId
        ? { ...holder, items: [...holder.items, ...resources.map((item) => ({ ...item, ownerId: t.starterId, hidden: true }))] }
        : holder),
    })
    await doneThrough(t, 'TRADE')
    const before = await view(t.gameId, t.starter)
    const paid = await post(t.starter, actions(t.gameId), {
      action: 'pottery', requestId: 'native-villages', rev: before.rev,
      args: {
        resources: ['Iron', 'Uranium'],
        ...(explicit ? { payments: resources.map((item, index) => ({ resource: index === 0 ? 'Iron' : 'Uranium', kind: 'village', id: item.id })) } : {}),
      },
    })
    expect(paid.status).toBe(200)
    const after = await paid.json<View>()
    const [iron, uranium] = resources
    if (iron === undefined || uranium === undefined) throw new Error('missing village resources')
    expect(after.assistedActions[0]?.text).toContain(`used Pottery: spent Iron (village) item number #${iron.itemNumber} and Uranium (village) item number #${uranium.itemNumber} and added 1 coin`)
    const stored = await repo.findGame(t.gameId)
    expect(stored?.board.pieces.filter((piece) => piece.assetId === 'resources/village')).toEqual([])
    expect(stored?.board.pieces.filter((piece) => piece.assetId === 'resources/hut')).toHaveLength(1)
    expect(stored?.discardedItems.map((item) => item.id)).toEqual(expect.arrayContaining(resources.map((item) => item.id)))
  })

  it('Pottery pays two named resources, adds the coin and shows it in the public counters', async () => {
    const t = await table('pot', 'Pottery', ['resources/iron', 'resources/wheat'])
    await doneThrough(t, 'TRADE')
    const before = await view(t.gameId, t.starter)
    expect(entryOf(before, 'pottery')).toMatchObject({ status: 'ready' })

    for (const args of [{ resources: ['Iron'] }, { resources: ['Iron', 'Wheat', 'Silk'] }, { resources: 'Iron' }, { resources: ['Iron', 'Wheat'], extra: 1 }, {}]) {
      expect((await post(t.starter, actions(t.gameId), { action: 'pottery', requestId: 'req-bad', rev: before.rev, args })).status).toBe(400)
    }
    const paid = await post(t.starter, actions(t.gameId), { action: 'pottery', requestId: 'req-1', rev: before.rev, args: { resources: ['Iron', 'Wheat'] } })
    expect(paid.status).toBe(200)
    const after = await paid.json<View>()
    expect(after.assistedActions[0]).toMatchObject({ kind: 'pottery', status: 'applied' })
    expect(after.assistedActions[0]?.text).toMatch(/used Pottery: spent Iron and Wheat and added 1 coin/)
    expect(after.you?.stats.coinSources['pottery']).toBe(1)
    expect((await view(t.gameId, t.other)).opponents[0]?.stats.coinSources['pottery']).toBe(1)
    expect(entryOf(after, 'pottery')?.status).toBe('used')
  })

  it('Philosophy takes exactly three names and never shows the drawn card to the other player', async () => {
    const t = await table('phi', 'Philosophy', ['resources/iron', 'resources/wheat', 'resources/silk'])
    await doneThrough(t, 'TRADE')
    const before = await view(t.gameId, t.starter)
    for (const args of [{ resources: ['Iron', 'Wheat'] }, { resources: ['Iron', 'Wheat', 'Silk', 'Spy'] }, { resources: ['Iron', 'Wheat', 'Silk'], extra: 1 }]) {
      expect((await post(t.starter, actions(t.gameId), { action: 'philosophy', requestId: 'req-bad', rev: before.rev, args })).status).toBe(400)
    }
    const paid = await post(t.starter, actions(t.gameId), { action: 'philosophy', requestId: 'req-1', rev: before.rev, args: { resources: ['Iron', 'Wheat', 'Silk'] } })
    expect(paid.status).toBe(200)
    const mine = await paid.json<View>()
    const card = mine.you?.items.find((item) => item.kind === 'greatperson')
    if (card?.name === undefined) throw new Error('no great person in the hand')
    // The owner has it; the line says only that a great person was taken
    expect(mine.assistedActions[0]?.text).toMatch(/took a .* great person marker into reserve \(item number #\d+\)/)
    expect(mine.assistedActions[0]?.text).not.toContain(card.name)

    // Not the whole view: `you.availableActions` lists every great person as a not-owned row for everybody, so the
    // name can be there whatever was drawn. Every field that could carry the held card is scanned instead
    const other = await view(t.gameId, t.other) as View & { log: unknown; opponents: unknown; battle: unknown; lastBattle: unknown; drawTokens: unknown }
    const { availableActions: _buttons, playableCards: _playable, ...theirYou } = other.you as NonNullable<View['you']> & { playableCards?: unknown }
    const theirs = JSON.stringify({ you: theirYou, log: other.log, opponents: other.opponents, assistedActions: other.assistedActions, battle: other.battle, drawTokens: other.drawTokens })
    expect(theirs).not.toContain(card.name)
    expect(theirs).not.toContain(card.id)
    expect(theirs).not.toContain('"effect"')
    // Nor does the stored private line leave through the public list
    expect(JSON.stringify((await view(t.gameId, t.other)).assistedActions)).not.toContain(card.name)
  })

  it('Education takes no args at all and pays Incense, Iron, Silk and Wheat', async () => {
    const t = await table('edu', 'Education', ['resources/iron', 'resources/wheat', 'resources/silk', 'resources/incense'])
    await doneThrough(t, 'TRADE')
    const before = await view(t.gameId, t.starter)
    expect(entryOf(before, 'education')).toMatchObject({ status: 'ready' })
    // The route reads no names: only optional explicit payments are accepted.
    for (const args of [{ resources: ['Iron', 'Wheat', 'Silk', 'Incense'] }, { extra: 1 }]) {
      const bad = await post(t.starter, actions(t.gameId), { action: 'education', requestId: 'req-bad', rev: before.rev, args })
      expect(bad.status).toBe(400)
    }
    expect((await repo.findGame(t.gameId))?.assistedActions).toHaveLength(0)

    const paid = await post(t.starter, actions(t.gameId), { action: 'education', requestId: 'req-1', rev: before.rev })
    expect(paid.status).toBe(200)
    expect((await paid.json<View>()).assistedActions[0]?.text).toMatch(/used Education: spent Incense, Iron, Silk and Wheat, and may learn a new tech/)
    const state = await repo.findGame(t.gameId)
    expect(state?.players.find((p) => p.playerId === t.starterId)?.techGrants).toMatchObject([{ source: 'Education', phase: 'CM' }])
    expect(state?.board.pieces.some((piece) => piece.assetId.startsWith('resources/'))).toBe(false)
  })

  describe('explicit resource payments through strict args', () => {
    it('a fixed-only ability accepts args.payments and spends the exact gift while keeping its Wheat token', async () => {
      const t = await table('explicit-fixed', 'Ecology', ['resources/wheat'])
      const giftId = await giveGift(t.gameId, t.starterId)
      const before = await view(t.gameId, t.starter)
      const payment = entryOf(before, 'sot:ecology')?.payment
      expect(payment).toMatchObject({
        cost: ['Wheat'],
        options: expect.arrayContaining([{ choice: { resource: 'Wheat', kind: 'card', id: giftId }, label: 'A Generous Gift (as Wheat)' }]),
      })
      expect(JSON.stringify(await view(t.gameId, t.other))).not.toContain(giftId)
      const paid = await post(t.starter, actions(t.gameId), {
        action: 'sot:ecology', requestId: 'explicit-fixed', rev: before.rev,
        args: { payments: [{ resource: 'Wheat', kind: 'card', id: giftId }] },
      })
      expect(paid.status).toBe(200)
      const after = await repo.findGame(t.gameId)
      expect(after?.discardedItems.some((item) => item.id === giftId)).toBe(true)
      expect(after?.board.pieces.some((piece) => piece.assetId === 'resources/wheat')).toBe(true)
      expect(after?.assistedActions[0]?.effect).toMatchObject({ spent: { kind: 'card', resource: 'Wheat', itemId: giftId } })
      expect((await paid.json<View>()).assistedActions[0]?.text).toMatch(/played A Generous Gift item number #\d+ as Wheat/)
      const theirs = await view(t.gameId, t.other)
      expect(JSON.stringify(theirs.assistedActions)).not.toContain(giftId)
      expect(JSON.stringify(theirs.assistedActions)).not.toContain('"payments"')
    })

    it('centrally rejects malformed, excessive, duplicate, unsupported and wrong-slot payments without persisting changes', async () => {
      const t = await table('explicit-bad', 'Pottery', ['resources/iron', 'resources/wheat'])
      await doneThrough(t, 'TRADE')
      const before = await view(t.gameId, t.starter)
      const options = entryOf(before, 'pottery')?.payment?.options ?? []
      const iron = options.find((option) => option.choice.resource === 'Iron')?.choice
      const wheat = options.find((option) => option.choice.resource === 'Wheat')?.choice
      if (iron === undefined || wheat === undefined) throw new Error('no piece choices')
      const stored = await repo.findGame(t.gameId)
      for (const payments of [
        null, 'Iron', {}, [], [iron], [iron, wheat, wheat], [iron, iron],
        [iron, { ...wheat, kind: 'token' }],
        [iron, { ...wheat, resource: 'Banana' }],
        [iron, { ...wheat, resource: 7 }],
        [iron, { ...wheat, id: 'bad id!' }],
        [iron, { ...wheat, id: 'a'.repeat(65) }],
        [iron, { ...wheat, extra: true }],
        [iron, null],
        [iron, { resource: 'Wheat', kind: 'piece' }],
      ]) {
        const bad = await post(t.starter, actions(t.gameId), {
          action: 'pottery', requestId: 'malformed', rev: before.rev,
          args: { resources: ['Iron', 'Wheat'], payments },
        })
        expect(bad.status, JSON.stringify(payments)).toBe(400)
        expect(await bad.json()).toMatchObject({ error: 'BAD_REQUEST' })
        expect(await repo.findGame(t.gameId)).toEqual(stored)
      }
      for (const action of ['bureaucracy', 'cultureAdvance', 'playCard']) {
        const bad = await post(t.starter, actions(t.gameId), {
          action, requestId: 'unsupported', rev: before.rev, args: { payments: [] },
        })
        expect(bad.status).toBe(400)
      }
      const wrongSlot = await post(t.starter, actions(t.gameId), {
        action: 'currency', requestId: 'wrong-slot', rev: before.rev, args: { payments: [iron] },
      })
      expect(wrongSlot.status).toBe(400)
      expect(await wrongSlot.json()).toMatchObject({ error: 'BAD_REQUEST' })
      // The action-specific parser remains strict after centrally extracting valid payments.
      for (const args of [
        { resources: ['Iron'], payments: [iron, wheat] },
        { resources: ['Iron', 'Wheat'], payments: [iron, wheat], extra: 1 },
      ]) {
        expect((await post(t.starter, actions(t.gameId), { action: 'pottery', requestId: 'specific', rev: before.rev, args })).status).toBe(400)
      }
      expect(await repo.findGame(t.gameId)).toEqual(stored)
    })

    it('Any payments reject foreign, stale, used and pending choices atomically, then honor a chosen card over held tokens', async () => {
      const t = await table('explicit-any', 'Pottery', ['resources/iron', 'resources/wheat'])
      const giftId = await giveGift(t.gameId, t.starterId)
      const foreignId = await giveGift(t.gameId, t.otherId)
      await doneThrough(t, 'TRADE')
      const before = await view(t.gameId, t.starter)
      const options = entryOf(before, 'pottery')?.payment?.options ?? []
      const iron = options.find((option) => option.choice.kind === 'piece' && option.choice.resource === 'Iron')?.choice
      const wheat = options.find((option) => option.choice.kind === 'piece' && option.choice.resource === 'Wheat')?.choice
      if (iron === undefined || wheat === undefined) throw new Error('no piece choices')
      const stored = await repo.findGame(t.gameId)
      if (stored === undefined) throw new Error('no stored game')
      const gift = { resource: 'Silk', kind: 'card', id: giftId }
      const attempt = (payments: readonly unknown[]) => post(t.starter, actions(t.gameId), {
        action: 'pottery', requestId: 'explicit-any', rev: before.rev,
        args: { resources: ['Iron', 'Wheat'], payments },
      })
      for (const unavailable of [{ ...gift, id: foreignId }, { ...wheat, id: 'stale-piece' }, { ...gift, resource: 'Incense' }]) {
        const bad = await attempt([iron, unavailable])
        expect(bad.status).toBe(400)
        expect(await bad.json()).toMatchObject({ error: 'ASSISTED_ACTION_REJECTED' })
        expect(await repo.findGame(t.gameId)).toEqual(stored)
      }
      for (const mode of ['used', 'pending', 'wrong-owner'] as const) {
        const changed = {
          ...stored,
          players: stored.players.map((player) => player.playerId !== t.starterId ? player : {
            ...player,
            items: player.items.map((item) => item.id !== giftId ? item : {
              ...item, used: mode === 'used', ownerId: mode === 'wrong-owner' ? t.otherId : t.starterId,
            }),
            pendingRewards: mode === 'pending'
              ? [{ id: 'pending', kind: 'event' as const, level: 2 as const, step: 8, candidateIds: [giftId], keep: 1 as const }]
              : [],
          }),
        }
        await repo.saveGame(changed)
        expect(entryOf(await view(t.gameId, t.starter), 'pottery')?.payment?.options.some((option) => option.choice.id === giftId)).toBe(false)
        const bad = await attempt([iron, gift])
        expect(bad.status).toBe(400)
        expect(await repo.findGame(t.gameId)).toEqual(changed)
      }
      await repo.saveGame(stored)
      const paid = await attempt([iron, gift])
      expect(paid.status).toBe(200)
      const after = await repo.findGame(t.gameId)
      expect(after?.discardedItems.some((item) => item.id === giftId)).toBe(true)
      expect(after?.board.pieces.some((piece) => piece.id === wheat.id)).toBe(true)
      expect(after?.assistedActions[0]?.effect).toMatchObject({
        spent: [{ kind: 'piece', resource: 'Iron', piece: { id: iron.id } }, { kind: 'card', resource: 'Silk', itemId: giftId }],
      })
    })

    it('Education supports explicit each-resource payments', async () => {
      const t = await table('explicit-each', 'Education', ['resources/incense', 'resources/iron', 'resources/silk', 'resources/wheat'])
      const giftId = await giveGift(t.gameId, t.starterId)
      await doneThrough(t, 'TRADE')
      const before = await view(t.gameId, t.starter)
      const payment = entryOf(before, 'education')?.payment
      if (payment === undefined) throw new Error('no Education choices')
      const payments = payment.cost.map((resource) => {
        const option = payment.options.find((option) => option.choice.resource === resource &&
          (resource === 'Iron' ? option.choice.id === giftId : option.choice.kind === 'piece'))
        if (option === undefined) throw new Error(`no ${resource} payment`)
        return option.choice
      })
      const bad = await post(t.starter, actions(t.gameId), {
        action: 'education', requestId: 'duplicate-card', rev: before.rev,
        args: { payments: payments.map((payment) => payment.resource === 'Wheat' ? { ...payment, kind: 'card', id: giftId } : payment) },
      })
      expect(bad.status).toBe(400)
      expect(await bad.json()).toMatchObject({ error: 'BAD_REQUEST' })
      const paid = await post(t.starter, actions(t.gameId), {
        action: 'education', requestId: 'explicit-each', rev: before.rev, args: { payments },
      })
      expect(paid.status).toBe(200)
      expect((await repo.findGame(t.gameId))?.board.pieces.some((piece) => piece.assetId === 'resources/iron')).toBe(true)
      expect((await repo.findGame(t.gameId))?.discardedItems.some((item) => item.id === giftId)).toBe(true)

    })

    it('an empty args object still performs automatic payment', async () => {
      const legacy = await table('empty-each', 'Education', ['resources/incense', 'resources/iron', 'resources/silk', 'resources/wheat'])
      await doneThrough(legacy, 'TRADE')
      const empty = await post(legacy.starter, actions(legacy.gameId), {
        action: 'education', requestId: 'empty-args', rev: (await view(legacy.gameId, legacy.starter)).rev, args: {},
      })
      expect(empty.status).toBe(200)
      expect((await repo.findGame(legacy.gameId))?.board.pieces.some((piece) => piece.category === 'resource')).toBe(false)
    })
  })

  it('Education without an Incense token is refused whatever else is held, and pays nothing', async () => {
    const t = await table('edu2', 'Education', ['resources/iron', 'resources/wheat', 'resources/silk'])
    await doneThrough(t, 'TRADE')
    const before = await view(t.gameId, t.starter)
    expect(entryOf(before, 'education')).toMatchObject({ status: 'needs-resource' })
    const refused = await post(t.starter, actions(t.gameId), { action: 'education', requestId: 'req-1', rev: before.rev })
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({ error: 'ASSISTED_ACTION_REJECTED' })
    expect((await repo.findGame(t.gameId))?.board.pieces.filter((piece) => piece.assetId.startsWith('resources/'))).toHaveLength(3)
  })
})

describe('a production boost through args', () => {
  it('names one of the player\'s cities, and refuses a shape that is not a city id', async () => {
    const t = await table('boost', 'Animal Husbandry', ['resources/wheat'])
    await doneThrough(t, 'TRADE')
    const before = await view(t.gameId, t.starter)
    expect(entryOf(before, 'animalHusbandry')).toMatchObject({ status: 'ready' })
    for (const args of [{}, { cityPieceId: 7 }, { cityPieceId: 'bad id!' }, { cityPieceId: 'a1', extra: true }, { city: 'a1' }]) {
      expect((await post(t.starter, actions(t.gameId), { action: 'animalHusbandry', requestId: 'req-bad', rev: before.rev, args })).status).toBe(400)
    }
    // A well-formed id of a piece that is not the player's city is the engine's refusal; the Wheat stays
    const missing = await post(t.starter, actions(t.gameId), { action: 'animalHusbandry', requestId: 'req-1', rev: before.rev, args: { cityPieceId: 'no-such-piece' } })
    expect(missing.status).toBe(400)
    expect(await missing.json()).toMatchObject({ error: 'ASSISTED_ACTION_REJECTED' })
    const state = await repo.findGame(t.gameId)
    expect(state?.assistedActions).toHaveLength(0)
    expect(state?.board.pieces.some((piece) => piece.assetId === 'resources/wheat')).toBe(true)
  })

  it('boosts a city on the map and shows the bonus in its public production figures', async () => {
    const t = await table('boost2', 'Construction', ['resources/wheat'])
    const city = await post(t.starter, `/api/games/${t.gameId}/board/pieces`, {
      assetId: `cities/${t.color.toLowerCase()}city2`,
      x: 6 * SQUARE_SIZE,
      y: mapTop((await view(t.gameId, t.starter) as unknown as { board: Parameters<typeof mapTop>[0] }).board) + 6 * SQUARE_SIZE,
    })
    expect(city.status).toBe(200)
    await doneThrough(t, 'TRADE')
    const before = await view(t.gameId, t.starter) as View & { you: { cities: { pieceId: string; boost: number }[] } }
    const cityId = before.you.cities[0]?.pieceId
    if (cityId === undefined) throw new Error('no city in the view')
    const paid = await post(t.starter, actions(t.gameId), { action: 'construction', requestId: 'req-1', rev: before.rev, args: { cityPieceId: cityId } })
    expect(paid.status).toBe(200)
    const after = await paid.json<View & { you: { cities: { boost: number; estimate: number }[] } }>()
    expect(after.you.cities[0]?.boost).toBe(5)
    expect(after.assistedActions[0]?.text).toMatch(/used Construction: spent 1 Wheat, so .* produces 5 extra production this turn/)
    // The figure is public, like every city's production
    const theirs = await view(t.gameId, t.other) as unknown as { opponents: { cities: { boost: number }[] }[] }
    expect(theirs.opponents[0]?.cities[0]?.boost).toBe(5)
  })
})

describe('Horseback Riding through args', () => {
  it('names another player in the Trade phase and moves both trade counters', async () => {
    const t = await table('hr', 'Horseback Riding', ['resources/silk'])
    await doneThrough(t, 'SOT')
    const before = await view(t.gameId, t.starter)
    expect(entryOf(before, 'horsebackRiding')).toMatchObject({ status: 'ready' })
    for (const args of [{}, { targetId: 7 }, { targetId: 'bad id!' }, { targetId: 'x', note: 'no note here' }]) {
      expect((await post(t.starter, actions(t.gameId), { action: 'horsebackRiding', requestId: 'req-bad', rev: before.rev, args })).status).toBe(400)
    }
    // Naming yourself is the engine's refusal and spends nothing
    const self = await post(t.starter, actions(t.gameId), { action: 'horsebackRiding', requestId: 'req-self', rev: before.rev, args: { targetId: t.starterId } })
    expect(self.status).toBe(400)
    expect(await self.json()).toMatchObject({ error: 'ASSISTED_ACTION_REJECTED' })
    // Nothing was persisted: no record, the Silk is still on the board and the trade is where it was
    const stored = await repo.findGame(t.gameId)
    expect(stored?.assistedActions).toHaveLength(0)
    expect(stored?.board.pieces.some((piece) => piece.assetId === 'resources/silk')).toBe(true)
    expect(stored?.players.find((player) => player.playerId === t.starterId)?.stats.trade).toBe(before.you?.stats.trade)

    const paid = await post(t.starter, actions(t.gameId), { action: 'horsebackRiding', requestId: 'req-1', rev: before.rev, args: { targetId: t.otherId } })
    expect(paid.status).toBe(200)
    const after = await paid.json<View>()
    expect(after.you?.stats.trade).toBe((before.you?.stats.trade ?? 0) + 9)
    expect((await view(t.gameId, t.other)).you?.stats.trade).toBe(6)
    expect(after.assistedActions[0]?.text).toMatch(/used Horseback Riding: spent 1 Silk, gaining 9 \(\d+\) trade, and .* gained 6 \(6\) trade/)
  })
})

describe('the Spy abilities through args', () => {
  it('Mysticism names an opponent and a coin counter, and refuses an opponent with no coin there', async () => {
    const t = await table('mys', 'Mysticism', [])
    await giveHut(t.gameId, t.starterId, 'Spy')
    await doneThrough(t, 'TRADE')
    const before = await view(t.gameId, t.starter)
    for (const args of [{}, { targetId: t.otherId }, { source: 'sheet' }, { targetId: t.otherId, source: 'sheet', extra: 1 }, { targetId: t.otherId, source: '' }]) {
      expect((await post(t.starter, actions(t.gameId), { action: 'mysticism', requestId: 'req-bad', rev: before.rev, args })).status).toBe(400)
    }
    const none = await post(t.starter, actions(t.gameId), { action: 'mysticism', requestId: 'req-1', rev: before.rev, args: { targetId: t.otherId, source: 'sheet' } })
    expect(none.status).toBe(400)
    expect(await none.json()).toMatchObject({ error: 'ASSISTED_ACTION_REJECTED' })
    expect((await repo.findGame(t.gameId))?.assistedActions).toHaveLength(0)

    // Give the other player a coin by hand: the same request is accepted and takes it
    const stored = await repo.findGame(t.gameId)
    if (stored === undefined) throw new Error('game missing')
    await repo.saveGame({
      ...stored,
      players: stored.players.map((player) =>
        player.playerId === t.otherId ? { ...player, stats: { ...player.stats, coinSources: { ...player.stats.coinSources, sheet: 2 } } } : player,
      ),
    })
    const fresh = await view(t.gameId, t.starter)
    const paid = await post(t.starter, actions(t.gameId), { action: 'mysticism', requestId: 'req-2', rev: fresh.rev, args: { targetId: t.otherId, source: 'sheet' } })
    expect(paid.status).toBe(200)
    expect((await view(t.gameId, t.other)).you?.stats.coinSources['sheet']).toBe(1)
  })

  it('Writing, Civil Service and Mass Media take a player and an optional short note', async () => {
    const t = await table('wr', 'Civil Service', [])
    const spyNumber = await giveHut(t.gameId, t.starterId, 'Spy')
    const before = await view(t.gameId, t.starter)
    expect(entryOf(before, 'civilService')).toMatchObject({ status: 'ready' })
    for (const args of [{}, { targetId: 7 }, { targetId: t.otherId, note: 7 }, { targetId: t.otherId, note: 'x'.repeat(81) }, { targetId: t.otherId, extra: 1 }]) {
      expect((await post(t.starter, actions(t.gameId), { action: 'civilService', requestId: 'req-bad', rev: before.rev, args })).status).toBe(400)
    }
    const paid = await post(t.starter, actions(t.gameId), { action: 'civilService', requestId: 'req-1', rev: before.rev, args: { targetId: t.otherId, note: 'Sinbad' } })
    expect(paid.status).toBe(200)
    expect((await paid.json<View>()).assistedActions[0]?.text).toMatch(new RegExp(`used Civil Service: spent 1 Spy \\(hut\\) item number #${spyNumber}, cancelling a culture event of .* \\(Sinbad\\)`))
  })

  it('a note with line breaks and control characters is flattened to one line in the public log', async () => {
    const t = await table('note', 'Writing', [])
    await giveHut(t.gameId, t.starterId, 'Spy')
    const before = await view(t.gameId, t.starter)
    const paid = await post(t.starter, actions(t.gameId), { action: 'writing', requestId: 'req-1', rev: before.rev, args: { targetId: t.otherId, note: 'Build\nin\r\n  Capital\u0000!' } })
    expect(paid.status).toBe(200)
    const text = (await paid.json<View>()).assistedActions[0]?.text ?? ''
    expect(text).toContain('(Build in Capital !)')
    expect(text).not.toMatch(/[\u0000-\u001f]/)
  })

  it('Monarchy: obsolete takes a wonder, kill takes a target and is refused when the opponent has no unit card', async () => {
    const t = await table('mon', 'Monarchy', ['resources/silk', 'resources/silk'])
    await doneThrough(t, 'TRADE')
    const before = await view(t.gameId, t.starter)
    for (const args of [{}, { mode: 'raze' }, { mode: 'kill' }, { mode: 'obsolete' }, { mode: 'obsolete', targetId: t.otherId }, { mode: 'obsolete', wonderPieceId: 7 }, { mode: 'obsolete', wonderPieceId: 'a b' }, { mode: 'kill', targetId: t.otherId, wonderPieceId: 'w1' }, { mode: 'kill', targetId: t.otherId, extra: 1 }]) {
      expect((await post(t.starter, actions(t.gameId), { action: 'monarchy', requestId: 'req-bad', rev: before.rev, args })).status).toBe(400)
    }
    const none = await post(t.starter, actions(t.gameId), { action: 'monarchy', requestId: 'req-1', rev: before.rev, args: { mode: 'kill', targetId: t.otherId } })
    expect(none.status).toBe(400)
    expect(await none.json()).toMatchObject({ error: 'ASSISTED_ACTION_REJECTED' })
    const state = await repo.findGame(t.gameId)
    expect(state?.assistedActions).toHaveLength(0)
    expect(state?.board.pieces.filter((piece) => piece.assetId === 'resources/silk')).toHaveLength(2)

    // With a unit in the opponent's hand the kill goes through and names the discard in the public line only
    expect((await post(t.other, `/api/games/${t.gameId}/draw/INFANTRY`, { confirmedOutOfTurn: true })).status).toBe(200)
    const fresh = await view(t.gameId, t.starter)
    const paid = await post(t.starter, actions(t.gameId), { action: 'monarchy', requestId: 'req-2', rev: fresh.rev, args: { mode: 'kill', targetId: t.otherId } })
    expect(paid.status).toBe(200)
    expect((await paid.json<View>()).assistedActions[0]?.text).toMatch(/used Monarchy: spent 1 Silk, killing \w+ \d\.\d item number #\d+ from .*'s hand/)
  })
})

describe('Monarchy obsolete through the routes', () => {
  it('disables an owned ancient wonder, shows it on the public board, refuses a modern one and an unowned one with nothing spent', async () => {
    const t = await table('obs', 'Monarchy', ['resources/silk'])
    await doneThrough(t, 'TRADE')
    const placed: string[] = []
    for (const [index, assetId] of ['wonders/pyramids', 'wonders/bigben', 'wonders/stonehenge'].entries()) {
      const response = await post(t.starter, `/api/games/${t.gameId}/board/pieces`, { assetId, x: 40, y: 700 + index * 90 })
      expect(response.status).toBe(200)
      placed.push(((await response.json()) as { board: { pieces: { id: string; assetId: string }[] } }).board.pieces.find((piece) => piece.assetId === assetId)?.id ?? '')
    }
    const [pyramids, bigBen, stonehenge] = placed
    if (pyramids === undefined || bigBen === undefined || stonehenge === undefined) throw new Error('wonders not placed')
    // The Pyramids and Big Ben belong to the other player; Stonehenge stays in the market
    const stored = await repo.findGame(t.gameId)
    if (stored === undefined) throw new Error('game missing')
    await repo.saveGame({
      ...stored,
      board: { ...stored.board, pieces: stored.board.pieces.map((piece) => ([pyramids, bigBen].includes(piece.id) ? { ...piece, ownerId: t.otherId } : piece)) },
    })
    const before = await view(t.gameId, t.starter)
    for (const wonderPieceId of [bigBen, stonehenge, 'no-such-piece']) {
      const refused = await post(t.starter, actions(t.gameId), { action: 'monarchy', requestId: 'req-n', rev: before.rev, args: { mode: 'obsolete', wonderPieceId } })
      expect(refused.status).toBe(400)
      expect(await refused.json()).toMatchObject({ error: 'ASSISTED_ACTION_REJECTED' })
    }
    expect((await repo.findGame(t.gameId))?.assistedActions).toHaveLength(0)
    expect((await repo.findGame(t.gameId))?.board.pieces.some((piece) => piece.assetId === 'resources/silk')).toBe(true)

    const paid = await post(t.starter, actions(t.gameId), { action: 'monarchy', requestId: 'req-1', rev: before.rev, args: { mode: 'obsolete', wonderPieceId: pyramids } })
    expect(paid.status).toBe(200)
    const after = await paid.json<View & { board: { pieces: { id: string; ownerId?: string | null; disabled?: boolean }[] } }>()
    expect(after.assistedActions[0]?.text).toMatch(/used Monarchy: spent 1 Silk, obsoleting The Pyramids of .*: the wonder is disabled/)
    expect(after.board.pieces.find((piece) => piece.id === pyramids)).toMatchObject({ ownerId: null, disabled: true })
    // The other player sees the same public board, and no effect
    const theirs = await view(t.gameId, t.other)
    expect(JSON.stringify(theirs)).not.toContain('"effect"')
    expect((theirs as unknown as { board: { pieces: { id: string; disabled?: boolean }[] } }).board.pieces.find((piece) => piece.id === pyramids)?.disabled).toBe(true)
  })
})

describe('batch 2 through the routes: Metalworking, Atomic Theory and Bureaucracy', () => {
  it('Bureaucracy is one press in Research with no args, and takes nothing from the player', async () => {
    const t = await table('bur', 'Bureaucracy', [])
    await doneThrough(t, 'MOVEMENT')
    const before = await view(t.gameId, t.starter)
    expect(entryOf(before, 'bureaucracy')).toMatchObject({ status: 'ready' })
    const stray = await post(t.starter, actions(t.gameId), { action: 'bureaucracy', requestId: 'req-bad', rev: before.rev, args: { x: 1 } })
    expect(stray.status).toBe(400)
    const paid = await post(t.starter, actions(t.gameId), { action: 'bureaucracy', requestId: 'req-1', rev: before.rev })
    expect(paid.status).toBe(200)
    const after = await paid.json<View>()
    expect(after.assistedActions[0]).toMatchObject({ kind: 'bureaucracy', status: 'applied' })
    expect(after.assistedActions[0]?.text).toMatch(/used Bureaucracy: may switch one of their social policies during research/)
    expect(entryOf(after, 'bureaucracy')?.status).toBe('used')
  })

  it('Atomic Theory takes a strict mode and, for a nuke, a city; a nuke in City Management is the engine\'s refusal', async () => {
    const t = await table('atom', 'Atomic Theory', [])
    const uraniumNumber = await giveHut(t.gameId, t.starterId, 'Uranium')
    const city = await post(t.starter, `/api/games/${t.gameId}/board/pieces`, {
      assetId: `cities/${t.color.toLowerCase()}city2`,
      x: 6 * SQUARE_SIZE,
      y: mapTop((await view(t.gameId, t.starter) as unknown as { board: Parameters<typeof mapTop>[0] }).board) + 6 * SQUARE_SIZE,
    })
    expect(city.status).toBe(200)
    await doneThrough(t, 'TRADE')
    const before = await view(t.gameId, t.starter)
    expect(entryOf(before, 'atomicTheory')).toMatchObject({ status: 'ready' })
    for (const args of [{}, { mode: 'raze' }, { mode: 'nuke' }, { mode: 'nuke', cityPieceId: 7 }, { mode: 'extraActions', cityPieceId: 'a1' }, { mode: 'extraActions', extra: 1 }]) {
      expect((await post(t.starter, actions(t.gameId), { action: 'atomicTheory', requestId: 'req-bad', rev: before.rev, args })).status).toBe(400)
    }
    const early = await post(t.starter, actions(t.gameId), { action: 'atomicTheory', requestId: 'req-n', rev: before.rev, args: { mode: 'nuke', cityPieceId: 'no-such-piece' } })
    expect(early.status).toBe(400)
    expect(await early.json()).toMatchObject({ error: 'ASSISTED_ACTION_REJECTED' })
    expect((await repo.findGame(t.gameId))?.assistedActions).toHaveLength(0)

    const paid = await post(t.starter, actions(t.gameId), { action: 'atomicTheory', requestId: 'req-1', rev: before.rev, args: { mode: 'extraActions' } })
    expect(paid.status).toBe(200)
    expect((await paid.json<View>()).assistedActions[0]?.text).toMatch(new RegExp(`^ta-[ab]-atom used Atomic Theory: spent 1 Uranium \\(hut\\) item number #${uraniumNumber}, so each of their cities may take one more city action this turn$`))
  })

  it('Metalworking adds 3 to one of the player\'s own arena units and refuses an enemy unit', async () => {
    const t = await table('met', 'Metalworking', ['resources/iron'])
    for (const [token, confirm] of [[t.starter, {}], [t.other, { confirmedOutOfTurn: true }]] as const) {
      expect((await post(token, `/api/games/${t.gameId}/draw/INFANTRY`, confirm)).status).toBe(200)
      expect((await post(token, `/api/games/${t.gameId}/battle/draw`, { numberOfUnits: 1 })).status).toBe(200)
    }
    expect((await post(t.starter, `/api/games/${t.gameId}/battle/arena/initiate`, { opponentId: t.otherId })).status).toBe(200)
    for (const [token, side, position] of [[t.starter, 'attacker', 0], [t.other, 'defender', 1]] as const) {
      const mine = await inject(app, { url: `/api/games/${t.gameId}`, headers: bearer(token) })
      const unit = (await mine.json<{ you: { battlehand: { id: string; attack: number; health: number }[] } }>()).you.battlehand[0]
      if (unit === undefined) throw new Error('no battlehand unit')
      expect((await post(token, `/api/games/${t.gameId}/battle/arena/place`, { unitId: unit.id, side, position, attack: unit.attack, health: unit.health })).status).toBe(200)
    }
    const before = await view(t.gameId, t.starter) as View & { battle: { arena: { id: string; side: string; attack: number }[] } }
    const own = before.battle.arena.find((unit) => unit.side === 'attacker')
    const enemy = before.battle.arena.find((unit) => unit.side === 'defender')
    if (own === undefined || enemy === undefined) throw new Error('missing arena units')
    expect(entryOf(before, 'metalworking')).toMatchObject({ status: 'ready' })

    for (const args of [{}, { arenaUnitId: 7 }, { arenaUnitId: 'bad id!' }, { arenaUnitId: own.id, extra: 1 }]) {
      expect((await post(t.starter, actions(t.gameId), { action: 'metalworking', requestId: 'req-bad', rev: before.rev, args })).status).toBe(400)
    }
    const theirs = await post(t.starter, actions(t.gameId), { action: 'metalworking', requestId: 'req-e', rev: before.rev, args: { arenaUnitId: enemy.id } })
    expect(theirs.status).toBe(400)
    expect(await theirs.json()).toMatchObject({ error: 'ASSISTED_ACTION_REJECTED' })
    expect((await repo.findGame(t.gameId))?.board.pieces.some((piece) => piece.assetId === 'resources/iron')).toBe(true)

    const paid = await post(t.starter, actions(t.gameId), { action: 'metalworking', requestId: 'req-1', rev: before.rev, args: { arenaUnitId: own.id } })
    expect(paid.status).toBe(200)
    const after = await paid.json<View & { battle: { arena: { id: string; attack: number }[] } }>()
    expect(after.battle.arena.find((unit) => unit.id === own.id)?.attack).toBe(own.attack + 3)
    expect(after.assistedActions[0]?.text).toMatch(/used Metalworking: spent 1 Iron, adding 3 to the attack of a unit it placed/)
    // The unit is not announced yet, so the other player's view does not name it in any line
    const log = JSON.stringify((await view(t.gameId, t.other) as unknown as { log: unknown }).log)
    expect(log).not.toMatch(/Metalworking: Infantry/)
  })
})
