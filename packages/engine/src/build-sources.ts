/**
 * Where the production for a build can come from besides the city itself (#352): a We Love the ... Day! card from the
 * hand (4, 6 or 8 hammers) and a tech production boost (Animal Husbandry 3, Construction 5, Banking 7, Plastics 10, each
 * for a Wheat). Build offers these as ways to pay, so the player does not press Play on a card first and then find the
 * hand space spent on something else: the cards and boosts that are needed are used together with the build, each as an
 * action record of its own (`assisted.ts`, `embedCards`), so an opponent can still cancel the card.
 *
 * The arithmetic lives here and is pure: for an item with a cost, a production and the sources, which sets of cards and
 * boosts make a difference to the trade the build costs. Only the viewer's own options carry the cards (the hand is private).
 */

import { openCityManagementTurn, techBlock, waitingCardIds } from './assisted-core.js'
import { resourcePaymentOptions } from './assisted-resources.js'
import { itemName } from './item.js'
import { PRODUCTION_BOOSTS, WE_LOVE_HAMMERS } from './hammer-data.js'
import { rushTradeCost } from './build-options.js'
import type { AssistedActionKind, GameState, Playerhand } from './state.js'

/** A We Love card in the player's hand. */
export interface HammerCard {
  readonly itemId: string
  readonly name: string
  readonly hammers: number
}

/** A tech boost the player can use now, and the action it is. */
export interface HammerBoost {
  readonly tech: string
  readonly kind: AssistedActionKind
  readonly hammers: number
}

/** What the player could use for production now. The viewer's own view only: it names cards in the hand. */
export interface HammerSources {
  readonly cards: readonly HammerCard[]
  readonly boosts: readonly HammerBoost[]
  /** How many boosts the player has the Wheat for: the most that can be used together. */
  readonly wheat: number
}

export const NO_SOURCES: HammerSources = { cards: [], boosts: [], wheat: 0 }

/** The cards and boosts that can give the player's cities hammers now. Empty outside the player's open City Management. */
export function hammerSourcesOf(state: GameState, player: Playerhand): HammerSources {
  const turn = openCityManagementTurn(state, player)
  if (turn === undefined) return NO_SOURCES
  const waiting = waitingCardIds(player)
  const cards = player.items.flatMap((item): readonly HammerCard[] => {
    if (!item.kind.startsWith('culture') || waiting.has(item.id)) return []
    const name = itemName(item)
    const hammers = WE_LOVE_HAMMERS.get(name)
    return hammers === undefined ? [] : [{ itemId: item.id, name, hammers }]
  })
  const wheat = resourcePaymentOptions(state, player.playerId, ['Wheat']).length
  const boosts =
    wheat === 0
      ? []
      : PRODUCTION_BOOSTS.flatMap((spec): readonly HammerBoost[] =>
          techBlock(player, spec.techName) === undefined && !turn.usedActions.includes(`card:${spec.techName}`)
            ? [{ tech: spec.techName, kind: spec.kind, hammers: spec.amount }]
            : [],
        )
  return cards.length === 0 && boosts.length === 0 ? NO_SOURCES : { cards, boosts, wheat }
}

/** One way to pay for an item: the cards and boosts used, the hammers they give and the trade still to pay. */
export interface BuildPayOption {
  /** A stable key: `none`, or the names of what is used, so it survives a refresh of the options. */
  readonly id: string
  readonly cards: readonly HammerCard[]
  readonly boosts: readonly { readonly tech: string; readonly hammers: number }[]
  readonly hammers: number
  readonly tradeToPay: number
}

/** What a set of cards and boosts is called, in a log line and as an option key. */
export const sourceNames = (cards: readonly { readonly name: string }[], boosts: readonly { readonly tech: string }[]): string[] => [
  ...cards.map((card) => card.name).sort(),
  ...boosts.map((boost) => boost.tech).sort(),
]

const tradeWith = (cost: number, production: number, hammers: number, civilization: string | null | undefined): number =>
  rushTradeCost(Math.max(0, cost - production - hammers), civilization)

/** The most options listed for one item. */
const MAX_OPTIONS = 12

