/**
 * Port av `MiscTest`-delene som handler om `SheetName.find`, pluss dekning av
 * de seks EnumSet-ene.
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
  it('finner via etikett, uten hensyn til store bokstaver', () => {
    expect(findSheetName('CIV')).toBe('CIV')
    expect(findSheetName('civ')).toBe('CIV')
    expect(findSheetName('Civ')).toBe('CIV')
  })

  it('finner via etikett med mellomrom fjernet', () => {
    expect(findSheetName('Great Person')).toBe('GREAT_PERSON')
    expect(findSheetName('GreatPerson')).toBe('GREAT_PERSON')
    expect(findSheetName('greatperson')).toBe('GREAT_PERSON')
    expect(findSheetName('Ancient Wonders')).toBe('ANCIENT_WONDERS')
  })

  it('faller tilbake på enum-navnet når etiketten ikke treffer', () => {
    // "Culture I" med mellomrom fjernet blir "CultureI", som ikke matcher
    // "CULTURE_1". Java falt da tilbake på valueOf().
    expect(findSheetName('CULTURE_1')).toBe('CULTURE_1')
    expect(findSheetName('culture_3')).toBe('CULTURE_3')
    expect(findSheetName('LEVEL_5_TECH')).toBe('LEVEL_5_TECH')
  })

  it('gir undefined for ukjente navn', () => {
    expect(findSheetName('Sjakkbrikker')).toBeUndefined()
    expect(findSheetName('')).toBeUndefined()
  })

  it('finner alle ark via sin egen etikett', () => {
    for (const sheet of SHEET_NAME_ORDER) {
      expect(findSheetName(SHEET_LABEL[sheet])).toBe(sheet)
    }
  })
})

describe('mengdene', () => {
  it('SHEETS er hele enumet', () => {
    expect(SHEETS.size).toBe(SHEET_NAME_ORDER.length)
    expect(SHEET_NAME_ORDER).toHaveLength(23)
  })

  it('TECHS er de fem tech-nivåene', () => {
    expect([...TECHS].sort()).toEqual([
      'LEVEL_1_TECH',
      'LEVEL_2_TECH',
      'LEVEL_3_TECH',
      'LEVEL_4_TECH',
      'LEVEL_5_TECH',
    ])
  })

  it('UNITS er de fire unittypene', () => {
    expect([...UNITS].sort()).toEqual(['AIRCRAFT', 'ARTILLERY', 'INFANTRY', 'MOUNTED'])
  })

  it('CULTURE_CARD er de tre kulturnivåene', () => {
    expect([...CULTURE_CARD].sort()).toEqual(['CULTURE_1', 'CULTURE_2', 'CULTURE_3'])
  })

  it('ALL_WONDERS er de tre epokene, ikke WONDERS-arket selv', () => {
    expect([...ALL_WONDERS].sort()).toEqual([
      'ANCIENT_WONDERS',
      'MEDIEVAL_WONDERS',
      'MODERN_WONDERS',
    ])
    expect(ALL_WONDERS.has('WONDERS')).toBe(false)
  })

  it('SHUFFLABLE_ITEMS er units, great person, kulturkort og civ', () => {
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

  it('huts, villages, tiles, bystater og wonders kan ikke reshuffles', () => {
    // Dokumenterer avviket mot briefen for denne portingen: den antok at
    // huts og villages hentes tilbake fra spillernes hender. Java gjør ikke det.
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
  it('følger rekkefølgen i Java-enumet, som compareTo bygget på', () => {
    expect(sheetOrdinal('CIV')).toBe(0)
    expect(sheetOrdinal('CULTURE_1')).toBe(1)
    expect(sheetOrdinal('SOCIAL_POLICY')).toBe(22)
    expect(sheetOrdinal('INFANTRY')).toBeLessThan(sheetOrdinal('AIRCRAFT'))
  })
})
