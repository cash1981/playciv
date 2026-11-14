/** Private games (issue #348): `joinGame` seats only the invited. */

import { describe, expect, it } from 'vitest'

import { createGame, joinGame } from '../src/index.js'

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
})
