/**
 * Port av testfixturen i old-civ-rest:
 * `CivilizationIntegrationTestApplication.createNewPBFGame()` +
 * `PBFTestAction.createNewGame()`.
 *
 * Samme fire spillere, samme startspiller. Java lot Mongo dele ut id-er; her er
 * de faste, siden testene bare trenger stabile referanser.
 */

import { createGame } from '../src/create-game.js'
import type { GameState } from '../src/state.js'

export const CASH1981 = 'player-cash1981'
export const KARANDRAS1 = 'player-karandras1'
export const ITCHI = 'player-itchi'
export const CHUL = 'player-chul'

/** Fast seed, slik at hver test starter fra samme stokk. */
export const TEST_SEED = 'First civ game'

export function firstCivGame(seed: string | number = TEST_SEED): GameState {
  return createGame({
    name: 'First civ game',
    numOfPlayers: 4,
    seed,
    players: [
      // Java: cash1981 er gameCreator og har turen
      { playerId: CASH1981, username: 'cash1981', color: 'Red', gameCreator: true, yourTurn: true },
      { playerId: KARANDRAS1, username: 'Karandras1', color: 'Red' },
      { playerId: ITCHI, username: 'Itchi', color: 'Red' },
      { playerId: CHUL, username: 'Chul', color: 'Red' },
    ],
  })
}
