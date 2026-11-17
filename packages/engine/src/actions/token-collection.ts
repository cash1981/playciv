/**
 * A figure ends its move on a hut or village (issue #364): the token leaves the square for the player's
 * area and the card it gives goes into the hand.
 *
 * The player confirms first (the web asks), and the move is the ordinary `travelFigure`. The board then
 * holds two entries, in this order: the figure's move and the token's. The first board Undo puts the token
 * back and returns the card (`tokenCollections`), the second takes the move back, as the exploration does.
 * Flight cannot end on a hut or village, so it never collects one.
 */

import { boardAreas, nextFreeSlot } from '../board.js'
import { squareLabel } from '../build-options.js'
import type { EngineError } from '../errors.js'
import type { Result } from '../result.js'
import { ok } from '../result.js'
import type { GameState, TokenCollection } from '../state.js'
import { findPlayer } from '../state.js'
import { mapTokensOf } from '../zheng-he.js'
import { movePieceUnchecked, travelFigure } from './board.js'
import type { TravelFigureInput } from './board.js'
import { draw } from './draw.js'

export interface TravelCollectingInput extends TravelFigureInput {
  /** The player agreed to draw the hut or village the figure ends on. Without it the token stays where it is. */
  readonly collectToken?: boolean
}

export function travelFigureCollecting(state: GameState, input: TravelCollectingInput): Result<GameState, EngineError> {
  const travelled = travelFigure(state, input)
  if (!travelled.ok || input.collectToken !== true || input.disband === true) return travelled
  const moved = travelled.value
  const player = findPlayer(moved, input.playerId)
  const token = mapTokensOf(moved.board).find(
    (candidate) => candidate.cell.column === input.column && candidate.cell.row === input.row,
  )
  if (player === undefined || token === undefined) return travelled
  const area = boardAreas(moved.board, moved.players).find((candidate) => candidate.playerId === input.playerId)
  if (area === undefined) return travelled

  const under = (moved.underTokens ?? []).find((candidate) => candidate.pieceId === token.piece.id) ?? null
  const held = new Set(player.items.map((item) => item.id))
  const drawn = draw(moved, {
    playerId: input.playerId,
    sheetName: token.sheet,
    fromPieceId: token.piece.id,
    confirmedOutOfTurn: true,
  })
  // No hut or village left in the deck: the move stands and the token stays on its square
  if (!drawn.ok) return travelled
  const card = findPlayer(drawn.value, input.playerId)?.items.find((item) => !held.has(item.id))
  if (card === undefined) return travelled

  const [x, y] = nextFreeSlot(drawn.value.board, area, drawn.value.board.pieces, { x: token.piece.x, y: token.piece.y })
  const placed = movePieceUnchecked(drawn.value, {
    playerId: input.playerId,
    pieceId: token.piece.id,
    x,
    y,
    snap: false,
    ...(input.at === undefined ? {} : { at: input.at }),
  })
  const entry = placed?.board.history.at(-1)
  if (placed === undefined || entry === undefined) return travelled
  const collection: TokenCollection = {
    historyId: entry.id,
    playerId: input.playerId,
    pieceId: token.piece.id,
    itemId: card.id,
    under,
    square: squareLabel(token.cell),
  }
  return ok({ ...placed, tokenCollections: [...(placed.tokenCollections ?? []), collection] })
}
