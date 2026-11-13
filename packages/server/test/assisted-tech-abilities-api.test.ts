/**
 * The resource abilities of the techs (issue #327, slice 2) through the routes: each takes strict `args`, and
 * Philosophy's drawn card and Monarchy's victim hand stay private. The rules are in
 * `packages/engine/test/assisted-tech-abilities.test.ts`.
 */

import { SQUARE_SIZE, mapTop } from '@civ/engine'
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
    readonly availableActions?: readonly { action: string; status: string; reason: string }[]
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
async function giveHut(gameId: string, playerId: string, name: string): Promise<void> {
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
}

const actions = (gameId: string) => `/api/games/${gameId}/actions`
const entryOf = (v: View, action: string) => v.you?.availableActions?.find((entry) => entry.action === action)
const doneThrough = async (t: { gameId: string; starter: string }, phase: 'SOT' | 'TRADE' | 'CM' | 'MOVEMENT') =>
  expect((await post(t.starter, `/api/games/${t.gameId}/turns/done`, { phase })).status).toBe(200)

describe('resources through args: Pottery, Philosophy and Education', () => {
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

  it('Education takes exactly four names', async () => {
    const t = await table('edu', 'Education', ['resources/iron', 'resources/wheat', 'resources/silk', 'resources/incense'])
    await doneThrough(t, 'TRADE')
    const before = await view(t.gameId, t.starter)
    expect(entryOf(before, 'education')).toMatchObject({ status: 'ready' })
    for (const args of [{ resources: ['Iron', 'Wheat', 'Silk'] }, { resources: ['Iron', 'Wheat', 'Silk', 'Incense', 'Spy'] }]) {
      expect((await post(t.starter, actions(t.gameId), { action: 'education', requestId: 'req-bad', rev: before.rev, args })).status).toBe(400)
    }
    // Four names that repeat a kind are the engine's refusal, and nothing is paid
    const repeated = await post(t.starter, actions(t.gameId), { action: 'education', requestId: 'req-dup', rev: before.rev, args: { resources: ['Iron', 'Iron', 'Wheat', 'Silk'] } })
    expect(repeated.status).toBe(400)
    expect(await repeated.json()).toMatchObject({ error: 'ASSISTED_ACTION_REJECTED' })
    expect((await repo.findGame(t.gameId))?.assistedActions).toHaveLength(0)

    const paid = await post(t.starter, actions(t.gameId), { action: 'education', requestId: 'req-1', rev: before.rev, args: { resources: ['Iron', 'Wheat', 'Silk', 'Incense'] } })
    expect(paid.status).toBe(200)
    expect((await paid.json<View>()).assistedActions[0]?.text).toMatch(/used Education: spent Iron, Wheat, Silk and Incense, and may learn a new tech/)
    const state = await repo.findGame(t.gameId)
    expect(state?.players.find((p) => p.playerId === t.starterId)?.techGrants).toMatchObject([{ source: 'Education', phase: 'CM' }])
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
    await giveHut(t.gameId, t.starterId, 'Spy')
    const before = await view(t.gameId, t.starter)
    expect(entryOf(before, 'civilService')).toMatchObject({ status: 'ready' })
    for (const args of [{}, { targetId: 7 }, { targetId: t.otherId, note: 7 }, { targetId: t.otherId, note: 'x'.repeat(81) }, { targetId: t.otherId, extra: 1 }]) {
      expect((await post(t.starter, actions(t.gameId), { action: 'civilService', requestId: 'req-bad', rev: before.rev, args })).status).toBe(400)
    }
    const paid = await post(t.starter, actions(t.gameId), { action: 'civilService', requestId: 'req-1', rev: before.rev, args: { targetId: t.otherId, note: 'Sinbad' } })
    expect(paid.status).toBe(200)
    expect((await paid.json<View>()).assistedActions[0]?.text).toMatch(/used Civil Service: spent 1 Spy, cancelling a culture event of .* \(Sinbad\)/)
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

  it('Monarchy: obsolete takes no target, kill takes one and is refused when the opponent has no unit card', async () => {
    const t = await table('mon', 'Monarchy', ['resources/silk', 'resources/silk'])
    await doneThrough(t, 'TRADE')
    const before = await view(t.gameId, t.starter)
    for (const args of [{}, { mode: 'raze' }, { mode: 'kill' }, { mode: 'obsolete', targetId: t.otherId }, { mode: 'kill', targetId: t.otherId, extra: 1 }]) {
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
    await giveHut(t.gameId, t.starterId, 'Uranium')
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
    expect((await paid.json<View>()).assistedActions[0]?.text).toMatch(/^ta-[ab]-atom used Atomic Theory: spent 1 Uranium, so each of their cities may take one more city action this turn$/)
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
