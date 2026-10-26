/**
 * The per-city production estimate and its manual override (task
 * `city-production`, issue #250 slice A).
 *
 * Every test builds the same small scene: Cash is Red and Monarchy, so the
 * default Despotism bonus does not hide in the numbers, and the England tile
 * lies in the first map slot with a red city on its square B2. The England grid,
 * as printed (row by row, column 0 to 3):
 *
 *   row 0: water     mountain  mountain  water
 *   row 1: water     mountain  forest    water
 *   row 2: water     mountain  forest    grassland
 *   row 3: grassland forest    water     water
 *
 * so the outskirts of a city on B2 are: B1 mountain, C1 mountain, C2 forest, B3
 * mountain and C3 forest, and the rest water. That gives 1 + 1 + 2 + 1 + 2 = 7.
 */

import { describe, expect, it } from 'vitest'

import {
  movePiece,
  placePiece,
  redoLastBoardChange,
  removePiece,
  setCityProductionOverride,
  setWonderOwner,
  undoLastBoardChange,
} from '../src/actions/board.js'
import {
  chooseSocialPolicy,
  chooseTech,
  revealSocialPolicy,
  revealTech,
  setPlayerStat,
} from '../src/actions/player.js'
import { cityFootprintsOf, mapCellOf } from '../src/blockade.js'
import {
  SQUARE_SIZE,
  findBoardAsset,
  mapTop,
  piecesAtStep,
  slotOrigin,
} from '../src/board.js'
import type { BoardPiece, Rotation } from '../src/board.js'
import { BUILDING_DATA, buildingDataOf } from '../src/building-data.js'
import { cityProductionsOf } from '../src/city-production.js'
import { tradeEstimateOf } from '../src/trade-estimate.js'
import type { CityProduction } from '../src/city-production.js'
import { describeError } from '../src/errors.js'
import type { GreatPersonItem } from '../src/item.js'
import { migrateGameState } from '../src/migrate.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { AssistedActionRecord, GameState } from '../src/state.js'
import { tileTerrainGrid } from '../src/terrain.js'
import { turnStatus } from '../src/turn.js'

import { CASH1981, ITCHI, KARANDRAS1, CHUL, firstCivGame } from './fixture.js'

const AT = '2026-10-09T10:00:00.000Z'

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

/** A metropolis with its image centre on the boundary between its two city squares, as the blockade tests do. */
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

/** The England tile in the first slot, with its terrain known. */
function withEngland(state: GameState): GameState {
  const slot = state.board.slots[0]
  if (slot === undefined) throw new Error('board has no slots')
  const [x, y] = slotOrigin(state.board, slot)
  return unwrap(placePiece(state, { playerId: CASH1981, assetId: 'tiles/England', x, y }))
}

/** England and a red city on B2 (column 1, row 1). */
function scene(): GameState {
  return put(withEngland(game()), CASH1981, 'cities/redcity2', 1, 1)
}

const cash = (state: GameState) => {
  const found = findPlayer(state, CASH1981)
  if (found === undefined) throw new Error('no Cash')
  return found
}

const citiesOf = (state: GameState, playerId = CASH1981): readonly CityProduction[] => {
  const found = findPlayer(state, playerId)
  if (found === undefined) throw new Error('no such player')
  return cityProductionsOf(state, found)
}

function only(state: GameState, playerId = CASH1981): CityProduction {
  const cities = citiesOf(state, playerId)
  expect(cities).toHaveLength(1)
  const city = cities[0]
  if (city === undefined) throw new Error('no city')
  return city
}

const lastPiece = (state: GameState): BoardPiece => {
  const piece = state.board.pieces.at(-1)
  if (piece === undefined) throw new Error('the board is empty')
  return piece
}

const cityPiece = (state: GameState): BoardPiece => {
  const piece = state.board.pieces.find((candidate) => candidate.category === 'city')
  if (piece === undefined) throw new Error('no city on the board')
  return piece
}

const squaresOf = (city: CityProduction) =>
  [...city.outskirtsDetail].sort((a, b) => a.square.localeCompare(b.square)).map((entry) => [entry.square, entry.source, entry.amount])

const modifier = (city: CityProduction, label: string) => city.modifiers.find((entry) => entry.label === label)

const withGovernment = (state: GameState, government: 'Despotism' | 'Communism' | 'Monarchy'): GameState => ({
  ...state,
  players: state.players.map((p) => (p.playerId === CASH1981 ? { ...p, government } : p)),
})

const withStat = (state: GameState, stat: 'infra', value: number): GameState =>
  unwrap(setPlayerStat(state, { editorPlayerId: CASH1981, targetPlayerId: CASH1981, stat, value }))

/** Puts coins on the free-form counter, set directly so no source cap gets in the way. */
const withCoins = (state: GameState, coins: number): GameState => ({
  ...state,
  players: state.players.map((p) =>
    p.playerId === CASH1981
      ? { ...p, stats: { ...p.stats, coinSources: { ...p.stats.coinSources, sheet: coins } } }
      : p,
  ),
})

const withTech = (state: GameState, techName: string, reveal: boolean): GameState => {
  const chosen = unwrap(chooseTech(state, { playerId: CASH1981, techName }))
  return reveal ? unwrap(revealTech(chosen, { playerId: CASH1981, techName })) : chosen
}

const withSocialPolicy = (state: GameState, name: string, reveal: boolean): GameState => {
  const chosen = unwrap(chooseSocialPolicy(state, { playerId: CASH1981, name }))
  return reveal ? unwrap(revealSocialPolicy(chosen, { playerId: CASH1981, name })) : chosen
}

const withSusan = (state: GameState, hidden: boolean): GameState => {
  const card: GreatPersonItem = {
    id: 'susan-test',
    itemNumber: 4243,
    kind: 'greatperson',
    sheetName: 'GREAT_PERSON',
    name: 'Susan B. Anthony',
    type: 'Humanitarian',
    description: 'Hand-held secret.',
    used: false,
    hidden,
    ownerId: CASH1981,
  }
  return {
    ...state,
    players: state.players.map((p) => (p.playerId === CASH1981 ? { ...p, items: [...p.items, card] } : p)),
  }
}

describe('the fixture', () => {
  it('England is the terrain the numbers below are worked out from', () => {
    const grid = tileTerrainGrid('tiles/England')
    expect(grid?.[1]?.[2]).toBe('forest')
    expect(grid?.[0]?.[1]).toBe('mountain')
    expect(grid?.[2]?.[3]).toBe('grassland')
  })
})

