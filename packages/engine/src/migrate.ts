/**
 * Fills in fields added to saved games after they were created.
 *
 * Java solved this by letting Jackson ignore unknown fields and leaving new
 * ones as `null`, which failed quietly later on. Here they are filled in
 * explicitly, and every storage implementation calls this when it reads a game.
 */

import type { ArenaUnit, Battle } from './battle.js'
import type { Board, BoardHistoryEntry, BoardPiece } from './board.js'
import { createBoard, createBoardForPlayers } from './board.js'
import { EMPTY_COIN_SOURCES } from './coins.js'
import type { SocialPolicyItem } from './item.js'
import type { GameState, Playerhand, PlayerStats } from './state.js'
import { DEFAULT_PLAYER_STATS } from './state.js'
import { DEFAULT_GOVERNMENT } from './government.js'
import type { PlayerTurn } from './turn.js'
import { TURN_PHASES, migratePlayerTurn, startPlayerOf } from './turn.js'

/**
 * Issue #175: a game saved before `gamedata.ts` started correcting the
 * `Military Tradition` / `Pacifism` flipside pair still carries the old,
 * one-way value in its own `socialPolicies` — the game's catalogue and any
 * player's already-chosen copy both freeze whatever `readGameData` returned
 * when the card was dealt. Corrected here too, so an existing game does not
 * need a fresh deal to stop reproducing the bug. See decisions.md,
 * 2026-09-25.
 */
const correctSocialPolicyFlipsides = (
  policies: readonly SocialPolicyItem[],
): readonly SocialPolicyItem[] =>
  policies.map((policy) =>
    policy.name === 'Military Tradition' && policy.flipside === 'Patronage'
      ? { ...policy, flipside: 'Pacifism' }
      : policy,
  )

/** Everything that did not exist in some earlier version of `GameState`. */
type MaybeOlder = Omit<
  GameState,
  'board' | 'withdrawnPlayers' | 'publicTurns' | 'wondersDealt' | 'battle' | 'rev' | 'createdAt' | 'logSecret' | 'chatOrdersStartTurn' | 'startPlayerId' | 'turnStarters' | 'legacyOrdersCopied' | 'legacyRevealsCopied' | 'assistedActions'
> & {
    /** The switch that used to choose between the old baton view and chat orders. Gone from `GameState`. */
    readonly chatOrders?: boolean
  } &
  Partial<
    Pick<
      GameState,
      | 'board'
      | 'withdrawnPlayers'
      | 'publicTurns'
      | 'wondersDealt'
      | 'battle'
      | 'rev'
      | 'createdAt'
      | 'chatOrdersStartTurn'
      | 'startPlayerId'
      | 'legacyOrdersCopied'
      | 'legacyRevealsCopied'
      | 'turnStarters'
      | 'logSecret'
      | 'assistedActions'
    >
  >

/** A hand from before the status board, governments (issue #43), the tech
 *  pyramid placements, or its own `socialPolicies` array existed. */
type MaybeOlderPlayerhand = Omit<
  Playerhand,
  'stats' | 'government' | 'pyramidPlacements' | 'socialPolicies'
> &
  Partial<Pick<Playerhand, 'stats' | 'government' | 'pyramidPlacements' | 'socialPolicies'>>

/**
 * Fills in the status board and, since issue #102, normalises Movement to its
 * string form.
 *
 * A game saved before the coin sources existed has a single `coins` number.
 * The human chose that the new model replaces it rather than carrying it into a
 * source, so it is dropped and every counter starts at zero. The fields are
 * listed one by one on purpose: the legacy `coins` property cannot survive the
 * spread, and a field added to `PlayerStats` later is a compile error here
 * until its migration is decided.
 */
const normalizeStats = (stats: Partial<PlayerStats> | undefined): PlayerStats => {
  const merged = { ...DEFAULT_PLAYER_STATS, ...stats }
  // `handSize` was a number before it became the free-text Combat hand size.
  const legacyHandSize = (stats as { readonly handSize?: unknown } | undefined)?.handSize
  return {
    coinSources: { ...EMPTY_COIN_SOURCES, ...merged.coinSources },
    trade: merged.trade,
    culture: merged.culture,
    cultureHandSize: merged.cultureHandSize,
    infantry: merged.infantry,
    artillery: merged.artillery,
    mounted: merged.mounted,
    stacking: merged.stacking,
    // `?? default` guards a hand-edited or older save that stored neither.
    mvmt: String(merged.mvmt ?? DEFAULT_PLAYER_STATS.mvmt),
    combat: merged.combat,
    combatHandSize: String(
      stats?.combatHandSize ?? (typeof legacyHandSize === 'number' && legacyHandSize !== 0 ? legacyHandSize : ''),
    ),
    efta: merged.efta,
    infra: merged.infra,
    mic: merged.mic,
    pe: merged.pe,
  }
}

