/**
 * City Walls (base rules p. 17) as a Build choice: a building in the city centre, unlocked by
 * Masonry for 7 production, that turns the city marker over to its walled side. No square is
 * picked and nothing new is placed: the same piece takes another asset.
 *
 * The scene is `assisted-build.test.ts`'s: Cash is Red on Monarchy and the America tile lies in
 * the first map slot with a red city on its square B2, whose estimate is 5 production.
 */

import { describe, expect, it } from 'vitest'

import {
  placePiece,
  removePiece,
  setCityProductionOverride,
  undoLastBoardChange,
} from '../src/actions/board.js'
import { chooseTech, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { performAssistedAction, takeBackOpenBuild } from '../src/assisted.js'
import { cityFootprintsOf } from '../src/blockade.js'
import { SQUARE_SIZE, findBoardAsset, mapTop, piecesAtStep, revertChange, slotOrigin } from '../src/board.js'
import type { BoardPiece } from '../src/board.js'
import { buildOptionsOf, walledAssetIdOf } from '../src/build-options.js'
import type { BuildPayload, CityBuildOptions } from '../src/build-options.js'
import { cityProductionsOf } from '../src/city-production.js'
import { describeError } from '../src/errors.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { findPlayer } from '../src/state.js'
import type { GameState, Playerhand } from '../src/state.js'

import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-10-09T10:00:00.000Z'
const OTHERS = [KARANDRAS1, ITCHI, CHUL]

const WALLS = { kind: 'walls' } as const

function game(): GameState {
  const colors: Record<string, string> = { [CASH1981]: 'Red', [KARANDRAS1]: 'Blue', [ITCHI]: 'Green', [CHUL]: 'Yellow' }
  const state = firstCivGame()
  return {
    ...state,
    players: state.players.map((p) => ({
      ...p,
      color: colors[p.playerId] ?? p.color,
      government: p.playerId === CASH1981 ? 'Monarchy' : p.government,
    })),
  }
}

function put(state: GameState, assetId: string, column: number, row: number): GameState {
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

function withAmerica(state: GameState): GameState {
  const slot = state.board.slots[0]
  if (slot === undefined) throw new Error('board has no slots')
  const [x, y] = slotOrigin(state.board, slot)
  return unwrap(placePiece(state, { playerId: CASH1981, assetId: 'tiles/america', x, y }))
}

function learn(state: GameState, ...techs: readonly string[]): GameState {
  return techs.reduce(
    (next, techName) =>
      unwrap(revealTech(unwrap(chooseTech(next, { playerId: CASH1981, techName })), { playerId: CASH1981, techName })),
    state,
  )
}

/** The America tile and a city of the given asset on B2, Masonry revealed, City Management open and the production set by hand. */
function ready(
  options: { cityAsset?: string; techs?: readonly string[]; trade?: number; production?: number | null } = {},
): GameState {
  let state = put(withAmerica(game()), options.cityAsset ?? 'cities/redcity2', 1, 1)
  state = learn(state, ...(options.techs ?? ['Masonry']))
  state = unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))
  state = {
    ...state,
    players: state.players.map((p) =>
      p.playerId === CASH1981 ? { ...p, stats: { ...p.stats, trade: options.trade ?? 0 } } : p,
    ),
  }
  const production = options.production === undefined ? 7 : options.production
  if (production !== null) {
    state = unwrap(setCityProductionOverride(state, { playerId: CASH1981, pieceId: cityOf(state).id, value: production }))
  }
  return state
}

const me = (state: GameState): Playerhand => {
  const found = findPlayer(state, CASH1981)
  if (found === undefined) throw new Error('no cash')
  return found
}

const cityOf = (state: GameState): BoardPiece => {
  const city = state.board.pieces.find((piece) => piece.category === 'city')
  if (city === undefined) throw new Error('no city')
  return city
}

const optionsOf = (state: GameState): CityBuildOptions => {
  const found = buildOptionsOf(state, me(state))[0]
  if (found === undefined) throw new Error('no build options')
  return found
}
const wallsChoice = (options: CityBuildOptions) => options.choices.find((choice) => choice.item.kind === 'walls')
const wallsReason = (options: CityBuildOptions): string =>
  options.unavailable.find((entry) => entry.item.kind === 'walls')?.reason ?? ''

const payloadOf = (state: GameState, extra: Partial<BuildPayload> = {}): BuildPayload =>
  ({ cityPieceId: cityOf(state).id, item: WALLS, ...extra }) as BuildPayload

