/**
 * Mark Twain over HTTP (issue #301): `POST /api/games/:id/twain` cancels another player's city action and rewinds the
 * game to the stored revision before it. The rules are in `packages/engine/test/great-person-twain.test.ts`; these
 * check the wiring: the revision lookup, the refusal when somebody else has saved a revision since, and that the game
 * is saved as a new revision with the cancelled action on the record.
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
  if (otherPlayer === undefined || twain === undefined) throw new Error('no Mark Twain card in the fixture')
  state = {
    ...state,
    items: state.items.filter((item) => item.id !== twain.id),
    players: state.players.map((player) =>
      player.playerId === otherPlayer.playerId ? { ...player, items: [...player.items, { ...twain, hidden: true, ownerId: otherPlayer.playerId }] } : player,
    ),
  }
  await repo.saveGame(state)
  // Through the route, so the history starts from the game with the city and the card in place
  expect((await post(starter, `/api/games/${gameId}/turns/done`, { phase: 'TRADE' })).status).toBe(200)
  return { gameId, starter, other, starterId: starterPlayer.playerId, otherId: otherPlayer.playerId, cityId, twainId: twain.id }
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

describe('Mark Twain over HTTP', () => {
  it('refuses an admin participant a new case after the game ends without removing correction privileges', async () => {
    const t = await table('Ended')
    expect((await startProgram(t, 'sp-1')).status).toBe(200)
    await repo.updatePlayer(t.otherId, { role: 'admin' })
    expect((await post(t.other, `/api/games/${t.gameId}/end`, { winner: 'Ended-a' })).status).toBe(200)
    const before = await repo.findGame(t.gameId)
    expect(before?.active).toBe(false)
    const revisions = await repo.listGameRevisionSummaries(t.gameId)
    for (const path of ['twain', 'cancellations']) {
      const response = await post(t.other, `/api/games/${t.gameId}/${path}`, {
        kind: 'open', itemId: t.twainId, logId: await logIdOf(t, 'sp-1'), rev: before?.rev, requestId: `ended-${path}`,
      })
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ message: 'A cancellation cannot be opened in an inactive game.' })
      expect(await repo.findGame(t.gameId)).toEqual(before)
      expect(await repo.listGameRevisionSummaries(t.gameId)).toEqual(revisions)
    }
    expect((await post(t.other, `/api/games/${t.gameId}/note`, { note: 'Admin correction' })).status).toBe(200)
    expect((await post(t.starter, `/api/games/${t.gameId}/note`, { note: 'Not allowed' })).status).toBe(409)
  })

  it('opens a persistent case and only rewinds after everyone passes, with stale-request retries idempotent', async () => {
    const t = await table('Rewind')
    expect((await startProgram(t, 'sp-1')).status).toBe(200)
    const logId = await logIdOf(t, 'sp-1')
    const before = await repo.findGame(t.gameId)
    expect(before?.board.pieces.some((piece) => piece.assetId === 'markers/Building Program')).toBe(true)

    const opening = { logId, requestId: 'open', rev: before?.rev }
    const response = await post(t.other, `/api/games/${t.gameId}/twain`, opening)
    const answer = response.status === 200 ? '' : JSON.stringify(await response.json())
    expect([response.status, answer]).toEqual([200, ''])

    const pending = await repo.findGame(t.gameId)
    expect(pending?.board).toEqual(before?.board)
    expect(pending?.items).toEqual(before?.items)
    expect(pending?.cancellations?.cases[0]).toMatchObject({ id: 'open', version: 1, outcome: 'pending', passes: [] })
    expect((await post(t.other, `/api/games/${t.gameId}/twain`, opening)).status).toBe(200)
    expect((await repo.findGame(t.gameId))?.rev).toBe(pending?.rev)
    expect((await post(t.starter, `/api/games/${t.gameId}/cancellations`, {
      kind: 'pass', caseId: 'open', version: 1, requestId: 'pass-a', rev: pending?.rev,
    })).status).toBe(200)
    const final = { kind: 'pass', caseId: 'open', version: 1, requestId: 'pass-b', rev: (await view(t.gameId, t.other)).rev }
    expect((await post(t.other, `/api/games/${t.gameId}/cancellations`, final)).status).toBe(200)
    const after = await repo.findGame(t.gameId)
    // The Building Program marker the action placed is gone, the action stays as cancelled and Twain is discarded
    expect(after?.board.pieces.some((piece) => piece.assetId === 'markers/Building Program')).toBe(false)
    expect(after?.assistedActions.map((record) => record.status)).toEqual(['cancelled'])
    expect(after?.players.find((player) => player.playerId === t.otherId)?.items.some((item) => item.id === t.twainId)).toBe(false)
    expect(after?.discardedItems.some((item) => item.id === t.twainId)).toBe(true)
    expect(after?.log.at(-1)?.publicLog).toContain('Cancellation settled')
    // It is a new revision of the game, never the old counter reused
    expect(after?.rev).toBe((before?.rev ?? 0) + 3)
    const seen = await view(t.gameId, t.starter)
    expect(seen.assistedActions.map((action) => action.status)).toEqual(['cancelled'])
    expect((await post(t.other, `/api/games/${t.gameId}/cancellations`, final)).status).toBe(200)
    expect((await post(t.other, `/api/games/${t.gameId}/twain`, opening)).status).toBe(200)
    expect((await repo.findGame(t.gameId))?.rev).toBe(after?.rev)
    await repo.updatePlayer(t.otherId, { role: 'admin' })
    expect((await post(t.other, `/api/games/${t.gameId}/end`, { winner: 'Rewind-a' })).status).toBe(200)
    const ended = await repo.findGame(t.gameId)
    expect((await post(t.other, `/api/games/${t.gameId}/twain`, opening)).status).toBe(200)
    expect((await post(t.other, `/api/games/${t.gameId}/cancellations`, final)).status).toBe(200)
    expect(await repo.findGame(t.gameId)).toEqual(ended)
  })

  it('allows interleaved revisions but pauses gameplay mutations, while notes, orders and chat stay available', async () => {
    const t = await table('Erase')
    expect((await startProgram(t, 'sp-1')).status).toBe(200)
    const logId = await logIdOf(t, 'sp-1')
    // The other player acts after it: a rewind would erase their action
    expect((await post(t.other, `/api/games/${t.gameId}/techs/choose`, { name: 'Pottery' })).status).toBe(200)
    await post(t.starter, `/api/games/${t.gameId}/turns/done`, { phase: 'RESEARCH' })
    const before = await repo.findGame(t.gameId)
    const rev = before?.rev

    const response = await post(t.other, `/api/games/${t.gameId}/twain`, { logId, rev, requestId: 'open' })
    expect(response.status).toBe(200)
    for (const [path, payload] of [
      ['techs/choose', { name: 'Writing' }],
      ['draw/CULTURE_1', {}],
      ['turns/done', { phase: 'CM' }],
      ['turns/undone', { phase: 'TRADE', rev: (rev ?? 0) + 1 }],
      ['items/discard', { sheetName: 'GREAT_PERSON', name: 'Mark Twain' }],
      ['end', {}], ['withdraw', {}], ['delete', {}],
    ] as const) {
      expect((await post(t.other, `/api/games/${t.gameId}/${path}`, payload)).status, path).toBe(409)
    }
    expect((await post(t.other, `/api/games/${t.gameId}/note`, { note: 'private writing' })).status).toBe(200)
    expect((await post(t.other, `/api/games/${t.gameId}/turns/order`, { phase: 'SOT', markdown: 'Preserved order text' })).status).toBe(200)
    expect((await post(t.other, `/api/games/${t.gameId}/chat`, { message: 'Discuss the dispute' })).status).toBe(201)
    for (const [token, requestId] of [[t.starter, 'pass-a'], [t.other, 'pass-b']] as const) {
      expect((await post(token, `/api/games/${t.gameId}/cancellations`, {
        kind: 'pass', caseId: 'open', version: 1, requestId, rev: (await view(t.gameId, token)).rev,
      })).status).toBe(200)
    }
    const restored = await repo.findGame(t.gameId)
    const other = restored?.players.find((p) => p.playerId === t.otherId)
    expect(other?.gamenote).toBe('private writing')
    expect(other?.playerTurns[0]?.orders.SOT).toBe('Preserved order text')
    expect(other?.playerTurns[0]?.needsRevision).toBe(true)
    expect(other?.techsChosen.some((tech) => tech.name === 'Pottery')).toBe(false)
    expect(restored?.players.find((p) => p.playerId === t.starterId)?.playerTurns[0]?.done.CM).toBe(false)
  })

  it('is refused for a player without the card, for one\'s own action and for an unknown line', async () => {
    const t = await table('Refuse')
    expect((await startProgram(t, 'sp-1')).status).toBe(200)
    const logId = await logIdOf(t, 'sp-1')
    // The starter has no Mark Twain card, and it is their own action in any case
    const rev = (await view(t.gameId, t.other)).rev
    expect((await post(t.starter, `/api/games/${t.gameId}/twain`, { logId, rev, requestId: 'own' })).status).toBe(400)
    expect((await post(t.other, `/api/games/${t.gameId}/twain`, { logId: 'nope', rev, requestId: 'unknown' })).status).toBe(400)
    expect((await post(t.other, `/api/games/${t.gameId}/twain`, {})).status).toBe(400)
    const stale = await post(t.other, `/api/games/${t.gameId}/twain`, { logId, rev: 0, requestId: 'stale' })
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
    const response = await post(t.other, `/api/games/${t.gameId}/twain`, {
      logId: await logIdOf(t, 'sp-1'), rev: current?.rev, requestId: 'missing',
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
    expect((await post(t.other, `/api/games/${t.gameId}/twain`, {
      logId: await logIdOf(t, 'sp-1'), rev: (await view(t.gameId, t.other)).rev, requestId: 'open',
    })).status).toBe(200)
    const pending = await repo.findGame(t.gameId)
    const affected = pending?.cancellations?.cases[0]?.affected
    expect(affected).toContain('Before assisted action')
    for (const log of baseline.log.filter((entry) => entry.publicLog !== '')) {
      expect(affected?.join(' · ')).not.toContain(log.publicLog)
    }
    expect(JSON.stringify(affected)).not.toContain('Private')
    expect(pending?.players.find((p) => p.playerId === t.starterId)?.gamenote).toBe('Private later note')
  })

  it('does not settle a final pass without its saved continuation and baseline', async () => {
    const t = await table('Missing final')
    await startProgram(t, 'sp-1')
    await post(t.other, `/api/games/${t.gameId}/twain`, {
      logId: await logIdOf(t, 'sp-1'), rev: (await view(t.gameId, t.other)).rev, requestId: 'open',
    })
    await post(t.starter, `/api/games/${t.gameId}/cancellations`, {
      kind: 'pass', caseId: 'open', version: 1, requestId: 'pass-a', rev: (await view(t.gameId, t.starter)).rev,
    })
    const before = await repo.findGame(t.gameId)
    const spy = vi.spyOn(repo, 'findGameRevision').mockResolvedValue(undefined)
    const response = await post(t.other, `/api/games/${t.gameId}/cancellations`, {
      kind: 'pass', caseId: 'open', version: 1, requestId: 'pass-b', rev: before?.rev,
    })
    expect(response.status).toBe(409)
    expect(await repo.findGame(t.gameId)).toEqual(before)
    spy.mockRestore()
  })

  it('hides saved revisions, response hands and request data from public and opponent projections', async () => {
    const t = await table('Privacy')
    await startProgram(t, 'sp-1')
    await post(t.other, `/api/games/${t.gameId}/twain`, {
      logId: await logIdOf(t, 'sp-1'), rev: (await view(t.gameId, t.other)).rev, requestId: 'open',
    })
    for (const response of [
      await inject(app, { url: `/api/games/${t.gameId}` }),
      await inject(app, { url: `/api/games/${t.gameId}`, headers: bearer(t.starter) }),
    ]) {
      expect(response.status).toBe(200)
      const text = JSON.stringify(await response.json())
      for (const secret of ['beforeRevision', 'continuationRevision', 'fingerprint', t.twainId]) expect(text).not.toContain(secret)
    }
    const outsider = await register('outsider')
    const spectator = await post(outsider, `/api/games/${t.gameId}/cancellations`, {
      kind: 'pass', caseId: 'open', version: 1, requestId: 'spectator', rev: (await view(t.gameId, t.other)).rev,
    })
    expect(spectator.status).toBe(403)
    expect((await post(outsider, `/api/games/${t.gameId}/chat`, { message: 'Not a participant' })).status).toBe(403)
  })
})
