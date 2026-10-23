/**
 * The Start of Turn choices that are more than a button (assisted play, part 13): change
 * government, harvest with Feudalism, invest a coin, and the free techs waiting to be
 * learned. The buttons themselves (policies, government abilities) come from
 * `view.you.availableActions`; the choices behind these four come from
 * `view.you.startOfTurn`, which the engine computes for the viewer. Nothing here is a
 * rule: it shows the status and reason the engine gives and sends one request per press.
 */

import { useId, useState } from 'react'

import type { Government } from '@civ/engine'

import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import { pressOnce } from './AssistedActions.js'
import type { Run } from './GameView.js'
import { goToPanel } from './PhaseSummary.js'
import './SotPanel.css'

type StartOfTurn = NonNullable<NonNullable<PlayerView['you']>['startOfTurn']>

interface Props {
  readonly gameId: string
  readonly view: PlayerView
  readonly busy: boolean
  readonly readOnly: boolean
  readonly run: Run
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'] as const

/** "a level I tech", "a tech of your choice". */
const techWords = (level: number | null): string => (level === null ? 'a tech of your choice' : `a level ${ROMAN[level] ?? level} tech`)

/**
 * The choices of the Start of Turn, in the order the rules list them: free techs
 * waiting, the government, the harvest of Feudalism, the investment, and the scouts
 * and cities. Nothing for a spectator or for a replayed revision.
 */
export function StartOfTurnChoices({ gameId, view, busy, readOnly, run }: Props): React.JSX.Element | null {
  const sot = view.you?.startOfTurn
  if (view.you === null || sot === undefined || sot === null) return null
  const common = { gameId, view, busy: busy || readOnly, run, sot }
  return (
    <>
      <TechGrants grants={sot.techGrants} />
      <GovernmentChange {...common} />
      {sot.feudalism !== null && <FeudalismHarvest {...common} feudalism={sot.feudalism} />}
      <Invest {...common} />
      <ScoutsAndCities {...common} />
      <MetropolisHint view={view} />
    </>
  )
}

interface ChoiceProps {
  readonly gameId: string
  readonly view: PlayerView
  readonly busy: boolean
  readonly run: Run
  readonly sot: StartOfTurn
}

function TechGrants({ grants }: { readonly grants: StartOfTurn['techGrants'] }): React.JSX.Element | null {
  if (grants.length === 0) return null
  return (
    <section className="phase-group sot-grants" aria-label="Free techs">
      <h3 className="phase-group-title">Free techs waiting</h3>
      <ul className="sot-grant-list">
        {grants.map((grant) => (
          <li key={grant.id}>
            You may learn {techWords(grant.level)} for free ({grant.source}).
          </li>
        ))}
      </ul>
      <p className="muted">
        Choose the tech and reveal it in the tech tree. Revealing a tech that fits uses up the free tech.
      </p>
      <button type="button" className="small" onClick={() => goToPanel('techs')}>
        Go to the tech tree
      </button>
    </section>
  )
}

/** The reason a control is blocked, as text the button points at; nothing while it is ready. */
function Reason({ id, status, reason }: { readonly id: string; readonly status: string; readonly reason: string }): React.JSX.Element | null {
  if (status === 'ready') return null
  return (
    <p id={id} className="muted sot-reason">
      {reason}
    </p>
  )
}

function GovernmentChange({ gameId, view, busy, run, sot }: ChoiceProps): React.JSX.Element {
  const reasonId = useId()
  const { government } = sot
  const ready = government.status === 'ready'
  const direct = government.options.filter((option) => option.route === 'direct')
  const viaAnarchy = government.options.filter((option) => option.route === 'anarchy')
  const playerId = view.you?.playerId ?? ''

  const change = (target: Government): void => {
    const key = `${gameId}:${playerId}:switchGovernment:${target}`
    void pressOnce(
      key,
      run,
      (requestId) => api.actionWithArgs(gameId, 'switchGovernment', requestId, view.rev, { government: target }),
      view,
    )
  }

  return (
    <section className="phase-group sot-government" aria-label="Change government">
      <h3 className="phase-group-title">Change government</h3>
      <p>
        You are governed by <strong>{government.current}</strong>. You can change once in your Start of Turn.
      </p>
      <Reason id={reasonId} status={government.status} reason={government.reason} />
      {ready && direct.length === 0 && viaAnarchy.length === 0 && !government.canEnterAnarchy && (
        <p className="muted">You know no other government.</p>
      )}
      <ul className="sot-options">
        {direct.map((option) => (
          <li key={option.government}>
            <button
              type="button"
              className="small"
              aria-label={`Change to ${option.government}`}
              aria-describedby={ready ? undefined : reasonId}
              disabled={busy || !ready}
              onClick={() => change(option.government)}
            >
              Change to {option.government}
            </button>{' '}
            <span className="muted sot-option-reason">{option.reason}</span>
          </li>
        ))}
        {viaAnarchy.map((option) => (
          <li key={option.government} className="sot-option-anarchy">
            <span className="sot-option-name">{option.government}</span>{' '}
            <span className="muted sot-option-reason">Only through Anarchy. {option.reason}</span>
          </li>
        ))}
        {government.canEnterAnarchy && (
          <li>
            <button
              type="button"
              className="small"
              aria-label="Change to Anarchy"
              aria-describedby={ready ? undefined : reasonId}
              disabled={busy || !ready}
              onClick={() => change('Anarchy')}
            >
              Change to Anarchy
            </button>{' '}
            <span className="muted sot-option-reason">
              Your capital takes no action this turn and your social policies have no effect. Next Start of Turn you can
              take any government you know.
            </span>
          </li>
        )}
      </ul>
    </section>
  )
}

function FeudalismHarvest({
  gameId,
  view,
  busy,
  run,
  feudalism,
}: ChoiceProps & { readonly feudalism: NonNullable<StartOfTurn['feudalism']> }): React.JSX.Element {
  const reasonId = useId()
  const [cityPieceId, setCity] = useState('')
  const [resource, setResource] = useState('')
  const ready = feudalism.status === 'ready'
  // A single city is chosen for the player; a city picked earlier is dropped when it is gone
  const known = feudalism.cities.find((candidate) => candidate.pieceId === cityPieceId)
  const city = known ?? (feudalism.cities.length === 1 ? feudalism.cities[0] : undefined)
  const choice = city?.choices.find((candidate) => candidate.resource === resource && candidate.available)
  const valid = city !== undefined && choice !== undefined
  const playerId = view.you?.playerId ?? ''

  const harvest = (): void => {
    if (city === undefined || choice === undefined) return
    const key = `${gameId}:${playerId}:feudalismHarvest:${city.pieceId}:${choice.resource}`
    void pressOnce(
      key,
      run,
      (requestId) =>
        api.actionWithArgs(gameId, 'feudalismHarvest', requestId, view.rev, {
          cityPieceId: city.pieceId,
          resource: choice.resource,
        }),
      view,
    ).then((done) => {
      if (done) setResource('')
    })
  }

  return (
    <section className="phase-group sot-feudalism" aria-label="Feudalism harvest">
      <h3 className="phase-group-title">Feudalism: harvest a resource</h3>
      <p>
        Take one resource token from the market, from a square with its icon in the outskirts of one of your cities. The
        list is what the map shows around each city.
      </p>
      <p className="muted">
        The same resource icon cannot be harvested twice in a turn, also not by the Harvest of a city. The game does not
        track that.
      </p>
      <Reason id={reasonId} status={feudalism.status} reason={feudalism.reason} />
      <form
        className="sot-form"
        onSubmit={(event) => {
          event.preventDefault()
          harvest()
        }}
      >
        <label>
          City{' '}
          <select
            value={city?.pieceId ?? ''}
            disabled={busy || !ready}
            onChange={(event) => {
              setCity(event.target.value)
              setResource('')
            }}
          >
            <option value="">Choose a city</option>
            {feudalism.cities.map((candidate) => (
              <option key={candidate.pieceId} value={candidate.pieceId}>
                {candidate.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Resource{' '}
          <select value={resource} disabled={busy || !ready || city === undefined} onChange={(event) => setResource(event.target.value)}>
            <option value="">{city === undefined ? 'Choose a city first' : 'Choose a resource'}</option>
            {(city?.choices ?? []).map((candidate) => (
              <option key={candidate.resource} value={candidate.resource} disabled={!candidate.available}>
                {candidate.label}
                {candidate.available ? '' : ` (${candidate.unavailableReason ?? 'none left'})`}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="small"
          aria-describedby={ready ? undefined : reasonId}
          disabled={busy || !ready || !valid}
        >
          Harvest
        </button>
      </form>
      {city !== undefined && city.choices.length === 0 && (
        <p className="muted">The map shows no resource in the outskirts of {city.label}.</p>
      )}
    </section>
  )
}

function Invest({ gameId, view, busy, run, sot }: ChoiceProps): React.JSX.Element {
  const reasonId = useId()
  const { invest } = sot
  const [source, setSource] = useState('')
  const [card, setCard] = useState('')
  const ready = invest.status === 'ready'
  const chosenSource = source === '' && invest.coins.length === 1 ? (invest.coins[0]?.key ?? '') : source
  const valid = chosenSource !== '' && card !== ''
  const playerId = view.you?.playerId ?? ''

  const press = (): void => {
    if (!valid) return
    const key = `${gameId}:${playerId}:invest:${chosenSource}:${card}`
    void pressOnce(
      key,
      run,
      (requestId) =>
        api.actionWithArgs(gameId, 'invest', requestId, view.rev, { source: chosenSource, card }),
      view,
    ).then((done) => {
      if (done) {
        setSource('')
        setCard('')
      }
    })
  }

  return (
    <section className="phase-group sot-invest" aria-label="Invest a coin">
      <h3 className="phase-group-title">Invest a coin</h3>
      <p>
        You may invest one coin each turn. Only coin tokens on your sheet and on tech cards can be invested, not coins
        printed on the map, a building, a government or a card.
      </p>
      <Reason id={reasonId} status={invest.status} reason={invest.reason} />
      <ul className="sot-cards" aria-label="Your investment cards">
        {invest.cards.map((entry) => (
          <li key={entry.key}>
            <strong>{entry.label}</strong>: {entry.markers} {entry.markers === 1 ? 'marker' : 'markers'}. {entry.ability}{' '}
            <span className="muted">Active at {entry.thresholds.join(', ')}.</span>
          </li>
        ))}
      </ul>
      <form
        className="sot-form"
        onSubmit={(event) => {
          event.preventDefault()
          press()
        }}
      >
        <label>
          Coin from{' '}
          <select value={chosenSource} disabled={busy || !ready} onChange={(event) => setSource(event.target.value)}>
            <option value="">Choose where the coin comes from</option>
            {invest.coins.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label} ({entry.coins})
              </option>
            ))}
          </select>
        </label>
        <label>
          Marker on{' '}
          <select value={card} disabled={busy || !ready} onChange={(event) => setCard(event.target.value)}>
            <option value="">Choose a card</option>
            {invest.cards.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="small"
          aria-describedby={ready ? undefined : reasonId}
          disabled={busy || !ready || !valid}
        >
          Invest
        </button>
      </form>
    </section>
  )
}

const terrainWords = (terrain: string | null): string => (terrain === null ? 'unknown terrain' : terrain)

/**
 * The scouts: each can send its square to one of the player's cities for the whole turn,
 * and found a city where it stands. The reasons a city cannot be founded are listed, all
 * of them, so the player sees what to fix.
 */
function ScoutsAndCities({ gameId, view, busy, run, sot }: ChoiceProps): React.JSX.Element | null {
  const playerId = view.you?.playerId ?? ''
  const { scouts, cities, cityLimit, scoutsNow } = sot
  if (scouts.length === 0 && cityLimit.have >= cityLimit.max) return null
  const now = scoutsNow.status === 'ready'

  const found = (pieceId: string): void => {
    const key = `${gameId}:${playerId}:foundCity:${pieceId}`
    void pressOnce(
      key,
      run,
      (requestId) => api.actionWithArgs(gameId, 'foundCity', requestId, view.rev, { figurePieceId: pieceId }),
      view,
    )
  }
  const send = (pieceId: string, cityPieceId: string | null): void => {
    const key = `${gameId}:${playerId}:assignScout:${pieceId}:${cityPieceId ?? 'none'}`
    void pressOnce(
      key,
      run,
      (requestId) => api.actionWithArgs(gameId, 'assignScout', requestId, view.rev, { scoutPieceId: pieceId, cityPieceId }),
      view,
    )
  }

  return (
    <section className="phase-group sot-scouts" aria-label="Scouts and cities">
      <h3 className="phase-group-title">Scouts and cities</h3>
      <p>
        You have {cityLimit.have} of the {cityLimit.max} cities you may have (a third city needs Irrigation). A new city
        replaces the scout that stands where it goes. A scout sends its square to one city for the whole turn, and the
        city gets that square&apos;s production. A scout you do not send goes to your capital. A scout placed this turn
        gathers from next turn.
      </p>
      <p className="muted">
        A scout gathers for its city alone. Its square counts for the city's production, and its culture and
        resource icons are offered to that city's Devote to the Arts and Harvest. The trade and coin icons are still counted
        by hand.
      </p>
      {!now && <p className="muted sot-reason">{scoutsNow.reason}</p>}
      {scouts.length === 0 && <p className="muted">You have no scout on the map.</p>}
      <ul className="sot-scout-list">
        {scouts.map((scout) => (
          <li key={scout.pieceId} className="sot-scout">
            <strong>
              {scout.figure === 'army' ? 'Army' : 'Scout'} on {scout.square}
            </strong>{' '}
            <span className="muted">({terrainWords(scout.terrain)})</span>
            {scout.canSend && (
              <SendSquare
                scoutId={scout.pieceId}
                square={scout.square}
                assignedTo={scout.assignedTo}
                byDefault={scout.assignedByDefault}
                cities={cities}
                busy={busy || !now}
                send={send}
              />
            )}
            <FoundHere
              pieceId={scout.pieceId}
              square={scout.square}
              ok={now && scout.found.ok}
              reasons={now ? scout.found.reasons : [scoutsNow.reason]}
              zuluHuts={scout.found.zuluHuts}
              busy={busy}
              found={found}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

function SendSquare({
  scoutId,
  square,
  assignedTo,
  byDefault,
  cities,
  busy,
  send,
}: {
  readonly scoutId: string
  readonly square: string
  readonly assignedTo: string | null
  readonly byDefault: boolean
  readonly cities: StartOfTurn['cities']
  readonly busy: boolean
  readonly send: (pieceId: string, cityPieceId: string | null) => void
}): React.JSX.Element {
  // The choice made in the list lasts until the engine's answer changes (an undo, another device)
  const [chosen, setChosen] = useState<{ readonly for: string | null; readonly city: string } | null>(null)
  const value = chosen !== null && chosen.for === assignedTo ? chosen.city : (assignedTo ?? '')
  const changed = value !== (assignedTo ?? '')
  return (
    <form
      className="sot-form sot-send"
      onSubmit={(event) => {
        event.preventDefault()
        if (!changed) return
        send(scoutId, value === '' ? null : value)
        // The answer that comes back shows the city; a choice kept here would come back after an undo
        setChosen(null)
      }}
    >
      <label>
        Send the square of {square} to{' '}
        <select value={value} disabled={busy || cities.length === 0} onChange={(event) => setChosen({ for: assignedTo, city: event.target.value })}>
          {!byDefault && <option value="">{assignedTo === null ? 'No city' : 'Back to the default'}</option>}
          {cities.map((city) => (
            <option key={city.pieceId} value={city.pieceId}>
              {city.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="small" disabled={busy || !changed}>
        Send
      </button>
      {cities.length === 0 && <span className="muted">You have no city on the map.</span>}
      {byDefault && <span className="muted">Your capital, because you did not send it anywhere.</span>}
    </form>
  )
}

function FoundHere({
  pieceId,
  square,
  ok,
  reasons,
  zuluHuts,
  busy,
  found,
}: {
  readonly pieceId: string
  readonly square: string
  readonly ok: boolean
  readonly reasons: readonly string[]
  readonly zuluHuts: readonly string[]
  readonly busy: boolean
  readonly found: (pieceId: string) => void
}): React.JSX.Element {
  const reasonId = useId()
  return (
    <div className="sot-found">
      <button
        type="button"
        className="small"
        aria-label={`Found a city here on ${square}`}
        aria-describedby={ok ? undefined : reasonId}
        disabled={busy || !ok}
        onClick={() => found(pieceId)}
      >
        Found a city here
      </button>
      {!ok && (
        <ul id={reasonId} className="muted sot-reasons" aria-label={`Why no city on ${square}`}>
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      {ok && zuluHuts.length > 0 && (
        <p className="muted">The Zulu may explore the hut next to the city ({zuluHuts.join(', ')}). Do that by hand.</p>
      )}
      {ok && <p className="muted">Move any other figures of yours on {square} to a square next to it.</p>}
    </div>
  )
}

/**
 * Agriculture grows the capital into a metropolis on the map, which the game does not do
 * for the player (the human, 2026-10-23): a pointer to the board is all it gives.
 */
function MetropolisHint({ view }: { readonly view: PlayerView }): React.JSX.Element | null {
  const you = view.you
  if (you === null) return null
  const agriculture = (you.techsChosen ?? []).some((tech) => tech.name === 'Agriculture' && !tech.hidden)
  const capital = (you.cities ?? []).some((city) => city.label.startsWith('Capital'))
  if (!agriculture || !capital) return null
  return (
    <section className="phase-group sot-metropolis" aria-label="Metropolis">
      <h3 className="phase-group-title">Grow your capital into a metropolis</h3>
      <p>
        You have Agriculture, so your capital grows into a metropolis when it can: on the capital&apos;s square and one
        square next to it, with no enemy figure there and its outskirts on the map. Do it on the map.
      </p>
      <button type="button" className="small" onClick={() => goToPanel('board')}>
        Go to the map
      </button>
    </section>
  )
}
