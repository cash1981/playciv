/**
 * The culture, production and trade on the Great Person markers: one row per marker of the board art, read by
 * eye from the six images (twice, the second time by a reader who had not seen the first).
 */

import { describe, expect, it } from 'vitest'

import { BOARD_ASSETS } from '../src/board.js'
import {
  GREAT_PERSON_CULTURE,
  GREAT_PERSON_PRODUCTION,
  GREAT_PERSON_TRADE,
  greatPersonCultureOf,
  greatPersonProductionOf,
  greatPersonTradeOf,
} from '../src/great-person-data.js'

describe('the Great Person culture table', () => {
  it('has a row for every Great Person marker of the board art, and nothing else', () => {
    const markers = BOARD_ASSETS.filter((asset) => asset.category === 'greatperson').map((asset) => asset.id)
    expect(Object.keys(GREAT_PERSON_CULTURE).sort()).toEqual(markers.sort())
  })

  it('has the culture read from the markers: Artist 2, Merchant 2, Humanitarian 1, the others none', () => {
    expect(greatPersonCultureOf('great people/artist')).toBe(2)
    expect(greatPersonCultureOf('great people/merchant')).toBe(2)
    expect(greatPersonCultureOf('great people/humanitarian')).toBe(1)
    expect(greatPersonCultureOf('great people/builder')).toBe(0)
    expect(greatPersonCultureOf('great people/general')).toBe(0)
    expect(greatPersonCultureOf('great people/scientist')).toBe(0)
  })

  it('has a production and a trade row for every marker, read from the images', () => {
    const markers = BOARD_ASSETS.filter((asset) => asset.category === 'greatperson').map((asset) => asset.id).sort()
    expect(Object.keys(GREAT_PERSON_PRODUCTION).sort()).toEqual(markers)
    expect(Object.keys(GREAT_PERSON_TRADE).sort()).toEqual(markers)
    expect(greatPersonProductionOf('great people/builder')).toBe(2)
    expect(greatPersonProductionOf('great people/humanitarian')).toBe(1)
    expect(greatPersonProductionOf('great people/scientist')).toBe(1)
    expect(greatPersonProductionOf('great people/artist')).toBe(0)
    expect(greatPersonTradeOf('great people/scientist')).toBe(2)
    expect(greatPersonTradeOf('great people/artist')).toBe(1)
    expect(greatPersonTradeOf('great people/humanitarian')).toBe(1)
    expect(greatPersonTradeOf('great people/merchant')).toBe(0)
  })

  it('knows no marker under another name, nor one inherited from Object', () => {
    expect(greatPersonCultureOf('great people/nothing')).toBeUndefined()
    expect(greatPersonCultureOf('toString')).toBeUndefined()
  })
})
