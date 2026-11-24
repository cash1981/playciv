/**
 * The Chinese civilization card: "The Chinese may save one of their killed units after each battle, returning it to their
 * standing forces." End battle discards the killed units' cards; until the next battle starts the Chinese player who fought
 * may take one of their own back into the hand, once per battle (`chineseSaveAction`).
 *
 * Only the Chinese player is offered it (`you.chineseSave`); nobody else's view carries anything about it.
 */

import type { ArenaUnit } from './battle.js'
import { playerSideOf } from './battle-cards.js'
import { itemName } from './item.js'
import type { DiscardedKilledCard } from './killed-units.js'
import { killedCardOnPile } from './killed-units.js'
import type { GameState, Playerhand } from './state.js'

export const CHINESE = 'Chinese'

/** One killed unit the Chinese may save: its arena unit id, and how the battle showed it. */
export interface ChineseSaveUnitView {
  readonly arenaUnitId: string
  readonly name: string
  /** Its front, counted from 0 like `ArenaUnit.position`. */
  readonly position: number
}

/** What the Chinese player may save after the battle that has just ended. */
export interface ChineseSaveView {
  readonly units: readonly ChineseSaveUnitView[]
}

/** A killed unit of the Chinese side and the record of its discarded card. */
export interface ChineseSaveCandidate {
  readonly unit: ArenaUnit
  readonly record: DiscardedKilledCard
}

/**
 * The killed units the player may save now: they are Chinese, fought in the battle End battle has just set aside, and
 * have not saved one from it yet. Only units whose card End battle discarded and that is still on the pile.
 */
export function chineseSaveCandidates(state: GameState, player: Playerhand): readonly ChineseSaveCandidate[] {
  const ended = state.endedBattle
  if (state.battle !== null || ended === null || ended.chineseSaved !== undefined) return []
  if (player.civilization?.name !== CHINESE) return []
  const side = playerSideOf(ended.battle, player.playerId)
  if (side === null) return []
  const records = (ended.killedDiscarded ?? []).filter(
    (record) => record.ownerId === player.playerId && killedCardOnPile(state, record),
  )
  return [...ended.battle.arena, ...ended.battle.departedUnits].flatMap((unit) => {
    if (unit.side !== side || !unit.killed || unit.saved === true) return []
    const record = records.find((candidate) => candidate.cardId === unit.unit.id)
    return record === undefined ? [] : [{ unit, record }]
  })
}

/** The viewer's own choice, or null when there is nothing to save. */
export function chineseSaveViewOf(state: GameState, player: Playerhand): ChineseSaveView | null {
  const candidates = chineseSaveCandidates(state, player)
  if (candidates.length === 0) return null
  return {
    units: candidates.map(({ unit }) => ({ arenaUnitId: unit.id, name: itemName(unit.unit), position: unit.position })),
  }
}
