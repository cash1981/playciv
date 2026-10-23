/**
 * Shared set-up for the Start of Turn tests: cash1981 is Red, the others have their own
 * colours, and Start of Turn is the open phase (nothing is marked done).
 */

import { placePiece } from '../src/actions/board.js'
import { chooseSocialPolicy, chooseTech, revealSocialPolicy, revealTech, setPlayerGovernment } from '../src/actions/player.js'
import { SQUARE_SIZE, findBoardAsset, mapTop } from '../src/board.js'
import type { Government } from '../src/government.js'
import { unwrap } from '../src/result.js'
import type { GameState, PlayerStats } from '../src/state.js'
import { findPlayer } from '../src/state.js'

import { withCivilization, withMarkerAt, withStats } from './culture-advance-fixture.js'
import { CASH1981, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

export { AT } from './culture-advance-fixture.js'

export interface SotOptions {
  readonly civ?: string
  readonly step?: number
  readonly culture?: number
  readonly trade?: number
  readonly stats?: Partial<PlayerStats>
  readonly techs?: readonly string[]
  readonly policies?: readonly string[]
  /** Adopted but not revealed. */
  readonly hiddenPolicies?: readonly string[]
  readonly government?: Government
}

/** Cash is Red, Karandras Blue and Itchi Green, so figures can be told apart. */
function coloured(): GameState {
  const colors: Record<string, string> = { [CASH1981]: 'Red', [KARANDRAS1]: 'Blue', [ITCHI]: 'Green' }
  const state = firstCivGame()
  return { ...state, players: state.players.map((p) => ({ ...p, color: colors[p.playerId] ?? p.color })) }
}

/** Puts a piece with its centre in map square (column, row), both from 0. */
export function put(state: GameState, playerId: string, assetId: string, column: number, row: number): GameState {
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`no asset ${assetId}`)
  return unwrap(
    placePiece(state, {
      playerId,
      assetId,
      x: column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2,
      y: mapTop(state.board) + row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2,
    }),
  )
}

/** A game where cash1981's Start of Turn is open, with the given civilization, techs, policies and government. */
export function sotTurn(options: SotOptions = {}): GameState {
  let state = withCivilization(coloured(), options.civ ?? 'Japanese')
  for (const techName of options.techs ?? []) {
    state = unwrap(chooseTech(state, { playerId: CASH1981, techName }))
    state = unwrap(revealTech(state, { playerId: CASH1981, techName }))
  }
  for (const name of options.policies ?? []) {
    state = unwrap(chooseSocialPolicy(state, { playerId: CASH1981, name }))
    state = unwrap(revealSocialPolicy(state, { playerId: CASH1981, name }))
  }
  for (const name of options.hiddenPolicies ?? []) {
    state = unwrap(chooseSocialPolicy(state, { playerId: CASH1981, name }))
  }
  if (options.government !== undefined) {
    state = unwrap(
      setPlayerGovernment(state, { editorPlayerId: CASH1981, targetPlayerId: CASH1981, government: options.government }),
    )
  }
  state = withStats(state, { culture: options.culture ?? 20, trade: options.trade ?? 20, ...options.stats })
  return withMarkerAt(state, options.step ?? 0, options.civ ?? 'Japanese')
}

export const me = (state: GameState, playerId = CASH1981) => {
  const player = findPlayer(state, playerId)
  if (player === undefined) throw new Error('fixture player missing')
  return player
}
