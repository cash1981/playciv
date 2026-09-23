import { rankByEvidence } from '@civ/engine'
import type { PlacementEvidence, RatedGame } from '@civ/engine'

import { createdAtFromObjectId, oidOf } from './rows.js'
import type { DumpDoc } from './rows.js'

function record(value: unknown): DumpDoc {
  return value !== null && typeof value === 'object' ? value as DumpDoc : {}
}

function cards(value: unknown): readonly DumpDoc[] {
  return Array.isArray(value) ? value.map(record) : []
}

function inner(card: DumpDoc): DumpDoc {
  if (typeof card['kind'] === 'string') return card
  const nested = Object.values(card).find((value) => value !== null && typeof value === 'object')
  return record(nested)
}

function tier(card: DumpDoc): number {
  const item = inner(card)
  const sheet = item['sheetName']
  return sheet === 'CULTURE_3' ? 3 : sheet === 'CULTURE_2' ? 2 : sheet === 'CULTURE_1' ? 1 : 0
}

const PRINTED_COIN_TECHS = new Set(['Civil Service', 'Bureaucracy', 'Railroad', 'Computers'])

/** A one-time estimate from archived Java documents; uncertain fields stay unknown. */
export function legacyRatedGame(doc: DumpDoc): RatedGame | null {
  if (doc['active'] === true || typeof doc['winner'] !== 'string' || doc['winner'] === '') return null
  const id = oidOf(doc['_id']) ?? (typeof doc['id'] === 'string' ? doc['id'] : null)
  if (id === null || !Array.isArray(doc['players'])) return null
  const players = doc['players'].map(record)
  const winner = doc['winner']
  if (!players.some((player) => player['username'] === winner)) return null
  const discarded = cards(doc['discardedItems'])
  const evidence: PlacementEvidence[] = players.map((player) => {
    const playerId = player['playerId']
    const owned = [...cards(player['items']), ...discarded].filter((card) => {
      const owner = inner(card)['ownerId']
      return typeof playerId === 'string' && owner === playerId
    })
    const culture = owned.reduce((max, card) => Math.max(max, tier(card)), 0)
    const techs = Array.isArray(player['techsChosen']) ? cards(player['techsChosen']) : null
    const printedCoins = techs?.filter((card) => PRINTED_COIN_TECHS.has(String(inner(card)['name']))).length ?? 0
    const greatPersonCoins = owned.filter((card) => inner(card)['name'] === 'Adam Smith').length
    return {
      username: String(player['username']),
      techs: techs?.length ?? null,
      cultureTier: culture || null,
      coins: techs === null ? null : printedCoins + greatPersonCoins,
    }
  })
  const created = doc['created']
  const sortKey = Array.isArray(created) && created.length >= 6
    ? created.slice(0, 6).map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0')).join('-')
    : createdAtFromObjectId(id)
  return { id: `pbf:${id}`, sortKey, participants: rankByEvidence(winner, evidence) }
}
