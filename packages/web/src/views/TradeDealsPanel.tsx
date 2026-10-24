/**
 * The Trade deals panel in the chat: every deal between the players, public for everybody who can
 * see the game. Deals are grouped into threads, so an offer and its counteroffers sit together, and
 * a ◀ ▶ pager walks the turns. Writing and answering a deal stays in the Trade tab of Your actions.
 */

import { useState } from 'react'

import type { PlayerView } from '../lib/api.js'
import { TradeDealThread } from './TradeDealThread.js'
import { offersOfTurn, threadsOf } from './tradeDeals.js'
import './TradeOffers.css'

interface Props {
  readonly view: PlayerView
  readonly tabPanelId: string
  readonly labelledBy: string
}

export function TradeDealsPanel({ view, tabPanelId, labelledBy }: Props): React.JSX.Element {
  const offers = view.tradeOffers ?? []
  const currentTurn = Math.max(view.activeTurn?.turnNumber ?? 1, ...offers.map((offer) => offer.turnNumber))
  const [pick, setPick] = useState<number | null>(null)
  const turn = Math.min(Math.max(pick ?? currentTurn, 1), currentTurn)
  const threads = threadsOf(offersOfTurn(offers, turn))

  return (
    <div role="tabpanel" id={tabPanelId} aria-labelledby={labelledBy} className="trade-deals">
      <div className="trade-deals-pager" role="group" aria-label="Turn">
        <button type="button" className="small" aria-label="Previous turn" title="Previous turn" disabled={turn <= 1} onClick={() => setPick(turn - 1)}>
          ◀
        </button>
        <strong>{`Turn ${turn}`}</strong>
        <button type="button" className="small" aria-label="Next turn" title="Next turn" disabled={turn >= currentTurn} onClick={() => setPick(turn + 1 >= currentTurn ? null : turn + 1)}>
          ▶
        </button>
      </div>
      {threads.length === 0 ? (
        <p className="muted">{`No trade deals in turn ${turn}.`}</p>
      ) : (
        threads.map((thread) => <TradeDealThread key={thread.root.id} thread={thread} />)
      )}
    </div>
  )
}
