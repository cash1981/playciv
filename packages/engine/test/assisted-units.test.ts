/**
 * The Build action for army and scout figures and for military units (task
 * `assisted-units`, issue #264 parts 3 and 4): what a city may build besides
 * buildings, the action that builds it, and the undo vote that takes it back.
 * Buildings are tested in `assisted-build.test.ts`; this file only adds what the
 * two new kinds of item do differently.
 *
 * The scene is that file's: Cash is Red on Monarchy and the America tile lies in
 * the first map slot with a red city on its square B2. The America grid, as
 * printed (row by row, column 0 to 3):
 *
 *   row 0: mountain  mountain  water      grassland
 *   row 1: forest    mountain  grassland  water
 *   row 2: desert    desert    mountain   forest
 *   row 3: water     desert    water      forest
 *
 * so the outskirts of a city on B2 are A1 mountain, B1 mountain, C1 water, A2
 * forest, C2 grassland, A3 desert, B3 desert and C3 mountain. C1 is the only
 * water square, so it is the one the water techs decide. The estimate is 5
 * production and the stacking limit and the unit levels are the defaults (2 and
 * level 1), so an army (4) is paid for by the production, a scout (6) is one
 * short (3 trade) and every level 1 unit (5) is exactly paid.
 */

import { describe, expect, it } from 'vitest'

