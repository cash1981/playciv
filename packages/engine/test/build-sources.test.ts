/**
 * Build offers how to make up the production (#352): We Love the ... Day! cards from the hand and tech production
 * boosts, used together with the build. Each card or boost is an action record of its own, so an opponent can still
 * cancel it, and the undo of the build takes every one back. Specification: `docs/agents/decisions.md` ("Build: ways to pay").
 */

import { describe, expect, it } from 'vitest'

import { placePiece, setCityProductionOverride } from '../src/actions/board.js'
import { chooseTech, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { performAssistedAction, reverseAssistedAction, takeBackOpenBuild } from '../src/assisted.js'
import { SQUARE_SIZE, findBoardAsset, mapTop, slotOrigin } from '../src/board.js'
import type { BoardPiece } from '../src/board.js'
import { buildOptionsOf } from '../src/build-options.js'
import type { BuildChoice, CityBuildOptions } from '../src/build-options.js'
import { payOptionsFor } from '../src/build-sources.js'
import type { HammerSources } from '../src/build-sources.js'
import { applyCancellation } from '../src/cancellation.js'
import { cityProductionsOf } from '../src/city-production.js'
import { describeError } from '../src/errors.js'
import { itemName } from '../src/item.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { GameState } from '../src/state.js'

import { player as playerOf, withCardInHand, withHutInHand } from './assisted-fixture.js'
import { CASH1981 as A, CHUL, ITCHI, KARANDRAS1 as B, firstCivGame } from './fixture.js'

const AT = '2026-11-27T10:00:00.000Z'
const LIBRARY = 'buildings/library'
const DESPOT = 'We Love the Despot Day!'
const QUEEN = 'We Love the Queen Day!'
const PRESIDENT = 'We Love the President Day!'

function put(state: GameState, assetId: string, column: number, row: number): GameState {
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`no asset ${assetId}`)
  return unwrap(
    placePiece(state, {
      playerId: A,
      assetId,
      x: column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2,
      y: mapTop(state.board) + row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2,
      rotation: 0,
    }),
  )
}

const learn = (state: GameState, ...techs: readonly string[]): GameState =>
  techs.reduce((next, techName) => unwrap(revealTech(unwrap(chooseTech(next, { playerId: A, techName })), { playerId: A, techName })), state)

const cityOf = (state: GameState): BoardPiece => state.board.pieces.find((piece) => piece.category === 'city') as BoardPiece

/** Cash (Red, Monarchy) with a city on B2 of the America tile, City Management open, `techs` revealed, a production set by hand. */
function ready(techs: readonly string[], production: number, trade = 0): GameState {
  let state = firstCivGame()
  const colors: Record<string, string> = { [A]: 'Red', [B]: 'Blue', [ITCHI]: 'Green', [CHUL]: 'Yellow' }
  state = { ...state, players: state.players.map((p) => ({ ...p, color: colors[p.playerId] ?? p.color, government: p.playerId === A ? 'Monarchy' : p.government })) }
  const slot = state.board.slots[0]
  if (slot === undefined) throw new Error('no slot')
  const [x, y] = slotOrigin(state.board, slot)
  state = unwrap(placePiece(state, { playerId: A, assetId: 'tiles/america', x, y }))
  state = put(state, 'cities/redcity2', 1, 1)
  state = learn(state, ...techs)
  state = unwrap(markPhasesDone(state, { playerId: A, turnNumber: 1, upToPhase: 'TRADE' }))
  state = unwrap(setCityProductionOverride(state, { playerId: A, pieceId: cityOf(state).id, value: production }))
  return { ...state, players: state.players.map((p) => (p.playerId === A ? { ...p, stats: { ...p.stats, trade } } : p)) }
}

/** The scene with the cards in the hand, in order; the ids are returned by name. */
function withCards(state: GameState, ...names: readonly string[]): { state: GameState; ids: Record<string, string[]> } {
  let current = state
  const ids: Record<string, string[]> = {}
  for (const name of names) {
    const given = withCardInHand(current, name)
    current = given.state
    ids[name] = [...(ids[name] ?? []), given.itemId]
  }
  return { state: current, ids }
}

