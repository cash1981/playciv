/**
 * Assisted Build in the browser (#264: buildings, wonders from the market, army and
 * scout figures, and military units).
 *
 * Two pieces that share one {@link BuildFlow}, owned by GameView:
 *
 * - {@link BuildPicker}, in Your actions under a city: what the engine says
 *   that city can build now, in groups (buildings, wonders, figures placed on the
 *   map, units that are a private card), and, behind a link, why the others can not;
 * - {@link BuildBar}, above the board: the choice, the cost, the square picked on
 *   the board, Confirm and Cancel. A unit and City Walls have no square, so their bar
 *   opens with Confirm ready. A square where the item replaces a building or wonder of
 *   the player carries the engine's note, so it needs Confirm too.
 *
 * Neither adds a rule. The choices, costs, trade and squares come from
 * `view.you.buildOptions`, and the server checks it all again on Confirm.
 */

import { useEffect, useId, useRef, useState } from 'react'

import { errorMessage, isUnauthorized } from '../App.js'
import type { BuildChoice, BuildPayload, CityBuildOptions, PlayerView } from '../lib/api.js'
import { api } from '../lib/api.js'
import { isPressInFlight, pressOnce } from './AssistedActions.js'
import { itemKeyOf } from './buildFlow.js'
import { resolveAgain } from './CityGather.js'
import type { BuildFlow, BuildPlan } from './buildFlow.js'
import type { Run } from './GameView.js'
import { ReferenceDialog } from './ReferenceDialog.js'
import './BuildPicker.css'

export const BUILD_PICKER_ID = 'build-picker'

const SOURCE_TEXT: Readonly<Record<CityBuildOptions['productionSource'], string>> = {
  override: 'override',
  'building-program': 'with the Building Program',
  estimate: 'estimate',
}

/** The groups of the picker, in the order they are shown. */
const GROUPS = [
  { id: 'building', noun: 'Buildings', heading: 'Buildings' },
  {
    id: 'wonder',
    noun: 'Wonders',
    heading: 'Wonders',
    // Cards and Great Persons can add hammers, and how to count them is not settled: only the cost is told
    note: 'The cost is not checked against the city’s production.',
  },
  { id: 'figure', noun: 'Figures', heading: 'Figures (placed on the map)' },
  { id: 'unit', noun: 'Units', heading: 'Units' },
] as const

type GroupId = (typeof GROUPS)[number]['id']

function groupOf(choice: BuildChoice): GroupId {
  // City Walls are a building (base rules p. 17, FAQ), listed with the others
  if (choice.item.kind === 'building' || choice.item.kind === 'walls') return 'building'
  if (choice.item.kind === 'wonder') return 'wonder'
  return choice.item.kind === 'unit' ? 'unit' : 'figure'
}

/** "an infantry unit", "a mounted unit": the bar names the type of card, never a placed item. */
function unitNameOf(unitType: string): string {
  return `${/^[aeiou]/.test(unitType) ? 'an' : 'a'} ${unitType} unit`
}

/**
 * Back to the picker, which sits in the City Management tab of "Your actions". The
 * panel may have been collapsed and another tab opened since the Build started, and
 * hidden content is not on the page, so the panel and the tab are opened first.
 */
