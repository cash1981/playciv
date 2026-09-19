/**
 * Port of `PBF` and `Playerhand`.
 *
 * PBF stood for "play by forum" and was the Mongo document for a game. The
 * `mapLink` and `assetLink` fields are deliberately left out — they pointed at
 * a Google Presentation and a Google Spreadsheet in an iframe, and are going
 * away.
 */

import type { Item, SocialPolicyItem, TechItem, UnitItem, CivItem } from './item.js'
import type { Rng } from './random.js'
import type { Board, BoardArea, BoardPiece } from './board.js'
import { boardAreas, cultureStepOf, leaderAssetId } from './board.js'
import type { PlayerTurn } from './turn.js'
import type { Undo } from './undo.js'
import type { Battle, BattleSideSummary } from './battle.js'

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
  readonly coins: number
  readonly trade: number
  readonly culture: number
  readonly infantry: number
  readonly artillery: number
  readonly mounted: number
  readonly stacking: number
  readonly mvmt: number
  readonly combat: number
  readonly handSize: number
  readonly efta: number
  readonly infra: number
  readonly mic: number
  readonly pe: number
}

export const DEFAULT_PLAYER_STATS: PlayerStats = {
  coins: 0,
  trade: 0,
  culture: 0,
  infantry: 1,
  artillery: 1,
  mounted: 1,
  stacking: 2,
  mvmt: 2,
  combat: 0,
  handSize: 0,
  efta: 0,
  infra: 0,
  mic: 0,
  pe: 0,
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
  /** Java: at most three barbarian units at a time. */
  readonly barbarians: readonly UnitItem[]
  readonly battlehand: readonly UnitItem[]
  readonly socialPolicies: readonly SocialPolicyItem[]
  /** Java: `playerTurns` — the player's own turn orders, private until shared. */
  readonly playerTurns: readonly PlayerTurn[]
  /** Java: `gamenote` — the player's private note about the game. */
  readonly gamenote: string | null
  /** The status board. New in this port — see {@link PlayerStats}. */
  readonly stats: PlayerStats
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
   * Java: `publicTurns`, keyed on `turnNumber + username`. Turn orders become
   * public the moment they are updated.
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

/** What other players see of a hand: counts, not contents. */
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
   * The turn orders that have been shared. `gamenote` and `playerTurns` are
   * private and do not appear here.
   */
  readonly publicTurns: readonly PlayerTurn[]
  /** The status board (issue #43) is public, unlike the rest of the hand. */
  readonly stats: PlayerStats
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
    numberOfTechsChosen: player.techsChosen.length,
    numberOfBarbarians: player.barbarians.length,
    numberOfSocialPolicies: player.socialPolicies.length,
    battlehand: player.battlehand,
    revealedTechs: player.techsChosen.filter((tech) => !tech.hidden),
    publicTurns: Object.values(state.publicTurns).filter(
      (turn) => turn.username === player.username,
    ),
    stats: player.stats,
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

function battleSummaries(state: GameState): readonly BattleSideSummary[] {
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
