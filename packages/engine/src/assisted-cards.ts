/**
 * Playing a culture event or a Great Person card (assisted play, part 13).
 *
 * The game does exactly two things for the player: it takes the card out of the hand
 * (to the discard pile, or turned faceup for a Great Person that stays), and it
 * writes a public line saying who played what, against whom and as which resource.
 * It does not apply the card. Other players can cancel a card, and most effects
 * (kill a figure, destroy a building, discard a coin) need a choice on the map, so
 * the player carries the effect out by hand once nobody cancels it (the human's
 * decision, 2026-10-23).
 *
 * Which cards can be played, and when, is read from the card's own effect text (see
 * `card-timing.ts`). The list is own view only, because it names cards in the hand.
 */

import { TRADE_CEILING } from './limits.js'
import { placeStartMarker } from './actions/board.js'
import { unbuiltArmies } from './assisted-abilities.js'
import { drawCandidates, shuffleSheetTwice } from './assisted-culture.js'
import { unitSheetOf } from './build-options.js'
import { blockadedGreatPersonTypes } from './blockade.js'
import { READY, blocked, lastLogId, playerOf, rejected, withPlayerHand } from './assisted-core.js'
import type { AssistedActionDefinition } from './assisted-core.js'
import {
  AUTOMATIC_EFFECTS,
  CARDS_WITH_OWN_BUTTON,
  CARD_TIMING_TEXT,
  cardPlayRuleOf,
  discardsWhenUsed,
  timingsOf,
} from './card-timing.js'
import type { CardTiming, PlayableCard } from './card-timing.js'
import { err, ok } from './result.js'
import type { Result } from './result.js'
import { itemName } from './item.js'
import type { Item } from './item.js'
import { appendLog } from './log.js'
import type { AssistedEffect, GameState, Playerhand } from './state.js'
import { startPlayerOf, turnStatus } from './turn.js'
import type { TurnPhase } from './turn.js'

const KIND_OF: Readonly<Partial<Record<Item['kind'], PlayableCard['kind']>>> = {
  cultureI: 'culture',
  cultureII: 'culture',
  cultureIII: 'culture',
  greatperson: 'greatPerson',
}

/** The phase the player is working on: the first not marked done, `null` once every phase is done. */
export function currentPhaseOf(state: GameState, playerId: string): TurnPhase | null {
  return turnStatus(state).players.find((candidate) => candidate.playerId === playerId)?.phase ?? null
}

const timingsText = (timings: readonly CardTiming[]): string =>
  timings.map((timing) => CARD_TIMING_TEXT[timing]).join(' or ')

/** Whether a card with these timings can be played while the player is in `now`, and why or why not. */
function playableIn(
  timings: readonly CardTiming[],
  now: TurnPhase | null,
): { readonly status: 'ready' | 'wrong-phase'; readonly reason: string } {
  if (timings.includes('ANY')) return { status: 'ready', reason: 'Can be played at any time.' }
  if (now !== null && timings.includes(now)) {
    return { status: 'ready', reason: `Can be played in ${CARD_TIMING_TEXT[now]}, which you are in.` }
  }
  if (timings.length === 1 && timings[0] === 'BATTLE') {
    return { status: 'wrong-phase', reason: 'Played during a battle.' }
  }
  const where =
    now === null ? 'You have finished every phase of this turn.' : `You are in ${CARD_TIMING_TEXT[now]}.`
  return { status: 'wrong-phase', reason: `Played in ${timingsText(timings)}. ${where}` }
}

/**
 * The cards of the player's hand that can be played at some time, with whether each
 * can be played now. A card with no timing in its text (a passive Great Person) is
 * not listed. A Great Person whose tokens are all blockaded cannot be used (FAQ 2.0).
 */
