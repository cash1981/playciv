/**
 * Moving the orders of the old Turn orders panel into the single chat
 * (issue #215, `docs/agents/tasks/single-chat.md`).
 *
 * Done once per game by the admin migration, so a game that was played with the
 * old panel shows its turns in the timeline. Only the public history is read
 * (`publicOrderVersions`, and `publicOrdersWithoutVersions` for the orders that
 * were revealed before versions were kept), so a draft that was never revealed and
 * the private notes cannot end up in it. No mail is sent for these rows.
 */

import type { GameState } from '@civ/engine'
import { publicOrderVersions, publicOrdersWithoutVersions } from '@civ/engine'
import type { PublicOrderVersion } from '@civ/engine'

import type { ChatMessage, Repository } from './store/types.js'

/** Every public order the timeline should hold for this game, with the id its row gets. */
export function legacyOrderRows(
  gameId: string,
  state: GameState,
): readonly { readonly id: string; readonly version: PublicOrderVersion; readonly withoutVersion: boolean }[] {
  const base = (version: PublicOrderVersion): string =>
    `${gameId}-${version.turnNumber}-${version.username}-${version.phase}-${version.index}`
  const rows = [
    ...publicOrderVersions(state).map((version) => ({ id: `legacy-${base(version)}`, version, withoutVersion: false })),
    // A distinct marker: these have no history entry, so their id cannot collide with the above
    ...publicOrdersWithoutVersions(state).map((version) => ({ id: `legacy-reveal-${base(version)}`, version, withoutVersion: true })),
  ]
  // Oldest first across both kinds (the sort is stable, so equal times keep their order)
  return [...rows].sort((a, b) => Date.parse(a.version.at) - Date.parse(b.version.at))
}

export interface LegacyCopy {
  /** Rows written by this call. */
  readonly written: number
  /** Every version is in the timeline now; false when `limit` stopped the copy short. */
  readonly complete: boolean
}

/**
 * The rows of `legacyOrderRows` that the given chat does not hold yet, oldest first:
 * the same dedupe `copyLegacyOrders` writes by, so a count of these is what a copy
 * would write.
 */
export function missingLegacyRows(
  chat: readonly ChatMessage[],
  gameId: string,
  state: GameState,
): ReturnType<typeof legacyOrderRows> {
  const existing = new Set(chat.map((row) => row.id))
  const orders = chat.filter((row) => row.kind === 'order')
  const posted = new Set(orders.map((row) => [row.username, row.turnNumber, row.phase, row.createdAt, row.message].join('\u0000')))
  const postedAnyTime = new Set(orders.map((row) => [row.username, row.turnNumber, row.phase, row.message].join('\u0000')))
  return legacyOrderRows(gameId, state).filter(({ id, version, withoutVersion }) => {
    const key = [version.username, version.turnNumber, version.phase, version.at, version.markdown].join('\u0000')
    const keyAnyTime = [version.username, version.turnNumber, version.phase, version.markdown].join('\u0000')
    return !(existing.has(id) || posted.has(key) || (withoutVersion && postedAnyTime.has(keyAnyTime)))
  })
}

/**
 * Writes one `order` row per revealed version, oldest first, dated when the owner
 * published it, and one per order revealed before versions were kept, dated from the
 * reveal's log line (see `publicOrdersWithoutVersions`). The ids are made from the
 * version, and a row that already exists is skipped, so running this again copies nothing twice. A version that the
 * timeline already holds under another id (an order posted after the game was
 * adopted writes both the history and its own row) is skipped too, matched on
 * author, turn, phase, time and text; a version-less one is matched without the
 * time, which is only a guess. `limit` caps the rows written, for a
 * request with a budget; calling again carries on where it stopped.
 */
export async function copyLegacyOrders(
  repo: Pick<Repository, 'appendChat' | 'chatFor'>,
  gameId: string,
  state: GameState,
  limit: number = Number.POSITIVE_INFINITY,
): Promise<LegacyCopy> {
  let written = 0
  for (const { id, version } of missingLegacyRows(await repo.chatFor(gameId), gameId, state)) {
    if (written >= limit) return { written, complete: false }
    await repo.appendChat({
      id,
      gameId,
      username: version.username,
      message: version.markdown,
      createdAt: version.at,
      kind: 'order',
      turnNumber: version.turnNumber,
      phase: version.phase,
    })
    written += 1
  }
  return { written, complete: true }
}
