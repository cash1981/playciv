/**
 * Fills in fields added to saved games after they were created.
 *
 * Java solved this by letting Jackson ignore unknown fields and leaving new
 * ones as `null`, which failed quietly later on. Here they are filled in
 * explicitly, and every storage implementation calls this when it reads a game.
 */

import type { ArenaUnit, Battle } from './battle.js'
import type { Board, BoardHistoryEntry, BoardPiece } from './board.js'
import { createBoard } from './board.js'
import type { GameState, Playerhand, PlayerStats } from './state.js'
import { DEFAULT_PLAYER_STATS } from './state.js'
import { DEFAULT_GOVERNMENT } from './government.js'
import { migratePlayerTurn } from './turn.js'

/** Everything that did not exist in some earlier version of `GameState`. */
type MaybeOlder = Omit<
  GameState,
  'board' | 'withdrawnPlayers' | 'publicTurns' | 'wondersDealt' | 'battle' | 'rev' | 'createdAt'
> &
  Partial<
    Pick<
      GameState,
      'board' | 'withdrawnPlayers' | 'publicTurns' | 'wondersDealt' | 'battle' | 'rev' | 'createdAt'
    >
  >

/** A hand from before the status board or governments (issue #43) existed. */
type MaybeOlderPlayerhand = Omit<Playerhand, 'stats' | 'government'> &
  Partial<Pick<Playerhand, 'stats' | 'government'>>

/**
 * Fills in the status board and, since issue #102, normalises Movement to its
 * string form: a game saved before then stored it as a number.
 */
const normalizeStats = (stats: Partial<PlayerStats> | undefined): PlayerStats => {
  const merged = { ...DEFAULT_PLAYER_STATS, ...stats }
  return { ...merged, mvmt: String(merged.mvmt) }
}

const withPlayerDefaults = (player: MaybeOlderPlayerhand): Playerhand => ({
  ...player,
  playerTurns: player.playerTurns.map(migratePlayerTurn),
  stats: normalizeStats(player.stats),
  government: player.government ?? DEFAULT_GOVERNMENT,
})

/** A board from before the player areas and the history existed. */
type MaybeOlderBoard = Omit<Board, 'areaRows' | 'history'> &
  Partial<Pick<Board, 'areaRows' | 'history'>>

/** An arena unit from before rotation or the undoable kill (issue #71) existed. */
type MaybeOlderArenaUnit = Omit<ArenaUnit, 'rotation' | 'killed'> &
  Partial<Pick<ArenaUnit, 'rotation' | 'killed'>>

/** A battle from before reinforcement tracked what it displaced (issue #75). */
type MaybeOlderBattle = Omit<Battle, 'departedUnits'> & Partial<Pick<Battle, 'departedUnits'>>

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
  const battle = older.battle as MaybeOlderBattle | null | undefined

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
    createdAt: older.createdAt ?? null,
    log: state.log.map((entry) => ({ ...entry, createdAt: entry.createdAt ?? null })),
    players: state.players.map(withPlayerDefaults),
    board:
      board === undefined
        ? fresh
        : {
            ...board,
            areaRows: board.areaRows ?? fresh.areaRows,
            history: board.history ?? historyForImportedPieces(board.pieces),
          },
    withdrawnPlayers: (older.withdrawnPlayers ?? []).map(withPlayerDefaults),
    publicTurns: Object.fromEntries(
      Object.entries(older.publicTurns ?? {}).map(([key, turn]) => [key, migratePlayerTurn(turn)]),
    ),
    wondersDealt: older.wondersDealt ?? (hasWonder || setupComplete),
    battle:
      battle === null || battle === undefined
        ? null
        : {
            ...battle,
            arena: battle.arena.map(
              (unit: MaybeOlderArenaUnit): ArenaUnit => ({
                ...unit,
                rotation: unit.rotation ?? 0,
                killed: unit.killed ?? false,
              }),
            ),
            departedUnits: battle.departedUnits ?? [],
          },
    rev: older.rev ?? 0,
  }
}
