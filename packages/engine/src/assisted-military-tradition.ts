/**
 * Military Tradition (issue #311): "Once per turn, get a free unlocked military unit
 * when you build an army figure" (tech sheet, Policy Benefits). After an army figure
 * is built with Build this turn, City Management offers one button per unit type; the
 * one pressed draws a card of that type into the hand for free, as a unit build does.
 * Once per turn, whichever type was chosen.
 *
 * The army must have been built with Build, so the action can see it: an army put on
 * the map by hand does not count. The army build cannot be undone while the free unit
 * stands on it; the free unit's own undo goes first.
 */

import { drawCandidates, shuffleSheetTwice } from './assisted-culture.js'
import {
  PHASE_REASON,
  READY,
  blocked,
  lastLogId,
  openCityManagementTurn,
  playerOf,
  rejected,
  techBlock,
  useTurnAction,
  withPlayerHand,
} from './assisted-core.js'
import type { AssistedActionDefinition, BlockedAvailability } from './assisted-core.js'
import { policyBlock } from './assisted-sot.js'
import { UNIT_TYPES } from './build-item.js'
import type { UnitType } from './build-item.js'
import { unitCardAvailable, unitSheetOf } from './build-options.js'
import { itemName } from './item.js'
import type { Item } from './item.js'
import { appendLog } from './log.js'
import { err, ok } from './result.js'
import { SHEET_LABEL } from './sheet-name.js'
import type { AssistedActionRecord, GameState, Playerhand } from './state.js'

const POLICY = 'Military Tradition'
export const MILITARY_TRADITION_USAGE_KEY = 'policy:Military Tradition'

/** Aircraft are unlocked by Flight; the other three types always are. */
const AIRCRAFT_TECH = 'Flight'

const kindOf = (unitType: UnitType) => `militaryTradition:${unitType}` as const

const unitNoun = (unitType: UnitType): string => `${unitType} unit`

/** The player's army builds of this turn that are still applied and whose army is still on the board. */
const armyBuildsOf = (state: GameState, playerId: string, turnNumber: number): readonly AssistedActionRecord[] =>
  state.assistedActions.filter((record) => {
    const effect = record.effect
    return (
      record.status === 'applied' &&
      record.playerId === playerId &&
      record.turnNumber === turnNumber &&
      effect.kind === 'build' &&
      effect.item.kind === 'army' &&
      'pieceId' in effect &&
      state.board.pieces.some((piece) => piece.id === effect.pieceId)
    )
  })

/**
 * Why the army build `record` cannot be taken back: a free unit of Military Tradition
 * that this turn still holds and no other army build of the turn would carry. `undefined`
 * when nothing stands in the way.
 */
export function militaryTraditionUndoBlock(state: GameState, record: AssistedActionRecord): string | undefined {
  if (record.effect.kind !== 'build' || record.effect.item.kind !== 'army') return undefined
  const freeUnit = state.assistedActions.some(
    (candidate) =>
      candidate.status === 'applied' &&
      candidate.playerId === record.playerId &&
      candidate.turnNumber === record.turnNumber &&
      candidate.effect.kind === 'militaryTradition',
  )
  if (!freeUnit) return undefined
  const others = armyBuildsOf(state, record.playerId, record.turnNumber).filter((candidate) => candidate.id !== record.id)
  return others.length > 0 ? undefined : 'Military Tradition gave a free unit for this army. Undo the free unit first.'
}

function gate(state: GameState, player: Playerhand, unitType: UnitType): BlockedAvailability | undefined {
  const policy = policyBlock(player, [POLICY], POLICY)
  if (policy !== undefined) return policy
  // Before the use, so a player without Flight never sees an aircraft button, not even a used one
  if (unitType === 'aircraft') {
    const flight = techBlock(player, AIRCRAFT_TECH)
    if (flight !== undefined) return blocked(flight.status, `Aircraft units need ${AIRCRAFT_TECH}. ${flight.reason}`)
  }
  const turn = openCityManagementTurn(state, player)
  if (turn === undefined) return blocked('wrong-phase', PHASE_REASON)
  if (turn.usedActions.includes(MILITARY_TRADITION_USAGE_KEY)) {
    return blocked('used', `${POLICY} has already given a free unit this turn.`)
  }
  if (armyBuildsOf(state, player.playerId, turn.turnNumber).length === 0) {
    return blocked('unavailable', 'Build an army figure with Build this turn first.')
  }
  if (!unitCardAvailable(state, unitSheetOf(unitType))) {
    return blocked('unavailable', `No ${unitNoun(unitType)} cards are left in the deck or the discard pile.`)
  }
  return undefined
}

