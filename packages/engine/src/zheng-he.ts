/**
 * Zheng He: "You may discard this card to look under every hut and village token on the map and/or
 * owned by other players."
 *
 * The hut and village pieces on the map are anonymous: a player who collects one draws the top item of
 * the deck, whichever piece it was. To make a look worth something the item is fixed to the piece: the
 * first look takes the top hut or village out of the deck and sets it under each piece that has none
 * (`GameState.underTokens`). A shuffle then cannot change what lies there, so nothing the player saw
 * becomes stale. When the piece leaves the map a draw gets its item first, on top of the deck.
 */

import { mapCellOf } from './blockade.js'
import type { BoardPiece } from './board.js'
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

/** The hut and village pieces on a map square, top row first and left to right, so the list reads the same every time. */
export function mapTokensOf(state: GameState): readonly { readonly piece: BoardPiece; readonly cell: Cell; readonly sheet: SheetName }[] {
  const found: { piece: BoardPiece; cell: Cell; sheet: SheetName }[] = []
  for (const piece of state.board.pieces) {
    const sheet = TOKEN_SHEETS.get(piece.assetId)
    const cell = sheet === undefined ? null : mapCellOf(state.board, piece)
    if (sheet !== undefined && cell !== null) found.push({ piece, cell, sheet })
  }
  return found.sort((a, b) => a.cell.row - b.cell.row || a.cell.column - b.cell.column || a.piece.id.localeCompare(b.piece.id))
}

/**
 * Gives the items under the pieces that have left the map (collected into an area, or taken off) back to
 * the deck, on top of their sheet, so the next draw gives what was under the piece. Nothing changes when
 * no look was ever made.
 */
export function releaseLooseTokens(state: GameState): GameState {
  const under = state.underTokens ?? []
  if (under.length === 0) return state
  const onMap = new Set(mapTokensOf(state).map((token) => token.piece.id))
  const loose = under.filter((token) => !onMap.has(token.pieceId))
  if (loose.length === 0) return state
  const items = [...state.items]
  for (const token of loose) {
    const top = items.findIndex((item) => item.sheetName === token.item.sheetName)
    items.splice(top < 0 ? items.length : top, 0, { ...token.item, hidden: true, ownerId: null })
  }
  return { ...state, items, underTokens: under.filter((token) => onMap.has(token.pieceId)) }
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
  for (const { piece, cell, sheet } of mapTokensOf(state)) {
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
