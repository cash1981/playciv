/**
 * The Arabs gain culture for every resource they spend (civilization card; the human chose 1 per resource, the value of
 * FAQ 2.0 "Advanced Arabia", where the printed card says 2). Every spend goes through `spendResource`, so one spend is
 * counted once however it was reached, and the undo takes back what is still there.
 */

import { describe, expect, it } from 'vitest'

import { placePiece } from '../src/actions/board.js'
import { chooseTech, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { performAssistedAction } from '../src/assisted.js'
import {
  ARAB_RESOURCE_CULTURE,
  returnResource,
  returnResources,
  spendAnyResources,
  spendChosenResources,
  spendEachResource,
  spendResource,
} from '../src/assisted-resources.js'
import { mapTop, slotOrigin, SQUARE_SIZE } from '../src/board.js'
import { applyCancellation } from '../src/cancellation.js'
import { toPlayerView } from '../src/state.js'
import { unwrap } from '../src/result.js'
import type { GameState } from '../src/state.js'

import { player, withCardInHand, withHutInHand, withPieceInArea } from './assisted-fixture.js'
import { withCivilization, withStats } from './culture-advance-fixture.js'
import { CASH1981 as A, CHUL as D, ITCHI as C, KARANDRAS1 as B, firstCivGame } from './fixture.js'

const AT = '2026-11-20T12:00:00.000Z'
const culture = (state: GameState, playerId = A): number => player(state, playerId).stats.culture
const lines = (state: GameState): string[] => state.log.map((entry) => entry.publicLog)
const arabs = (): GameState => withStats(withCivilization(firstCivGame(), 'Arabs'), { culture: 10 })
const withTech = (state: GameState, techName: string, playerId = A): GameState =>
  unwrap(revealTech(unwrap(chooseTech(state, { playerId, techName })), { playerId, techName }))

function undoByVote(state: GameState, requestId: string): GameState {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line for the action')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: A }))
  for (const playerId of [B, C, D]) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  return next
}

describe('the value', () => {
  it('is 1 per resource, the value the human chose (FAQ 2.0), not the 2 the card prints', () => {
    expect(ARAB_RESOURCE_CULTURE).toBe(1)
  })
})

describe('spending one resource', () => {
  it('gives an Arab 1 culture with a public line carrying the amount and the new total, from a hut in the hand', () => {
    const { state } = withHutInHand(arabs(), 'Iron')
    const spent = unwrap(spendResource(state, A, 'Iron'))
    expect(culture(spent.state)).toBe(11)
    expect(lines(spent.state).at(-1)).toBe('cash1981 gained 1 (11) culture for spending Iron as the Arabs')
    expect(spent.spent.arabCulture).toBe(1)
  })

  it('counts a piece in the area and a culture card played as the resource too', () => {
    const piece = withPieceInArea(arabs(), 'resources/silk').state
    expect(culture(unwrap(spendResource(piece, A, 'Silk')).state)).toBe(11)
    const card = withCardInHand(arabs(), 'A Generous Gift').state
    const spent = unwrap(spendResource(card, A, 'Iron'))
    expect(spent.spent.kind).toBe('card')
    expect(culture(spent.state)).toBe(11)
  })

  it('gives nothing to another civilization, and nothing for a spend that is refused', () => {
    const { state } = withHutInHand(withStats(withCivilization(firstCivGame(), 'Romans'), { culture: 10 }), 'Iron')
    const spent = unwrap(spendResource(state, A, 'Iron'))
    expect(culture(spent.state)).toBe(10)
    expect(spent.spent.arabCulture).toBeUndefined()
    expect(spendResource(arabs(), A, 'Iron').ok).toBe(false)
  })
})

describe('spending several resources', () => {
  const twoHuts = (): GameState => withHutInHand(withHutInHand(arabs(), 'Iron').state, 'Wheat').state

  it('gives 1 culture for each of an Any cost, one line each, with the running total', () => {
    const paid = unwrap(spendAnyResources(twoHuts(), A, ['Iron', 'Wheat']))
    expect(culture(paid.state)).toBe(12)
    expect(lines(paid.state).filter((line) => line.includes('as the Arabs'))).toEqual([
      'cash1981 gained 1 (11) culture for spending Iron as the Arabs',
      'cash1981 gained 1 (12) culture for spending Wheat as the Arabs',
    ])
  })

  it('gives 1 culture for each kind of one-of-each, and for chosen payments', () => {
    const four = ['Incense', 'Iron', 'Silk', 'Wheat'].reduce((next, name) => withHutInHand(next, name).state, arabs())
    expect(culture(unwrap(spendEachResource(four, A, ['Incense', 'Iron', 'Silk', 'Wheat'])).state)).toBe(14)

    const state = twoHuts()
    const holdings = player(state).items.filter((item) => item.kind === 'hut')
    const choices = holdings.map((item) => ({ resource: item.name, kind: 'hut' as const, id: item.id }))
    const chosen = unwrap(spendChosenResources(state, A, choices.map((choice) => choice.resource), choices))
    expect(culture(chosen.state)).toBe(12)
  })

  it('takes everything back with the resources, last paid first', () => {
    const state = twoHuts()
    const paid = unwrap(spendAnyResources(state, A, ['Iron', 'Wheat']))
    const back = unwrap(returnResources(paid.state, player(paid.state), paid.spent, null))
    expect(culture(back)).toBe(10)
    expect(lines(back).slice(-2)).toEqual([
      'cash1981 took back 1 (11) culture gained for spending Wheat as the Arabs',
      'cash1981 took back 1 (10) culture gained for spending Iron as the Arabs',
    ])
  })
})

describe('returning a resource', () => {
  it('takes back as much as is still there, clamped at 0, and the line says how much', () => {
    const { state } = withHutInHand(arabs(), 'Iron')
    const spent = unwrap(spendResource(state, A, 'Iron'))
    const spentAway = withStats(spent.state, { culture: 0 })
    const back = unwrap(returnResource(spentAway, player(spentAway), spent.spent, null))
    expect(culture(back)).toBe(0)
    expect(lines(back).at(-1)).toBe('cash1981 took back 0 of 1 (0) culture gained for spending Iron as the Arabs (the rest is spent)')
    // A resource that gave nothing writes no such line
    const plain = withHutInHand(withCivilization(firstCivGame(), 'Romans'), 'Iron').state
    const plainSpent = unwrap(spendResource(plain, A, 'Iron'))
    const plainBack = unwrap(returnResource(plainSpent.state, player(plainSpent.state), plainSpent.spent, null))
    expect(lines(plainBack).some((line) => line.includes('as the Arabs'))).toBe(false)
  })
})

describe('through the assisted actions', () => {
  /** City Management open for an Arab with Pottery, an Iron and a Wheat hut. */
  const potteryTurn = (): GameState => {
    const huts = withHutInHand(withHutInHand(withTech(arabs(), 'Pottery'), 'Iron').state, 'Wheat').state
    return unwrap(markPhasesDone(huts, { playerId: A, turnNumber: 1, upToPhase: 'TRADE' }))
  }

  it('gives culture for the resources an ability spends, and the undo vote takes it back', () => {
    const start = potteryTurn()
    const used = unwrap(performAssistedAction(start, { playerId: A, action: 'pottery', requestId: 'req-1', at: AT, payload: { resources: ['Iron', 'Wheat'] } }))
    expect(culture(used)).toBe(12)
    // The action's own line is still the last line, so the undo vote finds it
    expect(used.log.at(-1)?.assistedActionId).toBe('req-1')
    const undone = undoByVote(used, 'req-1')
    expect(culture(undone)).toBe(10)
    expect(player(undone).stats.coinSources.pottery).toBe(0)
  })

  it('keeps the culture an earlier gain left when the undo comes after culture was spent', () => {
    const used = unwrap(performAssistedAction(potteryTurn(), { playerId: A, action: 'pottery', requestId: 'req-1', at: AT, payload: { resources: ['Iron', 'Wheat'] } }))
    const spentSince = withStats(used, { culture: 1 })
    const undone = undoByVote(spentSince, 'req-1')
    expect(culture(undone)).toBe(0)
    expect(lines(undone).some((line) => line.includes('took back 1 of 1') || line.includes('took back 0 of 1'))).toBe(true)
  })

  it('works for a single resource of a Start of Turn ability (Ecology)', () => {
    const turn = withHutInHand(withTech(arabs(), 'Ecology'), 'Wheat').state
    const used = unwrap(performAssistedAction(turn, { playerId: A, action: 'sot:ecology', requestId: 'req-1', at: AT }))
    expect(culture(used)).toBe(11)
    expect(culture(undoByVote(used, 'req-1'))).toBe(10)
  })

  it('does not leak anything private: the line names the kind, never the card', () => {
    const { state } = withHutInHand(arabs(), 'Iron')
    const spent = unwrap(spendResource(state, A, 'Iron'))
    const hut = player(state).items.find((item) => item.kind === 'hut')
    expect(JSON.stringify(toPlayerView(spent.state, B))).not.toContain(hut?.id ?? 'x')
  })
})

describe('in a cancellation', () => {
  const scene = (): GameState => {
    let state = firstCivGame()
    state = { ...state, players: state.players.map((p) => ({ ...p, color: p.playerId === A ? 'Red' : p.playerId === B ? 'Blue' : 'Green' })) }
    const slot = state.board.slots[0]
    if (slot === undefined) throw new Error('no slot')
    const [x, y] = slotOrigin(state.board, slot)
    state = unwrap(placePiece(state, { playerId: A, assetId: 'tiles/america', x, y }))
    state = unwrap(placePiece(state, { playerId: A, assetId: 'cities/redcapital2', x: SQUARE_SIZE + 4, y: mapTop(state.board) + SQUARE_SIZE + 4 }))
    return unwrap(markPhasesDone(state, { playerId: A, turnNumber: 1, upToPhase: 'TRADE' }))
  }

  it('gives the Arab who cancels with a Spy the culture for it', () => {
    const base = withStats(withCivilization(scene(), 'Arabs', B), { culture: 10 }, B)
    const cityId = base.board.pieces.at(-1)?.id ?? ''
    const writing = withHutInHand(withTech(base, 'Writing', B), 'Spy', B)
    const current = unwrap(performAssistedAction(writing.state, { playerId: A, action: 'devoteToTheArts', requestId: 'target', payload: { cityPieceId: cityId } }))
    const logId = current.assistedActions.find((record) => record.id === 'target')?.logId ?? ''
    const done = unwrap(applyCancellation(current, { playerId: B, requestId: 'w1', command: { logId, tech: 'Writing', payment: { resource: 'Spy', kind: 'hut', id: writing.hutId } } }, writing.state))
    expect(culture(done, B)).toBe(11)
    expect(lines(done).some((line) => line === 'Karandras1 gained 1 (11) culture for spending Spy as the Arabs')).toBe(true)
  })

  it('counts the resources of a cancelled ability once: what it cost stays spent, and so does the culture', () => {
    const base = withTech(withStats(withCivilization(scene(), 'Arabs'), { culture: 10 }), 'Pottery')
    const huts = withHutInHand(withHutInHand(base, 'Iron').state, 'Wheat').state
    const mass = withHutInHand(withTech(huts, 'Mass Media', B), 'Spy', B)
    const before = unwrap(performAssistedAction(mass.state, { playerId: A, action: 'pottery', requestId: 'target', at: AT, payload: { resources: ['Iron', 'Wheat'] } }))
    expect(culture(before)).toBe(12)
    const logId = before.assistedActions.find((record) => record.id === 'target')?.logId ?? ''
    const done = unwrap(applyCancellation(before, { playerId: B, requestId: 'm1', command: { logId, tech: 'Mass Media', payment: { resource: 'Spy', kind: 'hut', id: mass.hutId } } }, mass.state))
    expect(culture(done)).toBe(12)
    expect(player(done).stats.coinSources.pottery).toBe(0)
  })
})
