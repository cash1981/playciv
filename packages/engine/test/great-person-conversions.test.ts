/**
 * Frank Lloyd Wright and Albert Einstein: Great Persons that turn resources into
 * other resources. Each test names the printed ability it covers.
 */

import { describe, expect, it } from 'vitest'

import { placePiece } from '../src/actions/board.js'
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

const withBuildings = (state: GameState, count: number, playerId = CASH1981): GameState => {
  let next = state
  for (let index = 0; index < count; index += 1) {
    next = unwrap(
      placePiece(next, { playerId, assetId: 'buildings/granary', x: 400 + index * 90, y: 600 }),
    )
  }
  return next
}

describe('Frank Lloyd Wright', () => {
  it('gains trade and culture equal to the buildings in your cities, and takes both back on undo', () => {
    const base = withStats(withBuildings(firstCivGame(), 3), { trade: 4, culture: 2 })
    const card = withCardInHand(openCityManagement(base), 'Frank Lloyd Wright')
    const played = unwrap(play(card.state, 'flw-1', card.itemId))
    expect(me(played).stats.trade).toBe(7)
    expect(me(played).stats.culture).toBe(5)
    expect(played.log.at(-1)?.publicLog).toContain('gaining 3 trade and 3 culture for 3 buildings')
    expect(me(played).items.some((item) => item.id === card.itemId)).toBe(false)

    const undone = undoByVote(played, 'flw-1')
    expect(me(undone).stats.trade).toBe(4)
    expect(me(undone).stats.culture).toBe(2)
    expect(me(undone).items.some((item) => item.id === card.itemId)).toBe(true)
  })

  it('counts only your own buildings and never lifts trade past the track ceiling', () => {
    let base = withBuildings(firstCivGame(), 2)
    base = withBuildings(base, 4, KARANDRAS1)
    base = withStats(withCivilization(base, 'Japanese'), { trade: 24 })
    const card = withCardInHand(openCityManagement(base), 'Frank Lloyd Wright')
    const played = unwrap(play(card.state, 'flw-2', card.itemId))
    expect(me(played).stats.trade).toBe(25) // Japanese ceiling
    expect(me(played).stats.culture).toBe(2)
    expect(played.log.at(-1)?.publicLog).toContain('gaining 1 trade and 2 culture')
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