/** Whether every piece of the set lowers the trade: taking any one of them out would make the build cost more. */
function allNeeded(
  parts: readonly number[],
  cost: number,
  production: number,
  civilization: string | null | undefined,
): boolean {
  const total = parts.reduce((sum, part) => sum + part, 0)
  const trade = tradeWith(cost, production, total, civilization)
  return parts.every((part) => tradeWith(cost, production, total - part, civilization) > trade)
}

/**
 * The ways to pay `cost` from `production` with the player's trade and these sources, each of which uses only what is
 * needed (every card and boost lowers the trade), cheapest in cards first: no source at all first when the trade alone
 * covers it. Two cards of one name are one option. Empty when nothing the player holds is enough.
 */
export function payOptionsFor(
  cost: number,
  production: number,
  sources: HammerSources,
  trade: number,
  civilization: string | null | undefined,
): readonly BuildPayOption[] {
  const groups = new Map<string, HammerCard[]>()
  for (const card of sources.cards) groups.set(card.name, [...(groups.get(card.name) ?? []), card])
  const groupList = [...groups.values()]
  const options: BuildPayOption[] = []

  const visit = (index: number, cards: readonly HammerCard[]): void => {
    if (index < groupList.length) {
      const group = groupList[index] ?? []
      for (let count = 0; count <= group.length; count += 1) visit(index + 1, [...cards, ...group.slice(0, count)])
      return
    }
    const limit = Math.min(sources.boosts.length, sources.wheat)
    const pick = (start: number, boosts: readonly HammerBoost[]): void => {
      const parts = [...cards.map((card) => card.hammers), ...boosts.map((boost) => boost.hammers)]
      const hammers = parts.reduce((sum, part) => sum + part, 0)
      const owed = tradeWith(cost, production, hammers, civilization)
      if (owed <= trade && allNeeded(parts, cost, production, civilization)) {
        const names = sourceNames(cards, boosts.map((boost) => ({ tech: boost.tech })))
        options.push({
          id: names.length === 0 ? 'none' : names.join(' + '),
          cards,
          boosts: boosts.map((boost) => ({ tech: boost.tech, hammers: boost.hammers })),
          hammers,
          tradeToPay: owed,
        })
      }
      if (boosts.length >= limit) return
      for (let next = start; next < sources.boosts.length; next += 1) {
        const boost = sources.boosts[next]
        if (boost !== undefined) pick(next + 1, [...boosts, boost])
      }
    }
    pick(0, [])
  }
  visit(0, [])

  options.sort(
    (a, b) =>
      a.cards.length + a.boosts.length - (b.cards.length + b.boosts.length) ||
      a.tradeToPay - b.tradeToPay ||
      a.hammers - b.hammers ||
      a.id.localeCompare(b.id),
  )
  return options.slice(0, MAX_OPTIONS)
}

/** The verdict on a set the player chose: its trade, or the sentence saying why it is refused. */
export function judgeSelection(
  cost: number,
  production: number,
  chosenCards: readonly HammerCard[],
  chosenBoosts: readonly HammerBoost[],
  trade: number,
  civilization: string | null | undefined,
): { readonly ok: true; readonly tradeToPay: number } | { readonly ok: false; readonly reason: string } {
  const parts = [...chosenCards.map((card) => card.hammers), ...chosenBoosts.map((boost) => boost.hammers)]
  const hammers = parts.reduce((sum, part) => sum + part, 0)
  const owed = tradeWith(cost, production, hammers, civilization)
  if (owed > trade) {
    return { ok: false, reason: `Even with ${hammers} more hammers covering the missing production takes ${owed} trade and you have ${trade}.` }
  }
  const idle = [...chosenCards.map((card) => ({ name: card.name, hammers: card.hammers })), ...chosenBoosts.map((boost) => ({ name: boost.tech, hammers: boost.hammers }))].find(
    (part) => tradeWith(cost, production, hammers - part.hammers, civilization) <= owed,
  )
  if (idle !== undefined) return { ok: false, reason: `${idle.name} is not needed for this build, so it is not used. Choose only what the build needs.` }
  return { ok: true, tradeToPay: owed }
}
