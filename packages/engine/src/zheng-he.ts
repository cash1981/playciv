/**
 * Zheng He: "You may discard this card to look under every hut and village token on the map and/or
 * owned by other players."
 *
 * The hut and village pieces on the map are anonymous: a player who collects one draws the top item of
 * the deck, whichever piece it was. To make a look worth something the item is fixed to the piece: the
 * first look takes the top hut or village out of the deck and sets it under each piece that has none
 * (`GameState.underTokens`). A shuffle then cannot change what lies there, so nothing the player saw
 * becomes stale. A draw from the piece gets its item (a piece that is gone from the board gives it to the next draw of its sheet).
 */

import { mapCellOf } from './blockade.js'
import { WONDERS_AREA_ID, areaAt, boardAreas } from './board.js'
import type { Board, BoardArea, BoardPiece } from './board.js'
import { squareLabel } from './build-options.js'
import type { Cell } from './blockade.js'
import { itemName } from './item.js'
import type { HutItem, Item, VillageItem } from './item.js'
import type { SheetName } from './sheet-name.js'
import type { DrawTokenView, GameState, Playerhand, UnderToken } from './state.js'

export const ZHENG_HE_NAME = 'Zheng He'

/** The deck each token piece is drawn from. */
const TOKEN_SHEETS: ReadonlyMap<string, SheetName> = new Map<string, SheetName>([
  ['resources/hut', 'HUTS'],
  ['resources/village', 'VILLAGES'],
])

export const TOKEN_SHEET_NAMES: readonly SheetName[] = ['HUTS', 'VILLAGES']

const isTokenItem = (item: Item): item is HutItem | VillageItem => item.kind === 'hut' || item.kind === 'village'

const kindWord = (sheet: SheetName | undefined): string => (sheet === 'VILLAGES' ? 'village' : 'hut')

/** A hut or village piece on a map square. */
export interface MapToken {
  readonly piece: BoardPiece
  readonly cell: Cell
  readonly sheet: SheetName
}

/** The hut and village pieces on a map square, top row first and left to right, so the list reads the same every time. */
export function mapTokensOf(board: Board): readonly MapToken[] {
  const found: MapToken[] = []
  for (const piece of board.pieces) {
    const sheet = TOKEN_SHEETS.get(piece.assetId)
    const cell = sheet === undefined ? null : mapCellOf(board, piece)
    if (sheet !== undefined && cell !== null) found.push({ piece, cell, sheet })
  }
  return found.sort((a, b) => a.cell.row - b.cell.row || a.cell.column - b.cell.column || a.piece.id.localeCompare(b.piece.id))
}

/** A hut or village piece a draw can be made from, and where it lies. */
export interface BoardToken {
  readonly piece: BoardPiece
  readonly sheet: SheetName
  /** What a button says: the square ("J6"), or "C2 (in cash1981's area)" for a piece read on C2 and moved. */
  readonly label: string
  /** What the log says after "the token": "on J6", "in cash1981's area" or "off the map". */
  readonly phrase: string
}

/**
 * The pieces a draw of huts or villages can be made from: every one on a map square (top row first, left to right),
 * then those moved away that still have an item under them, which are the ones Zheng He's look read. A moved piece
 * with nothing under it is the same as a random draw, so it is left out; that also leaves out a piece already drawn
 * from, and the squares the others were read on tell the rest apart.
 */
export function boardTokensOf(board: Board, areas: readonly BoardArea[], under: readonly UnderToken[]): readonly BoardToken[] {
  const onMap = mapTokensOf(board).map((token): BoardToken => ({
    piece: token.piece,
    sheet: token.sheet,
    label: squareLabel(token.cell),
    phrase: `on ${squareLabel(token.cell)}`,
  }))
  const mapIds = new Set(onMap.map((token) => token.piece.id))
  const moved: BoardToken[] = []
  for (const token of under) {
    const piece = board.pieces.find((candidate) => candidate.id === token.pieceId)
    const sheet = piece === undefined ? undefined : TOKEN_SHEETS.get(piece.assetId)
    if (piece === undefined || sheet === undefined || mapIds.has(piece.id)) continue
    const area = areaAt(areas, piece.x + piece.width / 2, piece.y + piece.height / 2)
    const place = area === undefined ? 'off the map' : area.playerId === WONDERS_AREA_ID ? 'the Wonders area' : `${area.username}'s area`
    moved.push({
      piece,
      sheet,
      label: `${token.square ?? 'A token'} (${area === undefined ? place : `in ${place}`})`,
      phrase: area === undefined ? place : `in ${place}`,
    })
  }
  return [...onMap, ...moved.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))]
}

/** The tokens of the view: what the Draw panel offers. */
export function drawTokensOf(state: GameState): readonly DrawTokenView[] {
  return boardTokensOf(state.board, boardAreas(state.board, state.players), state.underTokens ?? []).map((token) => ({
    pieceId: token.piece.id,
    sheet: token.sheet,
    label: token.label,
  }))
}

