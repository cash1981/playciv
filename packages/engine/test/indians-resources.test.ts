/**
 * The Indians may spend any resource as incense, iron, silk or wheat (civilization card). Spy and Uranium are not covered.
 */

import { describe, expect, it } from 'vitest'

import { spendAnyResources, findResourcePayment, resourceAvailability, resourcePaymentOptions, returnResource, spendEachResource, spendResource } from '../src/assisted-resources.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'

import { withCivilization } from './culture-advance-fixture.js'
import { withCardInHand, withPieceInArea } from './assisted-fixture.js'
import { CASH1981, firstCivGame } from './fixture.js'

const withToken = (civ: string, asset: string): GameState =>
  withPieceInArea(withCivilization(firstCivGame(), civ), asset).state

describe('the Indians and resources', () => {
  it('spend a token of another resource as iron, and say so in the line', () => {
    const state = withToken('Indians', 'resources/silk')
    expect(findResourcePayment(state, CASH1981, 'Iron')).toMatchObject({ kind: 'piece', resource: 'Silk', asResource: 'Iron' })
    const spent = unwrap(spendResource(state, CASH1981, 'Iron', undefined, true))
    expect(spent.said).toBe('spent 1 Silk as Iron')
    expect(spent.state.board.pieces.some((piece) => piece.assetId === 'resources/silk')).toBe(false)
    // The undo puts the same token back
    const player = spent.state.players.find((candidate) => candidate.playerId === CASH1981)
    if (player === undefined) throw new Error('no player')
    const back = unwrap(returnResource(spent.state, player, spent.spent, null))
    expect(back.board.pieces.some((piece) => piece.assetId === 'resources/silk')).toBe(true)
  })

  it('offer the token as a choice for the four resources, labelled', () => {
    const state = withToken('Indians', 'resources/wheat')
    const options = resourcePaymentOptions(state, CASH1981, ['Iron'])
    expect(options.map((option) => option.label)).toEqual(['Wheat (player area) (as Iron)'])
  })

  it('prefer the real resource, and never cover Spy or Uranium', () => {
    const both = withPieceInArea(withToken('Indians', 'resources/silk'), 'resources/iron').state
    const payment = findResourcePayment(both, CASH1981, 'Iron')
    expect(payment).toMatchObject({ kind: 'piece', resource: 'Iron' })
    expect(payment).not.toHaveProperty('asResource')
    const silk = withToken('Indians', 'resources/silk')
    expect(findResourcePayment(silk, CASH1981, 'Spy')).toBeUndefined()
    expect(findResourcePayment(silk, CASH1981, 'Uranium')).toBeUndefined()
    expect(unwrapErr(spendResource(silk, CASH1981, 'Spy'))).toBe('NO_RESOURCE')
  })

  it('spend a token of another kind before a culture card that could pay, and warn about the token only', () => {
    const withCard = withCardInHand(withToken('Indians', 'resources/silk'), 'A Generous Gift').state
    // The card can pay iron by itself, but it would be lost: the Silk token goes first
    expect(findResourcePayment(withCard, CASH1981, 'Iron')).toMatchObject({ kind: 'piece', resource: 'Silk', asResource: 'Iron' })
    const spent = unwrap(spendResource(withCard, CASH1981, 'Iron'))
    expect(spent.spent.kind).toBe('piece')
    expect(resourceAvailability(withCard, CASH1981, 'Iron')).toMatchObject({ status: 'ready', warning: 'You have no Iron token: your Silk token would be spent as Iron.' })
    // Without any token the card is played, as before
    const cardOnly = withCardInHand(withCivilization(firstCivGame(), 'Indians'), 'A Generous Gift').state
    expect(findResourcePayment(cardOnly, CASH1981, 'Iron')).toMatchObject({ kind: 'card' })
  })

  it('pay one of each of two named kinds without a wildcard taking the token another kind needs', () => {
    // Silk and Iron wanted, with a Silk and a Wheat token: Iron takes the Wheat, never the Silk that Silk needs
    const state = withPieceInArea(withToken('Indians', 'resources/silk'), 'resources/wheat').state
    const paid = unwrap(spendEachResource(state, CASH1981, ['Iron', 'Silk']))
    expect(paid.spent.map((payment) => [payment.resource, payment.kind === 'card' ? undefined : payment.asResource])).toEqual([
      ['Wheat', 'Iron'],
      ['Silk', undefined],
    ])
  })

  it('keep the named preference of an Any cost: the Silk token pays the Silk slot', () => {
    const state = withPieceInArea(withToken('Indians', 'resources/silk'), 'resources/wheat').state
    const paid = unwrap(spendAnyResources(state, CASH1981, ['Iron', 'Silk']))
    expect(paid.spent.map((payment) => payment.resource).sort()).toEqual(['Silk', 'Wheat'])
    expect(paid.spent.every((payment) => payment.kind === 'card' || payment.asResource === undefined)).toBe(true)
    expect(paid.said).not.toContain(' as ')
  })

  it('list each token once for an Any cost, without wildcard copies', () => {
    const state = withPieceInArea(withToken('Indians', 'resources/silk'), 'resources/wheat').state
    const labels = resourcePaymentOptions(state, CASH1981, [null]).map((option) => option.label)
    expect(labels.sort()).toEqual(['Silk (player area)', 'Wheat (player area)'])
  })

  it('give nothing to another civilization', () => {
    expect(findResourcePayment(withToken('Romans', 'resources/silk'), CASH1981, 'Iron')).toBeUndefined()
  })
})
