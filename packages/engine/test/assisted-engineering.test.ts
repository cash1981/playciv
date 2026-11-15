/**
 * Engineering (issue #354): "Once per turn, when spending production from a city, you may split the production to
 * purchase two items instead of only one." The player does two ordinary builds in one city; the second takes what the
 * first left of the production, asks no "already acted" question and writes the `card:Engineering` usage key.
 * Specification: `docs/agents/decisions.md` ("Engineering").
 */

import { describe, expect, it } from 'vitest'

import { placePiece, setCityProductionOverride } from '../src/actions/board.js'
import { chooseTech, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { performAssistedAction, takeBackOpenBuild } from '../src/assisted.js'
import { LOVELACE_NAME, SUPPLY_DROP_NAME, cityActionsTakenThisTurn } from '../src/assisted-core.js'
import { CARAVAN_ASSET_ID } from '../src/disband.js'
import { SQUARE_SIZE, findBoardAsset, mapTop, slotOrigin } from '../src/board.js'
import type { BoardPiece } from '../src/board.js'
import { buildOptionsOf } from '../src/build-options.js'
import type { CityBuildOptions } from '../src/build-options.js'
import { applyCancellation } from '../src/cancellation.js'
import { describeError } from '../src/errors.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { findPlayer } from '../src/state.js'
import type { AssistedActionRecord, GameState } from '../src/state.js'

import { player as playerOf, withHutInHand } from './assisted-fixture.js'
import { CASH1981 as A, CHUL, ITCHI, KARANDRAS1 as B, firstCivGame } from './fixture.js'

const AT = '2026-10-09T10:00:00.000Z'
const KEY = 'card:Engineering'

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

const learn = (state: GameState, playerId: string, ...techs: readonly string[]): GameState =>
  techs.reduce((next, techName) => unwrap(revealTech(unwrap(chooseTech(next, { playerId, techName })), { playerId, techName })), state)

const cityOf = (state: GameState): BoardPiece => state.board.pieces.find((piece) => piece.category === 'city') as BoardPiece

/** Cash (Red, Monarchy) with a city on B2 of the America tile, City Management open, `techs` revealed, a production set by hand. */
function ready(techs: readonly string[], production: number, trade = 0, cityAsset = 'cities/redcity2'): GameState {
  let state = firstCivGame()
  const colors: Record<string, string> = { [A]: 'Red', [B]: 'Blue', [ITCHI]: 'Green', [CHUL]: 'Yellow' }
  state = { ...state, players: state.players.map((p) => ({ ...p, color: colors[p.playerId] ?? p.color, government: p.playerId === A ? 'Monarchy' : p.government })) }
  const slot = state.board.slots[0]
  if (slot === undefined) throw new Error('no slot')
  const [x, y] = slotOrigin(state.board, slot)
  state = unwrap(placePiece(state, { playerId: A, assetId: 'tiles/america', x, y }))
  state = put(state, cityAsset, 1, 1)
  state = learn(state, A, ...techs)
  state = unwrap(markPhasesDone(state, { playerId: A, turnNumber: 1, upToPhase: 'TRADE' }))
  state = unwrap(setCityProductionOverride(state, { playerId: A, pieceId: cityOf(state).id, value: production }))
  return { ...state, players: state.players.map((p) => (p.playerId === A ? { ...p, stats: { ...p.stats, trade } } : p)) }
}

const options = (state: GameState): CityBuildOptions => buildOptionsOf(state, findPlayer(state, A)!)[0]!

/** Any legal square of a building, so that each test need not know the map. */
function squareOf(state: GameState, assetId: string) {
  const square = options(state).choices.find((choice) => choice.assetId === assetId)?.squares[0]
  if (square === undefined) throw new Error(`no square for ${assetId}`)
  return { column: square.column, row: square.row }
}

const tryBuild = (state: GameState, assetId: string, requestId: string, rush?: boolean, confirmed = false) =>
  performAssistedAction(state, {
    playerId: A,
    action: 'build',
    requestId,
    at: AT,
    payload: { cityPieceId: cityOf(state).id, item: { kind: 'building', assetId }, target: squareOf(state, assetId), ...(rush === undefined ? {} : { rush }) },
    ...(confirmed ? { confirmedRepeat: true } : {}),
  })
const build = (state: GameState, assetId: string, requestId: string, rush?: boolean): GameState => unwrap(tryBuild(state, assetId, requestId, rush))
const usedKey = (state: GameState): boolean => playerOf(state, A).playerTurns.some((turn) => turn.usedActions.includes(KEY))
const reason = (result: ReturnType<typeof tryBuild>): string => describeError(unwrapErr(result))
const costOf = (state: GameState, assetId: string): number => options(state).choices.find((c) => c.assetId === assetId)?.cost ?? -1
const tradeOf = (state: GameState, assetId: string): number => options(state).choices.find((c) => c.assetId === assetId)?.tradeToPay ?? -1
const logIdOf = (state: GameState, requestId: string): string => state.log.find((entry) => entry.assistedActionId === requestId)!.id

function undoByVote(state: GameState, requestId: string) {
  const logId = logIdOf(state, requestId)
  let next = unwrap(initiateUndo(state, { logId, playerId: A }))
  for (const playerId of [B, ITCHI]) next = unwrap(vote(next, { logId, playerId, vote: true, at: AT }))
  return vote(next, { logId, playerId: CHUL, vote: true, at: AT })
}

const LIBRARY = 'buildings/library'
const MARKET = 'buildings/market'
const TECHS = ['Writing', 'Currency']

describe('Engineering: the second build of a city', () => {
  it('is allowed without a question and takes what the first build left', () => {
    const first = build(ready(['Engineering', ...TECHS], 12), LIBRARY, 'b1')
    const city = options(first)
    expect(city.engineering).toEqual({ firstCost: 5, fullProduction: 12 })
    expect(city.production).toBe(7)
    expect(costOf(first, MARKET)).toBe(7)
    expect(tradeOf(first, MARKET)).toBe(0)
    const second = build(first, MARKET, 'b2')
    expect(usedKey(second)).toBe(true)
    expect(second.log.find((entry) => entry.assistedActionId === 'b2')?.publicLog).toContain('(splitting the production with Engineering)')
    expect(second.log.find((entry) => entry.assistedActionId === 'b2')?.publicLog).not.toContain('second action')
    const [r1, r2] = second.assistedActions
    expect(r1?.effect).toMatchObject({ cost: 5, production: 12 })
    expect(r2?.effect).toMatchObject({ engineering: { firstRecordId: 'b1' } })
    expect(r2?.usageKey).toBe(KEY)
  })

  it('shows the shortfall in trade and is paid with a rush like any build', () => {
    const first = build(ready(['Engineering', ...TECHS], 8, 20), LIBRARY, 'b1')
    expect(options(first).production).toBe(3)
    expect(tradeOf(first, MARKET)).toBe(12)
    expect(reason(tryBuild(first, MARKET, 'b2'))).toContain('Confirm paying 12 trade')
    const second = build(first, MARKET, 'b2', true)
    expect(playerOf(second, A).stats.trade).toBe(8)
    expect(second.assistedActions[1]?.effect).toMatchObject({ trade: 12 })
  })

  it('leaves nothing when the first build was rushed with trade', () => {
    const first = build(ready(['Engineering', ...TECHS], 3, 30), LIBRARY, 'b1', true)
    expect(options(first).production).toBe(0)
    expect(tradeOf(first, MARKET)).toBe(21)
  })

  it('does not count the hammers the first item adds, the marker or a caravan again', () => {
    // The production is the figure the first build had, whatever the new building adds to the estimate
    const first = build(ready(['Engineering', ...TECHS], 5), LIBRARY, 'b1')
    expect(options(first).production).toBe(0)
    expect(options(first).caravan).toBe(false)
    expect(options(first).boost).toBe(0)
  })

  it('asks the old question without Engineering revealed', () => {
    const first = build(ready(TECHS, 12), LIBRARY, 'b1')
    expect(options(first).engineering).toBeUndefined()
    expect(reason(tryBuild(first, MARKET, 'b2'))).toContain('has already acted this turn')
    const confirmed = unwrap(tryBuild(first, MARKET, 'b2', undefined, true))
    expect(usedKey(confirmed)).toBe(false)
    expect(confirmed.log.at(-1)?.publicLog).not.toContain('Engineering')
  })
})

describe('Engineering: what it does not cover', () => {
  const TEMPLE = 'buildings/temple'

  it('asks about a third action and refuses a second use of the key', () => {
    const done = build(build(ready(['Engineering', 'Philosophy', ...TECHS], 30), LIBRARY, 'b1'), MARKET, 'b2')
    expect(options(done).engineering).toBeUndefined()
    expect(reason(tryBuild(done, TEMPLE, 'b3'))).toContain('has already acted this turn')
    expect(reason(tryBuild(done, TEMPLE, 'b3'))).toContain('Engineering has already split the production this turn')
  })

  it('is not offered when the first action was not a build', () => {
    const state = ready(['Engineering', ...TECHS], 12)
    const devoted = unwrap(performAssistedAction(state, { playerId: A, action: 'devoteToTheArts', requestId: 'd1', payload: { cityPieceId: cityOf(state).id } }))
    expect(options(devoted).engineering).toBeUndefined()
    expect(reason(tryBuild(devoted, LIBRARY, 'b1'))).toContain('has already acted this turn')
  })

  it('is not offered after a first build recorded without a cost', () => {
    const first = build(ready(['Engineering', ...TECHS], 12), LIBRARY, 'b1')
    const old = {
      ...first,
      assistedActions: first.assistedActions.map((record) => {
        if (record.effect.kind !== 'build') return record
        const { cost: _cost, production: _production, ...rest } = record.effect
        return { ...record, effect: rest as typeof record.effect }
      }),
    }
    expect(options(old).engineering).toBeUndefined()
  })
})

describe('Engineering: undo', () => {
  it('undoing the second build frees the key and offers the second build again', () => {
    const second = build(build(ready(['Engineering', ...TECHS], 12), LIBRARY, 'b1'), MARKET, 'b2')
    const undone = unwrap(undoByVote(second, 'b2'))
    expect(usedKey(undone)).toBe(false)
    expect(options(undone).engineering).toBeDefined()
    expect(undone.board.pieces.some((piece) => piece.assetId === MARKET)).toBe(false)
  })

  it('refuses to undo the first build while the second stands', () => {
    const second = build(build(ready(['Engineering', ...TECHS], 12), LIBRARY, 'b1'), MARKET, 'b2')
    const refused = undoByVote(second, 'b1')
    expect(describeError(unwrapErr(refused))).toContain('Undo the second build first')
    const both = unwrap(undoByVote(unwrap(undoByVote(second, 'b2')), 'b1'))
    expect(both.board.pieces.some((piece) => piece.assetId === LIBRARY)).toBe(false)
  })
})

describe('Engineering: cancelling a city action with Writing', () => {
  /** B holds Writing and a Spy; the baseline is the game before A's first build. */
  function scene() {
    const base = ready(['Engineering', ...TECHS], 12)
    const withWriting = learn(base, B, 'Writing')
    const hut = withHutInHand(withWriting, 'Spy', B)
    const baseline = hut.state
    const current = build(build(baseline, LIBRARY, 'b1'), MARKET, 'b2')
    const cancel = (target: string) =>
      unwrap(
        applyCancellation(
          current,
          { playerId: B, requestId: 'w1', command: { logId: logIdOf(current, target), tech: 'Writing', payment: { resource: 'Spy', kind: 'hut', id: hut.hutId } } },
          // Cancelling the second leaves the first: the baseline is the game after the first build
          target === 'b1' ? baseline : build(baseline, LIBRARY, 'b1'),
        ),
      )
    return { cancel }
  }

  it('taking back the first build takes back both and frees Engineering', () => {
    const done = scene().cancel('b1')
    expect(done.board.pieces.some((piece) => piece.assetId === LIBRARY || piece.assetId === MARKET)).toBe(false)
    expect(usedKey(done)).toBe(false)
    expect(done.assistedActions.map((record) => record.status)).toEqual(['cancelled', 'superseded'])
    expect(options(done).engineering).toBeUndefined()
  })

  it('cancelling the second and then undoing the first leaves the cancelled second as the city\'s action', () => {
    const undone = unwrap(undoByVote(scene().cancel('b2'), 'b1'))
    expect(undone.board.pieces.some((piece) => piece.assetId === LIBRARY || piece.assetId === MARKET)).toBe(false)
    expect(cityActionsTakenThisTurn(undone, playerOf(undone, A), cityOf(undone).id)).toEqual(['Build (cancelled by Mark Twain)'])
    expect(options(undone).engineering).toBeUndefined()
  })

  it('a new build beside a cancelled second whose first was undone is the second action: no split is offered', () => {
    const undone = unwrap(undoByVote(scene().cancel('b2'), 'b1'))
    const again = unwrap(tryBuild(undone, LIBRARY, 'b3', undefined, true))
    expect(cityActionsTakenThisTurn(again, playerOf(again, A), cityOf(again).id)).toHaveLength(2)
    expect(options(again).engineering).toBeUndefined()
    expect(usedKey(again)).toBe(false)
  })

  it('taking back only the second leaves the first and frees Engineering', () => {
    const done = scene().cancel('b2')
    expect(done.board.pieces.some((piece) => piece.assetId === LIBRARY)).toBe(true)
    expect(done.board.pieces.some((piece) => piece.assetId === MARKET)).toBe(false)
    expect(usedKey(done)).toBe(false)
    expect(done.assistedActions[0]?.status).toBe('applied')
    expect(done.assistedActions[1]?.status).toBe('cancelled')
    // Ruling 165: Engineering is back, and the cancelled second build no longer counts, so the split can be made again at once
    expect(options(done).engineering).toBeDefined()
    const again = build(done, MARKET, 'b3')
    expect(usedKey(again)).toBe(true)
    expect(again.board.pieces.some((piece) => piece.assetId === MARKET)).toBe(true)
  })
})

/** A play of Ada Lovelace or Supply Drop earlier this turn that no city action has used: an allowance for one more action. */
const withCredit = (state: GameState, name: string): GameState => ({
  ...state,
  assistedActions: [
    ...state.assistedActions,
    {
      id: `credit-${name}`,
      kind: 'playCard',
      playerId: A,
      turnNumber: 1,
      phase: 'CM',
      usageKey: null,
      at: null,
      logId: 'credit',
      status: 'applied',
      effect: { kind: 'playCard', name },
    } as unknown as AssistedActionRecord,
  ],
})

const tryUnit = (state: GameState, requestId: string) =>
  performAssistedAction(state, { playerId: A, action: 'build', requestId, at: AT, payload: { cityPieceId: cityOf(state).id, item: { kind: 'unit', unitType: 'infantry' } } })

const withAtomic = (state: GameState): GameState => {
  const held = withHutInHand(state, 'Uranium').state
  return unwrap(performAssistedAction(held, { playerId: A, action: 'atomicTheory', requestId: 'atomic', at: AT, payload: { mode: 'extraActions' } }))
}

describe('Engineering: another allowance that covers the second build wins', () => {
  const techs = ['Engineering', 'Atomic Theory', ...TECHS]
  const full = (state: GameState): number => options(state).production

  it.each([
    ['Atomic Theory', (s: GameState) => withAtomic(s), 'Atomic Theory'],
    ['an Ada Lovelace credit', (s: GameState) => withCredit(s, LOVELACE_NAME), 'Ada Lovelace'],
    ['a Supply Drop credit', (s: GameState) => withCredit(s, SUPPLY_DROP_NAME), 'Supply Drop'],
  ])('%s: full production, no split and the key stays free', (_name, allow, text) => {
    const first = build(allow(ready(techs, 12)), LIBRARY, 'b1')
    expect(options(first).engineering).toBeUndefined()
    expect(full(first)).toBe(12)
    expect(tradeOf(first, MARKET)).toBe(0)
    const second = build(first, MARKET, 'b2')
    expect(usedKey(second)).toBe(false)
    expect(second.assistedActions.at(-1)?.effect).not.toHaveProperty('engineering')
    expect(second.log.at(-1)?.publicLog).toContain(text)
    expect(second.log.at(-1)?.publicLog).not.toContain('Engineering')
  })

  it('a confirmed repeat takes the full production and Engineering stays unused', () => {
    const first = build(ready(['Engineering', ...TECHS], 8, 30), LIBRARY, 'b1')
    expect(options(first).engineering).toBeDefined()
    expect(tradeOf(first, MARKET)).toBeGreaterThan(0)
    const second = unwrap(tryBuild(first, MARKET, 'b2', undefined, true))
    expect(usedKey(second)).toBe(false)
    expect(second.assistedActions.at(-1)?.effect).toMatchObject({ trade: 0 })
    expect(second.log.at(-1)?.publicLog).toContain('a second action of this city this turn, confirmed by the player')
  })

  it('splits when nothing covers it, also in the capital under Monarchy (which forbids the same action twice)', () => {
    const state = ready(['Engineering', ...TECHS], 12, 0, 'cities/redcapital2')
    const second = build(build(state, LIBRARY, 'b1'), MARKET, 'b2')
    expect(usedKey(second)).toBe(true)
    expect(second.log.at(-1)?.publicLog).toContain('splitting the production with Engineering')
  })

  it('a credit played after the split is still free for the next action (the split took none)', () => {
    const split = build(build(ready(['Engineering', ...TECHS, 'Philosophy'], 30), LIBRARY, 'b1'), MARKET, 'b2')
    expect(split.assistedActions[1]?.lovelaceCreditId).toBeUndefined()
    const third = build(withCredit(split, LOVELACE_NAME), 'buildings/temple', 'b3')
    expect(third.assistedActions.at(-1)?.lovelaceCreditId).toBe(`credit-${LOVELACE_NAME}`)
    expect(third.log.at(-1)?.publicLog).toContain('Ada Lovelace')
  })
})

describe('Engineering: the split is not an action of its own', () => {
  it('a third build is asked about, and the refusal says Engineering is spent', () => {
    const split = build(build(ready(['Engineering', 'Philosophy', ...TECHS], 30), LIBRARY, 'b1'), MARKET, 'b2')
    const refused = reason(tryBuild(split, 'buildings/temple', 'b3'))
    expect(refused).toContain('has already acted this turn')
    expect(refused).toContain('Engineering has already split the production this turn')
  })

  it('Atomic Theory still gives one more action after the split, and Engineering is once per turn even then (ruling 166)', () => {
    const split = build(build(ready(['Engineering', 'Atomic Theory', 'Philosophy', ...TECHS], 30), LIBRARY, 'b1'), MARKET, 'b2')
    const third = build(withAtomic(split), 'buildings/temple', 'b3')
    expect(third.log.at(-1)?.publicLog).toContain('an extra city action from Atomic Theory')
    expect(playerOf(third, A).playerTurns.flatMap((turn) => turn.usedActions).filter((key) => key === KEY)).toHaveLength(1)
    // The fourth is the city's third action
    expect(reason(tryUnit(third, 'b4'))).toContain('has already acted this turn')
  })

  it('the capital under Monarchy may still take a different action after the split', () => {
    const state = ready(['Engineering', ...TECHS], 12, 0, 'cities/redcapital2')
    const split = build(build(state, LIBRARY, 'b1'), MARKET, 'b2')
    const devoted = unwrap(performAssistedAction(split, { playerId: A, action: 'devoteToTheArts', requestId: 'd1', at: AT, payload: { cityPieceId: cityOf(split).id } }))
    expect(devoted.log.at(-1)?.publicLog).toContain('the additional capital action of Monarchy')
  })

  it('the Monarchy refusal and the refusal of a devoted city do not mention Engineering', () => {
    const split = build(build(ready(['Engineering', 'Philosophy', ...TECHS], 30, 0, 'cities/redcapital2'), LIBRARY, 'b1'), MARKET, 'b2')
    const monarchy = reason(tryBuild(split, 'buildings/temple', 'b3'))
    expect(monarchy).toContain('Monarchy')
    expect(monarchy).not.toContain('Engineering has already')
    const other = ready(['Engineering', ...TECHS], 12)
    const devoted = unwrap(performAssistedAction(other, { playerId: A, action: 'devoteToTheArts', requestId: 'd1', payload: { cityPieceId: cityOf(other).id } }))
    expect(reason(tryBuild(devoted, LIBRARY, 'b1'))).not.toContain('Engineering has already')
  })
})

describe('Engineering: the production is the one the first build had', () => {
  it('ignores a production set by hand after the first build', () => {
    const first = build(ready(['Engineering', ...TECHS], 12), LIBRARY, 'b1')
    const changed = unwrap(setCityProductionOverride(first, { playerId: A, pieceId: cityOf(first).id, value: 2 }))
    expect(options(changed).production).toBe(7)
    expect(options(changed).engineering).toEqual({ firstCost: 5, fullProduction: 12 })
  })

  it('uses up the caravan with the first build and does not count its 2 again', () => {
    const state = put(ready(['Engineering', ...TECHS], 5), CARAVAN_ASSET_ID, 1, 1)
    expect(options(state).production).toBe(7)
    expect(options(state).caravan).toBe(true)
    const first = build(state, LIBRARY, 'b1')
    expect(first.board.pieces.some((piece) => piece.assetId === CARAVAN_ASSET_ID)).toBe(false)
    expect(options(first).production).toBe(2)
    expect(options(first).caravan).toBe(false)
    expect(options(first).engineering).toEqual({ firstCost: 5, fullProduction: 7 })
  })
})

describe('Engineering: when it is not offered', () => {
  it('Engineering chosen but still hidden', () => {
    let state = ready(TECHS, 12)
    state = unwrap(chooseTech(state, { playerId: A, techName: 'Engineering' }))
    expect(options(build(state, LIBRARY, 'b1')).engineering).toBeUndefined()
  })

  it('the first build undone', () => {
    const first = build(ready(['Engineering', ...TECHS], 12), LIBRARY, 'b1')
    expect(options(unwrap(undoByVote(first, 'b1'))).engineering).toBeUndefined()
  })

  it('the first build from another turn', () => {
    const first = build(ready(['Engineering', ...TECHS], 12), LIBRARY, 'b1')
    const older = { ...first, assistedActions: first.assistedActions.map((record) => ({ ...record, turnNumber: 0 })) }
    expect(options(older).engineering).toBeUndefined()
  })
})

describe('Engineering: removing the first build\'s piece by hand while the second stands', () => {
  it('is a plain removal, not a take-back', () => {
    const split = build(build(ready(['Engineering', ...TECHS], 12), LIBRARY, 'b1'), MARKET, 'b2')
    const piece = split.board.pieces.find((p) => p.assetId === LIBRARY)!
    expect(takeBackOpenBuild(split, { playerId: A, pieceId: piece.id, at: AT })).toBeUndefined()
    const second = split.board.pieces.find((p) => p.assetId === MARKET)!
    expect(takeBackOpenBuild(split, { playerId: A, pieceId: second.id, at: AT })?.ok).toBe(true)
  })

  it('also when the second build was a unit card', () => {
    const state = ready(['Engineering', ...TECHS], 12)
    const first = build(state, LIBRARY, 'b1')
    const split = unwrap(
      performAssistedAction(first, { playerId: A, action: 'build', requestId: 'b2', at: AT, payload: { cityPieceId: cityOf(first).id, item: { kind: 'unit', unitType: 'infantry' } } }),
    )
    expect(usedKey(split)).toBe(true)
    const piece = split.board.pieces.find((p) => p.assetId === LIBRARY)!
    expect(takeBackOpenBuild(split, { playerId: A, pieceId: piece.id, at: AT })).toBeUndefined()
  })
})
