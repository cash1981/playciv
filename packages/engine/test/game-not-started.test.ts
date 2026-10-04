/**
 * A game whose table is not full has not started: nobody has `yourTurn` until
 * `startIfAllPlayers` runs, so it has no active turn and takes no orders.
 */

import { describe, expect, it } from 'vitest'

import { joinGame, withdrawFromGame } from '../src/actions/game.js'
import { markPhasesDone, postOrder, unmarkPhaseDone } from '../src/actions/turn.js'
import { createGame } from '../src/create-game.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { activeTurnStatus, toPlayerView } from '../src/state.js'
import { gameHasStarted } from '../src/turn.js'

const AT = '2026-05-01T10:00:00.000Z'

const lobby = (): GameState => {
  let state = createGame({ name: 'Lobby', numOfPlayers: 4, seed: 'lobby' })
  state = unwrap(joinGame(state, { playerId: 'p1', username: 'one', gameCreator: true }))
  return state
}

const fill = (state: GameState): GameState => {
  let next = state
  for (const [playerId, username] of [['p2', 'two'], ['p3', 'three'], ['p4', 'four']] as const) {
    next = unwrap(joinGame(next, { playerId, username }))
  }
  return next
}

describe('a game that has not started', () => {
  it('has no active turn, in the state or in the view', () => {
    const state = lobby()
    expect(gameHasStarted(state)).toBe(false)
    expect(state.players).toHaveLength(1)
    expect(activeTurnStatus(state)).toBeNull()
    expect(toPlayerView(state, 'p1').activeTurn).toBeNull()
  })

  it('takes no order and no done marker, and writes nothing', () => {
    const state = lobby()
    const post = unwrapErr(postOrder(state, { playerId: 'p1', turnNumber: 1, phase: 'SOT', markdown: 'plan', at: AT }))
    const done = unwrapErr(markPhasesDone(state, { playerId: 'p1', turnNumber: 1, upToPhase: 'SOT', at: AT }))
    const undone = unwrapErr(unmarkPhaseDone(state, { playerId: 'p1', turnNumber: 1, phase: 'SOT' }))
    expect(post).toEqual({ kind: 'GAME_NOT_STARTED' })
    expect(done).toEqual({ kind: 'GAME_NOT_STARTED' })
    expect(undone).toEqual({ kind: 'GAME_NOT_STARTED' })
    // The input state is untouched: no turn, no public copy, no log line
    expect(state.players[0]?.playerTurns).toEqual([])
    expect(state.publicTurns).toEqual({})
  })

  it('still answers a stranger with no access, not with "not started"', () => {
    const error = unwrapErr(postOrder(lobby(), { playerId: 'stranger', turnNumber: 1, phase: 'SOT', markdown: 'x', at: AT }))
    expect(error.kind).toBe('NO_ACCESS')
  })

  it('starts normally when the table fills: the first turn is active and takes orders', () => {
    const started = fill(lobby())
    expect(gameHasStarted(started)).toBe(true)
    const status = activeTurnStatus(started)
    expect(status?.turnNumber).toBe(1)
    expect(status?.waitingFor).toHaveLength(4)
    const first = started.players.find((player) => player.yourTurn)
    if (first === undefined) throw new Error('nobody holds the first turn')

    const posted = unwrap(postOrder(started, { playerId: first.playerId, turnNumber: 1, phase: 'SOT', markdown: 'plan', at: AT }))

    expect(posted.publicTurns[`1${first.username}`]?.orders.SOT).toBe('plan')
  })

  it('counts as started when the player who held the first turn has withdrawn', () => {
    const started = fill(lobby())
    const first = started.players.find((player) => player.yourTurn)
    if (first === undefined) throw new Error('nobody holds the first turn')
    const gone = unwrap(withdrawFromGame(started, first.playerId))
    expect(gone.players.some((player) => player.yourTurn)).toBe(false)

    expect(gameHasStarted(gone)).toBe(true)
    expect(activeTurnStatus(gone)).not.toBeNull()
    const other = gone.players[0]
    if (other === undefined) throw new Error('no one left')
    expect(postOrder(gone, { playerId: other.playerId, turnNumber: 1, phase: 'SOT', markdown: 'still plays', at: AT }).ok).toBe(true)
  })
})
