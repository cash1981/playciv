/**
 * What happens when a battle ends: the killed units are discarded, the Aztecs gain trade and culture, the Chinese may save a
 * killed unit.
 */

import { describe, expect, it } from 'vitest'

import { chineseSaveAction, endBattleAction, initiateBattle, killArenaUnit, placeUnitInArena, undoEndBattle } from '../src/actions/arena.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { draw, drawUnitsForBattle, reshuffleItems } from '../src/actions/draw.js'
import { discardItem } from '../src/actions/player.js'
import { unitCardAvailable } from '../src/build-options.js'
import { itemName } from '../src/item.js'
import { describeError } from '../src/errors.js'
import { unwrap } from '../src/result.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { GameState } from '../src/state.js'

import { withCivilization, withStats } from './culture-advance-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

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

describe('End battle discards the killed units', () => {
  it("puts every killed unit's card of both players on the discard pile with a public line, and leaves the living ones", () => {
    const state = kill(kill(fight(), KARANDRAS1, 1, CASH1981), CASH1981, 2, KARANDRAS1)
    const [dead, alive] = unitsOf(state, CASH1981)
    if (dead === undefined || alive === undefined) throw new Error('no units')
    const ended = unwrap(endBattleAction(state, { playerId: KARANDRAS1 }))
    const deadCards = [dead, ...unitsOf(state, KARANDRAS1)].map((unit) => unit.unit.id)
    for (const id of deadCards) {
      expect(ended.discardedItems.some((item) => item.id === id)).toBe(true)
      expect([...me(ended).items, ...me(ended, KARANDRAS1).items, ...me(ended).battlehand].some((item) => item.id === id)).toBe(false)
    }
    expect(me(ended).items.find((item) => item.id === alive.unit.id)).toMatchObject({ inBattle: false })
    const discards = ended.log.filter((entry) => entry.logType === 'DISCARD')
    expect(discards.map((entry) => entry.item?.id).sort()).toEqual([...deadCards].sort())
    expect(discards.find((entry) => entry.item?.id === dead.unit.id)?.publicLog).toMatch(/^cash1981 has discarded /)
    expect(ended.endedBattle?.killedDiscarded).toHaveLength(3)
  })

  it('keeps a unit Florence Nightingale saved during the battle in the hand', () => {
    const killed = kill(fight(), KARANDRAS1, 1, CASH1981)
    const state: GameState = {
      ...killed,
      battle: killed.battle === null ? null : { ...killed.battle, arena: killed.battle.arena.map((unit) => (unit.killed ? { ...unit, saved: true } : unit)) },
    }
    const victim = unitsOf(state, CASH1981)[0]
    const ended = unwrap(endBattleAction(state, { playerId: CASH1981 }))
    expect(me(ended).items.some((item) => item.id === victim?.unit.id)).toBe(true)
    expect(ended.endedBattle?.killedDiscarded).toBeUndefined()
  })

  it('gives the cards back to the hand, locked in the battle, when End battle is undone, and their discard lines can no longer be undone by vote', () => {
    const state = kill(fight(), KARANDRAS1, 2, CASH1981)
    const ended = unwrap(endBattleAction(state, { playerId: CASH1981 }))
    const undone = unwrap(undoEndBattle(ended, { playerId: CASH1981 }))
    for (const unit of unitsOf(state, CASH1981)) {
      expect(me(undone).items.find((item) => item.id === unit.unit.id)).toMatchObject({ inBattle: true })
      expect(undone.discardedItems.some((item) => item.id === unit.unit.id)).toBe(false)
    }
    const discards = undone.log.filter((entry) => entry.logType === 'DISCARD')
    expect(discards).toHaveLength(2)
    expect(discards.every((entry) => entry.superseded === true)).toBe(true)
    expect(lines(undone).at(-1)).toContain('and the 2 killed units go back to the hand')
  })
})

