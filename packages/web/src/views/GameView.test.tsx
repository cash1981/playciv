// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import { AUTO_REFRESH_MS } from './GameView.js'

describe('game auto-refresh', () => {
  // The human asked for 10 s specifically ("setter auto refresh til 10
  // sekunder"); the toggle was introduced at 30 s (issue #63). This fails if
  // the interval is changed back without a decision.
  it('reloads the live game every 10 seconds', () => {
    expect(AUTO_REFRESH_MS).toBe(10_000)
  })
})
