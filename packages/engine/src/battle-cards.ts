/**
 * The Great Persons played during a battle (issue #301): Leonidas, Joan of Arc and Florence Nightingale.
 * Sun Tzu passes the battle turn and has his own arena action (`sunTzuPass`).
 *
 * The battle is public, so a bonus or a saved unit is plain state on it. Each card names who may play it
 * (`battleCardBlock`); `applyBattleCard` changes the battle and `undoBattleCard` takes it back.
 */

import type { ArenaUnit, Battle, BattleSideId } from './battle.js'
import type { GameState, Playerhand } from './state.js'

export const LEONIDAS = 'Leonidas'
export const JOAN_OF_ARC = 'Joan of Arc'
export const NIGHTINGALE = 'Florence Nightingale'
export const SUN_TZU = 'Sun Tzu'
export const ZHUKOV = 'Georgy Zhukov'
export const GUSTAVUS = 'Gustavus Adolphus'

/** What Leonidas adds to the combat bonus (card text). */
export const LEONIDAS_BONUS = 8
/** What Sun Tzu costs to pass the battle turn (card text). */
export const SUN_TZU_COST = 3

/** The cards `applyBattleCard` carries out. */
export const BATTLE_CARDS: ReadonlySet<string> = new Set([LEONIDAS, JOAN_OF_ARC, NIGHTINGALE, ZHUKOV, GUSTAVUS])

const other = (side: BattleSideId): BattleSideId => (side === 'attacker' ? 'defender' : 'attacker')

/** The side a player fights on in this battle. The controller of the barbarians is not a combatant for a card. */
export function playerSideOf(battle: Battle, playerId: string): BattleSideId | null {
  if (battle.attacker.kind === 'player' && battle.attacker.playerId === playerId) return 'attacker'
  if (battle.defender.kind === 'player' && battle.defender.playerId === playerId) return 'defender'
  return null
}

/** The units a side has put in the arena so far, killed or not, and the ones reinforced away. */
export function forceOf(battle: Battle, side: BattleSideId): number {
  return [...battle.arena, ...battle.departedUnits].filter((unit) => unit.side === side).length
}

/** The killed units of a side that Nightingale can still save, also the ones another unit has since replaced on their front. */
const killedOf = (battle: Battle, side: BattleSideId): readonly ArenaUnit[] =>
  [...battle.arena, ...battle.departedUnits].filter((unit) => unit.side === side && unit.killed && unit.saved !== true)

/** The ids of every unit of a side that has been killed, saved or not. */
const killedIdsOf = (battle: Battle, side: BattleSideId): readonly string[] =>
  [...battle.arena, ...battle.departedUnits].filter((unit) => unit.side === side && unit.killed).map((unit) => unit.id)

/** Zhukov's wounds the player has earned and not yet dealt: their units killed since the card was played. */
export function zhukovOwed(battle: Battle, playerId: string): number {
  const entry = (battle.zhukov ?? []).find((candidate) => candidate.playerId === playerId)
  const side = playerSideOf(battle, playerId)
  if (entry === undefined || side === null) return 0
  return Math.max(0, killedIdsOf(battle, side).filter((id) => !entry.deadIds.includes(id)).length - entry.dealt)
}

/** The wounds Zhukov has dealt for the card play `actionId`, in the battle on now or the one set aside. */
export function zhukovDealt(state: GameState, actionId: string): number {
  const entries = [...(state.battle?.zhukov ?? []), ...(state.endedBattle?.battle.zhukov ?? [])]
  return entries.find((entry) => entry.actionId === actionId)?.dealt ?? 0
}

/**
 * Why the player cannot play a battle card now, or `undefined` when they can. Leonidas and Joan of Arc are for the
 * defender; Leonidas also needs fewer units played than the opponent, which is judged when it is played.
 */
export function battleCardBlock(state: GameState, player: Playerhand, name: string): string | undefined {
  // Florence Nightingale saves the killed units "after a battle" (human, 2026-11-03), so she can also be played on the
  // battle End battle has just set aside, by either combatant, until the next battle starts
  const battle = state.battle ?? (name === NIGHTINGALE ? (state.endedBattle?.battle ?? null) : null)
  if (battle === null) return name === NIGHTINGALE ? 'Played during a battle, or right after it.' : 'Played during a battle.'
  const side = playerSideOf(battle, player.playerId)
  if (side === null) return 'You are not fighting in this battle.'
  switch (name) {
    case LEONIDAS: {
      if (side !== 'defender') return 'Leonidas can be played only by the defender.'
      if ((battle.cardBonuses ?? []).some((bonus) => bonus.card === LEONIDAS && bonus.playerId === player.playerId)) {
        return 'Leonidas has already been played in this battle.'
      }
      const own = forceOf(battle, side)
      const theirs = forceOf(battle, other(side))
      if (own >= theirs) {
        return `Leonidas needs fewer units than your opponent: you have played ${own}, they have played ${theirs}.`
      }
      return undefined
    }
    case JOAN_OF_ARC:
      if (side !== 'defender') return 'Joan of Arc can be played only by the defender.'
      if (player.stats.culture <= 0) return 'You have no unspent culture for Joan of Arc to add.'
      return undefined
    case ZHUKOV:
      return (battle.zhukov ?? []).some((entry) => entry.playerId === player.playerId)
        ? 'Georgy Zhukov has already been played in this battle.'
        : undefined
    case NIGHTINGALE:
      return killedOf(battle, side).length === 0 ? 'None of your units has been killed in this battle.' : undefined
    default:
      return undefined
  }
}

