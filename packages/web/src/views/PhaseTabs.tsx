/**
 * "Your actions": one tab per phase of the turn (assisted play, part 13).
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
 *
 * The Research tab also holds the Tech panel, below the cards that can be played in
 * Research: that is where a tech is learned. A viewer without the actions panel
 * (a spectator) gets the Tech panel on its own from `GameView`.
 */

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

import { TURN_PHASES, TURN_PHASE_LABEL } from '@civ/engine'
import type { TurnPhase } from '@civ/engine'

import type { GameRevisionView, PlayerView } from '../lib/api.js'
import { AssistedActionGroups, PendingRewardSection, hasActionsPanel } from './AssistedActions.js'
import type { BuildFlow } from './buildFlow.js'
import { CollapsiblePanel } from './CollapsiblePanel.js'
import { ChineseSavePrompt } from './ChineseSavePrompt.js'
import { ConquestPrompt } from './ConquestPrompt.js'
import { EndTurn } from './EndTurn.js'
import type { Run } from './GameView.js'
import { turnTitle } from './ChatOrdersPanel.js'
import { goToPanel } from './PhaseSummary.js'
import { PlayableCardList } from './PlayableCards.js'
import { SetupPanel } from './SetupPanel.js'
import { SpanishFreeBuild, StartOfTurnChoices } from './SotPanel.js'
import { focusPlayer } from './turnFocus.js'
import { TechPanel } from './TechPanel.js'
import { TradeCollected, TradeOffers } from './TradeOffers.js'
import { YourCities } from './YourCities.js'
import './PhaseTabs.css'

const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

/** The tab names: the phase labels the rest of the page already uses. */
export const phaseTabLabel = (phase: TurnPhase): string => capitalized(TURN_PHASE_LABEL[phase])

/**
 * A tab of "Your actions": a phase of the turn, or the Setup tab (#374) that comes first until the viewer's setup is
 * over. Setup is not a `TurnPhase`: `TURN_PHASES` drives the turn status and the done marks, and the setup is not one of them.
 */
export type TabKey = TurnPhase | 'SETUP'

export const SETUP_TAB_LABEL = 'Setup'

/** What the Setup tab is for, in the words of the issue (#374). */
export const SETUP_GUIDE =
  'Before turn 1: place your capital, then your army and scout, choose your social policy and count your starting trade. Do them in any order; a step that needs the capital waits for it.'

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
  const turn = view.activeTurn ?? null
  if (you === null || turn === null) return null
  return turn.waitingFor.find((entry) => entry.username === you.username)?.phase ?? null
}

/** One sentence under the tabs about the tab that is open. */
export function phaseStatusText(selected: TurnPhase, current: TurnPhase | null, started = true): string {
  if (!started) return 'The game has not started yet. The phases open when it does.'
  if (current === null) return 'You have finished every phase of this turn.'
  const order = (phase: TurnPhase): number => TURN_PHASES.indexOf(phase)
  if (selected === current) return 'This is your current phase.'
  if (order(selected) < order(current)) return 'You have finished this phase.'
  return `Not yet: you are in ${TURN_PHASE_LABEL[current]}. This phase opens when you mark the earlier ones done.`
}

/**
 * The question to ask before an action out of turn, or `null` when the viewer is the player the game
 * header names (`turnTitle`, so the two always agree) or nobody is up.
 */
export function notYourTurnQuestion(view: PlayerView): string | null {
  const focus = focusPlayer(view.activeTurn ?? null)
  if (view.you === null || focus === null || focus.username === view.you.username) return null
  return `It is not your turn. ${focus.username} is up. Do it anyway?`
}

interface Props {
  readonly gameId: string
  readonly view: PlayerView
  readonly busy: boolean
  readonly readOnly: boolean
  readonly run: Run
  /** The Build flow GameView shares with the board; City Management uses it for the Build buttons. */
  readonly build?: BuildFlow | undefined
  /** The tab to open first, instead of the viewer's current phase. The tab then follows the viewer as usual. */
  readonly initialPhase?: TabKey | undefined
  /** Bumped by GameView after each action, so the Research tab fetches the available techs again. */
  readonly reloadCount?: number | undefined
  /** A replayed revision: the Research tab shows its saved techs and no live fetch. */
  readonly historical?: GameRevisionView | null | undefined
}

