/**
 * The Start of Turn choices that are more than a button (assisted play, part 9): change
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
 * waiting, the government, the harvest of Feudalism and the investment. Nothing for a
 * spectator or for a replayed revision.
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
  const city = cityPieceId === '' ? (feudalism.cities.length === 1 ? (feudalism.cities[0]?.pieceId ?? '') : '') : cityPieceId
  const valid = city !== '' && resource !== ''
  const playerId = view.you?.playerId ?? ''

  const harvest = (): void => {
    if (!valid) return
    const key = `${gameId}:${playerId}:feudalismHarvest:${city}:${resource}`
    void pressOnce(
      key,
      run,
      (requestId) => api.actionWithArgs(gameId, 'feudalismHarvest', requestId, view.rev, { cityPieceId: city, resource }),
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
        game cannot see the map icons, so you say which city and which resource.
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
          <select value={city} disabled={busy || !ready} onChange={(event) => setCity(event.target.value)}>
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
          <select value={resource} disabled={busy || !ready} onChange={(event) => setResource(event.target.value)}>
            <option value="">Choose a resource</option>
            {feudalism.resources.map((name) => (
              <option key={name} value={name}>
                {name}
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
