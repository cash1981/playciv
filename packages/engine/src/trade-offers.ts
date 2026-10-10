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
  readonly recipientId: string
  readonly terms: string
  readonly requestId: string
  readonly at?: string | null | undefined
}

export interface TradeOfferTransitionInput {
  readonly actorId: string
  readonly offerId: string
  readonly action: TradeOfferAction
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

/** Records visible expiry when a round advances or either participant leaves. */
export function expireTradeOffers(state: GameState, at: string | null = null): GameState {
  const currentTurn = turnStatus(state).currentTurn
  let next = state
  for (const offer of state.tradeOffers) {
    const participantMissing = findPlayer(next, offer.senderId) === undefined || findPlayer(next, offer.recipientId) === undefined
    if (offer.status !== 'pending' || (!participantMissing && offer.turnNumber >= currentTurn)) continue
    const sender = findPlayer(next, offer.senderId)?.username ?? offer.senderId
    const recipient = findPlayer(next, offer.recipientId)?.username ?? offer.recipientId
    const cause = participantMissing ? 'a participant left the game' : `Turn ${offer.turnNumber} ended`
    const logged = appendLog(next, {
      username: 'System',
      publicLog: `System: Trade offer from ${sender} to ${recipient} expired because ${cause}: ${offer.terms}`,
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

export function createTradeOffer(state: GameState, input: CreateTradeOfferInput): TradeOfferResult {
  const existing = state.tradeOffers.find((offer) => offer.requestId === input.requestId)
  if (existing !== undefined) {
    return existing.senderId === input.senderId
      ? ok(state)
      : err({ kind: 'TRADE_OFFER_REQUEST_REUSED', requestId: input.requestId })
  }
  const sender = findPlayer(state, input.senderId)
  const recipient = findPlayer(state, input.recipientId)
  if (sender === undefined) return err({ kind: 'NO_ACCESS', playerId: input.senderId })
  if (recipient === undefined) return err({ kind: 'TRADE_OFFER_RECIPIENT_NOT_FOUND', playerId: input.recipientId })
  if (input.senderId === input.recipientId) return err({ kind: 'TRADE_OFFER_SELF' })
  const terms = requireText(input.terms)
  if (!terms.ok) return terms

  const context = currentContext(state, input.senderId)
  const prepared = expireTradeOffers(state, input.at ?? null)
  const [id, rng] = nextId(prepared.rng)
  const draft: TradeOffer = {
    id,
    requestId: input.requestId,
    senderId: input.senderId,
    recipientId: input.recipientId,
    terms: terms.value,
    turnNumber: context.turnNumber,
    phase: context.phase,
    status: 'pending',
    parentOfferId: null,
    transitionRequestIds: [],
    createdAt: input.at ?? null,
    resolvedAt: null,
    logId: '',
  }
  const logged = appendOfferLog(
    { ...prepared, rng },
    `${sender.username} offered ${recipient.username}: ${draft.terms} (Turn ${draft.turnNumber} · ${draft.phase})`,
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
  const actorIsRecipient = input.actorId === offer.recipientId
  if ((input.action === 'withdraw' && !actorIsSender) || (input.action !== 'withdraw' && !actorIsRecipient)) {
    return err({ kind: 'TRADE_OFFER_NOT_ALLOWED', offerId: offer.id })
  }
  if (offer.transitionRequestIds.includes(input.requestId)) return ok(current)
  if (offer.status === 'expired' && found.status === 'pending') return ok(current)
  if (offer.status !== 'pending') return err({ kind: 'TRADE_OFFER_NOT_PENDING', offerId: offer.id })
  const status = input.action === 'accept' ? 'accepted' : input.action === 'decline' ? 'declined' : 'withdrawn'
  const actor = findPlayer(current, input.actorId)
  const next = {
    ...offer,
    status: status as TradeOffer['status'],
    transitionRequestIds: [...offer.transitionRequestIds, input.requestId],
    resolvedAt: input.at ?? null,
  }
  const logged = appendOfferLog(
    current,
    `${actor?.username ?? input.actorId} ${status} trade offer: ${offer.terms}`,
    input.actorId,
  )
  return ok({
    ...logged.state,
    tradeOffers: logged.state.tradeOffers.map((candidate) => candidate.id === offer.id ? next : candidate),
  })
}

export function counterTradeOffer(state: GameState, input: CounterTradeOfferInput): TradeOfferResult {
  const current = expireTradeOffers(state, input.at ?? null)
  const offer = current.tradeOffers.find((candidate) => candidate.id === input.offerId)
  if (offer === undefined) return err({ kind: 'TRADE_OFFER_NOT_FOUND', offerId: input.offerId })
  if (offer.recipientId !== input.actorId) return err({ kind: 'TRADE_OFFER_NOT_ALLOWED', offerId: input.offerId })
  if (offer.transitionRequestIds.includes(input.requestId)) return ok(current)
  if (offer.status === 'expired') return ok(current)
  if (offer.status !== 'pending') {
    return err({ kind: 'TRADE_OFFER_NOT_ALLOWED', offerId: input.offerId })
  }
  const terms = requireText(input.terms)
  if (!terms.ok) return terms
  const actor = findPlayer(current, input.actorId)
  const logged = appendOfferLog(
    current,
    `${actor?.username ?? input.actorId} countered trade offer: ${offer.terms}`,
    input.actorId,
  )
  const countered = {
    ...offer,
    status: 'countered' as const,
    transitionRequestIds: [...offer.transitionRequestIds, input.requestId],
    resolvedAt: input.at ?? null,
  }
  const closed: GameState = {
    ...logged.state,
    tradeOffers: logged.state.tradeOffers.map((candidate) => candidate.id === offer.id ? countered : candidate),
  }
  const created = createTradeOffer(closed, {
    senderId: input.actorId,
    recipientId: offer.senderId,
    terms: terms.value,
    requestId: input.requestId,
    at: input.at,
  })
  if (!created.ok) return created
  return ok({
    ...created.value,
    tradeOffers: created.value.tradeOffers.map((candidate) => candidate.requestId === input.requestId
      ? { ...candidate, parentOfferId: offer.id }
      : candidate),
  })
}
