/**
 * Port of `PBF` and `Playerhand`.
 *
 * PBF stood for "play by forum" and was the Mongo document for a game. The
 * `mapLink` and `assetLink` fields are deliberately left out — they pointed at
 * a Google Presentation and a Google Spreadsheet in an iframe, and are going
 * away.
 */

import type { Item, SocialPolicyItem, TechItem, UnitItem, CivItem, PyramidPlacement } from './item.js'
import { isUnit } from './item.js'
import type { Rng } from './random.js'
import type { Board, BoardArea, BoardPiece } from './board.js'
import { boardAreas } from './board.js'
import { blockadedGreatPersonTypes, blockadedPieceIds, pieceColorOf } from './blockade.js'
import { combatBonusOf } from './combat-bonus.js'
import type { CityProduction } from './city-production.js'
import { cityProductionsOf } from './city-production.js'
import type { CityBuildOptions, PlacedBuildItem, UnitBuildItem } from './build-options.js'
import { buildOptionsOf } from './build-options.js'
import { BASE_CULTURE_HAND_SIZE, cultureHandSizeOf } from './culture-hand.js'
import type { CoinSources } from './coins.js'
import { EMPTY_COIN_SOURCES, coinSourcesOf } from './coins.js'
import type { PlayerTurn, TurnPhase } from './turn.js'
import type { WaitingFor } from './turn.js'
import {
  gameHasStarted,
  startPlayerName,
  turnHolder,
  turnStatus,
} from './turn.js'
import type { Undo } from './undo.js'
import type { Battle, BattleSideSummary } from './battle.js'
import type { Government } from './government.js'
import { availableActionsFor, livePendingRewards, publicAssistedActions } from './assisted.js'
import { cultureMarkerOf } from './culture-track.js'
import type { CultureLevel, CultureSpaceKind } from './culture-track.js'
import type { SheetName } from './sheet-name.js'

export type GameType = 'WAW'

/** Java: `Playerhand.green()` and friends. */
export const PLAYER_COLORS = ['Green', 'Yellow', 'Purple', 'Red', 'Blue'] as const
export type PlayerColor = (typeof PLAYER_COLORS)[number]

/**
 * The per-player status board, replacing a manual spreadsheet the players used
 * to keep alongside the game. Public — every member of the game may see and
 * edit every player's numbers, as at a physical table.
 */
export interface PlayerStats {
  /**
   * One coin counter per source, replacing the old status board's single
   * `coins` number. See {@link CoinSources} for the sources and their limits.
   * Bank, Adam Smith and Great People entries are derived from board/card
   * eligibility by `coinSourcesOf`; a legacy Bank value is retained as a floor
   * so an existing save does not silently lose coins.
   */
  readonly coinSources: CoinSources
  readonly trade: number
  readonly culture: number
  /**
   * Ignored on read: the projections replace it with `cultureHandSizeOf`, which
   * counts revealed cards only.
   */
  readonly cultureHandSize: number
  readonly infantry: number
  readonly artillery: number
  readonly mounted: number
  readonly stacking: number
  /**
   * Movement is the one status value the players write as an expression:
   * natural religion adds one movement to an army figure, written `3+1`. It is
   * stored exactly as typed and, like the rest of the board, is never used in a
   * calculation. See {@link isMovementValue} for what is allowed.
   */
  readonly mvmt: string
  /** Ignored on read: the projections replace it with `combatBonusOf` (issue #197). */
  readonly combat: number
  /**
   * Free text, so a player can write `+1` or `5+2`; it is never used in a
   * calculation. See {@link isCombatHandSizeValue} for the limit.
   */
  readonly combatHandSize: string
  readonly efta: number
  readonly infra: number
  readonly mic: number
  readonly pe: number
}

export const DEFAULT_PLAYER_STATS: PlayerStats = {
  coinSources: EMPTY_COIN_SOURCES,
  trade: 0,
  culture: 0,
  cultureHandSize: BASE_CULTURE_HAND_SIZE,
  infantry: 1,
  artillery: 1,
  mounted: 1,
  stacking: 2,
  mvmt: '2',
  combat: 0,
  combatHandSize: '',
  efta: 0,
  infra: 0,
  mic: 0,
  pe: 0,
}

/** The longest Combat hand size text accepted: room for `5+1+2`, not for an essay. */
export const MAX_COMBAT_HAND_SIZE_LENGTH = 20

/** Whether `value` is acceptable Combat hand size text: a string of at most 20 characters once trimmed (empty clears it). */
export function isCombatHandSizeValue(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length <= MAX_COMBAT_HAND_SIZE_LENGTH
}

/**
 * What a Movement value may look like: a base number followed by zero or more
 * `+<bonus>` parts, as in `2`, `3+1` or `2+1+1`. Deliberately strict, so a typo
 * like `3+` or `+1` is refused rather than stored.
 */
