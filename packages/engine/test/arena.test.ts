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
  moveArenaUnit,
  placeUnitInArena,
  returnArenaUnitToHand,
  rotateArenaUnit,
  setArenaUnitStat,
  undoEndBattle,
} from '../src/actions/arena.js'
import { placePiece } from '../src/actions/board.js'
import { draw, drawBarbarians, drawUnitsForBattle } from '../src/actions/draw.js'
import { isUnit, revealAll } from '../src/item.js'
import { migrateGameState } from '../src/migrate.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { GameState } from '../src/state.js'

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

/**
 * Same as `withBattlehand`, but adds to an already-built state without
 * resetting it. The draw is confirmed out of turn, since only the start player
 * holds the turn in a fresh game.
 */
function addBattlehand(
  state: GameState,
  playerId: string,
  count: number = 3,
): GameState {
  let next = state
  for (let i = 0; i < count; i++) {
    next = unwrap(draw(next, { playerId, sheetName: 'INFANTRY', confirmedOutOfTurn: true }))
  }
  return unwrap(drawUnitsForBattle(next, { playerId, numberOfDraws: count }))
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
    // The initiator called the fight — the defender reacts first (issue #71).
    expect(after.battle?.turn).toBe('defender')
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

  it('lets a new unit reinforce a front still held by a killed one, keeping that card locked until battle end', () => {
    let state = withBattlehand(CASH1981, 2)
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))

    const [fallen, reinforcement] = findPlayer(state, CASH1981)!.battlehand
    state = unwrap(
      placeUnitInArena(state, {
        playerId: CASH1981,
        unitId: fallen!.id,
        side: 'attacker',
        position: 0,
        attack: fallen!.attack,
        health: fallen!.health,
      }),
    )
    const fallenArenaId = state.battle!.arena[0]!.id
    state = unwrap(killArenaUnit(state, { playerId: CASH1981, arenaUnitId: fallenArenaId }))
    expect(state.battle!.arena[0]!.killed).toBe(true)

    state = unwrap(
      placeUnitInArena(state, {
        playerId: CASH1981,
        unitId: reinforcement!.id,
        side: 'attacker',
        position: 0,
        attack: reinforcement!.attack,
        health: reinforcement!.health,
      }),
    )

    // The fallen unit is gone from the visible arena, replaced by the
    // reinforcement — one live unit on that front, not two.
    expect(state.battle!.arena).toHaveLength(1)
    expect(state.battle!.arena[0]!.unit.id).toBe(reinforcement!.id)
    expect(state.battle!.arena[0]!.killed).toBe(false)

    // But its card is not available yet — reinforcing a front does not free
    // up whatever it displaces mid-battle (issue #75's chosen design): the
    // fallen unit moves to departedUnits, inBattle still true, and only
    // returns to hand once the whole battle ends.
    expect(state.battle!.departedUnits).toHaveLength(1)
    expect(state.battle!.departedUnits[0]!.unit.id).toBe(fallen!.id)
    const stillLocked = findPlayer(state, CASH1981)!.battlehand.find((u) => u.id === fallen!.id)
    expect(stillLocked?.inBattle).toBe(true)
    expect(state.discardedItems.some((it) => it.id === fallen!.id)).toBe(false)

    // Ending the battle finally frees it, same as any other unit.
    state = unwrap(endBattleAction(state, { playerId: CASH1981 }))
    const freed = findPlayer(state, CASH1981)!.battlehand.find((u) => u.id === fallen!.id)
    expect(freed?.inBattle).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// moveArenaUnit
// ---------------------------------------------------------------------------

describe('moveArenaUnit', () => {
  it('changes the position of an already-placed unit', () => {
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
    state = unwrap(moveArenaUnit(state, { playerId: CASH1981, arenaUnitId, position: 3 }))

    expect(state.battle!.arena).toHaveLength(1)
    expect(state.battle!.arena[0]!.position).toBe(3)
  })

  it('collapses repeated moves of the same unit into one log entry', () => {
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
    const logLengthAfterPlace = state.log.length

    const arenaUnitId = state.battle!.arena[0]!.id
    state = unwrap(moveArenaUnit(state, { playerId: CASH1981, arenaUnitId, position: 1 }))
    state = unwrap(moveArenaUnit(state, { playerId: CASH1981, arenaUnitId, position: 2 }))
    state = unwrap(moveArenaUnit(state, { playerId: CASH1981, arenaUnitId, position: 3 }))

    // Three moves, but only one new log line beyond the placement.
    expect(state.log.length).toBe(logLengthAfterPlace + 1)
    expect(state.log[state.log.length - 1]!.publicLog).toContain('front #3')
  })

  it('does not carry the card on the log entry, so a move can never be undone', () => {
    // initiateUndo's only gate is `entry.item !== null` — if a move entry
    // carried the card (as an early version of the rolling-log helper did),
    // accepting an undo vote on it would try to pull the unit back into the
    // deck/hand while it is still referenced by battle.arena, corrupting the
    // game. See docs/agents/decisions.md (issue #71).
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
    state = unwrap(moveArenaUnit(state, { playerId: CASH1981, arenaUnitId, position: 1 }))

    expect(state.log[state.log.length - 1]!.item).toBeNull()
  })

  it('errors on a position already held by another unit on the same side', () => {
    let state = withBattlehand(CASH1981, 2)
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))

    const [unit1, unit2] = findPlayer(state, CASH1981)!.battlehand
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
    state = unwrap(
      placeUnitInArena(state, {
        playerId: CASH1981,
        unitId: unit2!.id,
        side: 'attacker',
        position: 1,
        attack: unit2!.attack,
        health: unit2!.health,
      }),
    )

    const movedUnitId = state.battle!.arena.find((u) => u.unit.id === unit2!.id)!.id
    const error = unwrapErr(moveArenaUnit(state, { playerId: CASH1981, arenaUnitId: movedUnitId, position: 0 }))
    expect(error.kind).toBe('ARENA_POSITION_OCCUPIED')
  })

  it('rejects moving a unit on the other side', () => {
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
      moveArenaUnit(state, { playerId: KARANDRAS1, arenaUnitId, position: 1 }),
    )
    expect(error.kind).toBe('NOT_IN_THIS_BATTLE')
  })

  it('reinforces a front held by a killed unit when moved onto it, keeping that card locked until battle end', () => {
    let state = withBattlehand(CASH1981, 2)
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))

    const [fallen, mover] = findPlayer(state, CASH1981)!.battlehand
    state = unwrap(
      placeUnitInArena(state, {
        playerId: CASH1981,
        unitId: fallen!.id,
        side: 'attacker',
        position: 0,
        attack: fallen!.attack,
        health: fallen!.health,
      }),
    )
    const fallenArenaId = state.battle!.arena.find((u) => u.unit.id === fallen!.id)!.id
    state = unwrap(killArenaUnit(state, { playerId: CASH1981, arenaUnitId: fallenArenaId }))

    state = unwrap(
      placeUnitInArena(state, {
        playerId: CASH1981,
        unitId: mover!.id,
        side: 'attacker',
        position: 1,
        attack: mover!.attack,
        health: mover!.health,
      }),
    )
    const moverArenaId = state.battle!.arena.find((u) => u.unit.id === mover!.id)!.id

    state = unwrap(moveArenaUnit(state, { playerId: CASH1981, arenaUnitId: moverArenaId, position: 0 }))

    expect(state.battle!.arena).toHaveLength(1)
    expect(state.battle!.arena[0]!.unit.id).toBe(mover!.id)
    expect(state.battle!.arena[0]!.position).toBe(0)

    // The fallen unit moves to departedUnits, still locked (not discarded,
    // not yet returned to hand) until the battle ends (issue #75).
    expect(state.battle!.departedUnits).toHaveLength(1)
    expect(state.battle!.departedUnits[0]!.unit.id).toBe(fallen!.id)
    expect(state.discardedItems.some((it) => it.id === fallen!.id)).toBe(false)
    const updated = findPlayer(state, CASH1981)!
    expect(updated.battlehand.find((u) => u.id === fallen!.id)?.inBattle).toBe(true)
    const lockedInItems = updated.items.find((it) => it.id === fallen!.id)
    expect((lockedInItems as { inBattle?: boolean } | undefined)?.inBattle).toBe(true)

    state = unwrap(endBattleAction(state, { playerId: CASH1981 }))
    const freedPlayer = findPlayer(state, CASH1981)!
    expect(freedPlayer.battlehand.find((u) => u.id === fallen!.id)?.inBattle).toBe(false)
    const freedInItems = freedPlayer.items.find((it) => it.id === fallen!.id)
    expect((freedInItems as { inBattle?: boolean } | undefined)?.inBattle).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// returnArenaUnitToHand
