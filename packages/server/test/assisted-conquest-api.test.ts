/**
 * Answering a conquest offer over HTTP (issue #368): the same `/actions` route as every assisted action, with a strictly
 * parsed `args` payload. The rules are in `packages/engine/test/conquest.test.ts`; these check the wiring, the payload
 * validation, the status codes, the undo of the answer and of End battle, the replayed revision and that nobody but the
 * owner is ever sent the offer or the pending conquest.
 *
 * The scene: the America tile in the first map slot, the starter a Chinese player with an army on C3 and a village on C2.
 * The army marches onto the village and wins a battle against the barbarians, which the other player controls.
 */

import type { App } from '../src/app.js'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  SQUARE_SIZE,
  cultureCellCenter,
  cultureStepOf,
  draw,
  drawUnitsForBattle,
  findBoardAsset,
  findPlayer,
  initiateBattle,
  leaderAssetId,
  killArenaUnit,
  mapTop,
  placePiece,
  placeUnitInArena,
  slotOrigin,
  unwrap,
} from '@civ/engine'
import type { GameState } from '@civ/engine'

import { createTestApp } from '../src/app.js'
import { JsonFileRepository } from '../src/store/json-file.js'
import { bearer, inject } from './helpers.js'

let app: App
let repo: JsonFileRepository

beforeEach(async () => {
  const created = await createTestApp()
  app = created.app
  repo = created.repo
})

