/**
 * The relics that give their ability the moment an army has taken the marker (Fame and
 * Fortune p. 9, Wisdom and Warfare): the Ark of the Covenant (two free culture advances),
 * Attila's Village (two free unlocked units) and the School of Confucius (two Great People).
 * Atlantis and the Seven Cities of Gold wait for the Start of Turn and live in
 * `assisted-abilities.ts`.
 *
 * Each is an action in no particular phase, so its button is there as soon as the marker is
 * off the map, in whichever tab is open. A relic is "taken" when the board history says this
 * player removed it last; it is claimed once for the whole game, and an undone claim can be
 * made again. The Ark and Attila give two uses, one press each, so the culture rules (hand
 * size, Mysticism, a card choice still waiting) are checked for every advance.
 *
 * The Ark's first advance and the School of Confucius need no choice, so the army's move claims
 * them at once (`IMMEDIATE_RELIC_CLAIMS`); when that is stopped (a hand over its size), the button
 * stays with its reason.
 */

import {
  blocked,
  lastLogId,
  playerOf,
  rejected,
  techBlock,
  withPlayerHand,
} from './assisted-core.js'
import type { AssistedActionDefinition, BlockedAvailability } from './assisted-core.js'
import {
  countLinesIn,
  freeAdvanceStatus,
  gainGreatPerson,
  drawCandidates,
  markerUndoBlock,
  performAdvance,
  removeGreatPersonMarker,
  removedMarkerText,
  restoreDrawnCards,
  reverseAdvanceEffect,
  shuffleSheetTwice,
} from './assisted-culture.js'
import { UNIT_TYPES } from './build-item.js'
import type { UnitType } from './build-item.js'
import { unitCardAvailable, unitSheetOf } from './build-options.js'
import { rewardDrawCount } from './culture-track.js'
import type { Item } from './item.js'
import { appendLog, itemNumberText, numberedItemName } from './log.js'
import { err, ok } from './result.js'
import { SHEET_LABEL } from './sheet-name.js'
import type { AssistedActionKind, GameState, Playerhand } from './state.js'

const GROUP = 'Relics'

export const ARK_ASSET = 'relics/ark_of_the_covenant'
export const ATTILA_ASSET = 'relics/attilas_village'
export const CONFUCIUS_ASSET = 'relics/school_of_confucius'

/** How many times the Ark and Attila's Village can be used. */
const USES = 2

const ARK_KIND: AssistedActionKind = 'relic:ark'
const CONFUCIUS_KIND: AssistedActionKind = 'relic:confucius'
const attilaKind = (unitType: UnitType): AssistedActionKind => `relic:attila:${unitType}`
const ATTILA_KINDS = UNIT_TYPES.map(attilaKind)

/** Aircraft are unlocked by Flight; the other three types always are. */
const AIRCRAFT_TECH = 'Flight'

/**
 * Why the relic is not the player's to claim: its marker is still on the map, or somebody
 * else took it. `undefined` when the board history says this player removed it last.
 */
export function relicTakenBlock(state: GameState, player: Playerhand, assetId: string, label: string): BlockedAvailability | undefined {
  if (state.board.pieces.some((piece) => piece.assetId === assetId)) {
    return blocked('not-owned', `The ${label} relic marker is still on the map.`)
  }
  const last = [...state.board.history]
    .reverse()
    .find((entry) => 'piece' in entry.change && entry.change.piece.assetId === assetId)
  if (last === undefined || last.change.kind !== 'remove' || last.playerId !== player.playerId) {
    return blocked('not-owned', `You have not taken the ${label} relic marker off the map.`)
  }
  return undefined
}

/** How many times the ability has been used and not undone. */
const usesOf = (state: GameState, kinds: readonly AssistedActionKind[]): number =>
  state.assistedActions.filter((record) => record.status === 'applied' && kinds.includes(record.kind)).length

function gateFor(
  state: GameState,
  player: Playerhand,
  assetId: string,
  label: string,
  kinds: readonly AssistedActionKind[],
  uses: number,
): BlockedAvailability | undefined {
  const taken = relicTakenBlock(state, player, assetId, label)
  if (taken !== undefined) return taken
  const used = usesOf(state, kinds)
  if (used >= uses) {
    return blocked('unavailable', uses === 1 ? `You have claimed the ${label} relic already. It gives its ability once.` : `You have used both of the ${label} relic's abilities.`)
  }
  return undefined
}

const announce = (state: GameState, player: Playerhand, requestId: string, at: string | undefined, text: string): GameState =>
  appendLog(state, {
    username: player.username,
    playerId: player.playerId,
    publicLog: text,
    privateLog: '',
    createdAt: at ?? null,
    assistedActionId: requestId,
  })

// ---------------------------------------------------------------------------
// The Ark of the Covenant: two free advances, one at a time
// ---------------------------------------------------------------------------

const ARK_LABEL = 'Ark of the Covenant'

