/** The School of Confucius taken by an army and its card kept: a Great Person that is kept after a choice. */

import { travelFigureCollecting } from '../src/actions/token-collection.js'
import { performAssistedAction } from '../src/assisted.js'
import { unwrap } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { findPlayer } from '../src/state.js'

import { AT } from './culture-advance-fixture.js'
import { CASH1981 } from './fixture.js'
import { put } from './sot-fixture.js'

export function armyTakesRelic(state: GameState, assetId: string): GameState {
  const withTile = put(state, CASH1981, 'tiles/tile05', 0, 0)
  const placed = put(put(withTile, CASH1981, 'figures/redarmy', 3, 2), CASH1981, assetId, 3, 1)
  const army = placed.board.pieces.find((piece) => piece.assetId === 'figures/redarmy')
  if (army === undefined) throw new Error('no army')
  return unwrap(travelFigureCollecting(placed, { playerId: CASH1981, pieceId: army.id, column: 3, row: 1, collectToken: true }))
}

export function keepReward(state: GameState, requestId: string): GameState {
  const reward = findPlayer(state, CASH1981)?.pendingRewards[0]
  if (reward === undefined) throw new Error('no reward waiting')
  return unwrap(
    performAssistedAction(state, {
      playerId: CASH1981,
      action: 'chooseReward',
      requestId,
      at: AT,
      payload: { rewardId: reward.id, itemId: reward.candidateIds[0] ?? '' },
    }),
  )
}
