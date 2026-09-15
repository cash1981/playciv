/**
 * Port of the test fixture in old-civ-rest:
 * `CivilizationIntegrationTestApplication.createNewPBFGame()` plus
 * `PBFTestAction.createNewGame()`.
 *
 * The same four players and the same starting player. Java let Mongo hand out
 * ids; here they are fixed, since the tests only need stable references.
 */

import { createGame } from '../src/create-game.js'
import type { GameState } from '../src/state.js'

export const CASH1981 = 'player-cash1981'
export const KARANDRAS1 = 'player-karandras1'
export const ITCHI = 'player-itchi'
export const CHUL = 'player-chul'

/** A fixed seed, so every test starts from the same shuffled deck. */
export const TEST_SEED = 'First civ game'

export function firstCivGame(seed: string | number = TEST_SEED): GameState {
  return createGame({
    name: 'First civ game',
    numOfPlayers: 4,
    seed,
    players: [
      // Java: cash1981 is the game creator and holds the first turn
      { playerId: CASH1981, username: 'cash1981', color: 'Red', gameCreator: true, yourTurn: true },
      { playerId: KARANDRAS1, username: 'Karandras1', color: 'Red' },
      { playerId: ITCHI, username: 'Itchi', color: 'Red' },
      { playerId: CHUL, username: 'Chul', color: 'Red' },
    ],
  })
}
