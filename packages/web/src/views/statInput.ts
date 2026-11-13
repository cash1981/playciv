/**
 * The validation of one typed stat value, shared by every editor of the status
 * bookkeeping (the Player status table's `StatCell` and the sidebar's editor) so
 * the two cannot drift. Pure: it reads the text and says what to save, nothing
 * else. An invalid entry is a value, not an exception; the caller reverts it.
 */

import { isCombatHandSizeValue, isMovementValue } from '@civ/engine'

/**
 * `number`: a non-negative whole number, optionally capped. `movement`: an
 * expression such as `3+1` (issue #102). `freeText`: Combat hand size, anything
 * up to the engine's length limit.
 */
export type StatInputKind = 'number' | 'movement' | 'freeText'

export type StatInputResult =
  | { readonly ok: true; readonly value: number | string }
  | { readonly ok: false }

export function parseStatInput(kind: StatInputKind, raw: string, max?: number): StatInputResult {
  const trimmed = raw.trim()
  if (kind === 'freeText') {
    return isCombatHandSizeValue(trimmed) ? { ok: true, value: trimmed } : { ok: false }
  }
  if (kind === 'movement') {
    return isMovementValue(trimmed) ? { ok: true, value: trimmed } : { ok: false }
  }
  const parsed = Number(trimmed)
  // Empty or partial input (e.g. "" or "-") must be refused, not read as 0.
  if (trimmed === '' || !Number.isInteger(parsed) || parsed < 0 || (max !== undefined && parsed > max)) {
    return { ok: false }
  }
  return { ok: true, value: parsed }
}
