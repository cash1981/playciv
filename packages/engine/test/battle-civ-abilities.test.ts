/**
 * Civilization abilities that act when a battle ends: the Aztecs' trade and culture, the Chinese saving a killed unit.
 */

import { describe, expect, it } from 'vitest'

import { endBattleAction, initiateBattle, killArenaUnit, placeUnitInArena, undoEndBattle } from '../src/actions/arena.js'
import { draw, drawUnitsForBattle } from '../src/actions/draw.js'
import { unwrap } from '../src/result.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { GameState } from '../src/state.js'

import { withCivilization, withStats } from './culture-advance-fixture.js'
import { CASH1981, KARANDRAS1, firstCivGame } from './fixture.js'

/** Cash (attacker) and Karandras1 (defender) with two units each in the arena, 1 attack and 3 health. */
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

const unitsOf = (state: GameState, playerId: string) => (state.battle?.arena ?? []).filter((unit) => unit.placedBy === playerId)
const kill = (state: GameState, playerId: string, count: number, victim: string): GameState =>
  unitsOf(state, victim)
    .slice(0, count)
    .reduce((next, unit) => unwrap(killArenaUnit(next, { playerId, arenaUnitId: unit.id })), state)
const me = (state: GameState, playerId = CASH1981) => {
  const found = findPlayer(state, playerId)
  if (found === undefined) throw new Error('no player')
  return found
}
const lines = (state: GameState): string[] => state.log.map((entry) => entry.publicLog)

describe('the Aztecs after a battle', () => {
  const aztecFight = (): GameState => withStats(withCivilization(fight(), 'Aztecs'), { trade: 5, culture: 5 })

  it('gain 3 trade for winning and 1 culture for each unit killed on either side', () => {
    // Cash kills both enemy units and loses one of their own: 3 killed, Cash wins
    const state = kill(kill(aztecFight(), KARANDRAS1, 1, CASH1981), CASH1981, 2, KARANDRAS1)
    const ended = unwrap(endBattleAction(state, { playerId: CASH1981 }))
    expect(me(ended).stats.trade).toBe(8)
    expect(me(ended).stats.culture).toBe(8)
    expect(lines(ended)).toContain('cash1981 gains 3 (8) trade for winning and 3 (8) culture for the units killed as the Aztecs')
    expect(ended.endedBattle?.aztecs).toEqual({ playerId: CASH1981, trade: 3, culture: 3 })
  })

  it('gain only the culture when they lose, also when the other side presses End battle', () => {
    const state = kill(aztecFight(), CASH1981, 2, CASH1981)
    const ended = unwrap(endBattleAction(state, { playerId: KARANDRAS1 }))
    expect(me(ended).stats.trade).toBe(5)
    expect(me(ended).stats.culture).toBe(7)
    expect(lines(ended)).toContain('cash1981 gains 2 (7) culture for the units killed as the Aztecs')
  })

  it('gain nothing when nobody was killed and they did not win, and nobody else gains anything', () => {
    // A draw goes to the defender
    const ended = unwrap(endBattleAction(aztecFight(), { playerId: CASH1981 }))
    expect(me(ended).stats).toMatchObject({ trade: 5, culture: 5 })
    expect(ended.endedBattle?.aztecs).toBeUndefined()
    const other = unwrap(endBattleAction(kill(fight(), CASH1981, 2, KARANDRAS1), { playerId: CASH1981 }))
    expect(me(other).stats.culture).toBe(me(fight()).stats.culture)
  })

  it('earn nothing from a battle against the barbarians they only control', () => {
    // Karandras1 controls the barbarians for Cash; as the Aztecs they fought no battle of their own
    const base = withCivilization(firstCivGame(), 'Aztecs', KARANDRAS1)
    const state = unwrap(initiateBattle(base, { initiatorId: CASH1981, opponentId: 'barbarians' }))
    const ended = unwrap(endBattleAction(state, { playerId: CASH1981 }))
    expect(me(ended, KARANDRAS1).stats.trade).toBe(me(base, KARANDRAS1).stats.trade)
    expect(ended.endedBattle?.aztecs).toBeUndefined()
  })

  it('are put back by undoing the end of the battle, and the log names no unit', () => {
    const state = kill(aztecFight(), CASH1981, 2, KARANDRAS1)
    const ended = unwrap(endBattleAction(state, { playerId: CASH1981 }))
    const undone = unwrap(undoEndBattle(ended, { playerId: CASH1981 }))
    expect(me(undone).stats).toMatchObject({ trade: 5, culture: 5 })
    expect(undone.battle).not.toBeNull()
    expect(lines(undone).at(-1)).toContain('takes back what the Aztecs gained')
    const unitName = unitsOf(state, KARANDRAS1)[0]?.unit.id ?? 'x'
    expect(lines(ended).filter((line) => line.includes('Aztecs')).every((line) => !line.includes(unitName))).toBe(true)
  })
})

describe('the Chinese after a battle', () => {
  const chineseFight = (): GameState => withCivilization(fight(), 'Chinese')

  it('save one killed unit, the first one, and it stays in the hand', () => {
    const state = kill(chineseFight(), KARANDRAS1, 2, CASH1981)
    const killed = unitsOf(state, CASH1981)
    const ended = unwrap(endBattleAction(state, { playerId: CASH1981 }))
    const saved = ended.endedBattle?.battle.arena.filter((unit) => unit.saved === true) ?? []
    expect(saved.map((unit) => unit.id)).toEqual([killed[0]?.id])
    expect(ended.endedBattle?.chineseSaved).toBe(killed[0]?.id)
    expect(lines(ended)).toContain('cash1981 saves one killed unit as the Chinese: it stays in the hand')
    // The card is in the hand, not in the discards
    expect(me(ended).items.some((item) => item.id === killed[0]?.unit.id)).toBe(true)
    // The public view of the last battle carries the mark, with ids scrubbed
    const view = toPlayerView(ended, KARANDRAS1)
    expect(view.lastBattle?.arena.filter((unit) => unit.saved === true)).toHaveLength(1)
    expect(JSON.stringify(view.lastBattle)).not.toContain(killed[0]?.unit.id ?? 'x')
  })

  it('save nothing when no Chinese unit was killed, and a unit of the other side is not saved', () => {
    const none = unwrap(endBattleAction(kill(chineseFight(), CASH1981, 2, KARANDRAS1), { playerId: CASH1981 }))
    expect(none.endedBattle?.chineseSaved).toBeUndefined()
    expect(none.endedBattle?.battle.arena.some((unit) => unit.saved === true)).toBe(false)
  })

  it('is taken back by undoing the end of the battle: the unit is killed and unsaved again', () => {
    const state = kill(chineseFight(), KARANDRAS1, 1, CASH1981)
    const ended = unwrap(endBattleAction(state, { playerId: CASH1981 }))
    const undone = unwrap(undoEndBattle(ended, { playerId: CASH1981 }))
    expect(undone.battle?.arena.some((unit) => unit.saved === true)).toBe(false)
    expect(undone.battle?.arena.filter((unit) => unit.killed)).toHaveLength(1)
    expect(lines(undone).at(-1)).toContain('the saved Chinese unit is killed again')
    expect(undone.endedBattle).toBeNull()
  })
})
