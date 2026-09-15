/**
 * Port of `no.asgari.civilization.server.action.DrawActionTest`.
 *
 * The old Java tests are the reference. Every test below names its Java
 * counterpart. Where Java leaned on value equality
 * (`assertThat(list).doesNotContain(item)`), both id and value are checked,
 * since the port added a stable id per instance.
 */

import { describe, expect, it } from 'vitest'

import { draw, drawUnitsForBattle, revealAndDiscardBattlehand } from '../src/actions/draw.js'
import { drawBarbarians, discardBarbarians, loot } from '../src/actions/draw.js'
import type { Item, ItemKind } from '../src/item.js'
import { isUnit, itemImage, itemName, itemValueEquals } from '../src/item.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { SheetName } from '../src/sheet-name.js'
import { findSheetName } from '../src/sheet-name.js'
import type { GameState } from '../src/state.js'
import { findPlayer } from '../src/state.js'

import { CASH1981, KARANDRAS1, firstCivGame } from './fixture.js'

const countInDeck = (state: GameState, sheetName: SheetName): number =>
  state.items.filter((item) => item.sheetName === sheetName).length

const lastDrawn = (state: GameState): Item => {
  const entry = state.log.at(-1)
  if (entry?.item == null) throw new Error('the last log entry carries no item')
  return entry.item
}

const handOf = (state: GameState, playerId: string): readonly Item[] =>
  findPlayer(state, playerId)?.items ?? []

/**
 * Java: the 17 `drawXAndMakeSureItsNoLongerInPBFCollection` tests.
 * They all share one shape, so they run as a table.
 */
describe('draw takes the item out of the deck and hands it to the player', () => {
  const cases: readonly { readonly sheetName: SheetName; readonly kind: ItemKind }[] = [
    { sheetName: 'CIV', kind: 'civ' },
    { sheetName: 'AIRCRAFT', kind: 'aircraft' },
    { sheetName: 'ARTILLERY', kind: 'artillery' },
    { sheetName: 'CITY_STATES', kind: 'citystate' },
    { sheetName: 'CULTURE_1', kind: 'cultureI' },
    { sheetName: 'CULTURE_2', kind: 'cultureII' },
    { sheetName: 'CULTURE_3', kind: 'cultureIII' },
    { sheetName: 'GREAT_PERSON', kind: 'greatperson' },
    { sheetName: 'HUTS', kind: 'hut' },
    { sheetName: 'INFANTRY', kind: 'infantry' },
    { sheetName: 'MOUNTED', kind: 'mounted' },
    { sheetName: 'TILES', kind: 'tile' },
    { sheetName: 'VILLAGES', kind: 'village' },
    { sheetName: 'ANCIENT_WONDERS', kind: 'wonder' },
    { sheetName: 'MEDIEVAL_WONDERS', kind: 'wonder' },
    { sheetName: 'MODERN_WONDERS', kind: 'wonder' },
  ]

  for (const { sheetName, kind } of cases) {
    it(`${sheetName} gives an item of kind ${kind}`, () => {
      const before = firstCivGame()
      const countBefore = countInDeck(before, sheetName)
      expect(countBefore).toBeGreaterThan(0)

      const after = unwrap(draw(before, { playerId: CASH1981, sheetName }))
      const item = lastDrawn(after)

      expect(item.kind).toBe(kind)
      expect(item.sheetName).toBe(sheetName)
      expect(countInDeck(after, sheetName)).toBe(countBefore - 1)
      // Java: assertThat(pbf.getItems()).doesNotContain(item)
      expect(after.items.some((deckItem) => deckItem.id === item.id)).toBe(false)
      // The item now sits in the hand of the player, hidden, with an owner
      expect(handOf(after, CASH1981).map((handItem) => handItem.id)).toContain(item.id)
      expect(item.hidden).toBe(true)
      expect(item.ownerId).toBe(CASH1981)
    })
  }
})

