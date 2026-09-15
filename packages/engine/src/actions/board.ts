/**
 * Handlinger på brettet.
 *
 * Alt dette er nytt — Java hadde ingen brettmodell, bare en lenke til et
 * Google-lysbilde. Reducerne følger samme form som resten av motoren.
 *
 * Alle spillere kan flytte alle brikker, som ved et fysisk bord. Serveren
 * validerer at brikkenavnet finnes i manifestet, så en klient kan ikke legge ut
 * en vilkårlig bildereferanse.
 *
 * Flytting logges ikke. En tur består av mange små justeringer, og loggen ville
 * druknet. Brettet er sin egen dokumentasjon.
 */

import type { Board, BoardPiece, Rotation } from '../board.js'
import { clampToBoard, findBoardAsset, findPiece, nextRotation } from '../board.js'
import type { EngineError } from '../errors.js'
import { nextId } from '../random.js'
import type { Result } from '../result.js'
import { err, ok } from '../result.js'
import type { GameState } from '../state.js'
import { hasUserAccess } from '../state.js'

type ActionResult = Result<GameState, EngineError>

function withBoard(state: GameState, board: Board): GameState {
  return { ...state, board }
}

function requireAccess(state: GameState, playerId: string): EngineError | undefined {
  return hasUserAccess(state, playerId) ? undefined : { kind: 'NO_ACCESS', playerId }
}

export interface PlacePieceInput {
  readonly playerId: string
  readonly assetId: string
  readonly x: number
  readonly y: number
  readonly rotation?: Rotation
}

/** Legger en ny brikke øverst på brettet. */
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
 * Samme som `placePiece`, men uten tilgangskontroll og uten Result.
 *
 * Brukes av motoren selv når en handling legger ut en brikke som følge av noe
 * annet — et trukket utforskningsbrett, eller startbrettet til en sivilisasjon
 * som avsløres. Tilgangen er allerede sjekket av handlingen som kaller.
 *
 * Returnerer `undefined` hvis brikketypen ikke finnes.
 */
export function placeUnchecked(
  state: GameState,
  input: PlacePieceInput,
): GameState | undefined {
  const asset = findBoardAsset(input.assetId)
  if (asset === undefined) return undefined

  const [id, rng] = nextId(state.rng)
  const [x, y] = clampToBoard(state.board, input.x, input.y, asset.width, asset.height)

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

  // Map-tiles skal ligge under alt annet, ellers dekker de brikkene på brettet
  const isTile = asset.category === 'tile' || asset.category === 'civtile'
  const pieces = isTile
    ? [piece, ...state.board.pieces]
    : [...state.board.pieces, piece]

  return withBoard({ ...state, rng }, { ...state.board, pieces })
}

export interface MovePieceInput {
  readonly playerId: string
  readonly pieceId: string
  readonly x: number
  readonly y: number
}

/**
 * Flytter en brikke. Brikken legges samtidig øverst, som når man tar opp en
 * brikke fra et bord og setter den ned igjen.
 */
export function movePiece(state: GameState, input: MovePieceInput): ActionResult {
  const denied = requireAccess(state, input.playerId)
  if (denied !== undefined) return err(denied)

  const piece = findPiece(state.board, input.pieceId)
  if (piece === undefined) return err({ kind: 'BOARD_PIECE_NOT_FOUND', pieceId: input.pieceId })

  const [x, y] = clampToBoard(state.board, input.x, input.y, piece.width, piece.height)
  const moved: BoardPiece = { ...piece, x, y }

  return ok(
    withBoard(state, {
      ...state.board,
      pieces: [...state.board.pieces.filter((other) => other.id !== piece.id), moved],
    }),
  )
}

export interface PieceInput {
  readonly playerId: string
  readonly pieceId: string
}

/** Legger brikken sist i listen, altså øverst i stabelen. */
export function bringToFront(state: GameState, input: PieceInput): ActionResult {
  const denied = requireAccess(state, input.playerId)
  if (denied !== undefined) return err(denied)

  const piece = findPiece(state.board, input.pieceId)
  if (piece === undefined) return err({ kind: 'BOARD_PIECE_NOT_FOUND', pieceId: input.pieceId })

  return ok(
    withBoard(state, {
      ...state.board,
      pieces: [...state.board.pieces.filter((other) => other.id !== piece.id), piece],
    }),
  )
}

/** Legger brikken først i listen, altså nederst i stabelen. */
export function sendToBack(state: GameState, input: PieceInput): ActionResult {
  const denied = requireAccess(state, input.playerId)
  if (denied !== undefined) return err(denied)

  const piece = findPiece(state.board, input.pieceId)
  if (piece === undefined) return err({ kind: 'BOARD_PIECE_NOT_FOUND', pieceId: input.pieceId })

  return ok(
    withBoard(state, {
      ...state.board,
      pieces: [piece, ...state.board.pieces.filter((other) => other.id !== piece.id)],
    }),
  )
}

export interface RotatePieceInput extends PieceInput {
  /** Utelates for å snu et kvart trinn med klokka. */
  readonly rotation?: Rotation
}

/**
 * Snur en brikke. Map-tiles har en pil som viser hvilken vei brettet skal
 * ligge, og et trukket brett kan trenge hvilken som helst av de fire retningene.
 */
export function rotatePiece(state: GameState, input: RotatePieceInput): ActionResult {
  const denied = requireAccess(state, input.playerId)
  if (denied !== undefined) return err(denied)

  const piece = findPiece(state.board, input.pieceId)
  if (piece === undefined) return err({ kind: 'BOARD_PIECE_NOT_FOUND', pieceId: input.pieceId })

  const rotated: BoardPiece = {
    ...piece,
    rotation: input.rotation ?? nextRotation(piece.rotation),
  }

  return ok(
    withBoard(state, {
      ...state.board,
      pieces: state.board.pieces.map((other) => (other.id === piece.id ? rotated : other)),
    }),
  )
}

export function removePiece(state: GameState, input: PieceInput): ActionResult {
  const denied = requireAccess(state, input.playerId)
  if (denied !== undefined) return err(denied)

  if (findPiece(state.board, input.pieceId) === undefined) {
    return err({ kind: 'BOARD_PIECE_NOT_FOUND', pieceId: input.pieceId })
  }

  return ok(
    withBoard(state, {
      ...state.board,
      pieces: state.board.pieces.filter((piece) => piece.id !== input.pieceId),
    }),
  )
}

/** Tømmer brettet. Nyttig når et oppsett skal gjøres om fra bunnen. */
export function clearBoard(state: GameState, playerId: string): ActionResult {
  const denied = requireAccess(state, playerId)
  if (denied !== undefined) return err(denied)
  return ok(withBoard(state, { ...state.board, pieces: [] }))
}
