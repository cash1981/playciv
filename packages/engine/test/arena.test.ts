/**
 * Tests for battle arena actions (issue #63).
 *
 * The old Java backend left battle as an open TODO, so there is no Java
 * reference to port here. These tests verify the engine's own spec.
 */

import { describe, expect, it } from 'vitest'

import {
  endBattleAction,
  endBattleTurn,
  initiateBattle,
  killArenaUnit,
  placeUnitInArena,
  setArenaUnitStat,
} from '../src/actions/arena.js'
import { draw, drawUnitsForBattle } from '../src/actions/draw.js'
import { isUnit } from '../src/item.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { findPlayer, toPlayerView } from '../src/state.js'

import { CASH1981, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Draw enough infantry for the given player to have something in their battlehand. */
function withBattlehand(
  playerId: string,
  count: number = 3,
): ReturnType<typeof firstCivGame> {
  let state = firstCivGame()
  // Draw units into the hand
  for (let i = 0; i < count; i++) {
    state = unwrap(draw(state, { playerId, sheetName: 'INFANTRY' }))
  }
  // Move them into the battlehand
  state = unwrap(drawUnitsForBattle(state, { playerId, numberOfDraws: count }))
  return state
}

// ---------------------------------------------------------------------------
// initiateBattle
// ---------------------------------------------------------------------------

describe('initiateBattle', () => {
  it('starts a battle between two players', () => {
    const before = firstCivGame()
    const after = unwrap(initiateBattle(before, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))

    expect(after.battle).not.toBeNull()
    expect(after.battle?.attacker.playerId).toBe(CASH1981)
    expect(after.battle?.defender.playerId).toBe(KARANDRAS1)
    expect(after.battle?.turn).toBe('attacker')
    expect(after.battle?.arena).toHaveLength(0)
  })

  it('errors if a battle is already active', () => {
    const state = unwrap(
      initiateBattle(firstCivGame(), { initiatorId: CASH1981, opponentId: KARANDRAS1 }),
    )
    const error = unwrapErr(
      initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }),
    )
    expect(error.kind).toBe('BATTLE_ALREADY_ACTIVE')
  })

  it('errors if the player battles themselves', () => {
    const error = unwrapErr(
      initiateBattle(firstCivGame(), { initiatorId: CASH1981, opponentId: CASH1981 }),
    )
    expect(error.kind).toBe('CANNOT_BATTLE_YOURSELF')
  })
})

// ---------------------------------------------------------------------------
// placeUnitInArena
// ---------------------------------------------------------------------------

describe('placeUnitInArena', () => {
  it('places a unit in the arena and marks inBattle on both battlehand and items', () => {
    let state = withBattlehand(CASH1981)
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))

    const player = findPlayer(state, CASH1981)!
    const unit = player.battlehand[0]!
    expect(unit).toBeDefined()

    state = unwrap(
      placeUnitInArena(state, {
        playerId: CASH1981,
        unitId: unit.id,
        side: 'attacker',
        position: 0,
        attack: unit.attack,
        health: unit.health,
      }),
    )

    const updated = findPlayer(state, CASH1981)!
    // inBattle on battlehand
    const bh = updated.battlehand.find((u) => u.id === unit.id)!
    expect(bh.inBattle).toBe(true)
    // inBattle on items
    const it = updated.items.find((i) => i.id === unit.id)!
    expect(it).toBeDefined()
    expect((it as { inBattle?: boolean }).inBattle).toBe(true)

    // Arena has one entry
    expect(state.battle?.arena).toHaveLength(1)
    expect(state.battle?.arena[0]?.side).toBe('attacker')
    expect(state.battle?.arena[0]?.position).toBe(0)
  })

  it('errors if the unit is already in battle', () => {
    let state = withBattlehand(CASH1981)
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))

    const unit = findPlayer(state, CASH1981)!.battlehand[0]!
    state = unwrap(
      placeUnitInArena(state, {
        playerId: CASH1981,
        unitId: unit.id,
        side: 'attacker',
        position: 0,
        attack: unit.attack,
        health: unit.health,
      }),
    )

    const error = unwrapErr(
      placeUnitInArena(state, {
        playerId: CASH1981,
        unitId: unit.id,
        side: 'attacker',
        position: 1,
        attack: unit.attack,
        health: unit.health,
      }),
    )
    expect(error.kind).toBe('UNIT_ALREADY_IN_BATTLE')
  })

  it('errors if the position is already occupied on that side', () => {
    let state = withBattlehand(CASH1981, 3)
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))

    const player = findPlayer(state, CASH1981)!
    const [unit1, unit2] = player.battlehand

    state = unwrap(
      placeUnitInArena(state, {
        playerId: CASH1981,
        unitId: unit1!.id,
        side: 'attacker',
        position: 0,
        attack: unit1!.attack,
        health: unit1!.health,
      }),
    )

    const error = unwrapErr(
      placeUnitInArena(state, {
        playerId: CASH1981,
        unitId: unit2!.id,
        side: 'attacker',
        position: 0,
        attack: unit2!.attack,
        health: unit2!.health,
      }),
    )
    expect(error.kind).toBe('ARENA_POSITION_OCCUPIED')
  })
})

