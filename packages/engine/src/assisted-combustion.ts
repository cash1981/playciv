/**
 * Combustion (issue #327), a tech with no resource cost: once per turn, when an army ends its movement on a
 * building, destroy that building; an army attacking a walled city destroys the walls first.
 *
 * The engine has no trigger on the end of a move, so this is the smallest design that fits: a once-per-turn
 * action in the open Movement phase (like Communism) that checks one of the player's armies stands on a building
 * or a walled city, logs the use with its usage key, and can be undone by vote. The building is removed from the board
 * (as Gunpowder's destroy does) or the walled city marker is turned back to its plain side, both through the board
 * history, so the undo puts it back exactly. Judging that the army really ended its move there stays with the players.
 */

import { flipPieceUnchecked, removePiece } from './actions/board.js'
import { countLinesIn } from './assisted-culture.js'
import { restoreDestroyedBuilding } from './destroy-buildings.js'
import { unwalledAssetIdOf } from './build-options.js'

import { COMBUSTION_NAME, COMBUSTION_USAGE_KEY, combustionTargetFor } from './combustion.js'
import type { CombustionTarget } from './combustion.js'
import type { EngineError } from './errors.js'
import type { Result } from './result.js'
import { figureBelongsTo } from './movement.js'
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
import { appendLog } from './log.js'
import { err, ok } from './result.js'
import { openPhaseOf } from './sot.js'
import type { AssistedEffect, GameState, Playerhand } from './state.js'
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
    const pieceId = payload !== undefined && 'pieceId' in payload && typeof payload.pieceId === 'string' ? payload.pieceId : undefined
    if (pieceId === undefined) {
      return err(rejected('combustion', blocked('unavailable', 'Choose the army that acts.')))
    }
    if (openPhaseOf(state, player.playerId) !== 'MOVEMENT') {
      return err(rejected('combustion', blocked('wrong-phase', PHASE_REASON)))
    }
    const army = state.board.pieces.find((piece) => piece.id === pieceId)
    if (army === undefined || !figureBelongsTo(player, army) || !army.assetId.endsWith('army')) {
      return err(rejected('combustion', blocked('unavailable', 'Choose one of your own armies.')))
    }
    const target = combustionTargetFor(state, player, army)
    if (target === undefined) {
      return err(rejected('combustion', blocked('unavailable', 'That army must stand on a building, or on the walled city of another player. Your own buildings and walls are never destroyed.')))
    }
    const at = context.at === undefined ? {} : { at: context.at }
    const destroyed = target.walls ? turnWallsBack(state, player, target, at) : removeBuilding(state, player, target, at)
    if (!destroyed.ok) return err(rejected('combustion', blocked('unavailable', destroyed.error)))
    const turn = turnOf(destroyed.value.state, playerOf(destroyed.value.state, player.playerId) ?? player)
    const acting = playerOf(destroyed.value.state, player.playerId) ?? player
    const marked = useTurnAction(destroyed.value.state, acting, turn, COMBUSTION_USAGE_KEY, acting.stats)
    const logged = appendLog(marked, {
      username: player.username,
      playerId: player.playerId,
      publicLog:
        `${player.username} used ${COMBUSTION_NAME}: an army destroys ${target.subject}` +
        (target.walls ? ', and the city marker is turned back to its unwalled side' : ', and the building is removed from the map') +
        (context.confirmedRepeat ? REPEAT_NOTE : ''),
      privateLog: '',
      createdAt: context.at ?? null,
      assistedActionId: context.requestId,
    })
    // The board change was recorded before the line existed: count it in, so stepping through the history shows them together
    const counted = countLinesIn(logged, [destroyed.value.historyId])
    return ok({
      state: counted,
      effect: {
        kind: 'combustion',
        pieceId,
        square: { column: target.column, row: target.row },
        walls: target.walls,
        subject: target.subject,
        ...destroyed.value.effect,
      },
      logId: lastLogId(counted),
    })
  },

  reverse(state, player, record, at) {
    const effect = record.effect
    if (effect.kind !== 'combustion') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    const refused = (reason: string): EngineError => ({ kind: 'ASSISTED_UNDO_BLOCKED', logId: record.logId, reason })
    const used = `${player.username}'s ${COMBUSTION_NAME} was undone: it can be used again this turn`
    // A record from before the removal was automated has nothing on the board to put back
    if (effect.building !== undefined) {
      const restored = restoreDestroyedBuilding(state, player, effect.building, at)
      if (!restored.ok) return err(refused(restored.error))
      return ok({ state: restored.value, text: `${used}, and ${effect.building.label} was put back on ${effect.building.square}` })
    }
    if (effect.unwalled !== undefined) {
      const { pieceId, from, to } = effect.unwalled
      const city = state.board.pieces.find((piece) => piece.id === pieceId)
      if (city === undefined) return err(refused('The city is no longer on the board, so its walls cannot be put back.'))
      if (city.assetId !== to.assetId) return err(refused('The city marker is not on its plain side any more, so its walls cannot be put back.'))
      const flipped = flipPieceUnchecked(state, { playerId: player.playerId, pieceId, assetId: from.assetId, ...(at === null ? {} : { at }) })
      if (flipped === undefined) return err(refused('The city marker could not be turned back to its walled side.'))
      return ok({ state: flipped, text: `${used}, and the walls of ${city.label} were put back` })
    }
    return ok({ state, text: `${used} (put back ${effect.subject} by hand if it was removed)` })
  },
}

interface Destroyed {
  readonly state: GameState
  readonly historyId: string
  readonly effect: { readonly building: NonNullable<Extract<AssistedEffect, { kind: 'combustion' }>['building']> } | { readonly unwalled: NonNullable<Extract<AssistedEffect, { kind: 'combustion' }>['unwalled']> }
}

type At = { readonly at?: string }

/** The building comes off the board, exactly as it stood, so an undo can put it back. */
function removeBuilding(state: GameState, player: Playerhand, target: CombustionTarget, at: At): Result<Destroyed, string> {
  const piece = state.board.pieces.find((candidate) => candidate.id === target.targetPieceId)
  if (piece === undefined) return err('The building is no longer on the board.')
  const removed = removePiece(state, { playerId: player.playerId, pieceId: piece.id, ...at })
  const entry = removed.ok ? removed.value.board.history.at(-1) : undefined
  if (!removed.ok || entry === undefined) return err(`${target.targetLabel} could not be taken off the board.`)
  return ok({
    state: removed.value,
    historyId: entry.id,
    effect: { building: { piece, label: target.targetLabel, square: target.square, historyId: entry.id } },
  })
}

/** The walled city marker is turned over to its plain side: the same piece, one board history entry. */
function turnWallsBack(state: GameState, player: Playerhand, target: CombustionTarget, at: At): Result<Destroyed, string> {
  const city = state.board.pieces.find((candidate) => candidate.id === target.targetPieceId)
  const plain = city === undefined ? undefined : unwalledAssetIdOf(city.assetId)
  if (city === undefined || plain === undefined) return err('The city no longer has walls.')
  const flipped = flipPieceUnchecked(state, { playerId: player.playerId, pieceId: city.id, assetId: plain, ...at })
  const entry = flipped?.board.history.at(-1)
  if (flipped === undefined || entry === undefined || entry.change.kind !== 'flip') {
    return err('The city marker could not be turned back to its unwalled side.')
  }
  return ok({
    state: flipped,
    historyId: entry.id,
    effect: { unwalled: { pieceId: city.id, from: entry.change.from, to: entry.change.to, historyId: entry.id } },
  })
}