function goBackToPicker(): void {
  const toggle = document.querySelector<HTMLElement>('[aria-controls="actions-content"]')
  const collapsed = toggle?.getAttribute('aria-expanded') === 'false'
  if (collapsed) toggle?.click()
  // The picker sits in the City Management tab, which another tab may have replaced
  const tab = document.getElementById('phase-tab-CM')
  const otherTab = tab !== null && tab.getAttribute('aria-selected') !== 'true'
  if (otherTab) tab?.click()
  const show = (): void => {
    const picker = document.getElementById(BUILD_PICKER_ID)
    if (picker !== null) bringIntoView(picker)
  }
  // Opening is a state change in React; the content is visible once it has flushed.
  if (collapsed || otherTab) queueMicrotask(show)
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
 * What one city can build now. It opens with a button for each kind (buildings,
 * wonders, figures, units) that has something to pick, and the button shows that
 * list; a kind that is alone is shown at once. Choosing a building, a wonder or a
 * figure starts picking a square on the board; choosing a unit goes straight to the
 * confirm bar.
 */
export function BuildPicker({ city, note, message, busy, onChoose, onClose }: PickerProps): React.JSX.Element {
  const ref = useRef<HTMLElement>(null)
  // Opening the picker is a press on Build right above it: put keyboard focus in it. Not when it comes back
  // with its tab (the picker survives a switch of tab) while the viewer is moving along the tab list.
  useEffect(() => {
    if (document.activeElement?.closest('[role="tablist"]')) return
    ref.current?.focus({ preventScroll: true })
  }, [])
  const ready = city.status === 'ready'
  const [picked, setPicked] = useState<GroupId | null>(null)
  const groupRef = useRef<HTMLElement>(null)
  // The groups with something to pick. One alone is shown at once: a button for it would only be a click.
  const filled = GROUPS.filter((group) => city.choices.some((choice) => groupOf(choice) === group.id))
  const open = filled.length === 1 ? filled[0]! : (filled.find((group) => group.id === picked) ?? null)
  // Opening a group moves focus into it, and coming back puts focus on the button that opened it.
  const lastOpen = useRef<GroupId | null>(null)
  const openId = open?.id ?? null
  useEffect(() => {
    const before = lastOpen.current
    lastOpen.current = openId
    if (openId !== null && before !== openId) groupRef.current?.focus({ preventScroll: true })
    else if (openId === null && before !== null) {
      ref.current?.querySelector<HTMLElement>(`[data-group="${before}"]`)?.focus({ preventScroll: true })
    }
  }, [openId])

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
        {city.productionSource === 'override'
          ? `Production override: ${city.production}.`
          : `Production ${city.production}, ${SOURCE_TEXT[city.productionSource]}.`}
      </p>

      {/* Plain text: the bar above the board is the live region that announces these. */}
      {message !== null && <p className="build-picker-alert">{message}</p>}
      {note !== null && <p className="build-picker-note">{note}</p>}

      {!ready && <p className="build-picker-empty">{city.reason}</p>}

      {ready && city.choices.length === 0 && (
        <p className="build-picker-empty">
          Nothing can be built in this city right now. The reasons are behind the Why not the others link. If the
          production above is too low, set the city&rsquo;s production by hand.
        </p>
      )}

      {ready && open === null && filled.length > 0 && (
        <div className="build-categories" role="group" aria-label={`What ${city.label} can build`}>
          {filled.map((group) => (
            <button
              key={group.id}
              type="button"
              className="small"
              data-group={group.id}
              onClick={() => setPicked(group.id)}
            >
              {group.noun}
            </button>
          ))}
        </div>
      )}

      {ready && open !== null && (
        <section
          key={open.id}
          ref={groupRef}
          className="build-group"
          tabIndex={-1}
          aria-label={open.noun}
        >
          <div className="build-group-head">
            <h6 className="build-group-heading">{open.heading}</h6>
            {filled.length > 1 && (
              <button type="button" className="small" onClick={() => setPicked(null)}>
                Back
              </button>
            )}
          </div>
          {'note' in open && <p className="build-group-note muted">{open.note}</p>}
          <ul className="build-choices" aria-label={`${open.noun} ${city.label} can build`}>
            {city.choices
              .filter((choice) => groupOf(choice) === open.id)
              .map((choice) => (
                <li key={choice.assetId} className="build-choice">
                  <span className="build-choice-text">
                    <strong>{choice.label}</strong>
                    <span>
                      Cost {choice.cost}
                      {choice.costNote !== undefined && <> ({choice.costNote})</>}
                      {choice.tradeToPay > 0 && <>, pays {choice.tradeToPay} trade</>}
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
      )}

      {ready && city.unavailable.length > 0 && <WhyNot city={city} />}

      <button type="button" className="small" onClick={onClose}>
        Close
      </button>
    </section>
  )
}

/**
 * "Why not the others": a link that opens the reasons in a popup, the way the
 * production count does, so the long list does not push the choices down the page.
 */
function WhyNot({ city }: { readonly city: CityBuildOptions }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const titleId = useId()
  const linkRef = useRef<HTMLButtonElement | null>(null)
  return (
    <>
      <p className="build-why">
        <button
          ref={linkRef}
          type="button"
          className="build-why-link"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          Why not the others ({city.unavailable.length})
        </button>
      </p>
      {open && (
        <ReferenceDialog
          titleId={titleId}
          title={`${city.label}: why not the others`}
          onClose={() => setOpen(false)}
          returnFocusTo={linkRef}
          className="build-why-dialog"
        >
          <ul aria-label={`Items ${city.label} cannot build`}>
            {city.unavailable.map((entry) => (
              <li key={entry.assetId}>
                <strong>{entry.label}</strong>: {entry.reason}
              </li>
            ))}
          </ul>
        </ReferenceDialog>
      )}
    </>
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
  // The square a build was sent on by the tap, so Confirm can come back for it if that did not go through
  const [autoSent, setAutoSent] = useState<string | null>(null)
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
  // A unit and City Walls have no square to wait for: Confirm is ready at once.
  const ready = !placed || target !== null
  // What goes on the map (a building, a wonder, a figure) is placed by the tap on its
  // square, with no Confirm: it can be moved, and removing it before the turn ends takes
  // the whole build back. The exception is a square the engine has a note for (an enemy
  // figure stands there, so the outcome is settled by hand, or the item replaces a building,
  // wonder or Great Person of the player's): its note is read first, and Confirm builds.
  // A unit and City Walls have no square, so they keep Confirm.
  const immediate = placed && target?.note === undefined

  function confirm(): void {
    if (!ready || sending) return
    const item = plan.item
    const rushPart = rush ? { rush: true as const } : {}
    let payload: BuildPayload
    if (item.kind === 'unit' || item.kind === 'walls') {
      payload = { cityPieceId: plan.cityPieceId, item, ...rushPart }
    } else if (target !== null) {
      payload = { cityPieceId: plan.cityPieceId, item, target: { column: target.column, row: target.row }, ...rushPart }
    } else {
      return
    }
    // The key says which press this is: the same item and square (a unit and City Walls have none)
    // while the outcome is unknown reuses the request id, another is a new press.
    const where = target === null ? 'card' : `${target.column},${target.row}`
    const key = `${gameId}:${playerId}:build:${plan.cityPieceId}:${itemKeyOf(item)}:${where}`
    // The same press is already on its way (this bar was closed and opened again):
    // its outcome is not known yet, so this click says nothing and sends nothing.
    if (isPressInFlight(key)) return
    // A yes given when the picker was opened stands; a city that has acted since is asked now
    const acted = view.you?.cityActions?.find((candidate) => candidate.cityPieceId === plan.cityPieceId)?.actedThisTurn ?? []
    const again = resolveAgain(plan.cityLabel, acted, flow.confirmedAgain)
    if (again === null) return
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
        again ? api.build(gameId, requestId, view.rev, payload, true) : api.build(gameId, requestId, view.rev, payload),
      view,
    ).then((done) => {
      setSending(false)
      if (done) flow.clear()
      else flow.refused(failure === null ? 'Nothing was built.' : errorMessage(failure))
    })
  }

  // Picking a square for a piece on the map sends the build, and only the pick does: a square that
  // loses its note on a refresh is not sent, and a second tap on the same square is no new pick.
  // Confirm is there for both, and after a refusal, so the square can always be sent.
  const pickedColumn = target?.column
  const pickedRow = target?.row
  const pickedKey = pickedColumn === undefined || pickedRow === undefined ? null : `${pickedColumn},${pickedRow}`
  const lastPicked = useRef<string | null>(null)
  useEffect(() => {
    const justPicked = pickedKey !== null && lastPicked.current !== pickedKey
    lastPicked.current = pickedKey
    if (justPicked && immediate) {
      setAutoSent(pickedKey)
      // `confirm` reads the plan of this render, which is the one whose square was just picked.
      confirm()
    }
  }, [immediate, pickedKey])
  // A piece on the map shows Confirm for a square once it has one, except while the tap's own request is out
  const showConfirm = !placed || (pickedKey !== null && !(sending && autoSent === pickedKey))

  return (
    <div ref={ref} className="build-bar" role="group" aria-label="Build" tabIndex={-1}>
      <p className="build-bar-title">
        <strong>Build {plan.item.kind === 'unit' ? unitNameOf(plan.item.unitType) : plan.item.kind === 'wonder' ? plan.label.replace(/^The /, 'the ') : plan.label}</strong> in {plan.cityLabel}
      </p>
      <p className="build-bar-facts">
        Cost {plan.cost}
        {plan.costNote !== undefined && <> ({plan.costNote})</>}
        {rush && <>. Pays {plan.tradeToPay} trade</>}.{' '}
        {!placed ? (
          plan.item.kind === 'walls' ? (
            <>The city marker is turned over to its walled side, nothing else is placed on the map.</>
          ) : (
            <>A private card is drawn, nothing is placed on the map.</>
          )
        ) : target === null ? (
          <>Tap a highlighted square on the board to place it.</>
        ) : (
          <>
            Square <strong>{target.label}</strong>.{sending ? ' Placing it.' : ''}
          </>
        )}
      </p>
      {/* What the engine says about the chosen square: an army put where an enemy figure stands is not automated, or what the item replaces. A live region, so it is read out when the square is picked. */}
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
        {showConfirm && (
          <button
            type="button"
            className="small primary"
            disabled={busy || sending || !ready}
            onClick={confirm}
          >
            {rush ? `Confirm and pay ${plan.tradeToPay} trade` : 'Confirm'}
          </button>
        )}
        <button type="button" className="small" onClick={flow.clear}>
          Cancel
        </button>
      </div>
    </div>
  )
}