// ---------------------------------------------------------------------------

describe('returnArenaUnitToHand', () => {
  it('removes the unit from the arena and clears inBattle, undoing placement', () => {
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
    state = unwrap(returnArenaUnitToHand(state, { playerId: CASH1981, arenaUnitId }))

    expect(state.battle!.arena).toHaveLength(0)
    const bh = findPlayer(state, CASH1981)!.battlehand.find((u) => u.id === unit.id)
    expect(bh?.inBattle).toBe(false)
  })

  it('rejects returning a unit on the other side', () => {
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
      returnArenaUnitToHand(state, { playerId: KARANDRAS1, arenaUnitId }),
    )
    expect(error.kind).toBe('NOT_IN_THIS_BATTLE')
    expect(state.battle!.arena).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// killArenaUnit
// ---------------------------------------------------------------------------

describe('killArenaUnit', () => {
  it('toggles killed without removing the unit from the arena or touching inBattle', () => {
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
    expect(state.battle!.arena[0]!.killed).toBe(false)

    state = unwrap(killArenaUnit(state, { playerId: CASH1981, arenaUnitId }))

    // Still in the arena, just marked killed.
    expect(state.battle!.arena).toHaveLength(1)
    expect(state.battle!.arena[0]!.killed).toBe(true)

    const stillPlaced = findPlayer(state, CASH1981)!
    const bh = stillPlaced.battlehand.find((u) => u.id === unit.id)
    expect(bh?.inBattle).toBe(true)
  })

  it('is undoable — calling it again un-kills the unit', () => {
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
    expect(state.battle!.arena[0]!.killed).toBe(true)

    state = unwrap(killArenaUnit(state, { playerId: CASH1981, arenaUnitId }))
    expect(state.battle!.arena[0]!.killed).toBe(false)
  })

  it('collapses a kill/undo-kill run into one log entry, whichever direction was last', () => {
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
    const logLengthAfterPlace = state.log.length

    const arenaUnitId = state.battle!.arena[0]!.id
    state = unwrap(killArenaUnit(state, { playerId: CASH1981, arenaUnitId })) // killed: true
    state = unwrap(killArenaUnit(state, { playerId: CASH1981, arenaUnitId })) // killed: false
    state = unwrap(killArenaUnit(state, { playerId: CASH1981, arenaUnitId })) // killed: true

    // Three toggles, but only one new log line beyond the placement.
    expect(state.log.length).toBe(logLengthAfterPlace + 1)
    expect(state.battle!.arena[0]!.killed).toBe(true)
    expect(state.log[state.log.length - 1]!.publicLog).toContain('kills')
    expect(state.log[state.log.length - 1]!.item).toBeNull()
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
    // Unit stays alive
    expect(state.battle!.arena[0]!.killed).toBe(false)
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

  it('returns a still-killed unit\'s source card to hand too, not just an unkilled one (issue #75)', () => {
    let state = withBattlehand(CASH1981, 2)
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))

    const [killedUnit, survivor] = findPlayer(state, CASH1981)!.battlehand
    state = unwrap(
      placeUnitInArena(state, {
        playerId: CASH1981,
        unitId: killedUnit!.id,
        side: 'attacker',
        position: 0,
        attack: killedUnit!.attack,
        health: killedUnit!.health,
      }),
    )
    state = unwrap(
      placeUnitInArena(state, {
        playerId: CASH1981,
        unitId: survivor!.id,
        side: 'attacker',
        position: 1,
        attack: survivor!.attack,
        health: survivor!.health,
      }),
    )

    const killedArenaUnitId = state.battle!.arena.find((u) => u.unit.id === killedUnit!.id)!.id
    state = unwrap(killArenaUnit(state, { playerId: CASH1981, arenaUnitId: killedArenaUnitId }))

    state = unwrap(endBattleAction(state, { playerId: CASH1981 }))

    const updated = findPlayer(state, CASH1981)!
    // Killing never auto-discards: the killed unit's card is back in hand,
    // just like the unkilled one — the player discards it themselves.
    const killedInHand = updated.battlehand.find((u) => u.id === killedUnit!.id)
    expect(killedInHand?.inBattle).toBe(false)
    const killedInItems = updated.items.find((it) => it.id === killedUnit!.id)
    expect((killedInItems as { inBattle?: boolean } | undefined)?.inBattle).toBe(false)
    expect(state.discardedItems.some((it) => it.id === killedUnit!.id)).toBe(false)

    const survivorHand = updated.battlehand.find((u) => u.id === survivor!.id)
    expect(survivorHand?.inBattle).toBe(false)
  })

  it('logs the winner as whichever side has more remaining HP', () => {
    let state = withBattlehand(CASH1981)
    state = addBattlehand(state, KARANDRAS1)
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))

    const attackerUnit = findPlayer(state, CASH1981)!.battlehand[0]!
    const defenderUnit = findPlayer(state, KARANDRAS1)!.battlehand[0]!
    state = unwrap(
      placeUnitInArena(state, {
        playerId: CASH1981,
        unitId: attackerUnit.id,
        side: 'attacker',
        position: 0,
        attack: attackerUnit.attack,
        health: 5,
      }),
    )
    state = unwrap(
      placeUnitInArena(state, {
        playerId: KARANDRAS1,
        unitId: defenderUnit.id,
        side: 'defender',
        position: 0,
        attack: 1,
        health: 2,
      }),
    )

    state = unwrap(endBattleAction(state, { playerId: CASH1981 }))

    const logEntry = state.log[state.log.length - 1]!
    expect(logEntry.publicLog).toContain('cash1981 won with 5 HP vs 2 HP')
  })

  it('adds each side\'s combat bonus (issue #197, derived) to its HP before deciding the winner', () => {
    let state = withBattlehand(CASH1981)
    state = addBattlehand(state, KARANDRAS1)
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))
    // An Academy placed by the defender is worth +4 combat bonus (issue #197).
    state = unwrap(
      placePiece(state, { playerId: KARANDRAS1, assetId: 'buildings/academy', x: 40, y: 300 }),
    )

    const attackerUnit = findPlayer(state, CASH1981)!.battlehand[0]!
    const defenderUnit = findPlayer(state, KARANDRAS1)!.battlehand[0]!
    state = unwrap(
      placeUnitInArena(state, {
        playerId: CASH1981,
        unitId: attackerUnit.id,
        side: 'attacker',
        position: 0,
        attack: attackerUnit.attack,
        health: 5,
      }),
    )
    state = unwrap(
      placeUnitInArena(state, {
        playerId: KARANDRAS1,
        unitId: defenderUnit.id,
        side: 'defender',
        position: 0,
        attack: 1,
        health: 2,
      }),
    )

    state = unwrap(endBattleAction(state, { playerId: CASH1981 }))

    // Defender's 2 HP + the 4-point combat bonus (6) beats the attacker's 5.
    const logEntry = state.log[state.log.length - 1]!
    expect(logEntry.publicLog).toContain('Karandras1 won with 6 HP vs 5 HP')
  })

  it('a draw goes to the defender', () => {
    let state = withBattlehand(CASH1981)
    state = addBattlehand(state, KARANDRAS1)
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))

    const attackerUnit = findPlayer(state, CASH1981)!.battlehand[0]!
    const defenderUnit = findPlayer(state, KARANDRAS1)!.battlehand[0]!
    state = unwrap(
      placeUnitInArena(state, {
        playerId: CASH1981,
        unitId: attackerUnit.id,
        side: 'attacker',
        position: 0,
        attack: attackerUnit.attack,
        health: 3,
      }),
    )
    state = unwrap(
      placeUnitInArena(state, {
        playerId: KARANDRAS1,
        unitId: defenderUnit.id,
        side: 'defender',
        position: 0,
        attack: 1,
        health: 3,
      }),
    )

    state = unwrap(endBattleAction(state, { playerId: CASH1981 }))

    const logEntry = state.log[state.log.length - 1]!
    expect(logEntry.publicLog).toContain('Karandras1 won with 3 HP vs 3 HP')
  })

  it('returns a killed barbarian unit to the barbarian list too, clearing inBattle', () => {
    let state = unwrap(
      initiateBattle(firstCivGame(), { initiatorId: CASH1981, opponentId: 'barbarians' }),
    )
    // The player to CASH1981's left controls the barbarians (KARANDRAS1 in firstCivGame).
    const controllerId = state.battle!.defender.playerId
    const barbarianUnit = findPlayer(state, controllerId)!.barbarians[0]!

    state = unwrap(
      placeUnitInArena(state, {
        playerId: controllerId,
        unitId: barbarianUnit.id,
        side: 'defender',
        position: 0,
        attack: barbarianUnit.attack,
        health: barbarianUnit.health,
      }),
    )
    const arenaUnitId = state.battle!.arena[0]!.id
    state = unwrap(killArenaUnit(state, { playerId: controllerId, arenaUnitId }))

    state = unwrap(endBattleAction(state, { playerId: controllerId }))

    const controller = findPlayer(state, controllerId)!
    const barbarianAfter = controller.barbarians.find((u) => u.id === barbarianUnit.id)
    expect(barbarianAfter?.inBattle).toBe(false)
    expect(state.discardedItems.some((it) => it.id === barbarianUnit.id)).toBe(false)
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

describe('rotateArenaUnit', () => {
  it('is placed at rotation 0 and cycles counter-clockwise 0 → 270 → 180 → 90 → 0', () => {
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
    expect(state.battle!.arena[0]!.rotation).toBe(0)

    for (const expected of [270, 180, 90, 0]) {
      // Any game member may rotate — not just the two combatants.
      state = unwrap(rotateArenaUnit(state, { playerId: KARANDRAS1, arenaUnitId }))
      expect(state.battle!.arena[0]!.rotation).toBe(expected)
    }
  })

  it('suggests attack/health one higher per press, from the base card, wrapping after 360°', () => {
    let state = withBattlehand(CASH1981)
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))

    const unit = findPlayer(state, CASH1981)!.battlehand[0]!
    // Seed the arena with different attack/health than the base card, so a
    // reset to base+bonus is distinguishable from "left untouched".
    state = unwrap(
      placeUnitInArena(state, {
        playerId: CASH1981,
        unitId: unit.id,
        side: 'attacker',
        position: 0,
        attack: unit.attack + 10,
        health: unit.health + 10,
      }),
    )

    const arenaUnitId = state.battle!.arena[0]!.id

    for (const bonus of [1, 2, 3, 0]) {
      state = unwrap(rotateArenaUnit(state, { playerId: CASH1981, arenaUnitId }))
      expect(state.battle!.arena[0]!.attack).toBe(unit.attack + bonus)
      expect(state.battle!.arena[0]!.health).toBe(unit.health + bonus)
    }
  })

  it('leaves attack/health untouched for aircraft, which print no level ladder', () => {
    let state = firstCivGame()
    state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'AIRCRAFT' }))
    state = unwrap(drawUnitsForBattle(state, { playerId: CASH1981, numberOfDraws: 1 }))
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
    state = unwrap(rotateArenaUnit(state, { playerId: CASH1981, arenaUnitId }))

    expect(state.battle!.arena[0]!.rotation).toBe(270)
    expect(state.battle!.arena[0]!.attack).toBe(unit.attack)
    expect(state.battle!.arena[0]!.health).toBe(unit.health)
  })

  it('returns ARENA_UNIT_NOT_FOUND for an unknown arena unit', () => {
    let state = withBattlehand(CASH1981)
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))

    const error = unwrapErr(
      rotateArenaUnit(state, { playerId: CASH1981, arenaUnitId: 'no-such-unit' }),
    )
    expect(error.kind).toBe('ARENA_UNIT_NOT_FOUND')
  })

  it('migrating a saved battle backfills rotation: 0 on arena units missing it', () => {
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

    // Simulate a game saved before the rotate button existed: strip
    // `rotation` from the persisted arena unit, as an old JSON blob would.
    const arenaUnit = state.battle!.arena[0]! as unknown as Record<string, unknown>
    delete arenaUnit['rotation']
    const older = { ...state, battle: { ...state.battle, arena: [arenaUnit] } }

    const migrated = migrateGameState(older as unknown as GameState)
    expect(migrated.battle!.arena[0]!.rotation).toBe(0)
  })

  it('migrating a saved battle backfills killed: false on arena units missing it', () => {
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

    // Simulate a game saved before undoable kills existed (issue #71).
    const arenaUnit = state.battle!.arena[0]! as unknown as Record<string, unknown>
    delete arenaUnit['killed']
    const older = { ...state, battle: { ...state.battle, arena: [arenaUnit] } }

    const migrated = migrateGameState(older as unknown as GameState)
    expect(migrated.battle!.arena[0]!.killed).toBe(false)
  })

  it('migrating a saved battle backfills departedUnits: [] when missing', () => {
    let state = withBattlehand(CASH1981)
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))

    // Simulate a game saved before reinforcement tracked what it displaced
    // (issue #75).
    const olderBattle = state.battle as unknown as Record<string, unknown>
    delete olderBattle['departedUnits']
    const older = { ...state, battle: olderBattle }

    const migrated = migrateGameState(older as unknown as GameState)
    expect(migrated.battle!.departedUnits).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// endBattleTurn
