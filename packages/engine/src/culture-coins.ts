/**
 * The culture events that make other players discard a coin token: Counterfeiters (one
 * player), Depression (up to two) and Bank Scandal (every other player). The player of the
 * card chooses, for each target, the counter that loses its coin, as for Mysticism.
 *
 * Only coin tokens go: the counters of `INVESTABLE_COIN_SOURCES`. A printed coin (Civil
 * Service, Bank, ...), Great People coins, the Panama Canal and invested markers are never
 * touched ("this cannot affect investments"). A target with no coin token is skipped, and a
 * card that has no target with one cannot be played.
 */

import { coinSourcesOf, findCoinSource, totalCoins, withCoinSource } from './coins.js'
import type { CoinSourceKey } from './coins.js'
import { INVESTABLE_COIN_SOURCES } from './sot.js'
import { err, ok } from './result.js'
import type { Result } from './result.js'
import type { GameState, Playerhand } from './state.js'
import { withPlayer } from './state.js'

export const COIN_DISCARD_CARDS: ReadonlySet<string> = new Set(['Counterfeiters', 'Depression', 'Bank Scandal'])

/** One counter that holds coin tokens, with how many. */
export interface CoinCounter {
  readonly key: CoinSourceKey
  readonly label: string
  readonly coins: number
}

/** A player who holds coin tokens, and on which counters. Public status board data. */
export interface CoinTarget {
  readonly playerId: string
  readonly username: string
  readonly counters: readonly CoinCounter[]
}

/** What the player of the card chose for one target. */
export interface CoinPick {
  readonly targetId: string
  readonly source: string
}

/** What the card took, kept on the record so an undo gives every coin back to the same counter. */
export interface CoinDiscard {
  readonly targetId: string
  readonly source: CoinSourceKey
}

/** The counters of the player that hold a coin token, in the order of the status board. */
export function coinCountersOf(state: GameState, player: Playerhand): readonly CoinCounter[] {
  const held = coinSourcesOf(state, player)
  return INVESTABLE_COIN_SOURCES.flatMap((key) => (held[key] > 0 ? [{ key, label: findCoinSource(key)?.label ?? key, coins: held[key] }] : []))
}

/** The players among `players` who hold at least one coin token. */
export function coinTargetsOf(state: GameState, players: readonly Playerhand[]): readonly CoinTarget[] {
  return players.flatMap((player) => {
    const counters = coinCountersOf(state, player)
    return counters.length === 0 ? [] : [{ playerId: player.playerId, username: player.username, counters }]
  })
}

const joinNames = (names: readonly string[]): string =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`

export interface AppliedCoinDiscard {
  readonly state: GameState
  readonly discarded: readonly CoinDiscard[]
  /** The end of the public line. */
  readonly said: string
}

/**
 * Takes one coin from each named player who holds one. `picks` says which counter, for a target
 * with tokens on more than one; with one counter it is taken without a pick.
 */
export function applyCoinDiscard(
  state: GameState,
  cardName: string,
  named: readonly Playerhand[],
  picks: readonly CoinPick[] | undefined,
): Result<AppliedCoinDiscard, string> {
  const holders = coinTargetsOf(state, named)
  if (holders.length === 0) {
    return err(
      named.length === 1
        ? `${named[0]?.username ?? 'That player'} holds no coin token to discard.`
        : `None of the players ${cardName} names holds a coin token, so there is nothing to discard.`,
    )
  }
  const chosen = picks ?? []
  if (!Array.isArray(chosen)) return err('Choose the coin token each player discards.')
  const seen = new Set<string>()
  for (const pick of chosen) {
    const holder = holders.find((candidate) => candidate.playerId === pick.targetId)
    if (holder === undefined) return err('Choose a coin token only for a player the card names who holds one.')
    if (seen.has(pick.targetId)) return err(`Choose one coin token for ${holder.username}, not several.`)
    seen.add(pick.targetId)
    if (!holder.counters.some((counter) => counter.key === pick.source)) {
      return err(`${holder.username} holds no coin token on ${findCoinSource(pick.source)?.label ?? pick.source}.`)
    }
  }

  const discarded: CoinDiscard[] = []
  const parts: string[] = []
  let working = state
  for (const holder of holders) {
    const pick = chosen.find((candidate) => candidate.targetId === holder.playerId)
    const counter =
      pick !== undefined
        ? holder.counters.find((candidate) => candidate.key === pick.source)
        : holder.counters.length === 1
          ? holder.counters[0]
          : undefined
    if (counter === undefined) {
      return err(`Choose which coin token ${holder.username} discards: ${holder.counters.map((candidate) => `${candidate.label} (${candidate.coins})`).join(', ')}.`)
    }
    const target = working.players.find((candidate) => candidate.playerId === holder.playerId)
    if (target === undefined) return err('The other player is no longer in the game.')
    const lowered: Playerhand = {
      ...target,
      stats: {
        ...target.stats,
        coinSources: withCoinSource(target.stats.coinSources, counter.key, target.stats.coinSources[counter.key] - 1),
      },
    }
    working = withPlayer(working, lowered)
    discarded.push({ targetId: holder.playerId, source: counter.key })
    parts.push(`${holder.username} discards a coin from ${counter.label} (${totalCoins(coinSourcesOf(working, lowered))} left)`)
  }
  const skipped = named.filter((player) => !holders.some((holder) => holder.playerId === player.playerId))
  return ok({
    state: working,
    discarded,
    said:
      `, so ${joinNames(parts)}` +
      (skipped.length === 0 ? '' : `; ${joinNames(skipped.map((player) => player.username))} ${skipped.length === 1 ? 'holds' : 'hold'} no coin token`),
  })
}

/** Gives every coin back to the counter it came from. `Err` when a player has left the game. */
export function restoreCoinDiscard(state: GameState, discarded: readonly CoinDiscard[]): Result<GameState, string> {
  let working = state
  for (const entry of discarded) {
    const target = working.players.find((candidate) => candidate.playerId === entry.targetId)
    if (target === undefined) return err('A player who discarded a coin is no longer in the game.')
    working = withPlayer(working, {
      ...target,
      stats: {
        ...target.stats,
        coinSources: withCoinSource(target.stats.coinSources, entry.source, target.stats.coinSources[entry.source] + 1),
      },
    })
  }
  return ok(working)
}
