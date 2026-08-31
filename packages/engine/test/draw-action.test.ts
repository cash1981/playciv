/**
 * Port av `no.asgari.civilization.server.action.DrawActionTest`.
 *
 * De gamle Java-testene er fasit. Hver test under navngir sin Java-motpart.
 * Der Java lente seg på verdi-likhet (`assertThat(list).doesNotContain(item)`),
 * sjekkes både id og verdi, siden porten la til stabil id per instans.
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
  if (entry?.item == null) throw new Error('Siste loggpost har ikke noe item')
  return entry.item
}

const handOf = (state: GameState, playerId: string): readonly Item[] =>
  findPlayer(state, playerId)?.items ?? []

/**
 * Java: de 17 `drawXAndMakeSureItsNoLongerInPBFCollection`-testene.
 * Alle har samme form, så de kjøres som en tabell.
 */
describe('draw fjerner itemet fra stokken og gir det til spilleren', () => {
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
    it(`${sheetName} gir et item av typen ${kind}`, () => {
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
      // Itemet ligger nå i spillerens hånd, skjult, med eier satt
      expect(handOf(after, CASH1981).map((handItem) => handItem.id)).toContain(item.id)
      expect(item.hidden).toBe(true)
      expect(item.ownerId).toBe(CASH1981)
    })
  }
})

/** Java: `drawCivAndMakeSureItsNoLongerInPBFCollection` — loggkravene. */
describe('drawCiv', () => {
  it('logger privat og offentlig, og finner arket via find("CIV")', () => {
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

  it('avslører ikke sivilisasjonsnavnet i den offentlige loggen', () => {
    const state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'CIV' }))
    const entry = state.log.at(-1)
    const item = lastDrawn(state)

    expect(entry?.privateLog).toContain(itemName(item))
    expect(entry?.publicLog).not.toContain(itemName(item))
  })

  it('stokken inneholder ikke lenger et verdi-likt item', () => {
    const state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'CIV' }))
    const item = lastDrawn(state)
    expect(state.items.some((deckItem) => itemValueEquals(deckItem, item))).toBe(false)
  })
})

/** Java: `drawArtilleryAndMakeSureItsNoLongerInPBFCollection` — bildesjekken. */
describe('drawArtillery', () => {
  it('bildefilnavnet har ingen mellomrom og slutter på .png', () => {
    const state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'ARTILLERY' }))
    const image = itemImage(lastDrawn(state))

    expect(image).not.toBeNull()
    expect(image).not.toContain(' ')
    expect(image?.endsWith('.png')).toBe(true)
  })
})

/** Java: `drawItemAndMakeSureLogsAreStored`. */
describe('logging', () => {
  it('hvert trekk legger til én loggpost', () => {
    const before = firstCivGame()
    const after = unwrap(draw(before, { playerId: CASH1981, sheetName: 'GREAT_PERSON' }))
    expect(after.log.length).toBe(before.log.length + 1)
  })
})

/**
 * Java: `makeSureSystemCorrectlyThrowsExceptionWhenNothingToShuffle`
 * (annotert `@Test(expected = NoMoreItemsException.class)`).
 */
