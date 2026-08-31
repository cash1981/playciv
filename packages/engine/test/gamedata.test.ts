/**
 * Låser innholdet i kortstokken mot regnearket.
 *
 * Java hadde ingen tilsvarende test; `ItemReaderTest` sjekket bare at listene
 * ikke var tomme. Tallene her er hentet fra `gamedata-faf-waw.xlsx` ved å telle
 * radene ItemReaders fire filtre slipper gjennom, og de fanger opp om
 * Excel-konverteringen endrer seg.
 */

import { describe, expect, it } from 'vitest'

import { createGame } from '../src/create-game.js'
import type { CivItem, SheetName, WonderItem } from '../src/index.js'
import { itemImage, itemName, revealAll, revealPublic } from '../src/item.js'

const game = createGame({ name: 'gamedata', numOfPlayers: 4, seed: 'gamedata' })

describe('kortstokken', () => {
  /**
   * Radantall i regnearket minus overskriftsraden, minus tomme rader.
   * City-states har 10 rader men bare 5 utfylte, og Level 4 Tech 10 rader med
   * 8 utfylte.
   */
  const expectedCounts: Readonly<Record<string, number>> = {
    CIV: 16,
    CULTURE_1: 27,
    CULTURE_2: 25,
    CULTURE_3: 17,
    GREAT_PERSON: 42,
    INFANTRY: 15,
    ARTILLERY: 15,
    MOUNTED: 15,
    AIRCRAFT: 8,
    VILLAGES: 20,
    HUTS: 35,
    TILES: 27,
    CITY_STATES: 5,
    ANCIENT_WONDERS: 9,
    MEDIEVAL_WONDERS: 9,
    MODERN_WONDERS: 9,
  }

  it('har forventet antall av hver type', () => {
    const actual: Record<string, number> = {}
    for (const item of game.items) {
      actual[item.sheetName] = (actual[item.sheetName] ?? 0) + 1
    }
    expect(actual).toEqual(expectedCounts)
  })

  it('har 294 items i stokken', () => {
    expect(game.items).toHaveLength(294)
  })

  it('inneholder ingen tech eller sosialpolitikk — de ligger i egne lister', () => {
    expect(game.items.some((item) => item.kind === 'tech')).toBe(false)
    expect(game.items.some((item) => item.kind === 'socialpolicy')).toBe(false)
  })

  it('alle items starter skjult og uten eier', () => {
    expect(game.items.every((item) => item.hidden && item.ownerId === null)).toBe(true)
  })

  it('hver item har unik id', () => {
    expect(new Set(game.items.map((item) => item.id)).size).toBe(game.items.length)
  })

  it('hver item har unikt itemNumber', () => {
    expect(new Set(game.items.map((item) => item.itemNumber)).size).toBe(game.items.length)
  })
})

describe('teknologier', () => {
  it('har 45 teknologier fordelt på fem nivåer', () => {
    const byLevel: Record<number, number> = {}
    for (const tech of game.techs) byLevel[tech.level] = (byLevel[tech.level] ?? 0) + 1
    // Nivå 1-4 fra regnearket, nivå 5 er bare Space Flight, lagt til i kode
    expect(byLevel).toEqual({ 1: 12, 2: 13, 3: 11, 4: 8, 5: 1 })
    expect(game.techs).toHaveLength(45)
  })

  it('er sortert på nivå', () => {
    const levels = game.techs.map((tech) => tech.level)
    expect([...levels].sort((a, b) => a - b)).toEqual(levels)
  })

  it('nivå 5 er Space Flight', () => {
    const level5 = game.techs.filter((tech) => tech.level === 5)
    expect(level5.map((tech) => tech.name)).toEqual(['Space Flight'])
  })

  it('Space Flight er en ny instans per spill, ikke en delt singleton', () => {
    // Java hadde `Tech.SPACE_FLIGHT` som statisk felt, altså delt muterbar
    // tilstand mellom alle spill i samme JVM.
    const other = createGame({ name: 'annet', numOfPlayers: 4, seed: 'annet' })
    const a = game.techs.find((tech) => tech.name === 'Space Flight')
    const b = other.techs.find((tech) => tech.name === 'Space Flight')
    expect(a?.id).not.toBe(b?.id)
  })
})

describe('sosialpolitikk', () => {
  it('har 8 kort, alle med bakside', () => {
    expect(game.socialPolicies).toHaveLength(8)
    expect(game.socialPolicies.every((policy) => policy.flipside !== null)).toBe(true)
  })
})

