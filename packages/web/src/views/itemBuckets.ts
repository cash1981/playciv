/**
 * Groups items by kind the way old-civ-web's hand view did: `UserItemController`
 * (`old-civ-web/app/scripts/controllers/UserItemController.js:53-74`) and its
 * template `useritems.html` bucket a player's own items into eight sections —
 * Civilizations, Items (a catch-all for wonders, city-states, techs and social
 * policies), Great Persons, Units, Tiles, Culture Cards, Huts, Villages — and
 * render one heading per non-empty bucket, in that fixed order.
 *
 * `RevealedController`'s Revealed/Discarded feed duplicated the identical
 * bucketing independently there, and this port briefly ported it to the
 * Revealed/Discarded panel too (issue #190) before the human asked for that to
 * be reverted: grouping belongs to the hand, and Revealed/Discarded stays a
 * flat, newest-first list. See the 2026-09-28 decisions.md entries for both
 * issue #190 and this follow-up.
 *
 * Deliberate departure: this port keeps the order but renders no heading per
 * bucket; the hand is one continuous grid (see decisions.md, 2026-09-29).
 * `BUCKET_LABEL` is kept for reference and has no consumer at present.
 */

import { isUnit } from '@civ/engine'
import type { Item } from '@civ/engine'

export const BUCKET_ORDER = [
  'civs',
  'items',
  'greatPersons',
  'units',
  'tiles',
  'cultureCards',
  'huts',
  'villages',
] as const

export type Bucket = (typeof BUCKET_ORDER)[number]

export const BUCKET_LABEL: Readonly<Record<Bucket, string>> = {
  civs: 'Civilizations',
  items: 'Items',
  greatPersons: 'Great Persons',
  units: 'Units',
  tiles: 'Tiles',
  cultureCards: 'Culture Cards',
  huts: 'Huts',
  villages: 'Villages',
}

/** Port of `readKeysFromItems`'s if/else chain. */
export function bucketFor(item: Item): Bucket {
  switch (item.kind) {
    case 'cultureI':
    case 'cultureII':
    case 'cultureIII':
      return 'cultureCards'
    case 'greatperson':
      return 'greatPersons'
    case 'hut':
      return 'huts'
    case 'village':
      return 'villages'
    case 'tile':
      return 'tiles'
    case 'civ':
      return 'civs'
    default:
      return isUnit(item) ? 'units' : 'items'
  }
}

/**
 * Groups `entries` into the eight buckets, in fixed order, skipping empty
 * ones. Within a bucket, `entries`' existing order is preserved unchanged —
 * callers that want newest-first within a bucket pass entries already sorted
 * that way.
 */
export function groupByOldClientBucket<T>(
  entries: readonly T[],
  itemOf: (entry: T) => Item,
): ReadonlyArray<{ readonly bucket: Bucket; readonly entries: readonly T[] }> {
  const byBucket = new Map<Bucket, T[]>()
  for (const entry of entries) {
    const bucket = bucketFor(itemOf(entry))
    const list = byBucket.get(bucket)
    if (list === undefined) {
      byBucket.set(bucket, [entry])
    } else {
      list.push(entry)
    }
  }
  const groups: Array<{ readonly bucket: Bucket; readonly entries: readonly T[] }> = []
  for (const bucket of BUCKET_ORDER) {
    const bucketEntries = byBucket.get(bucket)
    if (bucketEntries !== undefined) groups.push({ bucket, entries: bucketEntries })
  }
  return groups
}