const cityOptions = (state: GameState, playerId = A): CityBuildOptions => buildOptionsOf(state, findPlayer(state, playerId)!)[0]!
const choiceOf = (state: GameState, assetId = LIBRARY): BuildChoice => {
  const found = cityOptions(state).choices.find((choice) => choice.assetId === assetId)
  if (found === undefined) throw new Error(`${assetId} is not offered`)
  return found
}
const optionIds = (state: GameState, assetId = LIBRARY): readonly string[] => choiceOf(state, assetId).payOptions.map((option) => option.id)

/** The Library's one grassland square (C2), whether or not the Library is offered now. */
const squareOf = (_state: GameState): { column: number; row: number } => ({ column: 2, row: 1 })

const tryBuild = (
  state: GameState,
  extra: { playCards?: readonly string[]; boosts?: readonly string[]; rush?: boolean; free?: boolean } = {},
  requestId = 'b1',
) =>
  performAssistedAction(state, {
    playerId: A,
    action: 'build',
    requestId,
    at: AT,
    payload: { cityPieceId: cityOf(state).id, item: { kind: 'building', assetId: LIBRARY }, target: squareOf(state), ...extra },
  })
const reason = (result: ReturnType<typeof tryBuild>): string => describeError(unwrapErr(result))
const trade = (state: GameState): number => playerOf(state, A).stats.trade
const libraries = (state: GameState): number => state.board.pieces.filter((piece) => piece.assetId === LIBRARY).length
const inHand = (state: GameState, itemId: string): boolean => playerOf(state, A).items.some((item) => item.id === itemId)
const status = (state: GameState, id: string): string | undefined => state.assistedActions.find((record) => record.id === id)?.status
const lineOf = (state: GameState, id: string): number => state.log.findIndex((entry) => entry.assistedActionId === id)

function undoByVote(state: GameState, requestId: string) {
  const logId = state.log.find((entry) => entry.assistedActionId === requestId)?.id ?? ''
  let next = unwrap(initiateUndo(state, { logId, playerId: A }))
  for (const playerId of [B, ITCHI]) next = unwrap(vote(next, { logId, playerId, vote: true, at: AT }))
  return vote(next, { logId, playerId: CHUL, vote: true, at: AT })
}

describe('the ways to pay', () => {
  const sources = (cards: readonly [string, number][], boosts: readonly [string, number][] = [], wheat = boosts.length): HammerSources => ({
    cards: cards.map(([name, hammers], index) => ({ itemId: `card-${index}`, name, hammers })),
    boosts: boosts.map(([tech, hammers]) => ({ tech, kind: 'animalHusbandry' as const, hammers })),
    wheat,
  })

  it('lists no card at all first when the trade covers the item, then only what makes a difference', () => {
    const options = payOptionsFor(5, 3, sources([['Despot', 4]]), 6, null)
    // 2 short is 6 trade: affordable alone; the card lowers it to nothing
    expect(options.map((option) => [option.id, option.tradeToPay])).toEqual([['none', 6], ['Despot', 0]])
  })

  it('leaves out a card that would add nothing and a pair where one is enough', () => {
    const options = payOptionsFor(5, 0, sources([['Despot', 4], ['Queen', 6], ['President', 8]]), 0, null)
    // Queen or President alone; the Despot is only needed with another card that is not enough alone
    expect(options.map((option) => option.id)).toEqual(['Queen', 'President'])
  })

  it('asks for both cards when one is not enough, and counts two of a kind as one option', () => {
    const two = payOptionsFor(5, 0, sources([['Despot', 4], ['Despot', 4]]), 0, null)
    expect(two.map((option) => option.id)).toEqual(['Despot + Despot'])
    expect(two[0]?.cards).toHaveLength(2)
    // A card that cannot be enough alone is still used when the trade can cover the rest
    const withTrade = payOptionsFor(5, 0, sources([['Despot', 4], ['Despot', 4]]), 3, null)
    expect(withTrade.map((option) => [option.id, option.tradeToPay])).toEqual([['Despot', 3], ['Despot + Despot', 0]])
  })

  it('offers nothing when the player cannot cover it even with everything', () => {
    expect(payOptionsFor(30, 0, sources([['Despot', 4]], [['Animal Husbandry', 3]]), 3, null)).toEqual([])
  })

  it('uses no more boosts than the Wheat there is for', () => {
    const one = payOptionsFor(5, 0, sources([], [['Animal Husbandry', 3], ['Construction', 5]], 1), 0, null)
    expect(one.map((option) => option.id)).toEqual(['Construction'])
    const two = payOptionsFor(8, 0, sources([], [['Animal Husbandry', 3], ['Construction', 5]], 2), 0, null)
    expect(two.map((option) => option.id)).toEqual(['Animal Husbandry + Construction'])
  })
})

