/**
 * Oppgraderer lagrede spill som mangler felter lagt til etter at de ble laget.
 *
 * Java løste dette ved å la Jackson ignorere ukjente felter og la nye felter få
 * `null`, som ga stille feil senere. Her fylles de eksplisitt, og alle
 * lagringsimplementasjoner kaller dette når de leser et spill.
 */

import { createBoard } from './board.js'
import type { GameState } from './state.js'

/** Alt som ikke fantes i en tidligere versjon av `GameState`. */
type MaybeOlder = Omit<GameState, 'board' | 'withdrawnPlayers' | 'publicTurns'> &
  Partial<Pick<GameState, 'board' | 'withdrawnPlayers' | 'publicTurns'>>

export function migrateGameState(state: GameState): GameState {
  const older = state as MaybeOlder

  return {
    ...state,
    board: older.board ?? createBoard(),
    withdrawnPlayers: older.withdrawnPlayers ?? [],
    publicTurns: older.publicTurns ?? {},
  }
}
