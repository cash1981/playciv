/**
 * The coin token piece (`markers/coin1`) and the Sheet coin counter. A coin marker put in a
 * player's area adds 1 to that player's Sheet counter; taking it out of the area (removing it,
 * or moving it out) takes 1 off; moving it between two players' areas moves the coin between
 * their Sheets. Moving it inside one area changes nothing.
 *
 * The change is worked out from the board change itself and written on its history entry
 * (`BoardHistoryEntry.sheet`, what was really applied: the counter never goes below 0), so a
 * board Undo and Redo give back or take again exactly that, and the counter does not drift.
 * Coin pieces that already sat in an area before this existed are not counted.
 */

import { areaAt, boardAreas } from './board.js'
import type { BoardChange, BoardPiece } from './board.js'
import { withCoinSource } from './coins.js'
import type { GameState } from './state.js'
import { withPlayer } from './state.js'

export const COIN_MARKER_ASSET_ID = 'markers/coin1'

/** The Sheet coins a board change added to (positive) or took from (negative) a player. */
export interface SheetChange {
  readonly playerId: string
  readonly delta: number
}

/** The player whose area holds the piece's centre when its top left corner is (x, y), if any. */
export function areaOwnerAt(state: GameState, piece: BoardPiece, x: number, y: number): string | undefined {
  const areas = boardAreas(state.board, state.players)
  const area = areaAt(areas, x + piece.width / 2, y + piece.height / 2)
  return area !== undefined && state.players.some((player) => player.playerId === area.playerId) ? area.playerId : undefined
}

const isCoin = (piece: BoardPiece): boolean => piece.assetId === COIN_MARKER_ASSET_ID

/** What a change does to the Sheets, before it is applied; `state` is the game before the change. */
export function sheetChangesOf(state: GameState, change: BoardChange): readonly SheetChange[] {
  const gains = (piece: BoardPiece, x: number, y: number, delta: number): readonly SheetChange[] => {
    const owner = areaOwnerAt(state, piece, x, y)
    return owner === undefined ? [] : [{ playerId: owner, delta }]
  }
  switch (change.kind) {
    case 'place':
      return isCoin(change.piece) ? gains(change.piece, change.piece.x, change.piece.y, 1) : []
    case 'remove':
      return isCoin(change.piece) ? gains(change.piece, change.piece.x, change.piece.y, -1) : []
    case 'move': {
      const piece = state.board.pieces.find((candidate) => candidate.id === change.pieceId)
      if (piece === undefined || !isCoin(piece)) return []
      const from = areaOwnerAt(state, piece, change.from.x, change.from.y)
      const to = areaOwnerAt(state, piece, change.to.x, change.to.y)
      if (from === to) return []
      return [
        ...(from === undefined ? [] : [{ playerId: from, delta: -1 }]),
        ...(to === undefined ? [] : [{ playerId: to, delta: 1 }]),
      ]
    }
    default:
      return []
  }
}

/** The Sheets after the changes, never below 0, with what each really changed by. */
export function withSheetChanges(
  state: GameState,
  changes: readonly SheetChange[],
): { readonly state: GameState; readonly applied: readonly SheetChange[] } {
  let working = state
  const applied: SheetChange[] = []
  for (const change of changes) {
    const holder = working.players.find((player) => player.playerId === change.playerId)
    if (holder === undefined) continue
    const sheet = holder.stats.coinSources.sheet
    const next = Math.max(0, sheet + change.delta)
    if (next === sheet) continue
    working = withPlayer(working, {
      ...holder,
      stats: { ...holder.stats, coinSources: withCoinSource(holder.stats.coinSources, 'sheet', next) },
    })
    applied.push({ playerId: change.playerId, delta: next - sheet })
  }
  return { state: working, applied }
}

/** A board Undo (`direction` -1) or Redo (1) of an entry: gives back or takes again what it applied. */
export function replaySheet(state: GameState, sheet: readonly SheetChange[] | undefined, direction: 1 | -1): GameState {
  if (sheet === undefined || sheet.length === 0) return state
  return withSheetChanges(state, sheet.map((change) => ({ playerId: change.playerId, delta: change.delta * direction }))).state
}
