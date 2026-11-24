/**
 * How many social policies a player may hold (issue #378, Wisdom and Warfare rulebook p. 10): one per built city, one more
 * for the French; derived from the board, enforced on choosing, never on removing.
 */

import { describe, expect, it } from 'vitest'

import { undoLastBoardChange } from '../src/actions/board.js'
import { chooseSocialPolicy, removeSocialPolicy, setPlayerGovernment } from '../src/actions/player.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { socialPolicySlots } from '../src/social-policy-slots.js'
import type { GameState, Playerhand } from '../src/state.js'
import { findPlayer, toPlayerView, withPlayer } from '../src/state.js'
import { ownCityPieces } from '../src/city-founding.js'

import { withCivilization } from './culture-advance-fixture.js'
import { CASH1981, KARANDRAS1, firstCivGame } from './fixture.js'
import { put } from './sot-fixture.js'

const CITY = 'cities/redcity2'

const me = (state: GameState): Playerhand => {
  const found = findPlayer(state, CASH1981)
  if (found === undefined) throw new Error('no cash1981')
  return found
}
const slots = (state: GameState) => socialPolicySlots(state, me(state))

/** The names of policies that are no flipside of each other. */
function policyNames(state: GameState, count: number): readonly string[] {
  const names: string[] = []
  for (const policy of state.socialPolicies) {
    if (names.length === count) break
    if (policy.flipside !== null && names.includes(policy.flipside)) continue
    names.push(policy.name)
  }
  return names
}

const choose = (state: GameState, name: string) => chooseSocialPolicy(state, { playerId: CASH1981, name })
const withCities = (state: GameState, count: number): GameState => {
  let next = state
  for (let index = 0; index < count; index += 1) next = put(next, CASH1981, CITY, 1 + index * 3, 1)
  return next
}

describe('socialPolicySlots', () => {
  it('allows one policy with no city yet (the starting policy comes before the capital) and with one city', () => {
    const game = firstCivGame()
    expect(slots(game)).toEqual({ maximum: 1, held: 0, free: 1 })
    expect(slots(withCities(game, 1))).toEqual({ maximum: 1, held: 0, free: 1 })
  })

  it('allows one per built city', () => {
    expect(slots(withCities(firstCivGame(), 3))).toEqual({ maximum: 3, held: 0, free: 3 })
  })

  it('allows the French one more: two at the start, cities plus one after', () => {
    const french = withCivilization(firstCivGame(), 'French')
    expect(slots(french)).toEqual({ maximum: 2, held: 0, free: 2 })
    expect(slots(withCities(french, 1))).toEqual({ maximum: 2, held: 0, free: 2 })
    expect(slots(withCities(french, 2))).toEqual({ maximum: 3, held: 0, free: 3 })
  })

  it('holds a player whose setup is finished to the cities they really have: no floor of one, the French keep their extra', () => {
    const finished = (state: GameState): GameState =>
      withPlayer(state, { ...me(state), setup: { required: true, finished: true, placed: [], historyIds: [] } })
    const game = finished(firstCivGame())
    expect(slots(game)).toEqual({ maximum: 0, held: 0, free: 0 })
    expect(unwrapErr(choose(game, policyNames(game, 1)[0] as string)).kind).toBe('SOCIAL_POLICY_LIMIT')
    expect(slots(withCities(game, 1)).maximum).toBe(1)
    expect(slots(finished(withCivilization(firstCivGame(), 'French'))).maximum).toBe(1)
    // Until setup is finished the starting policy can come before the capital
    const open = withPlayer(firstCivGame(), { ...me(firstCivGame()), setup: { required: true, finished: false, placed: [], historyIds: [] } })
    expect(slots(open).maximum).toBe(1)
  })

  it('counts a city piece only when its centre is on the map: not off the board, not in a player area', () => {
    const game = withCities(firstCivGame(), 1)
    expect(ownCityPieces(game, me(game))).toHaveLength(1)
    const moved = (x: number, y: number): GameState => ({
      ...game,
      board: { ...game.board, pieces: game.board.pieces.map((piece) => (piece.category === 'city' ? { ...piece, x, y } : piece)) },
    })
    expect(ownCityPieces(moved(-4000, -4000), me(game))).toHaveLength(0)
    expect(slots(moved(-4000, -4000)).maximum).toBe(1) // only the floor of the starting policy
  })

  it("does not count another player's city", () => {
    const game = put(firstCivGame(), KARANDRAS1, CITY, 1, 1)
    expect(slots(game).maximum).toBe(1)
  })
})

