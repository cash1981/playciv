/**
 * Fills in fields added to saved games after they were created.
 *
 * Java solved this by letting Jackson ignore unknown fields and leaving new
 * ones as `null`, which failed quietly later on. Here they are filled in
 * explicitly, and every storage implementation calls this when it reads a game.
 */

import type { Board, BoardHistoryEntry, BoardPiece } from './board.js'
import { createBoard } from './board.js'
import type { GameState, Playerhand } from './state.js'
import { DEFAULT_PLAYER_STATS } from './state.js'

/** Everything that did not exist in some earlier version of `GameState`. */
type MaybeOlder = Omit<
  GameState,
  'board' | 'withdrawnPlayers' | 'publicTurns' | 'wondersDealt' | 'battle' | 'rev'
> &
  Partial<Pick<GameState, 'board' | 'withdrawnPlayers' | 'publicTurns' | 'wondersDealt' | 'battle' | 'rev'>>

/** A hand from before the status board (issue #43) existed. */
type MaybeOlderPlayerhand = Omit<Playerhand, 'stats'> & Partial<Pick<Playerhand, 'stats'>>

const withStats = (player: MaybeOlderPlayerhand): Playerhand => ({
  ...player,
  stats: { ...DEFAULT_PLAYER_STATS, ...player.stats },
})

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

  // A game saved before `wondersDealt` existed is treated as having dealt if the
  // setup is complete or a wonder already exists anywhere (an old game put drawn
  // wonders in a hand). That way the deal never re-fires on a game past setup,
  // while a game still choosing civs will deal correctly when the last is chosen.
  const hasWonder =
    state.players.some((player) => player.items.some((item) => item.kind === 'wonder')) ||
    state.discardedItems.some((item) => item.kind === 'wonder') ||
    (board?.pieces ?? []).some((piece) => piece.category === 'wonder')
  const setupComplete =
    state.players.length > 0 &&
    state.numOfPlayers === state.players.length &&
    state.players.every((player) => player.civilization !== null)

  return {
    ...state,
    log: state.log.map((entry) => ({ ...entry, createdAt: entry.createdAt ?? null })),
    players: state.players.map(withStats),
    board:
      board === undefined
        ? fresh
        : {
            ...board,
            areaRows: board.areaRows ?? fresh.areaRows,
            history: board.history ?? historyForImportedPieces(board.pieces),
          },
    withdrawnPlayers: (older.withdrawnPlayers ?? []).map(withStats),
    publicTurns: older.publicTurns ?? {},
    wondersDealt: older.wondersDealt ?? (hasWonder || setupComplete),
    battle:
      older.battle === null || older.battle === undefined
        ? null
        : {
            ...older.battle,
            arena: older.battle.arena.map((unit) => ({ ...unit, rotation: unit.rotation ?? 0 })),
          },
    rev: older.rev ?? 0,
  }
}
