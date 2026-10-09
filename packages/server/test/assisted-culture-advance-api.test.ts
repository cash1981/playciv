/**
 * The culture advance and the choice of reward over HTTP: the same route as
 * every assisted action, with a payload for `chooseReward`. The rules are in
 * `packages/engine/test/assisted-culture-advance.test.ts`; these check the
 * wiring, the status codes, that a refresh resumes the choice, and above all that
 * nothing about the drawn cards reaches another client.
 */

import type { App } from '../src/app.js'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  cultureCellCenter,
  findBoardAsset,
  itemName,
  leaderAssetId,
  placePiece,
  unwrap,
} from '@civ/engine'
import type { CivItem, GameState, Item } from '@civ/engine'

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
  readonly numberOfItemsInDeck: number
  readonly winner: string | null
  readonly active: boolean
  readonly you: {
    readonly playerId: string
    readonly stats: { readonly culture: number; readonly trade: number }
    readonly cultureMarkerLevel: number | null
    readonly items: readonly { readonly id: string; readonly name: string }[]
    readonly pendingRewards: readonly {
      readonly id: string
      readonly step: number
      readonly candidates: readonly { readonly id: string; readonly name: string }[]
    }[]
    readonly availableActions: readonly { action: string; status: string; reason: string }[]
  } | null
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

const view = async (gameId: string, token?: string): Promise<View> =>
  (await inject(app, { url: `/api/games/${gameId}`, ...(token === undefined ? {} : { headers: bearer(token) }) })).json<View>()

const post = (token: string, url: string, payload: unknown) =>
  inject(app, { method: 'POST', url, headers: bearer(token), payload })

interface Table {
  readonly gameId: string
  readonly starter: string
  readonly other: string
  readonly starterId: string
}

interface TableOptions {
  readonly step?: number
  readonly culture?: number
  readonly trade?: number
  readonly mysticism?: boolean
  /** Leave City Management closed. */
  readonly closed?: boolean
}

/**
 * A started two-player game where the starter has a civilization, their leader on
 * `step`, the given culture and trade, and City Management open.
 */
async function cultureTable(name: string, options: TableOptions = {}): Promise<Table> {
  const creator = await register(`${name}-a`)
  const created = await inject(app, {
    method: 'POST', url: '/api/games', headers: bearer(creator), payload: { name, numOfPlayers: 2 },
  })
  const gameId = (await created.json() as { id: string }).id
  const joiner = await register(`${name}-b`)
  await post(joiner, `/api/games/${gameId}/join`, {})

  const found = await repo.findGame(gameId)
  const starter = found?.players.find((player) => player.yourTurn)?.username === `${name}-a` ? creator : joiner
  const other = starter === creator ? joiner : creator
  const starterId = (await view(gameId, starter)).you?.playerId as string

  if (options.mysticism === true) {
    expect((await post(starter, `/api/games/${gameId}/techs/choose`, { name: 'Mysticism' })).status).toBe(200)
    expect((await post(starter, `/api/games/${gameId}/techs/reveal`, { name: 'Mysticism' })).status).toBe(200)
  }
  if (options.closed !== true) {
    expect((await post(starter, `/api/games/${gameId}/turns/done`, { phase: 'TRADE' })).status).toBe(200)
  }

  const state = await repo.findGame(gameId)
  if (state === undefined) throw new Error('game missing')
  const color = state.players.find((player) => player.playerId === starterId)?.color
  const assetId = color === null || color === undefined ? undefined : leaderAssetId('Japanese', color)
  const asset = assetId === undefined ? undefined : findBoardAsset(assetId)
  if (assetId === undefined || asset === undefined) throw new Error('no leader artwork for the starter')
  const centre = cultureCellCenter(state.board, options.step ?? 0)
  const withCiv: GameState = {
    ...state,
    players: state.players.map((player) =>
      player.playerId === starterId
        ? {
            ...player,
            civilization: { kind: 'civ', name: 'Japanese' } as unknown as CivItem,
            stats: { ...player.stats, culture: options.culture ?? 100, trade: options.trade ?? 100 },
          }
        : player,
    ),
  }
  await repo.saveGame(
    unwrap(placePiece(withCiv, { playerId: starterId, assetId, x: Math.round(centre.x - asset.width / 2), y: 10 })),
  )
  return { gameId, starter, other, starterId }
}

