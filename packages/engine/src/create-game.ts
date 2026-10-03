/**
 * Port of `PBFTestAction.createNewGame` — the fixture the old tests ran
 * against, and therefore the reference for this port.
 *
 * `GameAction.createNewGame` in the production code puts the same items in the
 * pbf. The only difference is the order they are added in, which only affects
 * the `itemNumber` each item gets. The order below follows PBFTestAction.
 */

import gamedataWaw from '../data/gamedata-faf-waw.json' with { type: 'json' }

import { createBoardForPlayers } from './board.js'
import type { GameDataFile, GreatPersonReference, WonderReference } from './gamedata.js'
import { greatPersonReference, readDeck, wonderReference } from './gamedata.js'
import type { Item, SocialPolicyItem, TechItem } from './item.js'
import type { Rng } from './random.js'
import { nextIntBetween, nextId, seedFrom } from './random.js'
import { deriveLogSecret } from './log.js'
import type { GameState, GameType, Playerhand } from './state.js'
import { DEFAULT_PLAYER_STATS } from './state.js'
import { DEFAULT_GOVERNMENT } from './government.js'

/** Every great person's printed text in print order, computed once for the menu reference. */
export const GREAT_PERSON_REFERENCE: readonly GreatPersonReference[] = greatPersonReference(
  gamedataWaw as GameDataFile,
)

const GAMEDATA: Readonly<Record<GameType, GameDataFile>> = {
  WAW: gamedataWaw as GameDataFile,
}

/**
 * Every wonder's printed text, by name — a player aid, computed once, not
 * per game. Unlike `TECH_TEXT` (`packages/web/src/views/techText.ts`, which
 * has to be transcribed because the sheet's tech Description column was
 * never filled in), the Wonders sheet's Description column is populated, so
 * this reads straight from `gamedataWaw` rather than inventing wording.
 */
const WONDER_ENTRIES = wonderReference(GAMEDATA.WAW)

export const WONDER_DESCRIPTIONS: Readonly<Record<string, string>> = Object.fromEntries(
  WONDER_ENTRIES
    .filter((entry): entry is WonderReference & { description: string } =>
      entry.description !== null && entry.description !== '',
    )
    .map((entry): readonly [string, string] => [entry.name, entry.description]),
)

/** The level a wonder is printed at: Ancient is 1, Medieval 2, Modern 3. */
const WONDER_LEVEL_BY_TYPE: Readonly<Record<WonderReference['type'], 1 | 2 | 3>> = {
  Ancient: 1,
  Medieval: 2,
  Modern: 3,
}

/** Every wonder's level by name, computed once from the Wonders sheet. */
export const WONDER_LEVELS: Readonly<Record<string, 1 | 2 | 3>> = Object.fromEntries(
  WONDER_ENTRIES.map((entry): readonly [string, 1 | 2 | 3] => [
    entry.name,
    WONDER_LEVEL_BY_TYPE[entry.type],
  ]),
)

/** A wonder's name without a leading "The", so "The Pyramids" files under P. */
const wonderSortName = (name: string): string => name.replace(/^The /, '')

/**
 * Orders wonders by level (1, 2, 3) and alphabetically within a level. A name
 * the sheet does not know sorts after the known ones, alphabetically.
 */
export function compareWonderNames(a: string, b: string): number {
  const levelA = WONDER_LEVELS[a] ?? Number.POSITIVE_INFINITY
  const levelB = WONDER_LEVELS[b] ?? Number.POSITIVE_INFINITY
  if (levelA !== levelB) return levelA < levelB ? -1 : 1
  return wonderSortName(a).localeCompare(wonderSortName(b), 'en')
}

export interface NewPlayer {
  readonly playerId: string
  readonly username: string
  readonly email?: string
  readonly color?: string
  readonly gameCreator?: boolean
  readonly yourTurn?: boolean
}

