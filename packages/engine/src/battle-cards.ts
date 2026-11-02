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

/** What Leonidas adds to the combat bonus (card text). */
export const LEONIDAS_BONUS = 8
/** What Sun Tzu costs to pass the battle turn (card text). */
export const SUN_TZU_COST = 3

/** The cards `applyBattleCard` carries out. */
export const BATTLE_CARDS: ReadonlySet<string> = new Set([LEONIDAS, JOAN_OF_ARC, NIGHTINGALE])

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

const killedOf = (battle: Battle, side: BattleSideId): readonly ArenaUnit[] =>
  battle.arena.filter((unit) => unit.side === side && unit.killed && unit.saved !== true)

/**
 * Why the player cannot play a battle card now, or `undefined` when they can. Leonidas and Joan of Arc are for the
 * defender; Leonidas also needs fewer units played than the opponent, which is judged when it is played.
 */
export function battleCardBlock(state: GameState, player: Playerhand, name: string): string | undefined {
  const battle = state.battle
  if (battle === null) return 'Played during a battle.'
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
    case NIGHTINGALE:
      return killedOf(battle, side).length === 0 ? 'None of your units has been killed in this battle.' : undefined
    default:
      return undefined
  }
}

export interface AppliedBattleCard {
  readonly state: GameState
  readonly effect: { readonly battleId: string; readonly bonus?: number; readonly saved?: readonly string[] }
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
  const battle = state.battle
  if (battle === null) return undefined
  const side = playerSideOf(battle, player.playerId)
  if (side === null) return undefined
  if (name === NIGHTINGALE) {
    const saved = killedOf(battle, side).map((unit) => unit.id)
    const arena = battle.arena.map((unit) => (saved.includes(unit.id) ? { ...unit, saved: true } : unit))
    return {
      state: { ...state, battle: { ...battle, arena } },
      effect: { battleId: battle.id, saved },
      said: `, saving ${saved.length} killed unit${saved.length === 1 ? '' : 's'}: they stay in the hand`,
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

/**
 * Takes a battle card back. In a battle that has ended there is nothing left to take back (its result stands, and
 * End battle can be undone by its ender), so the card alone returns.
 */
export function undoBattleCard(
  state: GameState,
  effect: { readonly battleId: string; readonly bonus?: number; readonly saved?: readonly string[] },
  actionId: string,
): GameState {
  const battle = state.battle
  if (battle === null || battle.id !== effect.battleId) return state
  const saved = effect.saved ?? []
  const arena = battle.arena.map((unit) => {
    if (!saved.includes(unit.id)) return unit
    const { saved: _saved, ...rest } = unit
    return rest
  })
  const cardBonuses = (battle.cardBonuses ?? []).filter((bonus) => bonus.actionId !== actionId)
  return { ...state, battle: { ...battle, arena, cardBonuses } }
}
