/** Twain's card-specific eligibility. The cancellation itself lives in cancellation.ts, never in a card play. */
import { LOVELACE_NAME, cityActionOf, massMediaShield, resourceAbilityOf } from './assisted-core.js'
import { blockadedGreatPersonTypes } from './blockade.js'
import type { AssistedActionRecord, GameState, Playerhand } from './state.js'
import { turnStatus } from './turn.js'

export const TWAIN_NAME = 'Mark Twain'
export const KING_NAME = 'Dr. Martin Luther King'

export interface TwainTarget {
  readonly logId: string
  readonly playerId: string
  readonly username: string
  readonly kind: 'city' | 'culture' | 'ability'
  readonly text: string
  readonly blocked: string | null
}

export const holdsFaceupKing = (state: GameState, player: Playerhand): boolean =>
  player.items.some((item) => item.kind === 'greatperson' && item.name === KING_NAME && !item.hidden &&
    !player.pendingRewards.some((r) => r.candidateIds.includes(item.id))) &&
  !blockadedGreatPersonTypes(state, player).includes('Humanitarian')

/** Private historical eligibility, not a public response hint. */
export function availableKingId(state: GameState, player: Playerhand): string | null {
  if (blockadedGreatPersonTypes(state, player).includes('Humanitarian')) return null
  return player.items.find((i) => i.kind === 'greatperson' && i.name === KING_NAME &&
    !player.pendingRewards.some((r) => r.candidateIds.includes(i.id)))?.id ?? null
}

/** Intentional printed exclusions. */
export function cancellationRefusal(state: GameState, record: AssistedActionRecord): string | undefined {
  if (record.status !== 'applied') return 'That action is no longer in force.'
  const actor = state.players.find((p) => p.playerId === record.playerId)
  if (actor === undefined) return 'That player has left the game.'
  if (record.effect.kind === 'playCard' && record.effect.garcia !== undefined) return 'Jerry Garcia’s devotion cannot be canceled.'
  if (cityActionOf(record) !== undefined) {
    // Only Ada Lovelace's extra action is immune: the credit may also be one of Supply Drop's
    const credit = record.lovelaceCreditId === undefined ? undefined : state.assistedActions.find((r) => r.id === record.lovelaceCreditId)
    if (credit?.effect.kind === 'playCard' && credit.effect.name === LOVELACE_NAME) return 'An extra city action from Ada Lovelace cannot be canceled.'
    // King protects the action when he is faceup now, or was when it was taken: the rewind would bring him back with it
    if (record.kingFaceupAtAction === true ||
        (holdsFaceupKing(state, actor) && (record.kingAtAction === undefined || record.kingAtAction === availableKingId(state, actor)))) {
      return `${actor.username}'s city actions cannot be canceled: Dr. Martin Luther King is faceup.`
    }
    return undefined
  }
  if (resourceAbilityOf(record) !== undefined) return undefined
  if (record.effect.kind === 'playCard' && record.effect.item.kind.startsWith('culture')) {
    // Mass Media: "Your culture events cannot be canceled, regardless of other game effects" (every card and tech that cancels one)
    return massMediaShield(actor)
  }
  return 'Only a city action, a culture event or a resource ability can be cancelled.'
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
    const ability = resourceAbilityOf(record) !== undefined
    if (!city && !ability && !(record.effect.kind === 'playCard' && record.effect.item.kind.startsWith('culture'))) return []
    const index = logIndices.get(record.logId) ?? -1
    const entry = state.log[index]
    const actor = state.players.find((p) => p.playerId === record.playerId)
    if (entry === undefined || actor === undefined) return []
    const blocked = record.playerId === holder.playerId ? 'Your own action: Mark Twain cancels the action of another player.'
      : cancellationRefusal(state, record) ??
        (index < (state.cancellations?.sealedThrough ?? 0) ? 'That action is before an earlier cancellation.' : null)
    return [{ logId: record.logId, playerId: actor.playerId, username: actor.username,
      kind: city ? 'city' : ability ? 'ability' : 'culture', text: entry.publicLog, blocked }]
  })
}