describe('the Chinese after a battle', () => {
  const chineseFight = (): GameState => withCivilization(fight(), 'Chinese')
  const save = (state: GameState, arenaUnitId: string, playerId = CASH1981) => chineseSaveAction(state, { playerId, arenaUnitId })

  it('are offered nothing while the battle is on, and the battle ends for either player', () => {
    const state = kill(chineseFight(), KARANDRAS1, 2, CASH1981)
    expect(toPlayerView(state, CASH1981).you?.chineseSave).toBeNull()
    const victim = unitsOf(state, CASH1981)[0]
    if (victim === undefined) throw new Error('no unit')
    const refused = save(state, victim.id)
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error).toEqual({ kind: 'CHINESE_SAVE_UNAVAILABLE' })
    // The opponent may end the battle: nothing waits for the Chinese, and the end says nothing about them
    const ended = unwrap(endBattleAction(state, { playerId: KARANDRAS1 }))
    expect(lines(ended).some((line) => line.includes('Chinese'))).toBe(false)
  })

  it('save the chosen killed unit after the battle: its card leaves the discard pile for the hand', () => {
    const state = kill(chineseFight(), KARANDRAS1, 2, CASH1981)
    const [first, second] = unitsOf(state, CASH1981)
    if (first === undefined || second === undefined) throw new Error('no units')
    const ended = unwrap(endBattleAction(state, { playerId: KARANDRAS1 }))
    expect(toPlayerView(ended, CASH1981).you?.chineseSave?.units.map((unit) => unit.arenaUnitId)).toEqual([first.id, second.id])

    const saved = unwrap(save(ended, second.id))
    expect(me(saved).items.find((item) => item.id === second.unit.id)).toMatchObject({ inBattle: false, hidden: true })
    expect(saved.discardedItems.some((item) => item.id === second.unit.id)).toBe(false)
    expect(saved.discardedItems.some((item) => item.id === first.unit.id)).toBe(true)
    expect(saved.endedBattle?.chineseSaved).toBe(second.id)
    expect(saved.endedBattle?.battle.arena.filter((unit) => unit.saved === true).map((unit) => unit.id)).toEqual([second.id])
    expect(lines(saved).at(-1)).toMatch(/^cash1981 saves the killed .+ as the Chinese: it goes back to the hand$/)
    // Its discard line is spent: a vote cannot put the card back a second time
    expect(saved.log.find((entry) => entry.logType === 'DISCARD' && entry.item?.id === second.unit.id)?.superseded).toBe(true)
    // The public view of the last battle carries the mark, with ids scrubbed
    const view = toPlayerView(saved, KARANDRAS1)
    expect(view.lastBattle?.arena.filter((unit) => unit.saved === true)).toHaveLength(1)
    expect(JSON.stringify(view.lastBattle)).not.toContain(second.unit.id)
  })

  it('save one unit per battle', () => {
    const state = kill(chineseFight(), KARANDRAS1, 2, CASH1981)
    const [first, second] = unitsOf(state, CASH1981)
    if (first === undefined || second === undefined) throw new Error('no units')
    const saved = unwrap(save(unwrap(endBattleAction(state, { playerId: CASH1981 })), first.id))
    expect(toPlayerView(saved, CASH1981).you?.chineseSave).toBeNull()
    const again = save(saved, second.id)
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.error).toEqual({ kind: 'CHINESE_SAVE_UNAVAILABLE' })
  })

  it('are the only ones offered it: the opponent sees nothing, and is refused', () => {
    const state = kill(chineseFight(), KARANDRAS1, 1, CASH1981)
    const victim = unitsOf(state, CASH1981)[0]
    if (victim === undefined) throw new Error('no unit')
    const ended = unwrap(endBattleAction(state, { playerId: CASH1981 }))
    for (const viewer of [KARANDRAS1, ITCHI]) {
      const view = toPlayerView(ended, viewer)
      expect(view.you?.chineseSave).toBeNull()
      expect(JSON.stringify(view)).not.toContain(victim.id)
    }
    const refused = save(ended, victim.id, KARANDRAS1)
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error).toEqual({ kind: 'CHINESE_SAVE_UNAVAILABLE' })
  })

  it('save when they defend, and after a battle against the barbarians ended by their controller', () => {
    const defending = kill(withCivilization(fight(), 'Chinese', KARANDRAS1), CASH1981, 1, KARANDRAS1)
    const victim = unitsOf(defending, KARANDRAS1)[0]
    if (victim === undefined) throw new Error('no unit')
    const ended = unwrap(endBattleAction(defending, { playerId: CASH1981 }))
    expect(unwrap(save(ended, victim.id, KARANDRAS1)).endedBattle?.chineseSaved).toBe(victim.id)

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
    const theirs = state.battle?.arena.find((unit) => unit.side === 'defender')
    if (mine === undefined || theirs === undefined) throw new Error('no units')
    state = unwrap(killArenaUnit(state, { playerId: KARANDRAS1, arenaUnitId: mine.id }))
    state = unwrap(killArenaUnit(state, { playerId: CASH1981, arenaUnitId: theirs.id }))
    const byController = unwrap(endBattleAction(state, { playerId: KARANDRAS1 }))
    // A killed barbarian stays with its controller, for Discard barbarians
    expect(me(byController, KARANDRAS1).barbarians.some((unit) => unit.id === barbarian.id)).toBe(true)
    expect(me(unwrap(save(byController, mine.id))).items.some((item) => item.id === own.id)).toBe(true)
  })

  it('refuse a unit that is not one of their killed units still on the pile', () => {
    const state = kill(kill(chineseFight(), KARANDRAS1, 1, CASH1981), CASH1981, 1, KARANDRAS1)
    const [killedChinese, aliveChinese] = unitsOf(state, CASH1981)
    const killedEnemy = unitsOf(state, KARANDRAS1)[0]
    if (killedChinese === undefined || aliveChinese === undefined || killedEnemy === undefined) throw new Error('no units')
    const ended = unwrap(endBattleAction(state, { playerId: CASH1981 }))
    for (const arenaUnitId of ['no-such-unit', aliveChinese.id, killedEnemy.id]) {
      const refused = save(ended, arenaUnitId)
      expect(refused.ok).toBe(false)
      if (!refused.ok) {
        expect(refused.error).toEqual({ kind: 'CHINESE_SAVE_INVALID', arenaUnitId })
        expect(describeError(refused.error)).toContain('still on the discard pile')
      }
    }
    // A card that has left the pile since (a vote put it back in the hand) is no choice any more
    const line = ended.log.find((entry) => entry.logType === 'DISCARD' && entry.item?.id === killedChinese.unit.id)
    if (line === undefined) throw new Error('no discard line')
    let voted = unwrap(initiateUndo(ended, { logId: line.id, playerId: CASH1981 }))
    for (const playerId of [KARANDRAS1, ITCHI, CHUL]) voted = unwrap(vote(voted, { logId: line.id, playerId, vote: true }))
    expect(toPlayerView(voted, CASH1981).you?.chineseSave).toBeNull()
    expect(save(voted, killedChinese.id).ok).toBe(false)
  })

  it('cannot save in a battle with no Chinese side, nor once the next battle has started', () => {
    const plain = kill(fight(), KARANDRAS1, 1, CASH1981)
    const victim = unitsOf(plain, CASH1981)[0]
    if (victim === undefined) throw new Error('no unit')
    expect(save(unwrap(endBattleAction(plain, { playerId: CASH1981 })), victim.id).ok).toBe(false)

    const ended = unwrap(endBattleAction(kill(chineseFight(), KARANDRAS1, 1, CASH1981), { playerId: CASH1981 }))
    const next = unwrap(initiateBattle(ended, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))
    expect(toPlayerView(next, CASH1981).you?.chineseSave).toBeNull()
    expect(save(next, victim.id).ok).toBe(false)
  })

  it('is taken back by undoing the end of the battle: the unit is killed and unsaved again, its card locked in the hand', () => {
    const state = kill(chineseFight(), KARANDRAS1, 1, CASH1981)
    const victim = unitsOf(state, CASH1981)[0]
    if (victim === undefined) throw new Error('no unit')
    const saved = unwrap(save(unwrap(endBattleAction(state, { playerId: CASH1981 })), victim.id))
    const undone = unwrap(undoEndBattle(saved, { playerId: CASH1981 }))
    expect(undone.battle?.arena.some((unit) => unit.saved === true)).toBe(false)
    expect(undone.battle?.arena.filter((unit) => unit.killed)).toHaveLength(1)
    expect(me(undone).items.find((item) => item.id === victim.unit.id)).toMatchObject({ inBattle: true })
    expect(lines(undone).at(-1)).toContain('the saved Chinese unit is killed again')
    expect(undone.endedBattle).toBeNull()
  })
})

