/**
 * Paying a resource for an assisted action, and putting it back on an undo.
 *
 * A resource is paid with a token first (a hut in the hand, then a piece in the player's area) and, when the
 * player has none, with a culture card in the hand that can be played as that resource (A Gift from Afar,
 * A Generous Gift, A Princely Gift: `card-timing.ts`), which is discarded as `playCard` discards it (human,
 * 2026-11-13). Every resource ability pays through here, so each benefits.
 *
 * Its own file so the Start of Turn abilities that cost a resource (Ecology) and the
 * cards of `assisted.ts` share one body. Imports only what the registry already
 * imports; nothing here is computed at load time (see the cycle note in `assisted.ts`).
 */

import { removePiece } from './actions/board.js'
import { READY, blocked, placeBack, playerOf, withPlayerHand } from './assisted-core.js'
import type { AssistedAvailability } from './assisted-core.js'
import { areaAt, playerAreas } from './board.js'
import { cardPlayRuleOf } from './card-timing.js'
import type { EngineError } from './errors.js'
import { itemName } from './item.js'
import type { Item } from './item.js'
import { itemNumberText } from './log.js'
import type { Result } from './result.js'
import { err, ok } from './result.js'
import type { GameState, Playerhand, SpentResource } from './state.js'

const normalize = (name: string): string => name.trim().toLowerCase()

/**
 * The culture card in the player's hand that would be played as `resource`, or `undefined`. A culture card in
 * the hand that is not used and whose play rule lists the resource; the first in hand order.
 */
function findResourceCard(player: Playerhand, resource: string): Item | undefined {
  const wanted = normalize(resource)
  return player.items.find(
    (item) =>
      item.kind.startsWith('culture') &&
      !item.used &&
      cardPlayRuleOf(itemName(item)).resources.some((allowed) => normalize(allowed) === wanted),
  )
}

/**
 * The payment a resource would be made with, without paying it: a token (a hut in the player's hand comes
 * first, then a `resources/<name>` piece whose centre lies in the player's own area; a piece outside every area
 * is nobody's and is never taken), else, unless `tokensOnly`, a culture card that can be played as the resource.
 * Marie Curie: a Uranium spend may use the resource she armed instead.
 */
export function findResourcePayment(
  state: GameState,
  playerId: string,
  resource: string,
  tokensOnly = false,
): SpentResource | undefined {
  const player = playerOf(state, playerId)
  if (player === undefined) return undefined

  const curieSubstitute = resource === 'Uranium' ? player.curieSubstitute ?? undefined : undefined
  const paid = curieSubstitute ?? resource
  const wanted = normalize(paid)
  const hut = player.items.find(
    (item) => item.kind === 'hut' && !item.used && normalize(item.name) === wanted,
  )
  if (hut !== undefined) {
    return {
      kind: 'hut',
      resource: paid,
      itemId: hut.id,
      ...(curieSubstitute === undefined ? {} : { curieSubstitute }),
    }
  }

  const areas = playerAreas(state.board, state.players)
  const piece = state.board.pieces.find(
    (candidate) =>
      candidate.category === 'resource' &&
      candidate.assetId === `resources/${wanted}` &&
      areaAt(areas, candidate.x + candidate.width / 2, candidate.y + candidate.height / 2)
        ?.playerId === playerId,
  )
  if (piece !== undefined) {
    return { kind: 'piece', resource: paid, piece, ...(curieSubstitute === undefined ? {} : { curieSubstitute }) }
  }
  if (tokensOnly) return undefined
  const card = findResourceCard(player, paid)
  return card === undefined
    ? undefined
    : { kind: 'card', resource: paid, itemId: card.id, ...(curieSubstitute === undefined ? {} : { curieSubstitute }) }
}

/** The token (never a card) a resource would be paid with. */
export function findResourceToken(state: GameState, playerId: string, resource: string): SpentResource | undefined {
  return findResourcePayment(state, playerId, resource, true)
}

/** How a payment is named in the public line of the action: "spent 1 Iron", or the card played as the resource. */
export function paymentText(state: GameState, player: Playerhand, spent: SpentResource): string {
  if (spent.kind !== 'card') return `spent 1 ${spent.resource}`
  const item = player.items.find((candidate) => candidate.id === spent.itemId) ?? state.discardedItems.find((candidate) => candidate.id === spent.itemId)
  // A played card is open information, so it is named with its item number as `playCard` writes it
  return item === undefined
    ? `played a card as ${spent.resource}`
    : `played ${itemName(item)} ${itemNumberText(state.logSecret, player.username, item)} as ${spent.resource}`
}

