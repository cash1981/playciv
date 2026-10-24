/**
 * The rush maths of the Build action (base rules p. 15): every 3 trade lowers the
 * production shortfall by 1, in whole steps and never more than needed. The
 * Americans get 2 production per 3 trade.
 */

import { describe, expect, it } from 'vitest'

import { TRADE_PER_RUSH_STEP, rushTradeCost } from '../src/build-options.js'

describe('rushTradeCost', () => {
  it('nothing is paid when there is no shortfall', () => {
    expect(rushTradeCost(0, null)).toBe(0)
    expect(rushTradeCost(-4, 'Americans')).toBe(0)
    expect(rushTradeCost(Number.NaN, null)).toBe(0)
  })

  it('every production missing costs 3 trade', () => {
    expect(TRADE_PER_RUSH_STEP).toBe(3)
    expect(rushTradeCost(1, null)).toBe(3)
    expect(rushTradeCost(2, 'Romans')).toBe(6)
    expect(rushTradeCost(5, undefined)).toBe(15)
  })

  it('the Americans pay 3 trade for 2 production', () => {
    expect(rushTradeCost(2, 'Americans')).toBe(3)
    expect(rushTradeCost(4, 'Americans')).toBe(6)
    expect(rushTradeCost(10, 'Americans')).toBe(15)
  })

  it('the Americans round an odd shortfall up to a whole step, never down', () => {
    // 1 short needs one step, and so does 2; 3 short needs two steps
    expect(rushTradeCost(1, 'Americans')).toBe(3)
    expect(rushTradeCost(3, 'Americans')).toBe(6)
    expect(rushTradeCost(5, 'Americans')).toBe(9)
    expect(rushTradeCost(7, 'Americans')).toBe(12)
  })

  it('always whole steps of 3 and never more than needed', () => {
    for (const civ of [null, 'Americans']) {
      for (let shortfall = 1; shortfall <= 30; shortfall += 1) {
        const trade = rushTradeCost(shortfall, civ)
        const perStep = civ === 'Americans' ? 2 : 1
        expect(trade % TRADE_PER_RUSH_STEP).toBe(0)
        // It covers the shortfall, and one step less would not
        expect((trade / TRADE_PER_RUSH_STEP) * perStep).toBeGreaterThanOrEqual(shortfall)
        expect((trade / TRADE_PER_RUSH_STEP - 1) * perStep).toBeLessThan(shortfall)
      }
    }
  })
})
