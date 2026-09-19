/**
 * Port of `no.asgari.civilization.server.action.TurnActionTest`.
 *
 * Java had five tests — updateSOT, updateTrade, updateCM, updateMovement and
 * updateResearch — all checking that the order landed in the right field and
 * that `publicTurns` was filled. They run here as a table against one
 * `updateTurn`.
 */

import { describe, expect, it } from 'vitest'

import {
  addNewTurn,
  allPublicTurns,
  lockOrUnlockTurn,
  playersTurns,
  updateTurn,
} from '../src/actions/turn.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { findPlayer } from '../src/state.js'
import type { TurnPhase } from '../src/turn.js'
import { TURN_PHASES } from '../src/turn.js'

import { CASH1981, KARANDRAS1, firstCivGame } from './fixture.js'

describe('updateTurn', () => {
  const cases: readonly { readonly phase: TurnPhase; readonly order: string }[] = [
    { phase: 'SOT', order: 'SOT: Create city @ L4' },
    { phase: 'TRADE', order: 'Trade: 6 total' },
    { phase: 'CM', order: 'CM: Build market' },
    { phase: 'MOVEMENT', order: 'Movement: A6 -> A5' },
    { phase: 'RESEARCH', order: 'Research: Done' },
  ]
  const phaseNames: Readonly<Record<TurnPhase, string>> = {
    SOT: 'start of turn',
    TRADE: 'trade',
    CM: 'city management',
    MOVEMENT: 'movement',
    RESEARCH: 'research',
  }

  for (const { phase, order } of cases) {
    it(`${phase} is stored on the turn and in publicTurns`, () => {
      const state = unwrap(
        updateTurn(firstCivGame(), { playerId: CASH1981, turnNumber: 1, phase, order }),
      )

      const turn = findPlayer(state, CASH1981)?.playerTurns[0]
      expect(turn?.orders[phase]).toBe(order)
      expect(turn?.turnNumber).toBe(1)
      expect(turn?.username).toBe('cash1981')

      // Java: assertFalse(pbf.getPublicTurns().isEmpty())
      expect(Object.keys(state.publicTurns)).toEqual(['1cash1981'])
      expect(state.publicTurns['1cash1981']?.orders[phase]).toBe(order)
      expect(state.log.at(-1)?.logType).toBe(phase)
      expect(state.log.at(-1)?.publicLog).toBe(`Turn 1 - cash1981 has updated ${phaseNames[phase]} phase`)
    })
  }

  it('several phases on one turn collect into a single PlayerTurn', () => {
    let state = firstCivGame()
    for (const phase of TURN_PHASES) {
      state = unwrap(
        updateTurn(state, { playerId: CASH1981, turnNumber: 1, phase, order: `${phase} order` }),
      )
    }

    const turns = playersTurns(state, CASH1981)
    expect(turns).toHaveLength(1)
    expect(turns[0]?.orders).toEqual({
      SOT: 'SOT order',
      TRADE: 'TRADE order',
      CM: 'CM order',
      MOVEMENT: 'MOVEMENT order',
      RESEARCH: 'RESEARCH order',
    })
  })

  it('a changed order goes into the history', () => {
    let state = firstCivGame()
    state = unwrap(
      updateTurn(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'first' }),
    )
    state = unwrap(
      updateTurn(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'second' }),
    )

    const turn = playersTurns(state, CASH1981)[0]
    expect(turn?.orders.SOT).toBe('second')
    expect(turn?.history.SOT).toEqual(['first', 'second'])
  })

  it('the same order twice makes only one history entry', () => {
    // Java used a Set<String> for the history
    let state = firstCivGame()
    for (let i = 0; i < 3; i++) {
      state = unwrap(
        updateTurn(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'same' }),
      )
    }
    expect(playersTurns(state, CASH1981)[0]?.history.SOT).toEqual(['same'])
  })

  it('several turn numbers give several PlayerTurns, sorted', () => {
    let state = firstCivGame()
    for (const turnNumber of [3, 1, 2]) {
      state = unwrap(
        updateTurn(state, { playerId: CASH1981, turnNumber, phase: 'SOT', order: `turn ${turnNumber}` }),
      )
    }
    expect(playersTurns(state, CASH1981).map((turn) => turn.turnNumber)).toEqual([1, 2, 3])
  })

  it('a player without access is refused', () => {
    const error = unwrapErr(
      updateTurn(firstCivGame(), {
        playerId: 'outsider',
        turnNumber: 1,
        phase: 'SOT',
        order: 'x',
      }),
    )
    expect(error).toEqual({ kind: 'NO_ACCESS', playerId: 'outsider' })
  })
})

