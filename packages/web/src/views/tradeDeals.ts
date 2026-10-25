/**
 * Trade deals grouped for reading: the offers of one turn, with a counteroffer sitting in the thread
 * of the offer it answers, so a back and forth reads as one deal. Pure, shared by the Trade tab (the
 * current turn, with buttons) and the Trade deals panel in the chat (any turn, read only).
 */

import type { PublicTradeOffer, TurnPhase } from '@civ/engine'

/** Short phase names for the tag on an offer. */
export const PHASE_SHORT: Readonly<Record<TurnPhase, string>> = {
  SOT: 'SOT',
  TRADE: 'Trade',
  CM: 'CM',
  MOVEMENT: 'Movement',
  RESEARCH: 'Research',
}

/** One deal: the offer that started it and every offer after it, oldest first. */
export interface DealThread {
  readonly root: PublicTradeOffer
  readonly offers: readonly PublicTradeOffer[]
}

/**
 * The deals among `offers`, in the order they were started. An offer joins the thread of its parent;
 * one whose parent is not among `offers` starts a thread of its own.
 */
export function threadsOf(offers: readonly PublicTradeOffer[]): readonly DealThread[] {
  const byId = new Map(offers.map((offer) => [offer.id, offer] as const))
  const rootOf = (offer: PublicTradeOffer): PublicTradeOffer => {
    let at = offer
    const seen = new Set<string>()
    while (at.parentOfferId !== null && !seen.has(at.id)) {
      seen.add(at.id)
      const parent = byId.get(at.parentOfferId)
      if (parent === undefined) break
      at = parent
    }
    return at
  }
  const threads = new Map<string, PublicTradeOffer[]>()
  for (const offer of offers) {
    const root = rootOf(offer)
    threads.set(root.id, [...(threads.get(root.id) ?? []), offer])
  }
  return [...threads.entries()].flatMap(([rootId, members]) => {
    const root = byId.get(rootId)
    return root === undefined ? [] : [{ root, offers: members }]
  })
}

/** The offers made in `turnNumber`. */
export const offersOfTurn = (offers: readonly PublicTradeOffer[], turnNumber: number): readonly PublicTradeOffer[] =>
  offers.filter((offer) => offer.turnNumber === turnNumber)

/** "Bob", "Bob and Chul", "Bob, Chul and Itchi". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`
}

/** Who the offer went to, as it reads after the arrow. */
export const recipientsText = (offer: PublicTradeOffer): string =>
  offer.open ? 'everyone' : listNames(offer.recipientUsernames)

/** Whether the offer went to more than one player, so its recipients answer for themselves and the sender chooses. */
export const wentToSeveral = (offer: PublicTradeOffer): boolean => offer.recipientIds.length > 1

/** What the recipients said so far, for an offer that went to several: "Chul accepted · Itchi declined". */
export const responsesText = (offer: PublicTradeOffer): string =>
  offer.responses.map((response) => `${response.username} ${response.action === 'accept' ? 'accepted' : 'declined'}`).join(' · ')