describe('outskirts', () => {
  it('counts forest 2 and mountain 1, and nothing for water, grassland or desert', () => {
    const city = only(scene())
    expect(city.outskirts).toBe(7)
    expect(squaresOf(city)).toEqual([
      ['B1', 'mountain', 1],
      ['B3', 'mountain', 1],
      ['C1', 'mountain', 1],
      ['C2', 'forest', 2],
      ['C3', 'forest', 2],
    ])
    expect(city.estimate).toBe(7)
    expect(city.effective).toBe(7)
    expect(city.override).toBeNull()
  })

  it('does not count the city square itself', () => {
    // B2 is a mountain: a centre that was counted would make 8.
    expect(only(scene()).outskirts).toBe(7)
  })

  it('a building replaces the icons of the square it stands on', () => {
    // A Workshop is worth 3 and takes the place of C2's forest (2): 7 - 2 + 3.
    const workshop = put(scene(), CASH1981, 'buildings/workshop', 2, 1)
    expect(only(workshop).outskirts).toBe(8)
    expect(squaresOf(only(workshop))).toContainEqual(['C2', 'Workshop', 3])

    // A Temple gives no production, so the forest under it is lost, and the square is still listed.
    const temple = put(scene(), CASH1981, 'buildings/temple', 2, 1)
    expect(only(temple).outskirts).toBe(5)
    expect(squaresOf(only(temple))).toContainEqual(['C2', 'Temple', 0])
  })

  it('takes a building on water from the building table', () => {
    // A1 is water and gives nothing by itself; a Harbor is worth 1.
    const harbor = put(scene(), CASH1981, 'buildings/harbor', 0, 0)
    expect(only(harbor).outskirts).toBe(8)
    expect(squaresOf(only(harbor))).toContainEqual(['A1', 'Harbor', 1])
  })

  it('a building outside the outskirts changes nothing', () => {
    expect(only(put(scene(), CASH1981, 'buildings/workshop', 3, 3)).outskirts).toBe(7)
  })

  it('a wonder in a square gives 0 and is named in the notes', () => {
    const wonder = put(scene(), CASH1981, 'wonders/pyramids', 2, 2)
    const city = only(wonder)
    expect(city.outskirts).toBe(5)
    expect(squaresOf(city)).toContainEqual(['C3', 'wonder', 0])
    expect(city.notes.some((note) => note.includes('C3') && note.includes('wonder'))).toBe(true)

  })

  it('a great person marker gives the production printed on it in place of the terrain under it', () => {
    // C3 is forest (2). The Builder shows 2, the Scientist and the Humanitarian 1, the General none.
    const builder = only(put(scene(), CASH1981, 'great people/builder', 2, 2))
    expect(builder.outskirts).toBe(7)
    expect(squaresOf(builder)).toContainEqual(['C3', 'Builder (great person)', 2])
    expect(only(put(scene(), CASH1981, 'great people/scientist', 2, 2)).outskirts).toBe(6)
    expect(only(put(scene(), CASH1981, 'great people/humanitarian', 2, 2)).outskirts).toBe(6)
    const general = only(put(scene(), CASH1981, 'great people/general', 2, 2))
    expect(general.outskirts).toBe(5)
    expect(squaresOf(general)).toContainEqual(['C3', 'General (great person)', 0])
    // Nothing about it is unknown, so the notes do not name the square
    expect(general.notes.some((note) => note.includes('C3 holds'))).toBe(false)
  })

  it('an enemy figure blockades a great person marker too', () => {
    const state = put(put(scene(), CASH1981, 'great people/builder', 2, 2), KARANDRAS1, 'figures/bluearmy', 2, 2)
    expect(only(state).outskirts).toBe(5)
  })

  it('a square with no known terrain gives 0 and is named in the notes', () => {
    // No tile lies under a city in the middle of the map.
    const city = only(put(game(), CASH1981, 'cities/redcity2', 5, 5))
    expect(city.outskirts).toBe(0)
    expect(city.outskirtsDetail).toHaveLength(8)
    expect(city.outskirtsDetail.every((entry) => entry.source === 'unknown terrain' && entry.amount === 0)).toBe(true)
    expect(city.notes.some((note) => note.includes('unknown'))).toBe(true)
  })

  it('squares off the map at the edge are not counted and not reported as unknown', () => {
    // A city on A1 has three outskirts squares on the map: B1 (mountain 1), A2 (water) and B2 (mountain 1).
    const city = only(put(withEngland(game()), CASH1981, 'cities/redcity2', 0, 0))
    expect(city.outskirts).toBe(2)
    expect(city.notes.some((note) => note.includes('unknown'))).toBe(false)
  })
})

/**
 * The England tile prints trade icons on A1, A2 and A3 (column 0, rows 0 to 2), all
 * water, so a city on B2 has 3 trade around it. The trade squares as [square, source, amount].
 */
const tradeSquaresOf = (city: CityProduction) =>
  [...city.trade.detail].sort((a, b) => a.square.localeCompare(b.square)).map((entry) => [entry.square, entry.source, entry.amount])

