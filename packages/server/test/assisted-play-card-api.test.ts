/**
 * Playing a card through `POST /api/games/:gameId/actions` with `args`. The rules are
 * in `packages/engine/test/assisted-play-card.test.ts`; this checks the route's own
 * work: the strict shape of `args`, the 409 on a stale revision, and that nothing
 * about a hand reaches another player.
 */

import type { App } from '../src/app.js'
import { beforeEach, describe, expect, it } from 'vitest'

import { findBoardAsset, mapCellOf, mapTop, markPhasesDone, placePiece, unwrap } from '@civ/engine'

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
    readonly playableCards: readonly { itemId: string; name: string; status: string; reason: string }[]
  } | null
  readonly assistedActions: readonly { id: string; kind: string; label: string; status: string; text: string }[]
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

/** A started two-player game; the starter holds the named card, and Start of Turn is open. */
async function table(cardName: string) {
  const creator = await register(`card-a-${cardName.length}`)
  const created = await inject(app, {
    method: 'POST', url: '/api/games', headers: bearer(creator), payload: { name: 'Cards', numOfPlayers: 2 },
  })
  const gameId = (await created.json() as { id: string }).id
  const joiner = await register(`card-b-${cardName.length}`)
  await post(joiner, `/api/games/${gameId}/join`, {})

  const state = await repo.findGame(gameId)
  if (state === undefined) throw new Error('game missing')
  const starterName = state.players.find((player) => player.yourTurn)?.username
  const starter = starterName === `card-a-${cardName.length}` ? creator : joiner
  const other = starter === creator ? joiner : creator
  const starterId = (await view(gameId, starter)).you?.playerId as string
  const otherId = (await view(gameId, other)).you?.playerId as string

  const card = state.items.find(
    (item) => (item.kind === 'greatperson' || item.kind.startsWith('culture')) && 'name' in item && item.name === cardName,
  )
  if (card === undefined) throw new Error(`no ${cardName} card in the deck`)
  await repo.saveGame({
    ...state,
    items: state.items.filter((item) => item.id !== card.id),
    players: state.players.map((player) =>
      player.playerId === starterId
        ? { ...player, items: [...player.items, { ...card, hidden: true, ownerId: starterId }] }
        : player,
    ),
  })
  return { gameId, starter, other, starterId, otherId, itemId: card.id }
}

const actions = (gameId: string) => `/api/games/${gameId}/actions`

