/**
 * Issue #352, slice 1: We Love the ... Day! (extra hammers for one city) and the Start of Turn half of Supply Drop (7 trade).
 * Specification: `docs/agents/decisions.md` ("Playing a card is a log line").
 */

import { describe, expect, it } from 'vitest'

import { placePiece } from '../src/actions/board.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { performAssistedAction } from '../src/assisted.js'
import { playableCardsOf } from '../src/assisted-cards.js'
import { SQUARE_SIZE, findBoardAsset, mapTop } from '../src/board.js'
import { cityProductionsOf } from '../src/city-production.js'
import { tradeCeilingOf } from '../src/limits.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'

import { player, startOfTurn, withCardInHand } from './assisted-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-11-25T12:00:00.000Z'

const put = (state: GameState, assetId: string, column: number, row: number): GameState => {
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`no asset ${assetId}`)
  return unwrap(
    placePiece(state, {
      playerId: CASH1981,
      assetId,
      x: column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2,
      y: mapTop(state.board) + row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2,
    }),
  )
}

const withCities = (): GameState => {
  const colours: Record<string, string> = { [CASH1981]: 'Red', [KARANDRAS1]: 'Blue', [ITCHI]: 'Green', [CHUL]: 'Yellow' }
  const base = firstCivGame()
  const state = { ...base, players: base.players.map((p) => ({ ...p, color: colours[p.playerId] ?? p.color })) }
  return put(put(state, 'cities/redcapital2', 3, 3), 'cities/redcity2', 9, 9)
}

const inCityManagement = (state: GameState): GameState =>
  unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))

const play = (state: GameState, requestId: string, itemId: string, extra: Record<string, unknown> = {}) =>
  performAssistedAction(state, { playerId: CASH1981, action: 'playCard', requestId, at: AT, payload: { itemId, targets: [], ...extra } as never })

const cardOf = (state: GameState, name: string) => {
  const found = playableCardsOf(state, player(state)).find((card) => card.name === name)
  if (found === undefined) throw new Error(`${name} is not playable`)
  return found
}

const undo = (state: GameState, requestId: string) => {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of [KARANDRAS1, ITCHI, CHUL]) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  return next
}

describe.each([
  ['We Love the Despot Day!', 4],
  ['We Love the Queen Day!', 6],
  ['We Love the President Day!', 8],
] as const)('%s', (name, hammers) => {
  const scene = () => {
    const held = withCardInHand(inCityManagement(withCities()), name)
    const cities = cardOf(held.state, name).cities ?? []
    return { ...held, cities }
  }
  const boostOf = (state: GameState, pieceId: string) => cityProductionsOf(state, player(state)).find((entry) => entry.pieceId === pieceId)?.boost

  it('lists the viewer\'s own cities to choose from', () => {
    expect(scene().cities).toHaveLength(2)
  })

  it(`gives the chosen city ${hammers} extra hammers and no other`, () => {
    const { state, itemId, cities } = scene()
    const [first, second] = cities
    if (first === undefined || second === undefined) throw new Error('two cities expected')
    const done = unwrap(play(state, 'r1', itemId, { hammerCityId: first.cityPieceId }))
    expect(boostOf(done, first.cityPieceId)).toBe(hammers)
    expect(boostOf(done, second.cityPieceId)).toBe(0)
    expect(done.log.at(-1)?.publicLog).toContain(`${first.cityLabel} produces ${hammers} extra hammers this turn`)
  })

  it('refuses to play without a city, or with one that is not the player\'s, and keeps the card', () => {
    const { state, itemId } = scene()
    expect(unwrapErr(play(state, 'r2', itemId)).kind).toBe('ASSISTED_ACTION_REJECTED')
    expect(unwrapErr(play(state, 'r3', itemId, { hammerCityId: 'nope' })).kind).toBe('ASSISTED_ACTION_REJECTED')
    expect(player(state).items.some((item) => item.id === itemId)).toBe(true)
  })

  it('is taken back by an undo: the hammers go and the card returns', () => {
    const { state, itemId, cities } = scene()
    const first = cities[0]
    if (first === undefined) throw new Error('a city expected')
    const done = unwrap(play(state, 'r4', itemId, { hammerCityId: first.cityPieceId }))
    const back = undo(done, 'r4')
    expect(boostOf(back, first.cityPieceId)).toBe(0)
    expect(player(back).items.some((item) => item.id === itemId)).toBe(true)
  })
})

describe('Supply Drop, Start of Turn half', () => {
  it('gains 7 trade when played in Start of Turn, and an undo takes it back', () => {
    const { state, itemId } = withCardInHand(startOfTurn(), 'Supply Drop')
    const before = player(state).stats.trade
    const done = unwrap(play(state, 's1', itemId))
    expect(player(done).stats.trade).toBe(before + 7)
    expect(done.log.at(-1)?.publicLog).toContain(`gaining 7 (${before + 7}) trade`)
    expect(player(undo(done, 's1')).stats.trade).toBe(before)
  })

  it('stops at the trade ceiling', () => {
    const { state, itemId } = withCardInHand(startOfTurn(), 'Supply Drop')
    const ceiling = tradeCeilingOf(player(state).civilization?.name)
    const nearly: GameState = {
      ...state,
      players: state.players.map((p) => (p.playerId === CASH1981 ? { ...p, stats: { ...p.stats, trade: ceiling - 3 } } : p)),
    }
    expect(player(unwrap(play(nearly, 's2', itemId))).stats.trade).toBe(ceiling)
  })

  it('gains no trade in City Management, where it is the extra city action', () => {
    const { state, itemId } = withCardInHand(inCityManagement(startOfTurn()), 'Supply Drop')
    const before = player(state).stats.trade
    expect(player(unwrap(play(state, 's3', itemId))).stats.trade).toBe(before)
  })
})
