/**
 * Trade offers: an explicit negotiation record between players. The terms are opaque prose and
 * accepting only records an agreement; nothing is moved.
 *
 * An offer goes to one player, to a few of them, or to everybody else (an open deal). With one
 * recipient it is a plain offer: the recipient accepts, declines or counters. With several, each
 * recipient answers for themselves, and an acceptance only says "I would": the offer stays pending
 * until the sender chooses one of the players who accepted. A counter is a new offer back to the
 * sender, linked to the one it answers (`parentOfferId`), so a back and forth reads as one thread.
 * Every offer belongs to the turn and phase it was made in, and an unanswered one expires when the
 * turn ends.
 */

import type { EngineError } from './errors.js'
import { appendLog } from './log.js'
import { nextId } from './random.js'
import type { Result } from './result.js'
import { err, ok } from './result.js'
import type { GameState, TradeOffer, TradeOfferAction } from './state.js'
import { findPlayer } from './state.js'
import { turnStatus, type TurnPhase } from './turn.js'

export const MAX_TRADE_OFFER_TERMS = 2_000

export interface CreateTradeOfferInput {
  readonly senderId: string
  /** One recipient. Use `recipientIds` for several, or `open` for everybody else. */
  readonly recipientId?: string
  readonly recipientIds?: readonly string[]
  /** An open deal goes to every other player in the game. */
  readonly open?: boolean
  readonly terms: string
  readonly requestId: string
  readonly at?: string | null | undefined
}

export interface TradeOfferTransitionInput {
  readonly actorId: string
  readonly offerId: string
  readonly action: TradeOfferAction
  /** For `choose`: the recipient who accepted and was picked. */
  readonly chosenId?: string
  readonly requestId: string
  readonly at?: string | null | undefined
}

export interface CounterTradeOfferInput {
  readonly actorId: string
  readonly offerId: string
  readonly terms: string
  readonly requestId: string
  readonly at?: string | null
}

type TradeOfferResult = Result<GameState, EngineError>

function requireText(terms: string): Result<string, EngineError> {
  const normalized = terms.trim()
  return normalized.length === 0 || normalized.length > MAX_TRADE_OFFER_TERMS
    ? err({ kind: 'INVALID_TRADE_OFFER_TERMS', length: normalized.length })
    : ok(normalized)
}

function currentContext(state: GameState, playerId: string): { turnNumber: number; phase: TurnPhase } {
  const status = turnStatus(state)
  return {
    turnNumber: status.currentTurn,
    phase: status.players.find((player) => player.playerId === playerId)?.phase ?? 'TRADE',
  }
}

/** Whether the offer went to just one player (an open deal in a game of two too), which makes it a plain offer and answer. */
const isSingle = (offer: TradeOffer): boolean => offer.recipientIds.length === 1

const nameOf = (state: GameState, playerId: string): string => findPlayer(state, playerId)?.username ?? playerId

