/**
 * "Your actions": one tab per phase of the turn (assisted play, part 9).
 *
 * The tab for the viewer's current phase opens first and follows them when they
 * move on; any other tab can be opened to see what that phase allows. Each tab says
 * what the phase is for, then lists the assisted actions that belong to it, every
 * one a button with its status and the reason it cannot be pressed. Nothing is
 * decided here: the buttons read `view.you.availableActions`, which the engine
 * computes once for the viewer, and the server checks every press again.
 *
 * A choice that is waiting (the card to keep after a culture advance) is shown above
 * the tabs, so it cannot hide behind the tab that is not open.
 */

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

import { TURN_PHASES, TURN_PHASE_LABEL } from '@civ/engine'
import type { TurnPhase } from '@civ/engine'

import type { PlayerView } from '../lib/api.js'
import { AssistedActionGroups, PendingRewardSection } from './AssistedActions.js'
import type { BuildFlow } from './buildFlow.js'
import { CityOrders } from './CityOrders.js'
import { CollapsiblePanel } from './CollapsiblePanel.js'
import type { Run } from './GameView.js'
import './PhaseTabs.css'

const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

/** The tab names: the phase labels the rest of the page already uses. */
export const phaseTabLabel = (phase: TurnPhase): string => capitalized(TURN_PHASE_LABEL[phase])

/** What a phase is for, from the rulebook, so the tab guides a player who is new to it. */
export const PHASE_GUIDE: Readonly<Record<TurnPhase, string>> = {
  SOT: 'Play start of turn cards, use your social policies and government, invest a coin and build new cities with your scouts. You may do these in any order, and the order matters.',
  TRADE: 'Your cities collect trade. Then you may negotiate and trade with the other players in the chat.',
  CM: 'Take one action with each city: produce, devote it to the arts or harvest. Spend resource abilities and advance on the culture track.',
  MOVEMENT: 'Move your armies and scouts up to your travel speed, discover map tiles and fight battles.',
  RESEARCH: 'Learn one tech by spending trade, and place it in your tech pyramid. Every player does this at the same time.',
}

/**
 * The phase the viewer is in: the first one not marked done, from the waiting list
 * the engine derives. `null` when there is no active turn or every phase is done.
 */
export function currentPhaseOf(view: PlayerView): TurnPhase | null {
  const you = view.you
  const turn = view.activeTurn
  if (you === null || turn === null) return null
  return turn.waitingFor.find((entry) => entry.username === you.username)?.phase ?? null
}

/** One sentence under the tabs about the tab that is open. */
export function phaseStatusText(selected: TurnPhase, current: TurnPhase | null): string {
  if (current === null) return 'You have finished every phase of this turn.'
  const order = (phase: TurnPhase): number => TURN_PHASES.indexOf(phase)
  if (selected === current) return 'This is your current phase.'
  if (order(selected) < order(current)) return 'You have finished this phase.'
  return `Not yet: you are in ${TURN_PHASE_LABEL[current]}. This phase opens when you mark the earlier ones done.`
}

interface Props {
  readonly gameId: string
  readonly view: PlayerView
  readonly busy: boolean
  readonly readOnly: boolean
  readonly run: Run
  /** The Build flow GameView shares with the board; City Management uses it for the Build buttons. */
  readonly build?: BuildFlow | undefined
}