/** What a battle card changed in its battle, kept on the card play so an undo can take it back. */
export interface BattleCardEffect {
  readonly battleId: string
  readonly bonus?: number
  readonly saved?: readonly string[]
  readonly zhukov?: boolean
}

export interface AppliedBattleCard {
  readonly state: GameState
  readonly effect: BattleCardEffect
  /** The end of the public line. */
  readonly said: string
}

/** Carries out a battle card that `battleCardBlock` allowed. `actionId` ties the bonus to the card play. */
export function applyBattleCard(
  state: GameState,
  player: Playerhand,
  name: string,
  actionId: string,
): AppliedBattleCard | undefined {
  if (name === NIGHTINGALE) {
    // The battle on now, or the one that has just ended
    const ended = state.battle === null ? state.endedBattle : null
    const target = state.battle ?? ended?.battle ?? null
    const own = target === null ? null : playerSideOf(target, player.playerId)
    if (target === null || own === null) return undefined
    const saved = killedOf(target, own).map((unit) => unit.id)
    const mark = (unit: ArenaUnit): ArenaUnit => (saved.includes(unit.id) ? { ...unit, saved: true } : unit)
    const marked = { ...target, arena: target.arena.map(mark), departedUnits: target.departedUnits.map(mark) }
    return {
      state: ended === null ? { ...state, battle: marked } : { ...state, endedBattle: { ...ended, battle: marked } },
      effect: { battleId: target.id, saved },
      said: `, saving ${saved.length} killed unit${saved.length === 1 ? '' : 's'}: they stay in the hand`,
    }
  }
  const battle = state.battle
  if (battle === null) return undefined
  const side = playerSideOf(battle, player.playerId)
  if (side === null) return undefined
  if (name === ZHUKOV) {
    const entry = { playerId: player.playerId, deadIds: killedIdsOf(battle, side), dealt: 0, actionId }
    return {
      state: { ...state, battle: { ...battle, zhukov: [...(battle.zhukov ?? []), entry] } },
      effect: { battleId: battle.id, zhukov: true },
      said: ', dealing 1 wound to an enemy unit each time one of their units is killed from now on',
    }
  }
  const amount = name === LEONIDAS ? LEONIDAS_BONUS : name === JOAN_OF_ARC ? player.stats.culture : undefined
  if (amount === undefined) return undefined
  const cardBonuses = [...(battle.cardBonuses ?? []), { playerId: player.playerId, card: name, amount, actionId }]
  return {
    state: { ...state, battle: { ...battle, cardBonuses } },
    effect: { battleId: battle.id, bonus: amount },
    said: `, adding ${amount} to the combat bonus until the battle ends`,
  }
}

/** A battle without what a card play changed in it. */
function withoutCard(battle: Battle, effect: BattleCardEffect, actionId: string): Battle {
  const saved = effect.saved ?? []
  const clear = (unit: ArenaUnit): ArenaUnit => {
    if (!saved.includes(unit.id)) return unit
    const { saved: _saved, ...rest } = unit
    return rest
  }
  return {
    ...battle,
    arena: battle.arena.map(clear),
    departedUnits: battle.departedUnits.map(clear),
    cardBonuses: (battle.cardBonuses ?? []).filter((bonus) => bonus.actionId !== actionId),
    zhukov: (battle.zhukov ?? []).filter((entry) => entry.actionId !== actionId),
  }
}

/**
 * Takes a battle card back, from the battle it was played in: the one on now, or the one End battle has set aside
 * for its ender to bring back, which must not return with the card's bonus in it. A battle that is gone altogether
 * has nothing left to take back (its result stands), so the card alone returns.
 */
export function undoBattleCard(state: GameState, effect: BattleCardEffect, actionId: string): GameState {
  const battle = state.battle
  if (battle !== null && battle.id === effect.battleId) {
    return { ...state, battle: withoutCard(battle, effect, actionId) }
  }
  const ended = state.endedBattle
  if (ended !== null && ended.battle.id === effect.battleId) {
    return { ...state, endedBattle: { ...ended, battle: withoutCard(ended.battle, effect, actionId) } }
  }
  return state
}
