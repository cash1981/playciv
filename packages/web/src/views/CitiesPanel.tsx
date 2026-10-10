/**
 * What each city produces, with the arithmetic shown (task `city-production`).
 *
 * The numbers come from the engine (`cityProductionsOf`, carried on every
 * player's view), so the viewer's cities and the opponents' look the same. The
 * estimate is never presented as complete: the map data does not hold every
 * icon. A number typed by hand always wins, and any player in the game may set
 * it, like other board edits. Only the viewer's own cities get the field here;
 * the opponents' are read only, as is everything for a spectator.
 */

import { useEffect, useId, useState } from 'react'

import { MAX_PRODUCTION_OVERRIDE } from '@civ/engine'

import type { BuildChoice, CityActionOptions, CityBuildOptions, CityProduction, PlayerView } from '../lib/api.js'
import { api } from '../lib/api.js'
import { BuildPicker } from './BuildPicker.js'
import type { BuildFlow } from './buildFlow.js'
import { CollapsiblePanel } from './CollapsiblePanel.js'
import { CityActions, useCityActionPress } from './CityActions.js'
import type { Run } from './GameView.js'
import './CitiesPanel.css'

/** The data mixes "forest" (terrain) and "Workshop" (a building's label); show both the same way. */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** A whole number from 0 to the engine's cap, or `null` for anything else (empty, negative, fractional, too big). */
function parseProduction(typed: string): number | null {
  const trimmed = typed.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return parsed <= MAX_PRODUCTION_OVERRIDE ? parsed : null
}

export function CitiesPanel({
  gameId,
  view,
  busy,
  readOnly,
  run,
  build,
}: {
  readonly gameId: string
  readonly view: PlayerView
  readonly busy: boolean
  readonly readOnly: boolean
  readonly run: Run
  /** The Build flow GameView shares with the board. Without it the cards have no Build button. */
  readonly build?: BuildFlow | undefined
}): React.JSX.Element {
  const own = view.you?.cities ?? []
  const others = view.opponents.filter((opponent) => (opponent.cities ?? []).length > 0)
  const nobodyHasCities = own.length === 0 && others.length === 0
  // A spectator has no cities of their own, so the title counts the ones on the map.
  const count =
    view.you === null ? others.reduce((total, opponent) => total + (opponent.cities ?? []).length, 0) : own.length
  // A player with no city of their own, while others have some, would otherwise read as a map without cities.
  const titleCount = view.you !== null && own.length === 0 && others.length > 0 ? `${count} yours` : String(count)

  return (
    <CollapsiblePanel id="cities" title={`Cities (${titleCount})`} defaultOpen={false}>
      <p className="muted">Cities that are not on the map are not listed.</p>
      {nobodyHasCities && <p className="muted">No cities on the map.</p>}

      <CityActions gameId={gameId} view={view} busy={busy} readOnly={readOnly} run={run} />

      {view.you !== null && own.length > 0 && (
        <div className="cities-group">
          <h3 className="cities-owner">Your cities</h3>
          <ul className="cities-list">
            {own.map((city) => (
              <CityCard
                key={city.pieceId}
                city={city}
                gameId={gameId}
                editable={!readOnly}
                busy={busy}
                run={run}
                buildOptions={view.you?.buildOptions?.find((options) => options.cityPieceId === city.pieceId)}
                cityActions={view.you?.cityActions?.find((actions) => actions.cityPieceId === city.pieceId)}
                view={view}
                build={build}
              />
            ))}
          </ul>
        </div>
      )}

      {others.map((opponent) => (
        <div key={opponent.playerId} className="cities-group">
          <h3 className="cities-owner">{opponent.username}</h3>
          <ul className="cities-list">
            {(opponent.cities ?? []).map((city) => (
              <CityCard
                key={city.pieceId}
                city={city}
                gameId={gameId}
                editable={false}
                busy={busy}
                run={run}
              />
            ))}
          </ul>
        </div>
      ))}
    </CollapsiblePanel>
  )
}

