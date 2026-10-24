/**
 * The culture track as a ladder: which space is what, what an advance costs and
 * how many cards it draws. The movement of the marker is in `culture-track.test.ts`
 * and the action itself in `assisted-culture-advance.test.ts`.
 */

import { describe, expect, it } from 'vitest'

import { CULTURE_VICTORY_STEP } from '../src/board.js'
import {
  CULTURE_LADDER,
  GREAT_PERSON_STEPS,
  cultureAdvanceCost,
  cultureMarkerOf,
  cultureSpaceAt,
  rewardDrawCount,
} from '../src/culture-track.js'
import type { TechItem } from '../src/item.js'
import type { GameState, Playerhand, SocialPolicyItem } from '../src/index.js'
import { findPlayer } from '../src/state.js'

import { advanceTurn, withStats } from './culture-advance-fixture.js'
import { CASH1981 } from './fixture.js'

const me = (state: GameState): Playerhand => {
  const player = findPlayer(state, CASH1981)
  if (player === undefined) throw new Error('fixture player missing')
  return player
}

const withEfta = (state: GameState, efta: number): GameState => withStats(state, { efta })

const withCoins = (state: GameState, coins: number): GameState =>
  withStats(state, {
    coinSources: { ...me(state).stats.coinSources, sheet: coins },
  })

describe('the ladder', () => {
  it('has the 21 spaces, the last being Culture Victory', () => {
    expect(CULTURE_LADDER).toHaveLength(21)
    expect(CULTURE_LADDER.at(-1)?.step).toBe(CULTURE_VICTORY_STEP)
    expect(cultureSpaceAt(0)).toBeUndefined()
    expect(cultureSpaceAt(22)).toBeUndefined()
  })

  it('has Great Person spaces at 3, 7, 12 and 18 and a culture event everywhere else', () => {
    expect(GREAT_PERSON_STEPS).toEqual([3, 7, 12, 18])
    const greatPersons = CULTURE_LADDER.filter((space) => space.kind === 'greatPerson').map((space) => space.step)
    expect(greatPersons).toEqual([3, 7, 12, 18])
    expect(CULTURE_LADDER.filter((space) => space.kind === 'event')).toHaveLength(17)
  })

  it('is three sections of seven: level 1 to 7, level 2 to 14, level 3 to 21', () => {
    const levels = CULTURE_LADDER.map((space) => space.level)
    expect(levels.slice(0, 7)).toEqual(Array(7).fill(1))
    expect(levels.slice(7, 14)).toEqual(Array(7).fill(2))
    expect(levels.slice(14)).toEqual(Array(7).fill(3))
  })

  it('a Great Person space belongs to its section', () => {
    expect(cultureSpaceAt(7)).toEqual({ step: 7, kind: 'greatPerson', level: 1 })
    expect(cultureSpaceAt(8)).toEqual({ step: 8, kind: 'event', level: 2 })
    expect(cultureSpaceAt(12)).toEqual({ step: 12, kind: 'greatPerson', level: 2 })
    expect(cultureSpaceAt(18)).toEqual({ step: 18, kind: 'greatPerson', level: 3 })
  })
})

