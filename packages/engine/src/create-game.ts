/**
 * Port of `PBFTestAction.createNewGame` — the fixture the old tests ran
 * against, and therefore the reference for this port.
 *
 * `GameAction.createNewGame` in the production code puts the same items in the
 * pbf. The only difference is the order they are added in, which only affects
 * the `itemNumber` each item gets. The order below follows PBFTestAction.
 */

import gamedataWaw from '../data/gamedata-faf-waw.json' with { type: 'json' }

import { createBoard } from './board.js'
import type { GameDataFile } from './gamedata.js'
import { readDeck } from './gamedata.js'
import type { Item, SocialPolicyItem, TechItem } from './item.js'
import type { Rng } from './random.js'
import { nextIntBetween, nextId, seedFrom } from './random.js'
import type { GameState, GameType, Playerhand } from './state.js'

const GAMEDATA: Readonly<Record<GameType, GameDataFile>> = {
  WAW: gamedataWaw as GameDataFile,
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
    barbarians: [],
    battlehand: [],
    socialPolicies: [],
    playerTurns: [],
    gamenote: null,
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
    numOfPlayers: options.numOfPlayers,
    active: true,
    winner: null,
    items: numberedItems,
    discardedItems: [],
    withdrawnPlayers: [],
    publicTurns: {},
    board: createBoard(),
    players: (options.players ?? []).map((player, index) =>
      emptyPlayerhand(player, index + 1),
    ),
    techs: numberedTechs,
    socialPolicies: numberedPolicies,
    log: [],
    rng: deck.rng,
    itemCounter: counter,
  }
}
