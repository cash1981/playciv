/**
 * Assisted Build in the browser (#264, part 2: buildings).
 *
 * Two pieces that share one {@link BuildFlow}, owned by GameView:
 *
 * - {@link BuildPicker}, in the Cities panel under a city: the buildings the
 *   engine says that city can build now, and, folded away, why the others can not;
 * - {@link BuildBar}, above the board: the choice, the cost, the square picked on
 *   the board, Confirm and Cancel.
 *
 * Neither adds a rule. The choices, costs, trade and squares come from
 * `view.you.buildOptions`, and the server checks it all again on Confirm.
 */

import { useEffect, useRef, useState } from 'react'

import { errorMessage, isUnauthorized } from '../App.js'
import type { BuildChoice, CityBuildOptions, PlayerView } from '../lib/api.js'
import { api } from '../lib/api.js'
import { isPressInFlight, pressOnce } from './AssistedActions.js'
import type { BuildFlow, BuildPlan } from './buildFlow.js'
import type { Run } from './GameView.js'
import './BuildPicker.css'

export const BUILD_PICKER_ID = 'build-picker'

const SOURCE_TEXT: Readonly<Record<CityBuildOptions['productionSource'], string>> = {
  override: 'set by hand',
  'building-program': 'with the Building Program',
  estimate: 'estimate',
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

/**
 * Back to the picker, which sits in the Cities panel. That panel may have been
 * collapsed since the Build started, and a collapsed panel keeps its content
 * hidden, so it is opened first.
 */
function goBackToPicker(): void {
  const toggle = document.querySelector<HTMLElement>('[aria-controls="cities-content"]')
  const collapsed = toggle?.getAttribute('aria-expanded') === 'false'
  if (collapsed) toggle?.click()
  const show = (): void => {
    const picker = document.getElementById(BUILD_PICKER_ID)
    if (picker !== null) bringIntoView(picker)
  }
  // Opening is a state change in React; the content is visible once it has flushed.
  if (collapsed) queueMicrotask(show)
  else show()
}

/** Scrolls to an element and moves focus to it; smooth unless the user asks for reduced motion. */
function bringIntoView(element: HTMLElement): void {
  const reduced =
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  element.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  element.focus({ preventScroll: true })
}

// ---------------------------------------------------------------------------
// The picker
// ---------------------------------------------------------------------------

interface PickerProps {
  readonly city: CityBuildOptions
  /** Why the flow came back here, for example that the options changed. */
  readonly note: string | null
  /** What the server said when it refused the last build. */
  readonly message: string | null
  readonly busy: boolean
  readonly onChoose: (choice: BuildChoice) => void
  readonly onClose: () => void
}

/** The buildings one city can build now. Choosing one starts picking a square on the board. */
export function BuildPicker({ city, note, message, busy, onChoose, onClose }: PickerProps): React.JSX.Element {
  const ref = useRef<HTMLElement>(null)
  // Opening the picker is a press on Build right above it: put keyboard focus in it.
  useEffect(() => ref.current?.focus({ preventScroll: true }), [])
  const ready = city.status === 'ready'

  return (
    <section
      ref={ref}
      id={BUILD_PICKER_ID}
      className="build-picker"
      tabIndex={-1}
      aria-label={`Build in ${city.label}`}
    >
      <h5 className="build-picker-title">Build in {city.label}</h5>
      <p className="build-picker-production">
        Production {city.production}, {SOURCE_TEXT[city.productionSource]}.
      </p>

      {/* Plain text: the bar above the board is the live region that announces these. */}
      {message !== null && <p className="build-picker-alert">{message}</p>}
      {note !== null && <p className="build-picker-note">{note}</p>}

      {!ready && <p className="build-picker-empty">{city.reason}</p>}

      {ready && city.choices.length === 0 && (
        <p className="build-picker-empty">
          Nothing can be built in this city right now. The reasons are under Why not the others. If the
          production above is too low, set the city&rsquo;s production by hand.
        </p>
      )}

      {ready && city.choices.length > 0 && (
        <ul className="build-choices" aria-label={`Buildings ${city.label} can build`}>
          {city.choices.map((choice) => (
            <li key={choice.assetId} className="build-choice">
              <span className="build-choice-text">
                <strong>{choice.label}</strong>
                <span>
                  Cost {choice.cost}
                  {choice.tradeToPay > 0 && <>, pays {choice.tradeToPay} trade</>}
                </span>
                <span className="muted">{plural(choice.squares.length, 'square')}</span>
              </span>
              <button
                type="button"
                className="small"
                aria-label={`Choose ${choice.label}`}
                disabled={busy}
                onClick={() => onChoose(choice)}
              >
                Choose
              </button>
            </li>
          ))}
        </ul>
      )}

      {ready && city.unavailable.length > 0 && (
        <details className="build-why">
          <summary>Why not the others ({city.unavailable.length})</summary>
          <ul aria-label={`Buildings ${city.label} cannot build`}>
            {city.unavailable.map((entry) => (
              <li key={entry.assetId}>
                <strong>{entry.label}</strong>: {entry.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      <button type="button" className="small" onClick={onClose}>
        Close
      </button>
    </section>
  )
}

// ---------------------------------------------------------------------------
// The bar
// ---------------------------------------------------------------------------

interface BarProps {
  readonly gameId: string
  readonly view: PlayerView
  readonly flow: BuildFlow
  readonly busy: boolean
  readonly run: Run
}

/**
 * The confirm bar. With a plan it shows the item, the city, the cost, any trade
 * and the square, with Confirm and Cancel. Without one, but with something to
 * say (the options changed, or the server refused), it says that and points back
 * at the picker. Otherwise nothing.
 */
export function BuildBar({ gameId, view, flow, busy, run }: BarProps): React.JSX.Element | null {
  if (view.you === null) return null
  if (flow.plan !== null) {
    return (
      <PlanBar
        key={`${flow.plan.cityPieceId}:${flow.plan.assetId}`}
        gameId={gameId}
        playerId={view.you.playerId}
        view={view}
        plan={flow.plan}
        flow={flow}
        busy={busy}
        run={run}
      />
    )
  }
  if (flow.note === null && flow.message === null) return null
  return (
    <div className="build-bar" role="group" aria-label="Build">
      {flow.message !== null && (
        <p role="alert" className="build-bar-alert">
          {flow.message}
        </p>
      )}
      {flow.note !== null && <p role="status">{flow.note}</p>}
      <div className="build-bar-buttons">
        {flow.pickerCityId !== null && (
          <button
            type="button"
            className="small"
            onClick={goBackToPicker}
          >
            Back to the picker
          </button>
        )}
        <button type="button" className="small" onClick={flow.clear}>
          Dismiss
        </button>
      </div>
    </div>
  )
}

interface PlanBarProps {
  readonly gameId: string
  readonly playerId: string
  readonly view: PlayerView
  readonly plan: BuildPlan
  readonly flow: BuildFlow
  readonly busy: boolean
  readonly run: Run
}

function PlanBar({ gameId, playerId, view, plan, flow, busy, run }: PlanBarProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [sending, setSending] = useState(false)
  // A new plan mounts a new bar: bring it into view once and put focus on it.
  // Keyboard users then Tab on to the squares, which follow it on the page.
  useEffect(() => {
    if (ref.current !== null) bringIntoView(ref.current)
  }, [])

  const target = plan.target
  const rush = plan.tradeToPay > 0

  function confirm(): void {
    if (target === null || sending) return
    // The key says which press this is: the same square of the same choice while
    // the outcome is unknown reuses the request id, another square is a new press.
    const key = `${gameId}:${playerId}:build:${plan.cityPieceId}:${plan.assetId}:${target.column},${target.row}`
    // The same press is already on its way (this bar was closed and opened again):
    // its outcome is not known yet, so this click says nothing and sends nothing.
    if (isPressInFlight(key)) return
    let failure: unknown = null
    // The refusal is shown here, so it is kept out of GameView's banner. `run`
    // still reloads afterwards, which is what brings the fresh options.
    const quietRun: Run = (action) =>
      run(async () => {
        try {
          return await action()
        } catch (caught) {
          if (isUnauthorized(caught)) throw caught
          failure = caught
          return undefined
        }
      })
    setSending(true)
    void pressOnce(
      key,
      quietRun,
      (requestId) =>
        api.build(gameId, requestId, view.rev, {
          cityPieceId: plan.cityPieceId,
          item: { kind: 'building', assetId: plan.assetId },
          target: { column: target.column, row: target.row },
          ...(rush ? { rush: true } : {}),
        }),
      view,
    ).then((done) => {
      setSending(false)
      if (done) flow.clear()
      else flow.refused(failure === null ? 'The building was not built.' : errorMessage(failure))
    })
  }

  return (
    <div ref={ref} className="build-bar" role="group" aria-label="Build" tabIndex={-1}>
      <p className="build-bar-title">
        <strong>Build {plan.label}</strong> in {plan.cityLabel}
      </p>
      <p className="build-bar-facts">
        Cost {plan.cost}
        {rush && <>. Pays {plan.tradeToPay} trade</>}.{' '}
        {target === null ? (
          <>Tap a highlighted square on the board ({plural(plan.squares.length, 'square')}).</>
        ) : (
          <>
            Square <strong>{target.label}</strong>.
          </>
        )}
      </p>
      {flow.message !== null && (
        <p role="alert" className="build-bar-alert">
          {flow.message}
        </p>
      )}
      {flow.note !== null && <p role="status">{flow.note}</p>}
      <div className="build-bar-buttons">
        <button
          type="button"
          className="small primary"
          disabled={busy || sending || target === null}
          onClick={confirm}
        >
          {rush ? `Confirm and pay ${plan.tradeToPay} trade` : 'Confirm'}
        </button>
        <button type="button" className="small" onClick={flow.clear}>
          Cancel
        </button>
      </div>
    </div>
  )
}