const advance = (table: Table, requestId: string, rev: number, token = table.starter) =>
  post(token, `/api/games/${table.gameId}/actions`, { action: 'cultureAdvance', requestId, rev })

const choose = (table: Table, requestId: string, rewardId: string, itemId: string, rev: number, token = table.starter) =>
  post(token, `/api/games/${table.gameId}/actions`, { action: 'chooseReward', requestId, rewardId, itemId, rev })

/** The stored candidates of the starter's pending reward, with names. */
async function storedCandidates(table: Table): Promise<readonly Item[]> {
  const state = await repo.findGame(table.gameId)
  const player = state?.players.find((candidate) => candidate.playerId === table.starterId)
  const reward = player?.pendingRewards[0]
  if (player === undefined || reward === undefined) return []
  return reward.candidateIds.map((id) => player.items.find((item) => item.id === id) as Item)
}

const stored = async (table: Table): Promise<GameState> => {
  const state = await repo.findGame(table.gameId)
  if (state === undefined) throw new Error('game missing')
  return state
}

describe('advancing over HTTP', () => {
  it('pays the cost of the level, moves the marker and returns the projection', async () => {
    const table = await cultureTable('Cost', { step: 7 })
    const before = await view(table.gameId, table.starter)
    expect(before.you?.availableActions.find((entry) => entry.action === 'cultureAdvance')).toMatchObject({
      status: 'ready',
      reason: 'Advance to space 8 (culture II event): 5 culture and 3 trade.',
    })

    const response = await advance(table, 'req-1', before.rev)

    expect(response.status).toBe(200)
    const after = await response.json<View>()
    expect(after.rev).toBe(before.rev + 1)
    expect(after.you?.stats).toMatchObject({ culture: 95, trade: 97 })
    expect(after.you?.cultureMarkerLevel).toBe(8)
    expect(after.you?.pendingRewards).toEqual([])
    expect(after.you?.items).toHaveLength(1)
    expect(after.assistedActions).toEqual([
      expect.objectContaining({
        id: 'req-1', kind: 'cultureAdvance', status: 'applied',
        text: expect.stringMatching(/^.+ advanced on the culture track to space 8 and drew 1 culture II card$/),
      }),
    ])
  })

  it('can be repeated in a turn, each press with its own request id', async () => {
    const table = await cultureTable('Repeat')
    const first = await (await advance(table, 'req-1', (await view(table.gameId, table.starter)).rev)).json<View>()
    const second = await advance(table, 'req-2', first.rev)
    expect(second.status).toBe(200)
    const after = await second.json<View>()
    expect(after.you?.cultureMarkerLevel).toBe(2)
    expect(after.you?.stats.culture).toBe(94)
  })

  it('refuses when culture is short, outside City Management and at step 21, and changes nothing', async () => {
    const short = await cultureTable('Short', { step: 7, culture: 4 })
    const shortRev = (await view(short.gameId, short.starter)).rev
    const refusedShort = await advance(short, 'req-1', shortRev)
    expect(refusedShort.status).toBe(400)
    expect(await refusedShort.json()).toMatchObject({
      error: 'ASSISTED_ACTION_REJECTED',
      message: expect.stringContaining('You are missing 1 culture.'),
    })
    expect((await view(short.gameId, short.starter)).rev).toBe(shortRev)

    const closed = await cultureTable('Closed', { closed: true })
    const refusedClosed = await advance(closed, 'req-1', (await view(closed.gameId, closed.starter)).rev)
    expect(refusedClosed.status).toBe(400)
    expect(await refusedClosed.json()).toMatchObject({ error: 'ASSISTED_ACTION_REJECTED' })
    expect((await view(closed.gameId, closed.starter)).you?.cultureMarkerLevel).toBe(0)

    const last = await cultureTable('Last', { step: 21 })
    const refusedLast = await advance(last, 'req-1', (await view(last.gameId, last.starter)).rev)
    expect(refusedLast.status).toBe(400)
    expect(JSON.stringify(await refusedLast.json())).toContain('Culture Victory space')
  })

  it('a stale rev is a 409 and changes nothing', async () => {
    const table = await cultureTable('Stale')
    const rev = (await view(table.gameId, table.starter)).rev
    const stale = await advance(table, 'req-1', rev - 1)
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ error: 'CONFLICT' })
    expect((await view(table.gameId, table.starter)).you?.cultureMarkerLevel).toBe(0)
  })

  it('step 21 writes the Culture Victory line and ends nothing', async () => {
    const table = await cultureTable('Victory', { step: 20 })
    const response = await advance(table, 'req-1', (await view(table.gameId, table.starter)).rev)
    expect(response.status).toBe(200)
    const after = await response.json<View>()
    expect(after.you?.cultureMarkerLevel).toBe(21)
    expect(after.winner).toBeNull()
    expect(after.active).toBe(true)
    const log = await inject(app, { url: `/api/games/${table.gameId}/log/public`, headers: bearer(table.other) })
    expect(log.body).toContain('has reached the Culture Victory space on the culture track')
    expect((await stored(table)).winner).toBeNull()
  })

  it('two parallel presses with the same request id have one effect', async () => {
    const table = await cultureTable('Parallel')
    const rev = (await view(table.gameId, table.starter)).rev
    const [first, second] = await Promise.all([advance(table, 'req-1', rev), advance(table, 'req-1', rev)])

    // One of them wins; the other is a no-op or a 409 for the stale rev, never a second effect
    expect([first.status, second.status].filter((status) => status === 200).length).toBeGreaterThanOrEqual(1)
    for (const status of [first.status, second.status]) expect([200, 409]).toContain(status)
    const state = await stored(table)
    expect(state.assistedActions).toHaveLength(1)
    const player = state.players.find((candidate) => candidate.playerId === table.starterId)
    expect(player?.stats.culture).toBe(97)
    expect(player?.items).toHaveLength(1)
    expect((await view(table.gameId, table.starter)).you?.cultureMarkerLevel).toBe(1)
  })
})

