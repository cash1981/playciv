/**
 * The Americans' great person in setup (issue #374), an assisted action in no particular phase: a random draw laid out like
 * Philosophy's and the School of Confucius' (`gainGreatPerson`), kept through `chooseReward` and taken back by the undo vote
 * on its log line. The rules about when it may be drawn are `greatPersonBlock` in `setup.ts`.
 *
 * A file of its own because `assisted.ts` lists it while `setup.ts` imports the board actions that import `assisted.ts`: this
 * module reads `setup.ts` only when an action runs, never while the modules load.
 */

import { blocked, lastLogId, playerOf, rejected } from './assisted-core.js'
import type { AssistedActionDefinition, AssistedAvailability } from './assisted-core.js'
import {
  countLinesIn,
  gainGreatPerson,
  markerUndoBlock,
  removeGreatPersonMarker,
  removedMarkerText,
  restoreDrawnCards,
} from './assisted-culture.js'
import { rewardDrawCount } from './culture-track.js'
import { appendLog } from './log.js'
import { err, ok } from './result.js'
import { greatPersonBlock } from './setup.js'

const GREAT_PERSON_KIND = 'setupGreatPerson'

export const setupGreatPerson: AssistedActionDefinition = {
  kind: GREAT_PERSON_KIND,
  techName: null,
  label: 'Great person (setup)',
  button: false,
  usageKey: null,
  strictOnce: true,
  phase: 'ANY',
  group: 'Setup',

  availability(state, playerId): AssistedAvailability {
    const player = playerOf(state, playerId)
    if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
    const refused = greatPersonBlock(state, player)
    if (refused !== undefined) return refused
    const count = rewardDrawCount(state, player, 'greatPerson')
    return { status: 'ready', reason: `Draw ${count} great person ${count === 1 ? 'card' : 'cards'} and keep one.` }
  },

  apply(state, player, context) {
    const refused = greatPersonBlock(state, player)
    if (refused !== undefined) return err(rejected(GREAT_PERSON_KIND, refused))
    // As a Great Person space draws: one card, one more for a revealed Organized Religion, of which the player keeps one
    const gained = gainGreatPerson(state, player, {
      requestId: context.requestId,
      at: context.at,
      count: rewardDrawCount(state, player, 'greatPerson'),
      level: 1,
      step: 0,
    })
    if (!gained.ok) return err(rejected(GREAT_PERSON_KIND, blocked('unavailable', gained.error)))
    if (gained.value.outcome === 'none') {
      return err(rejected(GREAT_PERSON_KIND, blocked('unavailable', `No great person could be gained: ${gained.value.phrase.replace(/^gained no Great Person, because /, '')}.`)))
    }
    // The public line names the marker type and the logged item number, never the card
    const publicLine = appendLog(gained.value.state, {
      username: player.username,
      playerId: player.playerId,
      logType: 'SETUP',
      publicLog: `${player.username} drew a great person in setup: ${gained.value.phrase}`,
      privateLog: '',
      createdAt: context.at ?? null,
      assistedActionId: context.requestId,
    })
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
        kind: 'setupGreatPerson',
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
    if (effect.kind !== 'setupGreatPerson') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    const refuse = (reason: string) => err({ kind: 'ASSISTED_UNDO_BLOCKED' as const, logId: record.logId, reason })
    if (effect.marker !== null) {
      const blockedBy = markerUndoBlock(state, record.playerId, effect.marker)
      if (blockedBy !== undefined) return refuse(blockedBy)
    }
    const restored = restoreDrawnCards(state, player, record.id, [...effect.drawn, ...effect.rejected], effect.kept, 'GREAT_PERSON')
    if (!restored.ok) return restored
    let current = restored.value
    if (effect.marker !== null) {
      const removed = removeGreatPersonMarker(current, record, effect.marker, at)
      if (!removed.ok) return refuse(removed.error)
      current = removed.value
    }
    return ok({
      state: current,
      text: `${player.username}'s setup great person was undone: the drawn cards were put back in the deck${removedMarkerText(effect.marker)}`,
    })
  },
}

export const SETUP_ACTIONS: readonly AssistedActionDefinition[] = [setupGreatPerson]
