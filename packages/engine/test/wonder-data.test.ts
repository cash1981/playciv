/**
 * The wonder cost table against the Wonders sheet it was read from, so the two cannot
 * drift: every wonder of the deck has a row, the cost, the discount and the era are the
 * sheet's (but for the corrections listed in the table), and every row has board art to move.
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { BOARD_ASSETS, wonderAssetId } from '../src/board.js'
import {
  SHEET_CORRECTIONS,
  WONDERS_PER_ERA,
  WONDER_ASSET_IDS,
  WONDER_CULTURE,
  WONDER_DATA,
  WONDER_ERAS,
  wonderCostFor,
  wonderCultureOf,
  wonderDataOf,
} from '../src/wonder-data.js'

type Sheet = readonly (readonly (string | undefined)[])[]

const sheet = (
  JSON.parse(readFileSync(new URL('../data/gamedata-faf-waw.json', import.meta.url), 'utf8')) as {
    sheets: { Wonders: Sheet }
  }
).sheets.Wonders

/** The wonder rows only: the three header rows ("Ancient Wonders", ...) have "Description" in column 1. */
const rows = sheet.filter((row) => row[0] !== undefined && row[1] !== 'Description')

describe('the wonder cost table', () => {
  it('has a row for every wonder of the sheet, and nothing else', () => {
    expect(rows).toHaveLength(27)
    expect([...WONDER_ASSET_IDS].sort()).toEqual(rows.map((row) => wonderAssetId(row[0] as string)).sort())
  })

  it('has the cost and the discount of the sheet for each, but for the listed corrections', () => {
    for (const row of rows) {
      const assetId = wonderAssetId(row[0] as string)
      const data = wonderDataOf(assetId)
      expect(data, row[0]).toBeDefined()
      expect(data?.cost, row[0]).toBe(Number(row[2]))
      const discount = row[3]?.trim() ?? ''
      const match = /^(\d+) w\/ (.+)$/.exec(discount)
      if (Object.hasOwn(SHEET_CORRECTIONS, assetId)) {
        // A correction differs from the sheet in the discount only, and says why
        expect(data?.discount, row[0]).not.toEqual({ tech: match?.[2], cost: Number(match?.[1]) })
        expect(data?.discount?.tech, row[0]).toBe(match?.[2])
        continue
      }
      if (discount === '') expect(data?.discount, row[0]).toBeUndefined()
      else expect(data?.discount, row[0]).toEqual({ tech: match?.[2], cost: Number(match?.[1]) })
    }
    expect(Object.keys(SHEET_CORRECTIONS)).toEqual(['wonders/angkorwat'])
    expect(wonderDataOf('wonders/angkorwat')?.discount).toEqual({ tech: 'Theology', cost: 15 })
  })

  it('has the era of the block of the sheet the wonder is in, nine of each', () => {
    let era = 0
    const eras = WONDER_ERAS
    for (const row of sheet) {
      if (row[1] === 'Description') {
        era = eras.findIndex((name) => row[0]?.startsWith(name))
        continue
      }
      if (row[0] === undefined) continue
      expect(wonderDataOf(wonderAssetId(row[0]))?.era, row[0]).toBe(eras[era])
    }
    for (const name of eras) {
      expect(Object.values(WONDER_DATA).filter((data) => data.era === name)).toHaveLength(9)
    }
    expect(WONDERS_PER_ERA).toBe(4)
  })

  it('has board art for every wonder, so it can be moved onto the map', () => {
    const ids = new Set(BOARD_ASSETS.map((asset) => asset.id))
    for (const assetId of WONDER_ASSET_IDS) expect(ids.has(assetId), assetId).toBe(true)
  })

  it('a discount is always cheaper, and the tech makes the player pay it', () => {
    for (const [assetId, data] of Object.entries(WONDER_DATA)) {
      if (data.discount === undefined) continue
      expect(data.discount.cost, assetId).toBeLessThan(data.cost)
      expect(wonderCostFor(data, new Set())).toBe(data.cost)
      expect(wonderCostFor(data, new Set([data.discount.tech]))).toBe(data.discount.cost)
    }
  })

  it('knows no wonder under another name, nor one inherited from Object', () => {
    expect(wonderDataOf('wonders/nothing')).toBeUndefined()
    expect(wonderDataOf('toString')).toBeUndefined()
  })

  it('knows the culture on each marker, as read from the 27 images: 1 ancient, 2 medieval, 3 modern', () => {
    const read: Readonly<Record<string, number>> = {
      'wonders/chichenitza': 1,
      'wonders/colossus': 1,
      'wonders/greatlighthouse': 1,
      'wonders/greatwall': 1,
      'wonders/hanginggardens': 1,
      'wonders/oracle': 1,
      'wonders/pyramids': 1,
      'wonders/statueofzeus': 1,
      'wonders/stonehenge': 1,
      'wonders/angkorwat': 2,
      'wonders/brandenburggate': 2,
      'wonders/himejisamuraicastle': 2,
      "wonders/leonardo'sworkshop": 2,
      'wonders/louvre': 2,
      'wonders/machupichu': 2,
      'wonders/notredame': 2,
      'wonders/porcelaintower': 2,
      'wonders/tajmahal': 2,
      'wonders/bigben': 3,
      'wonders/cristoredentor': 3,
      'wonders/internet': 3,
      'wonders/kremlin': 3,
      'wonders/panamacanal': 3,
      'wonders/pentagon': 3,
      'wonders/statueofliberty': 3,
      'wonders/sydneyoperahouse': 3,
      'wonders/unitednations': 3,
    }
    expect(Object.keys(read).sort()).toEqual([...WONDER_ASSET_IDS].sort())
    for (const [assetId, culture] of Object.entries(read)) expect(wonderCultureOf(assetId), assetId).toBe(culture)
    expect(WONDER_CULTURE).toEqual({ Ancient: 1, Medieval: 2, Modern: 3 })
    expect(wonderCultureOf('wonders/nothing')).toBeUndefined()
  })
})