export function playableCardsOf(state: GameState, player: Playerhand): readonly PlayableCard[] {
  const now = currentPhaseOf(state, player.playerId)
  const blockaded = blockadedGreatPersonTypes(state, player)
  // The cards drawn for a choice are in the hand until one is kept: none of them is the player's yet
  const waiting = new Set(player.pendingRewards.flatMap((reward) => reward.candidateIds))
  return player.items.flatMap((item): readonly PlayableCard[] => {
    const kind = KIND_OF[item.kind]
    if (kind === undefined || item.description === null || item.description === undefined) return []
    const timings = timingsOf(item.description)
    if (timings.length === 0) return []
    const name = itemName(item)
    if (item.kind === 'greatperson' && CARDS_WITH_OWN_BUTTON.has(name)) return []
    const rule = cardPlayRuleOf(name)
    const base = {
      itemId: item.id,
      name,
      kind,
      description: item.description,
      timings,
      targets: rule.targets,
      prompt: rule.prompt,
      resources: rule.resources,
      automatic: kind === 'greatPerson' ? (AUTOMATIC_EFFECTS.get(name) ?? null) : null,
      discards: kind === 'culture' || discardsWhenUsed(item.description),
    }
    if (waiting.has(item.id)) {
      return [
        {
          ...base,
          status: 'unavailable',
          reason: `${name} is one of the cards you are choosing between. Choose the card to keep first.`,
        },
      ]
    }
    if (item.kind === 'greatperson' && item.type !== null && blockaded.includes(item.type)) {
      return [
        {
          ...base,
          status: 'unavailable',
          reason: `Every ${item.type} figure of yours is blockaded, so ${name} cannot be used.`,
        },
      ]
    }
    return [{ ...base, ...playableIn(timings, now) }]
  })
}

