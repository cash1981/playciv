/**
 * The derived combat bonus (issue #197). There is no old system behind the
 * numbers: each source and value was specified by the human in the issue.
 */

import { describe, expect, it } from 'vitest'

import { placePiece, setWonderOwner } from '../src/actions/board.js'
import { setPlayerGovernment, setPlayerStat } from '../src/actions/player.js'
import { isInWondersArea, wondersArea } from '../src/board.js'
import { combatBonusOf } from '../src/combat-bonus.js'
import type { CivItem } from '../src/item.js'
import { unwrap } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { findPlayer, toPlayerView } from '../src/state.js'

import { CASH1981, KARANDRAS1, firstCivGame } from './fixture.js'

function bonus(state: GameState, playerId = CASH1981): number {
  const player = findPlayer(state, playerId)
  if (player === undefined) throw new Error('no such player')
  return combatBonusOf(state, player)
}

function place(state: GameState, playerId: string, assetId: string, index = 0): GameState {
  return unwrap(placePiece(state, { playerId, assetId, x: 40 + index * 100, y: 300 }))
}

function setMic(state: GameState, value: number): GameState {
  return unwrap(
    setPlayerStat(state, { editorPlayerId: CASH1981, targetPlayerId: CASH1981, stat: 'mic', value }),
  )
}

function withCiv(state: GameState, playerId: string, name: string): GameState {
  const civilization = { kind: 'civ', name } as unknown as CivItem
  return {
    ...state,
    players: state.players.map((p) => (p.playerId === playerId ? { ...p, civilization } : p)),
  }
}

describe('combatBonusOf', () => {
  it('is 0 for a player with nothing', () => {
    expect(bonus(firstCivGame())).toBe(0)
  })

  it('counts Barracks and the Shipyard as +2 and an Academy as +4', () => {
    let state = place(firstCivGame(), CASH1981, 'buildings/barracks', 0)
    expect(bonus(state)).toBe(2)
    state = place(state, CASH1981, 'buildings/shipyard', 1)
    expect(bonus(state)).toBe(4)
    state = place(state, CASH1981, 'buildings/academy', 2)
    expect(bonus(state)).toBe(8)
    state = place(state, CASH1981, 'buildings/barracks', 3)
    expect(bonus(state)).toBe(10)
  })

  it('ignores buildings that give no bonus, and buildings placed by someone else', () => {
    let state = place(firstCivGame(), CASH1981, 'buildings/library', 0)
    state = place(state, KARANDRAS1, 'buildings/barracks', 1)
    expect(bonus(state)).toBe(0)
    expect(bonus(state, KARANDRAS1)).toBe(2)
  })

  it('counts each General as +4', () => {
    let state = place(firstCivGame(), CASH1981, 'great people/general', 0)
    expect(bonus(state)).toBe(4)
    state = place(state, CASH1981, 'great people/general', 1)
    expect(bonus(state)).toBe(8)
    expect(bonus(place(state, CASH1981, 'great people/scientist', 2))).toBe(8)
  })

  it.each([
    [0, 0],
    [1, 0],
    [2, 4],
    [3, 4],
    [4, 8],
    [5, 8],
    [6, 12],
    [7, 12],
    [10, 12],
  ])('gives %i MIC investments a bonus of %i, capped at 6 investments', (mic, expected) => {
    expect(bonus(setMic(firstCivGame(), mic))).toBe(expected)
  })

  it('adds 4 under Fundamentalism and nothing under other governments', () => {
    const fundamentalism = unwrap(
      setPlayerGovernment(firstCivGame(), {
        editorPlayerId: CASH1981, targetPlayerId: CASH1981, government: 'Fundamentalism',
      }),
    )
    expect(bonus(fundamentalism)).toBe(4)
    const democracy = unwrap(
      setPlayerGovernment(fundamentalism, {
        editorPlayerId: CASH1981, targetPlayerId: CASH1981, government: 'Democracy',
      }),
    )
    expect(bonus(democracy)).toBe(0)
  })

  it('adds 2 for the French', () => {
    const state = withCiv(firstCivGame(), CASH1981, 'French')
    expect(bonus(state)).toBe(2)
    expect(bonus(withCiv(firstCivGame(), CASH1981, 'Germans'))).toBe(0)
  })

  it('adds 6 for the owner of the Statue of Zeus in the Wonders area only', () => {
    const state = firstCivGame()
    const area = wondersArea(state.board)
    const placed = unwrap(placePiece(state, {
      playerId: CASH1981, assetId: 'wonders/statueofzeus', x: area.x + 20, y: area.y + 40,
    }))
    const wonder = placed.board.pieces.at(-1)
    if (wonder === undefined) throw new Error('the statue should be on the board')
    expect(isInWondersArea(placed.board, wonder)).toBe(true)
    // Unowned: nobody gets it.
    expect(bonus(placed)).toBe(0)
    const owned = unwrap(setWonderOwner(placed, {
      playerId: CASH1981, pieceId: wonder.id, ownerId: KARANDRAS1,
    }))
    expect(bonus(owned, KARANDRAS1)).toBe(6)
    expect(bonus(owned, CASH1981)).toBe(0)
  })

  it('adds up every source', () => {
    let state = withCiv(firstCivGame(), CASH1981, 'French')
    state = place(state, CASH1981, 'buildings/barracks', 0)
    state = place(state, CASH1981, 'buildings/academy', 1)
    state = place(state, CASH1981, 'great people/general', 2)
    state = setMic(state, 4)
    state = unwrap(
      setPlayerGovernment(state, {
        editorPlayerId: CASH1981, targetPlayerId: CASH1981, government: 'Fundamentalism',
      }),
    )
    // French 2 + Barracks 2 + Academy 4 + General 4 + MIC 8 + Fundamentalism 4
    expect(bonus(state)).toBe(24)
  })
})

describe('combat in the projections', () => {
  it('shows the derived value to the owner and to opponents, and ignores a stored value', () => {
    const base = place(firstCivGame(), CASH1981, 'buildings/academy', 0)
    const stored = {
      ...base,
      players: base.players.map((p) =>
        p.playerId === CASH1981 ? { ...p, stats: { ...p.stats, combat: 99 } } : p,
      ),
    }

    const own = toPlayerView(stored, CASH1981)
    expect(own.you?.stats.combat).toBe(4)

    const seen = toPlayerView(stored, KARANDRAS1)
    expect(seen.opponents.find((p) => p.playerId === CASH1981)?.stats.combat).toBe(4)
  })

  it('recalculates when a building is removed from the board', () => {
    const state = place(firstCivGame(), CASH1981, 'buildings/barracks', 0)
    expect(toPlayerView(state, CASH1981).you?.stats.combat).toBe(2)
    const without = { ...state, board: { ...state.board, pieces: [] } }
    expect(toPlayerView(without, CASH1981).you?.stats.combat).toBe(0)
  })
})

