/**
 * Chat orders (issue #215), slice 1. New in the port, so there is no Java
 * counterpart: the behaviour is the one in `docs/agents/tasks/chat-orders.md`.
 */

import { describe, expect, it } from 'vitest'

import { draw, drawWonder } from '../src/actions/draw.js'
import { takeTurn } from '../src/actions/player.js'
import {
  allPublicTurns,
  markPhasesDone,
  postOrder,
  revealTurnOrder,
  setChatOrders,
  unmarkPhaseDone,
  updateTurn,
} from '../src/actions/turn.js'
import { migrateGameState } from '../src/migrate.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { activeTurnStatus, findPlayer, toPlayerView } from '../src/state.js'
import type { PlayerTurn, TurnPhase } from '../src/turn.js'
import { TURN_PHASES, migratePlayerTurn, turnHolder, turnStatus } from '../src/turn.js'

import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const chatGame = (): GameState => unwrap(setChatOrders(firstCivGame(), true))

const done = (state: GameState, playerId: string, turnNumber = 1): Readonly<Record<TurnPhase, boolean>> | undefined =>
  findPlayer(state, playerId)?.playerTurns.find((turn) => turn.turnNumber === turnNumber)?.done

/** Everybody marks every phase of a turn done. */
const finishTurn = (state: GameState, turnNumber: number): GameState =>
  [CASH1981, KARANDRAS1, ITCHI, CHUL].reduce(
    (current, playerId) =>
      unwrap(markPhasesDone(current, { playerId, turnNumber, upToPhase: 'RESEARCH' })),
    state,
  )

describe('the chatOrders setting', () => {
  it('is off in a new game and shown in the player view', () => {
    const state = firstCivGame()
    expect(state.chatOrders).toBe(false)
    expect(toPlayerView(state, CASH1981).chatOrders).toBe(false)
    expect(toPlayerView(chatGame(), KARANDRAS1).chatOrders).toBe(true)
  })

  it('can be switched on and off and logs it once per change', () => {
    const on = unwrap(setChatOrders(firstCivGame(), true))
    expect(on.chatOrders).toBe(true)
    expect(on.log.at(-1)?.publicLog).toBe('System: Chat orders turned on')

    // Same value again is a no-op, not a second log line
    expect(unwrap(setChatOrders(on, true))).toBe(on)

    const off = unwrap(setChatOrders(on, false))
    expect(off.chatOrders).toBe(false)
    expect(off.log.at(-1)?.publicLog).toBe('System: Chat orders turned off')
  })

  it('switching off and on loses no orders or done markers', () => {
    let state = chatGame()
    state = unwrap(postOrder(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', markdown: 'found a city', at: 't1' }))
    state = unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))

    const roundTrip = unwrap(setChatOrders(unwrap(setChatOrders(state, false)), true))
    const turn = findPlayer(roundTrip, CASH1981)?.playerTurns[0]
    expect(turn?.orders.SOT).toBe('found a city')
    expect(turn?.done.TRADE).toBe(true)
    expect(roundTrip.publicTurns['1cash1981']?.history.SOT).toHaveLength(1)
  })

  it('an old saved game migrates to off', () => {
    const old = { ...firstCivGame() } as Record<string, unknown>
    delete old['chatOrders']
    const migrated = migrateGameState(old as unknown as GameState)
    expect(migrated.chatOrders).toBe(false)
    // and a game that has it switched on keeps it
    expect(migrateGameState(chatGame()).chatOrders).toBe(true)
  })

  it('an old saved game gets the baseline turn 1, and a stored baseline survives', () => {
    const old = { ...firstCivGame() } as Record<string, unknown>
    delete old['chatOrdersStartTurn']
    expect(migrateGameState(old as unknown as GameState).chatOrdersStartTurn).toBe(1)
    expect(migrateGameState({ ...firstCivGame(), chatOrdersStartTurn: 7 }).chatOrdersStartTurn).toBe(7)
  })
})

