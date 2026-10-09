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

import { useId, useState } from 'react'
import type { ReactNode } from 'react'

import { itemName } from '@civ/engine'
import type { AssistedActionKind, PendingRewardView } from '@civ/engine'

import { ApiError, api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import { CollapsiblePanel } from './CollapsiblePanel.js'
import { ItemCard } from './ItemCard.js'
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
 * A request id per press. It is kept while the outcome is unknown, so a double
 * click or a retry of the same press sends the same id and the server does the
 * action once. It is freed as soon as the client got a definitive answer: a
 * success, or an HTTP error (the server processed the request and did not apply
 * it, so the next press is a new one). Only a failure with no HTTP response at
 * all (network down, lost response) keeps it. Kept at module level, keyed on
 * game, viewer and action, so the panel and the dialog share it, a remount
 * (closing the dialog) does not lose it, and another account in the same tab
 * never reuses it.
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

/**
 * One press, with its kept request id. `key` says which press it is: the same key
 * while the outcome is unknown reuses the id, a settled one gets a new id.
 */
function pressOnce(
  key: string,
  run: Run,
  send: (requestId: string) => Promise<PlayerView>,
): Promise<void> {
  // A second click before the first has settled is the same press.
  if (inFlight.has(key)) return Promise.resolve()
  const requestId = pendingRequestIds.get(key) ?? newRequestId()
  pendingRequestIds.set(key, requestId)
  inFlight.add(key)
  const settle = (): void => {
    inFlight.delete(key)
  }
  return run(async () => {
    try {
      const result = await send(requestId)
      pendingRequestIds.delete(key)
      return result
    } catch (caught) {
      // An HTTP status means the server answered and did not apply the request,
      // so the id is spent. With no response the outcome is unknown, and the
      // same id makes the retry safe.
      if (caught instanceof ApiError && typeof caught.status === 'number') {
        pendingRequestIds.delete(key)
      }
      throw caught
    }
  }).then(settle, settle)
}

/** Actions whose button does not read "Use <label>". */
const BUTTON_TEXT: Readonly<Partial<Record<AssistedActionKind, string>>> = {
  cultureAdvance: 'Advance culture',
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
  const playerId = view.you.playerId

  const press = (): void => {
    void pressOnce(`${gameId}:${playerId}:${action}`, run, (requestId) =>
      api.performAction(gameId, action, requestId, rev),
    )
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
        {children ?? BUTTON_TEXT[action] ?? `Use ${state.label}`}
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
 * "Your actions": the viewer's assisted actions with their state, and the card
 * choice waiting after a culture advance. Actions for a card the player does not
 * hold are left out, so the list stays short, and the panel is not rendered at
 * all for a spectator or when there is nothing to show.
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
  // Only the viewer's own projection has the field; a replayed view has it blank.
  const pending = view.you?.pendingRewards?.[0]
  if (view.you === null || (actions.length === 0 && pending === undefined)) return null
  return (
    <CollapsiblePanel id="actions" title="Your actions" defaultOpen>
      {actions.length > 0 && (
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
      )}
      {pending !== undefined && (
        <RewardChoice
          gameId={gameId}
          playerId={view.you.playerId}
          rev={view.rev}
          reward={pending}
          busy={busy}
          readOnly={readOnly}
          run={run}
        />
      )}
    </CollapsiblePanel>
  )
}

interface RewardChoiceProps {
  readonly gameId: string
  readonly playerId: string
  readonly rev: number
  readonly reward: PendingRewardView
  readonly busy: boolean
  readonly readOnly: boolean
  readonly run: Run
}

/**
 * The card choice from a culture advance. The candidates come from the
 * projection, so a refresh shows the same cards and nothing is drawn again. One
 * press keeps one card; the engine discards the rest. The id is kept per reward
 * and card, so a retry of the same press is safe and another card, after the
 * server refused the first, is a new press.
 */
function RewardChoice({
  gameId,
  playerId,
  rev,
  reward,
  busy,
  readOnly,
  run,
}: RewardChoiceProps): React.JSX.Element {
  const [sending, setSending] = useState(false)
  const keep = (itemId: string): void => {
    // One choice at a time for the whole reward: a click on another card while the
    // first is in flight must not send a second request.
    const rewardKey = `${gameId}:${playerId}:chooseReward:${reward.id}`
    if (inFlight.has(rewardKey)) return
    inFlight.add(rewardKey)
    setSending(true)
    // The id is kept per reward and card: after a definitive refusal a different
    // card is a new press, while the same card retried after a lost response is not.
    const settle = (): void => {
      inFlight.delete(rewardKey)
      setSending(false)
    }
    pressOnce(`${rewardKey}:${itemId}`, run, (requestId) =>
      api.chooseReward(gameId, reward.id, itemId, requestId, rev),
    ).then(settle, settle)
  }
  const disabled = busy || readOnly || sending
  return (
    <section className="assisted-reward" aria-labelledby={`reward-${reward.id}`}>
      <h3 id={`reward-${reward.id}`} className="assisted-reward-title">
        Choose a card to keep
      </h3>
      <p className="muted">
        Keep one of these cards. The other cards are discarded.
        {reward.kind === 'greatPerson' && ' Great Person tokens are still handled by hand.'}
      </p>
      <ul className="card-grid small assisted-reward-cards">
        {reward.candidates.map((item) => (
          <ItemCard key={item.id} item={item}>
            <button
              type="button"
              className="small"
              disabled={disabled}
              aria-label={`Keep this card: ${itemName(item)}`}
              onClick={() => keep(item.id)}
            >
              Keep this card
            </button>
          </ItemCard>
        ))}
      </ul>
    </section>
  )
}
