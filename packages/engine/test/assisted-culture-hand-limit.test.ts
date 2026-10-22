/**
 * The culture hand limit on the culture advance (issue #248, Slice A), and the
 * rule that dragging the leader marker by hand stays a correction: it charges and
 * awards nothing. The limit warns and never refuses, because a player may hold one
 * card above the hand size while deciding which to discard.
 */

import { describe, expect, it } from 'vitest'

import { movePiece } from '../src/actions/board.js'
import { draw } from '../src/actions/draw.js'
import { discardItem, tradeToPlayer } from '../src/actions/player.js'
import { assistedAvailability, performAssistedAction } from '../src/assisted.js'
import { cultureCellCenter } from '../src/board.js'
import { cultureCardsHeld, cultureHandSizeOf, cultureHandWarning } from '../src/culture-hand.js'
import type { Item } from '../src/item.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { findPlayer, toPlayerView } from '../src/state.js'

import { AT, advanceTurn, topCards } from './culture-advance-fixture.js'
import { CASH1981, KARANDRAS1 } from './fixture.js'

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
        'You may hold it while you decide which to discard, but you must discard down to 2 or increase your culture hand size ' +
        'before you can receive another culture card.',
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

describe('a hand over its size', () => {
  const OVER_REASON =
    'You hold 3 culture cards, over the culture hand size of 2. Discard down to 2 or increase the culture hand size before another culture card can be received.'

  it('is blocked from advancing onto a culture event until it has discarded', () => {
    const over = holding(advanceTurn(), 3)
    expect(assistedAvailability(over, CASH1981, 'cultureAdvance')).toEqual({
      status: 'unavailable',
      reason: `Advance to space 1 (culture I event): 3 culture. ${OVER_REASON}`,
    })
    const result = performAssistedAction(over, { playerId: CASH1981, action: 'cultureAdvance', requestId: 'req-1', at: AT })
    expect(unwrapErr(result).kind).toBe('ASSISTED_ACTION_REJECTED')

    const [first] = me(over).items
    const discarded = unwrap(
      discardItem(over, { playerId: CASH1981, sheetName: 'CULTURE_1', itemNumber: first?.itemNumber ?? 0, name: first === undefined ? '' : (first as { name: string }).name }),
    )
    expect(cultureCardsHeld(me(discarded))).toBe(2)
    expect(assistedAvailability(discarded, CASH1981, 'cultureAdvance').status).toBe('ready')
  })

  it('is unblocked by a larger hand size', () => {
    const roomier = holding(advanceTurn({ techs: ['Pottery'] }), 3)
    expect(assistedAvailability(roomier, CASH1981, 'cultureAdvance').status).toBe('ready')
  })

  it('is not blocked on a Great Person space', () => {
    expect(assistedAvailability(holding(advanceTurn({ step: 2 }), 3), CASH1981, 'cultureAdvance').status).toBe('ready')
  })

  it('a hand exactly at its size may still advance, and then sits one over', () => {
    const done = unwrap(
      performAssistedAction(holding(advanceTurn(), 2), { playerId: CASH1981, action: 'cultureAdvance', requestId: 'req-1', at: AT }),
    )
    expect(cultureCardsHeld(me(done))).toBe(3)
    expect(assistedAvailability(done, CASH1981, 'cultureAdvance').status).toBe('unavailable')
  })

  it('cannot draw a culture card without confirming, but can draw other cards', () => {
    const over = holding(advanceTurn(), 3)
    const refused = unwrapErr(draw(over, { playerId: CASH1981, sheetName: 'CULTURE_2', confirmedOutOfTurn: true }))
    expect(refused).toEqual({ kind: 'CULTURE_HAND_OVER', playerId: CASH1981, held: 3, size: 2 })
    expect(draw(over, { playerId: CASH1981, sheetName: 'CULTURE_2', confirmedOutOfTurn: true }).ok).toBe(false)
    expect(draw(over, { playerId: CASH1981, sheetName: 'INFANTRY', confirmedOutOfTurn: true }).ok).toBe(true)
    // After a yes to the warning the draw goes through
    expect(
      draw(over, { playerId: CASH1981, sheetName: 'CULTURE_2', confirmedOutOfTurn: true, confirmedOverLimit: true }).ok,
    ).toBe(true)
    expect(draw(holding(advanceTurn(), 2), { playerId: CASH1981, sheetName: 'CULTURE_2', confirmedOutOfTurn: true }).ok).toBe(true)
  })

  it('cannot be given a culture card, and the giver keeps it', () => {
    const base = advanceTurn()
    const giverCard = topCards(base, 'CULTURE_1', 1)[0] as Item
    const gifted: GameState = {
      ...base,
      items: base.items.filter((item) => item.id !== giverCard.id),
      players: base.players.map((player) =>
        player.playerId === KARANDRAS1 ? { ...player, items: [{ ...giverCard, ownerId: KARANDRAS1, hidden: true }] } : player,
      ),
    }
    const receiverOver = holding(gifted, 3)
    const input = { playerId: KARANDRAS1, targetPlayerId: CASH1981, sheetName: 'CULTURE_1' as const, itemNumber: giverCard.itemNumber, name: (giverCard as { name: string }).name }
    expect(unwrapErr(tradeToPlayer(receiverOver, input)).kind).toBe('CULTURE_HAND_OVER')
    expect(tradeToPlayer(gifted, input).ok).toBe(true)
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
