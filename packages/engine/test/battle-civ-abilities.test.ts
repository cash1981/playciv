/**
 * Civilization abilities that act when a battle ends: the Aztecs' trade and culture, the Chinese saving a killed unit.
 */

import { describe, expect, it } from 'vitest'

import { endBattleAction, initiateBattle, killArenaUnit, placeUnitInArena, undoEndBattle } from '../src/actions/arena.js'
import { draw, drawUnitsForBattle } from '../src/actions/draw.js'
import { describeError } from '../src/errors.js'
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

  /** What the Aztecs (Cash by default) hold after spending: the totals are replaced, nothing else is touched. */
  const spentTo = (ended: GameState, trade: number, culture: number, playerId = CASH1981): GameState =>
    withStats(ended, { trade, culture }, playerId)

  it('refuse the undo of the end of the battle when the trade or the culture they gained is spent, and change nothing', () => {
    const state = kill(kill(aztecFight(), KARANDRAS1, 1, CASH1981), CASH1981, 2, KARANDRAS1)
    const ended = unwrap(endBattleAction(state, { playerId: CASH1981 }))
    expect(me(ended).stats).toMatchObject({ trade: 8, culture: 8 })
    // 3 trade and 3 culture were gained: a total below either means part of it was spent
    for (const [trade, culture] of [[2, 8], [8, 2], [0, 0], [2, 1]] as const) {
      const spent = spentTo(ended, trade, culture)
      const before = structuredClone(spent)
      const refused = undoEndBattle(spent, { playerId: CASH1981 })
      expect(refused.ok).toBe(false)
      if (!refused.ok) {
        expect(refused.error).toEqual({ kind: 'END_BATTLE_UNDO_AZTEC_SPENT' })
        expect(describeError(refused.error)).toContain('has been spent')
      }
      // The state the caller passed in is untouched: the battle stays ended, with its totals and log
      expect(spent).toEqual(before)
    }
  })

  it('check only what was gained: culture alone when only culture came, trade alone when only trade came', () => {
    // Only culture: the Aztecs lose and 2 units are killed
    const lost = unwrap(endBattleAction(kill(aztecFight(), CASH1981, 2, CASH1981), { playerId: KARANDRAS1 }))
    expect(lost.endedBattle?.aztecs).toEqual({ playerId: CASH1981, trade: 0, culture: 2 })
    expect(undoEndBattle(spentTo(lost, 5, 1), { playerId: KARANDRAS1 }).ok).toBe(false)
    // No trade was gained, so having none left does not block the undo
    const noTrade = unwrap(undoEndBattle(spentTo(lost, 0, 7), { playerId: KARANDRAS1 }))
    expect(me(noTrade).stats).toMatchObject({ trade: 0, culture: 5 })

    // Only trade: the Aztecs defend, nobody is killed, and a draw goes to the defender
    const won = unwrap(endBattleAction(withCivilization(fight(), 'Aztecs', KARANDRAS1), { playerId: KARANDRAS1 }))
    expect(won.endedBattle?.aztecs).toEqual({ playerId: KARANDRAS1, trade: 3, culture: 0 })
    const traded = me(won, KARANDRAS1).stats
    expect(undoEndBattle(spentTo(won, traded.trade - 1, traded.culture, KARANDRAS1), { playerId: KARANDRAS1 }).ok).toBe(false)
    const noCulture = unwrap(undoEndBattle(spentTo(won, traded.trade, 0, KARANDRAS1), { playerId: KARANDRAS1 }))
    expect(me(noCulture, KARANDRAS1).stats).toMatchObject({ trade: traded.trade - 3, culture: 0 })
  })

  it('take back all of it, and the amounts and new totals are in the log, when it is still there', () => {
    const state = kill(kill(aztecFight(), KARANDRAS1, 1, CASH1981), CASH1981, 2, KARANDRAS1)
    const ended = unwrap(endBattleAction(state, { playerId: CASH1981 }))
    // More than was gained is held (they earned some more since): exactly the gain goes back
    const richer = spentTo(ended, 11, 9)
    const undone = unwrap(undoEndBattle(richer, { playerId: CASH1981 }))
    expect(me(undone).stats).toMatchObject({ trade: 8, culture: 6 })
    expect(lines(undone).at(-1)).toContain('takes back 3 (8) trade and 3 (6) culture the Aztecs gained')
    // Exactly the gain held is enough
    const exact = unwrap(undoEndBattle(spentTo(ended, 3, 3), { playerId: CASH1981 }))
    expect(me(exact).stats).toMatchObject({ trade: 0, culture: 0 })
    expect(lines(exact).at(-1)).toContain('takes back 3 (0) trade and 3 (0) culture the Aztecs gained')
  })

  it('cannot farm the reward: spend it and the undo is refused, so the battle never comes back to be won again', () => {
    // Start with nothing, win with 3 units killed: 3 trade and 3 culture, all of it spent at once
    const state = kill(kill(withStats(aztecFight(), { trade: 0, culture: 0 }), KARANDRAS1, 1, CASH1981), CASH1981, 2, KARANDRAS1)
    const ended = unwrap(endBattleAction(state, { playerId: CASH1981 }))
    expect(me(ended).stats).toMatchObject({ trade: 3, culture: 3 })
    const spent = spentTo(ended, 0, 0)
    const refused = undoEndBattle(spent, { playerId: CASH1981 })
    expect(refused.ok).toBe(false)
    // Nothing reopens the battle, and pressing End battle again finds none: no second reward
    expect(spent.battle).toBeNull()
    const again = unwrap(endBattleAction(spent, { playerId: CASH1981 }))
    expect(me(again).stats).toMatchObject({ trade: 0, culture: 0 })
    expect(lines(again).filter((line) => line.includes('as the Aztecs'))).toHaveLength(1)
    // With the whole gain still there the undo takes it back first, so a second end pays once and not twice
    const undone = unwrap(undoEndBattle(ended, { playerId: CASH1981 }))
    expect(me(undone).stats).toMatchObject({ trade: 0, culture: 0 })
    const endedTwice = unwrap(endBattleAction(undone, { playerId: CASH1981 }))
    expect(me(endedTwice).stats).toMatchObject({ trade: 3, culture: 3 })
  })

  it('gain only the trade that fits under the ceiling, say so, and take back exactly that', () => {
    // 25 of 27: 3 trade for winning leaves room for 2
    const state = kill(withStats(aztecFight(), { trade: 25 }), CASH1981, 2, KARANDRAS1)
    const ended = unwrap(endBattleAction(state, { playerId: CASH1981 }))
    expect(me(ended).stats.trade).toBe(27)
    expect(ended.endedBattle?.aztecs).toEqual({ playerId: CASH1981, trade: 2, culture: 2 })
    expect(lines(ended)).toContain('cash1981 gains 2 (27) trade for winning and 2 (7) culture for the units killed as the Aztecs')
    const undone = unwrap(undoEndBattle(ended, { playerId: CASH1981 }))
    expect(me(undone).stats).toMatchObject({ trade: 25, culture: 5 })
    expect(lines(undone).at(-1)).toContain('takes back 2 (25) trade and 2 (5) culture the Aztecs gained')
  })

  it('gain one trade when one fits, and keep the culture when the room is none', () => {
    const one = unwrap(endBattleAction(kill(withStats(aztecFight(), { trade: 26 }), CASH1981, 2, KARANDRAS1), { playerId: CASH1981 }))
    expect(me(one).stats.trade).toBe(27)
    expect(lines(one)).toContain('cash1981 gains 1 (27) trade for winning and 2 (7) culture for the units killed as the Aztecs')
    expect(one.endedBattle?.aztecs).toEqual({ playerId: CASH1981, trade: 1, culture: 2 })

    const full = unwrap(endBattleAction(kill(withStats(aztecFight(), { trade: 27 }), CASH1981, 2, KARANDRAS1), { playerId: CASH1981 }))
    expect(me(full).stats).toMatchObject({ trade: 27, culture: 7 })
    expect(lines(full)).toContain('cash1981 gains 2 (7) culture for the units killed as the Aztecs')
    expect(lines(full).some((line) => line.includes('trade for winning'))).toBe(false)
    expect(full.endedBattle?.aztecs).toEqual({ playerId: CASH1981, trade: 0, culture: 2 })
    // The undo takes back the culture only, and leaves the trade at the ceiling
    const undone = unwrap(undoEndBattle(full, { playerId: CASH1981 }))
    expect(me(undone).stats).toMatchObject({ trade: 27, culture: 5 })
    expect(lines(undone).at(-1)).toContain('takes back 2 (5) culture the Aztecs gained')
    expect(lines(undone).at(-1)).not.toContain('trade')
  })

  it('gain nothing, and record nothing, when they win at the ceiling with no unit killed', () => {
    // The defender wins a draw: Karandras1 is the Aztec player here, at the ceiling
    const state = withStats(withCivilization(fight(), 'Aztecs', KARANDRAS1), { trade: 27 }, KARANDRAS1)
    const ended = unwrap(endBattleAction(state, { playerId: KARANDRAS1 }))
    expect(me(ended, KARANDRAS1).stats.trade).toBe(27)
    expect(ended.endedBattle?.aztecs).toBeUndefined()
    expect(lines(ended).some((line) => line.includes('as the Aztecs'))).toBe(false)
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

  it('are the only ones who choose: the opponent may not end the battle while a killed unit could be saved', () => {
    const state = kill(chineseFight(), KARANDRAS1, 1, CASH1981)
    const victim = unitsOf(state, CASH1981)[0]
    if (victim === undefined) throw new Error('no unit')
    // Neither with their choice nor without one, and the battle is left as it was
    for (const input of [{ playerId: KARANDRAS1 }, { playerId: KARANDRAS1, chineseSave: victim.id }]) {
      const refused = endBattleAction(state, input)
      expect(refused.ok).toBe(false)
      if (!refused.ok) {
        expect(refused.error).toEqual({ kind: 'CHINESE_SAVE_PENDING' })
        expect(describeError(refused.error)).toContain('the Chinese player chooses')
      }
    }
    expect(state.battle).not.toBeNull()
    expect(state.endedBattle).toBeNull()
    // The Chinese player ends it and chooses
    const ended = unwrap(endBattleAction(state, { playerId: CASH1981, chineseSave: victim.id }))
    expect(ended.endedBattle?.chineseSaved).toBe(victim.id)
  })

  it('are the only ones who choose when they defend, too', () => {
    // karandras1 defends as the Chinese; cash1981 attacks and kills one of their units
    const state = kill(withCivilization(fight(), 'Chinese', KARANDRAS1), CASH1981, 1, KARANDRAS1)
    const victim = unitsOf(state, KARANDRAS1)[0]
    if (victim === undefined) throw new Error('no unit')
    const refused = endBattleAction(state, { playerId: CASH1981 })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error.kind).toBe('CHINESE_SAVE_PENDING')
    const ended = unwrap(endBattleAction(state, { playerId: KARANDRAS1, chineseSave: victim.id }))
    expect(ended.endedBattle?.chineseSaved).toBe(victim.id)
  })

  it('leave the end of the battle to either player when no killed unit could be saved', () => {
    // Nothing of the Chinese was killed
    const none = kill(chineseFight(), CASH1981, 2, KARANDRAS1)
    expect(endBattleAction(none, { playerId: KARANDRAS1 }).ok).toBe(true)
    // Their only killed unit was already saved by another card
    const killed = kill(chineseFight(), KARANDRAS1, 1, CASH1981)
    const saved: GameState = {
      ...killed,
      battle: killed.battle === null ? null : { ...killed.battle, arena: killed.battle.arena.map((unit) => (unit.killed ? { ...unit, saved: true } : unit)) },
    }
    expect(endBattleAction(saved, { playerId: KARANDRAS1 }).ok).toBe(true)
  })

  it('are not ended for by the player who controls the barbarians they fight', () => {
    // karandras1 controls the barbarians cash1981 (the Chinese) fights
    let base = withCivilization(firstCivGame(), 'Chinese')
    base = unwrap(draw(base, { playerId: CASH1981, sheetName: 'INFANTRY', confirmedOutOfTurn: true }))
    base = unwrap(drawUnitsForBattle(base, { playerId: CASH1981, numberOfDraws: 1 }))
    let state = unwrap(initiateBattle(base, { initiatorId: CASH1981, opponentId: 'barbarians' }))
    const own = me(state).battlehand[0]
    const barbarian = me(state, KARANDRAS1).barbarians[0]
    if (own === undefined || barbarian === undefined) throw new Error('no units')
    state = unwrap(placeUnitInArena(state, { playerId: CASH1981, unitId: own.id, side: 'attacker', position: 0, attack: 1, health: 3 }))
    state = unwrap(placeUnitInArena(state, { playerId: KARANDRAS1, unitId: barbarian.id, side: 'defender', position: 0, attack: 1, health: 3 }))
    const mine = state.battle?.arena.find((unit) => unit.side === 'attacker')
    if (mine === undefined) throw new Error('no attacker')
    state = unwrap(killArenaUnit(state, { playerId: CASH1981, arenaUnitId: mine.id }))
    const refused = endBattleAction(state, { playerId: KARANDRAS1 })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error.kind).toBe('CHINESE_SAVE_PENDING')
    expect(endBattleAction(state, { playerId: CASH1981, chineseSave: mine.id }).ok).toBe(true)
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

  it('save nothing when no Chinese unit was killed, and say nothing about it', () => {
    const none = unwrap(endBattleAction(kill(chineseFight(), CASH1981, 2, KARANDRAS1), { playerId: CASH1981 }))
    expect(none.endedBattle?.chineseSaved).toBeUndefined()
    expect(none.endedBattle?.battle.arena.some((unit) => unit.saved === true)).toBe(false)
    // No candidate, no choice: the "saves no unit" line is for a choice that was open and left empty
    expect(lines(none).some((line) => line.includes('as the Chinese'))).toBe(false)
  })

  it('say nothing about saving either when every killed Chinese unit was already saved by another card', () => {
    const killed = kill(chineseFight(), KARANDRAS1, 1, CASH1981)
    const saved: GameState = {
      ...killed,
      battle: killed.battle === null ? null : { ...killed.battle, arena: killed.battle.arena.map((unit) => (unit.killed ? { ...unit, saved: true } : unit)) },
    }
    const ended = unwrap(endBattleAction(saved, { playerId: CASH1981 }))
    expect(lines(ended).some((line) => line.includes('as the Chinese'))).toBe(false)
  })

  /** The card of an arena unit leaves the player's hand before the battle ends (discarded, or removed some other way). */
  const withoutCard = (state: GameState, arenaUnitId: string, playerId = CASH1981): GameState => {
    const cardId = [...(state.battle?.arena ?? []), ...(state.battle?.departedUnits ?? [])].find((unit) => unit.id === arenaUnitId)?.unit.id
    if (cardId === undefined) throw new Error('no such arena unit')
    const player = me(state, playerId)
    const card = player.items.find((item) => item.id === cardId)
    if (card === undefined) throw new Error('card not in hand')
    return {
      ...state,
      players: state.players.map((p) => (p.playerId === playerId ? { ...p, items: p.items.filter((item) => item.id !== cardId) } : p)),
      discardedItems: [...state.discardedItems, { ...card, hidden: true }],
    }
  }

  it('cannot save a killed unit whose card has left the hand, and the choice is refused with its id', () => {
    const killed = kill(chineseFight(), KARANDRAS1, 2, CASH1981)
    const [gone, kept] = unitsOf(killed, CASH1981)
    if (gone === undefined || kept === undefined) throw new Error('no units')
    const state = withoutCard(killed, gone.id)
    const refused = endBattleAction(state, { playerId: CASH1981, chineseSave: gone.id })
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.error).toEqual({ kind: 'CHINESE_SAVE_INVALID', arenaUnitId: gone.id })
      expect(describeError(refused.error)).toContain('whose card is still in the hand')
    }
    // The battle is untouched by the refusal, and the unit whose card is still there can be saved
    expect(state.battle).not.toBeNull()
    const ended = unwrap(endBattleAction(state, { playerId: CASH1981, chineseSave: kept.id }))
    expect(ended.endedBattle?.chineseSaved).toBe(kept.id)
    expect(ended.endedBattle?.battle.arena.filter((unit) => unit.saved === true).map((unit) => unit.id)).toEqual([kept.id])
    // The discarded card is still where it was put: saving did not bring it back
    expect(me(ended).items.some((item) => item.id === gone.unit.id)).toBe(false)
  })

  it('cannot save a departed killed unit whose card has left the hand either, but can while it is there', () => {
    const killed = kill(chineseFight(), KARANDRAS1, 1, CASH1981)
    const victim = unitsOf(killed, CASH1981).find((unit) => unit.killed)
    if (victim === undefined || killed.battle === null) throw new Error('no unit')
    // The unit was moved off its front by a reinforcement: it is among the departed units
    const departed: GameState = {
      ...killed,
      battle: { ...killed.battle, arena: killed.battle.arena.filter((unit) => unit.id !== victim.id), departedUnits: [...killed.battle.departedUnits, victim] },
    }
    expect(endBattleAction(departed, { playerId: CASH1981, chineseSave: victim.id }).ok).toBe(true)
    const refused = endBattleAction(withoutCard(departed, victim.id), { playerId: CASH1981, chineseSave: victim.id })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error).toEqual({ kind: 'CHINESE_SAVE_INVALID', arenaUnitId: victim.id })
  })

  it('is no candidate for the Chinese choice when its card has left the hand: the opponent may end, and no line says nothing was saved', () => {
    const killed = kill(chineseFight(), KARANDRAS1, 1, CASH1981)
    const victim = unitsOf(killed, CASH1981).find((unit) => unit.killed)
    if (victim === undefined) throw new Error('no unit')
    const state = withoutCard(killed, victim.id)
    // Nothing could be saved, so nobody waits for the Chinese player
    const byOpponent = unwrap(endBattleAction(state, { playerId: KARANDRAS1 }))
    expect(byOpponent.endedBattle?.chineseSaved).toBeUndefined()
    expect(lines(byOpponent).some((line) => line.includes('as the Chinese'))).toBe(false)
    // The Chinese player ending it with no choice does not get the "saves no unit" line either
    const byChinese = unwrap(endBattleAction(state, { playerId: CASH1981 }))
    expect(lines(byChinese).some((line) => line.includes('as the Chinese'))).toBe(false)
  })

  it('still wait for the Chinese player, and say that no unit was saved, while another killed unit has its card in the hand', () => {
    const killed = kill(chineseFight(), KARANDRAS1, 2, CASH1981)
    const [gone] = unitsOf(killed, CASH1981)
    if (gone === undefined) throw new Error('no unit')
    const state = withoutCard(killed, gone.id)
    const refused = endBattleAction(state, { playerId: KARANDRAS1 })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error).toEqual({ kind: 'CHINESE_SAVE_PENDING' })
    const ended = unwrap(endBattleAction(state, { playerId: CASH1981 }))
    expect(lines(ended)).toContain('cash1981 saves no unit as the Chinese')
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
