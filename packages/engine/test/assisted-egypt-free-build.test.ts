/**
 * The Egyptians' free build (issue #368): "Once per turn, during City Management, the Egyptians may build an unlocked
 * building for free by using an action." It takes the city's action, costs no production and no trade, is once per
 * turn, covers City Walls (FAQ 2.0) and is never combined with Engineering (rulings 80 and 164).
 * Specification: `docs/agents/decisions.md` ("Egyptians' free build").
 */

import { describe, expect, it } from 'vitest'

import { placePiece, setCityProductionOverride } from '../src/actions/board.js'
import { chooseTech, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { performAssistedAction } from '../src/assisted.js'
import { EGYPT_FREE_BUILD_KEY } from '../src/assisted-core.js'
import { CARAVAN_ASSET_ID } from '../src/disband.js'
import { SQUARE_SIZE, findBoardAsset, mapTop, slotOrigin } from '../src/board.js'
import type { BoardPiece } from '../src/board.js'
import type { BuildItem } from '../src/build-item.js'
import { buildOptionsOf } from '../src/build-options.js'
import type { CityBuildOptions } from '../src/build-options.js'
import { describeError } from '../src/errors.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { findPlayer } from '../src/state.js'
import type { GameState, Playerhand } from '../src/state.js'

import { player as playerOf } from './assisted-fixture.js'
import { CASH1981 as A, CHUL, ITCHI, KARANDRAS1 as B, firstCivGame } from './fixture.js'

const AT = '2026-10-09T10:00:00.000Z'
const LIBRARY = 'buildings/library'
const MARKET = 'buildings/market'

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

/** Cash (Red, Monarchy, the `civ`) with a city on B2 of the America tile, City Management open, `techs` revealed and a production set by hand. */
function ready(civ: string, techs: readonly string[], production: number, trade = 0): GameState {
  let state = firstCivGame()
  const colors: Record<string, string> = { [A]: 'Red', [B]: 'Blue', [ITCHI]: 'Green', [CHUL]: 'Yellow' }
  state = {
    ...state,
    players: state.players.map((p) => ({
      ...p,
      color: colors[p.playerId] ?? p.color,
      government: p.playerId === A ? 'Monarchy' : p.government,
      ...(p.playerId === A ? { civilization: { name: civ } as Playerhand['civilization'] } : {}),
    })),
  }
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

const options = (state: GameState): CityBuildOptions => buildOptionsOf(state, findPlayer(state, A)!)[0]!
const choiceFor = (state: GameState, assetId: string) => options(state).choices.find((choice) => choice.assetId === assetId)

function squareOf(state: GameState, assetId: string) {
  const square = choiceFor(state, assetId)?.squares[0]
  if (square === undefined) throw new Error(`no square for ${assetId}`)
  return { column: square.column, row: square.row }
}

const tryBuild = (state: GameState, assetId: string, requestId: string, free?: boolean, confirmed = false) =>
  performAssistedAction(state, {
    playerId: A,
    action: 'build',
    requestId,
    at: AT,
    payload: {
      cityPieceId: cityOf(state).id,
      item: { kind: 'building', assetId },
      target: squareOf(state, assetId),
      ...(free === undefined ? {} : { free }),
    },
    ...(confirmed ? { confirmedRepeat: true } : {}),
  })

const tryItem = (state: GameState, item: BuildItem, requestId: string, free: boolean, target?: { column: number; row: number }) =>
  performAssistedAction(state, {
    playerId: A,
    action: 'build',
    requestId,
    at: AT,
    payload: { cityPieceId: cityOf(state).id, item, ...(target === undefined ? {} : { target }), free } as never,
  })

const freeBuild = (state: GameState, assetId: string, requestId: string, confirmed = false): GameState => unwrap(tryBuild(state, assetId, requestId, true, confirmed))
const reason = (result: ReturnType<typeof tryBuild>): string => describeError(unwrapErr(result))
const usedKey = (state: GameState): boolean => playerOf(state, A).playerTurns.some((turn) => turn.usedActions.includes(EGYPT_FREE_BUILD_KEY))
const tradeOf = (state: GameState): number => playerOf(state, A).stats.trade

function undoByVote(state: GameState, requestId: string): GameState {
  const logId = state.log.find((entry) => entry.assistedActionId === requestId)!.id
  let next = unwrap(initiateUndo(state, { logId, playerId: A }))
  for (const playerId of [B, ITCHI, CHUL]) next = unwrap(vote(next, { logId, playerId, vote: true, at: AT }))
  return next
}

const TECHS = ['Writing', 'Currency']

describe("the Egyptians' free build", () => {
  it('builds an unlocked building without production or trade, uses the key and logs it', () => {
    const state = ready('Egyptians', TECHS, 3, 30)
    expect(choiceFor(state, LIBRARY)).toMatchObject({ cost: 5, freeBuild: true })
    const built = freeBuild(state, LIBRARY, 'b1')
    expect(tradeOf(built)).toBe(30)
    expect(usedKey(built)).toBe(true)
    expect(built.log.find((entry) => entry.assistedActionId === 'b1')?.publicLog).toContain('for free with the Egyptian ability')
    const [record] = built.assistedActions
    expect(record).toMatchObject({ usageKey: EGYPT_FREE_BUILD_KEY, effect: { free: true, trade: 0, cost: 0 } })
    expect(built.board.pieces.some((piece) => piece.assetId === LIBRARY)).toBe(true)
  })

  it('offers a building the city cannot pay for, but only as a free build', () => {
    const state = ready('Egyptians', TECHS, 1, 0)
    expect(choiceFor(state, LIBRARY)).toMatchObject({ freeBuild: true, freeOnly: true, tradeToPay: 0 })
    expect(reason(tryBuild(state, LIBRARY, 'b1'))).toContain('The Egyptians can build it for free instead')
    expect(tryBuild(state, LIBRARY, 'b2', true).ok).toBe(true)
  })

  it('still builds for the normal price when the player does not ask for it', () => {
    const state = ready('Egyptians', TECHS, 12)
    const built = unwrap(tryBuild(state, LIBRARY, 'b1'))
    expect(usedKey(built)).toBe(false)
    expect(built.assistedActions[0]?.effect).not.toHaveProperty('free')
  })

  it('is once a turn: the second free build is refused and the choice stops offering it', () => {
    const first = freeBuild(ready('Egyptians', TECHS, 12), LIBRARY, 'b1')
    expect(choiceFor(first, MARKET)?.freeBuild).toBeUndefined()
    expect(reason(tryBuild(first, MARKET, 'b2', true, true))).toBe('The Egyptians have already built for free this turn.')
  })

  it('gives the use back when the build is undone by vote', () => {
    const built = freeBuild(ready('Egyptians', TECHS, 3), LIBRARY, 'b1')
    const undone = undoByVote(built, 'b1')
    expect(usedKey(undone)).toBe(false)
    expect(undone.board.pieces.some((piece) => piece.assetId === LIBRARY)).toBe(false)
    expect(choiceFor(undone, LIBRARY)?.freeBuild).toBe(true)
  })

  it('builds City Walls for free too', () => {
    const state = ready('Egyptians', ['Masonry'], 2, 0)
    expect(choiceFor(state, 'walls')).toMatchObject({ freeBuild: true, freeOnly: true })
    const built = unwrap(tryItem(state, { kind: 'walls' }, 'w1', true))
    expect(usedKey(built)).toBe(true)
    expect(built.assistedActions[0]?.effect).toMatchObject({ free: true, trade: 0 })
  })

  it('is for the Egyptians, and for buildings and City Walls only', () => {
    expect(reason(tryBuild(ready('Romans', TECHS, 12), LIBRARY, 'b1', true))).toBe('Only the Egyptians can build for free.')
    const state = ready('Egyptians', TECHS, 12)
    const army = describeError(unwrapErr(tryItem(state, { kind: 'army' }, 'b1', true, { column: 2, row: 1 })))
    expect(army).toBe('The Egyptians build only a building or City Walls for free, not a wonder, a figure or a unit.')
    expect(choiceFor(ready('Romans', TECHS, 12), LIBRARY)?.freeBuild).toBeUndefined()
  })

  it('is its own action and is not split with Engineering', () => {
    const first = freeBuild(ready('Egyptians', ['Engineering', ...TECHS], 12), LIBRARY, 'b1')
    expect(options(first).engineering).toBeUndefined()
    expect(reason(tryBuild(first, MARKET, 'b2'))).toContain('has already acted this turn')
  })

  it('leaves the caravan on the city: no production is used', () => {
    const state = put(ready('Egyptians', TECHS, 5), CARAVAN_ASSET_ID, 1, 1)
    const built = freeBuild(state, LIBRARY, 'b1')
    expect(built.board.pieces.some((piece) => piece.assetId === CARAVAN_ASSET_ID)).toBe(true)
    expect(built.assistedActions[0]?.effect).toMatchObject({ cost: 0, production: 7 })
  })
})
