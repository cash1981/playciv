/**
 * The city orders of the City Management tab: for each of the viewer's cities the
 * Build and Start Building Program buttons, and the Upgrades block. They used to sit
 * on the Cities panel's cards; the Cities panel now only shows what a city produces.
 *
 * Nothing here is a rule. What a city can build comes from the engine's
 * `view.you.buildOptions` and `cityActions`, and the server checks every press again.
 */

import { useId } from 'react'

import type { BuildChoice, CityActionOptions, CityBuildOptions, CityProduction, PlayerView } from '../lib/api.js'
import { api } from '../lib/api.js'
import { BuildPicker } from './BuildPicker.js'
import type { BuildFlow } from './buildFlow.js'
import { CityActions, useCityActionPress } from './CityActions.js'
import type { Run } from './GameView.js'
import './CitiesPanel.css'

/** The Build button of one of the viewer's cities, and its picker while it is open. */
export function BuildEntry({
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
export function StartProgramEntry({
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


/**
 * One card per own city with its two buttons, then the Upgrades block. Nothing for
 * a spectator; the buttons are disabled with their reason when the engine says no.
 */
export function CityOrders({
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
  readonly build?: BuildFlow | undefined
}): React.JSX.Element | null {
  const own = view.you?.cities ?? []
  if (view.you === null) return null
  // A replay or a locked game takes no orders; the Cities panel still shows the numbers.
  if (readOnly) return <p className="muted">City orders are not available in a replay or a locked game.</p>
  return (
    <div className="city-orders">
      {own.length === 0 ? (
        <p className="muted">You have no city on the map.</p>
      ) : (
        <ul className="cities-list">
          {own.map((city) => (
            <CityOrderCard
              key={city.pieceId}
              city={city}
              gameId={gameId}
              view={view}
              busy={busy}
              run={run}
              build={build}
              buildOptions={view.you?.buildOptions?.find((options) => options.cityPieceId === city.pieceId)}
              cityActions={view.you?.cityActions?.find((actions) => actions.cityPieceId === city.pieceId)}
            />
          ))}
        </ul>
      )}
      <CityActions gameId={gameId} view={view} busy={busy} readOnly={readOnly} run={run} />
    </div>
  )
}

function CityOrderCard({
  city,
  gameId,
  view,
  busy,
  run,
  build,
  buildOptions,
  cityActions,
}: {
  readonly city: CityProduction
  readonly gameId: string
  readonly view: PlayerView
  readonly busy: boolean
  readonly run: Run
  readonly build: BuildFlow | undefined
  readonly buildOptions: CityBuildOptions | undefined
  readonly cityActions: CityActionOptions | undefined
}): React.JSX.Element {
  const programId = useId()
  const programShown = city.buildingProgram && city.withBuildingProgram !== null
  return (
    <li className="city-card">
      <h4 className="city-label">{city.label}</h4>
      <p className="city-figure">
        {city.override === null ? (
          <strong className="city-number">Production: about {city.estimate}</strong>
        ) : (
          <strong className="city-number">Production set by hand: {city.override}</strong>
        )}
      </p>
      {programShown && (
        <p id={programId} className="city-program">
          {city.override === null
            ? `Building Program in place: ${city.withBuildingProgram} if this city produces now`
            : 'Building Program in place. The figure above is set by hand, so no doubled figure is shown.'}
        </p>
      )}
      {build !== undefined && buildOptions !== undefined && (
        <BuildEntry city={city} options={buildOptions} busy={busy} build={build} />
      )}
      {cityActions !== undefined && (
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
    </li>
  )
}
