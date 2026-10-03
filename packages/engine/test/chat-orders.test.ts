/**
 * Chat orders (issue #215), slice 1. New in the port, so there is no Java
 * counterpart: the behaviour is the one in `docs/agents/tasks/chat-orders.md`.
 * Since the single chat (`docs/agents/tasks/single-chat.md`) it is the only mode.
 */

import { describe, expect, it } from 'vitest'

import { draw, drawWonder } from '../src/actions/draw.js'
import {
  allPublicTurns,
  markPhasesDone,
  postOrder,
  revealTurnOrder,
  unmarkPhaseDone,
  updateTurn,
} from '../src/actions/turn.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { activeTurnStatus, findPlayer, toPlayerView } from '../src/state.js'
import type { PlayerTurn, TurnPhase } from '../src/turn.js'
import { TURN_PHASES, migratePlayerTurn, turnHolder, turnStatus } from '../src/turn.js'

import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const done = (state: GameState, playerId: string, turnNumber = 1): Readonly<Record<TurnPhase, boolean>> | undefined =>
  findPlayer(state, playerId)?.playerTurns.find((turn) => turn.turnNumber === turnNumber)?.done

/** Everybody marks every phase of a turn done. */
const finishTurn = (state: GameState, turnNumber: number): GameState =>
  [CASH1981, KARANDRAS1, ITCHI, CHUL].reduce(
    (current, playerId) =>
      unwrap(markPhasesDone(current, { playerId, turnNumber, upToPhase: 'RESEARCH' })),
    state,
  )

