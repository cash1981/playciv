/**
 * Steam Power's Silk ability (issue #302): spend a Silk in City Management to move
 * all of your figures in one square to any water square; they cannot move again
 * this turn. The rules are in `steam-power.ts`. The moves are board history entries
 * that belong to the action, so only the undo vote takes them back, with the Silk.
 */

import { moveFigureWithMovementUnchecked } from './actions/board.js'
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
import type { Cell } from './blockade.js'
import type { PieceMovement } from './board.js'
import { mapTop } from './board.js'
import { squareLabel } from './build-options.js'
import { brandenburgForbiddenFor } from './brandenburg.js'
import { communismLocksOf } from './communism.js'
import { stackingLimitOf } from './great-person-effects.js'
import { appendLog } from './log.js'
import { err, ok } from './result.js'
import { openPhaseOf } from './sot.js'
import type { GameState, Playerhand } from './state.js'
import {
  STEAM_POWER_NAME,
  STEAM_POWER_USAGE_KEY,
  steamPowerDestinations,
  steamPowerFiguresAt,
} from './steam-power.js'
import { createPlayerTurn, turnStatus } from './turn.js'

const PHASE_REASON = 'Only available during your open City Management phase.'

const sameCell = (a: Cell, b: Cell): boolean => a.column === b.column && a.row === b.row

const turnOf = (state: GameState, player: Playerhand) => {
  const turnNumber = turnStatus(state).currentTurn
  return player.playerTurns.find((turn) => turn.turnNumber === turnNumber) ?? createPlayerTurn(player.username, turnNumber)
}

const cellOf = (value: unknown): Cell | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const { column, row } = value as { column?: unknown; row?: unknown }
  return typeof column === 'number' && typeof row === 'number' ? { column, row } : undefined
}

