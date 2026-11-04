/**
 * Nikola Tesla (issue #301): "Research: You may discard this card when adding a tech of level II, III, or IV to your
 * tech pyramid to place it one level lower in the pyramid than normal." The human (2026-11-03): the trade of the
 * tech's own level is still needed, so a level III tech needs 16 trade to be put in the level II row.
 */

import { describe, expect, it } from 'vitest'

import { chooseTech, removeTech, setTechSlot } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { performAssistedAction } from '../src/assisted.js'
import { playableCardsOf } from '../src/assisted-cards.js'
import type { TechItem } from '../src/item.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { GameState, Playerhand } from '../src/state.js'
import { unwrap } from '../src/result.js'

import { withCardInHand } from './assisted-fixture.js'
import { withStats } from './culture-advance-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-11-03T10:00:00.000Z'
const OTHERS = [KARANDRAS1, ITCHI, CHUL]

const me = (state: GameState): Playerhand => {
  const found = findPlayer(state, CASH1981)
  if (found === undefined) throw new Error('no cash1981')
  return found
}

/** The first tech of a level in the catalogue the player has not chosen, skipping `skip` of them. */
const techOfLevel = (state: GameState, level: number, skip = 0): TechItem => {
  const found = state.techs.filter((tech) => tech.level === level)[skip]
  if (found === undefined) throw new Error(`no level ${level} tech`)
  return found
}

/** The Research phase of turn 1, with the trade given. */
const research = (trade: number): GameState =>
  withStats(unwrap(markPhasesDone(firstCivGame(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'MOVEMENT' })), { trade })

const learn = (state: GameState, tech: TechItem): GameState => unwrap(chooseTech(state, { playerId: CASH1981, techName: tech.name }))

const rowOf = (state: GameState, name: string): number | undefined => {
  const tech = me(state).techsChosen.find((candidate) => candidate.name === name)
  return tech === undefined ? undefined : (tech.slot ?? tech.level)
}

const play = (state: GameState, itemId: string, tech: string | undefined, requestId = 'tesla-1') =>
  performAssistedAction(state, {
    playerId: CASH1981,
    action: 'playCard',
    requestId,
    at: AT,
    payload: { itemId, targets: [], ...(tech === undefined ? {} : { tech }) },
  })

const card = (state: GameState, itemId: string) => playableCardsOf(state, me(state)).find((entry) => entry.itemId === itemId)

function undoByVote(state: GameState, requestId: string): GameState {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line for the action')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of OTHERS) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  return next
}

