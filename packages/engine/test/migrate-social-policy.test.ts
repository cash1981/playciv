/**
 * Issue #175: `Military Tradition`'s flipside was recorded as `Patronage`
 * instead of `Pacifism` until `gamedata.ts` started correcting it (see
 * decisions.md, 2026-09-25). A game saved before that fix froze the old
 * value into its own `socialPolicies` when the card was dealt, so it needs
 * the same correction on read, not just a fresh deal.
 */

import { describe, expect, it } from 'vitest'

import { chooseSocialPolicy } from '../src/actions/player.js'
import { migrateGameState } from '../src/migrate.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { findPlayer } from '../src/state.js'

import { CASH1981, firstCivGame } from './fixture.js'

/** Simulates a game saved before the correction existed. */
function withOldFlipside(state: GameState): GameState {
  const brokenFlipside = (name: string, flipside: string | null): string | null =>
    name === 'Military Tradition' ? 'Patronage' : flipside

  return {
    ...state,
    socialPolicies: state.socialPolicies.map((policy) => ({
      ...policy,
      flipside: brokenFlipside(policy.name, policy.flipside),
    })),
    players: state.players.map((player) => ({
      ...player,
      socialPolicies: player.socialPolicies.map((policy) => ({
        ...policy,
        flipside: brokenFlipside(policy.name, policy.flipside),
      })),
    })),
  }
}

describe('migrating the social policy flipside (issue #175)', () => {
  it('corrects the catalogue in an old save', () => {
    const migrated = migrateGameState(withOldFlipside(firstCivGame()))
    const militaryTradition = migrated.socialPolicies.find(
      (policy) => policy.name === 'Military Tradition',
    )
    expect(militaryTradition?.flipside).toBe('Pacifism')
  })

  it('corrects a card a player already chose under the old value', () => {
    const original = firstCivGame()
    const chosen = unwrap(
      chooseSocialPolicy(original, { playerId: CASH1981, name: 'Military Tradition' }),
    )
    const migrated = migrateGameState(withOldFlipside(chosen))
    const held = findPlayer(migrated, CASH1981)?.socialPolicies.find(
      (policy) => policy.name === 'Military Tradition',
    )
    expect(held?.flipside).toBe('Pacifism')

    // And the engine now rejects Pacifism, exactly like a freshly dealt game.
    const error = unwrapErr(
      chooseSocialPolicy(migrated, { playerId: CASH1981, name: 'Pacifism' }),
    )
    expect(error.kind).toBe('SOCIAL_POLICY_FLIPSIDE_TAKEN')
  })
})