/** Java: `drawCivAndMakeSureItsNoLongerInPBFCollection` — the log requirements. */
describe('drawCiv', () => {
  it('logs privately and publicly, and finds the sheet through find("CIV")', () => {
    const civ = findSheetName('CIV')
    expect(civ).toBe('CIV')

    const state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: civ as SheetName }))
    const entry = state.log.at(-1)

    expect(entry?.playerId).toBe(CASH1981)
    expect(entry?.item?.kind).toBe('civ')
    // Java: assertThat(gameLog.getPrivateLog()).matches(".+drew.*Civ.+")
    expect(entry?.privateLog).toMatch(/.+drew.*Civ.+/)
    // Java: assertTrue(gameLog.getPublicLog().matches(".+drew.*Civ..*"))
    expect(entry?.publicLog).toMatch(/.+drew.*Civ..*/)
  })

  it('keeps the name of the civilization out of the public log', () => {
    const state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'CIV' }))
    const entry = state.log.at(-1)
    const item = lastDrawn(state)

    expect(entry?.privateLog).toContain(itemName(item))
    expect(entry?.publicLog).not.toContain(itemName(item))
  })

  it('the deck no longer holds an item equal by value', () => {
    const state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'CIV' }))
    const item = lastDrawn(state)
    expect(state.items.some((deckItem) => itemValueEquals(deckItem, item))).toBe(false)
  })
})

/** Java: `drawArtilleryAndMakeSureItsNoLongerInPBFCollection` — the image check. */
describe('drawArtillery', () => {
  it('the image filename has no spaces and ends in .png', () => {
    const state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'ARTILLERY' }))
    const image = itemImage(lastDrawn(state))

    expect(image).not.toBeNull()
    expect(image).not.toContain(' ')
    expect(image?.endsWith('.png')).toBe(true)
  })
})

/** Java: `drawItemAndMakeSureLogsAreStored`. */
describe('logging', () => {
  it('every draw adds one log entry', () => {
    const before = firstCivGame()
    const after = unwrap(draw(before, { playerId: CASH1981, sheetName: 'GREAT_PERSON' }))
    expect(after.log.length).toBe(before.log.length + 1)
  })
})

/**
 * Java: `makeSureSystemCorrectlyThrowsExceptionWhenNothingToShuffle`
 * (annotated `@Test(expected = NoMoreItemsException.class)`).
 */
describe('reshuffle', () => {
  it('emptying a deck with nothing discarded makes the next draw NO_MORE_ITEMS', () => {
    let state = firstCivGame()
    const aircrafts = countInDeck(state, 'AIRCRAFT')
    expect(aircrafts).toBeGreaterThan(0)

    for (let i = 0; i < aircrafts; i++) {
      state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'AIRCRAFT' }))
    }
    expect(countInDeck(state, 'AIRCRAFT')).toBe(0)

    const error = unwrapErr(draw(state, { playerId: CASH1981, sheetName: 'AIRCRAFT' }))
    expect(error).toEqual({ kind: 'NO_MORE_ITEMS', what: 'Aircraft' })
  })

  it('discarded items go back into the deck and can be drawn again', () => {
    let state = firstCivGame()
    const aircrafts = countInDeck(state, 'AIRCRAFT')

    for (let i = 0; i < aircrafts; i++) {
      state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'AIRCRAFT' }))
    }

    // Mimic the player discarding five aircraft, the way PlayerAction.discardItem does
    const player = findPlayer(state, CASH1981)
    if (player === undefined) throw new Error('missing player')
    const discarded = player.items.filter((item) => item.sheetName === 'AIRCRAFT').slice(0, 5)
    state = {
      ...state,
      discardedItems: [...state.discardedItems, ...discarded.map((i) => ({ ...i, hidden: true }))],
      players: state.players.map((p) =>
        p.playerId === CASH1981
          ? { ...p, items: p.items.filter((i) => !discarded.some((d) => d.id === i.id)) }
          : p,
      ),
    }

    const after = unwrap(draw(state, { playerId: CASH1981, sheetName: 'AIRCRAFT' }))

    // Five put back, one drawn out again
    expect(countInDeck(after, 'AIRCRAFT')).toBe(4)
    expect(after.discardedItems).toHaveLength(0)
    // Java: logShuffle writes a System entry
    expect(after.log.some((e) => e.publicLog === 'Aircraft reshuffled and put back in the deck')).toBe(true)
  })

  it('reshuffle leaves discarded items of other kinds alone', () => {
    let state = firstCivGame()
    const aircrafts = countInDeck(state, 'AIRCRAFT')
    for (let i = 0; i < aircrafts; i++) {
      state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'AIRCRAFT' }))
    }

    const player = findPlayer(state, CASH1981)
    if (player === undefined) throw new Error('missing player')
    const oneAircraft = player.items.find((item) => item.sheetName === 'AIRCRAFT')
    if (oneAircraft === undefined) throw new Error('missing aircraft')
    const someHut = state.items.find((item) => item.sheetName === 'HUTS')
    if (someHut === undefined) throw new Error('missing hut')

    state = { ...state, discardedItems: [oneAircraft, someHut] }
    const after = unwrap(draw(state, { playerId: CASH1981, sheetName: 'AIRCRAFT' }))

    expect(after.discardedItems.map((i) => i.id)).toEqual([someHut.id])
  })

  it('kinds outside SHUFFLABLE_ITEMS cannot be reshuffled', () => {
    // Java: reshuffleItems throws IllegalArgumentException for huts and
    // villages. The brief for this port assumed they are collected back from
    // the hands; Java does no such thing, and Java is the reference.
    let state = firstCivGame()
    const huts = countInDeck(state, 'HUTS')
    for (let i = 0; i < huts; i++) {
      state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'HUTS' }))
    }

    const error = unwrapErr(draw(state, { playerId: CASH1981, sheetName: 'HUTS' }))
    expect(error).toEqual({ kind: 'NOT_SHUFFLABLE', sheetName: 'HUTS' })
  })
})