const tryBuild = (state: GameState, extra: Partial<BuildPayload> = {}, requestId = 'req-1', confirmedRepeat = false) =>
  performAssistedAction(state, {
    playerId: CASH1981,
    action: 'build',
    requestId,
    at: AT,
    payload: payloadOf(state, extra),
    ...(confirmedRepeat ? { confirmedRepeat: true } : {}),
  })
const build = (state: GameState, extra: Partial<BuildPayload> = {}, requestId = 'req-1'): GameState =>
  unwrap(tryBuild(state, extra, requestId))

function undoByVote(state: GameState, requestId: string): GameState {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no line')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of OTHERS) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  return next
}

const centreOf = (piece: BoardPiece) => ({ x: piece.x + piece.width / 2, y: piece.y + piece.height / 2 })

describe('the walled side of a city marker', () => {
  it('is the same asset with walled before the number, and a walled marker has none', () => {
    expect(walledAssetIdOf('cities/redcity2')).toBe('cities/redcitywalled2')
    expect(walledAssetIdOf('cities/bluecapital2')).toBe('cities/bluecapitalwalled2')
    expect(walledAssetIdOf('cities/greenmetropolis2')).toBe('cities/greenmetropoliswalled2')
    expect(walledAssetIdOf('cities/redcitywalled2')).toBeUndefined()
    // No trailing digits: nothing to put the word before, as before
    expect(walledAssetIdOf('cities/redcity')).toBe('cities/redcity')
    // A very long run of digits is cut in one pass
    expect(walledAssetIdOf(`cities/redcity${'0'.repeat(100000)}`)).toBe(`cities/redcitywalled${'0'.repeat(100000)}`)
  })

  it('has artwork for every colour of capital, city and metropolis', () => {
    for (const colour of ['blue', 'green', 'purple', 'red', 'yellow']) {
      for (const kind of ['capital', 'city', 'metropolis']) {
        const walled = walledAssetIdOf(`cities/${colour}${kind}2`)
        expect(walled === undefined ? undefined : findBoardAsset(walled), `${colour} ${kind}`).toBeDefined()
      }
    }
  })
})

describe('what a city may build: City Walls', () => {
  it('need a revealed Masonry, and the reason says which tech', () => {
    const without = optionsOf(ready({ techs: [] }))
    expect(wallsChoice(without)).toBeUndefined()
    expect(wallsReason(without)).toBe('Needs Masonry.')

    const chosen = unwrap(chooseTech(ready({ techs: [] }), { playerId: CASH1981, techName: 'Masonry' }))
    expect(wallsReason(optionsOf(chosen))).toBe('Needs Masonry. Masonry is chosen but not revealed yet.')
  })

  it('are offered with Masonry: 7 production, no square, no trade when the city makes 7', () => {
    expect(wallsChoice(optionsOf(ready()))).toEqual({
      assetId: 'walls',
      item: { kind: 'walls' },
      placement: 'none',
      label: 'City Walls',
      cost: 7,
      tradeToPay: 0,
      squares: [],
    })
  })

  it('cost trade for the missing production like a building, and are refused when the trade is short', () => {
    // The estimate is 5, so 2 are missing: 6 trade
    expect(wallsChoice(optionsOf(ready({ production: null, trade: 6 })))).toMatchObject({ cost: 7, tradeToPay: 6 })
    expect(wallsReason(optionsOf(ready({ production: null, trade: 5 })))).toMatch(/^Costs 7 production and City B2 has 5/)
  })

  it('are not offered to a city that has them already', () => {
    const walled = optionsOf(ready({ cityAsset: 'cities/redcitywalled2' }))
    expect(wallsChoice(walled)).toBeUndefined()
    expect(wallsReason(walled)).toBe('City B2 already has City Walls. A city may have only one.')
  })

  it('a walled city builds everything else on the same squares', () => {
    const plain = optionsOf(ready({ techs: ['Masonry', 'Currency'] }))
    const walled = optionsOf(ready({ techs: ['Masonry', 'Currency'], cityAsset: 'cities/redcitywalled2' }))
    const squares = (options: CityBuildOptions) => options.choices.find((choice) => choice.assetId === 'buildings/market')?.squares
    expect(squares(walled)).toEqual(squares(plain))
    expect(squares(plain)?.length).toBeGreaterThan(0)
  })
})