describe('the Chinese and Florence Nightingale on the same battle', () => {
  it('offer only the killed units Nightingale did not save, and the undo leaves her mark', () => {
    let state = kill(withCivilization(fight(), 'Chinese'), KARANDRAS1, 2, CASH1981)
    const [first, second] = unitsOf(state, CASH1981)
    if (first === undefined || second === undefined) throw new Error('no units')
    // Nightingale's mark, as the battle card writes it
    state = {
      ...state,
      battle: state.battle === null ? null : { ...state.battle, arena: state.battle.arena.map((unit) => (unit.id === first.id ? { ...unit, saved: true } : unit)) },
    }
    const ended = unwrap(endBattleAction(state, { playerId: CASH1981 }))
    expect(toPlayerView(ended, CASH1981).you?.chineseSave?.units.map((unit) => unit.arenaUnitId)).toEqual([second.id])
    const saved = unwrap(chineseSaveAction(ended, { playerId: CASH1981, arenaUnitId: second.id }))
    expect(saved.endedBattle?.battle.arena.filter((unit) => unit.saved === true).map((unit) => unit.id).sort()).toEqual([first.id, second.id].sort())
    const undone = unwrap(undoEndBattle(saved, { playerId: CASH1981 }))
    expect(undone.battle?.arena.filter((unit) => unit.saved === true).map((unit) => unit.id)).toEqual([first.id])
  })
})