describe('the classic update and reveal', () => {
  it('still work, and a reveal publishes the order and marks the phase done', () => {
    let state = unwrap(updateTurn(firstCivGame(), { playerId: CASH1981, turnNumber: 1, phase: 'SOT', order: 'classic' }))
    state = unwrap(revealTurnOrder(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT', at: 't1' }))
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
    const state = unwrap(markPhasesDone(firstCivGame(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' }))
    expect(done(state, CASH1981)).toEqual({ SOT: true, TRADE: true, CM: true, MOVEMENT: false, RESEARCH: false })
    expect(state.publicTurns['1cash1981']?.done.CM).toBe(true)
    expect(state.log.at(-1)?.publicLog).toBe('Turn 1 - cash1981 marked all phases up to city management done')
    expect(state.log.at(-1)?.logType).toBe('CM')
  })

  it('does not need to be the players turn', () => {
    // KARANDRAS1 does not hold the baton in firstCivGame
    const state = unwrap(markPhasesDone(firstCivGame(), { playerId: KARANDRAS1, turnNumber: 1, upToPhase: 'SOT' }))
    expect(done(state, KARANDRAS1)?.SOT).toBe(true)
    expect(state.log.at(-1)?.publicLog).toBe('Turn 1 - Karandras1 marked start of turn phase done')
  })

  it('repeating it changes and logs nothing', () => {
    const once = unwrap(markPhasesDone(firstCivGame(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' }))
    expect(unwrap(markPhasesDone(once, { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))).toBe(once)
  })

  it('keeps phases already marked and leaves published orders alone', () => {
    let state = unwrap(postOrder(firstCivGame(), { playerId: CASH1981, turnNumber: 1, phase: 'CM', markdown: 'build', at: 't1' }))
    state = unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'MOVEMENT' }))
    expect(findPlayer(state, CASH1981)?.playerTurns[0]?.orders.CM).toBe('build')
    expect(findPlayer(state, CASH1981)?.playerTurns).toHaveLength(1)
  })

  it('a player who is not in the game is refused', () => {
    expect(unwrapErr(markPhasesDone(firstCivGame(), { playerId: 'stranger', turnNumber: 1, upToPhase: 'SOT' }))).toEqual({
      kind: 'NO_ACCESS',
      playerId: 'stranger',
    })
  })
})

describe('unmarkPhaseDone', () => {
  it('unmarks one phase and does not touch the later ones', () => {
    let state = unwrap(markPhasesDone(firstCivGame(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'MOVEMENT' }))
    state = unwrap(unmarkPhaseDone(state, { playerId: CASH1981, turnNumber: 1, phase: 'TRADE' }))
    expect(done(state, CASH1981)).toEqual({ SOT: true, TRADE: false, CM: true, MOVEMENT: true, RESEARCH: false })
    expect(state.publicTurns['1cash1981']?.done.TRADE).toBe(false)
    expect(state.log.at(-1)?.publicLog).toBe('Turn 1 - cash1981 marked trade phase not done')
  })

  it('needs no vote and does not need the players turn', () => {
    let state = unwrap(markPhasesDone(firstCivGame(), { playerId: CHUL, turnNumber: 1, upToPhase: 'SOT' }))
    state = unwrap(unmarkPhaseDone(state, { playerId: CHUL, turnNumber: 1, phase: 'SOT' }))
    expect(done(state, CHUL)?.SOT).toBe(false)
  })

  it('unmarking a phase that is not done changes nothing', () => {
    const state = unwrap(markPhasesDone(firstCivGame(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'SOT' }))
    expect(unwrap(unmarkPhaseDone(state, { playerId: CASH1981, turnNumber: 1, phase: 'CM' }))).toBe(state)
  })

  it('a turn that does not exist is TURN_NOT_FOUND', () => {
    expect(unwrapErr(unmarkPhaseDone(firstCivGame(), { playerId: CASH1981, turnNumber: 4, phase: 'SOT' }))).toEqual({
      kind: 'TURN_NOT_FOUND',
      turnNumber: 4,
    })
  })
})

describe('postOrder', () => {
  it('writes and publishes the order in one step, without marking it done', () => {
    const state = unwrap(
      postOrder(firstCivGame(), { playerId: KARANDRAS1, turnNumber: 1, phase: 'MOVEMENT', markdown: 'A6 to A5', at: '2026-01-01T10:00:00Z' }),
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
    let state = firstCivGame()
    state = unwrap(postOrder(state, { playerId: CASH1981, turnNumber: 2, phase: 'SOT', markdown: 'first', at: 't1' }))
    state = unwrap(postOrder(state, { playerId: CASH1981, turnNumber: 2, phase: 'SOT', markdown: 'second', at: 't2' }))

    const turn = findPlayer(state, CASH1981)?.playerTurns[0]
    expect(turn?.orders.SOT).toBe('second')
    expect(turn?.history.SOT.map((version) => version.markdown)).toEqual(['first', 'second'])
    expect(state.publicTurns['2cash1981']?.orders.SOT).toBe('second')
    expect(state.publicTurns['2cash1981']?.history.SOT).toHaveLength(2)
  })

  it('does not need the players turn, and refuses a stranger', () => {
    expect(unwrap(postOrder(firstCivGame(), { playerId: CHUL, turnNumber: 1, phase: 'SOT', markdown: 'x', at: 't' })).publicTurns['1Chul']).toBeDefined()
    expect(unwrapErr(postOrder(firstCivGame(), { playerId: 'stranger', turnNumber: 1, phase: 'SOT', markdown: 'x', at: 't' })).kind).toBe('NO_ACCESS')
  })

  it('does not disturb the other phases of the turn', () => {
    let state = unwrap(updateTurn(firstCivGame(), { playerId: CASH1981, turnNumber: 1, phase: 'CM', order: 'draft, unpublished' }))
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
    const status = turnStatus(firstCivGame())
    expect(status.currentTurn).toBe(1)
    expect(status.waitingFor).toEqual([
      { username: 'cash1981', phase: 'SOT' },
      { username: 'Karandras1', phase: 'SOT' },
      { username: 'Itchi', phase: 'SOT' },
      { username: 'Chul', phase: 'SOT' },
    ])
  })

  it('reports each players first phase not done', () => {
    let state = unwrap(markPhasesDone(firstCivGame(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' }))
    state = unwrap(markPhasesDone(state, { playerId: ITCHI, turnNumber: 1, upToPhase: 'RESEARCH' }))
    const byName = Object.fromEntries(turnStatus(state).players.map((player) => [player.username, player.phase]))
    expect(byName).toEqual({ cash1981: 'MOVEMENT', Karandras1: 'SOT', Itchi: null, Chul: 'SOT' })
    // Itchi has finished, so nobody waits for them
    expect(turnStatus(state).waitingFor.map((entry) => entry.username)).toEqual(['cash1981', 'Karandras1', 'Chul'])
  })

  it('follows an unmark at once', () => {
    let state = unwrap(markPhasesDone(firstCivGame(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' }))
    state = unwrap(unmarkPhaseDone(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT' }))
    expect(turnStatus(state).players[0]?.phase).toBe('SOT')
  })

  it('moves to the next turn when the last player marks Research done', () => {
    let state = firstCivGame()
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
    let state = finishTurn(firstCivGame(), 1)
    state = unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 2, upToPhase: 'RESEARCH' }))
    state = unwrap(unmarkPhaseDone(state, { playerId: CHUL, turnNumber: 1, phase: 'RESEARCH' }))
    expect(turnStatus(state).currentTurn).toBe(1)
    expect(turnStatus(state).waitingFor).toEqual([{ username: 'Chul', phase: 'RESEARCH' }])
  })

  it('a withdrawn player never holds the turn up', () => {
    let state = firstCivGame()
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
    const status = turnStatus({ ...firstCivGame(), players: [] })
    expect(status).toEqual({ currentTurn: 1, players: [], waitingFor: [] })
    expect(turnHolder({ ...firstCivGame(), players: [] })).toBeUndefined()
  })
})

describe('turnHolder', () => {
  it('starts with seat 1', () => {
    expect(turnHolder(firstCivGame())?.playerId).toBe(CASH1981)
  })

  it('is the first player, in seat order, who has not marked the earliest open phase done', () => {
    let state = unwrap(markPhasesDone(firstCivGame(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'SOT' }))
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
    const state = firstCivGame()
    expect(turnHolder(state, 9)?.playerId).toBe(CASH1981)
    const afterCash = unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'SOT' }))
    expect(turnHolder(afterCash, 9)?.playerId).toBe(KARANDRAS1)
    // The last seat as the start player: it goes first, then wraps round
    expect(turnHolder(state, 4)?.playerId).toBe(CHUL)
    const afterChul = unwrap(markPhasesDone(state, { playerId: CHUL, turnNumber: 1, upToPhase: 'SOT' }))
    expect(turnHolder(afterChul, 4)?.playerId).toBe(CASH1981)
  })

  it('counts seats from the start player', () => {
    const state = firstCivGame()
    expect(turnHolder(state, 3)?.playerId).toBe(ITCHI)
    const afterItchi = unwrap(markPhasesDone(state, { playerId: ITCHI, turnNumber: 1, upToPhase: 'SOT' }))
    expect(turnHolder(afterItchi, 3)?.playerId).toBe(CHUL)
    const afterChul = unwrap(markPhasesDone(afterItchi, { playerId: CHUL, turnNumber: 1, upToPhase: 'SOT' }))
    // wraps round to seat 1
    expect(turnHolder(afterChul, 3)?.playerId).toBe(CASH1981)
  })
})

describe('activeTurn in the player view', () => {
  it('is read from turnStatus', () => {
    let state = unwrap(markPhasesDone(firstCivGame(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'SOT' }))
    state = finishTurn(state, 1)
    state = unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 2, upToPhase: 'TRADE' }))

    const view = toPlayerView(state, KARANDRAS1)
    expect(view.activeTurn).toEqual({
      playerId: KARANDRAS1,
      username: 'Karandras1',
      turnNumber: 2,
      phase: 'SOT',
      // Turn 1 finished, so turn 2 started with the next seat
      startPlayer: 'Karandras1',
      waitingFor: [
        { username: 'cash1981', phase: 'CM' },
        { username: 'Karandras1', phase: 'SOT' },
        { username: 'Itchi', phase: 'SOT' },
        { username: 'Chul', phase: 'SOT' },
      ],
    })
    expect(view.activeTurn).toEqual(toPlayerView(state, CASH1981).activeTurn)
  })
})

describe('out-of-turn draws', () => {
  it('a player who is not the turn holder is refused without confirmation', () => {
    const error = unwrapErr(draw(firstCivGame(), { playerId: KARANDRAS1, sheetName: 'CIV' }))
    expect(error).toEqual({ kind: 'NOT_YOUR_TURN', playerId: KARANDRAS1 })
    expect(unwrapErr(draw(firstCivGame(), { playerId: KARANDRAS1, sheetName: 'CIV', confirmedOutOfTurn: false })).kind).toBe('NOT_YOUR_TURN')
  })

  it('confirmedOutOfTurn lets the draw through', () => {
    const state = unwrap(draw(firstCivGame(), { playerId: KARANDRAS1, sheetName: 'CIV', confirmedOutOfTurn: true }))
    expect(findPlayer(state, KARANDRAS1)?.items).toHaveLength(1)
  })

  it('the turn holder draws without confirming, whatever `yourTurn` says', () => {
    // `yourTurn` is stored data that nothing moves: it stays with cash1981 in
    // firstCivGame. Once seat 1 is through the start of turn, seat 2 holds the turn.
    const state = unwrap(markPhasesDone(firstCivGame(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'SOT' }))
    expect(findPlayer(state, KARANDRAS1)?.yourTurn).toBe(false)
    expect(unwrap(draw(state, { playerId: KARANDRAS1, sheetName: 'CIV' }))).toBeDefined()
    // and the player with `yourTurn` set is now out of turn
    expect(unwrapErr(draw(state, { playerId: CASH1981, sheetName: 'CIV' })).kind).toBe('NOT_YOUR_TURN')
  })

  it('drawWonder follows the same rule', () => {
    const input = { playerId: KARANDRAS1, sheetName: 'ANCIENT_WONDERS' } as const
    expect(unwrapErr(drawWonder(firstCivGame(), input)).kind).toBe('NOT_YOUR_TURN')
    expect(unwrap(drawWonder(firstCivGame(), { ...input, confirmedOutOfTurn: true }))).toBeDefined()
  })
})

describe('hidden information', () => {
  it('another player sees the flags and posted orders but no private log, note or draft', () => {
    let state = firstCivGame()
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
    const state = unwrap(markPhasesDone(firstCivGame(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'RESEARCH' }))
    expect(Object.keys(done(state, CASH1981) ?? {})).toEqual([...TURN_PHASES])
  })
})
