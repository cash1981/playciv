/**
 * The Great Person space of the culture advance over HTTP: the marker taken into
 * the player's area, the faceup discards, the private choice for the Greeks, the
 * vote undo and the board Undo, and above all what another client can and cannot
 * read. The rules are in `packages/engine/test/assisted-gp.test.ts`.
 */

import type { App } from '../src/app.js'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  GREAT_PERSON_CARD_TYPES,
  areaAt,
  cultureCellCenter,
  findBoardAsset,
  itemName,
  leaderAssetId,
  mapTop,
  placePiece,
  playerAreas,
  unwrap,
} from '@civ/engine'
import type { BoardPiece, CivItem, GameState, Item } from '@civ/engine'

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
    readonly stats: { readonly culture: number; readonly trade: number }
    readonly cultureMarkerLevel: number | null
    readonly items: readonly { readonly id: string; readonly name: string }[]
    readonly pendingRewards: readonly {
      readonly id: string
      readonly candidates: readonly { readonly id: string; readonly name: string }[]
    }[]
  } | null
  readonly board: { readonly pieces: readonly { readonly id: string; readonly assetId: string }[] }
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
  readonly otherId: string
}

interface TableOptions {
  readonly greeks?: boolean
  /** Card types to put on top of the Great Person deck, in order. */
  readonly top?: readonly string[]
  /** Marker assets whose supply is used up (three pieces on the map). */
  readonly exhausted?: readonly string[]
}

const typeOf = (item: Item): string | null => ('type' in item ? item.type : null)

/** A started two-player game, the starter on space 2 with City Management open, so the next advance is Great Person space 3. */
async function gpTable(name: string, options: TableOptions = {}): Promise<Table> {
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
  const otherId = (await view(gameId, other)).you?.playerId as string
  expect((await post(starter, `/api/games/${gameId}/turns/done`, { phase: 'TRADE' })).status).toBe(200)

  let state = await repo.findGame(gameId)
  if (state === undefined) throw new Error('game missing')
  const color = state.players.find((player) => player.playerId === starterId)?.color
  const civName = options.greeks === true ? 'Greeks' : 'Japanese'
  const assetId = color === null || color === undefined ? undefined : leaderAssetId(civName, color)
  const asset = assetId === undefined ? undefined : findBoardAsset(assetId)
  if (assetId === undefined || asset === undefined) throw new Error('no leader artwork for the starter')
  const centre = cultureCellCenter(state.board, 2)
  state = {
    ...state,
    players: state.players.map((player) =>
      player.playerId === starterId
        ? {
            ...player,
            civilization: { kind: 'civ', name: civName } as unknown as CivItem,
            stats: { ...player.stats, culture: 100, trade: 100 },
          }
        : player,
    ),
  }
  state = unwrap(placePiece(state, { playerId: starterId, assetId, x: Math.round(centre.x - asset.width / 2), y: 10 }))

  // Markers of an exhausted type lie on the map, three of them
  for (const marker of options.exhausted ?? []) {
    for (let index = 0; index < 3; index += 1) {
      state = unwrap(placePiece(state, { playerId: starterId, assetId: marker, x: 100 + index * 100, y: mapTop(state.board) + 100 }))
    }
  }
  // Known cards on top, so the test does not depend on the seeded shuffle
  const used = new Set<string>()
  const top = (options.top ?? []).map((type) => {
    const card = state?.items.find((item) => item.sheetName === 'GREAT_PERSON' && typeOf(item) === type && !used.has(item.id))
    if (card === undefined) throw new Error(`no ${type} card`)
    used.add(card.id)
    return card
  })
  const rest = state.items.filter((item) => !used.has(item.id))
  const firstGp = rest.findIndex((item) => item.sheetName === 'GREAT_PERSON')
  state = { ...state, items: [...rest.slice(0, firstGp), ...top, ...rest.slice(firstGp)] }
  await repo.saveGame(state)
  return { gameId, starter, other, starterId, otherId }
}

const advance = (table: Table, requestId: string, rev: number) =>
  post(table.starter, `/api/games/${table.gameId}/actions`, { action: 'cultureAdvance', requestId, rev })

