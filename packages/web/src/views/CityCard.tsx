/**
 * One city with what it produces and the arithmetic behind it (tasks
 * `city-production` and `cities-in-actions`).
 *
 * The numbers come from the engine (`cityProductionsOf`, carried on every
 * player's view), so the viewer's cities and the opponents' look the same. The
 * estimate is never presented as complete: the map data does not hold every
 * icon. A number typed by hand always wins, and any player in the game may set
 * it, like other board edits. Only the viewer's own card gets the controls
 * (`own`): Build, Start Building Program and the field to set production by
 * hand. An opponent's card has the figure and the popup, nothing to press.
 *
 * The viewer's cards sit in "Your actions" (`YourCities.tsx`) and the
 * opponents' in the Cities panel (`CitiesPanel.tsx`); this is the card both use.
 */

import { useEffect, useId, useRef, useState } from 'react'

import { MAX_PRODUCTION_OVERRIDE } from '@civ/engine'

import type { BuildChoice, CityActionOptions, CityBuildOptions, CityProduction, PlayerView } from '../lib/api.js'
import { api } from '../lib/api.js'
import { BuildPicker } from './BuildPicker.js'
import type { BuildFlow } from './buildFlow.js'
import { useCityActionPress } from './CityActions.js'
import type { Run } from './GameView.js'
import { ReferenceDialog } from './ReferenceDialog.js'
import './CityCard.css'

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

/** What a card of the viewer's own needs beyond the figure: the controls and the state they read. */
export interface OwnCityControls {
  readonly gameId: string
  /** The viewer's view, for the request (revision, player) of a city action. */
  readonly view: PlayerView
  readonly busy: boolean
  /** A replay, a locked game: the figure stays, every control goes. */
  readonly readOnly: boolean
  readonly run: Run
  /** What this city can build. */
  readonly buildOptions?: CityBuildOptions | undefined
  /** What else this city can do. */
  readonly cityActions?: CityActionOptions | undefined
  /** The Build flow GameView shares with the board. Without it the card has no Build button. */
  readonly build?: BuildFlow | undefined
}

export function CityCard({
  city,
  own,
}: {
  readonly city: CityProduction
  /** Set for the viewer's own cities only. */
  readonly own?: OwnCityControls | undefined
}): React.JSX.Element {
  const programId = useId()
  // The dialog is a sibling of the figure paragraph, not inside it: a div and a
  // section are not valid in a p. Focus goes back to the link on close.
  const [countOpen, setCountOpen] = useState(false)
  const countTitleId = useId()
  const countLinkRef = useRef<HTMLButtonElement | null>(null)
  const countLinkText = city.override === null ? 'Not a complete count' : 'How the estimate is counted'
  const programShown = city.buildingProgram && city.withBuildingProgram !== null
  const controls = own !== undefined && !own.readOnly ? own : undefined
  const countLink = (
    <button
      ref={countLinkRef}
      type="button"
      className="city-count-link"
      aria-haspopup="dialog"
      aria-label={`${countLinkText}: ${city.label}`}
      onClick={() => setCountOpen(true)}
    >
      {countLinkText}
    </button>
  )
  return (
    <li className="city-card">
      <h4 className="city-label">{city.label}</h4>

      <p className="city-figure">
        {city.override === null ? (
          <>
            <strong className="city-number">Estimated production: {city.estimate}</strong>{' '}
            {countLink}
          </>
        ) : (
          <>
            <strong className="city-number">Set by hand: {city.override}</strong>{' '}
            <small className="muted">estimate was {city.estimate}</small>{' '}
            {countLink}
          </>
        )}
      </p>

      {countOpen && (
        <ReferenceDialog
          titleId={countTitleId}
          title={`${city.label}: how the estimate is counted`}
          onClose={() => setCountOpen(false)}
          returnFocusTo={countLinkRef}
          className="city-count-dialog"
        >
          <CityArithmetic city={city} />
        </ReferenceDialog>
      )}

      {city.buildingProgram && city.withBuildingProgram !== null && (
        <p id={programId} className="city-program">
          {city.override === null
            ? `Building Program in place: ${city.withBuildingProgram} if this city produces now`
            : 'Building Program in place. The figure above is set by hand, so no doubled figure is shown.'}
        </p>
      )}

      {controls !== undefined && controls.build !== undefined && controls.buildOptions !== undefined && (
        <BuildEntry city={city} options={controls.buildOptions} busy={controls.busy} build={controls.build} />
      )}

      {controls !== undefined && controls.cityActions !== undefined && (
        <StartProgramEntry
          city={city}
          gameId={controls.gameId}
          view={controls.view}
          options={controls.cityActions.startBuildingProgram}
          markerLineId={programShown ? programId : undefined}
          busy={controls.busy}
          run={controls.run}
        />
      )}

      {controls !== undefined && (
        <OverrideForm city={city} gameId={controls.gameId} busy={controls.busy} run={controls.run} />
      )}
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
