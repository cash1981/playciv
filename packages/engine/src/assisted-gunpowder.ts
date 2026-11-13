/**
 * Gunpowder (issue #327): "Any 2 — City Management: obsolete an ancient or medieval wonder, or destroy a
 * building of your choice."
 *
 * The first "Any N" payment (Pottery's Any 2 and Philosophy's Any 3 can reuse `spendAnyResources`): the player
 * names the resources to pay, as a preference: one it does not hold is paid by any other token, and only what
 * tokens cannot cover by a culture card. The effect itself stays manual: a wonder's obsolescence is not tracked in the
 * engine, and the choice between obsoleting a wonder and destroying a building is the player's, so the log
 * says so. The undo vote returns exactly the tokens spent.
 */

import { ANY_RESOURCES, anyResourceName, anyResourcesAvailability, joinList, returnedText, returnResources, spendAnyResources } from './assisted-resources.js'
import {
  PHASE_REASON,
  REPEAT_NOTE,
  blocked,
  lastLogId,
  openCityManagementTurn,
  playerOf,
  rejected,
  techBlock,
  useTurnAction,
  usedReason,
} from './assisted-core.js'
import type { AssistedActionDefinition } from './assisted-core.js'
import { appendLog } from './log.js'
import { err, ok } from './result.js'

export const GUNPOWDER_NAME = 'Gunpowder'
export const GUNPOWDER_COST = 2
const USAGE_KEY = `card:${GUNPOWDER_NAME}`

const NAMES_NOT_TOKENS = `Name exactly ${GUNPOWDER_COST} resources to pay: ${ANY_RESOURCES.join(', ')}.`

export const gunpowder: AssistedActionDefinition = {
  kind: 'gunpowder',
  techName: GUNPOWDER_NAME,
  label: GUNPOWDER_NAME,
  button: true,
  usageKey: USAGE_KEY,
  phase: 'CM',
  group: 'Resource abilities',
  buttonText: `Use ${GUNPOWDER_NAME} (any ${GUNPOWDER_COST} resources)`,

  availability(state, playerId) {
    const player = playerOf(state, playerId)
    if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
    const tech = techBlock(player, GUNPOWDER_NAME)
    if (tech !== undefined) return tech
    const turn = openCityManagementTurn(state, player)
    if (turn === undefined) return blocked('wrong-phase', PHASE_REASON)
    if (turn.usedActions.includes(USAGE_KEY)) return blocked('used', usedReason(GUNPOWDER_NAME))
    return anyResourcesAvailability(state, playerId, GUNPOWDER_COST)
  },

  apply(state, player, context) {
    const turn = openCityManagementTurn(state, player)
    if (turn === undefined) return err(rejected('gunpowder', blocked('wrong-phase', PHASE_REASON)))
    const named = context.payload !== undefined && 'resources' in context.payload ? context.payload.resources : undefined
    const resources = Array.isArray(named) ? (named as readonly unknown[]).map(anyResourceName) : undefined
    if (resources === undefined || resources.length !== GUNPOWDER_COST || resources.some((name) => name === undefined)) {
      return err(rejected('gunpowder', blocked('unavailable', NAMES_NOT_TOKENS)))
    }
    const names = resources as readonly string[]
    const paid = spendAnyResources(state, player.playerId, names, context.at)
    if (!paid.ok) {
      return err(rejected('gunpowder', blocked('needs-resource', `You cannot pay ${GUNPOWDER_COST} resources for ${GUNPOWDER_NAME}: you hold too few resource tokens or culture cards that can be played as a resource.`)))
    }
    const after = playerOf(paid.value.state, player.playerId) ?? player
    const marked = useTurnAction(paid.value.state, after, turn, USAGE_KEY, after.stats)
    const logged = appendLog(marked, {
      username: player.username,
      playerId: player.playerId,
      // The choice and the effect are made by hand, so the line says what the player has to do next
      publicLog:
        `${player.username} used ${GUNPOWDER_NAME}: ${paid.value.said}. ` +
        'Obsolete an ancient or medieval wonder, or destroy a building of your choice, by hand' +
        (context.confirmedRepeat ? REPEAT_NOTE : ''),
      privateLog: '',
      createdAt: context.at ?? null,
      assistedActionId: context.requestId,
    })
    return ok({
      state: logged,
      effect: { kind: 'gunpowder', spent: paid.value.spent },
      logId: lastLogId(logged),
    })
  },

  reverse(state, player, record, at) {
    const effect = record.effect
    if (effect.kind !== 'gunpowder') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    const returned = returnResources(state, player, effect.spent, at)
    if (!returned.ok) return returned
    return ok({
      state: returned.value,
      text: `${player.username}'s ${GUNPOWDER_NAME} was undone: ${joinList(effect.spent.map(returnedText))} returned`,
    })
  },
}