describe('kolonneparing', () => {
  it('sivilisasjoner får riktig startteknologi', () => {
    const civs = game.items.filter((item): item is CivItem => item.kind === 'civ')
    const byName = new Map(civs.map((civ) => [civ.name, civ.startingTech.name]))

    // Fasit fra Civ-arket
    expect(byName.get('Americans')).toBe('Currency')
    expect(byName.get('Spanish')).toBe('Navigation')
    expect(byName.get('Zulu')).toBe('Animal Husbandry')
    expect(byName.get('Mongols')).toBe('Horseback Riding')
  })

  it('startteknologien er nivå 1 og har eget itemNumber', () => {
    const civ = game.items.find((item): item is CivItem => item.kind === 'civ')
    expect(civ?.startingTech.level).toBe(1)
    expect(civ?.startingTech.sheetName).toBe('LEVEL_1_TECH')
    expect(civ?.startingTech.itemNumber).toBeGreaterThan(0)
  })

  it('great persons får brikketype fra kolonne B', () => {
    const gp = game.items.filter((item) => item.kind === 'greatperson')
    expect(gp.every((item) => item.type !== null && item.type !== '')).toBe(true)
  })

  it('bystater bruker kolonne B som bildereferanse', () => {
    const cityStates = game.items.filter((item) => item.kind === 'citystate')
    expect(cityStates.map((item) => item.description).sort()).toEqual([
      'cs1',
      'cs2',
      'cs3',
      'cs4',
      'cs5',
    ])
  })

  it('wonders deles i tre epoker av skillelinjene i arket', () => {
    const byType = (type: string): readonly string[] =>
      game.items
        .filter((item): item is WonderItem => item.kind === 'wonder')
        .filter((item) => item.type === type)
        .map((item) => item.name)

    expect(byType('Ancient')).toContain('Stonehenge')
    expect(byType('Medieval')).toContain('Taj Mahal')
    expect(byType('Modern')).toContain('Big Ben')
    // Skillelinjene «Medieval Wonders» og «Modern Wonders» skal ikke bli items
    expect(game.items.some((item) => itemName(item).toLowerCase().includes('wonders'))).toBe(false)
  })

  it('tiles er heltall, ikke "1.0"', () => {
    const tiles = game.items.filter((item) => item.kind === 'tile').map((item) => item.name)
    expect(tiles.every((name) => /^\d+$/.test(name))).toBe(true)
    expect([...tiles].sort((a, b) => Number(a) - Number(b))[0]).toBe('1')
  })

  it('units leser angrep og helse fra celler som "1.3"', () => {
    const infantry = game.items.filter((item) => item.kind === 'infantry')
    expect(infantry.every((unit) => unit.attack > 0 && unit.health > 0)).toBe(true)
    // Java kaller aldri setLevel, så alle units starter på nivå 0
    expect(infantry.every((unit) => unit.level === 0)).toBe(true)
    expect(infantry.some((unit) => unit.attack === 1 && unit.health === 3)).toBe(true)
  })

  it('leser kun kolonne A for units — kolonne B-D er oppgraderte stats', () => {
    // Arket har 1.3 / 2.4 / 3.5 / 4.6 på hver rad. Java leser bare den første.
    const infantry = game.items.filter((item) => item.kind === 'infantry')
    expect(infantry.some((unit) => unit.attack === 2 && unit.health === 4)).toBe(false)
  })
})

describe('bildefilnavn', () => {
  it('ingen bildefilnavn har mellomrom, bortsett fra Civ som Java aldri strippet', () => {
    for (const item of game.items) {
      const image = itemImage(item)
      if (image === null || item.kind === 'civ') continue
      expect(image, `${item.sheetName}: ${revealAll(item)}`).not.toContain(' ')
    }
  })

  it('alle bildefilnavn slutter på .png', () => {
    for (const item of game.items) {
      const image = itemImage(item)
      if (image === null) continue
      expect(image.endsWith('.png')).toBe(true)
    }
  })

  it('wonders har ingen bilde — Java implementerte ikke Image der', () => {
    const wonder = game.items.find((item) => item.kind === 'wonder')
    expect(wonder && itemImage(wonder)).toBeNull()
  })
})

describe('avsløring', () => {
  it('revealPublic avslører ikke navnet for skjulte korttyper', () => {
    const hidden: readonly SheetName[] = [
      'CIV',
      'CULTURE_1',
      'CULTURE_2',
      'CULTURE_3',
      'HUTS',
      'VILLAGES',
    ]
    for (const sheetName of hidden) {
      const item = game.items.find((candidate) => candidate.sheetName === sheetName)
      if (item === undefined) throw new Error(`fant ingen ${sheetName}`)
      expect(revealPublic(item)).not.toContain(itemName(item))
    }
  })

  it('revealPublic for tech gir bare nivået', () => {
    const tech = game.techs[0]
    if (tech === undefined) throw new Error('ingen tech')
    expect(revealPublic(tech)).toBe('Level 1 Tech')
    expect(revealAll(tech)).toBe(tech.name)
  })

  it('kulturkort avslører klassenavnet, ikke arknavnet', () => {
    // Java: CultureI.revealPublic() returnerer getClass().getSimpleName()
    const card = game.items.find((item) => item.kind === 'cultureII')
    expect(card && revealPublic(card)).toBe('CultureII')
  })

  it('great person avslører typen sin offentlig', () => {
    const gp = game.items.find((item) => item.kind === 'greatperson')
    expect(gp && revealPublic(gp)).toBe(gp?.type)
  })

  it('wonder og sosialpolitikk avslører navnet også offentlig', () => {
    // Dette er Javas oppførsel. For sosialpolitikk kompenseres det i loggen,
    // som skriver «has chosen a hidden social policy» i stedet.
    const wonder = game.items.find((item) => item.kind === 'wonder')
    expect(wonder && revealPublic(wonder)).toBe(wonder?.name)
    const policy = game.socialPolicies[0]
    expect(policy && revealPublic(policy)).toBe(policy?.name)
  })
})