function arkBlock(state: GameState, player: Playerhand): BlockedAvailability | undefined {
  const gate = gateFor(state, player, ARK_ASSET, ARK_LABEL, [ARK_KIND], USES)
  if (gate !== undefined) return gate
  const status = freeAdvanceStatus(state, player)
  return status.kind === 'ok' ? undefined : blocked('unavailable', status.reason)
}

const arkOfTheCovenant: AssistedActionDefinition = {
  kind: ARK_KIND,
  techName: null,
  label: ARK_LABEL,
  buttonText: `${ARK_LABEL}: advance on the culture track for free`,
  button: true,
  usageKey: null,
  phase: 'ANY',
  group: GROUP,

  availability(state, playerId) {
    const player = playerOf(state, playerId)
    if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
    const refused = arkBlock(state, player)
    if (refused !== undefined) return refused
    const left = USES - usesOf(state, [ARK_KIND])
    return { status: 'ready', reason: `Advance one space on the culture track for free, and take what the space gives (${left} of ${USES} left).` }
  },

  apply(state, player, context) {
    const refused = arkBlock(state, player)
    if (refused !== undefined) return err(rejected(ARK_KIND, refused))
    const number = usesOf(state, [ARK_KIND]) + 1
    const line = announce(
      state,
      player,
      context.requestId,
      context.at,
      `${player.username} used the ${ARK_LABEL}: an advance on the culture track for free (${number} of ${USES})`,
    )
    const logId = lastLogId(line)
    const holder = playerOf(line, player.playerId) ?? player
    const advanced = performAdvance(line, holder, { requestId: context.requestId, at: context.at }, { free: true, tagLog: false })
    if (!advanced.ok) return advanced
    return ok({ state: advanced.value.state, effect: { kind: 'sotAdvance', subject: ARK_LABEL, advance: advanced.value.effect }, logId })
  },

  reverse(state, player, record, at) {
    const effect = record.effect
    if (effect.kind !== 'sotAdvance') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    const reversed = reverseAdvanceEffect(state, player, record, effect.advance, at)
    if (!reversed.ok) return reversed
    return ok({
      state: reversed.value.state,
      text: `${player.username}'s ${effect.subject} was undone: the free advance was taken back`,
    })
  },
}

// ---------------------------------------------------------------------------
// The School of Confucius: Great People
// ---------------------------------------------------------------------------

const CONFUCIUS_LABEL = 'School of Confucius'

/**
 * Two Great Person cards are drawn and one is kept; a revealed Organized Religion and the
 * Greeks each add a card, and the extras stack: the Greeks with Organized Religion draw
 * four. That is the draw of a Great Person space of the culture track, plus one.
 */
const confuciusDraw = (state: GameState, player: Playerhand): number => rewardDrawCount(state, player, 'greatPerson') + 1

const schoolOfConfucius: AssistedActionDefinition = {
  kind: CONFUCIUS_KIND,
  techName: null,
  label: CONFUCIUS_LABEL,
  buttonText: `${CONFUCIUS_LABEL}: draw Great Persons`,
  button: true,
  usageKey: null,
  phase: 'ANY',
  group: GROUP,

  availability(state, playerId) {
    const player = playerOf(state, playerId)
    if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
    const refused = gateFor(state, player, CONFUCIUS_ASSET, CONFUCIUS_LABEL, [CONFUCIUS_KIND], 1)
    if (refused !== undefined) return refused
    return { status: 'ready', reason: `Draw ${confuciusDraw(state, player)} Great Person cards and keep one of them.` }
  },

  apply(state, player, context) {
    const refused = gateFor(state, player, CONFUCIUS_ASSET, CONFUCIUS_LABEL, [CONFUCIUS_KIND], 1)
    if (refused !== undefined) return err(rejected(CONFUCIUS_KIND, refused))
    const gained = gainGreatPerson(state, player, {
      requestId: context.requestId,
      at: context.at,
      count: confuciusDraw(state, player),
      level: 1,
      step: 0,
    })
    if (!gained.ok) return err(rejected(CONFUCIUS_KIND, blocked('unavailable', gained.error)))
    const publicLine = announce(gained.value.state, player, context.requestId, context.at, `${player.username} used the ${CONFUCIUS_LABEL}: ${gained.value.phrase}`)
    const logId = lastLogId(publicLine)
    const logged =
      gained.value.privateText === ''
        ? publicLine
        : appendLog(publicLine, {
            username: player.username,
            playerId: player.playerId,
            privateLog: gained.value.privateText,
            createdAt: context.at ?? null,
          })
    return ok({
      state: countLinesIn(logged, [gained.value.marker?.historyId]),
      effect: {
        kind: 'relicGreatPerson',
        subject: CONFUCIUS_LABEL,
        drawn: gained.value.drawn,
        rejected: gained.value.rejected,
        kept: gained.value.kept,
        marker: gained.value.marker,
      },
      logId,
    })
  },

  reverse(state, player, record, at) {
    const effect = record.effect
    if (effect.kind !== 'relicGreatPerson') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    const refused = (reason: string) => err({ kind: 'ASSISTED_UNDO_BLOCKED' as const, logId: record.logId, reason })
    if (effect.marker !== null) {
      const blockedBy = markerUndoBlock(state, record.playerId, effect.marker)
      if (blockedBy !== undefined) return refused(blockedBy)
    }
    const restored = restoreDrawnCards(state, player, record.id, [...effect.drawn, ...effect.rejected], effect.kept, 'GREAT_PERSON')
    if (!restored.ok) return restored
    let current = restored.value
    if (effect.marker !== null) {
      const removed = removeGreatPersonMarker(current, record, effect.marker, at)
      if (!removed.ok) return refused(removed.error)
      current = removed.value
    }
    return ok({
      state: current,
      text: `${player.username}'s ${effect.subject} was undone: the drawn cards were put back in the deck${removedMarkerText(effect.marker)}`,
    })
  },
}