function militaryTradition(unitType: UnitType): AssistedActionDefinition {
  const kind = kindOf(unitType)
  return {
    kind,
    techName: null,
    label: `${POLICY}: free ${unitNoun(unitType)}`,
    buttonText: `Military Tradition: draw a free ${unitNoun(unitType)}`,
    button: true,
    usageKey: MILITARY_TRADITION_USAGE_KEY,
    phase: 'CM',
    group: 'Social policies',
    strictOnce: true,

    availability(state, playerId) {
      const player = playerOf(state, playerId)
      if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
      return gate(state, player, unitType) ?? READY
    },

    apply(state, player, context) {
      const refused = gate(state, player, unitType)
      if (refused !== undefined) return err(rejected(kind, refused))
      const turn = openCityManagementTurn(state, player)
      if (turn === undefined) return err(rejected(kind, blocked('wrong-phase', PHASE_REASON)))

      const sheetName = unitSheetOf(unitType)
      const drawn = drawCandidates(state, sheetName, 1)
      const first = drawn.ok ? drawn.value.items[0] : undefined
      if (!drawn.ok || first === undefined) {
        return err(rejected(kind, blocked('unavailable', `No ${unitNoun(unitType)} cards are left in the deck or the discard pile.`)))
      }
      const card: Item = { ...first, ownerId: player.playerId, hidden: true }
      const holder = playerOf(drawn.value.state, player.playerId) ?? player
      const holding: Playerhand = { ...holder, items: [...holder.items, card] }
      const used = useTurnAction(withPlayerHand(drawn.value.state, holding), holding, turn, MILITARY_TRADITION_USAGE_KEY, holding.stats)
      // The public line names the type only; the card is in a private line, as for a unit build
      const logged = appendLog(used, {
        username: player.username,
        playerId: player.playerId,
        publicLog: `${player.username} used ${POLICY} and drew a free ${unitNoun(unitType)}`,
        privateLog: '',
        createdAt: context.at ?? null,
        assistedActionId: context.requestId,
      })
      const logId = lastLogId(logged)
      const withPrivate = appendLog(logged, {
        username: player.username,
        playerId: player.playerId,
        privateLog: `${player.username} drew ${itemName(card)} (${SHEET_LABEL[sheetName]}) with ${POLICY}`,
        createdAt: context.at ?? null,
      })
      return ok({
        state: withPrivate,
        effect: { kind: 'militaryTradition', unitType, card: { itemId: card.id, sheetName } },
        logId,
      })
    },

    reverse(state, player, record) {
      const effect = record.effect
      if (effect.kind !== 'militaryTradition') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
      const found = player.items.find((candidate) => candidate.id === effect.card.itemId)
      if (found === undefined) {
        return err({
          kind: 'ASSISTED_UNDO_BLOCKED',
          logId: record.logId,
          reason: `The free ${unitNoun(effect.unitType)} card is no longer in your hand, so it cannot be undone.`,
        })
      }
      // Back in its deck, and that deck alone shuffled again, as a unit build's undo does
      const returned: GameState = {
        ...withPlayerHand(state, { ...player, items: player.items.filter((candidate) => candidate.id !== found.id) }),
        items: [...state.items, { ...found, hidden: true, ownerId: null }],
      }
      return ok({
        state: shuffleSheetTwice(returned, effect.card.sheetName),
        text: `${player.username}'s free ${unitNoun(effect.unitType)} from ${POLICY} was undone: the card was put back in the deck`,
      })
    },
  }
}

/** One button per unit type, in the order of `UNIT_TYPES`. */
export const MILITARY_TRADITION_ACTIONS: readonly AssistedActionDefinition[] = UNIT_TYPES.map(militaryTradition)