export function PhaseActionsPanel({
  gameId,
  view,
  busy,
  readOnly,
  run,
  build,
  initialPhase,
  reloadCount = 0,
  historical = null,
}: Props): React.JSX.Element | null {
  const current = currentPhaseOf(view)
  const started = view.activeTurn != null
  // The Setup tab is there while the engine projects a setup for the viewer (it is `null` otherwise), and opens first
  const hasSetup = (view.you?.setup ?? null) !== null
  const [selected, setSelected] = useState<TabKey>(initialPhase ?? (hasSetup ? 'SETUP' : (current ?? 'SOT')))
  // The tab follows the viewer to their next phase, and stays where it is otherwise. The Setup tab is not left
  // for a phase while the setup is open (the game starting must not pull the viewer off it); it is gone when setup
  // ends, and the tab shown is then the viewer's phase.
  const followed = useRef(current)
  useEffect(() => {
    if (current !== null && current !== followed.current) setSelected((previous) => (previous === 'SETUP' && hasSetup ? previous : current))
    followed.current = current
  }, [current, hasSetup])
  // A setup that appears while the viewer is on a phase (their civilization is revealed in a running game) opens its tab
  const hadSetup = useRef(hasSetup)
  useEffect(() => {
    if (hasSetup && !hadSetup.current) setSelected('SETUP')
    hadSetup.current = hasSetup
  }, [hasSetup])
  // A setup that is over takes its tab with it: the viewer's phase is shown
  const tab: TabKey = selected === 'SETUP' && !hasSetup ? (current ?? 'SOT') : selected
  const tabs: readonly TabKey[] = hasSetup ? ['SETUP', ...TURN_PHASES] : TURN_PHASES
  // After a successful Keep the choice unmounts and focus would fall to the page.
  const bodyRef = useRef<HTMLDivElement>(null)
  // The same when a press removes the control that was pressed (a city founded, a card played, a government
  // taken): the panel gets the focus when the page's own element is gone and focus was in the panel before.
  // Focus is followed as it moves, and a click elsewhere on the page ends it, so a later refresh takes nothing.
  const focusInPanel = useRef(false)
  useEffect(() => {
    const leave = (event: Event): void => {
      if (!(event.target instanceof Node) || !bodyRef.current?.contains(event.target)) focusInPanel.current = false
    }
    document.addEventListener('pointerdown', leave, true)
    return () => document.removeEventListener('pointerdown', leave, true)
  }, [])
  useEffect(() => {
    if (focusInPanel.current && document.activeElement === document.body) bodyRef.current?.focus({ preventScroll: true })
  })
  // A culture advance puts its cards in the hand: after it, and after a waiting card choice has been
  // kept, the page goes to Your hand. Left alone while a choice is waiting, which is above the hand.
  const [toHand, setToHand] = useState(false)
  const waiting = view.you?.pendingRewards?.length ?? 0
  useEffect(() => {
    if (toHand && waiting === 0) {
      setToHand(false)
      goToPanel('hand')
    }
  }, [toHand, waiting])
  // A free tech the viewer has just been given (Rationalism, the Teacher, Atlantis, the Statue of Liberty,
  // Public Education) is chosen and revealed in the tech tree, so the page goes there when one arrives.
  // A replayed revision has no Start of Turn view (null): that is no change in the number of grants.
  const grants = view.you?.startOfTurn?.techGrants?.length ?? null
  const seenGrants = useRef(grants)
  useEffect(() => {
    if (grants === null) return
    if (seenGrants.current !== null && grants > seenGrants.current) goToPanel('techs')
    seenGrants.current = grants
  }, [grants])

  if (view.you === null || !hasActionsPanel(view)) return null
  // A collapsed panel must not hide the choice, so the title says it is waiting; a conquest offer and the Chinese save wait too
  const choices =
    waiting +
    (view.you.conquestOffers?.length ?? 0) +
    ((view.you.chineseSave?.units.length ?? 0) > 0 ? 1 : 0) +
    // A free building the Spanish earned by exploring: asked for here, in any phase
    (view.you.startOfTurn?.spanish != null ? 1 : 0)
  const title =
    choices > 0
      ? `Your actions (${choices} ${choices === 1 ? 'choice' : 'choices'} waiting)`
      : 'Your actions'

  // Every request a tab sends goes through here, so only a press that changes the game asks; navigation,
  // Cancel and the `?` hints send nothing. A no sends nothing. End turn sits outside the tabs and never asks.
  const askOutOfTurn: Run = (action) => {
    const question = notYourTurnQuestion(view)
    if (question !== null && !window.confirm(question)) return Promise.resolve()
    return run(action)
  }

  const select = (key: TabKey, focus: boolean): void => {
    setSelected(key)
    if (focus) document.getElementById(tabId(key))?.focus()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, key: TabKey): void => {
    const index = tabs.indexOf(key)
    const target =
      event.key === 'ArrowRight'
        ? tabs[(index + 1) % tabs.length]
        : event.key === 'ArrowLeft'
          ? tabs[(index + tabs.length - 1) % tabs.length]
          : event.key === 'Home'
            ? tabs[0]
            : event.key === 'End'
              ? tabs[tabs.length - 1]
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
        onFocus={() => {
          focusInPanel.current = true
        }}
        onBlur={(event) => {
          // Focus that moves to another element (outside the panel too) is not lost; removal gives no target
          if (event.relatedTarget !== null) focusInPanel.current = false
        }}
      >
        <p className="phase-turn-line">{turnTitle(view.activeTurn ?? null, view.you.username)}</p>

        <EndTurn gameId={gameId} view={view} busy={busy} readOnly={readOnly} run={run} onSetupTab={tab === 'SETUP'} />

        <PendingRewardSection
          gameId={gameId}
          view={view}
          busy={busy}
          readOnly={readOnly}
          run={run}
          onKept={() => bodyRef.current?.focus()}
        />

        <ConquestPrompt gameId={gameId} view={view} busy={busy} readOnly={readOnly} run={run} />
        <ChineseSavePrompt gameId={gameId} view={view} busy={busy} readOnly={readOnly} run={run} />
        <SpanishFreeBuild gameId={gameId} view={view} busy={busy} readOnly={readOnly} run={askOutOfTurn} />

        <div className="phase-tabs" role="tablist" aria-label="Phases of the turn">
          {tabs.map((key) => {
            if (key === 'SETUP') {
              const todo = view.you?.setup?.blocksTurn != null
              return (
                <button
                  key={key}
                  id={tabId(key)}
                  type="button"
                  role="tab"
                  aria-selected={key === tab}
                  aria-controls={panelId(key)}
                  tabIndex={key === tab ? 0 : -1}
                  className={`phase-tab${key === tab ? ' active' : ''}${todo ? ' current' : ''}`}
                  onClick={() => select(key, false)}
                  onKeyDown={(event) => onKeyDown(event, key)}
                >
                  {SETUP_TAB_LABEL}
                  {todo && <span className="phase-tab-mark"> (to do)</span>}
                </button>
              )
            }
            const phase = key
            const isCurrent = phase === current
            // Before the game starts nothing is done: the tabs carry no marks
            const done =
              started &&
              (current === null || TURN_PHASES.indexOf(phase) < TURN_PHASES.indexOf(current))
            return (
              <button
                key={phase}
                id={tabId(phase)}
                type="button"
                role="tab"
                aria-selected={phase === tab}
                aria-controls={panelId(phase)}
                tabIndex={phase === tab ? 0 : -1}
                className={`phase-tab${phase === tab ? ' active' : ''}${isCurrent ? ' current' : ''}`}
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
          id={panelId(tab)}
          role="tabpanel"
          aria-labelledby={tabId(tab)}
          className="phase-tab-panel"
        >
          {tab === 'SETUP' ? (
            <>
              <p className="phase-guide">{SETUP_GUIDE}</p>
              <SetupPanel gameId={gameId} view={view} busy={busy} readOnly={readOnly} run={run} />
            </>
          ) : (
            <>
              <p className="phase-guide">{PHASE_GUIDE[tab]}</p>
              <p className="phase-status muted">{phaseStatusText(tab, current, started)}</p>
              <PhaseBody
                phase={tab}
                gameId={gameId}
                view={view}
                busy={busy}
                readOnly={readOnly}
                run={askOutOfTurn}
                build={build}
                reloadCount={reloadCount}
                historical={historical}
                onAdvanced={() => setToHand(true)}
              />
            </>
          )}
        </div>
      </div>
    </CollapsiblePanel>
  )
}

const tabId = (key: TabKey): string => `phase-tab-${key}`
const panelId = (key: TabKey): string => `phase-panel-${key}`

/** What one tab holds. Every phase lists its assisted actions; Research also holds the Tech panel and City Management the city orders. */
function PhaseBody({
  phase,
  gameId,
  view,
  busy,
  readOnly,
  run,
  build,
  reloadCount = 0,
  historical = null,
  onAdvanced,
}: Props & { readonly phase: TurnPhase; readonly onAdvanced: () => void }): React.JSX.Element {
  return (
    <>
      <AssistedActionGroups
        phase={phase}
        gameId={gameId}
        view={view}
        busy={busy}
        readOnly={readOnly}
        run={run}
        onDone={(action) => {
          if (action === 'cultureAdvance') onAdvanced()
        }}
      />
      {phase === 'SOT' && (
        <StartOfTurnChoices gameId={gameId} view={view} busy={busy} readOnly={readOnly} run={run} />
      )}
      <PlayableCardList
        phase={phase}
        gameId={gameId}
        view={view}
        busy={busy}
        readOnly={readOnly}
        run={run}
      />
      {phase === 'RESEARCH' && (
        <TechPanel
          gameId={gameId}
          busy={busy}
          run={run}
          view={view}
          reloadCount={reloadCount}
          historical={historical}
        />
      )}
      {phase === 'TRADE' && (
        <>
          <TradeCollected gameId={gameId} view={view} busy={busy} readOnly={readOnly} run={run} />
          <TradeOffers gameId={gameId} view={view} busy={busy} readOnly={readOnly} run={run} />
        </>
      )}
      {phase === 'CM' && (
        <YourCities gameId={gameId} view={view} busy={busy} readOnly={readOnly} run={run} build={build} />
      )}
    </>
  )
}