describe('a choice of reward over HTTP', () => {
  it('a refresh resumes the same choice and draws nothing', async () => {
    const table = await cultureTable('Refresh', { mysticism: true })
    const response = await advance(table, 'req-1', (await view(table.gameId, table.starter)).rev)
    expect(response.status).toBe(200)
    const pressed = await response.json<View>()
    expect(pressed.you?.pendingRewards).toHaveLength(1)
    expect(pressed.you?.pendingRewards[0]?.candidates).toHaveLength(2)

    const refreshed = await view(table.gameId, table.starter)
    const again = await view(table.gameId, table.starter)
    expect(refreshed.you?.pendingRewards).toEqual(pressed.you?.pendingRewards)
    expect(again.you?.pendingRewards).toEqual(pressed.you?.pendingRewards)
    expect(again.numberOfItemsInDeck).toBe(pressed.numberOfItemsInDeck)
    expect(again.rev).toBe(pressed.rev)

    // A retry of the press from a tab that missed the answer draws nothing either
    const retry = await advance(table, 'req-1', pressed.rev)
    expect(retry.status).toBe(200)
    const retried = await retry.json<View>()
    expect(retried.you?.pendingRewards).toEqual(pressed.you?.pendingRewards)
    expect(retried.rev).toBe(pressed.rev)
    expect((await stored(table)).assistedActions).toHaveLength(1)
  })

  it('refuses a second advance while the choice is pending, and allows it after the choice', async () => {
    const table = await cultureTable('Pending', { mysticism: true })
    const pressed = await (await advance(table, 'req-1', (await view(table.gameId, table.starter)).rev)).json<View>()
    const blocked = await advance(table, 'req-2', pressed.rev)
    expect(blocked.status).toBe(400)
    expect(JSON.stringify(await blocked.json())).toContain('Choose the card to keep')

    const [keep] = pressed.you?.pendingRewards[0]?.candidates ?? []
    const chosen = await choose(table, 'req-3', 'req-1', keep?.id ?? '', pressed.rev)
    expect(chosen.status).toBe(200)
    const after = await chosen.json<View>()
    expect(after.you?.pendingRewards).toEqual([])
    expect(after.you?.items.map((item) => item.id)).toEqual([keep?.id])
    expect(after.assistedActions.map((entry) => entry.id)).toEqual(['req-1'])
    expect((await advance(table, 'req-4', after.rev)).status).toBe(200)
  })

  it('chooseReward is idempotent, refuses a stale or unknown reward and validates its body', async () => {
    const table = await cultureTable('Choose', { mysticism: true })
    const pressed = await (await advance(table, 'req-1', (await view(table.gameId, table.starter)).rev)).json<View>()
    const [keep, other] = pressed.you?.pendingRewards[0]?.candidates ?? []

    // Strict body: both ids, plain characters, and only for chooseReward
    const missing = await post(table.starter, `/api/games/${table.gameId}/actions`, {
      action: 'chooseReward', requestId: 'req-2', rewardId: 'req-1',
    })
    expect(missing.status).toBe(400)
    const odd = await choose(table, 'req-2', 'req 1', keep?.id ?? '', pressed.rev)
    expect(odd.status).toBe(400)
    const stray = await post(table.starter, `/api/games/${table.gameId}/actions`, {
      action: 'cultureAdvance', requestId: 'req-2', rewardId: 'req-1', itemId: keep?.id,
    })
    expect(stray.status).toBe(400)

    // An unknown reward is a clear 400 and changes nothing
    const unknown = await choose(table, 'req-2', 'no-such-reward', keep?.id ?? '', pressed.rev)
    expect(unknown.status).toBe(400)
    expect(JSON.stringify(await unknown.json())).toContain('not waiting any more')
    // A card that is not a candidate
    const wrongCard = await choose(table, 'req-2', 'req-1', 'ffffffffffffffff', pressed.rev)
    expect(wrongCard.status).toBe(400)
    // A stale rev
    expect((await choose(table, 'req-2', 'req-1', keep?.id ?? '', pressed.rev - 1)).status).toBe(409)
    expect((await view(table.gameId, table.starter)).you?.pendingRewards).toHaveLength(1)

    const ok = await choose(table, 'req-2', 'req-1', keep?.id ?? '', pressed.rev)
    expect(ok.status).toBe(200)
    const done = await ok.json<View>()
    expect(done.you?.items.map((item) => item.id)).toEqual([keep?.id])
    expect((await stored(table)).discardedItems.map((item) => item.id)).toContain(other?.id)

    // The same request id again is a no-op, a new one for the same reward is stale
    const retry = await choose(table, 'req-2', 'req-1', keep?.id ?? '', done.rev)
    expect(retry.status).toBe(200)
    expect((await retry.json<View>()).rev).toBe(done.rev)
    const stale = await choose(table, 'req-9', 'req-1', keep?.id ?? '', done.rev)
    expect(stale.status).toBe(400)
  })

  it('the other player cannot choose for the starter', async () => {
    const table = await cultureTable('Theft', { mysticism: true })
    const pressed = await (await advance(table, 'req-1', (await view(table.gameId, table.starter)).rev)).json<View>()
    const [keep] = pressed.you?.pendingRewards[0]?.candidates ?? []
    const response = await choose(table, 'req-2', 'req-1', keep?.id ?? '', pressed.rev, table.other)
    expect(response.status).toBe(400)
    expect((await view(table.gameId, table.starter)).you?.pendingRewards).toHaveLength(1)
  })
})

