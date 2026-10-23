/**
 * Playing a culture event or Great Person card (assisted play, part 13).
 *
 * Two places use the same {@link PlayCardControl}: the phase tabs, which list the
 * ready cards of the hand that can be played in that phase, and the hand itself, where
 * each card that can ever be played has a Play button. Whether it is enabled is the
 * engine's answer in `view.you.playableCards`; nothing here knows a card's timing. A
 * listed card's name goes to the same card in the hand.
 *
 * Playing asks first, because it takes the card out of the hand: who the card names
 * (the log says it), the resource a gift is played as, then Confirm. The game only
 * logs the play and discards the card. It does not apply the effect, because another
 * player may cancel the card, so the control says so.
 */

import { useId, useState } from 'react'

import { CARD_TIMING_TEXT } from '@civ/engine'
import type { CardTiming, PlayableCard, TurnPhase } from '@civ/engine'

import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import { pressOnce } from './AssistedActions.js'
import type { Run } from './GameView.js'
import { HelpHint } from './HelpHint.js'
import { goToHandItem } from './PhaseSummary.js'
import './PlayableCards.css'

const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

/** "Start of turn", "Start of turn or city management": where the card is played. */
export const timingLabel = (timings: readonly CardTiming[]): string =>
  capitalized(timings.map((timing) => CARD_TIMING_TEXT[timing]).join(' or '))

/** The most players a card can name that the picker must keep inside its limit. */
const targetLimit = (card: PlayableCard): { readonly min: number; readonly max: number } =>
  card.targets.kind === 'players' ? card.targets : { min: 0, max: 0 }

interface ControlProps {
  readonly card: PlayableCard
  readonly gameId: string
  readonly view: PlayerView
  readonly busy: boolean
  readonly readOnly?: boolean
  readonly run: Run
}

/**
 * The Play button of one card, with its form while it is open. Disabled, with the
 * reason as text, when the card cannot be played now.
 */
export function PlayCardControl({
  card,
  gameId,
  view,
  busy,
  readOnly = false,
  run,
}: ControlProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<readonly string[]>([])
  const [resource, setResource] = useState('')
  const formId = useId()
  if (view.you === null) return null

  const ready = card.status === 'ready'
  const others = view.opponents
  const { min, max } = targetLimit(card)
  const needsResource = card.resources.length > 0
  // A card that must name exactly one player, in a game with one other player, has no choice to make
  const effective =
    card.targets.kind === 'players' && min >= 1 && others.length === 1 && chosen.length === 0
      ? others.map((opponent) => opponent.playerId)
      : chosen
  const valid =
    effective.length >= min &&
    effective.length <= max &&
    (!needsResource || resource !== '')
  const disabled = busy || readOnly

  const toggle = (playerId: string): void =>
    setChosen(
      effective.includes(playerId)
        ? effective.filter((id) => id !== playerId)
        : effective.length >= max
          ? effective
          : [...effective, playerId],
    )

  const confirm = (): void => {
    if (!valid || view.you === null) return
    const playerId = view.you.playerId
    const key = `${gameId}:${playerId}:playCard:${card.itemId}:${[...effective].sort().join(',')}:${resource}`
    void pressOnce(
      key,
      run,
      (requestId) =>
        api.actionWithArgs(gameId, 'playCard', requestId, view.rev, {
          itemId: card.itemId,
          targets: card.targets.kind === 'players' ? effective : [],
          ...(needsResource ? { resource } : {}),
        }),
      view,
    ).then((succeeded) => {
      if (succeeded) setOpen(false)
    })
  }

  return (
    <div className="play-card">
      <div className="play-card-row">
        <button
          type="button"
          className="small"
          aria-label={`${card.kind === 'greatPerson' && !card.discards ? 'Use' : 'Play'} ${card.name}`}
          aria-expanded={ready ? open : undefined}
          aria-controls={ready && open ? formId : undefined}
          disabled={disabled || !ready}
          title={ready ? undefined : card.reason}
          onClick={() => setOpen((current) => !current)}
        >
          {card.kind === 'greatPerson' && !card.discards ? 'Use' : 'Play'}
        </button>
        {!ready && <HelpHint label={card.name}>{card.reason}</HelpHint>}
      </div>

      {ready && open && (
        <form
          id={formId}
          className="play-card-form"
          aria-label={`Play ${card.name}`}
          onSubmit={(event) => {
            event.preventDefault()
            confirm()
          }}
        >
          {card.targets.kind === 'players' && (
            <fieldset className="play-card-targets">
              <legend>{card.prompt}</legend>
              {others.length === 0 && <p className="muted">There is no other player.</p>}
              {others.map((opponent) => (
                <label key={opponent.playerId} className="play-card-target">
                  <input
                    type="checkbox"
                    checked={effective.includes(opponent.playerId)}
                    disabled={disabled || (!effective.includes(opponent.playerId) && effective.length >= max)}
                    onChange={() => toggle(opponent.playerId)}
                  />{' '}
                  {opponent.username}
                </label>
              ))}
              <p className="muted">
                {min === max
                  ? `Choose ${min}.`
                  : min === 0
                    ? `Choose up to ${max}, or nobody.`
                    : `Choose ${min} to ${max}.`}
              </p>
            </fieldset>
          )}
          {card.targets.kind === 'allOthers' && (
            <p className="play-card-all">This card names every other player.</p>
          )}
          {needsResource && (
            <label className="play-card-resource">
              Play it as{' '}
              <select
                value={resource}
                disabled={disabled}
                onChange={(event) => setResource(event.target.value)}
              >
                <option value="">Choose a resource</option>
                {card.resources.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="muted play-card-note">
            The game logs this and {card.discards ? 'discards the card' : 'turns the card faceup'}. It does not
            apply the effect: do that yourself unless another player cancels the card.
          </p>
          <div className="play-card-buttons">
            <button type="submit" className="small" disabled={disabled || !valid}>
              {card.kind === 'greatPerson' && !card.discards ? 'Confirm use' : 'Confirm play'}
            </button>
            <button type="button" className="small" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

interface ListProps {
  readonly gameId: string
  readonly view: PlayerView
  readonly phase: TurnPhase
  readonly busy: boolean
  readonly readOnly: boolean
  readonly run: Run
}

/**
 * The ready cards of the hand that belong to a phase tab: the ones played in that phase
 * and the ones that can be played at any time, which are listed in every tab. Nothing
 * when no such card is ready, and nothing for a spectator.
 */
export function PlayableCardList({
  gameId,
  view,
  phase,
  busy,
  readOnly,
  run,
}: ListProps): React.JSX.Element | null {
  if (view.you === null) return null
  const cards = (view.you.playableCards ?? []).filter(
    (card) =>
      card.status === 'ready' && (card.timings.includes(phase) || card.timings.includes('ANY')),
  )
  if (cards.length === 0) return null

  return (
    <section className="phase-group" aria-label="Cards you can play">
      <h3 className="phase-group-title">Cards you can play</h3>
      <ul className="playable-cards">
        {cards.map((card) => (
          <li key={card.itemId} className="playable-card">
            <button
              type="button"
              className="link playable-card-name"
              title={`Show ${card.name} in your hand`}
              aria-label={`Show ${card.name} in your hand`}
              onClick={() => goToHandItem(card.itemId)}
            >
              {card.name}
            </button>{' '}
            <span className="tag">{timingLabel(card.timings)}</span>
            <PlayCardControl
              card={card}
              gameId={gameId}
              view={view}
              busy={busy}
              readOnly={readOnly}
              run={run}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
