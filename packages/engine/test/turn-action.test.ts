/**
 * Turn data kept from the old Turn orders panel, and the active turn.
 *
 * The panel's actions are gone; what is left is the stored shape of its data,
 * which the migration and the timeline still read, and the projection that keeps
 * an unpublished draft from other players. `savedOrder` builds that data.
 */

import { describe, expect, it } from 'vitest'

import { markPhasesDone, postOrder } from '../src/actions/turn.js'
import { unwrap } from '../src/result.js'
import { migrateGameState } from '../src/migrate.js'
import { activeTurnStatus, toPlayerView } from '../src/state.js'
import type { PlayerTurn } from '../src/turn.js'
import { createPlayerTurn, migratePlayerTurn, publicTurn } from '../src/turn.js'

import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'
import { savedOrder } from './saved-orders.js'

describe('saved turns migrate', () => {
  it('migrates an old turn as already public', () => {
    const state = savedOrder(firstCivGame(), CASH1981, 1, 'SOT', 'old order')
    const oldTurn = { ...state.publicTurns['1cash1981'] } as Record<string, unknown>
    delete oldTurn['revealed']
    oldTurn['orders'] = { ...state.publicTurns['1cash1981']?.orders, SOT: 'old order' }
    const migrated = migrateGameState({
      ...state,
      players: state.players.map((player) => ({
        ...player,
        playerTurns: player.playerTurns.map((turn) => {
          const old = { ...turn } as Record<string, unknown>
          delete old['revealed']
          return old
        }),
      })),
      publicTurns: { '1cash1981': oldTurn },
    } as unknown as typeof state)

    expect(migrated.publicTurns['1cash1981']?.revealed.SOT).toBe(true)
    expect(migrated.players[0]?.playerTurns[0]?.revealed.SOT).toBe(true)
    expect(migrated.publicTurns['1cash1981']?.orders.SOT).toBe('old order')
  })

  it('migration drops legacy string histories and is idempotent', () => {
    const state = savedOrder(firstCivGame(), CASH1981, 1, 'SOT', 'current')
    const stored = state.publicTurns['1cash1981'] as PlayerTurn
    // The old save-based history: bare strings, including the current order.
    const legacy = {
      ...stored,
      history: { ...stored.history, SOT: ['saved first', 'current'] },
    } as unknown as PlayerTurn

    const migratedTurn = migratePlayerTurn(legacy)
    expect(migratedTurn.history.SOT).toEqual([])
    // Running it again changes nothing.
    expect(migratePlayerTurn(migratedTurn).history.SOT).toEqual([])

    // A real revealed version survives untouched.
    const withVersion = {
      ...migratedTurn,
      history: { ...migratedTurn.history, SOT: [{ markdown: 'kept', at: 't1' }] },
    }
    expect(migratePlayerTurn(withVersion).history.SOT).toEqual([{ markdown: 'kept', at: 't1' }])

    // A save written before `history` existed is tolerated.
    const withoutHistory = { ...stored, history: undefined } as unknown as PlayerTurn
    expect(migratePlayerTurn(withoutHistory).history.SOT).toEqual([])
  })
})

describe('hidden information', () => {
  it('gamenote and private turn lists do not leak through publicTurns', () => {
    const withNote = firstCivGame()
    const state = unwrap(
      postOrder(
        {
          ...withNote,
          players: withNote.players.map((player) =>
            player.playerId === CASH1981 ? { ...player, gamenote: 'NOTE-SECRET' } : player,
          ),
        },
        { playerId: CASH1981, turnNumber: 1, phase: 'SOT', markdown: 'public order', at: 't1' },
      ),
    )
    expect(JSON.stringify(state.publicTurns)).toContain('public order')
    expect(JSON.stringify(state.publicTurns)).not.toContain('NOTE-SECRET')
    expect(JSON.stringify(state.publicTurns)).not.toContain('gamenote')
  })

  it('an unpublished phase is masked in the public copy, and a published version stays', () => {
    const turn: PlayerTurn = {
      ...createPlayerTurn('cash1981', 1),
      orders: { SOT: 'new private draft', TRADE: 'published trade', CM: '', MOVEMENT: '', RESEARCH: '' },
      revealed: { SOT: false, TRADE: true, CM: false, MOVEMENT: false, RESEARCH: false },
      history: {
        SOT: [{ markdown: 'published plan', at: 't1' }],
        TRADE: [{ markdown: 'published trade', at: 't2' }],
        CM: [],
        MOVEMENT: [],
        RESEARCH: [],
      },
    }

    const masked = publicTurn(turn)

    // Editing made the phase private again, but a version that was published is public history
    expect(masked.orders.SOT).toBe('')
    expect(masked.history.SOT).toEqual([{ markdown: 'published plan', at: 't1' }])
    expect(masked.orders.TRADE).toBe('published trade')
    expect(JSON.stringify(masked)).not.toContain('new private draft')
    // The projection is pure: the stored turn keeps its draft
    expect(turn.orders.SOT).toBe('new private draft')
  })
})

describe('activeTurnStatus', () => {
  const everybody = [CASH1981, KARANDRAS1, ITCHI, CHUL]

  it('is null when there are no active players', () => {
    expect(activeTurnStatus({ ...firstCivGame(), players: [] })).toBeNull()
  })

  it('reports SOT and turn 1, with everybody waiting, for a fresh game', () => {
    expect(activeTurnStatus(firstCivGame())).toEqual({
      playerId: CASH1981,
      username: 'cash1981',
      turnNumber: 1,
      phase: 'SOT',
      waitingFor: [
        { username: 'cash1981', phase: 'SOT' },
        { username: 'Karandras1', phase: 'SOT' },
        { username: 'Itchi', phase: 'SOT' },
        { username: 'Chul', phase: 'SOT' },
      ],
      startPlayer: 'cash1981',
    })
  })

  it('moves to the next player in seat order once the holder has marked the phase done', () => {
    const state = unwrap(markPhasesDone(firstCivGame(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'SOT' }))
    expect(activeTurnStatus(state)).toMatchObject({ playerId: KARANDRAS1, turnNumber: 1, phase: 'SOT' })
  })

  it('rolls over to SOT of the next turn number once everybody has finished Research', () => {
    const state = everybody.reduce(
      (current, playerId) => unwrap(markPhasesDone(current, { playerId, turnNumber: 1, upToPhase: 'RESEARCH' })),
      firstCivGame(),
    )
    // The marker has moved on to the next seat, and that player holds turn 2
    expect(activeTurnStatus(state)).toMatchObject({
      playerId: KARANDRAS1,
      turnNumber: 2,
      phase: 'SOT',
      startPlayer: 'Karandras1',
    })
  })

  it('shows only phases and names to every viewer, never order text', () => {
    let state = savedOrder(firstCivGame(), CASH1981, 1, 'SOT', 'top secret plan', 't1')
    state = savedOrder(state, CASH1981, 1, 'TRADE', 'unpublished draft text')

    const opponentView = toPlayerView(state, KARANDRAS1)
    expect(opponentView.activeTurn).toEqual(toPlayerView(state, CASH1981).activeTurn)
    expect(JSON.stringify(opponentView.activeTurn)).not.toContain('top secret plan')
    expect(JSON.stringify(opponentView.activeTurn)).not.toContain('unpublished draft text')
  })
})