export const MOVEMENT_VALUE_PATTERN = /^\d+(?:\+\d+)*$/

/**
 * True for a Movement value. A non-negative integer is accepted for callers
 * that still send a bare number (and for games saved before Movement was text);
 * it is stored in its string form. Shared by the engine and the client so the
 * two cannot drift apart.
 */
export function isMovementValue(value: unknown): value is number | string {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0
  return typeof value === 'string' && MOVEMENT_VALUE_PATTERN.test(value)
}

export interface Playerhand {
  readonly playerId: string
  readonly username: string
  readonly email: string | null
  readonly color: string | null
  readonly playernumber: number
  readonly gameCreator: boolean
  /** Java: `yourTurn` — only one player has this set at a time. */
  readonly yourTurn: boolean
  /** Java: `civilization` — the chosen civilization. */
  readonly civilization: CivItem | null
  /** A hidden hand. Only the owner should see the contents. */
  readonly items: readonly Item[]
  readonly techsChosen: readonly TechItem[]
  /** Great Persons placed face-down as a blank pyramid occupant (Sir Isaac
   *  Newton). Always public once placed — see the task brief. */
  readonly pyramidPlacements: readonly PyramidPlacement[]
  /** Java: at most three barbarian units at a time. */
  readonly barbarians: readonly UnitItem[]
  readonly battlehand: readonly UnitItem[]
  readonly socialPolicies: readonly SocialPolicyItem[]
  /** Java: `playerTurns` — the player's own turn orders, private until revealed. */
  readonly playerTurns: readonly PlayerTurn[]
  /** Java: `gamenote` — the player's private note about the game. */
  readonly gamenote: string | null
  /** The status board. New in this port — see {@link PlayerStats}. */
  readonly stats: PlayerStats
  /** Public shared bookkeeping for the civilization's current government. */
  readonly government: Government
  /**
   * Card choices waiting for the owner after a culture advance. Private: the
   * candidates are in the hand, hidden, and only the owner's projection carries
   * this list. Stored in the state, so a refresh resumes the choice and never draws again.
   */
  readonly pendingRewards: readonly PendingReward[]
}

/**
 * A reward of a culture advance that still has to be resolved: the player drew
 * `candidateIds.length` cards, keeps `keep` of them and discards the rest.
 */
export interface PendingReward {
  /** The `requestId` of the advance that drew them. */
  readonly id: string
  readonly kind: CultureSpaceKind
  readonly level: CultureLevel
  /** The space the marker moved to. */
  readonly step: number
  /** Ids of the drawn cards, which are in the player's hand until the choice is made. */
  readonly candidateIds: readonly string[]
  readonly keep: 1
}

/** A pending reward in the owner's projection, with the candidate cards in the clear. */
export interface PendingRewardView {
  readonly id: string
  readonly kind: CultureSpaceKind
  readonly level: CultureLevel
  readonly step: number
  readonly candidates: readonly Item[]
  readonly keep: 1
}

/** Java: `GameLog.LogType`. */
export type LogType =
  | 'TRADE_BETWEEN_PLAYERS'
  | 'BATTLE'
  | 'ITEM'
  | 'TECH'
  | 'REMOVED_TECH'
  | 'SHUFFLE'
  | 'DISCARD'
  | 'WITHDRAW'
  | 'JOIN'
  | 'REVEAL'
  | 'UNDO'
  | 'SOCIAL_POLICY'
  | 'REMOVED_SOCIAL_POLICY'
  | 'VOTE'
  | 'SETUP'
  | 'SOT'
  | 'TRADE'
  | 'CM'
  | 'MOVEMENT'
  | 'RESEARCH'

/**
 * Java: `GameLog`. Java stored the whole item on the log document and let the
 * resource layer filter it; that was the security hole noted in todo.txt. Here
 * the item sits on its own field that the `publicLog` projection never touches.
 */
export interface GameLogEntry {
  readonly id: string
  readonly username: string
  readonly logType: LogType | null
  /** Full information. Only ever shown to whoever made the draw. */
  readonly privateLog: string
  /** What everyone may see. Never reveals the contents of a hidden item. */
  readonly publicLog: string
  /**
   * The item the draw was about, if any. Java: `GameLog.draw.item`. For the
   * private view and undo only — never send this out in a public projection.
   */
  readonly item: Item | null
  /** Java: `GameLog.draw.playerId` — whose draw it is. */
  readonly playerId: string | null
  /**
   * Java: `GameLog.draw.undo`. Set when someone has asked to undo this log
   * entry. The undo hangs off the log entry because it is the action being
   * taken back, not the item.
   */
  readonly undo: Undo | null
  /** ISO timestamp assigned by the server when this entry is persisted. */
  readonly createdAt: string | null
  /**
   * The `requestId` of the assisted action this line reports (see
   * `AssistedActionRecord`). It makes the line a target for the undo vote even
   * though it carries no item.
   */
  readonly assistedActionId?: string
}