// ---------------------------------------------------------------------------
// killArenaUnit
// ---------------------------------------------------------------------------

describe('killArenaUnit', () => {
  it('removes the unit from the arena and clears inBattle on items and battlehand', () => {
    let state = withBattlehand(CASH1981)
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))

    const unit = findPlayer(state, CASH1981)!.battlehand[0]!
    state = unwrap(
      placeUnitInArena(state, {
        playerId: CASH1981,
        unitId: unit.id,
        side: 'attacker',
        position: 0,
        attack: unit.attack,
        health: unit.health,
      }),
    )

    const arenaUnitId = state.battle!.arena[0]!.id
    state = unwrap(killArenaUnit(state, { playerId: CASH1981, arenaUnitId }))

    // Arena is empty
    expect(state.battle?.arena).toHaveLength(0)

    const updated = findPlayer(state, CASH1981)!
    // inBattle cleared on battlehand
    const bh = updated.battlehand.find((u) => u.id === unit.id)
    expect(bh).toBeDefined()
    expect(bh!.inBattle).toBe(false)
    // inBattle cleared on items
    const it = updated.items.find((i) => i.id === unit.id)
    expect(it).toBeDefined()
    expect((it as { inBattle?: boolean }).inBattle).toBe(false)
  })

  it('does NOT set killed: true on the source card', () => {
    let state = withBattlehand(CASH1981)
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))

    const unit = findPlayer(state, CASH1981)!.battlehand[0]!
    state = unwrap(
      placeUnitInArena(state, {
        playerId: CASH1981,
        unitId: unit.id,
        side: 'attacker',
        position: 0,
        attack: unit.attack,
        health: unit.health,
      }),
    )

    const arenaUnitId = state.battle!.arena[0]!.id
    state = unwrap(killArenaUnit(state, { playerId: CASH1981, arenaUnitId }))

    const it = findPlayer(state, CASH1981)!.items.find((i) => i.id === unit.id)
    expect(it).toBeDefined()
    expect(isUnit(it!) && it.killed).toBe(false)
  })

  it('rejects a non-participant trying to kill an arena unit', () => {
    let state = withBattlehand(CASH1981)
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))

    const unit = findPlayer(state, CASH1981)!.battlehand[0]!
    state = unwrap(
      placeUnitInArena(state, {
        playerId: CASH1981,
        unitId: unit.id,
        side: 'attacker',
        position: 0,
        attack: unit.attack,
        health: unit.health,
      }),
    )

    const arenaUnitId = state.battle!.arena[0]!.id
    // ITCHI is not part of the CASH1981 vs KARANDRAS1 battle
    const error = unwrapErr(killArenaUnit(state, { playerId: ITCHI, arenaUnitId }))
    expect(error.kind).toBe('NOT_IN_THIS_BATTLE')
    // Unit stays in the arena
    expect(state.battle!.arena).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// endBattleAction
// ---------------------------------------------------------------------------

