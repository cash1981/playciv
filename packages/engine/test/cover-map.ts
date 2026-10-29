/**
 * Test helper: lays a tile back over every slot that has no tile, so the whole
 * map counts as explored (a tile back has no terrain data). Movement tests that
 * walk across the map need it now that fog cannot be walked onto (issue #302).
 * Idempotent, and it never covers a slot that already holds a tile.
 */

import { placePiece } from '../src/actions/board.js'
import { slotOrigin } from '../src/board.js'
import { isExploredCell } from '../src/explore.js'
import { unwrap } from '../src/result.js'
import type { GameState } from '../src/state.js'

export function coverMap(state: GameState): GameState {
  let current = state
  for (const slot of state.board.slots) {
    const cells = []
    for (let row = slot.y; row < slot.y + 4; row += 1) {
      for (let column = slot.x; column < slot.x + 4; column += 1) cells.push({ column, row })
    }
    if (cells.some((cell) => isExploredCell(current.board, cell))) continue
    const [x, y] = slotOrigin(current.board, slot)
    const playerId = current.players[0]?.playerId
    if (playerId === undefined) continue
    current = unwrap(placePiece(current, { playerId, assetId: 'tiles/tileback', x, y }))
  }
  return current
}
