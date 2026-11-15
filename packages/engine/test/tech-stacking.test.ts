/**
 * The stacking limit a revealed tech gives (Masonry 3, Printing Press 4, Biology 5, Replacement Parts 6): the highest counts,
 * a hidden tech gives nothing, a higher typed value wins, and Louis Pasteur's +1 goes on top.
 */

import { describe, expect, it } from 'vitest'

import { stackingLimitOf } from '../src/great-person-effects.js'
import { techStackingOf } from '../src/movement.js'
import { toPlayerView, findPlayer } from '../src/state.js'
import type { GameState } from '../src/state.js'

import { withCardInHand } from './assisted-fixture.js'
import { withStats } from './culture-advance-fixture.js'
import { CASH1981, firstCivGame } from './fixture.js'

type Techs = readonly { readonly name: string; readonly hidden: boolean }[]

const withTechs = (state: GameState, techs: Techs): GameState => ({
  ...state,
  players: state.players.map((candidate) =>
    candidate.playerId === CASH1981
      ? { ...candidate, techsChosen: techs.map((tech) => ({ ...tech }) as GameState['players'][number]['techsChosen'][number]) }
      : candidate,
  ),
})

const limit = (state: GameState): number => {
  const player = findPlayer(state, CASH1981)
  if (player === undefined) throw new Error('no player')
  return stackingLimitOf(state, player)
}

describe('stacking limit from techs', () => {
  const base = withStats(firstCivGame(), { stacking: 2 })

  it('each tech alone sets the limit', () => {
    for (const [name, expected] of [['Masonry', 3], ['Printing Press', 4], ['Biology', 5], ['Replacement Parts', 6]] as const) {
      expect(limit(withTechs(base, [{ name, hidden: false }]))).toBe(expected)
    }
    expect(limit(base)).toBe(2)
  })

  it('the highest counts and they do not add up', () => {
    expect(techStackingOf([{ name: 'Masonry', hidden: false }, { name: 'Biology', hidden: false }])).toEqual({ limit: 5, tech: 'Biology' })
    expect(limit(withTechs(base, [{ name: 'Masonry', hidden: false }, { name: 'Printing Press', hidden: false }]))).toBe(4)
  })

  it('a hidden tech gives nothing', () => {
    expect(limit(withTechs(base, [{ name: 'Biology', hidden: true }, { name: 'Masonry', hidden: false }]))).toBe(3)
    expect(limit(withTechs(base, [{ name: 'Biology', hidden: true }]))).toBe(2)
  })

  it('a typed value that is higher still wins', () => {
    expect(limit(withTechs(withStats(firstCivGame(), { stacking: 5 }), [{ name: 'Masonry', hidden: false }]))).toBe(5)
  })

  it('Louis Pasteur adds 1 on top of the tech', () => {
    const card = withCardInHand(withTechs(base, [{ name: 'Printing Press', hidden: false }]), 'Louis Pasteur')
    const state: GameState = {
      ...card.state,
      players: card.state.players.map((candidate) => ({
        ...candidate,
        items: candidate.items.map((item) => (item.id === card.itemId ? { ...item, hidden: false } : item)),
      })),
    }
    expect(limit(state)).toBe(5)
  })

  it('movement receives the effective limit through the player view', () => {
    const state = withTechs(base, [{ name: 'Replacement Parts', hidden: false }])
    expect(toPlayerView(state, CASH1981).you?.stackingLimit).toBe(6)
  })
})
