/**
 * End turn in "Your actions": the first order panel control to move over.
 *
 * It marks the viewer's own earliest open phase in the active turn done, the
 * same request the Order tab's End turn button sends (`api.markDone`). The turn
 * and the phase are read from the waiting list the engine derives from the done
 * marks, and they go in the request, so a press ends the phase the viewer saw
 * even if the turn has moved on since. Ending Research is the last press of a
 * turn: the next turn starts when every player has done it. Nothing here adds a
 * rule.
 */

import { useEffect, useRef } from 'react'

import { TURN_PHASES, TURN_PHASE_LABEL } from '@civ/engine'
import type { TurnPhase } from '@civ/engine'

import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import type { Run } from './GameView.js'
import { earliestOthers } from './turnFocus.js'

/** Where the viewer stands in the active turn. */
export type EndTurnState =
  | { readonly kind: 'open'; readonly turnNumber: number; readonly phase: TurnPhase }
  | { readonly kind: 'done'; readonly turnNumber: number }

/**
 * The viewer's open phase in the active turn, or `done` once they are no longer
 * waited for. `null` for a spectator, a game that has not started or has ended
 * (there is no turn to end). A replayed view keeps its active turn, so it has a
 * state too; the page disables the button there (`readOnly`).
 */
export function endTurnState(view: PlayerView): EndTurnState | null {
  const you = view.you
  const turn = view.activeTurn ?? null
  if (you === null || turn === null || view.active === false) return null
  const mine = turn.waitingFor.find((entry) => entry.username === you.username)
  return mine === undefined
    ? { kind: 'done', turnNumber: turn.turnNumber }
    : { kind: 'open', turnNumber: turn.turnNumber, phase: mine.phase }
}

const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

interface Props {
  readonly gameId: string
  readonly view: PlayerView
  readonly busy: boolean
  readonly readOnly: boolean
  readonly run: Run
}

/** Renders nothing when there is no turn to end (see {@link endTurnState}). */
export function EndTurn({ gameId, view, busy, readOnly, run }: Props): React.JSX.Element | null {
  const state = endTurnState(view)
  const kind = state?.kind
  const doneRef = useRef<HTMLParagraphElement>(null)
  const wasOpen = useRef(false)

  // The last press replaces the button with a line of text, and focus would fall to
  // the page, with nothing announced. Focus the line, but only when focus was lost:
  // a refresh that shows the turn ended somewhere else must not steal it.
  useEffect(() => {
    if (kind === 'open') {
      wasOpen.current = true
    } else if (kind === 'done' && wasOpen.current) {
      wasOpen.current = false
      const active = document.activeElement
      if (active === null || active === document.body) doneRef.current?.focus()
    }
  }, [kind])

  if (state === null) return null

  if (state.kind === 'done') {
    const behind = earliestOthers(view.activeTurn ?? null, view.you?.username)
    return (
      <div className="assisted-endturn">
        <p ref={doneRef} className="assisted-endturn-text" tabIndex={-1}>
          You have ended turn {state.turnNumber}.
          {behind !== null &&
            ` Waiting for ${behind.usernames.join(', ')} (${TURN_PHASE_LABEL[behind.phase]}).`}
        </p>
      </div>
    )
  }

  const label = TURN_PHASE_LABEL[state.phase]
  const last = state.phase === TURN_PHASES[TURN_PHASES.length - 1]
  return (
    <div className="assisted-endturn">
      <button
        type="button"
        className="primary"
        disabled={busy || readOnly}
        // Starts with the visible text (WCAG 2.5.3, Label in Name)
        aria-label={`End turn: mark ${capitalized(label)} as done`}
        onClick={() => void run(() => api.markDone(gameId, state.phase, state.turnNumber))}
      >
        End turn
      </button>
      <p className="assisted-endturn-text muted">
        Turn {state.turnNumber}: marks your {label} phase done.
        {last && ' The next turn starts when every player has ended their research phase.'}
      </p>
    </div>
  )
}
