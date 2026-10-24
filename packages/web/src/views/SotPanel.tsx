/**
 * The Start of Turn choices that are more than a button (assisted play, part 13): change
 * government, harvest with Feudalism, invest a coin, and the free techs waiting to be
 * learned. The buttons themselves (policies, government abilities) come from
 * `view.you.availableActions`; the choices behind these four come from
 * `view.you.startOfTurn`, which the engine computes for the viewer. Nothing here is a
 * rule: it shows the status and reason the engine gives and sends one request per press.
 */

import { useState } from 'react'

import type { Government } from '@civ/engine'

import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import { pressOnce } from './AssistedActions.js'
import type { Run } from './GameView.js'
import { HelpHint } from './HelpHint.js'
import { goToPanel } from './PhaseSummary.js'
import { openGovernmentReference } from './StatusPanel.js'
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
      <div className="assisted-action">
        <button type="button" className="small" onClick={() => goToPanel('techs')}>
          Go to the tech tree
        </button>
        <HelpHint label="Free techs">
          Choose the tech and reveal it in the tech tree. Revealing a tech that fits uses up the free tech.
        </HelpHint>
      </div>
    </section>
  )
}

function GovernmentChange({ gameId, view, busy, run, sot }: ChoiceProps): React.JSX.Element | null {
  const { government } = sot
  const ready = government.status === 'ready'
  const direct = government.options.filter((option) => option.route === 'direct')
  const playerId = view.you?.playerId ?? ''
  // Nothing to press when the change cannot be made: shown while ready, and as used once it is done
  if (!ready && government.status !== 'used') return null
  if (direct.length === 0 && !government.canEnterAnarchy) return null

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
      <div className="assisted-action">
        {direct.map((option) => (
          <button
            key={option.government}
            type="button"
            className="small"
            aria-label={`Change to ${option.government}`}
            title={option.reason}
            disabled={busy || !ready}
            onClick={() => change(option.government)}
          >
            Change to {option.government}
          </button>
        ))}
        {government.canEnterAnarchy && (
          <button
            type="button"
            className="small"
            aria-label="Change to Anarchy"
            title="Your capital takes no action this turn and your social policies have no effect. Next Start of Turn you can take any government you know."
            disabled={busy || !ready}
            onClick={() => change('Anarchy')}
          >
            Change to Anarchy
          </button>
        )}
        {!ready && <span className="tag">Used</span>}
        <button
          type="button"
          className="help-button"
          aria-label="Show government card reference"
          title={`You are governed by ${government.current}. Show the government cards.`}
          onClick={openGovernmentReference}
        >
          ?
        </button>
      </div>
    </section>
  )
}

function FeudalismHarvest({
  gameId,
  view,
  busy,
  run,
  feudalism,
}: ChoiceProps & { readonly feudalism: NonNullable<StartOfTurn['feudalism']> }): React.JSX.Element | null {
  // One list of every resource the map shows around the player's cities; the label already names the square
  const [picked, setPicked] = useState('')
  const ready = feudalism.status === 'ready'
  const options = feudalism.cities.flatMap((city) =>
    city.choices.map((choice) => ({
      key: `${city.pieceId}:${choice.resource}`,
      city,
      choice,
      // The square does not tell two cities apart when both have the resource
      shared: feudalism.cities.filter((other) => other.choices.some((c) => c.resource === choice.resource)).length > 1,
    })),
  )
  const selected = options.find((option) => option.key === picked && option.choice.available)
  const valid = selected !== undefined
  const playerId = view.you?.playerId ?? ''

  const harvest = (): void => {
    if (selected === undefined) return
    const { city, choice } = selected
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
      if (done) setPicked('')
    })
  }

  // Only when it can be done (or was done this turn and returns next turn)
  if (!ready && feudalism.status !== 'used') return null

  return (
    <section className="phase-group sot-feudalism" aria-label="Feudalism harvest">
      <h3 className="phase-group-title">Feudalism: harvest a resource</h3>
      <form
        className="sot-form"
        onSubmit={(event) => {
          event.preventDefault()
          harvest()
        }}
      >
        <label>
          Resource{' '}
          <select value={picked} disabled={busy || !ready} onChange={(event) => setPicked(event.target.value)}>
            <option value="">Choose a resource</option>
            {options.map(({ key, city, choice, shared }) => (
              <option key={key} value={key} disabled={!choice.available}>
                {choice.label}
                {shared ? ` (${city.label})` : ''}
                {choice.available ? '' : ` (${choice.unavailableReason ?? 'none left'})`}
              </option>
            ))}
          </select>
        </label>
        <span className="card-control sot-invest-card">
          <button type="submit" className="small" title={ready ? undefined : feudalism.reason} disabled={busy || !ready || !valid}>
            Harvest
          </button>
          {!ready && <span className="tag">Used</span>}
          <HelpHint label="Feudalism: harvest a resource">
            <p>
              Take one resource token from the market, from a square with its icon in the outskirts of one of your
              cities, or under a scout that gathers for it. The list is what the map shows around each city.
            </p>
            <p>
              The same resource icon cannot be harvested twice in a turn, also not by the Harvest of a city. The game
              does not track that.
            </p>
            <p>{feudalism.reason}</p>
            {options.length === 0 && <p>The map shows no resource in the outskirts of your cities.</p>}
          </HelpHint>
        </span>
      </form>
    </section>
  )
}

