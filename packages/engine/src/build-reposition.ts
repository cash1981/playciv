/**
 * Putting a figure a Build placed on another square of the same city, while City Management is
 * still open (human, 2026-11-24): a player who regrets the square need not undo the whole build.
 *
 * The build stays as it was (trade paid, marker used up, one city action); only the figure moves,
 * under the placement rules the Build used (`figureSquaresFor`). The build's record follows the
 * figure, so the undo vote on the build's line still removes it from where it stands, and the
 * board history entry of the move belongs to the build (`effect.repositioned`), so the board Undo
 * cannot take the figure back to the old square while the build stays.
 *
 * Buildings, wonders, units and City Walls are not figures and are not moved here.
 */

import { mapCellOf } from './blockade.js'
import { moveFigureWithMovementUnchecked } from './actions/board.js'
import { figureSquaresFor, squareCentre, squareLabel } from './build-options.js'
import type { BuildSquare } from './build-options.js'
import { openCityManagementTurn } from './assisted-core.js'
import type { EngineError } from './errors.js'
import { movementOf } from './movement.js'
import { err, ok } from './result.js'
import type { Result } from './result.js'
import { findPlayer, hasUserAccess } from './state.js'
import type { AssistedActionRecord, GameState, Playerhand } from './state.js'
import { turnStatus } from './turn.js'

/** A figure of the viewer's that can be put on another square, with the squares it can go to (its own is not among them). */
export interface RepositionableFigure {
  readonly pieceId: string
  readonly squares: readonly BuildSquare[]
}

export interface RepositionBuiltFigureInput {
  readonly playerId: string
  readonly pieceId: string
  /** The destination map square, zero based from the map's top left corner. */
  readonly column: number
  readonly row: number
  readonly at?: string
}

type PlacedBuildRecord = AssistedActionRecord & {
  readonly effect: Extract<AssistedActionRecord['effect'], { readonly kind: 'build'; readonly pieceId: string }>
}

const refused = (reason: string): EngineError => ({ kind: 'FIGURE_MOVE_ILLEGAL', reason })

/** The newest applied build of this turn that put the piece on the board, and whose figure it was. */
function figureBuildOf(state: GameState, playerId: string, pieceId: string): PlacedBuildRecord | undefined {
  const currentTurn = turnStatus(state).currentTurn
  return [...state.assistedActions].reverse().find((record): record is PlacedBuildRecord => {
    const effect = record.effect
    return (
      record.status === 'applied' &&
      record.playerId === playerId &&
      record.turnNumber === currentTurn &&
      effect.kind === 'build' &&
      'pieceId' in effect &&
      effect.pieceId === pieceId &&
      (effect.item.kind === 'army' || effect.item.kind === 'scout')
    )
  })
}

/** Another applied action of the turn that names the piece (a scout sent to a city, a city founded): it would be left behind. */
function laterUseOf(state: GameState, record: AssistedActionRecord, pieceId: string): AssistedActionRecord | undefined {
  const index = state.assistedActions.findIndex((candidate) => candidate.id === record.id)
  return state.assistedActions.find(
    (candidate, at) => at !== index && candidate.status === 'applied' && JSON.stringify(candidate.effect).includes(pieceId),
  )
}

type Inspected =
  | { readonly ok: true; readonly record: PlacedBuildRecord; readonly squares: readonly BuildSquare[] }
  | { readonly ok: false; readonly reason: string }

function inspect(state: GameState, player: Playerhand, pieceId: string): Inspected {
  const fail = (reason: string): Inspected => ({ ok: false, reason })
  const piece = state.board.pieces.find((candidate) => candidate.id === pieceId)
  if (piece === undefined) return fail('That figure is not on the board.')
  const record = figureBuildOf(state, player.playerId, pieceId)
  if (record === undefined) return fail(`${piece.label} was not built by you this turn, so it cannot be put on another square this way.`)
  if (openCityManagementTurn(state, player) === undefined) {
    return fail('City Management is over, so the figure stays where the build put it.')
  }
  const effect = record.effect
  const turn = turnStatus(state).currentTurn
  if (movementOf(piece, turn) !== null) return fail(`${piece.label} has moved this turn, so it cannot be put on another square this way.`)
  const cell = mapCellOf(state.board, piece)
  if (cell === null || cell.column !== effect.square.column || cell.row !== effect.square.row) {
    return fail(`${piece.label} has left ${effect.square.label}. Move it back first.`)
  }
  const later = laterUseOf(state, record, pieceId)
  if (later !== undefined) {
    return fail(`${piece.label} was used after it was built (${later.kind}). Undo that first.`)
  }
  const kind = effect.item.kind === 'scout' ? 'scout' : 'army'
  // Without the figure itself, so its own square is not full because of it
  const without: GameState = { ...state, board: { ...state.board, pieces: state.board.pieces.filter((candidate) => candidate.id !== pieceId) } }
  const squares = figureSquaresFor(without, player, effect.cityPieceId, kind).filter(
    (square) => square.column !== effect.square.column || square.row !== effect.square.row,
  )
  return { ok: true, record, squares }
}

