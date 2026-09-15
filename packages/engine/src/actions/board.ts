/**
 * Board actions.
 *
 * All of this is new — Java had no board model, only a link to a Google slide.
 * The reducers follow the same shape as the rest of the engine.
 *
 * Every player may move every piece, as at a physical table. The server checks
 * that the asset name exists in the manifest, so a client cannot put an
 * arbitrary image reference on the board.
 *
 * Every change is recorded in `board.history`, which makes two things possible:
 * undoing the last change, and stepping through the whole game to see what the
 * others did while you were away. The game log is not written to from here — a
 * turn is made of many small adjustments and the log would drown.
 */

import type { Board, BoardArea, BoardChange, BoardPiece, Rotation } from '../board.js'
import {
  areaAt,
  clampToBoard,
  findBoardAsset,
  findPiece,
  locationOf,
  nextFreeSlot,
  nextRotation,
  playerAreas,
  revertChange,
} from '../board.js'
import type { EngineError } from '../errors.js'
import { nextId } from '../random.js'
import type { Result } from '../result.js'
import { err, ok } from '../result.js'
import type { GameState, Playerhand } from '../state.js'
import { findPlayer, hasUserAccess } from '../state.js'

type ActionResult = Result<GameState, EngineError>

function withBoard(state: GameState, board: Board): GameState {
  return { ...state, board }
}

function requireAccess(state: GameState, playerId: string): EngineError | undefined {
  return hasUserAccess(state, playerId) ? undefined : { kind: 'NO_ACCESS', playerId }
}

/** The player areas for this game, derived from the current player list. */
export function areasFor(state: GameState): readonly BoardArea[] {
  return playerAreas(state.board, state.players)
}

interface Recorded {
  readonly state: GameState
  readonly pieces: readonly BoardPiece[]
  readonly change: BoardChange
  readonly description: string
}

/**
 * Writes one change into the board and appends it to the history.
 *
 * The caller works out the new pieces and the change that produced them; this
 * keeps the bookkeeping in one place.
 */
function record(
  input: { readonly playerId: string; readonly at?: string },
  recorded: Recorded,
): GameState {
  const { state } = recorded
  const player = findPlayer(state, input.playerId)
  const [id, rng] = nextId(state.rng)

  return {
    ...state,
    rng,
    board: {
      ...state.board,
      pieces: recorded.pieces,
      history: [
        ...state.board.history,
        {
          id,
          at: input.at ?? null,
          playerId: input.playerId,
          username: player?.username ?? 'unknown',
          description: `${player?.username ?? 'Someone'} ${recorded.description}`,
          change: recorded.change,
          logLength: state.log.length,
        },
      ],
    },
  }
}

// ---------------------------------------------------------------------------
// Placing
// ---------------------------------------------------------------------------

export interface PlacePieceInput {
  readonly playerId: string
  readonly assetId: string
  readonly x: number
  readonly y: number
  readonly rotation?: Rotation
  /** ISO timestamp for the history. The engine itself stays pure. */
  readonly at?: string
}

/** Puts a new piece on the board, on top of the stack. */
export function placePiece(state: GameState, input: PlacePieceInput): ActionResult {
  const denied = requireAccess(state, input.playerId)
  if (denied !== undefined) return err(denied)

  const placed = placeUnchecked(state, input)
  if (placed === undefined) {
    return err({ kind: 'BOARD_ASSET_NOT_FOUND', assetId: input.assetId })
  }
  return ok(placed)
}

/**
 * The same as `placePiece`, but without the access check and without a Result.
 *
 * Used by the engine itself when one action puts a piece down as a consequence
 * of something else — a drawn exploration tile, or the starting tile of a
 * civilization being revealed. Access has already been checked by the caller.
 *
 * Returns `undefined` when the asset does not exist.
 */
