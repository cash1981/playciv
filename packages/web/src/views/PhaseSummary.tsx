/**
 * The phase summary and the page shortcuts in the game header (#260, #261).
 *
 * Everything here is read from the projection the viewer already has: the
 * active turn and its waiting list, the viewer's own stats and their pending
 * card choices. Nothing is inferred from chat text, and nothing is added to the
 * server. A spectator gets the round and who is waited for, no resources.
 */

import { TURN_PHASE_LABEL } from '@civ/engine'
import type { TurnPhase } from '@civ/engine'

import type { PlayerView } from '../lib/api.js'
import { earliestOthers } from './turnFocus.js'
import './PhaseSummary.css'

/** The DOM id of the board panel; BoardView puts it on its section. */
export const BOARD_PANEL_ID = 'game-board'

const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

const phaseLabel = (phase: TurnPhase): string => capitalized(TURN_PHASE_LABEL[phase])

/**
 * What the viewer is doing this round, from the waiting list the engine
 * derives from the done marks: the first phase not marked done, or all done
 * once they are no longer waited for.
 */
export function viewerPhaseText(view: PlayerView): string | null {
  const you = view.you
  const turn = view.activeTurn
  if (you === null || turn === null) return null
  const mine = turn.waitingFor.find((entry) => entry.username === you.username)
  if (mine === undefined) return 'You: all phases done'
  return `You: ${phaseLabel(mine.phase)}`
}

/**
 * Who holds the round up besides the viewer: the players at the earliest open
 * phase, with that phase. `null` when there is no active turn, 'Everyone is done'
 * when nobody is waited for, and `''` when the viewer is the only one at the
 * earliest phase (their own line already says so). Players who are ahead are
 * not listed.
 */
export function waitingText(view: PlayerView): string | null {
  const turn = view.activeTurn
  if (turn === null) return null
  // Defensive: the engine clears the active turn once nobody is waited for. Mirrors `turnTitle` in ChatOrdersPanel.
  if (turn.waitingFor.length === 0) return 'Everyone is done'
  const behind = earliestOthers(turn, view.you?.username)
  if (behind === null) return ''
  return `Waiting for ${behind.usernames.join(', ')} (${TURN_PHASE_LABEL[behind.phase]})`
}

