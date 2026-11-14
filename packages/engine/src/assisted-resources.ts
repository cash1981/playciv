/**
 * Paying a resource for an assisted action, and putting it back on an undo.
 *
 * Automatic payments use a token first (a hut/village in the hand, then a piece in the player's area) and, when the
 * player has none, a culture card in the hand that can be played as that resource (A Gift from Afar,
 * A Generous Gift, A Princely Gift: `card-timing.ts`), which is discarded as `playCard` discards it (human,
 * 2026-11-13). Explicit payments may choose a card even with tokens held. Every resource ability pays through here.
 *
 * Its own file so the Start of Turn abilities that cost a resource (Ecology) and the
 * cards of `assisted.ts` share one body. Imports only what the registry already
 * imports; nothing here is computed at load time (see the cycle note in `assisted.ts`).
 */

import { removePiece } from './actions/board.js'
import { READY, blocked, placeBack, playerOf, restoreSupplyBlock, waitingCardIds, withPlayerHand } from './assisted-core.js'
import type { ApplyContext, AssistedAvailability } from './assisted-core.js'
import { areaAt, playerAreas } from './board.js'
import type { BoardPiece } from './board.js'
import { cardPlayRuleOf } from './card-timing.js'
import type { EngineError } from './errors.js'
import { itemName } from './item.js'
import type { Item } from './item.js'
import { itemNumberText } from './log.js'
import type { Result } from './result.js'
import { err, ok } from './result.js'
import type { GameState, Playerhand, SpentResource } from './state.js'

const normalize = (name: string): string => name.trim().toLowerCase()

export interface ResourcePaymentChoice {
  readonly resource: string
  readonly kind: 'hut' | 'village' | 'piece' | 'card'
  readonly id: string
}

export interface ResourcePaymentOption {
  readonly choice: ResourcePaymentChoice
  readonly label: string
  readonly usesCurie?: boolean
}

