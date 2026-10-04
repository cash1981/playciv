/**
 * The single chat (`docs/agents/tasks/single-chat.md`): a game saved while the
 * old baton view was on is adopted by `migrateGameState`. New in the port, so no
 * Java counterpart.
 */

import { describe, expect, it } from 'vitest'

import { placeUnchecked } from '../src/actions/board.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { START_PLAYER_ID, playerAreas } from '../src/board.js'
import { migrateGameState } from '../src/migrate.js'
import { unwrap } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { toPlayerView } from '../src/state.js'
import { TURN_PHASES, startPlayerOf, turnHolder, turnStatus } from '../src/turn.js'

import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'
import { savedOrder } from './saved-orders.js'

/** A state as the old code saved it with the switch off. */
const savedClassic = (state: GameState): GameState => ({ ...state, chatOrders: false }) as unknown as GameState

/** A state with a field removed, as a save from before that field existed. */
const without = (state: GameState, ...keys: readonly string[]): GameState => {
  const copy = { ...state } as Record<string, unknown>
  for (const key of keys) delete copy[key]
  return copy as unknown as GameState
}

/** `turns` classic turns per player, every phase revealed. A player in `skipFirst` never wrote turn 1. */
const classicGame = (turns: number, skipFirst: readonly string[] = []): GameState => {
  let state = firstCivGame()
  for (const playerId of [CASH1981, KARANDRAS1, ITCHI, CHUL]) {
    for (let turnNumber = skipFirst.includes(playerId) ? 2 : 1; turnNumber <= turns; turnNumber += 1) {
      for (const phase of TURN_PHASES) {
        state = savedOrder(state, playerId, turnNumber, phase, `${phase} ${turnNumber}`, 't')
      }
    }
  }
  return state
}

const hasKey = (state: GameState, key: string): boolean => key in (state as unknown as Record<string, unknown>)