function InvestmentHelp({ cards }: { readonly cards: StartOfTurn['invest']['cards'] }): React.JSX.Element {
  return (
    <>
      <p>
        You may invest one coin each turn. Only coin tokens on your sheet and on tech cards can be invested, not coins
        printed on the map, a building, a government or a card.
      </p>
      <ul className="sot-cards" aria-label="Investment cards">
        {cards.map((entry) => (
          <li key={entry.key}>
            <strong>{entry.label}</strong>: {entry.markers} {entry.markers === 1 ? 'marker' : 'markers'}. {entry.ability}{' '}
            <span className="muted">Active at {entry.thresholds.join(', ')}.</span>
          </li>
        ))}
      </ul>
    </>
  )
}

function Invest({ gameId, view, busy, run, sot }: ChoiceProps): React.JSX.Element | null {
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

  if (invest.status !== 'ready' && invest.status !== 'used') return null

  return (
    <section className="phase-group sot-invest" aria-label="Invest a coin">
      <h3 className="phase-group-title">Invest a coin</h3>
      {ready ? (
        <form
          className="sot-form"
          onSubmit={(event) => {
            event.preventDefault()
            press()
          }}
        >
          <label>
            Coin from{' '}
            <select value={chosenSource} disabled={busy} onChange={(event) => setSource(event.target.value)}>
              <option value="">Choose where the coin comes from</option>
              {invest.coins.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label} ({entry.coins})
                </option>
              ))}
            </select>
          </label>
          <span className="card-control sot-invest-card">
            <label>
              Marker on{' '}
              <select
                aria-label="Marker on"
                value={card}
                disabled={busy}
                onChange={(event) => setCard(event.target.value)}
              >
                <option value="">Choose a card</option>
                {invest.cards.map((entry) => (
                  <option key={entry.key} value={entry.key}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
            <HelpHint label="Investment cards">
              <InvestmentHelp cards={invest.cards} />
            </HelpHint>
          </span>
          <button type="submit" className="small" disabled={busy || !valid}>
            Invest
          </button>
        </form>
      ) : (
        <div className="assisted-action">
          <button type="button" className="small" disabled title={invest.reason}>
            Invest
          </button>
          <span className="tag">Used</span>
          <HelpHint label="Invest a coin">{invest.reason}</HelpHint>
        </div>
      )}
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
  // No scout on the map, or nothing to do with one right now: nothing to show
  if (scouts.length === 0 || scoutsNow.status !== 'ready') return null

  const found = (pieceId: string): void => {
    const key = `${gameId}:${playerId}:foundCity:${pieceId}`
    void pressOnce(
      key,
      run,
      (requestId) => api.actionWithArgs(gameId, 'foundCity', requestId, view.rev, { figurePieceId: pieceId }),
      view,
    ).then((done) => {
      if (done) goToPanel('board')
    })
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
      <h3 className="phase-group-title">
        Scouts and cities
        <HelpHint label="Scouts and cities">
          <p>
            You have {cityLimit.have} of the {cityLimit.max} cities you may have (a third city needs Irrigation). A new
            city replaces the scout that stands where it goes. A scout sends its square to one city for the whole turn,
            and the city gets that square&apos;s production. A scout you do not send goes to your capital. A scout
            placed this turn gathers from next turn.
          </p>
          <p>
            A scout gathers for its city alone. Its square counts for the city&apos;s production, and its culture and
            resource icons are offered to that city&apos;s Devote to the Arts and Harvest. The trade and coin icons are
            still counted by hand.
          </p>
          <p>Move any other figures of yours on the square of a new city to a square next to it.</p>
          {scouts.map((scout) => (
            <p key={scout.pieceId}>
              <strong>{scout.square}:</strong>{' '}
              {scout.found.ok ? 'a city can be founded here.' : scout.found.reasons.join(' ')}
            </p>
          ))}
        </HelpHint>
      </h3>
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
                busy={busy}
                send={send}
              />
            )}
            <FoundHere
              pieceId={scout.pieceId}
              square={scout.square}
              ok={scout.found.ok}
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
      {byDefault && <span className="muted">Capital</span>}
    </form>
  )
}

function FoundHere({
  pieceId,
  square,
  ok,
  zuluHuts,
  busy,
  found,
}: {
  readonly pieceId: string
  readonly square: string
  readonly ok: boolean
  readonly zuluHuts: readonly string[]
  readonly busy: boolean
  readonly found: (pieceId: string) => void
}): React.JSX.Element | null {
  // A city that cannot be founded here has no button; the section's `?` says why
  if (!ok) return null
  return (
    <div className="sot-found">
      <button
        type="button"
        className="small"
        aria-label={`Found a city here on ${square}`}
        disabled={busy}
        onClick={() => found(pieceId)}
      >
        Found a city here
      </button>
      {zuluHuts.length > 0 && (
        <p className="muted">The Zulu may explore the hut next to the city ({zuluHuts.join(', ')}). Do that by hand.</p>
      )}
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
      <div className="assisted-action">
        <button type="button" className="small" onClick={() => goToPanel('board')}>
          Go to the map
        </button>
        <HelpHint label="Metropolis">
          You have Agriculture, so your capital grows into a metropolis when it can: on the capital&apos;s square and one
          square next to it, with no enemy figure there and its outskirts on the map. Do it on the map.
        </HelpHint>
      </div>
    </section>
  )
}
