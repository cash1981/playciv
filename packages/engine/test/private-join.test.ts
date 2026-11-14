/** Private games (issue #348): `joinGame` seats only the invited. */

import { describe, expect, it } from 'vitest'

import { createGame, joinGame, withdrawFromGame } from '../src/index.js'
import { migrateGameState } from '../src/migrate.js'
import type { GameState } from '../src/index.js'

describe('joinGame in a private game', () => {
  const base = createGame({ name: 'private', numOfPlayers: 3, seed: 'private', secret: 's', players: [] })
  const state = { ...base, invitedPlayerIds: ['a', 'b'] }

  it('refuses a player who was not invited', () => {
    const result = joinGame(state, { playerId: 'c', username: 'c' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('NOT_INVITED')
  })

  it('seats an invited player, and anyone in a public game', () => {
    expect(joinGame(state, { playerId: 'b', username: 'b' }).ok).toBe(true)
    expect(joinGame(base, { playerId: 'c', username: 'c' }).ok).toBe(true)
  })

  it('keeps a withdrawn seat for the invited too: a stranger cannot take it over', () => {
    const seated = (id: string) => (current: GameState): GameState => {
      const result = joinGame(current, { playerId: id, username: id })
      if (!result.ok) throw new Error('join failed')
      return result.value
    }
    const full = seated('b')(seated('a')(state))
    const left = withdrawFromGame(full, 'b')
    if (!left.ok) throw new Error('withdraw failed')
    expect(left.value.withdrawnPlayers).toHaveLength(1)
    const stranger = joinGame(left.value, { playerId: 'c', username: 'c' })
    expect(stranger.ok).toBe(false)
    if (!stranger.ok) expect(stranger.error.kind).toBe('NOT_INVITED')
    // Only an invited account that is not seated may take the freed seat.
    expect(joinGame(left.value, { playerId: 'b', username: 'b' }).ok).toBe(true)
  })

  it('survives a migration', () => {
    expect(migrateGameState(state as unknown as GameState).invitedPlayerIds).toEqual(['a', 'b'])
  })
})