export interface CreateGameOptions {
  readonly name: string
  readonly numOfPlayers: number
  readonly gameType?: GameType
  /** Seed for shuffling and itemNumber. A string gives the same game every time. */
  readonly seed: Rng | string
  readonly players?: readonly NewPlayer[]
  /**
   * Keys the numbers in the public log for hidden techs and social policies.
   * The server passes a random value. Without one it is derived from the seed,
   * which is enough for tests but as guessable as the seed itself.
   */
  readonly secret?: string
  /**
   * When the game was created. The engine is pure, so the caller passes the
   * timestamp; `null` when it has none (the old client never carried one).
   */
  readonly createdAt?: string | null
}

export function emptyPlayerhand(player: NewPlayer, playernumber: number): Playerhand {
  return {
    playerId: player.playerId,
    username: player.username,
    email: player.email ?? null,
    color: player.color ?? null,
    playernumber,
    gameCreator: player.gameCreator ?? false,
    yourTurn: player.yourTurn ?? false,
    civilization: null,
    items: [],
    techsChosen: [],
    pyramidPlacements: [],
    barbarians: [],
    battlehand: [],
    socialPolicies: [],
    playerTurns: [],
    gamenote: null,
    stats: DEFAULT_PLAYER_STATS,
    government: DEFAULT_GOVERNMENT,
  }
}

export function createGame(options: CreateGameOptions): GameState {
  const gameType = options.gameType ?? 'WAW'
  const data = GAMEDATA[gameType]

  const seed = typeof options.seed === 'string' ? seedFrom(options.seed) : options.seed

  // Java: `itemCounter = new AtomicInteger(RandomUtils.nextInt(1, 20))`, a
  // static counter with a random start. The offset stays random per game so
  // itemNumber cannot be used to guess which card another game was dealt.
  const [startCounter, afterOffset] = nextIntBetween(seed, 1, 20)
  const [gameId, afterId] = nextId(afterOffset)

  const deck = readDeck(data, afterId, startCounter)

  // This order decides the itemNumber, and follows PBFTestAction
  const items: Item[] = [
    ...deck.mounted,
    ...deck.aircraft,
    ...deck.artillery,
    ...deck.infantry,
    ...deck.civs,
    ...deck.cultureI,
    ...deck.cultureII,
    ...deck.cultureIII,
    ...deck.greatPersons,
    ...deck.huts,
    ...deck.villages,
    ...deck.tiles,
    ...deck.cityStates,
    ...deck.ancientWonders,
    ...deck.medievalWonders,
    ...deck.modernWonders,
  ]

  // Java: items, then techs, then socialPolicies — all from the same counter
  let counter = deck.itemCounter
  const numbered = <T extends Item>(list: readonly T[]): T[] =>
    list.map((item) => {
      counter += 1
      return { ...item, itemNumber: counter }
    })

  const numberedItems = numbered(items)
  const numberedTechs = numbered<TechItem>(deck.techs)
  const numberedPolicies = numbered<SocialPolicyItem>(deck.socialPolicies)

  return {
    id: gameId,
    name: options.name,
    gameType,
    createdAt: options.createdAt ?? null,
    numOfPlayers: options.numOfPlayers,
    active: true,
    winner: null,
    items: numberedItems,
    discardedItems: [],
    withdrawnPlayers: [],
    publicTurns: {},
    // Each player count gets the board the rulebooks draw: the half-height
    // 16 × 8 for two, the stepped pyramid for three, the holed 28 × 18 for
    // five, and the full 16 × 16 for one and four.
    board: createBoardForPlayers(options.numOfPlayers),
    players: (options.players ?? []).map((player, index) =>
      emptyPlayerhand(player, index + 1),
    ),
    techs: numberedTechs,
    socialPolicies: numberedPolicies,
    log: [],
    rng: deck.rng,
    logSecret: options.secret ?? deriveLogSecret(seed, gameId),
    itemCounter: counter,
    wondersDealt: false,
    chatOrdersStartTurn: 1,
    startPlayerId: null,
    // Nothing to copy: a new game writes its orders to the timeline itself
    legacyOrdersCopied: true,
    turnStarters: {},
    battle: null,
    rev: 0,
  }
}