describe('trade', () => {
  it('counts the trade icons printed on the outskirts squares, and the city centre not at all', () => {
    const city = only(scene())
    expect(city.trade.outskirts).toBe(3)
    expect(tradeSquaresOf(city)).toEqual([
      ['A1', 'map icon', 1],
      ['A2', 'map icon', 1],
      ['A3', 'map icon', 1],
    ])
  })

  it('does not change the production estimate', () => {
    expect(only(scene()).estimate).toBe(7)
  })

  it('does not count squares outside the outskirts or off the map', () => {
    // A city on A1 has B1, A2 and B2 as outskirts; only A2 prints a trade icon.
    expect(only(put(withEngland(game()), CASH1981, 'cities/redcity2', 0, 0)).trade.outskirts).toBe(1)
  })

  it('a building takes the trade of its own row in place of the icon under it', () => {
    // A Harbor is worth 2 trade and replaces A1's printed 1: 3 - 1 + 2.
    const harbor = only(put(scene(), CASH1981, 'buildings/harbor', 0, 0))
    expect(harbor.trade.outskirts).toBe(4)
    expect(tradeSquaresOf(harbor)).toContainEqual(['A1', 'Harbor', 2])

    // A Temple gives no trade, so the icon under it is lost.
    const temple = only(put(scene(), CASH1981, 'buildings/temple', 0, 0))
    expect(temple.trade.outskirts).toBe(2)
    expect(tradeSquaresOf(temple).some(([square]) => square === 'A1')).toBe(false)
  })

  it('a building on a square with no icon adds its own trade', () => {
    // A Library is worth 1 trade on C2, a forest with no trade icon.
    const library = only(put(scene(), CASH1981, 'buildings/library', 2, 1))
    expect(library.trade.outskirts).toBe(4)
    expect(tradeSquaresOf(library)).toContainEqual(['C2', 'Library', 1])
  })

  it('an enemy figure blockades the square, and the square says so', () => {
    const city = only(put(scene(), KARANDRAS1, 'figures/bluearmy', 0, 1))
    expect(city.trade.outskirts).toBe(2)
    expect(city.trade.detail.find((entry) => entry.square === 'A2')).toEqual({
      square: 'A2',
      source: 'map icon',
      amount: 0,
      blockaded: true,
    })
  })

  it('a great person marker gives the trade printed on it in place of the icon under it', () => {
    // A1 prints 1 trade. The Scientist shows 2, the Artist 1 and the Builder none.
    expect(only(put(scene(), CASH1981, 'great people/scientist', 0, 0)).trade.outskirts).toBe(4)
    expect(tradeSquaresOf(only(put(scene(), CASH1981, 'great people/scientist', 0, 0)))).toContainEqual(['A1', 'Scientist (great person)', 2])
    expect(only(put(scene(), CASH1981, 'great people/artist', 0, 0)).trade.outskirts).toBe(3)
    expect(only(put(scene(), CASH1981, 'great people/builder', 0, 0)).trade.outskirts).toBe(2)
  })

  it('a disaster token replaces the icon of the tile, so a forest token on A1 gives no trade', () => {
    const forest = only(put(scene(), CASH1981, 'disasters/forest', 0, 0))
    expect(forest.trade.outskirts).toBe(2)
    // and A1 becomes forest: 7 production + 2
    expect(forest.outskirts).toBe(9)
  })

  it('a drought token gives its own trade icon and turns forest into desert', () => {
    // C2 is forest with no trade icon; a drought token makes it desert (0 production) with 1 trade.
    const drought = only(put(scene(), CASH1981, 'disasters/drought', 2, 1))
    expect(drought.trade.outskirts).toBe(4)
    expect(tradeSquaresOf(drought)).toContainEqual(['C2', 'disaster token', 1])
    expect(drought.outskirts).toBe(5)
  })

  it('a water token gives its own trade icon and turns forest into water', () => {
    const water = only(put(scene(), CASH1981, 'disasters/water', 2, 1))
    expect(tradeSquaresOf(water)).toContainEqual(['C2', 'disaster token', 1])
    expect(water.trade.outskirts).toBe(4)
    expect(water.outskirts).toBe(5)
  })

  it('a building on a disaster token gives the building’s own trade', () => {
    const state = put(put(scene(), CASH1981, 'disasters/water', 0, 0), CASH1981, 'buildings/harbor', 0, 0)
    expect(tradeSquaresOf(only(state))).toContainEqual(['A1', 'Harbor', 2])
  })

  describe('a scout standing on a trade icon', () => {
    // A2 prints a trade icon and lies in the outskirts of a city on B2. A scout that was not sent goes to the capital.
    const scoutOnA2 = (state: GameState): GameState => put(state, CASH1981, 'figures/redscout', 0, 1)

    it('counts the square once when the scout goes to the city that owns it', () => {
      const capital = put(withEngland(game()), CASH1981, 'cities/redcapital2', 1, 1)
      expect(only(capital).trade.outskirts).toBe(3)
      const city = only(scoutOnA2(capital))
      expect(city.trade.outskirts).toBe(3)
      expect(tradeSquaresOf(city).filter(([square]) => square === 'A2')).toEqual([['A2', 'map icon', 1]])
    })

    it('gives the owning city nothing when the scout goes to another city, and gives that city the trade', () => {
      // The capital is on a square with no known tile, so the scout goes there and not to B2.
      const state = scoutOnA2(put(scene(), CASH1981, 'cities/redcapital2', 8, 8))
      const owner = citiesOf(state).find((candidate) => candidate.label.startsWith('City'))
      expect(owner?.trade.outskirts).toBe(2)
      expect(owner?.trade.detail.some((entry) => entry.square === 'A2')).toBe(false)
      const capital = citiesOf(state).find((candidate) => candidate.label.startsWith('Capital'))
      if (capital === undefined) throw new Error('no capital')
      expect(capital.trade.outskirts).toBe(1)
      expect(tradeSquaresOf(capital)).toContainEqual(['A2', 'map icon, sent by your scout', 1])
    })

    it('counts trade once when two scouts on one square are sent to the same city', () => {
      const capital = put(withEngland(game()), CASH1981, 'cities/redcapital2', 8, 8)
      const together = put(
        put(capital, CASH1981, 'figures/redscout', 0, 1),
        CASH1981,
        'figures/redscout',
        0,
        1,
      )
      const target = together.board.pieces.find((piece) => piece.assetId === 'cities/redcapital2')
      if (target === undefined) throw new Error('no target city')
      const scouts = together.board.pieces.filter((piece) => {
        const cell = mapCellOf(together.board, piece)
        return piece.assetId === 'figures/redscout' && cell?.column === 0 && cell.row === 1
      })
      expect(scouts).toHaveLength(2)
      const turnNumber = turnStatus(together).currentTurn
      const assignments: AssistedActionRecord[] = scouts.map((scout, index) => ({
        id: `assigned-${index}`,
        kind: 'assignScout',
        playerId: CASH1981,
        turnNumber,
        phase: 'SOT',
        usageKey: null,
        at: AT,
        logId: `assigned-log-${index}`,
        status: 'applied',
        effect: {
          kind: 'assignScout',
          scoutPieceId: scout.id,
          cityPieceId: target.id,
          column: 0,
          row: 1,
          square: 'A2',
          cityLabel: target.label,
        },
      }))
      const state = { ...together, assistedActions: assignments }
      const city = citiesOf(state).find((candidate) => candidate.pieceId === target.id)
      if (city === undefined) throw new Error('no city production')

      expect(city.trade.outskirts).toBe(1)
      expect(tradeSquaresOf(city).filter(([square]) => square === 'A2')).toEqual([
        ['A2', 'map icon, sent by your scout', 1],
      ])
    })

    it('adds an unsent scout square to the capital and to the trade estimate (issue #292)', () => {
      // A1 prints a trade icon and is outside the outskirts of a capital on G2,
      // which has no tile around it, so the scout's default is the only trade.
      const capital = put(withEngland(game()), CASH1981, 'cities/redcapital2', 6, 1)
      const state = put(capital, CASH1981, 'figures/redscout', 0, 0)
      const city = only(state)
      expect(city.label).toBe('Capital G2')
      expect(city.trade.outskirts).toBe(1)
      expect(tradeSquaresOf(city)).toContainEqual(['A1', 'map icon, sent by your scout', 1])
      expect(tradeEstimateOf(state, cash(state)).cities).toBe(1)
    })

    it('a building on the square a scout sends gives the building trade', () => {
      const capital = put(withEngland(game()), CASH1981, 'cities/redcapital2', 2, 3)
      const withScout = put(capital, CASH1981, 'figures/redscout', 0, 0)
      const state = put(withScout, CASH1981, 'buildings/harbor', 0, 0)
      expect(tradeSquaresOf(only(state))).toContainEqual(['A1', 'Harbor, sent by your scout', 2])
    })
  })

  it('a wonder square counts for no trade and is named in the notes', () => {
    const city = only(put(scene(), CASH1981, 'wonders/pyramids', 0, 0))
    expect(city.trade.outskirts).toBe(2)
    expect(city.trade.notes.some((note) => note.includes('A1') && note.includes('wonder'))).toBe(true)
  })

  it('never calls the count complete, and says when two cities share a square', () => {
    expect(only(scene()).trade.notes[0]).toContain('Not a complete count')

    // B2 and B3 are neighbours, so their outskirts overlap on A2 and A3, among others.
    const two = citiesOf(put(scene(), CASH1981, 'cities/redcity2', 1, 2))
    expect(two).toHaveLength(2)
    expect(two.every((city) => city.trade.notes.some((note) => note.includes('another of your cities')))).toBe(true)
  })
})

