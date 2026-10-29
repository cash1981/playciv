/**
 * Helpers for reading documents from the restored `playciv` mongodump export,
 * which is extended JSON whose only special type is `{"$oid": "…"}`. Used by
 * the legacy rating backfill.
 */

export type DumpDoc = Readonly<Record<string, unknown>>

const EPOCH = new Date(0).toISOString()

/** `{"$oid": "hex"}` or a plain string `_id` becomes a string; else null. */
export function oidOf(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null) {
    const oid = (value as DumpDoc)['$oid']
    if (typeof oid === 'string') return oid
  }
  return null
}

/**
 * A legacy record's `_id` timestamp, the same fallback `MongoRepository` used.
 */
export function createdAtFromObjectId(id: string): string {
  if (!/^[0-9a-fA-F]{24}$/.test(id)) return EPOCH
  const seconds = Number.parseInt(id.slice(0, 8), 16)
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : EPOCH
}
