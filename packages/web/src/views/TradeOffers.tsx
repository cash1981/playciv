/**
 * The Trade tab's own controls: the trade the viewer's cities collect, and trade offers.
 *
 * The collected trade is the viewer's `stats.trade` from the Status panel, which stays the master:
 * the box reads it and writes it with the same call, so an edit on either side shows on both.
 *
 * An offer is a note in plain language. Accepting one records that both players agreed; it moves
 * nothing, so the players settle it with the existing controls.
 */

import { useRef, useState } from 'react'

import { TRADE_CEILING } from '@civ/engine'
import type { TurnPhase } from '@civ/engine'

import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import type { Run } from './GameView.js'
import { HelpHint } from './HelpHint.js'
import { StatCell } from './StatusPanel.js'
import './TradeOffers.css'

function newRequestId(): string {
  const random = globalThis.crypto?.randomUUID
  return typeof random === 'function'
    ? random.call(globalThis.crypto)
    : `offer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Short phase names for the tag on an offer. */
const PHASE_SHORT: Readonly<Record<TurnPhase, string>> = {
  SOT: 'SOT',
  TRADE: 'Trade',
  CM: 'CM',
  MOVEMENT: 'Movement',
  RESEARCH: 'Research',
}

interface Props {
  readonly gameId: string
  readonly view: PlayerView
  readonly busy: boolean
  readonly readOnly: boolean
  readonly run: Run
}

/**
 * A small box for the trade around the viewer's cities; it is the Status panel's Trade number.
 * Under it, the trade the cities should give this phase, as an estimate the player may add.
 */
export function TradeCollected({ gameId, view, busy, readOnly, run }: Props): React.JSX.Element | null {
  const you = view.you
  if (you === null) return null
  const estimate = you.cities.reduce((total, city) => total + city.trade.outskirts, 0)
  const current = you.stats.trade
  // The trade track ends at the ceiling, so the sum stops there. A balance already above it
  // (typed in before the ceiling was enforced) is never lowered.
  const after = Math.max(current, Math.min(TRADE_CEILING, current + estimate))
  const addLabel = `Add ${estimate} to your trade (${current} becomes ${after})`
  const notes = [...new Set(you.cities.flatMap((city) => city.trade.notes))]
  return (
    <div className="trade-box">
      <label className="trade-collected">
        <span>Trade around your cities</span>
        <StatCell
          label="Trade around your cities"
          value={current}
          max={TRADE_CEILING}
          disabled={busy || readOnly}
          onCommit={(value) => void run(() => api.setPlayerStat(gameId, you.playerId, 'trade', value))}
        />
      </label>
      <div className="trade-estimate">
        <span>
          Estimate for this phase: <strong>{estimate}</strong>
        </span>
        <HelpHint label="Trade estimate">
          {you.cities.length === 0 ? (
            <p>You have no cities on the map, so there is nothing to count.</p>
          ) : (
            <ul aria-label="Trade per city">
              {you.cities.map((city) => (
                <li key={city.pieceId}>
                  {`${city.label}: ${city.trade.outskirts}`}
                  {city.trade.detail.length > 0 &&
                    ` (${city.trade.detail.map((entry) => `${entry.square} ${entry.amount}${entry.blockaded ? ', blockaded' : ''}`).join(', ')})`}
                </li>
              ))}
            </ul>
          )}
          <ul aria-label="Trade estimate notes">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </HelpHint>
        <button
          type="button"
          className="small"
          disabled={busy || readOnly || estimate === 0 || after === current}
          aria-label={addLabel}
          title={addLabel}
          onClick={() => void run(() => api.setPlayerStat(gameId, you.playerId, 'trade', after))}
        >
          Add {estimate}
        </button>
      </div>
    </div>
  )
}

export function TradeOffers({ gameId, view, busy, readOnly, run }: Props): React.JSX.Element {
  const [offerTerms, setOfferTerms] = useState('')
  const [offerRecipientId, setOfferRecipientId] = useState(view.opponents[0]?.playerId ?? '')
  const [counterOfferId, setCounterOfferId] = useState<string | null>(null)
  const [counterTerms, setCounterTerms] = useState('')
  // A lost response leaves the player not knowing whether the offer went through.
  // Sending the same thing again reuses the request id, so the server answers with
  // the first outcome instead of making a second offer. An id is dropped on success.
  const requestIds = useRef(new Map<string, string>())
  const canWrite = view.you !== null && !readOnly

  /** The request id for one exact request: the same key gives the same id until it succeeds. */
  const requestIdFor = (key: string): string => {
    const held = requestIds.current.get(key)
    if (held !== undefined) return held
    const fresh = newRequestId()
    requestIds.current.set(key, fresh)
    return fresh
  }

  // The offer controls are only drawn for a viewer who may write; the handlers check
  // too, as a fallback.
  const sendOffer = (): void => {
    const terms = offerTerms.trim()
    if (!canWrite || busy || terms === '' || offerRecipientId === '') return
    const key = `offer\n${offerRecipientId}\n${terms}`
    void run(async () => {
      await api.sendTradeOffer(gameId, offerRecipientId, terms, requestIdFor(key), view.rev)
      requestIds.current.delete(key)
      // What was typed while the request was out is a new draft and stays
      setOfferTerms((current) => (current.trim() === terms ? '' : current))
    })
  }

  const transitionOffer = (offerId: string, action: 'accept' | 'decline' | 'withdraw'): void => {
    if (!canWrite || busy) return
    const key = `${action}\n${offerId}`
    void run(async () => {
      await api.transitionTradeOffer(gameId, offerId, action, requestIdFor(key), view.rev)
      requestIds.current.delete(key)
    })
  }

  const sendCounter = (offerId: string): void => {
    const terms = counterTerms.trim()
    if (!canWrite || busy || terms === '') return
    const key = `counter\n${offerId}\n${terms}`
    void run(async () => {
      await api.counterTradeOffer(gameId, offerId, terms, requestIdFor(key), view.rev)
      requestIds.current.delete(key)
      // The form closes with its offer answered, so its words go too
      setCounterOfferId(null)
      setCounterTerms('')
    })
  }

  return (
    <div className="trade-offers">
      {canWrite && (
        <div className="trade-offer-composer">
          <strong>Trade offer</strong>
          <p className="trade-offer-note">
            Accepting records that you agreed to the terms. It does not transfer resources; settle through the existing controls during the legal trade window.
          </p>
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
            placeholder="Write the terms in plain language"
          />
          <button type="button" disabled={busy || offerRecipientId === '' || offerTerms.trim() === ''} onClick={sendOffer}>Send offer</button>
        </div>
      )}
      <ul className="trade-offer-list">
        {(view.tradeOffers ?? []).map((offer) => {
          const recipient = view.you?.playerId === offer.recipientId
          const sender = view.you?.playerId === offer.senderId
          return (
            <li key={offer.id} className="trade-offer">
              <div className="trade-offer-meta">
                <strong>{`Offer · ${offer.senderUsername} → ${offer.recipientUsername}`}</strong>
                <span className="tag turn">{`T${offer.turnNumber} · ${PHASE_SHORT[offer.phase]}`}</span>
                <span className="tag">{offer.status}</span>
              </div>
              <div className="trade-offer-body">{offer.terms}</div>
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
              {canWrite && counterOfferId === offer.id && (
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
    </div>
  )
}
