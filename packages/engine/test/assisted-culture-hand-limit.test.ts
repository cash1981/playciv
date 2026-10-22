/**
 * The culture hand limit on the culture advance (issue #248, Slice A), and the
 * rule that dragging the leader marker by hand stays a correction: it charges and
 * awards nothing. The limit warns and never refuses, because a player may hold one
 * card above the hand size while deciding which to discard.
 */

import { describe, expect, it } from 'vitest'

import { movePiece } from '../src/actions/board.js'
import { assistedAvailability, performAssistedAction } from '../src/assisted.js'
import { cultureCellCenter } from '../src/board.js'
import { cultureCardsHeld, cultureHandSizeOf, cultureHandWarning } from '../src/culture-hand.js'
import type { Item } from '../src/item.js'
import { unwrap } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { findPlayer, toPlayerView } from '../src/state.js'

import { AT, advanceTurn, topCards } from './culture-advance-fixture.js'
import { CASH1981 } from './fixture.js'

const me = (state: GameState) => {
  const player = findPlayer(state, CASH1981)
  if (player === undefined) throw new Error('fixture player missing')
  return player
}

/** Moves the next `count` culture I cards from the deck into cash1981's hand. */
function holding(state: GameState, count: number): GameState {
  const cards = topCards(state, 'CULTURE_1', count).map((item): Item => ({ ...item, ownerId: CASH1981, hidden: true }))
  const ids = new Set(cards.map((card) => card.id))
  return {
    ...state,
    items: state.items.filter((item) => !ids.has(item.id)),
    players: state.players.map((player) =>
      player.playerId === CASH1981 ? { ...player, items: [...player.items, ...cards] } : player,
    ),
  }
}

const warningOf = (state: GameState): string | undefined => {
  const availability = assistedAvailability(state, CASH1981, 'cultureAdvance')
  return availability.status === 'ready' ? availability.warning : undefined
}

describe('the culture hand limit on an advance', () => {
  it('counts the culture cards in the hand against the derived hand size', () => {
    const state = holding(advanceTurn(), 2)
    expect(cultureCardsHeld(me(state))).toBe(2)
    expect(cultureHandSizeOf(state, me(state))).toBe(2)
  })

  it('gives no warning while the new card fits', () => {
    expect(warningOf(advanceTurn())).toBeUndefined()
    expect(warningOf(holding(advanceTurn(), 1))).toBeUndefined()
  })

  it('warns, but stays ready, when the new card takes the hand one over its size', () => {
    const state = holding(advanceTurn(), 2)
    const availability = assistedAvailability(state, CASH1981, 'cultureAdvance')
    expect(availability.status).toBe('ready')
    expect(warningOf(state)).toBe(
      'Culture hand limit: this card brings your hand to 3 culture cards, over your culture hand size of 2. ' +
        'You may hold one more while you decide which to discard. Discard a culture card or increase your culture hand size.',
    )
  })

  it('still advances over the limit and keeps the card, with nothing discarded for the player', () => {
    const ready = holding(advanceTurn(), 2)
    const done = unwrap(
      performAssistedAction(ready, { playerId: CASH1981, action: 'cultureAdvance', requestId: 'req-1', at: AT }),
    )
    expect(cultureCardsHeld(me(done))).toBe(3)
    expect(cultureHandWarning(done, me(done))).toMatch(/you hold 3 culture cards, over your culture hand size of 2/)
  })

  it('stops warning once a card is discarded or the hand size grows', () => {
    const over = holding(advanceTurn(), 2)
    expect(warningOf(over)).toBeDefined()
    // One more card of hand size, through Pottery: a revealed tech raises the size.
    const roomier = holding(advanceTurn({ techs: ['Pottery'] }), 2)
    expect(cultureHandSizeOf(roomier, me(roomier))).toBe(3)
    expect(warningOf(roomier)).toBeUndefined()
  })

  it('does not warn on a Great Person space, which gives a marker and no culture card', () => {
    const state = holding(advanceTurn({ step: 2 }), 2)
    expect(assistedAvailability(state, CASH1981, 'cultureAdvance').reason).toMatch(/Great Person/)
    expect(warningOf(state)).toBeUndefined()
  })

  it('shows the warning only on the viewer own projection, never to an opponent', () => {
    const state = holding(advanceTurn(), 2)
    const own = toPlayerView(state, CASH1981).you?.availableActions.find((entry) => entry.action === 'cultureAdvance')
    expect(own?.warning).toMatch(/Culture hand limit/)
    const other = state.players.find((player) => player.playerId !== CASH1981)
    expect(other).toBeDefined()
    const view = toPlayerView(state, other?.playerId ?? '')
    expect(JSON.stringify(view.opponents)).not.toMatch(/Culture hand limit/)
  })
})

describe('moving the leader marker by hand', () => {
  it('charges nothing, draws nothing and records no assisted action', () => {
    const ready = advanceTurn({ culture: 10, trade: 10 })
    const marker = ready.board.pieces.find((piece) => piece.assetId === 'leaders/japanese_red')
    if (marker === undefined) throw new Error('marker missing')
    const target = cultureCellCenter(ready.board, 5)
    const moved = unwrap(
      movePiece(ready, {
        playerId: CASH1981,
        pieceId: marker.id,
        x: Math.round(target.x - marker.width / 2),
        y: marker.y,
      }),
    )
    expect(me(moved).stats.culture).toBe(10)
    expect(me(moved).stats.trade).toBe(10)
    expect(me(moved).items).toEqual(me(ready).items)
    expect(moved.items).toEqual(ready.items)
    expect(moved.assistedActions).toEqual([])
    expect(me(moved).pendingRewards).toEqual([])
  })
})
