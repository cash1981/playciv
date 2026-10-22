/**
 * The wonder cost table against the Wonders sheet it was read from, so the two cannot
 * drift: every wonder of the deck has a row, the cost and the discount are the sheet's,
 * and every row has board art to move.
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { BOARD_ASSETS, wonderAssetId } from '../src/board.js'
import { WONDER_ASSET_IDS, WONDER_DATA, wonderCostFor, wonderDataOf } from '../src/wonder-data.js'

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

  it('has the cost and the discount of the sheet for each', () => {
    for (const row of rows) {
      const data = wonderDataOf(wonderAssetId(row[0] as string))
      expect(data, row[0]).toBeDefined()
      expect(data?.cost, row[0]).toBe(Number(row[2]))
      const discount = row[3]?.trim() ?? ''
      const match = /^(\d+) w\/ (.+)$/.exec(discount)
      if (discount === '') expect(data?.discount, row[0]).toBeUndefined()
      else expect(data?.discount, row[0]).toEqual({ tech: match?.[2], cost: Number(match?.[1]) })
    }
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
})