function CityCard({
  city,
  gameId,
  editable,
  busy,
  run,
  buildOptions,
  cityActions,
  view,
  build,
}: {
  readonly city: CityProduction
  readonly gameId: string
  readonly editable: boolean
  readonly busy: boolean
  readonly run: Run
  /** What this city can build, for the viewer's own cities only. */
  readonly buildOptions?: CityBuildOptions | undefined
  /** What else this city can do, for the viewer's own cities only. */
  readonly cityActions?: CityActionOptions | undefined
  /** The viewer's view, for the request (revision, player) of a city action. Only the viewer's own cards use it. */
  readonly view?: PlayerView | undefined
  readonly build?: BuildFlow | undefined
}): React.JSX.Element {
  const programId = useId()
  const programShown = city.buildingProgram && city.withBuildingProgram !== null
  return (
    <li className="city-card">
      <h4 className="city-label">{city.label}</h4>

      <p className="city-figure">
        {city.override === null ? (
          <>
            <strong className="city-number">Estimated production: {city.estimate}</strong>
            <span>, not a complete count</span>
          </>
        ) : (
          <>
            <strong className="city-number">Set by hand: {city.override}</strong>{' '}
            <small className="muted">estimate was {city.estimate}</small>
          </>
        )}
      </p>

      {city.buildingProgram && city.withBuildingProgram !== null && (
        <p id={programId} className="city-program">
          {city.override === null
            ? `Building Program in place: ${city.withBuildingProgram} if this city produces now`
            : 'Building Program in place. The figure above is set by hand, so no doubled figure is shown.'}
        </p>
      )}

      <details className="city-details">
        <summary>How it is counted</summary>
        <CityArithmetic city={city} />
      </details>

      {editable && build !== undefined && buildOptions !== undefined && (
        <BuildEntry city={city} options={buildOptions} busy={busy} build={build} />
      )}

      {editable && cityActions !== undefined && view !== undefined && view.you !== null && (
        <StartProgramEntry
          city={city}
          gameId={gameId}
          view={view}
          options={cityActions.startBuildingProgram}
          markerLineId={programShown ? programId : undefined}
          busy={busy}
          run={run}
        />
      )}

      {editable && <OverrideForm city={city} gameId={gameId} busy={busy} run={run} />}
    </li>
  )
}

/** The Build button of one of the viewer's cities, and its picker while it is open. */
function BuildEntry({
  city,
  options,
  busy,
  build,
}: {
  readonly city: CityProduction
  readonly options: CityBuildOptions
  readonly busy: boolean
  readonly build: BuildFlow
}): React.JSX.Element {
  const reasonId = useId()
  const ready = options.status === 'ready'
  const open = build.pickerCityId === city.pieceId
  return (
    <div className="city-build">
      <div className="city-build-row">
        <button
          type="button"
          className="small"
          aria-label={`Build in ${city.label}`}
          aria-expanded={ready ? open : undefined}
          aria-describedby={ready ? undefined : reasonId}
          disabled={busy || !ready}
          onClick={() => (open ? build.closePicker() : build.openPicker(city.pieceId))}
        >
          Build
        </button>
        {!ready && (
          <span id={reasonId} className="muted">
            {options.reason}
          </span>
        )}
      </div>
      {open && (
        <BuildPicker
          city={options}
          note={build.note}
          message={build.message}
          busy={busy}
          onChoose={(choice: BuildChoice) => build.start(options, choice)}
          onClose={build.closePicker}
        />
      )}
    </div>
  )
}

/**
 * The Start Building Program button of one of the viewer's cities. When the
 * marker is already there the card says so on its own line, so the button only
 * points at that line instead of repeating it.
 */