describe('allPublicTurns', () => {
  it('sorts on turn number, then username', () => {
    let state = firstCivGame()
    state = unwrap(
      updateTurn(state, { playerId: KARANDRAS1, turnNumber: 2, phase: 'SOT', order: 'k2' }),
    )
    state = unwrap(
      updateTurn(state, { playerId: CASH1981, turnNumber: 2, phase: 'SOT', order: 'c2' }),
    )
    state = unwrap(
      updateTurn(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'c1' }),
    )

    expect(allPublicTurns(state).map((turn) => `${turn.turnNumber}${turn.username}`)).toEqual([
      '1cash1981',
      '2Karandras1',
      '2cash1981',
    ])
  })

  it('strips the current order from the history without changing the state', () => {
    let state = firstCivGame()
    state = unwrap(
      updateTurn(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'first' }),
    )
    state = unwrap(
      updateTurn(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'second' }),
    )

    expect(allPublicTurns(state)[0]?.history.SOT).toEqual(['first'])
    // Java mutated the stored objects here, so a read corrupted data
    expect(playersTurns(state, CASH1981)[0]?.history.SOT).toEqual(['first', 'second'])
  })
})

describe('addNewTurn', () => {
  it('creates an empty turn', () => {
    const state = unwrap(addNewTurn(firstCivGame(), { playerId: CASH1981, turnNumber: 2 }))
    const turn = playersTurns(state, CASH1981)[0]

    expect(turn?.turnNumber).toBe(2)
    expect(turn?.orders.SOT).toBe('')
    expect(turn?.disabled).toBe(false)
  })

  it('the same turn number twice makes no duplicate', () => {
    let state = unwrap(addNewTurn(firstCivGame(), { playerId: CASH1981, turnNumber: 2 }))
    state = unwrap(addNewTurn(state, { playerId: CASH1981, turnNumber: 2 }))
    expect(playersTurns(state, CASH1981)).toHaveLength(1)
  })
})

describe('lockOrUnlockTurn', () => {
  it('locks the turn and logs it publicly', () => {
    let state = unwrap(
      updateTurn(firstCivGame(), { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'x' }),
    )
    state = unwrap(lockOrUnlockTurn(state, { playerId: CASH1981, turnNumber: 1, locked: true }))

    expect(playersTurns(state, CASH1981)[0]?.disabled).toBe(true)
    expect(state.log.at(-1)?.publicLog).toBe('cash1981  has locked in turn 1')
    // The public copy has to follow along
    expect(state.publicTurns['1cash1981']?.disabled).toBe(true)
  })

  it('reopens the turn', () => {
    let state = unwrap(
      updateTurn(firstCivGame(), { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'x' }),
    )
    state = unwrap(lockOrUnlockTurn(state, { playerId: CASH1981, turnNumber: 1, locked: true }))
    state = unwrap(lockOrUnlockTurn(state, { playerId: CASH1981, turnNumber: 1, locked: false }))

    expect(playersTurns(state, CASH1981)[0]?.disabled).toBe(false)
    expect(state.log.at(-1)?.publicLog).toBe('cash1981  has re-opened turn 1')
  })

  it('a turn that does not exist gives TURN_NOT_FOUND', () => {
    const error = unwrapErr(
      lockOrUnlockTurn(firstCivGame(), { playerId: CASH1981, turnNumber: 9, locked: true }),
    )
    expect(error).toEqual({ kind: 'TURN_NOT_FOUND', turnNumber: 9 })
  })
})

describe('hidden information', () => {
  it('gamenote and private turn lists do not leak through publicTurns', () => {
    const state = unwrap(
      updateTurn(firstCivGame(), { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'x' }),
    )
    // Turn orders ARE public — that is the point of play by forum
    expect(JSON.stringify(state.publicTurns)).toContain('x')
    expect(JSON.stringify(state.publicTurns)).not.toContain('gamenote')
  })
})
