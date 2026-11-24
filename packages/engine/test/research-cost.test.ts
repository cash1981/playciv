/**
 * The trade a tech costs to research: 6, 11, 16, 21 and 27 (Space Flight). The Japanese card, "Require 3 less trade to
 * research new techs of any level", takes 3 off every level (human, 2026-11-24).
 */

import { describe, expect, it } from 'vitest'

import { researchTradeCostOf } from '../src/research-cost.js'

describe('researchTradeCostOf', () => {
  it('is 6, 11, 16, 21 and 27 for levels 1 to 5', () => {
    expect([1, 2, 3, 4, 5].map((level) => researchTradeCostOf(level))).toEqual([6, 11, 16, 21, 27])
  })

  it('is the same for every civilization but the Japanese, and with none', () => {
    for (const civilization of [undefined, null, 'Romans', 'Chinese', 'japanese']) {
      expect([1, 2, 3, 4, 5].map((level) => researchTradeCostOf(level, civilization))).toEqual([6, 11, 16, 21, 27])
    }
  })

  it('is 3 less at every level for the Japanese, Space Flight included', () => {
    expect([1, 2, 3, 4, 5].map((level) => researchTradeCostOf(level, 'Japanese'))).toEqual([3, 8, 13, 18, 24])
  })

  it('is null for a level outside 1 to 5', () => {
    for (const level of [0, 6, -1, 1.5, Number.NaN]) {
      expect(researchTradeCostOf(level)).toBeNull()
      expect(researchTradeCostOf(level, 'Japanese')).toBeNull()
    }
  })
})
