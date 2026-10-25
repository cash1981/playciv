import { describe, expect, it } from 'vitest'

import type { PublicTradeOffer } from '@civ/engine'

import { listNames, offersOfTurn, recipientsText, responsesText, threadsOf, wentToSeveral } from './tradeDeals.js'

const offer = (id: string, overrides: Partial<PublicTradeOffer> = {}): PublicTradeOffer => ({
  id,
  senderId: 'a',
  senderUsername: 'Alice',
  recipientIds: ['b'],
  recipientUsernames: ['Bob'],
  open: false,
  responses: [],
  chosenId: null,
  chosenUsername: null,
  terms: id,
  turnNumber: 1,
  phase: 'TRADE',
  status: 'pending',
  parentOfferId: null,
  createdAt: null,
  resolvedAt: null,
  logId: id,
  ...overrides,
})

describe('threadsOf', () => {
  it('puts a counteroffer, and a counter to it, in the thread of the first offer', () => {
    const threads = threadsOf([offer('o1'), offer('o2', { parentOfferId: 'o1' }), offer('o3', { parentOfferId: 'o2' })])
    expect(threads).toHaveLength(1)
    expect(threads[0]?.root.id).toBe('o1')
    expect(threads[0]?.offers.map((entry) => entry.id)).toEqual(['o1', 'o2', 'o3'])
  })

  it('keeps separate deals apart, in the order they were started', () => {
    const threads = threadsOf([offer('o1'), offer('o2'), offer('o3', { parentOfferId: 'o1' }), offer('o4')])
    expect(threads.map((thread) => thread.offers.map((entry) => entry.id))).toEqual([['o1', 'o3'], ['o2'], ['o4']])
  })

  it('several counteroffers to one offer to several players share its thread', () => {
    const threads = threadsOf([offer('o1', { open: true }), offer('o2', { parentOfferId: 'o1', senderId: 'b' }), offer('o3', { parentOfferId: 'o1', senderId: 'c' })])
    expect(threads).toHaveLength(1)
    expect(threads[0]?.offers).toHaveLength(3)
  })

  it('starts a thread of its own for an offer whose parent is not in the list', () => {
    const threads = threadsOf([offer('o2', { parentOfferId: 'gone' })])
    expect(threads).toHaveLength(1)
    expect(threads[0]?.root.id).toBe('o2')
  })

  it('does not loop on offers that name each other as parent', () => {
    expect(() => threadsOf([offer('o1', { parentOfferId: 'o2' }), offer('o2', { parentOfferId: 'o1' })])).not.toThrow()
  })

  it('is empty for no offers', () => {
    expect(threadsOf([])).toEqual([])
  })
})

describe('the small helpers', () => {
  it('keeps only the offers of one turn', () => {
    const offers = [offer('o1', { turnNumber: 1 }), offer('o2', { turnNumber: 2 })]
    expect(offersOfTurn(offers, 2).map((entry) => entry.id)).toEqual(['o2'])
    expect(offersOfTurn(offers, 3)).toEqual([])
  })

  it('writes the names as a phrase', () => {
    expect(listNames([])).toBe('')
    expect(listNames(['Bob'])).toBe('Bob')
    expect(listNames(['Bob', 'Chul'])).toBe('Bob and Chul')
    expect(listNames(['Bob', 'Chul', 'Itchi'])).toBe('Bob, Chul and Itchi')
  })

  it('says who an offer went to, and whether it went to several', () => {
    expect(recipientsText(offer('o1'))).toBe('Bob')
    expect(recipientsText(offer('o1', { open: true, recipientUsernames: ['Bob', 'Chul'] }))).toBe('everyone')
    expect(wentToSeveral(offer('o1'))).toBe(false)
    expect(wentToSeveral(offer('o1', { recipientIds: ['b', 'c'] }))).toBe(true)
    // an open deal in a game of two has one recipient, and is a plain offer
    expect(wentToSeveral(offer('o1', { open: true }))).toBe(false)
    expect(wentToSeveral(offer('o1', { open: true, recipientIds: ['b', 'c'] }))).toBe(true)
  })

  it('writes what the recipients said', () => {
    expect(
      responsesText(
        offer('o1', {
          responses: [
            { playerId: 'b', username: 'Bob', action: 'accept' },
            { playerId: 'c', username: 'Chul', action: 'decline' },
          ],
        }),
      ),
    ).toBe('Bob accepted · Chul declined')
  })
})