export function PhaseSummary({ view }: { readonly view: PlayerView }): React.JSX.Element {
  const you = view.you
  const round = view.activeTurn?.turnNumber
  const mine = viewerPhaseText(view)
  const waiting = waitingText(view)
  const waitingChoices = you?.pendingRewards?.length ?? 0

  return (
    <div className="phase-summary" role="group" aria-label="Phase summary">
      {round !== undefined && <p className="phase-summary-round">Round {round}</p>}
      {mine !== null && <p className="phase-summary-you">{mine}</p>}
      {waiting !== null && waiting !== '' && <p className="phase-summary-waiting">{waiting}</p>}
      {waitingChoices > 0 && (
        <button
          type="button"
          className="phase-summary-choice"
          onClick={() => goToPanel('actions')}
        >
          {waitingChoices === 1 ? '1 card choice waiting' : `${waitingChoices} card choices waiting`}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shortcuts
// ---------------------------------------------------------------------------

/**
 * A panel on the page by its `CollapsiblePanel` id, or the board. A collapsed
 * panel still has its heading on the page, so that is where the shortcut lands
 * ({@link goToPanel} opens Your actions as well).
 */
function findPanel(key: string): { readonly section: HTMLElement; readonly focus: HTMLElement } | null {
  if (key === 'board') {
    const board = document.getElementById(BOARD_PANEL_ID)
    return board === null ? null : { section: board, focus: board }
  }
  // A collapsible panel is found by its content; a plain panel (the embedded Tech
  // content, once the Research tab is open) by its own id.
  const section =
    document.getElementById(`${key}-content`)?.closest('section') ?? document.getElementById(key)
  if (section === null) return null
  const toggle = section.querySelector<HTMLElement>(`[aria-controls="${key}-content"]`)
  return { section, focus: toggle ?? section }
}

/**
 * Scrolls a panel into view and moves focus to it. The scroll is smooth unless
 * the user asks for reduced motion. Focus does not scroll on its own, so the
 * page moves once.
 *
 * Your actions (`actions`) is opened when it is collapsed: the city controls and
 * a waiting card choice are in it, and a saved collapsed state would hide them
 * behind a button that says it goes there. `open` asks for the same for a card
 * link, so the referenced card is visible. The click on the toggle is a manual
 * one, so the open state is remembered. Every other panel is left as it is.
 *
 * The Tech content lives in the Research tab of Your actions, with no panel of its
 * own to collapse. Going to `techs` opens Your actions if needed and selects the
 * Research tab before the scroll, because the content is not mounted in any other
 * tab. It has an id and focus target of its own in place of a toggle.
 */
function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function scrollToPanel(key: string, open: boolean): void {
  const panel = findPanel(key)
  if (panel === null) return
  if (open && panel.focus.getAttribute('aria-expanded') === 'false') panel.focus.click()
  panel.section.scrollIntoView({
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    block: 'start',
  })
  panel.focus.focus({ preventScroll: true })
}

export function goToPanel(key: string, open = false): void {
  if (key === 'techs') {
    // The Tech content can only be shown inside Your actions, so open that first.
    const actions = findPanel('actions')
    let deferScroll = false
    if (actions !== null && actions.focus.getAttribute('aria-expanded') === 'false') {
      actions.focus.click()
      deferScroll = true
    }
    const research = document.getElementById('phase-tab-RESEARCH')
    if (research !== null && research.getAttribute('aria-selected') !== 'true') {
      // A click on the tab goes through the tabs' own state, so there is no second
      // copy of the selected phase here. The panel mounts on the next render.
      research.click()
      deferScroll = true
    }
    if (deferScroll) {
      window.setTimeout(() => scrollToPanel('techs', false), 0)
      return
    }
  }
  if (key === 'actions') {
    const actions = findPanel('actions')
    if (actions !== null && actions.focus.getAttribute('aria-expanded') === 'false') {
      actions.focus.click()
    }
  }
  scrollToPanel(key, open)
}

/** The DOM id of one card in the viewer's hand. */
export const handItemId = (itemId: string): string => `hand-item-${itemId}`

/**
 * Scrolls to a card in the viewer's hand and focuses it. The hand is opened first
 * when it is collapsed, so the card is not hidden behind the panel toggle.
 */
export function goToHandItem(itemId: string): void {
  const panel = findPanel('hand')
  if (panel === null) return
  const content = document.getElementById('hand-content')
  const wasClosed = content?.hidden === true
  if (wasClosed) panel.focus.click()
  const reveal = (): void => {
    const item = document.getElementById(handItemId(itemId))
    if (item === null) return
    item.scrollIntoView?.({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'center',
    })
    item.focus({ preventScroll: true })
  }
  if (wasClosed) window.setTimeout(reveal, 0)
  else reveal()
}

const SHORTCUTS: readonly { readonly key: string; readonly label: string; readonly onlyWithActions?: true }[] = [
  { key: 'board', label: 'Board' },
  // The panel id, not its title: "Your actions" is too long for a button.
  { key: 'actions', label: 'Actions', onlyWithActions: true },
  { key: 'hand', label: 'Your cards' },
  { key: 'techs', label: 'Tech tree' },
]

/**
 * Buttons that jump to the main parts of the page. Chat and History are left out on purpose, for now.
 * `actions` says whether "Your actions" is on the page (a spectator has none, and a
 * player with nothing to do there has none either), so the button is never dead.
 */
export function PageShortcuts({ actions }: { readonly actions: boolean }): React.JSX.Element {
  return (
    <nav className="page-shortcuts" aria-label="Go to">
      {SHORTCUTS.filter((shortcut) => actions || shortcut.onlyWithActions !== true).map((shortcut) => (
        <button
          key={shortcut.key}
          type="button"
          className="small"
          onClick={() => goToPanel(shortcut.key)}
        >
          {shortcut.label}
        </button>
      ))}
    </nav>
  )
}