interface View {
  readonly rev: number
  readonly you: {
    readonly stats: { readonly culture: number }
    readonly conquestOffers?: readonly {
      readonly id: string
      readonly kind: string
      readonly square: string
      readonly civ: string
      readonly blocked: string | null
      readonly nothing: string | null
    }[]
  } | null
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

const post = (token: string, url: string, payload: unknown) => inject(app, { method: 'POST', url, headers: bearer(token), payload })

const view = async (gameId: string, token?: string): Promise<View> =>
  (await inject(app, { url: `/api/games/${gameId}`, ...(token === undefined ? {} : { headers: bearer(token) }) })).json<View>()

interface Table {
  readonly gameId: string
  readonly starter: string
  readonly other: string
  readonly starterId: string
  readonly armyId: string
}

/**
 * A started two-player game with the scene above, the starter Chinese with 5 culture, the army not yet moved. `leaderStep`
 * puts the starter's leader marker on that space of the culture track; without it there is none.
 */
async function buildTable(name: string, civ = 'Chinese', leaderStep?: number): Promise<Table> {
  const creator = await register(`${name}-a`)
  const created = await inject(app, { method: 'POST', url: '/api/games', headers: bearer(creator), payload: { name, numOfPlayers: 2 } })
  const gameId = (await created.json() as { id: string }).id
  const joiner = await register(`${name}-b`)
  await post(joiner, `/api/games/${gameId}/join`, {})

  let state = await repo.findGame(gameId)
  if (state === undefined) throw new Error('game missing')
  const starterPlayer = state.players.find((player) => player.yourTurn)
  if (starterPlayer === undefined) throw new Error('nobody has the first turn')
  const starter = starterPlayer.username === `${name}-a` ? creator : joiner
  const other = starter === creator ? joiner : creator
  const colour = starterPlayer.color?.toLowerCase()
  if (colour === undefined) throw new Error('the starter has no colour')

  const slot = state.board.slots[0]
  if (slot === undefined) throw new Error('board has no slots')
  const [x, y] = slotOrigin(state.board, slot)
  state = unwrap(placePiece(state, { playerId: starterPlayer.playerId, assetId: 'tiles/america', x, y }))
  const at = (assetId: string, column: number, row: number): GameState =>
    unwrap(placePiece(state as GameState, {
      playerId: starterPlayer.playerId,
      assetId,
      x: column * SQUARE_SIZE + 4,
      y: mapTop((state as GameState).board) + row * SQUARE_SIZE + 4,
    }))
  state = at('resources/village', 2, 1)
  state = at(`figures/${colour}army`, 2, 2)
  const armyId = state.board.pieces.at(-1)?.id ?? ''
  const leader = leaderStep === undefined || starterPlayer.color == null ? undefined : leaderAssetId(civ, starterPlayer.color)
  const leaderAsset = leader === undefined ? undefined : findBoardAsset(leader)
  if (leaderStep !== undefined && leaderAsset !== undefined) {
    const centre = cultureCellCenter(state.board, leaderStep)
    state = unwrap(placePiece(state, { playerId: starterPlayer.playerId, assetId: leaderAsset.id, x: Math.round(centre.x - leaderAsset.width / 2), y: 10 }))
  } else if (leaderStep !== undefined) {
    throw new Error('no leader marker artwork')
  }
  state = {
    ...state,
    players: state.players.map((player) =>
      player.playerId === starterPlayer.playerId
        ? { ...player, civilization: { kind: 'civ', name: civ } as unknown as typeof player.civilization, stats: { ...player.stats, culture: 5 } }
        : player,
    ),
  }
  await repo.saveGame(state)
  return { gameId, starter, other, starterId: starterPlayer.playerId, armyId }
}

const stored = async (table: Table): Promise<GameState> => {
  const state = await repo.findGame(table.gameId)
  if (state === undefined) throw new Error('game missing')
  return state
}

/** The army marches onto the village over HTTP, then the battle against the barbarians is set up with the other side wiped out. */
async function marchAndFight(table: Table): Promise<void> {
  const marched = await post(table.starter, `/api/games/${table.gameId}/board/pieces/${table.armyId}/travel`, { column: 2, row: 1 })
  expect(marched.status).toBe(200)
  let state = await stored(table)
  expect(state.pendingConquests).toHaveLength(1)
  let next = state
  for (let i = 0; i < 2; i++) next = unwrap(draw(next, { playerId: table.starterId, sheetName: 'INFANTRY', confirmedOutOfTurn: true }))
  next = unwrap(drawUnitsForBattle(next, { playerId: table.starterId, numberOfDraws: 2 }))
  next = unwrap(initiateBattle(next, { initiatorId: table.starterId, opponentId: 'barbarians' }))
  const controller = next.battle?.defender.playerId ?? ''
  for (const [index, unit] of (findPlayer(next, table.starterId)?.battlehand ?? []).entries()) {
    next = unwrap(placeUnitInArena(next, { playerId: table.starterId, unitId: unit.id, side: 'attacker', position: index, attack: 1, health: 3 }))
  }
  for (const [index, unit] of (findPlayer(next, controller)?.barbarians ?? []).entries()) {
    next = unwrap(placeUnitInArena(next, { playerId: controller, unitId: unit.id, side: 'defender', position: 10 + index, attack: 1, health: 3 }))
  }
  for (const unit of next.battle?.arena.filter((candidate) => candidate.side === 'defender') ?? []) {
    next = unwrap(killArenaUnit(next, { playerId: table.starterId, arenaUnitId: unit.id }))
  }
  state = next
  await repo.saveGame(state)
}

const endBattle = async (table: Table) => {
  const rev = (await view(table.gameId, table.starter)).rev
  return post(table.starter, `/api/games/${table.gameId}/battle/arena/end`, { rev })
}

const claimBody = (offerId: string, accept: unknown, requestId: string, rev: number) => ({
  action: 'claimConquest',
  requestId,
  rev,
  args: { offerId, accept },
})

/** A table where the battle has been won and ended, with the offer open. */
async function offered(name: string, civ = 'Chinese', leaderStep?: number): Promise<{ table: Table; offerId: string }> {
  const table = await buildTable(name, civ, leaderStep)
  await marchAndFight(table)
  expect((await endBattle(table)).status).toBe(200)
  const offerId = (await view(table.gameId, table.starter)).you?.conquestOffers?.[0]?.id
  if (offerId === undefined) throw new Error('no offer was made')
  return { table, offerId }
}

// ---------------------------------------------------------------------------

describe('the offer in the projection', () => {
  it('goes to its owner, once the battle is ended and not before, and to nobody else', async () => {
    const table = await buildTable('Offer-view')
    await marchAndFight(table)
    // The battle is still on: no offer yet, and the pending conquest is not in anybody's view
    const before = await inject(app, { url: `/api/games/${table.gameId}`, headers: bearer(table.starter) })
    expect((await before.json<View>()).you?.conquestOffers).toEqual([])
    expect(before.body).not.toContain('pendingConquests')

    expect((await endBattle(table)).status).toBe(200)
    const mine = await view(table.gameId, table.starter)
    expect(mine.you?.conquestOffers).toEqual([{ id: expect.any(String), kind: 'village', square: 'C2', civ: 'Chinese', blocked: null, nothing: null }])
    const offerId = mine.you?.conquestOffers?.[0]?.id ?? ''

    const asOther = await inject(app, { url: `/api/games/${table.gameId}`, headers: bearer(table.other) })
    const asSpectator = await inject(app, { url: `/api/games/${table.gameId}`, headers: bearer(await register('Offer-view-watcher')) })
    const anonymous = await inject(app, { url: `/api/games/${table.gameId}` })
    // The other player's own, empty self view; the leak protection is that the id and the pending conquest are nowhere in it
    expect((await asOther.json<View>()).you?.conquestOffers).toEqual([])
    for (const response of [asOther, asSpectator, anonymous]) {
      expect(response.status).toBe(200)
      expect(response.body).not.toContain(offerId)
      expect(response.body).not.toContain('pendingConquests')
    }
    for (const response of [asSpectator, anonymous]) {
      expect(response.body).not.toContain('conquestOffers')
      expect((await response.json<View>()).you).toBeNull()
    }
    expect(JSON.stringify(mine)).not.toContain('pendingConquests')
  })

  it('is empty in a replayed revision, though the live game has it', async () => {
    const { table } = await offered('Offer-replay')
    const live = await view(table.gameId, table.starter)
    expect(live.you?.conquestOffers).toHaveLength(1)
    const past = await inject(app, { url: `/api/games/${table.gameId}/revisions/${live.rev}`, headers: bearer(table.starter) })
    expect(past.status).toBe(200)
    expect((await past.json<{ view: View }>()).view.you?.conquestOffers).toEqual([])
  })
})

describe('answering over HTTP', () => {
  it('gives the Chinese 3 culture on accept and closes the offer', async () => {
    const { table, offerId } = await offered('Claim-accept')
    const rev = (await view(table.gameId, table.starter)).rev
    const response = await post(table.starter, `/api/games/${table.gameId}/actions`, claimBody(offerId, true, 'claim-1', rev))
    expect(response.status).toBe(200)
    const after = await response.json<View>()
    expect(after.you?.stats.culture).toBe(8)
    expect(after.you?.conquestOffers).toEqual([])
    const state = await stored(table)
    expect(state.conquestOffers).toBeUndefined()
    expect(state.log.some((entry) => entry.publicLog.includes('gained 3 (8) culture for conquering the village on C2 as the Chinese'))).toBe(true)
  })

  it('closes the offer on decline and gains nothing', async () => {
    const { table, offerId } = await offered('Claim-decline')
    const rev = (await view(table.gameId, table.starter)).rev
    const response = await post(table.starter, `/api/games/${table.gameId}/actions`, claimBody(offerId, false, 'claim-1', rev))
    expect(response.status).toBe(200)
    expect((await response.json<View>()).you?.stats.culture).toBe(5)
    expect((await stored(table)).conquestOffers).toBeUndefined()
  })

  const leaderStepOf = (state: GameState): number | null => {
    const marker = state.board.pieces.find((piece) => piece.assetId.startsWith('leaders/'))
    return marker === undefined ? null : cultureStepOf(state.board, marker)
  }

  it('moves the Romans’ leader marker one space for free on accept, and closes the offer', async () => {
    const { table, offerId } = await offered('Claim-roman', 'Romans', 9)
    const before = await view(table.gameId, table.starter)
    expect(before.you?.conquestOffers?.[0]).toMatchObject({ civ: 'Romans', blocked: null, nothing: null })
    expect(leaderStepOf(await stored(table))).toBe(9)
    const response = await post(table.starter, `/api/games/${table.gameId}/actions`, claimBody(offerId, true, 'claim-1', before.rev))
    expect(response.status).toBe(200)
    const state = await stored(table)
    expect(leaderStepOf(state)).toBe(10)
    expect(state.conquestOffers).toBeUndefined()
    expect(state.log.some((entry) => entry.publicLog.includes('took the free advance for conquering the village on C2 as the Romans'))).toBe(true)
    expect(state.log.some((entry) => entry.publicLog.includes('advanced for free on the culture track to space 10'))).toBe(true)
  })

  it('closes and logs a Roman offer when there is nothing to advance (no marker on the track), and says so beforehand', async () => {
    const { table, offerId } = await offered('Claim-roman-nothing', 'Romans')
    const before = await view(table.gameId, table.starter)
    expect(before.you?.conquestOffers?.[0]?.nothing).toBe('Your leader marker is not on the culture track.')
    const response = await post(table.starter, `/api/games/${table.gameId}/actions`, claimBody(offerId, true, 'claim-1', before.rev))
    expect(response.status).toBe(200)
    const state = await stored(table)
    expect(state.conquestOffers).toBeUndefined()
    expect(state.log.some((entry) => entry.publicLog.includes('took the free advance for conquering the village on C2 as the Romans, but there is nothing to advance'))).toBe(true)
  })

  it('refuses another player’s answer with a 400 and leaves the offer open', async () => {
    const { table, offerId } = await offered('Claim-other')
    const rev = (await view(table.gameId, table.other)).rev
    const response = await post(table.other, `/api/games/${table.gameId}/actions`, claimBody(offerId, true, 'claim-x', rev))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'ASSISTED_ACTION_REJECTED', message: 'You have no conquest to answer.' })
    expect((await stored(table)).conquestOffers).toHaveLength(1)
  })