describe('the trade estimate for the Trade phase', () => {
  const estimate = (state: GameState) => tradeEstimateOf(state, cash(state))
  /** An applied Start of Turn ability that gave `trade`, in the given turn. */
  const withSotGain = (state: GameState, trade: number, overrides: Record<string, unknown> = {}): GameState => ({
    ...state,
    assistedActions: [
      ...state.assistedActions,
      {
        id: `a${state.assistedActions.length}`,
        kind: 'expansionism',
        playerId: CASH1981,
        turnNumber: 1,
        phase: 'SOT',
        usageKey: null,
        at: null,
        logId: 'l',
        status: 'applied',
        effect: { kind: 'statGain', trade, culture: 0, subject: 'Expansionism' },
        ...overrides,
      } as never,
    ],
  })

  it('is the trade around the cities, the Start of Turn trade and the coins, added up', () => {
    const state = withCoins(withSotGain(scene(), 2), 4)
    expect(estimate(state)).toEqual({ cities: 3, startOfTurn: 2, coins: 4, ceiling: 27, total: 9, set: false })
  })

  it('counts nothing for a city-less player, no gain and no coins', () => {
    expect(estimate(game())).toMatchObject({ cities: 0, startOfTurn: 0, coins: 0, total: 0 })
  })

  it('leaves out a Start of Turn gain that was undone, was another turn or was another phase or player', () => {
    let state = scene()
    state = withSotGain(state, 5, { status: 'undone' })
    state = withSotGain(state, 5, { turnNumber: 2 })
    state = withSotGain(state, 5, { phase: 'TRADE' })
    state = withSotGain(state, 5, { playerId: KARANDRAS1 })
    expect(estimate(state).startOfTurn).toBe(0)
  })

  it('is held to the trade track, 27, or 25 for the Japanese', () => {
    expect(estimate(withCoins(scene(), 40))).toMatchObject({ total: 27, ceiling: 27 })
    const japanese: GameState = {
      ...withCoins(scene(), 40),
      players: withCoins(scene(), 40).players.map((p) =>
        p.playerId === CASH1981 ? { ...p, civilization: { kind: 'civ', name: 'Japanese' } as never } : p,
      ),
    }
    expect(estimate(japanese)).toMatchObject({ total: 25, ceiling: 25 })
  })

  it('is set once the trade is set, from any panel, and only for that turn and that player', () => {
    const setTrade = (state: GameState, playerId: string, value: number) =>
      unwrap(setPlayerStat(state, { editorPlayerId: playerId, targetPlayerId: playerId, stat: 'trade', value }))
    const before = scene()
    expect(estimate(before).set).toBe(false)
    const after = setTrade(before, CASH1981, 7)
    expect(estimate(after).set).toBe(true)
    expect(cash(after).stats.trade).toBe(7)
    // another player setting theirs does not set mine, and setting another stat does not either
    expect(estimate(setTrade(before, KARANDRAS1, 7)).set).toBe(false)
    expect(estimate(unwrap(setPlayerStat(before, { editorPlayerId: CASH1981, targetPlayerId: CASH1981, stat: 'culture', value: 3 }))).set).toBe(false)
    // an editor setting someone else's trade marks that player's turn
    const byOther = unwrap(setPlayerStat(before, { editorPlayerId: KARANDRAS1, targetPlayerId: CASH1981, stat: 'trade', value: 4 }))
    expect(estimate(byOther).set).toBe(true)
    // setting it again keeps one marker
    expect(cash(setTrade(after, CASH1981, 8)).playerTurns.flatMap((turn) => turn.usedActions).filter((key) => key === 'trade:set')).toHaveLength(1)
    // it is the guess again the next turn
    const nextTurn = { ...after, chatOrdersStartTurn: 2 }
    expect(estimate(nextTurn).set).toBe(false)
  })

  it('reaches only the player it is about', () => {
    const state = withCoins(scene(), 4)
    expect(toPlayerView(state, CASH1981).you?.tradeEstimate).toMatchObject({ coins: 4, cities: 3 })
    expect(JSON.stringify(toPlayerView(state, KARANDRAS1).opponents)).not.toContain('tradeEstimate')
    expect(toPlayerView(state, KARANDRAS1).you?.tradeEstimate.coins).toBe(0)
  })
})

describe('blockade', () => {
  it('an enemy figure in a square gives the owner nothing from it, and the square says so', () => {
    const blocked = put(scene(), KARANDRAS1, 'figures/bluearmy', 2, 1)
    const city = only(blocked)
    expect(city.outskirts).toBe(5)
    expect(city.outskirtsDetail.find((entry) => entry.square === 'C2')).toEqual({
      square: 'C2',
      source: 'forest',
      amount: 0,
      blockaded: true,
    })
    expect(city.outskirtsDetail.filter((entry) => entry.blockaded)).toHaveLength(1)
  })

  it('a scout blockades too, and a building in the square gives nothing', () => {
    const state = put(put(scene(), CASH1981, 'buildings/workshop', 2, 1), ITCHI, 'figures/greenscout', 2, 1)
    expect(only(state).outskirts).toBe(5)
    expect(only(state).outskirtsDetail.find((entry) => entry.square === 'C2')).toMatchObject({
      source: 'Workshop',
      amount: 0,
      blockaded: true,
    })
  })

  it("the city's own figures do not blockade it", () => {
    const state = put(put(scene(), CASH1981, 'figures/redarmy', 2, 1), CASH1981, 'figures/redscout', 2, 2)
    expect(only(state).outskirts).toBe(7)
  })

  it('a figure in a square next to the outskirts does nothing', () => {
    expect(only(put(scene(), KARANDRAS1, 'figures/bluearmy', 3, 1)).outskirts).toBe(7)
  })

  it('the white army is a friend of the Russian player and an enemy of everyone else', () => {
    const asRussians = (state: GameState, playerId: string): GameState => ({
      ...state,
      players: state.players.map((p) =>
        p.playerId === playerId ? { ...p, civilization: { kind: 'civ', name: 'Russians' } as never } : p,
      ),
    })

    // Only the Russian player may place it; here that is Cash, so it is hers and blockades nobody of hers.
    const ownWhite = put(asRussians(scene(), CASH1981), CASH1981, 'figures/whitearmy', 2, 1)
    expect(only(ownWhite).outskirts).toBe(7)

    // Karandras is Russia: the white army in C2 is an enemy of Cash.
    const theirWhite = put(asRussians(scene(), KARANDRAS1), KARANDRAS1, 'figures/whitearmy', 2, 1)
    expect(only(theirWhite).outskirts).toBe(5)

    // With no Russian player the white army belongs to nobody, so it is an enemy of all.
    const nobodys: GameState = {
      ...ownWhite,
      players: ownWhite.players.map((p) => ({ ...p, civilization: null })),
    }
    expect(only(nobodys).outskirts).toBe(5)
  })
})