// ---------------------------------------------------------------------------

describe('endBattleTurn', () => {
  it('flips battle.turn from defender to attacker and back', () => {
    let state = firstCivGame()
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))

    // The defender opens (issue #71).
    expect(state.battle!.turn).toBe('defender')

    state = unwrap(endBattleTurn(state, { playerId: KARANDRAS1 }))
    expect(state.battle!.turn).toBe('attacker')

    state = unwrap(endBattleTurn(state, { playerId: CASH1981 }))
    expect(state.battle!.turn).toBe('defender')
  })

  it('rejects a non-participant trying to end the battle turn', () => {
    let state = firstCivGame()
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))

    // ITCHI is not part of the CASH1981 vs KARANDRAS1 battle
    const error = unwrapErr(endBattleTurn(state, { playerId: ITCHI }))
    expect(error.kind).toBe('NOT_IN_THIS_BATTLE')
    expect(state.battle!.turn).toBe('defender')
  })
})

// ---------------------------------------------------------------------------
// initiateBattle — barbarians
// ---------------------------------------------------------------------------

describe('initiateBattle with barbarians', () => {
  it('reuses the left player prepared hand without drawing or mutating the input', () => {
    const before = unwrap(drawBarbarians(firstCivGame(), KARANDRAS1))
    const snapshot = JSON.stringify(before)
    const prepared = findPlayer(before, KARANDRAS1)?.barbarians
    const after = unwrap(initiateBattle(before, { initiatorId: CASH1981, opponentId: 'barbarians' }))
    expect(findPlayer(after, KARANDRAS1)?.barbarians).toEqual(prepared)
    expect(after.items).toEqual(before.items)
    expect(after.log).toHaveLength(before.log.length + 1)
    expect(after.battle?.defender).toEqual({ kind: 'barbarians', playerId: KARANDRAS1 })
    expect(after.battle?.turn).toBe('defender')
    expect(JSON.stringify(before)).toBe(snapshot)
    const serialized = JSON.stringify(toPlayerView(after, CASH1981))
    for (const unit of prepared ?? []) expect(serialized).not.toContain(unit.id)
  })

  it('uses the left controller hand and leaves another player prepared hand untouched', () => {
    const before = unwrap(drawBarbarians(firstCivGame(), ITCHI))
    const otherHand = findPlayer(before, ITCHI)?.barbarians
    const after = unwrap(initiateBattle(before, { initiatorId: CASH1981, opponentId: 'barbarians' }))
    expect(after.battle?.defender.playerId).toBe(KARANDRAS1)
    expect(findPlayer(after, KARANDRAS1)?.barbarians).toHaveLength(3)
    expect(findPlayer(after, ITCHI)?.barbarians).toEqual(otherHand)
  })

  it('sets up a player-vs-barbarians battle and draws 3 units for the left player', () => {
    const state = unwrap(
      initiateBattle(firstCivGame(), { initiatorId: CASH1981, opponentId: 'barbarians' }),
    )

    expect(state.battle).not.toBeNull()
    expect(state.battle!.attacker.kind).toBe('player')
    expect(state.battle!.attacker.playerId).toBe(CASH1981)
    expect(state.battle!.defender.kind).toBe('barbarians')
    // The defender (the barbarian controller) opens, same as vs. a player (issue #71).
    expect(state.battle!.turn).toBe('defender')

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

  it('excludes a killed unit from the totals, since it stays in the arena until the battle ends', () => {
    let state = withBattlehand(CASH1981, 2)
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))

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

    const arenaUnitId = state.battle!.arena[0]!.id
    state = unwrap(killArenaUnit(state, { playerId: CASH1981, arenaUnitId }))

    // Still 2 entries in the arena (undoable), but only 1 counts as alive.
    expect(state.battle!.arena).toHaveLength(2)
    const view = toPlayerView(state, CASH1981)
    const attackerSummary = view.battleSummary.find((s) => s.side === 'attacker')
    expect(attackerSummary!.unitCount).toBe(1)
    expect(attackerSummary!.totalAttack).toBe(3)
    expect(attackerSummary!.totalHealth).toBe(5)
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

// ---------------------------------------------------------------------------
// undoEndBattle
// ---------------------------------------------------------------------------

describe('undoEndBattle', () => {
  /**
   * A player-vs-player battle with one unit per side placed, ended by the
   * attacker. Returns the state just before and just after pressing End battle.
   */
  function endedPvpBattle(): {
    readonly before: GameState
    readonly ended: GameState
    readonly attackerCardId: string
    readonly defenderCardId: string
  } {
    let state = withBattlehand(CASH1981, 2)
    state = addBattlehand(state, KARANDRAS1, 2)
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))
    const attackerCard = findPlayer(state, CASH1981)!.battlehand[0]!
    const defenderCard = findPlayer(state, KARANDRAS1)!.battlehand[0]!
    state = unwrap(
      placeUnitInArena(state, {
        playerId: CASH1981,
        unitId: attackerCard.id,
        side: 'attacker',
        position: 0,
        attack: attackerCard.attack,
        health: attackerCard.health,
      }),
    )
    state = unwrap(
      placeUnitInArena(state, {
        playerId: KARANDRAS1,
        unitId: defenderCard.id,
        side: 'defender',
        position: 0,
        attack: defenderCard.attack,
        health: defenderCard.health,
      }),
    )
    state = unwrap(endBattleTurn(state, { playerId: KARANDRAS1 }))
    const ended = unwrap(endBattleAction(state, { playerId: CASH1981 }))
    return { before: state, ended, attackerCardId: attackerCard.id, defenderCardId: defenderCard.id }
  }

  const cardInBattle = (state: GameState, playerId: string, cardId: string): boolean | undefined =>
    findPlayer(state, playerId)!.battlehand.find((u) => u.id === cardId)?.inBattle

  it('restores the same arena, turn and units, and locks the source cards again', () => {
    const { before, ended, attackerCardId, defenderCardId } = endedPvpBattle()
    expect(ended.battle).toBeNull()
    expect(cardInBattle(ended, CASH1981, attackerCardId)).toBe(false)

    const restored = unwrap(undoEndBattle(ended, { playerId: CASH1981 }))

    expect(restored.battle).toEqual(before.battle)
    expect(restored.battle?.turn).toBe(before.battle?.turn)
    expect(restored.endedBattle).toBeNull()
    expect(cardInBattle(restored, CASH1981, attackerCardId)).toBe(true)
    expect(cardInBattle(restored, KARANDRAS1, defenderCardId)).toBe(true)
    // inBattle is mirrored on the hand's items, as when a unit is placed
    const item = findPlayer(restored, CASH1981)!.items.find((i) => i.id === attackerCardId)
    expect((item as { inBattle?: boolean }).inBattle).toBe(true)
    // The same players' hands and the rest of the state are back as before
    expect(findPlayer(restored, CASH1981)!.battlehand).toEqual(
      findPlayer(before, CASH1981)!.battlehand,
    )
    expect(restored.items).toEqual(before.items)
  })

  it('logs one public line, with no item, and keeps the earlier "ends the battle" line', () => {
    const { ended } = endedPvpBattle()
    const restored = unwrap(undoEndBattle(ended, { playerId: CASH1981 }))

    expect(restored.log).toHaveLength(ended.log.length + 1)
    expect(restored.log.slice(0, ended.log.length)).toEqual(ended.log)
    const entry = restored.log[restored.log.length - 1]!
    expect(entry.publicLog).toBe('cash1981 undoes ending the battle')
    expect(entry.item).toBeNull()
  })

  it('does not mutate the state it was given', () => {
    const { ended } = endedPvpBattle()
    const snapshot = JSON.stringify(ended)
    unwrap(undoEndBattle(ended, { playerId: CASH1981 }))
    expect(JSON.stringify(ended)).toBe(snapshot)
  })

  it('can only be done once', () => {
    const { ended } = endedPvpBattle()
    const restored = unwrap(undoEndBattle(ended, { playerId: CASH1981 }))
    expect(unwrapErr(undoEndBattle(restored, { playerId: CASH1981 })).kind).toBe(
      'BATTLE_ALREADY_ACTIVE',
    )
  })

  it('can be ended and undone again', () => {
    const { ended } = endedPvpBattle()
    const restored = unwrap(undoEndBattle(ended, { playerId: CASH1981 }))
    const endedAgain = unwrap(endBattleAction(restored, { playerId: KARANDRAS1 }))
    // The ender is whoever pressed it last, not the original ender
    expect(endedAgain.endedBattle?.endedBy).toBe(KARANDRAS1)
    expect(unwrap(undoEndBattle(endedAgain, { playerId: KARANDRAS1 })).battle).not.toBeNull()
  })

  it('only the player who ended the battle may undo it, and a refusal changes nothing', () => {
    const { ended } = endedPvpBattle()
    const snapshot = JSON.stringify(ended)

    // The other participant
    expect(unwrapErr(undoEndBattle(ended, { playerId: KARANDRAS1 })).kind).toBe(
      'NOT_IN_THIS_BATTLE',
    )
    // A player who was not in the battle
    expect(unwrapErr(undoEndBattle(ended, { playerId: ITCHI })).kind).toBe('NOT_IN_THIS_BATTLE')
    // Someone who is not in the game at all
    expect(unwrapErr(undoEndBattle(ended, { playerId: 'nobody' })).kind).toBe('PLAYER_NOT_FOUND')
    expect(JSON.stringify(ended)).toBe(snapshot)
  })

  it('is refused when no battle has been ended', () => {
    const state = firstCivGame()
    expect(unwrapErr(undoEndBattle(state, { playerId: CASH1981 })).kind).toBe('NO_BATTLE_ACTIVE')
  })

  it('is refused once a new battle has been initiated, and initiating clears the snapshot', () => {
    const { ended } = endedPvpBattle()
    expect(ended.endedBattle).not.toBeNull()

    const next = unwrap(initiateBattle(ended, { initiatorId: KARANDRAS1, opponentId: ITCHI }))
    expect(next.endedBattle).toBeNull()
    expect(unwrapErr(undoEndBattle(next, { playerId: CASH1981 })).kind).toBe(
      'BATTLE_ALREADY_ACTIVE',
    )

    // Even after the new battle is over, the first one cannot come back: the
    // snapshot is now the second battle's, and belongs to its ender.
    const nextEnded = unwrap(endBattleAction(next, { playerId: KARANDRAS1 }))
    expect(unwrapErr(undoEndBattle(nextEnded, { playerId: CASH1981 })).kind).toBe(
      'NOT_IN_THIS_BATTLE',
    )
    expect(unwrap(undoEndBattle(nextEnded, { playerId: KARANDRAS1 })).battle?.id).toBe(
      next.battle?.id,
    )
  })

  it('initiating a barbarian battle clears the snapshot too', () => {
    const { ended } = endedPvpBattle()
    const next = unwrap(initiateBattle(ended, { initiatorId: ITCHI, opponentId: 'barbarians' }))
    expect(next.endedBattle).toBeNull()
  })

  it('is not expired by other game actions', () => {
    const { ended } = endedPvpBattle()
    const later = unwrap(draw(ended, { playerId: ITCHI, sheetName: 'INFANTRY', confirmedOutOfTurn: true }))
    expect(unwrap(undoEndBattle(later, { playerId: CASH1981 })).battle).not.toBeNull()
  })

  it('works for a barbarian battle', () => {
    let state = unwrap(
      initiateBattle(firstCivGame(), { initiatorId: CASH1981, opponentId: 'barbarians' }),
    )
    const controllerId = state.battle!.defender.playerId
    const barbarian = findPlayer(state, controllerId)!.barbarians[0]!
    state = unwrap(
      placeUnitInArena(state, {
        playerId: controllerId,
        unitId: barbarian.id,
        side: 'defender',
        position: 0,
        attack: barbarian.attack,
        health: barbarian.health,
      }),
    )
    const before = state
    state = unwrap(endBattleAction(state, { playerId: controllerId }))
    expect(findPlayer(state, controllerId)!.barbarians.find((u) => u.id === barbarian.id)?.inBattle).toBe(false)

    // The barbarian controller ended it, so only they may undo it
    expect(unwrapErr(undoEndBattle(state, { playerId: CASH1981 })).kind).toBe('NOT_IN_THIS_BATTLE')
    const restored = unwrap(undoEndBattle(state, { playerId: controllerId }))

    expect(restored.battle).toEqual(before.battle)
    expect(restored.battle?.defender.kind).toBe('barbarians')
    expect(findPlayer(restored, controllerId)!.barbarians.find((u) => u.id === barbarian.id)?.inBattle).toBe(true)
  })

  it('locks the cards of reinforced-away (departed) units again', () => {
    let state = withBattlehand(CASH1981, 2)
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))
    const [fallen, reinforcement] = findPlayer(state, CASH1981)!.battlehand
    state = unwrap(
      placeUnitInArena(state, {
        playerId: CASH1981,
        unitId: fallen!.id,
        side: 'attacker',
        position: 0,
        attack: fallen!.attack,
        health: fallen!.health,
      }),
    )
    state = unwrap(
      killArenaUnit(state, { playerId: CASH1981, arenaUnitId: state.battle!.arena[0]!.id }),
    )
    state = unwrap(
      placeUnitInArena(state, {
        playerId: CASH1981,
        unitId: reinforcement!.id,
        side: 'attacker',
        position: 0,
        attack: reinforcement!.attack,
        health: reinforcement!.health,
      }),
    )
    expect(state.battle!.departedUnits).toHaveLength(1)
    const before = state

    state = unwrap(endBattleAction(state, { playerId: CASH1981 }))
    expect(cardInBattle(state, CASH1981, fallen!.id)).toBe(false)
    const restored = unwrap(undoEndBattle(state, { playerId: CASH1981 }))

    expect(restored.battle).toEqual(before.battle)
    expect(restored.battle!.departedUnits).toHaveLength(1)
    expect(cardInBattle(restored, CASH1981, fallen!.id)).toBe(true)
    expect(cardInBattle(restored, CASH1981, reinforcement!.id)).toBe(true)
  })

  it('skips a source card that was discarded or removed between end and undo', () => {
    const { ended, attackerCardId } = endedPvpBattle()
    const attacker = findPlayer(ended, CASH1981)!
    // The attacker's card leaves their hand; the defender's player is gone entirely
    const gone: GameState = {
      ...ended,
      players: ended.players
        .filter((p) => p.playerId !== KARANDRAS1)
        .map((p) =>
          p.playerId === CASH1981
            ? {
                ...attacker,
                battlehand: attacker.battlehand.filter((u) => u.id !== attackerCardId),
                items: attacker.items.filter((i) => i.id !== attackerCardId),
              }
            : p,
        ),
    }

    const restored = unwrap(undoEndBattle(gone, { playerId: CASH1981 }))

    expect(restored.battle).toEqual(ended.endedBattle!.battle)
    expect(findPlayer(restored, CASH1981)!.battlehand.some((u) => u.id === attackerCardId)).toBe(false)
    expect(findPlayer(restored, KARANDRAS1)).toBeUndefined()
    // The card that was never placed is left alone
    expect(findPlayer(restored, CASH1981)!.battlehand.every((u) => !u.inBattle)).toBe(true)
  })
})

