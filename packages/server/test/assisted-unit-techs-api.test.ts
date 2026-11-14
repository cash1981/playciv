/**
 * The unit techs (issue #327) through the routes: Mathematics and Ballistics pay Iron on
 * `POST /actions` and deal their wounds on `POST /battle/arena/tech-wound`; Gunpowder and Combustion take
 * strict `args`. The rules are in `packages/engine/test/assisted-unit-techs.test.ts`.
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
    readonly availableActions?: readonly { action: string; status: string; reason: string }[]
  } | null
  readonly boardAreas: readonly { playerId: string; x: number; y: number }[]
  readonly battle: { arena: readonly { id: string; side: string; health: number; killed: boolean }[]; techWounds?: readonly unknown[] } | null
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

/** A started two-player game; the starter has revealed `tech` and holds two resource pieces in their area. */
async function table(tag: string, tech: string, pieces: readonly string[]) {
  const creator = await register(`ut-a-${tag}`)
  const created = await inject(app, {
    method: 'POST', url: '/api/games', headers: bearer(creator), payload: { name: 'UT', numOfPlayers: 2 },
  })
  const gameId = (await created.json() as { id: string }).id
  const joiner = await register(`ut-b-${tag}`)
  await post(joiner, `/api/games/${gameId}/join`, {})
  const state = await repo.findGame(gameId)
  const starter = state?.players.find((player) => player.yourTurn)?.username === `ut-a-${tag}` ? creator : joiner
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
  return { gameId, starter, other, starterId, otherId }
}

const actions = (gameId: string) => `/api/games/${gameId}/actions`
const entryOf = (v: View, action: string) => v.you?.availableActions?.find((entry) => entry.action === action)

describe('Mathematics through the routes', () => {
  /** Both players have one infantry in the arena. */
  async function battle() {
    const t = await table('math', 'Mathematics', ['resources/iron'])
    for (const [token, confirm] of [[t.starter, {}], [t.other, { confirmedOutOfTurn: true }]] as const) {
      expect((await post(token, `/api/games/${t.gameId}/draw/INFANTRY`, confirm)).status).toBe(200)
      expect((await post(token, `/api/games/${t.gameId}/battle/draw`, { numberOfUnits: 1 })).status).toBe(200)
    }
    expect((await post(t.starter, `/api/games/${t.gameId}/battle/arena/initiate`, { opponentId: t.otherId })).status).toBe(200)
    const place = async (token: string, side: string, position: number) => {
      const mine = await inject(app, { url: `/api/games/${t.gameId}`, headers: bearer(token) })
      const unit = (await mine.json<{ you: { battlehand: { id: string; attack: number; health: number }[] } }>()).you.battlehand[0]
      if (unit === undefined) throw new Error('no battlehand unit')
      const placed = await post(token, `/api/games/${t.gameId}/battle/arena/place`, {
        unitId: unit.id, side, position, attack: unit.attack, health: unit.health,
      })
      expect(placed.status).toBe(200)
    }
    await place(t.starter, 'attacker', 0)
    await place(t.other, 'defender', 1)
    return t
  }

  it('refuses a wound that was not paid for, pays the Iron, then deals the wound and hides nothing private', async () => {
    const t = await battle()
    const before = await view(t.gameId, t.starter)
    const target = before.battle?.arena.find((unit) => unit.side === 'defender')
    if (target === undefined) throw new Error('no enemy unit')

    const unpaid = await post(t.starter, `/api/games/${t.gameId}/battle/arena/tech-wound`, { tech: 'Mathematics', arenaUnitId: target.id, wounds: 1 })
    expect(unpaid.status).toBe(409)
    expect(JSON.stringify(await unpaid.json())).toContain('Mathematics')
    expect((await post(t.starter, `/api/games/${t.gameId}/battle/arena/tech-wound`, { arenaUnitId: target.id })).status).toBe(400)
    expect((await post(t.starter, `/api/games/${t.gameId}/battle/arena/tech-wound`, { tech: 'Mathematics' })).status).toBe(400)
    // The number of wounds is required
    expect((await post(t.starter, `/api/games/${t.gameId}/battle/arena/tech-wound`, { tech: 'Mathematics', arenaUnitId: target.id })).status).toBe(400)

    expect(entryOf(before, 'mathematics')).toMatchObject({ status: 'ready' })
    const paid = await post(t.starter, actions(t.gameId), { action: 'mathematics', requestId: 'req-1', rev: before.rev })
    expect(paid.status).toBe(200)
    const afterPaying = await paid.json<View>()
    expect(afterPaying.assistedActions[0]).toMatchObject({ id: 'req-1', kind: 'mathematics', status: 'applied' })
    expect(afterPaying.assistedActions[0]?.text).toMatch(/used Mathematics: spent 1 Iron to deal up to 3 wounds/)
    expect(entryOf(afterPaying, 'mathematics')?.status).toBe('used')
    expect(afterPaying.battle?.techWounds).toHaveLength(1)

    // The unit's health is drawn at random: two wounds when it can take them, else its last one
    const dealing = Math.min(2, target.health)
    const hit = await post(t.starter, `/api/games/${t.gameId}/battle/arena/tech-wound`, { tech: 'Mathematics', arenaUnitId: target.id, wounds: dealing, rev: afterPaying.rev })
    expect(hit.status).toBe(200)
    const hitView = await hit.json<View>()
    expect(hitView.battle?.arena.find((unit) => unit.id === target.id)?.health).toBe(target.health - dealing)

    // The opponent never sees an effect, a usage key or the Iron token
    const theirs = JSON.stringify(await view(t.gameId, t.other))
    expect(theirs).not.toContain('"effect"')
    expect(theirs).not.toContain('usageKey')
    expect(theirs).not.toContain('card:Mathematics')
  })

  it('refuses the wound for the opponent, who paid nothing', async () => {
    const t = await battle()
    const mine = await view(t.gameId, t.starter)
    const own = mine.battle?.arena.find((unit) => unit.side === 'attacker')
    if (own === undefined) throw new Error('no own unit')
    const response = await post(t.other, `/api/games/${t.gameId}/battle/arena/tech-wound`, { tech: 'Mathematics', arenaUnitId: own.id, wounds: 1 })
    expect(response.status).toBe(409)
  })
})

