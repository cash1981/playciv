/**
 * Port of `no.asgari.civilization.server.action.TurnActionTest`.
 *
 * Java had five tests — updateSOT, updateTrade, updateCM, updateMovement and
 * updateResearch — all checking that the order landed in the right field and
 * that a turn was created. Reveal behaviour is covered alongside the same
 * update action because the hotfix adds publication as a separate step.
 */

import { describe, expect, it } from 'vitest'

import {
  addNewTurn,
  allPublicTurns,
  lockOrUnlockTurn,
  playersTurns,
  revealTurnOrder,
  updateTurn,
} from '../src/actions/turn.js'
import { endTurn } from '../src/actions/player.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { migrateGameState } from '../src/migrate.js'
import { activeTurnStatus, findPlayer, toPlayerView } from '../src/state.js'
import type { PlayerTurn, TurnPhase } from '../src/turn.js'
import { currentPhaseStatus, TURN_PHASES, migratePlayerTurn } from '../src/turn.js'

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
    it(`${phase} is stored privately until it is revealed`, () => {
      const state = unwrap(
        updateTurn(firstCivGame(), { playerId: CASH1981, turnNumber: 1, phase, order }),
      )

      const turn = findPlayer(state, CASH1981)?.playerTurns[0]
      expect(turn?.orders[phase]).toBe(order)
      expect(turn?.turnNumber).toBe(1)
      expect(turn?.username).toBe('cash1981')

      // Java: assertFalse(pbf.getPublicTurns().isEmpty())
      expect(Object.keys(state.publicTurns)).toEqual(['1cash1981'])
      expect(state.publicTurns['1cash1981']?.orders[phase]).toBe('')
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

  it('a changed order does not create a history version', () => {
    let state = firstCivGame()
    state = unwrap(
      updateTurn(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'first' }),
    )
    state = unwrap(
      updateTurn(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'second' }),
    )

    const turn = playersTurns(state, CASH1981)[0]
    expect(turn?.orders.SOT).toBe('second')
    // Only a reveal records a version; saving never does.
    expect(turn?.history.SOT).toEqual([])
  })

  it('revealing a phase appends exactly one version with its timestamp', () => {
    let state = firstCivGame()
    state = unwrap(
      updateTurn(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'first' }),
    )
    state = unwrap(
      revealTurnOrder(state, {
        playerId: CASH1981,
        turnNumber: 1,
        phase: 'SOT',
        at: '2026-09-21T10:00:00.000Z',
      }),
    )

    expect(playersTurns(state, CASH1981)[0]?.history.SOT).toEqual([
      { markdown: 'first', at: '2026-09-21T10:00:00.000Z' },
    ])
  })

  it('keeps every revealed version in order across edits and reveals', () => {
    let state = firstCivGame()
    state = unwrap(
      updateTurn(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'first' }),
    )
    state = unwrap(
      revealTurnOrder(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', at: 't1' }),
    )
    state = unwrap(
      updateTurn(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'second' }),
    )
    state = unwrap(
      revealTurnOrder(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', at: 't2' }),
    )

    expect(playersTurns(state, CASH1981)[0]?.history.SOT).toEqual([
      { markdown: 'first', at: 't1' },
      { markdown: 'second', at: 't2' },
    ])
  })

  it('revealing an already revealed phase adds no duplicate version', () => {
    let state = firstCivGame()
    state = unwrap(
      updateTurn(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'first' }),
    )
    state = unwrap(
      revealTurnOrder(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', at: 't1' }),
    )
    state = unwrap(
      revealTurnOrder(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', at: 't2' }),
    )

    expect(playersTurns(state, CASH1981)[0]?.history.SOT).toEqual([
      { markdown: 'first', at: 't1' },
    ])
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

  it('reveals only the requested phase to public turns', () => {
    let state = firstCivGame()
    state = unwrap(updateTurn(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'secret' }))
    state = unwrap(updateTurn(state, { playerId: CASH1981, turnNumber: 1, phase: 'TRADE', order: 'public' }))
    state = unwrap(revealTurnOrder(state, { playerId: CASH1981, turnNumber: 1, phase: 'TRADE', at: 't1' }))

    expect(state.publicTurns['1cash1981']?.orders).toMatchObject({ SOT: '', TRADE: 'public' })
    expect(playersTurns(state, CASH1981)[0]?.orders).toMatchObject({ SOT: 'secret', TRADE: 'public' })
    expect(state.log.at(-1)?.publicLog).toBe('Turn 1 - cash1981 revealed trade phase')

    state = unwrap(
      updateTurn(state, { playerId: CASH1981, turnNumber: 1, phase: 'TRADE', order: 'new public' }),
    )
    expect(state.publicTurns['1cash1981']?.orders.TRADE).toBe('')
    state = unwrap(revealTurnOrder(state, { playerId: CASH1981, turnNumber: 1, phase: 'TRADE', at: 't2' }))
    expect(state.publicTurns['1cash1981']?.orders.TRADE).toBe('new public')
  })

  it('does not let another player reveal the owner\'s phase', () => {
    const state = unwrap(updateTurn(firstCivGame(), {
      playerId: CASH1981,
      turnNumber: 1,
      phase: 'SOT',
      order: 'secret',
    }))

    expect(unwrapErr(revealTurnOrder(state, { playerId: KARANDRAS1, turnNumber: 1, phase: 'SOT', at: 't1' }))).toEqual({
      kind: 'TURN_NOT_FOUND',
      turnNumber: 1,
    })
  })

  it('migrates an old turn as already public', () => {
    const state = unwrap(updateTurn(firstCivGame(), {
      playerId: CASH1981,
      turnNumber: 1,
      phase: 'SOT',
      order: 'old order',
    }))
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
    expect(allPublicTurns(migrated)[0]?.orders.SOT).toBe('old order')
  })

  it('migration drops legacy string histories and is idempotent', () => {
    const state = unwrap(
      updateTurn(firstCivGame(), {
        playerId: CASH1981,
        turnNumber: 1,
        phase: 'SOT',
        order: 'current',
      }),
    )
    const stored = state.publicTurns['1cash1981'] as PlayerTurn
    // Java's save-based history: bare strings, including the current order.
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

  it('shows every revealed version without changing the stored state', () => {
    let state = firstCivGame()
    state = unwrap(
      updateTurn(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'first' }),
    )
    state = unwrap(revealTurnOrder(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', at: 't1' }))
    state = unwrap(
      updateTurn(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'second' }),
    )
    state = unwrap(revealTurnOrder(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', at: 't2' }))

    expect(allPublicTurns(state)[0]?.history.SOT).toEqual([
      { markdown: 'first', at: 't1' },
      { markdown: 'second', at: 't2' },
    ])
    // The projection is pure: it must not touch the stored turn.
    expect(playersTurns(state, CASH1981)[0]?.history.SOT).toHaveLength(2)
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
    expect(JSON.stringify(state.publicTurns)).not.toContain('x')
    expect(JSON.stringify(state.publicTurns)).not.toContain('gamenote')
  })

  it('an unrevealed phase never reaches publicTurns, even as a version', () => {
    const state = unwrap(
      updateTurn(firstCivGame(), {
        playerId: CASH1981,
        turnNumber: 1,
        phase: 'SOT',
        order: 'secret draft',
      }),
    )

    expect(JSON.stringify(state.publicTurns)).not.toContain('secret draft')
    expect(allPublicTurns(state)[0]?.history.SOT).toEqual([])
  })

  it('a revealed version stays public after the phase is edited and made private', () => {
    let state = firstCivGame()
    state = unwrap(
      updateTurn(state, {
        playerId: CASH1981,
        turnNumber: 1,
        phase: 'SOT',
        order: 'published plan',
      }),
    )
    state = unwrap(revealTurnOrder(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', at: 't1' }))
    expect(JSON.stringify(state.publicTurns)).toContain('published plan')

    // Editing makes the phase private again, but the revealed version is public
    // information and must survive.
    state = unwrap(
      updateTurn(state, {
        playerId: CASH1981,
        turnNumber: 1,
        phase: 'SOT',
        order: 'new private draft',
      }),
    )

    expect(state.publicTurns['1cash1981']?.orders.SOT).toBe('')
    expect(state.publicTurns['1cash1981']?.history.SOT).toEqual([
      { markdown: 'published plan', at: 't1' },
    ])
    expect(JSON.stringify(state.publicTurns)).not.toContain('new private draft')
  })
})

describe('currentPhaseStatus', () => {
  it('is SOT for a turn that has not been saved yet', () => {
    expect(currentPhaseStatus(undefined)).toBe('SOT')
  })

  it('is the first phase not yet revealed', () => {
    let state = firstCivGame()
    state = unwrap(updateTurn(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'a' }))
    state = unwrap(revealTurnOrder(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', at: 't1' }))
    const turn = findPlayer(state, CASH1981)?.playerTurns.find((candidate) => candidate.turnNumber === 1)
    expect(currentPhaseStatus(turn)).toBe('TRADE')
  })

  it('is SOT again once every phase of the turn has been revealed', () => {
    let state = firstCivGame()
    for (const phase of TURN_PHASES) {
      state = unwrap(updateTurn(state, { playerId: CASH1981, turnNumber: 1, phase, order: 'x' }))
      state = unwrap(revealTurnOrder(state, { playerId: CASH1981, turnNumber: 1, phase, at: 't' }))
    }
    const turn = findPlayer(state, CASH1981)?.playerTurns.find((candidate) => candidate.turnNumber === 1)
    expect(currentPhaseStatus(turn)).toBe('SOT')
  })
})

describe('activeTurnStatus', () => {
  it('is null before the game has started', () => {
    const state = firstCivGame()
    const noOneOnTurn = {
      ...state,
      players: state.players.map((player) => ({ ...player, yourTurn: false })),
    }
    expect(activeTurnStatus(noOneOnTurn)).toBeNull()
  })

  it('reports SOT and turn 1 for a fresh active player', () => {
    const state = firstCivGame()
    expect(activeTurnStatus(state)).toEqual({
      playerId: CASH1981,
      username: 'cash1981',
      turnNumber: 1,
      phase: 'SOT',
    })
  })

  it('reports the first unrevealed phase of the active player, not order text', () => {
    let state = firstCivGame()
    state = unwrap(updateTurn(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'secret plan' }))
    state = unwrap(revealTurnOrder(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', at: 't1' }))

    const status = activeTurnStatus(state)
    expect(status).toEqual({ playerId: CASH1981, username: 'cash1981', turnNumber: 1, phase: 'TRADE' })
    // Never leaks the order text, only the phase name.
    expect(JSON.stringify(status)).not.toContain('secret plan')
  })

  it('rolls over to SOT of the next turn number once every phase is revealed', () => {
    let state = firstCivGame()
    for (const phase of TURN_PHASES) {
      state = unwrap(updateTurn(state, { playerId: CASH1981, turnNumber: 1, phase, order: 'x' }))
      state = unwrap(revealTurnOrder(state, { playerId: CASH1981, turnNumber: 1, phase, at: 't' }))
    }
    expect(activeTurnStatus(state)).toEqual({
      playerId: CASH1981,
      username: 'cash1981',
      turnNumber: 2,
      phase: 'SOT',
    })
  })

  it('exposes on PlayerView without leaking order text to another player', () => {
    let state = firstCivGame()
    state = unwrap(
      updateTurn(state, {
        playerId: CASH1981,
        turnNumber: 1,
        phase: 'SOT',
        order: 'top secret plan',
      }),
    )

    // Neither the owner's own view nor an opponent's view can leak the text
    // through `activeTurn` — only `you`/`opponents[].publicTurns` may carry it,
    // and only for its owner.
    const ownView = toPlayerView(state, CASH1981)
    const opponentView = toPlayerView(state, KARANDRAS1)
    expect(ownView.activeTurn).toEqual({
      playerId: CASH1981,
      username: 'cash1981',
      turnNumber: 1,
      phase: 'SOT',
    })
    expect(opponentView.activeTurn).toEqual(ownView.activeTurn)
    expect(JSON.stringify(opponentView.activeTurn)).not.toContain('top secret plan')
  })

  it('endTurn logs the phase the newly active player is actually on, not just SOT', () => {
    let state = firstCivGame()
    // KARANDRAS1 has already worked ahead and revealed SOT for turn 1, so once
    // the turn reaches them they should be pointed at TRADE, not SOT.
    state = unwrap(
      updateTurn(state, { playerId: KARANDRAS1, turnNumber: 1, phase: 'SOT', order: 'ready' }),
    )
    state = unwrap(
      revealTurnOrder(state, { playerId: KARANDRAS1, turnNumber: 1, phase: 'SOT', at: 't1' }),
    )

    const afterEndTurn = unwrap(endTurn(state))
    expect(activeTurnStatus(afterEndTurn)).toEqual({
      playerId: KARANDRAS1,
      username: 'Karandras1',
      turnNumber: 1,
      phase: 'TRADE',
    })
    expect(afterEndTurn.log.at(-1)?.publicLog).toBe(
      "System: Turn 1 - it is now Karandras1's turn (trade phase)",
    )
  })

  it('follows the turn to whoever it is passed to', () => {
    const state = firstCivGame()
    const passed = {
      ...state,
      players: state.players.map((player) => ({
        ...player,
        yourTurn: player.playerId === KARANDRAS1,
      })),
    }
    expect(activeTurnStatus(passed)).toEqual({
      playerId: KARANDRAS1,
      username: 'Karandras1',
      turnNumber: 1,
      phase: 'SOT',
    })
  })
})