export function placeUnchecked(
  state: GameState,
  input: PlacePieceInput,
): GameState | undefined {
  const asset = findBoardAsset(input.assetId)
  if (asset === undefined) return undefined

  const [id, rng] = nextId(state.rng)
  const withId: GameState = { ...state, rng }

  // Dropping a piece in a player area tidies it into the next free slot
  const areas = areasFor(state)
  const area = areaAt(areas, input.x + asset.width / 2, input.y + asset.height / 2)
  const wanted =
    area === undefined
      ? { x: input.x, y: input.y }
      : (() => {
          const [slotX, slotY] = nextFreeSlot(state.board, area, state.board.pieces, {
            x: input.x,
            y: input.y,
          })
          return { x: slotX, y: slotY }
        })()

  const [x, y] = clampToBoard(state.board, wanted.x, wanted.y, asset.width, asset.height)

  const piece: BoardPiece = {
    id,
    assetId: asset.id,
    path: asset.path,
    label: asset.label,
    category: asset.category,
    x,
    y,
    width: asset.width,
    height: asset.height,
    rotation: input.rotation ?? 0,
    placedBy: input.playerId,
  }

  // Map tiles go under everything else, or they would cover the pieces on them
  const onTop = asset.category !== 'tile' && asset.category !== 'civtile'
  const pieces = onTop ? [...state.board.pieces, piece] : [piece, ...state.board.pieces]

  return record(input, {
    state: withId,
    pieces,
    change: { kind: 'place', piece, onTop },
    description: `placed ${piece.label} at ${locationOf(state.board, areas, piece)}`,
  })
}

// ---------------------------------------------------------------------------
// Moving
// ---------------------------------------------------------------------------

export interface MovePieceInput {
  readonly playerId: string
  readonly pieceId: string
  readonly x: number
  readonly y: number
  readonly at?: string
}

/**
 * Moves a piece. It also comes to the top, the way picking something up off a
 * table and putting it back down leaves it on top of the pile.
 */
export function movePiece(state: GameState, input: MovePieceInput): ActionResult {
  const denied = requireAccess(state, input.playerId)
  if (denied !== undefined) return err(denied)

  const fromIndex = state.board.pieces.findIndex((piece) => piece.id === input.pieceId)
  const piece = state.board.pieces[fromIndex]
  if (piece === undefined) {
    return err({ kind: 'BOARD_PIECE_NOT_FOUND', pieceId: input.pieceId })
  }

  const areas = areasFor(state)
  const area = areaAt(areas, input.x + piece.width / 2, input.y + piece.height / 2)
  const wanted =
    area === undefined
      ? { x: input.x, y: input.y }
      : (() => {
          const others = state.board.pieces.filter((other) => other.id !== piece.id)
          const [slotX, slotY] = nextFreeSlot(state.board, area, others, {
            x: input.x,
            y: input.y,
          })
          return { x: slotX, y: slotY }
        })()

  const [x, y] = clampToBoard(state.board, wanted.x, wanted.y, piece.width, piece.height)
  const moved: BoardPiece = { ...piece, x, y }
  const pieces = [...state.board.pieces.filter((other) => other.id !== piece.id), moved]

  const from = locationOf(state.board, areas, piece)
  const to = locationOf(state.board, areas, moved)

  return ok(
    record(input, {
      state,
      pieces,
      change: {
        kind: 'move',
        pieceId: piece.id,
        from: { x: piece.x, y: piece.y },
        to: { x, y },
        fromIndex,
      },
      description:
        from === to
          ? `nudged ${piece.label} in ${to}`
          : `moved ${piece.label} from ${from} to ${to}`,
    }),
  )
}

// ---------------------------------------------------------------------------
// Stacking and turning
// ---------------------------------------------------------------------------

export interface PieceInput {
  readonly playerId: string
  readonly pieceId: string
  readonly at?: string
}

function reorder(state: GameState, input: PieceInput, toTop: boolean): ActionResult {
  const denied = requireAccess(state, input.playerId)
  if (denied !== undefined) return err(denied)

  const fromIndex = state.board.pieces.findIndex((piece) => piece.id === input.pieceId)
  const piece = state.board.pieces[fromIndex]
  if (piece === undefined) {
    return err({ kind: 'BOARD_PIECE_NOT_FOUND', pieceId: input.pieceId })
  }

  const rest = state.board.pieces.filter((other) => other.id !== piece.id)
  const pieces = toTop ? [...rest, piece] : [piece, ...rest]

  return ok(
    record(input, {
      state,
      pieces,
      change: { kind: 'reorder', pieceId: piece.id, fromIndex, toTop },
      description: `sent ${piece.label} to the ${toTop ? 'front' : 'back'}`,
    }),
  )
}