describe('endBattleAction', () => {
  it('with active battle: clears arena, sets battle to null, clears inBattle on involved units', () => {
    let state = withBattlehand(CASH1981)
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))

    const unit = findPlayer(state, CASH1981)!.battlehand[0]!
    state = unwrap(
      placeUnitInArena(state, {
        playerId: CASH1981,
        unitId: unit.id,
        side: 'attacker',
        position: 0,
        attack: unit.attack,
        health: unit.health,
      }),
    )

    state = unwrap(endBattleAction(state, { playerId: CASH1981 }))

    expect(state.battle).toBeNull()

    const updated = findPlayer(state, CASH1981)!
    const bh = updated.battlehand.find((u) => u.id === unit.id)
    expect(bh).toBeDefined()
    expect(bh!.inBattle).toBe(false)
    // inBattle also cleared on items
    const it = updated.items.find((i) => i.id === unit.id)
    expect(it).toBeDefined()
    expect((it as { inBattle?: boolean }).inBattle).toBe(false)
  })

  it('rejects a non-participant trying to end an active battle', () => {
    let state = withBattlehand(CASH1981)
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))

    // ITCHI is not part of the CASH1981 vs KARANDRAS1 battle
    const error = unwrapErr(endBattleAction(state, { playerId: ITCHI }))
    expect(error.kind).toBe('NOT_IN_THIS_BATTLE')
  })

  it('without active battle: clears inBattle on caller items only', () => {
    let state = firstCivGame()
    for (let i = 0; i < 2; i++) {
      state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'INFANTRY' }))
    }
    state = unwrap(drawUnitsForBattle(state, { playerId: CASH1981, numberOfDraws: 2 }))

    // Verify there are units to test against
    const player = findPlayer(state, CASH1981)!
    const units = player.items.filter(isUnit)
    expect(units.length).toBeGreaterThan(0)

    // endBattleAction with no active battle clears inBattle on caller's items
    const after = unwrap(endBattleAction(state, { playerId: CASH1981 }))
    expect(after.battle).toBeNull()
    const afterPlayer = findPlayer(after, CASH1981)!
    for (const item of afterPlayer.items) {
      if (isUnit(item)) expect(item.inBattle).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// setArenaUnitStat
// ---------------------------------------------------------------------------

describe('setArenaUnitStat', () => {
  it('any game member can update attack; new value is stored and logged', () => {
    let state = withBattlehand(CASH1981)
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))

    const unit = findPlayer(state, CASH1981)!.battlehand[0]!
    state = unwrap(
      placeUnitInArena(state, {
        playerId: CASH1981,
        unitId: unit.id,
        side: 'attacker',
        position: 0,
        attack: unit.attack,
        health: unit.health,
      }),
    )

    const arenaUnitId = state.battle!.arena[0]!.id

    // KARANDRAS1 (not the one who placed the unit) updates the attack
    state = unwrap(
      setArenaUnitStat(state, { playerId: KARANDRAS1, arenaUnitId, key: 'attack', value: 5 }),
    )

    expect(state.battle!.arena[0]!.attack).toBe(5)
    // The log should contain an entry about the update
    const logEntry = state.log[state.log.length - 1]
    expect(logEntry?.publicLog).toContain('attack')
  })

  it('returns INVALID_ARENA_STAT_VALUE for a negative value', () => {
    let state = withBattlehand(CASH1981)
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))

    const unit = findPlayer(state, CASH1981)!.battlehand[0]!
    state = unwrap(
      placeUnitInArena(state, {
        playerId: CASH1981,
        unitId: unit.id,
        side: 'attacker',
        position: 0,
        attack: unit.attack,
        health: unit.health,
      }),
    )

    const arenaUnitId = state.battle!.arena[0]!.id
    const error = unwrapErr(
      setArenaUnitStat(state, { playerId: CASH1981, arenaUnitId, key: 'attack', value: -1 }),
    )
    expect(error.kind).toBe('INVALID_ARENA_STAT_VALUE')
  })
})

// ---------------------------------------------------------------------------
// endBattleTurn
// ---------------------------------------------------------------------------

describe('endBattleTurn', () => {
  it('flips battle.turn from attacker to defender and back', () => {
    let state = firstCivGame()
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))

    expect(state.battle!.turn).toBe('attacker')

    state = unwrap(endBattleTurn(state, { playerId: CASH1981 }))
    expect(state.battle!.turn).toBe('defender')

    state = unwrap(endBattleTurn(state, { playerId: KARANDRAS1 }))
    expect(state.battle!.turn).toBe('attacker')
  })

  it('rejects a non-participant trying to end the battle turn', () => {
    let state = firstCivGame()
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))

    // ITCHI is not part of the CASH1981 vs KARANDRAS1 battle
    const error = unwrapErr(endBattleTurn(state, { playerId: ITCHI }))
    expect(error.kind).toBe('NOT_IN_THIS_BATTLE')
    expect(state.battle!.turn).toBe('attacker')
  })
})

// ---------------------------------------------------------------------------
// initiateBattle — barbarians
// ---------------------------------------------------------------------------