describe('what other clients receive', () => {
  it('another player, a spectator and an anonymous viewer get no candidate, no pending reward and no card name; the owner does', async () => {
    const table = await cultureTable('Hidden', { mysticism: true })
    const pressed = await (await advance(table, 'req-1', (await view(table.gameId, table.starter)).rev)).json<View>()
    const candidates = await storedCandidates(table)
    expect(candidates).toHaveLength(2)
    const secrets = candidates.flatMap((item) => [item.id, itemName(item)])
    const spectator = await register('hidden-spectator')
    const logId = pressed.assistedActions[0]?.logId as string

    const urls = [
      `/api/games/${table.gameId}`,
      `/api/games/${table.gameId}/log/public`,
      `/api/games/${table.gameId}/log/private`,
      `/api/games/${table.gameId}/undo/pending`,
      `/api/games/${table.gameId}/revisions`,
    ]
    for (const token of [table.other, spectator, undefined]) {
      for (const url of urls) {
        const response = await inject(app, { url, ...(token === undefined ? {} : { headers: bearer(token) }) })
        for (const secret of secrets) expect(response.body).not.toContain(secret)
        expect(response.body).not.toContain('candidateIds')
        expect(response.body).not.toContain('"effect"')
      }
      // Every stored revision, as that viewer sees it
      const list = (await (await inject(app, {
        url: `/api/games/${table.gameId}/revisions`,
        ...(token === undefined ? {} : { headers: bearer(token) }),
      })).json()) as readonly { revision: number }[]
      for (const entry of list) {
        const revision = await inject(app, {
          url: `/api/games/${table.gameId}/revisions/${entry.revision}`,
          ...(token === undefined ? {} : { headers: bearer(token) }),
        })
        for (const secret of secrets) expect(revision.body).not.toContain(secret)
        expect(revision.body).not.toContain('candidateIds')
      }
    }
    // Not even a count of the choice reaches an opponent or a spectator
    const asOther = await inject(app, { url: `/api/games/${table.gameId}`, headers: bearer(table.other) })
    expect(JSON.stringify((await asOther.json<{ opponents: unknown }>()).opponents)).not.toContain('pendingRewards')
    expect((await view(table.gameId, table.other)).you?.pendingRewards).toEqual([])
    expect((await inject(app, { url: `/api/games/${table.gameId}` })).body).not.toContain('pendingRewards')

    // The public line says only how many cards were drawn, and the undo target is that line
    const publicLog = await inject(app, { url: `/api/games/${table.gameId}/log/public`, headers: bearer(table.other) })
    expect(publicLog.body).toContain('advanced on the culture track to space 1 and drew 2 culture I cards')
    expect(publicLog.body).toContain(logId)

    // The owner has the choice with the cards, and the private line naming them
    const mine = await view(table.gameId, table.starter)
    expect(mine.you?.pendingRewards[0]?.candidates.map((item) => item.id)).toEqual(candidates.map((item) => item.id))
    const privateLog = await inject(app, { url: `/api/games/${table.gameId}/log/private`, headers: bearer(table.starter) })
    for (const item of candidates) expect(privateLog.body).toContain(itemName(item))
    const revisions = await inject(app, { url: `/api/games/${table.gameId}/revisions/${pressed.rev}`, headers: bearer(table.starter) })
    expect(revisions.body).toContain(candidates[0]?.id ?? 'missing')
    // A replay is the past: the owner's hand shows in it, but the choice cannot be made from it
    expect((await revisions.json<{ view: View }>()).view.you?.pendingRewards).toEqual([])
  })

  it('after the choice the public line says only that a card was kept', async () => {
    const table = await cultureTable('Kept', { mysticism: true })
    const pressed = await (await advance(table, 'req-1', (await view(table.gameId, table.starter)).rev)).json<View>()
    const candidates = await storedCandidates(table)
    const chosen = await choose(table, 'req-2', 'req-1', candidates[0]?.id ?? '', pressed.rev)
    expect(chosen.status).toBe(200)

    const publicLog = await inject(app, { url: `/api/games/${table.gameId}/log/public`, headers: bearer(table.other) })
    expect(publicLog.body).toContain('kept a card')
    for (const item of candidates) expect(publicLog.body).not.toContain(itemName(item))
    const privateLog = await inject(app, { url: `/api/games/${table.gameId}/log/private`, headers: bearer(table.starter) })
    expect(privateLog.body).toContain(`kept ${itemName(candidates[0] as Item)}`)
    const revisions = await inject(app, { url: `/api/games/${table.gameId}/revisions`, headers: bearer(table.other) })
    for (const item of candidates) expect(revisions.body).not.toContain(itemName(item))
  })
})

