/**
 * Disbanding figures (Fame and Fortune p. 7–8, the human's rulings of 2026-10-30).
 *
 * A player's army or scout that travels onto a centre square of one of their own
 * cities may be disbanded there: the figure leaves the board (back to supply,
 * which is counted from the board). A disbanded army fortifies the city, a
 * disbanded scout sends it a caravan: the marker goes on the city centre. A city
 * holds one such marker, either kind; disbanding into a city that already has one
 * only removes the figure.
 *
 * A caravan adds 2 production to the city's next Build and is then discarded
 * (`build-options.ts`, the build in `assisted.ts`). A fortification adds 2 to the
 * defender's combat bonus in a battle for the city (`city-defence.ts`) and is
 * removed when that battle ends, whoever wins (`endBattleAction`).
 *
 * Everything here reads the public board only, so the web asks the same question
 * before it sends a move.
 */

import { cityCenterCells, mapCellOf, pieceColorOf } from './blockade.js'
import type { Cell } from './blockade.js'
import type { Board, BoardPiece } from './board.js'
import { squareOf } from './board.js'

/** The caravan side of the fortification/caravan marker. */
export const CARAVAN_ASSET_ID = 'markers/caravan'
/** The fortification side of the fortification/caravan marker. */
export const FORTIFICATION_ASSET_ID = 'markers/fortification'
/** The production a caravan adds to one Build (F&F p. 7). */
export const CARAVAN_PRODUCTION = 2
/** The combat bonus a fortification adds when its city is defended (F&F p. 7). */
export const FORTIFICATION_BONUS = 2

export type DisbandMarkerKind = 'caravan' | 'fortification'

const keyOf = (cell: Cell): string => `${cell.column},${cell.row}`

const isCityMarker = (piece: BoardPiece): boolean =>
  piece.assetId === CARAVAN_ASSET_ID || piece.assetId === FORTIFICATION_ASSET_ID

/** The kind of a figure piece: armies and scouts disband, nothing else does. */
export function figureKindOf(piece: BoardPiece): 'army' | 'scout' | undefined {
  if (piece.category !== 'figure') return undefined
  if (piece.assetId.endsWith('army')) return 'army'
  if (piece.assetId.endsWith('scout')) return 'scout'
  return undefined
}

/** The marker a figure of this kind leaves behind. */
export const disbandMarkerOf = (kind: 'army' | 'scout'): DisbandMarkerKind =>
  kind === 'army' ? 'fortification' : 'caravan'

/**
 * The fortification or caravan marker on a centre square of the city, if there is
 * one. A metropolis has two centre squares and a marker on either counts.
 */
export function cityMarkerOf(board: Board, city: BoardPiece): BoardPiece | undefined {
  const centres = new Set((cityCenterCells(board, city) ?? []).map(keyOf))
  return board.pieces.find((piece) => {
    if (!isCityMarker(piece)) return false
    const cell = mapCellOf(board, piece)
    return cell !== null && centres.has(keyOf(cell))
  })
}

/** The city of this colour with a centre on this square, if any. `colour` is lower case. */
export function cityCentredAt(board: Board, colour: string, cell: Cell): BoardPiece | undefined {
  return board.pieces.find(
    (piece) =>
      piece.category === 'city' &&
      pieceColorOf(piece) === colour &&
      (cityCenterCells(board, piece) ?? []).some((centre) => centre.column === cell.column && centre.row === cell.row),
  )
}

/** What disbanding a figure on a square would do. */
export interface DisbandOffer {
  readonly city: BoardPiece
  /** "Capital D5", for questions and log lines. */
  readonly cityLabel: string
  readonly figureKind: 'army' | 'scout'
  readonly marker: DisbandMarkerKind
  /**
   * The marker already on the city, whichever kind, when there is one: then
   * disbanding only removes the figure.
   */
  readonly existing: BoardPiece | undefined
}

/** "Capital D5": the city's kind and the square of its marker. */
export function cityLabelOf(board: Board, city: BoardPiece): string {
  const kind = city.assetId.includes('metropolis') ? 'Metropolis' : city.assetId.includes('capital') ? 'Capital' : 'City'
  return `${kind} ${squareOf(board, city) ?? ''}`.trim()
}

/**
 * Whether `figure`, standing on `cell`, may be disbanded there by the player of
 * `colour` (lower case): an army or scout on a centre square of one of that
 * player's own cities. `undefined` anywhere else, the outskirts included. Who owns
 * the figure is the caller's check (`figureBelongsTo`).
 */
export function disbandOfferAt(
  board: Board,
  colour: string | null,
  figure: BoardPiece,
  cell: Cell,
): DisbandOffer | undefined {
  if (colour === null) return undefined
  const figureKind = figureKindOf(figure)
  if (figureKind === undefined) return undefined
  const city = cityCentredAt(board, colour.toLowerCase(), cell)
  if (city === undefined) return undefined
  return {
    city,
    cityLabel: cityLabelOf(board, city),
    figureKind,
    marker: disbandMarkerOf(figureKind),
    existing: cityMarkerOf(board, city),
  }
}