describe('what Build offers', () => {
  it('moves an item that only a card makes affordable from unavailable to the choices', () => {
    const without = ready(['Writing'], 0, 0)
    expect(cityOptions(without).unavailable.some((entry) => entry.assetId === LIBRARY)).toBe(true)
    const { state, ids } = withCards(without, QUEEN, PRESIDENT, DESPOT)
    const choice = choiceOf(state)
    expect(choice.payOptions.map((option) => option.id)).toEqual([QUEEN, PRESIDENT])
    expect(choice.tradeToPay).toBe(0)
    expect(choice.payOptions[0]?.cards.map((card) => card.itemId)).toEqual(ids[QUEEN])
    expect(cityOptions(state).hammerSources.cards.map((card) => card.name).sort()).toEqual([DESPOT, PRESIDENT, QUEEN].sort())
  })

  it('keeps the plain option first when the production covers the item, and offers no card then', () => {
    const { state } = withCards(ready(['Writing'], 5, 0), DESPOT)
    expect(optionIds(state)).toEqual(['none'])
  })

  it('offers the trade and a card as two ways, the trade first', () => {
    const { state } = withCards(ready(['Writing'], 3, 6), DESPOT)
    expect(choiceOf(state).payOptions.map((option) => [option.id, option.tradeToPay])).toEqual([['none', 6], [DESPOT, 0]])
  })

  it('stays unavailable when nothing in the hand is enough', () => {
    const { state } = withCards(ready(['Writing'], 0, 0), DESPOT)
    expect(cityOptions(state).unavailable.some((entry) => entry.assetId === LIBRARY)).toBe(true)
    expect(cityOptions(state).unavailable.find((entry) => entry.assetId === LIBRARY)?.reason).toContain('also with the cards and tech boosts you could use')
  })

  it('does not count a card that is one of the cards still being chosen between', () => {
    const { state, ids } = withCards(ready(['Writing'], 0, 0), QUEEN)
    const waiting = {
      ...state,
      players: state.players.map((p) =>
        p.playerId === A
          ? { ...p, pendingRewards: [{ id: 'r1', kind: 'event' as const, level: 1 as const, step: 3, candidateIds: ids[QUEEN] ?? [], keep: 1 as const }] }
          : p,
      ),
    }
    expect(cityOptions(waiting).hammerSources.cards).toEqual([])
  })

  it('shows another player none of it, and names no card in the public log before it is played', () => {
    const { state } = withCards(ready(['Writing'], 0, 0), QUEEN)
    const json = JSON.stringify(toPlayerView(state, B))
    expect(json).not.toContain(QUEEN)
    expect(JSON.stringify(state.log.map((entry) => entry.publicLog))).not.toContain(QUEEN)
    expect(toPlayerView(state, A).you?.buildOptions?.[0]?.hammerSources.cards).toHaveLength(1)
  })
})