/** The viewer's figures a Build placed in the open City Management, each with the squares it can be put on. Own view only. */
export function repositionableFiguresOf(state: GameState, player: Playerhand): readonly RepositionableFigure[] {
  if (openCityManagementTurn(state, player) === undefined) return []
  const currentTurn = turnStatus(state).currentTurn
  const ids = new Set<string>()
  for (const record of state.assistedActions) {
    const effect = record.effect
    if (
      record.status === 'applied' &&
      record.playerId === player.playerId &&
      record.turnNumber === currentTurn &&
      effect.kind === 'build' &&
      'pieceId' in effect &&
      (effect.item.kind === 'army' || effect.item.kind === 'scout')
    ) {
      ids.add(effect.pieceId)
    }
  }
  return [...ids].flatMap((pieceId) => {
    const found = inspect(state, player, pieceId)
    return found.ok ? [{ pieceId, squares: found.squares }] : []
  })
}

/**
 * Puts a figure the owner's open build placed on another legal square of that city. Free: nothing is paid
 * or refunded, and the figure keeps its full movement for the Movement phase. One board history entry.
 */
export function repositionBuiltFigure(state: GameState, input: RepositionBuiltFigureInput): Result<GameState, EngineError> {
  if (!hasUserAccess(state, input.playerId)) return err({ kind: 'NO_ACCESS', playerId: input.playerId })
  const player = findPlayer(state, input.playerId)
  if (player === undefined) return err({ kind: 'PLAYER_NOT_FOUND', playerId: input.playerId })
  const piece = state.board.pieces.find((candidate) => candidate.id === input.pieceId)
  if (piece === undefined) return err({ kind: 'BOARD_PIECE_NOT_FOUND', pieceId: input.pieceId })

  const found = inspect(state, player, input.pieceId)
  if (!found.ok) return err(refused(found.reason))
  const { record, squares } = found
  const effect = record.effect

  if (!Number.isInteger(input.column) || !Number.isInteger(input.row)) return err(refused('Pick a square on the map.'))
  const target = squares.find((square) => square.column === input.column && square.row === input.row)
  if (target === undefined) {
    const label = input.column >= 0 && input.column < 1000 && input.row >= 0 && input.row < 1000 ? squareLabel(input) : 'That square'
    return err(
      refused(
        input.column === effect.square.column && input.row === effect.square.row
          ? `${piece.label} already stands on ${label}.`
          : `${label} is not a legal square for ${piece.label} here: it must be one of the squares the build offered for this city.`,
      ),
    )
  }

  const centre = squareCentre(state.board, target)
  const moved = moveFigureWithMovementUnchecked(state, {
    playerId: input.playerId,
    pieceId: piece.id,
    x: centre.x - piece.width / 2,
    y: centre.y - piece.height / 2,
    movementFrom: null,
    movementTo: null,
    description:
      `put ${piece.label} on ${target.label} instead of ${effect.square.label}, still in City Management (no movement used)` +
      (target.note === undefined ? '' : `. ${target.note}`),
    ...(input.at === undefined ? {} : { at: input.at }),
  })
  const entry = moved?.board.history.at(-1)
  const placed = moved?.board.pieces.find((candidate) => candidate.id === piece.id)
  if (moved === undefined || entry === undefined || placed === undefined) {
    return err({ kind: 'BOARD_PIECE_NOT_FOUND', pieceId: input.pieceId })
  }
  const landed = mapCellOf(moved.board, placed)
  if (landed === null || landed.column !== target.column || landed.row !== target.row) {
    return err(refused(`${piece.label} could not be put on ${target.label}.`))
  }
  return ok({
    ...moved,
    assistedActions: moved.assistedActions.map((candidate) =>
      candidate.id !== record.id
        ? candidate
        : {
            ...candidate,
            effect: {
              ...effect,
              square: { column: target.column, row: target.row, label: target.label },
              position: { x: placed.x, y: placed.y },
              repositioned: [...(effect.repositioned ?? []), entry.id],
            },
          },
    ),
  })
}
