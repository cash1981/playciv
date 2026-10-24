/**
 * Shared set-up for the culture advance tests: a player with a civilization,
 * their leader marker on a chosen space of the culture track, and their City
 * Management phase open.
 */

import { placePiece } from '../src/actions/board.js'
import { chooseSocialPolicy, chooseTech, revealSocialPolicy, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { cultureCellCenter, findBoardAsset, leaderAssetId } from '../src/board.js'
import type { CivItem, Item } from '../src/item.js'
import { unwrap } from '../src/result.js'
import type { GameState, PlayerStats } from '../src/state.js'

import { CASH1981, firstCivGame } from './fixture.js'

/** The fixture players are all Red, and Japanese is a civilization with a leader marker. */
export const LEADER = 'leaders/japanese_red'

export const AT = '2026-10-09T10:00:00.000Z'

export const withCivilization = (state: GameState, civName: string, playerId = CASH1981): GameState => ({
  ...state,
  players: state.players.map((candidate) =>
    candidate.playerId === playerId
      ? { ...candidate, civilization: { kind: 'civ', name: civName } as unknown as CivItem }
      : candidate,
  ),
})

export const withStats = (state: GameState, stats: Partial<PlayerStats>, playerId = CASH1981): GameState => ({
  ...state,
  players: state.players.map((candidate) =>
    candidate.playerId === playerId ? { ...candidate, stats: { ...candidate.stats, ...stats } } : candidate,
  ),
})

/** The leader marker of the civilization, in the player's colour, placed on the given step at the top of the track. */
export function withMarkerAt(state: GameState, step: number, civName = 'Japanese', playerId = CASH1981): GameState {
  const assetId = leaderAssetId(civName, 'Red')
  const asset = assetId === undefined ? undefined : findBoardAsset(assetId)
  if (assetId === undefined || asset === undefined) throw new Error('leader artwork missing')
  const centre = cultureCellCenter(state.board, step)
  return unwrap(
    placePiece(state, { playerId, assetId, x: Math.round(centre.x - asset.width / 2), y: 10 }),
  )
}

/** The player's turn 1 with Start of Turn and Trade done, so City Management is open. */
export const openCityManagement = (state: GameState, playerId = CASH1981): GameState =>
  unwrap(markPhasesDone(state, { playerId, turnNumber: 1, upToPhase: 'TRADE' }))

export interface AdvanceOptions {
  readonly step?: number
  readonly culture?: number
  readonly trade?: number
  readonly civ?: string
  readonly techs?: readonly string[]
  readonly policies?: readonly string[]
}

/**
 * A game where cash1981 stands on `step` (0 by default), has the given culture
 * and trade (plenty by default), the given techs and social policies revealed,
 * and an open City Management.
 */
export function advanceTurn(options: AdvanceOptions = {}): GameState {
  let state = withCivilization(firstCivGame(), options.civ ?? 'Japanese')
  for (const techName of options.techs ?? []) {
    state = unwrap(chooseTech(state, { playerId: CASH1981, techName }))
    state = unwrap(revealTech(state, { playerId: CASH1981, techName }))
  }
  for (const name of options.policies ?? []) {
    state = unwrap(chooseSocialPolicy(state, { playerId: CASH1981, name }))
    state = unwrap(revealSocialPolicy(state, { playerId: CASH1981, name }))
  }
  state = withStats(state, { culture: options.culture ?? 100, trade: options.trade ?? 100 })
  state = withMarkerAt(state, options.step ?? 0, options.civ ?? 'Japanese')
  return openCityManagement(state)
}

/** The first item of a sheet on the deck, which is what the next draw takes. */
export const topOf = (state: GameState, sheetName: Item['sheetName']): Item | undefined =>
  state.items.find((item) => item.sheetName === sheetName)

/** The first `count` items of a sheet on the deck, in draw order. */
export const topCards = (state: GameState, sheetName: Item['sheetName'], count: number): readonly Item[] =>
  state.items.filter((item) => item.sheetName === sheetName).slice(0, count)