/** A Library on a map square, which is what Gunpowder may destroy; the id of the piece. */
async function placeLibrary(t: { gameId: string; starter: string }): Promise<string> {
  const board = (await view(t.gameId, t.starter) as unknown as { board: Parameters<typeof mapTop>[0] }).board
  const placed = await post(t.starter, `/api/games/${t.gameId}/board/pieces`, {
    assetId: 'buildings/library',
    x: 4 * SQUARE_SIZE + 10,
    y: mapTop(board) + 4 * SQUARE_SIZE + 10,
  })
  expect(placed.status).toBe(200)
  const id = ((await placed.json()) as { board: { pieces: { id: string; assetId: string }[] } }).board.pieces.find((piece) => piece.assetId === 'buildings/library')?.id
  if (id === undefined) throw new Error('library not placed')
  return id
}

describe('Gunpowder and Combustion args', () => {
  it('pays two named resources and destroys the chosen building through args, and refuses a malformed payload', async () => {
    const t = await table('gun', 'Gunpowder', ['resources/iron', 'resources/wheat'])
    const library = await placeLibrary(t)
    expect((await post(t.starter, `/api/games/${t.gameId}/turns/done`, { phase: 'TRADE' })).status).toBe(200)
    const before = await view(t.gameId, t.starter)
    expect(entryOf(before, 'gunpowder')).toMatchObject({ status: 'ready' })

    const destroy = { mode: 'destroy', buildingPieceId: library }
    for (const args of [
      { resources: ['Iron'], ...destroy },
      { resources: 'Iron', ...destroy },
      { resources: ['Iron', 'Wheat'], ...destroy, extra: 1 },
      {},
      { resources: ['Iron', 'Wheat'] },
      { resources: ['Iron', 'Wheat'], mode: 'raze' },
      { resources: ['Iron', 'Wheat'], mode: 'destroy' },
      { resources: ['Iron', 'Wheat'], mode: 'destroy', buildingPieceId: 7 },
      { resources: ['Iron', 'Wheat'], mode: 'destroy', buildingPieceId: library, wonderPieceId: 'w1' },
      { resources: ['Iron', 'Wheat'], mode: 'obsolete' },
      { resources: ['Iron', 'Wheat'], mode: 'obsolete', wonderPieceId: 'w1', buildingPieceId: library },
    ]) {
      const bad = await post(t.starter, actions(t.gameId), { action: 'gunpowder', requestId: 'req-bad', rev: before.rev, args })
      expect(bad.status).toBe(400)
    }
    expect((await repo.findGame(t.gameId))?.assistedActions).toHaveLength(0)
    const paid = await post(t.starter, actions(t.gameId), { action: 'gunpowder', requestId: 'req-1', rev: before.rev, args: { resources: ['Iron', 'Silk'], ...destroy } })
    expect(paid.status).toBe(200)
    const after = await paid.json<View>()
    expect(after.assistedActions[0]).toMatchObject({ kind: 'gunpowder', status: 'applied' })
    // The names are a preference: no Silk is held, so the other token (Wheat) pays for it
    expect(after.assistedActions[0]?.text).toMatch(/spent Iron and Wheat, destroying Library on E5 \(in no single player's outskirts\)/)
    expect(entryOf(after, 'gunpowder')?.status).toBe('used')
    const state = await repo.findGame(t.gameId)
    expect(state?.board.pieces.some((piece) => piece.assetId === 'resources/iron' || piece.assetId === 'resources/wheat' || piece.id === library)).toBe(false)
  })

  it('obsolete disables an owned ancient or medieval wonder through the routes, and the other player sees the result and no effect', async () => {
    const t = await table('guno', 'Gunpowder', ['resources/iron', 'resources/wheat'])
    expect((await post(t.starter, `/api/games/${t.gameId}/turns/done`, { phase: 'TRADE' })).status).toBe(200)
    const placed: string[] = []
    for (const [index, assetId] of ['wonders/pyramids', 'wonders/bigben'].entries()) {
      const response = await post(t.starter, `/api/games/${t.gameId}/board/pieces`, { assetId, x: 40, y: 700 + index * 90 })
      expect(response.status).toBe(200)
      placed.push(((await response.json()) as { board: { pieces: { id: string; assetId: string }[] } }).board.pieces.find((piece) => piece.assetId === assetId)?.id ?? '')
    }
    const [pyramids, bigBen] = placed
    if (pyramids === undefined || bigBen === undefined) throw new Error('wonders not placed')
    const stored = await repo.findGame(t.gameId)
    if (stored === undefined) throw new Error('game missing')
    await repo.saveGame({
      ...stored,
      board: { ...stored.board, pieces: stored.board.pieces.map((piece) => ([pyramids, bigBen].includes(piece.id) ? { ...piece, ownerId: t.otherId } : piece)) },
    })
    const before = await view(t.gameId, t.starter)
    // A modern wonder is not eligible: refused with nothing spent
    const modern = await post(t.starter, actions(t.gameId), { action: 'gunpowder', requestId: 'req-m', rev: before.rev, args: { resources: ['Iron', 'Wheat'], mode: 'obsolete', wonderPieceId: bigBen } })
    expect(modern.status).toBe(400)
    expect(await modern.json()).toMatchObject({ error: 'ASSISTED_ACTION_REJECTED' })
    expect((await repo.findGame(t.gameId))?.assistedActions).toHaveLength(0)

    const paid = await post(t.starter, actions(t.gameId), { action: 'gunpowder', requestId: 'req-1', rev: before.rev, args: { resources: ['Iron', 'Wheat'], mode: 'obsolete', wonderPieceId: pyramids } })
    expect(paid.status).toBe(200)
    const after = await paid.json<View & { board: { pieces: { id: string; ownerId?: string | null; disabled?: boolean }[] } }>()
    expect(after.assistedActions[0]?.text).toMatch(/used Gunpowder: spent Iron and Wheat, obsoleting The Pyramids of .*: the wonder is disabled/)
    expect(after.board.pieces.find((piece) => piece.id === pyramids)).toMatchObject({ ownerId: null, disabled: true })
    const theirs = await view(t.gameId, t.other)
    expect(JSON.stringify(theirs)).not.toContain('"effect"')
    expect((theirs as unknown as { board: { pieces: { id: string; disabled?: boolean }[] } }).board.pieces.find((piece) => piece.id === pyramids)?.disabled).toBe(true)
    expect((await repo.findGame(t.gameId))?.board.pieces.some((piece) => piece.assetId === 'resources/iron')).toBe(false)
  })

  it('refuses a target that is not eligible with nothing spent, and the button is not usable with nothing to do', async () => {
    const t = await table('gunt', 'Gunpowder', ['resources/iron', 'resources/wheat'])
    expect((await post(t.starter, `/api/games/${t.gameId}/turns/done`, { phase: 'TRADE' })).status).toBe(200)
    const nothing = await view(t.gameId, t.starter)
    expect(entryOf(nothing, 'gunpowder')).toMatchObject({ status: 'unavailable' })
    const library = await placeLibrary(t)
    const before = await view(t.gameId, t.starter)
    expect(entryOf(before, 'gunpowder')).toMatchObject({ status: 'ready' })
    for (const args of [
      { resources: ['Iron', 'Wheat'], mode: 'destroy', buildingPieceId: 'no-such-piece' },
      { resources: ['Iron', 'Wheat'], mode: 'obsolete', wonderPieceId: library },
    ]) {
      const refused = await post(t.starter, actions(t.gameId), { action: 'gunpowder', requestId: 'req-1', rev: before.rev, args })
      expect(refused.status).toBe(400)
      expect(await refused.json()).toMatchObject({ error: 'ASSISTED_ACTION_REJECTED' })
    }
    const state = await repo.findGame(t.gameId)
    expect(state?.assistedActions).toHaveLength(0)
    expect(state?.board.pieces.some((piece) => piece.assetId === 'resources/iron')).toBe(true)
    expect(state?.board.pieces.some((piece) => piece.id === library)).toBe(true)
  })

  it('refuses Gunpowder with a lone token and no card: 400, nothing paid, nothing persisted', async () => {
    const t = await table('lone', 'Gunpowder', ['resources/iron'])
    const library = await placeLibrary(t)
    expect((await post(t.starter, `/api/games/${t.gameId}/turns/done`, { phase: 'TRADE' })).status).toBe(200)
    const before = await view(t.gameId, t.starter)
    expect(entryOf(before, 'gunpowder')).toMatchObject({ status: 'needs-resource' })
    const refused = await post(t.starter, actions(t.gameId), { action: 'gunpowder', requestId: 'req-1', rev: before.rev, args: { resources: ['Iron', 'Wheat'], mode: 'destroy', buildingPieceId: library } })
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({ error: 'ASSISTED_ACTION_REJECTED' })
    const state = await repo.findGame(t.gameId)
    expect(state?.assistedActions).toHaveLength(0)
    expect(state?.board.pieces.some((piece) => piece.assetId === 'resources/iron')).toBe(true)
    expect(state?.board.pieces.some((piece) => piece.id === library)).toBe(true)
  })

  it('takes the id of an army for Combustion and nothing else', async () => {
    const t = await table('com', 'Combustion', [])
    expect((await post(t.starter, `/api/games/${t.gameId}/turns/done`, { phase: 'CM' })).status).toBe(200)
    const before = await view(t.gameId, t.starter)
    expect(entryOf(before, 'combustion')).toMatchObject({ status: 'ready' })
    for (const args of [{}, { pieceId: 7 }, { pieceId: 'bad id!' }, { square: { column: 1, row: 1 } }, { pieceId: 'a1', extra: true }]) {
      const bad = await post(t.starter, actions(t.gameId), { action: 'combustion', requestId: 'req-bad', rev: before.rev, args })
      expect(bad.status).toBe(400)
    }
    // A valid shape naming no army of the player is the engine's refusal
    const missing = await post(t.starter, actions(t.gameId), { action: 'combustion', requestId: 'req-1', rev: before.rev, args: { pieceId: 'no-such-piece' } })
    expect(missing.status).toBe(400)
    expect(await missing.json()).toMatchObject({ error: 'ASSISTED_ACTION_REJECTED' })
    expect((await repo.findGame(t.gameId))?.assistedActions).toHaveLength(0)
  })
})
