/**
 * The Start of Turn choices that are more than a button (assisted play, part 13): change
 * government, harvest with Feudalism, invest a coin, and the free techs waiting to be
 * learned. The buttons themselves (policies, government abilities) come from
 * `view.you.availableActions`; the choices behind these four come from
 * `view.you.startOfTurn`, which the engine computes for the viewer. Nothing here is a
 * rule: it shows the status and reason the engine gives and sends one request per press.
 */

import { useEffect, useId, useRef, useState } from 'react'

import type { Government } from '@civ/engine'

import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import { AssistedActionButton, pressOnce } from './AssistedActions.js'
import type { Run } from './GameView.js'
import { HelpHint } from './HelpHint.js'
import { useMapPicker } from './mapPick.js'
import { goToPanel } from './PhaseSummary.js'
import { openGovernmentReference } from './GovernmentReferenceDialog.js'
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

/** "a level I tech", "a tech of your choice", or one of Edison's eligible techs. */
const techWords = (level: number | null, allowedTechNames?: readonly string[]): string =>
  allowedTechNames === undefined
    ? level === null
      ? 'a tech of your choice'
      : `a level ${ROMAN[level] ?? level} tech`
    : `one of ${allowedTechNames.join(' or ')}`

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
      <FreeBuildPicker
        {...common}
        answer={sot.giannini}
        action="gianniniBuild"
        title={GIANNINI_TITLE}
        className="sot-giannini"
        showUnavailable={false}
      />
      <ScoutsAndCities {...common} />
      <MetropolisGrowth gameId={gameId} view={view} busy={common.busy} run={run} />
    </>
  )
}

/**
 * The Spanish free building, asked for whenever a credit is unspent: the tile is explored in Movement, so this sits above
 * the phase tabs and not in the Start of Turn tab. Nothing without a credit, for a spectator or for another civilization.
 */
export function SpanishFreeBuild({ gameId, view, busy, readOnly, run }: Props): React.JSX.Element | null {
  const sot = view.you?.startOfTurn
  const spanish = sot?.spanish ?? null
  if (view.you === null || sot === undefined || sot === null || spanish === null) return null
  return (
    <FreeBuildPicker
      gameId={gameId}
      view={view}
      busy={busy || readOnly}
      run={run}
      sot={sot}
      answer={spanish}
      action="spanishBuild"
      title={SPANISH_TITLE}
      className="sot-spanish"
      showUnavailable
    />
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
            You may learn {techWords(grant.level, grant.allowedTechNames)} for free ({grant.source}).
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
      // Named when two cities offer the resource, as an unsent scout's square is the same for both
      shared: feudalism.cities.filter((other) => other.choices.some((c) => c.resource === choice.resource)).length > 1,
    })),
  )
  // A choice that is gone after a refresh is forgotten, so it is not selected again if it returns
  const stale = picked !== '' && !options.some((option) => option.key === picked)
  useEffect(() => {
    if (stale) setPicked('')
  }, [stale])
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
                {choice.available ? '' : `: ${choice.unavailableReason ?? 'none left'}`}
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
              cities, or under a scout (or a sent English army) that gathers for it. The list is what the map shows around each city.
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
  const cardId = useId()
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
          <div className="sot-field">
            <label htmlFor={cardId}>Marker on</label>
            <span className="card-control">
              <select id={cardId} value={card} disabled={busy} onChange={(event) => setCard(event.target.value)}>
                <option value="">Choose a card</option>
                {invest.cards.map((entry) => (
                  <option key={entry.key} value={entry.key}>
                    {entry.label}
                  </option>
                ))}
              </select>
              <HelpHint label="Investment cards">
                <InvestmentHelp cards={invest.cards} />
              </HelpHint>
            </span>
          </div>
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

const GIANNINI_TITLE = 'A. P. Giannini: a free building'
const SPANISH_TITLE = 'Spanish: a free building'

type FreeBuildChoice = NonNullable<StartOfTurn['giannini']>['choices'][number]
type FreeBuildSquare = FreeBuildChoice['squares'][number]
const squareKeyOf = (square: FreeBuildSquare): string => `${square.cityPieceId}:${square.column}:${square.row}`