/**
 * The next draw of `sheetName` when an item lies under a piece that is no longer on the board at all: that one item
 * goes on top of its sheet, so the draw gives what was under the piece. Every other item stays under its piece, out
 * of the reach of a shuffle and of a later board undo that puts its piece back. Nothing changes when no look was
 * ever made.
 */
export function releaseLooseToken(state: GameState, sheetName: SheetName): GameState {
  const under = state.underTokens ?? []
  if (under.length === 0) return state
  const onBoard = new Set(state.board.pieces.filter((piece) => TOKEN_SHEETS.has(piece.assetId)).map((piece) => piece.id))
  const loose = under.find((token) => token.item.sheetName === sheetName && !onBoard.has(token.pieceId))
  if (loose === undefined) return state
  const top = state.items.findIndex((item) => item.sheetName === sheetName)
  const items = [...state.items]
  items.splice(top < 0 ? items.length : top, 0, { ...loose.item, hidden: true, ownerId: null })
  return { ...state, items, underTokens: under.filter((token) => token !== loose) }
}

/**
 * A draw from the token on `pieceId`: the item under it goes on top of its sheet, so the draw gives it, and the
 * piece stays where it is. A token nobody has looked under gives the top card as an anonymous draw does.
 * `undefined` when the piece is not a hut or village of `sheetName` on the board.
 */
export function releaseTokenOf(state: GameState, pieceId: string, sheetName: SheetName): { readonly state: GameState; readonly phrase: string } | undefined {
  const token = boardTokensOf(state.board, boardAreas(state.board, state.players), state.underTokens ?? []).find((candidate) => candidate.piece.id === pieceId && candidate.sheet === sheetName)
  if (token === undefined) return undefined
  const under = state.underTokens ?? []
  const bound = under.find((candidate) => candidate.pieceId === pieceId)
  if (bound === undefined) return { state, phrase: token.phrase }
  const top = state.items.findIndex((item) => item.sheetName === sheetName)
  const items = [...state.items]
  items.splice(top < 0 ? items.length : top, 0, { ...bound.item, hidden: true, ownerId: null })
  return { state: { ...state, items, underTokens: under.filter((candidate) => candidate !== bound) }, phrase: token.phrase }
}

export interface TokenLook {
  readonly state: GameState
  /** The identities this look created, for the undo. */
  readonly bound: readonly UnderToken[]
  /** One private line for each token on the map and each token another player holds. */
  readonly lines: readonly string[]
}

const holderLines = (others: readonly Playerhand[]): string[] =>
  others.flatMap((other) =>
    other.items
      .filter(isTokenItem)
      .map((item) => `${ZHENG_HE_NAME}: ${other.username} holds the ${kindWord(item.sheetName)} ${itemName(item)}`),
  )

/** Looks under every token on the map and in the other players' hands, fixing the ones on the map. */
export function lookUnderTokens(state: GameState, others: readonly Playerhand[]): TokenLook {
  let items = state.items
  const under = [...(state.underTokens ?? [])]
  const bound: UnderToken[] = []
  const lines: string[] = []
  for (const { piece, cell, sheet } of mapTokensOf(state.board)) {
    let token = under.find((candidate) => candidate.pieceId === piece.id)
    if (token === undefined) {
      const index = items.findIndex((item) => item.sheetName === sheet)
      const item = items[index]
      if (item !== undefined && isTokenItem(item)) {
        token = { pieceId: piece.id, item, square: squareLabel(cell) }
        items = items.filter((_, position) => position !== index)
        under.push(token)
        bound.push(token)
      }
    }
    lines.push(
      token === undefined
        ? `${ZHENG_HE_NAME}: the ${kindWord(sheet)} on ${squareLabel(cell)} cannot be read, no ${kindWord(sheet)}s are left in the deck`
        : `${ZHENG_HE_NAME}: the ${kindWord(sheet)} on ${squareLabel(cell)} is ${itemName(token.item)}`,
    )
  }
  lines.push(...holderLines(others))
  if (lines.length === 0) lines.push(`${ZHENG_HE_NAME}: there is no hut or village on the map or in another player's hand`)
  return { state: { ...state, items, underTokens: under }, bound, lines }
}

/** The undo: what the look still holds under a piece goes back into the deck, to be shuffled by the caller. */
export function putBackTokens(state: GameState, bound: readonly UnderToken[]): GameState {
  const back = (state.underTokens ?? []).filter((token) => bound.some((own) => own.pieceId === token.pieceId && own.item.id === token.item.id))
  if (back.length === 0) return state
  return {
    ...state,
    items: [...state.items, ...back.map((token) => ({ ...token.item, hidden: true, ownerId: null }))],
    underTokens: (state.underTokens ?? []).filter((token) => !back.includes(token)),
  }
}
