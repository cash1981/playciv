/**
 * The Aztecs' civilization ability: "each time they gain a great person, may build 2 unlocked
 * units of their choice for free". Modelled like Attila's Village (`assisted-relics.ts`): every
 * Great Person the Aztecs keep gives two credits (`takeGreatPersonMarker`, which every assisted
 * gain goes through), and each credit is one press of a button per unit type, drawing one unit
 * card of that type for free.
 *
 * The credits are server-only (`GameState.aztecFreeUnits`); the owner sees only the availability
 * text "N of M left". Aircraft need Flight, as for Attila. A Great Person drawn by hand in the
 * Draw panel gives no credits (limitations).
 *
 * Undo: a used credit is taken back by undoing the unit (the card goes back to its deck), and the
 * credits of a Great Person are taken back with it as far as they are unused (`removeGreatPersonMarker`).
 * A unit's undo that would bring back a credit whose Great Person was undone is refused, so
 * undoing the gain and then the unit cannot make a credit out of nothing.
 */

import {
  AZTEC_CIVILIZATION,
  aztecCreditsOf,
  blocked,
  lastLogId,
  playerOf,
  rejected,
  techBlock,
  withAztecCredits,
  withPlayerHand,
} from './assisted-core.js'
import type { AssistedActionDefinition, BlockedAvailability } from './assisted-core.js'
import { advanceEffectOf, drawCandidates, shuffleSheetTwice } from './assisted-culture.js'
import { UNIT_TYPES } from './build-item.js'
import type { UnitType } from './build-item.js'
import { unitCardAvailable, unitSheetOf } from './build-options.js'
import type { Item } from './item.js'
import { appendLog, itemNumberText, numberedItemName } from './log.js'
import { err, ok } from './result.js'
import { SHEET_LABEL } from './sheet-name.js'
import type { AssistedActionKind, GameState, Playerhand } from './state.js'

const GROUP = 'Civilization'
const LABEL = 'Aztecs'

/** Aircraft are unlocked by Flight; the other three types always are. */
const AIRCRAFT_TECH = 'Flight'

const kindOf = (unitType: UnitType): AssistedActionKind => `aztecs:${unitType}`
const KINDS = UNIT_TYPES.map(kindOf)

const unitNoun = (unitType: UnitType): string => `${unitType} unit`

/** The applied free units of this player, not counting `except`. */
const usedBy = (state: GameState, playerId: string, except?: string): number =>
  state.assistedActions.filter(
    (record) => record.status === 'applied' && record.playerId === playerId && record.id !== except && KINDS.includes(record.kind),
  ).length

/** Every credit the player's applied Great Person gains gave (their markers carry it), whatever has been spent since. */
function grantedTo(state: GameState, playerId: string): number {
  let total = 0
  for (const record of state.assistedActions) {
    if (record.status !== 'applied' || record.playerId !== playerId) continue
    const effect = record.effect
    const marker = advanceEffectOf(record)?.marker ?? ('marker' in effect ? effect.marker : undefined)
    if (typeof marker === 'object' && marker !== null && 'aztecCredits' in marker && typeof marker.aztecCredits === 'number') {
      total += marker.aztecCredits
    }
  }
  return total
}

function gate(state: GameState, player: Playerhand, unitType: UnitType): BlockedAvailability | undefined {
  // Before anything else, so a player without Flight never sees an aircraft button
  if (unitType === 'aircraft') {
    const flight = techBlock(player, AIRCRAFT_TECH)
    if (flight !== undefined) return blocked(flight.status, `Aircraft units need ${AIRCRAFT_TECH}. ${flight.reason}`)
  }
  if (player.civilization?.name !== AZTEC_CIVILIZATION) {
    return blocked('not-owned', 'Only the Aztecs build free units for their Great Persons.')
  }
  if (aztecCreditsOf(state, player.playerId) <= 0) {
    return blocked('unavailable', 'You have no free units left. Every Great Person you gain gives 2.')
  }
  if (!unitCardAvailable(state, unitSheetOf(unitType))) {
    return blocked('unavailable', `No ${unitNoun(unitType)} cards are left in the deck or the discard pile.`)
  }
  return undefined
}