describe('playing a card through the actions route', () => {
  it('lists the card as playable for its owner only', async () => {
    const t = await table('Counterfeiters')
    const mine = await view(t.gameId, t.starter)
    expect(mine.you?.playableCards).toMatchObject([{ itemId: t.itemId, name: 'Counterfeiters', status: 'ready' }])

    const theirs = await view(t.gameId, t.other)
    expect(theirs.you?.playableCards).toEqual([])
    expect(JSON.stringify(theirs)).not.toContain(t.itemId)
    expect(JSON.stringify(theirs)).not.toContain('Counterfeiters')
  })

  it('plays it, names the target in the public line and returns the projection', async () => {
    const t = await table('Counterfeiters')
    const before = await view(t.gameId, t.starter)
    const response = await post(t.starter, actions(t.gameId), {
      action: 'playCard',
      requestId: 'req-1',
      rev: before.rev,
      args: { itemId: t.itemId, targets: [t.otherId] },
    })

    expect(response.status).toBe(200)
    const after = await response.json<View>()
    expect(after.you?.playableCards).toEqual([])
    expect(after.assistedActions[0]).toMatchObject({ id: 'req-1', kind: 'playCard', label: 'Counterfeiters', status: 'applied' })
    expect(after.assistedActions[0]?.text).toMatch(/^card-[ab]-\d+ played Counterfeiters \(start of turn\), targeting card-[ab]-\d+$/)

    // The other player sees the public line and the discarded card, never an effect
    const theirs = await view(t.gameId, t.other)
    expect(theirs.assistedActions[0]?.text).toBe(after.assistedActions[0]?.text)
    expect(JSON.stringify(theirs)).not.toContain('"effect"')
    const stored = await repo.findGame(t.gameId)
    expect(stored?.discardedItems.some((item) => item.id === t.itemId)).toBe(true)
  })

  it('does it once for the same request id', async () => {
    const t = await table('Counterfeiters')
    const rev = (await view(t.gameId, t.starter)).rev
    const body = { action: 'playCard', requestId: 'req-1', rev, args: { itemId: t.itemId, targets: [t.otherId] } }
    expect((await post(t.starter, actions(t.gameId), body)).status).toBe(200)
    const retry = await post(t.starter, actions(t.gameId), { ...body, rev: rev + 1 })
    expect(retry.status).toBe(200)
    expect((await repo.findGame(t.gameId))?.assistedActions).toHaveLength(1)
  })

  it('gives 409 and changes nothing on a stale revision', async () => {
    const t = await table('Counterfeiters')
    const rev = (await view(t.gameId, t.starter)).rev
    const response = await post(t.starter, actions(t.gameId), {
      action: 'playCard',
      requestId: 'req-1',
      rev: rev - 1,
      args: { itemId: t.itemId, targets: [t.otherId] },
    })
    expect(response.status).toBe(409)
    expect((await repo.findGame(t.gameId))?.discardedItems).toHaveLength(0)
  })

  it('refuses a card the game does not allow, with the engine reason', async () => {
    const t = await table('Counterfeiters')
    const rev = (await view(t.gameId, t.starter)).rev
    const noTarget = await post(t.starter, actions(t.gameId), {
      action: 'playCard', requestId: 'req-1', rev, args: { itemId: t.itemId, targets: [] },
    })
    expect(noTarget.status).toBe(400)
    expect(await noTarget.json()).toMatchObject({ error: 'ASSISTED_ACTION_REJECTED' })

    const outsiderCard = await post(t.other, actions(t.gameId), {
      action: 'playCard', requestId: 'req-2', rev, args: { itemId: t.itemId, targets: [t.starterId] },
    })
    expect(outsiderCard.status).toBe(400)
  })

  it('refuses a malformed args object before it reaches the engine', async () => {
    const t = await table('Counterfeiters')
    const rev = (await view(t.gameId, t.starter)).rev
    const send = (args: unknown, extra: Record<string, unknown> = {}) =>
      post(t.starter, actions(t.gameId), { action: 'playCard', requestId: `req-${Math.random()}`, rev, args, ...extra })

    expect((await send(undefined)).status).toBe(400) // no itemId
    expect((await send('x')).status).toBe(400)
    expect((await send([])).status).toBe(400)
    expect((await send({ itemId: 'bad id!', targets: [] })).status).toBe(400)
    expect((await send({ itemId: t.itemId, targets: 'nobody' })).status).toBe(400)
    expect((await send({ itemId: t.itemId, targets: ['a', 'b', 'c', 'd', 'e'] })).status).toBe(400)
    expect((await send({ itemId: t.itemId, targets: [], resource: '' })).status).toBe(400)
    expect((await send({ itemId: t.itemId, targets: [], from: { column: 0 } })).status).toBe(400)
    expect((await send({ itemId: t.itemId, targets: [], to: { column: -1, row: 0 } })).status).toBe(400)
    expect((await send({ itemId: t.itemId, targets: [], to: { column: 0, row: 0, extra: 1 } })).status).toBe(400)
    expect((await send({ itemId: t.itemId, targets: [], from: { column: 0, row: 0 }, to: 'A1' })).status).toBe(400)
    expect((await send({ itemId: t.itemId, targets: [], figureId: 'bad id!' })).status).toBe(400)
    expect((await send({ itemId: t.itemId, targets: [], extra: 1 })).status).toBe(400)
    expect((await send({ itemId: t.itemId, targets: [] }, { family: 'x' })).status).toBe(400)
    // A field of the body that no action reads is refused too, not ignored
    const stray = await send({ itemId: t.itemId, targets: [] }, { foo: 1 })
    expect(stray.status).toBe(400)
    expect(await stray.json()).toMatchObject({ message: 'playCard takes only args, not foo' })
    // An args that is null is not an object, and says so
    const empty = await send(null)
    expect(empty.status).toBe(400)
    expect(await empty.json()).toMatchObject({ message: 'args must be an object' })
    expect((await repo.findGame(t.gameId))?.assistedActions).toHaveLength(0)
  })

  it('carries Galileo’s two squares through the route and moves the figures', async () => {
    const t = await table('Galileo Galilei')
    const saved = await repo.findGame(t.gameId)
    if (saved === undefined) throw new Error('missing game')
    const player = saved.players.find((candidate) => candidate.playerId === t.starterId)
    if (player?.color == null) throw new Error('starter has no colour')
    const army = findBoardAsset(`figures/${player.color.toLowerCase()}army`)
    if (army === undefined) throw new Error('missing army')
    const square = saved.board.squareSize
    const opened = unwrap(markPhasesDone(saved, { playerId: t.starterId, turnNumber: 1, upToPhase: 'TRADE' }))
    // The first slot is explored (a tile back has no terrain): Galileo may not land in fog
    const explored = unwrap(
      placePiece(opened, { playerId: t.starterId, assetId: 'tiles/tileback', x: 0, y: mapTop(opened.board) }),
    )
    const placed = unwrap(
      placePiece(explored, {
        playerId: t.starterId,
        assetId: army.id,
        x: Math.round((square - army.width) / 2),
        y: Math.round(mapTop(opened.board) + (square - army.height) / 2),
      }),
    )
    await repo.saveGame(placed)

    const rev = (await view(t.gameId, t.starter)).rev
    const response = await post(t.starter, actions(t.gameId), {
      action: 'playCard',
      requestId: 'req-galileo',
      rev,
      args: {
        itemId: t.itemId,
        targets: [],
        from: { column: 0, row: 0 },
        to: { column: 0, row: 2 },
      },
    })
    expect(response.status).toBe(200)
    const stored = await repo.findGame(t.gameId)
    if (stored === undefined) throw new Error('missing stored game')
    const moved = stored.board.pieces.find((piece) => piece.category === 'figure')
    expect(moved?.movement).toMatchObject({ turn: 1, locked: true })
    expect(moved === undefined ? null : mapCellOf(stored.board, moved)).toEqual({ column: 0, row: 2 })
  })

  it('validates the squares of Steam Power', async () => {
    const t = await table('Counterfeiters')
    const rev = (await view(t.gameId, t.starter)).rev
    const extra = await post(t.starter, actions(t.gameId), {
      action: 'steamPower', requestId: 'req-steam-1', rev, args: { from: { column: 0, row: 0 }, to: { column: 1, row: 1 }, figureId: 'x' },
    })
    expect(extra.status).toBe(400)
    expect(await extra.json()).toMatchObject({ message: 'steamPower takes only from and to, not figureId' })

    const missing = await post(t.starter, actions(t.gameId), {
      action: 'steamPower', requestId: 'req-steam-2', rev, args: { from: { column: 0, row: 0 } },
    })
    expect(missing.status).toBe(400)
    expect(await missing.json()).toMatchObject({ message: 'to is required' })

    const fractional = await post(t.starter, actions(t.gameId), {
      action: 'steamPower', requestId: 'req-steam-3', rev, args: { from: { column: 0.5, row: 0 }, to: { column: 1, row: 1 } },
    })
    expect(fractional.status).toBe(400)
    expect(await fractional.json()).toMatchObject({ message: 'from needs whole column and row numbers' })
  })

  it('refuses args for an action that takes none', async () => {
    const t = await table('Counterfeiters')
    const rev = (await view(t.gameId, t.starter)).rev
    const response = await post(t.starter, actions(t.gameId), {
      action: 'chivalry', requestId: 'req-1', rev, args: { itemId: t.itemId },
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ message: 'args does not belong to this action' })
  })
})