describe('building with a card', () => {
  it('plays only the card that is needed, as a record of its own before the build, and the build uses its hammers', () => {
    const { state, ids } = withCards(ready(['Writing'], 0, 0), DESPOT, QUEEN, PRESIDENT)
    const done = unwrap(tryBuild(state, { playCards: ids[QUEEN] ?? [] }))
    expect(libraries(done)).toBe(1)
    expect(inHand(done, ids[QUEEN]?.[0] ?? '')).toBe(false)
    expect(inHand(done, ids[DESPOT]?.[0] ?? '')).toBe(true)
    expect(inHand(done, ids[PRESIDENT]?.[0] ?? '')).toBe(true)
    expect(done.assistedActions.map((record) => [record.id, record.kind])).toEqual([['b1:c1', 'playCard'], ['b1', 'build']])
    expect(done.assistedActions[1]?.effect).toMatchObject({ embedded: ['b1:c1'], trade: 0 })
    // The card's own public line comes first and is tagged with its own record; the build's follows
    expect(lineOf(done, 'b1:c1')).toBeGreaterThanOrEqual(0)
    expect(lineOf(done, 'b1:c1')).toBeLessThan(lineOf(done, 'b1'))
    expect(done.log[lineOf(done, 'b1:c1')]?.publicLog).toContain(`played ${QUEEN}`)
    // The hammers are the city's for the rest of the turn, as for a card played by hand
    expect(cityProductionsOf(done, playerOf(done, A))[0]?.boost).toBe(6)
    // Every record shares the revision before the step, so one saved game is the baseline of all of them
    expect(new Set(done.assistedActions.map((record) => record.beforeRevision)).size).toBe(1)
  })

  it('refuses the build without the card when only the card makes it affordable, and says what to play', () => {
    const { state, ids } = withCards(ready(['Writing'], 0, 0), QUEEN)
    const text = reason(tryBuild(state))
    expect(text).toContain('your trade cannot cover the rest')
    expect(text).toContain(`Play with the build: ${QUEEN}`)
    expect(libraries(state)).toBe(0)
    expect(inHand(state, ids[QUEEN]?.[0] ?? '')).toBe(true)
  })

  it('pays only the trade the card leaves', () => {
    const { state, ids } = withCards(ready(['Writing'], 3, 6), DESPOT)
    expect(reason(tryBuild(state, { playCards: [] }))).toContain('Confirm paying 6 trade')
    const withCard = unwrap(tryBuild(state, { playCards: ids[DESPOT] ?? [] }))
    expect(trade(withCard)).toBe(6)
    const withTrade = unwrap(tryBuild(state, { rush: true }))
    expect(trade(withTrade)).toBe(0)
    expect(inHand(withTrade, ids[DESPOT]?.[0] ?? '')).toBe(true)
  })

  it('plays two cards when two are needed', () => {
    const { state, ids } = withCards(ready(['Writing'], 0, 0), DESPOT, DESPOT)
    expect(optionIds(state)).toEqual([`${DESPOT} + ${DESPOT}`])
    expect(reason(tryBuild(state, { playCards: [ids[DESPOT]?.[0] ?? ''] }))).toContain('Even with 4 more hammers')
    const done = unwrap(tryBuild(state, { playCards: ids[DESPOT] ?? [] }))
    expect(done.assistedActions.map((record) => record.id)).toEqual(['b1:c1', 'b1:c2', 'b1'])
    expect(cityProductionsOf(done, playerOf(done, A))[0]?.boost).toBe(8)
  })

  it('refuses a card that is not needed, nothing played', () => {
    const { state, ids } = withCards(ready(['Writing'], 0, 0), DESPOT, QUEEN)
    const before = JSON.stringify(state)
    expect(reason(tryBuild(state, { playCards: [...(ids[QUEEN] ?? []), ...(ids[DESPOT] ?? [])] }))).toContain('is not needed')
    expect(JSON.stringify(state)).toBe(before)
    expect(inHand(state, ids[QUEEN]?.[0] ?? '')).toBe(true)
  })

  it('refuses ids that are not We Love cards of the own hand, and a card named twice', () => {
    const { state, ids } = withCards(ready(['Writing'], 0, 0), QUEEN)
    const other = withCardInHand(state, QUEEN, B)
    expect(reason(tryBuild(other.state, { playCards: [other.itemId] }))).toContain('Choose only We Love cards from your own hand')
    const supply = withCardInHand(other.state, 'Supply Drop')
    expect(reason(tryBuild(supply.state, { playCards: [supply.itemId] }))).toContain('Choose only We Love cards from your own hand')
    expect(reason(tryBuild(state, { playCards: ['nope'] }))).toContain('Choose only We Love cards')
    expect(reason(tryBuild(state, { playCards: [...(ids[QUEEN] ?? []), ...(ids[QUEEN] ?? [])] }))).toContain('each card and each tech boost once')
  })

  it('refuses cards with a free build', () => {
    const { state, ids } = withCards(ready(['Writing'], 0, 0), QUEEN)
    expect(reason(tryBuild(state, { playCards: ids[QUEEN] ?? [], free: true }))).toContain('free build uses no cards')
  })

  it('refuses cards for the second build of Engineering, and takes them with the first build', () => {
    const base = ready(['Engineering', 'Writing', 'Currency'], 0, 0)
    const { state, ids } = withCards(base, QUEEN, QUEEN)
    // The first build may use a card; the leftover production then goes to the second
    const first = unwrap(tryBuild(state, { playCards: ids[QUEEN]?.slice(0, 1) ?? [] }))
    expect(first.assistedActions.at(-1)?.effect).toMatchObject({ production: 6, embedded: ['b1:c1'] })
    const market = cityOptions(first)
    expect(market.engineering).toEqual({ firstCost: 5, fullProduction: 6 })
    expect(market.hammerSources.cards).toEqual([])
    const second = performAssistedAction(first, {
      playerId: A,
      action: 'build',
      requestId: 'b2',
      at: AT,
      payload: { cityPieceId: cityOf(first).id, item: { kind: 'building', assetId: 'buildings/market' }, target: { column: 2, row: 1 }, playCards: ids[QUEEN]?.slice(1) ?? [] },
    })
    expect(describeError(unwrapErr(second))).toContain('second build of Engineering')
  })

  it('does not change the game it was given', () => {
    const { state, ids } = withCards(ready(['Writing'], 0, 0), QUEEN)
    const before = JSON.stringify(state)
    unwrap(tryBuild(state, { playCards: ids[QUEEN] ?? [] }))
    expect(JSON.stringify(state)).toBe(before)
  })

  it('is the same call twice with one request id', () => {
    const { state, ids } = withCards(ready(['Writing'], 0, 0), QUEEN)
    const once = unwrap(tryBuild(state, { playCards: ids[QUEEN] ?? [] }))
    expect(unwrap(tryBuild(once, { playCards: ids[QUEEN] ?? [] }))).toBe(once)
  })
})