/** Java: `drawUnitForBattle`. */
describe('battle hand', () => {
  it('draws the right number of units, and empties on reveal', () => {
    let state = firstCivGame()
    for (const sheetName of ['INFANTRY', 'ARTILLERY', 'ARTILLERY', 'MOUNTED', 'MOUNTED'] as const) {
      state = unwrap(draw(state, { playerId: CASH1981, sheetName }))
    }

    state = unwrap(drawUnitsForBattle(state, { playerId: CASH1981, numberOfDraws: 5 }))
    expect(findPlayer(state, CASH1981)?.battlehand).toHaveLength(5)

    // Java: ask for 99 units with 5 available and you get 5
    state = unwrap(drawUnitsForBattle(state, { playerId: CASH1981, numberOfDraws: 99 }))
    expect(findPlayer(state, CASH1981)?.battlehand).toHaveLength(5)

    state = unwrap(drawUnitsForBattle(state, { playerId: CASH1981, numberOfDraws: 3 }))
    expect(findPlayer(state, CASH1981)?.battlehand).toHaveLength(3)

    state = unwrap(revealAndDiscardBattlehand(state, CASH1981))
    expect(findPlayer(state, CASH1981)?.battlehand).toHaveLength(0)
    // The units stay in the hand — Java does not move them to the discard pile
    expect(handOf(state, CASH1981).filter(isUnit)).toHaveLength(5)
  })
})

/** Java: `drawAndDiscardBarbarians`. */
describe('barbarians', () => {
  it('draws three and discards them to discardedItems', () => {
    let state = firstCivGame()
    expect(findPlayer(state, CASH1981)?.barbarians).toHaveLength(0)

    state = unwrap(drawBarbarians(state, CASH1981))
    expect(findPlayer(state, CASH1981)?.barbarians).toHaveLength(3)

    const discardedBefore = state.discardedItems.length
    state = unwrap(discardBarbarians(state, CASH1981))

    expect(findPlayer(state, CASH1981)?.barbarians).toHaveLength(0)
    expect(state.discardedItems).toHaveLength(discardedBefore + 3)
    expect(state.discardedItems.every((item) => item.ownerId === null)).toBe(true)
  })

  it('cannot draw more until they have been discarded', () => {
    const state = unwrap(drawBarbarians(firstCivGame(), CASH1981))
    const error = unwrapErr(drawBarbarians(state, CASH1981))
    expect(error).toEqual({ kind: 'BARBARIANS_NOT_DISCARDED', playerId: CASH1981 })
  })
})

