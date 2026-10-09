/**
 * A card used once this turn can be used again when the player confirms it. Some
 * Great Persons and culture cards allow a second use and are not built, so the
 * player is the override: only the `used` refusal is lifted, every other refusal
 * stands, and the second use pays and applies like the first.
 */

import { describe, expect, it } from 'vitest'

import { purchaseCoin } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import {
  assistedAvailability,
  availableActionsFor,
  performAssistedAction,
} from '../src/assisted.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { AssistedActionKind, GameState } from '../src/state.js'
import { toPlayerView } from '../src/state.js'

import { chivalryTurn, player, withPieceInArea } from './assisted-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-10-09T10:00:00.000Z'
const REPEAT_NOTE = '(used again, confirmed by the player)'

const press = (
  state: GameState,
  requestId: string,
  options: { readonly action?: AssistedActionKind; readonly confirmedRepeat?: boolean } = {},
) =>
  performAssistedAction(state, {
    playerId: CASH1981,
    action: options.action ?? 'chivalry',
    requestId,
    at: AT,
    ...(options.confirmedRepeat === undefined ? {} : { confirmedRepeat: options.confirmedRepeat }),
  })

/** Chivalry revealed, City Management open, and `pieces` incense pieces in the player's area. */
function withIncense(pieces: number): GameState {
  let state = chivalryTurn()
  for (let count = 0; count < pieces; count += 1) {
    state = withPieceInArea(state, 'resources/incense').state
  }
  return state
}

const incensePieces = (state: GameState) =>
  state.board.pieces.filter((piece) => piece.assetId === 'resources/incense')

const usedKeys = (state: GameState): readonly string[] => player(state).playerTurns[0]?.usedActions ?? []

function undoByVote(state: GameState, requestId: string): GameState {
  const logId = state.log.find((entry) => entry.assistedActionId === requestId)?.id
  if (logId === undefined) throw new Error('no log line for the action')
  let next = unwrap(initiateUndo(state, { logId, playerId: CASH1981 }))
  for (const playerId of [KARANDRAS1, ITCHI, CHUL]) {
    next = unwrap(vote(next, { logId, playerId, vote: true, at: AT }))
  }
  return next
}

/** Two incense, Chivalry used once and then once more with the player's confirmation. */
function usedTwice(): GameState {
  const first = unwrap(press(withIncense(2), 'first'))
  return unwrap(press(first, 'again', { confirmedRepeat: true }))
}