describe('building City Walls', () => {
  it('turns the city marker over: the same piece, the walled asset, the same centre', () => {
    const before = ready()
    const city = cityOf(before)
    const done = build(before)

    const after = cityOf(done)
    expect(after.id).toBe(city.id)
    expect(after.assetId).toBe('cities/redcitywalled2')
    expect(after.category).toBe('city')
    expect(centreOf(after)).toEqual(centreOf(city))
    // What was typed in about the city stays, since it is the same piece
    expect(after.productionOverride).toBe(7)
    expect(done.board.pieces).toHaveLength(before.board.pieces.length)
    expect(done.log.find((entry) => entry.assistedActionId === 'req-1')?.publicLog).toBe(
      'cash1981 built City Walls in City B2, turning the city marker over to its walled side',
    )
  })

  it('records one board entry, counted with the build line, and a record that undo can read', () => {
    const before = ready()
    const done = build(before)
    const effect = done.assistedActions[0]?.effect
    if (effect?.kind !== 'build' || !('walls' in effect)) throw new Error('no walls effect')
    expect(effect.walls.pieceId).toBe(cityOf(before).id)
    expect(effect.walls.from.assetId).toBe('cities/redcity2')
    expect(effect.walls.to.assetId).toBe('cities/redcitywalled2')
    const entry = done.board.history.find((candidate) => candidate.id === effect.walls.historyId)
    expect(entry?.change).toMatchObject({ kind: 'flip', pieceId: cityOf(before).id })
    expect(entry?.logLength).toBe(done.log.findIndex((line) => line.assistedActionId === 'req-1') + 1)
    expect(done.board.history.at(-1)?.id).toBe(effect.walls.historyId)
  })

  it('keeps the city where it was for everything that reads the board', () => {
    const before = ready()
    const done = build(before)
    expect(cityFootprintsOf(done, 'red')).toHaveLength(1)
    expect(cityFootprintsOf(done, 'red')[0]?.outskirts).toEqual(cityFootprintsOf(before, 'red')[0]?.outskirts)
    const [production] = cityProductionsOf(done, me(done))
    expect(production?.label).toBe('City B2')
    // The next options still list the city, and say it has walls
    expect(wallsReason(optionsOf(done))).toBe('City B2 already has City Walls. A city may have only one.')
  })

  it('pays the trade for the missing production and takes it back on undo', () => {
    const before = ready({ production: null, trade: 10 })
    const done = build(before, { rush: true })
    expect(me(done).stats.trade).toBe(4)
    expect(done.log.find((entry) => entry.assistedActionId === 'req-1')?.publicLog).toContain('paying 6 trade for the missing production')
    expect(me(undoByVote(done, 'req-1')).stats.trade).toBe(10)
  })

  it('uses up the Building Program marker and puts it back on undo', () => {
    const marked = put(ready({ production: null }), 'markers/Building Program', 1, 1)
    const done = build(marked)
    expect(done.board.pieces.some((piece) => piece.assetId === 'markers/Building Program')).toBe(false)
    expect(done.log.find((entry) => entry.assistedActionId === 'req-1')?.publicLog).toContain('using up the Building Program marker')
    const undone = undoByVote(done, 'req-1')
    expect(undone.board.pieces.some((piece) => piece.assetId === 'markers/Building Program')).toBe(true)
  })

  it('works for a capital too', () => {
    const done = build(ready({ cityAsset: 'cities/redcapital2' }))
    expect(cityOf(done).assetId).toBe('cities/redcapitalwalled2')
    expect(done.log.find((entry) => entry.assistedActionId === 'req-1')?.publicLog).toContain('in Capital B2')
  })

  it('is the very action of the city: another one in the same turn asks first', () => {
    const done = build(ready({ techs: ['Masonry', 'Writing'] }))
    const again = describeError(
      unwrapErr(
        performAssistedAction(done, {
          playerId: CASH1981,
          action: 'build',
          requestId: 'req-2',
          at: AT,
          payload: { cityPieceId: cityOf(done).id, item: { kind: 'building', assetId: 'buildings/library' }, target: { column: 2, row: 1 } },
        }),
      ),
    )
    expect(again).toContain('has already acted this turn (Build)')
  })

  it('refuses a square, a missing Masonry and a second wall, and a refusal changes nothing', () => {
    const state = ready()
    expect(describeError(unwrapErr(tryBuild(state, { target: { column: 2, row: 1 } })))).toBe(
      'City Walls turn the city marker over and have no square. Send no square.',
    )
    expect(describeError(unwrapErr(tryBuild(ready({ techs: [] }))))).toContain('Needs Masonry.')
    expect(describeError(unwrapErr(tryBuild(build(state), {}, 'req-2')))).toContain('City B2 already has City Walls')
    const snapshot = JSON.stringify(state)
    tryBuild(state, { target: { column: 2, row: 1 } })
    expect(JSON.stringify(state)).toBe(snapshot)
  })
})

