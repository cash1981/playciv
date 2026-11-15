/**
 * Animal Husbandry and Biology heal (issue #354): once per battle, free, on the player's own living arena units, up to the
 * health their cards have at their level.
 */

import { describe, expect, it } from 'vitest'

import { undoEndBattle } from '../src/actions/arena.js'
import { arenaUnitTier, healUnits, initiateBattle, killArenaUnit, placeUnitInArena, rotateArenaUnit, setArenaUnitStat } from '../src/actions/arena.js'
import { draw, drawUnitsForBattle } from '../src/actions/draw.js'
import { chooseTech, revealTech } from '../src/actions/player.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { assistedAvailability, performAssistedAction } from '../src/assisted.js'
import { healOwed } from '../src/battle-cards.js'
import { resourceAbilityOf } from '../src/assisted-core.js'
import { endBattleAction } from '../src/actions/arena.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { AssistedActionKind, GameState } from '../src/state.js'

import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-11-15T12:00:00.000Z'

const withTech = (state: GameState, techName: string, playerId = CASH1981, reveal = true): GameState => {
  const chosen = unwrap(chooseTech(state, { playerId, techName }))
  return reveal ? unwrap(revealTech(chosen, { playerId, techName })) : chosen
}

/** Cash (attacker) and Karandras (defender) each have two infantry in the arena; Cash's are at level III, so their cards have 3 health. */
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
  for (const unit of (state.battle?.arena ?? []).filter((candidate) => candidate.placedBy === CASH1981)) {
    for (let i = 0; i < 2; i++) state = unwrap(rotateArenaUnit(state, { playerId: CASH1981, arenaUnitId: unit.id }))
  }
  return state
}

const own = (state: GameState) => (state.battle?.arena ?? []).filter((unit) => unit.placedBy === CASH1981)
const enemy = (state: GameState) => (state.battle?.arena ?? []).filter((unit) => unit.placedBy === KARANDRAS1)
const healthOf = (state: GameState, id: string): number => state.battle?.arena.find((unit) => unit.id === id)?.health ?? -1

/** Lowers a unit's health by `lost` below what its card has at its level, by hand as the players would. */
const wound = (state: GameState, id: string, lost: number): GameState => {
  const unit = state.battle?.arena.find((candidate) => candidate.id === id)
  if (unit === undefined) throw new Error('no unit')
  return unwrap(setArenaUnitStat(state, { playerId: CASH1981, arenaUnitId: id, key: 'health', value: arenaUnitTier(unit).health - lost }))
}

const press = (state: GameState, action: AssistedActionKind, requestId = 'req-1', playerId = CASH1981) =>
  performAssistedAction(state, { playerId, action, requestId, at: AT })

const heal = (state: GameState, id: string, wounds: number, tech = 'Animal Husbandry', playerId = CASH1981) =>
  healUnits(state, { playerId, tech, arenaUnitId: id, wounds })

/** Asks for the undo of `requestId` and gathers every vote but the last; the last vote's result is what the test judges. */
const lastVote = (state: GameState, requestId: string) => {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of [KARANDRAS1, ITCHI]) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  return vote(next, { logId: entry.id, playerId: CHUL, vote: true, at: AT })
}

const undone = (state: GameState, requestId: string) => {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of [KARANDRAS1, ITCHI, CHUL]) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  return next
}

/** Both of Cash's units have lost 2 health. */
const hurt = (tech: string): GameState => {
  let state = withTech(fight(), tech)
  for (const unit of own(state)) state = wound(state, unit.id, 2)
  return state
}