import {
  movePiece,
  placePiece,
  removePiece,
  setCityProductionOverride,
  undoLastBoardChange,
} from '../src/actions/board.js'
import { draw } from '../src/actions/draw.js'
import { chooseTech, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { performAssistedAction } from '../src/assisted.js'
import { mapCellOf } from '../src/blockade.js'
import { SQUARE_SIZE, findBoardAsset, mapTop, slotOrigin } from '../src/board.js'
import type { BoardPiece, Rotation } from '../src/board.js'
import { buildOptionsOf, buildSquareRefusal } from '../src/build-options.js'
import type { BuildChoice, BuildItem, BuildPayload, CityBuildOptions, UnitType } from '../src/build-options.js'
import { describeError } from '../src/errors.js'
import type { CivItem, Item } from '../src/item.js'
import { itemName } from '../src/item.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { SheetName } from '../src/sheet-name.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { GameState, Playerhand } from '../src/state.js'

import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-10-09T10:00:00.000Z'
const OTHERS = [KARANDRAS1, ITCHI, CHUL]

const C2 = { column: 2, row: 1 }
const C1 = { column: 2, row: 0 }
const A1 = { column: 0, row: 0 }

type Cell = { readonly column: number; readonly row: number }

const SHEET: Readonly<Record<UnitType, SheetName>> = {
  infantry: 'INFANTRY',
  artillery: 'ARTILLERY',
  mounted: 'MOUNTED',
  aircraft: 'AIRCRAFT',
}

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

/** Cash is Red unless told otherwise, Karandras Blue, Itchi Green, Chul Yellow. Cash is on Monarchy. */
function game(colour = 'Red'): GameState {
  const colors: Record<string, string> = {
    [CASH1981]: colour,
    [KARANDRAS1]: 'Blue',
    [ITCHI]: 'Green',
    [CHUL]: 'Yellow',
  }
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

/** Places a piece so its centre is in map square (column, row), both from 0. */
function put(
  state: GameState,
  playerId: string,
  assetId: string,
  column: number,
  row: number,
  rotation: Rotation = 0,
): GameState {
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`no asset ${assetId}`)
  return unwrap(
    placePiece(state, {
      playerId,
      assetId,
      x: column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2,
      y: mapTop(state.board) + row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2,
      rotation,
    }),
  )
}

function withAmerica(state: GameState): GameState {
  const slot = state.board.slots[0]
  if (slot === undefined) throw new Error('board has no slots')
  const [x, y] = slotOrigin(state.board, slot)
  return unwrap(placePiece(state, { playerId: CASH1981, assetId: 'tiles/america', x, y }))
}

/** The America tile and a city of Cash's colour on B2, City Management closed. */
const scene = (colour = 'Red'): GameState =>
  put(withAmerica(game(colour)), CASH1981, `cities/${colour.toLowerCase()}city2`, 1, 1)

function learn(state: GameState, ...techs: readonly string[]): GameState {
  return techs.reduce(
    (next, techName) =>
      unwrap(revealTech(unwrap(chooseTech(next, { playerId: CASH1981, techName })), { playerId: CASH1981, techName })),
    state,
  )
}

/** Start of Turn and Trade done, so City Management is open. */
const openTurn = (state: GameState, playerId = CASH1981): GameState =>
  unwrap(markPhasesDone(state, { playerId, turnNumber: 1, upToPhase: 'TRADE' }))

function withStats(state: GameState, stats: Partial<Playerhand['stats']>, playerId = CASH1981): GameState {
  return {
    ...state,
    players: state.players.map((p) => (p.playerId === playerId ? { ...p, stats: { ...p.stats, ...stats } } : p)),
  }
}

/** The scene with City Management open, the techs revealed and the trade in hand. */
const ready = (techs: readonly string[] = [], trade = 0, colour = 'Red'): GameState =>
  withStats(openTurn(learn(scene(colour), ...techs)), { trade })

const me = (state: GameState, playerId = CASH1981): Playerhand => {
  const found = findPlayer(state, playerId)
  if (found === undefined) throw new Error(`no player ${playerId}`)
  return found
}

const cityOf = (state: GameState): BoardPiece => {
  const city = state.board.pieces.find((piece) => piece.category === 'city')
  if (city === undefined) throw new Error('no city on the board')
  return city
}

const optionsOf = (state: GameState): CityBuildOptions => {
  const found = buildOptionsOf(state, me(state))[0]
  if (found === undefined) throw new Error('no build options')
  return found
}

const withOverride = (state: GameState, value: number | null): GameState =>
  unwrap(setCityProductionOverride(state, { playerId: CASH1981, pieceId: cityOf(state).id, value }))

const americans = (state: GameState): GameState => ({
  ...state,
  players: state.players.map((p) =>
    p.playerId === CASH1981 ? { ...p, civilization: { kind: 'civ', name: 'Americans' } as unknown as CivItem } : p,
  ),
})

const russians = (state: GameState): GameState => ({
  ...state,
  players: state.players.map((p) =>
    p.playerId === CASH1981 ? { ...p, civilization: { kind: 'civ', name: 'Russians' } as unknown as CivItem } : p,
  ),
})

const choiceOf = (options: CityBuildOptions, item: BuildItem): BuildChoice | undefined =>
  options.choices.find((choice) =>
    item.kind === 'unit'
      ? choice.item.kind === 'unit' && choice.item.unitType === item.unitType
      : choice.item.kind === item.kind && (item.kind !== 'building' || (choice.item.kind === 'building' && choice.item.assetId === item.assetId)),
  )

const reasonOf = (options: CityBuildOptions, item: BuildItem): string =>
  options.unavailable.find((entry) =>
    item.kind === 'unit'
      ? entry.item.kind === 'unit' && entry.item.unitType === item.unitType
      : entry.item.kind === item.kind,
  )?.reason ?? ''

const ARMY: BuildItem = { kind: 'army' }
const SCOUT: BuildItem = { kind: 'scout' }
const unit = (unitType: UnitType): BuildItem => ({ kind: 'unit', unitType })

const cellsOf = (squares: readonly Cell[] | undefined) => (squares ?? []).map((square) => [square.column, square.row])

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

function payloadFor(state: GameState, item: BuildItem, at?: Cell, rush?: boolean): BuildPayload {
  const base = { cityPieceId: cityOf(state).id, ...(rush === undefined ? {} : { rush }) }
  if (item.kind === 'unit') return { ...base, item }
  if (at === undefined) throw new Error('a figure needs a square')
  return { ...base, item, target: at }
}

const tryBuild = (state: GameState, item: BuildItem, at?: Cell, requestId = 'req-1', rush?: boolean, playerId = CASH1981) =>
  performAssistedAction(state, { playerId, action: 'build', requestId, at: AT, payload: payloadFor(state, item, at, rush) })

const build = (state: GameState, item: BuildItem, at?: Cell, requestId = 'req-1', rush?: boolean): GameState =>
  unwrap(tryBuild(state, item, at, requestId, rush))

const refusal = (result: ReturnType<typeof tryBuild>): string => describeError(unwrapErr(result))

function logIdOf(state: GameState, requestId: string): string {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line for the action')
  return entry.id
}

function undoByVote(state: GameState, requestId: string): GameState {
  const logId = logIdOf(state, requestId)
  let next = unwrap(initiateUndo(state, { logId, playerId: CASH1981 }))
  for (const playerId of OTHERS) next = unwrap(vote(next, { logId, playerId, vote: true, at: AT }))
  return next
}

/** Asks for the undo and casts every vote but the last; the last vote is returned for the test to try. */
function almostUndone(state: GameState, requestId: string) {
  const logId = logIdOf(state, requestId)
  let next = unwrap(initiateUndo(state, { logId, playerId: CASH1981 }))
  for (const playerId of [KARANDRAS1, ITCHI]) next = unwrap(vote(next, { logId, playerId, vote: true, at: AT }))
  return { state: next, logId, last: () => vote(next, { logId, playerId: CHUL, vote: true, at: AT }) }
}

const piecesOf = (state: GameState, assetId: string): readonly BoardPiece[] =>
  state.board.pieces.filter((piece) => piece.assetId === assetId)

const lastLine = (state: GameState): string => state.log.at(-1)?.publicLog ?? ''

const handOf = (state: GameState, playerId = CASH1981): readonly Item[] => me(state, playerId).items

const firstCardOf = (state: GameState, sheet: SheetName): Item => {
  const card = state.items.find((item) => item.sheetName === sheet)
  if (card === undefined) throw new Error(`no ${sheet} card in the deck`)
  return card
}

/** Every card of a sheet moved from the deck to the discard pile. */
const discardSheet = (state: GameState, sheet: SheetName): GameState => ({
  ...state,
  items: state.items.filter((item) => item.sheetName !== sheet),
  discardedItems: [...state.discardedItems, ...state.items.filter((item) => item.sheetName === sheet)],
})

/** Every card of a sheet gone from the deck and the discard pile. */
const dropSheet = (state: GameState, sheet: SheetName): GameState => ({
  ...state,
  items: state.items.filter((item) => item.sheetName !== sheet),
  discardedItems: state.discardedItems.filter((item) => item.sheetName !== sheet),
})

/** Red figures put far from the city, where nothing else is, to use up a supply. */
function crowd(state: GameState, assetId: string, count: number): GameState {
  let next = state
  for (let index = 0; index < count; index += 1) next = put(next, CASH1981, assetId, 6 + index, 8)
  return next
}

// ---------------------------------------------------------------------------
// What a city offers
// ---------------------------------------------------------------------------

describe('what is offered', () => {
  it('a figure is a choice with squares and a unit is a choice with none', () => {
    const options = optionsOf(ready([], 3))
    const army = choiceOf(options, ARMY)
    expect(army).toMatchObject({
      assetId: 'figures/redarmy',
      item: { kind: 'army' },
      placement: 'square',
      label: 'Army figure',
      cost: 4,
      tradeToPay: 0,
    })
    expect(army?.squares.length).toBeGreaterThan(0)
    expect(choiceOf(options, SCOUT)).toMatchObject({
      assetId: 'figures/redscout',
      item: { kind: 'scout' },
      placement: 'square',
      label: 'Scout figure',
      cost: 6,
      tradeToPay: 3,
    })
    expect(choiceOf(options, unit('infantry'))).toEqual({
      assetId: 'units/infantry',
      item: { kind: 'unit', unitType: 'infantry' },
      placement: 'none',
      label: 'Infantry unit',
      cost: 5,
      tradeToPay: 0,
      squares: [],
    })
  })

  it('the army and scout assets follow the colour of the player', () => {
    const options = optionsOf(ready([], 3, 'Yellow'))
    expect(choiceOf(options, ARMY)?.assetId).toBe('figures/yellowarmy')
    expect(choiceOf(options, SCOUT)?.assetId).toBe('figures/yellowscout')
  })

  it('a closed phase offers nothing', () => {
    const options = optionsOf(scene())
    expect(options).toMatchObject({ status: 'wrong-phase', choices: [], unavailable: [] })
  })

  it('every item is either a choice or has a reason, once', () => {
    const options = optionsOf(ready())
    const items = [...options.choices.map((c) => c.item), ...options.unavailable.map((u) => u.item)]
    expect(items.filter((item) => item.kind === 'army')).toHaveLength(1)
    expect(items.filter((item) => item.kind === 'scout')).toHaveLength(1)
    expect(items.filter((item) => item.kind === 'unit')).toHaveLength(4)
    // The scout is one short and there is no trade
    expect(reasonOf(options, SCOUT)).toMatch(/^Costs 6 production and City B2 has 5/)
  })
})

describe('the cost', () => {
  it('an army costs 4 and a scout 6, the scout paid by trade when the city makes 5', () => {
    const rich = optionsOf(withOverride(ready(), 20))
    expect(choiceOf(rich, ARMY)).toMatchObject({ cost: 4, tradeToPay: 0 })
    expect(choiceOf(rich, SCOUT)).toMatchObject({ cost: 6, tradeToPay: 0 })
    // A production of 3: the army is 1 short, the scout 3
    const poor = optionsOf(withOverride(ready([], 99), 3))
    expect(choiceOf(poor, ARMY)).toMatchObject({ tradeToPay: 3 })
    expect(choiceOf(poor, SCOUT)).toMatchObject({ tradeToPay: 9 })
  })

  it('a unit costs 5, 7, 9 or 11 by the level of its type', () => {
    const rich = withOverride(ready(), 20)
    for (const [level, cost] of [[1, 5], [2, 7], [3, 9], [4, 11]] as const) {
      const state = withStats(rich, { infantry: level, artillery: level, mounted: level })
      const options = optionsOf(state)
      for (const type of ['infantry', 'artillery', 'mounted'] as const) {
        expect(choiceOf(options, unit(type)), `${type} level ${level}`).toMatchObject({ cost, tradeToPay: 0 })
      }
    }
  })

  it('each type reads its own level', () => {
    const state = withStats(withOverride(ready(), 20), { infantry: 1, artillery: 2, mounted: 4 })
    const options = optionsOf(state)
    expect(choiceOf(options, unit('infantry'))?.cost).toBe(5)
    expect(choiceOf(options, unit('artillery'))?.cost).toBe(7)
    expect(choiceOf(options, unit('mounted'))?.cost).toBe(11)
  })

  it('a level outside 1 to 4 is read as the nearest level and never changed', () => {
    const state = withStats(withOverride(ready(), 20), { infantry: 0, artillery: 9, mounted: 2.9 })
    const options = optionsOf(state)
    expect(choiceOf(options, unit('infantry'))?.cost).toBe(5)
    expect(choiceOf(options, unit('artillery'))?.cost).toBe(11)
    expect(choiceOf(options, unit('mounted'))?.cost).toBe(7)
    const built = build(state, unit('artillery'))
    expect(me(built).stats).toMatchObject({ infantry: 0, artillery: 9, mounted: 2.9 })
  })

  it('aircraft need a revealed Flight and then cost 12 whatever the levels are', () => {
    const without = optionsOf(withOverride(ready(), 20))
    expect(choiceOf(without, unit('aircraft'))).toBeUndefined()
    expect(reasonOf(without, unit('aircraft'))).toBe('Needs Flight.')

    const chosen = openTurn(unwrap(chooseTech(scene(), { playerId: CASH1981, techName: 'Flight' })))
    expect(reasonOf(optionsOf(chosen), unit('aircraft'))).toBe('Needs Flight. Flight is chosen but not revealed yet.')

    const withFlight = withStats(withOverride(ready(['Flight']), 20), { infantry: 4, artillery: 4, mounted: 4 })
    expect(choiceOf(optionsOf(withFlight), unit('aircraft'))).toMatchObject({ cost: 12, tradeToPay: 0, placement: 'none' })
    // 5 production: 7 short, 21 trade
    expect(choiceOf(optionsOf(ready(['Flight'], 21)), unit('aircraft'))?.tradeToPay).toBe(21)
    expect(choiceOf(optionsOf(ready(['Flight'], 20)), unit('aircraft'))).toBeUndefined()
  })

  it('a choice exists only when the player can pay, and the reason says how much is missing', () => {
    const options = optionsOf(ready([], 2))
    expect(choiceOf(options, SCOUT)).toBeUndefined()
    expect(reasonOf(options, SCOUT)).toBe(
      'Costs 6 production and City B2 has 5 (the estimate). Covering the missing 1 takes 3 trade and you have 2. ' +
        'If the city makes more than that, set its production by hand on the city.',
    )
    const heavy = withStats(ready([], 0), { artillery: 3 })
    expect(reasonOf(optionsOf(heavy), unit('artillery'))).toMatch(/^Costs 9 production \(artillery level 3\) and City B2 has 5/)
  })
})

describe('the squares of a figure', () => {
  it('an army may go on every outskirts square but the water, and never the centre', () => {
    const squares = choiceOf(optionsOf(ready()), ARMY)?.squares ?? []
    expect(squares.map((square) => square.label)).toEqual(['A1', 'B1', 'A2', 'C2', 'A3', 'B3', 'C3'])
    expect(squares.every((square) => square.note === undefined)).toBe(true)
  })

  it.each(['Sailing', 'Steam Power', 'Flight'])('water is a square for a figure with %s revealed', (tech) => {
    const without = ready()
    expect(cellsOf(choiceOf(optionsOf(without), ARMY)?.squares)).not.toContainEqual([2, 0])
    expect(buildSquareRefusal(without, me(without), cityOf(without).id, ARMY, C1)).toBe(
      'C1 is water, and a figure may stand in water only with a revealed Sailing, Steam Power or Flight.',
    )
    const withTech = ready([tech])
    expect(cellsOf(choiceOf(optionsOf(withTech), ARMY)?.squares)).toContainEqual([2, 0])
    expect(cellsOf(choiceOf(optionsOf(withTech), SCOUT)?.squares ?? [])).toEqual([])
    expect(buildSquareRefusal(withTech, me(withTech), cityOf(withTech).id, ARMY, C1)).toBeUndefined()
  })

  it('a water tech that is only chosen does not open the water', () => {
    const chosen = openTurn(unwrap(chooseTech(scene(), { playerId: CASH1981, techName: 'Sailing' })))
    expect(cellsOf(choiceOf(optionsOf(chosen), ARMY)?.squares)).not.toContainEqual([2, 0])
  })

  it('a scout may go on water with a tech as well', () => {
    const state = ready(['Sailing'], 3)
    expect(cellsOf(choiceOf(optionsOf(state), SCOUT)?.squares)).toContainEqual([2, 0])
  })

  it('a city centre of any colour is never a square', () => {
    const base = ready()
    const crowded = put(base, KARANDRAS1, 'cities/bluecity2', A1.column, A1.row)
    const options = optionsOf(crowded)
    expect(cellsOf(choiceOf(options, ARMY)?.squares)).not.toContainEqual([0, 0])
    expect(buildSquareRefusal(crowded, me(crowded), cityOf(crowded).id, ARMY, A1)).toBe('A1 is a city centre.')
    expect(buildSquareRefusal(base, me(base), cityOf(base).id, ARMY, { column: 1, row: 1 })).toBe(
      'B2 is not in the outskirts of that city.',
    )
  })

  it('a city-state square is never a square', () => {
    const crowded = put(ready(), KARANDRAS1, 'city-states/cs1', C2.column, C2.row)
    expect(cellsOf(choiceOf(optionsOf(crowded), ARMY)?.squares)).not.toContainEqual([2, 1])
    expect(buildSquareRefusal(crowded, me(crowded), cityOf(crowded).id, ARMY, C2)).toBe('C2 is a city-state square.')
  })

  it('a building, a wonder or a great person does not keep a figure off', () => {
    const base = ready()
    for (const assetId of ['buildings/granary', 'wonders/pyramids', 'great people/scientist']) {
      const crowded = put(base, KARANDRAS1, assetId, C2.column, C2.row)
      expect(cellsOf(choiceOf(optionsOf(crowded), ARMY)?.squares), assetId).toContainEqual([2, 1])
    }
  })

  it.each(['resources/hut', 'resources/village'])('a square with a %s marker is not offered, and the reason leaves it to the player', (marker) => {
    const crowded = put(ready([], 3), KARANDRAS1, marker, C2.column, C2.row)
    const options = optionsOf(crowded)
    for (const item of [ARMY, SCOUT]) {
      expect(cellsOf(choiceOf(options, item)?.squares), item.kind).not.toContainEqual([2, 1])
    }
    const what = marker.endsWith('hut') ? 'hut' : 'village'
    const why = buildSquareRefusal(crowded, me(crowded), cityOf(crowded).id, ARMY, C2) ?? ''
    expect(why).toBe(
      `C2 has a ${what} marker. The rules do not say how a figure is placed there, so Build leaves it to you: place the figure by hand.`,
    )
    // Another resource marker is no such thing
    const wheat = put(ready(), KARANDRAS1, 'resources/wheat', C2.column, C2.row)
    expect(cellsOf(choiceOf(optionsOf(wheat), ARMY)?.squares)).toContainEqual([2, 1])
  })

  it('when no square is left the reason counts what is in the way', () => {
    // Every square but C2 is taken by something a figure cannot stand on; C2 holds a hut
    let state = ready([], 3)
    state = put(state, KARANDRAS1, 'resources/hut', C2.column, C2.row)
    for (const cell of [[0, 0], [1, 0], [0, 1], [0, 2], [1, 2], [2, 2]] as const) {
      state = put(state, KARANDRAS1, 'resources/village', cell[0], cell[1])
    }
    const options = optionsOf(state)
    expect(choiceOf(options, ARMY)).toBeUndefined()
    expect(reasonOf(options, ARMY)).toBe(
      'No legal square. 7 squares have a hut or village marker, which Build leaves for you to place by hand, 1 square is water, which needs a revealed Sailing, Steam Power or Flight.',
    )
  })
})

describe('the stacking limit', () => {
  const figuresOn = (state: GameState, cell: Cell, ...assetIds: readonly string[]): GameState =>
    assetIds.reduce((next, assetId) => put(next, CASH1981, assetId, cell.column, cell.row), state)

  it('one friendly figure leaves room for a second, two fill the square', () => {
    const one = figuresOn(ready(), C2, 'figures/redarmy')
    expect(cellsOf(choiceOf(optionsOf(one), ARMY)?.squares)).toContainEqual([2, 1])
    const two = figuresOn(ready(), C2, 'figures/redarmy', 'figures/redscout')
    expect(cellsOf(choiceOf(optionsOf(two), ARMY)?.squares)).not.toContainEqual([2, 1])
    expect(buildSquareRefusal(two, me(two), cityOf(two).id, ARMY, C2)).toBe(
      'C2 already holds 2 of your figures, which is your stacking limit of 2.',
    )
  })

  it('the limit is stats.stacking, read as it is', () => {
    const two = figuresOn(ready(), C2, 'figures/redarmy', 'figures/redarmy')
    expect(cellsOf(choiceOf(optionsOf(withStats(two, { stacking: 3 })), ARMY)?.squares)).toContainEqual([2, 1])
    expect(cellsOf(choiceOf(optionsOf(withStats(two, { stacking: 2 })), ARMY)?.squares)).not.toContainEqual([2, 1])
    const one = figuresOn(ready(), C2, 'figures/redarmy')
    expect(cellsOf(choiceOf(optionsOf(withStats(one, { stacking: 1 })), ARMY)?.squares)).not.toContainEqual([2, 1])
    // No limit above 0 means no square at all
    expect(choiceOf(optionsOf(withStats(ready(), { stacking: 0 })), ARMY)).toBeUndefined()
  })

  it('a stacking limit of 0 is said as such, not as "already holds 0"', () => {
    const none = withStats(ready(), { stacking: 0 })
    expect(buildSquareRefusal(none, me(none), cityOf(none).id, ARMY, C2)).toBe(
      'C2 cannot hold a figure: your stacking limit is 0.',
    )
  })

  it('armies and scouts count together, and figures of another colour do not count', () => {
    // A blue army and one red army: one friendly figure, so the red player may add one
    const mixed = put(figuresOn(ready(), C2, 'figures/redarmy'), KARANDRAS1, 'figures/bluearmy', C2.column, C2.row)
    expect(cellsOf(choiceOf(optionsOf(mixed), ARMY)?.squares)).toContainEqual([2, 1])
    // A blue figure alone is no friendly one at all
    const blue = put(ready(), KARANDRAS1, 'figures/bluearmy', C2.column, C2.row)
    expect(cellsOf(choiceOf(optionsOf(blue), ARMY)?.squares)).toContainEqual([2, 1])
  })

  it('the white army stands with the figures of the Russian player only', () => {
    // Only the Russian player may place the white army, so it goes down as Russia and is then handed back
    const white = (state: GameState) =>
      put(figuresOn(russians(state), C2, 'figures/redarmy'), CASH1981, 'figures/whitearmy', C2.column, C2.row)
    const noCivilization = (state: GameState): GameState => ({
      ...state,
      players: state.players.map((p) => (p.playerId === CASH1981 ? { ...p, civilization: null } : p)),
    })
    // Russia: the white army is theirs, so red army and white army fill the square
    const own = white(ready())
    expect(cellsOf(choiceOf(optionsOf(own), ARMY)?.squares)).not.toContainEqual([2, 1])
    // Not Russia: with no Russian player it is an enemy of all, and the square is blockaded, not full
    const notRussia = noCivilization(white(ready()))
    expect(buildSquareRefusal(notRussia, me(notRussia), cityOf(notRussia).id, ARMY, C2)).toBeUndefined()
    expect(choiceOf(optionsOf(notRussia), ARMY)?.squares.find((square) => square.label === 'C2')?.note).toMatch(/^An enemy figure stands here/)
  })
})

describe('blockade', () => {
  const blockaded = (state: GameState, assetId = 'figures/bluearmy'): GameState =>
    put(state, KARANDRAS1, assetId, C2.column, C2.row)

  it('a scout is not offered a blockaded square, an army is, with a note about the battle', () => {
    for (const enemy of ['figures/bluearmy', 'figures/bluescout']) {
      const state = blockaded(ready([], 3), enemy)
      const options = optionsOf(state)
      expect(cellsOf(choiceOf(options, SCOUT)?.squares), enemy).not.toContainEqual([2, 1])
      expect(buildSquareRefusal(state, me(state), cityOf(state).id, SCOUT, C2), enemy).toBe(
        'C2 is blockaded by an enemy figure.',
      )
      const square = choiceOf(options, ARMY)?.squares.find((candidate) => candidate.label === 'C2')
      expect(square?.note, enemy).toBe(
        'An enemy figure stands here. Placing the army here is not automated: resolve any battle or loot by hand.',
      )
      expect(buildSquareRefusal(state, me(state), cityOf(state).id, ARMY, C2), enemy).toBeUndefined()
    }
  })

  it('only the blockaded square carries a note', () => {
    const squares = choiceOf(optionsOf(blockaded(ready())), ARMY)?.squares ?? []
    expect(squares.filter((square) => square.note !== undefined).map((square) => square.label)).toEqual(['C2'])
  })

  it('an army put on a blockaded square says so in the line, and undo takes it away', () => {
    const state = blockaded(ready())
    const done = build(state, ARMY, C2)
    expect(lastLine(done)).toBe('cash1981 built an army in City B2 on square C2 (an enemy figure is there, so the outcome is to be settled by hand)')
    expect(mapCellOf(done.board, piecesOf(done, 'figures/redarmy')[0] as BoardPiece)).toEqual(C2)
    const undone = undoByVote(done, 'req-1')
    expect(piecesOf(undone, 'figures/redarmy')).toEqual([])
  })

  it('a blockaded scout square is also counted in the reason when it is the only one left', () => {
    const state = blockaded(withStats(ready([], 3), { stacking: 2 }))
    // Fill every other square with a hut so only the blockaded square and the water are in play
    let crowded = state
    for (const cell of [[0, 0], [1, 0], [0, 1], [0, 2], [1, 2], [2, 2]] as const) {
      crowded = put(crowded, KARANDRAS1, 'resources/hut', cell[0], cell[1])
    }
    expect(reasonOf(optionsOf(crowded), SCOUT)).toMatch(/1 square is blockaded/)
  })
})

describe('the supply', () => {
  it('six armies on the board, anywhere, use the supply up; five leave one', () => {
    const five = optionsOf(crowd(ready(), 'figures/redarmy', 5))
    expect(choiceOf(five, ARMY)).toBeDefined()
    const six = optionsOf(crowd(ready(), 'figures/redarmy', 6))
    expect(choiceOf(six, ARMY)).toBeUndefined()
    expect(reasonOf(six, ARMY)).toBe('None left in the supply: all 6 armies of your colour are on the board.')
  })

  it('two scouts use up the scouts, and the armies are not affected', () => {
    const state = crowd(ready([], 3), 'figures/redscout', 2)
    const options = optionsOf(state)
    expect(choiceOf(options, SCOUT)).toBeUndefined()
    expect(reasonOf(options, SCOUT)).toBe('None left in the supply: all 2 scouts of your colour are on the board.')
    expect(choiceOf(options, ARMY)).toBeDefined()
    expect(choiceOf(optionsOf(crowd(ready([], 3), 'figures/redscout', 1)), SCOUT)).toBeDefined()
  })

  it('a figure in a player area or on a city square counts as well', () => {
    // Two scouts, one on the map next to the city and one outside the map
    let state = put(ready([], 3), CASH1981, 'figures/redscout', 0, 0)
    const area = state.board.pieces.length
    state = unwrap(
      placePiece(state, { playerId: CASH1981, assetId: 'figures/redscout', x: 20, y: 20 }),
    )
    expect(state.board.pieces.length).toBe(area + 1)
    expect(choiceOf(optionsOf(state), SCOUT)).toBeUndefined()
  })

  it('the figures of other colours do not use up yours', () => {
    let state = ready([], 3)
    for (let index = 0; index < 6; index += 1) state = put(state, KARANDRAS1, 'figures/bluearmy', 6 + index, 8)
    expect(choiceOf(optionsOf(state), ARMY)).toBeDefined()
  })
})

describe('the unit decks', () => {
  it('an empty deck with nothing to reshuffle gives a reason', () => {
    const state = dropSheet(ready(), 'INFANTRY')
    const options = optionsOf(state)
    expect(choiceOf(options, unit('infantry'))).toBeUndefined()
    expect(reasonOf(options, unit('infantry'))).toBe('No infantry unit cards left in the deck or the discard pile.')
    // The other decks are not touched
    expect(choiceOf(options, unit('artillery'))).toBeDefined()
  })

  it('an empty deck with discards of the type is still offered, since the Draw button would reshuffle', () => {
    const state = discardSheet(ready(), 'MOUNTED')
    expect(state.items.some((item) => item.sheetName === 'MOUNTED')).toBe(false)
    expect(choiceOf(optionsOf(state), unit('mounted'))).toBeDefined()
    // Discards of another type do not help
    const wrong = discardSheet(dropSheet(ready(), 'MOUNTED'), 'ARTILLERY')
    expect(choiceOf(optionsOf(wrong), unit('mounted'))).toBeUndefined()
    expect(reasonOf(optionsOf(wrong), unit('mounted'))).toBe('No mounted unit cards left in the deck or the discard pile.')
  })

  it('building with only discards reshuffles them, as the Draw button does, and draws one', () => {
    const state = discardSheet(ready(), 'INFANTRY')
    const total = state.discardedItems.filter((item) => item.sheetName === 'INFANTRY').length
    const done = build(state, unit('infantry'))
    expect(handOf(done).filter((item) => item.sheetName === 'INFANTRY')).toHaveLength(1)
    expect(done.items.filter((item) => item.sheetName === 'INFANTRY')).toHaveLength(total - 1)
    expect(done.discardedItems.some((item) => item.sheetName === 'INFANTRY')).toBe(false)
    expect(done.log.some((entry) => entry.publicLog === 'Infantry reshuffled and put back in the deck')).toBe(true)
  })

  it('the card is the one the Draw button would take, off the top of the deck', () => {
    const state = ready()
    const top = firstCardOf(state, 'ARTILLERY')
    const done = build(state, unit('artillery'))
    expect(handOf(done).map((item) => item.id)).toContain(top.id)
    const drawn = unwrap(draw(state, { playerId: CASH1981, sheetName: 'ARTILLERY', confirmedOutOfTurn: true }))
    expect(handOf(drawn).map((item) => item.id)).toContain(top.id)
  })
})

// ---------------------------------------------------------------------------
// The action: figures
// ---------------------------------------------------------------------------

describe('building a figure', () => {
  it.each([
    ['army', 'figures/redarmy', 4, 'cash1981 built an army in City B2 on square C2'],
    ['scout', 'figures/redscout', 6, 'cash1981 built a scout in City B2 on square C2'],
  ] as const)('an %s is put centred on the square, named in the log, and pays nothing it does not owe', (kind, assetId, _cost, line) => {
    const before = ready([], 3)
    const done = build(before, { kind }, C2, 'req-1', kind === 'scout' ? true : undefined)
    const pieces = piecesOf(done, assetId)
    expect(pieces).toHaveLength(1)
    const piece = pieces[0] as BoardPiece
    const asset = findBoardAsset(assetId)
    expect(piece.width).toBe(asset?.width)
    expect(mapCellOf(done.board, piece)).toEqual(C2)
    expect(Math.abs(piece.x + piece.width / 2 - (C2.column + 0.5) * SQUARE_SIZE)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(piece.y + piece.height / 2 - (mapTop(done.board) + (C2.row + 0.5) * SQUARE_SIZE))).toBeLessThanOrEqual(0.5)
    expect(piece.placedBy).toBe(CASH1981)
    expect(lastLine(done)).toBe(kind === 'scout' ? `${line}, paying 3 trade for the missing production` : line)
    expect(me(done).stats.trade).toBe(kind === 'scout' ? 0 : 3)
    expect(done.log.at(-1)?.assistedActionId).toBe('req-1')
    expect(done.assistedActions).toHaveLength(1)
  })

  it('a figure takes the colour of its player', () => {
    const done = build(ready([], 0, 'Yellow'), ARMY, C2)
    expect(piecesOf(done, 'figures/yellowarmy')).toHaveLength(1)
    expect(piecesOf(done, 'figures/redarmy')).toEqual([])
  })

  it('a figure put on a square holding a friendly figure makes the next one see it full', () => {
    const first = build(ready(), ARMY, C2, 'req-1')
    const second = build(first, ARMY, C2, 'req-2')
    expect(refusal(tryBuild(second, ARMY, C2, 'req-3'))).toMatch(/^C2 already holds 2 of your figures, which is your stacking limit of 2\./)
  })

  it('one vote undo removes the figure again and writes the system line', () => {
    const done = build(ready(), ARMY, C2)
    const undone = undoByVote(done, 'req-1')
    expect(piecesOf(undone, 'figures/redarmy')).toEqual([])
    expect(undone.assistedActions[0]?.status).toBe('undone')
    expect(lastLine(undone)).toBe("System: cash1981's army on C2 was undone: the figure was removed")
  })

  it('refuses the undo when the figure has been moved off its square, and changes nothing', () => {
    const done = build(ready(), ARMY, C2)
    const piece = piecesOf(done, 'figures/redarmy')[0] as BoardPiece
    const moved = unwrap(
      movePiece(done, { playerId: KARANDRAS1, pieceId: piece.id, x: 3 * SQUARE_SIZE, y: mapTop(done.board) + 3 * SQUARE_SIZE }),
    )
    const pending = almostUndone(moved, 'req-1')
    const result = pending.last()
    expect(describeError(unwrapErr(result))).toBe('The army has left C2. Move it back first.')
    expect(unwrapErr(result).kind).toBe('ASSISTED_UNDO_BLOCKED')
    expect(piecesOf(pending.state, 'figures/redarmy')).toHaveLength(1)
    expect(pending.state.assistedActions[0]?.status).toBe('applied')
  })

  it('refuses the undo when the figure is gone', () => {
    const done = build(ready([], 3), SCOUT, C2, 'req-1', true)
    const piece = piecesOf(done, 'figures/redscout')[0] as BoardPiece
    const removed = unwrap(removePiece(done, { playerId: KARANDRAS1, pieceId: piece.id }))
    const result = almostUndone(removed, 'req-1').last()
    expect(describeError(unwrapErr(result))).toBe('The scout is no longer on the board, so the build cannot be undone.')
  })

  it('the board Undo cannot take the placed figure back alone', () => {
    const done = build(ready(), ARMY, C2)
    const result = undoLastBoardChange(done, CASH1981)
    expect(unwrapErr(result).kind).toBe('BOARD_UNDO_ASSISTED')
    expect(piecesOf(done, 'figures/redarmy')).toHaveLength(1)
  })

  it('a figure refuses a square that is not one of the legal ones, with the reason', () => {
    const state = ready()
    expect(refusal(tryBuild(state, ARMY, C1))).toBe(
      'C1 is water, and a figure may stand in water only with a revealed Sailing, Steam Power or Flight. Pick one of the highlighted squares.',
    )
    expect(refusal(tryBuild(state, ARMY, { column: 1, row: 1 }))).toBe(
      'B2 is not in the outskirts of that city. Pick one of the highlighted squares.',
    )
    expect(refusal(tryBuild(state, ARMY, { column: 40, row: 40 }))).toBe(
      'AO41 is not on the map. Pick one of the highlighted squares.',
    )
    // A label only for a plain number: a huge column is not turned into a long label
    expect(refusal(tryBuild(state, ARMY, { column: 5000, row: 1 }))).toBe(
      'That square is not on the map. Pick one of the highlighted squares.',
    )
    expect(piecesOf(state, 'figures/redarmy')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The action: units
// ---------------------------------------------------------------------------

describe('building a unit', () => {
  it.each([
    ['infantry', 'an infantry unit'],
    ['artillery', 'an artillery unit'],
    ['mounted', 'a mounted unit'],
  ] as const)('%s: the card goes to the hand hidden, the board is untouched and the line names the type only', (type, phrase) => {
    const before = ready()
    const top = firstCardOf(before, SHEET[type])
    const done = build(before, unit(type))

    const hand = handOf(done)
    expect(hand).toHaveLength(handOf(before).length + 1)
    const card = hand.find((item) => item.id === top.id)
    expect(card).toMatchObject({ ownerId: CASH1981, hidden: true, sheetName: SHEET[type] })
    expect(done.items.some((item) => item.id === top.id)).toBe(false)
    expect(done.items).toHaveLength(before.items.length - 1)
    // Nothing was put on the board or taken off it
    expect(done.board.pieces).toEqual(before.board.pieces)
    expect(done.board.history).toEqual(before.board.history)

    expect(done.log.find((entry) => entry.assistedActionId === 'req-1')?.publicLog).toBe(`cash1981 built ${phrase} in City B2`)
  })

  it('an aircraft unit is built with Flight', () => {
    const before = withOverride(ready(['Flight']), 20)
    const done = build(before, unit('aircraft'))
    expect(handOf(done).some((item) => item.sheetName === 'AIRCRAFT')).toBe(true)
    expect(done.log.find((entry) => entry.assistedActionId === 'req-1')?.publicLog).toBe('cash1981 built an aircraft unit in City B2')
  })

  it('a private line names the card for its owner, and carries no item an item undo could take back', () => {
    const before = ready()
    const top = firstCardOf(before, 'INFANTRY')
    const done = build(before, unit('infantry'))
    const added = done.log.slice(before.log.length)
    const secret = added.find((entry) => entry.privateLog !== '')
    expect(secret).toMatchObject({ playerId: CASH1981, item: null, publicLog: '' })
    expect(secret?.privateLog).toBe(`cash1981 drew ${itemName(top)} (Infantry) for an infantry unit built in City B2`)
    expect(added.every((entry) => entry.item === null)).toBe(true)
  })

  it('pays the trade of a rush, and the line says so', () => {
    const state = withOverride(ready([], 9), 2)
    // 3 short with a production of 2: 9 trade
    const choice = choiceOf(optionsOf(state), unit('mounted'))
    expect(choice).toMatchObject({ cost: 5, tradeToPay: 9 })
    const done = build(state, unit('mounted'), undefined, 'req-1', true)
    expect(me(done).stats.trade).toBe(0)
    expect(done.log.find((entry) => entry.assistedActionId === 'req-1')?.publicLog).toBe(
      'cash1981 built a mounted unit in City B2, paying 9 trade for the missing production',
    )
  })

  it('without the rush flag a unit that needs trade is refused, and nothing is drawn', () => {
    const state = withOverride(ready([], 9), 2)
    const result = tryBuild(state, unit('mounted'))
    expect(refusal(result)).toBe('Mounted unit costs 5 and City B2 has 2. Confirm paying 9 trade to build it.')
    expect(me(state).items).toEqual(handOf(state))
  })

  it('the Americans pay 2 production per 3 trade for a unit too', () => {
    const state = withOverride(americans(ready([], 6)), 2)
    expect(choiceOf(optionsOf(state), unit('infantry'))?.tradeToPay).toBe(6)
    expect(me(build(state, unit('infantry'), undefined, 'req-1', true)).stats.trade).toBe(0)
  })

  it('a unit has no square: a target is refused', () => {
    const state = ready()
    const result = performAssistedAction(state, {
      playerId: CASH1981,
      action: 'build',
      requestId: 'req-1',
      payload: { cityPieceId: cityOf(state).id, item: unit('infantry'), target: C2 } as unknown as BuildPayload,
    })
    expect(refusal(result)).toBe('Infantry unit is a card and has no square. Send no square.')
    expect(handOf(state)).toEqual(me(state).items)
  })

  it('a figure without a square is refused', () => {
    const state = ready()
    const result = performAssistedAction(state, {
      playerId: CASH1981,
      action: 'build',
      requestId: 'req-1',
      payload: { cityPieceId: cityOf(state).id, item: ARMY } as unknown as BuildPayload,
    })
    expect(refusal(result)).toBe('Pick one of the highlighted squares.')
  })

  it('an item that is not offered is refused with its reason', () => {
    const state = ready()
    expect(refusal(tryBuild(state, unit('aircraft')))).toBe('Aircraft unit cannot be built in City B2 now. Needs Flight.')
    expect(refusal(tryBuild(dropSheet(state, 'INFANTRY'), unit('infantry')))).toBe(
      'Infantry unit cannot be built in City B2 now. No infantry unit cards left in the deck or the discard pile.',
    )
    expect(refusal(tryBuild(state, SCOUT, C2))).toMatch(/^Scout figure cannot be built in City B2 now\. Costs 6 production/)
  })
})

describe('undoing a unit', () => {
  it('puts the same card back in the deck, refunds the trade and leaves the hand as it was', () => {
    const before = withOverride(ready([], 9), 2)
    const top = firstCardOf(before, 'MOUNTED')
    const done = build(before, unit('mounted'), undefined, 'req-1', true)
    const undone = undoByVote(done, 'req-1')

    expect(handOf(undone).some((item) => item.id === top.id)).toBe(false)
    expect(handOf(undone)).toEqual(handOf(before))
    // The card is back in the deck, and the deck holds exactly what it held before
    const back = undone.items.find((item) => item.id === top.id)
    expect(back).toMatchObject({ hidden: true, ownerId: null })
    expect(undone.items.map((item) => item.id).sort()).toEqual(before.items.map((item) => item.id).sort())
    expect(me(undone).stats.trade).toBe(9)
    expect(undone.assistedActions[0]?.status).toBe('undone')
    expect(lastLine(undone)).toBe("System: cash1981's mounted unit was undone: the card was put back in the deck, 9 trade returned")
  })

  it('puts the card back where it was and shuffles nothing, so a second build draws the same card', () => {
    const before = ready()
    const top = firstCardOf(before, 'INFANTRY')
    const index = before.items.findIndex((item) => item.id === top.id)
    const done = build(before, unit('infantry'))
    const undone = undoByVote(done, 'req-1')

    // The deck is exactly what it was: same cards, same order, and the card at its old index
    expect(undone.items).toEqual(before.items)
    expect(undone.items[index]?.id).toBe(top.id)
    // The other decks are not reshuffled either
    for (const sheet of ['GREAT_PERSON', 'CULTURE_I', 'CULTURE_II'] as const) {
      expect(undone.items.filter((item) => item.sheetName === sheet)).toEqual(
        before.items.filter((item) => item.sheetName === sheet),
      )
    }

    // Build and undo is no way to redraw: the second build takes the same card
    const again = build(undone, unit('infantry'), undefined, 'req-2')
    expect(handOf(again).map((item) => item.id)).toContain(top.id)
    expect(again.items).toEqual(done.items)
  })

  it('a repeated build and undo never reveals a second card', () => {
    let state = ready()
    const top = firstCardOf(state, 'INFANTRY')
    for (let round = 1; round <= 3; round += 1) {
      const done = build(state, unit('infantry'), undefined, `req-${round}`)
      expect(handOf(done).filter((item) => item.sheetName === 'INFANTRY').map((item) => item.id)).toEqual([top.id])
      state = undoByVote(done, `req-${round}`)
    }
    expect(state.items).toEqual(ready().items)
  })

  it('puts the card back at its index in the reshuffled deck when the discards were reshuffled during the build', () => {
    const before = discardSheet(ready(), 'INFANTRY')
    const done = build(before, unit('infantry'))
    const card = handOf(done).find((item) => item.sheetName === 'INFANTRY') as Item
    const undone = undoByVote(done, 'req-1')

    // The reshuffled deck stays reshuffled, and the card is back at the front of its sheet, where it was drawn from
    const index = undone.items.findIndex((item) => item.id === card.id)
    expect(index).toBeGreaterThanOrEqual(0)
    expect(undone.items.findIndex((item) => item.sheetName === 'INFANTRY')).toBe(index)
    expect(undone.items.filter((item) => item.id !== card.id)).toEqual(done.items)
    expect(undone.items[index]).toMatchObject({ hidden: true, ownerId: null })
    expect(undone.discardedItems.some((item) => item.sheetName === 'INFANTRY')).toBe(false)
    expect(handOf(undone)).toEqual(handOf(before))

    // The second build takes the same card
    const again = build(undone, unit('infantry'), undefined, 'req-2')
    expect(handOf(again).map((item) => item.id)).toContain(card.id)
    expect(again.items).toEqual(done.items)
  })

  it('refuses the undo when the card has left the hand, and changes nothing', () => {
    const done = build(ready(), unit('infantry'))
    const card = handOf(done).find((item) => item.sheetName === 'INFANTRY') as Item
    const gone: GameState = {
      ...done,
      players: done.players.map((p) =>
        p.playerId === CASH1981 ? { ...p, items: p.items.filter((item) => item.id !== card.id) } : p,
      ),
      discardedItems: [...done.discardedItems, card],
    }
    const pending = almostUndone(gone, 'req-1')
    const result = pending.last()
    expect(unwrapErr(result).kind).toBe('ASSISTED_UNDO_BLOCKED')
    expect(describeError(unwrapErr(result))).toBe('The infantry unit card is no longer in your hand, so the build cannot be undone.')
    expect(pending.state.assistedActions[0]?.status).toBe('applied')
  })

  it('writes no item log line, so the old item undo has no way to take the card back', () => {
    const done = build(ready(), unit('infantry'))
    expect(done.log.every((entry) => entry.item === null)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Rush and the Building Program, for figures and units too
// ---------------------------------------------------------------------------

describe('the Building Program marker', () => {
  const marked = (trade = 0): GameState => put(ready([], trade), CASH1981, 'markers/Building Program', 1, 1)

  it('is used up by a figure, restored by undo, and doubles the production', () => {
    const state = marked()
    expect(optionsOf(state).production).toBe(10)
    const marker = piecesOf(state, 'markers/Building Program')[0] as BoardPiece
    const done = build(state, SCOUT, C2)
    expect(piecesOf(done, 'markers/Building Program')).toEqual([])
    expect(lastLine(done)).toBe('cash1981 built a scout in City B2 on square C2, using up the Building Program marker')
    const undone = undoByVote(done, 'req-1')
    expect(piecesOf(undone, 'figures/redscout')).toEqual([])
    expect(piecesOf(undone, 'markers/Building Program')).toEqual([expect.objectContaining({ id: marker.id, x: marker.x, y: marker.y })])
  })

  it('is used up by a unit, restored by undo', () => {
    const state = marked()
    const marker = piecesOf(state, 'markers/Building Program')[0] as BoardPiece
    const done = build(state, unit('artillery'))
    expect(piecesOf(done, 'markers/Building Program')).toEqual([])
    expect(done.log.find((entry) => entry.assistedActionId === 'req-1')?.publicLog).toBe(
      'cash1981 built an artillery unit in City B2, using up the Building Program marker',
    )
    const undone = undoByVote(done, 'req-1')
    expect(handOf(undone)).toEqual(handOf(state))
    expect(piecesOf(undone, 'markers/Building Program')).toEqual([expect.objectContaining({ id: marker.id, x: marker.x, y: marker.y })])
    expect(lastLine(undone)).toBe(
      "System: cash1981's artillery unit was undone: the card was put back in the deck and the Building Program marker was put back",
    )
  })

  it('is used up whatever production number was used: a hand set number wins and still uses it up', () => {
    const state = withOverride(marked(9), 2)
    expect(optionsOf(state)).toMatchObject({ production: 2, productionSource: 'override' })
    const done = build(state, unit('infantry'), undefined, 'req-1', true)
    expect(piecesOf(done, 'markers/Building Program')).toEqual([])
    expect(me(done).stats.trade).toBe(0)
  })

  it('the board Undo cannot take the marker removal back alone', () => {
    const done = build(marked(), unit('infantry'))
    // The last board change is the removal of the marker
    expect(unwrapErr(undoLastBoardChange(done, CASH1981)).kind).toBe('BOARD_UNDO_ASSISTED')
    expect(piecesOf(done, 'markers/Building Program')).toEqual([])
  })

  it('a rush for a figure is refunded by undo with the marker', () => {
    const state = withOverride(marked(9), 2)
    // A scout is 4 short with 2: 12 trade, so only an army (2 short, 6 trade) with 9 trade
    const done = build(state, ARMY, C2, 'req-1', true)
    expect(me(done).stats.trade).toBe(3)
    const undone = undoByVote(done, 'req-1')
    expect(me(undone).stats.trade).toBe(9)
    expect(piecesOf(undone, 'markers/Building Program')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

describe('stale and duplicate requests, and who may build', () => {
  it('the same request id twice builds once', () => {
    const state = ready()
    const once = build(state, unit('infantry'))
    const twice = unwrap(tryBuild(once, unit('infantry'), undefined, 'req-1'))
    expect(twice).toBe(once)
    expect(handOf(twice)).toHaveLength(handOf(state).length + 1)

    const figure = build(state, ARMY, C2)
    expect(piecesOf(unwrap(tryBuild(figure, ARMY, C2, 'req-1')), 'figures/redarmy')).toHaveLength(1)
  })

  it('a request id used by another action or player is refused', () => {
    const done = build(ready(), unit('infantry'))
    const other = performAssistedAction(done, {
      playerId: KARANDRAS1,
      action: 'build',
      requestId: 'req-1',
      payload: payloadFor(done, unit('infantry')),
    })
    expect(refusal(other)).toBe('This request id was already used.')
  })

  it('a unit whose deck ran out since the player looked is refused, and nothing changes', () => {
    const looked = ready()
    const payload = payloadFor(looked, unit('infantry'))
    const later = dropSheet(looked, 'INFANTRY')
    const result = performAssistedAction(later, { playerId: CASH1981, action: 'build', requestId: 'req-1', at: AT, payload })
    expect(refusal(result)).toMatch(/No infantry unit cards left/)
    expect(handOf(later)).toEqual(handOf(looked))
  })

  it('a rush whose trade was spent since the player looked is refused', () => {
    const looked = ready([], 3)
    const payload = payloadFor(looked, SCOUT, C2, true)
    const later = withStats(looked, { trade: 0 })
    const result = performAssistedAction(later, { playerId: CASH1981, action: 'build', requestId: 'req-1', at: AT, payload })
    expect(refusal(result)).toMatch(/^Scout figure cannot be built in City B2 now\. Costs 6 production and City B2 has 5/)
    expect(piecesOf(later, 'figures/redscout')).toEqual([])
  })

  it('a square that filled up since the player looked is refused with the reason', () => {
    const looked = ready()
    const payload = payloadFor(looked, ARMY, C2)
    const later = put(put(looked, CASH1981, 'figures/redarmy', 2, 1), CASH1981, 'figures/redscout', 2, 1)
    const result = performAssistedAction(later, { playerId: CASH1981, action: 'build', requestId: 'req-1', at: AT, payload })
    expect(refusal(result)).toBe('C2 already holds 2 of your figures, which is your stacking limit of 2. Pick one of the highlighted squares.')
  })

  it('outside City Management neither a figure nor a unit is built', () => {
    const closed = learn(scene(), 'Flight')
    for (const [item, at] of [[ARMY, C2], [unit('infantry'), undefined]] as const) {
      const result = tryBuild(closed, item, at)
      expect(refusal(result)).toBe('Only available during your open City Management phase.')
    }
    expect(handOf(closed)).toEqual(me(closed).items)
  })

  it('another player cannot build with the city of the first one', () => {
    const own = put(ready(), KARANDRAS1, 'cities/bluecity2', 8, 8)
    const state = openTurn(own, KARANDRAS1)
    // Karandras has a city of his own, and names Cash's
    const result = performAssistedAction(state, {
      playerId: KARANDRAS1,
      action: 'build',
      requestId: 'req-1',
      payload: payloadFor(state, unit('infantry')),
    })
    expect(refusal(result)).toBe('That city is not yours, or it is no longer on the map.')
    expect(handOf(state, KARANDRAS1)).toEqual(me(own, KARANDRAS1).items)
    // Without a city he cannot build at all
    const none = tryBuild(openTurn(ready(), KARANDRAS1), unit('infantry'), undefined, 'req-2', undefined, KARANDRAS1)
    expect(refusal(none)).toBe('You have no city on the map to build with.')
  })

  it('a spectator, who is no player, cannot build', () => {
    const state = ready()
    const result = tryBuild(state, unit('infantry'), undefined, 'req-1', undefined, 'someone-else')
    expect(unwrapErr(result).kind).toBe('NO_ACCESS')
  })

  it('every refusal leaves the game exactly as it was', () => {
    const state = ready()
    const snapshot = JSON.stringify(state)
    tryBuild(state, unit('aircraft'))
    tryBuild(state, ARMY, C1)
    tryBuild(state, SCOUT, C2)
    tryBuild(dropSheet(state, 'INFANTRY'), unit('infantry'))
    expect(JSON.stringify(state)).toBe(snapshot)
  })
})

// ---------------------------------------------------------------------------
// Hidden information
// ---------------------------------------------------------------------------

describe('hidden information', () => {
  /** The same game twice, with a different infantry card on top of the deck. */
  function twoDecks(): { readonly first: GameState; readonly second: GameState; readonly a: Item; readonly b: Item } {
    const base = ready()
    const infantry = base.items.filter((item) => item.sheetName === 'INFANTRY')
    const a = infantry[0] as Item
    // A card that differs from the first in what it shows: same sheet, another name or stats
    const b = infantry.find((item) => itemName(item) !== itemName(a)) as Item
    expect(b).toBeDefined()
    const swapped: GameState = {
      ...base,
      items: base.items.map((item) => (item.id === a.id ? b : item.id === b.id ? a : item)),
    }
    expect(firstCardOf(swapped, 'INFANTRY').id).toBe(b.id)
    return { first: base, second: swapped, a, b }
  }

  it('the drawn card is in no other viewer\'s projection, nor in the public line or the public record', () => {
    const { first, a } = twoDecks()
    const done = build(first, unit('infantry'))
    const secret = [a.id, `${itemName(a)} (Infantry)`, `drew ${itemName(a)}`]
    for (const viewerId of [KARANDRAS1, ITCHI, CHUL, 'spectator']) {
      const json = JSON.stringify(toPlayerView(done, viewerId))
      for (const text of secret) expect(json, `${viewerId} must not see ${text}`).not.toContain(text)
    }
    const line = done.log.find((entry) => entry.assistedActionId === 'req-1')
    expect(line?.publicLog).toBe('cash1981 built an infantry unit in City B2')
    for (const text of secret) expect(line?.publicLog).not.toContain(text)
    const own = JSON.stringify(toPlayerView(done, CASH1981))
    expect(own).toContain(a.id)
  })

  it('the public record carries the type in its text and nothing of the card', () => {
    const { first, a } = twoDecks()
    const done = build(first, unit('infantry'))
    const view = toPlayerView(done, KARANDRAS1)
    expect(view.assistedActions).toEqual([
      expect.objectContaining({ kind: 'build', label: 'Build', status: 'applied', text: 'cash1981 built an infantry unit in City B2' }),
    ])
    const record = JSON.stringify(view.assistedActions)
    expect(record).not.toContain(a.id)
    expect(record).not.toContain('"effect"')
    expect(record).not.toContain('"card"')
    // The deck position the undo needs is server side only
    expect(record).not.toContain('"index"')
    expect(record).not.toContain('"reshuffled"')
    expect(JSON.stringify(view)).not.toContain('"reshuffled"')
  })

  it('another player\'s projection does not depend on which card was drawn', () => {
    const { first, second } = twoDecks()
    const one = build(first, unit('infantry'))
    const two = build(second, unit('infantry'))
    // The two games drew different cards, and every other player sees exactly the same
    expect(handOf(one).map((item) => item.id)).not.toEqual(handOf(two).map((item) => item.id))
    for (const viewerId of [KARANDRAS1, ITCHI, CHUL, 'spectator']) {
      expect(JSON.stringify(toPlayerView(two, viewerId)), viewerId).toBe(JSON.stringify(toPlayerView(one, viewerId)))
    }
  })

  it('another player\'s projection changes only by the public line, the record, the deck count and the unit count', () => {
    const before = ready()
    const after = build(before, unit('mounted'))
    const was = toPlayerView(before, KARANDRAS1)
    const now = toPlayerView(after, KARANDRAS1)

    expect(now.log.length).toBe(was.log.length + 2)
    // The second new line is the private one, which another viewer sees in its public form: empty
    expect(now.log.at(-1)).toMatchObject({ publicLog: '' })
    expect(JSON.stringify(now.log.at(-1))).not.toContain('drew')
    expect(now.assistedActions).toHaveLength(1)
    expect(now.numberOfItemsInDeck).toBe(was.numberOfItemsInDeck - 1)

    const cash = (view: typeof now) => view.opponents.find((player) => player.playerId === CASH1981)
    expect(cash(now)?.numberOfItemsInHand).toBe((cash(was)?.numberOfItemsInHand ?? 0) + 1)
    // Everything else, the other hands and the board among it, is as it was
    const rest = (view: typeof now) =>
      JSON.stringify({
        ...view,
        log: undefined,
        assistedActions: undefined,
        numberOfItemsInDeck: undefined,
        rev: undefined,
        opponents: view.opponents.filter((player) => player.playerId !== CASH1981),
      })
    expect(rest(now)).toBe(rest(was))
  })

  it('the undo line says no card and the private line stays with its owner', () => {
    const { first, a } = twoDecks()
    const undone = undoByVote(build(first, unit('infantry')), 'req-1')
    for (const viewerId of [KARANDRAS1, ITCHI, CHUL, 'spectator']) {
      const json = JSON.stringify(toPlayerView(undone, viewerId))
      expect(json).not.toContain(a.id)
      expect(json).not.toContain(itemName(a))
    }
  })

  it('a figure shows others the same as a building does: the line and the piece', () => {
    const done = build(ready(), ARMY, C2)
    const view = toPlayerView(done, KARANDRAS1)
    expect(JSON.stringify(view)).not.toContain('"effect"')
    expect(view.assistedActions).toEqual([
      expect.objectContaining({ kind: 'build', text: 'cash1981 built an army in City B2 on square C2' }),
    ])
    expect(view.board.pieces.some((piece) => piece.assetId === 'figures/redarmy')).toBe(true)
  })

  it('the options with their units and reasons go to the owner only', () => {
    const state = dropSheet(ready(), 'INFANTRY')
    const owner = JSON.stringify(toPlayerView(state, CASH1981).you?.buildOptions)
    expect(owner).toContain('No infantry unit cards left')
    for (const viewerId of [KARANDRAS1, 'spectator']) {
      const json = JSON.stringify(toPlayerView(state, viewerId))
      expect(json).not.toContain('No infantry unit cards left')
      expect(json).not.toContain('units/infantry')
      expect(json).not.toContain('"placement"')
    }
  })
})