describe('building with a tech boost', () => {
  const boosted = (production: number, trade = 0) => {
    const withWheat = withHutInHand(ready(['Writing', 'Animal Husbandry'], production, trade), 'Wheat')
    return withWheat.state
  }

  it('uses the boost with its Wheat as a record of its own, and offers it as a way to pay', () => {
    const state = boosted(3)
    expect(cityOptions(state).hammerSources.boosts.map((boost) => boost.tech)).toEqual(['Animal Husbandry'])
    expect(optionIds(state)).toEqual(['Animal Husbandry'])
    const done = unwrap(tryBuild(state, { boosts: ['Animal Husbandry'] }))
    expect(libraries(done)).toBe(1)
    expect(done.assistedActions.map((record) => [record.id, record.kind])).toEqual([['b1:b1', 'animalHusbandry'], ['b1', 'build']])
    expect(done.assistedActions[0]?.usageKey).toBe('card:Animal Husbandry')
    expect(done.assistedActions[1]?.effect).toMatchObject({ embedded: ['b1:b1'] })
    // The Wheat is spent and the tech counts as used this turn
    expect(done.discardedItems.some((item) => item.kind === 'hut' && item.name === 'Wheat')).toBe(true)
    expect(playerOf(done, A).playerTurns.some((turn) => turn.usedActions.includes('card:Animal Husbandry'))).toBe(true)
  })

  it('offers no boost once it has been used this turn, or without a Wheat', () => {
    const used = unwrap(tryBuild(boosted(3), { boosts: ['Animal Husbandry'] }))
    expect(cityOptions(used).hammerSources.boosts).toEqual([])
    // A second Wheat does not bring it back: it is once per turn
    expect(cityOptions(withHutInHand(used, 'Wheat').state).hammerSources.boosts).toEqual([])
    expect(cityOptions(ready(['Writing', 'Animal Husbandry'], 3)).hammerSources.boosts).toEqual([])
    // Without a Wheat the item is not offered at all, and the build says why
    expect(reason(tryBuild(ready(['Writing', 'Animal Husbandry'], 3), { boosts: ['Animal Husbandry'] }))).toContain('cannot be built')
    // A tech that is not revealed gives nothing
    expect(reason(tryBuild(boosted(3), { boosts: ['Banking'] }))).toContain('Banking cannot give production now')
  })

  it('combines a card and a boost when both are needed', () => {
    const { state, ids } = withCards(boosted(0), DESPOT)
    // 5 needed: the Despot's 4 and the boost's 3 together, neither alone
    expect(optionIds(state)).toEqual([`${DESPOT} + Animal Husbandry`])
    const done = unwrap(tryBuild(state, { playCards: ids[DESPOT] ?? [], boosts: ['Animal Husbandry'] }))
    expect(done.assistedActions.map((record) => record.id)).toEqual(['b1:c1', 'b1:b1', 'b1'])
  })
})

