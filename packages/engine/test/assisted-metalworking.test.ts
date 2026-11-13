/**
 * Metalworking (issue #327, slice 2): "Iron — Battle: when playing a unit from hand, add 3 to the attack of its
 * strength." Pays the Iron, adds 3 to the typed attack of one of the player's own living arena units, once per turn.
 */

import { describe, expect, it } from 'vitest'

import { initiateBattle, placeUnitInArena, setArenaUnitStat } from '../src/actions/arena.js'
import { draw, drawUnitsForBattle } from '../src/actions/draw.js'
import { chooseTech, revealTech } from '../src/actions/player.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { assistedAvailability, performAssistedAction } from '../src/assisted.js'
import { killArenaUnit } from '../src/actions/arena.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { GameState } from '../src/state.js'

import { player, withHutInHand } from './assisted-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-11-13T12:00:00.000Z'

const withTech = (state: GameState, techName: string, playerId = CASH1981): GameState =>
  unwrap(revealTech(unwrap(chooseTech(state, { playerId, techName })), { playerId, techName }))

/** Cash (attacker) and Karandras (defender) each have two infantry in the arena, attack 1, 3 health. */
function fight(): GameState {
  let state = firstCivGame()
  for (const playerId of [CASH1981, KARANDRAS1]) {
    for (let i = 0; i < 2; i++) state = unwrap(draw(state, { playerId, sheetName: 'INFANTRY', confirmedOutOfTurn: true }))
    state = unwrap(drawUnitsForBattle(state, { playerId, numberOfDraws: 2 }))
  }
  state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))
  for (const [playerId, side, first] of [
    [CASH1981, 'attacker', 0],
    [KARANDRAS1, 'defender', 10],
  ] as const) {
    for (const [index, unit] of (findPlayer(state, playerId)?.battlehand ?? []).entries()) {
      state = unwrap(placeUnitInArena(state, { playerId, unitId: unit.id, side, position: first + index, attack: 1, health: 3 }))
    }
  }
  return state
}

const armed = (): GameState => withHutInHand(withTech(fight(), 'Metalworking'), 'Iron').state
const mine = (state: GameState) => (state.battle?.arena ?? []).filter((unit) => unit.placedBy === CASH1981)
const theirs = (state: GameState) => (state.battle?.arena ?? []).filter((unit) => unit.placedBy === KARANDRAS1)

const press = (state: GameState, payload?: Record<string, unknown>, requestId = 'req-1', confirmedRepeat = false) =>
  performAssistedAction(state, {
    playerId: CASH1981,
    action: 'metalworking',
    requestId,
    at: AT,
    ...(payload === undefined ? {} : { payload: payload as never }),
    ...(confirmedRepeat ? { confirmedRepeat } : {}),
  })

const tryVote = (state: GameState, requestId: string) => {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of [KARANDRAS1, ITCHI]) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  return vote(next, { logId: entry.id, playerId: CHUL, vote: true, at: AT })
}

const hasIron = (state: GameState): boolean => player(state).items.some((item) => item.kind === 'hut' && item.name === 'Iron' && !item.used)