// ---------------------------------------------------------------------------
// Attila's Village: two free units
// ---------------------------------------------------------------------------

const ATTILA_LABEL = "Attila's Village"

const unitNoun = (unitType: UnitType): string => `${unitType} unit`

function attilaBlock(state: GameState, player: Playerhand, unitType: UnitType): BlockedAvailability | undefined {
  // Before anything else, so a player without Flight never sees an aircraft button
  if (unitType === 'aircraft') {
    const flight = techBlock(player, AIRCRAFT_TECH)
    if (flight !== undefined) return blocked(flight.status, `Aircraft units need ${AIRCRAFT_TECH}. ${flight.reason}`)
  }
  const gate = gateFor(state, player, ATTILA_ASSET, ATTILA_LABEL, ATTILA_KINDS, USES)
  if (gate !== undefined) return gate
  if (!unitCardAvailable(state, unitSheetOf(unitType))) {
    return blocked('unavailable', `No ${unitNoun(unitType)} cards are left in the deck or the discard pile.`)
  }
  return undefined
}

function attilasVillage(unitType: UnitType): AssistedActionDefinition {
  const kind = attilaKind(unitType)
  return {
    kind,
    techName: null,
    label: `${ATTILA_LABEL}: free ${unitNoun(unitType)}`,
    buttonText: `${ATTILA_LABEL}: draw a free ${unitNoun(unitType)}`,
    button: true,
    usageKey: null,
    phase: 'ANY',
    group: GROUP,

    availability(state, playerId) {
      const player = playerOf(state, playerId)
      if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
      const refused = attilaBlock(state, player, unitType)
      if (refused !== undefined) return refused
      const left = USES - usesOf(state, ATTILA_KINDS)
      return { status: 'ready', reason: `Draw a ${unitNoun(unitType)} card for free (${left} of ${USES} left).` }
    },

    apply(state, player, context) {
      const refused = attilaBlock(state, player, unitType)
      if (refused !== undefined) return err(rejected(kind, refused))
      const sheetName = unitSheetOf(unitType)
      const drawn = drawCandidates(state, sheetName, 1)
      const first = drawn.ok ? drawn.value.items[0] : undefined
      if (!drawn.ok || first === undefined) {
        return err(rejected(kind, blocked('unavailable', `No ${unitNoun(unitType)} cards are left in the deck or the discard pile.`)))
      }
      const card: Item = { ...first, ownerId: player.playerId, hidden: true }
      const holder = playerOf(drawn.value.state, player.playerId) ?? player
      const holding = withPlayerHand(drawn.value.state, { ...holder, items: [...holder.items, card] })
      // The public line names the type only; the card is in a private line, as for a unit build
      const logged = announce(
        holding,
        player,
        context.requestId,
        context.at,
        `${player.username} used ${ATTILA_LABEL} and drew a free ${unitNoun(unitType)} (${itemNumberText(state.logSecret, player.username, card)})`,
      )
      const logId = lastLogId(logged)
      const withPrivate = appendLog(logged, {
        username: player.username,
        playerId: player.playerId,
        privateLog: `${player.username} drew ${numberedItemName(state.logSecret, player.username, card)} (${SHEET_LABEL[sheetName]}) with ${ATTILA_LABEL}`,
        createdAt: context.at ?? null,
      })
      return ok({
        state: withPrivate,
        effect: { kind: 'relicUnit', subject: ATTILA_LABEL, unitType, card: { itemId: card.id, sheetName } },
        logId,
      })
    },

    reverse(state, player, record) {
      const effect = record.effect
      if (effect.kind !== 'relicUnit') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
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
        text: `${player.username}'s free ${unitNoun(effect.unitType)} from ${ATTILA_LABEL} was undone: the card was put back in the deck`,
      })
    },
  }
}

// ---------------------------------------------------------------------------

export const RELIC_ACTIONS: readonly AssistedActionDefinition[] = [
  arkOfTheCovenant,
  schoolOfConfucius,
  ...UNIT_TYPES.map(attilasVillage),
]

/** The relics whose ability needs no choice, and the action that claims it the moment the marker is taken. */
export const IMMEDIATE_RELIC_CLAIMS: Readonly<Record<string, AssistedActionKind>> = {
  [ARK_ASSET]: ARK_KIND,
  [CONFUCIUS_ASSET]: CONFUCIUS_KIND,
}