/** What an undo says came back: "the Spy token" or "the card played as Spy". */
export const returnedText = (spent: SpentResource): string =>
  spent.kind === 'card' ? `the card played as ${spent.resource}` : `the ${spent.resource} token`

const readyWith = (warning: string): AssistedAvailability => ({ status: 'ready', reason: READY.reason, warning })

/**
 * Whether the player can pay `resource`, for the availability of an action: ready with a `warning` naming the
 * card when only a card can pay (it would be played and discarded), `needs-resource` when nothing can. The
 * warning is the viewer's own: availability is computed for the viewer only.
 */
export function resourceAvailability(state: GameState, playerId: string, resource: string): AssistedAvailability {
  const payment = findResourcePayment(state, playerId, resource)
  if (payment === undefined) {
    return blocked(
      'needs-resource',
      `You need a${/^[AEIOU]/i.test(resource) ? 'n' : ''} ${resource} token: a ${resource} hut in your hand or a ${resource} piece in your player area` +
        ', or a culture card that can be played as a resource.',
    )
  }
  return payment.kind === 'card' ? readyWith(cardWarning(state, playerId, payment)) : READY
}

function cardWarning(state: GameState, playerId: string, payment: SpentResource): string {
  const card = playerOf(state, playerId)?.items.find((item) => item.id === (payment.kind === 'card' ? payment.itemId : ''))
  return `You have no ${payment.resource} token: ${card === undefined ? 'a culture card' : itemName(card)} in your hand would be played as ${payment.resource} and discarded.`
}

export interface SpendOutcome {
  readonly state: GameState
  /** Exactly what was spent, so an undo can put the same token back. */
  readonly spent: SpentResource
  /** The public words for the log: "spent 1 Iron", or "played <card> item number #N as Iron". */
  readonly said: string
}

/**
 * Pays one resource. A hut goes to `discardedItems` (hidden, as `discardItem` leaves it); a piece is removed from
 * the board through the board history, which is "back to stock" because supply is counted from the pieces on the
 * board; a culture card is discarded like a played card (`playCard`). `NO_RESOURCE` when the player has none.
 */
export function spendResource(
  state: GameState,
  playerId: string,
  resource: string,
  at?: string,
): Result<SpendOutcome, 'NO_RESOURCE'> {
  const player = playerOf(state, playerId)
  const token = findResourcePayment(state, playerId, resource)
  if (player === undefined || token === undefined) return err('NO_RESOURCE')

  if (token.kind === 'hut' || token.kind === 'card') {
    const held = player.items.find((item) => item.id === token.itemId)
    if (held === undefined) return err('NO_RESOURCE')
    const next: GameState = {
      ...withPlayerHand(state, {
        ...player,
        items: player.items.filter((item) => item.id !== held.id),
        ...(token.curieSubstitute === undefined ? {} : { curieSubstitute: null }),
      }),
      discardedItems: [...state.discardedItems, { ...held, hidden: true }],
    }
    return ok({ state: next, spent: token, said: paymentText(next, player, token) })
  }

  const removed = removePiece(state, {
    playerId,
    pieceId: token.piece.id,
    ...(at === undefined ? {} : { at }),
  })
  if (!removed.ok) return err('NO_RESOURCE')
  const after = playerOf(removed.value, playerId)
  return ok({
    state:
      token.curieSubstitute === undefined || after === undefined
        ? removed.value
        : withPlayerHand(removed.value, { ...after, curieSubstitute: null }),
    spent: token,
    said: paymentText(removed.value, player, token),
  })
}

/** Puts a spent payment back: the hut or card into the hand, or the piece onto the board where it was. */
export function returnResource(
  state: GameState,
  player: Playerhand,
  spent: SpentResource,
  at: string | null,
): Result<GameState, EngineError> {
  const restoredPlayer =
    spent.curieSubstitute === undefined ? player : { ...player, curieSubstitute: spent.curieSubstitute }
  if (spent.kind === 'hut' || spent.kind === 'card') {
    const inDiscard = state.discardedItems.find((item) => item.id === spent.itemId)
    const inDeck = state.items.find((item) => item.id === spent.itemId)
    const item = inDiscard ?? inDeck
    if (item === undefined) {
      return err({ kind: 'ITEM_NOT_FOUND', ...(spent.kind === 'hut' ? { sheetName: 'HUTS' as const } : {}) })
    }
    return ok({
      ...withPlayerHand(state, { ...restoredPlayer, items: [...player.items, { ...item, hidden: true }] }),
      discardedItems: state.discardedItems.filter((candidate) => candidate.id !== item.id),
      items: state.items.filter((candidate) => candidate.id !== item.id),
    })
  }
  return ok(placeBack(withPlayerHand(state, restoredPlayer), restoredPlayer, spent.piece, at))
}