/** The assisted actions the game can perform for a player. See `assisted.ts`. */
export type AssistedActionKind =
  | CultureCardKind
  | 'democracy'
  | 'printingPress'
  | 'cultureAdvance'
  | 'chooseReward'
  | 'build'

/** The cards that spend a resource token for culture: "Incense, City Management: gain N culture". */
export type CultureCardKind = 'chivalry' | 'currency' | 'metalCasting'

/** Why a player can or cannot press an assisted action right now. */
export type AssistedStatus =
  | 'ready'
  | 'used'
  | 'needs-resource'
  | 'wrong-phase'
  | 'not-owned'
  | 'unavailable'

/**
 * The resource token an action spent, exactly, so an undo puts back the same
 * one: a hut from the hand (moved to `discardedItems`), or the board piece that
 * was removed, with its position.
 */
export type SpentResource =
  | { readonly kind: 'hut'; readonly resource: string; readonly itemId: string }
  | { readonly kind: 'piece'; readonly resource: string; readonly piece: BoardPiece }

/**
 * The Great Person marker a culture advance put in the player's area: which piece, where it
 * landed and the board history entry that placed it. An undo removes exactly this
 * piece, and refuses when it has left the owner's area.
 */
export interface GreatPersonMarker {
  readonly assetId: string
  readonly pieceId: string
  readonly position: { readonly x: number; readonly y: number }
  readonly historyId: string
}

/** What an action changed, enough to reverse it. Server side only, never in a view. */
export type AssistedEffect =
  | { readonly kind: CultureCardKind; readonly culture: number; readonly spent: SpentResource }
  | {
      readonly kind: 'coinPurchase'
      readonly source: 'democracy' | 'printingPress'
      readonly resource: 'trade' | 'culture'
      readonly cost: number
    }
  | {
      readonly kind: 'cultureAdvance'
      readonly fromStep: number
      readonly toStep: number
      /** What was paid, after the discounts. */
      readonly culture: number
      readonly trade: number
      /** The leader piece that moved, where it was and where it went, and the board history entry of the move. */
      readonly markerPieceId: string
      readonly markerFrom: { readonly x: number; readonly y: number }
      readonly markerTo: { readonly x: number; readonly y: number }
      readonly historyId: string
      readonly reward: CultureSpaceKind
      readonly level: CultureLevel
      readonly sheetName: SheetName
      /** Every card drawn, in draw order. */
      readonly drawn: readonly string[]
      /** The card kept, or `null` while the choice is still pending. */
      readonly kept: string | null
      /**
       * Great Person space only (absent on a culture event and on records saved
       * before the markers existed): the faceup cards discarded because no marker of
       * their type was left, and the marker taken once a card is kept.
       */
      readonly rejected?: readonly string[]
      readonly marker?: GreatPersonMarker | null
    }
  | {
      readonly kind: 'chooseReward'
      readonly rewardId: string
      /** The card kept, or `null` when no candidate was left in the hand and the choice was only dropped. */
      readonly itemId: string | null
    }
  | {
      readonly kind: 'build'
      readonly cityPieceId: string
      /** What was built: a building or a figure, which stands on the map. */
      readonly item: PlacedBuildItem
      /** The map square, as numbers from the map's top left corner, and the label the log used. */
      readonly square: { readonly column: number; readonly row: number; readonly label: string }
      /** The piece that was placed, where it went and the board history entry that placed it. */
      readonly pieceId: string
      readonly position: { readonly x: number; readonly y: number }
      readonly historyId: string
      /** The trade paid for the missing production; 0 when the city's production was enough. */
      readonly trade: number
      /** The Building Program marker the build used up, exactly as it stood, and the history entry that removed it. `null` without one. */
      readonly marker: { readonly piece: BoardPiece; readonly historyId: string } | null
    }
  | {
      readonly kind: 'build'
      readonly cityPieceId: string
      /** A military unit: no square and no piece, only a card in the hand. */
      readonly item: UnitBuildItem
      /**
       * The card that was drawn, its deck, and the index it had in `GameState.items` just
       * before it was taken, so an undo puts the same card back in the same place and
       * the next draw returns it again (no chance to redraw). `reshuffled` is true when
       * the discards were reshuffled during the draw, which means `index` refers to the
       * reshuffled deck. Server side only, like every effect: never projected.
       */
      readonly card: {
        readonly itemId: string
        readonly sheetName: SheetName
        readonly index: number
        readonly reshuffled: boolean
      }
      readonly trade: number
      readonly marker: { readonly piece: BoardPiece; readonly historyId: string } | null
    }