/** Moves the piece to the end of the list, that is to the top of the stack. */
export const bringToFront = (state: GameState, input: PieceInput): ActionResult =>
  reorder(state, input, true)

/** Moves the piece to the start of the list, that is to the bottom. */
export const sendToBack = (state: GameState, input: PieceInput): ActionResult =>
  reorder(state, input, false)

export interface RotatePieceInput extends PieceInput {
  /** Leave out to turn a quarter step clockwise. */
  readonly rotation?: Rotation
}

/**
 * Turns a piece. Map tiles carry an arrow showing which way the tile goes, and
 * a drawn tile may need any of the four directions.
 */
export function rotatePiece(state: GameState, input: RotatePieceInput): ActionResult {
  const denied = requireAccess(state, input.playerId)
  if (denied !== undefined) return err(denied)

  const piece = findPiece(state.board, input.pieceId)
  if (piece === undefined) return err({ kind: 'BOARD_PIECE_NOT_FOUND', pieceId: input.pieceId })

  const rotation = input.rotation ?? nextRotation(piece.rotation)
  const pieces = state.board.pieces.map((other) =>
    other.id === piece.id ? { ...other, rotation } : other,
  )

  return ok(
    record(input, {
      state,
      pieces,
      change: { kind: 'rotate', pieceId: piece.id, from: piece.rotation, to: rotation },
      description: `turned ${piece.label} to ${rotation} degrees`,
    }),
  )
}

// ---------------------------------------------------------------------------
// Removing
// ---------------------------------------------------------------------------

export function removePiece(state: GameState, input: PieceInput): ActionResult {
  const denied = requireAccess(state, input.playerId)
  if (denied !== undefined) return err(denied)

  const index = state.board.pieces.findIndex((piece) => piece.id === input.pieceId)
  const piece = state.board.pieces[index]
  if (piece === undefined) {
    return err({ kind: 'BOARD_PIECE_NOT_FOUND', pieceId: input.pieceId })
  }

  return ok(
    record(input, {
      state,
      pieces: state.board.pieces.filter((other) => other.id !== piece.id),
      change: { kind: 'remove', piece, index },
      description: `removed ${piece.label} from ${locationOf(state.board, areasFor(state), piece)}`,
    }),
  )
}

export interface ClearBoardInput {
  readonly playerId: string
  readonly at?: string
}

/** Empties the board. Useful when a setup has to be redone from scratch. */
export function clearBoard(state: GameState, input: ClearBoardInput): ActionResult {
  const denied = requireAccess(state, input.playerId)
  if (denied !== undefined) return err(denied)

  return ok(
    record(input, {
      state,
      pieces: [],
      change: { kind: 'clear', pieces: state.board.pieces },
      description: `cleared the board of ${state.board.pieces.length} pieces`,
    }),
  )
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

/**
 * Takes back the last board change, whoever made it.
 *
 * Anyone may undo, because anyone may move anything — the history shows who
 * did what. The entry is dropped rather than kept and marked, so stepping
 * through the game shows the corrected timeline rather than a dead end.
 */
export function undoLastBoardChange(state: GameState, playerId: string): ActionResult {
  const denied = requireAccess(state, playerId)
  if (denied !== undefined) return err(denied)

  const last = state.board.history.at(-1)
  if (last === undefined) return err({ kind: 'NOTHING_TO_UNDO_ON_BOARD' })

  return ok(
    withBoard(state, {
      ...state.board,
      pieces: revertChange(state.board.pieces, last.change),
      history: state.board.history.slice(0, -1),
    }),
  )
}

/** Helper for the server: the players an area layout is built from. */
export function areaPlayers(state: GameState): readonly Playerhand[] {
  return state.players
}
