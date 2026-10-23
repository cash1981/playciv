/**
 * Assisted actions in the browser (#260): the game does a step for the player
 * instead of asking them to edit counters by hand.
 *
 * The state of every button comes from `view.you.availableActions`, which the
 * engine computes once for the viewer. This file adds no rule of its own: it
 * shows `status` and `reason`, and sends one request per press.
 *
 * Two entry points use the same {@link AssistedActionButton}: the phase tabs
 * (`PhaseTabs.tsx`) and the tech detail dialog. Neither fires anything by rendering;
 * only a press does.
 */

import { useId, useState } from 'react'
import type { ReactNode } from 'react'

import { itemName } from '@civ/engine'
import type { AssistedActionKind, PendingRewardView, TurnPhase } from '@civ/engine'

import { ApiError, api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import type { BuildFlow } from './buildFlow.js'
import { endTurnState } from './EndTurn.js'
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
 * action once. It is freed in three cases:
 *
 * - the press succeeded;
 * - the server answered with a status that means it decided not to apply the
 *   write: below 500, except 408 (request timeout) and 429 (too many requests),
 *   which say nothing about whether the write was applied (see
 *   {@link serverDeclined});
 * - the projection shows the action as applied: the kept id is the `id` of a
 *   record in `view.assistedActions`, so the press landed even though its
 *   response was lost, and the next press is a new one (see
 *   {@link dropLandedId}).
 *
 * It is kept for 500 and above (a gateway, or Cloudflare's resource limit, can
 * answer after the Worker applied the write) and for a failure with no response
 * at all (network down, lost response). Kept at module level, keyed on game,
 * viewer and action, so the panel and the dialog share it, a remount (closing the
 * dialog) does not lose it, and another account in the same tab never reuses it.
 */
const pendingRequestIds = new Map<string, string>()
const inFlight = new Set<string>()

/** Whether a press with this key has been sent and has not settled yet. */
export function isPressInFlight(key: string): boolean {
  return inFlight.has(key)
}

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
 * True when the status proves the server decided not to apply the write. A 5xx
 * does not: it can come from a gateway after the Worker did the work. 408 and 429
 * are 4xx but come from the edge or a limiter, not from the game's own decision.
 */
function serverDeclined(status: unknown): boolean {
  return typeof status === 'number' && status < 500 && status !== 408 && status !== 429
}

/**
 * The kept id is the `id` of an applied action in the projection: the press
 * landed. Forget the id, so the next press (a second culture advance, say) is a
 * new request and not an idempotent replay of the first.
 */
function dropLandedId(key: string, view: PlayerView | undefined): void {
  const kept = pendingRequestIds.get(key)
  if (kept !== undefined && view?.assistedActions?.some((record) => record.id === kept)) {
    pendingRequestIds.delete(key)
  }
}

/**
 * One press, with its kept request id. `key` says which press it is: the same key
 * while the outcome is unknown reuses the id, a settled one gets a new id.
 * Resolves to true when the request succeeded.
 */
export function pressOnce(
  key: string,
  run: Run,
  send: (requestId: string) => Promise<PlayerView>,
  view?: PlayerView,
): Promise<boolean> {
  // A second click before the first has settled is the same press.
  if (inFlight.has(key)) return Promise.resolve(false)
  dropLandedId(key, view)
  const requestId = pendingRequestIds.get(key) ?? newRequestId()
  pendingRequestIds.set(key, requestId)
  inFlight.add(key)
  let succeeded = false
  const settle = (): boolean => {
    inFlight.delete(key)
    return succeeded
  }
  return run(async () => {
    try {
      const result = await send(requestId)
      succeeded = true
      pendingRequestIds.delete(key)
      return result
    } catch (caught) {
      // See the comment on pendingRequestIds for which failures spend the id.
      if (caught instanceof ApiError && serverDeclined(caught.status)) {
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
  /** Called after a press that went through, once the page has the fresh view. */
  readonly onDone?: (() => void) | undefined
}

/**
 * What the player is asked before a card that was used this turn is used again.
 * Some Great Persons and culture cards allow it and are not built, so the player
 * is the override, the way the Draw button asks first when it is not your turn.
 */
export const usedAgainQuestion = (label: string): string =>
  `You have already used ${label} this turn. The rules allow it once per turn. Use it again?`

/**
 * One button for one assisted action. Renders nothing for a spectator or when
 * the viewer has no state for the action. Disabled unless the status is `ready`
 * or `used`, and then the reason is on the page as text, not only in a tooltip.
 * A `used` card stays pressable: a press asks first and sends `confirmedRepeat`
 * only after a yes.
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
  onDone,
}: ButtonProps): React.JSX.Element | null {
  const reasonId = useId()
  const state = view.you?.availableActions?.find((candidate) => candidate.action === action)
  if (view.you === null || state === undefined) return null

  const ready = state.status === 'ready'
  const used = state.status === 'used'
  const showReason = detail === 'full' || !ready
  const rev = view.rev
  const playerId = view.you.playerId

  const press = (): void => {
    const key = `${gameId}:${playerId}:${action}`
    if (used) {
      // A press already on its way is the same press: do not ask a second time.
      if (inFlight.has(key)) return
      // Cancelling asks nothing of the server and leaves any kept request id as it is.
      if (!window.confirm(usedAgainQuestion(state.label))) return
    }
    void pressOnce(
      key,
      run,
      (requestId) =>
        used
          ? api.performAction(gameId, action, requestId, rev, true)
          : api.performAction(gameId, action, requestId, rev),
      view,
    ).then((done) => {
      if (done) onDone?.()
    })
  }

  return (
    <span className="assisted-action">
      <button
        type="button"
        className={className}
        disabled={busy || readOnly || !(ready || used)}
        aria-describedby={showReason ? reasonId : undefined}
        onClick={press}
      >
        {children ?? state.buttonText ?? BUTTON_TEXT[action] ?? `Use ${state.label}`}
      </button>
      {detail === 'full' && <span className="tag">{STATUS_TEXT[state.status]}</span>}
      {showReason && (
        <span id={reasonId} className="muted assisted-reason">
          {state.reason}
        </span>
      )}
      {ready && state.warning !== undefined && (
        <span role="status" className="assisted-warning">
          {state.warning}
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
  /** The Build flow GameView shares with the board. Without it the city cards have no Build button. */
  readonly build?: BuildFlow | undefined
}

/**
 * Whether "Your actions" is on the page: the viewer has an action for a card they
 * hold, a card choice waiting, a city on the map, or a turn to end (a player in a
 * game that is running). Never for a spectator. The game page asks too, so the
 * Actions shortcut is not a dead button.
 */
export function hasActionsPanel(view: PlayerView): boolean {
  return (
    endTurnState(view) !== null ||
    (view.you?.availableActions ?? []).some((candidate) => candidate.status !== 'not-owned') ||
    (view.you?.pendingRewards?.length ?? 0) > 0 ||
    (view.you?.cities?.length ?? 0) > 0
  )
}

/**
 * The buttons of one phase, grouped under the heading each action names. Actions for
 * a card the player does not hold are left out, so the list stays short. `'ANY'`
 * actions are listed in every phase. `onDone` runs after a press that went through, with
 * the action that was pressed.
 */
export function AssistedActionGroups({
  gameId,
  view,
  busy,
  readOnly,
  run,
  phase,
  onDone,
}: PanelProps & {
  readonly phase: TurnPhase
  readonly onDone?: ((action: AssistedActionKind) => void) | undefined
}): React.JSX.Element | null {
  const actions = (view.you?.availableActions ?? []).filter(
    (candidate) =>
      candidate.status !== 'not-owned' && (candidate.phase === phase || candidate.phase === 'ANY'),
  )
  if (view.you === null || actions.length === 0) return null
  const groups = [...new Set(actions.map((candidate) => candidate.group))]
  return (
    <section className="assisted-possible" aria-label="Possible actions">
      <h3 className="assisted-possible-title">Possible actions</h3>
      <div className="assisted-possible-box">
        {groups.map((group) => (
          <section key={group} className="phase-group" aria-label={group}>
            <h4 className="phase-group-title">{group}</h4>
            <ul className="assisted-actions">
              {actions
                .filter((candidate) => candidate.group === group)
                .map((candidate) => (
                  <li key={candidate.action}>
                    {/* A button with its own text (Advance culture) names the row itself. */}
                    {BUTTON_TEXT[candidate.action] === undefined && candidate.buttonText === undefined && (
                      <span className="assisted-name">{candidate.label}</span>
                    )}
                    <AssistedActionButton
                      action={candidate.action}
                      gameId={gameId}
                      view={view}
                      busy={busy}
                      readOnly={readOnly}
                      run={run}
                      onDone={onDone === undefined ? undefined : () => onDone(candidate.action)}
                    />
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  )
}

/**
 * The card choice waiting after a culture advance. It is shown above the phase tabs,
 * whichever tab is open, because a choice that is hidden behind a tab is a choice a
 * player forgets. Nothing when no choice is waiting.
 */
export function PendingRewardSection({
  gameId,
  view,
  busy,
  readOnly,
  run,
  onKept,
}: PanelProps & { readonly onKept: () => void }): React.JSX.Element | null {
  const pending = view.you?.pendingRewards?.[0]
  if (view.you === null || pending === undefined) return null
  return (
    <RewardChoice
      gameId={gameId}
      playerId={view.you.playerId}
      rev={view.rev}
      reward={pending}
      busy={busy}
      readOnly={readOnly}
      run={run}
      onKept={onKept}
    />
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
  /** Called after a successful choice, when this section is about to go away. */
  readonly onKept: () => void
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
  onKept,
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
    ).then((kept) => {
      settle()
      if (kept) onKept()
    }, settle)
  }
  const disabled = busy || readOnly || sending
  return (
    <section className="assisted-reward" aria-labelledby={`reward-${reward.id}`}>
      <h3 id={`reward-${reward.id}`} className="assisted-reward-title">
        Choose a card to keep
      </h3>
      <p className="muted">
        Keep one of these cards. The other cards are discarded.
        {reward.kind === 'greatPerson' &&
          ' Keeping a card also puts its marker next to your civilization sheet. Drag it onto the map when you place it.'}
      </p>
      <ul className="card-grid small assisted-reward-cards">
        {(reward.candidates ?? []).map((item) => (
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