const choose = (table: Table, requestId: string, rewardId: string, itemId: string, rev: number) =>
  post(table.starter, `/api/games/${table.gameId}/actions`, { action: 'chooseReward', requestId, rewardId, itemId, rev })

const stored = async (table: Table): Promise<GameState> => {
  const state = await repo.findGame(table.gameId)
  if (state === undefined) throw new Error('game missing')
  return state
}

const ownMarkers = (state: GameState, playerId: string): readonly BoardPiece[] => {
  const areas = playerAreas(state.board, state.players)
  return state.board.pieces.filter(
    (piece) =>
      piece.category === 'greatperson' &&
      areaAt(areas, piece.x + piece.width / 2, piece.y + piece.height / 2)?.playerId === playerId,
  )
}

const SCIENTIST = 'Scientist'
const GENERAL = 'General'

const askAndVote = async (table: Table, logId: string) => {
  expect((await post(table.other, `/api/games/${table.gameId}/undo/${logId}`, {})).status).toBe(200)
  return post(table.starter, `/api/games/${table.gameId}/undo/${logId}/vote`, { vote: true })
}

describe('a Great Person space over HTTP', () => {
  it('gives the card hidden and a marker in the own area, and the public line names only the marker type', async () => {
    const table = await gpTable('One', { top: [SCIENTIST] })
    const before = await stored(table)
    const [card] = before.items.filter((item) => item.sheetName === 'GREAT_PERSON')
    const rev = (await view(table.gameId, table.starter)).rev

    const response = await advance(table, 'req-1', rev)

    expect(response.status).toBe(200)
    const after = await response.json<View>()
    expect(after.you?.items.map((item) => item.id)).toEqual([card?.id])
    expect(after.you?.pendingRewards).toEqual([])
    expect(after.you?.stats.culture).toBe(97)
    expect(after.you?.cultureMarkerLevel).toBe(3)
    const state = await stored(table)
    expect(ownMarkers(state, table.starterId).map((piece) => piece.assetId)).toEqual(['great people/scientist'])
    expect(after.board.pieces.some((piece) => piece.assetId === 'great people/scientist')).toBe(true)
    expect(after.assistedActions[0]?.text).toMatch(
      /^.+ advanced on the culture track to space 3 and took a scientist great person marker into reserve$/,
    )
  })

  it('is idempotent by request id: a retry changes nothing and takes no second marker', async () => {
    const table = await gpTable('Idem', { top: [SCIENTIST] })
    const first = await (await advance(table, 'req-1', (await view(table.gameId, table.starter)).rev)).json<View>()
    const retry = await advance(table, 'req-1', first.rev)
    expect(retry.status).toBe(200)
    expect((await retry.json<View>()).rev).toBe(first.rev)
    expect(ownMarkers(await stored(table), table.starterId)).toHaveLength(1)
    expect((await stored(table)).assistedActions).toHaveLength(1)
  })

  it('a card whose marker type is exhausted is discarded faceup and listed publicly; the kept card is not', async () => {
    const table = await gpTable('Faceup', { top: [SCIENTIST, GENERAL], exhausted: ['great people/scientist'] })
    const before = await stored(table)
    const [rejected, kept] = before.items.filter((item) => item.sheetName === 'GREAT_PERSON')
    if (rejected === undefined || kept === undefined) throw new Error('two cards expected')

    const response = await advance(table, 'req-1', (await view(table.gameId, table.starter)).rev)
    expect(response.status).toBe(200)

    const spectator = await register('faceup-spectator')
    for (const token of [table.other, spectator, undefined]) {
      const headers = token === undefined ? {} : { headers: bearer(token) }
      const log = await inject(app, { url: `/api/games/${table.gameId}/log/public`, ...headers })
      expect(log.body).toContain(
        `drew the Great Person card ${itemName(rejected)}, but no scientist marker is left, so it was discarded faceup`,
      )
      expect(log.body).toContain('took a general great person marker into reserve')
      expect(log.body).not.toContain(kept.id)
      const feed = await inject(app, { url: `/api/games/${table.gameId}/revealed`, ...headers })
      expect(feed.body).toContain(rejected.id)
      expect(feed.body).not.toContain(kept.id)
    }
    const state = await stored(table)
    expect(ownMarkers(state, table.starterId).map((piece) => piece.assetId)).toEqual(['great people/general'])
  })

  it('with every type exhausted the advance still moves and is paid, and nothing is received', async () => {
    const table = await gpTable('None', { exhausted: [...GREAT_PERSON_CARD_TYPES.map(([assetId]) => assetId)] })
    // Three of each of six kinds on the map is what a full table looks like
    const response = await advance(table, 'req-1', (await view(table.gameId, table.starter)).rev)
    expect(response.status).toBe(200)
    const after = await response.json<View>()
    expect(after.you?.cultureMarkerLevel).toBe(3)
    expect(after.you?.stats.culture).toBe(97)
    expect(after.you?.items).toEqual([])
    expect(after.assistedActions[0]?.text).toContain('gained no Great Person')
    expect(ownMarkers(await stored(table), table.starterId)).toEqual([])
  })
})