describe('reshuffle', () => {
  it('tømmer man en stokk der ingenting er kastet, gir neste trekk NO_MORE_ITEMS', () => {
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

  it('kastede items legges tilbake i stokken og kan trekkes igjen', () => {
    let state = firstCivGame()
    const aircrafts = countInDeck(state, 'AIRCRAFT')

    for (let i = 0; i < aircrafts; i++) {
      state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'AIRCRAFT' }))
    }

    // Simuler at spilleren kaster fem fly, slik PlayerAction.discardItem gjør
    const player = findPlayer(state, CASH1981)
    if (player === undefined) throw new Error('mangler spiller')
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

    // Fem lagt tilbake, ett trukket ut igjen
    expect(countInDeck(after, 'AIRCRAFT')).toBe(4)
    expect(after.discardedItems).toHaveLength(0)
    // Java: logShuffle skriver en System-post
    expect(after.log.some((e) => e.publicLog === 'Aircraft reshuffled and put back in the deck')).toBe(true)
  })

  it('reshuffle rører ikke kastede items av andre typer', () => {
    let state = firstCivGame()
    const aircrafts = countInDeck(state, 'AIRCRAFT')
    for (let i = 0; i < aircrafts; i++) {
      state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'AIRCRAFT' }))
    }

    const player = findPlayer(state, CASH1981)
    if (player === undefined) throw new Error('mangler spiller')
    const oneAircraft = player.items.find((item) => item.sheetName === 'AIRCRAFT')
    if (oneAircraft === undefined) throw new Error('mangler fly')
    const someHut = state.items.find((item) => item.sheetName === 'HUTS')
    if (someHut === undefined) throw new Error('mangler hut')

    state = { ...state, discardedItems: [oneAircraft, someHut] }
    const after = unwrap(draw(state, { playerId: CASH1981, sheetName: 'AIRCRAFT' }))

    expect(after.discardedItems.map((i) => i.id)).toEqual([someHut.id])
  })

  it('typer utenfor SHUFFLABLE_ITEMS kan ikke reshuffles', () => {
    // Java: reshuffleItems kaster IllegalArgumentException for huts og villages.
    // Briefen for denne portingen antok at de hentes tilbake fra hendene;
    // det gjør Java ikke, og Java er fasit.
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
describe('battlehand', () => {
  it('trekker riktig antall units, og tømmes ved reveal', () => {
    let state = firstCivGame()
    for (const sheetName of ['INFANTRY', 'ARTILLERY', 'ARTILLERY', 'MOUNTED', 'MOUNTED'] as const) {
      state = unwrap(draw(state, { playerId: CASH1981, sheetName }))
    }

    state = unwrap(drawUnitsForBattle(state, { playerId: CASH1981, numberOfDraws: 5 }))
    expect(findPlayer(state, CASH1981)?.battlehand).toHaveLength(5)

    // Java: ber man om 99 units og har 5, får man 5
    state = unwrap(drawUnitsForBattle(state, { playerId: CASH1981, numberOfDraws: 99 }))
    expect(findPlayer(state, CASH1981)?.battlehand).toHaveLength(5)

    state = unwrap(drawUnitsForBattle(state, { playerId: CASH1981, numberOfDraws: 3 }))
    expect(findPlayer(state, CASH1981)?.battlehand).toHaveLength(3)

    state = unwrap(revealAndDiscardBattlehand(state, CASH1981))
    expect(findPlayer(state, CASH1981)?.battlehand).toHaveLength(0)
    // Unitene ligger fortsatt i hånden — Java flytter dem ikke til discard
    expect(handOf(state, CASH1981).filter(isUnit)).toHaveLength(5)
  })
})

/** Java: `drawAndDiscardBarbarians`. */
describe('barbarer', () => {
  it('trekker tre og kaster dem til discardedItems', () => {
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

  it('kan ikke trekke flere før de er kastet', () => {
    const state = unwrap(drawBarbarians(firstCivGame(), CASH1981))
    const error = unwrapErr(drawBarbarians(state, CASH1981))
    expect(error).toEqual({ kind: 'BARBARIANS_NOT_DISCARDED', playerId: CASH1981 })
  })
})

/** Java: `simulateLoot`. */
describe('loot', () => {
  it('flytter en landsby fra én spiller til en annen', () => {
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

  it('gir NOTHING_TO_LOOT når spilleren ikke har noe av typen', () => {
    const error = unwrapErr(
      loot(firstCivGame(), {
        playerId: CASH1981,
        targetPlayerId: KARANDRAS1,
        sheetNames: new Set(['VILLAGES']),
      }),
    )
    expect(error).toEqual({ kind: 'NOTHING_TO_LOOT', playerId: CASH1981 })
  })

  it('gir ITEM_NOT_LOOTABLE for items som ikke er Tradable', () => {
    // Java: kun CultureI/II/III, Hut og Village implementerer Tradable.
    // Wonders gjør det ikke.
    const state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'ANCIENT_WONDERS' }))
    const result = loot(state, {
      playerId: CASH1981,
      targetPlayerId: KARANDRAS1,
      sheetNames: new Set(['ANCIENT_WONDERS']),
    })
    expect(unwrapErr(result).kind).toBe('ITEM_NOT_LOOTABLE')
  })
})

/** Java: `DrawAction.draw` sjekket tur og nektet trekk av teknologier. */
describe('forutsetninger for trekk', () => {
  it('bare spilleren som har turen kan trekke', () => {
    const error = unwrapErr(draw(firstCivGame(), { playerId: KARANDRAS1, sheetName: 'CIV' }))
    expect(error).toEqual({ kind: 'NOT_YOUR_TURN', playerId: KARANDRAS1 })
  })

  it('teknologier kan ikke trekkes, de skal velges', () => {
    const error = unwrapErr(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'LEVEL_1_TECH' }))
    expect(error).toEqual({ kind: 'TECHS_ARE_CHOSEN_NOT_DRAWN', sheetName: 'LEVEL_1_TECH' })
  })

  it('ukjent spiller gir PLAYER_NOT_FOUND', () => {
    const error = unwrapErr(draw(firstCivGame(), { playerId: 'ingen', sheetName: 'CIV' }))
    expect(error).toEqual({ kind: 'PLAYER_NOT_FOUND', playerId: 'ingen' })
  })
})

describe('renhet', () => {
  it('draw muterer ikke inn-tilstanden', () => {
    const before = firstCivGame()
    const snapshot = JSON.stringify(before)

    unwrap(draw(before, { playerId: CASH1981, sheetName: 'CIV' }))

    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('samme seed gir samme stokk', () => {
    expect(firstCivGame('samme').items.map((i) => i.itemNumber)).toEqual(
      firstCivGame('samme').items.map((i) => i.itemNumber),
    )
  })

  it('forskjellig seed gir forskjellige itemNumber', () => {
    const a = firstCivGame('spill-a')
    const b = firstCivGame('spill-b')
    expect(a.items[0]?.itemNumber).not.toBe(b.items[0]?.itemNumber)
  })
})
