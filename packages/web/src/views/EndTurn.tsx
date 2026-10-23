/**
 * End turn in "Your actions": the first order panel control to move over.
 *
 * It marks the viewer's own earliest open phase in the active turn done, the
 * same request the Order tab's End turn button sends (`api.markDone`). The turn
 * and the phase are read from the waiting list the engine derives from the done
 * marks, and they go in the request, so a press ends the phase the viewer saw
 * even if the turn has moved on since. Ending Research is the last press of a
 * turn: the next turn starts when every player has done it.
 *
 * "Reopen" takes the viewer's latest ended phase of the active turn back to not
 * done (`api.unmarkDone`), for a player who forgot something. It sends the
 * revision it saw, so a press on a stale panel is refused instead of pulling back
 * a turn that has moved on. Nothing else moves:
 * the turn is derived from the done marks, so the others keep waiting for whoever
 * they waited for, and phases the viewer ended later stay ended. Nothing here adds
 * a rule.
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

/**
 * The phase "Reopen" takes back: the last one the viewer ended before the phase
 * they have open, or Research once they are done. `null` when there is none. Only
 * the active turn is offered: reopening Research of a turn everybody has finished
 * would pull the whole game back to it.
 */
export function reopenPhase(view: PlayerView, state: EndTurnState): TurnPhase | null {
  const done = view.you?.playerTurns?.find((turn) => turn.turnNumber === state.turnNumber)?.done
  const before = state.kind === 'open' ? TURN_PHASES.slice(0, TURN_PHASES.indexOf(state.phase)) : TURN_PHASES
  return [...before].reverse().find((phase) => done?.[phase] === true) ?? null
}

/** The phases the viewer ended after the one they have open, in the same turn. */
function endedLater(view: PlayerView, state: EndTurnState): readonly TurnPhase[] {
  if (state.kind !== 'open') return []
  const done = view.you?.playerTurns?.find((turn) => turn.turnNumber === state.turnNumber)?.done
  const after = TURN_PHASES.slice(TURN_PHASES.indexOf(state.phase) + 1)
  return after.filter((phase) => done?.[phase] === true)
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
  const endRef = useRef<HTMLButtonElement>(null)
  const reopened = useRef(false)

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

  // Pressing Reopen removes or moves the Reopen button, and focus would fall to the
  // page. Put it on End turn, which is then the way to lock the phase again.
  const phaseKey = state === null ? '' : `${state.kind}:${state.kind === 'open' ? state.phase : ''}`
  useEffect(() => {
    if (!reopened.current) return
    const active = document.activeElement
    if (active === null || active === document.body) {
      endRef.current?.focus()
      reopened.current = false
    }
  }, [phaseKey])

  if (state === null) return null

  const reopen = reopenPhase(view, state)
  const reopenButton =
    reopen === null ? null : (
      <button
        type="button"
        className="small"
        disabled={busy || readOnly}
        // Starts with the visible text (WCAG 2.5.3, Label in Name)
        aria-label={`Reopen ${TURN_PHASE_LABEL[reopen]}: mark as not done`}
        onClick={() => {
          reopened.current = true
          void run(() => api.unmarkDone(gameId, reopen, state.turnNumber, view.rev))
        }}
      >
        Reopen {TURN_PHASE_LABEL[reopen]}
      </button>
    )

  if (state.kind === 'done') {
    const behind = earliestOthers(view.activeTurn ?? null, view.you?.username)
    return (
      <div className="assisted-endturn">
        <p ref={doneRef} className="assisted-endturn-text" tabIndex={-1}>
          You have ended turn {state.turnNumber}.
          {behind !== null &&
            ` Waiting for ${behind.usernames.join(', ')} (${TURN_PHASE_LABEL[behind.phase]}).`}
        </p>
        {reopenButton}
      </div>
    )
  }

  const label = TURN_PHASE_LABEL[state.phase]
  const last = state.phase === TURN_PHASES[TURN_PHASES.length - 1]
  const stillEnded = endedLater(view, state)
  return (
    <div className="assisted-endturn">
      <button
        ref={endRef}
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
      {stillEnded.length > 0 && (
        <p className="assisted-endturn-text assisted-endturn-reopened">
          Reopened: your {label} phase is open again. Your {stillEnded.map((phase) => TURN_PHASE_LABEL[phase]).join(' and ')}{' '}
          {stillEnded.length === 1 ? 'phase stays' : 'phases stay'} ended.
        </p>
      )}
      {reopenButton}
    </div>
  )
}
