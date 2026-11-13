/**
 * Mathematics and Ballistics (issue #327): "Iron — Battle: while involved in a battle, deal up to 3 (6)
 * wounds, spread across enemy units however you choose."
 *
 * Pressing the button pays the Iron and records the wounds owed on the battle (`Battle.techWounds`); the
 * player then deals them one click at a time with `techWound` (`actions/arena.ts`), modelled on Georgy
 * Zhukov's wounds. The player may stop early. The undo vote returns the Iron and removes the wounds owed, and
 * is refused once a wound has been dealt (the health is corrected by hand, as for Zhukov).
 */

import { findResourceToken, returnResource, spendResource } from './assisted-resources.js'
import {
  READY,
  REPEAT_NOTE,
  blocked,
  lastLogId,
  playerOf,
  rejected,
  techBlock,
  useTurnAction,
  usedReason,
} from './assisted-core.js'
import type { AssistedActionDefinition } from './assisted-core.js'
import type { Battle } from './battle.js'
import { TECH_WOUNDS, playerSideOf, techWoundsDealt } from './battle-cards.js'
import { appendLog } from './log.js'
import { err, ok } from './result.js'
import type { AssistedActionKind, GameState, Playerhand } from './state.js'
import { createPlayerTurn, turnStatus } from './turn.js'

const NOT_IN_BATTLE = 'Used during a battle you are fighting in.'

const turnOf = (state: GameState, player: Playerhand) => {
  const turnNumber = turnStatus(state).currentTurn
  return player.playerTurns.find((turn) => turn.turnNumber === turnNumber) ?? createPlayerTurn(player.username, turnNumber)
}

/** The same battle with a changed list of wounds owed. */
const withWounds = (battle: Battle, techWounds: Battle['techWounds']): Battle => {
  const { techWounds: _old, ...rest } = battle
  return techWounds === undefined || techWounds.length === 0 ? rest : { ...rest, techWounds }
}

function woundTech(kind: AssistedActionKind, tech: string): AssistedActionDefinition {
  const wounds = TECH_WOUNDS[tech] ?? 0
  const usageKey = `card:${tech}`
  return {
    kind,
    techName: tech,
    label: tech,
    button: true,
    usageKey,
    phase: 'ANY',
    group: 'Battle',
    buttonText: `Use ${tech} (Iron)`,

    availability(state, playerId) {
      const player = playerOf(state, playerId)
      if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
      const owned = techBlock(player, tech)
      if (owned !== undefined) return owned
      if (state.battle === null) return blocked('wrong-phase', NOT_IN_BATTLE)
      if (playerSideOf(state.battle, playerId) === null) {
        return blocked('unavailable', 'You are not fighting in this battle.')
      }
      if (turnOf(state, player).usedActions.includes(usageKey)) return blocked('used', usedReason(tech))
      if (findResourceToken(state, playerId, 'Iron') === undefined) {
        return blocked('needs-resource', 'You need an Iron token: an Iron hut in your hand or an Iron piece in your player area.')
      }
      return READY
    },

    apply(state, player, context) {
      const battle = state.battle
      if (battle === null) return err(rejected(kind, blocked('wrong-phase', NOT_IN_BATTLE)))
      if (playerSideOf(battle, player.playerId) === null) {
        return err(rejected(kind, blocked('unavailable', 'You are not fighting in this battle.')))
      }
      const spend = spendResource(state, player.playerId, 'Iron', context.at)
      if (!spend.ok) return err(rejected(kind, blocked('needs-resource', 'You need an Iron token.')))
      const after = playerOf(spend.value.state, player.playerId) ?? player
      const marked = useTurnAction(spend.value.state, after, turnOf(spend.value.state, after), usageKey, after.stats)
      const entry = { playerId: player.playerId, tech, total: wounds, dealt: 0, actionId: context.requestId }
      const owing: GameState = {
        ...marked,
        battle: withWounds(battle, [...(battle.techWounds ?? []), entry]),
      }
      const logged = appendLog(owing, {
        username: player.username,
        playerId: player.playerId,
        publicLog:
          `${player.username} used ${tech}: spent 1 Iron to deal up to ${wounds} wounds, spread across enemy units in the battle` +
          (context.confirmedRepeat ? REPEAT_NOTE : ''),
        privateLog: '',
        createdAt: context.at ?? null,
        assistedActionId: context.requestId,
      })
      return ok({
        state: logged,
        effect: { kind: 'techWounds', tech, wounds, battleId: battle.id, spent: spend.value.spent },
        logId: lastLogId(logged),
      })
    },

    reverse(state, player, record, at) {
      const effect = record.effect
      if (effect.kind !== 'techWounds') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
      if (techWoundsDealt(state, record.id) > 0) {
        return err({
          kind: 'ASSISTED_UNDO_BLOCKED',
          logId: record.logId,
          reason: `${tech} has already dealt wounds in this battle, which cannot be taken back.`,
        })
      }
      const without = (battle: Battle): Battle =>
        withWounds(battle, (battle.techWounds ?? []).filter((entry) => entry.actionId !== record.id))
      // The battle on now, or the one End battle has set aside; a battle that is gone has nothing left to take back
      let current: GameState = state
      if (state.battle !== null && state.battle.id === effect.battleId) {
        current = { ...state, battle: without(state.battle) }
      } else if (state.endedBattle !== null && state.endedBattle.battle.id === effect.battleId) {
        current = { ...state, endedBattle: { ...state.endedBattle, battle: without(state.endedBattle.battle) } }
      }
      const returned = returnResource(current, playerOf(current, player.playerId) ?? player, effect.spent, at)
      if (!returned.ok) return returned
      return ok({
        state: returned.value,
        text: `${player.username}'s ${tech} was undone: the Iron returned and the wounds are no longer owed`,
      })
    },
  }
}

export const mathematics = woundTech('mathematics', 'Mathematics')
export const ballistics = woundTech('ballistics', 'Ballistics')