/** "Bob", "Bob and Chul", "Bob, Chul and Itchi". */
function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`
}

const whoText = (state: GameState, offer: TradeOffer): string =>
  offer.open ? 'everyone' : listNames(offer.recipientIds.map((id) => nameOf(state, id)))

/** Records visible expiry when a round advances or every recipient (or the sender) has left. */
export function expireTradeOffers(state: GameState, at: string | null = null): GameState {
  const currentTurn = turnStatus(state).currentTurn
  let next = state
  for (const offer of state.tradeOffers) {
    const participantMissing =
      findPlayer(next, offer.senderId) === undefined ||
      offer.recipientIds.every((id) => findPlayer(next, id) === undefined)
    if (offer.status !== 'pending' || (!participantMissing && offer.turnNumber >= currentTurn)) continue
    const cause = participantMissing ? 'a participant left the game' : `Turn ${offer.turnNumber} ended`
    const logged = appendLog(next, {
      username: 'System',
      publicLog: `System: Trade offer from ${nameOf(next, offer.senderId)} to ${whoText(next, offer)} expired because ${cause}: ${offer.terms}`,
    })
    next = {
      ...logged,
      tradeOffers: logged.tradeOffers.map((candidate) => candidate.id === offer.id
        ? { ...candidate, status: 'expired', resolvedAt: at }
        : candidate),
    }
  }
  return next
}

function appendOfferLog(state: GameState, message: string, actorId: string): { state: GameState; logId: string } {
  const actor = findPlayer(state, actorId)
  const logged = appendLog(state, {
    username: actor?.username ?? actorId,
    playerId: actorId,
    publicLog: message,
    privateLog: message,
  })
  return { state: logged, logId: logged.log.at(-1)?.id ?? '' }
}

/** The recipients an offer from `senderId` goes to, or the reason it cannot be made. */
function resolveRecipients(state: GameState, input: CreateTradeOfferInput): Result<readonly string[], EngineError> {
  if (input.open === true) {
    const others = state.players.filter((player) => player.playerId !== input.senderId).map((player) => player.playerId)
    return others.length === 0 ? err({ kind: 'TRADE_OFFER_NO_RECIPIENT' }) : ok(others)
  }
  const wanted = [...new Set(input.recipientIds ?? (input.recipientId === undefined ? [] : [input.recipientId]))]
  if (wanted.length === 0) return err({ kind: 'TRADE_OFFER_NO_RECIPIENT' })
  for (const id of wanted) {
    if (id === input.senderId) return err({ kind: 'TRADE_OFFER_SELF' })
    if (findPlayer(state, id) === undefined) return err({ kind: 'TRADE_OFFER_RECIPIENT_NOT_FOUND', playerId: id })
  }
  return ok(wanted)
}

export function createTradeOffer(state: GameState, input: CreateTradeOfferInput): TradeOfferResult {
  const existing = state.tradeOffers.find((offer) => offer.requestId === input.requestId)
  const sender = findPlayer(state, input.senderId)
  if (sender === undefined) return err({ kind: 'NO_ACCESS', playerId: input.senderId })
  const recipients = resolveRecipients(state, input)
  if (existing !== undefined) {
    // A retry of the same request answers with the first outcome, even when a player has left since:
    // the recipients are compared as they were asked for, not as they resolve now
    const asked = [...new Set(input.recipientIds ?? (input.recipientId === undefined ? [] : [input.recipientId]))]
    const same =
      existing.senderId === input.senderId &&
      existing.terms === input.terms.trim() &&
      existing.open === (input.open === true) &&
      (existing.open || asked.slice().sort().join() === [...existing.recipientIds].sort().join())
    return same ? ok(state) : err({ kind: 'TRADE_OFFER_REQUEST_REUSED', requestId: input.requestId })
  }
  if (!recipients.ok) return recipients
  const terms = requireText(input.terms)
  if (!terms.ok) return terms

  const context = currentContext(state, input.senderId)
  const prepared = expireTradeOffers(state, input.at ?? null)
  const [id, rng] = nextId(prepared.rng)
  const draft: TradeOffer = {
    id,
    requestId: input.requestId,
    senderId: input.senderId,
    recipientIds: recipients.value,
    open: input.open === true,
    responses: [],
    chosenId: null,
    terms: terms.value,
    turnNumber: context.turnNumber,
    phase: context.phase,
    status: 'pending',
    parentOfferId: null,
    transitionRequests: [],
    createdAt: input.at ?? null,
    resolvedAt: null,
    logId: '',
  }
  const logged = appendOfferLog(
    { ...prepared, rng },
    `${sender.username} offered ${whoText(prepared, draft)}: ${draft.terms} (Turn ${draft.turnNumber} · ${draft.phase})`,
    input.senderId,
  )
  return ok({ ...logged.state, tradeOffers: [...logged.state.tradeOffers, { ...draft, logId: logged.logId }] })
}

export function transitionTradeOffer(state: GameState, input: TradeOfferTransitionInput): TradeOfferResult {
  const found = state.tradeOffers.find((offer) => offer.id === input.offerId)
  if (found === undefined) return err({ kind: 'TRADE_OFFER_NOT_FOUND', offerId: input.offerId })
  const current = expireTradeOffers(state, input.at ?? null)
  const offer = current.tradeOffers.find((candidate) => candidate.id === input.offerId) ?? found
  const actorIsSender = input.actorId === offer.senderId
  const actorIsRecipient = offer.recipientIds.includes(input.actorId)
  const senderAction = input.action === 'withdraw' || input.action === 'choose'
  if ((senderAction && !actorIsSender) || (!senderAction && !actorIsRecipient)) {
    return err({ kind: 'TRADE_OFFER_NOT_ALLOWED', offerId: offer.id })
  }
  const priorRequest = offer.transitionRequests.find((request) => request.requestId === input.requestId)
  if (priorRequest !== undefined) {
    return priorRequest.actorId === input.actorId && priorRequest.action === input.action
      ? ok(current)
      : err({ kind: 'TRADE_OFFER_REQUEST_REUSED', requestId: input.requestId })
  }
  if (offer.status === 'expired' && found.status === 'pending') return ok(current)
  if (offer.status !== 'pending') return err({ kind: 'TRADE_OFFER_NOT_PENDING', offerId: offer.id })

  const request = {
    requestId: input.requestId,
    actorId: input.actorId,
    action: input.action,
    terms: null,
  }
  const actorName = nameOf(current, input.actorId)

  // An answer from one of several recipients: recorded, and the offer stays pending
  if (!isSingle(offer) && (input.action === 'accept' || input.action === 'decline')) {
    const responses = [
      ...offer.responses.filter((response) => response.playerId !== input.actorId),
      { playerId: input.actorId, action: input.action },
    ]
    // A recipient who has left cannot answer, so only those still in the game have to decline
    const staying = offer.recipientIds.filter((id) => findPlayer(current, id) !== undefined)
    const everyoneDeclined =
      staying.length > 0 &&
      staying.every((id) => responses.some((response) => response.playerId === id && response.action === 'decline'))
    const verb = input.action === 'accept' ? 'accepted' : 'declined'
    const logged = appendOfferLog(current, `${actorName} ${verb} trade offer from ${nameOf(current, offer.senderId)}: ${offer.terms}`, input.actorId)
    const next: TradeOffer = {
      ...offer,
      responses,
      transitionRequests: [...offer.transitionRequests, request],
      ...(everyoneDeclined ? { status: 'declined' as const, resolvedAt: input.at ?? null } : {}),
    }
    return ok({ ...logged.state, tradeOffers: logged.state.tradeOffers.map((candidate) => candidate.id === offer.id ? next : candidate) })
  }

  // The sender picks one of the players who accepted
  if (input.action === 'choose') {
    const chosenId = input.chosenId
    const accepted =
      chosenId !== undefined &&
      findPlayer(current, chosenId) !== undefined &&
      offer.responses.some((response) => response.playerId === chosenId && response.action === 'accept')
    if (chosenId === undefined || !accepted) {
      return err({ kind: 'TRADE_OFFER_CHOICE_INVALID', offerId: offer.id, playerId: chosenId ?? '' })
    }
    const logged = appendOfferLog(current, `${actorName} chose ${nameOf(current, chosenId)} for trade offer: ${offer.terms}`, input.actorId)
    const next: TradeOffer = {
      ...offer,
      status: 'accepted',
      chosenId,
      transitionRequests: [...offer.transitionRequests, request],
      resolvedAt: input.at ?? null,
    }
    return ok({ ...logged.state, tradeOffers: logged.state.tradeOffers.map((candidate) => candidate.id === offer.id ? next : candidate) })
  }

  const status = input.action === 'accept' ? 'accepted' : input.action === 'decline' ? 'declined' : 'withdrawn'
  const logged = appendOfferLog(current, `${actorName} ${status} trade offer: ${offer.terms}`, input.actorId)
  const next: TradeOffer = {
    ...offer,
    status,
    // A plain offer that is accepted was made with its one recipient
    chosenId: status === 'accepted' ? input.actorId : offer.chosenId,
    transitionRequests: [...offer.transitionRequests, request],
    resolvedAt: input.at ?? null,
  }
  return ok({
    ...logged.state,
    tradeOffers: logged.state.tradeOffers.map((candidate) => candidate.id === offer.id ? next : candidate),
  })
}

export function counterTradeOffer(state: GameState, input: CounterTradeOfferInput): TradeOfferResult {
  const current = expireTradeOffers(state, input.at ?? null)
  const offer = current.tradeOffers.find((candidate) => candidate.id === input.offerId)
  if (offer === undefined) return err({ kind: 'TRADE_OFFER_NOT_FOUND', offerId: input.offerId })
  if (!offer.recipientIds.includes(input.actorId)) return err({ kind: 'TRADE_OFFER_NOT_ALLOWED', offerId: input.offerId })
  const priorRequest = offer.transitionRequests.find((request) => request.requestId === input.requestId)
  if (priorRequest !== undefined) {
    const terms = input.terms.trim()
    return priorRequest.actorId === input.actorId && priorRequest.action === 'counter' && priorRequest.terms === terms
      ? ok(current)
      : err({ kind: 'TRADE_OFFER_REQUEST_REUSED', requestId: input.requestId })
  }
  if (offer.status === 'expired') return ok(current)
  if (offer.status !== 'pending') {
    return err({ kind: 'TRADE_OFFER_NOT_ALLOWED', offerId: input.offerId })
  }
  const terms = requireText(input.terms)
  if (!terms.ok) return terms
  const counterRequestId = `counter:${offer.id}:${input.requestId}`
  if (current.tradeOffers.some((candidate) => candidate.requestId === counterRequestId)) {
    return err({ kind: 'TRADE_OFFER_REQUEST_REUSED', requestId: input.requestId })
  }
  const logged = appendOfferLog(
    current,
    `${nameOf(current, input.actorId)} countered trade offer: ${offer.terms}`,
    input.actorId,
  )
  const request = {
    requestId: input.requestId,
    actorId: input.actorId,
    action: 'counter' as const,
    terms: terms.value,
  }
  // A plain offer is closed by the counter. An offer that went to several stays open for the others.
  const answered: TradeOffer = isSingle(offer)
    ? { ...offer, status: 'countered', transitionRequests: [...offer.transitionRequests, request], resolvedAt: input.at ?? null }
    : { ...offer, transitionRequests: [...offer.transitionRequests, request] }
  const closed: GameState = {
    ...logged.state,
    tradeOffers: logged.state.tradeOffers.map((candidate) => candidate.id === offer.id ? answered : candidate),
  }
  const created = createTradeOffer(closed, {
    senderId: input.actorId,
    recipientId: offer.senderId,
    terms: terms.value,
    requestId: counterRequestId,
    at: input.at,
  })
  if (!created.ok) return created
  return ok({
    ...created.value,
    tradeOffers: created.value.tradeOffers.map((candidate) => candidate.requestId === counterRequestId
      ? { ...candidate, parentOfferId: offer.id }
      : candidate),
  })
}
