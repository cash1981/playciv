/**
 * The Japanese civilization card: "infantry units have +1 in strength". Strength is the wounds a unit deals
 * (`ArenaUnit.attack`), so the unit is placed with its printed attack plus one, at every level, as attacker or defender.
 */

import { describe, expect, it } from 'vitest'

import {
  arenaUnitTier,
  endBattleTurn,
  initiateBattle,
  placeUnitInArena,
  rotateArenaUnit,
  setArenaUnitStat,
} from '../src/actions/arena.js'
import { draw, drawBarbarians, drawUnitsForBattle } from '../src/actions/draw.js'
import { civilizationAttackBonus } from '../src/civ-strength.js'
import { unwrap } from '../src/result.js'
import { findPlayer, withPlayer } from '../src/state.js'
import type { GameState } from '../src/state.js'

import { withCivilization } from './culture-advance-fixture.js'
import { CASH1981, KARANDRAS1, firstCivGame } from './fixture.js'

type Kind = 'infantry' | 'artillery' | 'mounted'

/** A battle of Cash (attacker) and Karandras1 (defender), each with one battle-hand unit of the given kind. */
function battle(kinds: { attacker: Kind; defender: Kind }, japanese: readonly string[]): GameState {
  let state = firstCivGame()
  for (const playerId of [CASH1981, KARANDRAS1]) {
    state = unwrap(draw(state, { playerId, sheetName: 'INFANTRY', confirmedOutOfTurn: true }))
    state = unwrap(drawUnitsForBattle(state, { playerId, numberOfDraws: 1 }))
    const player = findPlayer(state, playerId)!
    const kind = playerId === CASH1981 ? kinds.attacker : kinds.defender
    state = withPlayer(state, {
      ...player,
      battlehand: player.battlehand.map((u) => ({ ...u, kind }) as typeof u),
    })
  }
  for (const playerId of japanese) state = withCivilization(state, 'Japanese', playerId)
  return unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))
}

/** Places the player's battle-hand unit with the printed attack and health, or the given ones. */
function place(
  state: GameState,
  playerId: string,
  stats: { attack?: number; health?: number } = {},
  position = 0,
): GameState {
  const unit = findPlayer(state, playerId)!.battlehand[0]!
  return unwrap(
    placeUnitInArena(state, {
      playerId,
      unitId: unit.id,
      side: playerId === CASH1981 ? 'attacker' : 'defender',
      position,
      attack: stats.attack ?? unit.attack,
      health: stats.health ?? unit.health,
    }),
  )
}

const arenaUnit = (state: GameState, playerId: string) => state.battle!.arena.find((u) => u.placedBy === playerId)!
const printed = (state: GameState, playerId: string) => findPlayer(state, playerId)!.battlehand[0]!