describe('what an advance costs', () => {
  const state = advanceTurn()
  const player = me(state)

  it.each([
    [1, 3, 0],
    [3, 3, 0],
    [7, 3, 0],
    [8, 5, 3],
    [12, 5, 3],
    [14, 5, 3],
    [15, 7, 6],
    [18, 7, 6],
    [21, 7, 6],
  ])('space %i costs %i culture and %i trade with no discount', (step, culture, trade) => {
    expect(cultureAdvanceCost(state, player, step)).toEqual({ culture, trade })
  })

  it('a step outside the ladder costs nothing', () => {
    expect(cultureAdvanceCost(state, player, 0)).toEqual({ culture: 0, trade: 0 })
    expect(cultureAdvanceCost(state, player, 22)).toEqual({ culture: 0, trade: 0 })
  })

  describe('Endowment for the Arts', () => {
    it.each([
      [0, 3], [1, 3], [2, 2], [3, 2], [4, 1], [9, 1],
    ])('%i investments take the culture cost of level 1 from 3 to %i', (efta, culture) => {
      expect(cultureAdvanceCost(withEfta(state, efta), me(withEfta(state, efta)), 1).culture).toBe(culture)
    })

    it('takes the same off at every level, and nothing off the trade', () => {
      const two = withEfta(state, 2)
      expect(cultureAdvanceCost(two, me(two), 8)).toEqual({ culture: 4, trade: 3 })
      expect(cultureAdvanceCost(two, me(two), 15)).toEqual({ culture: 6, trade: 6 })
      const four = withEfta(state, 4)
      expect(cultureAdvanceCost(four, me(four), 8)).toEqual({ culture: 3, trade: 3 })
      expect(cultureAdvanceCost(four, me(four), 15)).toEqual({ culture: 5, trade: 6 })
    })

    it('takes at most 2 off however many investments, which leaves 1 at level 1', () => {
      // The floor at 0 is in the code but no printed cost is low enough to reach it with EftA alone
      const many = withEfta(state, 40)
      expect(cultureAdvanceCost(many, me(many), 1).culture).toBe(1)
    })
  })

  describe('Ecology', () => {
    const ecology = advanceTurn({ techs: ['Ecology'] })

    it('takes 1 off the trade for every 3 coins', () => {
      for (const [coins, trade] of [[0, 3], [2, 3], [3, 2], [5, 2], [6, 1], [8, 1], [9, 0]] as const) {
        const next = withCoins(ecology, coins)
        expect(cultureAdvanceCost(next, me(next), 8)).toEqual({ culture: 5, trade })
      }
    })

    it('never takes the trade below zero, and has no trade to take at level 1', () => {
      const rich = withCoins(ecology, 60)
      expect(cultureAdvanceCost(rich, me(rich), 8).trade).toBe(0)
      expect(cultureAdvanceCost(rich, me(rich), 15).trade).toBe(0)
      expect(cultureAdvanceCost(rich, me(rich), 1)).toEqual({ culture: 3, trade: 0 })
    })

    it('does nothing while Ecology is hidden, so a cost cannot show what the owner holds', () => {
      const hidden = {
        ...ecology,
        players: ecology.players.map((candidate) => ({
          ...candidate,
          techsChosen: candidate.techsChosen.map((tech): TechItem => ({ ...tech, hidden: true })),
        })),
      }
      const rich = withCoins(hidden, 30)
      expect(cultureAdvanceCost(rich, me(rich), 8)).toEqual({ culture: 5, trade: 3 })
    })

    it('stacks with Endowment for the Arts', () => {
      const both = withEfta(withCoins(ecology, 3), 4)
      expect(cultureAdvanceCost(both, me(both), 15)).toEqual({ culture: 5, trade: 5 })
    })
  })
})

describe('how many cards an advance draws', () => {
  const plain = advanceTurn()

  it('is 1 with nothing revealed', () => {
    expect(rewardDrawCount(plain, me(plain), 'event')).toBe(1)
    expect(rewardDrawCount(plain, me(plain), 'greatPerson')).toBe(1)
  })

  it('a culture event draws 1 more with Mysticism revealed, and Great Person extras do not apply to it', () => {
    const mysticism = advanceTurn({ techs: ['Mysticism'] })
    expect(rewardDrawCount(mysticism, me(mysticism), 'event')).toBe(2)
    expect(rewardDrawCount(mysticism, me(mysticism), 'greatPerson')).toBe(1)
    const greeks = advanceTurn({ civ: 'Greeks', policies: ['Organized Religion'] })
    expect(rewardDrawCount(greeks, me(greeks), 'event')).toBe(1)
  })

  it('a Great Person space draws 1 more for Organized Religion and 1 more for the Greeks', () => {
    const religion = advanceTurn({ policies: ['Organized Religion'] })
    expect(rewardDrawCount(religion, me(religion), 'greatPerson')).toBe(2)
    const greeks = advanceTurn({ civ: 'Greeks' })
    expect(rewardDrawCount(greeks, me(greeks), 'greatPerson')).toBe(2)
  })

  it('the Great Person extras stack, and Mysticism does not join them', () => {
    const all = advanceTurn({ civ: 'Greeks', policies: ['Organized Religion'], techs: ['Mysticism'] })
    expect(rewardDrawCount(all, me(all), 'greatPerson')).toBe(3)
    expect(rewardDrawCount(all, me(all), 'event')).toBe(2)
  })

  it('counts only what is revealed', () => {
    const hidden = advanceTurn({ policies: ['Organized Religion'], techs: ['Mysticism'] })
    const covered = {
      ...hidden,
      players: hidden.players.map((candidate) => ({
        ...candidate,
        techsChosen: candidate.techsChosen.map((tech): TechItem => ({ ...tech, hidden: true })),
        socialPolicies: candidate.socialPolicies.map((policy): SocialPolicyItem => ({ ...policy, hidden: true })),
      })),
    }
    expect(rewardDrawCount(covered, me(covered), 'event')).toBe(1)
    expect(rewardDrawCount(covered, me(covered), 'greatPerson')).toBe(1)
  })
})

describe('the marker', () => {
  it('is the leader piece in the player colour, with the space it stands on', () => {
    const state = advanceTurn({ step: 5 })
    const marker = cultureMarkerOf(state, me(state))
    expect(marker?.step).toBe(5)
    expect(marker?.piece.assetId).toBe('leaders/japanese_red')
  })

  it('is undefined with no civilization or no piece', () => {
    const state = advanceTurn()
    expect(cultureMarkerOf(state, { ...me(state), civilization: null })).toBeUndefined()
    expect(cultureMarkerOf({ ...state, board: { ...state.board, pieces: [] } }, me(state))).toBeUndefined()
  })
})
