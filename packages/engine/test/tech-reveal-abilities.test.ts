/**
 * Civilization abilities on the first reveal of a tech: the Germans' free unit and the Greeks' culture.
 */

import { describe, expect, it } from 'vitest'

import { endBattleAction, initiateBattle, placeUnitInArena } from '../src/actions/arena.js'
import { draw, drawUnitsForBattle } from '../src/actions/draw.js'
import { chooseTech, removeTech, revealTech } from '../src/actions/player.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { isUnit } from '../src/item.js'
import { unwrap } from '../src/result.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { GameState } from '../src/state.js'
import { applyTechRevealAbilities } from '../src/tech-reveal-abilities.js'

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
const remove = (state: GameState, techName: string, playerId = CASH1981): GameState => unwrap(removeTech(state, { playerId, techName }))
const paidRecords = (state: GameState, techName: string) =>
  (state.techRevealEffects ?? []).filter((effect) => effect.playerId === CASH1981 && effect.techName === techName && effect.paid === true)
const alreadyPaid = (state: GameState): string[] => lines(state).filter((line) => line.includes('the ability was already paid'))
/** The unit card leaves the hand for the discard pile, as when the player discards it. */
const discardUnits = (state: GameState): GameState => {
  const cards = units(state)
  return {
    ...state,
    players: state.players.map((p) => (p.playerId === CASH1981 ? { ...p, items: p.items.filter((item) => !cards.some((card) => card.id === item.id)) } : p)),
    discardedItems: [...state.discardedItems, ...cards],
  }
}

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

  it('are taken back from the battle hand too, where a drawn copy of the card also stands', () => {
    const revealed = learn(germans(), 'Chivalry')
    const withBattle = unwrap(drawUnitsForBattle(revealed, { playerId: CASH1981, numberOfDraws: 1 }))
    const card = units(revealed)[0]
    expect(me(withBattle).battlehand.some((item) => item.id === card?.id)).toBe(true)
    const undone = undoReveal(withBattle, 'Chivalry')
    expect(me(undone).battlehand.some((item) => item.id === card?.id)).toBe(false)
    expect(units(undone)).toHaveLength(0)
  })

  it('say that the card could no longer be returned when it left the hand, and keep it where it went', () => {
    const revealed = learn(germans(), 'Chivalry')
    const card = units(revealed)[0]
    if (card === undefined) throw new Error('no card')
    const discarded: GameState = {
      ...revealed,
      players: revealed.players.map((p) => (p.playerId === CASH1981 ? { ...p, items: p.items.filter((item) => item.id !== card.id) } : p)),
      discardedItems: [...revealed.discardedItems, card],
    }
    const deckBefore = discarded.items.filter((item) => item.sheetName === 'MOUNTED').length
    const undone = undoReveal(discarded, 'Chivalry')
    expect(lines(undone).some((line) => line.includes('took back 0 of 1 free units (a card could no longer be returned: it has left the hand)'))).toBe(true)
    expect(undone.discardedItems.some((item) => item.id === card.id)).toBe(true)
    expect(undone.items.filter((item) => item.sheetName === 'MOUNTED')).toHaveLength(deckBefore)
    // Removing the tech by hand is just as truthful
    const removed = unwrap(removeTech(discarded, { playerId: CASH1981, techName: 'Chivalry' }))
    expect(lines(removed).some((line) => line.includes('could no longer be returned'))).toBe(true)
    // What stays is the record that the reward was paid, with no culture and no card
    expect(removed.techRevealEffects).toEqual([{ playerId: CASH1981, techName: 'Chivalry', culture: 0, units: [], paid: true }])
  })

  it('pay no second unit when the tech is removed, chosen and revealed again after the card left the hand', () => {
    const revealed = learn(germans(), 'Chivalry')
    const discarded = discardUnits(revealed)
    const removed = remove(discarded, 'Chivalry')
    expect(paidRecords(removed, 'Chivalry')).toEqual([{ playerId: CASH1981, techName: 'Chivalry', culture: 0, units: [], paid: true }])
    const deckBefore = removed.items.filter((item) => item.sheetName === 'MOUNTED').length
    const again = learn(removed, 'Chivalry')
    expect(units(again)).toHaveLength(0)
    expect(again.items.filter((item) => item.sheetName === 'MOUNTED')).toHaveLength(deckBefore)
    expect(alreadyPaid(again)).toEqual(['cash1981 gets nothing for Chivalry as the Germans: the ability was already paid when the tech was revealed before'])
    // The resource reminder is not repeated, and the record is still there, once
    expect(lines(again).filter((line) => line.includes('may take one resource'))).toHaveLength(1)
    expect(paidRecords(again, 'Chivalry')).toHaveLength(1)
    expect(again.techRevealEffects).toHaveLength(1)
    // Removing it once more keeps the record, and so does revealing it a third time
    const third = learn(remove(again, 'Chivalry'), 'Chivalry')
    expect(units(third)).toHaveLength(0)
    expect(paidRecords(third, 'Chivalry')).toHaveLength(1)
    expect(alreadyPaid(third)).toHaveLength(2)
    // A paid record is for this tech only
    expect(units(learn(removed, 'Gunpowder'))).toHaveLength(1)
  })

  it('pay no second set of units when only one of several cards left the hand', () => {
    const revealed = learn(germans(), 'Logistics')
    const cards = units(revealed)
    expect(cards).toHaveLength(3)
    const one: GameState = {
      ...revealed,
      players: revealed.players.map((p) => (p.playerId === CASH1981 ? { ...p, items: p.items.filter((item) => item.id !== cards[0]?.id) } : p)),
    }
    const removed = remove(one, 'Logistics')
    expect(units(removed)).toHaveLength(0)
    expect(paidRecords(removed, 'Logistics')).toHaveLength(1)
    expect(lines(removed).some((line) => line.includes('took back 2 of 3 free units') && line.includes('it is not paid again if the tech is revealed again'))).toBe(true)
    expect(units(learn(removed, 'Logistics'))).toHaveLength(0)
  })

  it('pay again after a complete take-back, since nothing of the first payment is left', () => {
    const revealed = learn(germans(), 'Chivalry')
    const deckBefore = revealed.items.filter((item) => item.sheetName === 'MOUNTED').length
    const removed = remove(revealed, 'Chivalry')
    expect(removed.techRevealEffects ?? []).toHaveLength(0)
    expect(units(removed)).toHaveLength(0)
    const again = learn(removed, 'Chivalry')
    expect(units(again)).toHaveLength(1)
    expect(again.items.filter((item) => item.sheetName === 'MOUNTED')).toHaveLength(deckBefore)
    expect(alreadyPaid(again)).toHaveLength(0)
    expect(lines(again).filter((line) => line.includes('builds a free mounted unit as the Germans (Chivalry)'))).toHaveLength(2)
    // The vote that undoes the reveal is a complete take-back as well
    const undone = undoReveal(revealed, 'Chivalry')
    expect(undone.techRevealEffects ?? []).toHaveLength(0)
    expect(units(learn(undone, 'Chivalry'))).toHaveLength(1)
  })

  it('pay once for each chain of reveals: a complete take-back does not use up the reward, a partial one does', () => {
    const first = learn(germans(), 'Chivalry')
    const second = learn(remove(first, 'Chivalry'), 'Chivalry')
    expect(units(second)).toHaveLength(1)
    // The second payment leaves the hand: from here on the tech pays nothing more
    const gone = remove(discardUnits(second), 'Chivalry')
    const third = learn(gone, 'Chivalry')
    expect(units(third)).toHaveLength(0)
    expect(alreadyPaid(third)).toHaveLength(1)
    expect(paidRecords(third, 'Chivalry')).toHaveLength(1)
  })

  it('return a unit card that stood in the arena without its battle lock, so it can be placed again', () => {
    const revealed = learn(germans(), 'Chivalry')
    const card = units(revealed)[0]
    if (card === undefined) throw new Error('no card')
    let state = unwrap(drawUnitsForBattle(revealed, { playerId: CASH1981, numberOfDraws: 1 }))
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))
    state = unwrap(placeUnitInArena(state, { playerId: CASH1981, unitId: card.id, side: 'attacker', position: 0, attack: 1, health: 3 }))
    // The card is locked while the unit stands in the arena
    expect(units(state)[0]?.inBattle).toBe(true)

    const removed = remove(state, 'Chivalry')
    expect(units(removed)).toHaveLength(0)
    const inDeck = removed.items.find((item) => item.id === card.id)
    expect(inDeck).toBeDefined()
    expect(inDeck !== undefined && isUnit(inDeck) ? inDeck.inBattle : undefined).toBe(false)
    expect(inDeck?.hidden).toBe(true)
    expect(inDeck?.ownerId).toBeNull()
    // A complete take-back, though the card was in the arena
    expect(removed.techRevealEffects ?? []).toHaveLength(0)

    // Draw the card again later and place it in a new battle: no UNIT_ALREADY_IN_BATTLE
    let later = unwrap(endBattleAction(removed, { playerId: CASH1981 }))
    const deckSize = later.items.filter((item) => item.sheetName === 'MOUNTED').length
    for (let i = 0; i < deckSize && !units(later).some((unit) => unit.id === card.id); i++) {
      later = unwrap(draw(later, { playerId: CASH1981, sheetName: 'MOUNTED', confirmedOutOfTurn: true }))
    }
    const drawnAgain = units(later).find((unit) => unit.id === card.id)
    expect(drawnAgain).toBeDefined()
    expect(drawnAgain?.inBattle).toBe(false)
    later = unwrap(drawUnitsForBattle(later, { playerId: CASH1981, numberOfDraws: units(later).length }))
    later = unwrap(initiateBattle(later, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))
    const placed = placeUnitInArena(later, { playerId: CASH1981, unitId: card.id, side: 'attacker', position: 0, attack: 1, health: 3 })
    expect(placed.ok).toBe(true)
  })

  it('skip the unit with a line when no card of the type is left, and still point at the resource', () => {
    const base = germans()
    const empty: GameState = {
      ...base,
      items: base.items.filter((item) => item.sheetName !== 'MOUNTED'),
      discardedItems: base.discardedItems.filter((item) => item.sheetName !== 'MOUNTED'),
    }
    const revealed = learn(empty, 'Chivalry')
    expect(units(revealed)).toHaveLength(0)
    expect(lines(revealed)).toContain('cash1981 would build a free mounted unit as the Germans, but no mounted unit cards are left')
    expect(lines(revealed)).toContain('cash1981 may take one resource of their choice from the market as the Germans (Chivalry)')
    // Nothing to give back, so the undo adds no claim about units
    expect(lines(undoReveal(revealed, 'Chivalry')).some((line) => line.includes('free unit'))).toBe(false)
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

  it('do not count a player who has the tech revealed', () => {
    const state = greeks()
    const start = culture(state)
    const revealedByOther = learn(state, 'Pottery', KARANDRAS1)
    expect(culture(learn(revealedByOther, 'Pottery'))).toBe(start + 2)
    const revealedByTwo = learn(revealedByOther, 'Pottery', ITCHI)
    expect(culture(learn(revealedByTwo, 'Pottery'))).toBe(start + 1)
  })

  it('count a hidden choice of another player as nothing: the same culture with or without it, so it tells nothing', () => {
    const state = greeks()
    const start = culture(state)
    const without = learn(state, 'Pottery')
    const oneHidden = learn(choose(state, 'Pottery', ITCHI), 'Pottery')
    const allHidden = learn(choose(choose(choose(state, 'Pottery', KARANDRAS1), 'Pottery', ITCHI), 'Pottery', CHUL), 'Pottery')
    for (const result of [without, oneHidden, allHidden]) {
      expect(culture(result)).toBe(start + 3)
      expect(lines(result)).toContain(`cash1981 gains 3 (${start + 3}) culture as the Greeks`)
    }
    // Everything the log says about the reveal is the same too, so no player and no hidden tech is named
    const line = (result: GameState) => lines(result).filter((text) => text.includes('as the Greeks'))
    expect(line(oneHidden)).toEqual(line(without))
    expect(line(allHidden)).toEqual(line(without))
    for (const name of ['Karandras1', 'Itchi', 'Chul']) expect(line(allHidden).join('\n')).not.toContain(name)
    // A revealed copy still counts, next to a hidden one
    const mixed = learn(choose(learn(state, 'Pottery', KARANDRAS1), 'Pottery', ITCHI), 'Pottery')
    expect(culture(mixed)).toBe(start + 2)
  })

  it('give nothing to another civilization, for a hidden choice, or when everyone has the tech revealed', () => {
    const start = culture(firstCivGame())
    expect(culture(learn(withCivilization(firstCivGame(), 'Romans'), 'Pottery'))).toBe(start)
    expect(culture(choose(greeks(), 'Pottery'))).toBe(culture(greeks()))
    let all = greeks()
    for (const playerId of [KARANDRAS1, ITCHI, CHUL]) all = learn(all, 'Pottery', playerId)
    expect(culture(learn(all, 'Pottery'))).toBe(culture(greeks()))
  })

  it('are taken back with the tech', () => {
    const state = greeks()
    const start = culture(state)
    const revealed = learn(state, 'Pottery')
    expect(culture(undoReveal(revealed, 'Pottery'))).toBe(start)
    expect(lines(undoReveal(revealed, 'Pottery')).some((line) => line.includes(`took back 3 (${start}) culture: the Greeks ability for Pottery goes with the tech`))).toBe(true)
    expect(culture(unwrap(removeTech(revealed, { playerId: CASH1981, techName: 'Pottery' })))).toBe(start)
  })

  it('take back only what is left of the culture when it was spent, and say so', () => {
    const state = greeks()
    const revealed = learn(state, 'Pottery')
    const spent: GameState = {
      ...revealed,
      players: revealed.players.map((p) => (p.playerId === CASH1981 ? { ...p, stats: { ...p.stats, culture: 1 } } : p)),
    }
    const undone = undoReveal(spent, 'Pottery')
    expect(culture(undone)).toBe(0)
    expect(lines(undone).some((line) => line.includes('took back 1 of 3 (0) culture (the rest is spent)'))).toBe(true)
  })

  it('keep a paid record when the culture was spent, and leave it where it is', () => {
    const revealed = learn(greeks(), 'Pottery')
    const spent: GameState = {
      ...revealed,
      players: revealed.players.map((p) => (p.playerId === CASH1981 ? { ...p, stats: { ...p.stats, culture: 1 } } : p)),
    }
    const undone = undoReveal(spent, 'Pottery')
    expect(undone.techRevealEffects).toEqual([{ playerId: CASH1981, techName: 'Pottery', culture: 0, units: [], paid: true }])
    expect(lines(undone).some((line) => line.includes('took back 1 of 3 (0) culture (the rest is spent)') && line.includes('it is not paid again if the tech is revealed again'))).toBe(true)
  })

  it('pay no second time when the culture was spent, the tech removed, chosen and revealed again', () => {
    const start = culture(greeks())
    const revealed = learn(greeks(), 'Pottery')
    expect(culture(revealed)).toBe(start + 3)
    // The Greeks spend all of it
    const spent: GameState = {
      ...revealed,
      players: revealed.players.map((p) => (p.playerId === CASH1981 ? { ...p, stats: { ...p.stats, culture: 0 } } : p)),
    }
    const removed = remove(spent, 'Pottery')
    expect(culture(removed)).toBe(0)
    expect(paidRecords(removed, 'Pottery')).toHaveLength(1)
    const again = learn(removed, 'Pottery')
    expect(culture(again)).toBe(0)
    expect(alreadyPaid(again)).toEqual(['cash1981 gets nothing for Pottery as the Greeks: the ability was already paid when the tech was revealed before'])
    expect(lines(again).filter((line) => line.includes('culture as the Greeks'))).toHaveLength(1)
    // One record, which a later removal and reveal do not remove or add to
    expect(again.techRevealEffects).toHaveLength(1)
    const third = learn(remove(again, 'Pottery'), 'Pottery')
    expect(culture(third)).toBe(0)
    expect(third.techRevealEffects).toHaveLength(1)
    expect(alreadyPaid(third)).toHaveLength(2)
    // Another tech is paid as usual
    expect(culture(learn(removed, 'Writing'))).toBe(3)
    // Nothing of the record reaches another player
    const view = JSON.stringify(toPlayerView(third, KARANDRAS1))
    expect(view).not.toContain('techRevealEffects')
  })

  it('pay again after a complete take-back, and once more per chain of reveals', () => {
    const start = culture(greeks())
    const first = learn(greeks(), 'Pottery')
    const removed = remove(first, 'Pottery')
    expect(culture(removed)).toBe(start)
    expect(removed.techRevealEffects ?? []).toHaveLength(0)
    const second = learn(removed, 'Pottery')
    expect(culture(second)).toBe(start + 3)
    expect(alreadyPaid(second)).toHaveLength(0)
    // The vote that undoes the reveal is a complete take-back too
    expect(culture(learn(undoReveal(second, 'Pottery'), 'Pottery'))).toBe(start + 3)
    // Only a partial take-back uses the reward up
    const spent: GameState = {
      ...second,
      players: second.players.map((p) => (p.playerId === CASH1981 ? { ...p, stats: { ...p.stats, culture: 1 } } : p)),
    }
    const third = learn(remove(spent, 'Pottery'), 'Pottery')
    expect(culture(third)).toBe(0)
    expect(alreadyPaid(third)).toHaveLength(1)
  })

  it('say once, in the public log only, that the ability was already paid, and change nothing else', () => {
    const state: GameState = {
      ...greeks(),
      techRevealEffects: [{ playerId: CASH1981, techName: 'Pottery', culture: 0, units: [], paid: true }],
    }
    const result = applyTechRevealAbilities(state, CASH1981, 'Pottery')
    expect(result.log).toHaveLength(state.log.length + 1)
    const added = result.log.at(-1)
    expect(added?.publicLog).toBe('cash1981 gets nothing for Pottery as the Greeks: the ability was already paid when the tech was revealed before')
    expect(added?.privateLog).toBe('')
    expect({ ...result, log: state.log, rng: state.rng }).toEqual(state)
    // Another tech, another player, and another civilization are not held back by it
    expect(applyTechRevealAbilities(state, CASH1981, 'Writing').log).toHaveLength(state.log.length + 1)
    expect(culture(applyTechRevealAbilities(state, CASH1981, 'Writing'))).toBe(culture(state) + 3)
    const other: GameState = { ...withCivilization(state, 'Romans'), techRevealEffects: state.techRevealEffects ?? [] }
    expect(applyTechRevealAbilities(other, CASH1981, 'Pottery')).toBe(other)
  })
})