describe('Greeks: a private choice over HTTP', () => {
  it('survives a refresh, then keeping a card takes its marker and discards the other', async () => {
    const table = await gpTable('Choice', { greeks: true, top: [SCIENTIST, GENERAL] })
    const pressed = await (await advance(table, 'req-1', (await view(table.gameId, table.starter)).rev)).json<View>()
    expect(pressed.you?.pendingRewards[0]?.candidates).toHaveLength(2)
    expect(ownMarkers(await stored(table), table.starterId)).toEqual([])

    const refreshed = await view(table.gameId, table.starter)
    expect(refreshed.you?.pendingRewards).toEqual(pressed.you?.pendingRewards)
    expect(refreshed.rev).toBe(pressed.rev)

    const [scientist, general] = pressed.you?.pendingRewards[0]?.candidates ?? []
    const chosen = await choose(table, 'req-2', 'req-1', general?.id ?? '', pressed.rev)
    expect(chosen.status).toBe(200)
    const after = await chosen.json<View>()
    expect(after.you?.pendingRewards).toEqual([])
    expect(after.you?.items.map((item) => item.id)).toEqual([general?.id])
    const state = await stored(table)
    expect(ownMarkers(state, table.starterId).map((piece) => piece.assetId)).toEqual(['great people/general'])
    expect(state.discardedItems.map((item) => item.id)).toContain(scientist?.id)

    const log = await inject(app, { url: `/api/games/${table.gameId}/log/public`, headers: bearer(table.other) })
    expect(log.body).toContain('took a general great person marker into reserve')
    expect(log.body).not.toContain('kept a card')
  })

  it('another player, a spectator and an anonymous viewer get no candidate, no card name and no effect; the marker type only after the choice', async () => {
    const table = await gpTable('Hidden', { greeks: true, top: [SCIENTIST, GENERAL] })
    const pressed = await (await advance(table, 'req-1', (await view(table.gameId, table.starter)).rev)).json<View>()
    const candidates = pressed.you?.pendingRewards[0]?.candidates ?? []
    expect(candidates).toHaveLength(2)
    const state = await stored(table)
    const cards = state.players.find((player) => player.playerId === table.starterId)?.items ?? []
    const secrets = cards.flatMap((item) => [item.id, itemName(item)])
    // The scientist is discarded when the general is kept, and a discard is public
    const discardedCard = secrets.slice(0, 2)
    const spectator = await register('hidden-spectator-gp')

    const check = async (kept: boolean) => {
      const urls = [
        `/api/games/${table.gameId}`,
        `/api/games/${table.gameId}/log/public`,
        `/api/games/${table.gameId}/log/private`,
        `/api/games/${table.gameId}/undo/pending`,
        `/api/games/${table.gameId}/revisions`,
        `/api/games/${table.gameId}/revealed`,
        `/api/games/${table.gameId}/board`,
      ]
      for (const token of [table.other, spectator, undefined]) {
        const headers = token === undefined ? {} : { headers: bearer(token) }
        for (const url of urls) {
          const response = await inject(app, { url, ...headers })
          // The one allowed exception is the card that was discarded, which is public
          for (const secret of secrets) {
            if (kept && discardedCard.includes(secret)) continue
            expect(response.body).not.toContain(secret)
          }
          expect(response.body).not.toContain('candidateIds')
          expect(response.body).not.toContain('"effect"')
          expect(response.body).not.toContain('"historyId"')
        }
        const list = (await (await inject(app, { url: `/api/games/${table.gameId}/revisions`, ...headers })).json()) as readonly { revision: number }[]
        for (const entry of list) {
          const revision = await inject(app, { url: `/api/games/${table.gameId}/revisions/${entry.revision}`, ...headers })
          for (const secret of secrets) {
            if (kept && discardedCard.includes(secret)) continue
            expect(revision.body).not.toContain(secret)
          }
        }
      }
    }

    await check(false)
    // Before a card is kept there is no marker, so the type is not on the board either
    const asOther = await inject(app, { url: `/api/games/${table.gameId}`, headers: bearer(table.other) })
    expect(asOther.body).not.toContain('great people/')
    expect(JSON.stringify((await asOther.json<{ opponents: unknown }>()).opponents)).not.toContain('pendingRewards')
    expect((await view(table.gameId, table.other)).you?.pendingRewards).toEqual([])
    expect((await inject(app, { url: `/api/games/${table.gameId}` })).body).not.toContain('pendingRewards')

    // After the choice the marker type is public; the kept card still is not, and the discarded one is (the first secret)
    const chosen = await choose(table, 'req-2', 'req-1', candidates[1]?.id ?? '', pressed.rev)
    expect(chosen.status).toBe(200)
    const after = await inject(app, { url: `/api/games/${table.gameId}`, headers: bearer(table.other) })
    expect(after.body).toContain('great people/general')
    const keptCard = cards.find((item) => item.id === candidates[1]?.id)
    expect(after.body).not.toContain(keptCard?.id ?? 'x')
    await check(true)
    const privateLog = await inject(app, { url: `/api/games/${table.gameId}/log/private`, headers: bearer(table.starter) })
    expect(privateLog.body).toContain(itemName(keptCard as Item))
  })
})

