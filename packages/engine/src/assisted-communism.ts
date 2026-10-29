/**
 * Communism's Spy resource ability (issue #302): choose a square; no figure may
 * leave it this turn. The lock is derived from the applied assisted action, so
 * the undo vote removes it and returns the Spy.
 */

import { isMapCell } from './board.js'
import { squareLabel } from './build-options.js'
import { COMMUNISM_USAGE_KEY } from './communism.js'
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
} from './assisted-core.js'
import type { AssistedActionDefinition } from './assisted-core.js'
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

export const communism: AssistedActionDefinition = {
  kind: 'communism',
  techName: 'Communism',
  label: 'Communism',
  button: true,
  usageKey: COMMUNISM_USAGE_KEY,
  phase: 'MOVEMENT',
  group: 'Resource abilities',

  availability(state, playerId) {
    const player = playerOf(state, playerId)
    if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
    const tech = techBlock(player, 'Communism')
    if (tech !== undefined) return tech
    if (openPhaseOf(state, playerId) !== 'MOVEMENT') return blocked('wrong-phase', PHASE_REASON)
    const turn = turnOf(state, player)
    if (turn.usedActions.includes(COMMUNISM_USAGE_KEY)) {
      return blocked('used', 'Communism has already been used this turn.')
    }
    if (findResourceToken(state, playerId, 'Spy') === undefined) {
      return blocked(
        'needs-resource',
        'You need a Spy token: a Spy hut in your hand or a Spy piece in your player area.',
      )
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
      return err(rejected('communism', blocked('unavailable', 'Choose a square on the map.')))
    }
    const turn = turnOf(state, player)
    if (openPhaseOf(state, player.playerId) !== 'MOVEMENT') {
      return err(rejected('communism', blocked('wrong-phase', PHASE_REASON)))
    }
    const spend = spendResource(state, player.playerId, 'Spy', context.at)
    if (!spend.ok) {
      return err(rejected('communism', blocked('needs-resource', 'You need a Spy token.')))
    }
    const after = playerOf(spend.value.state, player.playerId) ?? player
    const marked = useTurnAction(spend.value.state, after, turn, COMMUNISM_USAGE_KEY, after.stats)
    const logged = appendLog(marked, {
      username: player.username,
      playerId: player.playerId,
      publicLog:
        `${player.username} used Communism: spent 1 Spy and locked ${squareLabel(square)} this turn` +
        (context.confirmedRepeat ? REPEAT_NOTE : ''),
      privateLog: '',
      createdAt: context.at ?? null,
      assistedActionId: context.requestId,
    })
    return ok({
      state: logged,
      effect: { kind: 'communism', square, spent: spend.value.spent },
      logId: lastLogId(logged),
    })
  },

  reverse(state, player, record, at) {
    const effect = record.effect
    if (effect.kind !== 'communism') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    const returned = returnResource(state, player, effect.spent, at)
    if (!returned.ok) return returned
    return ok({
      state: returned.value,
      text: `${player.username}'s Communism was undone: the Spy returned and the square is no longer locked`,
    })
  },
}