describe('ending a battle and the projection', () => {
  function endedBattleWithUnits(): {
    readonly ended: GameState
    readonly arenaIds: readonly string[]
    readonly battleId: string
    readonly unitNames: readonly string[]
  } {
    let state = withBattlehand(CASH1981, 2)
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))
    const cards = findPlayer(state, CASH1981)!.battlehand
    cards.forEach((card, position) => {
      state = unwrap(
        placeUnitInArena(state, {
          playerId: CASH1981,
          unitId: card.id,
          side: 'attacker',
          position,
          attack: card.attack,
          health: card.health,
        }),
      )
    })
    const battle = state.battle!
    const ended = unwrap(endBattleAction(state, { playerId: CASH1981 }))
    return {
      ended,
      arenaIds: battle.arena.map((u) => u.id),
      battleId: battle.id,
      unitNames: battle.arena.map((u) => revealAll(u.unit)),
    }
  }

  it('exposes only who ended the battle, never the snapshot, to any viewer', () => {
    const { ended, arenaIds, battleId } = endedBattleWithUnits()

    for (const viewer of [CASH1981, KARANDRAS1, ITCHI, 'a-spectator']) {
      const view = toPlayerView(ended, viewer)
      expect(view.battle).toBeNull()
      expect(view.battleUndo).toEqual({ endedBy: CASH1981 })
      expect(Object.keys(view.battleUndo ?? {})).toEqual(['endedBy'])
      const json = JSON.stringify(view)
      expect(json).not.toContain('endedBattle')
      expect(json).not.toContain(battleId)
      for (const id of arenaIds) expect(json).not.toContain(id)
    }
  })

  it('has no battleUndo before a battle is ended, while one is running, or after a new one starts', () => {
    expect(toPlayerView(firstCivGame(), CASH1981).battleUndo).toBeNull()

    const { ended } = endedBattleWithUnits()
    const next = unwrap(initiateBattle(ended, { initiatorId: KARANDRAS1, opponentId: ITCHI }))
    expect(toPlayerView(next, CASH1981).battleUndo).toBeNull()

    const restored = unwrap(undoEndBattle(ended, { playerId: CASH1981 }))
    expect(toPlayerView(restored, CASH1981).battleUndo).toBeNull()
  })

  it('ending a battle logs no unit name, in either log, and carries no item', () => {
    const { ended, unitNames } = endedBattleWithUnits()
    expect(unitNames.length).toBeGreaterThan(0)

    const entry = ended.log[ended.log.length - 1]!
    expect(entry.publicLog).toContain('ends the battle')
    expect(entry.item).toBeNull()
    for (const name of unitNames) {
      expect(entry.publicLog).not.toContain(name)
      expect(entry.privateLog).not.toContain(name)
    }
    const restored = unwrap(undoEndBattle(ended, { playerId: CASH1981 }))
    const undoEntry = restored.log[restored.log.length - 1]!
    for (const name of unitNames) {
      expect(undoEntry.publicLog).not.toContain(name)
      expect(undoEntry.privateLog).not.toContain(name)
    }
  })

  it('an old saved game without endedBattle loads with nothing to undo', () => {
    const old = { ...firstCivGame() } as Record<string, unknown>
    delete old['endedBattle']
    const migrated = migrateGameState(old as unknown as GameState)
    expect(migrated.endedBattle).toBeNull()
    expect(toPlayerView(migrated, CASH1981).battleUndo).toBeNull()
  })

  it('a saved snapshot keeps the arena backfills of a live battle when it migrates', () => {
    const { ended } = endedBattleWithUnits()
    const older = JSON.parse(JSON.stringify(ended)) as {
      endedBattle: { battle: { departedUnits?: unknown; arena: { killed?: unknown; rotation?: unknown }[] } }
    }
    delete older.endedBattle.battle.departedUnits
    for (const unit of older.endedBattle.battle.arena) {
      delete unit.killed
      delete unit.rotation
    }
    const migrated = migrateGameState(older as unknown as GameState)
    expect(migrated.endedBattle?.endedBy).toBe(CASH1981)
    expect(migrated.endedBattle?.battle.departedUnits).toEqual([])
    expect(migrated.endedBattle?.battle.arena.every((u) => !u.killed && u.rotation === 0)).toBe(true)
  })
})