describe('choosing a social policy', () => {
  it('is refused at the maximum, naming the maximum and the held count, and changes nothing', () => {
    const game = firstCivGame()
    const [first, second] = policyNames(game, 2)
    const held = unwrap(choose(game, first as string))
    expect(unwrapErr(choose(held, second as string))).toEqual({ kind: 'SOCIAL_POLICY_LIMIT', maximum: 1, held: 1 })
    expect(me(held).socialPolicies).toHaveLength(1)
  })

  it('keeps the flipside and the same-card refusals ahead of the cap', () => {
    const game = firstCivGame()
    const [first] = policyNames(game, 1)
    const held = unwrap(choose(game, first as string))
    expect(unwrapErr(choose(held, first as string)).kind).toBe('SOCIAL_POLICY_ALREADY_CHOSEN')
  })

  it('takes a second policy once a second city is built, and refuses a third', () => {
    const game = withCities(firstCivGame(), 2)
    const [first, second, third] = policyNames(game, 3)
    const held = unwrap(choose(unwrap(choose(game, first as string)), second as string))
    expect(slots(held)).toEqual({ maximum: 2, held: 2, free: 0 })
    expect(unwrapErr(choose(held, third as string)).kind).toBe('SOCIAL_POLICY_LIMIT')
  })

  it('lets the French hold two at the start', () => {
    const french = withCivilization(firstCivGame(), 'French')
    const [first, second, third] = policyNames(french, 3)
    const held = unwrap(choose(unwrap(choose(french, first as string)), second as string))
    expect(slots(held).free).toBe(0)
    expect(unwrapErr(choose(held, third as string)).kind).toBe('SOCIAL_POLICY_LIMIT')
  })

  it('switches by removing one, then choosing: the count is unchanged', () => {
    const game = firstCivGame()
    const [first, second] = policyNames(game, 2)
    const held = unwrap(choose(game, first as string))
    const removed = unwrap(removeSocialPolicy(held, { playerId: CASH1981, name: first as string }))
    expect(slots(removed)).toEqual({ maximum: 1, held: 0, free: 1 })
    const switched = unwrap(choose(removed, second as string))
    expect(slots(switched)).toEqual({ maximum: 1, held: 1, free: 0 })
  })

  it('keeps the policies in Anarchy: they still count', () => {
    const game = firstCivGame()
    const [first, second] = policyNames(game, 2)
    const held = unwrap(choose(game, first as string))
    const anarchy = unwrap(setPlayerGovernment(held, { editorPlayerId: CASH1981, targetPlayerId: CASH1981, government: 'Anarchy' }))
    expect(me(anarchy).socialPolicies).toHaveLength(1)
    expect(slots(anarchy)).toEqual({ maximum: 1, held: 1, free: 0 })
    expect(unwrapErr(choose(anarchy, second as string)).kind).toBe('SOCIAL_POLICY_LIMIT')
  })
})

describe('a city that goes away', () => {
  it('leaves the player over the maximum without a throw: free is 0, nothing is removed, choosing is refused', () => {
    const twoCities = withCities(firstCivGame(), 2)
    const [first, second, third] = policyNames(twoCities, 3)
    const held = unwrap(choose(unwrap(choose(twoCities, first as string)), second as string))
    const undone = unwrap(undoLastBoardChange(held, CASH1981))
    expect(slots(undone)).toEqual({ maximum: 1, held: 2, free: 0 })
    expect(me(undone).socialPolicies).toHaveLength(2)
    expect(unwrapErr(choose(undone, third as string)).kind).toBe('SOCIAL_POLICY_LIMIT')
    // The player may still return one by hand
    const returned = unwrap(removeSocialPolicy(undone, { playerId: CASH1981, name: first as string }))
    expect(slots(returned)).toEqual({ maximum: 1, held: 1, free: 0 })
  })
})

describe('the view of the slots', () => {
  it('gives the owner counts only, and an opponent no such field and an unchanged public count', () => {
    const game = withCities(firstCivGame(), 2)
    const [first] = policyNames(game, 1)
    const held = unwrap(choose(game, first as string))
    const own = toPlayerView(held, CASH1981)
    expect(own.you?.socialPolicySlots).toEqual({ maximum: 2, held: 1, free: 1 })
    expect(Object.keys(own.you?.socialPolicySlots ?? {}).sort()).toEqual(['free', 'held', 'maximum'])
    expect(JSON.stringify(own.you?.socialPolicySlots)).not.toContain(first as string)

    const other = toPlayerView(held, KARANDRAS1)
    expect(other.you?.socialPolicySlots?.held).toBe(0)
    const asSeen = other.opponents.find((opponent) => opponent.playerId === CASH1981)
    expect(asSeen).toBeDefined()
    expect(asSeen).not.toHaveProperty('socialPolicySlots')
    expect(asSeen?.numberOfSocialPolicies).toBe(1)
    expect(JSON.stringify(other.opponents)).not.toContain('maximum')
  })
})
