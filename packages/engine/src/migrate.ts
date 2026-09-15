/**
 * Fills in fields added to saved games after they were created.
 *
 * Java solved this by letting Jackson ignore unknown fields and leaving new
 * ones as `null`, which failed quietly later on. Here they are filled in
 * explicitly, and every storage implementation calls this when it reads a game.
 */

import type { Board, BoardHistoryEntry, BoardPiece } from './board.js'
import { createBoard } from './board.js'
import type { GameState } from './state.js'

/** Everything that did not exist in some earlier version of `GameState`. */
type MaybeOlder = Omit<GameState, 'board' | 'withdrawnPlayers' | 'publicTurns'> &
  Partial<Pick<GameState, 'board' | 'withdrawnPlayers' | 'publicTurns'>>

/** A board from before the player areas and the history existed. */
type MaybeOlderBoard = Omit<Board, 'areaRows' | 'history'> &
  Partial<Pick<Board, 'areaRows' | 'history'>>

/**
 * Turns pieces that predate the history into one entry each.
 *
 * Without this, stepping back through a game saved before the history existed
 * would make those pieces vanish, because replay rebuilds from an empty board.
 * The ids are derived from the piece ids so the result is stable across reads.
 */
function historyForImportedPieces(
  pieces: readonly BoardPiece[],
): readonly BoardHistoryEntry[] {
  return pieces.map((piece) => ({
    id: `imported-${piece.id}`,
    at: null,
    playerId: piece.placedBy ?? '',
    username: 'System',
    description: `System imported ${piece.label} from before the history was kept`,
    change: {
      kind: 'place' as const,
      piece,
      // Keep map tiles at the bottom, as placing them would
      onTop: piece.category !== 'tile' && piece.category !== 'civtile',
    },
    logLength: 0,
  }))
}

export function migrateGameState(state: GameState): GameState {
  const older = state as MaybeOlder
  const fresh = createBoard()
  const board = older.board as MaybeOlderBoard | undefined

  return {
    ...state,
    board:
      board === undefined
        ? fresh
        : {
            ...board,
            areaRows: board.areaRows ?? fresh.areaRows,
            history: board.history ?? historyForImportedPieces(board.pieces),
          },
    withdrawnPlayers: older.withdrawnPlayers ?? [],
    publicTurns: older.publicTurns ?? {},
  }
}
