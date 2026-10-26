/**
 * The Trade tab's own controls: the Trade box, and trade offers.
 *
 * The Trade box is the viewer's `stats.trade` from the Status panel, which stays the master: it is
 * read and written with the same call, so an edit on either side shows on both. The engine resets
 * trade to the coins kept at the start of the turn and adds the trade around the viewer's cities
 * once, when Trade starts; the box shows that stored number. A turn saved before this rule still
 * gets a guess (the trade so far plus the cities), and the box keeps what the viewer types.
 *
 * An offer is a note in plain language, to one player, a few of them or everybody (an open deal).
 * Accepting records that the players agreed; it moves nothing, so they settle it with the existing
 * controls. The tab shows the deals of the current turn; the Trade deals panel in the chat has them all.
 */

import { useEffect, useRef, useState } from 'react'

import type { PublicTradeOffer } from '@civ/engine'

import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import type { Run } from './GameView.js'
import { HelpHint } from './HelpHint.js'
import { TradeDealThread } from './TradeDealThread.js'
import { offersOfTurn, threadsOf, wentToSeveral } from './tradeDeals.js'
import './TradeOffers.css'

function newRequestId(): string {
  const random = globalThis.crypto?.randomUUID
  return typeof random === 'function'
    ? random.call(globalThis.crypto)
    : `offer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

interface Props {
  readonly gameId: string
  readonly view: PlayerView
  readonly busy: boolean
  readonly readOnly: boolean
  readonly run: Run
}

/**
 * The Trade box: one number, the viewer's trade. Once the engine has collected the city trade (or the
 * viewer has set it from this box or the Status panel, on any device: the game remembers it) it shows
 * the stored number. Only a turn with no collection yet shows the guess, and says it is not saved.
 * Leaving the field saves what it shows, as the Status panel's Trade does.
 */
export function TradeCollected({ gameId, view, busy, readOnly, run }: Props): React.JSX.Element | null {
  const you = view.you
  const stored = you?.stats.trade ?? 0
  const suggested = you?.tradeEstimate.total ?? 0
  const set = you?.tradeEstimate.set ?? true
  const shown = String(set ? stored : suggested)
  const [draft, setDraft] = useState(shown)
  const editing = useRef(false)
  // Escape cancels: the blur that follows it must not save what the field goes back to
  const cancelled = useRef(false)

  // The number follows the game, except while the viewer is typing in it
  useEffect(() => {
    if (!editing.current) setDraft(shown)
  }, [shown])

  if (you === null) return null
  const estimate = you.tradeEstimate

  const commit = (): void => {
    editing.current = false
    if (cancelled.current) {
      cancelled.current = false
      setDraft(shown)
      return
    }
    const text = draft.trim()
    const parsed = Number(text)
    if (text === '' || !Number.isInteger(parsed) || parsed < 0 || parsed > estimate.ceiling) {
      setDraft(shown)
      return
    }
    // A number the game already holds still counts as setting it for the turn, so it is sent
    if (parsed !== stored || !set) void run(() => api.setPlayerStat(gameId, you.playerId, 'trade', parsed))
    else setDraft(String(parsed))
  }

  const unsaved = !set || draft.trim() !== String(stored)
  return (
    <div className="trade-box">
      <div className="trade-collected">
        <label htmlFor="trade-input">Trade</label>
        <input
          id="trade-input"
          className="stat-input"
          type="text"
          inputMode="numeric"
          aria-label="Trade"
          title={estimate.collected
            ? 'Your trade: the coins you kept plus the trade around your cities. Edit it and leave the field to save.'
            : estimate.set
              ? 'Your trade, set by hand for this turn. Edit it and leave the field to save.'
              : 'Your trade. It starts from a guess; leave the field to save the number.'}
          value={draft}
          disabled={busy || readOnly}
          onChange={(event) => {
            editing.current = true
            setDraft(event.target.value)
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              editing.current = false
              cancelled.current = true
              setDraft(shown)
              event.currentTarget.blur()
            }
          }}
        />
        {unsaved && <span className="trade-unsaved muted">Not saved yet</span>}
        <HelpHint label={estimate.collected
          ? 'How the trade was counted'
          : estimate.set
            ? 'How the trade is set'
            : 'How the trade is guessed'}>
          <p>
            {estimate.collected
              ? 'The trade around your cities was added once when Trade started. It is the same number as Trade in the Status panel, and opening this tab does not count it again.'
              : estimate.set
                ? 'The number is set by hand for this turn. It is the same number as Trade in the Status panel, and the city trade is not added on top.'
                : 'The number is a guess, and you set the real one: it is saved when you leave the field. It is the same number as Trade in the Status panel.'}
          </p>
          <ul aria-label={estimate.collected ? 'Trade count' : estimate.set ? 'Trade set' : 'Trade guess'}>
            {(!estimate.set || estimate.collected) && <li>{`Trade so far: ${estimate.current}`}</li>}
            <li>{`Trade around your cities: ${estimate.cities}`}</li>
            <li>{estimate.collected
              ? `Collected: ${estimate.total}, at most ${estimate.ceiling}`
              : estimate.set
                ? `Set by hand: ${estimate.total}, at most ${estimate.ceiling}`
                : `Guess: ${estimate.total}, at most ${estimate.ceiling}`}</li>
          </ul>
          {you.cities.length > 0 && (
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
          <ul aria-label={estimate.collected ? 'Trade count notes' : 'Trade guess notes'}>
            {[...new Set(you.cities.flatMap((city) => city.trade.notes))].map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </HelpHint>
      </div>
    </div>
  )
}

export function TradeOffers({ gameId, view, busy, readOnly, run }: Props): React.JSX.Element {
  const [offerTerms, setOfferTerms] = useState('')
  const [targets, setTargets] = useState<readonly string[]>([])
  const [openDeal, setOpenDeal] = useState(false)
  const [counterOfferId, setCounterOfferId] = useState<string | null>(null)
  const [counterTerms, setCounterTerms] = useState('')
  // A lost response leaves the player not knowing whether the offer went through.
  // Sending the same thing again reuses the request id, so the server answers with
  // the first outcome instead of making a second offer. An id is dropped on success.
  const requestIds = useRef(new Map<string, string>())
  const canWrite = view.you !== null && !readOnly

  // The tab shows the deals of this turn. It is folded away until there is one.
  const turn = view.activeTurn?.turnNumber ?? 1
  const thisTurn = offersOfTurn(view.tradeOffers ?? [], turn)
  const threads = threadsOf(thisTurn)
  const [expanded, setExpanded] = useState(thisTurn.length > 0)
  const lastTurn = useRef(turn)
  const hadDeals = useRef(thisTurn.length > 0)
  useEffect(() => {
    if (lastTurn.current !== turn) {
      // A new turn starts folded again, until it has a deal
      lastTurn.current = turn
      setExpanded(thisTurn.length > 0)
    } else if (thisTurn.length > 0 && !hadDeals.current) {
      setExpanded(true)
    }
    hadDeals.current = thisTurn.length > 0
  }, [turn, thisTurn.length])

  /** The request id for one exact request: the same key gives the same id until it succeeds. */
  const requestIdFor = (key: string): string => {
    const held = requestIds.current.get(key)
    if (held !== undefined) return held
    const fresh = newRequestId()
    requestIds.current.set(key, fresh)
    return fresh
  }

  const toggleTarget = (playerId: string): void =>
    setTargets((current) => (current.includes(playerId) ? current.filter((id) => id !== playerId) : [...current, playerId]))

  const hasRecipient = openDeal || targets.length > 0

  // The offer controls are only drawn for a viewer who may write; the handlers check
  // too, as a fallback.
  const sendOffer = (): void => {
    const terms = offerTerms.trim()
    if (!canWrite || busy || terms === '' || !hasRecipient) return
    const who = openDeal ? 'open' : [...targets].sort().join(',')
    const key = `offer\n${who}\n${terms}`
    void run(async () => {
      await api.sendTradeOffer(gameId, openDeal ? { open: true } : { recipientIds: targets }, terms, requestIdFor(key), view.rev)
      requestIds.current.delete(key)
      // What was typed while the request was out is a new draft and stays
      setOfferTerms((current) => (current.trim() === terms ? '' : current))
    })
  }

  const transitionOffer = (offerId: string, action: 'accept' | 'decline' | 'withdraw' | 'choose', chosenId?: string): void => {
    if (!canWrite || busy) return
    const key = `${action}\n${offerId}\n${chosenId ?? ''}`
    void run(async () => {
      await api.transitionTradeOffer(gameId, offerId, action, requestIdFor(key), view.rev, chosenId)
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

  /** The buttons under one offer, for the viewer's part in it. */
  const actionsFor = (offer: PublicTradeOffer): React.ReactNode => {
    const you = view.you
    if (you === null || !canWrite || offer.status !== 'pending') return null
    const recipient = offer.recipientIds.includes(you.playerId)
    const sender = you.playerId === offer.senderId
    if (!recipient && !sender) return null
    const several = wentToSeveral(offer)
    const mine = offer.responses.find((response) => response.playerId === you.playerId)?.action
    // A player who has left cannot be chosen
    const inGame = new Set([...view.opponents.map((player) => player.playerId), you.playerId])
    const accepters = offer.responses.filter((response) => response.action === 'accept' && inGame.has(response.playerId))
    return (
      <>
        <div className="trade-offer-actions">
          {recipient && (
            <>
              <button
                type="button"
                disabled={busy}
                title={several ? 'Say you would. The sender chooses who the deal is made with.' : 'Agree to the terms'}
                onClick={() => transitionOffer(offer.id, 'accept')}
              >
                Accept
              </button>
              <button type="button" disabled={busy} onClick={() => transitionOffer(offer.id, 'decline')}>Decline</button>
              <button type="button" disabled={busy} onClick={() => setCounterOfferId(counterOfferId === offer.id ? null : offer.id)}>Counter</button>
              {several && mine !== undefined && <span className="muted">{`You ${mine === 'accept' ? 'accepted' : 'declined'}`}</span>}
            </>
          )}
          {sender && (
            <>
              {several && accepters.map((response) => (
                <button
                  key={response.playerId}
                  type="button"
                  disabled={busy}
                  title={`Make the deal with ${response.username}`}
                  onClick={() => transitionOffer(offer.id, 'choose', response.playerId)}
                >
                  {`Choose ${response.username}`}
                </button>
              ))}
              <button type="button" disabled={busy} onClick={() => transitionOffer(offer.id, 'withdraw')}>Withdraw</button>
            </>
          )}
        </div>
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
      </>
    )
  }

  return (
    <div className="trade-offers">
      <button
        type="button"
        className="trade-offers-toggle"
        aria-expanded={expanded}
        aria-controls="trade-offers-body"
        onClick={() => setExpanded((current) => !current)}
      >
        {`${expanded ? '▾' : '▸'} Trade offers`}
        <span className="muted">{` · Turn ${turn} · ${threads.length === 0 ? 'no deals' : `${threads.length} ${threads.length === 1 ? 'deal' : 'deals'}`}`}</span>
      </button>
      <div id="trade-offers-body" hidden={!expanded}>
        {canWrite && (
          <div className="trade-offer-composer">
            <p className="trade-offer-note">
              Accepting records that you agreed to the terms. It does not transfer resources; settle through the existing controls during the legal trade window.
              Every deal is public and stays with the turn it was made in.
            </p>
            <fieldset className="trade-offer-recipients">
              <legend>Send to</legend>
              <label>
                <input type="checkbox" checked={openDeal} onChange={(event) => setOpenDeal(event.target.checked)} />
                Everyone (an open deal)
              </label>
              {view.opponents.map((player) => (
                <label key={player.playerId}>
                  <input
                    type="checkbox"
                    checked={openDeal || targets.includes(player.playerId)}
                    disabled={openDeal}
                    onChange={() => toggleTarget(player.playerId)}
                  />
                  {player.username}
                </label>
              ))}
            </fieldset>
            <label htmlFor="trade-offer-terms">Terms</label>
            <textarea
              id="trade-offer-terms"
              value={offerTerms}
              onChange={(event) => setOfferTerms(event.target.value)}
              maxLength={2000}
              placeholder="Write the terms in plain language"
            />
            <button type="button" disabled={busy || !hasRecipient || offerTerms.trim() === ''} onClick={sendOffer}>Send offer</button>
          </div>
        )}
        {threads.length === 0 ? (
          <p className="muted">No trade deals this turn. Earlier turns are in the Trade deals panel in the chat.</p>
        ) : (
          threads.map((thread) => <TradeDealThread key={thread.root.id} thread={thread} actions={actionsFor} />)
        )}
      </div>
    </div>
  )
}
