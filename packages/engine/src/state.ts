/**
 * Port av `PBF` og `Playerhand`.
 *
 * PBF het «play by forum» og var Mongo-dokumentet for et spill. Feltene
 * `mapLink` og `assetLink` er bevisst utelatt — de pekte på en Google
 * Presentation og et Google Spreadsheet i en iframe, og skal dø.
 */

import type { Item, SocialPolicyItem, TechItem, UnitItem, CivItem } from './item.js'
import type { Rng } from './random.js'
import type { Board } from './board.js'
import type { PlayerTurn } from './turn.js'
import type { Undo } from './undo.js'

export type GameType = 'WAW'

/** Java: `Playerhand.green()` og vennene. */
export const PLAYER_COLORS = ['Green', 'Yellow', 'Purple', 'Red', 'Blue'] as const
export type PlayerColor = (typeof PLAYER_COLORS)[number]

export interface Playerhand {
  readonly playerId: string
  readonly username: string
  readonly email: string | null
  readonly color: string | null
  readonly playernumber: number
  readonly gameCreator: boolean
  /** Java: `yourTurn` — kun én spiller har denne satt om gangen. */
  readonly yourTurn: boolean
  /** Java: `civilization` — den valgte sivilisasjonen. */
  readonly civilization: CivItem | null
  /** Skjult hånd. Kun eieren skal se innholdet. */
  readonly items: readonly Item[]
  readonly techsChosen: readonly TechItem[]
  /** Java: maks 3 barbarenheter av gangen. */
  readonly barbarians: readonly UnitItem[]
  readonly battlehand: readonly UnitItem[]
  readonly socialPolicies: readonly SocialPolicyItem[]
  /** Java: `playerTurns` — spillerens egne turordrer, private til de deles. */
  readonly playerTurns: readonly PlayerTurn[]
  /** Java: `gamenote` — spillerens private notat om spillet. */
  readonly gamenote: string | null
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
 * Java: `GameLog`. Java lagret hele itemet på loggdokumentet og lot
 * ressurslaget filtrere; det var kilden til sikkerhetshullet som er notert i
 * todo.txt. Her ligger itemet på et eget felt som `publicLog`-projeksjonen
 * aldri rører.
 */
export interface GameLogEntry {
  readonly id: string
  readonly username: string
  readonly logType: LogType | null
  /** Full informasjon. Skal kun vises til eieren av trekket. */
  readonly privateLog: string
  /** Informasjon alle kan se. Skal aldri avsløre innholdet i et skjult item. */
  readonly publicLog: string
  /**
   * Itemet trekket gjaldt, hvis noe. Java: `GameLog.draw.item`. Kun for
   * privat visning og undo — send aldri dette ut i en offentlig projeksjon.
   */
  readonly item: Item | null
  /** Java: `GameLog.draw.playerId` — hvem trekket tilhører. */
  readonly playerId: string | null
  /**
   * Java: `GameLog.draw.undo`. Satt når noen har bedt om undo av denne
   * loggposten. Undoet henger på loggposten fordi det er handlingen som
   * angres, ikke itemet.
   */
  readonly undo: Undo | null
}

export interface GameState {
  readonly id: string
  readonly name: string
  readonly gameType: GameType
  readonly numOfPlayers: number
  readonly active: boolean
  readonly winner: string | null
  /** Stokken. Java: `PBF.items`. */
  readonly items: readonly Item[]
  /** Java: `PBF.discardedItems` — det reshuffle henter tilbake fra. */
  readonly discardedItems: readonly Item[]
  readonly players: readonly Playerhand[]
  /** Java: `withdrawnPlayers` — hender til spillere som har trukket seg. */
  readonly withdrawnPlayers: readonly Playerhand[]
  /** Teknologier velges, ikke trekkes, så alle spillere ser hele listen. */
  readonly techs: readonly TechItem[]
  readonly socialPolicies: readonly SocialPolicyItem[]
  /**
   * Java: `publicTurns`, nøklet på `turnNumber + username`. Turordrer blir
   * offentlige idet de oppdateres.
   */
  readonly publicTurns: Readonly<Record<string, PlayerTurn>>
  readonly log: readonly GameLogEntry[]
  /** Brettet med brikkene som ligger på det. Alle spillere ser hele brettet. */
  readonly board: Board
  readonly rng: Rng
  /** Neste `itemNumber`. Java: `ItemReader.itemCounter`, en global AtomicInteger. */
  readonly itemCounter: number
}

// ---------------------------------------------------------------------------
// Oppslag
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

/** Java: `misc.SecurityCheck.hasUserAccess` — er spilleren med i dette spillet. */
export function hasUserAccess(state: GameState, playerId: string): boolean {
  return state.players.some((player) => player.playerId === playerId)
}

export function findLogEntry(state: GameState, logId: string): GameLogEntry | undefined {
  return state.log.find((entry) => entry.id === logId)
}

/** Bytter ut én loggpost og lar resten stå. */
export function withLogEntry(state: GameState, entry: GameLogEntry): GameState {
  return {
    ...state,
    log: state.log.map((existing) => (existing.id === entry.id ? entry : existing)),
  }
}

/** Bytter ut én spillerhånd og lar resten stå. */
export function withPlayer(state: GameState, player: Playerhand): GameState {
  return {
    ...state,
    players: state.players.map((existing) =>
      existing.playerId === player.playerId ? player : existing,
    ),
  }
}

// ---------------------------------------------------------------------------
// Projeksjoner — hva en gitt spiller får se
// ---------------------------------------------------------------------------

/** Det andre spillere får se av en hånd: antall, ikke innhold. */
export interface OpaquePlayerhand {
  readonly playerId: string
  readonly username: string
  readonly color: string | null
  readonly playernumber: number
  readonly gameCreator: boolean
  readonly yourTurn: boolean
  /** Sivilisasjonen er offentlig så snart den er avslørt. */
  readonly civilization: CivItem | null
  readonly numberOfItemsInHand: number
  readonly numberOfTechsChosen: number
  readonly numberOfBarbarians: number
  readonly numberOfSocialPolicies: number
  /** Battlehand avsløres eksplisitt under kamp, så den vises som den er. */
  readonly battlehand: readonly UnitItem[]
  /**
   * Kun avslørte teknologier. Java: `getTechsForAllPlayers` filtrerte på
   * `!isHidden()`, som er hvordan tech-pyramiden blir offentlig.
   */
  readonly revealedTechs: readonly TechItem[]
  /**
   * Turordrene som er delt offentlig. `gamenote` og `playerTurns` er private
   * og finnes ikke her.
   */
  readonly publicTurns: readonly PlayerTurn[]
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
  }
}

/** Én loggpost slik alle kan se den. Innholdet i itemet er borte. */
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

/**
 * Spilltilstanden sett fra én spiller: egen hånd i klartekst, andres som tall,
 * stokken kun som antall, og logg der andres trekk bare finnes i offentlig
 * form.
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
  readonly you: Playerhand | null
  readonly opponents: readonly OpaquePlayerhand[]
  readonly techs: readonly TechItem[]
  /** Brettet er offentlig — alle ser de samme brikkene. */
  readonly board: Board
  readonly log: readonly (PublicLogEntry | GameLogEntry)[]
}

export function toPlayerView(state: GameState, viewerId: string): PlayerView {
  const you = findPlayer(state, viewerId) ?? null
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
    log: state.log.map((entry) =>
      entry.playerId === viewerId ? entry : toPublicLog(entry),
    ),
  }
}
