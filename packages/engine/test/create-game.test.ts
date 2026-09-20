/**
 * `GameState.createdAt`, so the old list view's "Created" column has a source.
 * There is no Java counterpart: the old client showed `PBF.created`, which the
 * rewrite never carried across. The server stamps the timestamp; the engine is
 * pure and only stores what it is given.
 */

import { describe, expect, it } from 'vitest'

import { createGame } from '../src/create-game.js'
import { migrateGameState } from '../src/migrate.js'
import type { GameState } from '../src/state.js'

const STAMP = '2026-09-20T12:00:00.000Z'

describe('createGame createdAt', () => {
  it('stores the timestamp it is given', () => {
    const state = createGame({
      name: 'stamped',
      numOfPlayers: 4,
      seed: 'stamped',
      createdAt: STAMP,
    })

    expect(state.createdAt).toBe(STAMP)
  })

  it('defaults to null when it is not given', () => {
    const state = createGame({ name: 'unstamped', numOfPlayers: 4, seed: 'unstamped' })

    expect(state.createdAt).toBeNull()
  })
})

describe('migrateGameState createdAt', () => {
  it('defaults a game saved before the field existed to null', () => {
    const state = createGame({
      name: 'older',
      numOfPlayers: 4,
      seed: 'older',
      createdAt: STAMP,
    })
    const { createdAt: _createdAt, ...without } = state

    const migrated = migrateGameState(without as unknown as GameState)

    expect(migrated.createdAt).toBeNull()
  })

  it('keeps an existing createdAt', () => {
    const state = createGame({
      name: 'current',
      numOfPlayers: 4,
      seed: 'current',
      createdAt: STAMP,
    })

    expect(migrateGameState(state).createdAt).toBe(STAMP)
  })
})