describe('metropolis', () => {
  it('lying down, counts its ten outskirts squares and neither centre', () => {
    // Centres B2 and C2 (column 1 and 2, row 1); the footprint is columns 0 to 3, rows 0 to 2.
    const state = putMetropolis(withEngland(game()), 2, 1, 0)
    const footprint = cityFootprintsOf(state, 'red')[0]
    expect(footprint?.centers).toHaveLength(2)
    expect(footprint?.outskirts).toHaveLength(10)

    const city = only(state)
    // B1 1, C1 1, B3 1, C3 2, and A1, A2, A3, D1, D2, D3 are water or grassland.
    // C2 is a forest and a centre: counted it would make 7.
    expect(city.outskirts).toBe(5)
    expect(city.outskirtsDetail).toHaveLength(4)
    expect(city.label).toBe('Metropolis C2')
  })

  it('standing up, counts its ten outskirts squares and neither centre', () => {
    // Centres B3 and B2 (column 1, rows 2 and 1); the footprint is columns 0 to 2, rows 0 to 3.
    const state = putMetropolis(withEngland(game()), 1, 2, 90)
    const footprint = cityFootprintsOf(state, 'red')[0]
    expect(footprint?.centers).toHaveLength(2)
    expect(footprint?.outskirts).toHaveLength(10)

    const city = only(state)
    // Column 2 gives 1 + 2 + 2 + 0, B1 gives 1 and B4 (a forest) 2: 8. The centres are
    // mountains, so counting them would make 10.
    expect(city.outskirts).toBe(8)
    expect(city.label).toBe('Metropolis B3')
  })
})

describe('modifiers', () => {
  it('lists no modifier for a player with none', () => {
    const city = only(scene())
    expect(city.modifiers).toEqual([])
    expect(city.estimate).toBe(city.outskirts)
  })

  it('Infrastructure adds one per investment, at most three', () => {
    const two = only(withStat(scene(), 'infra', 2))
    expect(modifier(two, 'Infrastructure')).toMatchObject({ amount: 2, applied: true })
    expect(two.estimate).toBe(9)

    const five = only(withStat(scene(), 'infra', 5))
    expect(modifier(five, 'Infrastructure')).toMatchObject({ amount: 3, applied: true })
    expect(modifier(five, 'Infrastructure')?.note).toContain('5')
    expect(five.estimate).toBe(10)
  })

  it('Despotism adds 1 per city, and only under Despotism', () => {
    const despotism = only(withGovernment(scene(), 'Despotism'))
    expect(modifier(despotism, 'Despotism')).toMatchObject({ amount: 1, applied: true })
    expect(despotism.estimate).toBe(8)

    expect(modifier(only(scene()), 'Despotism')).toBeUndefined()
  })

  describe('Chichen Itza', () => {
    const withWonder = (state: GameState, owner: string | null, column = 8, row = 8): GameState => {
      const placed = put(state, CASH1981, 'wonders/chichenitza', column, row)
      return owner === null
        ? placed
        : unwrap(setWonderOwner(placed, { playerId: CASH1981, pieceId: lastPiece(placed).id, ownerId: owner }))
    }

    it('adds 3 when Cash owns it and it is free', () => {
      const city = only(withWonder(scene(), CASH1981))
      expect(modifier(city, 'Chichen Itza')).toMatchObject({ amount: 3, applied: true })
      expect(city.estimate).toBe(10)
    })

    it('adds nothing when it has no owner or another player owns it', () => {
      expect(modifier(only(withWonder(scene(), null)), 'Chichen Itza')).toBeUndefined()
      expect(modifier(only(withWonder(scene(), KARANDRAS1)), 'Chichen Itza')).toBeUndefined()
    })

    it('is switched off, and says why, while an enemy figure stands on it', () => {
      const blocked = put(withWonder(scene(), CASH1981), KARANDRAS1, 'figures/bluearmy', 8, 8)
      const city = only(blocked)
      expect(modifier(city, 'Chichen Itza')).toMatchObject({ amount: 0, applied: false })
      expect(modifier(city, 'Chichen Itza')?.note).toContain('Blockaded')
      expect(city.estimate).toBe(7)
    })
  })

  describe('Susan B. Anthony', () => {
    it('adds 2 when she is revealed in the hand', () => {
      const city = only(withSusan(scene(), false))
      expect(modifier(city, 'Susan B. Anthony')).toMatchObject({ amount: 2, applied: true })
      expect(city.estimate).toBe(9)
    })

    it('adds nothing while she is hidden', () => {
      const city = only(withSusan(scene(), true))
      expect(city.modifiers).toEqual([])
      expect(city.estimate).toBe(7)
    })

    it('is switched off while every Humanitarian token of the player is blockaded', () => {
      // A Humanitarian token far from the city, placed by Cash, with a Blue army on it.
      const token = put(put(withSusan(scene(), false), CASH1981, 'great people/humanitarian', 8, 8), KARANDRAS1, 'figures/bluearmy', 8, 8)
      const city = only(token)
      expect(modifier(city, 'Susan B. Anthony')).toMatchObject({ amount: 0, applied: false })
      expect(city.estimate).toBe(7)

      // A second token that is free keeps her usable.
      const free = only(put(token, CASH1981, 'great people/humanitarian', 10, 10))
      expect(modifier(free, 'Susan B. Anthony')).toMatchObject({ amount: 2, applied: true })
    })
  })

  describe('Military Science', () => {
    it('adds one per three coins, rounded down, when revealed', () => {
      const seven = only(withCoins(withTech(scene(), 'Military Science', true), 7))
      expect(modifier(seven, 'Military Science')).toMatchObject({ amount: 2, applied: true })
      expect(seven.estimate).toBe(9)

      const three = only(withCoins(withTech(scene(), 'Military Science', true), 3))
      expect(modifier(three, 'Military Science')?.amount).toBe(1)

      const two = only(withCoins(withTech(scene(), 'Military Science', true), 2))
      expect(modifier(two, 'Military Science')?.amount).toBe(0)
      expect(two.estimate).toBe(7)
    })

    it('adds nothing while the tech is hidden, however many coins there are', () => {
      const city = only(withCoins(withTech(scene(), 'Military Science', false), 9))
      expect(city.modifiers).toEqual([])
      expect(city.estimate).toBe(7)
    })
  })

  it('every city gets the modifiers once, not once per square', () => {
    const second = put(withStat(scene(), 'infra', 2), CASH1981, 'cities/redcity2', 5, 1)
    const cities = citiesOf(second)
    expect(cities).toHaveLength(2)
    expect(cities.map((city) => modifier(city, 'Infrastructure')?.amount)).toEqual([2, 2])
  })
})