describe('adopting a state saved with the baton view', () => {
  it('drops the switch, keeps the data, and writes nothing to the log or the board', () => {
    const saved = savedClassic(firstCivGame())

    const migrated = migrateGameState(saved)

    expect(hasKey(migrated, 'chatOrders')).toBe(false)
    expect(migrated.log).toEqual(saved.log)
    expect(migrated.board.pieces).toEqual([])
    expect(migrated.board.history).toEqual([])
    expect(migrated.players.map((player) => player.yourTurn)).toEqual([true, false, false, false])
  })

  it('records the start player and the starter of turn 1 from seat 1 when the board has no marker', () => {
    const migrated = migrateGameState(savedClassic(firstCivGame()))

    expect(migrated.chatOrdersStartTurn).toBe(1)
    expect(migrated.startPlayerId).toBe(CASH1981)
    expect(migrated.turnStarters).toEqual({ 1: 'cash1981' })
    expect(toPlayerView(migrated, KARANDRAS1).activeTurn?.startPlayer).toBe('cash1981')
  })

  it('lets a marker that is already on the board decide who the start player is', () => {
    const start = firstCivGame()
    const area = playerAreas(start.board, start.players).find((candidate) => candidate.username === 'Itchi')
    if (area === undefined) throw new Error('no area')
    const withMarker = placeUnchecked(start, { playerId: CASH1981, assetId: START_PLAYER_ID, x: area.x, y: area.y })
    if (withMarker === undefined) throw new Error('marker not placed')

    const migrated = migrateGameState(savedClassic(withMarker))

    expect(startPlayerOf(migrated)?.username).toBe('Itchi')
    expect(migrated.startPlayerId).toBe(ITCHI)
    expect(migrated.turnStarters).toEqual({ 1: 'Itchi' })
    expect(migrated.board.history).toHaveLength(withMarker.board.history.length)
  })

  it('does not pin the turn to 1 when the baton sits on a player who never wrote turn orders', () => {
    // Karandras1 wrote nothing at all and holds the baton: the old view says turn 1
    const everyoneElse = [CASH1981, ITCHI, CHUL].reduce((state, playerId) => {
      let next = state
      for (let turnNumber = 1; turnNumber <= 20; turnNumber += 1) {
        for (const phase of TURN_PHASES) {
          next = savedOrder(next, playerId, turnNumber, phase, `${phase} ${turnNumber}`, 't')
        }
      }
      return next
    }, firstCivGame())
    const laggardHoldsBaton: GameState = {
      ...everyoneElse,
      players: everyoneElse.players.map((player) => ({ ...player, yourTurn: player.playerId === KARANDRAS1 })),
    }

    const migrated = migrateGameState(savedClassic(laggardHoldsBaton))

    expect(migrated.chatOrdersStartTurn).toBe(21)
    expect(turnStatus(migrated).currentTurn).toBe(21)
  })

  it('a player who never wrote turn 1 does not pin the current turn to it', () => {
    const migrated = migrateGameState(savedClassic(classicGame(20, [KARANDRAS1])))

    expect(migrated.chatOrdersStartTurn).toBe(21)
    expect(turnStatus(migrated).waitingFor).toEqual([
      { username: 'cash1981', phase: 'SOT' },
      { username: 'Karandras1', phase: 'SOT' },
      { username: 'Itchi', phase: 'SOT' },
      { username: 'Chul', phase: 'SOT' },
    ])
    // Seat 1, not Karandras1 who skipped turn 1
    expect(turnHolder(migrated)?.playerId).toBe(CASH1981)
    expect(migrated.turnStarters).toEqual({ 21: 'cash1981' })
  })

  it('without the baseline the same game would be pinned to turn 1', () => {
    // Guards the test above: it must fail when the baseline is ignored.
    const migrated = migrateGameState(savedClassic(classicGame(20, [KARANDRAS1])))
    const noBaseline = { ...migrated, chatOrdersStartTurn: 1 }
    expect(turnStatus(noBaseline).currentTurn).toBe(1)
    expect(turnHolder(noBaseline)?.playerId).toBe(KARANDRAS1)
  })

  it('play carries on from the baseline', () => {
    let state = migrateGameState(savedClassic(classicGame(20, [KARANDRAS1])))
    for (const playerId of [CASH1981, KARANDRAS1, ITCHI, CHUL]) {
      state = unwrap(markPhasesDone(state, { playerId, turnNumber: 21, upToPhase: 'RESEARCH' }))
    }
    expect(turnStatus(state).currentTurn).toBe(22)
    // The turn started with the next seat, from the recorded starter of turn 21
    expect(state.turnStarters).toEqual({ 21: 'cash1981', 22: 'Karandras1' })
  })

  it('mid-turn it uses the turn the old view reports, and never goes back down', () => {
    // Turn 3 is under way for the baton holder: not all phases revealed yet
    const midTurn = savedOrder(classicGame(2), CASH1981, 3, 'SOT', 'x')
    expect(migrateGameState(savedClassic(midTurn)).chatOrdersStartTurn).toBe(3)

    // A baseline an earlier switch-on had set stays when it is higher
    expect(migrateGameState(savedClassic({ ...midTurn, chatOrdersStartTurn: 9 })).chatOrdersStartTurn).toBe(9)
  })

  it('keeps the starter an earlier switch-on had already recorded for the baseline turn', () => {
    const saved = savedClassic({ ...firstCivGame(), turnStarters: { 1: 'Chul' } })
    expect(migrateGameState(saved).turnStarters).toEqual({ 1: 'Chul' })
  })

  it('adopts a save from before the switch and the baseline existed', () => {
    const veryOld = without(firstCivGame(), 'chatOrders', 'chatOrdersStartTurn', 'startPlayerId', 'turnStarters')
    const migrated = migrateGameState(veryOld)
    expect(migrated.chatOrdersStartTurn).toBe(1)
    expect(migrated.startPlayerId).toBe(CASH1981)
    expect(migrated.turnStarters).toEqual({ 1: 'cash1981' })
  })

  it('a game with no players is left with an empty record', () => {
    const migrated = migrateGameState(savedClassic({ ...firstCivGame(), players: [] }))
    expect(migrated.startPlayerId).toBeNull()
    expect(migrated.turnStarters).toEqual({})
  })

  it('a second load changes nothing', () => {
    const once = migrateGameState(savedClassic(classicGame(20, [KARANDRAS1])))
    expect(migrateGameState(once)).toEqual(once)
    // Even after play has moved the baseline's game on, the second load leaves it alone
    const later = { ...once, chatOrdersStartTurn: 30 }
    expect(migrateGameState(later).chatOrdersStartTurn).toBe(30)
    expect(migrateGameState(later).turnStarters).toEqual(once.turnStarters)
  })
})

describe('a state that is already a chat game', () => {
  it('keeps its baseline, start player and starters, and only drops the switch', () => {
    const saved = {
      ...classicGame(5),
      chatOrders: true,
      chatOrdersStartTurn: 4,
      startPlayerId: ITCHI,
      turnStarters: { 4: 'Itchi' },
    } as unknown as GameState

    const migrated = migrateGameState(saved)

    expect(hasKey(migrated, 'chatOrders')).toBe(false)
    expect(migrated.chatOrdersStartTurn).toBe(4)
    expect(migrated.startPlayerId).toBe(ITCHI)
    expect(migrated.turnStarters).toEqual({ 4: 'Itchi' })
  })

  it('a state saved by this code (a baseline and no switch) is not adopted again', () => {
    const saved: GameState = { ...classicGame(5), chatOrdersStartTurn: 2, startPlayerId: null, turnStarters: {} }

    const migrated = migrateGameState(saved)

    // Adoption would have moved the baseline up to turn 6 and named a starter
    expect(migrated.chatOrdersStartTurn).toBe(2)
    expect(migrated.startPlayerId).toBeNull()
    expect(migrated.turnStarters).toEqual({})
  })

  it('a new game is not adopted either', () => {
    const fresh = firstCivGame()
    const migrated = migrateGameState(fresh)
    expect(migrated.chatOrdersStartTurn).toBe(1)
    expect(migrated.turnStarters).toEqual({})
    expect(migrated.legacyOrdersCopied).toBe(true)
  })
})