describe('Animal Husbandry heal', () => {
  it('is unavailable outside a battle, without the tech revealed, to a bystander and with no wounded unit, each for its own reason', () => {
    const hurtWith = (tech: string, playerId = CASH1981, reveal = true): GameState => {
      let state = withTech(fight(), tech, playerId, reveal)
      for (const unit of own(state)) state = wound(state, unit.id, 2)
      return state
    }
    expect(assistedAvailability(withTech(firstCivGame(), 'Animal Husbandry'), CASH1981, 'animalHusbandryHeal')).toMatchObject({ status: 'wrong-phase' })
    expect(assistedAvailability(hurtWith('Animal Husbandry', CASH1981, false), CASH1981, 'animalHusbandryHeal')).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('Reveal Animal Husbandry') })
    expect(assistedAvailability(hurtWith('Biology', ITCHI), ITCHI, 'biologyHeal')).toMatchObject({ status: 'unavailable', reason: 'You are not fighting in this battle.' })
    expect(assistedAvailability(withTech(fight(), 'Animal Husbandry'), CASH1981, 'animalHusbandryHeal')).toMatchObject({ status: 'unavailable', reason: 'None of your units in the arena is wounded.' })
    let notOwned = fight()
    for (const unit of own(notOwned)) notOwned = wound(notOwned, unit.id, 2)
    expect(assistedAvailability(notOwned, CASH1981, 'animalHusbandryHeal')).toMatchObject({ status: 'not-owned' })
  })

  it('puts the heals in the opponent view, with nothing private in them', () => {
    const state = unwrap(press(hurt('Animal Husbandry'), 'animalHusbandryHeal'))
    const seen = toPlayerView(state, KARANDRAS1).battle?.heals
    expect(seen).toEqual([expect.objectContaining({ playerId: CASH1981, tech: 'Animal Husbandry', total: 3, healed: 0 })])
  })

  it('refuses healing for a player outside the battle', () => {
    const state = unwrap(press(hurt('Animal Husbandry'), 'animalHusbandryHeal'))
    expect(unwrapErr(heal(state, own(state)[0]!.id, 1, 'Animal Husbandry', ITCHI)).kind).toBe('NOT_IN_THIS_BATTLE')
  })

  it('is strictly once per battle: a confirmed repeat does not get another heal', () => {
    for (const [tech, action] of [['Animal Husbandry', 'animalHusbandryHeal'], ['Biology', 'biologyHeal']] as const) {
      const first = unwrap(press(hurt(tech), action))
      let again = first
      if (tech === 'Animal Husbandry') for (const unit of own(first)) again = unwrap(heal(again, unit.id, 1))
      const repeated = performAssistedAction(wound(again, own(again)[0]!.id, 1), { playerId: CASH1981, action, requestId: 'req-2', at: AT, confirmedRepeat: true })
      expect(unwrapErr(repeated).kind).toBe('ASSISTED_ACTION_REJECTED')
    }
  })

  it('works again in the next battle, and End battle undone brings the used mark back', () => {
    const state = unwrap(press(hurt('Biology'), 'biologyHeal'))
    const over = unwrap(endBattleAction(state, { playerId: CASH1981 }))
    expect(unwrap(undoEndBattle(over, { playerId: CASH1981 })).battle!.heals).toHaveLength(1)
    // A new battle with a wounded unit of Cash's: the heal is ready again
    let next = over
    for (const playerId of [CASH1981, KARANDRAS1]) {
      next = unwrap(draw(next, { playerId, sheetName: 'INFANTRY', confirmedOutOfTurn: true }))
      next = unwrap(drawUnitsForBattle(next, { playerId, numberOfDraws: 1 }))
    }
    next = unwrap(initiateBattle(next, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))
    const mine = findPlayer(next, CASH1981)!.battlehand[0]!
    next = unwrap(placeUnitInArena(next, { playerId: CASH1981, unitId: mine.id, side: 'attacker', position: 0, attack: 1, health: 1 }))
    const placed = own(next)[0]!
    next = unwrap(rotateArenaUnit(next, { playerId: CASH1981, arenaUnitId: placed.id }))
    next = wound(next, placed.id, 1)
    expect(next.battle!.heals).toBeUndefined()
    expect(assistedAvailability(next, CASH1981, 'biologyHeal').status).toBe('ready')
  })

  it('owes 3 wounds for free and writes a public line', () => {
    const state = unwrap(press(hurt('Animal Husbandry'), 'animalHusbandryHeal'))
    expect(healOwed(state.battle!, CASH1981, 'Animal Husbandry')).toBe(3)
    expect(state.log.at(-1)?.publicLog).toContain('used Animal Husbandry: may heal up to 3 wounds')
    expect(assistedAvailability(state, CASH1981, 'animalHusbandryHeal').status).toBe('used')
    // The production boost is a different button and is untouched
    expect(assistedAvailability(state, CASH1981, 'animalHusbandry').status).not.toBe('used')
  })

  it('heals the chosen number per unit, up to 3 in total, and not above full health', () => {
    let state = unwrap(press(hurt('Animal Husbandry'), 'animalHusbandryHeal'))
    const [a, b] = own(state)
    const full = healthOf(state, a!.id) + 2
    state = unwrap(heal(state, a!.id, 2))
    expect(healthOf(state, a!.id)).toBe(full)
    expect(state.log.at(-1)?.publicLog).toContain('uses Animal Husbandry: heals 2 wounds')
    expect(unwrapErr(heal(state, a!.id, 1)).kind).toBe('BATTLE_CARD_REFUSED')
    expect(unwrapErr(heal(state, b!.id, 2)).kind).toBe('BATTLE_CARD_REFUSED')
    state = unwrap(heal(state, b!.id, 1))
    expect(healOwed(state.battle!, CASH1981, 'Animal Husbandry')).toBe(0)
    expect(unwrapErr(heal(state, b!.id, 1)).kind).toBe('BATTLE_CARD_REFUSED')
    // Once per battle: pressing again is refused
    expect(unwrapErr(press(state, 'animalHusbandryHeal', 'req-2')).kind).toBe('ASSISTED_ACTION_REJECTED')
  })

  it('refuses before the button is pressed, an enemy unit, a killed unit, a bad number and another tech', () => {
    const base = hurt('Animal Husbandry')
    const [a] = own(base)
    expect(unwrapErr(heal(base, a!.id, 1)).kind).toBe('BATTLE_CARD_REFUSED')
    const state = unwrap(press(base, 'animalHusbandryHeal'))
    expect(unwrapErr(heal(state, enemy(state)[0]!.id, 1)).kind).toBe('BATTLE_CARD_REFUSED')
    expect(unwrapErr(heal(state, a!.id, 0)).kind).toBe('BATTLE_CARD_REFUSED')
    expect(unwrapErr(heal(state, a!.id, 1.5)).kind).toBe('BATTLE_CARD_REFUSED')
    expect(unwrapErr(heal(state, a!.id, 1, 'Biology')).kind).toBe('BATTLE_CARD_REFUSED')
    const dead = unwrap(killArenaUnit(state, { playerId: CASH1981, arenaUnitId: a!.id }))
    expect(unwrapErr(heal(dead, a!.id, 1)).kind).toBe('BATTLE_CARD_REFUSED')
    expect(unwrapErr(heal(fight(), a!.id, 1)).kind).toBe('BATTLE_CARD_REFUSED')
  })

  it('undoes by vote while nothing is healed, and is refused after a wound was healed', () => {
    const pressed = unwrap(press(hurt('Animal Husbandry'), 'animalHusbandryHeal'))
    const back = undone(pressed, 'req-1')
    expect(healOwed(back.battle!, CASH1981, 'Animal Husbandry')).toBe(0)
    expect(back.battle!.heals).toBeUndefined()
    expect(assistedAvailability(back, CASH1981, 'animalHusbandryHeal').status).toBe('ready')
    const healed = unwrap(heal(pressed, own(pressed)[0]!.id, 1))
    expect(unwrapErr(lastVote(healed, 'req-1')).kind).toBe('ASSISTED_UNDO_BLOCKED')
    expect(healOwed(healed.battle!, CASH1981, 'Animal Husbandry')).toBe(2)
  })
})