// ---------------------------------------------------------------------------
// "Any N": N resource tokens of the player's own choosing (Gunpowder; Pottery and Philosophy later)
// ---------------------------------------------------------------------------

/**
 * The resources an "Any" payment may name: the ones `findResourceToken` can find a token for. Whether Spy and
 * Uranium count as "Any" is not settled by a rulebook the project could read (see decisions.md); they are
 * accepted so that a player is never blocked from paying with a token that is theirs.
 */
export const ANY_RESOURCES: readonly string[] = ['Incense', 'Iron', 'Silk', 'Wheat', 'Spy', 'Uranium']

/** The canonical name of a resource a payload named (case and spacing are forgiven), or `undefined`. */
export const anyResourceName = (name: unknown): string | undefined =>
  typeof name === 'string' ? ANY_RESOURCES.find((resource) => normalize(resource) === normalize(name)) : undefined

/**
 * Whether the player can pay `count` resources of any kind together, for the availability of an action: each is
 * paid from a scratch copy in turn, tokens of every kind first and culture cards only for what is left, so the
 * answer agrees with what paying would do (the Marie Curie substitution included). Ready with a `warning` naming
 * the cards that would be played when tokens alone do not cover it.
 */
export function anyResourcesAvailability(state: GameState, playerId: string, count: number): AssistedAvailability {
  let current = state
  const spent: SpentResource[] = []
  for (const tokensOnly of [true, false]) {
    for (const resource of ANY_RESOURCES) {
      while (spent.length < count) {
        const payment = findResourcePayment(current, playerId, resource, tokensOnly)
        if (payment === undefined) break
        const paid = spendResource(current, playerId, resource)
        if (!paid.ok) break
        current = paid.value.state
        spent.push(paid.value.spent)
      }
    }
  }
  if (spent.length < count) {
    return blocked(
      'needs-resource',
      `You need ${count} resource tokens of your choice: resource huts in your hand or resource pieces in your player area, or culture cards that can be played as a resource.`,
    )
  }
  const holder = playerOf(state, playerId)
  const cards = spent.flatMap((payment) => {
    const card = payment.kind === 'card' ? holder?.items.find((item) => item.id === payment.itemId) : undefined
    return card === undefined ? [] : [`${itemName(card)} (as ${payment.resource})`]
  })
  return cards.length === 0
    ? READY
    : readyWith(`Not enough resource tokens: ${cards.join(' and ')} in your hand would be played as a resource and discarded.`)
}

export interface SpendAnyOutcome {
  readonly state: GameState
  /** Exactly what was spent, in the order named, so an undo can put the same tokens back. */
  readonly spent: readonly SpentResource[]
  /** The public words for the log: "spent Iron and Wheat", cards named as `playCard` names them. */
  readonly said: string
}

/**
 * Pays one token (or, lacking one, a card) for each name in `resources`, in order; naming a resource twice pays two.
 * `NO_RESOURCE` carries the first name the player cannot pay, and nothing is spent then.
 */
export function spendAnyResources(
  state: GameState,
  playerId: string,
  resources: readonly string[],
  at?: string,
): Result<SpendAnyOutcome, { readonly missing: string }> {
  let current = state
  const spent: SpentResource[] = []
  const cards: string[] = []
  for (const resource of resources) {
    const paid = spendResource(current, playerId, resource, at)
    if (!paid.ok) return err({ missing: resource })
    current = paid.value.state
    spent.push(paid.value.spent)
    if (paid.value.spent.kind === 'card') cards.push(paid.value.said)
  }
  const tokens = spent.filter((payment) => payment.kind !== 'card').map((payment) => payment.resource)
  const said = [...(tokens.length === 0 ? [] : [`spent ${tokens.join(' and ')}`]), ...cards].join(' and ')
  return ok({ state: current, spent, said })
}

/** Puts back every token of {@link spendAnyResources}, the last paid first. */
export function returnResources(
  state: GameState,
  player: Playerhand,
  spent: readonly SpentResource[],
  at: string | null,
): Result<GameState, EngineError> {
  let current = state
  let holder = player
  for (const token of [...spent].reverse()) {
    const returned = returnResource(current, holder, token, at)
    if (!returned.ok) return returned
    current = returned.value
    holder = playerOf(current, player.playerId) ?? holder
  }
  return ok(current)
}
