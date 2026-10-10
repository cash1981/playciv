import { describe, expect, it } from 'vitest'

import { createTradeOffer, counterTradeOffer, expireTradeOffers, transitionTradeOffer } from '../src/trade-offers.js'
import { toPlayerView } from '../src/state.js'
import { unwrap } from '../src/result.js'
import { CASH1981, CHUL, firstCivGame } from './fixture.js'

describe('free-text trade offers', () => {
  it('creates a public offer without interpreting or changing player stats', () => {
    const state = firstCivGame()
    const before = state.players.map((player) => player.stats)
    const offered = unwrap(createTradeOffer(state, {
      senderId: CASH1981,
      recipientId: CHUL,
      terms: 'I offer 2 trade for your wheat.',
      requestId: 'offer-1',
      at: '2026-10-10T10:00:00.000Z',
    }))

    expect(offered.tradeOffers[0]).toMatchObject({
      senderId: CASH1981,
      recipientId: CHUL,
      terms: 'I offer 2 trade for your wheat.',
      status: 'pending',
      turnNumber: 1,
    })
    expect(offered.players.map((player) => player.stats)).toEqual(before)
    expect(offered.log.at(-1)?.publicLog).toContain('I offer 2 trade for your wheat.')
    const viewJson = JSON.stringify(toPlayerView(offered, CHUL))
    expect(toPlayerView(offered, CHUL).tradeOffers[0]?.senderUsername).toBe('cash1981')
    expect(viewJson).not.toContain('requestId')
    expect(viewJson).not.toContain('transitionRequests')
  })

  it('is idempotent by create request id and transitions only the intended actor', () => {
    const state = unwrap(createTradeOffer(firstCivGame(), {
      senderId: CASH1981,
      recipientId: CHUL,
      terms: 'one wheat',
      requestId: 'offer-1',
    }))
    const retried = unwrap(createTradeOffer(state, {
      senderId: CASH1981,
      recipientId: CHUL,
      terms: 'one wheat',
      requestId: 'offer-1',
    }))
    expect(retried).toBe(state)
    expect(createTradeOffer(state, {
      senderId: CASH1981,
      recipientId: CASH1981,
      terms: 'different recipient',
      requestId: 'offer-1',
    }).ok).toBe(false)
    expect(transitionTradeOffer(state, {
      actorId: CASH1981,
      offerId: state.tradeOffers[0]!.id,
      action: 'accept',
      requestId: 'accept-1',
    }).ok).toBe(false)
    const accepted = unwrap(transitionTradeOffer(state, {
      actorId: CHUL,
      offerId: state.tradeOffers[0]!.id,
      action: 'accept',
      requestId: 'accept-1',
    }))
    expect(accepted.tradeOffers[0]?.status).toBe('accepted')
    expect(unwrap(transitionTradeOffer(accepted, {
      actorId: CHUL,
      offerId: state.tradeOffers[0]!.id,
      action: 'accept',
      requestId: 'accept-1',
    }))).toBe(accepted)
    expect(transitionTradeOffer(accepted, {
      actorId: CHUL,
      offerId: state.tradeOffers[0]!.id,
      action: 'decline',
      requestId: 'accept-1',
    }).ok).toBe(false)
    expect(transitionTradeOffer(accepted, {
      actorId: CASH1981,
      offerId: state.tradeOffers[0]!.id,
      action: 'accept',
      requestId: 'accept-1',
    }).ok).toBe(false)
  })

  it('creates a linked counteroffer and keeps the original terms unchanged', () => {
    const state = unwrap(createTradeOffer(firstCivGame(), {
      senderId: CASH1981,
      recipientId: CHUL,
      terms: 'two trade',
      requestId: 'offer-1',
    }))
    const next = unwrap(counterTradeOffer(state, {
      actorId: CHUL,
      offerId: state.tradeOffers[0]!.id,
      terms: 'one trade and one wheat',
      requestId: 'counter-1',
    }))
    expect(next.tradeOffers).toHaveLength(2)
    expect(next.tradeOffers[0]).toMatchObject({ terms: 'two trade', status: 'countered' })
    expect(next.tradeOffers[1]).toMatchObject({ terms: 'one trade and one wheat', parentOfferId: state.tradeOffers[0]!.id })
    expect(next.log.at(-2)?.publicLog).toContain('countered trade offer')
    expect(counterTradeOffer(next, {
      actorId: CHUL,
      offerId: state.tradeOffers[0]!.id,
      terms: 'different retry text is ignored',
      requestId: 'counter-1',
    }).ok).toBe(false)
    expect(counterTradeOffer(next, {
      actorId: CHUL,
      offerId: state.tradeOffers[0]!.id,
      terms: 'different counter terms',
      requestId: 'counter-1',
    }).ok).toBe(false)
    expect(unwrap(counterTradeOffer(next, {
      actorId: CHUL,
      offerId: state.tradeOffers[0]!.id,
      terms: 'one trade and one wheat',
      requestId: 'counter-1',
    }))).toBe(next)
  })

  it('does not confuse a counter request id with an earlier offer creation id', () => {
    const first = unwrap(createTradeOffer(firstCivGame(), {
      senderId: CASH1981,
      recipientId: CHUL,
      terms: 'first offer',
      requestId: 'first-offer',
    }))
    const other = unwrap(createTradeOffer(first, {
      senderId: CHUL,
      recipientId: CASH1981,
      terms: 'unrelated offer',
      requestId: 'counter-request',
    }))
    const next = unwrap(counterTradeOffer(other, {
      actorId: CHUL,
      offerId: first.tradeOffers[0]!.id,
      terms: 'actual counteroffer',
      requestId: 'counter-request',
    }))

    expect(next.tradeOffers).toHaveLength(3)
    expect(next.tradeOffers[0]?.status).toBe('countered')
    expect(next.tradeOffers[1]).toMatchObject({ terms: 'unrelated offer', parentOfferId: null })
    expect(next.tradeOffers[2]).toMatchObject({ terms: 'actual counteroffer', parentOfferId: first.tradeOffers[0]!.id })
  })

  it('rejects a collision with the counteroffer creation key without closing the original', () => {
    const first = unwrap(createTradeOffer(firstCivGame(), {
      senderId: CASH1981,
      recipientId: CHUL,
      terms: 'first offer',
      requestId: 'first-offer',
    }))
    const offerId = first.tradeOffers[0]!.id
    const existing = unwrap(createTradeOffer(first, {
      senderId: CHUL,
      recipientId: CASH1981,
      terms: 'unrelated offer',
      requestId: `counter:${offerId}:counter-request`,
    }))

    expect(counterTradeOffer(existing, {
      actorId: CHUL,
      offerId,
      terms: 'actual counteroffer',
      requestId: 'counter-request',
    }).ok).toBe(false)
    expect(existing.tradeOffers[0]?.status).toBe('pending')
  })

  it('expires an unresolved offer when a later turn is observed', () => {
    const state = unwrap(createTradeOffer(firstCivGame(), {
      senderId: CASH1981,
      recipientId: CHUL,
      terms: 'old offer',
      requestId: 'offer-1',
    }))
    const later = {
      ...state,
      chatOrdersStartTurn: 2,
      players: state.players.map((player) => ({
        ...player,
        playerTurns: player.playerTurns.map((turn) => turn.turnNumber === 1 ? { ...turn, done: { ...turn.done, RESEARCH: true } } : turn),
      })),
    }
    const next = unwrap(createTradeOffer(later, {
      senderId: CASH1981,
      recipientId: CHUL,
      terms: 'new offer',
      requestId: 'offer-2',
    }))
    expect(next.tradeOffers[0]?.status).toBe('expired')
    expect(next.tradeOffers[0]?.resolvedAt).toBeNull()
    expect(next.log.at(-2)?.publicLog).toContain('expired because Turn 1 ended')
  })

  it('expires and logs an offer when either participant leaves, but preserves accepted offers', () => {
    const state = unwrap(createTradeOffer(firstCivGame(), {
      senderId: CASH1981,
      recipientId: CHUL,
      terms: 'one wheat',
      requestId: 'offer-1',
    }))
    const accepted = unwrap(transitionTradeOffer(state, {
      actorId: CHUL,
      offerId: state.tradeOffers[0]!.id,
      action: 'accept',
      requestId: 'accept-1',
    }))
    const participantLeft = { ...accepted, players: accepted.players.filter((player) => player.playerId !== CHUL) }
    const reconciled = expireTradeOffers(participantLeft, '2026-10-10T12:00:00.000Z')
    expect(reconciled.tradeOffers[0]?.status).toBe('accepted')

    const pending = unwrap(createTradeOffer(firstCivGame(), {
      senderId: CASH1981,
      recipientId: CHUL,
      terms: 'two trade',
      requestId: 'offer-2',
    }))
    const departed = { ...pending, players: pending.players.filter((player) => player.playerId !== CHUL) }
    const expired = expireTradeOffers(departed, '2026-10-10T12:00:00.000Z')
    expect(expired.tradeOffers[0]).toMatchObject({ status: 'expired', resolvedAt: '2026-10-10T12:00:00.000Z' })
    expect(expired.log.at(-1)?.publicLog).toContain('expired because a participant left the game')
  })
})
