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

  it('write every gain as the amount followed by the new total in parentheses, and every take-back the same way', () => {
    const state = kill(kill(aztecFight(), KARANDRAS1, 1, CASH1981), CASH1981, 2, KARANDRAS1)
    const ended = unwrap(endBattleAction(state, { playerId: CASH1981 }))
    const gain = lines(ended).find((line) => line.includes('as the Aztecs')) ?? ''
    // Before: 5 trade and 5 culture; the amounts 3 and 3 give the totals 8 and 8
    expect(gain).toMatch(/^cash1981 gains 3 \(8\) trade for winning and 3 \(8\) culture for the units killed as the Aztecs$/)
    const back = lines(unwrap(undoEndBattle(ended, { playerId: CASH1981 }))).at(-1) ?? ''
    expect(back).toContain('takes back 3 (5) trade and 3 (5) culture the Aztecs gained')
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

  it('earn nothing from a battle the barbarians they only control fight', () => {
    // Karandras1 (the Aztecs) controls the barbarians for Cash. The barbarians win a battle in which a unit is killed:
    // as a side of their own army the Aztecs would gain trade and culture; as the barbarians' controller they gain nothing
    let base = withCivilization(firstCivGame(), 'Aztecs', KARANDRAS1)
    base = unwrap(draw(base, { playerId: CASH1981, sheetName: 'INFANTRY', confirmedOutOfTurn: true }))
    base = unwrap(drawUnitsForBattle(base, { playerId: CASH1981, numberOfDraws: 1 }))
    let state = unwrap(initiateBattle(base, { initiatorId: CASH1981, opponentId: 'barbarians' }))
    expect(state.battle?.defender).toEqual({ kind: 'barbarians', playerId: KARANDRAS1 })
    const own = me(state).battlehand[0]
    const barbarian = me(state, KARANDRAS1).barbarians[0]
    if (own === undefined || barbarian === undefined) throw new Error('no units')
    state = unwrap(placeUnitInArena(state, { playerId: CASH1981, unitId: own.id, side: 'attacker', position: 0, attack: 1, health: 3 }))
    state = unwrap(placeUnitInArena(state, { playerId: KARANDRAS1, unitId: barbarian.id, side: 'defender', position: 0, attack: 1, health: 3 }))
    const killed = state.battle?.arena.find((unit) => unit.side === 'attacker')
    if (killed === undefined) throw new Error('no attacker')
    state = unwrap(killArenaUnit(state, { playerId: CASH1981, arenaUnitId: killed.id }))
    const ended = unwrap(endBattleAction(state, { playerId: CASH1981 }))
    expect(ended.endedBattle?.summary?.find((side) => side.kind === 'barbarians')?.side).toBe('defender')
    expect(me(ended, KARANDRAS1).stats).toEqual(me(base, KARANDRAS1).stats)
    expect(ended.endedBattle?.aztecs).toBeUndefined()
  })

  it('are put back as far as it is still there when it was spent, and the line says how much', () => {
    const state = kill(kill(aztecFight(), KARANDRAS1, 1, CASH1981), CASH1981, 2, KARANDRAS1)
    const ended = unwrap(endBattleAction(state, { playerId: CASH1981 }))
    expect(me(ended).stats).toMatchObject({ trade: 8, culture: 8 })
    // The Aztecs have spent 6 trade and 7 culture since
    const spent: GameState = {
      ...ended,
      players: ended.players.map((p) => (p.playerId === CASH1981 ? { ...p, stats: { ...p.stats, trade: 2, culture: 1 } } : p)),
    }
    const undone = unwrap(undoEndBattle(spent, { playerId: CASH1981 }))
    expect(me(undone).stats).toMatchObject({ trade: 0, culture: 0 })
    expect(lines(undone).at(-1)).toContain('takes back 2 of 3 (0) trade and 1 of 3 (0) culture the Aztecs gained')
    const partly: GameState = {
      ...ended,
      players: ended.players.map((p) => (p.playerId === CASH1981 ? { ...p, stats: { ...p.stats, trade: 4, culture: 2 } } : p)),
    }
    const some = unwrap(undoEndBattle(partly, { playerId: CASH1981 }))
    expect(me(some).stats).toMatchObject({ trade: 1, culture: 0 })
    expect(lines(some).at(-1)).toContain('takes back 3 (1) trade and 2 of 3 (0) culture the Aztecs gained')
  })

  it('are put back by undoing the end of the battle, and the log names no unit', () => {
    const state = kill(aztecFight(), CASH1981, 2, KARANDRAS1)
    const ended = unwrap(endBattleAction(state, { playerId: CASH1981 }))
    const undone = unwrap(undoEndBattle(ended, { playerId: CASH1981 }))
    expect(me(undone).stats).toMatchObject({ trade: 5, culture: 5 })
    expect(undone.battle).not.toBeNull()
    expect(lines(undone).at(-1)).toContain('takes back 3 (5) trade and 2 (5) culture the Aztecs gained')
    const unitName = unitsOf(state, KARANDRAS1)[0]?.unit.id ?? 'x'
    expect(lines(ended).filter((line) => line.includes('Aztecs')).every((line) => !line.includes(unitName))).toBe(true)
  })
})

