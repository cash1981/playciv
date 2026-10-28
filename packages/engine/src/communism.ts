/**
 * The squares locked by the Communism tech's Spy ability this turn.
 *
 * The lock lives in the applied assisted action records rather than in a second
 * saved field: an undo marks the record undone and the lock disappears with it.
 * It is public, so every viewer can see which squares figures may not leave.
 */

import type { GameState } from './state.js'
import { turnStatus } from './turn.js'

export const COMMUNISM_USAGE_KEY = 'card:Communism'

/** The map squares no figure may leave this turn. */
export function communismLocksOf(state: GameState): readonly { readonly column: number; readonly row: number }[] {
  const turnNumber = turnStatus(state).currentTurn
  return state.assistedActions.flatMap((record) =>
    record.status === 'applied' &&
    record.kind === 'communism' &&
    record.turnNumber === turnNumber &&
    record.effect.kind === 'communism'
      ? [{ column: record.effect.square.column, row: record.effect.square.row }]
      : [],
  )
}

/** The lock squares as the `column,row` keys movement uses. */
export function communismLockKeys(state: GameState): ReadonlySet<string> {
  return new Set(communismLocksOf(state).map((cell) => `${cell.column},${cell.row}`))
}