describe('taking it back', () => {
  it('returns the cards, the Wheat and the trade with the vote on the build, and the board is as before', () => {
    const base = withHutInHand(withCards(ready(['Writing', 'Animal Husbandry'], 0, 3), DESPOT).state, 'Wheat').state
    const dealt = playerOf(base, A).items.find((item) => itemName(item) === DESPOT)?.id ?? ''
    const done = unwrap(tryBuild(base, { playCards: [dealt], boosts: ['Animal Husbandry'] }))
    expect(libraries(done)).toBe(1)
    const undone = unwrap(undoByVote(done, 'b1'))
    expect(libraries(undone)).toBe(0)
    expect(inHand(undone, dealt)).toBe(true)
    expect(undone.discardedItems.some((item) => item.id === dealt)).toBe(false)
    expect(playerOf(undone, A).items.some((item) => item.kind === 'hut' && item.name === 'Wheat')).toBe(true)
    expect(trade(undone)).toBe(3)
    expect(cityProductionsOf(undone, playerOf(undone, A))[0]?.boost).toBe(0)
    expect(['b1', 'b1:c1', 'b1:b1'].map((id) => status(undone, id))).toEqual(['undone', 'undone', 'undone'])
    expect(playerOf(undone, A).playerTurns.some((turn) => turn.usedActions.includes('card:Animal Husbandry'))).toBe(false)
    expect(undone.board.pieces.map((piece) => piece.id)).toEqual(base.board.pieces.map((piece) => piece.id))
  })

  it('takes the cards back too when the player removes the built piece before End turn', () => {
    const { state, ids } = withCards(ready(['Writing'], 0, 0), QUEEN)
    const done = unwrap(tryBuild(state, { playCards: ids[QUEEN] ?? [] }))
    const library = done.board.pieces.find((piece) => piece.assetId === LIBRARY)
    const taken = takeBackOpenBuild(done, { playerId: A, pieceId: library?.id ?? '', at: AT })
    const back = unwrap(taken ?? (() => { throw new Error('not taken back') })() as never)
    expect(libraries(back)).toBe(0)
    expect(inHand(back, ids[QUEEN]?.[0] ?? '')).toBe(true)
    expect(status(back, 'b1:c1')).toBe('undone')
  })

  it('refuses a build whose derived request id already names another record, before anything is played', () => {
    const { state, ids } = withCards(ready(['Writing'], 0, 0), QUEEN, QUEEN)
    // The player played a card as b1:c1 in an earlier action; a build sent as b1 must not take it for its own
    const earlier = unwrap(performAssistedAction(state, { playerId: A, action: 'playCard', requestId: 'b1:c1', at: AT, payload: { itemId: ids[QUEEN]?.[1] ?? '', targets: [], hammerCityId: cityOf(state).id } }))
    const before = JSON.stringify(earlier)
    expect(reason(tryBuild(earlier, { playCards: ids[QUEEN]?.slice(0, 1) ?? [] }))).toContain('already used for another action')
    expect(JSON.stringify(earlier)).toBe(before)
    expect(libraries(earlier)).toBe(0)
  })

  it('keeps the ids of the records within 64 characters, also for the longest request id', () => {
    const { state, ids } = withCards(ready(['Writing'], 0, 0), QUEEN)
    const long = 'x'.repeat(64)
    const done = unwrap(tryBuild(state, { playCards: ids[QUEEN] ?? [] }, long))
    const embedded = done.assistedActions.map((record) => record.id)
    expect(embedded).toHaveLength(2)
    expect(embedded.every((id) => id.length <= 64)).toBe(true)
    expect(done.assistedActions.at(-1)?.id).toBe(long)
  })

  it('refuses the vote on the card alone, which would leave the build paid for hammers it no longer has', () => {
    const { state, ids } = withCards(ready(['Writing'], 0, 0), QUEEN)
    const done = unwrap(tryBuild(state, { playCards: ids[QUEEN] ?? [] }))
    const result = reverseAssistedAction(done, 'b1:c1', AT)
    expect(describeError(unwrapErr(result))).toContain('Undo the build instead')
    const logId = done.log.find((entry) => entry.assistedActionId === 'b1:c1')?.id ?? ''
    let next = unwrap(initiateUndo(done, { logId, playerId: A }))
    next = unwrap(vote(next, { logId, playerId: B, vote: true, at: AT }))
    next = unwrap(vote(next, { logId, playerId: ITCHI, vote: true, at: AT }))
    expect(vote(next, { logId, playerId: CHUL, vote: true, at: AT }).ok).toBe(false)
    expect(libraries(done)).toBe(1)
  })

  it('refuses before changing anything when a card has left the discard pile', () => {
    const { state, ids } = withCards(ready(['Writing'], 0, 0), QUEEN)
    const done = unwrap(tryBuild(state, { playCards: ids[QUEEN] ?? [] }))
    const lost = { ...done, discardedItems: done.discardedItems.filter((item) => item.id !== ids[QUEEN]?.[0]) }
    const before = JSON.stringify(lost)
    expect(reverseAssistedAction(lost, 'b1', AT).ok).toBe(false)
    expect(JSON.stringify(lost)).toBe(before)
    expect(libraries(lost)).toBe(1)
  })
})

