/**
 * Combustion (issue #327), a tech with no resource cost: once per turn, when an army ends its movement on a
 * building, destroy that building; an army attacking a walled city destroys the walls first.
 *
 * The engine has no trigger on the end of a move, so this is the smallest design that fits: a once-per-turn
 * action in the open Movement phase (like Communism) that checks one of the player's armies stands on a building
 * or a walled city, logs the use with its usage key, and can be undone by vote. Removing the building, or
 * turning the city marker back to its unwalled side, stays manual; the log line says so.
 */

import { isMapCell } from './board.js'
import { COMBUSTION_NAME, COMBUSTION_USAGE_KEY, combustionTargetAt } from './combustion.js'
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
import { squareLabel } from './build-options.js'
import { appendLog } from './log.js'
import { err, ok } from './result.js'
import { openPhaseOf } from './sot.js'
import type { GameState, Playerhand } from './state.js'
import { createPlayerTurn, turnStatus } from './turn.js'

const PHASE_REASON = 'Only available during your open Movement phase.'

const turnOf = (state: GameState, player: Playerhand) => {
  const turnNumber = turnStatus(state).currentTurn
  return player.playerTurns.find((turn) => turn.turnNumber === turnNumber) ?? createPlayerTurn(player.username, turnNumber)
}

export const combustion: AssistedActionDefinition = {
  kind: 'combustion',
  techName: COMBUSTION_NAME,
  label: COMBUSTION_NAME,
  button: true,
  usageKey: COMBUSTION_USAGE_KEY,
  phase: 'MOVEMENT',
  group: 'Movement abilities',
  buttonText: `Use ${COMBUSTION_NAME} (destroy a building or walls)`,

  availability(state, playerId) {
    const player = playerOf(state, playerId)
    if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
    const tech = techBlock(player, COMBUSTION_NAME)
    if (tech !== undefined) return tech
    if (openPhaseOf(state, playerId) !== 'MOVEMENT') return blocked('wrong-phase', PHASE_REASON)
    if (turnOf(state, player).usedActions.includes(COMBUSTION_USAGE_KEY)) {
      return blocked('used', usedReason(COMBUSTION_NAME))
    }
    return READY
  },

  apply(state, player, context) {
    const payload = context.payload
    const square =
      payload !== undefined &&
      'square' in payload &&
      typeof payload.square === 'object' &&
      payload.square !== null &&
      !Array.isArray(payload.square)
        ? payload.square
        : undefined
    if (square === undefined || !isMapCell(state.board, square.column, square.row)) {
      return err(rejected('combustion', blocked('unavailable', 'Choose a square on the map.')))
    }
    if (openPhaseOf(state, player.playerId) !== 'MOVEMENT') {
      return err(rejected('combustion', blocked('wrong-phase', PHASE_REASON)))
    }
    const target = combustionTargetAt(state.board, player, { column: square.column, row: square.row })
    if (target === undefined) {
      return err(rejected('combustion', blocked('unavailable', `One of your armies must stand on a building or on a walled city on ${squareLabel(square)}.`)))
    }
    const turn = turnOf(state, player)
    const marked = useTurnAction(state, player, turn, COMBUSTION_USAGE_KEY, player.stats)
    const logged = appendLog(marked, {
      username: player.username,
      playerId: player.playerId,
      // The removal is by hand: the line says what the player has to do
      publicLog:
        `${player.username} used ${COMBUSTION_NAME}: an army destroys ${target.subject}. ` +
        (target.walls ? 'Turn the city marker back to its unwalled side by hand' : 'Remove the building from the map by hand') +
        (context.confirmedRepeat ? REPEAT_NOTE : ''),
      privateLog: '',
      createdAt: context.at ?? null,
      assistedActionId: context.requestId,
    })
    return ok({
      state: logged,
      effect: { kind: 'combustion', square: { column: square.column, row: square.row }, walls: target.walls, subject: target.subject },
      logId: lastLogId(logged),
    })
  },

  reverse(state, player, record) {
    const effect = record.effect
    if (effect.kind !== 'combustion') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    return ok({
      state,
      text: `${player.username}'s ${COMBUSTION_NAME} was undone: it can be used again this turn (put back ${effect.subject} by hand if it was removed)`,
    })
  },
}
