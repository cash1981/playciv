/**
 * Cancellation over HTTP (issues #301, #336): `POST /api/games/:id/cancellations` cancels another player's city action
 * with Mark Twain at once and rewinds the game to the stored revision before it; Dr. Martin Luther King can undo that.
 * The rules are in `packages/engine/test/cancellation.test.ts`; these check the wiring: the revision lookup, the refusal
 * when somebody else has saved a revision since, and that the game is saved as a new revision.
 */

import type { App } from '../src/app.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SQUARE_SIZE, mapTop, placePiece, slotOrigin, unwrap } from '@civ/engine'

import { createTestApp } from '../src/app.js'
import { JsonFileRepository } from '../src/store/json-file.js'
import { revisionSnapshot } from '../src/context.js'
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
  readonly assistedActions: readonly { id: string; kind: string; status: string; logId: string; text: string }[]
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
  readonly cityId: string
  readonly twainId: string
  readonly kingId: string
}

/** A started two-player game: the starter has a city on B2 of America, City Management is open and the other player holds Mark Twain. */
async function table(name: string): Promise<Table> {
  const creator = await register(`${name}-a`)
  const created = await inject(app, { method: 'POST', url: '/api/games', headers: bearer(creator), payload: { name, numOfPlayers: 2 } })
  const gameId = (await created.json() as { id: string }).id
  const joiner = await register(`${name}-b`)
  await post(joiner, `/api/games/${gameId}/join`, {})

  const found = await repo.findGame(gameId)
  const starterPlayer = found?.players.find((player) => player.yourTurn)
  if (found === undefined || starterPlayer === undefined) throw new Error('nobody has the first turn')
  const starter = starterPlayer.username === `${name}-a` ? creator : joiner
  const other = starter === creator ? joiner : creator
  let state = await repo.findGame(gameId)
  if (state === undefined) throw new Error('game missing')
  const colour = state.players.find((player) => player.playerId === starterPlayer.playerId)?.color
  const slot = state.board.slots[0]
  if (colour === null || colour === undefined || slot === undefined) throw new Error('no colour or slot')
  const [x, y] = slotOrigin(state.board, slot)
  state = unwrap(placePiece(state, { playerId: starterPlayer.playerId, assetId: 'tiles/america', x, y }))
  state = unwrap(
    placePiece(state, {
      playerId: starterPlayer.playerId,
      assetId: `cities/${colour.toLowerCase()}city2`,
      x: 1 * SQUARE_SIZE + 4,
      y: mapTop(state.board) + 1 * SQUARE_SIZE + 4,
    }),
  )
  const cityId = state.board.pieces.at(-1)?.id ?? ''
  const otherPlayer = state.players.find((player) => player.playerId !== starterPlayer.playerId)
  const twain = state.items.find((item) => item.kind === 'greatperson' && item.name === 'Mark Twain')
  const king = state.items.find((item) => item.kind === 'greatperson' && item.name === 'Dr. Martin Luther King')
  if (otherPlayer === undefined || twain === undefined || king === undefined) throw new Error('no Mark Twain or King card in the fixture')
  state = {
    ...state,
    items: state.items.filter((item) => item.id !== twain.id && item.id !== king.id),
    players: state.players.map((player) =>
      player.playerId === otherPlayer.playerId ? { ...player, items: [...player.items, { ...twain, hidden: true, ownerId: otherPlayer.playerId }] }
        : { ...player, items: [...player.items, { ...king, hidden: true, ownerId: player.playerId }] },
    ),
  }
  await repo.saveGame(state)
  // Through the route, so the history starts from the game with the city and the card in place
  expect((await post(starter, `/api/games/${gameId}/turns/done`, { phase: 'TRADE' })).status).toBe(200)
  return { gameId, starter, other, starterId: starterPlayer.playerId, otherId: otherPlayer.playerId, cityId, twainId: twain.id, kingId: king.id }
}

const startProgram = async (t: Table, requestId: string) =>
  post(t.starter, `/api/games/${t.gameId}/actions`, {
    action: 'startBuildingProgram',
    requestId,
    rev: (await view(t.gameId, t.starter)).rev,
    cityPieceId: t.cityId,
  })