function StartProgramEntry({
  city,
  gameId,
  view,
  options,
  markerLineId,
  busy,
  run,
}: {
  readonly city: CityProduction
  readonly gameId: string
  readonly view: PlayerView
  readonly options: CityActionOptions['startBuildingProgram']
  /** The id of the card's "Building Program in place" line, when it is shown. */
  readonly markerLineId: string | undefined
  readonly busy: boolean
  readonly run: Run
}): React.JSX.Element | null {
  const reasonId = useId()
  const errorId = useId()
  const { sending, message, press } = useCityActionPress(run, view)
  if (view.you === null) return null
  const playerId = view.you.playerId
  const ready = options.status === 'ready'
  const markerHere = options.hasMarker && options.status === 'unavailable'
  // The card's own line says "Building Program in place"; say it here only when that line is not shown.
  const reason = markerHere ? (markerLineId === undefined ? 'Building Program in place' : null) : options.reason

  function start(): void {
    const key = `${gameId}:${playerId}:startBuildingProgram:${city.pieceId}`
    press(key, (requestId) => api.startBuildingProgram(gameId, requestId, view.rev, city.pieceId))
  }

  return (
    <div className="city-build">
      <div className="city-build-row">
        <button
          type="button"
          className="small"
          aria-label={`Start Building Program in ${city.label}`}
          aria-describedby={
            [ready ? undefined : (reason === null ? markerLineId : reasonId), message === null ? undefined : errorId]
              .filter((id) => id !== undefined)
              .join(' ') || undefined
          }
          disabled={busy || sending || !ready}
          onClick={start}
        >
          Start Building Program
        </button>
        {!ready && reason !== null && (
          <span id={reasonId} className="muted">
            {reason}
          </span>
        )}
      </div>
      {message !== null && (
        <p id={errorId} role="alert" className="city-error">
          {message}
        </p>
      )}
    </div>
  )
}

function CityArithmetic({ city }: { readonly city: CityProduction }): React.JSX.Element {
  return (
    <div className="city-arithmetic">
      <p className="city-caption">Outskirts: {city.outskirts}</p>
      {city.outskirtsDetail.length === 0 ? (
        <p className="muted">No outskirts square gives production.</p>
      ) : (
        <ul aria-label={`${city.label} outskirts squares`}>
          {city.outskirtsDetail.map((entry) => (
            <li key={entry.square}>
              {`${entry.square}: ${capitalise(entry.source)}, ${entry.amount}`}
              {entry.blockaded && <span className="city-flag"> (blockaded)</span>}
            </li>
          ))}
        </ul>
      )}

      <p className="city-caption">Added to every city</p>
      {city.modifiers.length === 0 ? (
        <p className="muted">Nothing is added.</p>
      ) : (
        <ul aria-label={`${city.label} modifiers`}>
          {city.modifiers.map((modifier) => (
            <li key={modifier.label}>
              {`${modifier.label}: +${modifier.amount}`}
              {!modifier.applied && <span className="city-flag"> (switched off)</span>}
              {modifier.note !== null && <span className="muted"> {modifier.note}</span>}
            </li>
          ))}
        </ul>
      )}

      <p className="city-caption">Estimate: {city.estimate}</p>
      <ul aria-label={`${city.label} notes`} className="city-notes">
        {city.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </div>
  )
}

function OverrideForm({
  city,
  gameId,
  busy,
  run,
}: {
  readonly city: CityProduction
  readonly gameId: string
  readonly busy: boolean
  readonly run: Run
}): React.JSX.Element {
  const saved = city.override === null ? '' : String(city.override)
  const [draft, setDraft] = useState(saved)
  const [invalid, setInvalid] = useState(false)

  // Follow the saved number only when it changes. A view that refreshes while
  // someone is typing carries the same number, so the half typed draft stays.
  useEffect(() => {
    setDraft(saved)
    setInvalid(false)
  }, [saved])

  const inputId = `city-production-${city.pieceId}`
  const errorId = `${inputId}-error`

  function submit(): void {
    const production = parseProduction(draft)
    if (production === null) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    void run(() => api.setCityProduction(gameId, city.pieceId, production))
  }

  return (
    <form
      className="city-edit"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <label htmlFor={inputId} className="city-edit-label">
        Production, set by hand
      </label>
      <div className="city-edit-row">
        <input
          id={inputId}
          className="city-input"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          aria-label={`Production, set by hand, ${city.label}`}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          value={draft}
          disabled={busy}
          onChange={(event) => {
            setDraft(event.target.value)
            setInvalid(false)
          }}
        />
        <button type="submit" className="small" aria-label={`Set production of ${city.label}`} disabled={busy}>
          Set
        </button>
        <button
          type="button"
          className="small"
          aria-label={`Use the estimate for ${city.label}`}
          disabled={busy || city.override === null}
          onClick={() => {
            setInvalid(false)
            void run(() => api.setCityProduction(gameId, city.pieceId, null))
          }}
        >
          Use the estimate
        </button>
      </div>
      {invalid && (
        <p id={errorId} role="alert" className="city-error">
          Type a whole number from 0 to {MAX_PRODUCTION_OVERRIDE}.
        </p>
      )}
    </form>
  )
}
