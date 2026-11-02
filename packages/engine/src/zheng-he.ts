/**
 * Zheng He: "You may discard this card to look under every hut and village token on the map and/or
 * owned by other players."
 *
 * The hut and village pieces on the map are anonymous: a player who collects one draws the top item of
 * the deck, whichever piece it was. To make a look worth something the item is fixed to the piece: the
 * first look takes the top hut or village out of the deck and sets it under each piece that has none
 * (`GameState.underTokens`). A shuffle then cannot change what lies there, so nothing the player saw
 * becomes stale. When the piece has left the map, a draw of that sheet gets its item first.
 */

import { mapCellOf } from './blockade.js'
import { areaAt, boardAreas } from './board.js'
import type { Board, BoardArea, BoardPiece } from './board.js'
import { squareLabel } from './build-options.js'
import type { Cell } from './blockade.js'
import { itemName } from './item.js'
import type { HutItem, Item, VillageItem } from './item.js'
import type { SheetName } from './sheet-name.js'
import type { GameState, Playerhand, UnderToken } from './state.js'

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

/** A hut or village piece anywhere on the board, and where it lies. */
export interface BoardToken {
  readonly piece: BoardPiece
  readonly sheet: SheetName
  /** The map square, or `null` for a piece elsewhere (in a player's area). */
  readonly cell: Cell | null
  /** What a button says: the square ("J6"), or the area ("cash1981's area", numbered when it holds several). */
  readonly label: string
  /** What the log says after "the token": "on J6", "in cash1981's area" or "off the map". */
  readonly phrase: string
}

/**
 * Every hut and village piece on the board: the ones on a map square first (top row first, left to right), then the
 * others by area. A piece lies in a player's area when it was collected there.
 */
export function boardTokensOf(board: Board, areas: readonly BoardArea[]): readonly BoardToken[] {
  const onMap = mapTokensOf(board).map((token): BoardToken => ({
    piece: token.piece,
    sheet: token.sheet,
    cell: token.cell,
    label: squareLabel(token.cell),
    phrase: `on ${squareLabel(token.cell)}`,
  }))
  const mapIds = new Set(onMap.map((token) => token.piece.id))
  const elsewhere: BoardToken[] = []
  const counts = new Map<string, number>()
  for (const piece of board.pieces) {
    const sheet = TOKEN_SHEETS.get(piece.assetId)
    if (sheet === undefined || mapIds.has(piece.id)) continue
    const area = areaAt(areas, piece.x + piece.width / 2, piece.y + piece.height / 2)
    const place = area === undefined ? 'off the map' : `${area.username}'s area`
    const number = (counts.get(`${sheet}:${place}`) ?? 0) + 1
    counts.set(`${sheet}:${place}`, number)
    elsewhere.push({ piece, sheet, cell: null, label: place, phrase: area === undefined ? place : `in ${place}` })
  }
  // A place that holds several pieces numbers them, so the buttons can be told apart
  const numbered = elsewhere.map((token) => {
    const total = counts.get(`${token.sheet}:${token.label}`) ?? 1
    if (total === 1) return token
    const position = elsewhere.filter((other) => other.sheet === token.sheet && other.label === token.label).indexOf(token) + 1
    return { ...token, label: `${token.label} (${position})` }
  })
  return [...onMap, ...numbered.sort((a, b) => a.label.localeCompare(b.label) || a.piece.id.localeCompare(b.piece.id))]
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
  const token = boardTokensOf(state.board, boardAreas(state.board, state.players)).find((candidate) => candidate.piece.id === pieceId && candidate.sheet === sheetName)
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
        token = { pieceId: piece.id, item }
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
