/**
 * Issue #337: transfers, loot and battle announcements name the cards they
 * move by item number, in the public log and in the owner's private log, and
 * the owner's log never relies on the public line.
 */

import { describe, expect, it } from 'vitest'

import { endBattleTurn, initiateBattle, placeUnitInArena } from '../src/actions/arena.js'
import { draw, drawUnitsForBattle, loot, revealAndDiscardBattlehand } from '../src/actions/draw.js'
import { tradeToPlayer } from '../src/actions/player.js'
import { itemName, revealAll } from '../src/item.js'
import { unwrap } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { findPlayer, toPlayerView } from '../src/state.js'

import { CASH1981, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const added = (before: GameState, after: GameState) => after.log.slice(before.log.length)

describe('giving a card', () => {
  it('numbers the card for the receiver, the giver and everyone else, without naming it publicly', () => {
    const before = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'CULTURE_1' }))
    const card = findPlayer(before, CASH1981)!.items[0]!
    const after = unwrap(
      tradeToPlayer(before, {
        playerId: CASH1981,
        targetPlayerId: ITCHI,
        sheetName: 'CULTURE_1',
        itemNumber: card.itemNumber,
        name: itemName(card),
      }),
    )
    const lines = added(before, after)
    const number = `#${card.itemNumber}`
    const privateLines = lines.filter((entry) => entry.privateLog !== '').map((entry) => entry.privateLog)
    expect(privateLines).toHaveLength(2)
    for (const text of privateLines) {
      expect(text).toContain(itemName(card))
      expect(text).toContain(number)
    }
    const publicLines = lines.filter((entry) => entry.publicLog !== '').map((entry) => entry.publicLog)
    expect(publicLines).toHaveLength(1)
    expect(publicLines[0]).toContain(number)
    expect(publicLines[0]).not.toContain(itemName(card))
    for (const viewer of [KARANDRAS1, 'spectator']) {
      expect(JSON.stringify(toPlayerView(after, viewer).log)).not.toContain(itemName(card))
    }
  })
})

describe('looting a card', () => {
  it('numbers the card in all four lines and keeps the name out of the public ones', () => {
    const before = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'CULTURE_1' }))
    const card = findPlayer(before, CASH1981)!.items[0]!
    const after = unwrap(loot(before, { playerId: CASH1981, targetPlayerId: KARANDRAS1, sheetNames: new Set(['CULTURE_1']) }))
    const lines = added(before, after)
    const number = `item number #${card.itemNumber}`
    const privateLines = lines.filter((entry) => entry.privateLog !== '').map((entry) => entry.privateLog)
    const publicLines = lines.filter((entry) => entry.publicLog !== '').map((entry) => entry.publicLog)
    expect(privateLines).toHaveLength(2)
    expect(publicLines).toHaveLength(2)
    for (const text of [...privateLines, ...publicLines]) expect(text).toContain(number)
    for (const text of publicLines) expect(text).not.toContain(itemName(card))
  })
})

describe('the battle hand', () => {
  const battle = (): GameState => {
    let state = firstCivGame()
    for (let i = 0; i < 3; i++) state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'INFANTRY' }))
    return unwrap(drawUnitsForBattle(state, { playerId: CASH1981, numberOfDraws: 3 }))
  }

  it('lists every revealed unit with its number, publicly and privately', () => {
    const before = battle()
    const units = findPlayer(before, CASH1981)!.battlehand
    const after = unwrap(revealAndDiscardBattlehand(before, CASH1981))
    const [line] = added(before, after)
    expect(line?.privateLog).toBe(line?.publicLog)
    for (const unit of units) {
      expect(line?.publicLog).toContain(`${revealAll(unit)} item number #${unit.itemNumber}`)
    }
  })

  it('announces a placement with the unit number in both logs once the turn ends', () => {
    let state = unwrap(initiateBattle(battle(), { initiatorId: CASH1981, opponentId: KARANDRAS1 }))
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
    const before = state
    const after = unwrap(endBattleTurn(before, { playerId: CASH1981 }))
    const placed = added(before, after).find((entry) => entry.publicLog.includes('into the arena'))
    expect(placed?.publicLog).toContain(`item number #${unit.itemNumber}`)
    expect(placed?.privateLog).toBe(placed?.publicLog)
  })
})
