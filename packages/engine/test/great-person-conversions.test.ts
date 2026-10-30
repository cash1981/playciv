/**
 * Frank Lloyd Wright and Albert Einstein: Great Persons that turn resources into
 * other resources. Each test names the printed ability it covers.
 */

import { describe, expect, it } from 'vitest'

import { placePiece } from '../src/actions/board.js'
import { findBoardAsset, mapTop, slotOrigin, SQUARE_SIZE } from '../src/board.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { performAssistedAction } from '../src/assisted.js'
import { playableCardsOf } from '../src/assisted-cards.js'
import { toPlayerView } from '../src/state.js'
import type { GameState, Playerhand } from '../src/state.js'
import { findPlayer } from '../src/state.js'
import { unwrap } from '../src/result.js'

import { withCardInHand } from './assisted-fixture.js'
import { openCityManagement, withCivilization, withStats } from './culture-advance-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-10-30T10:00:00.000Z'
const OTHERS = [KARANDRAS1, ITCHI, CHUL]

const me = (state: GameState): Playerhand => {
  const found = findPlayer(state, CASH1981)
  if (found === undefined) throw new Error('no cash1981')
  return found
}

const play = (
  state: GameState,
  requestId: string,
  itemId: string,
  convert?: { readonly from: 'trade' | 'culture'; readonly amount: number },
) =>
  performAssistedAction(state, {
    playerId: CASH1981,
    action: 'playCard',
    requestId,
    at: AT,
    payload: { itemId, targets: [], ...(convert === undefined ? {} : { convert }) },
  })

function undoByVote(state: GameState, requestId: string): GameState {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line for the action')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of OTHERS) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  return next
}

/** The colours the city rules read, the America tile and a red city on B2, as the city action tests set it up. */
function cityScene(): GameState {
  const colors: Record<string, string> = { [CASH1981]: 'Red', [KARANDRAS1]: 'Blue', [ITCHI]: 'Green', [CHUL]: 'Yellow' }
  const base = firstCivGame()
  const coloured = { ...base, players: base.players.map((candidate) => ({ ...candidate, color: colors[candidate.playerId] ?? null })) }
  const slot = coloured.board.slots[0]
  if (slot === undefined) throw new Error('board has no slots')
  const [x, y] = slotOrigin(coloured.board, slot)
  const tiled = unwrap(placePiece(coloured, { playerId: CASH1981, assetId: 'tiles/america', x, y }))
  return put(tiled, CASH1981, 'cities/redcity2', 1, 1)
}

/** A piece centred on the map square (column, row). */
function put(state: GameState, playerId: string, assetId: string, column: number, row: number): GameState {
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`no asset ${assetId}`)
  return unwrap(
    placePiece(state, {
      playerId,
      assetId,
      x: column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2,
      y: mapTop(state.board) + row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2,
    }),
  )
}

const GRANARY = 'buildings/granary'

describe('Frank Lloyd Wright', () => {
  // Cash's city is on B2; A1, A3 and C2 are in its outskirts, E6 is outside them
  const scene = (): GameState => {
    let state = cityScene()
    state = put(state, CASH1981, GRANARY, 0, 0)
    state = put(state, CASH1981, GRANARY, 0, 2)
    state = put(state, KARANDRAS1, GRANARY, 2, 1) // another player's building in Cash's outskirts
    state = put(state, CASH1981, GRANARY, 4, 5) // Cash's own building outside every outskirts
    // Opening the turn collects the city's trade, so the figures are set after it
    return withStats(openCityManagement(state), { trade: 4, culture: 2 })
  }

  it('gains trade and culture equal to the buildings in your cities, and takes both back on undo', () => {
    const card = withCardInHand(scene(), 'Frank Lloyd Wright')
    const played = unwrap(play(card.state, 'flw-1', card.itemId))
    // Three buildings stand in the outskirts of the red city, whoever placed them; the one outside does not count
    expect(me(played).stats.trade).toBe(7)
    expect(me(played).stats.culture).toBe(5)
    expect(played.log.at(-1)?.publicLog).toContain('gaining 3 trade and 3 culture for 3 buildings')
    expect(me(played).items.some((item) => item.id === card.itemId)).toBe(false)

    const undone = undoByVote(played, 'flw-1')
    expect(me(undone).stats.trade).toBe(4)
    expect(me(undone).stats.culture).toBe(2)
    expect(me(undone).items.some((item) => item.id === card.itemId)).toBe(true)
  })

  it('gives nothing for buildings when you have no city, and never lifts trade past the track ceiling', () => {
    const noCity = withCardInHand(
      openCityManagement(withStats(put(firstCivGame(), CASH1981, GRANARY, 0, 0), { trade: 4 })),
      'Frank Lloyd Wright',
    )
    const none = unwrap(play(noCity.state, 'flw-0', noCity.itemId))
    expect(me(none).stats.trade).toBe(4)
    expect(me(none).stats.culture).toBe(0)

    const nearCeiling = withCardInHand(withStats(withCivilization(scene(), 'Japanese'), { trade: 24 }), 'Frank Lloyd Wright')
    const played = unwrap(play(nearCeiling.state, 'flw-2', nearCeiling.itemId))
    expect(me(played).stats.trade).toBe(25) // Japanese ceiling
    expect(me(played).stats.culture).toBe(2 + 3)
    expect(played.log.at(-1)?.publicLog).toContain('gaining 1 trade and 3 culture')
  })
})