describe('building program', () => {
  it('doubles the outskirts and not the modifiers when the marker is on the city centre', () => {
    const state = put(withStat(scene(), 'infra', 2), CASH1981, 'markers/Building Program', 1, 1)
    const city = only(state)
    expect(city.buildingProgram).toBe(true)
    expect(city.estimate).toBe(7 + 2)
    expect(city.withBuildingProgram).toBe(7 * 2 + 2)
  })

  it('shows no second figure without the marker, or with it on an outskirts square', () => {
    expect(only(scene()).buildingProgram).toBe(false)
    expect(only(scene()).withBuildingProgram).toBeNull()

    const beside = only(put(scene(), CASH1981, 'markers/Building Program', 2, 1))
    expect(beside.buildingProgram).toBe(false)
    expect(beside.withBuildingProgram).toBeNull()
  })

  it('works from either centre of a metropolis', () => {
    const base = putMetropolis(withEngland(game()), 2, 1, 0)
    for (const column of [1, 2]) {
      const city = only(put(base, CASH1981, 'markers/Building Program', column, 1))
      expect(city.withBuildingProgram).toBe(city.outskirts * 2)
    }
  })

  it('belongs to the city it stands on', () => {
    const state = put(put(scene(), CASH1981, 'cities/redcity2', 5, 1), CASH1981, 'markers/Building Program', 5, 1)
    const [first, second] = citiesOf(state)
    expect(first?.buildingProgram).toBe(false)
    expect(second?.buildingProgram).toBe(true)
  })
})

describe('notes', () => {
  it('never call the estimate complete and are never empty', () => {
    const city = only(scene())
    expect(city.notes.length).toBeGreaterThan(0)
    expect(city.notes[0]).toMatch(/not a complete count/i)
    // "complete" may only appear in the negative.
    expect(city.notes.every((note) => !/\bcomplete\b/i.test(note) || /not a complete/i.test(note))).toBe(true)
  })

  it('name Communism, a revealed Urban Development and the Great Lighthouse', () => {
    const communism = only(withGovernment(scene(), 'Communism'))
    expect(communism.notes.some((note) => note.includes('Communism'))).toBe(true)
    expect(only(scene()).notes.some((note) => note.includes('Communism'))).toBe(false)

    const urban = only(withSocialPolicy(scene(), 'Urban Development', true))
    expect(urban.notes.some((note) => note.includes('Urban Development'))).toBe(true)

    const lighthouse = put(scene(), CASH1981, 'wonders/greatlighthouse', 8, 8)
    const owned = unwrap(setWonderOwner(lighthouse, { playerId: CASH1981, pieceId: lastPiece(lighthouse).id, ownerId: CASH1981 }))
    expect(only(owned).notes.some((note) => note.includes('Great Lighthouse'))).toBe(true)
  })

  it('name scouts that may send a square to another city, and the capital as the default', () => {
    expect(only(scene()).notes.some((note) => note.includes('scout'))).toBe(false)
    // No capital marker: a scout that was not sent goes nowhere
    expect(only(put(scene(), CASH1981, 'figures/redscout', 9, 9)).notes.join(' ')).toContain('no capital is marked on the map')
    const capital = put(put(game(), CASH1981, 'cities/redcapital2', 1, 1), CASH1981, 'figures/redscout', 9, 9)
    expect(only(capital).notes.join(' ')).toContain('a scout you did not send counts for your capital')
  })

  it('say when a square belongs to two of the player’s cities', () => {
    // Old data may overlap although base rules p. 13 forbid building so. B2 and D2 share column C.
    const state = put(scene(), CASH1981, 'cities/redcity2', 3, 1)
    const [first, second] = citiesOf(state)
    expect(first?.notes.some((note) => note.includes('another of your cities'))).toBe(true)
    expect(second?.notes.some((note) => note.includes('another of your cities'))).toBe(true)
    // Counted for each city, as the note says.
    expect(squaresOf(first as CityProduction)).toContainEqual(['C2', 'forest', 2])
    expect(squaresOf(second as CityProduction)).toContainEqual(['C2', 'forest', 2])
  })

  it('a square that is another city’s centre is not shared, only overlapping outskirts are', () => {
    // B2 and C2 side by side. Each is in the other's outskirts but is a centre, so it is
    // counted once, by the city whose outskirts it is in. B1, C1, B3 and C3 are outskirts of both.
    const state = put(scene(), CASH1981, 'cities/redcity2', 2, 1)
    const [first, second] = citiesOf(state)
    const sharedNote = (city: CityProduction | undefined): string | undefined =>
      city?.notes.find((note) => note.includes('another of your cities'))
    expect(sharedNote(first)).toBe('B1, B3, C1 and C3 also belong to another of your cities. They count for each city.')
    expect(sharedNote(second)).toBe('B1, B3, C1 and C3 also belong to another of your cities. They count for each city.')
    expect(sharedNote(first)).not.toContain('C2')
    expect(sharedNote(second)).not.toContain('B2')
  })

  it('two cities whose outskirts share one square say so in the singular', () => {
    // B2 and D4: only C3 lies in the outskirts of both.
    const state = put(scene(), CASH1981, 'cities/redcity2', 3, 3)
    const [first, second] = citiesOf(state)
    const expected = 'C3 also belongs to another of your cities. It counts for each city.'
    expect(first?.notes).toContain(expected)
    expect(second?.notes).toContain(expected)
  })

  it('cities with no common outskirts square carry no shared note', () => {
    const state = put(scene(), CASH1981, 'cities/redcity2', 5, 1)
    for (const city of citiesOf(state)) {
      expect(city.notes.some((note) => note.includes('another of your cities'))).toBe(false)
    }
  })

  it('a square with more than one building is named in the singular and the plural', () => {
    const one = put(put(scene(), CASH1981, 'buildings/workshop', 2, 1), CASH1981, 'buildings/temple', 2, 1)
    expect(only(one).notes).toContain('C2 holds more than one building. Only the one with most production counts.')

    const two = put(put(one, CASH1981, 'buildings/workshop', 2, 2), CASH1981, 'buildings/temple', 2, 2)
    expect(only(two).notes).toContain('C2 and C3 hold more than one building. Only the one with most production counts.')
  })

  it('a wonder or great person square is named in the singular and the plural', () => {
    const one = put(scene(), CASH1981, 'wonders/pyramids', 2, 2)
    expect(only(one).notes).toContain('C3 holds a wonder or a great person. Their icons are not in the data and count as 0.')

    const two = put(one, CASH1981, 'wonders/stonehenge', 2, 1)
    expect(only(two).notes).toContain('C2 and C3 hold a wonder or a great person. Their icons are not in the data and count as 0.')
  })

  it('a square with a building and a wonder is counted from the building and left out of the wonder note', () => {
    const state = put(put(scene(), CASH1981, 'buildings/workshop', 2, 1), CASH1981, 'wonders/pyramids', 2, 1)
    const city = only(state)
    expect(squaresOf(city)).toContainEqual(['C2', 'Workshop', 3])
    expect(city.notes.some((note) => note.includes('wonder or a great person'))).toBe(false)

    // A different square with only the wonder is still named, and C2 stays out of that note.
    const both = only(put(state, CASH1981, 'wonders/pyramids', 2, 2))
    const note = both.notes.find((entry) => entry.includes('wonder or a great person'))
    expect(note).toBe('C3 holds a wonder or a great person. Their icons are not in the data and count as 0.')
  })
})

