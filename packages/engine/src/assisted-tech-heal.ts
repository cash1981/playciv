/**
 * Animal Husbandry and Biology (issue #354): "Once per battle, heal up to a total of 3 wounds (all wounds) from your units
 * in play." Both are free and work in a battle the player fights in, on their own living arena units, up to the health the
 * card has at its level. They are once per battle, not per turn, so the mark is the entry on the battle (`Battle.heals`).
 *
 * Animal Husbandry's button owes 3 wounds, healed with `healUnits` (`actions/arena.ts`) the way Mathematics' wounds are dealt:
 * the player chooses how many each unit gets and may stop early. Its undo vote takes the wounds away and is refused once one
 * was healed. Biology heals every wounded unit when pressed, and its undo puts each unit's health back while that unit still has
 * what the heal gave it, and only until End battle (the results are counted with the healed units). Animal Husbandry's production boost is a separate button (`assisted-tech-abilities.ts`).
 */

import { blocked, lastLogId, playerOf, rejected, techBlock } from './assisted-core.js'
import type { AssistedActionDefinition } from './assisted-core.js'
import type { ArenaUnit, Battle } from './battle.js'
import { HEAL_TECHS, healUsed, healsDone, playerSideOf } from './battle-cards.js'
import { appendLog } from './log.js'
import { err, ok } from './result.js'
import type { AssistedActionKind, GameState } from './state.js'
import { healableWounds } from './actions/arena.js'

const NOT_IN_BATTLE = 'Used during a battle you are fighting in.'

/** The player's own living units in the arena that have lost health. */
const woundedUnits = (battle: Battle, playerId: string): readonly ArenaUnit[] => {
  const side = playerSideOf(battle, playerId)
  return side === null ? [] : battle.arena.filter((unit) => unit.side === side && !unit.killed && healableWounds(unit) > 0)
}

/** The battle on now, or the one End battle has set aside, with `change` applied to it. */
function withBattle(state: GameState, battleId: string, change: (battle: Battle) => Battle): GameState | undefined {
  if (state.battle !== null && state.battle.id === battleId) return { ...state, battle: change(state.battle) }
  if (state.endedBattle !== null && state.endedBattle.battle.id === battleId) {
    return { ...state, endedBattle: { ...state.endedBattle, battle: change(state.endedBattle.battle) } }
  }
  return undefined
}

