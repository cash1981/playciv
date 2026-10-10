import { useState } from 'react'

import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import { CollapsiblePanel } from './CollapsiblePanel.js'
import './TradeOffersPanel.css'

interface Props {
  readonly gameId: string
  readonly view: PlayerView
  readonly busy: boolean
  readonly readOnly: boolean
  readonly run: (action: () => Promise<PlayerView | unknown>) => Promise<void>
}

function newRequestId(): string {
  const random = globalThis.crypto?.randomUUID
  return typeof random === 'function'
    ? random.call(globalThis.crypto)
    : `offer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Negotiation has its own surface so it never competes with the conversation composer. */
export function TradeOffersPanel({ gameId, view, busy, readOnly, run }: Props): React.JSX.Element | null {
  const [offerTerms, setOfferTerms] = useState('')
  const [offerRecipientId, setOfferRecipientId] = useState(view.opponents[0]?.playerId ?? '')
  const [counterOfferId, setCounterOfferId] = useState<string | null>(null)
  const [counterTerms, setCounterTerms] = useState('')
  const offers = view.tradeOffers ?? []
  const pendingCount = offers.filter((offer) => offer.status === 'pending').length
  const canWrite = view.you !== null && !readOnly

  if (view.you === null && offers.length === 0) return null

  const sendOffer = (): void => {
    const terms = offerTerms.trim()
    if (terms === '' || offerRecipientId === '') return
    void run(async () => {
      await api.sendTradeOffer(gameId, offerRecipientId, terms, newRequestId(), view.rev)
      setOfferTerms('')
    })
  }

  const transitionOffer = (offerId: string, action: 'accept' | 'decline' | 'withdraw'): void => {
    void run(async () => {
      await api.transitionTradeOffer(gameId, offerId, action, newRequestId(), view.rev)
    })
  }

  const sendCounter = (offerId: string): void => {
    const terms = counterTerms.trim()
    if (terms === '') return
    void run(async () => {
      await api.counterTradeOffer(gameId, offerId, terms, newRequestId(), view.rev)
      setCounterOfferId(null)
      setCounterTerms('')
    })
  }

  return (
    <CollapsiblePanel
      id="trade-offers"
      title={pendingCount > 0 ? `Trade offers (${pendingCount} pending)` : 'Trade offers'}
      defaultOpen={pendingCount > 0}
      className="trade-offers-panel"
    >
      <p className="trade-offers-intro">
        Make agreements in plain language. Acceptance records the agreement; settle resources through the existing controls during the legal trade window.
      </p>

      {offers.length > 0 && (
        <ul className="trade-offers-list" aria-label="Trade offers">
          {offers.map((offer) => {
            const recipient = view.you?.playerId === offer.recipientId
            const sender = view.you?.playerId === offer.senderId
            return (
              <li key={offer.id} className="trade-offer">
                <div className="trade-offer-meta">
                  <strong>{`${offer.senderUsername} → ${offer.recipientUsername}`}</strong>
                  <span className="tag turn">{`Turn ${offer.turnNumber} · ${offer.phase}`}</span>
                  <span className="tag">{offer.status}</span>
                </div>
                <p className="trade-offer-terms">{offer.terms}</p>
                {canWrite && offer.status === 'pending' && (recipient || sender) && (
                  <div className="trade-offer-actions">
                    {recipient && <>
                      <button type="button" disabled={busy} onClick={() => transitionOffer(offer.id, 'accept')}>Accept</button>
                      <button type="button" disabled={busy} onClick={() => transitionOffer(offer.id, 'decline')}>Decline</button>
                      <button type="button" disabled={busy} onClick={() => setCounterOfferId(counterOfferId === offer.id ? null : offer.id)}>Counter</button>
                    </>}
                    {sender && <button type="button" disabled={busy} onClick={() => transitionOffer(offer.id, 'withdraw')}>Withdraw</button>}
                  </div>
                )}
                {counterOfferId === offer.id && (
                  <form className="trade-offer-counter" onSubmit={(event) => { event.preventDefault(); sendCounter(offer.id) }}>
                    <input
                      value={counterTerms}
                      onChange={(event) => setCounterTerms(event.target.value)}
                      aria-label="Counteroffer terms"
                      placeholder="Counteroffer terms"
                      maxLength={2000}
                    />
                    <button type="submit" disabled={busy || counterTerms.trim() === ''}>Send counteroffer</button>
                  </form>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {canWrite && (
        <form
          className="trade-offer-composer"
          onSubmit={(event) => { event.preventDefault(); sendOffer() }}
        >
          <div className="trade-offer-composer-heading">
            <h3>Make an offer</h3>
            <span className="muted">Keep the terms short and clear.</span>
          </div>
          <label htmlFor="trade-offer-recipient">Recipient</label>
          <select
            id="trade-offer-recipient"
            value={offerRecipientId}
            onChange={(event) => setOfferRecipientId(event.target.value)}
          >
            <option value="">Choose a player</option>
            {view.opponents.map((player) => <option key={player.playerId} value={player.playerId}>{player.username}</option>)}
          </select>
          <label htmlFor="trade-offer-terms">Terms</label>
          <textarea
            id="trade-offer-terms"
            value={offerTerms}
            onChange={(event) => setOfferTerms(event.target.value)}
            maxLength={2000}
            placeholder="For example: 2 trade for 1 wheat"
          />
          <button type="submit" disabled={busy || offerRecipientId === '' || offerTerms.trim() === ''}>Send offer</button>
        </form>
      )}
    </CollapsiblePanel>
  )
}
