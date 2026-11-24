/**
 * A figure explores the fog next to it (issue #302): 1 movement, the next map
 * tile from the deck laid in that slot.
 *
 * Two board history entries, in this order: the figure's movement bookkeeping
 * (same square, 1 more used) and the tile. The board Undo therefore takes the
 * tile off first and gives the movement back on the second press. The tile
 * card goes straight to the discard pile, like every drawn tile; undoing the
 * draw's log line by vote returns it to the deck.
 */

import { brandenburgForbiddenFor } from '../brandenburg.js'
import { mapCellOf } from '../blockade.js'
import { communismLocksOf } from '../communism.js'
import { explorationSlotFor, exploreTargetsFrom, isExploredCell } from '../explore.js'
import { activeGreatPerson, stackingLimitOf } from '../great-person-effects.js'
import { figureBelongsTo, figureMovementOptions, movementOf } from '../movement.js'
import { columnLabel, slotOrigin, findPiece, locationOf } from '../board.js'
import type { PieceMovement, Rotation } from '../board.js'
import type { EngineError } from '../errors.js'
import type { Result } from '../result.js'
import { err } from '../result.js'
import type { GameState } from '../state.js'
import { findPlayer, hasUserAccess } from '../state.js'
import { turnStatus } from '../turn.js'
import { appendLog } from '../log.js'
import { ok } from '../result.js'
import { spanishCreditsOf, withSpanishGrant } from '../spanish-credit.js'
import { SPANISH } from './player.js'
import { areasFor, moveFigureWithMovementUnchecked } from './board.js'
import { drawTileAt } from './draw.js'

export interface ExploreSquareInput {
  readonly playerId: string
  readonly pieceId: string
  /** The unexplored square to uncover, zero based from the map's top-left corner. */
  readonly column: number
  readonly row: number
  readonly at?: string
}

export function exploreSquare(state: GameState, input: ExploreSquareInput): Result<GameState, EngineError> {
  if (!hasUserAccess(state, input.playerId)) return err({ kind: 'NO_ACCESS', playerId: input.playerId })
  const player = findPlayer(state, input.playerId)
  const piece = findPiece(state.board, input.pieceId)
  if (player === undefined) return err({ kind: 'PLAYER_NOT_FOUND', playerId: input.playerId })
  if (piece === undefined) return err({ kind: 'BOARD_PIECE_NOT_FOUND', pieceId: input.pieceId })
  if (!figureBelongsTo(player, piece)) {
    return err({ kind: 'FIGURE_MOVE_ILLEGAL', reason: `${piece.label} is not one of your figures on the map.` })
  }
  const from = mapCellOf(state.board, piece)
  if (from === null) {
    return err({ kind: 'FIGURE_MOVE_ILLEGAL', reason: `${piece.label} is not on the map.` })
  }

  const turnNumber = turnStatus(state).currentTurn
  const options = figureMovementOptions(
    state.board,
    {
      ...player,
      activeGreatPersonNames: activeGreatPerson(state, player, 'Henry Ford') ? ['Henry Ford'] : [],
      stackingLimit: stackingLimitOf(state, player),
    },
    piece,
    turnNumber,
    communismLocksOf(state),
    brandenburgForbiddenFor(state, input.playerId),
  )
  const target = { column: input.column, row: input.row }
  if (
    options === null ||
    !options.explore.some((cell) => cell.column === target.column && cell.row === target.row) ||
    !exploreTargetsFrom(state.board, from).some((cell) => cell.column === target.column && cell.row === target.row)
  ) {
    return err({
      kind: 'FIGURE_MOVE_ILLEGAL',
      reason:
        options !== null && options.remaining < 1
          ? `${piece.label} has no movement left to explore with this turn.`
          : `${piece.label} cannot explore that square: it must be next to the figure, unexplored, and the figure must be free to move.`,
    })
  }
  const slot = explorationSlotFor(state.board, target)
  if (slot === undefined) {
    return err({ kind: 'FIGURE_MOVE_ILLEGAL', reason: 'There is no free map slot to put a tile on there.' })
  }

  const saved = movementOf(piece, turnNumber)
  const movement: PieceMovement = {
    turn: turnNumber,
    used: (saved?.used ?? 0) + 1,
    locked: saved?.locked ?? false,
    ...(saved?.reason === undefined ? {} : { reason: saved.reason }),
  }
  const square = `${columnLabel(target.column)}${target.row + 1}`
  const spent = moveFigureWithMovementUnchecked(state, {
    playerId: input.playerId,
    pieceId: piece.id,
    x: piece.x,
    y: piece.y,
    movementFrom: piece.movement ?? null,
    movementTo: movement,
    description: `explored ${square} with ${piece.label} at ${locationOf(state.board, areasFor(state), piece)} (1 movement)`,
    ...(input.at === undefined ? {} : { at: input.at }),
  })
  if (spent === undefined) return err({ kind: 'BOARD_PIECE_NOT_FOUND', pieceId: input.pieceId })
  const drawn = drawTileAt(spent, input.playerId, slotOrigin(spent.board, slot), arrowTowards(from, target))
  if (!drawn.ok) return drawn
  // A card with no tile artwork places nothing: do not spend the movement on fog that stays fog
  if (!explorationCovered(drawn.value, target)) {
    return err({ kind: 'FIGURE_MOVE_ILLEGAL', reason: 'The drawn tile could not be placed on the map.' })
  }
  return ok(grantSpanishBuilding(drawn.value, spent.board.history.length, input.playerId, square, input.at))
}

/**
 * The Spanish ability: the tile this exploration laid gives its explorer one free basic building (`spanish-credit.ts`),
 * tied to the board entry that placed the tile so that undoing the exploration takes it back. Nothing for any other
 * civilization, and nothing when no tile was laid. The public line says no number, the private one the amount and the total.
 */
function grantSpanishBuilding(state: GameState, historyBefore: number, playerId: string, square: string, at: string | undefined): GameState {
  const player = findPlayer(state, playerId)
  if (player?.civilization?.name !== SPANISH) return state
  const tile = state.board.history.slice(historyBefore).find((entry) => entry.change.kind === 'place' && entry.change.piece.category === 'tile')
  if (tile === undefined) return state
  const granted = withSpanishGrant(state, playerId, tile.id)
  return appendLog(granted, {
    username: player.username,
    playerId,
    publicLog: `${player.username} may build a free basic building for discovering ${square} as the Spanish`,
    privateLog: `${player.username} gains 1 (${spanishCreditsOf(granted, playerId)}) free building as the Spanish`,
    createdAt: at ?? null,
  })
}

/**
 * The turn that puts a tile's arrow on the edge the explorer came from. The
 * art has its arrow on the bottom edge, so a figure south of the tile needs no
 * turn; from the west the tile is turned 90, from the north 180, from the east 270.
 */
function arrowTowards(from: { column: number; row: number }, target: { column: number; row: number }): Rotation {
  if (target.column > from.column) return 90
  if (target.row > from.row) return 180
  if (target.column < from.column) return 270
  return 0
}

const explorationCovered = (state: GameState, target: { column: number; row: number }): boolean =>
  isExploredCell(state.board, target)
