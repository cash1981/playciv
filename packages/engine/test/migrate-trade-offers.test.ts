/**
 * An offer saved before deals could go to several players has one `recipientId`. Reading it gives
 * it the new shape: the same recipient as a list of one, answered by nobody, and (when accepted)
 * made with that recipient.
 */

import { describe, expect, it } from 'vitest'

import { migrateGameState } from '../src/migrate.js'
import type { GameState } from '../src/state.js'

import { CASH1981, CHUL, firstCivGame } from './fixture.js'

const oldOffer = (status: 'pending' | 'accepted') => ({
  id: 'o1',
  requestId: 'r1',
  senderId: CASH1981,
  recipientId: CHUL,
  terms: 'one wheat',
  turnNumber: 1,
  phase: 'TRADE',
  status,
  parentOfferId: null,
  createdAt: null,
  resolvedAt: null,
  logId: 'l1',
})

describe('migrateGameState and trade offers', () => {
  it('turns recipientId into a list of one, and keeps who an accepted deal was made with', () => {
    const game = { ...firstCivGame(), tradeOffers: [oldOffer('pending'), { ...oldOffer('accepted'), id: 'o2' }] }
    const [pending, accepted] = migrateGameState(game as unknown as GameState).tradeOffers
    expect(pending).toMatchObject({ recipientIds: [CHUL], open: false, responses: [], chosenId: null })
    expect(pending).not.toHaveProperty('recipientId')
    expect(accepted).toMatchObject({ recipientIds: [CHUL], chosenId: CHUL })
  })

  it('leaves an offer that already has the new shape alone', () => {
    const current = { ...oldOffer('pending'), recipientId: undefined, recipientIds: [CHUL], open: true, responses: [], chosenId: null }
    const [offer] = migrateGameState({ ...firstCivGame(), tradeOffers: [current] } as unknown as GameState).tradeOffers
    expect(offer).toMatchObject({ recipientIds: [CHUL], open: true })
  })
})
