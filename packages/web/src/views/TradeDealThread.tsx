/**
 * One deal as a thread: the offers in it, oldest first, each with who sent it to whom, the turn and
 * phase it was made in, what became of it and, for an offer that went to several players, what each
 * of them said. Read only; the Trade tab hands in `actions` to put buttons under an offer.
 */

import type { PublicTradeOffer } from '@civ/engine'

import type { DealThread } from './tradeDeals.js'
import { PHASE_SHORT, recipientsText, responsesText, wentToSeveral } from './tradeDeals.js'

interface Props {
  readonly thread: DealThread
  /** Content under an offer, such as its buttons. */
  readonly actions?: (offer: PublicTradeOffer) => React.ReactNode
}

export function TradeDealThread({ thread, actions }: Props): React.JSX.Element {
  const label = thread.root.open
    ? `Open deal from ${thread.root.senderUsername}`
    : `Deal from ${thread.root.senderUsername} to ${recipientsText(thread.root)}`
  return (
    <section className="trade-thread" aria-label={label}>
      <h4 className="trade-thread-title">{label}</h4>
      <ol className="trade-thread-offers">
        {thread.offers.map((offer, index) => (
          <li key={offer.id} className={`trade-offer${index > 0 ? ' trade-offer-reply' : ''}`}>
            <div className="trade-offer-meta">
              <strong>{`${index > 0 ? 'Counteroffer' : 'Offer'} · ${offer.senderUsername} → ${recipientsText(offer)}`}</strong>
              <span className="tag turn">{`T${offer.turnNumber} · ${PHASE_SHORT[offer.phase]}`}</span>
              <span className={`tag trade-status trade-status-${offer.status}`}>{offer.status}</span>
            </div>
            <div className="trade-offer-body">{offer.terms}</div>
            {wentToSeveral(offer) && offer.responses.length > 0 && (
              <div className="trade-offer-responses muted">{responsesText(offer)}</div>
            )}
            {offer.chosenUsername !== null && (
              <div className="trade-offer-responses muted">{`Made with ${offer.chosenUsername}`}</div>
            )}
            {actions?.(offer)}
          </li>
        ))}
      </ol>
    </section>
  )
}
