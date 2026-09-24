/**
 * Pins the contents of the deck to the spreadsheet.
 *
 * Java had no test like this; `ItemReaderTest` only checked that the lists were
 * not empty. The numbers here come from `gamedata-faf-waw.xlsx` by counting the
 * rows the four ItemReader filters let through, and they catch any change in
 * the Excel conversion.
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createGame } from '../src/create-game.js'
import type { CivItem, SheetName, WonderItem } from '../src/index.js'
import { itemImage, itemName, revealAll, revealPublic } from '../src/item.js'

/** `tools/item-assets.ps1` writes here; see conventions.md on generated files. */
const WEB_PUBLIC_ITEMS = fileURLToPath(
  new URL('../../web/public/items/', import.meta.url),
)

const game = createGame({ name: 'gamedata', numOfPlayers: 4, seed: 'gamedata' })

describe('the deck', () => {
  /**
   * Row counts in the spreadsheet less the header row, less the blank rows.
   * City states have 10 rows but only 5 filled in, and Level 4 Tech has 10 rows
   * with 8 filled in.
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

  it('holds the expected number of each kind', () => {
    const actual: Record<string, number> = {}
    for (const item of game.items) {
      actual[item.sheetName] = (actual[item.sheetName] ?? 0) + 1
    }
    expect(actual).toEqual(expectedCounts)
  })

  it('holds 294 items', () => {
    expect(game.items).toHaveLength(294)
  })

  it('holds no techs or social policies — those live in their own lists', () => {
    expect(game.items.some((item) => item.kind === 'tech')).toBe(false)
    expect(game.items.some((item) => item.kind === 'socialpolicy')).toBe(false)
  })

  it('every item starts hidden and unowned', () => {
    expect(game.items.every((item) => item.hidden && item.ownerId === null)).toBe(true)
  })

  it('every item has a unique id', () => {
    expect(new Set(game.items.map((item) => item.id)).size).toBe(game.items.length)
  })

  it('every item has a unique item number', () => {
    expect(new Set(game.items.map((item) => item.itemNumber)).size).toBe(game.items.length)
  })
})

describe('technologies', () => {
  it('holds 45 technologies across five levels', () => {
    const byLevel: Record<number, number> = {}
    for (const tech of game.techs) byLevel[tech.level] = (byLevel[tech.level] ?? 0) + 1
    // Levels 1-4 come from the spreadsheet; level 5 is Space Flight alone, added in code
    expect(byLevel).toEqual({ 1: 12, 2: 13, 3: 11, 4: 8, 5: 1 })
    expect(game.techs).toHaveLength(45)
  })

  it('is sorted by level', () => {
    const levels = game.techs.map((tech) => tech.level)
    expect([...levels].sort((a, b) => a - b)).toEqual(levels)
  })

  it('level 5 is Space Flight', () => {
    const level5 = game.techs.filter((tech) => tech.level === 5)
    expect(level5.map((tech) => tech.name)).toEqual(['Space Flight'])
  })

  it('Space Flight is a fresh instance per game, not a shared singleton', () => {
    // Java had `Tech.SPACE_FLIGHT` as a static field, which is mutable state
    // shared between every game in the same JVM.
    const other = createGame({ name: 'annet', numOfPlayers: 4, seed: 'annet' })
    const a = game.techs.find((tech) => tech.name === 'Space Flight')
    const b = other.techs.find((tech) => tech.name === 'Space Flight')
    expect(a?.id).not.toBe(b?.id)
  })
})

describe('social policies', () => {
  it('holds 8 cards, each with a flipside', () => {
    expect(game.socialPolicies).toHaveLength(8)
    expect(game.socialPolicies.every((policy) => policy.flipside !== null)).toBe(true)
  })
})

describe('column pairing', () => {
  it('civilizations get the right starting technology', () => {
    const civs = game.items.filter((item): item is CivItem => item.kind === 'civ')
    const byName = new Map(civs.map((civ) => [civ.name, civ.startingTech.name]))

    // Taken from the Civ sheet
    expect(byName.get('Americans')).toBe('Currency')
    expect(byName.get('Spanish')).toBe('Navigation')
    expect(byName.get('Zulu')).toBe('Animal Husbandry')
    expect(byName.get('Mongols')).toBe('Horseback Riding')
  })

  it('the starting technology is level 1 and carries its own item number', () => {
    const civ = game.items.find((item): item is CivItem => item.kind === 'civ')
    expect(civ?.startingTech.level).toBe(1)
    expect(civ?.startingTech.sheetName).toBe('LEVEL_1_TECH')
    expect(civ?.startingTech.itemNumber).toBeGreaterThan(0)
  })

  it('great persons take their figure type from column B', () => {
    const gp = game.items.filter((item) => item.kind === 'greatperson')
    expect(gp.every((item) => item.type !== null && item.type !== '')).toBe(true)
  })

  it('city states use column B as the image reference', () => {
    const cityStates = game.items.filter((item) => item.kind === 'citystate')
    expect(cityStates.map((item) => item.description).sort()).toEqual([
      'cs1',
      'cs2',
      'cs3',
      'cs4',
      'cs5',
    ])
  })

  it('wonders split into three eras at the divider rows in the sheet', () => {
    const byType = (type: string): readonly string[] =>
      game.items
        .filter((item): item is WonderItem => item.kind === 'wonder')
        .filter((item) => item.type === type)
        .map((item) => item.name)

    expect(byType('Ancient')).toContain('Stonehenge')
    expect(byType('Medieval')).toContain('Taj Mahal')
    expect(byType('Modern')).toContain('Big Ben')
    // The divider rows "Medieval Wonders" and "Modern Wonders" must not become items
    expect(game.items.some((item) => itemName(item).toLowerCase().includes('wonders'))).toBe(false)
  })

  it('tiles are whole numbers, not "1.0"', () => {
    const tiles = game.items.filter((item) => item.kind === 'tile').map((item) => item.name)
    expect(tiles.every((name) => /^\d+$/.test(name))).toBe(true)
    expect([...tiles].sort((a, b) => Number(a) - Number(b))[0]).toBe('1')
  })

  it('units read attack and health from cells like "1.3"', () => {
    const infantry = game.items.filter((item) => item.kind === 'infantry')
    expect(infantry.every((unit) => unit.attack > 0 && unit.health > 0)).toBe(true)
    // Java never calls setLevel, so every unit starts at level 0
    expect(infantry.every((unit) => unit.level === 0)).toBe(true)
    expect(infantry.some((unit) => unit.attack === 1 && unit.health === 3)).toBe(true)
  })

  it('reads only column A for units — columns B to D are upgraded stats', () => {
    // The sheet has 1.3 / 2.4 / 3.5 / 4.6 on each row. Java reads only the first.
    const infantry = game.items.filter((item) => item.kind === 'infantry')
    expect(infantry.some((unit) => unit.attack === 2 && unit.health === 4)).toBe(false)
  })
})

describe('image filenames', () => {
  it('no image filename has spaces, except Civ which Java never stripped', () => {
    for (const item of game.items) {
      const image = itemImage(item)
      if (image === null || item.kind === 'civ') continue
      expect(image, `${item.sheetName}: ${revealAll(item)}`).not.toContain(' ')
    }
  })

  it('every image filename ends in .png, except tech which is .jpg', () => {
    for (const item of game.items) {
      const image = itemImage(item)
      if (image === null) continue
      const expectedExtension = item.kind === 'tech' ? '.jpg' : '.png'
      expect(image.endsWith(expectedExtension)).toBe(true)
    }
  })

  it('wonders map onto the artwork under Moderator/wonders', () => {
    // Java left Wonder without an Image. The files are lower case with no
    // spaces, no hyphens and no leading "The"; apostrophes are kept.
    const named = (name: string) =>
      game.items.find((item) => item.kind === 'wonder' && item.name === name)
    const image = (name: string) => {
      const item = named(name)
      if (item === undefined) throw new Error(`no wonder named ${name}`)
      return itemImage(item)
    }

    expect(image('The Oracle')).toBe('oracle.png')
    expect(image('Chichen Itza')).toBe('chichenitza.png')
    expect(image('Notre-Dame')).toBe('notredame.png')
    expect(image("Leonardo's Workshop")).toBe("leonardo'sworkshop.png")
    expect(image('The Great Lighthouse')).toBe('greatlighthouse.png')
  })

  it('every wonder gets an image, and they are all distinct', () => {
    const wonders = game.items.filter((item) => item.kind === 'wonder')
    const images = wonders.map((item) => itemImage(item))

    expect(wonders).toHaveLength(27)
    expect(images.every((image) => image !== null && image.endsWith('.png'))).toBe(true)
    expect(new Set(images).size).toBe(27)
  })

  it('every social policy maps onto artwork under packages/web/public/items', () => {
    // The WaW files are lower case, unlike the tech/hut/village case this used
    // to share. "Expansionsim" is a typo in the spreadsheet — itemImage() asks
    // for expansionsim.png, and tools/item-assets.ps1 copies expansionism.png
    // under that name too.
    expect(game.socialPolicies).toHaveLength(8)
    const names = game.socialPolicies.map((policy) => policy.name)
    expect(names).toContain('Expansionsim')

    for (const policy of game.socialPolicies) {
      const image = itemImage(policy)
      if (image === null) throw new Error(`no image for ${policy.name}`)
      expect(image).not.toContain(' ')
      expect(
        existsSync(`${WEB_PUBLIC_ITEMS}${image}`),
        `missing ${image} for ${policy.name}`,
      ).toBe(true)
    }

    const expansionsim = game.socialPolicies.find((policy) => policy.name === 'Expansionsim')
    if (expansionsim === undefined) throw new Error('no Expansionsim policy')
    expect(itemImage(expansionsim)).toBe('expansionsim.png')
  })
})

describe('revealing', () => {
  it('revealPublic keeps the name back for hidden card kinds', () => {
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
      if (item === undefined) throw new Error(`found no ${sheetName}`)
      expect(revealPublic(item)).not.toContain(itemName(item))
    }
  })

  it('revealPublic for a tech gives the level only', () => {
    const tech = game.techs[0]
    if (tech === undefined) throw new Error('no tech')
    expect(revealPublic(tech)).toBe('Level 1 Tech')
    expect(revealAll(tech)).toBe(tech.name)
  })

  it('culture cards reveal the class name, not the sheet name', () => {
    // Java: CultureI.revealPublic() returns getClass().getSimpleName()
    const card = game.items.find((item) => item.kind === 'cultureII')
    expect(card && revealPublic(card)).toBe('CultureII')
  })

  it('a great person reveals its type publicly', () => {
    const gp = game.items.find((item) => item.kind === 'greatperson')
    expect(gp && revealPublic(gp)).toBe(gp?.type)
  })

  it('wonders and social policies reveal the name publicly too', () => {
    // This is what Java does. For social policies the log makes up for it by
    // writing "has chosen a hidden social policy" instead.
    const wonder = game.items.find((item) => item.kind === 'wonder')
    expect(wonder && revealPublic(wonder)).toBe(wonder?.name)
    const policy = game.socialPolicies[0]
    expect(policy && revealPublic(policy)).toBe(policy?.name)
  })
})
