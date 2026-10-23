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

import { blockadedGreatPersonTypes } from './blockade.js'
import { READY, blocked, lastLogId, playerOf, rejected, withPlayerHand } from './assisted-core.js'
import type { AssistedActionDefinition } from './assisted-core.js'
import {
  CARDS_WITH_OWN_BUTTON,
  CARD_TIMING_TEXT,
  cardPlayRuleOf,
  discardsWhenUsed,
  timingsOf,
} from './card-timing.js'
import type { CardTiming, PlayableCard } from './card-timing.js'
import { err, ok } from './result.js'
import { itemName } from './item.js'
import type { Item } from './item.js'
import { appendLog } from './log.js'
import type { GameState, Playerhand } from './state.js'
import { turnStatus } from './turn.js'
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

    const verb = card.kind === 'culture' ? 'played' : card.discards ? 'played' : 'used'
    const aimed =
      card.targets.kind === 'allOthers'
        ? ', targeting every other player'
        : targets.length > 0
          ? `, targeting ${joinNames(targets.map((target) => target.username))}`
          : ''
    const logged = appendLog(moved, {
      username: player.username,
      playerId: player.playerId,
      publicLog:
        `${player.username} ${verb} ${card.name} (${when})` +
        (resource === null ? '' : ` as ${resource}`) +
        aimed +
        (card.discards && card.kind === 'greatPerson' ? ' and discarded it' : ''),
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
      },
      logId: lastLogId(logged),
    })
  },

  reverse(state, player, record) {
    const effect = record.effect
    if (effect.kind !== 'playCard') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    const blockedBy = (reason: string) => err({ kind: 'ASSISTED_UNDO_BLOCKED' as const, logId: record.logId, reason })
    if (effect.discarded) {
      const inPile = state.discardedItems.find((candidate) => candidate.id === effect.item.id)
      if (inPile === undefined) return blockedBy(`${effect.name} is no longer in the discard pile.`)
      const back: GameState = {
        ...withPlayerHand(state, { ...player, items: [...player.items, effect.item] }),
        discardedItems: state.discardedItems.filter((candidate) => candidate.id !== effect.item.id),
      }
      return ok({ state: back, text: `${player.username}'s ${effect.name} was undone: the card is back in their hand` })
    }
    const inHand = player.items.find((candidate) => candidate.id === effect.item.id)
    if (inHand === undefined) return blockedBy(`${effect.name} has left ${player.username}'s hand.`)
    const back = withPlayerHand(state, {
      ...player,
      items: player.items.map((candidate) =>
        candidate.id === effect.item.id ? { ...candidate, hidden: effect.item.hidden } : candidate,
      ),
    })
    return ok({ state: back, text: `${player.username}'s use of ${effect.name} was undone: the card is facedown again` })
  },
}
