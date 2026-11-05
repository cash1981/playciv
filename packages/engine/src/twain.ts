/** Twain's card-specific eligibility. Settlement lives in cancellation.ts, never in a card play. */
import { cityActionOf } from './assisted-core.js'
import { blockadedGreatPersonTypes } from './blockade.js'
import type { AssistedActionRecord, GameState, Playerhand } from './state.js'
import { turnStatus } from './turn.js'

export const TWAIN_NAME = 'Mark Twain'
export const KING_NAME = 'Dr. Martin Luther King'

export interface TwainTarget {
  readonly logId: string
  readonly playerId: string
  readonly username: string
  readonly kind: 'city' | 'culture'
  readonly text: string
  readonly blocked: string | null
}

const holdsFaceupKing = (state: GameState, player: Playerhand): boolean =>
  player.items.some((item) => item.kind === 'greatperson' && item.name === KING_NAME && !item.hidden &&
    !player.pendingRewards.some((r) => r.candidateIds.includes(item.id))) &&
  !blockadedGreatPersonTypes(state, player).includes('Humanitarian')

/** Private historical eligibility, not a public response hint. */
export function availableKingId(state: GameState, player: Playerhand): string | null {
  if (blockadedGreatPersonTypes(state, player).includes('Humanitarian')) return null
  return player.items.find((i) => i.kind === 'greatperson' && i.name === KING_NAME &&
    !player.pendingRewards.some((r) => r.candidateIds.includes(i.id)))?.id ?? null
}

/** Intentional printed exclusions; phase completion is not confirmation. */
export function cancellationRefusal(state: GameState, record: AssistedActionRecord): string | undefined {
  if (record.status !== 'applied') return 'That action is no longer in force.'
  const actor = state.players.find((p) => p.playerId === record.playerId)
  if (actor === undefined) return 'That player has left the game.'
  if (record.effect.kind === 'playCard' && record.effect.garcia !== undefined) return 'Jerry Garcia’s devotion cannot be canceled.'
  if (cityActionOf(record) !== undefined) {
    if (record.lovelaceCreditId !== undefined) return 'An extra city action from Ada Lovelace cannot be canceled.'
    if (holdsFaceupKing(state, actor) && (record.kingAtAction === undefined || record.kingAtAction === availableKingId(state, actor))) {
      return `${actor.username}'s city actions cannot be canceled: Dr. Martin Luther King is faceup.`
    }
    return undefined
  }
  return record.effect.kind === 'playCard' && record.effect.item.kind.startsWith('culture')
    ? undefined : 'Only a city action or a culture event can be cancelled.'
}

export function twainBlock(state: GameState, holder: Playerhand): string | undefined {
  const card = holder.items.find((i) => i.kind === 'greatperson' && i.name === TWAIN_NAME &&
    !holder.pendingRewards.some((r) => r.candidateIds.includes(i.id)))
  if (card === undefined) return 'Mark Twain is not in your hand.'
  if (card.kind === 'greatperson' && card.type !== null && blockadedGreatPersonTypes(state, holder).includes(card.type)) {
    return `Every ${card.type} figure of yours is blockaded, so ${TWAIN_NAME} cannot be used.`
  }
  return undefined
}

/** Public target descriptions, including why a known target is blocked. Never uses another hand's hidden cards. */
export function twainTargetsOf(state: GameState, holder: Playerhand): readonly TwainTarget[] {
  if (twainBlock(state, holder) !== undefined) return []
  const logIndices = new Map(state.log.map((entry, index) => [entry.id, index]))
  return state.assistedActions.flatMap((record): readonly TwainTarget[] => {
    if (record.status !== 'applied' || record.turnNumber < (state.cancellations?.floorTurn ?? turnStatus(state).currentTurn)) return []
    const city = cityActionOf(record) !== undefined
    if (!city && !(record.effect.kind === 'playCard' && record.effect.item.kind.startsWith('culture'))) return []
    const index = logIndices.get(record.logId) ?? -1
    const entry = state.log[index]
    const actor = state.players.find((p) => p.playerId === record.playerId)
    if (entry === undefined || actor === undefined) return []
    const blocked = record.playerId === holder.playerId ? 'Your own action: Mark Twain cancels the action of another player.'
      : cancellationRefusal(state, record) ??
        (index < (state.cancellations?.sealedThrough ?? 0) ? 'That action is before the shared confirmation frontier.'
          : state.cancellations?.cases.some((c) => c.outcome === 'pending') ? 'A cancellation is already pending.' : null)
    return [{ logId: record.logId, playerId: actor.playerId, username: actor.username,
      kind: city ? 'city' : 'culture', text: entry.publicLog, blocked }]
  })
}

export const twainRecordOf = (state: GameState, logId: string): AssistedActionRecord | undefined =>
  state.assistedActions.find((r) => r.logId === logId)