/**
 * One applied assisted action. `id` is the client's `requestId`, which is what
 * makes a retry, a refresh or a second tab harmless. `phase` and `turnNumber`
 * stay on the record so a later "reopen phase" can find what belongs to it.
 */
export interface AssistedActionRecord {
  readonly id: string
  readonly kind: AssistedActionKind
  readonly playerId: string
  readonly turnNumber: number
  readonly phase: TurnPhase
  /** The key written to the player's `PlayerTurn.usedActions`, or `null` for a repeatable action. */
  readonly usageKey: string | null
  readonly at: string | null
  /** The public log line the action wrote. */
  readonly logId: string
  readonly status: 'applied' | 'undone'
  readonly effect: AssistedEffect
  /**
   * Set when the card had already been used this turn and the player confirmed
   * using it again. The record then shares the first use's `usageKey`, which is
   * freed only when no applied record holds it any more.
   */
  readonly confirmedRepeat?: boolean
}

/** One entry of `PlayerView.you.availableActions`: the viewer's own button state. */
export interface AvailableAction {
  readonly action: AssistedActionKind
  readonly label: string
  readonly status: AssistedStatus
  /** A readable sentence, also when `status` is `ready`. */
  readonly reason: string
}

/** An assisted action as everybody may read it. No effect, no hut or piece identity. */
export interface PublicAssistedAction {
  readonly id: string
  readonly kind: AssistedActionKind
  readonly label: string
  readonly playerId: string
  readonly username: string
  readonly turnNumber: number
  readonly phase: TurnPhase
  readonly status: 'applied' | 'undone'
  /** The public log line, as it was written. */
  readonly text: string
  readonly logId: string
  /** Present, and true, for a use the player confirmed after the card was used this turn. Not secret. */
  readonly confirmedRepeat?: boolean
}

export interface GameState {
  readonly id: string
  readonly name: string
  readonly gameType: GameType
  /**
   * ISO timestamp of when the game was created, stamped by the server. `null`
   * for games saved before the field existed (migrated games show no date).
   * Public data, like `winner`.
   */
  readonly createdAt: string | null
  readonly numOfPlayers: number
  readonly active: boolean
  readonly winner: string | null
  /** The deck. Java: `PBF.items`. */
  readonly items: readonly Item[]
  /** Java: `PBF.discardedItems` — what a reshuffle draws back from. */
  readonly discardedItems: readonly Item[]
  readonly players: readonly Playerhand[]
  /** Java: `withdrawnPlayers` — the hands of players who have withdrawn. */
  readonly withdrawnPlayers: readonly Playerhand[]
  /** Techs are chosen rather than drawn, so everyone sees the whole list. */
  readonly techs: readonly TechItem[]
  readonly socialPolicies: readonly SocialPolicyItem[]
  /**
   * Java: `publicTurns`, keyed on `turnNumber + username`. It stores a masked
   * public copy until each phase is revealed.
   */
  readonly publicTurns: Readonly<Record<string, PlayerTurn>>
  readonly log: readonly GameLogEntry[]
  /**
   * Every assisted action performed, with what it spent and gained. The
   * `effect` inside is for undo only and is never part of a projection.
   */
  readonly assistedActions: readonly AssistedActionRecord[]
  /** The board and the pieces on it. Every player sees the whole board. */
  readonly board: Board
  readonly rng: Rng
  /**
   * Keys the item numbers a public log line carries for a hidden tech or social
   * policy (`uniqueItemNumber`). Server only: a projection must never carry it,
   * or the numbers could be matched against the tech list again.
   */
  readonly logSecret: string
  /** The next `itemNumber`. Java: `ItemReader.itemCounter`, a global AtomicInteger. */
  readonly itemCounter: number
  /**
   * Whether the start-of-game ancient wonders have been dealt onto the board.
   * The deal happens once, when the last civilization is revealed. This flag is
   * the authority for that — a wonder *piece* on the board is not, because a
   * moderator may place wonder art from the palette, which must not cancel the
   * deal.
   */
  readonly wondersDealt: boolean
  /**
   * The first turn `turnStatus` looks at. Every turn below it counts as finished
   * for everybody. A game that was played with the old baton gets it set to the
   * turn it had reached when it was migrated (`migrateGameState`), read from
   * every player's records and not only the baton holder's, so it does not start
   * over at turn 1 and a player who never wrote an early turn cannot hold the
   * current turn back. 1 by default.
   */
  readonly chatOrdersStartTurn: number
  /**
   * The start player the engine last put in place (the marker moving to them at
   * the start of a turn, or a game being migrated from the old baton), by player
   * id. It is only the fallback of `startPlayerOf`, used when the marker is
   * missing or lies outside every player's area. Public. Null until then.
   */
  readonly startPlayerId: string | null
  /**
   * Who started each turn, turn number to username, so the title of an old turn
   * stays right after the marker has moved on. Also the guard that stops a turn
   * from being started twice. Public. Empty until the first turn is started.
   */
  readonly turnStarters: Readonly<Record<number, string>>
  /**
   * The public turn orders of the old baton view have been copied into the
   * timeline. True for a game created by this code. Nothing changes it after a game
   * is loaded; `migrateGameState` still derives it for a save that lacks it, so
   * that old saves load as before. Public, but not in the view.
   */
  readonly legacyOrdersCopied: boolean
  /**
   * The orders revealed before versions were stored have been copied into the
   * timeline. True for a game created by this code, false for a loaded game
   * that lacks it. Nothing changes it after a game is loaded; it is kept only so
   * that old saves load as before. Public, but not in the view.
   */
  readonly legacyRevealsCopied: boolean
  /**
   * The currently active battle, or null if no battle is in progress.
   * At most one battle may be active per game at a time.
   */
  readonly battle: Battle | null
  /**
   * The battle most recently ended with "End battle", kept so the player who
   * ended it can undo an accidental press. `null` when there is nothing to
   * undo. Cleared when a new battle is initiated; no other action expires it.
   * Never sent to a client: the view only carries `endedBy` (`battleUndo`).
   */
  readonly endedBattle: EndedBattle | null
  /**
   * Monotonically increasing revision counter. Incremented by `applyToGame`
   * on every write. Used to detect concurrent edits: the server returns 409
   * if the client's `rev` does not match the stored one.
   */
  readonly rev: number
}