/** "Iron", "Iron and Wheat", "Iron, Wheat and Silk": a list as the public lines say it. */
export const joinList = (names: readonly string[]): string =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`

/** The culture cards that can be played as a resource, by name (`card-timing.ts` lists what each allows). */
const RESOURCE_CARD_NAMES: readonly string[] = ['A Gift from Afar', 'A Generous Gift', 'A Princely Gift']
const AFAR = 'A Gift from Afar'

/** Whether any culture card can be played as `resource`. */
const cardCanPay = (resource: string): boolean =>
  RESOURCE_CARD_NAMES.some((name) => cardPlayRuleOf(name).resources.some((allowed) => normalize(allowed) === normalize(resource)))

/**
 * A Gift from Afar is also an event that gives a coin token to another player. The recipient is not asked for
 * here, so the line and the warning say it is given by hand (human, 2026-11-13).
 */
const AFAR_NOTE = 'another player of your choice also gets a coin token: give it by hand'
const noteOf = (name: string): string => (name === AFAR ? AFAR_NOTE : '')

/**
 * The culture cards in the player's hand that can be played as `resource`: cards that
 * is not used, is not still a candidate of a pending reward (those are not the player's yet) and whose play rule
 * list the resource. The card with the fewest allowed resources is played first, so A Princely Gift, the only
 * Uranium card, is kept for last; ties go to the first in hand order.
 */
function resourceCards(player: Playerhand, resource: string): readonly Item[] {
  const wanted = normalize(resource)
  const waiting = waitingCardIds(player)
  const allowed = (item: Item): readonly string[] => cardPlayRuleOf(itemName(item)).resources
  const candidates = player.items.filter(
    (item) =>
      item.kind.startsWith('culture') &&
      item.ownerId === player.playerId &&
      !item.used &&
      !waiting.has(item.id) &&
      allowed(item).some((name) => normalize(name) === wanted),
  )
  return candidates.sort((a, b) => allowed(a).length - allowed(b).length)
}

/** All physical payments of this kind, in the legacy token-first preference order. */
function physicalPayments(state: GameState, playerId: string, resource: string, tokensOnly: boolean): readonly SpentResource[] {
  const player = playerOf(state, playerId)
  if (player === undefined) return []
  const wanted = normalize(resource)
  const waiting = waitingCardIds(player)
  const held: SpentResource[] = player.items.flatMap((item) =>
    (item.kind === 'hut' || item.kind === 'village') && item.ownerId === playerId && !item.used && !waiting.has(item.id) && normalize(item.name) === wanted
      ? [{ kind: item.kind, resource, itemId: item.id }]
      : [],
  )
  const areas = playerAreas(state.board, state.players)
  const pieces: SpentResource[] = state.board.pieces.flatMap((piece) =>
    piece.category === 'resource' &&
    piece.assetId === `resources/${wanted}` &&
    areaAt(areas, piece.x + piece.width / 2, piece.y + piece.height / 2)?.playerId === playerId
      ? [{ kind: 'piece', resource, piece }]
      : [],
  )
  const cards: SpentResource[] = tokensOnly ? [] : resourceCards(player, resource).map((card) => ({ kind: 'card', resource, itemId: card.id }))
  return [...held, ...pieces, ...cards]
}

/**
 * The payment a resource would be made with, without paying it: a token (a hut/village in the player's hand comes
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
  const payment = physicalPayments(state, playerId, paid, tokensOnly)[0]
  return payment === undefined ? undefined : { ...payment, ...(curieSubstitute === undefined ? {} : { curieSubstitute }) }
}

const paymentId = (payment: SpentResource): string => payment.kind === 'piece' ? payment.piece.id : payment.itemId

/** Explicit choices retain normal Uranium options as well as the armed, one-shot substitutes. */
function selectablePayments(state: GameState, playerId: string, resource: string): readonly SpentResource[] {
  const normal = physicalPayments(state, playerId, resource, false)
  const substitute = resource === 'Uranium' ? playerOf(state, playerId)?.curieSubstitute : undefined
  if (substitute === undefined || substitute === null) return normal
  // A card that can pay Uranium directly needs no substitution. Its wire choice is the same either way.
  return [...normal, ...physicalPayments(state, playerId, substitute, false)
    .filter((payment) => !normal.some((other) => other.kind === payment.kind && paymentId(other) === paymentId(payment)))
    .map((payment) => ({ ...payment, curieSubstitute: substitute }))]
}

/** Private, viewer-only choices, derived from exactly the rules used to consume explicit payments. */
export function resourcePaymentOptions(state: GameState, playerId: string, cost: readonly (string | null)[]): readonly ResourcePaymentOption[] {
  const resources = cost.includes(null) ? ANY_RESOURCES : [...new Set(cost.filter((resource): resource is string => resource !== null))]
  const player = playerOf(state, playerId)
  if (player === undefined) return []
  return resources.flatMap((resource) => selectablePayments(state, playerId, resource).map((payment) => {
    const item = payment.kind === 'piece' ? undefined : player.items.find((candidate) => candidate.id === payment.itemId)
    const label = payment.kind === 'card'
      ? `${item === undefined ? 'Culture card' : itemName(item)} (as ${resource})`
      : `${payment.resource} (${payment.kind === 'hut' ? 'hand' : payment.kind === 'village' ? 'village in hand' : 'player area'})${payment.curieSubstitute === undefined ? '' : ` (as ${resource})`}`
    return {
      choice: { resource, kind: payment.kind, id: paymentId(payment) },
      label,
      ...(payment.curieSubstitute === undefined ? {} : { usesCurie: true }),
    }
  }))
}

/** The token (never a card) a resource would be paid with. */
export function findResourceToken(state: GameState, playerId: string, resource: string): SpentResource | undefined {
  return findResourcePayment(state, playerId, resource, true)
}

/**
 * How a payment is named in the public line: "spent 1 Iron" for a board resource,
 * "spent 1 Wheat (hut) item number #N" for a held token, or "played <card> item number #N as
 * <resource>", the card named with its item number as `playCard` names a played card (a played card is open
 * information). A Gift from Afar adds that its coin token goes to another player by hand.
 */
export function paymentText(state: GameState, player: Playerhand, spent: SpentResource): string {
  if (spent.kind !== 'card') return `spent 1 ${tokenText(state, player, spent)}`
  const item = player.items.find((candidate) => candidate.id === spent.itemId) ?? state.discardedItems.find((candidate) => candidate.id === spent.itemId)
  if (item === undefined) return `played a card as ${spent.resource}`
  const note = noteOf(itemName(item))
  return `played ${itemName(item)} ${itemNumberText(state.logSecret, player.username, item)} as ${spent.resource}${note === '' ? '' : ` (${note})`}`
}

/** Held resources become public only when paid; board resources keep their plain resource wording. */
function tokenText(state: GameState, player: Playerhand, spent: Exclude<SpentResource, { readonly kind: 'card' }>): string {
  if (spent.kind === 'piece') return spent.resource
  const item = player.items.find((candidate) => candidate.id === spent.itemId) ?? state.discardedItems.find((candidate) => candidate.id === spent.itemId)
  return `${spent.resource} (${spent.kind})${item === undefined ? '' : ` ${itemNumberText(state.logSecret, player.username, item)}`}`
}

/** Shared by explicit, Any and each payments; repeated held items keep their separate numbers. */
function paymentsText(state: GameState, player: Playerhand, spent: readonly SpentResource[]): string {
  const tokens = spent.flatMap((payment) => payment.kind === 'card' ? [] : [tokenText(state, player, payment)])
  const cards = spent.flatMap((payment) => payment.kind === 'card' ? [paymentText(state, player, payment)] : [])
  return [...(tokens.length === 0 ? [] : [`spent ${joinList(tokens)}`]), ...cards].join(' and ')
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
  const payment = findResourcePayment(state, playerId, resource) ?? selectablePayments(state, playerId, resource)[0]
  if (payment === undefined) {
    const article = /^[AEIOU]/.test(resource) && resource !== 'Uranium' ? 'an' : 'a'
    return blocked(
      'needs-resource',
      `You need ${article} ${resource} token: a ${resource} hut or village in your hand or a ${resource} piece in your player area` +
        (cardCanPay(resource) ? ', or a culture card that can be played as that resource.' : '.'),
    )
  }
  return payment.kind === 'card' ? readyWith(cardWarning(state, playerId, payment)) : READY
}

function cardWarning(state: GameState, playerId: string, payment: SpentResource): string {
  const card = playerOf(state, playerId)?.items.find((item) => item.id === (payment.kind === 'card' ? payment.itemId : ''))
  const note = card === undefined ? '' : noteOf(itemName(card))
  return (
    `You have no ${payment.resource} token: ${card === undefined ? 'a culture card' : itemName(card)} in your hand would be played as ${payment.resource} and discarded` +
    (note === '' ? '.' : `. ${itemName(card as Item)}: ${note}.`)
  )
}

export interface SpendOutcome {
  readonly state: GameState
  /** Exactly what was spent, so an undo can put the same token back. */
  readonly spent: SpentResource
  /** The public words for the log: "spent 1 Iron", or "played <card> item number #N as Iron". */
  readonly said: string
}

/**
 * Pays one resource. A hut/village goes to `discardedItems` (hidden, as `discardItem` leaves it), removing at most
 * one same-kind, collected icon in the player's area. A piece is removed from
 * the board through the board history, which is "back to stock" because supply is counted from the pieces on the
 * board; a culture card is discarded like a played card (`playCard`). `NO_RESOURCE` when the player has none.
 */
export function spendResource(
  state: GameState,
  playerId: string,
  resource: string,
  at?: string,
  tokensOnly = false,
  choice?: ResourcePaymentChoice,
): Result<SpendOutcome, 'NO_RESOURCE'> {
  const player = playerOf(state, playerId)
  const token = choice === undefined
    ? findResourcePayment(state, playerId, resource, tokensOnly)
    : choice.resource !== resource ? undefined : selectablePayments(state, playerId, resource).find((payment) =>
      payment.kind === choice.kind && paymentId(payment) === choice.id && (!tokensOnly || payment.kind !== 'card'),
    )
  if (player === undefined || token === undefined) return err('NO_RESOURCE')

  if (token.kind !== 'piece') {
    const held = player.items.find((item) => item.id === token.itemId)
    if (held === undefined) return err('NO_RESOURCE')
    let working = state
    let spent = token
    if (token.kind !== 'card') {
      const areas = playerAreas(state.board, state.players)
      const tokenPiece = state.board.pieces.find((piece) =>
        piece.category === 'resource' &&
        piece.assetId === `resources/${held.kind}` &&
        areaAt(areas, piece.x + piece.width / 2, piece.y + piece.height / 2)?.playerId === playerId &&
        !(state.underTokens ?? []).some((bound) => bound.pieceId === piece.id),
      )
      if (tokenPiece !== undefined) {
        const removed = removePiece(state, { playerId, pieceId: tokenPiece.id, ...(at === undefined ? {} : { at }) })
        if (!removed.ok) return err('NO_RESOURCE')
        working = removed.value
        spent = { ...token, tokenPiece }
      }
    }
    const next: GameState = {
      ...withPlayerHand(working, {
        ...player,
        items: player.items.filter((item) => item.id !== held.id),
        ...(token.curieSubstitute === undefined ? {} : { curieSubstitute: null }),
      }),
      discardedItems: [...working.discardedItems, { ...held, hidden: true }],
    }
    return ok({ state: next, spent, said: paymentText(next, player, spent) })
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

/** The single-resource actions all read choices here rather than accidentally ignoring their payload. */
export function spendActionResource(state: GameState, playerId: string, resource: string, context: ApplyContext): Result<SpendOutcome, 'NO_RESOURCE'> {
  const payments = context.payload?.payments
  if (payments !== undefined && !parseResourcePayments(payments, [resource]).ok) return err('NO_RESOURCE')
  return spendResource(state, playerId, resource, context.at, false, payments?.[0])
}

/** Puts back the exact held item and any collected icon, or the board resource. Callers pass the owning action's logId for refusals. */
export function returnResource(
  state: GameState,
  player: Playerhand,
  spent: SpentResource,
  at: string | null,
  logId = '',
): Result<GameState, EngineError> {
  const blocked = resourceRestoreBlock(state, [spent])
  if (blocked !== undefined) return err({ kind: 'ASSISTED_UNDO_BLOCKED', logId, reason: blocked })
  const restoredPlayer =
    spent.curieSubstitute === undefined ? player : { ...player, curieSubstitute: spent.curieSubstitute }
  if (spent.kind !== 'piece') {
    const inDiscard = state.discardedItems.find((item) => item.id === spent.itemId)
    const inDeck = state.items.find((item) => item.id === spent.itemId)
    const item = inDiscard ?? inDeck
    if (item === undefined) {
      return err({ kind: 'ITEM_NOT_FOUND', ...(spent.kind === 'card' ? {} : { sheetName: spent.kind === 'hut' ? 'HUTS' as const : 'VILLAGES' as const }) })
    }
    const restored = {
      ...withPlayerHand(state, { ...restoredPlayer, items: [...player.items, { ...item, hidden: true }] }),
      discardedItems: state.discardedItems.filter((candidate) => candidate.id !== item.id),
      items: state.items.filter((candidate) => candidate.id !== item.id),
    }
    return ok(spent.kind === 'card' || spent.tokenPiece === undefined ? restored : placeBack(restored, restoredPlayer, spent.tokenPiece, at))
  }
  return ok(placeBack(withPlayerHand(state, restoredPlayer), restoredPlayer, spent.piece, at))
}

const restoredPiece = (spent: SpentResource): BoardPiece | undefined =>
  spent.kind === 'piece' ? spent.piece : spent.kind === 'card' ? undefined : spent.tokenPiece

/** Check the entire refund before placeBack, which otherwise silently accepts an occupied ID. */
function resourceRestoreBlock(state: GameState, spent: readonly SpentResource[]): string | undefined {
  const pieces = spent.flatMap((payment) => {
    const piece = restoredPiece(payment)
    return piece === undefined ? [] : [piece]
  })
  const ids = new Set(state.board.pieces.map((piece) => piece.id))
  for (const piece of pieces) {
    if (ids.has(piece.id)) return `The ${piece.label} piece is already on the board, so this payment cannot be returned. Undo its placement first.`
    ids.add(piece.id)
  }
  return restoreSupplyBlock(state, pieces)
}

// ---------------------------------------------------------------------------
// "Any N": N resource tokens of the player's own choosing (Gunpowder; Pottery and Philosophy later)
// ---------------------------------------------------------------------------

/**
 * The resources an "Any" payment may name: Incense, Iron, Silk, Wheat, Spy and Uranium (human, 2026-11-13).
 * Culture cards that can be played as a resource pay too, but only for what tokens cannot cover.
 */
export const ANY_RESOURCES: readonly string[] = ['Incense', 'Iron', 'Silk', 'Wheat', 'Spy', 'Uranium']

/** The canonical name of a resource a payload named (case and spacing are forgiven), or `undefined`. */
export const anyResourceName = (name: unknown): string | undefined =>
  typeof name === 'string' ? ANY_RESOURCES.find((resource) => normalize(resource) === normalize(name)) : undefined

/** Shared engine/API shape and slot validation. Eligibility is checked against fresh state when spending. */
export function parseResourcePayments(raw: unknown, cost: readonly (string | null)[] | undefined): Result<readonly ResourcePaymentChoice[], string> {
  if (cost === undefined) return err('This action does not take resource payments.')
  if (!Array.isArray(raw) || raw.length !== cost.length) return err(`payments must contain exactly ${cost.length} choices.`)
  const choices: ResourcePaymentChoice[] = []
  const ids = new Set<string>()
  const entries: readonly unknown[] = raw
  for (const [index, value] of entries.entries()) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return err('Each payment must be a resource, kind and id.')
    const resource = 'resource' in value ? value.resource : undefined
    const kind = 'kind' in value ? value.kind : undefined
    const id = 'id' in value ? value.id : undefined
    if (
      Object.keys(value).length !== 3 ||
      Object.keys(value).some((key) => !['resource', 'kind', 'id'].includes(key)) ||
      typeof resource !== 'string' || !ANY_RESOURCES.includes(resource) ||
      (kind !== 'hut' && kind !== 'village' && kind !== 'piece' && kind !== 'card') ||
      typeof id !== 'string' || !/^[A-Za-z0-9._:-]{1,64}$/.test(id)
    ) return err('Each payment needs a known resource, kind (hut, village, piece or card) and a valid id.')
    const required = cost[index]
    if (required !== null && resource !== required) return err(`Payment ${index + 1} must pay ${required ?? 'a resource'}.`)
    if (ids.has(id)) return err('The same physical token or card cannot pay twice.')
    ids.add(id)
    choices.push({ resource, kind, id })
  }
  return ok(choices)
}

/** Sequential immutable scratch payments: no fallback, no reused card, and no partial result on failure. */
export function spendChosenResources(
  state: GameState,
  playerId: string,
  cost: readonly (string | null)[],
  payments: readonly ResourcePaymentChoice[],
  at?: string,
): Result<SpendAnyOutcome, string> {
  const checked = parseResourcePayments(payments, cost)
  if (!checked.ok) return checked
  let current = state
  const spent: SpentResource[] = []
  for (const choice of checked.value) {
    const paid = spendResource(current, playerId, choice.resource, at, false, choice)
    if (!paid.ok) return err('That resource payment is no longer available.')
    current = paid.value.state
    spent.push(paid.value.spent)
  }
  const holder = playerOf(state, playerId)
  return ok({
    state: current,
    spent,
    said: holder === undefined ? '' : paymentsText(current, holder, spent),
  })
}

/**
 * Whether the player can pay `count` resources of any kind together, for the availability of an action: each is
 * paid from a scratch copy in turn, tokens of every kind first and culture cards only for what is left, so the
 * answer agrees with what paying does (the Marie Curie substitution included). Ready with a `warning` naming
 * exactly the cards that would be played, which is only the shortfall that tokens cannot cover.
 */
export function anyResourcesAvailability(state: GameState, playerId: string, count: number): AssistedAvailability {
  let current = state
  const spent: SpentResource[] = []
  for (const tokensOnly of [true, false]) {
    for (const resource of ANY_RESOURCES) {
      while (spent.length < count) {
        const paid = spendResource(current, playerId, resource, undefined, tokensOnly)
        if (!paid.ok) break
        current = paid.value.state
        spent.push(paid.value.spent)
      }
    }
  }
  if (spent.length < count) {
    // Legacy automatic Uranium always looks for the armed substitute, even when only real Uranium remains.
    // The explicit picker can still pay with that Uranium. Keep the automatic algorithm and its warnings
    // unchanged whenever it succeeds, but do not hide otherwise-payable explicit choices.
    const seen = new Set<string>()
    const choices: ResourcePaymentChoice[] = []
    const options = resourcePaymentOptions(state, playerId, [null])
      .filter((option) => option.usesCurie !== true)
      .sort((a, b) => Number(a.choice.kind === 'card') - Number(b.choice.kind === 'card'))
    for (const option of options) {
      if (seen.has(option.choice.id)) continue
      seen.add(option.choice.id)
      choices.push(option.choice)
      if (choices.length === count) break
    }
    const explicit = spendChosenResources(state, playerId, Array.from({ length: count }, () => null), choices)
    if (explicit.ok) return paidAvailability(state, playerId, explicit.value.spent)
    return blocked(
      'needs-resource',
      `You need ${count} resources of your choice: resource huts or villages in your hand or resource pieces in your player area, or culture cards that can be played as a resource.`,
    )
  }
  return paidAvailability(state, playerId, spent)
}

/** Ready, with a `warning` naming exactly the cards that `spent` would play (none when tokens pay it all). */
function paidAvailability(state: GameState, playerId: string, spent: readonly SpentResource[]): AssistedAvailability {
  const holder = playerOf(state, playerId)
  const cards = spent.flatMap((payment) => {
    const card = payment.kind === 'card' ? holder?.items.find((item) => item.id === payment.itemId) : undefined
    return card === undefined ? [] : [itemName(card)]
  })
  if (cards.length === 0) return READY
  const notes = [...new Set(cards.map(noteOf).filter((note) => note !== ''))].map((note) => ` ${AFAR}: ${note}.`).join('')
  return readyWith(`Not enough resource tokens: ${cards.join(' and ')} in your hand would be played as a resource and discarded.${notes}`)
}

export interface SpendAnyOutcome {
  readonly state: GameState
  /** Exactly what was spent, so an undo can put the same tokens and cards back. */
  readonly spent: readonly SpentResource[]
  /** The public words for the log: "spent Iron and Wheat", cards named with their item numbers. */
  readonly said: string
}

/**
 * Pays one resource for each name in `resources`; the names are a preference, not a requirement. Each name is paid
 * by its own token first; then each one left over by any other unspent token the player holds (a hut, village or piece,
 * of the six kinds); and only what tokens cannot cover is paid with culture cards (the fewest-allowed card first,
 * whatever was named), never one card twice. A card is never burned while any token could pay. `missing` is the first name left unpaid, and nothing is spent then.
 */
export function spendAnyResources(
  state: GameState,
  playerId: string,
  resources: readonly string[],
  at?: string,
  payments?: readonly ResourcePaymentChoice[],
): Result<SpendAnyOutcome, { readonly missing: string }> {
  if (payments !== undefined) {
    const paid = spendChosenResources(state, playerId, resources.map(() => null), payments, at)
    return paid.ok ? paid : err({ missing: resources[0] ?? '' })
  }
  let current = state
  const slots: (SpentResource | undefined)[] = resources.map(() => undefined)
  const pay = (index: number, resource: string, tokensOnly: boolean): boolean => {
    const paid = spendResource(current, playerId, resource, at, tokensOnly)
    if (!paid.ok) return false
    current = paid.value.state
    slots[index] = paid.value.spent
    return true
  }
  // 1. The token that was named
  for (const [index, resource] of resources.entries()) pay(index, resource, true)
  // 2. Any other token, for what was named and not held
  for (const [index] of resources.entries()) {
    if (slots[index] !== undefined) continue
    for (const resource of ANY_RESOURCES) if (pay(index, resource, true)) break
  }
  // 3. Cards, for the shortfall, by the rule and in the order the availability uses: the fewest-allowed card
  // first over the six resources. The names do not steer which card is played, so the warning names exactly them
  for (const [index] of resources.entries()) {
    if (slots[index] !== undefined) continue
    for (const resource of ANY_RESOURCES) if (pay(index, resource, false)) break
  }
  const missingAt = slots.findIndex((slot) => slot === undefined)
  if (missingAt !== -1) return err({ missing: resources[missingAt] ?? '' })
  const spent = slots.filter((slot): slot is SpentResource => slot !== undefined)
  const holder = playerOf(state, playerId)
  const said = holder === undefined ? '' : paymentsText(current, holder, spent)
  return ok({ state: current, spent, said })
}

// ---------------------------------------------------------------------------
// One of each of a fixed list of kinds (Education: Incense, Iron, Silk and Wheat)
// ---------------------------------------------------------------------------

/**
 * Automatically pays one resource of each of the `kinds`: a token of the kind first (a hut/village, then a piece
 * in the player's area), else a culture card that can be played as that kind (`resourceCards`: the fewest-allowed card
 * first, each card at most once, so several cards may be used when the player holds several). A token of another kind never
 * stands in. `missing` lists every kind neither can pay, and nothing is spent then.
 */
export function spendEachResource(
  state: GameState,
  playerId: string,
  kinds: readonly string[],
  at?: string,
  payments?: readonly ResourcePaymentChoice[],
): Result<SpendAnyOutcome, { readonly missing: readonly string[] }> {
  if (payments !== undefined) {
    const paid = spendChosenResources(state, playerId, kinds, payments, at)
    return paid.ok ? paid : err({ missing: kinds })
  }
  let current = state
  const slots: (SpentResource | undefined)[] = kinds.map(() => undefined)
  for (const tokensOnly of [true, false]) {
    for (const [index, kind] of kinds.entries()) {
      if (slots[index] !== undefined) continue
      const paid = spendResource(current, playerId, kind, at, tokensOnly)
      if (!paid.ok) continue
      current = paid.value.state
      slots[index] = paid.value.spent
    }
  }
  const missing = kinds.filter((_, index) => slots[index] === undefined)
  if (missing.length > 0) return err({ missing })
  const spent = slots.filter((slot): slot is SpentResource => slot !== undefined)
  const holder = playerOf(state, playerId)
  const said = holder === undefined ? '' : paymentsText(current, holder, spent)
  return ok({ state: current, spent, said })
}

/** What the player lacks for {@link spendEachResource}, in words: Incense can never be a card. */
export function missingEachText(missing: readonly string[]): string {
  const noCard = missing.filter((kind) => !cardCanPay(kind))
  return (
    `You lack ${joinList(missing)}: each needs a resource token (a hut or village in your hand or a piece in your player area) or a culture card that can be played as it.` +
    (noCard.length === 0 ? '' : ` No culture card can be played as ${joinList(noCard)}, so ${noCard.length === 1 ? 'a token is' : 'tokens are'} always needed.`)
  )
}

/**
 * Whether the player can pay one of each of the `kinds`, for the availability of an action: ready with a `warning`
 * naming every card that would be played (the Gift from Afar note included), or `needs-resource` saying what is missing.
 */
export function eachResourceAvailability(state: GameState, playerId: string, kinds: readonly string[]): AssistedAvailability {
  const paid = spendEachResource(state, playerId, kinds)
  return paid.ok ? paidAvailability(state, playerId, paid.value.spent) : blocked('needs-resource', missingEachText(paid.error.missing))
}

/** Puts back every token of {@link spendAnyResources}, the last paid first. */
export function returnResources(
  state: GameState,
  player: Playerhand,
  spent: readonly SpentResource[],
  at: string | null,
  logId = '',
): Result<GameState, EngineError> {
  const blocked = resourceRestoreBlock(state, spent)
  if (blocked !== undefined) return err({ kind: 'ASSISTED_UNDO_BLOCKED', logId, reason: blocked })
  let current = state
  let holder = player
  for (const token of [...spent].reverse()) {
    const returned = returnResource(current, holder, token, at, logId)
    if (!returned.ok) return returned
    current = returned.value
    holder = playerOf(current, player.playerId) ?? holder
  }
  return ok(current)
}