describe('initiateBattle with barbarians', () => {
  it('sets up a player-vs-barbarians battle and draws 3 units for the left player', () => {
    const state = unwrap(
      initiateBattle(firstCivGame(), { initiatorId: CASH1981, opponentId: 'barbarians' }),
    )

    expect(state.battle).not.toBeNull()
    expect(state.battle!.attacker.kind).toBe('player')
    expect(state.battle!.attacker.playerId).toBe(CASH1981)
    expect(state.battle!.defender.kind).toBe('barbarians')

    // The player to the left of CASH1981 in firstCivGame is KARANDRAS1 (index 1)
    const controllerId = state.battle!.defender.playerId
    expect(controllerId).toBe(KARANDRAS1)
    const controller = findPlayer(state, controllerId)
    expect(controller).toBeDefined()
    expect(controller!.barbarians).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// battleSummaries (via toPlayerView)
// ---------------------------------------------------------------------------

describe('battleSummaries', () => {
  it('computes correct totals for attacker and defender sides', () => {
    // Use a barbarians battle so the "defender" units are drawn automatically
    // by the engine (no turn restriction). CASH1981 is attacker;
    // KARANDRAS1 (player to the left) controls 3 barbarian units.
    let state = withBattlehand(CASH1981, 3)
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: 'barbarians' }))

    // Place two attacker units (attack 3, health 5 each)
    const cashUnits = findPlayer(state, CASH1981)!.battlehand
    state = unwrap(
      placeUnitInArena(state, {
        playerId: CASH1981,
        unitId: cashUnits[0]!.id,
        side: 'attacker',
        position: 0,
        attack: 3,
        health: 5,
      }),
    )
    state = unwrap(
      placeUnitInArena(state, {
        playerId: CASH1981,
        unitId: cashUnits[1]!.id,
        side: 'attacker',
        position: 1,
        attack: 3,
        health: 5,
      }),
    )

    // KARANDRAS1 controls the barbarians — place one barbarian (attack 2, health 4)
    const barbarianUnits = findPlayer(state, KARANDRAS1)!.barbarians
    expect(barbarianUnits.length).toBeGreaterThan(0)
    state = unwrap(
      placeUnitInArena(state, {
        playerId: KARANDRAS1,
        unitId: barbarianUnits[0]!.id,
        side: 'defender',
        position: 0,
        attack: 2,
        health: 4,
      }),
    )

    const view = toPlayerView(state, CASH1981)
    const attackerSummary = view.battleSummary.find((s) => s.side === 'attacker')
    const defenderSummary = view.battleSummary.find((s) => s.side === 'defender')

    expect(attackerSummary).toBeDefined()
    expect(attackerSummary!.unitCount).toBe(2)
    expect(attackerSummary!.totalAttack).toBe(6)
    expect(attackerSummary!.totalHealth).toBe(10)

    expect(defenderSummary).toBeDefined()
    expect(defenderSummary!.unitCount).toBe(1)
    expect(defenderSummary!.totalAttack).toBe(2)
    expect(defenderSummary!.totalHealth).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// Hidden-information test
// ---------------------------------------------------------------------------

describe('hidden information: battle arena', () => {
  it('view.battle.arena contains only explicitly placed units, not the full private hand', () => {
    // CASH1981 draws 3 infantry; their full hand and battlehand have 3 units
    let state = withBattlehand(CASH1981)
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))

    const cashPlayer = findPlayer(state, CASH1981)!
    const [placed, ...rest] = cashPlayer.battlehand
    expect(placed).toBeDefined()
    // Ensure there are unplaced units to verify they don't appear in the arena
    expect(rest.length).toBeGreaterThan(0)

    state = unwrap(
      placeUnitInArena(state, {
        playerId: CASH1981,
        unitId: placed!.id,
        side: 'attacker',
        position: 0,
        attack: placed!.attack,
        health: placed!.health,
      }),
    )

    // View from KARANDRAS1's perspective
    const view = toPlayerView(state, KARANDRAS1)

    // The arena must show exactly the one placed unit
    expect(view.battle?.arena).toHaveLength(1)
    expect(view.battle?.arena[0]?.unit.id).toBe(placed!.id)

    // Units that were NOT placed in the arena must not appear inside the arena array
    const arenaUnitIds = view.battle?.arena.map((u) => u.unit.id) ?? []
    for (const unit of rest) {
      expect(arenaUnitIds).not.toContain(unit.id)
    }

    // CASH1981's private items (regular hand) that are not in the arena
    // must not appear in the arena snapshot either
    const cashPrivateItems = findPlayer(state, CASH1981)!.items.filter(
      (i) => i.id !== placed!.id,
    )
    for (const item of cashPrivateItems) {
      expect(arenaUnitIds).not.toContain(item.id)
    }

    // Strengthen: none of CASH1981's private items (hand, not battlehand) appear
    // in the arena or anywhere in KARANDRAS1's view.
    // Note: battlehand IS intentionally exposed to opponents during battle
    // (see opaque() in state.ts), so only the private items field is checked here.
    const viewJson = JSON.stringify(view)
    const cashPrivateOnlyItems = findPlayer(state, CASH1981)!.items.filter(
      (i) => !cashPlayer.battlehand.some((u) => u.id === i.id) && i.id !== placed!.id,
    )
    for (const item of cashPrivateOnlyItems) {
      expect(viewJson).not.toContain(item.id)
    }
  })
})