describe('the actions need chat orders switched on', () => {
  it('markPhasesDone, unmarkPhaseDone and postOrder refuse with CHAT_ORDERS_OFF', () => {
    const off = firstCivGame()
    expect(unwrapErr(markPhasesDone(off, { playerId: CASH1981, turnNumber: 1, upToPhase: 'SOT' }))).toEqual({ kind: 'CHAT_ORDERS_OFF' })
    expect(unwrapErr(unmarkPhaseDone(off, { playerId: CASH1981, turnNumber: 1, phase: 'SOT' }))).toEqual({ kind: 'CHAT_ORDERS_OFF' })
    expect(unwrapErr(postOrder(off, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', markdown: 'x', at: 't' }))).toEqual({ kind: 'CHAT_ORDERS_OFF' })
  })

  it('they work again once it is on, and refuse again once it is off', () => {
    const on = chatGame()
    const marked = unwrap(markPhasesDone(on, { playerId: CASH1981, turnNumber: 1, upToPhase: 'SOT' }))
    const off = unwrap(setChatOrders(marked, false))
    expect(unwrapErr(unmarkPhaseDone(off, { playerId: CASH1981, turnNumber: 1, phase: 'SOT' })).kind).toBe('CHAT_ORDERS_OFF')
  })

  it('the classic update and reveal still work with it off', () => {
    let state = unwrap(updateTurn(firstCivGame(), { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'classic' }))
    state = unwrap(revealTurnOrder(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', at: 't1' }))
    expect(state.chatOrders).toBe(false)
    expect(state.publicTurns['1cash1981']?.orders.SOT).toBe('classic')
    expect(done(state, CASH1981)?.SOT).toBe(true)
  })
})

describe('PlayerTurn.done', () => {
  it('a new turn starts with nothing done', () => {
    const state = unwrap(updateTurn(firstCivGame(), { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'x' }))
    expect(done(state, CASH1981)).toEqual({ SOT: false, TRADE: false, CM: false, MOVEMENT: false, RESEARCH: false })
  })

  it('an old turn migrates with done equal to revealed', () => {
    const state = unwrap(updateTurn(firstCivGame(), { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'x' }))
    const stored = state.publicTurns['1cash1981'] as PlayerTurn
    const strip = (turn: PlayerTurn, revealed?: Record<string, boolean>): PlayerTurn => {
      const old = { ...turn } as Record<string, unknown>
      delete old['done']
      if (revealed === undefined) delete old['revealed']
      else old['revealed'] = revealed
      return old as unknown as PlayerTurn
    }

    // No revealed flags at all: old turns count as public, so as done
    expect(migratePlayerTurn(strip(stored)).done).toEqual({
      SOT: true, TRADE: true, CM: true, MOVEMENT: true, RESEARCH: true,
    })
    // Partly revealed: done follows revealed phase by phase
    const partly = migratePlayerTurn(strip(stored, { SOT: true, TRADE: false, CM: true, MOVEMENT: false, RESEARCH: false }))
    expect(partly.done).toEqual({ SOT: true, TRADE: false, CM: true, MOVEMENT: false, RESEARCH: false })
    // Idempotent, and an existing done is not overwritten by revealed
    expect(migratePlayerTurn(partly)).toEqual(partly)
    const explicit = migratePlayerTurn({ ...partly, done: { ...partly.done, TRADE: true } })
    expect(explicit.done.TRADE).toBe(true)
  })

  it('a classic reveal also marks the phase done', () => {
    let state = unwrap(updateTurn(firstCivGame(), { playerId: CASH1981, turnNumber: 1, phase: 'TRADE', order: 'trade 6' }))
    expect(done(state, CASH1981)?.TRADE).toBe(false)
    state = unwrap(revealTurnOrder(state, { playerId: CASH1981, turnNumber: 1, phase: 'TRADE', at: 't1' }))
    expect(done(state, CASH1981)?.TRADE).toBe(true)
    expect(done(state, CASH1981)?.SOT).toBe(false)
    expect(state.publicTurns['1cash1981']?.done.TRADE).toBe(true)
  })
})

describe('markPhasesDone', () => {
  it('marks every phase up to and including the given one, and creates the turn', () => {
    const state = unwrap(markPhasesDone(chatGame(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' }))
    expect(done(state, CASH1981)).toEqual({ SOT: true, TRADE: true, CM: true, MOVEMENT: false, RESEARCH: false })
    expect(state.publicTurns['1cash1981']?.done.CM).toBe(true)
    expect(state.log.at(-1)?.publicLog).toBe('Turn 1 - cash1981 marked all phases up to city management done')
    expect(state.log.at(-1)?.logType).toBe('CM')
  })

  it('does not need to be the players turn', () => {
    // KARANDRAS1 does not hold the baton in firstCivGame
    const state = unwrap(markPhasesDone(chatGame(), { playerId: KARANDRAS1, turnNumber: 1, upToPhase: 'SOT' }))
    expect(done(state, KARANDRAS1)?.SOT).toBe(true)
    expect(state.log.at(-1)?.publicLog).toBe('Turn 1 - Karandras1 marked start of turn phase done')
  })

  it('repeating it changes and logs nothing', () => {
    const once = unwrap(markPhasesDone(chatGame(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' }))
    expect(unwrap(markPhasesDone(once, { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))).toBe(once)
  })

  it('keeps phases already marked and leaves published orders alone', () => {
    let state = unwrap(postOrder(chatGame(), { playerId: CASH1981, turnNumber: 1, phase: 'CM', markdown: 'build', at: 't1' }))
    state = unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'MOVEMENT' }))
    expect(findPlayer(state, CASH1981)?.playerTurns[0]?.orders.CM).toBe('build')
    expect(findPlayer(state, CASH1981)?.playerTurns).toHaveLength(1)
  })

  it('a player who is not in the game is refused', () => {
    expect(unwrapErr(markPhasesDone(chatGame(), { playerId: 'stranger', turnNumber: 1, upToPhase: 'SOT' }))).toEqual({
      kind: 'NO_ACCESS',
      playerId: 'stranger',
    })
  })
})

describe('unmarkPhaseDone', () => {
  it('unmarks one phase and does not touch the later ones', () => {
    let state = unwrap(markPhasesDone(chatGame(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'MOVEMENT' }))
    state = unwrap(unmarkPhaseDone(state, { playerId: CASH1981, turnNumber: 1, phase: 'TRADE' }))
    expect(done(state, CASH1981)).toEqual({ SOT: true, TRADE: false, CM: true, MOVEMENT: true, RESEARCH: false })
    expect(state.publicTurns['1cash1981']?.done.TRADE).toBe(false)
    expect(state.log.at(-1)?.publicLog).toBe('Turn 1 - cash1981 marked trade phase not done')
  })

  it('needs no vote and does not need the players turn', () => {
    let state = unwrap(markPhasesDone(chatGame(), { playerId: CHUL, turnNumber: 1, upToPhase: 'SOT' }))
    state = unwrap(unmarkPhaseDone(state, { playerId: CHUL, turnNumber: 1, phase: 'SOT' }))
    expect(done(state, CHUL)?.SOT).toBe(false)
  })

  it('unmarking a phase that is not done changes nothing', () => {
    const state = unwrap(markPhasesDone(chatGame(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'SOT' }))
    expect(unwrap(unmarkPhaseDone(state, { playerId: CASH1981, turnNumber: 1, phase: 'CM' }))).toBe(state)
  })

  it('a turn that does not exist is TURN_NOT_FOUND', () => {
    expect(unwrapErr(unmarkPhaseDone(chatGame(), { playerId: CASH1981, turnNumber: 4, phase: 'SOT' }))).toEqual({
      kind: 'TURN_NOT_FOUND',
      turnNumber: 4,
    })
  })
})

describe('postOrder', () => {
  it('writes and publishes the order in one step, without marking it done', () => {
    const state = unwrap(
      postOrder(chatGame(), { playerId: KARANDRAS1, turnNumber: 1, phase: 'MOVEMENT', markdown: 'A6 to A5', at: '2026-01-01T10:00:00Z' }),
    )
    const turn = findPlayer(state, KARANDRAS1)?.playerTurns[0]
    expect(turn?.orders.MOVEMENT).toBe('A6 to A5')
    expect(turn?.revealed.MOVEMENT).toBe(true)
    expect(turn?.history.MOVEMENT).toEqual([{ markdown: 'A6 to A5', at: '2026-01-01T10:00:00Z' }])
    expect(turn?.done.MOVEMENT).toBe(false)

    // Public at once: opponents read it from publicTurns
    expect(state.publicTurns['1Karandras1']?.orders.MOVEMENT).toBe('A6 to A5')
    expect(allPublicTurns(state)[0]?.history.MOVEMENT).toHaveLength(1)
    expect(state.log.at(-1)?.publicLog).toBe('Turn 1 - Karandras1 posted an order for movement phase')
    // The text is in the history, not in the log
    expect(JSON.stringify(state.log)).not.toContain('A6 to A5')
  })

  it('several orders for one phase: the newest is the order and all stay in history', () => {
    let state = chatGame()
    state = unwrap(postOrder(state, { playerId: CASH1981, turnNumber: 2, phase: 'SOT', markdown: 'first', at: 't1' }))
    state = unwrap(postOrder(state, { playerId: CASH1981, turnNumber: 2, phase: 'SOT', markdown: 'second', at: 't2' }))

    const turn = findPlayer(state, CASH1981)?.playerTurns[0]
    expect(turn?.orders.SOT).toBe('second')
    expect(turn?.history.SOT.map((version) => version.markdown)).toEqual(['first', 'second'])
    expect(state.publicTurns['2cash1981']?.orders.SOT).toBe('second')
    expect(state.publicTurns['2cash1981']?.history.SOT).toHaveLength(2)
  })

  it('does not need the players turn, and refuses a stranger', () => {
    expect(unwrap(postOrder(chatGame(), { playerId: CHUL, turnNumber: 1, phase: 'SOT', markdown: 'x', at: 't' })).publicTurns['1Chul']).toBeDefined()
    expect(unwrapErr(postOrder(chatGame(), { playerId: 'stranger', turnNumber: 1, phase: 'SOT', markdown: 'x', at: 't' })).kind).toBe('NO_ACCESS')
  })

  it('does not disturb the other phases of the turn', () => {
    let state = unwrap(updateTurn(chatGame(), { playerId: CASH1981, turnNumber: 1, phase: 'CM', order: 'draft, unpublished' }))
    state = unwrap(postOrder(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', markdown: 'go', at: 't' }))
    const turn = findPlayer(state, CASH1981)?.playerTurns[0]
    expect(turn?.orders.CM).toBe('draft, unpublished')
    expect(turn?.revealed.CM).toBe(false)
    // and the draft stays masked in the public copy
    expect(state.publicTurns['1cash1981']?.orders.CM).toBe('')
  })
})

describe('turnStatus', () => {
  it('starts at turn 1 with every active player waiting on the start of turn', () => {
    const status = turnStatus(chatGame())
    expect(status.currentTurn).toBe(1)
    expect(status.waitingFor).toEqual([
      { username: 'cash1981', phase: 'SOT' },
      { username: 'Karandras1', phase: 'SOT' },
      { username: 'Itchi', phase: 'SOT' },
      { username: 'Chul', phase: 'SOT' },
    ])
  })

  it('reports each players first phase not done', () => {
    let state = unwrap(markPhasesDone(chatGame(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' }))
    state = unwrap(markPhasesDone(state, { playerId: ITCHI, turnNumber: 1, upToPhase: 'RESEARCH' }))
    const byName = Object.fromEntries(turnStatus(state).players.map((player) => [player.username, player.phase]))
    expect(byName).toEqual({ cash1981: 'MOVEMENT', Karandras1: 'SOT', Itchi: null, Chul: 'SOT' })
    // Itchi has finished, so nobody waits for them
    expect(turnStatus(state).waitingFor.map((entry) => entry.username)).toEqual(['cash1981', 'Karandras1', 'Chul'])
  })

  it('follows an unmark at once', () => {
    let state = unwrap(markPhasesDone(chatGame(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' }))
    state = unwrap(unmarkPhaseDone(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT' }))
    expect(turnStatus(state).players[0]?.phase).toBe('SOT')
  })

  it('moves to the next turn when the last player marks Research done', () => {
    let state = chatGame()
    for (const playerId of [CASH1981, KARANDRAS1, ITCHI]) {
      state = unwrap(markPhasesDone(state, { playerId, turnNumber: 1, upToPhase: 'RESEARCH' }))
    }
    expect(turnStatus(state).currentTurn).toBe(1)
    expect(turnStatus(state).waitingFor).toEqual([{ username: 'Chul', phase: 'SOT' }])

    state = unwrap(markPhasesDone(state, { playerId: CHUL, turnNumber: 1, upToPhase: 'RESEARCH' }))
    const next = turnStatus(state)
    expect(next.currentTurn).toBe(2)
    expect(next.waitingFor).toHaveLength(4)
    expect(next.waitingFor.every((entry) => entry.phase === 'SOT')).toBe(true)
  })

  it('the current turn is the lowest one someone has not finished', () => {
    // Everyone finished turn 1, but Chul unmarks Research of turn 1 while
    // cash1981 is already done with turn 2.
    let state = finishTurn(chatGame(), 1)
    state = unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 2, upToPhase: 'RESEARCH' }))
    state = unwrap(unmarkPhaseDone(state, { playerId: CHUL, turnNumber: 1, phase: 'RESEARCH' }))
    expect(turnStatus(state).currentTurn).toBe(1)
    expect(turnStatus(state).waitingFor).toEqual([{ username: 'Chul', phase: 'RESEARCH' }])
  })

  it('a withdrawn player never holds the turn up', () => {
    let state = chatGame()
    const chul = findPlayer(state, CHUL)
    if (chul === undefined) throw new Error('no Chul')
    state = {
      ...state,
      players: state.players.filter((player) => player.playerId !== CHUL),
      withdrawnPlayers: [chul],
    }
    for (const playerId of [CASH1981, KARANDRAS1, ITCHI]) {
      state = unwrap(markPhasesDone(state, { playerId, turnNumber: 1, upToPhase: 'RESEARCH' }))
    }
    expect(turnStatus(state).currentTurn).toBe(2)
    expect(turnStatus(state).players.map((player) => player.username)).not.toContain('Chul')
  })

  it('is 1 when there are no players at all', () => {
    const status = turnStatus({ ...chatGame(), players: [] })
    expect(status).toEqual({ currentTurn: 1, players: [], waitingFor: [] })
    expect(turnHolder({ ...chatGame(), players: [] })).toBeUndefined()
  })
})

describe('turnHolder', () => {
  it('starts with seat 1', () => {
    expect(turnHolder(chatGame())?.playerId).toBe(CASH1981)
  })

  it('is the first player, in seat order, who has not marked the earliest open phase done', () => {
    let state = unwrap(markPhasesDone(chatGame(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'SOT' }))
    expect(turnHolder(state)?.playerId).toBe(KARANDRAS1)

    // Seat 3 finishing early does not skip seat 2
    state = unwrap(markPhasesDone(state, { playerId: ITCHI, turnNumber: 1, upToPhase: 'SOT' }))
    expect(turnHolder(state)?.playerId).toBe(KARANDRAS1)

    state = unwrap(markPhasesDone(state, { playerId: KARANDRAS1, turnNumber: 1, upToPhase: 'SOT' }))
    expect(turnHolder(state)?.playerId).toBe(CHUL)

    // Everyone is through SOT, so the earliest open phase is TRADE and seat 1 is first again
    state = unwrap(markPhasesDone(state, { playerId: CHUL, turnNumber: 1, upToPhase: 'SOT' }))
    expect(turnHolder(state)?.playerId).toBe(CASH1981)
    expect(activeTurnStatus(state)?.phase).toBe('TRADE')
  })

  it('wraps to seat 1 when the start number is above every seat', () => {
    // No seat is at or after 9. Treating "not found" as an index would skip or
    // repeat seats; the order must just be seat 1 first.
    const state = chatGame()
    expect(turnHolder(state, 9)?.playerId).toBe(CASH1981)
    const afterCash = unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'SOT' }))
    expect(turnHolder(afterCash, 9)?.playerId).toBe(KARANDRAS1)
    // The last seat as the start player: it goes first, then wraps round
    expect(turnHolder(state, 4)?.playerId).toBe(CHUL)
    const afterChul = unwrap(markPhasesDone(state, { playerId: CHUL, turnNumber: 1, upToPhase: 'SOT' }))
    expect(turnHolder(afterChul, 4)?.playerId).toBe(CASH1981)
  })

  it('counts seats from the start player', () => {
    const state = chatGame()
    expect(turnHolder(state, 3)?.playerId).toBe(ITCHI)
    const afterItchi = unwrap(markPhasesDone(state, { playerId: ITCHI, turnNumber: 1, upToPhase: 'SOT' }))
    expect(turnHolder(afterItchi, 3)?.playerId).toBe(CHUL)
    const afterChul = unwrap(markPhasesDone(afterItchi, { playerId: CHUL, turnNumber: 1, upToPhase: 'SOT' }))
    // wraps round to seat 1
    expect(turnHolder(afterChul, 3)?.playerId).toBe(CASH1981)
  })
})

describe('activeTurn in the player view', () => {
  it('uses turnStatus when chat orders are on', () => {
    let state = unwrap(markPhasesDone(chatGame(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'SOT' }))
    state = finishTurn(state, 1)
    state = unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 2, upToPhase: 'TRADE' }))

    const view = toPlayerView(state, KARANDRAS1)
    expect(view.activeTurn).toEqual({
      playerId: KARANDRAS1,
      username: 'Karandras1',
      turnNumber: 2,
      phase: 'SOT',
      waitingFor: [
        { username: 'cash1981', phase: 'CM' },
        { username: 'Karandras1', phase: 'SOT' },
        { username: 'Itchi', phase: 'SOT' },
        { username: 'Chul', phase: 'SOT' },
      ],
    })
    expect(view.activeTurn).toEqual(toPlayerView(state, CASH1981).activeTurn)
  })

  it('is unchanged when chat orders are off, whatever the done flags say', () => {
    const state = firstCivGame()
    const baseline = JSON.stringify(toPlayerView(state, CASH1981).activeTurn)
    expect(baseline).toBe(
      JSON.stringify({ playerId: CASH1981, username: 'cash1981', turnNumber: 1, phase: 'SOT' }),
    )

    // done flags only matter in chat mode: a classic turn still follows `revealed`
    const marked = unwrap(
      setChatOrders(
        unwrap(markPhasesDone(chatGame(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'RESEARCH' })),
        false,
      ),
    )
    expect(findPlayer(marked, CASH1981)?.playerTurns[0]?.done.RESEARCH).toBe(true)
    expect(JSON.stringify(toPlayerView(marked, CASH1981).activeTurn)).toBe(baseline)
    expect(JSON.stringify(toPlayerView(state, KARANDRAS1).activeTurn)).toBe(baseline)
  })
})

describe('out-of-turn draws', () => {
  it('with chat orders on, a player who is not the turn holder is refused without confirmation', () => {
    const error = unwrapErr(draw(chatGame(), { playerId: KARANDRAS1, sheetName: 'CIV' }))
    expect(error).toEqual({ kind: 'NOT_YOUR_TURN', playerId: KARANDRAS1 })
    expect(unwrapErr(draw(chatGame(), { playerId: KARANDRAS1, sheetName: 'CIV', confirmedOutOfTurn: false })).kind).toBe('NOT_YOUR_TURN')
  })

  it('with chat orders on, confirmedOutOfTurn lets the draw through', () => {
    const state = unwrap(draw(chatGame(), { playerId: KARANDRAS1, sheetName: 'CIV', confirmedOutOfTurn: true }))
    expect(findPlayer(state, KARANDRAS1)?.items).toHaveLength(1)
  })

  it('with chat orders on, the turn holder draws without confirming, baton or not', () => {
    // The baton (`yourTurn`) is with cash1981 in firstCivGame. Once seat 1 is
    // through the start of turn, seat 2 holds the turn.
    const state = unwrap(markPhasesDone(chatGame(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'SOT' }))
    expect(findPlayer(state, KARANDRAS1)?.yourTurn).toBe(false)
    expect(unwrap(draw(state, { playerId: KARANDRAS1, sheetName: 'CIV' }))).toBeDefined()
    // and the baton holder is now out of turn
    expect(unwrapErr(draw(state, { playerId: CASH1981, sheetName: 'CIV' })).kind).toBe('NOT_YOUR_TURN')
  })

  it('drawWonder follows the same rule', () => {
    const input = { playerId: KARANDRAS1, sheetName: 'ANCIENT_WONDERS' } as const
    expect(unwrapErr(drawWonder(chatGame(), input)).kind).toBe('NOT_YOUR_TURN')
    expect(unwrap(drawWonder(chatGame(), { ...input, confirmedOutOfTurn: true }))).toBeDefined()
  })

  it('with chat orders off it is refused as before, confirmation or not', () => {
    const state = firstCivGame()
    expect(unwrapErr(draw(state, { playerId: KARANDRAS1, sheetName: 'CIV', confirmedOutOfTurn: true }))).toEqual({
      kind: 'NOT_YOUR_TURN',
      playerId: KARANDRAS1,
    })
    expect(unwrapErr(drawWonder(state, { playerId: KARANDRAS1, sheetName: 'ANCIENT_WONDERS', confirmedOutOfTurn: true })).kind).toBe('NOT_YOUR_TURN')
    // and the baton holder still draws
    expect(unwrap(draw(state, { playerId: CASH1981, sheetName: 'CIV' }))).toBeDefined()
  })
})

describe('hidden information with chat orders on', () => {
  it('another player sees the flags and posted orders but no private log, note or draft', () => {
    let state = chatGame()
    state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'GREAT_PERSON' }))
    state = unwrap(updateTurn(state, { playerId: CASH1981, turnNumber: 1, phase: 'CM', order: 'DRAFT-SECRET-PLAN' }))
    state = unwrap(postOrder(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', markdown: 'public order', at: 't' }))
    state = unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'SOT' }))
    const cash = findPlayer(state, CASH1981)
    if (cash === undefined) throw new Error('no cash1981')
    state = {
      ...state,
      players: state.players.map((player) =>
        player.playerId === CASH1981 ? { ...player, gamenote: 'NOTE-SECRET' } : player,
      ),
    }
    const privateLog = state.log.find((entry) => entry.playerId === CASH1981 && entry.item !== null)?.privateLog
    if (privateLog === undefined || privateLog === '') throw new Error('the draw has no private log')

    const json = JSON.stringify(toPlayerView(state, KARANDRAS1))
    expect(json).not.toContain('DRAFT-SECRET-PLAN')
    expect(json).not.toContain('NOTE-SECRET')
    expect(json).not.toContain(privateLog)
    // What is public is there
    expect(json).toContain('public order')
    expect(toPlayerView(state, KARANDRAS1).activeTurn?.waitingFor).toBeDefined()
    // The owner still has their own
    expect(JSON.stringify(toPlayerView(state, CASH1981))).toContain('DRAFT-SECRET-PLAN')
  })
})

describe('the turn phases', () => {
  it('there are five, and done is keyed by all of them', () => {
    const state = unwrap(markPhasesDone(chatGame(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'RESEARCH' }))
    expect(Object.keys(done(state, CASH1981) ?? {})).toEqual([...TURN_PHASES])
  })
})

describe('the chat orders baseline (chatOrdersStartTurn)', () => {
  /**
   * `turns` classic turns for each player, every phase revealed. A player in
   * `skipFirst` never wrote turn 1.
   */
  const classicGame = (turns: number, skipFirst: readonly string[]): GameState => {
    let state = firstCivGame()
    for (const playerId of [CASH1981, KARANDRAS1, ITCHI, CHUL]) {
      for (let turnNumber = skipFirst.includes(playerId) ? 2 : 1; turnNumber <= turns; turnNumber += 1) {
        for (const phase of TURN_PHASES) {
          state = unwrap(updateTurn(state, { playerId, turnNumber, phase, order: `${phase} ${turnNumber}` }))
          state = unwrap(revealTurnOrder(state, { playerId, turnNumber, phase, at: 't' }))
        }
      }
    }
    return state
  }

  it('does not pin the turn to 1 when the baton sits on a player who never wrote turn orders', () => {
    // Karandras1 wrote nothing at all and holds the baton, the classic view says turn 1
    const everyoneElse = [CASH1981, ITCHI, CHUL].reduce((state, playerId) => {
      let next = state
      for (let turnNumber = 1; turnNumber <= 20; turnNumber += 1) {
        for (const phase of TURN_PHASES) {
          next = unwrap(updateTurn(next, { playerId, turnNumber, phase, order: `${phase} ${turnNumber}` }))
          next = unwrap(revealTurnOrder(next, { playerId, turnNumber, phase, at: 't' }))
        }
      }
      return next
    }, firstCivGame())
    const laggardHoldsBaton = unwrap(takeTurn(everyoneElse, KARANDRAS1))
    expect(activeTurnStatus(laggardHoldsBaton)?.turnNumber).toBe(1)

    const on = unwrap(setChatOrders(laggardHoldsBaton, true))
    expect(on.chatOrdersStartTurn).toBe(21)
    expect(turnStatus(on).currentTurn).toBe(21)
  })

  it('starts at 1 in a new game and is set when the setting is switched on', () => {
    expect(firstCivGame().chatOrdersStartTurn).toBe(1)
    expect(chatGame().chatOrdersStartTurn).toBe(1)
  })

  it('a player who never wrote turn 1 does not pin the current turn to it', () => {
    const classic = classicGame(20, [KARANDRAS1])
    // The classic view: the baton holder finished turn 20, so it reports 21
    expect(activeTurnStatus(classic)?.turnNumber).toBe(21)

    const on = unwrap(setChatOrders(classic, true))
    expect(on.chatOrdersStartTurn).toBe(21)

    const status = turnStatus(on)
    expect(status.currentTurn).toBe(21)
    expect(status.waitingFor).toEqual([
      { username: 'cash1981', phase: 'SOT' },
      { username: 'Karandras1', phase: 'SOT' },
      { username: 'Itchi', phase: 'SOT' },
      { username: 'Chul', phase: 'SOT' },
    ])
    // Seat 1, not Karandras1 who skipped turn 1
    expect(turnHolder(on)?.playerId).toBe(CASH1981)
    expect(activeTurnStatus(on)).toMatchObject({ username: 'cash1981', turnNumber: 21, phase: 'SOT' })
  })

  it('without the baseline the same game would be pinned to turn 1', () => {
    // Guards the test above: it must fail when the baseline is ignored.
    const on = unwrap(setChatOrders(classicGame(20, [KARANDRAS1]), true))
    const noBaseline = { ...on, chatOrdersStartTurn: 1 }
    expect(turnStatus(noBaseline).currentTurn).toBe(1)
    expect(turnHolder(noBaseline)?.playerId).toBe(KARANDRAS1)
  })

  it('play carries on from the baseline', () => {
    let state = unwrap(setChatOrders(classicGame(20, [KARANDRAS1]), true))
    state = finishTurn(state, 21)
    expect(turnStatus(state).currentTurn).toBe(22)
  })

  it('switching on mid-turn uses the turn the classic view reports and never goes back down', () => {
    // Turn 3 is under way for the baton holder: not all phases revealed yet
    let state = classicGame(2, [])
    state = unwrap(updateTurn(state, { playerId: CASH1981, turnNumber: 3, phase: 'SOT', order: 'x' }))
    const on = unwrap(setChatOrders(state, true))
    expect(on.chatOrdersStartTurn).toBe(3)

    // Off and on again in a game that has moved on keeps the higher baseline
    const later = { ...unwrap(setChatOrders(on, false)), chatOrdersStartTurn: 9 }
    expect(unwrap(setChatOrders(later, true)).chatOrdersStartTurn).toBe(9)
    // Switching off leaves the baseline alone
    expect(unwrap(setChatOrders(on, false)).chatOrdersStartTurn).toBe(3)
  })

  it('a game that never played classic turns starts at 1', () => {
    expect(unwrap(setChatOrders(firstCivGame(), true)).chatOrdersStartTurn).toBe(1)
  })
})