describe('Albert Einstein', () => {
  const einstein = (stats: { readonly trade: number; readonly culture: number }) =>
    withCardInHand(openCityManagement(withStats(firstCivGame(), stats)), 'Albert Einstein')

  it('turns the chosen trade into the same amount of culture, and back on undo', () => {
    const card = einstein({ trade: 8, culture: 1 })
    const played = unwrap(play(card.state, 'e-1', card.itemId, { from: 'trade', amount: 5 }))
    expect(me(played).stats.trade).toBe(3)
    expect(me(played).stats.culture).toBe(6)
    expect(played.log.at(-1)?.publicLog).toContain('turning 5 trade into 5 culture')

    const undone = undoByVote(played, 'e-1')
    expect(me(undone).stats.trade).toBe(8)
    expect(me(undone).stats.culture).toBe(1)
  })

  it('turns culture into trade, within the trade track', () => {
    const card = einstein({ trade: 20, culture: 9 })
    const played = unwrap(play(card.state, 'e-2', card.itemId, { from: 'culture', amount: 7 }))
    expect(me(played).stats.trade).toBe(27)
    expect(me(played).stats.culture).toBe(2)

    const over = play(card.state, 'e-3', card.itemId, { from: 'culture', amount: 8 })
    expect(over.ok).toBe(false)
  })

  it('undoes culture into trade, and refuses an undo that would invent resources', () => {
    const card = einstein({ trade: 5, culture: 9 })
    const played = unwrap(play(card.state, 'e-5', card.itemId, { from: 'culture', amount: 4 }))
    expect(me(played).stats.trade).toBe(9)
    expect(me(played).stats.culture).toBe(5)
    const undone = undoByVote(played, 'e-5')
    expect(me(undone).stats.trade).toBe(5)
    expect(me(undone).stats.culture).toBe(9)

    // The trade was spent since: the undo cannot take back what is gone
    const spent = withStats(played, { trade: 1 })
    expect(() => undoByVote(spent, 'e-5')).toThrow(/ASSISTED_UNDO_BLOCKED.*already spent/)
    // Trade then turned into culture, and later filled to the ceiling: giving it back would pass the track
    const second = einstein({ trade: 8, culture: 0 })
    const toCulture = unwrap(play(second.state, 'e-6', second.itemId, { from: 'trade', amount: 5 }))
    expect(() => undoByVote(withStats(toCulture, { trade: 27 }), 'e-6')).toThrow(/ASSISTED_UNDO_BLOCKED.*trade track/)
  })

  it('refuses a missing choice, more than you hold, and a fraction, keeping the card', () => {
    const card = einstein({ trade: 3, culture: 3 })
    for (const convert of [undefined, { from: 'trade' as const, amount: 4 }, { from: 'trade' as const, amount: 0 }, { from: 'trade' as const, amount: 1.5 }]) {
      expect(play(card.state, 'e-4', card.itemId, convert).ok).toBe(false)
    }
    expect(me(card.state).items.some((item) => item.id === card.itemId)).toBe(true)
  })

  it('tells the UI how much can be turned each way, to its owner only', () => {
    const card = einstein({ trade: 6, culture: 2 })
    const listed = playableCardsOf(card.state, me(card.state)).find((entry) => entry.name === 'Albert Einstein')
    expect(listed?.conversion).toEqual({ trade: 6, culture: 2 })
    const other = playableCardsOf(card.state, findPlayer(card.state, KARANDRAS1) as Playerhand)
    expect(other.some((entry) => entry.name === 'Albert Einstein')).toBe(false)
    expect(JSON.stringify(toPlayerView(card.state, KARANDRAS1))).not.toContain(card.itemId)
  })
})
