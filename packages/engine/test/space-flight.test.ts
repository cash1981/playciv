/**
 * Space Flight, "Immediately win the game with a Tech victory" (issue #354): revealing it says so in the public log, as the
 * Culture Victory space does, and nothing else happens: the game does not end and no winner is set.
 */

import { describe, expect, it } from 'vitest'

import { chooseTech, revealTech } from '../src/actions/player.js'
import { unwrap } from '../src/result.js'
import { toPlayerView } from '../src/state.js'
import type { GameState } from '../src/state.js'

import { CASH1981, KARANDRAS1, firstCivGame } from './fixture.js'

const chosen = (state: GameState, techName: string): GameState => unwrap(chooseTech(state, { playerId: CASH1981, techName }))
const lines = (state: GameState): readonly string[] => state.log.map((entry) => entry.publicLog)
const victory = (state: GameState): readonly string[] => lines(state).filter((line) => line.includes('a Tech victory'))

describe('Space Flight', () => {
  it('says in the public log, once, that the player has reached space with a Tech victory', () => {
    const revealed = unwrap(revealTech(chosen(firstCivGame(), 'Space Flight'), { playerId: CASH1981, techName: 'Space Flight' }))
    expect(victory(revealed)).toHaveLength(1)
    expect(victory(revealed)[0]).toMatch(/has researched Space Flight and reached space: a Tech victory$/)
    // Revealing it again says nothing more
    const again = unwrap(revealTech(revealed, { playerId: CASH1981, techName: 'Space Flight' }))
    expect(victory(again)).toHaveLength(1)
  })

  it('does not end the game or set a winner, so a Military victory can still be won', () => {
    const before = firstCivGame()
    const revealed = unwrap(revealTech(chosen(before, 'Space Flight'), { playerId: CASH1981, techName: 'Space Flight' }))
    expect(revealed.winner).toBe(before.winner)
    expect(revealed.active).toBe(true)
    expect(revealed.active).toBe(before.active)
  })

  it('says nothing while the tech is only chosen, which is private, and nothing for another tech', () => {
    expect(victory(chosen(firstCivGame(), 'Space Flight'))).toEqual([])
    const other = unwrap(revealTech(chosen(firstCivGame(), 'Masonry'), { playerId: CASH1981, techName: 'Masonry' }))
    expect(victory(other)).toEqual([])
  })

  it('is public: another player sees the line', () => {
    const revealed = unwrap(revealTech(chosen(firstCivGame(), 'Space Flight'), { playerId: CASH1981, techName: 'Space Flight' }))
    expect(JSON.stringify(toPlayerView(revealed, KARANDRAS1).log)).toContain('a Tech victory')
  })
})