describe('Biology heal', () => {
  it('heals every wounded unit of the player at once, and no one else', () => {
    const base = hurt('Biology')
    const before = enemy(base).map((unit) => unit.health)
    const state = unwrap(press(base, 'biologyHeal'))
    for (const unit of own(state)) expect(unit.health).toBe(arenaUnitTier(unit).health)
    expect(enemy(state).map((unit) => unit.health)).toEqual(before)
    expect(state.log.at(-1)?.publicLog).toContain('used Biology: heals all wounds (4) from 2 units')
    expect(assistedAvailability(state, CASH1981, 'biologyHeal').status).toBe('used')
    expect(unwrapErr(press(state, 'biologyHeal', 'req-2')).kind).toBe('ASSISTED_ACTION_REJECTED')
  })

  it('leaves a killed unit dead and refuses when nothing is wounded', () => {
    const base = hurt('Biology')
    const [a, b] = own(base)
    const dead = unwrap(killArenaUnit(base, { playerId: CASH1981, arenaUnitId: a!.id }))
    const state = unwrap(press(dead, 'biologyHeal'))
    expect(state.battle!.arena.find((unit) => unit.id === a!.id)?.killed).toBe(true)
    expect(healthOf(state, b!.id)).toBe(arenaUnitTier(b!).health)
    expect(assistedAvailability(withTech(fight(), 'Biology'), CASH1981, 'biologyHeal')).toMatchObject({ status: 'unavailable', reason: 'None of your units in the arena is wounded.' })
  })

  it('cannot be undone after End battle, since the results were counted with the healed units', () => {
    const state = unwrap(press(hurt('Biology'), 'biologyHeal'))
    const over = unwrap(endBattleAction(state, { playerId: CASH1981 }))
    expect(unwrapErr(lastVote(over, 'req-1')).kind).toBe('ASSISTED_UNDO_BLOCKED')
  })

  it('undoes by vote, giving the wounds back, and is refused once a healed unit was edited', () => {
    const base = hurt('Biology')
    const wounded = own(base).map((unit) => unit.health)
    const state = unwrap(press(base, 'biologyHeal'))
    const back = undone(state, 'req-1')
    expect(own(back).map((unit) => unit.health)).toEqual(wounded)
    expect(back.battle!.heals).toBeUndefined()
    expect(assistedAvailability(back, CASH1981, 'biologyHeal').status).toBe('ready')
    const edited = unwrap(setArenaUnitStat(state, { playerId: CASH1981, arenaUnitId: own(state)[0]!.id, key: 'health', value: 1 }))
    expect(unwrapErr(lastVote(edited, 'req-1')).kind).toBe('ASSISTED_UNDO_BLOCKED')
  })

  it('is not a resource ability, so a cancel cannot spend anything on it', () => {
    for (const [tech, action] of [['Animal Husbandry', 'animalHusbandryHeal'], ['Biology', 'biologyHeal']] as const) {
      const state = unwrap(press(hurt(tech), action))
      const record = state.assistedActions.at(-1)!
      expect(record.kind).toBe(action)
      expect(resourceAbilityOf(record)).toBeUndefined()
    }
  })
})
