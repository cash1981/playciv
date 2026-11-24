/**
 * The prompt for a conquest (issue #368). After a battle for a village is won (any civilization) or for a city (the Romans) the
 * engine makes an offer and waits: nothing is ever gained without the player's answer. It is shown above the phase tabs
 * in "Your actions", like a card choice that is waiting, so it cannot hide behind a tab, and in the Battle panel right
 * after End battle, where the arena is.
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
  /** The region's name; the Battle panel's copy has its own, so the two can be told apart. */
  readonly label?: string
}

const whatOf = (offer: Offer): string => `${offer.kind === 'village' ? 'village' : 'city'} on ${offer.square}`

const VILLAGE_TAKEN = 'Take it: its token goes to your area and its card into your hand.'
const ROMAN_ADVANCE = 'advance one space on the culture track'

/**
 * What the viewer is offered, in a sentence that names the civilization the extra reward comes from. A village is offered to
 * every civilization (the token and its card); the Romans and the Chinese also get their extra. A village whose token has gone
 * from the square says so and offers only the extra.
 */
export const conquestSentence = (offer: Offer): string => {
  const gone = offer.kind === 'village' && offer.villageGone === true
  const lead =
    offer.kind === 'village' && !gone
      ? `You conquered the ${whatOf(offer)}. ${VILLAGE_TAKEN}`
      : gone
        ? `You conquered the ${whatOf(offer)}, but its token is no longer on the map.`
        : `You conquered the ${whatOf(offer)}.`
  if (offer.civ === 'Romans') return `${lead} As the Romans you ${gone || offer.kind === 'city' ? 'may' : 'may also'} ${ROMAN_ADVANCE}.`
  if (offer.civ === 'Chinese') return `${lead} As the Chinese you ${gone ? '' : 'also '}gain 3 culture.`
  return gone ? `${lead} There is nothing to take.` : lead
}

const acceptText = (offer: Offer): string => {
  const village = offer.kind === 'village' && offer.villageGone !== true
  if (offer.civ === 'Romans') return village ? 'Take village and advance' : 'Advance'
  if (offer.civ === 'Chinese') return village ? 'Take village and 3 culture' : 'Take 3 culture'
  return village ? 'Take the village' : 'Close'
}

/** The open conquest offers of the viewer, each with the two answers. Nothing when there is none. */
export function ConquestPrompt({ gameId, view, busy, readOnly, run, label = 'Conquest' }: Props): React.JSX.Element | null {
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
    <section className="assisted-conquest" aria-label={label}>
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
                Nothing to advance: {offer.nothing.charAt(0).toLowerCase() + offer.nothing.slice(1)}{' '}
                {offer.kind === 'village' && offer.villageGone !== true ? 'Accepting still takes the village.' : 'Accepting only closes this.'}
              </p>
            )}
          </div>
        )
      })}
    </section>
  )
}