interface FreeBuildPickerProps extends ChoiceProps {
  /** The engine's answer for this free building, `null` when it does not apply to the viewer. */
  readonly answer: StartOfTurn['giannini']
  /** The assisted action the choice is sent to. Both take the same payload. */
  readonly action: 'gianniniBuild' | 'spanishBuild'
  readonly title: string
  readonly className: string
  /** Show the reason when nothing can be built now (the Spanish keep their credit), instead of hiding the section or tagging it as used. */
  readonly showUnavailable: boolean
}

/**
 * A free building: one building, on a square of one of the player's cities, from the choices the engine lists. A. P.
 * Giannini's (a building he has unlocked, after an invest) and the Spanish one (a basic building for a tile explored)
 * share it. A choice that a refresh takes away is dropped, not sent.
 */
function FreeBuildPicker({ gameId, view, busy, run, answer, action, title, className, showUnavailable }: FreeBuildPickerProps): React.JSX.Element | null {
  const [assetId, setAssetId] = useState('')
  // The key of a square with a note (it replaces a building), picked on the map and read here before the button builds.
  const [pickedKey, setPickedKey] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  // Whether a board pick is open now, and a counter that opens one again on request.
  const [pickOpen, setPickOpen] = useState(false)
  const [restart, setRestart] = useState(0)
  const mapPicker = useMapPicker()
  const buildButton = useRef<HTMLButtonElement>(null)
  const playerId = view.you?.playerId ?? ''

  const chosen = answer?.status === 'ready' ? answer.choices.find((choice) => choice.assetId === assetId) : undefined
  const chosenId = chosen?.assetId
  const squaresKey = chosen?.squares.map(squareKeyOf).join('|') ?? ''
  // Read again from the current choice on every render: a square a refresh took away is no longer picked, and its note is the current one.
  const picked = pickedKey === null ? null : (chosen?.squares.find((square) => squareKeyOf(square) === pickedKey) ?? null)
  const hasPicked = picked !== null

  const busyRef = useRef(busy)
  const build = (choice: FreeBuildChoice, square: FreeBuildSquare): void => {
    const key = `${gameId}:${playerId}:${action}:${choice.assetId}:${squareKeyOf(square)}`
    setSending(true)
    void pressOnce(
      key,
      run,
      (requestId) =>
        api.actionWithArgs(gameId, action, requestId, view.rev, {
          cityPieceId: square.cityPieceId,
          assetId: choice.assetId,
          column: square.column,
          row: square.row,
        }),
      view,
    ).then((done) => {
      setSending(false)
      if (done) {
        setAssetId('')
        setPickedKey(null)
      }
      // Not done (declined, refused, a repeated press): nothing reopens and the page does not move; the buttons below start again.
    })
  }
  // The pick below resolves later than the render that opened it: it builds with the latest view and choice.
  const buildRef = useRef(build)
  useEffect(() => {
    busyRef.current = busy
    buildRef.current = build
  })

  // The building is chosen in the list; the square is then picked on the map, where the legal squares around the cities are
  // highlighted (the same board picker as a Build). A plain square builds at once, one that replaces a building is read first.
  // It opens on a change of building or squares, not on every refresh or send.
  useEffect(() => {
    if (mapPicker === null || chosen === undefined || hasPicked) return
    const choice = chosen
    let stale = false
    let settled = false
    setPickOpen(true)
    void mapPicker.begin({ title: choice.label, cells: choice.squares }).then((cell) => {
      settled = true
      if (stale) return
      setPickOpen(false)
      if (cell === null) {
        setAssetId('')
        return
      }
      const square = choice.squares.find((candidate) => candidate === cell) ?? choice.squares.find((candidate) => candidate.column === cell.column && candidate.row === cell.row)
      if (square === undefined) return
      if (square.note !== undefined) setPickedKey(squareKeyOf(square))
      else if (!busyRef.current) buildRef.current(choice, square)
    })
    return () => {
      stale = true
      setPickOpen(false)
      if (!settled) mapPicker.cancel()
    }
    // The pick follows the building and its squares, not every refresh of the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapPicker, chosenId, squaresKey, hasPicked, restart])

  // A replacing square was tapped and the board pick closed: bring the note and its button into view.
  useEffect(() => {
    if (hasPicked) buildButton.current?.focus()
  }, [hasPicked])

  if (answer === null || (!showUnavailable && answer.status !== 'ready' && answer.status !== 'used')) return null

  return (
    <section className={`phase-group ${className}`} aria-label={title}>
      <h3 className="phase-group-title">{title}</h3>
      {answer.status === 'ready' ? (
        <div className="sot-form">
          <label>
            Building{' '}
            <select
              value={chosen === undefined ? '' : chosen.assetId}
              disabled={busy || sending}
              onChange={(event) => {
                setAssetId(event.target.value)
                setPickedKey(null)
              }}
            >
              <option value="">Choose a building</option>
              {answer.choices.map((choice) => (
                <option key={choice.assetId} value={choice.assetId}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          <p className="muted" role="status">
            {chosen === undefined
              ? ''
              : picked === null
                ? `Pick a square for the ${chosen.label} on the map.`
                : `${chosen.label} in ${picked.cityLabel} on ${picked.label}. ${picked.note ?? `Replaces your ${picked.replaces?.label ?? 'building'}.`}`}
          </p>
          {chosen !== undefined && picked !== null && (
            <>
              <button ref={buildButton} type="button" className="small" disabled={busy || sending} onClick={() => build(chosen, picked)}>
                Build for free
              </button>
              <button
                type="button"
                className="small"
                disabled={sending}
                onClick={() => {
                  setPickedKey(null)
                  setRestart((count) => count + 1)
                }}
              >
                Pick another square
              </button>
            </>
          )}
          {chosen !== undefined && picked === null && !pickOpen && (
            <button type="button" className="small" disabled={busy || sending} onClick={() => setRestart((count) => count + 1)}>
              Pick a square on the map
            </button>
          )}
          {chosen !== undefined && (
            <button
              type="button"
              className="small"
              disabled={sending}
              onClick={() => {
                setAssetId('')
                setPickedKey(null)
              }}
            >
              Cancel
            </button>
          )}
        </div>
      ) : (
        <div className="assisted-action">
          <button type="button" className="small" disabled title={answer.reason}>
            Build for free
          </button>
          {answer.status === 'used' && <span className="tag">Used</span>}
          {answer.status === 'unavailable' && showUnavailable ? (
            <p className="muted">{answer.reason}</p>
          ) : (
            <HelpHint label={title}>{answer.reason}</HelpHint>
          )}
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
            and the city gets that square&apos;s production. A scout you do not send goes to your capital. A scout on
            the centre of one of your cities sends no square. A scout placed this turn gathers from next turn.
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
            {!scout.canSend && scout.figure === 'scout' && <span className="muted"> sends no square: it stands on a city centre</span>}
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
  const selectId = useId()
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
      <div className="sot-field">
        <label htmlFor={selectId}>Send the square of {square} to</label>
        <div className="sot-row">
          <select
            id={selectId}
            value={value}
            disabled={busy || cities.length === 0}
            onChange={(event) => setChosen({ for: assignedTo, city: event.target.value })}
          >
            {!byDefault && <option value="">{assignedTo === null ? 'No city' : 'Back to the default'}</option>}
            {cities.map((city) => (
              <option key={city.pieceId} value={city.pieceId}>
                {city.label}
              </option>
            ))}
          </select>
          <button type="submit" className="small" disabled={busy || !changed}>
            Send
          </button>
          {byDefault && <span className="muted">Capital</span>}
        </div>
      </div>
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
        <p className="muted">The Zulu explore the huts next to the city ({zuluHuts.join(', ')}) at once, when a hut card is left.</p>
      )}
    </div>
  )
}

/**
 * Agriculture grows the capital into a metropolis (issue #354): the button highlights the sides the capital can grow on, on the
 * map, and the square tapped names the side. It lists whatever stops a side when none is legal. It is not tied to the Start of
 * Turn (the card says "immediately"): the same button is in every phase tab; here it is next to the other Start of Turn choices.
 */
function MetropolisGrowth({ gameId, view, busy, run }: Pick<ChoiceProps, 'gameId' | 'view' | 'busy' | 'run'>): React.JSX.Element | null {
  const you = view.you
  if (you === null) return null
  const agriculture = (you.techsChosen ?? []).some((tech) => tech.name === 'Agriculture' && !tech.hidden)
  const capital = (you.cities ?? []).some((city) => city.label.startsWith('Capital'))
  if (!agriculture || !capital) return null
  return (
    <section className="phase-group sot-metropolis" aria-label="Metropolis">
      <h3 className="phase-group-title">Grow your capital into a metropolis</h3>
      <AssistedActionButton action="agriculture" gameId={gameId} view={view} busy={busy} readOnly={false} run={run} reasonPlacement="inline" />
    </section>
  )
}