function aztecUnit(unitType: UnitType): AssistedActionDefinition {
  const kind = kindOf(unitType)
  return {
    kind,
    techName: null,
    label: `${LABEL}: free ${unitNoun(unitType)}`,
    buttonText: `${LABEL}: draw a free ${unitNoun(unitType)} for a Great Person`,
    button: true,
    usageKey: null,
    phase: 'ANY',
    group: GROUP,

    availability(state, playerId) {
      const player = playerOf(state, playerId)
      if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
      const refused = gate(state, player, unitType)
      if (refused !== undefined) return refused
      const left = aztecCreditsOf(state, playerId)
      const total = left + usedBy(state, playerId)
      return { status: 'ready', reason: `Draw a ${unitNoun(unitType)} card for free (${left} of ${total} left).` }
    },

    apply(state, player, context) {
      const refused = gate(state, player, unitType)
      if (refused !== undefined) return err(rejected(kind, refused))
      const sheetName = unitSheetOf(unitType)
      const drawn = drawCandidates(state, sheetName, 1)
      const first = drawn.ok ? drawn.value.items[0] : undefined
      if (!drawn.ok || first === undefined) {
        return err(rejected(kind, blocked('unavailable', `No ${unitNoun(unitType)} cards are left in the deck or the discard pile.`)))
      }
      const card: Item = { ...first, ownerId: player.playerId, hidden: true }
      const holder = playerOf(drawn.value.state, player.playerId) ?? player
      const holding = withAztecCredits(
        withPlayerHand(drawn.value.state, { ...holder, items: [...holder.items, card] }),
        player.playerId,
        aztecCreditsOf(state, player.playerId) - 1,
      )
      // The public line names the type only; the card is in a private line, as for a unit build
      const logged = appendLog(holding, {
        username: player.username,
        playerId: player.playerId,
        publicLog: `${player.username} drew a free ${unitNoun(unitType)} as the Aztecs (${itemNumberText(state.logSecret, player.username, card)})`,
        privateLog: '',
        createdAt: context.at ?? null,
        assistedActionId: context.requestId,
      })
      const logId = lastLogId(logged)
      const left = aztecCreditsOf(logged, player.playerId)
      const withPrivate = appendLog(logged, {
        username: player.username,
        playerId: player.playerId,
        privateLog: `${player.username} drew ${numberedItemName(state.logSecret, player.username, card)} (${SHEET_LABEL[sheetName]}) as the Aztecs, ${left} free units left`,
        createdAt: context.at ?? null,
      })
      return ok({
        state: withPrivate,
        effect: { kind: 'relicUnit', subject: LABEL, unitType, card: { itemId: card.id, sheetName } },
        logId,
      })
    },

    reverse(state, player, record) {
      const effect = record.effect
      if (effect.kind !== 'relicUnit') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
      const refused = (reason: string) => err({ kind: 'ASSISTED_UNDO_BLOCKED' as const, logId: record.logId, reason })
      const found = player.items.find((candidate) => candidate.id === effect.card.itemId)
      if (found === undefined) {
        return refused(`The free ${unitNoun(effect.unitType)} card is no longer in your hand, so it cannot be undone.`)
      }
      // The credit goes back only while a Great Person gain still stands behind it; otherwise undoing the gain and then
      // this unit would give a free unit for nothing
      const have = aztecCreditsOf(state, player.playerId)
      if (have + 1 + usedBy(state, player.playerId, record.id) > grantedTo(state, player.playerId)) {
        return refused('The Great Person that gave this free unit was undone, so the unit cannot be undone and its credit is gone.')
      }
      // Back in its deck, and that deck alone shuffled again, as a unit build's undo does
      const returned: GameState = {
        ...withAztecCredits(
          withPlayerHand(state, { ...player, items: player.items.filter((candidate) => candidate.id !== found.id) }),
          player.playerId,
          have + 1,
        ),
        items: [...state.items, { ...found, hidden: true, ownerId: null }],
      }
      return ok({
        state: shuffleSheetTwice(returned, effect.card.sheetName),
        text: `${player.username}'s free ${unitNoun(effect.unitType)} for the Aztecs was undone: the card was put back in the deck and the free unit given back`,
      })
    },
  }
}

export const AZTEC_ACTIONS: readonly AssistedActionDefinition[] = UNIT_TYPES.map(aztecUnit)