describe('Nikola Tesla', () => {
  it('places a level III tech in the level II row when the player has the 16 trade it costs, and discards the card', () => {
    const tech = techOfLevel(firstCivGame(), 3)
    const held = withCardInHand(learn(research(16), tech), 'Nikola Tesla')
    expect(card(held.state, held.itemId)).toMatchObject({ status: 'ready', tesla: [{ name: tech.name, level: 3, trade: 16, to: 2 }] })

    const played = unwrap(play(held.state, held.itemId, tech.name))
    expect(rowOf(played, tech.name)).toBe(2)
    // Only the row it is shown in moves: it is still a level III tech
    expect(me(played).techsChosen.find((candidate) => candidate.name === tech.name)?.level).toBe(3)
    expect(me(played).items.some((item) => item.id === held.itemId)).toBe(false)
    expect(played.discardedItems.some((item) => item.id === held.itemId)).toBe(true)
  })

  it('needs the trade of the tech\'s own level: a level III tech with 15 trade is refused', () => {
    const tech = techOfLevel(firstCivGame(), 3)
    const held = withCardInHand(learn(research(15), tech), 'Nikola Tesla')
    const listed = card(held.state, held.itemId)
    expect(listed?.status).toBe('unavailable')
    expect(listed?.reason).toContain('needs 16 trade')
    expect(play(held.state, held.itemId, tech.name).ok).toBe(false)
    // Fixed by trade alone: with 16 it works
    expect(card(withStats(held.state, { trade: 16 }), held.itemId)?.status).toBe('ready')
  })

  it('costs 11 trade for a level II tech and 21 for a level IV tech', () => {
    const two = techOfLevel(firstCivGame(), 2)
    const lowTwo = withCardInHand(learn(research(10), two), 'Nikola Tesla')
    expect(card(lowTwo.state, lowTwo.itemId)?.status).toBe('unavailable')
    const okTwo = withCardInHand(learn(research(11), two), 'Nikola Tesla')
    expect(card(okTwo.state, okTwo.itemId)?.status).toBe('ready')

    const four = techOfLevel(firstCivGame(), 4)
    const lowFour = withCardInHand(learn(research(20), four), 'Nikola Tesla')
    expect(card(lowFour.state, lowFour.itemId)?.status).toBe('unavailable')
    const okFour = withCardInHand(learn(research(21), four), 'Nikola Tesla')
    expect(card(okFour.state, okFour.itemId)?.status).toBe('ready')
    expect(rowOf(unwrap(play(okFour.state, okFour.itemId, four.name)), four.name)).toBe(3)
  })

  it('does not place a level I or a level V tech', () => {
    const one = techOfLevel(firstCivGame(), 1, 1)
    const held = withCardInHand(learn(research(30), one), 'Nikola Tesla')
    expect(card(held.state, held.itemId)?.status).toBe('unavailable')
    expect(play(held.state, held.itemId, one.name).ok).toBe(false)
  })

  it('moves only a tech added in this Research phase, and only in Research', () => {
    const tech = techOfLevel(firstCivGame(), 3)
    // Learned in Start of Turn, for instance with a free tech, so not added in Research
    const early = unwrap(chooseTech(withStats(firstCivGame(), { trade: 16 }), { playerId: CASH1981, techName: tech.name }))
    const sot = withCardInHand(early, 'Nikola Tesla')
    expect(card(sot.state, sot.itemId)?.status).toBe('wrong-phase')

    const inResearch = withCardInHand(withStats(unwrap(markPhasesDone(early, { playerId: CASH1981, turnNumber: 1, upToPhase: 'MOVEMENT' })), { trade: 16 }), 'Nikola Tesla')
    expect(card(inResearch.state, inResearch.itemId)?.status).toBe('unavailable')
    expect(card(inResearch.state, inResearch.itemId)?.reason).toContain('just added to your pyramid in Research')
  })

  it('refuses when the row one level lower is full', () => {
    // The level II row holds 4 techs
    const base = research(16)
    const twos = [0, 1, 2, 3].map((index) => techOfLevel(base, 2, index))
    const filled = twos.reduce(learn, base)
    const tech = techOfLevel(base, 3)
    const held = withCardInHand(learn(filled, tech), 'Nikola Tesla')
    // The level II techs can still go to the level I row, but the level III tech has no place in the full level II row
    const offered = card(held.state, held.itemId)?.tesla?.map((choice) => choice.name) ?? []
    expect(offered).not.toContain(tech.name)
    expect(offered).toEqual(twos.map((two) => two.name))
    const refused = play(held.state, held.itemId, tech.name)
    expect(refused.ok).toBe(false)
    expect(JSON.stringify(refused)).toContain('level 2 row of your pyramid is full')
  })

  it('counts a Great Person placed by Newton in the row, and does not offer a tech already moved by hand', () => {
    const base = research(16)
    const twos = [0, 1, 2].map((index) => techOfLevel(base, 2, index))
    const tech = techOfLevel(base, 3)
    const withPlacement = (state: GameState): GameState => ({
      ...state,
      players: state.players.map((hand) =>
        hand.playerId === CASH1981 ? { ...hand, pyramidPlacements: [{ name: 'Sir Isaac Newton', slot: 2 }] } : hand,
      ),
    })
    // Three level II techs and Newton fill the four places of the level II row
    const full = withCardInHand(withPlacement(learn(twos.reduce(learn, base), tech)), 'Nikola Tesla')
    expect(card(full.state, full.itemId)?.tesla?.map((choice) => choice.name)).not.toContain(tech.name)

    const handMoved = unwrap(setTechSlot(learn(base, tech), { playerId: CASH1981, techName: tech.name, slot: 2 }))
    const held = withCardInHand(handMoved, 'Nikola Tesla')
    expect(card(held.state, held.itemId)?.status).toBe('unavailable')
  })

  it('refuses a tech the player has not chosen, and without a choice', () => {
    const tech = techOfLevel(firstCivGame(), 3)
    const held = withCardInHand(learn(research(16), tech), 'Nikola Tesla')
    expect(play(held.state, held.itemId, undefined).ok).toBe(false)
    expect(play(held.state, held.itemId, techOfLevel(firstCivGame(), 3, 1).name).ok).toBe(false)
    expect(me(held.state).items.some((item) => item.id === held.itemId)).toBe(true)
  })

  it('is undone by a vote, which puts the tech back in its own row and the card in the hand', () => {
    const tech = techOfLevel(firstCivGame(), 3)
    const held = withCardInHand(learn(research(16), tech), 'Nikola Tesla')
    const played = unwrap(play(held.state, held.itemId, tech.name))
    const undone = undoByVote(played, 'tesla-1')
    expect(rowOf(undone, tech.name)).toBe(3)
    expect(me(undone).techsChosen.find((candidate) => candidate.name === tech.name)?.slot).toBeUndefined()
    expect(me(undone).items.some((item) => item.id === held.itemId)).toBe(true)
  })

  it('cannot be undone once the tech has been moved to another row or removed', () => {
    const tech = techOfLevel(firstCivGame(), 3)
    const held = withCardInHand(learn(research(16), tech), 'Nikola Tesla')
    const played = unwrap(play(held.state, held.itemId, tech.name))
    const entry = played.log.find((candidate) => candidate.assistedActionId === 'tesla-1')
    if (entry === undefined) throw new Error('no log line')

    // The undo is refused when the votes are in, as for every card whose effect was changed afterwards
    const refusedAfter = (state: GameState) => {
      let result = initiateUndo(state, { logId: entry.id, playerId: CASH1981 })
      for (const playerId of OTHERS) {
        if (!result.ok) break
        result = vote(result.value, { logId: entry.id, playerId, vote: true, at: AT })
      }
      return result
    }
    const moved = unwrap(setTechSlot(played, { playerId: CASH1981, techName: tech.name, slot: 1 }))
    const movedResult = refusedAfter(moved)
    expect(movedResult.ok).toBe(false)
    expect(JSON.stringify(movedResult)).toContain('This action can no longer be undone because its effect has changed.')
    const removedResult = refusedAfter(unwrap(removeTech(played, { playerId: CASH1981, techName: tech.name })))
    expect(removedResult.ok).toBe(false)
    expect(JSON.stringify(removedResult)).toContain('This action can no longer be undone because its effect has changed.')
  })

  it('does not reveal a hidden tech when a non-owner vote cannot undo Tesla', () => {
    const tech = techOfLevel(firstCivGame(), 3)
    const held = withCardInHand(learn(research(16), tech), 'Nikola Tesla')
    const played = unwrap(play(held.state, held.itemId, tech.name))
    const entry = played.log.find((candidate) => candidate.assistedActionId === 'tesla-1')
    if (entry === undefined) throw new Error('no log line')

    const moved = unwrap(setTechSlot(played, { playerId: CASH1981, techName: tech.name, slot: 1 }))
    const requested = unwrap(initiateUndo(moved, { logId: entry.id, playerId: CASH1981 }))
    const firstVote = unwrap(vote(requested, { logId: entry.id, playerId: KARANDRAS1, vote: true, at: AT }))
    const secondVote = unwrap(vote(firstVote, { logId: entry.id, playerId: ITCHI, vote: true, at: AT }))
    const failedVote = vote(secondVote, { logId: entry.id, playerId: CHUL, vote: true, at: AT })

    expect(failedVote.ok).toBe(false)
    expect(JSON.stringify(failedVote)).not.toContain(tech.name)
  })

  it('does not name a hidden tech in the public log, only in the player\'s own', () => {
    const tech = techOfLevel(firstCivGame(), 3)
    const held = withCardInHand(learn(research(16), tech), 'Nikola Tesla')
    expect(me(held.state).techsChosen.find((candidate) => candidate.name === tech.name)?.hidden).toBe(true)
    const played = unwrap(play(held.state, held.itemId, tech.name))

    const line = played.log.find((candidate) => candidate.assistedActionId === 'tesla-1')
    expect(line?.publicLog).toContain('placing a tech one level lower in their pyramid')
    expect(line?.publicLog).not.toContain(tech.name)
    const others = JSON.stringify(toPlayerView(played, KARANDRAS1).log) + JSON.stringify(toPlayerView(played, KARANDRAS1).assistedActions)
    expect(others).not.toContain(tech.name)
    expect(JSON.stringify(toPlayerView(played, CASH1981).log)).toContain(tech.name)
  })
})