describe('an opponent cancels the card played with a build', () => {
  it('rewinds the build with it, spends the cancelled card and keeps the other', () => {
    const joust = withCardInHand(ready(['Writing'], 0, 0), 'Jousting Tourney', B)
    const { state, ids } = withCards(joust.state, DESPOT, DESPOT)
    const baseline = state
    const done = unwrap(tryBuild(baseline, { playCards: ids[DESPOT] ?? [] }))
    expect(done.assistedActions.map((record) => record.id)).toEqual(['b1:c1', 'b1:c2', 'b1'])
    expect(libraries(done)).toBe(1)
    const logId = done.assistedActions.find((record) => record.id === 'b1:c2')?.logId ?? ''
    const cancelled = unwrap(applyCancellation(done, { playerId: B, requestId: 'cancel', command: { logId, itemId: joust.itemId } }, baseline))
    // The build is rewound with the card: no Library, no hammers
    expect(libraries(cancelled)).toBe(0)
    expect(cityProductionsOf(cancelled, playerOf(cancelled, A))[0]?.boost).toBe(0)
    expect(status(cancelled, 'b1:c2')).toBe('cancelled')
    expect(['b1:c1', 'b1']
      .map((id) => status(cancelled, id))).toEqual(['superseded', 'superseded'])
    // The cancelled card is spent, the other one is back in the hand
    expect(cancelled.discardedItems.some((item) => item.id === ids[DESPOT]?.[1])).toBe(true)
    expect(inHand(cancelled, ids[DESPOT]?.[0] ?? '')).toBe(true)
  })

  it('rewinds the same way when the first card is the one cancelled', () => {
    const joust = withCardInHand(ready(['Writing'], 0, 0), 'Jousting Tourney', B)
    const { state, ids } = withCards(joust.state, DESPOT, DESPOT)
    const done = unwrap(tryBuild(state, { playCards: ids[DESPOT] ?? [] }))
    const logId = done.assistedActions[0]?.logId ?? ''
    const cancelled = unwrap(applyCancellation(done, { playerId: B, requestId: 'cancel', command: { logId, itemId: joust.itemId } }, state))
    expect(libraries(cancelled)).toBe(0)
    expect(status(cancelled, 'b1:c1')).toBe('cancelled')
    expect(trade(cancelled)).toBe(0)
  })
})
