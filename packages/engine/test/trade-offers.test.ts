import { describe, expect, it } from 'vitest'

import { createTradeOffer, counterTradeOffer, expireTradeOffers, transitionTradeOffer } from '../src/trade-offers.js'
import { toPlayerView } from '../src/state.js'
import { unwrap } from '../src/result.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

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
      recipientIds: [CHUL],
      open: false,
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

describe('a deal to several players, and an open deal', () => {
  const offer = (state: ReturnType<typeof firstCivGame>) => state.tradeOffers[0]!
  const to = (input: { recipientIds?: readonly string[]; open?: boolean }) =>
    unwrap(createTradeOffer(firstCivGame(), { senderId: CASH1981, terms: 'two trade for a wheat', requestId: 'multi-1', ...input }))
  const act = (state: ReturnType<typeof firstCivGame>, actorId: string, action: 'accept' | 'decline' | 'withdraw' | 'choose', requestId: string, chosenId?: string) =>
    transitionTradeOffer(state, { actorId, offerId: offer(state).id, action, requestId, ...(chosenId === undefined ? {} : { chosenId }) })

  it('goes to the players the sender picked, and to nobody else', () => {
    const state = to({ recipientIds: [CHUL, ITCHI] })
    expect(offer(state)).toMatchObject({ recipientIds: [CHUL, ITCHI], open: false, responses: [], chosenId: null })
    expect(act(state, KARANDRAS1, 'accept', 'r1').ok).toBe(false)
    expect(state.log.at(-1)?.publicLog).toContain('offered Chul and Itchi')
  })

  it('an open deal goes to every other player', () => {
    const state = to({ open: true })
    expect(offer(state).open).toBe(true)
    expect([...offer(state).recipientIds].sort()).toEqual([CHUL, ITCHI, KARANDRAS1].sort())
    expect(state.log.at(-1)?.publicLog).toContain('offered everyone')
  })

  it('refuses a deal with nobody to send it to, to the sender, or to a stranger', () => {
    const base = { senderId: CASH1981, terms: 'x', requestId: 'bad-1' }
    expect(createTradeOffer(firstCivGame(), { ...base, recipientIds: [] }).ok).toBe(false)
    expect(createTradeOffer(firstCivGame(), { ...base, recipientIds: [CHUL, CASH1981] }).ok).toBe(false)
    expect(createTradeOffer(firstCivGame(), { ...base, recipientIds: ['nobody'] }).ok).toBe(false)
  })

  it('an acceptance only says "I would": the offer stays pending until the sender chooses', () => {
    let state = to({ recipientIds: [CHUL, ITCHI] })
    state = unwrap(act(state, CHUL, 'accept', 'r1'))
    state = unwrap(act(state, ITCHI, 'accept', 'r2'))
    expect(offer(state)).toMatchObject({ status: 'pending', chosenId: null })
    expect(offer(state).responses).toEqual([
      { playerId: CHUL, action: 'accept' },
      { playerId: ITCHI, action: 'accept' },
    ])
    const chosen = unwrap(act(state, CASH1981, 'choose', 'r3', ITCHI))
    expect(offer(chosen)).toMatchObject({ status: 'accepted', chosenId: ITCHI })
    expect(chosen.log.at(-1)?.publicLog).toContain('chose Itchi')
    expect(toPlayerView(chosen, KARANDRAS1).tradeOffers[0]).toMatchObject({ chosenUsername: 'Itchi', recipientUsernames: ['Chul', 'Itchi'] })
  })

  it('only the sender chooses, and only a player who accepted', () => {
    let state = to({ recipientIds: [CHUL, ITCHI] })
    state = unwrap(act(state, CHUL, 'accept', 'r1'))
    expect(act(state, CHUL, 'choose', 'r2', CHUL).ok).toBe(false)
    expect(act(state, CASH1981, 'choose', 'r3', ITCHI).ok).toBe(false)
    expect(act(state, CASH1981, 'choose', 'r4').ok).toBe(false)
  })

  it('a recipient may change their answer while the offer is pending', () => {
    let state = to({ recipientIds: [CHUL, ITCHI] })
    state = unwrap(act(state, CHUL, 'accept', 'r1'))
    state = unwrap(act(state, CHUL, 'decline', 'r2'))
    expect(offer(state).responses).toEqual([{ playerId: CHUL, action: 'decline' }])
  })

  it('is declined only when every recipient has declined', () => {
    let state = to({ recipientIds: [CHUL, ITCHI] })
    state = unwrap(act(state, CHUL, 'decline', 'r1'))
    expect(offer(state).status).toBe('pending')
    state = unwrap(act(state, ITCHI, 'decline', 'r2'))
    expect(offer(state).status).toBe('declined')
  })

  it('a counter from one recipient leaves the offer open for the others, and links the thread', () => {
    const state = to({ recipientIds: [CHUL, ITCHI] })
    const countered = unwrap(counterTradeOffer(state, { actorId: CHUL, offerId: offer(state).id, terms: 'three trade', requestId: 'c1' }))
    expect(countered.tradeOffers[0]?.status).toBe('pending')
    expect(countered.tradeOffers[1]).toMatchObject({ senderId: CHUL, recipientIds: [CASH1981], parentOfferId: offer(state).id, status: 'pending' })
    // the other recipient can still answer the first offer
    expect(unwrap(transitionTradeOffer(countered, { actorId: ITCHI, offerId: offer(state).id, action: 'accept', requestId: 'r9' })).tradeOffers[0]?.responses).toHaveLength(1)
  })

  it('a plain offer is still closed by a counter', () => {
    const state = to({ recipientIds: [CHUL] })
    const countered = unwrap(counterTradeOffer(state, { actorId: CHUL, offerId: offer(state).id, terms: 'three trade', requestId: 'c1' }))
    expect(countered.tradeOffers[0]?.status).toBe('countered')
  })

  it('a plain offer that is accepted was made with its recipient', () => {
    const state = to({ recipientIds: [CHUL] })
    expect(offer(unwrap(act(state, CHUL, 'accept', 'a1'))).chosenId).toBe(CHUL)
  })

  it('an open deal in a game of two is a plain offer: the one recipient accepts and that is the deal', () => {
    const two = { ...firstCivGame(), players: firstCivGame().players.slice(0, 2) }
    const sender = two.players[0]!.playerId
    const other = two.players[1]!.playerId
    const state = unwrap(createTradeOffer(two, { senderId: sender, open: true, terms: 'a wheat', requestId: 'two-1' }))
    expect(offer(state)).toMatchObject({ open: true, recipientIds: [other] })
    const accepted = unwrap(transitionTradeOffer(state, { actorId: other, offerId: offer(state).id, action: 'accept', requestId: 'a1' }))
    expect(offer(accepted)).toMatchObject({ status: 'accepted', chosenId: other })
  })

  it('answers a retried create with the first outcome even after a recipient has left', () => {
    const state = to({ recipientIds: [CHUL, ITCHI] })
    const left = { ...state, players: state.players.filter((player) => player.playerId !== CHUL) }
    const again = createTradeOffer(left, { senderId: CASH1981, terms: 'two trade for a wheat', requestId: 'multi-1', recipientIds: [CHUL, ITCHI] })
    expect(unwrap(again)).toBe(left)
    // a different request under the same id is still refused
    expect(createTradeOffer(left, { senderId: CASH1981, terms: 'two trade for a wheat', requestId: 'multi-1', recipientIds: [ITCHI] }).ok).toBe(false)
  })

  it('does not let the sender choose a player who has left', () => {
    let state = to({ recipientIds: [CHUL, ITCHI] })
    state = unwrap(act(state, CHUL, 'accept', 'r1'))
    const left = { ...state, players: state.players.filter((player) => player.playerId !== CHUL) }
    expect(act(left, CASH1981, 'choose', 'r2', CHUL).ok).toBe(false)
  })

  it('is declined when everyone still in the game has declined, though a recipient has left', () => {
    let state = to({ recipientIds: [CHUL, ITCHI] })
    state = { ...state, players: state.players.filter((player) => player.playerId !== CHUL) }
    state = unwrap(act(state, ITCHI, 'decline', 'r1'))
    expect(offer(state).status).toBe('declined')
  })

  it('answers a retried create with the first outcome', () => {
    const state = to({ recipientIds: [CHUL, ITCHI] })
    const again = unwrap(createTradeOffer(state, { senderId: CASH1981, terms: 'two trade for a wheat', requestId: 'multi-1', recipientIds: [ITCHI, CHUL] }))
    expect(again).toBe(state)
    expect(createTradeOffer(state, { senderId: CASH1981, terms: 'two trade for a wheat', requestId: 'multi-1', open: true }).ok).toBe(false)
  })
})