const joinNames = (names: readonly string[]): string =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`

type PlayCardEffect = Extract<AssistedEffect, { readonly kind: 'playCard' }>

interface Automated {
  readonly state: GameState
  readonly extra: Pick<PlayCardEffect, 'gain' | 'drew' | 'starter'>
  /** The end of the public line: what the game did for the card. */
  readonly said: string
}

/**
 * The effects of a Great Person card the game can carry out itself, because they need
 * no choice on the map: trade or culture gained, or a unit card drawn. Every other card
 * is only logged and discarded, and the player does the rest by hand. `Err` is a
 * sentence for the player, and then the card stays in the hand.
 */
function automate(state: GameState, player: Playerhand, name: string, at: string | undefined): Result<Automated | null, string> {
  const gained = (trade: number, culture: number, said: string): Result<Automated, string> =>
    ok({
      state: withPlayerHand(state, {
        ...player,
        stats: { ...player.stats, trade: player.stats.trade + trade, culture: player.stats.culture + culture },
      }),
      extra: { gain: { trade, culture } },
      said,
    })
  switch (name) {
    case 'Marco Polo': {
      const trade = Math.max(0, Math.min(TRADE_CEILING, player.stats.trade + 27) - player.stats.trade)
      return gained(trade, 0, `, gaining ${trade} trade`)
    }
    case 'St. Francis of Assisi': {
      const armies = unbuiltArmies(state, player)
      return gained(0, armies * 3, `, gaining ${armies * 3} culture for ${armies} unbuilt ${armies === 1 ? 'army' : 'armies'}`)
    }
    case 'Orville Wright': {
      const sheetName = unitSheetOf('aircraft')
      const drawn = drawCandidates(state, sheetName, 1)
      const first = drawn.ok ? drawn.value.items[0] : undefined
      if (!drawn.ok || first === undefined) return err('No aircraft unit cards are left in the deck or the discard pile.')
      const card = { ...first, ownerId: player.playerId, hidden: true }
      const holder = playerOf(drawn.value.state, player.playerId) ?? player
      return ok({
        state: withPlayerHand(drawn.value.state, { ...holder, items: [...holder.items, card] }),
        extra: { drew: { itemId: card.id, sheetName } },
        said: ', building an aircraft unit for free',
      })
    }
    case 'Khalid ibn al-Walid': {
      const current = startPlayerOf(state)
      if (current === undefined || current.playerId === player.playerId) {
        return ok({ state, extra: {}, said: `, but ${player.username} was already the start player` })
      }
      const moved = placeStartMarker(state, player, player.playerId, at)
      const entry = moved.board.history.at(-1)
      if (moved === state || entry === undefined) return err('The start player marker could not be moved to your area.')
      return ok({
        state: { ...moved, startPlayerId: player.playerId },
        extra: { starter: { from: current.playerId, historyId: entry.id } },
        said: `, becoming the start player (next turn passes clockwise from ${player.username})`,
      })
    }
    default:
      return ok(null)
  }
}

export const playCard: AssistedActionDefinition = {
  kind: 'playCard',
  techName: null,
  label: 'Play a card',
  button: false,
  usageKey: null,
  phase: 'ANY',
  group: 'Cards',
  labelOf: (record) => (record.effect.kind === 'playCard' ? record.effect.name : 'Play a card'),

  // Which card can be played depends on the card chosen, so `apply` decides with the
  // payload and says why in its own words; a player is always allowed to try.
  availability(state, playerId) {
    return playerOf(state, playerId) === undefined
      ? blocked('unavailable', 'You are not a player in this game.')
      : READY
  },

  apply(state, player, context) {
    const payload = context.payload
    if (payload === undefined || !('itemId' in payload) || !('targets' in payload) || !Array.isArray(payload.targets)) {
      return err(rejected('playCard', blocked('unavailable', 'Choose the card to play.')))
    }
    const card = playableCardsOf(state, player).find((candidate) => candidate.itemId === payload.itemId)
    if (card === undefined) {
      return err(rejected('playCard', blocked('unavailable', 'That card is not in your hand, or cannot be played.')))
    }
    if (card.status !== 'ready') return err(rejected('playCard', blocked(card.status, card.reason)))

    // Who the card names: every other player for a card that hits all, else the choice
    const others = state.players.filter((candidate) => candidate.playerId !== player.playerId)
    const named =
      card.targets.kind === 'allOthers'
        ? others
        : card.targets.kind === 'none'
          ? []
          : payload.targets.map((id) => others.find((candidate) => candidate.playerId === id))
    if (named.some((target) => target === undefined) || new Set(payload.targets).size !== payload.targets.length) {
      return err(rejected('playCard', blocked('unavailable', 'Choose other players of this game, each once.')))
    }
    const targets = named.filter((target): target is Playerhand => target !== undefined)
    if (card.targets.kind === 'none' && payload.targets.length > 0) {
      return err(rejected('playCard', blocked('unavailable', `${card.name} names no player.`)))
    }
    if (card.targets.kind === 'players' && (targets.length < card.targets.min || targets.length > card.targets.max)) {
      const { min, max } = card.targets
      const wanted = min === max ? `${min}` : `${min} to ${max}`
      return err(rejected('playCard', blocked('unavailable', `${card.name} names ${wanted} other player${max === 1 ? '' : 's'}.`)))
    }

    // The resource a card is played as
    const resource = payload.resource ?? null
    if (card.resources.length > 0) {
      if (resource === null || !card.resources.includes(resource)) {
        return err(rejected('playCard', blocked('unavailable', `Choose a resource: ${card.resources.join(', ')}.`)))
      }
    } else if (resource !== null) {
      return err(rejected('playCard', blocked('unavailable', `${card.name} is not played as a resource.`)))
    }

    const item = player.items.find((candidate) => candidate.id === card.itemId)
    if (item === undefined) {
      return err(rejected('playCard', blocked('unavailable', 'That card is not in your hand.')))
    }
    const now = currentPhaseOf(state, player.playerId)
    const when = card.timings.includes('ANY') ? CARD_TIMING_TEXT.ANY : CARD_TIMING_TEXT[now ?? 'SOT']

    // The card leaves the hand: to the discard pile, or faceup in place for a Great Person that stays
    const moved: GameState = card.discards
      ? {
          ...withPlayerHand(state, { ...player, items: player.items.filter((candidate) => candidate.id !== item.id) }),
          discardedItems: [...state.discardedItems, { ...item, hidden: true }],
        }
      : withPlayerHand(state, {
          ...player,
          items: player.items.map((candidate) => (candidate.id === item.id ? { ...candidate, hidden: false } : candidate)),
        })

    const automated =
      card.kind === 'greatPerson'
        ? automate(moved, playerOf(moved, player.playerId) ?? player, card.name, context.at)
        : ok<Automated | null>(null)
    if (!automated.ok) return err(rejected('playCard', blocked('unavailable', automated.error)))
    const after = automated.value?.state ?? moved

    const verb = card.kind === 'culture' ? 'played' : card.discards ? 'played' : 'used'
    const aimed =
      card.targets.kind === 'allOthers'
        ? ', targeting every other player'
        : targets.length > 0
          ? `, targeting ${joinNames(targets.map((target) => target.username))}`
          : ''
    const logged = appendLog(after, {
      username: player.username,
      playerId: player.playerId,
      publicLog:
        `${player.username} ${verb} ${card.name} (${when})` +
        (resource === null ? '' : ` as ${resource}`) +
        aimed +
        (card.discards && card.kind === 'greatPerson' ? ' and discarded it' : '') +
        (automated.value === null ? '' : automated.value.said),
      privateLog: '',
      createdAt: context.at ?? null,
      assistedActionId: context.requestId,
    })
    return ok({
      state: logged,
      effect: {
        kind: 'playCard',
        item,
        discarded: card.discards,
        targets: targets.map((target) => target.playerId),
        resource,
        name: card.name,
        ...automated.value?.extra,
      },
      logId: lastLogId(logged),
    })
  },

  reverse(state, player, record, at) {
    const effect = record.effect
    if (effect.kind !== 'playCard') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    const blockedBy = (reason: string) => err({ kind: 'ASSISTED_UNDO_BLOCKED' as const, logId: record.logId, reason })

    // What the game did besides logging goes first, checked before anything changes
    const drewCard = effect.drew === undefined ? undefined : player.items.find((candidate) => candidate.id === effect.drew?.itemId)
    if (effect.drew !== undefined && drewCard === undefined) {
      return blockedBy(`The unit card ${effect.name} gave is no longer in ${player.username}'s hand.`)
    }
    if (effect.discarded && !state.discardedItems.some((candidate) => candidate.id === effect.item.id)) {
      return blockedBy(`${effect.name} is no longer in the discard pile.`)
    }
    if (!effect.discarded && !player.items.some((candidate) => candidate.id === effect.item.id)) {
      return blockedBy(`${effect.name} has left ${player.username}'s hand.`)
    }

    if (effect.starter !== undefined && startPlayerOf(state)?.playerId !== player.playerId) {
      return blockedBy(`${player.username} is no longer the start player, so ${effect.name} cannot be undone.`)
    }

    let current: GameState = state
    let hand: Playerhand = player
    if (effect.starter !== undefined) {
      const previous = state.players.find((candidate) => candidate.playerId === effect.starter?.from)
      if (previous === undefined) return blockedBy('The previous start player has left the game.')
      current = { ...placeStartMarker(current, previous, player.playerId, at ?? undefined), startPlayerId: previous.playerId }
    }
    if (effect.gain !== undefined) {
      hand = {
        ...hand,
        stats: {
          ...hand.stats,
          trade: Math.max(0, hand.stats.trade - effect.gain.trade),
          culture: Math.max(0, hand.stats.culture - effect.gain.culture),
        },
      }
    }
    if (effect.drew !== undefined && drewCard !== undefined) {
      current = {
        ...withPlayerHand(current, { ...hand, items: hand.items.filter((candidate) => candidate.id !== drewCard.id) }),
        items: [...current.items, { ...drewCard, hidden: true, ownerId: null }],
      }
      current = shuffleSheetTwice(current, effect.drew.sheetName)
      hand = playerOf(current, player.playerId) ?? hand
    }

    if (effect.discarded) {
      const back: GameState = {
        ...withPlayerHand(current, { ...hand, items: [...hand.items, effect.item] }),
        discardedItems: current.discardedItems.filter((candidate) => candidate.id !== effect.item.id),
      }
      return ok({ state: back, text: `${player.username}'s ${effect.name} was undone: the card is back in their hand` })
    }
    const back = withPlayerHand(current, {
      ...hand,
      items: hand.items.map((candidate) =>
        candidate.id === effect.item.id ? { ...candidate, hidden: effect.item.hidden } : candidate,
      ),
    })
    return ok({ state: back, text: `${player.username}'s use of ${effect.name} was undone: the card is facedown again` })
  },
}