describe('Japanese infantry strength', () => {
  it('adds one to the attack of a Japanese infantry unit placed as attacker', () => {
    const start = battle({ attacker: 'infantry', defender: 'infantry' }, [CASH1981])
    const state = place(start, CASH1981)
    const unit = arenaUnit(state, CASH1981)
    expect(unit.attack).toBe(printed(start, CASH1981).attack + 1)
    expect(unit.health).toBe(printed(start, CASH1981).health)
    expect(unit.attackBonus).toBe(1)
  })

  it('adds one to the attack of a Japanese infantry unit placed as defender', () => {
    const start = battle({ attacker: 'infantry', defender: 'infantry' }, [KARANDRAS1])
    const state = place(start, KARANDRAS1)
    expect(arenaUnit(state, KARANDRAS1).attack).toBe(printed(start, KARANDRAS1).attack + 1)
    expect(arenaUnit(state, KARANDRAS1).attackBonus).toBe(1)
  })

  it('adds it to the attack the client sends, not to the card', () => {
    const start = battle({ attacker: 'infantry', defender: 'infantry' }, [CASH1981])
    expect(arenaUnit(place(start, CASH1981, { attack: 4, health: 5 }), CASH1981)).toMatchObject({ attack: 5, health: 5 })
  })

  it.each(['mounted', 'artillery'] as const)('gives a Japanese %s unit nothing', (kind) => {
    const start = battle({ attacker: kind, defender: 'infantry' }, [CASH1981])
    const unit = arenaUnit(place(start, CASH1981), CASH1981)
    expect(unit.attack).toBe(printed(start, CASH1981).attack)
    expect(unit.attackBonus).toBeUndefined()
  })

  it('gives a non-Japanese infantry unit nothing, also when its opponent is Japanese', () => {
    const start = battle({ attacker: 'infantry', defender: 'infantry' }, [KARANDRAS1])
    const unit = arenaUnit(place(start, CASH1981), CASH1981)
    expect(unit.attack).toBe(printed(start, CASH1981).attack)
    expect('attackBonus' in unit).toBe(false)
  })

  it('gives a barbarian unit a Japanese player controls nothing', () => {
    let state = withCivilization(firstCivGame(), 'Japanese', KARANDRAS1)
    state = unwrap(drawBarbarians(state, KARANDRAS1))
    const controller = findPlayer(state, KARANDRAS1)!
    state = withPlayer(state, { ...controller, barbarians: controller.barbarians.map((u) => ({ ...u, kind: 'infantry' }) as typeof u) })
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: 'barbarians' }))
    const barbarian = findPlayer(state, KARANDRAS1)!.barbarians[0]!
    state = unwrap(
      placeUnitInArena(state, {
        playerId: KARANDRAS1, unitId: barbarian.id, side: 'defender', position: 0, attack: barbarian.attack, health: barbarian.health,
      }),
    )
    const unit = state.battle!.arena[0]!
    expect(unit.attack).toBe(barbarian.attack)
    expect(unit.attackBonus).toBeUndefined()
  })

  it('keeps the bonus at every rotation level, and wraps back to printed + 1', () => {
    const start = battle({ attacker: 'infantry', defender: 'infantry' }, [CASH1981])
    let state = place(start, CASH1981)
    const id = arenaUnit(state, CASH1981).id
    const base = printed(start, CASH1981)
    for (const level of [1, 2, 3, 0]) {
      state = unwrap(rotateArenaUnit(state, { playerId: CASH1981, arenaUnitId: id }))
      const unit = arenaUnit(state, CASH1981)
      expect(unit.attack).toBe(base.attack + 1 + level)
      expect(unit.health).toBe(base.health + level)
      expect(unit.attackBonus).toBe(1)
    }
  })

  it('shows it in arenaUnitTier, which the card label reads, and not in the health', () => {
    const start = battle({ attacker: 'infantry', defender: 'infantry' }, [CASH1981])
    let state = place(start, CASH1981)
    const base = printed(start, CASH1981)
    expect(arenaUnitTier(arenaUnit(state, CASH1981))).toEqual({ attack: base.attack + 1, health: base.health })
    state = unwrap(rotateArenaUnit(state, { playerId: CASH1981, arenaUnitId: arenaUnit(state, CASH1981).id }))
    expect(arenaUnitTier(arenaUnit(state, CASH1981))).toEqual({ attack: base.attack + 2, health: base.health + 1 })
  })

  it('wins a first strike the printed attack would lose: infantry trumps mounted only when its attack kills', () => {
    // Defender: mounted, 1 attack, 2 health. The attacker is infantry with 1 printed attack.
    const run = (japanese: readonly string[]) => {
      const start = battle({ attacker: 'infantry', defender: 'mounted' }, japanese)
      const state = place(place(start, KARANDRAS1, { attack: 1, health: 2 }), CASH1981, { attack: 1, health: 3 })
      return { attacker: arenaUnit(state, CASH1981), defender: arenaUnit(state, KARANDRAS1) }
    }
    const plain = run([])
    expect(plain.defender.killed).toBe(false)
    expect(plain.defender.health).toBe(1)
    expect(plain.attacker.health).toBe(2)

    const japanese = run([CASH1981])
    expect(japanese.defender.killed).toBe(true)
    expect(japanese.defender.health).toBe(0)
    expect(japanese.attacker.killed).toBe(false)
    expect(japanese.attacker.health).toBe(3)
  })

  it('treats an arena unit without attackBonus as before', () => {
    const start = battle({ attacker: 'infantry', defender: 'infantry' }, [CASH1981])
    const placed = arenaUnit(place(start, CASH1981), CASH1981)
    const { attackBonus: _dropped, ...old } = placed
    const state: GameState = {
      ...place(start, CASH1981),
      battle: { ...place(start, CASH1981).battle!, arena: [old] },
    }
    expect(arenaUnitTier(old).attack).toBe(placed.unit.attack)
    const rotated = unwrap(rotateArenaUnit(state, { playerId: CASH1981, arenaUnitId: old.id }))
    expect(arenaUnit(rotated, CASH1981).attack).toBe(placed.unit.attack + 1)
  })

  it('lets a hand edit win', () => {
    const start = battle({ attacker: 'infantry', defender: 'infantry' }, [CASH1981])
    let state = place(start, CASH1981)
    state = unwrap(setArenaUnitStat(state, { playerId: CASH1981, arenaUnitId: arenaUnit(state, CASH1981).id, key: 'attack', value: 7 }))
    expect(arenaUnit(state, CASH1981).attack).toBe(7)
    expect(arenaUnitTier(arenaUnit(state, CASH1981)).attack).toBe(printed(start, CASH1981).attack + 1)
  })

  it('names the bonus in the placement log line, only for the units that get it', () => {
    const japanese = battle({ attacker: 'infantry', defender: 'infantry' }, [CASH1981])
    let state = place(japanese, CASH1981)
    state = unwrap(endBattleTurn(unwrap(endBattleTurn(state, { playerId: KARANDRAS1 })), { playerId: CASH1981 }))
    const line = state.log.map((e) => e.publicLog).find((text) => text.includes('into the arena')) ?? ''
    expect(line).toMatch(/\(\d+\/\d+\) \(\+1 Japanese strength\) into the arena$/)

    const plain = battle({ attacker: 'infantry', defender: 'infantry' }, [])
    let other = place(plain, CASH1981)
    other = unwrap(endBattleTurn(unwrap(endBattleTurn(other, { playerId: KARANDRAS1 })), { playerId: CASH1981 }))
    const plainLine = other.log.map((e) => e.publicLog).find((text) => text.includes('into the arena')) ?? ''
    expect(plainLine).toMatch(/\(\d+\/\d+\) into the arena$/)
  })

  it('is a function of civilization and kind only', () => {
    const japan = { civilization: { kind: 'civ', name: 'Japanese' } } as unknown as Parameters<typeof civilizationAttackBonus>[0]
    const rome = { civilization: { kind: 'civ', name: 'Romans' } } as unknown as Parameters<typeof civilizationAttackBonus>[0]
    expect(civilizationAttackBonus(japan, { kind: 'infantry' })).toBe(1)
    expect(civilizationAttackBonus(japan, { kind: 'mounted' })).toBe(0)
    expect(civilizationAttackBonus(japan, { kind: 'aircraft' })).toBe(0)
    expect(civilizationAttackBonus(rome, { kind: 'infantry' })).toBe(0)
    expect(civilizationAttackBonus({ civilization: null }, { kind: 'infantry' })).toBe(0)
  })
})
