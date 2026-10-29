/**
 * A figure explores the fog next to it (issue #302): 1 movement, the next map
 * tile from the deck laid in that slot.
 *
 * Two board history entries, in this order: the figure's movement bookkeeping
 * (same square, 1 more used) and the tile. The board Undo therefore takes the
 * tile off first and gives the movement back on the second press. The tile
 * card stays in the player's hand like any other draw; undoing the draw's log
 * line by vote returns it to the deck.
 */

import { brandenburgForbiddenFor } from '../brandenburg.js'
import { mapCellOf } from '../blockade.js'
import { communismLocksOf } from '../communism.js'
import { explorationSlotFor, exploreTargetsFrom, isExploredCell } from '../explore.js'
import { activeGreatPerson, stackingLimitOf } from '../great-person-effects.js'
import { figureBelongsTo, figureMovementOptions, movementOf } from '../movement.js'
import { columnLabel, slotOrigin, findPiece, locationOf } from '../board.js'
import type { PieceMovement } from '../board.js'
import type { EngineError } from '../errors.js'
import type { Result } from '../result.js'
import { err } from '../result.js'
import type { GameState } from '../state.js'
import { findPlayer, hasUserAccess } from '../state.js'
import { turnStatus } from '../turn.js'
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
  const drawn = drawTileAt(spent, input.playerId, slotOrigin(spent.board, slot))
  if (!drawn.ok) return drawn
  // A card with no tile artwork places nothing: do not spend the movement on fog that stays fog
  if (!explorationCovered(drawn.value, target)) {
    return err({ kind: 'FIGURE_MOVE_ILLEGAL', reason: 'The drawn tile could not be placed on the map.' })
  }
  return drawn
}

const explorationCovered = (state: GameState, target: { column: number; row: number }): boolean =>
  isExploredCell(state.board, target)
