/**
 * Who the game header puts in focus: the player furthest behind.
 *
 * The engine's turn holder (`activeTurn.playerId`) is not who holds the round
 * up, so the title, the colour chips and the "Waiting for" line read from the
 * waiting list instead. Presentation only: the engine, `activeTurnStatus` and
 * the out of turn question keep using the holder.
 */

import { TURN_PHASES } from '@civ/engine'
import type { TurnPhase } from '@civ/engine'

import type { ActiveTurnStatus } from '../lib/api.js'

export interface FocusEntry {
  readonly username: string
  readonly phase: TurnPhase
}

/**
 * The entries at the earliest open phase, in list order. Empty when there is no
 * active turn or nobody is waited for.
 */
function earliestEntries(activeTurn: ActiveTurnStatus | null): readonly FocusEntry[] {
  if (activeTurn === null) return []
  const waiting = activeTurn.waitingFor
  const index = (phase: TurnPhase): number => TURN_PHASES.indexOf(phase)
  const earliest = Math.min(...waiting.map((entry) => index(entry.phase)))
  return waiting.filter((entry) => index(entry.phase) === earliest)
}

/**
 * The player furthest behind: the lowest phase among those waited for. Among a
 * tie the turn holder comes first when they are in it, else the first in the
 * list. The viewer gets no preference, so at the start of a round, when
 * everyone is tied, the title keeps naming the turn holder for everybody.
 * `null` when there is no active turn or everyone is done.
 */
export function focusPlayer(activeTurn: ActiveTurnStatus | null): FocusEntry | null {
  const tied = earliestEntries(activeTurn)
  return tied.find((entry) => entry.username === activeTurn?.username) ?? tied[0] ?? null
}

/**
 * The players other than the viewer who are at the earliest open phase, with
 * that phase. `null` when nobody is waited for, or when the viewer is the only
 * one at that phase. A viewer tied with others still gets the others.
 */
export function earliestOthers(
  activeTurn: ActiveTurnStatus | null,
  viewerUsername?: string,
): { readonly phase: TurnPhase; readonly usernames: readonly string[] } | null {
  const tied = earliestEntries(activeTurn)
  const first = tied[0]
  if (first === undefined) return null
  const others = tied.filter((entry) => entry.username !== viewerUsername)
  if (others.length === 0) return null
  return { phase: first.phase, usernames: others.map((entry) => entry.username) }
}