describe('undoing City Walls', () => {
  it('by the vote turns the marker back: the same piece on the same spot', () => {
    const before = ready()
    const city = cityOf(before)
    const undone = undoByVote(build(before), 'req-1')
    expect(cityOf(undone)).toEqual(city)
    expect(undone.assistedActions[0]?.status).toBe('undone')
    expect(undone.log.at(-1)?.publicLog).toBe(
      "System: cash1981's City Walls were undone: the city marker was turned back to its unwalled side",
    )
    // They can be built again
    expect(wallsChoice(optionsOf(undone))).toBeDefined()
  })

  it('is refused when the city is gone from the board', () => {
    const done = build(ready())
    const gone = unwrap(removePiece(done, { playerId: CASH1981, pieceId: cityOf(done).id }))
    const entry = gone.log.find((line) => line.assistedActionId === 'req-1')
    let next = unwrap(initiateUndo(gone, { logId: entry?.id ?? '', playerId: CASH1981 }))
    for (const playerId of [KARANDRAS1, ITCHI]) next = unwrap(vote(next, { logId: entry?.id ?? '', playerId, vote: true, at: AT }))
    const refused = unwrapErr(vote(next, { logId: entry?.id ?? '', playerId: CHUL, vote: true, at: AT }))
    expect(refused).toMatchObject({ kind: 'ASSISTED_UNDO_BLOCKED' })
    expect(refused.kind === 'ASSISTED_UNDO_BLOCKED' && refused.reason).toContain('The city is no longer on the board')
  })

  it('cannot be done with the board Undo: the turning over belongs to the build', () => {
    expect(unwrapErr(undoLastBoardChange(build(ready()), CASH1981))).toEqual({ kind: 'BOARD_UNDO_ASSISTED' })
  })

  it('and removing the city by hand is a plain removal, not a build taken back', () => {
    const done = build(ready())
    expect(takeBackOpenBuild(done, { playerId: CASH1981, pieceId: cityOf(done).id, at: AT })).toBeUndefined()
  })
})

describe('replaying the board history with the marker turned over', () => {
  const key = (piece: BoardPiece): string => `${piece.id}:${piece.assetId}@${piece.x},${piece.y}`

  it('gives the same pieces after the build and after its undo, and the step before shows the plain marker', () => {
    const before = ready()
    const done = build(before)
    const undone = undoByVote(done, 'req-1')
    for (const state of [done, undone]) {
      const replayed = piecesAtStep(state.board.history, state.board.history.length)
      expect([...replayed].map(key).sort()).toEqual([...state.board.pieces].map(key).sort())
    }
    const steps = done.board.history.length
    expect(piecesAtStep(done.board.history, steps - 1).find((piece) => piece.category === 'city')?.assetId).toBe('cities/redcity2')
    expect(piecesAtStep(done.board.history, steps).find((piece) => piece.category === 'city')?.assetId).toBe('cities/redcitywalled2')
  })

  it('reverting the change gives back exactly the piece it was', () => {
    const before = ready()
    const done = build(before)
    const change = done.board.history.at(-1)?.change
    if (change === undefined) throw new Error('no history')
    expect(revertChange(done.board.pieces, change).find((piece) => piece.category === 'city')).toEqual(cityOf(before))
  })
})

describe('City Walls with a caravan (Fame and Fortune p. 7)', () => {
  const caravans = (state: GameState) => state.board.pieces.filter((piece) => piece.assetId === 'markers/caravan')

  it('use it up although the city marker is turned over, and the undo vote puts it back', () => {
    const before = put(ready(), 'markers/caravan', 1, 1)
    const caravan = caravans(before)[0]
    expect(optionsOf(before).caravan).toBe(true)
    const done = build(before)
    expect(cityOf(done).assetId).toBe('cities/redcitywalled2')
    expect(caravans(done)).toEqual([])
    const undone = undoByVote(done, 'req-1')
    expect(cityOf(undone).assetId).toBe('cities/redcity2')
    expect(caravans(undone)).toEqual([caravan])
  })
})
