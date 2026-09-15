/**
 * Port of the parts of `MiscTest` that cover `SheetName.find`, plus coverage
 * of the six EnumSets.
 */

import { describe, expect, it } from 'vitest'

import {
  ALL_WONDERS,
  CULTURE_CARD,
  SHEETS,
  SHEET_LABEL,
  SHEET_NAME_ORDER,
  SHUFFLABLE_ITEMS,
  TECHS,
  UNITS,
  findSheetName,
  sheetOrdinal,
} from '../src/sheet-name.js'

describe('findSheetName', () => {
  it('finds by label, ignoring case', () => {
    expect(findSheetName('CIV')).toBe('CIV')
    expect(findSheetName('civ')).toBe('CIV')
    expect(findSheetName('Civ')).toBe('CIV')
  })

  it('finds by label with the spaces stripped', () => {
    expect(findSheetName('Great Person')).toBe('GREAT_PERSON')
    expect(findSheetName('GreatPerson')).toBe('GREAT_PERSON')
    expect(findSheetName('greatperson')).toBe('GREAT_PERSON')
    expect(findSheetName('Ancient Wonders')).toBe('ANCIENT_WONDERS')
  })

  it('falls back on the enum name when the label misses', () => {
    // "Culture I" with spaces stripped becomes "CultureI", which does not
    // match "CULTURE_1". Java then fell back on valueOf().
    expect(findSheetName('CULTURE_1')).toBe('CULTURE_1')
    expect(findSheetName('culture_3')).toBe('CULTURE_3')
    expect(findSheetName('LEVEL_5_TECH')).toBe('LEVEL_5_TECH')
  })

  it('gives undefined for unknown names', () => {
    expect(findSheetName('Sjakkbrikker')).toBeUndefined()
    expect(findSheetName('')).toBeUndefined()
  })

  it('finds every sheet by its own label', () => {
    for (const sheet of SHEET_NAME_ORDER) {
      expect(findSheetName(SHEET_LABEL[sheet])).toBe(sheet)
    }
  })
})

describe('the sets', () => {
  it('SHEETS is the whole enum', () => {
    expect(SHEETS.size).toBe(SHEET_NAME_ORDER.length)
    expect(SHEET_NAME_ORDER).toHaveLength(23)
  })

  it('TECHS is the five tech levels', () => {
    expect([...TECHS].sort()).toEqual([
      'LEVEL_1_TECH',
      'LEVEL_2_TECH',
      'LEVEL_3_TECH',
      'LEVEL_4_TECH',
      'LEVEL_5_TECH',
    ])
  })

  it('UNITS is the four unit types', () => {
    expect([...UNITS].sort()).toEqual(['AIRCRAFT', 'ARTILLERY', 'INFANTRY', 'MOUNTED'])
  })

  it('CULTURE_CARD is the three culture levels', () => {
    expect([...CULTURE_CARD].sort()).toEqual(['CULTURE_1', 'CULTURE_2', 'CULTURE_3'])
  })

  it('ALL_WONDERS is the three eras, not the WONDERS sheet itself', () => {
    expect([...ALL_WONDERS].sort()).toEqual([
      'ANCIENT_WONDERS',
      'MEDIEVAL_WONDERS',
      'MODERN_WONDERS',
    ])
    expect(ALL_WONDERS.has('WONDERS')).toBe(false)
  })

  it('SHUFFLABLE_ITEMS is units, great person, culture cards and civ', () => {
    expect([...SHUFFLABLE_ITEMS].sort()).toEqual([
      'AIRCRAFT',
      'ARTILLERY',
      'CIV',
      'CULTURE_1',
      'CULTURE_2',
      'CULTURE_3',
      'GREAT_PERSON',
      'INFANTRY',
      'MOUNTED',
    ])
  })

  it('huts, villages, tiles, city-states and wonders cannot be reshuffled', () => {
    // Documents where this port differs from the brief, which assumed huts
    // and villages come back from the players' hands. Java does no such thing.
    for (const sheet of [
      'HUTS',
      'VILLAGES',
      'TILES',
      'CITY_STATES',
      'ANCIENT_WONDERS',
      'MEDIEVAL_WONDERS',
      'MODERN_WONDERS',
    ] as const) {
      expect(SHUFFLABLE_ITEMS.has(sheet)).toBe(false)
    }
  })
})

describe('sheetOrdinal', () => {
  it('follows the order of the Java enum, which compareTo was built on', () => {
    expect(sheetOrdinal('CIV')).toBe(0)
    expect(sheetOrdinal('CULTURE_1')).toBe(1)
    expect(sheetOrdinal('SOCIAL_POLICY')).toBe(22)
    expect(sheetOrdinal('INFANTRY')).toBeLessThan(sheetOrdinal('AIRCRAFT'))
  })
})