/** Java: `simulateLoot`. */
describe('loot', () => {
  it('moves a village from one player to another', () => {
    let state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'VILLAGES' }))

    const villagesOf = (playerId: string): number =>
      handOf(state, playerId).filter((item) => item.sheetName === 'VILLAGES').length

    const fromBefore = villagesOf(CASH1981)
    const toBefore = villagesOf(KARANDRAS1)
    expect(fromBefore).toBeGreaterThan(0)

    state = unwrap(
      loot(state, {
        playerId: CASH1981,
        targetPlayerId: KARANDRAS1,
        sheetNames: new Set(['VILLAGES']),
      }),
    )

    expect(villagesOf(CASH1981)).toBe(fromBefore - 1)
    expect(villagesOf(KARANDRAS1)).toBe(toBefore + 1)
  })

  it('gives NOTHING_TO_LOOT when the player holds nothing of that kind', () => {
    const error = unwrapErr(
      loot(firstCivGame(), {
        playerId: CASH1981,
        targetPlayerId: KARANDRAS1,
        sheetNames: new Set(['VILLAGES']),
      }),
    )
    expect(error).toEqual({ kind: 'NOTHING_TO_LOOT', playerId: CASH1981 })
  })

  it('gives ITEM_NOT_LOOTABLE for items that are not Tradable', () => {
    // Java: only CultureI/II/III, Hut and Village implement Tradable.
    // Wonders do not.
    const state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'ANCIENT_WONDERS' }))
    const result = loot(state, {
      playerId: CASH1981,
      targetPlayerId: KARANDRAS1,
      sheetNames: new Set(['ANCIENT_WONDERS']),
    })
    expect(unwrapErr(result).kind).toBe('ITEM_NOT_LOOTABLE')
  })
})

/** Java: `DrawAction.draw` checked the turn and refused to draw technologies. */
describe('preconditions for drawing', () => {
  it('only the player whose turn it is may draw', () => {
    const error = unwrapErr(draw(firstCivGame(), { playerId: KARANDRAS1, sheetName: 'CIV' }))
    expect(error).toEqual({ kind: 'NOT_YOUR_TURN', playerId: KARANDRAS1 })
  })

  it('technologies cannot be drawn, they are chosen', () => {
    const error = unwrapErr(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'LEVEL_1_TECH' }))
    expect(error).toEqual({ kind: 'TECHS_ARE_CHOSEN_NOT_DRAWN', sheetName: 'LEVEL_1_TECH' })
  })

  it('an unknown player gives PLAYER_NOT_FOUND', () => {
    const error = unwrapErr(draw(firstCivGame(), { playerId: 'outsider', sheetName: 'CIV' }))
    expect(error).toEqual({ kind: 'PLAYER_NOT_FOUND', playerId: 'outsider' })
  })
})

describe('purity', () => {
  it('draw does not mutate the state it was given', () => {
    const before = firstCivGame()
    const snapshot = JSON.stringify(before)

    unwrap(draw(before, { playerId: CASH1981, sheetName: 'CIV' }))

    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('the same seed gives the same deck', () => {
    expect(firstCivGame('same').items.map((i) => i.itemNumber)).toEqual(
      firstCivGame('same').items.map((i) => i.itemNumber),
    )
  })

  it('a different seed gives a different deck order', () => {
    const a = firstCivGame('game-a').items.map((item) => itemName(item))
    const b = firstCivGame('game-b').items.map((item) => itemName(item))
    expect(a).not.toEqual(b)
  })

  it('a different seed gives a different item number offset', () => {
    // Java: RandomUtils.nextInt(1, 20), so only 19 offsets exist and two seeds
    // can land on the same one. These two are picked because they differ.
    expect(firstCivGame('game-a').items[0]?.itemNumber).not.toBe(
      firstCivGame('game-c').items[0]?.itemNumber,
    )
  })
})
