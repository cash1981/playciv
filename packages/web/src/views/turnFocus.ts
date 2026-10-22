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

/** The entries at the earliest open phase, in list order. Empty when nobody is waited for. */
function earliestEntries(activeTurn: ActiveTurnStatus): readonly FocusEntry[] {
  const index = (phase: TurnPhase): number => TURN_PHASES.indexOf(phase)
  const earliest = Math.min(...activeTurn.waitingFor.map((entry) => index(entry.phase)))
  return activeTurn.waitingFor.filter((entry) => index(entry.phase) === earliest)
}

/**
 * The player furthest behind: the lowest phase among those waited for. Among a
 * tie the viewer comes first, then the turn holder, then the first in the list.
 * `null` when there is no active turn or everyone is done.
 */
export function focusPlayer(activeTurn: ActiveTurnStatus | null, viewerUsername?: string): FocusEntry | null {
  if (activeTurn === null || activeTurn.waitingFor.length === 0) return null
  const tied = earliestEntries(activeTurn)
  return (
    tied.find((entry) => entry.username === viewerUsername) ??
    tied.find((entry) => entry.username === activeTurn.username) ??
    tied[0] ??
    null
  )
}

/**
 * The players other than the viewer who are at the earliest open phase, with
 * that phase. Empty when the viewer is alone at that phase, ahead of nobody
 * else, or when nobody is waited for.
 */
export function earliestOthers(
  activeTurn: ActiveTurnStatus | null,
  viewerUsername?: string,
): { readonly phase: TurnPhase; readonly usernames: readonly string[] } | null {
  if (activeTurn === null || activeTurn.waitingFor.length === 0) return null
  const tied = earliestEntries(activeTurn)
  const first = tied[0]
  if (first === undefined) return null
  const others = tied.filter((entry) => entry.username !== viewerUsername)
  if (others.length === 0) return null
  return { phase: first.phase, usernames: others.map((entry) => entry.username) }
}