describe('undo over HTTP', () => {
  it('after a resolved advance: the marker leaves the board, the card goes back to the deck', async () => {
    const table = await gpTable('UndoOne', { top: [SCIENTIST] })
    const before = await stored(table)
    const pressed = await (await advance(table, 'req-1', (await view(table.gameId, table.starter)).rev)).json<View>()
    expect(ownMarkers(await stored(table), table.starterId)).toHaveLength(1)

    const voted = await askAndVote(table, pressed.assistedActions[0]?.logId as string)

    expect(voted.status).toBe(200)
    const after = await stored(table)
    expect(ownMarkers(after, table.starterId)).toEqual([])
    expect(after.board.pieces.some((piece) => piece.category === 'greatperson')).toBe(false)
    expect(after.items).toHaveLength(before.items.length)
    expect(after.players.find((player) => player.playerId === table.starterId)?.items).toEqual([])
    expect((await voted.json<View>()).you?.cultureMarkerLevel).toBe(2)
  })

  it('before the choice: both cards go back and no marker was ever taken', async () => {
    const table = await gpTable('UndoChoice', { greeks: true, top: [SCIENTIST, GENERAL] })
    const before = await stored(table)
    const pressed = await (await advance(table, 'req-1', (await view(table.gameId, table.starter)).rev)).json<View>()
    const voted = await askAndVote(table, pressed.assistedActions[0]?.logId as string)
    expect(voted.status).toBe(200)
    const after = await voted.json<View>()
    expect(after.you?.pendingRewards).toEqual([])
    expect(after.you?.items).toEqual([])
    expect((await stored(table)).items).toHaveLength(before.items.length)
  })

  it('is refused with a 409, and the vote stays open, when the marker was moved out of the area', async () => {
    const table = await gpTable('UndoMoved', { top: [SCIENTIST] })
    const pressed = await (await advance(table, 'req-1', (await view(table.gameId, table.starter)).rev)).json<View>()
    const state = await stored(table)
    const marker = ownMarkers(state, table.starterId)[0]
    const moved = await post(table.starter, `/api/games/${table.gameId}/board/pieces/${marker?.id}/move`, {
      x: 200, y: mapTop(state.board) + 100, snap: false,
    })
    expect(moved.status).toBe(200)

    const logId = pressed.assistedActions[0]?.logId as string
    expect((await post(table.other, `/api/games/${table.gameId}/undo/${logId}`, {})).status).toBe(200)
    const voted = await post(table.starter, `/api/games/${table.gameId}/undo/${logId}/vote`, { vote: true })
    expect(voted.status).toBe(409)
    expect(await voted.json()).toMatchObject({ error: 'ASSISTED_UNDO_BLOCKED' })
    const after = await stored(table)
    expect(after.assistedActions[0]?.status).toBe('applied')
    expect(after.log.find((entry) => entry.id === logId)?.undo?.done).toBe(false)
    expect(after.board.pieces.some((piece) => piece.id === marker?.id)).toBe(true)
  })

  it('the board Undo refuses the marker placement', async () => {
    const table = await gpTable('BoardUndo', { top: [SCIENTIST] })
    const pressed = await (await advance(table, 'req-1', (await view(table.gameId, table.starter)).rev)).json<View>()
    const refused = await post(table.starter, `/api/games/${table.gameId}/board/undo`, {})
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ error: 'BOARD_UNDO_ASSISTED' })
    expect(ownMarkers(await stored(table), table.starterId)).toHaveLength(1)
    expect((await view(table.gameId, table.starter)).rev).toBe(pressed.rev)
  })
})

