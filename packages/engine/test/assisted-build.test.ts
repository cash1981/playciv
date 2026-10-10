/**
 * The Build action for buildings (task `assisted-build`, issue #264 part 2): what
 * a city may build, the action that builds it, and the undo vote that takes it
 * back.
 *
 * Every test builds the same scene. Cash is Red on Monarchy (so the Despotism
 * bonus stays out of the numbers) and the America tile lies in the first map slot
 * with a red city on its square B2. The America grid, as printed (row by row,
 * column 0 to 3):
 *
 *   row 0: mountain  mountain  water      grassland
 *   row 1: forest    mountain  grassland  water
 *   row 2: desert    desert    mountain   forest
 *   row 3: water     desert    water      forest
 *
 * so the eight outskirts squares of a city on B2 are: A1 mountain, B1 mountain,
 * C1 water, A2 forest, C2 grassland, A3 desert, B3 desert and C3 mountain. Each
 * of the five terrains is there once or more, and the estimate is 3 mountains at 1
 * plus a forest at 2: 5 production.
 */

import { describe, expect, it } from 'vitest'

import {
  movePiece,
  placePiece,
  removePiece,
  setCityProductionOverride,
  undoLastBoardChange,
} from '../src/actions/board.js'
import { chooseTech, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { performAssistedAction } from '../src/assisted.js'
import { mapCellOf } from '../src/blockade.js'
import { SQUARE_SIZE, findBoardAsset, mapTop, piecesAtStep, slotOrigin } from '../src/board.js'
import type { BoardPiece, Rotation } from '../src/board.js'
import { buildOptionsOf, buildSquareRefusal } from '../src/build-options.js'
import type { BuildPayload, CityBuildOptions } from '../src/build-options.js'
import { cityProductionsOf } from '../src/city-production.js'
import type { CivItem } from '../src/item.js'
import { describeError } from '../src/errors.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { findPlayer } from '../src/state.js'
import type { GameState, Playerhand } from '../src/state.js'
import { tileTerrainGrid } from '../src/terrain.js'

import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-10-09T10:00:00.000Z'
const OTHERS = [KARANDRAS1, ITCHI, CHUL]

const LIBRARY = 'buildings/library'
const UNIVERSITY = 'buildings/university'
const MARKET = 'buildings/market'
const HARBOR = 'buildings/harbor'

/** The only grassland square around B2, so the only square a Library may go on. */
const C2 = { column: 2, row: 1 }

/** Cash is Red, Karandras Blue, Itchi Green, Chul Yellow. Cash is on Monarchy. */
function game(): GameState {
  const colors: Record<string, string> = {
    [CASH1981]: 'Red',
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

/** A red metropolis with its image centre on the boundary between its two city squares. */
function putMetropolis(state: GameState, column: number, row: number, rotation: Rotation): GameState {
  const assetId = 'cities/redmetropolis2'
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`no asset ${assetId}`)
  const horizontal = rotation === 0 || rotation === 180
  const centerX = (column + (horizontal ? 0 : 0.5)) * SQUARE_SIZE
  const centerY = mapTop(state.board) + (row + (horizontal ? 0.5 : 0)) * SQUARE_SIZE
  return unwrap(
    placePiece(state, {
      playerId: CASH1981,
      assetId,
      x: centerX - asset.width / 2,
      y: centerY - asset.height / 2,
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

/** The America tile and a red city on B2, City Management closed. */
const scene = (): GameState => put(withAmerica(game()), CASH1981, 'cities/redcity2', 1, 1)

/** Techs chosen and revealed. */
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

/** The scene with City Management open, the techs revealed and the trade in hand. */
function ready(techs: readonly string[] = [], trade = 0): GameState {
  return withTrade(openTurn(learn(scene(), ...techs)), trade)
}

function withTrade(state: GameState, trade: number, playerId = CASH1981): GameState {
  return {
    ...state,
    players: state.players.map((p) => (p.playerId === playerId ? { ...p, stats: { ...p.stats, trade } } : p)),
  }
}

const me = (state: GameState, playerId = CASH1981): Playerhand => {
  const found = findPlayer(state, playerId)
  if (found === undefined) throw new Error(`no player ${playerId}`)
  return found
}

const cityOf = (state: GameState, index = 0): BoardPiece => {
  const city = state.board.pieces.filter((piece) => piece.category === 'city')[index]
  if (city === undefined) throw new Error('no city on the board')
  return city
}

const optionsOf = (state: GameState, index = 0): CityBuildOptions => {
  const found = buildOptionsOf(state, me(state))[index]
  if (found === undefined) throw new Error('no build options')
  return found
}

const choiceFor = (options: CityBuildOptions, assetId: string) =>
  options.choices.find((candidate) => candidate.assetId === assetId)

const reasonFor = (options: CityBuildOptions, assetId: string): string =>
  options.unavailable.find((candidate) => candidate.assetId === assetId)?.reason ?? ''

const cellsOf = (squares: readonly { readonly column: number; readonly row: number }[] | undefined) =>
  (squares ?? []).map((square) => [square.column, square.row])

function payloadFor(
  state: GameState,
  assetId: string,
  at: { readonly column: number; readonly row: number },
  rush?: boolean,
): BuildPayload {
  return {
    cityPieceId: cityOf(state).id,
    item: { kind: 'building', assetId },
    target: at,
    ...(rush === undefined ? {} : { rush }),
  }
}

const tryBuild = (
  state: GameState,
  assetId: string,
  at: { readonly column: number; readonly row: number },
  requestId = 'req-1',
  rush?: boolean,
  playerId = CASH1981,
) =>
  performAssistedAction(state, {
    playerId,
    action: 'build',
    requestId,
    at: AT,
    payload: payloadFor(state, assetId, at, rush),
  })

const build = (
  state: GameState,
  assetId: string,
  at: { readonly column: number; readonly row: number },
  requestId = 'req-1',
  rush?: boolean,
): GameState => unwrap(tryBuild(state, assetId, at, requestId, rush))

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

const americans = (state: GameState): GameState => ({
  ...state,
  players: state.players.map((p) =>
    p.playerId === CASH1981 ? { ...p, civilization: { kind: 'civ', name: 'Americans' } as unknown as CivItem } : p,
  ),
})

const withOverride = (state: GameState, value: number | null): GameState =>
  unwrap(setCityProductionOverride(state, { playerId: CASH1981, pieceId: cityOf(state).id, value }))

/** Fills a supply by putting pieces far from the city, where nothing else is. */
function exhaust(state: GameState, assetIds: readonly string[]): GameState {
  return assetIds.reduce((next, assetId, index) => put(next, KARANDRAS1, assetId, 6 + index, 8), state)
}

// ---------------------------------------------------------------------------
// What a city may build
// ---------------------------------------------------------------------------

describe('the unlock', () => {
  it('without a tech nothing is built, and each building says which tech it needs', () => {
    const options = optionsOf(ready())
    expect(options.status).toBe('ready')
    expect(options.choices).toEqual([])
    expect(options.unavailable).toHaveLength(16)
    expect(reasonFor(options, LIBRARY)).toBe('Needs Writing.')
    expect(reasonFor(options, 'buildings/militarydock')).toBe('Needs Military Science.')
    expect(reasonFor(options, 'buildings/tradingpost')).toBe('Needs Code of Laws.')
  })

  it('a revealed tech unlocks its building, with the cost, the squares and nothing to pay', () => {
    const options = optionsOf(ready(['Writing']))
    const library = choiceFor(options, LIBRARY)
    expect(library).toEqual({
      assetId: LIBRARY,
      label: 'Library',
      cost: 5,
      tradeToPay: 0,
      squares: [{ ...C2, label: 'C2' }],
    })
    expect(options.unavailable.some((entry) => entry.assetId === LIBRARY)).toBe(false)
  })

  it('a tech that is chosen but not revealed unlocks nothing, and says so', () => {
    const hidden = openTurn(unwrap(chooseTech(scene(), { playerId: CASH1981, techName: 'Writing' })))
    const options = optionsOf(hidden)
    expect(options.choices).toEqual([])
    expect(reasonFor(options, LIBRARY)).toBe('Needs Writing. Writing is chosen but not revealed yet.')
  })

  it('every unlock of the human tech sheet builds its building', () => {
    const unlocks: Readonly<Record<string, string>> = {
      'Code of Laws': 'buildings/tradingpost',
      Currency: 'buildings/market',
      Metalworking: 'buildings/barracks',
      Navigation: 'buildings/harbor',
      Philosophy: 'buildings/temple',
      Pottery: 'buildings/granary',
      Writing: LIBRARY,
      Navy: 'buildings/shipyard',
      Construction: 'buildings/workshop',
      Engineering: 'buildings/aqueduct',
      'Printing Press': UNIVERSITY,
      Banking: 'buildings/bank',
      'Military Science': 'buildings/academy',
      Railroad: 'buildings/ironmine',
      Theology: 'buildings/cathedral',
    }
    for (const [tech, assetId] of Object.entries(unlocks)) {
      const options = optionsOf(ready([tech], 99))
      expect(choiceFor(options, assetId), `${tech} unlocks ${assetId}`).toBeDefined()
    }
  })
})

describe('the basic and the upgraded form', () => {
  it('the upgraded form replaces the basic one once its tech is known', () => {
    const options = optionsOf(ready(['Writing', 'Printing Press'], 9))
    expect(choiceFor(options, LIBRARY)).toBeUndefined()
    expect(reasonFor(options, LIBRARY)).toBe(
      'Replaced by the University, which you have unlocked. Only the upgraded form can be built now.',
    )
    expect(choiceFor(options, UNIVERSITY)).toBeDefined()
  })

  it('the tech of the upgraded form is enough, the basic form tech is not needed', () => {
    const options = optionsOf(ready(['Printing Press'], 9))
    expect(choiceFor(options, UNIVERSITY)).toBeDefined()
    expect(reasonFor(options, LIBRARY)).toMatch(/^Replaced by the University/)
  })

  it('Military Science unlocks the Academy and the Military Dock without Metalworking or Navy', () => {
    const options = optionsOf(ready(['Military Science'], 99))
    expect(choiceFor(options, 'buildings/academy')).toBeDefined()
    expect(choiceFor(options, 'buildings/militarydock')).toBeDefined()
    expect(reasonFor(options, 'buildings/barracks')).toMatch(/^Replaced by the Academy/)
    expect(reasonFor(options, 'buildings/shipyard')).toMatch(/^Replaced by the Military Dock/)
  })

  it('every basic form is replaced by its upgrade, and Harbor and Trading Post have no upgrade', () => {
    const pairs: readonly (readonly [string, string, string])[] = [
      ['buildings/granary', 'buildings/aqueduct', 'Engineering'],
      [LIBRARY, UNIVERSITY, 'Printing Press'],
      [MARKET, 'buildings/bank', 'Banking'],
      ['buildings/temple', 'buildings/cathedral', 'Theology'],
      ['buildings/barracks', 'buildings/academy', 'Military Science'],
      ['buildings/workshop', 'buildings/ironmine', 'Railroad'],
      ['buildings/shipyard', 'buildings/militarydock', 'Military Science'],
    ]
    for (const [basic, upgraded, tech] of pairs) {
      const options = optionsOf(ready([tech], 99))
      expect(reasonFor(options, basic), basic).toMatch(/^Replaced by the/)
      expect(choiceFor(options, upgraded), upgraded).toBeDefined()
    }
    const single = optionsOf(ready(['Navigation', 'Code of Laws'], 99))
    expect(choiceFor(single, HARBOR)).toBeDefined()
    expect(choiceFor(single, 'buildings/tradingpost')).toBeDefined()
  })
})

describe('the supply', () => {
  it('a used up supply keeps the building out of the choices, and the two forms share one pool', () => {
    // 5 Libraries and 1 University are the 6 pieces of the shared pool
    const used = exhaust(ready(['Writing', 'Printing Press'], 99), [
      LIBRARY, LIBRARY, LIBRARY, LIBRARY, LIBRARY, UNIVERSITY,
    ])
    const options = optionsOf(used)
    expect(choiceFor(options, UNIVERSITY)).toBeUndefined()
    expect(reasonFor(options, UNIVERSITY)).toBe(
      'None left in the supply: all 6 are on the board (the basic and the upgraded form share one supply).',
    )
    // The Harbor has a pool of its own
    expect(choiceFor(optionsOf(exhaust(ready(['Navigation'], 99), [LIBRARY, LIBRARY, LIBRARY, LIBRARY, LIBRARY, UNIVERSITY])), HARBOR)).toBeDefined()
  })

  it('a building with one piece left is still a choice', () => {
    const almost = exhaust(ready(['Writing']), [LIBRARY, LIBRARY, LIBRARY, LIBRARY, LIBRARY])
    expect(choiceFor(optionsOf(almost), LIBRARY)).toBeDefined()
  })
})

describe('one limited building per city', () => {
  const limitedTechs = ['Currency', 'Philosophy', 'Metalworking', 'Banking', 'Theology', 'Military Science']

  it('a Temple in the outskirts, whoever put it there, rules out all six limited buildings', () => {
    // Karandras put it on A2, a square of Cash's outskirts
    const state = put(ready([...limitedTechs, 'Writing'], 99), KARANDRAS1, 'buildings/temple', 0, 1)
    const options = optionsOf(state)
    for (const assetId of [MARKET, 'buildings/bank', 'buildings/temple', 'buildings/cathedral', 'buildings/barracks', 'buildings/academy']) {
      expect(choiceFor(options, assetId), assetId).toBeUndefined()
    }
    expect(reasonFor(options, 'buildings/bank')).toBe(
      'City B2 already has a Temple. A city may hold only one of Market, Bank, Temple, Cathedral, Barracks and Academy.',
    )
    // A building that is not limited is not affected
    expect(choiceFor(options, LIBRARY)).toBeDefined()
  })

  it('a limited building outside the outskirts does not count', () => {
    const state = put(ready(['Currency'], 99), KARANDRAS1, 'buildings/temple', 3, 3)
    expect(choiceFor(optionsOf(state), MARKET)).toBeDefined()
  })

  it('the limit is per city: the other city of the same player may still build one', () => {
    // A second city far from the first has an empty outskirts
    const state = put(put(ready(['Currency'], 99), KARANDRAS1, 'buildings/temple', 0, 1), CASH1981, 'cities/redcity2', 9, 9)
    const [first, second] = buildOptionsOf(state, me(state))
    expect(choiceFor(first as CityBuildOptions, MARKET)).toBeUndefined()
    expect(reasonFor(second as CityBuildOptions, MARKET)).not.toMatch(/already has/)
  })
})

describe('the squares', () => {
  it('each building goes on its own terrain: grassland, water, desert, mountain, and any but water', () => {
    const options = optionsOf(
      ready(['Writing', 'Navigation', 'Code of Laws', 'Construction', 'Currency'], 99),
    )
    expect(cellsOf(choiceFor(options, LIBRARY)?.squares)).toEqual([[2, 1]])
    expect(cellsOf(choiceFor(options, HARBOR)?.squares)).toEqual([[2, 0]])
    expect(cellsOf(choiceFor(options, 'buildings/tradingpost')?.squares)).toEqual([[0, 2], [1, 2]])
    expect(cellsOf(choiceFor(options, 'buildings/workshop')?.squares)).toEqual([[0, 0], [1, 0], [2, 2]])
    // Not C1, which is water
    expect(cellsOf(choiceFor(options, MARKET)?.squares)).toEqual([[0, 0], [1, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]])
  })

  it('a square carries its label, and the centre of the city is never one', () => {
    const squares = choiceFor(optionsOf(ready(['Currency'], 99)), MARKET)?.squares ?? []
    expect(squares.map((square) => square.label)).toEqual(['A1', 'B1', 'A2', 'C2', 'A3', 'B3', 'C3'])
    expect(squares.some((square) => square.column === 1 && square.row === 1)).toBe(false)
  })

  it('a square with a building, a wonder or a great person is taken, whoever put it there', () => {
    const base = ready(['Writing'], 99)
    for (const assetId of ['buildings/granary', 'wonders/pyramids', 'great people/scientist']) {
      const taken = put(base, KARANDRAS1, assetId, C2.column, C2.row)
      const options = optionsOf(taken)
      expect(choiceFor(options, LIBRARY), assetId).toBeUndefined()
      expect(reasonFor(options, LIBRARY), assetId).toBe(
        'No legal square. A Library needs grassland: 7 squares have the wrong terrain, 1 square is taken.',
      )
    }
  })

  it('an enemy figure blockades its square, a friendly one does not', () => {
    const base = ready(['Writing'], 99)
    for (const figure of ['figures/bluearmy', 'figures/bluescout']) {
      const blocked = put(base, KARANDRAS1, figure, C2.column, C2.row)
      expect(choiceFor(optionsOf(blocked), LIBRARY), figure).toBeUndefined()
      expect(reasonFor(optionsOf(blocked), LIBRARY), figure).toMatch(/1 square is blockaded/)
    }
    const friendly = put(base, CASH1981, 'figures/redarmy', C2.column, C2.row)
    expect(cellsOf(choiceFor(optionsOf(friendly), LIBRARY)?.squares)).toEqual([[2, 1]])
  })

  it('a city centre of another city is not a square', () => {
    const base = ready(['Writing'], 99)
    for (const owner of [CASH1981, KARANDRAS1]) {
      const colour = owner === CASH1981 ? 'red' : 'blue'
      const crowded = put(base, owner, `cities/${colour}city2`, C2.column, C2.row)
      expect(choiceFor(optionsOf(crowded), LIBRARY), colour).toBeUndefined()
      expect(reasonFor(optionsOf(crowded), LIBRARY), colour).toMatch(/1 square is a city centre/)
    }
  })

  it('a city centre of any of the five colours is not a square, with the player\'s own colour among them', () => {
    const base = ready(['Writing'], 99)
    for (const colour of ['blue', 'green', 'purple', 'red', 'yellow']) {
      const crowded = put(base, KARANDRAS1, `cities/${colour}city2`, C2.column, C2.row)
      expect(choiceFor(optionsOf(crowded), LIBRARY), colour).toBeUndefined()
      expect(reasonFor(optionsOf(crowded), LIBRARY), colour).toMatch(/1 square is a city centre/)
    }
    // A metropolis of another colour holds two centre squares
    const metropolis = unwrap(
      placePiece(base, {
        playerId: KARANDRAS1,
        assetId: 'cities/bluemetropolis2',
        x: 3 * SQUARE_SIZE - (findBoardAsset('cities/bluemetropolis2')?.width ?? 0) / 2,
        y: mapTop(base.board) + 1.5 * SQUARE_SIZE - (findBoardAsset('cities/bluemetropolis2')?.height ?? 0) / 2,
        rotation: 0,
      }),
    )
    expect(reasonFor(optionsOf(metropolis), LIBRARY)).toMatch(/city centre/)
  })

  it('a city-state in the outskirts holds its square', () => {
    const crowded = put(ready(['Writing'], 99), KARANDRAS1, 'city-states/cs1', C2.column, C2.row)
    expect(choiceFor(optionsOf(crowded), LIBRARY)).toBeUndefined()
  })

  it('a square whose terrain is not known is not a square', () => {
    // No tile lies under column 5, so every outskirts square there is unknown
    const state = put(withTrade(openTurn(learn(withAmerica(game()), 'Currency')), 99), CASH1981, 'cities/redcity2', 5, 1)
    const options = optionsOf(state)
    expect(choiceFor(options, MARKET)).toBeUndefined()
    expect(reasonFor(options, MARKET)).toBe('No legal square. A Market needs any terrain except water: 8 squares have unknown terrain.')
  })

  it('squares off the map are not squares at all', () => {
    // A city on A1 has outskirts to the left and above, off the map
    const state = withTrade(openTurn(learn(put(withAmerica(game()), CASH1981, 'cities/redcity2', 0, 0), 'Currency')), 99)
    const squares = choiceFor(optionsOf(state), MARKET)?.squares ?? []
    expect(squares.map((square) => square.label)).toEqual(['B1', 'A2', 'B2'])
    expect(squares.every((square) => square.column >= 0 && square.row >= 0)).toBe(true)
  })

  it('names the wrong terrain when nothing else is in the way', () => {
    const options = optionsOf(ready(['Navigation', 'Code of Laws'], 99))
    expect(cellsOf(choiceFor(options, HARBOR)?.squares)).toEqual([[2, 0]])
    // The Harbor's only square taken: the reason counts the others as wrong terrain
    const taken = optionsOf(put(ready(['Navigation'], 99), KARANDRAS1, 'buildings/granary', 2, 0))
    expect(reasonFor(taken, HARBOR)).toBe('No legal square. A Harbor needs water: 7 squares have the wrong terrain, 1 square is taken.')
  })

  it('buildSquareRefusal says why one square does not work', () => {
    const state = put(ready(['Currency'], 99), KARANDRAS1, 'buildings/granary', 0, 0)
    const cash = me(state)
    const id = cityOf(state).id
    expect(buildSquareRefusal(state, cash, id, MARKET, { column: 1, row: 0 })).toBeUndefined()
    expect(buildSquareRefusal(state, cash, id, MARKET, { column: 0, row: 0 })).toBe('A1 is already taken: Granary stands there.')
    expect(buildSquareRefusal(state, cash, id, MARKET, { column: 2, row: 0 })).toBe('C1 is water, and a Market needs any terrain except water.')
    expect(buildSquareRefusal(state, cash, id, MARKET, { column: 1, row: 1 })).toBe('B2 is not in the outskirts of that city.')
    expect(buildSquareRefusal(state, cash, id, MARKET, { column: 3, row: 3 })).toBe('D4 is not in the outskirts of that city.')
    expect(buildSquareRefusal(state, cash, 'nope', MARKET, { column: 1, row: 0 })).toBeUndefined()
  })
})

describe('both metropolis orientations and a walled city', () => {
  const america = tileTerrainGrid('tiles/america') ?? []

  /** Every square of the block that is not a centre and not water, as the Market's squares must be. */
  const expectedMarket = (columns: readonly number[], rows: readonly number[], centres: readonly (readonly [number, number])[]) =>
    rows.flatMap((row) =>
      columns
        .filter((column) => !centres.some(([c, r]) => c === column && r === row))
        .filter((column) => america[row]?.[column] !== 'water')
        .map((column) => [column, row]),
    )

  it('a horizontal metropolis has ten outskirts squares around its two centres', () => {
    // Centres B2 and C2 (rotation 0 puts the second centre one column to the left of the anchor)
    const state = putMetropolis(withTrade(openTurn(learn(withAmerica(game()), 'Currency')), 99), 2, 1, 0)
    const options = optionsOf(state)
    const squares = cellsOf(choiceFor(options, MARKET)?.squares)
    expect(squares).toEqual(expectedMarket([0, 1, 2, 3], [0, 1, 2], [[1, 1], [2, 1]]))
    // 12 squares in the block, 2 are centres: 10 outskirts, of which the water ones are not for a Market
    const waterInBlock = [0, 1, 2].flatMap((r) => [0, 1, 2, 3].filter((c) => america[r]?.[c] === 'water')).length
    expect(squares).toHaveLength(10 - waterInBlock)
  })

  it('a vertical metropolis has ten outskirts squares around its two centres', () => {
    // Centres B2 and B3 (rotation 90 puts the second centre one row above the anchor)
    const state = putMetropolis(withTrade(openTurn(learn(withAmerica(game()), 'Currency')), 99), 1, 2, 90)
    const squares = cellsOf(choiceFor(optionsOf(state), MARKET)?.squares)
    expect(squares).toEqual(expectedMarket([0, 1, 2], [0, 1, 2, 3], [[1, 1], [1, 2]]))
    const waterInBlock = [0, 1, 2, 3].flatMap((r) => [0, 1, 2].filter((c) => america[r]?.[c] === 'water')).length
    expect(squares).toHaveLength(10 - waterInBlock)
  })

  it('a walled city, a capital and a city offer the same squares and cost', () => {
    const results = ['cities/redcity2', 'cities/redcitywalled2', 'cities/redcapital2', 'cities/redcapitalwalled2'].map((assetId) => {
      const state = put(withTrade(openTurn(learn(withAmerica(game()), 'Currency', 'Writing')), 99), CASH1981, assetId, 1, 1)
      const options = optionsOf(state)
      return { market: choiceFor(options, MARKET), library: choiceFor(options, LIBRARY) }
    })
    expect(results[0]?.market?.squares).toHaveLength(7)
    for (const result of results) expect(result).toEqual(results[0])
  })

  it('both cities of a player get an entry, and a player without a colour or a city gets none', () => {
    const two = put(ready(['Currency']), CASH1981, 'cities/redcity2', 9, 9)
    expect(buildOptionsOf(two, me(two))).toHaveLength(2)
    expect(buildOptionsOf(two, me(two, KARANDRAS1))).toEqual([])
    const colourless = { ...me(two), color: null }
    expect(buildOptionsOf(two, colourless)).toEqual([])
  })
})

describe('the production a city builds with', () => {
  it('uses the estimate when nothing is set by hand', () => {
    const options = optionsOf(ready())
    expect(options.production).toBe(5)
    expect(options.productionSource).toBe('estimate')
    expect(options.production).toBe(cityProductionsOf(ready(), me(ready()))[0]?.estimate)
  })

  it('the number the players set by hand wins over the estimate', () => {
    const options = optionsOf(withOverride(ready(), 9))
    expect(options.production).toBe(9)
    expect(options.productionSource).toBe('override')
  })

  it('a Building Program marker on the city doubles the outskirts, and the hand set number still wins', () => {
    const marked = put(ready(), CASH1981, 'markers/Building Program', 1, 1)
    const doubled = optionsOf(marked)
    // The outskirts are 5 here and no modifier applies, so doubled is 10
    expect(doubled.production).toBe(10)
    expect(doubled.productionSource).toBe('building-program')

    const set = optionsOf(withOverride(marked, 2))
    expect(set.production).toBe(2)
    expect(set.productionSource).toBe('override')
  })

  it('a marker on another square is not the city\'s Building Program', () => {
    const beside = put(ready(), CASH1981, 'markers/Building Program', 2, 1)
    expect(optionsOf(beside).productionSource).toBe('estimate')
  })

  it('production above the cost needs no trade, and a higher cost than the doubled figure still needs it', () => {
    const marked = put(ready(['Printing Press'], 99), CASH1981, 'markers/Building Program', 1, 1)
    expect(choiceFor(optionsOf(marked), UNIVERSITY)?.tradeToPay).toBe(0)
    // With 5 production the University (8) is 3 short: 3 trade each
    expect(choiceFor(optionsOf(ready(['Printing Press'], 99)), UNIVERSITY)?.tradeToPay).toBe(9)
    expect(choiceFor(optionsOf(withOverride(marked, 2)), UNIVERSITY)?.tradeToPay).toBe(18)
  })
})

describe('rush with trade', () => {
  it('a shortfall is paid in whole steps of 3 trade, and the building is a choice with that price', () => {
    // University 8 against 5: 3 short, 9 trade
    const options = optionsOf(ready(['Printing Press'], 9))
    expect(choiceFor(options, UNIVERSITY)).toMatchObject({ cost: 8, tradeToPay: 9 })
  })

  it('the Americans get 2 production per 3 trade, rounded up to whole steps', () => {
    // 3 short is 2 steps for the Americans: 6 trade
    expect(choiceFor(optionsOf(americans(ready(['Printing Press'], 6))), UNIVERSITY)?.tradeToPay).toBe(6)
    // 2 short (the Harbor, 7 against 5) is 1 step: 3 trade
    expect(choiceFor(optionsOf(americans(ready(['Navigation'], 3))), HARBOR)?.tradeToPay).toBe(3)
  })

  it('without the trade the building is not a choice, and the reason says what is missing and how out', () => {
    const options = optionsOf(ready(['Printing Press'], 8))
    expect(choiceFor(options, UNIVERSITY)).toBeUndefined()
    expect(reasonFor(options, UNIVERSITY)).toBe(
      'Costs 8 production and City B2 has 5 (the estimate). Covering the missing 3 takes 9 trade and you have 8. ' +
        'If the city makes more than that, set its production by hand on the city.',
    )
  })

  it('the reason names where the production figure came from', () => {
    expect(reasonFor(optionsOf(withOverride(ready(['Printing Press'], 0), 4)), UNIVERSITY)).toMatch(
      /has 4 \(the number you set by hand\)/,
    )
  })
})

describe('the phase', () => {
  it('outside City Management the city says wrong-phase and offers nothing', () => {
    const closed = learn(scene(), 'Writing')
    const options = optionsOf(closed)
    expect(options.status).toBe('wrong-phase')
    expect(options.reason).toBe('Only available during your open City Management phase.')
    expect(options.choices).toEqual([])
    expect(options.unavailable).toEqual([])
    expect(options.production).toBe(5)
  })

  it('after City Management is marked done the city is closed again', () => {
    const done = unwrap(markPhasesDone(ready(['Writing']), { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' }))
    expect(optionsOf(done).status).toBe('wrong-phase')
  })
})

// ---------------------------------------------------------------------------
// The action
// ---------------------------------------------------------------------------

describe('building', () => {
  it('puts the piece centred on the square, writes the line and records everything', () => {
    const before = ready(['Writing'])
    const done = build(before, LIBRARY, C2)

    const library = piecesOf(done, LIBRARY)
    expect(library).toHaveLength(1)
    const piece = library[0] as BoardPiece
    expect(mapCellOf(done.board, piece)).toEqual(C2)
    // Centred on the square, to the pixel the board rounds to
    expect(Math.abs(piece.x + piece.width / 2 - (C2.column + 0.5) * SQUARE_SIZE)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(piece.y + piece.height / 2 - (mapTop(done.board) + (C2.row + 0.5) * SQUARE_SIZE))).toBeLessThanOrEqual(0.5)
    expect(piece.placedBy).toBe(CASH1981)

    const line = done.log.at(-1)
    expect(line?.publicLog).toBe('cash1981 built a Library in City B2 on square C2')
    expect(line?.privateLog).toBe('')
    expect(line?.assistedActionId).toBe('req-1')
    expect(me(done).stats.trade).toBe(0)

    const placed = done.board.history.at(-1)
    expect(placed?.change.kind).toBe('place')
    expect(placed?.at).toBe(AT)
    const record = done.assistedActions[0]
    expect(record).toMatchObject({ id: 'req-1', kind: 'build', status: 'applied', usageKey: null, phase: 'CM', logId: line?.id })
    expect(record?.effect).toEqual({
      kind: 'build',
      cityPieceId: cityOf(before).id,
      item: { kind: 'building', assetId: LIBRARY },
      square: { column: 2, row: 1, label: 'C2' },
      pieceId: piece.id,
      position: { x: piece.x, y: piece.y },
      historyId: placed?.id,
      trade: 0,
      marker: null,
    })
  })

  it('writes an article that fits the name', () => {
    const state = withOverride(ready(['Military Science', 'Railroad']), 20)
    const done = build(state, 'buildings/academy', { column: 1, row: 0 })
    expect(done.log.at(-1)?.publicLog).toBe('cash1981 built an Academy in City B2 on square B1')
    expect(build(state, 'buildings/ironmine', { column: 0, row: 0 }).log.at(-1)?.publicLog).toBe(
      'cash1981 built an Iron Mine in City B2 on square A1',
    )
  })

  it('does not use up a turn action: the same player can build again with a new request id', () => {
    const first = build(withOverride(ready(['Currency', 'Writing'], 99), 20), LIBRARY, C2)
    const second = build(first, MARKET, { column: 0, row: 0 }, 'req-2')
    expect(second.board.pieces.filter((piece) => piece.category === 'building')).toHaveLength(2)
    expect(me(second).playerTurns.every((turn) => turn.usedActions.length === 0)).toBe(true)
  })

  it('a rush pays the trade, the line says so, and the choice needs the rush flag', () => {
    const state = ready(['Printing Press'], 12)
    const square = { column: 2, row: 1 }
    const refused = tryBuild(state, UNIVERSITY, square)
    expect(refusal(refused)).toBe('University costs 8 and City B2 has 5. Confirm paying 9 trade to build it.')

    const done = build(state, UNIVERSITY, square, 'req-1', true)
    expect(me(done).stats.trade).toBe(3)
    expect(done.log.at(-1)?.publicLog).toBe(
      'cash1981 built a University in City B2 on square C2, paying 9 trade for the missing production',
    )
    expect(done.assistedActions[0]?.effect).toMatchObject({ kind: 'build', trade: 9 })
  })

  it('the Americans pay 6 for the same 3 production', () => {
    const done = build(americans(ready(['Printing Press'], 12)), UNIVERSITY, C2, 'req-1', true)
    expect(me(done).stats.trade).toBe(6)
  })

  it('a rush flag with nothing to pay pays nothing', () => {
    const done = build(ready(['Writing'], 12), LIBRARY, C2, 'req-1', true)
    expect(me(done).stats.trade).toBe(12)
    expect(done.log.at(-1)?.publicLog).not.toContain('paying')
  })

  it('a Building Program marker is used up through the board history, whatever production was used', () => {
    const marked = put(ready(['Writing']), CASH1981, 'markers/Building Program', 1, 1)
    const marker = piecesOf(marked, 'markers/Building Program')[0] as BoardPiece
    const done = build(marked, LIBRARY, C2)

    expect(piecesOf(done, 'markers/Building Program')).toEqual([])
    const removal = done.board.history.at(-1)
    expect(removal?.change).toMatchObject({ kind: 'remove', piece: { id: marker.id } })
    expect(done.log.at(-1)?.publicLog).toBe(
      'cash1981 built a Library in City B2 on square C2, using up the Building Program marker',
    )
    const effect = done.assistedActions[0]?.effect
    expect(effect?.kind === 'build' && effect.marker).toEqual({ piece: marker, historyId: removal?.id })

    // Also when a hand set number was used instead of the doubled figure
    const byHand = build(withOverride(marked, 5), LIBRARY, C2)
    expect(piecesOf(byHand, 'markers/Building Program')).toEqual([])
  })

  it('a marker on another city is not used up', () => {
    const state = put(
      put(ready(['Writing']), CASH1981, 'cities/redcity2', 9, 9),
      CASH1981,
      'markers/Building Program',
      9,
      9,
    )
    const done = build(state, LIBRARY, C2)
    expect(piecesOf(done, 'markers/Building Program')).toHaveLength(1)
  })
})

describe('a request that is not allowed', () => {
  it('the same request id twice builds once and returns the same state', () => {
    const done = build(ready(['Writing']), LIBRARY, C2)
    const again = unwrap(tryBuild(done, LIBRARY, C2))
    expect(again).toBe(done)
    expect(piecesOf(again, LIBRARY)).toHaveLength(1)
    expect(again.assistedActions).toHaveLength(1)
  })

  it('a second request for the same square is refused, with the reason', () => {
    const done = build(ready(['Writing']), LIBRARY, C2)
    expect(refusal(tryBuild(done, LIBRARY, C2, 'req-2'))).toMatch(/^Library cannot be built in City B2 now\. No legal square\./)
  })

  it('a square taken in between is refused and says which', () => {
    const state = ready(['Currency'], 99)
    const looked = optionsOf(state)
    expect(cellsOf(choiceFor(looked, MARKET)?.squares)).toContainEqual([0, 0])
    const taken = put(state, KARANDRAS1, 'buildings/granary', 0, 0)
    const result = tryBuild(taken, MARKET, { column: 0, row: 0 })
    expect(refusal(result)).toBe('A1 is already taken: Granary stands there. Pick one of the highlighted squares.')
    expect(piecesOf(taken, MARKET)).toEqual([])
  })

  it('a supply used up in between is refused', () => {
    const state = exhaust(ready(['Writing'], 99), [LIBRARY, LIBRARY, LIBRARY, LIBRARY, LIBRARY, LIBRARY])
    expect(refusal(tryBuild(state, LIBRARY, C2))).toMatch(/None left in the supply/)
  })

  it('trade spent in between is refused', () => {
    const state = ready(['Printing Press'], 9)
    expect(choiceFor(optionsOf(state), UNIVERSITY)?.tradeToPay).toBe(9)
    const spent = withTrade(state, 4)
    const result = tryBuild(spent, UNIVERSITY, C2, 'req-1', true)
    expect(refusal(result)).toMatch(/Covering the missing 3 takes 9 trade and you have 4/)
    expect(me(spent).stats.trade).toBe(4)
  })

  it('a building the player has not unlocked is refused with the tech it needs', () => {
    expect(refusal(tryBuild(ready(), LIBRARY, C2))).toBe('Library cannot be built in City B2 now. Needs Writing.')
  })

  it('a wrong terrain, the city centre, a square outside the outskirts and one that is not a whole square are refused', () => {
    const state = ready(['Currency', 'Writing'], 99)
    expect(refusal(tryBuild(state, LIBRARY, { column: 0, row: 0 }))).toBe(
      'A1 is mountain, and a Library needs grassland. Pick one of the highlighted squares.',
    )
    expect(refusal(tryBuild(state, MARKET, { column: 2, row: 0 }))).toBe(
      'C1 is water, and a Market needs any terrain except water. Pick one of the highlighted squares.',
    )
    expect(refusal(tryBuild(state, MARKET, { column: 1, row: 1 }))).toMatch(/B2 is not in the outskirts/)
    expect(refusal(tryBuild(state, MARKET, { column: 3, row: 3 }))).toMatch(/D4 is not in the outskirts/)
    expect(refusal(tryBuild(state, MARKET, { column: -1, row: 0 }))).toMatch(/^That square is not on the map\./)
    expect(refusal(tryBuild(state, MARKET, { column: 0.5, row: 0 }))).toMatch(/^That square is not in the outskirts/)
    expect(refusal(tryBuild(state, MARKET, { column: Infinity, row: 0 }))).toMatch(/^That square is not on the map\./)
    expect(piecesOf(state, MARKET)).toEqual([])
  })

  it('outside City Management it is refused as wrong-phase, and nothing changes', () => {
    const closed = learn(scene(), 'Writing')
    const result = unwrapErr(tryBuild(closed, LIBRARY, C2))
    expect(result).toMatchObject({ kind: 'ASSISTED_ACTION_REJECTED', status: 'wrong-phase' })
    const done = unwrap(markPhasesDone(ready(['Writing']), { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' }))
    expect(unwrapErr(tryBuild(done, LIBRARY, C2))).toMatchObject({ status: 'wrong-phase' })
    expect(piecesOf(done, LIBRARY)).toEqual([])
  })

  it('someone who is not in the game cannot build', () => {
    expect(unwrapErr(tryBuild(ready(['Writing']), LIBRARY, C2, 'req-1', undefined, 'spectator'))).toEqual({
      kind: 'NO_ACCESS',
      playerId: 'spectator',
    })
  })

  it('a player cannot build with a city that is not theirs', () => {
    const state = openTurn(put(ready(['Writing']), KARANDRAS1, 'cities/bluecity2', 9, 9), KARANDRAS1)
    const result = performAssistedAction(learnFor(state, KARANDRAS1, 'Writing'), {
      playerId: KARANDRAS1,
      action: 'build',
      requestId: 'req-1',
      payload: { cityPieceId: cityOf(state, 0).id, item: { kind: 'building', assetId: LIBRARY }, target: C2 },
    })
    expect(refusal(result)).toBe('That city is not yours, or it is no longer on the map.')
  })

  it('a payload that is missing or of another action is refused', () => {
    const state = ready(['Writing'])
    const none = performAssistedAction(state, { playerId: CASH1981, action: 'build', requestId: 'req-1' })
    expect(refusal(none)).toBe('Say which city, what to build and which square.')
    const reward = performAssistedAction(state, {
      playerId: CASH1981,
      action: 'build',
      requestId: 'req-1',
      payload: { rewardId: 'x', itemId: 'y' },
    })
    expect(refusal(reward)).toBe('Say which city, what to build and which square.')
  })

  it('an item that is not a building, and a building that does not exist, are refused', () => {
    const state = ready(['Writing'])
    const figure = performAssistedAction(state, {
      playerId: CASH1981,
      action: 'build',
      requestId: 'req-1',
      payload: {
        cityPieceId: cityOf(state).id,
        item: { kind: 'figure', assetId: 'figures/redarmy' } as unknown as BuildPayload['item'],
        target: C2,
      },
    })
    expect(refusal(figure)).toBe('Only buildings can be built for now.')
    expect(refusal(tryBuild(state, 'buildings/nothing', C2))).toBe('buildings/nothing is not a building that can be built.')
  })

  it('every refusal leaves the game exactly as it was', () => {
    const state = ready(['Writing'])
    const snapshot = JSON.stringify(state)
    tryBuild(state, LIBRARY, { column: 0, row: 0 })
    tryBuild(state, 'buildings/market', C2)
    tryBuild(learn(state, 'Currency'), MARKET, { column: 2, row: 0 })
    expect(JSON.stringify(state)).toBe(snapshot)
  })
})

function learnFor(state: GameState, playerId: string, ...techs: readonly string[]): GameState {
  return techs.reduce(
    (next, techName) =>
      unwrap(revealTech(unwrap(chooseTech(next, { playerId, techName })), { playerId, techName })),
    state,
  )
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

describe('undoing a build with the vote', () => {
  it('removes the building, and the record is undone', () => {
    const done = build(ready(['Writing']), LIBRARY, C2)
    const undone = undoByVote(done, 'req-1')

    expect(piecesOf(undone, LIBRARY)).toEqual([])
    expect(undone.assistedActions[0]?.status).toBe('undone')
    expect(undone.log.at(-1)?.publicLog).toBe(
      "System: cash1981's Library on C2 was undone: the building was removed",
    )
    // The building is gone from the supply count too: it can be built again
    expect(choiceFor(optionsOf(undone), LIBRARY)).toBeDefined()
  })

  it('refunds the trade of a rush', () => {
    const done = build(ready(['Printing Press'], 12), UNIVERSITY, C2, 'req-1', true)
    expect(me(done).stats.trade).toBe(3)
    const undone = undoByVote(done, 'req-1')
    expect(me(undone).stats.trade).toBe(12)
    expect(undone.log.at(-1)?.publicLog).toBe(
      "System: cash1981's University on C2 was undone: the building was removed, 9 trade returned",
    )
  })

  it('puts the Building Program marker back where it was, through the board history', () => {
    const marked = put(ready(['Writing']), CASH1981, 'markers/Building Program', 1, 1)
    const marker = piecesOf(marked, 'markers/Building Program')[0] as BoardPiece
    const undone = undoByVote(build(marked, LIBRARY, C2), 'req-1')

    expect(piecesOf(undone, 'markers/Building Program')).toEqual([marker])
    expect(undone.board.history.at(-1)?.change).toMatchObject({ kind: 'place', piece: { id: marker.id } })
    expect(undone.log.at(-1)?.publicLog).toBe(
      "System: cash1981's Library on C2 was undone: the building was removed and the Building Program marker was put back",
    )
    // The city produces with the marker again
    expect(optionsOf(undone).productionSource).toBe('building-program')
  })

  it('is refused when the building has left its square, and the vote stays open', () => {
    const done = build(ready(['Writing']), LIBRARY, C2)
    const piece = piecesOf(done, LIBRARY)[0] as BoardPiece
    const moved = unwrap(
      movePiece(done, {
        playerId: CASH1981,
        pieceId: piece.id,
        x: 3 * SQUARE_SIZE + 4,
        y: mapTop(done.board) + 3 * SQUARE_SIZE + 4,
      }),
    )
    const attempt = almostUndone(moved, 'req-1')
    const refused = unwrapErr(attempt.last())
    expect(refused).toMatchObject({ kind: 'ASSISTED_UNDO_BLOCKED', logId: attempt.logId })
    expect(refused.kind === 'ASSISTED_UNDO_BLOCKED' && refused.reason).toBe('The Library has left C2. Move it back first.')
    // The state the vote was cast on is untouched: still applied, the building still there
    expect(attempt.state.assistedActions[0]?.status).toBe('applied')
    expect(piecesOf(attempt.state, LIBRARY)).toHaveLength(1)
  })

  it('is refused when the building is no longer on the board', () => {
    const done = build(ready(['Writing']), LIBRARY, C2)
    const piece = piecesOf(done, LIBRARY)[0] as BoardPiece
    const gone = unwrap(removePiece(done, { playerId: CASH1981, pieceId: piece.id }))
    const refused = unwrapErr(almostUndone(gone, 'req-1').last())
    expect(refused.kind === 'ASSISTED_UNDO_BLOCKED' && refused.reason).toBe(
      'The Library is no longer on the board, so the build cannot be undone.',
    )
  })

  it('still works when the building was nudged within its square', () => {
    const done = build(ready(['Writing']), LIBRARY, C2)
    const piece = piecesOf(done, LIBRARY)[0] as BoardPiece
    const nudged = unwrap(movePiece(done, { playerId: CASH1981, pieceId: piece.id, x: piece.x + 5, y: piece.y - 5, snap: false }))
    expect(piecesOf(undoByVote(nudged, 'req-1'), LIBRARY)).toEqual([])
  })

  it('cannot be undone twice', () => {
    const undone = undoByVote(build(ready(['Writing']), LIBRARY, C2), 'req-1')
    expect(unwrapErr(initiateUndo(undone, { logId: logIdOf(undone, 'req-1'), playerId: CASH1981 })).kind).toBe(
      'ASSISTED_ACTION_ALREADY_UNDONE',
    )
  })
})

describe('the board Undo', () => {
  it('refuses to take back the placed building alone', () => {
    const done = build(ready(['Writing']), LIBRARY, C2)
    const snapshot = JSON.stringify(done)
    expect(done.board.history.at(-1)?.change.kind).toBe('place')
    expect(unwrapErr(undoLastBoardChange(done, CASH1981))).toEqual({ kind: 'BOARD_UNDO_ASSISTED' })
    expect(JSON.stringify(done)).toBe(snapshot)
  })

  it('refuses to take back the marker removal alone', () => {
    const done = build(put(ready(['Writing']), CASH1981, 'markers/Building Program', 1, 1), LIBRARY, C2)
    expect(done.board.history.at(-1)?.change.kind).toBe('remove')
    expect(unwrapErr(undoLastBoardChange(done, CASH1981))).toEqual({ kind: 'BOARD_UNDO_ASSISTED' })
  })

  it('works on an ordinary change again once the build is undone', () => {
    const marked = put(ready(['Writing']), CASH1981, 'markers/Building Program', 1, 1)
    const undone = undoByVote(build(marked, LIBRARY, C2), 'req-1')
    const back = unwrap(undoLastBoardChange(undone, CASH1981))
    expect(back.board.history).toHaveLength(undone.board.history.length - 1)
  })

  it('the build\'s own entries are not the next thing to undo after a later ordinary change', () => {
    const done = build(ready(['Writing']), LIBRARY, C2)
    const piece = piecesOf(done, LIBRARY)[0] as BoardPiece
    const moved = unwrap(movePiece(done, { playerId: CASH1981, pieceId: piece.id, x: piece.x + 3, y: piece.y, snap: false }))
    // The move is an ordinary change: the board Undo takes it back
    expect(unwrap(undoLastBoardChange(moved, CASH1981)).board.history).toHaveLength(done.board.history.length)
  })
})

describe('replay and the board history', () => {
  it('counts the build line in both board entries, so stepping through the history shows them together', () => {
    const marked = put(ready(['Writing']), CASH1981, 'markers/Building Program', 1, 1)
    const done = build(marked, LIBRARY, C2)
    const [placed, removed] = done.board.history.slice(-2)
    expect(placed?.change.kind).toBe('place')
    expect(removed?.change.kind).toBe('remove')
    expect(placed?.logLength).toBe(done.log.length)
    expect(removed?.logLength).toBe(done.log.length)
    const lengths = done.board.history.map((entry) => entry.logLength)
    expect(lengths).toEqual([...lengths].sort((a, b) => a - b))
    // The line the history step reaches is the build line
    expect(done.log[(placed?.logLength ?? 0) - 1]?.assistedActionId).toBe('req-1')
  })

  it('replaying the history gives the same pieces, after the build and after its undo', () => {
    const marked = put(ready(['Writing']), CASH1981, 'markers/Building Program', 1, 1)
    for (const state of [build(marked, LIBRARY, C2), undoByVote(build(marked, LIBRARY, C2), 'req-1')]) {
      const replayed = piecesAtStep(state.board.history, state.board.history.length)
      const key = (piece: BoardPiece): string => `${piece.id}@${piece.x},${piece.y}`
      expect([...replayed].map(key).sort()).toEqual([...state.board.pieces].map(key).sort())
    }
  })

  it('the entries of the undo are counted with the System line and stay in order', () => {
    const marked = put(ready(['Writing']), CASH1981, 'markers/Building Program', 1, 1)
    const undone = undoByVote(build(marked, LIBRARY, C2), 'req-1')
    const last = undone.board.history.slice(-2)
    expect(last.map((entry) => entry.change.kind)).toEqual(['remove', 'place'])
    for (const entry of last) expect(entry.logLength).toBe(undone.log.length)
    const lengths = undone.board.history.map((entry) => entry.logLength)
    expect(lengths).toEqual([...lengths].sort((a, b) => a - b))
  })
})
