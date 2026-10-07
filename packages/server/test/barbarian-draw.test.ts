import { activeTurnStatus, createGame, initiateBattle, unwrap } from '@civ/engine'
import type { GameState, PlayerView } from '@civ/engine'
import { beforeEach, describe, expect, it } from 'vitest'

import type { App } from '../src/app.js'
import { createTestApp } from '../src/app.js'
import { TokenSigner } from '../src/auth.js'
import type { JsonFileRepository } from '../src/store/json-file.js'
import { bearer, inject } from './helpers.js'

let app: App
let repo: JsonFileRepository
let game: GameState
const sign = (id: string) => new TokenSigner('test-secret').sign(id)

beforeEach(async () => {
  const created = await createTestApp()
  app = created.app
  repo = created.repo
  for (const id of ['attacker', 'controller', 'other', 'outsider']) {
    await repo.createPlayer({ id, username: id, email: `${id}@example.com`, passwordHash: 'hash', createdAt: '2026-10-07T00:00:00Z' })
  }
  game = createGame({
    name: 'Prepared barbarians', numOfPlayers: 3, seed: 'prepared-barbarians',
    players: [
      { playerId: 'attacker', username: 'attacker', gameCreator: true, yourTurn: true },
      { playerId: 'controller', username: 'controller' },
      { playerId: 'other', username: 'other' },
    ],
  })
  await repo.saveGame(game)
})

const draw = (playerId: string, payload: unknown = { rev: game.rev }) => inject(app, {
  method: 'POST', url: `/api/games/${game.id}/battle/barbarians`, headers: bearer(sign(playerId)), payload,
})

async function live(): Promise<GameState> {
  const state = await repo.findGame(game.id)
  if (state === undefined) throw new Error('Missing game')
  return state
}

describe('independent barbarian draw endpoint', () => {
  it('lets a member outside the current phase turn draw only their own three units', async () => {
    expect(activeTurnStatus(game)?.playerId).toBe('attacker')
    const response = await draw('controller', { rev: game.rev, targetPlayerId: 'other' })
    expect(response.status).toBe(200)
    const view = await response.json<PlayerView>()
    expect(view.you?.playerId).toBe('controller')
    expect(view.you?.barbarians).toHaveLength(3)
    const saved = await live()
    expect(saved.rev).toBe(game.rev + 1)
    expect(saved.players.find((p) => p.playerId === 'other')?.barbarians).toHaveLength(0)
    expect(saved.players.find((p) => p.playerId === 'attacker')?.barbarians).toHaveLength(0)
    expect(saved.battle).toBeNull()
  })

  it('rejects duplicate and stale draws without changing the hand, deck or log', async () => {
    expect((await draw('controller')).status).toBe(200)
    const before = await live()
    const duplicate = await draw('controller', { rev: before.rev })
    expect(duplicate.status).toBe(412)
    expect(await duplicate.json()).toMatchObject({ error: 'BARBARIANS_NOT_DISCARDED' })
    expect(await live()).toEqual(before)
    const stale = await draw('other', { rev: game.rev })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ error: 'CONFLICT' })
    expect(await live()).toEqual(before)
  })

  it('rejects a live-arena draw even when the member has no barbarian hand', async () => {
    const active = unwrap(initiateBattle(game, { initiatorId: 'attacker', opponentId: 'other' }))
    await repo.saveGame(active)
    const response = await draw('controller')
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'BATTLE_ALREADY_ACTIVE' })
    expect(await live()).toEqual(active)
  })

  it.each([{}, { rev: -1 }, { rev: 0.5 }, { rev: '0' }])('requires a valid revision %j', async (payload) => {
    expect((await draw('controller', payload)).status).toBe(400)
    expect(await live()).toEqual(game)
  })

  it('rejects anonymous, nonmember and withdrawn callers without touching state', async () => {
    const anonymous = await inject(app, { method: 'POST', url: `/api/games/${game.id}/battle/barbarians`, payload: { rev: game.rev } })
    expect(anonymous.status).toBe(401)
    expect((await draw('outsider')).status).toBe(403)
    const controller = game.players.find((p) => p.playerId === 'controller')
    if (controller === undefined) throw new Error('Missing controller')
    const withdrawn = { ...game, players: game.players.filter((p) => p.playerId !== 'controller'), withdrawnPlayers: [controller] }
    await repo.saveGame(withdrawn)
    expect((await draw('controller')).status).toBe(403)
    expect(await live()).toEqual(withdrawn)
  })

  it('keeps prepared units private from other members and spectators, including after initiation', async () => {
    const drawn = await draw('controller')
    const units = (await drawn.json<PlayerView>()).you?.barbarians ?? []
    expect(units).toHaveLength(3)
    const prepared = await live()
    const initiated = await inject(app, {
      method: 'POST', url: `/api/games/${game.id}/battle/arena/initiate`, headers: bearer(sign('attacker')),
      payload: { opponentId: 'barbarians', rev: prepared.rev },
    })
    expect(initiated.status).toBe(200)
    const after = await live()
    expect(after.players.find((p) => p.playerId === 'controller')?.barbarians).toEqual(units)
    expect(after.items).toEqual(prepared.items)
    expect(after.log).toHaveLength(prepared.log.length + 1)
    expect(after.battle?.defender).toEqual({ kind: 'barbarians', playerId: 'controller' })
    expect(after.battle?.turn).toBe('defender')
    for (const id of ['attacker', 'other', 'outsider']) {
      const response = await inject(app, { url: `/api/games/${game.id}`, headers: bearer(sign(id)) })
      expect(response.status).toBe(200)
      for (const unit of units) expect(response.body).not.toContain(unit.id)
      for (const entry of after.log.filter((entry) => entry.item !== null)) {
        if (entry.privateLog !== entry.publicLog) expect(response.body).not.toContain(entry.privateLog)
      }
    }
  })
})