describe('which cities are whose', () => {
  it('lists a player’s own cities in board order, and no one else’s', () => {
    let state = scene()
    state = put(state, KARANDRAS1, 'cities/bluecapital2', 9, 9)
    state = put(state, CASH1981, 'cities/redcapital2', 5, 1)
    const cities = citiesOf(state)
    expect(cities.map((city) => city.label)).toEqual(['City B2', 'Capital F2'])
    expect(citiesOf(state, KARANDRAS1).map((city) => city.label)).toEqual(['Capital J10'])
    expect(citiesOf(state, ITCHI)).toEqual([])
  })

  it('a player without a colour has no cities', () => {
    const state = scene()
    const colourless = { ...cash(state), color: null }
    expect(cityProductionsOf(state, colourless)).toEqual([])
  })
})

describe('the building table', () => {
  it('has a row for every building asset, with the human’s numbers', () => {
    // Cost 7/10, production 3/4, culture 2/3, trade 2/2 and combat bonus 2/4 are the pairs most easily mixed up.
    expect(buildingDataOf('buildings/workshop')).toEqual({ production: 3, trade: 0, culture: 0, coin: 0, cost: 7, combatBonus: 0 })
    expect(buildingDataOf('buildings/ironmine')).toEqual({ production: 4, trade: 0, culture: 0, coin: 0, cost: 10, combatBonus: 0 })
    expect(buildingDataOf('buildings/harbor')).toEqual({ production: 1, trade: 2, culture: 0, coin: 0, cost: 7, combatBonus: 0 })
    expect(buildingDataOf('buildings/tradingpost')).toEqual({ production: 0, trade: 2, culture: 1, coin: 0, cost: 7, combatBonus: 0 })
    expect(buildingDataOf('buildings/library')).toEqual({ production: 0, trade: 1, culture: 1, coin: 0, cost: 5, combatBonus: 0 })
    expect(buildingDataOf('buildings/university')).toEqual({ production: 0, trade: 2, culture: 2, coin: 0, cost: 8, combatBonus: 0 })
    expect(buildingDataOf('buildings/granary')).toEqual({ production: 1, trade: 1, culture: 0, coin: 0, cost: 5, combatBonus: 0 })
    expect(buildingDataOf('buildings/aqueduct')).toEqual({ production: 2, trade: 2, culture: 0, coin: 0, cost: 8, combatBonus: 0 })
    expect(buildingDataOf('buildings/market')).toEqual({ production: 1, trade: 1, culture: 1, coin: 0, cost: 7, combatBonus: 0 })
    expect(buildingDataOf('buildings/temple')).toEqual({ production: 0, trade: 0, culture: 2, coin: 0, cost: 7, combatBonus: 0 })
    expect(buildingDataOf('buildings/cathedral')).toEqual({ production: 0, trade: 0, culture: 3, coin: 0, cost: 10, combatBonus: 0 })
    expect(buildingDataOf('buildings/barracks')).toEqual({ production: 0, trade: 2, culture: 0, coin: 0, cost: 7, combatBonus: 2 })
    expect(buildingDataOf('buildings/academy')).toEqual({ production: 0, trade: 2, culture: 0, coin: 0, cost: 10, combatBonus: 4 })
    expect(buildingDataOf('buildings/shipyard')).toEqual({ production: 2, trade: 0, culture: 0, coin: 0, cost: 5, combatBonus: 2 })
    expect(buildingDataOf('buildings/militarydock')).toEqual({ production: 2, trade: 0, culture: 0, coin: 0, cost: 10, combatBonus: 4 })
    expect(buildingDataOf('buildings/bank')).toEqual({ production: 1, trade: 1, culture: 1, coin: 1, cost: 10, combatBonus: 0 })
  })

  it('covers every building piece the board can hold, and nothing else', () => {
    const buildingAssets = ['academy', 'aqueduct', 'bank', 'barracks', 'cathedral', 'granary', 'harbor', 'ironmine', 'library', 'market', 'militarydock', 'shipyard', 'temple', 'tradingpost', 'university', 'workshop']
    expect(Object.keys(BUILDING_DATA).sort()).toEqual(buildingAssets.map((name) => `buildings/${name}`).sort())
    for (const key of Object.keys(BUILDING_DATA)) expect(findBoardAsset(key)?.category).toBe('building')
  })

  it('answers undefined for anything that is not a building, including inherited object keys', () => {
    expect(buildingDataOf('wonders/pyramids')).toBeUndefined()
    expect(buildingDataOf('constructor')).toBeUndefined()
  })
})