describe('undo over HTTP', () => {
  const askAndVote = async (table: Table, logId: string) => {
    expect((await post(table.other, `/api/games/${table.gameId}/undo/${logId}`, {})).status).toBe(200)
    return post(table.starter, `/api/games/${table.gameId}/undo/${logId}/vote`, { vote: true })
  }

  it('before the choice: marker, culture, trade and both cards are back and the choice is gone', async () => {
    const table = await cultureTable('UndoPending', { mysticism: true, step: 7 })
    const before = await stored(table)
    const pressed = await (await advance(table, 'req-1', (await view(table.gameId, table.starter)).rev)).json<View>()
    expect(pressed.you?.pendingRewards).toHaveLength(1)

    const voted = await askAndVote(table, pressed.assistedActions[0]?.logId as string)

    expect(voted.status).toBe(200)
    const after = await voted.json<View>()
    expect(after.you?.pendingRewards).toEqual([])
    expect(after.you?.items).toEqual([])
    expect(after.you?.cultureMarkerLevel).toBe(7)
    expect(after.you?.stats).toMatchObject({ culture: 100, trade: 100 })
    expect(after.assistedActions[0]?.status).toBe('undone')
    expect((await stored(table)).items).toHaveLength(before.items.length)
  })

  it('after the choice: the kept card and the discarded one go back to the deck', async () => {
    const table = await cultureTable('UndoChosen', { mysticism: true })
    const before = await stored(table)
    const pressed = await (await advance(table, 'req-1', (await view(table.gameId, table.starter)).rev)).json<View>()
    const candidates = await storedCandidates(table)
    const chosen = await (await choose(table, 'req-2', 'req-1', candidates[0]?.id ?? '', pressed.rev)).json<View>()
    expect(chosen.you?.items).toHaveLength(1)

    const voted = await askAndVote(table, pressed.assistedActions[0]?.logId as string)

    expect(voted.status).toBe(200)
    const after = await stored(table)
    expect(after.items).toHaveLength(before.items.length)
    expect(after.discardedItems).toHaveLength(before.discardedItems.length)
    expect(after.players.find((player) => player.playerId === table.starterId)?.items).toEqual([])
    expect((await voted.json<View>()).you?.cultureMarkerLevel).toBe(0)
  })

  it('the board Undo refuses the marker move of an applied advance', async () => {
    const table = await cultureTable('BoardUndo')
    const pressed = await (await advance(table, 'req-1', (await view(table.gameId, table.starter)).rev)).json<View>()
    const refused = await post(table.starter, `/api/games/${table.gameId}/board/undo`, {})
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ error: 'BOARD_UNDO_ASSISTED' })
    expect((await view(table.gameId, table.starter)).you?.cultureMarkerLevel).toBe(1)
    expect((await view(table.gameId, table.starter)).rev).toBe(pressed.rev)
  })
})