  it('refuses an unknown offer with a 400, a stale rev with a 409, and a stranger with a 403', async () => {
    const { table, offerId } = await offered('Claim-bad')
    const rev = (await view(table.gameId, table.starter)).rev
    const unknown = await post(table.starter, `/api/games/${table.gameId}/actions`, claimBody('no-such-offer', true, 'claim-1', rev))
    expect(unknown.status).toBe(400)
    expect(await unknown.json()).toMatchObject({ message: 'That conquest offer is not open.' })
    const stale = await post(table.starter, `/api/games/${table.gameId}/actions`, claimBody(offerId, true, 'claim-2', rev - 1))
    expect(stale.status).toBe(409)
    const stranger = await post(await register('Claim-bad-stranger'), `/api/games/${table.gameId}/actions`, claimBody(offerId, true, 'claim-3', rev))
    expect(stranger.status).toBe(403)
    expect((await stored(table)).conquestOffers).toHaveLength(1)
  })

  it('checks the shape of args: an offer id and a true boolean, nothing else', async () => {
    const { table, offerId } = await offered('Claim-args')
    const rev = (await view(table.gameId, table.starter)).rev
    const send = (body: Record<string, unknown>) => post(table.starter, `/api/games/${table.gameId}/actions`, { action: 'claimConquest', requestId: 'claim-1', rev, ...body })
    for (const body of [
      {},
      { args: {} },
      { args: { offerId } },
      { args: { accept: true } },
      { args: { offerId, accept: 'yes' } },
      { args: { offerId, accept: 1 } },
      { args: { offerId, accept: null } },
      { args: { offerId: 'has space', accept: true } },
      { args: { offerId: 42, accept: true } },
      { args: { offerId, accept: true, extra: 1 } },
      { args: [offerId, true] },
      { offerId, accept: true },
    ]) {
      expect((await send(body)).status, JSON.stringify(body)).toBe(400)
    }
    expect((await stored(table)).conquestOffers).toHaveLength(1)
    expect((await send({ args: { offerId, accept: true } })).status).toBe(200)
  })