describe('the manual override', () => {
  const set = (state: GameState, value: number | null, playerId = CASH1981): GameState =>
    unwrap(setCityProductionOverride(state, { playerId, pieceId: cityPiece(state).id, value, at: AT }))

  it('wins over the estimate and leaves the estimate where it was', () => {
    const city = only(set(scene(), 11))
    expect(city.override).toBe(11)
    expect(city.effective).toBe(11)
    expect(city.estimate).toBe(7)
    expect(city.outskirts).toBe(7)
  })

  it('can be 0, which is a number and not "no override"', () => {
    const city = only(set(scene(), 0))
    expect(city.override).toBe(0)
    expect(city.effective).toBe(0)
  })

  it('is removed by null, and the field leaves the piece altogether', () => {
    const cleared = set(set(scene(), 11), null)
    expect(only(cleared).override).toBeNull()
    expect(only(cleared).effective).toBe(7)
    expect('productionOverride' in cityPiece(cleared)).toBe(false)
  })

  it('can be set by any player in the game, and is recorded in the history', () => {
    const state = set(scene(), 4, KARANDRAS1)
    const entry = state.board.history.at(-1)
    expect(entry?.change).toEqual({ kind: 'productionOverride', pieceId: cityPiece(state).id, from: null, to: 4 })
    expect(entry?.playerId).toBe(KARANDRAS1)
    expect(entry?.description).toBe('Karandras1 set the production of Red city at B2 to 4')
    expect(set(state, null).board.history.at(-1)?.description).toBe('cash1981 removed the typed production of Red city at B2')
  })

  it('is refused for a stranger, a missing piece, a piece that is not a city, and a bad number', () => {
    const state = scene()
    const id = cityPiece(state).id
    const input = { playerId: CASH1981, pieceId: id, at: AT }
    expect(unwrapErr(setCityProductionOverride(state, { ...input, playerId: 'stranger', value: 3 }))).toEqual({ kind: 'NO_ACCESS', playerId: 'stranger' })
    expect(unwrapErr(setCityProductionOverride(state, { ...input, pieceId: 'nope', value: 3 }))).toEqual({ kind: 'BOARD_PIECE_NOT_FOUND', pieceId: 'nope' })

    const withBuilding = put(state, CASH1981, 'buildings/workshop', 8, 8)
    const building = lastPiece(withBuilding)
    expect(unwrapErr(setCityProductionOverride(withBuilding, { ...input, pieceId: building.id, value: 3 }))).toEqual({ kind: 'PIECE_NOT_A_CITY', pieceId: building.id })

    for (const value of [-1, 100, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(unwrapErr(setCityProductionOverride(state, { ...input, value })).kind, `value ${value}`).toBe('INVALID_PRODUCTION_OVERRIDE')
    }
    expect(describeError({ kind: 'INVALID_PRODUCTION_OVERRIDE', value: 100 })).toContain('between 0 and 99')
    expect(describeError({ kind: 'PIECE_NOT_A_CITY', pieceId: 'x' })).toContain('not a city')
    // The edges are fine.
    expect(only(set(state, 99)).override).toBe(99)
    expect(only(set(state, 0)).override).toBe(0)
  })

  it('leaves the state alone when the value is the one it already has', () => {
    const state = set(scene(), 6)
    expect(unwrap(setCityProductionOverride(state, { playerId: CASH1981, pieceId: cityPiece(state).id, value: 6 }))).toBe(state)
    const plain = scene()
    expect(unwrap(setCityProductionOverride(plain, { playerId: CASH1981, pieceId: cityPiece(plain).id, value: null }))).toBe(plain)
  })

  it('is undone by the board Undo, and redone', () => {
    const first = set(scene(), 6)
    const second = set(first, 9)
    expect(only(second).override).toBe(9)

    // Undo brings the old value back, not the estimate.
    const undone = unwrap(undoLastBoardChange(second, CASH1981))
    expect(only(undone).override).toBe(6)
    const undoneAgain = unwrap(undoLastBoardChange(undone, CASH1981))
    expect(only(undoneAgain).override).toBeNull()
    expect('productionOverride' in cityPiece(undoneAgain)).toBe(false)

    const redone = unwrap(redoLastBoardChange(undoneAgain, CASH1981))
    expect(only(redone).override).toBe(6)
  })

  it('undoing a removal puts the typed value back', () => {
    const cleared = set(set(scene(), 6), null)
    expect(only(unwrap(undoLastBoardChange(cleared, CASH1981))).override).toBe(6)
  })

  it('follows time travel through the board history', () => {
    const state = set(set(set(scene(), 6), 9), null)
    const history = state.board.history
    const stepOfOverride = (step: number): number | undefined =>
      piecesAtStep(history, step).find((piece) => piece.category === 'city')?.productionOverride
    const base = history.findIndex((entry) => entry.change.kind === 'productionOverride')
    expect(stepOfOverride(base)).toBeUndefined()
    expect(stepOfOverride(base + 1)).toBe(6)
    expect(stepOfOverride(base + 2)).toBe(9)
    expect(stepOfOverride(base + 3)).toBeUndefined()
  })

  it('stays with the city when it moves, and goes when it is removed', () => {
    const state = set(scene(), 5)
    const moved = unwrap(
      movePiece(state, { playerId: CASH1981, pieceId: cityPiece(state).id, x: 5 * SQUARE_SIZE, y: mapTop(state.board) + 5 * SQUARE_SIZE }),
    )
    expect(only(moved).override).toBe(5)
    expect(citiesOf(unwrap(removePiece(state, { playerId: CASH1981, pieceId: cityPiece(state).id })))).toEqual([])
  })

  it('survives a reload: a saved game loads to exactly what was saved', () => {
    const state = set(scene(), 12)
    const saved = JSON.parse(JSON.stringify(state)) as GameState
    const loaded = migrateGameState(saved)
    expect(JSON.stringify(loaded)).toBe(JSON.stringify(state))
    expect(only(loaded).override).toBe(12)
  })

  it('an old game without the field loads unchanged, and the field stays absent', () => {
    const state = scene()
    expect(cityPiece(state)).not.toHaveProperty('productionOverride')
    const loaded = migrateGameState(JSON.parse(JSON.stringify(state)) as GameState)
    expect(JSON.stringify(loaded)).toBe(JSON.stringify(state))
    expect(cityPiece(loaded)).not.toHaveProperty('productionOverride')
    expect(only(loaded).override).toBeNull()
  })
})

describe('the projection', () => {
  it('carries the cities on the own view and on every opponent', () => {
    const state = put(scene(), KARANDRAS1, 'cities/bluecity2', 9, 9)
    const view = toPlayerView(state, CASH1981)
    expect(view.you?.cities.map((city) => city.estimate)).toEqual([7])
    const karandras = view.opponents.find((opponent) => opponent.playerId === KARANDRAS1)
    expect(karandras?.cities).toHaveLength(1)
    expect(karandras?.cities[0]?.label).toBe('City J10')
    // A player with no city has an empty list, not a missing field.
    expect(view.opponents.find((opponent) => opponent.playerId === ITCHI)?.cities).toEqual([])
  })
})
