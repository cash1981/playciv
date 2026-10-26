/**
 * Trade timing: trade is kept as coins when the next turn starts, grows during
 * Start of Turn, and collects the trade around the cities once when Trade starts.
 */

import { describe, expect, it } from 'vitest'

import { placePiece } from '../src/actions/board.js'
import { chooseTech, removeTech, setPlayerStat } from '../src/actions/player.js'
import { markPhasesDone, unmarkPhaseDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { SQUARE_SIZE, findBoardAsset, mapTop, slotOrigin } from '../src/board.js'
import { cityProductionsOf } from '../src/city-production.js'
import { unwrap } from '../src/result.js'
import type { GameState, Playerhand } from '../src/state.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import { tradeEstimateOf } from '../src/trade-estimate.js'
import type { PlayerTurn } from '../src/turn.js'
import { createPlayerTurn, turnStatus } from '../src/turn.js'

import { CASH1981, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-10-26T12:00:00.000Z'

const playerOf = (state: GameState, playerId = CASH1981): Playerhand => {
  const found = findPlayer(state, playerId)
  if (found === undefined) throw new Error(`no player ${playerId}`)
  return found
}

const patchPlayer = (
  state: GameState,
  playerId: string,
  patch: (player: Playerhand) => Playerhand,
): GameState => ({
  ...state,
  players: state.players.map((player) => (player.playerId === playerId ? patch(player) : player)),
})

const withTrade = (state: GameState, trade: number, playerId = CASH1981): GameState =>
  patchPlayer(state, playerId, (player) => ({
    ...player,
    stats: { ...player.stats, trade },
  }))

const withCoins = (state: GameState, coins: number, playerId = CASH1981): GameState =>
  patchPlayer(state, playerId, (player) => ({
    ...player,
    stats: { ...player.stats, coinSources: { ...player.stats.coinSources, sheet: coins } },
  }))

const withResearch = (state: GameState, playerId = CASH1981, turnNumber = 1, techName = 'Pottery'): GameState =>
  patchPlayer(state, playerId, (player) => ({
    ...player,
    researchTurns: { ...player.researchTurns, [techName]: turnNumber },
  }))

/** England in the first slot and a Red city on B2, whose trade is 3. */
function cityScene(): GameState {
  const colors: Record<string, string> = {
    [CASH1981]: 'Red',
    [KARANDRAS1]: 'Blue',
    'player-itchi': 'Green',
    'player-chul': 'Yellow',
  }
  let state: GameState = {
    ...firstCivGame(),
    players: firstCivGame().players.map((player) => ({ ...player, color: colors[player.playerId] ?? player.color })),
  }
  const slot = state.board.slots[0]
  if (slot === undefined) throw new Error('no board slot')
  const [x, y] = slotOrigin(state.board, slot)
  state = unwrap(placePiece(state, { playerId: CASH1981, assetId: 'tiles/England', x, y }))

  const asset = findBoardAsset('cities/redcity2')
  if (asset === undefined) throw new Error('no city asset')
  return unwrap(
    placePiece(state, {
      playerId: CASH1981,
      assetId: 'cities/redcity2',
      x: SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2,
      y: mapTop(state.board) + SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2,
    }),
  )
}

const mark = (state: GameState, playerId: string, turnNumber: number, upToPhase: 'SOT' | 'TRADE' | 'MOVEMENT' | 'RESEARCH'): GameState =>
  unwrap(markPhasesDone(state, { playerId, turnNumber, upToPhase, at: AT }))

const undoByVote = (state: GameState, logId: string): GameState => {
  let next = unwrap(initiateUndo(state, { logId, playerId: CASH1981 }))
  for (const playerId of [KARANDRAS1, 'player-itchi', 'player-chul']) {
    next = unwrap(vote(next, { logId, playerId, vote: true }))
  }
  return next
}

const tradeTurn = (state: GameState): PlayerTurn => {
  const turn = playerOf(state).playerTurns.find((candidate) => candidate.turnNumber === 1)
  if (turn === undefined) throw new Error('no turn')
  return turn
}

const estimateOf = (state: GameState) => tradeEstimateOf(state, playerOf(state))

describe('keeping trade as coins at the start of the next turn', () => {
  it('resets the players who researched to their coins when the last Research ends', () => {
    let state = cityScene()
    state = withTrade(state, 9)
    state = withCoins(state, 4)
    state = withResearch(state)
    state = withTrade(state, 5, KARANDRAS1)
    state = withCoins(state, 1, KARANDRAS1)
    state = withResearch(state, KARANDRAS1)

    state = mark(state, CASH1981, 1, 'RESEARCH')
    state = mark(state, KARANDRAS1, 1, 'RESEARCH')
    // The turn has not rolled over while the other seats are still researching.
    expect(turnStatus(state).currentTurn).toBe(1)
    expect(playerOf(state).stats.trade).toBe(9 + 3)

    state = mark(state, 'player-itchi', 1, 'RESEARCH')
    state = mark(state, 'player-chul', 1, 'RESEARCH')

    expect(turnStatus(state).currentTurn).toBe(2)
    expect(playerOf(state).stats.trade).toBe(4)
    expect(playerOf(state, KARANDRAS1).stats.trade).toBe(1)
  })

  it('keeps the trade of a player who ended Research without choosing a tech', () => {
    let state = cityScene()
    state = withTrade(state, 4)
    state = withCoins(state, 5)
    state = withResearch(state)
    state = withTrade(state, 9, KARANDRAS1)
    state = withCoins(state, 1, KARANDRAS1)

    for (const playerId of [CASH1981, KARANDRAS1, 'player-itchi', 'player-chul']) {
      state = mark(state, playerId, 1, 'RESEARCH')
    }

    expect(playerOf(state).stats.trade).toBe(5)
    expect(playerOf(state, KARANDRAS1).stats.trade).toBe(9)
  })

  it('records a tech chosen in Research, keeps a free tech out, and clears a removed tech', () => {
    let state = mark(cityScene(), CASH1981, 1, 'MOVEMENT')
    state = unwrap(chooseTech(state, { playerId: CASH1981, techName: 'Pottery' }))
    expect(playerOf(state).researchTurns).toEqual({ Pottery: 1 })

    state = unwrap(removeTech(state, { playerId: CASH1981, techName: 'Pottery' }))
    expect(playerOf(state).researchTurns).toEqual({})

    const early = unwrap(chooseTech(cityScene(), { playerId: CASH1981, techName: 'Pottery' }))
    expect(playerOf(early).researchTurns).toEqual({})
  })

  it('does not reset trade after an accepted undo removes the Research tech', () => {
    let state = withCoins(withTrade(cityScene(), 4), 1)
    state = mark(state, CASH1981, 1, 'MOVEMENT')
    state = unwrap(chooseTech(state, { playerId: CASH1981, techName: 'Pottery' }))
    const logId = state.log.at(-1)?.id
    if (logId === undefined) throw new Error('no tech log entry')
    state = undoByVote(state, logId)
    expect(playerOf(state).researchTurns).toEqual({})

    for (const playerId of [CASH1981, KARANDRAS1, 'player-itchi', 'player-chul']) {
      state = mark(state, playerId, 1, 'RESEARCH')
    }

    expect(playerOf(state).stats.trade).toBe(7)
  })

  it('keeps the city trade collected when the player did not research', () => {
    let state = withTrade(cityScene(), 4)
    for (const playerId of [CASH1981, KARANDRAS1, 'player-itchi', 'player-chul']) {
      state = mark(state, playerId, 1, 'RESEARCH')
    }
    expect(playerOf(state).stats.trade).toBe(7)
  })

  it('records research marked ahead for the turn it belongs to', () => {
    let state = mark(cityScene(), CASH1981, 1, 'RESEARCH')
    state = mark(state, CASH1981, 2, 'MOVEMENT')
    state = unwrap(chooseTech(state, { playerId: CASH1981, techName: 'Pottery' }))
    expect(playerOf(state).researchTurns).toEqual({ Pottery: 2 })
  })

  it('shows the research choice to its owner and not to opponents or spectators', () => {
    let state = mark(cityScene(), CASH1981, 1, 'MOVEMENT')
    state = unwrap(chooseTech(state, { playerId: CASH1981, techName: 'Pottery' }))
    expect(toPlayerView(state, CASH1981).you?.researchTurns).toEqual({ Pottery: 1 })
    expect(JSON.stringify(toPlayerView(state, KARANDRAS1).opponents)).not.toContain('researchTurns')
    expect(JSON.stringify(toPlayerView(state, 'a-spectator'))).not.toContain('researchTurns')
  })

  it('holds the reset to the trade track, 25 for the Japanese', () => {
    let state = withCoins(cityScene(), 40)
    state = withResearch(state)
    state = {
      ...state,
      players: state.players.map((player) =>
        player.playerId === CASH1981 ? { ...player, civilization: { kind: 'civ', name: 'Japanese' } as never } : player,
      ),
    }
    for (const playerId of [CASH1981, KARANDRAS1, 'player-itchi', 'player-chul']) {
      state = mark(state, playerId, 1, 'RESEARCH')
    }
    expect(playerOf(state).stats.trade).toBe(25)
  })
})

describe('collecting the cities when Trade starts', () => {
  it('adds the city trade once when Start of Turn is marked done', () => {
    const state = mark(withTrade(cityScene(), 4), CASH1981, 1, 'SOT')

    expect(playerOf(state).stats.trade).toBe(7)
    expect(tradeTurn(state).tradeCollected).toBe(3)
    expect(estimateOf(state)).toEqual({
      current: 4,
      cities: 3,
      collected: true,
      ceiling: 27,
      total: 7,
      set: true,
    })
  })

  it('keeps a trade number set by hand instead of adding the cities to it', () => {
    let state = withTrade(cityScene(), 4)
    state = unwrap(setPlayerStat(state, { editorPlayerId: CASH1981, targetPlayerId: CASH1981, stat: 'trade', value: 9 }))
    state = mark(state, CASH1981, 1, 'SOT')

    expect(playerOf(state).stats.trade).toBe(9)
    expect(tradeTurn(state).tradeCollected).toBeUndefined()
    expect(estimateOf(state)).toMatchObject({ current: 9, collected: false, set: true, total: 9 })
  })

  it('does not count again when Trade is marked done or the phase is re-marked', () => {
    let state = mark(withTrade(cityScene(), 4), CASH1981, 1, 'SOT')
    state = mark(state, CASH1981, 1, 'TRADE')
    expect(playerOf(state).stats.trade).toBe(7)
    expect(tradeTurn(state).tradeCollected).toBe(3)
  })

  it('collects once when Start of Turn and Trade are marked done together', () => {
    const state = mark(withTrade(cityScene(), 4), CASH1981, 1, 'TRADE')
    expect(playerOf(state).stats.trade).toBe(7)
    expect(tradeTurn(state).tradeCollected).toBe(3)
  })

  it('takes the collection back when Start of Turn is reopened, and adds it again on the next end', () => {
    let state = mark(withTrade(cityScene(), 4), CASH1981, 1, 'SOT')
    state = unwrap(unmarkPhaseDone(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT' }))

    expect(playerOf(state).stats.trade).toBe(4)
    expect(tradeTurn(state).tradeCollected).toBeUndefined()

    state = mark(state, CASH1981, 1, 'SOT')
    expect(playerOf(state).stats.trade).toBe(7)
    expect(tradeTurn(state).tradeCollected).toBe(3)
  })

  it('records only what the trade track had room for', () => {
    const state = mark(withTrade(cityScene(), 26), CASH1981, 1, 'SOT')
    expect(playerOf(state).stats.trade).toBe(27)
    expect(tradeTurn(state).tradeCollected).toBe(1)
  })

  it('leaves trade already above the track alone instead of recording a negative addition', () => {
    let state = mark(withTrade(cityScene(), 29), CASH1981, 1, 'SOT')
    expect(playerOf(state).stats.trade).toBe(29)
    expect(tradeTurn(state).tradeCollected).toBe(0)

    state = unwrap(unmarkPhaseDone(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT' }))
    expect(playerOf(state).stats.trade).toBe(29)
  })

  it('does not subtract the old collection after the player edits trade by hand', () => {
    let state = mark(withTrade(cityScene(), 4), CASH1981, 1, 'SOT')
    state = unwrap(setPlayerStat(state, { editorPlayerId: CASH1981, targetPlayerId: CASH1981, stat: 'trade', value: 20 }))
    expect(tradeTurn(state).tradeCollected).toBeUndefined()

    state = unwrap(unmarkPhaseDone(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT' }))
    expect(playerOf(state).stats.trade).toBe(20)
  })

  it('collects when Trade is marked done on a turn saved before this rule', () => {
    const base = withTrade(cityScene(), 4)
    const player = playerOf(base)
    const legacy: PlayerTurn = {
      ...createPlayerTurn(player.username, 1),
      done: { ...createPlayerTurn(player.username, 1).done, SOT: true },
    }
    const state: GameState = {
      ...base,
      players: base.players.map((candidate) =>
        candidate.playerId === CASH1981 ? { ...candidate, playerTurns: [legacy] } : candidate,
      ),
    }

    const collected = mark(state, CASH1981, 1, 'TRADE')
    expect(playerOf(collected).stats.trade).toBe(7)
    expect(tradeTurn(collected).tradeCollected).toBe(3)
  })

  it('collects at the turn start for a player who marked the new turn ahead', () => {
    let state = withCoins(withTrade(cityScene(), 4), 5)
    state = withResearch(state)
    state = mark(state, CASH1981, 1, 'RESEARCH')
    state = mark(state, CASH1981, 2, 'TRADE')
    expect(turnStatus(state).currentTurn).toBe(1)

    state = mark(state, KARANDRAS1, 1, 'RESEARCH')
    state = mark(state, 'player-itchi', 1, 'RESEARCH')
    state = mark(state, 'player-chul', 1, 'RESEARCH')

    expect(turnStatus(state).currentTurn).toBe(2)
    expect(playerOf(state).stats.trade).toBe(8)
    const secondTurn = playerOf(state).playerTurns.find((turn) => turn.turnNumber === 2)
    expect(secondTurn?.tradeCollected).toBe(3)
  })

  it('leaves the current trade alone when an older Start of Turn is reopened', () => {
    let state = withCoins(withTrade(cityScene(), 4), 5)
    state = withResearch(state)
    state = mark(state, CASH1981, 1, 'SOT')
    for (const playerId of [CASH1981, KARANDRAS1, 'player-itchi', 'player-chul']) {
      state = mark(state, playerId, 1, 'RESEARCH')
    }
    expect(turnStatus(state).currentTurn).toBe(2)
    expect(playerOf(state).stats.trade).toBe(5)

    state = unwrap(unmarkPhaseDone(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT' }))
    expect(playerOf(state, CASH1981).stats.trade).toBe(5)
  })

  it('does not reverse an old collection after reopening Research and Start of Turn', () => {
    let state = withCoins(withTrade(cityScene(), 4), 5)
    state = withResearch(state)
    state = mark(state, CASH1981, 1, 'SOT')
    for (const playerId of [CASH1981, KARANDRAS1, 'player-itchi', 'player-chul']) {
      state = mark(state, playerId, 1, 'RESEARCH')
    }
    expect(turnStatus(state).currentTurn).toBe(2)
    expect(playerOf(state).stats.trade).toBe(5)

    state = unwrap(unmarkPhaseDone(state, { playerId: CASH1981, turnNumber: 1, phase: 'RESEARCH' }))
    state = unwrap(unmarkPhaseDone(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT' }))

    expect(playerOf(state).stats.trade).toBe(5)
    expect(tradeTurn(state).tradeCollected).toBe(3)
  })

  it('uses the trade around the cities on the board', () => {
    const base = withTrade(cityScene(), 4)
    const city = cityProductionsOf(base, playerOf(base))[0]
    if (city === undefined) throw new Error('no city')
    expect(city.trade.outskirts).toBe(3)
  })
})