  it('answers a repeated request once: the same request id is harmless', async () => {
    const { table, offerId } = await offered('Claim-retry')
    const rev = (await view(table.gameId, table.starter)).rev
    expect((await post(table.starter, `/api/games/${table.gameId}/actions`, claimBody(offerId, true, 'claim-1', rev))).status).toBe(200)
    const again = await post(table.starter, `/api/games/${table.gameId}/actions`, claimBody(offerId, true, 'claim-1', rev + 1))
    expect(again.status).toBe(200)
    expect((await again.json<View>()).you?.stats.culture).toBe(8)
  })
})

describe('taking it back over HTTP', () => {
  async function undoByVote(table: Table, requestId: string): Promise<void> {
    const state = await stored(table)
    const logId = state.log.find((entry) => entry.assistedActionId === requestId)?.id
    if (logId === undefined) throw new Error('no line for the action')
    expect((await post(table.other, `/api/games/${table.gameId}/undo/${logId}`, {})).status).toBe(200)
    expect((await post(table.starter, `/api/games/${table.gameId}/undo/${logId}/vote`, { vote: true })).status).toBe(200)
  }

  it('undoes an answer by the vote, which opens the offer again and takes the culture back', async () => {
    const { table, offerId } = await offered('Undo-answer')
    const rev = (await view(table.gameId, table.starter)).rev
    expect((await post(table.starter, `/api/games/${table.gameId}/actions`, claimBody(offerId, true, 'claim-1', rev))).status).toBe(200)
    await undoByVote(table, 'claim-1')
    const after = await view(table.gameId, table.starter)
    expect(after.you?.stats.culture).toBe(5)
    expect(after.you?.conquestOffers?.map((offer) => offer.id)).toEqual([offerId])
  })

  it('withdraws an open offer when End battle is undone, and refuses it with a 409 and the reason once it was answered', async () => {
    const { table, offerId } = await offered('Undo-end')
    const rev = (await view(table.gameId, table.starter)).rev
    expect((await post(table.starter, `/api/games/${table.gameId}/actions`, claimBody(offerId, true, 'claim-1', rev))).status).toBe(200)

    const refused = await post(table.starter, `/api/games/${table.gameId}/battle/arena/end/undo`, { rev: rev + 1 })
    expect(refused.status).toBe(409)
    const body = await refused.json<{ error: string; message: string }>()
    expect(body.error).toBe('ASSISTED_UNDO_BLOCKED')
    expect(body.message).toContain('Undo that first, then undo the end of the battle')
    expect((await view(table.gameId, table.starter)).you?.stats.culture).toBe(8)

    // Take the answer back, and the end of the battle can be undone: the offer goes with it
    await undoByVote(table, 'claim-1')
    const reopened = await view(table.gameId, table.starter)
    expect(reopened.you?.conquestOffers).toHaveLength(1)
    const undone = await post(table.starter, `/api/games/${table.gameId}/battle/arena/end/undo`, { rev: reopened.rev })
    expect(undone.status).toBe(200)
    expect((await undone.json<View>()).you?.conquestOffers).toEqual([])
  })
})
