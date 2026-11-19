/**
 * The Indians may spend any resource as incense, iron, silk or wheat (civilization card). Spy and Uranium are not covered.
 */

import { describe, expect, it } from 'vitest'

import { findResourcePayment, resourcePaymentOptions, returnResource, spendResource } from '../src/assisted-resources.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'

import { withCivilization } from './culture-advance-fixture.js'
import { withPieceInArea } from './assisted-fixture.js'
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
    expect(findResourcePayment(both, CASH1981, 'Iron')).toMatchObject({ resource: 'Iron' })
    expect(findResourcePayment(both, CASH1981, 'Iron')?.kind === 'piece' && (findResourcePayment(both, CASH1981, 'Iron') as { asResource?: string }).asResource).toBeFalsy()
    const silk = withToken('Indians', 'resources/silk')
    expect(findResourcePayment(silk, CASH1981, 'Spy')).toBeUndefined()
    expect(findResourcePayment(silk, CASH1981, 'Uranium')).toBeUndefined()
    expect(unwrapErr(spendResource(silk, CASH1981, 'Spy'))).toBe('NO_RESOURCE')
  })

  it('give nothing to another civilization', () => {
    expect(findResourcePayment(withToken('Romans', 'resources/silk'), CASH1981, 'Iron')).toBeUndefined()
  })
})