describe('the Chinese after a battle', () => {
  const chineseFight = (): GameState => withCivilization(fight(), 'Chinese')

  it('save the killed unit that was chosen, not the first one, and it stays in the hand', () => {
    const state = kill(chineseFight(), KARANDRAS1, 2, CASH1981)
    const killed = unitsOf(state, CASH1981)
    const [first, second] = killed
    if (first === undefined || second === undefined) throw new Error('no units')
    const ended = unwrap(endBattleAction(state, { playerId: CASH1981, chineseSave: second.id }))
    const saved = ended.endedBattle?.battle.arena.filter((unit) => unit.saved === true) ?? []
    expect(saved.map((unit) => unit.id)).toEqual([second.id])
    expect(ended.endedBattle?.chineseSaved).toBe(second.id)
    expect(lines(ended)).toContain('cash1981 saves one killed unit as the Chinese: it stays in the hand')
    // Nothing discards a killed card: it is still in the hand, and the other killed unit is no different
    expect(me(ended).items.some((item) => item.id === second.unit.id)).toBe(true)
    expect(ended.discardedItems.some((item) => item.id === second.unit.id)).toBe(false)
    // The public view of the last battle carries the mark, with ids scrubbed
    const view = toPlayerView(ended, KARANDRAS1)
    expect(view.lastBattle?.arena.filter((unit) => unit.saved === true)).toHaveLength(1)
    expect(JSON.stringify(view.lastBattle)).not.toContain(second.unit.id)
  })

  it('save nothing without a choice, and say so', () => {
    const state = kill(chineseFight(), KARANDRAS1, 2, CASH1981)
    const ended = unwrap(endBattleAction(state, { playerId: CASH1981 }))
    expect(ended.endedBattle?.chineseSaved).toBeUndefined()
    expect(ended.endedBattle?.battle.arena.some((unit) => unit.saved === true)).toBe(false)
    expect(lines(ended)).toContain('cash1981 saves no unit as the Chinese')
  })

  it('can be chosen by the other side pressing End battle', () => {
    const state = kill(chineseFight(), KARANDRAS1, 1, CASH1981)
    const victim = unitsOf(state, CASH1981)[0]
    if (victim === undefined) throw new Error('no unit')
    const ended = unwrap(endBattleAction(state, { playerId: KARANDRAS1, chineseSave: victim.id }))
    expect(ended.endedBattle?.chineseSaved).toBe(victim.id)
  })

  it('refuse a choice that is not a killed, unsaved unit of the Chinese side', () => {
    const state = kill(kill(chineseFight(), KARANDRAS1, 1, CASH1981), CASH1981, 1, KARANDRAS1)
    const [killedChinese, aliveChinese] = unitsOf(state, CASH1981)
    const killedEnemy = unitsOf(state, KARANDRAS1)[0]
    if (killedChinese === undefined || aliveChinese === undefined || killedEnemy === undefined) throw new Error('no units')
    for (const arenaUnitId of ['no-such-unit', aliveChinese.id, killedEnemy.id]) {
      const refused = endBattleAction(state, { playerId: CASH1981, chineseSave: arenaUnitId })
      expect(refused.ok).toBe(false)
      if (!refused.ok) expect(refused.error).toEqual({ kind: 'CHINESE_SAVE_INVALID', arenaUnitId })
    }
    // A unit another card (Florence Nightingale) already saved cannot be chosen again
    const marked: GameState = {
      ...state,
      battle: state.battle === null ? null : { ...state.battle, arena: state.battle.arena.map((unit) => (unit.id === killedChinese.id ? { ...unit, saved: true } : unit)) },
    }
    expect(endBattleAction(marked, { playerId: CASH1981, chineseSave: killedChinese.id }).ok).toBe(false)
    // The battle is untouched by a refusal, and a valid choice still works
    expect(state.battle).not.toBeNull()
    expect(endBattleAction(state, { playerId: CASH1981, chineseSave: killedChinese.id }).ok).toBe(true)
  })

  it('refuse a choice in a battle with no Chinese side', () => {
    const state = kill(fight(), KARANDRAS1, 1, CASH1981)
    const victim = unitsOf(state, CASH1981)[0]
    if (victim === undefined) throw new Error('no unit')
    expect(endBattleAction(state, { playerId: CASH1981, chineseSave: victim.id }).ok).toBe(false)
  })

  it('save nothing when no Chinese unit was killed', () => {
    const none = unwrap(endBattleAction(kill(chineseFight(), CASH1981, 2, KARANDRAS1), { playerId: CASH1981 }))
    expect(none.endedBattle?.chineseSaved).toBeUndefined()
    expect(none.endedBattle?.battle.arena.some((unit) => unit.saved === true)).toBe(false)
  })

  it('is taken back by undoing the end of the battle: the unit is killed and unsaved again', () => {
    const state = kill(chineseFight(), KARANDRAS1, 1, CASH1981)
    const victim = unitsOf(state, CASH1981)[0]
    if (victim === undefined) throw new Error('no unit')
    const ended = unwrap(endBattleAction(state, { playerId: CASH1981, chineseSave: victim.id }))
    const undone = unwrap(undoEndBattle(ended, { playerId: CASH1981 }))
    expect(undone.battle?.arena.some((unit) => unit.saved === true)).toBe(false)
    expect(undone.battle?.arena.filter((unit) => unit.killed)).toHaveLength(1)
    expect(lines(undone).at(-1)).toContain('the saved Chinese unit is killed again')
    expect(undone.endedBattle).toBeNull()
  })
})

describe('the Chinese and Florence Nightingale on the same battle', () => {
  it('save the chosen unit when Nightingale has already saved another, and the undo leaves her mark', () => {
    let state = kill(withCivilization(fight(), 'Chinese'), KARANDRAS1, 2, CASH1981)
    const [first, second] = unitsOf(state, CASH1981)
    if (first === undefined || second === undefined) throw new Error('no units')
    // Nightingale's mark, as the battle card writes it
    state = {
      ...state,
      battle: state.battle === null ? null : { ...state.battle, arena: state.battle.arena.map((unit) => (unit.id === first.id ? { ...unit, saved: true } : unit)) },
    }
    const ended = unwrap(endBattleAction(state, { playerId: CASH1981, chineseSave: second.id }))
    expect(ended.endedBattle?.chineseSaved).toBe(second.id)
    expect(ended.endedBattle?.battle.arena.filter((unit) => unit.saved === true).map((unit) => unit.id).sort()).toEqual([first.id, second.id].sort())
    const undone = unwrap(undoEndBattle(ended, { playerId: CASH1981 }))
    expect(undone.battle?.arena.filter((unit) => unit.saved === true).map((unit) => unit.id)).toEqual([first.id])
  })
})
