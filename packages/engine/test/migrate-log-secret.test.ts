/**
 * A game saved before public item numbers were keyed has no `logSecret`. It
 * stays empty on read: nothing in the game state is safe to derive a key from,
 * because the rng stream is published through log and item ids. The server
 * puts a random key in before the next action.
 */

import { describe, expect, it } from 'vitest'

import { migrateGameState } from '../src/migrate.js'
import type { GameState } from '../src/state.js'

import { firstCivGame } from './fixture.js'

describe('migrateGameState and logSecret', () => {
  it('leaves a game without a key empty, never a value the game hands out as an id', () => {
    const { logSecret: _dropped, ...older } = firstCivGame()
    const migrated = migrateGameState(older as unknown as GameState)
    expect(migrated.logSecret).toBe('')
  })

  it('keeps the key a game already has', () => {
    const game = { ...firstCivGame(), logSecret: 'kept' }
    expect(migrateGameState(game).logSecret).toBe('kept')
  })
})