export const steamPower: AssistedActionDefinition = {
  kind: 'steamPower',
  techName: STEAM_POWER_NAME,
  label: STEAM_POWER_NAME,
  button: true,
  usageKey: STEAM_POWER_USAGE_KEY,
  phase: 'CM',
  group: 'Resource abilities',
  buttonText: 'Use Steam Power (Silk)',

  availability(state, playerId) {
    const player = playerOf(state, playerId)
    if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
    const tech = techBlock(player, STEAM_POWER_NAME)
    if (tech !== undefined) return tech
    if (openPhaseOf(state, playerId) !== 'CM') return blocked('wrong-phase', PHASE_REASON)
    if (turnOf(state, player).usedActions.includes(STEAM_POWER_USAGE_KEY)) {
      return blocked('used', 'Steam Power has already been used this turn.')
    }
    if (findResourceToken(state, playerId, 'Silk') === undefined) {
      return blocked(
        'needs-resource',
        'You need a Silk token: a Silk hut in your hand or a Silk piece in your player area.',
      )
    }
    return READY
  },

  apply(state, player, context) {
    const payload = context.payload
    const from = payload !== undefined && 'from' in payload ? cellOf(payload.from) : undefined
    const to = payload !== undefined && 'to' in payload ? cellOf(payload.to) : undefined
    if (from === undefined || to === undefined) {
      return err(rejected('steamPower', blocked('unavailable', 'Choose a square with your figures and a water square.')))
    }
    if (openPhaseOf(state, player.playerId) !== 'CM') {
      return err(rejected('steamPower', blocked('wrong-phase', PHASE_REASON)))
    }
    const turnNumber = turnStatus(state).currentTurn
    const figures = steamPowerFiguresAt(state.board, player, from, turnNumber)
    if (figures.length === 0) {
      return err(rejected('steamPower', blocked('unavailable', `None of your figures can be moved from ${squareLabel(from)}: it holds no figure of yours, or one that Galileo or Steam Power already moved this turn.`)))
    }
    if (communismLocksOf(state).some((cell) => sameCell(cell, from))) {
      return err(rejected('steamPower', blocked('unavailable', `${squareLabel(from)} is locked by Communism; no figure may leave it this turn.`)))
    }
    const destinations = steamPowerDestinations(
      state.board,
      player,
      stackingLimitOf(state, player),
      figures,
      from,
      brandenburgForbiddenFor(state, player.playerId),
    )
    if (!destinations.some((cell) => sameCell(cell, to))) {
      return err(rejected('steamPower', blocked('unavailable', `${squareLabel(to)} is not a water square these figures may be moved to.`)))
    }

    const spend = spendResource(state, player.playerId, 'Silk', context.at)
    if (!spend.ok) return err(rejected('steamPower', blocked('needs-resource', 'You need a Silk token.')))

    const sameSquare = sameCell(from, to)
    const sourceX = from.column * state.board.squareSize
    const sourceY = mapTop(state.board) + from.row * state.board.squareSize
    const destX = to.column * state.board.squareSize
    const destY = mapTop(state.board) + to.row * state.board.squareSize
    const moves: {
      pieceId: string
      from: { x: number; y: number }
      to: { x: number; y: number }
      movementFrom: PieceMovement | null
      historyId: string
    }[] = []
    let current = spend.value.state
    for (const figure of figures) {
      const before = figure.movement?.turn === turnNumber ? figure.movement : null
      const x = destX + (figure.x - sourceX)
      const y = destY + (figure.y - sourceY)
      const moved = moveFigureWithMovementUnchecked(current, {
        playerId: player.playerId,
        pieceId: figure.id,
        x,
        y,
        movementFrom: figure.movement ?? null,
        movementTo: { turn: turnNumber, used: before?.used ?? 0, locked: true, reason: 'steamPower' },
        description: sameSquare
          ? `locked ${figure.label} on ${squareLabel(from)} with ${STEAM_POWER_NAME}`
          : `moved ${figure.label} from ${squareLabel(from)} to ${squareLabel(to)} with ${STEAM_POWER_NAME}`,
        ...(context.at === undefined ? {} : { at: context.at }),
      })
      const historyId = moved?.board.history.at(-1)?.id
      if (moved === undefined || historyId === undefined) {
        return err(rejected('steamPower', blocked('unavailable', 'The figures could not be moved.')))
      }
      current = moved
      moves.push({ pieceId: figure.id, from: { x: figure.x, y: figure.y }, to: { x, y }, movementFrom: figure.movement ?? null, historyId })
    }

    const holder = playerOf(current, player.playerId) ?? player
    const marked = useTurnAction(current, holder, turnOf(current, holder), STEAM_POWER_USAGE_KEY, holder.stats)
    const count = `${figures.length} ${figures.length === 1 ? 'figure' : 'figures'}`
    const logged = appendLog(marked, {
      username: player.username,
      playerId: player.playerId,
      publicLog:
        `${player.username} used ${STEAM_POWER_NAME}: spent 1 Silk and ` +
        (sameSquare
          ? `locked ${count} on ${squareLabel(from)}`
          : `moved ${count} from ${squareLabel(from)} to ${squareLabel(to)}`) +
        (context.confirmedRepeat ? REPEAT_NOTE : ''),
      privateLog: '',
      createdAt: context.at ?? null,
      assistedActionId: context.requestId,
    })
    return ok({
      state: logged,
      effect: { kind: 'steamPower', from, to, spent: spend.value.spent, moves },
      logId: lastLogId(logged),
    })
  },

  reverse(state, player, record, at) {
    const effect = record.effect
    if (effect.kind !== 'steamPower') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    const refuse = (reason: string) =>
      err({ kind: 'ASSISTED_ACTION_REJECTED' as const, action: 'steamPower', status: 'unavailable' as const, reason })
    for (const move of effect.moves) {
      const piece = state.board.pieces.find((candidate) => candidate.id === move.pieceId)
      // Still where Steam Power put it with its lock from that turn: a later exploration or move
      // changes the allowance, which an undo would otherwise refund
      if (
        piece === undefined ||
        piece.x !== move.to.x ||
        piece.y !== move.to.y ||
        piece.movement?.turn !== record.turnNumber ||
        piece.movement.locked !== true ||
        piece.movement.reason !== 'steamPower'
      ) {
        return refuse(`${STEAM_POWER_NAME} cannot be undone: a figure it moved has been moved again.`)
      }
    }
    let current: GameState = state
    for (const move of [...effect.moves].reverse()) {
      const piece = current.board.pieces.find((candidate) => candidate.id === move.pieceId)
      if (piece === undefined) return refuse(`${STEAM_POWER_NAME} cannot be undone: a figure it moved is gone.`)
      const next = moveFigureWithMovementUnchecked(current, {
        playerId: player.playerId,
        pieceId: move.pieceId,
        x: move.from.x,
        y: move.from.y,
        movementFrom: piece.movement ?? null,
        movementTo: move.movementFrom,
        description: `moved ${piece.label} back with ${STEAM_POWER_NAME}`,
        ...(at === null ? {} : { at }),
      })
      if (next === undefined) return refuse(`${STEAM_POWER_NAME} cannot be undone: a figure could not be moved back.`)
      current = next
    }
    const returned = returnResource(current, playerOf(current, player.playerId) ?? player, effect.spent, at)
    if (!returned.ok) return returned
    return ok({
      state: returned.value,
      text: `${player.username}'s ${STEAM_POWER_NAME} was undone: the figures went back and the Silk returned`,
    })
  },
}