function healTech(kind: AssistedActionKind, tech: string): AssistedActionDefinition {
  const wounds = HEAL_TECHS[tech] ?? null
  return {
    kind,
    // The tech's own button in the tech dialog is Animal Husbandry's production boost, so the heal is listed in the Battle panel
    techName: null,
    label: `${tech} (heal)`,
    button: true,
    usageKey: null,
    // Once per battle is a hard limit here: the mark is the battle's entry, which a confirmed repeat of the turn's key cannot give back
    strictOnce: true,
    phase: 'ANY',
    group: 'Battle',
    buttonText: wounds === null ? `Use ${tech} (heal all wounds)` : `Use ${tech} (heal up to ${wounds} wounds)`,

    availability(state, playerId) {
      const player = playerOf(state, playerId)
      if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
      const owned = techBlock(player, tech)
      if (owned !== undefined) return owned
      if (state.battle === null) return blocked('wrong-phase', NOT_IN_BATTLE)
      if (playerSideOf(state.battle, playerId) === null) return blocked('unavailable', 'You are not fighting in this battle.')
      if (healUsed(state.battle, playerId, tech)) return blocked('used', `${tech} has already healed in this battle: it works once per battle.`)
      if (woundedUnits(state.battle, playerId).length === 0) return blocked('unavailable', 'None of your units in the arena is wounded.')
      return { status: 'ready', reason: 'Ready to use.' }
    },

    apply(state, player, context) {
      const battle = state.battle
      if (battle === null) return err(rejected(kind, blocked('wrong-phase', NOT_IN_BATTLE)))
      if (playerSideOf(battle, player.playerId) === null) return err(rejected(kind, blocked('unavailable', 'You are not fighting in this battle.')))
      if (healUsed(battle, player.playerId, tech)) return err(rejected(kind, blocked('used', `${tech} has already healed in this battle: it works once per battle.`)))
      const wounded = woundedUnits(battle, player.playerId)
      if (wounded.length === 0) return err(rejected(kind, blocked('unavailable', 'None of your units in the arena is wounded.')))
      const units = wounded.map((unit) => ({ arenaUnitId: unit.id, before: unit.health, after: unit.health + healableWounds(unit) }))
      const healedNow = units.reduce((sum, unit) => sum + unit.after - unit.before, 0)
      const entry = { playerId: player.playerId, tech, total: wounds ?? healedNow, healed: wounds === null ? healedNow : 0, actionId: context.requestId }
      const ids = new Map(units.map((unit) => [unit.arenaUnitId, unit.after]))
      const healed: GameState = {
        ...state,
        battle: {
          ...battle,
          arena: wounds === null ? battle.arena.map((unit) => (ids.has(unit.id) ? { ...unit, health: ids.get(unit.id) ?? unit.health } : unit)) : battle.arena,
          heals: [...(battle.heals ?? []), entry],
        },
      }
      const logged = appendLog(healed, {
        username: player.username,
        playerId: player.playerId,
        publicLog:
          wounds === null
            ? `${player.username} used ${tech}: heals all wounds (${healedNow}) from ${units.length} unit${units.length === 1 ? '' : 's'} in play`
            : `${player.username} used ${tech}: may heal up to ${wounds} wounds from their units in play`,
        privateLog: '',
        createdAt: context.at ?? null,
        assistedActionId: context.requestId,
      })
      return ok({
        state: logged,
        effect: { kind: 'techHeal', tech, battleId: battle.id, wounds: wounds ?? healedNow, units: wounds === null ? units : [] },
        logId: lastLogId(logged),
      })
    },

    reverse(state, player, record) {
      const effect = record.effect
      if (effect.kind !== 'techHeal') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
      const blockedUndo = (reason: string) => err({ kind: 'ASSISTED_UNDO_BLOCKED' as const, logId: record.logId, reason })
      if (wounds !== null && healsDone(state, record.id) > 0) return blockedUndo(`${tech} has already healed wounds in this battle, which cannot be taken back.`)
      // The results of an ended battle are frozen with its arena, so a heal that changed health is not taken back after End battle
      const live = state.battle !== null && state.battle.id === effect.battleId ? state.battle : undefined
      if (live === undefined && wounds === null) return blockedUndo(`${tech} cannot be undone: its battle is over, and its results were counted with the healed units.`)
      const arenaOf = live?.arena ?? (state.endedBattle?.battle.id === effect.battleId ? state.endedBattle.battle.arena : undefined)
      if (arenaOf === undefined) return blockedUndo(`${tech} cannot be undone: its battle is over.`)
      for (const unit of effect.units) {
        const now = arenaOf.find((candidate) => candidate.id === unit.arenaUnitId)
        if (now === undefined) return blockedUndo('A unit it healed is no longer in the arena, so its health cannot be taken back.')
        if (now.health !== unit.after) return blockedUndo(`The health of a healed unit was edited since (it is ${now.health}, not ${unit.after}), so it cannot be taken back. Correct it by hand.`)
      }
      const before = new Map(effect.units.map((unit) => [unit.arenaUnitId, unit.before]))
      const cleaned = withBattle(state, effect.battleId, (battle) => {
        const { heals, ...rest } = battle
        const left = (heals ?? []).filter((entry) => entry.actionId !== record.id)
        return {
          ...rest,
          arena: battle.arena.map((unit) => (before.has(unit.id) ? { ...unit, health: before.get(unit.id) ?? unit.health } : unit)),
          ...(left.length === 0 ? {} : { heals: left }),
        }
      })
      if (cleaned === undefined) return blockedUndo(`${tech} cannot be undone: its battle is over.`)
      return ok({
        state: cleaned,
        text: `${player.username}'s ${tech} was undone: ${wounds === null ? 'the units have their wounds again' : 'the wounds are no longer owed'}`,
      })
    },
  }
}

export const animalHusbandryHeal = healTech('animalHusbandryHeal', 'Animal Husbandry')
export const biologyHeal = healTech('biologyHeal', 'Biology')