const withPlayerDefaults = (player: MaybeOlderPlayerhand): Playerhand => ({
  ...player,
  playerTurns: player.playerTurns.map(migratePlayerTurn),
  stats: normalizeStats(player.stats),
  government: player.government ?? DEFAULT_GOVERNMENT,
  pyramidPlacements: player.pyramidPlacements ?? [],
  socialPolicies: correctSocialPolicyFlipsides(player.socialPolicies ?? []),
})

/** A board from before the player areas, history, redo stack or shapes existed. */
type MaybeOlderBoard = Omit<
  Board,
  'areaRows' | 'history' | 'redo' | 'slots' | 'slotStep' | 'startSlots'
> &
  Partial<
    Pick<Board, 'areaRows' | 'history' | 'redo' | 'slots' | 'slotStep' | 'startSlots'>
  >

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

/**
 * The turn the old baton view says a game is on: the turn of whoever holds the
 * baton, moved on by one when that player has revealed every phase. A flag
 * missing from an old `revealed` map blocks nothing, only an explicit `false`.
 */
function batonTurn(players: readonly Playerhand[]): number {
  const current = players.find((player) => player.yourTurn)
  if (current === undefined) return 1
  const latest = current.playerTurns.reduce<PlayerTurn | undefined>(
    (best, turn) => (best === undefined || turn.turnNumber > best.turnNumber ? turn : best),
    undefined,
  )
  if (latest === undefined) return 1
  const roundDone = TURN_PHASES.every((phase) => latest.revealed[phase] !== false)
  return roundDone ? latest.turnNumber + 1 : latest.turnNumber
}

/**
 * The turn a game has reached, read from the whole table rather than from the
 * baton holder alone. The baton only looks at whoever holds it, and a holder who
 * never wrote turn orders would report turn 1 in a game that is on turn 20. So:
 * the larger of the baton turn and the highest turn anyone has a record for,
 * moved on by one when everybody who has a record for that turn has finished all
 * its phases. Overshooting only marks old turns finished, which is what a
 * baseline is for; undershooting would pin the game to an old turn.
 */
function playedTurn(players: readonly Playerhand[]): number {
  const baton = batonTurn(players)
  const recorded = players.flatMap((player) => player.playerTurns)
  const highest = recorded.reduce((best, turn) => Math.max(best, turn.turnNumber), 0)
  if (highest === 0) return baton
  const atHighest = recorded.filter((turn) => turn.turnNumber === highest)
  const finished = atHighest.every((turn) => TURN_PHASES.every((phase) => turn.revealed[phase] !== false))
  return Math.max(baton, finished ? highest + 1 : highest)
}

