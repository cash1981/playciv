/**
 * One city with what it produces and the arithmetic behind it (tasks
 * `city-production` and `cities-in-actions`).
 *
 * The numbers come from the engine (`cityProductionsOf`). The estimate is never
 * presented as complete: the map data does not hold every icon. A number typed
 * by hand always wins, and any player in the game may set it, like other board
 * edits. The viewer's own card gets the controls (`own`): Build, Start Building
 * Program, Devote to the Arts, Harvest and the field to set production by hand. Without `own` the card has
 * the figure and the popup, nothing to press; the game page no longer lists the
 * opponents' cities (the board shows them), so only the viewer's cards are used
 * there, in "Your actions" (`YourCities.tsx`).
 */

import { useEffect, useId, useRef, useState } from 'react'

import { MAX_PRODUCTION_OVERRIDE } from '@civ/engine'

import type { BuildChoice, CityActionOptions, CityBuildOptions, CityProduction, PlayerView } from '../lib/api.js'
import { api } from '../lib/api.js'
import { isPressInFlight } from './AssistedActions.js'
import { BuildPicker } from './BuildPicker.js'
import type { BuildFlow } from './buildFlow.js'
import { useCityActionPress } from './CityActions.js'
import { DevoteButton, DevotePanel, HarvestButton, HarvestPanel, cityAgainQuestion } from './CityGather.js'
import type { GatherPanel } from './CityGather.js'
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
  const [gather, setGather] = useState<GatherPanel | null>(null)
  // The player said yes to a second action of this city when the open panel was opened
  const [gatherAgain, setGatherAgain] = useState(false)
  const devoteReady = own?.cityActions?.devoteToTheArts.status === 'ready'
  const harvestReady = own?.cityActions?.harvest.status === 'ready'
  // A panel whose action stopped being ready (the phase ended) must not come back by itself in the next phase
  // Nor may one outlive the controls (a replay or a locked game takes them away)
  const hasControls = own !== undefined && !own.readOnly
  const acted = own?.cityActions?.actedThisTurn ?? []
  /** Opens a panel, after asking when the city has already acted this turn. A "no" opens nothing. */
  function toggleGather(panel: GatherPanel): void {
    if (gather === panel) {
      setGather(null)
      return
    }
    if (acted.length > 0 && !window.confirm(cityAgainQuestion(city.label, acted))) return
    setGatherAgain(acted.length > 0)
    setGather(panel)
  }
  useEffect(() => {
    if (!hasControls || (gather === 'devote' && !devoteReady) || (gather === 'harvest' && !harvestReady)) setGather(null)
  }, [gather, hasControls, devoteReady, harvestReady])
  const countLinkRef = useRef<HTMLButtonElement | null>(null)
  const countLinkText = city.override === null ? 'Not a complete count' : 'How the estimate is counted'
  const programShown = city.buildingProgram && city.withBuildingProgram !== null
  const controls = own !== undefined && !own.readOnly ? own : undefined
  const buildFlow = controls?.build
  const buildOptions = controls?.buildOptions
  const countLink = (
    <button
      ref={countLinkRef}
      type="button"
      className="help-button"
      aria-haspopup="dialog"
      aria-label={`${countLinkText}: ${city.label}`}
      title={`${countLinkText}: ${city.label}`}
      onClick={() => setCountOpen(true)}
    >
      ?
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

      {/* Build and Start Building Program share a line when there is room; the picker opens under both. */}
      {((buildFlow !== undefined && buildOptions !== undefined) || controls?.cityActions !== undefined) && (
        <div className="city-buttons">
          {controls !== undefined && buildFlow !== undefined && buildOptions !== undefined && (
            <BuildEntry city={city} options={buildOptions} busy={controls.busy} build={buildFlow} acted={acted} />
          )}
          {controls?.cityActions !== undefined && (
            <StartProgramEntry
              city={city}
              gameId={controls.gameId}
              view={controls.view}
              options={controls.cityActions.startBuildingProgram}
              markerLineId={programShown ? programId : undefined}
              acted={acted}
              busy={controls.busy}
              run={controls.run}
            />
          )}
          {controls?.cityActions !== undefined && (
            <>
              <DevoteButton
                city={city}
                options={controls.cityActions.devoteToTheArts}
                open={gather === 'devote'}
                busy={controls.busy}
                onToggle={() => toggleGather('devote')}
              />
              <HarvestButton
                city={city}
                options={controls.cityActions.harvest}
                open={gather === 'harvest'}
                busy={controls.busy}
                onToggle={() => toggleGather('harvest')}
              />
            </>
          )}
        </div>
      )}
      {controls?.cityActions !== undefined && gather === 'devote' && controls.cityActions.devoteToTheArts.status === 'ready' && (
        <DevotePanel
          city={city}
          options={controls.cityActions.devoteToTheArts}
          gameId={controls.gameId}
          view={controls.view}
          busy={controls.busy}
          run={controls.run}
          onClose={() => setGather(null)}
          confirmedAgain={gatherAgain}
          acted={acted}
        />
      )}
      {controls?.cityActions !== undefined && gather === 'harvest' && controls.cityActions.harvest.status === 'ready' && (
        <HarvestPanel
          city={city}
          options={controls.cityActions.harvest}
          gameId={controls.gameId}
          view={controls.view}
          busy={controls.busy}
          run={controls.run}
          onClose={() => setGather(null)}
          confirmedAgain={gatherAgain}
          acted={acted}
        />
      )}
      {controls !== undefined && buildFlow !== undefined && buildOptions !== undefined && buildFlow.pickerCityId === city.pieceId && (
        <BuildPicker
          city={buildOptions}
          note={buildFlow.note}
          message={buildFlow.message}
          busy={controls.busy}
          onChoose={(choice: BuildChoice) => buildFlow.start(buildOptions, choice)}
          onClose={buildFlow.closePicker}
        />
      )}

      {controls !== undefined && (
        <OverrideForm city={city} gameId={controls.gameId} busy={controls.busy} run={controls.run} />
      )}
    </li>
  )
}

/** The Build button of one of the viewer's cities. Its picker is shown by the card, under the buttons. */
function BuildEntry({
  city,
  options,
  busy,
  build,
  acted,
}: {
  readonly city: CityProduction
  readonly options: CityBuildOptions
  readonly busy: boolean
  readonly build: BuildFlow
  /** What the city has already done this turn. */
  readonly acted: readonly string[]
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
          onClick={() => {
            if (open) {
              build.closePicker()
              return
            }
            // A second action of a city in one turn needs a yes first; a no opens nothing
            if (acted.length > 0 && !window.confirm(cityAgainQuestion(city.label, acted))) return
            build.openPicker(city.pieceId, acted.length > 0)
          }}
        >
          Build
        </button>
        {!ready && (
          <span id={reasonId} className="muted">
            {options.reason}
          </span>
        )}
      </div>
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
  acted,
  busy,
  run,
}: {
  readonly city: CityProduction
  readonly gameId: string
  readonly view: PlayerView
  readonly acted: readonly string[]
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
    // A second action of a city in one turn needs a yes first; the press already on its way is not asked again
    const again = acted.length > 0
    if (again && !isPressInFlight(key) && !window.confirm(cityAgainQuestion(city.label, acted))) return
    void press(key, (requestId) =>
      again
        ? api.startBuildingProgram(gameId, requestId, view.rev, city.pieceId, true)
        : api.startBuildingProgram(gameId, requestId, view.rev, city.pieceId),
    )
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
        Production override
      </label>
      <div className="city-edit-row">
        <input
          id={inputId}
          className="city-input"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          aria-label={`Production override, ${city.label}`}
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