describe('the manual paths over HTTP', () => {
  it('the Draw button for a Great Person draws a card and takes no marker', async () => {
    const table = await gpTable('Draw', { top: [SCIENTIST, GENERAL] })
    const before = await stored(table)
    const [card] = before.items.filter((item) => item.sheetName === 'GREAT_PERSON')
    const response = await post(table.starter, `/api/games/${table.gameId}/draw/GREAT_PERSON`, { confirmedOutOfTurn: true })
    expect(response.status).toBe(200)
    const after = await stored(table)
    expect(after.players.find((player) => player.playerId === table.starterId)?.items.map((item) => item.id)).toEqual([card?.id])
    expect(after.board.pieces).toEqual(before.board.pieces)
    expect(after.assistedActions).toEqual([])
  })

  it('after the assisted flow the marker can be moved and removed, the culture marker dragged and counters edited', async () => {
    const table = await gpTable('Manual', { top: [SCIENTIST] })
    const pressed = await (await advance(table, 'req-1', (await view(table.gameId, table.starter)).rev)).json<View>()
    const state = await stored(table)
    const marker = ownMarkers(state, table.starterId)[0]
    const leader = state.board.pieces.find((piece) => piece.category === 'leader')
    const target = cultureCellCenter(state.board, 6)

    expect((await post(table.starter, `/api/games/${table.gameId}/board/pieces/${marker?.id}/move`, { x: 300, y: mapTop(state.board) + 120, snap: false })).status).toBe(200)
    expect((await post(table.starter, `/api/games/${table.gameId}/board/pieces/${leader?.id}/move`, {
      x: Math.round(target.x - (leader?.width ?? 0) / 2), y: leader?.y ?? 0, snap: false,
    })).status).toBe(200)
    expect((await post(table.starter, `/api/games/${table.gameId}/players/${table.starterId}/stat`, { stat: 'culture', value: 11 })).status).toBe(200)
    const mid = await view(table.gameId, table.starter)
    expect(mid.you?.cultureMarkerLevel).toBe(6)
    expect(mid.you?.stats.culture).toBe(11)
    expect(mid.rev).toBeGreaterThan(pressed.rev)

    expect((await post(table.starter, `/api/games/${table.gameId}/board/pieces/${marker?.id}/remove`, {})).status).toBe(200)
    expect((await stored(table)).board.pieces.some((piece) => piece.id === marker?.id)).toBe(false)
  })
})
