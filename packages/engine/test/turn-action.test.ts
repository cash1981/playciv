/**
 * Port av `no.asgari.civilization.server.action.TurnActionTest`.
 *
 * Java hadde fem tester — updateSOT, updateTrade, updateCM, updateMovement,
 * updateResearch — som alle sjekket at ordren havnet i riktig felt og at
 * `publicTurns` ble fylt. De kjøres her som en tabell mot én `updateTurn`.
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

  for (const { phase, order } of cases) {
    it(`${phase} lagres på spillerens tur og i publicTurns`, () => {
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
    })
  }

  it('flere faser på samme tur samles i én PlayerTurn', () => {
    let state = firstCivGame()
    for (const phase of TURN_PHASES) {
      state = unwrap(
        updateTurn(state, { playerId: CASH1981, turnNumber: 1, phase, order: `${phase} ordre` }),
      )
    }

    const turns = playersTurns(state, CASH1981)
    expect(turns).toHaveLength(1)
    expect(turns[0]?.orders).toEqual({
      SOT: 'SOT ordre',
      TRADE: 'TRADE ordre',
      CM: 'CM ordre',
      MOVEMENT: 'MOVEMENT ordre',
      RESEARCH: 'RESEARCH ordre',
    })
  })

  it('en endret ordre legges i historikken', () => {
    let state = firstCivGame()
    state = unwrap(
      updateTurn(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'første' }),
    )
    state = unwrap(
      updateTurn(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'andre' }),
    )

    const turn = playersTurns(state, CASH1981)[0]
    expect(turn?.orders.SOT).toBe('andre')
    expect(turn?.history.SOT).toEqual(['første', 'andre'])
  })

  it('samme ordre to ganger gir bare én historikkoppføring', () => {
    // Java brukte Set<String> for historikken
    let state = firstCivGame()
    for (let i = 0; i < 3; i++) {
      state = unwrap(
        updateTurn(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'samme' }),
      )
    }
    expect(playersTurns(state, CASH1981)[0]?.history.SOT).toEqual(['samme'])
  })

  it('flere turnumre gir flere PlayerTurn, sortert', () => {
    let state = firstCivGame()
    for (const turnNumber of [3, 1, 2]) {
      state = unwrap(
        updateTurn(state, { playerId: CASH1981, turnNumber, phase: 'SOT', order: `tur ${turnNumber}` }),
      )
    }
    expect(playersTurns(state, CASH1981).map((turn) => turn.turnNumber)).toEqual([1, 2, 3])
  })

  it('spiller uten tilgang avvises', () => {
    const error = unwrapErr(
      updateTurn(firstCivGame(), {
        playerId: 'ingen',
        turnNumber: 1,
        phase: 'SOT',
        order: 'x',
      }),
    )
    expect(error).toEqual({ kind: 'NO_ACCESS', playerId: 'ingen' })
  })
})

describe('allPublicTurns', () => {
  it('sorterer på turnummer, deretter brukernavn', () => {
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

  it('fjerner den gjeldende ordren fra historikken, uten å endre tilstanden', () => {
    let state = firstCivGame()
    state = unwrap(
      updateTurn(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'første' }),
    )
    state = unwrap(
      updateTurn(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'andre' }),
    )

    expect(allPublicTurns(state)[0]?.history.SOT).toEqual(['første'])
    // Java muterte de lagrede objektene her, så en lesing ødela data
    expect(playersTurns(state, CASH1981)[0]?.history.SOT).toEqual(['første', 'andre'])
  })
})

describe('addNewTurn', () => {
  it('oppretter en tom tur', () => {
    const state = unwrap(addNewTurn(firstCivGame(), { playerId: CASH1981, turnNumber: 2 }))
    const turn = playersTurns(state, CASH1981)[0]

    expect(turn?.turnNumber).toBe(2)
    expect(turn?.orders.SOT).toBe('')
    expect(turn?.disabled).toBe(false)
  })

  it('samme turnummer to ganger gir ingen duplikat', () => {
    let state = unwrap(addNewTurn(firstCivGame(), { playerId: CASH1981, turnNumber: 2 }))
    state = unwrap(addNewTurn(state, { playerId: CASH1981, turnNumber: 2 }))
    expect(playersTurns(state, CASH1981)).toHaveLength(1)
  })
})

describe('lockOrUnlockTurn', () => {
  it('låser turen og logger det offentlig', () => {
    let state = unwrap(
      updateTurn(firstCivGame(), { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'x' }),
    )
    state = unwrap(lockOrUnlockTurn(state, { playerId: CASH1981, turnNumber: 1, locked: true }))

    expect(playersTurns(state, CASH1981)[0]?.disabled).toBe(true)
    expect(state.log.at(-1)?.publicLog).toBe('cash1981  has locked in turn 1')
    // Den offentlige kopien skal følge med
    expect(state.publicTurns['1cash1981']?.disabled).toBe(true)
  })

  it('åpner turen igjen', () => {
    let state = unwrap(
      updateTurn(firstCivGame(), { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'x' }),
    )
    state = unwrap(lockOrUnlockTurn(state, { playerId: CASH1981, turnNumber: 1, locked: true }))
    state = unwrap(lockOrUnlockTurn(state, { playerId: CASH1981, turnNumber: 1, locked: false }))

    expect(playersTurns(state, CASH1981)[0]?.disabled).toBe(false)
    expect(state.log.at(-1)?.publicLog).toBe('cash1981  has re-opened turn 1')
  })

  it('en tur som ikke finnes gir TURN_NOT_FOUND', () => {
    const error = unwrapErr(
      lockOrUnlockTurn(firstCivGame(), { playerId: CASH1981, turnNumber: 9, locked: true }),
    )
    expect(error).toEqual({ kind: 'TURN_NOT_FOUND', turnNumber: 9 })
  })
})

describe('skjult informasjon', () => {
  it('gamenote og private turlister lekker ikke gjennom publicTurns', () => {
    const state = unwrap(
      updateTurn(firstCivGame(), { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'x' }),
    )
    // Turordrer ER offentlige — det er poenget med play-by-forum
    expect(JSON.stringify(state.publicTurns)).toContain('x')
    expect(JSON.stringify(state.publicTurns)).not.toContain('gamenote')
  })
})
