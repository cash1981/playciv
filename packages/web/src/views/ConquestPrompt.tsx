/**
 * The prompt for a conquest (issue #368). After a battle for a village or a city is won as the Romans or the Chinese the
 * engine makes an offer and waits: nothing is ever gained without the player's answer. It is shown above the phase tabs
 * in "Your actions", like a card choice that is waiting, so it cannot hide behind a tab.
 *
 * Nothing here is a rule. The offers, and why a Roman advance is stopped now, come from `view.you.conquestOffers`;
 * one press sends one `claimConquest` and the engine checks it again against the fresh state.
 */

import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import { pressOnce } from './AssistedActions.js'
import type { Run } from './GameView.js'
import './ConquestPrompt.css'

type Offer = NonNullable<PlayerView['you']>['conquestOffers'][number]

interface Props {
  readonly gameId: string
  readonly view: PlayerView
  readonly busy: boolean
  readonly readOnly: boolean
  readonly run: Run
}

const whatOf = (offer: Offer): string => `${offer.kind === 'village' ? 'village' : 'city'} on ${offer.square}`

/** What the viewer is offered, in a sentence that names the civilization the reward comes from. */
export const conquestSentence = (offer: Offer): string =>
  `You conquered the ${whatOf(offer)}. ` +
  (offer.civ === 'Romans'
    ? 'As the Romans you may advance one space on the culture track.'
    : 'As the Chinese you gain 3 culture.')

const acceptText = (offer: Offer): string => (offer.civ === 'Romans' ? 'Advance' : 'Take 3 culture')

/** The open conquest offers of the viewer, each with the two answers. Nothing when there is none. */
export function ConquestPrompt({ gameId, view, busy, readOnly, run }: Props): React.JSX.Element | null {
  const offers = view.you?.conquestOffers ?? []
  if (view.you === null || offers.length === 0) return null
  const playerId = view.you.playerId

  // A refusal reaches the player through `run`, the page's own error, once: the reason a Roman advance is stopped is on the
  // offer before the press, from the view, so it is not written a second time here
  const answer = (offer: Offer, accept: boolean): void => {
    const key = `${gameId}:${playerId}:claimConquest:${offer.id}:${accept ? 'yes' : 'no'}`
    void pressOnce(
      key,
      run,
      (requestId) => api.actionWithArgs(gameId, 'claimConquest', requestId, view.rev, { offerId: offer.id, accept }),
      view,
    )
  }

  return (
    <section className="assisted-conquest" aria-label="Conquest">
      {offers.map((offer) => {
        // A Roman advance that is stopped now says why, and cannot be pressed; saying no is never stopped
        const stopped = offer.blocked
        return (
          <div key={offer.id} className="assisted-conquest-offer">
            <p className="assisted-conquest-text">{conquestSentence(offer)}</p>
            <div className="assisted-action">
              <button
                type="button"
                className="small"
                disabled={busy || readOnly || stopped !== null}
                title={stopped ?? undefined}
                onClick={() => answer(offer, true)}
              >
                {acceptText(offer)}
              </button>
              <button type="button" className="small" disabled={busy || readOnly} onClick={() => answer(offer, false)}>
                No thanks
              </button>
            </div>
            {stopped !== null && <p className="assisted-conquest-stopped">Not now: {stopped}</p>}
            {offer.nothing != null && (
              <p className="assisted-conquest-stopped muted">
                Nothing to advance: {offer.nothing.charAt(0).toLowerCase() + offer.nothing.slice(1)} Accepting only closes this.
              </p>
            )}
          </div>
        )
      })}
    </section>
  )
}