describe('a confirmed repeat', () => {
  it('is refused without the confirmation, and with it set to false', () => {
    const once = unwrap(press(withIncense(2), 'first'))
    expect(unwrapErr(press(once, 'again'))).toMatchObject({ kind: 'ASSISTED_ACTION_REJECTED', status: 'used' })
    expect(unwrapErr(press(once, 'again', { confirmedRepeat: false }))).toMatchObject({ status: 'used' })
    expect(player(once).stats.culture).toBe(5)
    expect(incensePieces(once)).toHaveLength(1)
  })

  it('still reports used, now saying that the player will be asked', () => {
    const once = unwrap(press(withIncense(2), 'first'))
    const status = assistedAvailability(once, CASH1981, 'chivalry')
    expect(status.status).toBe('used')
    expect(status.reason).toContain('once per turn')
    expect(status.reason).toContain('confirm')
    expect(availableActionsFor(once, CASH1981).find((entry) => entry.action === 'chivalry')?.status).toBe('used')
  })

  it('applies as a first use: culture, resource and one more record', () => {
    const twice = usedTwice()
    expect(player(twice).stats.culture).toBe(10)
    expect(incensePieces(twice)).toHaveLength(0)
    expect(twice.assistedActions.map((record) => record.id)).toEqual(['first', 'again'])
    expect(twice.assistedActions[1]).toMatchObject({
      status: 'applied',
      usageKey: 'card:Chivalry',
      confirmedRepeat: true,
    })
    expect(twice.assistedActions[0]).not.toHaveProperty('confirmedRepeat')
  })

  it('writes the usage key once and says so in the log line', () => {
    const twice = usedTwice()
    expect(usedKeys(twice)).toEqual(['card:Chivalry'])
    const lines = twice.log.filter((entry) => entry.assistedActionId !== undefined)
    expect(lines).toHaveLength(2)
    expect(lines[0]?.publicLog).not.toContain(REPEAT_NOTE)
    expect(lines[1]?.publicLog).toBe(
      `${player(twice).username} used Chivalry: spent 1 Incense and gained 5 culture ${REPEAT_NOTE}`,
    )
  })

  it('keeps the card used afterwards, so a third press asks again', () => {
    const twice = usedTwice()
    expect(assistedAvailability(twice, CASH1981, 'chivalry').status).toBe('used')
    expect(unwrapErr(press(twice, 'third'))).toMatchObject({ status: 'used' })
  })

  it('the confirmation on a card that is ready does not mark the use as a repeat', () => {
    const first = unwrap(press(withIncense(1), 'first', { confirmedRepeat: true }))
    expect(first.assistedActions[0]).not.toHaveProperty('confirmedRepeat')
    expect(first.log.at(-1)?.publicLog).not.toContain(REPEAT_NOTE)
  })

  it('a request id that is already recorded is still idempotent', () => {
    const twice = usedTwice()
    expect(unwrap(press(twice, 'again', { confirmedRepeat: true }))).toBe(twice)
    expect(unwrap(press(twice, 'first'))).toBe(twice)
  })

  it('lifts nothing but used: no resource left is still refused', () => {
    const once = unwrap(press(withIncense(1), 'first'))
    const error = unwrapErr(press(once, 'again', { confirmedRepeat: true }))
    expect(error).toMatchObject({ kind: 'ASSISTED_ACTION_REJECTED', status: 'needs-resource' })
    expect(player(once).stats.culture).toBe(5)
    expect(once.assistedActions).toHaveLength(1)
  })

  it('lifts nothing but used: a closed phase is still refused', () => {
    const once = unwrap(press(withIncense(2), 'first'))
    const closed = unwrap(markPhasesDone(once, { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' }))
    expect(unwrapErr(press(closed, 'again', { confirmedRepeat: true }))).toMatchObject({ status: 'wrong-phase' })
    expect(player(closed).stats.culture).toBe(5)
  })

  it('lifts nothing but used: a card the player does not have is still refused', () => {
    const state = withIncense(1)
    const error = unwrapErr(press(state, 'req', { action: 'currency', confirmedRepeat: true }))
    expect(error).toMatchObject({ status: 'not-owned' })
    expect(player(state).stats.culture).toBe(player(firstCivGame()).stats.culture)
  })

  it('lifts nothing but used: an unrevealed card is still refused', () => {
    const state = withIncense(1)
    const hidden = {
      ...state,
      players: state.players.map((candidate) => ({
        ...candidate,
        techsChosen: candidate.techsChosen.map((tech) => ({ ...tech, hidden: true })),
      })),
    }
    expect(unwrapErr(press(hidden, 'req', { confirmedRepeat: true }))).toMatchObject({ status: 'unavailable' })
  })
})

describe('a confirmed repeat of Democracy', () => {
  function democracyTurn(trade: number): GameState {
    const state = chivalryTurn('Democracy')
    return {
      ...state,
      players: state.players.map((candidate) =>
        candidate.playerId === CASH1981 ? { ...candidate, stats: { ...candidate.stats, trade } } : candidate,
      ),
    }
  }
  const democracy = { action: 'democracy' } as const

  it('pays and adds the coin again, and says so in the line', () => {
    const first = unwrap(press(democracyTurn(12), 'first', democracy))
    expect(unwrapErr(press(first, 'again', democracy))).toMatchObject({ status: 'used' })
    const again = unwrap(press(first, 'again', { ...democracy, confirmedRepeat: true }))
    expect(player(again).stats.trade).toBe(0)
    expect(player(again).stats.coinSources.democracy).toBe(2)
    expect(usedKeys(again)).toEqual(['coin-purchase:democracy'])
    expect(again.log.at(-1)?.publicLog).toContain(REPEAT_NOTE)
    expect(again.assistedActions[1]).toMatchObject({ confirmedRepeat: true })
  })

  it('is still refused when the player cannot pay', () => {
    const first = unwrap(press(democracyTurn(6), 'first', democracy))
    const error = unwrapErr(press(first, 'again', { ...democracy, confirmedRepeat: true }))
    expect(error).toMatchObject({ kind: 'COIN_PURCHASE_REJECTED', reason: 'INSUFFICIENT_RESOURCES' })
    expect(player(first).stats.coinSources.democracy).toBe(1)
  })

  it('the old coin-purchase reducer still refuses a second use', () => {
    const first = unwrap(press(democracyTurn(12), 'first', democracy))
    expect(unwrapErr(purchaseCoin(first, { playerId: CASH1981, source: 'democracy' }))).toMatchObject({
      reason: 'ALREADY_USED',
    })
  })
})

describe('undoing a confirmed repeat', () => {
  it('undoing the repeat leaves the first use in place and the card used', () => {
    const undone = undoByVote(usedTwice(), 'again')
    expect(player(undone).stats.culture).toBe(5)
    expect(incensePieces(undone)).toHaveLength(1)
    expect(usedKeys(undone)).toEqual(['card:Chivalry'])
    expect(assistedAvailability(undone, CASH1981, 'chivalry').status).toBe('used')
    expect(undone.assistedActions.map((record) => record.status)).toEqual(['applied', 'undone'])
  })

  it('undoing the first use while the repeat stands keeps the card used', () => {
    const undone = undoByVote(usedTwice(), 'first')
    expect(player(undone).stats.culture).toBe(5)
    expect(usedKeys(undone)).toEqual(['card:Chivalry'])
    expect(assistedAvailability(undone, CASH1981, 'chivalry').status).toBe('used')
    expect(undone.assistedActions.map((record) => record.status)).toEqual(['undone', 'applied'])
  })

  it('undoing both frees the key', () => {
    for (const order of [['again', 'first'], ['first', 'again']] as const) {
      let state = usedTwice()
      for (const requestId of order) state = undoByVote(state, requestId)
      expect(player(state).stats.culture).toBe(0)
      expect(incensePieces(state)).toHaveLength(2)
      expect(usedKeys(state)).toEqual([])
      expect(assistedAvailability(state, CASH1981, 'chivalry').status).toBe('ready')
    }
  })

  it('a single ordinary use still frees its key when undone', () => {
    const undone = undoByVote(unwrap(press(withIncense(1), 'first')), 'first')
    expect(usedKeys(undone)).toEqual([])
    expect(assistedAvailability(undone, CASH1981, 'chivalry').status).toBe('ready')
  })
})

describe('the projection of a confirmed repeat', () => {
  it('shows the repeat flag publicly and nothing about the effect', () => {
    const twice = usedTwice()
    const view = toPlayerView(twice, KARANDRAS1)
    const records = view.assistedActions ?? []
    expect(records.map((record) => record.confirmedRepeat)).toEqual([undefined, true])
    const json = JSON.stringify(view)
    expect(json).not.toContain('"effect"')
    expect(json).not.toContain('usageKey')
    expect(json).not.toContain('card:Chivalry')
    // The actor's own button state is theirs; the other players' views carry their own, never the actor's
    expect(json).not.toContain('has already been used this turn')
    expect(JSON.stringify(toPlayerView(twice, CASH1981))).toContain('has already been used this turn')
    expect(JSON.stringify(toPlayerView(twice, 'a-spectator'))).not.toContain('"availableActions"')
  })
})
