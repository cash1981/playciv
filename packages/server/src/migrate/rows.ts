/**
 * Pure mapping from the restored `playciv` mongodump export to D1 rows.
 *
 * The export is pretty-printed extended JSON whose only special type is
 * `{"$oid": "…"}`. Everything here is a pure function of one document, so the
 * mapping is unit-tested with small fixtures rather than the 100 MB dump.
 *
 * A field that the app reads is a real column; the rest of the document is the
 * JSON `doc`/`state` payload. See `docs/agents/tasks/issue-72-d1.md`.
 */

export interface PlayerRow {
  readonly id: string
  readonly username: string
  /** `username` folded with JavaScript's Unicode-aware `toLowerCase`. */
  readonly username_lower: string
  readonly email: string | null
  readonly password: string
  readonly created_at: string
  readonly role: string
  readonly disabled: number
  readonly disable_email: number
}

export interface GameRow {
  readonly id: string
  readonly rev: number
  readonly active: number
  readonly winner: string | null
  readonly num_of_players: number
  readonly state: string
}

export interface RevisionRow {
  readonly game_id: string
  readonly revision: number
  readonly created_at: string
  readonly actor_id: string
  readonly actor_username: string
  readonly public_description: string
  readonly private_descriptions: string
  readonly log_ids: string
  readonly state: string
}

export interface EmailSentRow {
  readonly scope: string
  readonly at: string
}

export interface PbfRow {
  readonly id: string
  readonly active: number
  readonly winner: string | null
  readonly num_of_players: number
  readonly players: string
}

export interface PbfDocRow {
  readonly pbf_id: string
  readonly seq: number
  readonly chunk: string
}

export type DumpDoc = Readonly<Record<string, unknown>>

const EPOCH = new Date(0).toISOString()

function asRecord(value: unknown): DumpDoc {
  return typeof value === 'object' && value !== null ? (value as DumpDoc) : {}
}

/** `{"$oid": "hex"}` or a plain string `_id` becomes a string; else null. */
export function oidOf(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null) {
    const oid = (value as DumpDoc)['$oid']
    if (typeof oid === 'string') return oid
  }
  return null
}

/** Recursively replaces `{"$oid": "…"}` with its hex string. */
export function normalizeExtendedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeExtendedJson)
  if (typeof value === 'object' && value !== null) {
    const oid = (value as DumpDoc)['$oid']
    if (typeof oid === 'string' && Object.keys(value).length === 1) return oid
    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      out[key] = normalizeExtendedJson(nested)
    }
    return out
  }
  return value
}

function stringField(doc: DumpDoc, key: string): string | null {
  const value = doc[key]
  return typeof value === 'string' ? value : null
}

function numberField(doc: DumpDoc, key: string): number | null {
  const value = doc[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * A legacy record's `_id` timestamp, the same fallback `MongoRepository` used.
 */
export function createdAtFromObjectId(id: string): string {
  if (!/^[0-9a-fA-F]{24}$/.test(id)) return EPOCH
  const seconds = Number.parseInt(id.slice(0, 8), 16)
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : EPOCH
}

function requireId(doc: DumpDoc, collection: string): string {
  const id = oidOf(doc['_id']) ?? stringField(doc, 'id')
  if (id === null || id === '') {
    throw new Error(`A ${collection} document has no usable _id`)
  }
  return id
}

export function playerRow(doc: DumpDoc): PlayerRow {
  const id = requireId(doc, 'player')
  const username = stringField(doc, 'username') ?? ''
  return {
    id,
    username,
    // JavaScript folding, so D1 matches the JSON repository for non-ASCII names.
    // `0002_username_lower.sql` back-fills migrated rows with SQLite's ASCII
    // `lower()`, which is exact for every restored username.
    username_lower: username.toLowerCase(),
    email: stringField(doc, 'email'),
    password: stringField(doc, 'password') ?? '',
    created_at: stringField(doc, 'createdAt') ?? createdAtFromObjectId(id),
    role: doc['role'] === 'admin' ? 'admin' : 'user',
    disabled: doc['disabled'] === true ? 1 : 0,
    disable_email: doc['disableEmail'] === true ? 1 : 0,
  }
}

export function gameRow(doc: DumpDoc): GameRow {
  const id = oidOf(doc['_id']) ?? stringField(doc, 'id')
  if (id === null || id === '') throw new Error('A game document has no usable _id')
  const winner = stringField(doc, 'winner')
  // The stored GameState JSON never carries Mongo's `_id`; `state` is the whole
  // document minus it, so `migrateGameState` sees exactly what the app saved.
  const state = Object.fromEntries(Object.entries(doc).filter(([key]) => key !== '_id'))
  return {
    id,
    rev: numberField(doc, 'rev') ?? 0,
    active: doc['active'] === true ? 1 : 0,
    winner: winner === null || winner === '' ? null : winner,
    num_of_players: numberField(doc, 'numOfPlayers') ?? 0,
    state: JSON.stringify(state),
  }
}

export function revisionRow(doc: DumpDoc): RevisionRow {
  const actor = asRecord(doc['actor'])
  return {
    game_id: stringField(doc, 'gameId') ?? '',
    revision: numberField(doc, 'revision') ?? 0,
    created_at: stringField(doc, 'createdAt') ?? EPOCH,
    actor_id: stringField(actor, 'playerId') ?? '',
    actor_username: stringField(actor, 'username') ?? '',
    public_description: stringField(doc, 'publicDescription') ?? '',
    private_descriptions: JSON.stringify(asRecord(doc['privateDescriptions'])),
    log_ids: JSON.stringify(Array.isArray(doc['logIds']) ? doc['logIds'] : []),
    state: JSON.stringify(doc['state'] ?? {}),
  }
}

export function emailSentRow(doc: DumpDoc): EmailSentRow {
  return {
    scope: oidOf(doc['_id']) ?? stringField(doc, 'scope') ?? '',
    at: stringField(doc, 'at') ?? EPOCH,
  }
}

export function pbfRow(doc: DumpDoc): PbfRow {
  const roster = (Array.isArray(doc['players']) ? doc['players'] : []).map((entry) => {
    const player = asRecord(entry)
    const civilization = asRecord(player['civilization'])
    return {
      username: stringField(player, 'username') ?? '',
      civName: stringField(civilization, 'name'),
    }
  })
  const winner = stringField(doc, 'winner')
  return {
    id: requireId(doc, 'pbf'),
    active: doc['active'] === true ? 1 : 0,
    winner: winner === null || winner === '' ? null : winner,
    num_of_players: numberField(doc, 'numOfPlayers') ?? roster.length,
    players: JSON.stringify(roster),
  }
}

/** ~40 KB keeps an escaped statement well under D1's ~100 KB limit. */
export const PBF_DOC_CHUNK_SIZE = 40_000

/**
 * The full document, normalised and split into chunks. Nothing reads it; it is
 * kept so the move loses no data. A single `pbf` document can exceed D1's
 * per-statement limit, which is why it is not one column.
 */
export function pbfDocChunks(doc: DumpDoc): readonly PbfDocRow[] {
  const json = JSON.stringify(normalizeExtendedJson(doc))
  const chunks: PbfDocRow[] = []
  for (let offset = 0, seq = 0; offset < json.length; offset += PBF_DOC_CHUNK_SIZE, seq += 1) {
    chunks.push({
      pbf_id: requireId(doc, 'pbf'),
      seq,
      chunk: json.slice(offset, offset + PBF_DOC_CHUNK_SIZE),
    })
  }
  return chunks
}

