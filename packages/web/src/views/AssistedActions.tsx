/**
 * Assisted actions in the browser (#260): the game does a step for the player
 * instead of asking them to edit counters by hand.
 *
 * The state of every button comes from `view.you.availableActions`, which the
 * engine computes once for the viewer. This file adds no rule of its own: it
 * shows `status` and `reason`, and sends one request per press.
 *
 * Two entry points use the same {@link AssistedActionButton}: the "Your actions"
 * panel and the tech detail dialog. Neither fires anything by rendering; only a
 * press does.
 */

import { useId } from 'react'
import type { ReactNode } from 'react'

import type { AssistedActionKind } from '@civ/engine'

import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import { CollapsiblePanel } from './CollapsiblePanel.js'
import type { Run } from './GameView.js'
import './AssistedActions.css'

type Status = NonNullable<PlayerView['you']>['availableActions'][number]['status']

const STATUS_TEXT: Readonly<Record<Status, string>> = {
  ready: 'Ready',
  used: 'Used',
  'needs-resource': 'Needs resource',
  'wrong-phase': 'Not now',
  'not-owned': 'Not owned',
  unavailable: 'Unavailable',
}

/**
 * A request id per press. It is kept until the request succeeds, so a double
 * click or a retry of the same press sends the same id and the server does the
 * action once; the next press after a success gets a new one. Kept at module
 * level, keyed on game and action, so the panel and the dialog share it and a
 * remount (closing the dialog) does not lose it.
 */
const pendingRequestIds = new Map<string, string>()
const inFlight = new Set<string>()

/** For tests: forget every kept request id. */
export function resetPendingRequestIds(): void {
  pendingRequestIds.clear()
  inFlight.clear()
}

function newRequestId(): string {
  const random = globalThis.crypto?.randomUUID
  if (typeof random === 'function') return random.call(globalThis.crypto)
  // Old browsers and insecure contexts have no randomUUID. The id only has to be
  // unique per press, not unguessable.
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

interface ButtonProps {
  readonly action: AssistedActionKind
  readonly gameId: string
  readonly view: PlayerView
  readonly busy: boolean
  readonly readOnly: boolean
  readonly run: Run
  /**
   * `full` shows the status tag and the reason always; `blocked` shows the reason
   * only while the action cannot be pressed. A tight table cell uses `blocked`.
   */
  readonly detail?: 'full' | 'blocked'
  readonly className?: string
  /** Replaces the default "Use <label>" text. */
  readonly children?: ReactNode
}

/**
 * One button for one assisted action. Renders nothing for a spectator or when
 * the viewer has no state for the action. Disabled unless the status is `ready`,
 * and then the reason is on the page as text, not only in a tooltip.
 */
export function AssistedActionButton({
  action,
  gameId,
  view,
  busy,
  readOnly,
  run,
  detail = 'full',
  className = 'small',
  children,
}: ButtonProps): React.JSX.Element | null {
  const reasonId = useId()
  const state = view.you?.availableActions?.find((candidate) => candidate.action === action)
  if (view.you === null || state === undefined) return null

  const ready = state.status === 'ready'
  const showReason = detail === 'full' || !ready
  const rev = view.rev

  const press = (): void => {
    const key = `${gameId}:${action}`
    // A second click before the first has settled is the same press.
    if (inFlight.has(key)) return
    const requestId = pendingRequestIds.get(key) ?? newRequestId()
    pendingRequestIds.set(key, requestId)
    inFlight.add(key)
    const settle = (): void => {
      inFlight.delete(key)
    }
    void run(async () => {
      const result = await api.performAction(gameId, action, requestId, rev)
      // Only a success frees the id. After a failure the outcome may be unknown
      // (a lost response), and the same id makes the retry safe.
      pendingRequestIds.delete(key)
      return result
    }).then(settle, settle)
  }

  return (
    <span className="assisted-action">
      <button
        type="button"
        className={className}
        disabled={busy || readOnly || !ready}
        aria-describedby={showReason ? reasonId : undefined}
        onClick={press}
      >
        {children ?? `Use ${state.label}`}
      </button>
      {detail === 'full' && <span className="tag">{STATUS_TEXT[state.status]}</span>}
      {showReason && (
        <span id={reasonId} className="muted assisted-reason">
          {state.reason}
        </span>
      )}
    </span>
  )
}

interface PanelProps {
  readonly gameId: string
  readonly view: PlayerView
  readonly busy: boolean
  readonly readOnly: boolean
  readonly run: Run
}

/**
 * "Your actions": the viewer's assisted actions with their state. Actions for a
 * card the player does not hold are left out, so the list stays short, and the
 * panel is not rendered at all for a spectator or when nothing is left.
 */
export function AssistedActionsPanel({
  gameId,
  view,
  busy,
  readOnly,
  run,
}: PanelProps): React.JSX.Element | null {
  const actions = (view.you?.availableActions ?? []).filter(
    (candidate) => candidate.status !== 'not-owned',
  )
  if (view.you === null || actions.length === 0) return null
  return (
    <CollapsiblePanel id="actions" title="Your actions" defaultOpen>
      <ul className="assisted-actions">
        {actions.map((candidate) => (
          <li key={candidate.action}>
            <span className="assisted-name">{candidate.label}</span>
            <AssistedActionButton
              action={candidate.action}
              gameId={gameId}
              view={view}
              busy={busy}
              readOnly={readOnly}
              run={run}
            />
          </li>
        ))}
      </ul>
    </CollapsiblePanel>
  )
}
