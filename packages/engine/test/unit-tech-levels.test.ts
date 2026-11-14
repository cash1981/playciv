/**
 * Revealing a unit tech raises the level of that unit type automatically (issue #327), and never lowers it.
 * The table is `UNIT_LEVEL_TECHS` (the Military Unit table of the tech reference sheet); Flight unlocks aircraft.
 */

import { describe, expect, it } from 'vitest'

import { chooseTech, revealTech } from '../src/actions/player.js'
import { UNIT_LEVEL_TECHS } from '../src/build-item.js'
import type { UnitType } from '../src/build-item.js'
import { unwrap } from '../src/result.js'
import type { GameState } from '../src/state.js'

import { player } from './assisted-fixture.js'
import { CASH1981, KARANDRAS1, firstCivGame } from './fixture.js'

const reveal = (state: GameState, techName: string, playerId = CASH1981): GameState =>
  unwrap(revealTech(unwrap(chooseTech(state, { playerId, techName })), { playerId, techName }))

const LEVELS = [
  ['Chivalry', 'mounted', 2],
  ['Democracy', 'infantry', 2],
  ['Mathematics', 'artillery', 2],
  ['Logistics', 'infantry', 2],
  ['Logistics', 'artillery', 2],
  ['Logistics', 'mounted', 2],
  ['Gunpowder', 'infantry', 3],
  ['Metal Casting', 'artillery', 3],
  ['Railroad', 'mounted', 3],
  ['Combustion', 'mounted', 4],
  ['Replacement Parts', 'infantry', 4],
  ['Ballistics', 'artillery', 4],
] as const

describe('revealing a unit tech', () => {
  it.each(LEVELS)('%s raises %s to level %i, and nothing else', (techName, unitType, level) => {
    const before = player(firstCivGame()).stats
    const after = player(reveal(firstCivGame(), techName)).stats
    expect(after[unitType]).toBe(level)
    for (const other of ['infantry', 'artillery', 'mounted'] as const) {
      const raised = UNIT_LEVEL_TECHS[other][techName]
      if (other !== unitType && raised === undefined) expect(after[other]).toBe(before[other])
    }
  })

  it('does not raise it while the tech is only chosen and still hidden', () => {
    const chosen = unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Gunpowder' }))
    expect(player(chosen).stats.infantry).toBe(1)
  })

  it('never lowers a level the player already has, and does not touch another player', () => {
    const high = reveal(reveal(firstCivGame(), 'Gunpowder'), 'Democracy')
    expect(player(high).stats.infantry).toBe(3)
    expect(player(high, KARANDRAS1).stats.infantry).toBe(1)
  })

  it('every unit tech in the table is covered above', () => {
    const covered = new Set(LEVELS.map(([techName, unitType]) => `${unitType}:${techName}`))
    for (const unitType of ['infantry', 'artillery', 'mounted'] as const satisfies readonly Exclude<UnitType, 'aircraft'>[]) {
      for (const techName of Object.keys(UNIT_LEVEL_TECHS[unitType])) expect(covered.has(`${unitType}:${techName}`)).toBe(true)
    }
  })

  it('Flight unlocks aircraft', () => {
    expect(player(firstCivGame()).stats.aircraft).toBe(false)
    expect(player(reveal(firstCivGame(), 'Flight')).stats.aircraft).toBe(true)
  })
})
