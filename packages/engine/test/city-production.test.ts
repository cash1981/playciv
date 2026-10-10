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
import { cityFootprintsOf } from '../src/blockade.js'
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
import type { CityProduction } from '../src/city-production.js'
import { describeError } from '../src/errors.js'
import type { GreatPersonItem } from '../src/item.js'
import { migrateGameState } from '../src/migrate.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { GameState } from '../src/state.js'
import { tileTerrainGrid } from '../src/terrain.js'

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

  it('a wonder or a great person in a square gives 0 and is named in the notes', () => {
    const wonder = put(scene(), CASH1981, 'wonders/pyramids', 2, 2)
    const city = only(wonder)
    expect(city.outskirts).toBe(5)
    expect(squaresOf(city)).toContainEqual(['C3', 'wonder', 0])
    expect(city.notes.some((note) => note.includes('C3') && note.includes('wonder'))).toBe(true)

    const person = only(put(scene(), CASH1981, 'great people/general', 2, 2))
    expect(person.outskirts).toBe(5)
    expect(squaresOf(person)).toContainEqual(['C3', 'great person', 0])
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

  it('name scouts that may send a square to another city', () => {
    expect(only(scene()).notes.some((note) => note.includes('scout'))).toBe(false)
    expect(only(put(scene(), CASH1981, 'figures/redscout', 9, 9)).notes.some((note) => note.includes('scout'))).toBe(true)
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

    const two = put(one, CASH1981, 'great people/general', 2, 1)
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