export function migrateGameState(state: GameState): GameState {
  const { chatOrders, ...older } = state as MaybeOlder
  const board = older.board as MaybeOlderBoard | undefined
  const battle = older.battle as MaybeOlderBattle | null | undefined
  // A board saved before the shapes existed is a plain rectangle of its own
  // size; filling in the shape is a no-op for it. Games saved with a stepped
  // board carry their shape already, so nothing is ever re-seated.
  const fresh =
    board === undefined ? createBoard() : createBoard(board.columns, board.rows)

  // A save missing its shape gets the shape its player count would build
  // fresh today (issue #171), but only when both of these hold: it is the
  // same size board it already has, and it has no pieces on it yet. A
  // 3-player board is 16 x 16 either way, so size lets this rescue a save
  // from before the three-player pyramid existed; a 5-player board is not
  // (28 x 18 now, 16 x 16 before), and resizing an existing board would shift
  // `mapTop` and therefore every already-placed piece, so an old five-player
  // save keeps the plain rectangle's corners, wrap-around and all. The empty
  // check matters even at the same size: an in-progress three-player save
  // already has exploration tiles snapped to the rectangle's slots, and the
  // pyramid's are in different places (and a finer step), so re-seating it
  // under those tiles would manufacture new overlaps rather than remove the
  // one this issue reported.
  const shaped = createBoardForPlayers(state.numOfPlayers)
  const shapeSource =
    board !== undefined &&
    board.columns === shaped.columns &&
    board.rows === shaped.rows &&
    board.pieces.length === 0
      ? shaped
      : fresh

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

  // Panama coins were historically stored on each player's status board. The
  // tokens physically belong to the wonder, so copy the current owner's value
  // once when an older save first gains wonder-scoped storage.
  const migratedPlayers = older.players.map(withPlayerDefaults)
  const legacyPanamaOwner = (board?.pieces ?? []).find(
    (piece) => piece.category === 'wonder' && piece.assetId === 'wonders/panamacanal' && piece.ownerId != null,
  )?.ownerId
  const legacyPanamaCoins = migratedPlayers.find((player) => player.playerId === legacyPanamaOwner)
    ?.stats.coinSources.panamaCanal ?? 0
  const hasWonderScopedPanamaCoins = (board?.pieces ?? []).some(
    (piece) => piece.category === 'wonder' && piece.assetId === 'wonders/panamacanal' && piece.coinTokens !== undefined,
  )
  let copiedLegacyPanamaCoins = false
  const boardPieces = (board?.pieces ?? []).map((piece): BoardPiece => {
    if (
      piece.category !== 'wonder' ||
      piece.assetId !== 'wonders/panamacanal' ||
      piece.coinTokens !== undefined
    ) return piece
    if (
      hasWonderScopedPanamaCoins ||
      piece.ownerId !== legacyPanamaOwner ||
      copiedLegacyPanamaCoins
    ) {
      return { ...piece, coinTokens: 0 }
    }
    copiedLegacyPanamaCoins = true
    return { ...piece, coinTokens: legacyPanamaCoins }
  })

  const migrated: GameState = {
    ...older,
    createdAt: older.createdAt ?? null,
    // A game saved before the public item numbers were keyed has no key yet. It
    // is left empty, and the server puts a random one in before the next action
    // (`applyToGame`). Nothing in the game state is safe to derive it from: the
    // rng stream is published through log and item ids.
    logSecret: older.logSecret ?? '',
    assistedActions: older.assistedActions ?? [],
    log: older.log.map((entry) => ({ ...entry, createdAt: entry.createdAt ?? null })),
    players: migratedPlayers,
    board:
      board === undefined
        ? fresh
        : {
            ...board,
            pieces: boardPieces,
            areaRows: board.areaRows ?? fresh.areaRows,
            slots: board.slots ?? shapeSource.slots,
            slotStep: board.slotStep ?? shapeSource.slotStep,
            startSlots: board.startSlots ?? shapeSource.startSlots,
            history: board.history ?? historyForImportedPieces(board.pieces),
            redo: board.redo ?? [],
          },
    socialPolicies: correctSocialPolicyFlipsides(older.socialPolicies),
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
    chatOrdersStartTurn: older.chatOrdersStartTurn ?? 1,
    startPlayerId: older.startPlayerId ?? null,
    // A game that was already in chat mode has its orders in the timeline, and
    // copying the old ones later would duplicate those posted there. A save
    // without the flag from before chat orders existed has not been copied.
    legacyOrdersCopied: older.legacyOrdersCopied ?? chatOrders === true,
    // Not known to be copied until the server's migration has checked the game
    legacyRevealsCopied: older.legacyRevealsCopied ?? false,
    turnStarters: older.turnStarters ?? {},
  }
  // The old baton view is gone, and every game is a chat game. Adopt one that was
  // saved with the switch off, or from before it existed (neither it nor the
  // baseline is there). A state saved by this code has the baseline and no
  // switch, so it is left alone, and so is a second load of an adopted one.
  const classic = chatOrders === false || (chatOrders === undefined && older.chatOrdersStartTurn === undefined)
  return classic ? adoptClassicGame(migrated) : migrated
}

/**
 * What switching chat orders on used to do to the state, minus the board marker
 * and the log line: the baseline moves up to the turn the game has reached (never
 * down), and the start player and the starter of that turn are recorded. The
 * start player comes from the marker when the board has one and from
 * `startPlayerId` or seat 1 when it has not (`startPlayerOf`); no marker is
 * placed, because a load must not write to the board, and the next turn's
 * rotation places one.
 */
function adoptClassicGame(state: GameState): GameState {
  const chatOrdersStartTurn = Math.max(state.chatOrdersStartTurn, playedTurn(state.players))
  const starter = startPlayerOf(state)
  return {
    ...state,
    chatOrdersStartTurn,
    startPlayerId: starter?.playerId ?? state.startPlayerId,
    turnStarters:
      starter === undefined || state.turnStarters[chatOrdersStartTurn] !== undefined
        ? state.turnStarters
        : { ...state.turnStarters, [chatOrdersStartTurn]: starter.username },
  }
}
