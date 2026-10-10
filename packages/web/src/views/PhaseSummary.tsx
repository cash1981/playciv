/**
 * The phase summary and the page shortcuts in the game header (#260, #261).
 *
 * Everything here is read from the projection the viewer already has: the
 * active turn and its waiting list, the viewer's own stats and their pending
 * card choices. Nothing is inferred from chat text, and nothing is added to the
 * server. A spectator gets the round and who is waited for, no resources.
 */

import { TURN_PHASES, TURN_PHASE_LABEL, totalCoins } from '@civ/engine'
import type { TurnPhase } from '@civ/engine'

import type { PlayerView } from '../lib/api.js'
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
  return `You: ${phaseLabel(mine.phase)} (${TURN_PHASES.indexOf(mine.phase) + 1} of ${TURN_PHASES.length})`
}

/**
 * Who the round waits for besides the viewer, with their phase. `null` when
 * the round is finished, `''` when only the viewer is left (their own line
 * already says so).
 */
export function waitingText(view: PlayerView): string | null {
  const turn = view.activeTurn
  if (turn === null) return null
  // Defensive: the engine clears the active turn once nobody is waited for. Mirrors `turnTitle` in ChatOrdersPanel.
  if (turn.waitingFor.length === 0) return 'Everyone is done'
  const others = turn.waitingFor.filter((entry) => entry.username !== view.you?.username)
  if (others.length === 0) return ''
  return `Waiting for ${others
    .map((entry) => `${entry.username} (${TURN_PHASE_LABEL[entry.phase]})`)
    .join(', ')}`
}

export function PhaseSummary({ view }: { readonly view: PlayerView }): React.JSX.Element {
  const you = view.you
  const round = view.activeTurn?.turnNumber
  const mine = viewerPhaseText(view)
  const waiting = waitingText(view)
  const stats = you?.stats
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
      {stats !== undefined && (
        <ul className="phase-summary-resources" aria-label="Your resources">
          <li>Culture <strong>{stats.culture}</strong></li>
          <li>Trade <strong>{stats.trade}</strong></li>
          {stats.coinSources !== undefined && (
            <li>Coins <strong>{totalCoins(stats.coinSources)}</strong></li>
          )}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shortcuts
// ---------------------------------------------------------------------------

/**
 * A panel on the page by its `CollapsiblePanel` id, or the board. A collapsed
 * panel still has its heading on the page, so that is where the shortcut lands.
 */
function findPanel(key: string): { readonly section: HTMLElement; readonly focus: HTMLElement } | null {
  if (key === 'board') {
    const board = document.getElementById(BOARD_PANEL_ID)
    return board === null ? null : { section: board, focus: board }
  }
  // Assisted choices moved into Conversation & actions. Keep the old key as a
  // compatibility alias so existing shortcuts land on the new combined panel.
  const content = document.getElementById(`${key}-content`)
    ?? (key === 'actions' ? document.getElementById('chat-orders-content') : null)
  const section = content?.closest('section')
  if (section === null || section === undefined) return null
  const toggle = content === null ? null : section.querySelector<HTMLElement>(`[aria-controls="${content.id}"]`)
  return { section, focus: toggle ?? section }
}

/**
 * Scrolls a panel into view and moves focus to it. The scroll is smooth unless
 * the user asks for reduced motion. Focus does not scroll on its own, so the
 * page moves once.
 */
export function goToPanel(key: string): void {
  const panel = findPanel(key)
  if (panel === null) return
  const reduced =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  panel.section.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  panel.focus.focus({ preventScroll: true })
}

const SHORTCUTS: readonly { readonly key: string; readonly label: string; readonly chat?: true }[] = [
  { key: 'board', label: 'Board' },
  { key: 'hand', label: 'Your cards' },
  { key: 'techs', label: 'Tech tree' },
  { key: 'chat-orders', label: 'Chat', chat: true },
  { key: 'log', label: 'History' },
]

/**
 * Buttons that jump to the main parts of the page. `chat` is false when the
 * chat panel is not on the page (a spectator without an account).
 */
export function PageShortcuts({ chat }: { readonly chat: boolean }): React.JSX.Element {
  return (
    <nav className="page-shortcuts" aria-label="Go to">
      {SHORTCUTS.filter((shortcut) => shortcut.chat !== true || chat).map((shortcut) => (
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
