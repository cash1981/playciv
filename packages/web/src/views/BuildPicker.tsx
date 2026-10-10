/**
 * Assisted Build in the browser (#264: buildings, army and scout figures, and
 * military units).
 *
 * Two pieces that share one {@link BuildFlow}, owned by GameView:
 *
 * - {@link BuildPicker}, in the Cities panel under a city: what the engine says
 *   that city can build now, in three groups (buildings, figures placed on the
 *   map, units that are a private card), and, folded away, why the others can not;
 * - {@link BuildBar}, above the board: the choice, the cost, the square picked on
 *   the board, Confirm and Cancel. A unit has no square, so its bar opens with
 *   Confirm ready.
 *
 * Neither adds a rule. The choices, costs, trade and squares come from
 * `view.you.buildOptions`, and the server checks it all again on Confirm.
 */

import { useEffect, useRef, useState } from 'react'

import { errorMessage, isUnauthorized } from '../App.js'
import type { BuildChoice, BuildPayload, CityBuildOptions, PlayerView } from '../lib/api.js'
import { api } from '../lib/api.js'
import { isPressInFlight, pressOnce } from './AssistedActions.js'
import { itemKeyOf } from './buildFlow.js'
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

/** The three groups of the picker, in the order they are shown. */
const GROUPS = [
  { id: 'building', noun: 'Buildings', heading: 'Buildings' },
  { id: 'figure', noun: 'Figures', heading: 'Figures (placed on the map)' },
  { id: 'unit', noun: 'Units', heading: 'Units (a private card, nothing is placed)' },
] as const

type GroupId = (typeof GROUPS)[number]['id']

function groupOf(choice: BuildChoice): GroupId {
  if (choice.item.kind === 'building') return 'building'
  return choice.item.kind === 'unit' ? 'unit' : 'figure'
}

/** "an infantry unit", "a mounted unit": the bar names the type of card, never a placed item. */
function unitNameOf(unitType: string): string {
  return `${/^[aeiou]/.test(unitType) ? 'an' : 'a'} ${unitType} unit`
}

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

/**
 * What one city can build now. Choosing a building or a figure starts picking a
 * square on the board; choosing a unit goes straight to the confirm bar.
 */
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

      {ready &&
        GROUPS.map((group) => {
          const choices = city.choices.filter((choice) => groupOf(choice) === group.id)
          // An empty group has no heading: nothing says "Units" when there is none to pick.
          if (choices.length === 0) return null
          return (
            <section key={group.id} className="build-group">
              <h6 className="build-group-heading">{group.heading}</h6>
              <ul className="build-choices" aria-label={`${group.noun} ${city.label} can build`}>
                {choices.map((choice) => (
                  <li key={choice.assetId} className="build-choice">
                    <span className="build-choice-text">
                      <strong>{choice.label}</strong>
                      <span>
                        Cost {choice.cost}
                        {choice.tradeToPay > 0 && <>, pays {choice.tradeToPay} trade</>}
                      </span>
                      <span className="muted">
                        {choice.placement === 'none'
                          ? 'Draws a card in secret'
                          : plural(choice.squares.length, 'square')}
                      </span>
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
            </section>
          )
        })}

      {ready && city.unavailable.length > 0 && (
        <details className="build-why">
          <summary>Why not the others ({city.unavailable.length})</summary>
          <ul aria-label={`Items ${city.label} cannot build`}>
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
        key={`${flow.plan.cityPieceId}:${itemKeyOf(flow.plan.item)}`}
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
  // A new plan mounts a new bar: put focus on it once, without scrolling. The page
  // is scrolled by the board (BoardView), which brings its panel into view under
  // this sticky bar, so the two never pull the page in different directions.
  // Keyboard users then Tab on to the squares, which follow it on the page.
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [])

  const target = plan.target
  const rush = plan.tradeToPay > 0
  const placed = plan.placement === 'square'
  // A unit has no square to wait for: Confirm is ready at once.
  const ready = !placed || target !== null

  function confirm(): void {
    if (!ready || sending) return
    const item = plan.item
    const rushPart = rush ? { rush: true as const } : {}
    let payload: BuildPayload
    if (item.kind === 'unit') {
      payload = { cityPieceId: plan.cityPieceId, item, ...rushPart }
    } else if (target !== null) {
      payload = { cityPieceId: plan.cityPieceId, item, target: { column: target.column, row: target.row }, ...rushPart }
    } else {
      return
    }
    // The key says which press this is: the same item and square (a unit has none)
    // while the outcome is unknown reuses the request id, another is a new press.
    const where = target === null ? 'card' : `${target.column},${target.row}`
    const key = `${gameId}:${playerId}:build:${plan.cityPieceId}:${itemKeyOf(item)}:${where}`
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
      (requestId) => api.build(gameId, requestId, view.rev, payload),
      view,
    ).then((done) => {
      setSending(false)
      if (done) flow.clear()
      else flow.refused(failure === null ? 'Nothing was built.' : errorMessage(failure))
    })
  }

  return (
    <div ref={ref} className="build-bar" role="group" aria-label="Build" tabIndex={-1}>
      <p className="build-bar-title">
        <strong>Build {plan.item.kind === 'unit' ? unitNameOf(plan.item.unitType) : plan.label}</strong> in {plan.cityLabel}
      </p>
      <p className="build-bar-facts">
        Cost {plan.cost}
        {rush && <>. Pays {plan.tradeToPay} trade</>}.{' '}
        {!placed ? (
          <>A private card is drawn, nothing is placed on the map.</>
        ) : target === null ? (
          <>Tap a highlighted square on the board ({plural(plan.squares.length, 'square')}).</>
        ) : (
          <>
            Square <strong>{target.label}</strong>.
          </>
        )}
      </p>
      {/* What the engine says about the chosen square: an army put where an enemy figure stands is not automated. A live region, so it is read out when the square is picked. */}
      {target?.note !== undefined && (
        <p role="status" className="build-bar-square-note">
          <strong>Note for {target.label}:</strong> {target.note}
        </p>
      )}
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
          disabled={busy || sending || !ready}
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
