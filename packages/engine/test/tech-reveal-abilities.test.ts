/**
 * Civilization abilities on the first reveal of a tech: the Germans' free unit and the Greeks' culture.
 */

import { describe, expect, it } from 'vitest'

import { chooseTech, removeTech, revealTech } from '../src/actions/player.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { isUnit } from '../src/item.js'
import { unwrap } from '../src/result.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { GameState } from '../src/state.js'

import { withCivilization } from './culture-advance-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const me = (state: GameState, playerId = CASH1981) => {
  const found = findPlayer(state, playerId)
  if (found === undefined) throw new Error('no player')
  return found
}
const lines = (state: GameState): string[] => state.log.map((entry) => entry.publicLog)
const choose = (state: GameState, techName: string, playerId = CASH1981): GameState =>
  unwrap(chooseTech(state, { playerId, techName }))
const reveal = (state: GameState, techName: string, playerId = CASH1981): GameState =>
  unwrap(revealTech(state, { playerId, techName }))
const learn = (state: GameState, techName: string, playerId = CASH1981): GameState => reveal(choose(state, techName, playerId), techName, playerId)
const units = (state: GameState) => me(state).items.filter(isUnit)

function undoReveal(state: GameState, techName: string): GameState {
  const entry = state.log.find((line) => line.logType === 'REVEAL' && line.item?.kind === 'tech' && line.item.name === techName)
  if (entry === undefined) throw new Error('no reveal line')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of [KARANDRAS1, ITCHI, CHUL]) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true }))
  return next
}

describe('the Germans and techs that upgrade or unlock a unit', () => {
  const germans = (): GameState => withCivilization(firstCivGame(), 'Germans')

  it('build one free unit of the type and may take a resource, only on the first reveal', () => {
    const chosen = choose(germans(), 'Chivalry')
    // Choosing alone gives nothing
    expect(units(chosen)).toHaveLength(0)
    const revealed = reveal(chosen, 'Chivalry')
    expect(units(revealed)).toHaveLength(1)
    expect(units(revealed)[0]?.hidden).toBe(true)
    expect(lines(revealed)).toContain('cash1981 builds a free mounted unit as the Germans (Chivalry)')
    expect(lines(revealed)).toContain('cash1981 may take one resource of their choice from the market as the Germans (Chivalry)')
    // Revealing again gives nothing more
    expect(units(reveal(revealed, 'Chivalry'))).toHaveLength(1)
  })

  it('build one unit for each type a tech unlocks, and also when the type is already further up', () => {
    const logistics = learn(germans(), 'Logistics')
    expect(units(logistics)).toHaveLength(3)
    const later = learn(learn(germans(), 'Gunpowder'), 'Democracy')
    expect(units(later)).toHaveLength(2)
    expect(units(learn(germans(), 'Flight'))).toHaveLength(1)
  })

  it('give nothing for other techs, other civilizations, or another player upgrading', () => {
    expect(units(learn(germans(), 'Pottery'))).toHaveLength(0)
    expect(units(learn(withCivilization(firstCivGame(), 'Romans'), 'Chivalry'))).toHaveLength(0)
    const other = learn(germans(), 'Chivalry', KARANDRAS1)
    expect(units(other)).toHaveLength(0)
  })

  it('give no unit for the starting tech set at the civ reveal', () => {
    const state = germans()
    expect(units(state)).toHaveLength(0)
    expect(state.techRevealEffects).toBeUndefined()
  })

  it('are taken back with the tech: the card goes back in its deck', () => {
    const before = choose(germans(), 'Chivalry')
    const deckBefore = before.items.filter((item) => item.sheetName === 'MOUNTED').length
    const revealed = reveal(before, 'Chivalry')
    expect(revealed.items.filter((item) => item.sheetName === 'MOUNTED')).toHaveLength(deckBefore - 1)
    const undone = undoReveal(revealed, 'Chivalry')
    expect(units(undone)).toHaveLength(0)
    expect(undone.items.filter((item) => item.sheetName === 'MOUNTED')).toHaveLength(deckBefore)
    expect(undone.techRevealEffects ?? []).toHaveLength(0)
    // Removing the tech by hand takes it back too
    const removed = unwrap(removeTech(revealed, { playerId: CASH1981, techName: 'Chivalry' }))
    expect(units(removed)).toHaveLength(0)
  })

  it('name no card in the public log or in what another player sees', () => {
    const revealed = learn(germans(), 'Chivalry')
    const card = units(revealed)[0]
    const publicText = lines(revealed).join('\n')
    expect(card).toBeDefined()
    expect(publicText).not.toContain(card?.id ?? 'x')
    const view = JSON.stringify(toPlayerView(revealed, KARANDRAS1))
    expect(view).not.toContain(card?.id ?? 'x')
    expect(view).not.toContain('techRevealEffects')
  })
})

describe('the Greeks and techs', () => {
  const greeks = (): GameState => withCivilization(firstCivGame(), 'Greeks')
  const culture = (state: GameState) => me(state).stats.culture

  it('gain 1 culture for each other player who does not know or research the tech', () => {
    const state = greeks()
    const start = culture(state)
    const revealed = learn(state, 'Pottery')
    expect(culture(revealed)).toBe(start + 3)
    expect(lines(revealed)).toContain(`cash1981 gains 3 (${start + 3}) culture as the Greeks`)
  })

  it('count a tech another player has revealed or only chosen hidden as known or researched', () => {
    const state = greeks()
    const start = culture(state)
    const revealedByOther = learn(state, 'Pottery', KARANDRAS1)
    expect(culture(learn(revealedByOther, 'Pottery'))).toBe(start + 2)
    const hiddenByOther = choose(state, 'Pottery', ITCHI)
    const afterHidden = learn(choose(hiddenByOther, 'Pottery', KARANDRAS1), 'Pottery')
    expect(culture(afterHidden)).toBe(start + 1)
    // The line shows the amount only: no player and no hidden tech is named
    const line = lines(afterHidden).find((text) => text.includes('as the Greeks')) ?? ''
    for (const name of ['Karandras1', 'Itchi', 'Chul']) expect(line).not.toContain(name)
  })

  it('give nothing to another civilization, for a hidden choice, or when everyone has the tech', () => {
    const start = culture(firstCivGame())
    expect(culture(learn(withCivilization(firstCivGame(), 'Romans'), 'Pottery'))).toBe(start)
    expect(culture(choose(greeks(), 'Pottery'))).toBe(culture(greeks()))
    let all = greeks()
    for (const playerId of [KARANDRAS1, ITCHI, CHUL]) all = choose(all, 'Pottery', playerId)
    expect(culture(learn(all, 'Pottery'))).toBe(culture(greeks()))
  })

  it('are taken back with the tech', () => {
    const state = greeks()
    const start = culture(state)
    const revealed = learn(state, 'Pottery')
    expect(culture(undoReveal(revealed, 'Pottery'))).toBe(start)
    expect(culture(unwrap(removeTech(revealed, { playerId: CASH1981, techName: 'Pottery' })))).toBe(start)
  })
})
