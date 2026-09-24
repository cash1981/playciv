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
import { boardAreas, cultureStepOf, leaderAssetId } from './board.js'
import type { CoinSources } from './coins.js'
import { EMPTY_COIN_SOURCES } from './coins.js'
import type { PlayerTurn, TurnPhase } from './turn.js'
import { currentPhaseStatus, TURN_PHASES } from './turn.js'
import type { Undo } from './undo.js'
import type { Battle, BattleSideSummary } from './battle.js'
import type { Government } from './government.js'

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
   */
  readonly coinSources: CoinSources
  readonly trade: number
  readonly culture: number
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
  readonly combat: number
  readonly handSize: number
  readonly efta: number
  readonly infra: number
  readonly mic: number
  readonly pe: number
}

export const DEFAULT_PLAYER_STATS: PlayerStats = {
  coinSources: EMPTY_COIN_SOURCES,
  trade: 0,
  culture: 0,
  infantry: 1,
  artillery: 1,
  mounted: 1,
  stacking: 2,
  mvmt: '2',
  combat: 0,
  handSize: 0,
  efta: 0,
  infra: 0,
  mic: 0,
  pe: 0,
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
  /** The board and the pieces on it. Every player sees the whole board. */
  readonly board: Board
  readonly rng: Rng
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
   * The currently active battle, or null if no battle is in progress.
   * At most one battle may be active per game at a time.
   */
  readonly battle: Battle | null
  /**
   * Monotonically increasing revision counter. Incremented by `applyToGame`
   * on every write. Used to detect concurrent edits: the server returns 409
   * if the client's `rev` does not match the stored one.
   */
  readonly rev: number
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function findPlayer(state: GameState, playerId: string): Playerhand | undefined {
  return state.players.find((player) => player.playerId === playerId)
}

/** Java: `PBF.getNameOfUsersTurn()`. */
export function nameOfPlayersTurn(state: GameState): string {
  return state.players.find((player) => player.yourTurn)?.username ?? ''
}

/**
 * New in the port, no Java counterpart. Who is on turn, and which phase of
 * their turn they should be working on — see `currentPhaseStatus`. `null`
 * when nobody is on turn yet (game not started). Derived only from public
 * `revealed` flags, never order text, so it is safe in `PlayerView` for every
 * viewer, not just the active player.
 */
export interface ActiveTurnStatus {
  readonly playerId: string
  readonly username: string
  readonly turnNumber: number
  readonly phase: TurnPhase
}

export function activeTurnStatus(state: GameState): ActiveTurnStatus | null {
  const current = state.players.find((player) => player.yourTurn)
  if (current === undefined) return null

  const latest = current.playerTurns.reduce<PlayerTurn | undefined>(
    (best, turn) => (best === undefined || turn.turnNumber > best.turnNumber ? turn : best),
    undefined,
  )
  const phase = currentPhaseStatus(latest)
  // A missing `revealed` flag is treated as revealed, matching `publicTurn`
  // and `migratePlayerTurn`'s treatment of a legacy turn.
  const roundDone = latest !== undefined && TURN_PHASES.every((candidate) => latest.revealed[candidate] ?? true)
  const turnNumber = latest === undefined ? 1 : roundDone ? latest.turnNumber + 1 : latest.turnNumber

  return { playerId: current.playerId, username: current.username, turnNumber, phase }
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
  if (player === undefined || player.civilization === null || player.color === null) {
    return null
  }

  const assetId = leaderAssetId(player.civilization.name, player.color)
  if (assetId === undefined) return null

  const piece = state.board.pieces.find((candidate) => candidate.assetId === assetId)
  if (piece === undefined) return null

  return cultureStepOf(state.board, piece)
}

/** The five player colours a city piece can come in, matching `PLAYER_COLORS`. */
const CITY_COLOR_PREFIXES = ['blue', 'green', 'purple', 'red', 'yellow'] as const

/**
 * A city piece's colour, read off its asset id — for example
 * "cities/redcity2" belongs to Red. There is no equivalent for `building`
 * pieces: the manifest has one generic image per building type, with no
 * per-colour artwork, so `buildingCountOf` below falls back to `placedBy`
 * instead.
 */
function cityColorOf(piece: BoardPiece): string | undefined {
  const base = piece.assetId.split('/').at(-1)?.toLowerCase() ?? ''
  return CITY_COLOR_PREFIXES.find((colour) => base.startsWith(colour))
}

/** How many city pieces (capital, city or metropolis, walled or not) belong to a player. */
export function cityCountOf(state: GameState, playerId: string): number {
  const player = findPlayer(state, playerId)
  if (player === undefined || player.color === null) return 0

  const colour = player.color.toLowerCase()
  return state.board.pieces.filter(
    (piece) => piece.category === 'city' && cityColorOf(piece) === colour,
  ).length
}

/**
 * How many building pieces belong to a player. Buildings carry no per-colour
 * artwork (see {@link cityColorOf}), so ownership is read off `placedBy`
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
  /**
   * Public turn-order copies. `gamenote` and `playerTurns` are private and do
   * not appear here.
   */
  readonly publicTurns: readonly PlayerTurn[]
  /** The status board (issue #43) is public, unlike the rest of the hand. */
  readonly stats: PlayerStats
  readonly government: Government
  /** Derived from the board, so it cannot drift out of step. See `state.ts`. */
  readonly cultureMarkerLevel: number | null
  readonly cityCount: number
  readonly buildingCount: number
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
    publicTurns: Object.values(state.publicTurns).filter(
      (turn) => turn.username === player.username,
    ),
    stats: player.stats,
    government: player.government,
    cultureMarkerLevel: cultureMarkerLevelOf(state, player.playerId),
    cityCount: cityCountOf(state, player.playerId),
    buildingCount: buildingCountOf(state, player.playerId),
  }
}

/** One log entry as everyone may see it. The item contents are gone. */
export interface PublicLogEntry {
  readonly id: string
  readonly username: string
  readonly logType: LogType | null
  readonly publicLog: string
}

export function toPublicLog(entry: GameLogEntry): PublicLogEntry {
  return {
    id: entry.id,
    username: entry.username,
    logType: entry.logType,
    publicLog: entry.publicLog,
  }
}

/** The viewer's own hand, plus the same derived board numbers opponents get. */
export interface PlayerViewSelf extends Playerhand {
  readonly cultureMarkerLevel: number | null
  readonly cityCount: number
  readonly buildingCount: number
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
  readonly log: readonly (PublicLogEntry | GameLogEntry)[]
  /**
   * The active battle, or null. The arena is fully public — both sides see all
   * units once placed. Units NOT in the arena remain subject to existing
   * hidden-info rules (the hand, private techs).
   */
  readonly battle: Battle | null
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
    const combatBonus = side.kind === 'player' ? (player?.stats.combat ?? 0) : 0
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

export function toPlayerView(state: GameState, viewerId: string): PlayerView {
  const player = findPlayer(state, viewerId)
  const you: PlayerViewSelf | null =
    player === undefined
      ? null
      : {
          ...player,
          cultureMarkerLevel: cultureMarkerLevelOf(state, viewerId),
          cityCount: cityCountOf(state, viewerId),
          buildingCount: buildingCountOf(state, viewerId),
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
    log: state.log.map((entry) =>
      entry.playerId === viewerId ? entry : toPublicLog(entry),
    ),
    battle: state.battle,
    battleSummary: battleSummaries(state),
    rev: state.rev,
  }
}