const logIdOf = async (t: Table, requestId: string): Promise<string> => {
  const record = (await view(t.gameId, t.starter)).assistedActions.find((action) => action.id === requestId)
  if (record === undefined) throw new Error('no such action')
  return record.logId
}

const cancelWith = (token: string, t: Table, payload: Record<string, unknown>) =>
  post(token, `/api/games/${t.gameId}/cancellations`, payload)

describe('cancellation over HTTP', () => {
  it('refuses an admin participant a cancellation after the game ends without removing correction privileges', async () => {
    const t = await table('Ended')
    expect((await startProgram(t, 'sp-1')).status).toBe(200)
    await repo.updatePlayer(t.otherId, { role: 'admin' })
    expect((await post(t.other, `/api/games/${t.gameId}/end`, { winner: 'Ended-a' })).status).toBe(200)
    const before = await repo.findGame(t.gameId)
    expect(before?.active).toBe(false)
    const revisions = await repo.listGameRevisionSummaries(t.gameId)
    const response = await cancelWith(t.other, t, { itemId: t.twainId, logId: await logIdOf(t, 'sp-1'), rev: before?.rev, requestId: 'ended' })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ message: 'A cancellation cannot be made in an inactive game.' })
    expect(await repo.findGame(t.gameId)).toEqual(before)
    expect(await repo.listGameRevisionSummaries(t.gameId)).toEqual(revisions)
    expect((await post(t.other, `/api/games/${t.gameId}/note`, { note: 'Admin correction' })).status).toBe(200)
    expect((await post(t.starter, `/api/games/${t.gameId}/note`, { note: 'Not allowed' })).status).toBe(409)
  })

  it('cancels at once, saves one new revision and answers a stale retry unchanged', async () => {
    const t = await table('Rewind')
    expect((await startProgram(t, 'sp-1')).status).toBe(200)
    const logId = await logIdOf(t, 'sp-1')
    const before = await repo.findGame(t.gameId)
    expect(before?.board.pieces.some((piece) => piece.assetId === 'markers/Building Program')).toBe(true)

    const request = { itemId: t.twainId, logId, requestId: 'cancel', rev: before?.rev }
    const response = await cancelWith(t.other, t, request)
    const answer = response.status === 200 ? '' : JSON.stringify(await response.json())
    expect([response.status, answer]).toEqual([200, ''])

    const after = await repo.findGame(t.gameId)
    // The Building Program marker the action placed is gone, the action stays as cancelled and Twain is discarded
    expect(after?.board.pieces.some((piece) => piece.assetId === 'markers/Building Program')).toBe(false)
    expect(after?.assistedActions.map((record) => record.status)).toEqual(['cancelled'])
    expect(after?.players.find((player) => player.playerId === t.otherId)?.items.some((item) => item.id === t.twainId)).toBe(false)
    expect(after?.discardedItems.some((item) => item.id === t.twainId)).toBe(true)
    expect(after?.log.at(-1)?.publicLog).toContain('cancelled')
    // It is a new revision of the game, never the old counter reused
    expect(after?.rev).toBe((before?.rev ?? 0) + 1)
    expect((await view(t.gameId, t.starter)).assistedActions.map((action) => action.status)).toEqual(['cancelled'])
    // The same request again, on the old revision: answered, nothing saved
    expect((await cancelWith(t.other, t, request)).status).toBe(200)
    expect((await repo.findGame(t.gameId))?.rev).toBe(after?.rev)
  })

  it('keeps the game running: nothing pauses, and what was written before the rewind is kept', async () => {
    const t = await table('Erase')
    expect((await startProgram(t, 'sp-1')).status).toBe(200)
    const logId = await logIdOf(t, 'sp-1')
    // The other player acts after it and writes: a rewind erases the action, never the writing
    expect((await post(t.other, `/api/games/${t.gameId}/techs/choose`, { name: 'Pottery' })).status).toBe(200)
    expect((await post(t.other, `/api/games/${t.gameId}/note`, { note: 'private writing' })).status).toBe(200)
    expect((await post(t.other, `/api/games/${t.gameId}/turns/order`, { phase: 'SOT', markdown: 'Preserved order text' })).status).toBe(200)
    await post(t.starter, `/api/games/${t.gameId}/turns/done`, { phase: 'RESEARCH' })
    const rev = (await repo.findGame(t.gameId))?.rev

    expect((await cancelWith(t.other, t, { itemId: t.twainId, logId, rev, requestId: 'cancel' })).status).toBe(200)
    const restored = await repo.findGame(t.gameId)
    const other = restored?.players.find((p) => p.playerId === t.otherId)
    expect(other?.gamenote).toBe('private writing')
    expect(other?.playerTurns[0]?.orders.SOT).toBe('Preserved order text')
    expect(other?.playerTurns[0]?.needsRevision).toBe(true)
    expect(other?.techsChosen.some((tech) => tech.name === 'Pottery')).toBe(false)
    expect(restored?.players.find((p) => p.playerId === t.starterId)?.playerTurns[0]?.done.CM).toBe(false)
    // No pause: gameplay goes on right away
    expect((await post(t.other, `/api/games/${t.gameId}/techs/choose`, { name: 'Writing' })).status).toBe(200)
    expect((await post(t.other, `/api/games/${t.gameId}/chat`, { message: 'Carry on' })).status).toBe(201)
  })

  it('lets King undo the cancellation through the saved revision before it', async () => {
    const t = await table('King')
    expect((await startProgram(t, 'sp-1')).status).toBe(200)
    const logId = await logIdOf(t, 'sp-1')
    const before = await repo.findGame(t.gameId)
    expect((await cancelWith(t.other, t, { itemId: t.twainId, logId, rev: before?.rev, requestId: 'cancel' })).status).toBe(200)
    const cancelled = await repo.findGame(t.gameId)
    expect(cancelled?.board.pieces.some((piece) => piece.assetId === 'markers/Building Program')).toBe(false)

    const protect = await cancelWith(t.starter, t, { itemId: t.kingId, logId: 'cancellation:cancel', rev: cancelled?.rev, requestId: 'king' })
    const answer = protect.status === 200 ? '' : JSON.stringify(await protect.json())
    expect([protect.status, answer]).toEqual([200, ''])
    const after = await repo.findGame(t.gameId)
    expect(after?.board.pieces.some((piece) => piece.assetId === 'markers/Building Program')).toBe(true)
    expect(after?.assistedActions.map((record) => record.status)).toEqual(['applied'])
    // Twain stays in hand, King is revealed
    expect(after?.players.find((p) => p.playerId === t.otherId)?.items.some((item) => item.id === t.twainId)).toBe(true)
    expect(after?.discardedItems.some((item) => item.id === t.twainId)).toBe(false)
    expect(after?.players.find((p) => p.playerId === t.starterId)?.items.find((item) => item.id === t.kingId)?.hidden).toBe(false)
    expect(after?.rev).toBe((cancelled?.rev ?? 0) + 1)
  })

  it('is refused for a player without the card, for one\'s own action and for an unknown line', async () => {
    const t = await table('Refuse')
    expect((await startProgram(t, 'sp-1')).status).toBe(200)
    const logId = await logIdOf(t, 'sp-1')
    // The starter has no Mark Twain card, and it is their own action in any case
    const rev = (await view(t.gameId, t.other)).rev
    expect((await cancelWith(t.starter, t, { itemId: t.twainId, logId, rev, requestId: 'own' })).status).toBe(400)
    expect((await cancelWith(t.other, t, { itemId: t.twainId, logId: 'nope', rev, requestId: 'unknown' })).status).toBe(400)
    expect((await cancelWith(t.other, t, {})).status).toBe(400)
    const stale = await cancelWith(t.other, t, { itemId: t.twainId, logId, rev: 0, requestId: 'stale' })
    expect(stale.status).toBe(409)
    expect((await repo.findGame(t.gameId))?.assistedActions.map((record) => record.status)).toEqual(['applied'])
  })

  it('captures an exact before-action revision after a note-only gap and fails missing history atomically', async () => {
    const t = await table('Gap')
    expect((await post(t.starter, `/api/games/${t.gameId}/draw/CULTURE_1`, { confirmedOutOfTurn: true })).status).toBe(200)
    await post(t.starter, `/api/games/${t.gameId}/note`, { note: 'Private baseline note' })
    const baselineRev = (await view(t.gameId, t.starter)).rev
    const baseline = await repo.findGame(t.gameId)
    if (baseline === undefined) throw new Error('game missing')
    expect(baseline.log.some((entry) => entry.playerId !== null && entry.privateLog !== '' && entry.privateLog !== entry.publicLog)).toBe(true)
    expect(await repo.findGameRevision(t.gameId, baselineRev)).toBeUndefined()
    expect((await startProgram(t, 'sp-1')).status).toBe(200)
    const current = await repo.findGame(t.gameId)
    expect(current?.assistedActions[0]?.beforeRevision).toBe(baselineRev)
    const checkpoint = await repo.findGameRevision(t.gameId, baselineRev)
    expect(checkpoint?.state).toEqual(revisionSnapshot(baseline))
    expect(checkpoint).toMatchObject({
      logIds: [], privateDescriptions: {}, publicDescription: 'Before assisted action',
    })
    expect(checkpoint?.privateDescriptions).toEqual({})
    const spy = vi.spyOn(repo, 'findGameRevision').mockResolvedValue(undefined)
    const response = await cancelWith(t.other, t, {
      itemId: t.twainId, logId: await logIdOf(t, 'sp-1'), rev: current?.rev, requestId: 'missing',
    })
    expect(response.status).toBe(400)
    expect(await repo.findGame(t.gameId)).toEqual(current)
    spy.mockRestore()
    expect((await post(t.starter, `/api/games/${t.gameId}/note`, { note: 'Private later note' })).status).toBe(200)
    const later = await repo.findGame(t.gameId)
    if (later === undefined) throw new Error('game missing')
    expect((await post(t.starter, `/api/games/${t.gameId}/actions`, {
      action: 'devoteToTheArts', requestId: 'later', rev: later.rev, cityPieceId: t.cityId, confirmedRepeat: true,
    })).status).toBe(200)
    const laterCheckpoint = await repo.findGameRevision(t.gameId, later.rev)
    expect(laterCheckpoint?.state).toEqual(revisionSnapshot(later))
    expect(laterCheckpoint).toMatchObject({
      logIds: [], privateDescriptions: {}, publicDescription: 'Before assisted action',
    })
    expect(laterCheckpoint?.privateDescriptions).toEqual({})
    expect((await cancelWith(t.other, t, {
      itemId: t.twainId, logId: await logIdOf(t, 'sp-1'), rev: (await view(t.gameId, t.other)).rev, requestId: 'cancel',
    })).status).toBe(200)
    const done = await repo.findGame(t.gameId)
    expect(done?.players.find((p) => p.playerId === t.starterId)?.gamenote).toBe('Private later note')
  })

  it('hides saved revisions and request data from public and opponent projections, and refuses a spectator', async () => {
    const t = await table('Privacy')
    await startProgram(t, 'sp-1')
    await cancelWith(t.other, t, {
      itemId: t.twainId, logId: await logIdOf(t, 'sp-1'), rev: (await view(t.gameId, t.other)).rev, requestId: 'cancel',
    })
    for (const response of [
      await inject(app, { url: `/api/games/${t.gameId}` }),
      await inject(app, { url: `/api/games/${t.gameId}`, headers: bearer(t.starter) }),
    ]) {
      expect(response.status).toBe(200)
      const text = JSON.stringify(await response.json())
      for (const secret of ['beforeRevision', 'priorRevision', 'fingerprint']) expect(text).not.toContain(secret)
    }
    const outsider = await register('outsider')
    const spectator = await cancelWith(outsider, t, {
      itemId: t.twainId, logId: await logIdOf(t, 'sp-1'), requestId: 'spectator', rev: (await view(t.gameId, t.other)).rev,
    })
    expect(spectator.status).toBe(403)
    expect((await post(outsider, `/api/games/${t.gameId}/chat`, { message: 'Not a participant' })).status).toBe(403)
  })
})