/** A battle that was ended and can still be brought back by `endedBy`. */
export interface EndedBattle {
  /** The battle exactly as it stood when it was ended, arena included. */
  readonly battle: Battle
  /** The player who pressed End battle, and the only one who may undo it. */
  readonly endedBy: string
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function findPlayer(state: GameState, playerId: string): Playerhand | undefined {
  return state.players.find((player) => player.playerId === playerId)
}

/**
 * New in the port, no Java counterpart. Who is on turn, and which phase of
 * their turn they should be working on. Derived only from public `done` flags
 * and the start marker, never order text, so it is safe in `PlayerView` for
 * every viewer, not just the active player.
 */
export interface ActiveTurnStatus {
  readonly playerId: string
  readonly username: string
  readonly turnNumber: number
  readonly phase: TurnPhase
  /**
   * Everybody who has not finished the current turn and the phase they are on.
   * Public, derived from the `done` flags.
   */
  readonly waitingFor: readonly WaitingFor[]
  /** The username of whoever started this turn, `null` when there is nobody. Public. */
  readonly startPlayer: string | null
}

/**
 * There is no baton: the turn belongs to `turnHolder`, and the turn number and
 * phase come from `turnStatus`. `null` when there are no active players, and while
 * the game has not started (`gameHasStarted`): a lobby has no turn yet.
 */
export function activeTurnStatus(state: GameState): ActiveTurnStatus | null {
  if (!gameHasStarted(state)) return null
  const holder = turnHolder(state)
  if (holder === undefined) return null
  const status = turnStatus(state)
  const phase = status.players.find((player) => player.playerId === holder.playerId)?.phase
  return {
    playerId: holder.playerId,
    username: holder.username,
    turnNumber: status.currentTurn,
    // The holder has not finished the earliest open phase, so it is their first
    // open phase too. `SOT` only satisfies the type.
    phase: phase ?? 'SOT',
    waitingFor: status.waitingFor,
    startPlayer: startPlayerName(state, status.currentTurn),
  }
}

export function findPlayerByUsername(
  state: GameState,
  username: string,
): Playerhand | undefined {
  return state.players.find((player) => player.username === username)
}

/** Java: `misc.SecurityCheck.hasUserAccess` — is the player in this game. */
export function hasUserAccess(state: GameState, playerId: string): boolean {
  return state.players.some((player) => player.playerId === playerId)
}

export function findLogEntry(state: GameState, logId: string): GameLogEntry | undefined {
  return state.log.find((entry) => entry.id === logId)
}

/** Replaces one log entry and leaves the rest alone. */
export function withLogEntry(state: GameState, entry: GameLogEntry): GameState {
  return {
    ...state,
    log: state.log.map((existing) => (existing.id === entry.id ? entry : existing)),
  }
}

/** Replaces one player hand and leaves the rest alone. */
export function withPlayer(state: GameState, player: Playerhand): GameState {
  return {
    ...state,
    players: state.players.map((existing) =>
      existing.playerId === player.playerId ? player : existing,
    ),
  }
}

// ---------------------------------------------------------------------------
// Status board (issue #43) — read-only derived numbers
// ---------------------------------------------------------------------------

/**
 * Where a player's leader marker sits on the culture track, or `null` when it
 * has not been placed yet (no civilization chosen, no colour, or the marker is
 * off the track). The marker itself is placed by `placeLeaderMarker` in
 * `actions/player.ts` when a civilization is revealed.
 */
export function cultureMarkerLevelOf(state: GameState, playerId: string): number | null {
  const player = findPlayer(state, playerId)
  if (player === undefined) return null
  return cultureMarkerOf(state, player)?.step ?? null
}

/**
 * How many city pieces (capital, city or metropolis, walled or not) belong to a
 * player. A city's colour is read off its asset id — for example "cities/redcity2"
 * belongs to Red (see `pieceColorOf`). There is no equivalent for `building`
 * pieces: the manifest has one generic image per building type, with no
 * per-colour artwork, so `buildingCountOf` below falls back to `placedBy`
 * instead.
 */
export function cityCountOf(state: GameState, playerId: string): number {
  const player = findPlayer(state, playerId)
  if (player === undefined || player.color === null) return 0

  const colour = player.color.toLowerCase()
  return state.board.pieces.filter(
    (piece) => piece.category === 'city' && pieceColorOf(piece) === colour,
  ).length
}

/**
 * How many building pieces belong to a player. Buildings carry no per-colour
 * artwork (see {@link cityCountOf}), so ownership is read off `placedBy`
 * instead — who put the piece on the board. Pieces can be moved by anyone
 * afterwards, same as any other board piece, so this undercounts a building
 * that changed hands after being moved; there is no stronger signal in the
 * board model to attribute it by.
 */
export function buildingCountOf(state: GameState, playerId: string): number {
  return state.board.pieces.filter(
    (piece) => piece.category === 'building' && piece.placedBy === playerId,
  ).length
}

/**
 * The stats with the derived numbers filled in: `combat` is computed from the
 * board, MIC, government and civilization (issue #197), and Bank, Adam Smith
 * and Great People coins from public board/card eligibility (issues #241 and
 * #253). A legacy Bank value is retained as a floor for compatibility.
 */
function derivedStats(state: GameState, player: Playerhand): PlayerStats {
  return {
    ...player.stats,
    coinSources: coinSourcesOf(state, player),
    combat: combatBonusOf(state, player),
    cultureHandSize: cultureHandSizeOf(state, player),
  }
}

function withDerivedStats(state: GameState, player: Playerhand): Playerhand {
  return { ...player, stats: derivedStats(state, player) }
}

// ---------------------------------------------------------------------------
// Projections — what a given player gets to see
// ---------------------------------------------------------------------------

/**
 * A blank pyramid occupant as an opponent sees it: the slot only, never the
 * placed card's name. See `OpaquePlayerhand.pyramidPlacements`.
 */
export interface PublicPyramidPlacement {
  readonly slot: 1 | 2 | 3 | 4 | 5
}

/** What other players see of a hand: counts, not contents. */
export interface PublicHandCounts {
  readonly cultureCards: number
  readonly huts: number
  readonly villages: number
  readonly greatPersons: number
  readonly units: number
}

export interface OpaquePlayerhand {
  readonly playerId: string
  readonly username: string
  readonly color: string | null
  readonly playernumber: number
  readonly gameCreator: boolean
  readonly yourTurn: boolean
  /** The civilization is public as soon as it has been revealed. */
  readonly civilization: CivItem | null
  readonly numberOfItemsInHand: number
  /** Counts of the five public hand categories; no item data or order. */
  readonly publicHand: PublicHandCounts
  readonly numberOfTechsChosen: number
  readonly numberOfBarbarians: number
  readonly numberOfSocialPolicies: number
  /** The battlehand is revealed explicitly in battle, so it is shown as it is. */
  readonly battlehand: readonly UnitItem[]
  /**
   * Revealed techs only. Java: `getTechsForAllPlayers` filtered on
   * `!isHidden()`, which is how the tech pyramid becomes public.
   */
  readonly revealedTechs: readonly TechItem[]
  /**
   * Revealed social policies only (issue #140), the mirror of
   * `revealedTechs`. Java had no public social-policy projection — the
   * in-repo `revealSocialPolicy` is the port-only feature that publishes one —
   * so a hidden policy stays private and only `numberOfSocialPolicies` is
   * public until its owner reveals it.
   */
  readonly revealedSocialPolicies: readonly SocialPolicyItem[]
  /**
   * Great Persons placed face-down as a blank pyramid occupant. The *slot* is
   * public — everyone sees the pyramid layout — but the card's identity is
   * not: Sir Isaac Newton's printed effect places the card "facedown" as a
   * "blank" tech card, so the name is stripped in `opaque()` below.
   */
  readonly pyramidPlacements: readonly PublicPyramidPlacement[]
  /** The status board (issue #43) is public, unlike the rest of the hand. */
  readonly stats: PlayerStats
  readonly government: Government
  /** Derived from the board, so it cannot drift out of step. See `state.ts`. */
  readonly cultureMarkerLevel: number | null
  readonly cityCount: number
  readonly buildingCount: number
  /**
   * Each city's production estimate with its arithmetic. Derived from the public
   * board and from revealed cards only (see `city-production.ts`), so an opponent
   * gets the same figures a spectator would.
   */
  readonly cities: readonly CityProduction[]
}

function opaque(state: GameState, player: Playerhand): OpaquePlayerhand {
  return {
    playerId: player.playerId,
    username: player.username,
    color: player.color,
    playernumber: player.playernumber,
    gameCreator: player.gameCreator,
    yourTurn: player.yourTurn,
    civilization: player.civilization,
    numberOfItemsInHand: player.items.length,
    publicHand: {
      cultureCards: player.items.filter((item) => item.kind === 'cultureI' || item.kind === 'cultureII' || item.kind === 'cultureIII').length,
      huts: player.items.filter((item) => item.kind === 'hut').length,
      villages: player.items.filter((item) => item.kind === 'village').length,
      greatPersons: player.items.filter((item) => item.kind === 'greatperson').length,
      units: player.items.filter(isUnit).length,
    },
    numberOfTechsChosen: player.techsChosen.length,
    numberOfBarbarians: player.barbarians.length,
    numberOfSocialPolicies: player.socialPolicies.length,
    battlehand: player.battlehand,
    revealedTechs: player.techsChosen.filter((tech) => !tech.hidden),
    revealedSocialPolicies: player.socialPolicies.filter((policy) => !policy.hidden),
    pyramidPlacements: player.pyramidPlacements.map((placement) => ({ slot: placement.slot })),
    stats: derivedStats(state, player),
    government: player.government,
    cultureMarkerLevel: cultureMarkerLevelOf(state, player.playerId),
    cityCount: cityCountOf(state, player.playerId),
    buildingCount: buildingCountOf(state, player.playerId),
    cities: cityProductionsOf(state, player),
  }
}

/** One log entry as everyone may see it. The item contents are gone. */
export interface PublicLogEntry {
  readonly id: string
  readonly username: string
  readonly logType: LogType | null
  readonly publicLog: string
  /** Present on the line of an assisted action, so anyone can ask to undo it. */
  readonly assistedActionId?: string
}

export function toPublicLog(entry: GameLogEntry): PublicLogEntry {
  return {
    id: entry.id,
    username: entry.username,
    logType: entry.logType,
    publicLog: entry.publicLog,
    ...(entry.assistedActionId === undefined ? {} : { assistedActionId: entry.assistedActionId }),
  }
}

/** The viewer's own hand, plus the same derived board numbers opponents get. */
export interface PlayerViewSelf extends Omit<Playerhand, 'pendingRewards'> {
  /**
   * The card choices waiting for the viewer, each with its candidate cards.
   * Only ever the viewer's own: an opponent or a spectator gets no such field,
   * not even a count.
   */
  readonly pendingRewards: readonly PendingRewardView[]
  readonly cultureMarkerLevel: number | null
  readonly cityCount: number
  readonly buildingCount: number
  /** The viewer's cities, as `OpaquePlayerhand.cities` gives them for everybody. */
  readonly cities: readonly CityProduction[]
  /**
   * The Great Person card types the viewer cannot use for now (issue #241): they
   * have tokens of the type on the map and every one is blockaded. Derived from
   * the public board and the viewer's colour, never from the hand, and not part
   * of `OpaquePlayerhand`.
   */
  readonly blockadedGreatPersonTypes: readonly string[]
  /**
   * What the viewer can press right now, one entry per assisted action. Only
   * ever built for the viewer's own player: it depends on their hand and on
   * the resource tokens they hold, so nobody else gets it.
   */
  readonly availableActions: readonly AvailableAction[]
  /**
   * What each of the viewer's cities can build now (assisted Build). Derived
   * from the viewer's revealed techs and trade, so it exists on the own view only:
   * never on `OpaquePlayerhand`, never for a spectator, and blanked for a replayed
   * revision.
   */
  readonly buildOptions: readonly CityBuildOptions[]
}

/**
 * The game state seen by one player: their own hand in the clear, the others'
 * as counts, the deck as a count only, and a log where other people's draws
 * appear in public form alone.
 */
export interface PlayerView {
  readonly id: string
  readonly name: string
  readonly gameType: GameType
  readonly numOfPlayers: number
  readonly active: boolean
  readonly winner: string | null
  readonly numberOfItemsInDeck: number
  readonly numberOfDiscardedItems: number
  readonly you: PlayerViewSelf | null
  readonly opponents: readonly OpaquePlayerhand[]
  /** Whose turn it is and which phase they should be working on. */
  readonly activeTurn: ActiveTurnStatus | null
  readonly techs: readonly TechItem[]
  /** The board is public — everyone sees the same pieces. */
  readonly board: Board
  /** Derived from the player list, so it cannot drift out of step. */
  readonly boardAreas: readonly BoardArea[]
  /**
   * Buildings, Great Person tokens and wonders an enemy figure stands on (issue #241).
   * Derived from the public board alone, so every player gets the same list.
   */
  readonly blockadedPieceIds: readonly string[]
  readonly log: readonly (PublicLogEntry | GameLogEntry)[]
  /** Assisted actions already performed, public summary only. */
  readonly assistedActions: readonly PublicAssistedAction[]
  /**
   * The active battle, or null. The arena is fully public — both sides see all
   * units once placed. Units NOT in the arena remain subject to existing
   * hidden-info rules (the hand, private techs).
   */
  readonly battle: Battle | null
  /**
   * Set while the ended battle can still be undone. Only who ended it is
   * exposed; the arena snapshot itself stays in the game state.
   */
  readonly battleUndo: { readonly endedBy: string } | null
  /**
   * Per-side totals derived from the arena. Empty when no battle is active.
   * Derived rather than stored so it cannot drift out of step.
   */
  readonly battleSummary: readonly BattleSideSummary[]
  /** Current revision counter — sent back so the client can include it in writes. */
  readonly rev: number
}

/** Derived per-side totals for the active battle. Exported for `endBattleAction`'s winner check. */
export function battleSummaries(state: GameState): readonly BattleSideSummary[] {
  const { battle } = state
  if (battle === null) return []

  const sides = [
    { sideId: 'attacker' as const, side: battle.attacker },
    { sideId: 'defender' as const, side: battle.defender },
  ]

  return sides.map(({ sideId, side }) => {
    // A killed unit stays in the arena until the battle ends (issue #71, so a
    // kill can be undone) but should not count toward the living totals.
    const units = battle.arena.filter((u) => u.side === sideId && !u.killed)
    const player = findPlayer(state, side.playerId)
    const label =
      side.kind === 'barbarians'
        ? 'Barbarians'
        : (player?.username ?? side.playerId)
    const combatBonus =
      side.kind === 'player' && player !== undefined ? combatBonusOf(state, player) : 0
    return {
      side: sideId,
      kind: side.kind,
      playerId: side.playerId,
      label,
      unitCount: units.length,
      totalHealth: units.reduce((sum, u) => sum + u.health, 0),
      totalAttack: units.reduce((sum, u) => sum + u.attack, 0),
      combatBonus,
    }
  })
}

/**
 * The viewer's pending rewards with the candidate cards looked up in their hand.
 * A reward with no candidate left in the hand is not shown (`livePendingRewards`).
 */
function pendingRewardViews(player: Playerhand): readonly PendingRewardView[] {
  return livePendingRewards(player).map(({ candidateIds, ...reward }) => ({
    ...reward,
    candidates: candidateIds.flatMap((id) => {
      const item = player.items.find((candidate) => candidate.id === id)
      return item === undefined ? [] : [item]
    }),
  }))
}

export function toPlayerView(state: GameState, viewerId: string): PlayerView {
  const player = findPlayer(state, viewerId)
  const you: PlayerViewSelf | null =
    player === undefined
      ? null
      : {
          ...withDerivedStats(state, player),
          cultureMarkerLevel: cultureMarkerLevelOf(state, viewerId),
          cityCount: cityCountOf(state, viewerId),
          buildingCount: buildingCountOf(state, viewerId),
          cities: cityProductionsOf(state, player),
          blockadedGreatPersonTypes: blockadedGreatPersonTypes(state, player),
          availableActions: availableActionsFor(state, viewerId),
          buildOptions: buildOptionsOf(state, player),
          pendingRewards: pendingRewardViews(player),
        }
  return {
    id: state.id,
    name: state.name,
    gameType: state.gameType,
    numOfPlayers: state.numOfPlayers,
    active: state.active,
    winner: state.winner,
    numberOfItemsInDeck: state.items.length,
    numberOfDiscardedItems: state.discardedItems.length,
    you,
    opponents: state.players
      .filter((player) => player.playerId !== viewerId)
      .map((player) => opaque(state, player)),
    activeTurn: activeTurnStatus(state),
    techs: state.techs,
    board: state.board,
    boardAreas: boardAreas(state.board, state.players),
    blockadedPieceIds: blockadedPieceIds(state),
    log: state.log.map((entry) =>
      entry.playerId === viewerId ? entry : toPublicLog(entry),
    ),
    assistedActions: publicAssistedActions(state),
    battle: state.battle,
    battleUndo: state.endedBattle === null ? null : { endedBy: state.endedBattle.endedBy },
    battleSummary: battleSummaries(state),
    rev: state.rev,
  }
}
