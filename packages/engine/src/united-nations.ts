/**
 * The United Nations wonder: "Culture events cannot target you against your will." The game cannot ask the owner,
 * so whoever plays a culture event that names an owner confirms that the owner agreed; the log says so.
 */
import { blockadedPieceIds } from './blockade.js'
import { activeWonderOwnerIds } from './coins.js'
import type { GameState, Playerhand } from './state.js'

export const UNITED_NATIONS_ASSET = 'wonders/unitednations'

/** The players, other than `exceptPlayerId`, who own the United Nations while it is not blockaded. */
export function unitedNationsHolders(state: GameState, exceptPlayerId: string): readonly Playerhand[] {
  const owners = activeWonderOwnerIds(state.board.pieces, UNITED_NATIONS_ASSET, blockadedPieceIds(state))
  return state.players.filter((candidate) => candidate.playerId !== exceptPlayerId && owners.has(candidate.playerId))
}