describe('Metalworking (Iron, Battle: +3 attack on one of your own arena units)', () => {
  it('needs a battle you fight in, the tech revealed, an Iron token and a unit of your own in the arena', () => {
    expect(assistedAvailability(armed(), CASH1981, 'metalworking').status).toBe('ready')
    expect(assistedAvailability(withHutInHand(withTech(firstCivGame(), 'Metalworking'), 'Iron').state, CASH1981, 'metalworking')).toMatchObject({ status: 'wrong-phase' })
    expect(assistedAvailability(withTech(fight(), 'Metalworking'), CASH1981, 'metalworking').status).toBe('needs-resource')
    expect(assistedAvailability(withHutInHand(fight(), 'Iron').state, CASH1981, 'metalworking').status).toBe('not-owned')
    const bystander = withHutInHand(withTech(fight(), 'Metalworking', ITCHI), 'Iron', ITCHI).state
    expect(assistedAvailability(bystander, ITCHI, 'metalworking')).toMatchObject({ status: 'unavailable' })
    // Every unit of yours dead: nothing to give attack to
    let dead = armed()
    for (const unit of mine(dead)) dead = unwrap(killArenaUnit(dead, { playerId: CASH1981, arenaUnitId: unit.id }))
    expect(assistedAvailability(dead, CASH1981, 'metalworking')).toMatchObject({ status: 'unavailable' })
  })

  it('adds 3 to the chosen unit only, pays the Iron and logs it', () => {
    const state = armed()
    const [first, second] = mine(state)
    if (first === undefined || second === undefined) throw new Error('missing units')
    const used = unwrap(press(state, { arenaUnitId: first.id }))
    expect(mine(used).map((unit) => unit.attack)).toEqual([4, 1])
    expect(theirs(used).map((unit) => unit.attack)).toEqual([1, 1])
    expect(hasIron(used)).toBe(false)
    expect(player(used).playerTurns.at(-1)?.usedActions).toContain('card:Metalworking')
    expect(assistedAvailability(used, CASH1981, 'metalworking').status).toBe('used')
  })

  it('names the unit as the arena does once it is announced, and not before', () => {
    const state = armed()
    const first = mine(state)[0]
    if (first === undefined) throw new Error('missing unit')
    // Placed units are not announced until their player ends their turn: the public line does not name the card
    const hidden = unwrap(press(state, { arenaUnitId: first.id }))
    const hiddenLine = hidden.log.find((entry) => entry.assistedActionId === 'req-1')?.publicLog ?? ''
    expect(hiddenLine).toBe('cash1981 used Metalworking: spent 1 Iron, adding 3 to the attack of a unit it placed (1 → 4)')
    expect(hidden.log.some((entry) => entry.playerId === CASH1981 && entry.privateLog.includes('Metalworking: ') && entry.privateLog.includes('item number'))).toBe(true)
    // The card named in the owner's private line never reaches the other player's log
    // The private line follows the public one and carries the time of the press
    const lines = hidden.log.filter((entry) => entry.createdAt === AT)
    expect(lines.at(-2)?.assistedActionId).toBe('req-1')
    expect(lines.at(-1)?.privateLog).toContain('attack 1 → 4')
    expect(JSON.stringify(toPlayerView(hidden, KARANDRAS1).log)).not.toContain('attack 1 → 4')

    const announced: GameState = {
      ...state,
      battle: { ...state.battle!, arena: state.battle!.arena.map((unit) => ({ ...unit, announced: true })) },
    }
    const named = unwrap(press(announced, { arenaUnitId: first.id }))
    expect(named.log.find((entry) => entry.assistedActionId === 'req-1')?.publicLog).toMatch(
      /^cash1981 used Metalworking: spent 1 Iron, adding 3 to the attack of .* item number #\d+ \(1 → 4\)$/,
    )
  })

  it('refuses an enemy unit, a dead unit, a missing id and a malformed payload, and pays nothing', () => {
    const state = armed()
    const enemy = theirs(state)[0]
    const own = mine(state)[0]
    if (enemy === undefined || own === undefined) throw new Error('missing units')
    const dead = unwrap(killArenaUnit(state, { playerId: CASH1981, arenaUnitId: own.id }))
    for (const [base, payload] of [
      [state, { arenaUnitId: enemy.id }],
      [state, { arenaUnitId: 'nope' }],
      [state, {}],
      [state, undefined],
      [state, { arenaUnitId: 7 }],
      [dead, { arenaUnitId: own.id }],
    ] as const) {
      expect(unwrapErr(press(base, payload)).kind).toBe('ASSISTED_ACTION_REJECTED')
    }
    expect(hasIron(state)).toBe(true)
    expect(mine(state).map((unit) => unit.attack)).toEqual([1, 1])
  })

  it('is once per turn, with a confirmed repeat that adds another 3', () => {
    const state = withHutInHand(armed(), 'Iron').state
    const own = mine(state)[0]
    if (own === undefined) throw new Error('missing unit')
    const first = unwrap(press(state, { arenaUnitId: own.id }))
    expect(unwrapErr(press(first, { arenaUnitId: own.id }, 'req-2')).kind).toBe('ASSISTED_ACTION_REJECTED')
    const second = unwrap(press(first, { arenaUnitId: own.id }, 'req-2', true))
    expect(mine(second)[0]?.attack).toBe(7)
    // The player's own private line follows the public one, so the public line is found by its action
    expect(second.log.find((entry) => entry.assistedActionId === 'req-2')?.publicLog).toContain('confirmed by the player')
  })

  it('an undo by vote returns the Iron and takes the 3 back', () => {
    const state = armed()
    const own = mine(state)[0]
    if (own === undefined) throw new Error('missing unit')
    const used = unwrap(press(state, { arenaUnitId: own.id }))
    const undone = unwrap(tryVote(used, 'req-1'))
    expect(hasIron(undone)).toBe(true)
    expect(mine(undone).map((unit) => unit.attack)).toEqual([1, 1])
    expect(player(undone).playerTurns.at(-1)?.usedActions).not.toContain('card:Metalworking')
  })

  it('refuses the undo when the unit attack was edited since, or the unit is gone', () => {
    const state = armed()
    const own = mine(state)[0]
    if (own === undefined) throw new Error('missing unit')
    const used = unwrap(press(state, { arenaUnitId: own.id }))
    const edited = unwrap(setArenaUnitStat(used, { playerId: CASH1981, arenaUnitId: own.id, key: 'attack', value: 5 }))
    expect(unwrapErr(tryVote(edited, 'req-1')).kind).toBe('ASSISTED_UNDO_BLOCKED')
    // Nothing moved: the Iron is still spent and the edit stands
    expect(mine(edited)[0]?.attack).toBe(5)

    const gone: GameState = { ...used, battle: null }
    expect(unwrapErr(tryVote(gone, 'req-1')).kind).toBe('ASSISTED_UNDO_BLOCKED')
  })
})