describe('killed units and the hand', () => {
  it('puts a killed card the player discarded by hand before End battle on the pile once, and leaves no snapshot', () => {
    const state = kill(fight(), KARANDRAS1, 2, CASH1981)
    const [first, second] = unitsOf(state, CASH1981)
    if (first === undefined || second === undefined) throw new Error('no units')
    const discarded = unwrap(discardItem(state, { playerId: CASH1981, sheetName: 'INFANTRY', itemNumber: first.unit.itemNumber, name: itemName(first.unit) }))
    // Whichever copy the hand picked, exactly one of the two killed cards is gone from the hand already
    const gone = [first, second].filter((unit) => !me(discarded).items.some((item) => item.id === unit.unit.id))
    expect(gone).toHaveLength(1)
    expect(me(discarded).battlehand.some((item) => item.id === gone[0]?.unit.id)).toBe(true)
    const ended = unwrap(endBattleAction(discarded, { playerId: CASH1981 }))
    for (const unit of [first, second]) {
      expect(ended.discardedItems.filter((item) => item.id === unit.unit.id)).toHaveLength(1)
      expect(me(ended).battlehand.some((item) => item.id === unit.unit.id)).toBe(false)
    }
    expect(ended.endedBattle?.killedDiscarded).toHaveLength(1)
    const undone = unwrap(undoEndBattle(ended, { playerId: CASH1981 }))
    expect(undone.discardedItems.filter((item) => item.id === gone[0]?.unit.id)).toHaveLength(1)
  })

  it('keeps the casualties the Chinese may still save out of a reshuffle of the discard pile', () => {
    const state = kill(kill(withCivilization(fight(), 'Chinese'), KARANDRAS1, 2, CASH1981), CASH1981, 1, KARANDRAS1)
    const ended = unwrap(endBattleAction(state, { playerId: KARANDRAS1 }))
    const ids = (ended.endedBattle?.killedDiscarded ?? []).map((record) => record.cardId)
    expect(ids).toHaveLength(3)
    const theirs = unitsOf(state, KARANDRAS1)[0]?.unit.id
    // The opponent's casualty is the only card a reshuffle may take
    const shuffled = unwrap(reshuffleItems(ended, 'INFANTRY'))
    for (const id of ids.filter((candidate) => candidate !== theirs)) {
      expect(shuffled.discardedItems.some((item) => item.id === id)).toBe(true)
      expect(shuffled.items.some((item) => item.id === id)).toBe(false)
    }
    expect(shuffled.items.some((item) => item.id === theirs)).toBe(true)
    expect(toPlayerView(shuffled, CASH1981).you?.chineseSave?.units).toHaveLength(2)
    // Once the choice is made, the rest of the pile is free again
    const victim = unitsOf(state, CASH1981)[0]
    if (victim === undefined) throw new Error('no unit')
    const saved = unwrap(chineseSaveAction(shuffled, { playerId: CASH1981, arenaUnitId: victim.id }))
    const after = unwrap(reshuffleItems(saved, 'INFANTRY'))
    expect(after.discardedItems.some((item) => item.id === unitsOf(state, CASH1981)[1]?.unit.id)).toBe(false)
  })

  it('does not offer a unit card to build while only the Chinese casualties pending a save are on the pile', () => {
    const state = kill(withCivilization(fight(), 'Chinese'), KARANDRAS1, 2, CASH1981)
    const ended = unwrap(endBattleAction(state, { playerId: KARANDRAS1 }))
    const pending = new Set((ended.endedBattle?.killedDiscarded ?? []).map((record) => record.cardId))
    expect(pending.size).toBeGreaterThan(0)
    // An exhausted deck: the pile holds the pending casualties and nothing else of the type
    const exhausted: GameState = {
      ...ended,
      items: ended.items.filter((item) => item.sheetName !== 'INFANTRY'),
      discardedItems: ended.discardedItems.filter((item) => item.sheetName !== 'INFANTRY' || pending.has(item.id)),
    }
    expect(unitCardAvailable(exhausted, 'INFANTRY')).toBe(false)
    const saved = unwrap(chineseSaveAction(exhausted, { playerId: CASH1981, arenaUnitId: unitsOf(state, CASH1981)[0]?.id ?? '' }))
    // The choice is made: the other casualty is free for the next reshuffle again
    expect(unitCardAvailable(saved, 'INFANTRY')).toBe(true)
  })
})