export function PhaseActionsPanel({
  gameId,
  view,
  busy,
  readOnly,
  run,
  build,
}: Props): React.JSX.Element | null {
  const current = currentPhaseOf(view)
  const [selected, setSelected] = useState<TurnPhase>(current ?? 'SOT')
  // The tab follows the viewer to their next phase, and stays where it is otherwise.
  const followed = useRef(current)
  useEffect(() => {
    if (current !== null && current !== followed.current) setSelected(current)
    followed.current = current
  }, [current])
  // After a successful Keep the choice unmounts and focus would fall to the page.
  const bodyRef = useRef<HTMLDivElement>(null)

  if (view.you === null) return null
  const waiting = view.you.pendingRewards?.length ?? 0
  // A collapsed panel must not hide the choice, so the title says it is waiting.
  const title =
    waiting > 0
      ? `Your actions (${waiting} ${waiting === 1 ? 'choice' : 'choices'} waiting)`
      : 'Your actions'

  const select = (phase: TurnPhase, focus: boolean): void => {
    setSelected(phase)
    if (focus) document.getElementById(tabId(phase))?.focus()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, phase: TurnPhase): void => {
    const index = TURN_PHASES.indexOf(phase)
    const target =
      event.key === 'ArrowRight'
        ? TURN_PHASES[(index + 1) % TURN_PHASES.length]
        : event.key === 'ArrowLeft'
          ? TURN_PHASES[(index + TURN_PHASES.length - 1) % TURN_PHASES.length]
          : event.key === 'Home'
            ? TURN_PHASES[0]
            : event.key === 'End'
              ? TURN_PHASES[TURN_PHASES.length - 1]
              : undefined
    if (target === undefined) return
    event.preventDefault()
    select(target, true)
  }

  return (
    <CollapsiblePanel id="actions" title={title} defaultOpen>
      <div
        ref={bodyRef}
        className="assisted-panel-body"
        tabIndex={-1}
        role="group"
        aria-label="Your actions"
      >
        <PendingRewardSection
          gameId={gameId}
          view={view}
          busy={busy}
          readOnly={readOnly}
          run={run}
          onKept={() => bodyRef.current?.focus()}
        />

        <div className="phase-tabs" role="tablist" aria-label="Phases of the turn">
          {TURN_PHASES.map((phase) => {
            const isCurrent = phase === current
            const done =
              current === null || TURN_PHASES.indexOf(phase) < TURN_PHASES.indexOf(current)
            return (
              <button
                key={phase}
                id={tabId(phase)}
                type="button"
                role="tab"
                aria-selected={phase === selected}
                aria-controls={panelId(phase)}
                tabIndex={phase === selected ? 0 : -1}
                className={`phase-tab${phase === selected ? ' active' : ''}${isCurrent ? ' current' : ''}`}
                onClick={() => select(phase, false)}
                onKeyDown={(event) => onKeyDown(event, phase)}
              >
                {phaseTabLabel(phase)}
                {isCurrent && <span className="phase-tab-mark"> (now)</span>}
                {done && <span className="phase-tab-mark"> (done)</span>}
              </button>
            )
          })}
        </div>

        <div
          id={panelId(selected)}
          role="tabpanel"
          aria-labelledby={tabId(selected)}
          className="phase-tab-panel"
        >
          <p className="phase-guide">{PHASE_GUIDE[selected]}</p>
          <p className="phase-status muted">{phaseStatusText(selected, current)}</p>
          <PhaseBody
            phase={selected}
            gameId={gameId}
            view={view}
            busy={busy}
            readOnly={readOnly}
            run={run}
            build={build}
          />
        </div>
      </div>
    </CollapsiblePanel>
  )
}

const tabId = (phase: TurnPhase): string => `phase-tab-${phase}`
const panelId = (phase: TurnPhase): string => `phase-panel-${phase}`

/** What one tab holds. Every phase lists its assisted actions; City Management also holds the city orders. */
function PhaseBody({
  phase,
  gameId,
  view,
  busy,
  readOnly,
  run,
  build,
}: Props & { readonly phase: TurnPhase }): React.JSX.Element {
  return (
    <>
      <AssistedActionGroups
        phase={phase}
        gameId={gameId}
        view={view}
        busy={busy}
        readOnly={readOnly}
        run={run}
      />
      {phase === 'CM' && (
        <section className="phase-group" aria-label="Cities">
          <h3 className="phase-group-title">Cities</h3>
          <CityOrders
            gameId={gameId}
            view={view}
            busy={busy}
            readOnly={readOnly}
            run={run}
            build={build}
          />
        </section>
      )}
    </>
  )
}
