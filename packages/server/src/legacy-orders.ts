/**
 * Chat orders (issue #215): copying the classic turn orders into the timeline.
 *
 * Done once per game, the first time chat orders is switched on, so a game that
 * already played classic turns shows them in the timeline. Only the public
 * history is read (`publicOrderVersions`), so a draft that was never revealed
 * and the private notes cannot end up in it. No mail is sent for these rows.
 */

import type { GameState } from '@civ/engine'
import { publicOrderVersions } from '@civ/engine'

import type { Repository } from './store/types.js'

/**
 * Writes one `order` row per revealed version, oldest first, dated when the owner
 * published it. The ids are made from the version, and a row that already exists
 * is skipped, so running this again copies nothing twice. Returns how many rows
 * it wrote.
 */
export async function copyLegacyOrders(
  repo: Pick<Repository, 'appendChat' | 'chatFor'>,
  gameId: string,
  state: GameState,
): Promise<number> {
  const existing = new Set((await repo.chatFor(gameId)).map((row) => row.id))
  let written = 0
  for (const version of publicOrderVersions(state)) {
    const id = `legacy-${gameId}-${version.turnNumber}-${version.username}-${version.phase}-${version.index}`
    if (existing.has(id)) continue
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
  return written
}
