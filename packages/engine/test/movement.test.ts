/**
 * Figure movement (issue #302): cardinal steps up to the travel speed, water
 * rules, the once-a-turn lock, and the undo that gives the move back.
 */

import { describe, expect, it } from 'vitest'

import { movePiece, placePiece, redoLastBoardChange, travelFigure, undoLastBoardChange } from '../src/actions/board.js'
import { travelGroup } from '../src/actions/travel-group.js'
import {
  SQUARE_SIZE,
  findBoardAsset,
  mapTop,
  type BoardPiece,
} from '../src/board.js'
import {
  arrangeWithinSquare,
  checkRoute,
  figureMovementOptions,
  groupMovementOptions,
  movementOf,
  movementTotal,
  planGroupRoute,
  planRoute,
  splitMovement,
  travelSpeedOf,
} from '../src/movement.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState, Playerhand } from '../src/state.js'
import { turnStatus } from '../src/turn.js'
import { terrainAt } from '../src/terrain.js'

import { coverMap } from './cover-map.js'
import { CASH1981, KARANDRAS1, firstCivGame } from './fixture.js'

/** The fixture has four Red seats; movement needs a real owner per seat. */
function game(): GameState {
  const base = firstCivGame()
  const colours = ['Red', 'Blue', 'Green', 'Purple']
  return {
    ...base,
    players: base.players.map((player, index) => ({
      ...player,
      color: colours[index] ?? 'Yellow',
    })),
  }
}

const playerOf = (state: GameState, playerId = CASH1981): Playerhand => {
  const player = state.players.find((candidate) => candidate.playerId === playerId)
  if (player === undefined) throw new Error('missing fixture player')
  return player
}

const withPlayer = (state: GameState, player: Playerhand): GameState => ({
  ...state,
  players: state.players.map((candidate) =>
    candidate.playerId === player.playerId ? player : candidate,
  ),
})

/** Places a piece with its centre in the map square at `column`, `row`. */
function place(
  state: GameState,
  assetId: string,
  column: number,
  row: number,
  playerId = CASH1981,
): GameState {
  state = coverMap(state)
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`missing asset ${assetId}`)
  return unwrap(
    placePiece(state, {
      playerId,
      assetId,
      x: Math.round(column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2),
      y: Math.round(mapTop(state.board) + row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2),
    }),
  )
}

function placeTile(state: GameState, assetId: string): GameState {
  return unwrap(
    placePiece(state, {
      playerId: CASH1981,
      assetId,
      x: 0,
      y: mapTop(state.board),
    }),
  )
}

const figure = (state: GameState): BoardPiece => {
  const piece = state.board.pieces.find((candidate) => candidate.category === 'figure')
  if (piece === undefined) throw new Error('no figure on the board')
  return piece
}

const withTech = (state: GameState, name: string, hidden = false): GameState => {
  const player = playerOf(state)
  return withPlayer(state, {
    ...player,
    techsChosen: [
      ...player.techsChosen,
      { name, hidden } as Playerhand['techsChosen'][number],
    ],
  })
}

const withSailing = (state: GameState): GameState => withTech(state, 'Sailing')

describe('movement speed', () => {
  it('adds the parts of the Movement expression', () => {
    expect(movementTotal('2')).toBe(2)
    expect(movementTotal('3+1')).toBe(4)
    expect(movementTotal('2+1+1')).toBe(4)
  })

  it('splits the typed Movement into its base and its bonus', () => {
    expect(splitMovement('2')).toEqual({ base: 2, bonus: 0, spain: 0 })
    expect(splitMovement('2+1')).toEqual({ base: 2, bonus: 1, spain: 0 })
    expect(splitMovement('3+1+1')).toEqual({ base: 3, bonus: 2, spain: 0 })
    expect(splitMovement('3', true)).toEqual({ base: 2, bonus: 0, spain: 1 })
    expect(splitMovement('3+1', true)).toEqual({ base: 2, bonus: 1, spain: 1 })
    expect(splitMovement('')).toEqual({ base: 0, bonus: 0, spain: 0 })
    expect(splitMovement('x+1')).toEqual({ base: 1, bonus: 0, spain: 0 })
  })

  it('gives Natural Religion +1 to an army but not a scout', () => {
    let state = place(game(), 'figures/redarmy', 1, 1)
    state = place(state, 'figures/redscout', 4, 1)
    const player = playerOf(state)
    const religious = withPlayer(state, {
      ...player,
      socialPolicies: [
        { name: 'Natural Religion', hidden: false } as Playerhand['socialPolicies'][number],
      ],
    })
    const armyPiece = religious.board.pieces.find((piece) => piece.assetId === 'figures/redarmy')
    const scoutPiece = religious.board.pieces.find((piece) => piece.assetId === 'figures/redscout')
    if (armyPiece === undefined || scoutPiece === undefined) throw new Error('missing figure')

    expect(travelSpeedOf(player, armyPiece, 1)).toBe(2)
    expect(travelSpeedOf(playerOf(religious), armyPiece, 1)).toBe(3)
    expect(travelSpeedOf(playerOf(religious), scoutPiece, 1)).toBe(2)

    // An expression that already contains a bonus, as older saves typed Natural
    // Religion (`3+1`), is not given the bonus a second time.
    const typed = withPlayer(religious, {
      ...playerOf(religious),
      stats: { ...playerOf(religious).stats, mvmt: '3+1' },
    })
    expect(travelSpeedOf(playerOf(typed), armyPiece, 1)).toBe(4)
    // ...and the scout does not get the army-only bonus from it.
    expect(travelSpeedOf(playerOf(typed), scoutPiece, 1)).toBe(3)

    const hidden = withPlayer(state, {
      ...player,
      socialPolicies: [
        { name: 'Natural Religion', hidden: true } as Playerhand['socialPolicies'][number],
      ],
    })
    expect(travelSpeedOf(playerOf(hidden), armyPiece, 1)).toBe(2)

    const anarchy = withPlayer(religious, {
      ...playerOf(religious),
      government: 'Anarchy',
    })
    expect(travelSpeedOf(playerOf(anarchy), armyPiece, 1)).toBe(2)
  })

  it('gives a Spanish army 4 and a Spanish scout 3 with Natural Religion, and Spain keeps its +1 without it or in Anarchy', () => {
    let state = place(game(), 'figures/redarmy', 1, 1)
    state = place(state, 'figures/redscout', 4, 1)
    const army = state.board.pieces.find((piece) => piece.assetId === 'figures/redarmy')
    const scout = state.board.pieces.find((piece) => piece.assetId === 'figures/redscout')
    if (army === undefined || scout === undefined) throw new Error('missing figure')
    const spanish = (mvmt: string, religion: boolean, government?: string): Playerhand => {
      const player = playerOf(state)
      return {
        ...player,
        civilization: { kind: 'civ', name: 'Spanish' } as unknown as Playerhand['civilization'],
        stats: { ...player.stats, mvmt },
        socialPolicies: religion ? [{ name: 'Natural Religion', hidden: false } as Playerhand['socialPolicies'][number]] : [],
        ...(government === undefined ? {} : { government }),
      } as Playerhand
    }
    // Spain's +1 is not the older typed Natural Religion bonus: the army adds its own +1 on top of it
    expect(travelSpeedOf(spanish('3', true), army, 1)).toBe(4)
    expect(travelSpeedOf(spanish('3', true), scout, 1)).toBe(3)
    // Without Natural Religion both travel 3, and under Anarchy (no policy effect) too
    expect(travelSpeedOf(spanish('3', false), army, 1)).toBe(3)
    expect(travelSpeedOf(spanish('3', false), scout, 1)).toBe(3)
    expect(travelSpeedOf(spanish('3', true, 'Anarchy'), army, 1)).toBe(3)
    expect(travelSpeedOf(spanish('3', true, 'Anarchy'), scout, 1)).toBe(3)
    // A legacy typed `+` for Natural Religion on top of Spain's: still the army's speed, the scout gives it back
    expect(travelSpeedOf(spanish('3+1', true), army, 1)).toBe(4)
    expect(travelSpeedOf(spanish('3+1', true), scout, 1)).toBe(3)
    // Other civilizations keep the older reading of `2+1`
    const roman = { ...spanish('2+1', true), civilization: { kind: 'civ', name: 'Romans' } as unknown as Playerhand['civilization'] }
    expect(travelSpeedOf(roman, army, 1)).toBe(3)
    expect(travelSpeedOf(roman, scout, 1)).toBe(2)
  })

  it('takes the highest speed a revealed tech gives, never below the typed one, and the techs do not add up', () => {
    const state = place(game(), 'figures/redarmy', 1, 1)
    const piece = figure(state)
    const speedWith = (names: readonly string[], hidden = false, mvmt = '2'): number => {
      const tech = names.reduce((held, name) => withTech(held, name, hidden), state)
      const player = playerOf(tech)
      return travelSpeedOf({ ...player, stats: { ...player.stats, mvmt } }, piece, 1)
    }
    expect(speedWith([])).toBe(2)
    expect(speedWith(['Horseback Riding'])).toBe(3)
    expect(speedWith(['Sailing'])).toBe(4)
    expect(speedWith(['Steam Power'])).toBe(5)
    // The highest counts, whatever the order: they do not add up
    expect(speedWith(['Horseback Riding', 'Sailing'])).toBe(4)
    expect(speedWith(['Steam Power', 'Horseback Riding', 'Sailing'])).toBe(5)
    expect(speedWith(['Flight'])).toBe(6)
    expect(speedWith(['Flight', 'Steam Power', 'Sailing'])).toBe(6)
    // A hidden tech gives nothing, and a tech with no speed of its own leaves the typed one
    expect(speedWith(['Steam Power'], true)).toBe(2)
    expect(speedWith(['Flight'], true)).toBe(2)
    expect(speedWith(['Mathematics'])).toBe(2)
    // A typed value above what the techs give stays, so a correction by hand still wins
    expect(speedWith(['Sailing'], false, '6')).toBe(6)
    // A typed bonus (Spain's +1) is added on top of the tech's speed, and is not swallowed by it
    expect(speedWith(['Sailing'], false, '2+1')).toBe(5)
    expect(speedWith(['Horseback Riding'], false, '2+1')).toBe(4)
    expect(speedWith(['Flight'], false, '2+1')).toBe(7)
    expect(speedWith([], false, '2+1')).toBe(3)
    // Spain's typed `3` holds its +1: a tech replaces only the 2 under it
    const spanishWith = (names: readonly string[], mvmt: string): number => {
      const tech = names.reduce((held, name) => withTech(held, name, false), state)
      const player = playerOf(tech)
      return travelSpeedOf(
        { ...player, civilization: { kind: 'civ', name: 'Spanish' } as unknown as Playerhand['civilization'], stats: { ...player.stats, mvmt } },
        piece,
        1,
      )
    }
    expect(spanishWith([], '3')).toBe(3)
    expect(spanishWith(['Sailing'], '3')).toBe(5)
    expect(spanishWith(['Horseback Riding'], '3')).toBe(4)
    // A typed base that is higher than the tech's stays, with its bonus
    expect(speedWith(['Sailing'], false, '3+1')).toBe(5)
    expect(speedWith(['Horseback Riding'], false, '5+1')).toBe(6)

    // Natural Religion, Henry Ford and Captain James Cook apply on top of the tech's speed
    const religious = (mvmt: string) => {
      const tech = withTech(state, 'Sailing')
      const player = playerOf(tech)
      return travelSpeedOf({ ...player, stats: { ...player.stats, mvmt }, socialPolicies: [{ name: 'Natural Religion', hidden: false } as Playerhand['socialPolicies'][number]] }, piece, 1)
    }
    expect(religious('2')).toBe(5)
    // `3+1` typed as an older save did: its base is 3, the tech gives 4, the army gets the bonus once
    expect(religious('3+1')).toBe(5)
  })

  it('adds Henry Ford while faceup and doubles with Captain James Cook this turn', () => {
    const state = place(game(), 'figures/redarmy', 1, 1)
    const piece = figure(state)
    const withFord = withPlayer(state, {
      ...playerOf(state),
      items: [
        {
          kind: 'greatperson',
          name: 'Henry Ford',
          hidden: false,
        } as Playerhand['items'][number],
      ],
    })
    expect(travelSpeedOf(playerOf(withFord), piece, 1)).toBe(3)

    const withCook = withPlayer(withFord, {
      ...playerOf(withFord),
      playerTurns: [
        {
          turnNumber: 1,
          usedActions: ['card:Captain James Cook'],
        } as unknown as Playerhand['playerTurns'][number],
      ],
    })
    expect(travelSpeedOf(playerOf(withCook), piece, 1)).toBe(6)
  })

  it('does not apply Henry Ford while every Builder or Inventor token is blockaded', () => {
    let state = place(game(), 'figures/redarmy', 1, 1)
    state = place(state, 'great people/builder', 5, 5)
    const unblocked = withPlayer(state, {
      ...playerOf(state),
      items: [
        {
          kind: 'greatperson',
          name: 'Henry Ford',
          type: 'Builder or Inventor',
          hidden: false,
        } as Playerhand['items'][number],
      ],
    })
    const piece = figure(unblocked)
    expect(
      travelFigure(unblocked, { playerId: CASH1981, pieceId: piece.id, column: 4, row: 1 }).ok,
    ).toBe(true)

    const blocked = place(unblocked, 'figures/bluearmy', 5, 5, KARANDRAS1)
    const blockedPiece = figure(blocked)
    expect(
      unwrapErr(
        travelFigure(blocked, {
          playerId: CASH1981,
          pieceId: blockedPiece.id,
          column: 4,
          row: 1,
        }),
      ).kind,
    ).toBe('FIGURE_MOVE_ILLEGAL')
  })
})

describe('reachable squares', () => {
  it('lists cardinal squares within the speed, never diagonals', () => {
    const state = place(game(), 'figures/redarmy', 1, 1)
    const options = figureMovementOptions(state.board, playerOf(state), figure(state), 1)
    if (options === null) throw new Error('expected movement options')

    expect(options.speed).toBe(2)
    expect(options.destinations).toContainEqual(
      expect.objectContaining({ column: 1, row: 2, distance: 1, label: 'B3' }),
    )
    expect(options.destinations).toContainEqual(
      expect.objectContaining({ column: 3, row: 1, distance: 2 }),
    )
    // A diagonal square is reached in two cardinal steps, not one jump.
    expect(options.destinations).toContainEqual(
      expect.objectContaining({ column: 2, row: 2, distance: 2 }),
    )
  })

  it('does not walk through another figure to reach the square beyond it', () => {
    let state = place(game(), 'figures/redarmy', 1, 1)
    state = place(state, 'figures/bluearmy', 2, 1, KARANDRAS1)
    const options = figureMovementOptions(state.board, playerOf(state), figure(state), 1)
    if (options === null) throw new Error('expected movement options')
    expect(options.destinations.some((cell) => cell.column === 3 && cell.row === 1)).toBe(false)
  })

  it('offers no destinations once the whole speed is spent', () => {
    const state = place(game(), 'figures/redarmy', 1, 1)
    const piece = figure(state)
    const travelled = unwrap(
      travelFigure(state, { playerId: CASH1981, pieceId: piece.id, column: 1, row: 3 }),
    )
    const moved = figure(travelled)
    const options = figureMovementOptions(travelled.board, playerOf(travelled), moved, 1)
    if (options === null) throw new Error('expected movement options')

    expect(moved.movement).toMatchObject({ turn: 1, used: 2, locked: true })
    expect(options.locked).toBe(true)
    expect(options.destinations).toHaveLength(0)
  })

  it('is fresh again on the next turn', () => {
    const state = place(game(), 'figures/redarmy', 1, 1)
    const piece = figure(state)
    const travelled = unwrap(
      travelFigure(state, { playerId: CASH1981, pieceId: piece.id, column: 1, row: 2 }),
    )
    const options = figureMovementOptions(
      travelled.board,
      playerOf(travelled),
      figure(travelled),
      2,
    )
    if (options === null) throw new Error('expected movement options')
    expect(options.locked).toBe(false)
    expect(options.destinations.length).toBeGreaterThan(0)
  })
})

// Tile 05 has water in the upper-left and land below it.
const waterGame = (): GameState =>
  place(placeTile(game(), 'tiles/tile05'), 'figures/redarmy', 0, 3)

describe('a metropolis on a water square (Fame and Fortune p. 10)', () => {
  /** Tile 05: row 1 is water, water, grass, forest. A horizontal metropolis lies on (1,1) water and (2,1) grass. */
  const withMetropolis = (on: boolean): GameState => {
    let state = place(placeTile(game(), 'tiles/tile05'), 'figures/redarmy', 3, 1)
    if (!on) return state
    const asset = findBoardAsset('cities/redmetropolis2')
    if (asset === undefined) throw new Error('missing metropolis')
    state = unwrap(
      placePiece(state, {
        playerId: CASH1981,
        assetId: asset.id,
        x: Math.round(2 * SQUARE_SIZE - 1 - asset.width / 2),
        y: Math.round(mapTop(state.board) + SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2),
      }),
    )
    return state
  }
  const reach = (state: GameState, column: number, row: number): number | undefined => {
    const army = state.board.pieces.find((piece) => piece.assetId === 'figures/redarmy')
    if (army === undefined) throw new Error('army missing')
    const options = figureMovementOptions(state.board, playerOf(state), army, 1)
    if (options === null) throw new Error('expected movement options')
    return options.destinations.find((cell) => cell.column === column && cell.row === row)?.distance
  }

  it('is land for movement: an army may end its move on the water square the metropolis covers', () => {
    const water = (state: GameState): string | null => terrainAt(state.board, 1.5 * SQUARE_SIZE, mapTop(state.board) + 1.5 * SQUARE_SIZE)
    expect(water(withMetropolis(false))).toBe('water')
    expect(reach(withMetropolis(false), 1, 1)).toBeUndefined()
    expect(reach(withMetropolis(true), 1, 1)).toBe(2)
  })
})

describe('a vertical metropolis on a water square (Fame and Fortune p. 10)', () => {
  /** Tile 05 column 0 is water, water, water, grass: a vertical metropolis lies on (0,2) water and (0,3) grass. */
  const withVertical = (on: boolean): GameState => {
    let state = place(placeTile(game(), 'tiles/tile05'), 'figures/redarmy', 1, 3)
    if (!on) return state
    const asset = findBoardAsset('cities/redmetropolis2')
    if (asset === undefined) throw new Error('missing metropolis')
    state = unwrap(
      placePiece(state, {
        playerId: CASH1981,
        assetId: asset.id,
        rotation: 90,
        x: Math.round(SQUARE_SIZE / 2 - asset.width / 2),
        y: Math.round(mapTop(state.board) + 3 * SQUARE_SIZE - 1 - asset.height / 2),
      }),
    )
    return state
  }

  it('is land for travel on both of its squares (the water square is reachable and the figure may end on it)', () => {
    for (const [on, expected] of [[false, undefined], [true, 2]] as const) {
      const state = withVertical(on)
      const army = state.board.pieces.find((piece) => piece.assetId === 'figures/redarmy')
      if (army === undefined) throw new Error('army missing')
      const travel = figureMovementOptions(state.board, playerOf(state), army, 1)?.destinations.find((cell) => cell.column === 0 && cell.row === 2)
      expect(travel?.distance).toBe(expected)
    }
  })
})

describe('Flight', () => {
  const distanceTo = (state: GameState, column: number, row: number): number | undefined => {
    const options = figureMovementOptions(state.board, playerOf(state), figure(state), 1)
    if (options === null) throw new Error('expected movement options')
    return options.destinations.find((cell) => cell.column === column && cell.row === row)?.distance
  }

  it('moves 6 squares', () => {
    const flying = withTech(place(game(), 'figures/redarmy', 1, 1), 'Flight')
    expect(distanceTo(flying, 7, 1)).toBe(6)
    expect(distanceTo(flying, 8, 1)).toBeUndefined()
  })

  it("flies over another player's figures, which block the same squares for a figure without it", () => {
    let state = place(game(), 'figures/redarmy', 1, 1)
    state = place(state, 'figures/bluearmy', 2, 1, KARANDRAS1)
    // The same speed typed by hand: the army can end on the Blue army's square but not pass it, so it goes round
    const walker = withPlayer(state, { ...playerOf(state), stats: { ...playerOf(state).stats, mvmt: '6' } })
    expect(distanceTo(walker, 3, 1)).toBe(4)
    const flying = withTech(state, 'Flight')
    expect(distanceTo(flying, 3, 1)).toBe(2)
    // It may still end its move on the Blue army to fight it, as an army without Flight may
    expect(distanceTo(flying, 2, 1)).toBe(1)
  })

  it('is not stopped by buildings and cities on the way', () => {
    let state = place(game(), 'figures/redarmy', 1, 1)
    state = place(state, 'cities/bluecity2', 2, 1, KARANDRAS1)
    state = place(state, 'buildings/library', 3, 1, KARANDRAS1)
    const flying = withTech(state, 'Flight')
    expect(distanceTo(flying, 4, 1)).toBe(3)
  })
})

describe('huts and villages', () => {
  it.each(['resources/hut', 'resources/village'])(
    'stops a move on a %s square unless Flight flies over it',
    (assetId) => {
      let state = place(game(), 'figures/redarmy', 1, 1)
      state = place(state, assetId, 2, 1)
      const options = figureMovementOptions(state.board, playerOf(state), figure(state), 1)
      if (options === null) throw new Error('expected movement options')
      expect(options.destinations).toContainEqual(
        expect.objectContaining({ column: 2, row: 1, distance: 1 }),
      )
      expect(options.destinations.some((cell) => cell.column === 3 && cell.row === 1)).toBe(false)

      const flying = withTech(state, 'Flight')
      const flown = figureMovementOptions(flying.board, playerOf(flying), figure(flying), 1)
      if (flown === null) throw new Error('expected movement options')
      expect(flown.destinations).toContainEqual(
        expect.objectContaining({ column: 3, row: 1, distance: 2 }),
      )
      // Flight crosses the marker or lands on it; landing ends the move. Ruling 283 (cross, never end) is
      // about the Migrants, Colonists and Immigrants cards only.
      expect(flown.destinations).toContainEqual(
        expect.objectContaining({ column: 2, row: 1, distance: 1, ends: true }),
      )
    },
  )

  it('lets a figure that starts on a hut move away', () => {
    let state = place(game(), 'figures/redarmy', 2, 1)
    state = place(state, 'resources/hut', 2, 1)
    const options = figureMovementOptions(state.board, playerOf(state), figure(state), 1)
    if (options === null) throw new Error('expected movement options')
    expect(options.destinations).toContainEqual(
      expect.objectContaining({ column: 3, row: 1, distance: 1 }),
    )
  })

  it('does not fly over with a hidden Flight', () => {
    let state = place(game(), 'figures/redarmy', 1, 1)
    state = place(state, 'resources/hut', 2, 1)
    state = withTech(state, 'Flight', true)
    const options = figureMovementOptions(state.board, playerOf(state), figure(state), 1)
    if (options === null) throw new Error('expected movement options')
    expect(options.destinations.some((cell) => cell.column === 3 && cell.row === 1)).toBe(false)
  })

  it('refuses to travel past a hut without Flight', () => {
    let state = place(game(), 'figures/redarmy', 1, 1)
    state = place(state, 'resources/hut', 2, 1)
    const piece = figure(state)
    expect(
      unwrapErr(travelFigure(state, { playerId: CASH1981, pieceId: piece.id, column: 3, row: 1 })).kind,
    ).toBe('FIGURE_MOVE_ILLEGAL')
    const stopped = unwrap(
      travelFigure(state, { playerId: CASH1981, pieceId: piece.id, column: 2, row: 1 }),
    ).board.pieces.find((candidate) => candidate.id === piece.id)
    expect(stopped?.movement).toMatchObject({ turn: 1, used: 1, locked: true })
  })
})

describe('water', () => {
  it('does not offer a water square without a water tech', () => {
    const state = waterGame()
    const options = figureMovementOptions(state.board, playerOf(state), figure(state), 1)
    if (options === null) throw new Error('expected movement options')
    const x = 0 * SQUARE_SIZE + SQUARE_SIZE / 2
    const y = mapTop(state.board) + 2 * SQUARE_SIZE + SQUARE_SIZE / 2
    expect(terrainAt(state.board, x, y)).toBe('water')
    expect(options.destinations.some((cell) => cell.column === 0 && cell.row === 2)).toBe(false)
  })

  it('offers water with Sailing, Steam Power or Flight', () => {
    const state = withSailing(waterGame())
    const options = figureMovementOptions(state.board, playerOf(state), figure(state), 1)
    if (options === null) throw new Error('expected movement options')
    expect(options.destinations.some((cell) => cell.column === 0 && cell.row === 2)).toBe(true)
  })

  it('lets England cross water but never end there', () => {
    // A4 (grassland) has only two neighbours: A3 (water) and B4 (forest).
    // Put an enemy on B4 so the only two-step way to B3 (grassland) is across A3.
    const blocked = place(waterGame(), 'figures/bluearmy', 1, 3, KARANDRAS1)
    const base = withPlayer(blocked, {
      ...playerOf(blocked),
      civilization: { name: 'England' } as Playerhand['civilization'],
    })
    const options = figureMovementOptions(base.board, playerOf(base), figure(base), 1)
    if (options === null) throw new Error('expected movement options')
    expect(options.destinations).toContainEqual(
      expect.objectContaining({ column: 1, row: 2, distance: 2 }),
    )
    expect(options.destinations.some((cell) => cell.column === 0 && cell.row === 2)).toBe(false)

    // Without England, the same blocked route leaves B3 unreachable.
    const noCrossing = figureMovementOptions(blocked.board, playerOf(blocked), figure(blocked), 1)
    if (noCrossing === null) throw new Error('expected movement options')
    expect(noCrossing.destinations.some((cell) => cell.column === 1 && cell.row === 2)).toBe(false)
  })
})

describe('Navigation', () => {
  it('lets a figure cross water, but not end there when no fog touches it', () => {
    const blocked = place(waterGame(), 'figures/bluearmy', 1, 3, KARANDRAS1)
    const navigator = withTech(blocked, 'Navigation')
    const options = figureMovementOptions(navigator.board, playerOf(navigator), figure(navigator), 1)
    if (options === null) throw new Error('expected movement options')
    expect(options.destinations).toContainEqual(expect.objectContaining({ column: 1, row: 2, distance: 2 }))
    expect(options.destinations.some((cell) => cell.column === 0 && cell.row === 2)).toBe(false)
  })
})

describe('travelFigure', () => {
  it('moves a figure and records the distance and lock with the position', () => {
    const state = place(game(), 'figures/redarmy', 1, 1)
    const piece = figure(state)
    const travelled = unwrap(
      travelFigure(state, { playerId: CASH1981, pieceId: piece.id, column: 3, row: 1 }),
    )
    const moved = figure(travelled)

    expect(moved.x).toBe(Math.round(3 * SQUARE_SIZE + (SQUARE_SIZE - moved.width) / 2))
    expect(movementOf(moved, 1)).toEqual({ turn: 1, used: 2, locked: true, reason: 'travel' })
    expect(travelled.board.history.at(-1)?.change).toMatchObject({
      kind: 'move',
      movement: { from: null, to: { turn: 1, used: 2, locked: true, reason: 'travel' } },
    })
  })

  it('refuses a second move in the same turn', () => {
    const state = place(game(), 'figures/redarmy', 1, 1)
    const piece = figure(state)
    // The whole speed of 2 in one move: nothing is left
    const travelled = unwrap(
      travelFigure(state, { playerId: CASH1981, pieceId: piece.id, column: 1, row: 3 }),
    )
    const refused = unwrapErr(
      travelFigure(travelled, { playerId: CASH1981, pieceId: piece.id, column: 1, row: 4 }),
    )
    expect(refused.kind).toBe('FIGURE_MOVE_ILLEGAL')
  })

  it('may move again while speed is left, and is locked once it is spent', () => {
    const state = place(game(), 'figures/redarmy', 1, 1)
    const piece = figure(state)
    const first = unwrap(travelFigure(state, { playerId: CASH1981, pieceId: piece.id, column: 1, row: 2 }))
    expect(movementOf(figure(first), 1)).toMatchObject({ used: 1, locked: false })
    const options = figureMovementOptions(first.board, playerOf(first), figure(first), 1)
    expect(Math.max(...(options?.destinations.map((cell) => cell.distance) ?? [0]))).toBe(1)

    const second = unwrap(travelFigure(first, { playerId: CASH1981, pieceId: piece.id, column: 1, row: 3 }))
    expect(movementOf(figure(second), 1)).toMatchObject({ used: 2, locked: true })
    // Undo takes the moves back one at a time
    const undone = unwrap(undoLastBoardChange(second, CASH1981))
    expect(movementOf(figure(undone), 1)).toMatchObject({ used: 1, locked: false })
  })

  it('ends the movement at once on a hut, with speed left', () => {
    let state = place(game(), 'figures/redarmy', 1, 1)
    state = place(state, 'resources/hut', 1, 2)
    const piece = figure(state)
    const travelled = unwrap(travelFigure(state, { playerId: CASH1981, pieceId: piece.id, column: 1, row: 2 }))
    expect(movementOf(figure(travelled), 1)).toMatchObject({ used: 1, locked: true })
    expect(
      unwrapErr(travelFigure(travelled, { playerId: CASH1981, pieceId: piece.id, column: 1, row: 3 })).kind,
    ).toBe('FIGURE_MOVE_ILLEGAL')
  })

  it('refuses a square too far away and water without a tech', () => {
    const state = place(game(), 'figures/redarmy', 1, 1)
    const piece = figure(state)
    expect(
      unwrapErr(travelFigure(state, { playerId: CASH1981, pieceId: piece.id, column: 4, row: 1 })).kind,
    ).toBe('FIGURE_MOVE_ILLEGAL')

    const wet = waterGame()
    const wetPiece = figure(wet)
    expect(
      unwrapErr(travelFigure(wet, { playerId: CASH1981, pieceId: wetPiece.id, column: 0, row: 2 })).kind,
    ).toBe('FIGURE_MOVE_ILLEGAL')
  })

  it('refuses another player’s figure', () => {
    const state = place(game(), 'figures/redarmy', 1, 1)
    const piece = figure(state)
    const refused = unwrapErr(
      travelFigure(state, { playerId: KARANDRAS1, pieceId: piece.id, column: 1, row: 2 }),
    )
    expect(refused.kind).toBe('FIGURE_MOVE_ILLEGAL')
  })

  it('undoes the position and the spent movement together', () => {
    const state = place(game(), 'figures/redarmy', 1, 1)
    const piece = figure(state)
    const travelled = unwrap(
      travelFigure(state, { playerId: CASH1981, pieceId: piece.id, column: 3, row: 1 }),
    )
    const undone = unwrap(undoLastBoardChange(travelled, CASH1981))
    const back = figure(undone)

    expect(back.x).toBe(piece.x)
    expect(back.y).toBe(piece.y)
    expect(back.movement).toBeUndefined()
    const options = figureMovementOptions(undone.board, playerOf(undone), back, 1)
    expect(options?.destinations.length).toBeGreaterThan(0)
    expect(turnStatus(undone).currentTurn).toBe(1)
  })
})

describe('arranging a figure in its own square', () => {
  it('allows a spot whose centre stays in the square and refuses one in the next', () => {
    const state = place(game(), 'figures/redarmy', 1, 1)
    const piece = figure(state)
    const right = piece.x + Math.floor((SQUARE_SIZE - piece.width) / 2)

    expect(arrangeWithinSquare(state.board, piece, right, piece.y)).toEqual([right, piece.y])
    expect(arrangeWithinSquare(state.board, piece, piece.x + SQUARE_SIZE, piece.y)).toBeUndefined()
    expect(arrangeWithinSquare(state.board, { ...piece, y: 0 }, piece.x, 0)).toBeUndefined()
    // An even-width figure just inside the edge rounds onto it, so its centre would be in the next square
    const even = { ...piece, width: 34 }
    expect(arrangeWithinSquare(state.board, even, 2 * SQUARE_SIZE - 17 - 0.3, piece.y)).toBeUndefined()
    expect(arrangeWithinSquare(state.board, even, 2 * SQUARE_SIZE - 17 - 0.7, piece.y)).toEqual([
      2 * SQUARE_SIZE - 18,
      piece.y,
    ])
  })

  it('keeps the spent movement, so a shifted figure may still travel what is left', () => {
    const state = place(game(), 'figures/redarmy', 1, 1)
    const piece = figure(state)
    const travelled = unwrap(travelFigure(state, { playerId: CASH1981, pieceId: piece.id, column: 1, row: 2 }))
    const moved = figure(travelled)
    const spot = arrangeWithinSquare(travelled.board, moved, moved.x + 10, moved.y)
    if (spot === undefined) throw new Error('expected a spot in the square')
    const shifted = unwrap(
      movePiece(travelled, { playerId: CASH1981, pieceId: piece.id, x: spot[0], y: spot[1], snap: false }),
    )

    expect(figure(shifted).x).toBe(moved.x + 10)
    expect(movementOf(figure(shifted), 1)).toEqual(movementOf(moved, 1))
    const again = unwrap(travelFigure(shifted, { playerId: CASH1981, pieceId: piece.id, column: 1, row: 3 }))
    expect(movementOf(figure(again), 1)).toMatchObject({ used: 2, locked: true })
  })
})

describe('routes (issue #362)', () => {
  const cell = (column: number, row: number) => ({ column, row })
  const withSpeed = (state: GameState, mvmt: string): GameState =>
    withPlayer(state, { ...playerOf(state), stats: { ...playerOf(state).stats, mvmt } })
  const travel = (state: GameState, route: ReturnType<typeof cell>[]) => {
    const last = route.at(-1) ?? cell(0, 0)
    return travelFigure(state, {
      playerId: CASH1981,
      pieceId: figure(state).id,
      column: last.column,
      row: last.row,
      route,
    })
  }
  const check = (state: GameState, route: ReturnType<typeof cell>[]) =>
    checkRoute(state.board, playerOf(state), figure(state), 1, route)

  it('records the chosen route, charges its length and undoes it in one step', () => {
    const state = place(game(), 'figures/redarmy', 1, 1)
    for (const [route, via] of [
      [[cell(2, 1), cell(2, 2)], 'C2'],
      [[cell(1, 2), cell(2, 2)], 'B3'],
    ] as const) {
      const moved = unwrap(travel(state, [...route]))
      expect(movementOf(figure(moved), 1)).toMatchObject({ used: 2, locked: true })
      expect(moved.board.history.at(-1)?.change).toMatchObject({ kind: 'move', route })
      expect(moved.board.history.at(-1)?.description).toContain(`→ ${via} →`)
      // The route survives a save and a reload
      const reloaded = JSON.parse(JSON.stringify(moved)) as GameState
      expect(reloaded.board.history.at(-1)?.change).toMatchObject({ route })

      const undone = unwrap(undoLastBoardChange(moved, CASH1981))
      expect(figure(undone).x).toBe(figure(state).x)
      expect(figure(undone).movement).toBeUndefined()
    }
  })

  it('charges a longer detour and uses the pool for what is left', () => {
    const state = withSpeed(place(game(), 'figures/redarmy', 1, 1), '4')
    // Two squares away as the crow flies, three squares as walked
    const moved = unwrap(travel(state, [cell(1, 2), cell(2, 2), cell(2, 1)]))
    expect(movementOf(figure(moved), 1)).toMatchObject({ used: 3, locked: false })
    expect(unwrapErr(travel(moved, [cell(2, 2), cell(2, 3)])).kind).toBe('FIGURE_MOVE_ILLEGAL')
    const rest = unwrap(travel(moved, [cell(3, 1)]))
    expect(movementOf(figure(rest), 1)).toMatchObject({ used: 4, locked: true })
  })

  it('says in the public log which squares the figure went through, and takes the line back with an Undo', () => {
    const state = place(game(), 'figures/redarmy', 1, 1)
    const moved = unwrap(travel(state, [cell(2, 1), cell(2, 2)]))
    const line = moved.log.at(-1)
    expect(line?.publicLog).toBe('cash1981 moved Red army B2 → C2 → C3 (2 squares)')
    expect(line?.privateLog).toBe('')
    // The history entry counts its own line, so replay keeps them together
    expect(moved.board.history.at(-1)?.logLength).toBe(moved.log.length)

    const undone = unwrap(undoLastBoardChange(moved, CASH1981))
    expect(undone.log.at(-1)?.publicLog).toBe('cash1981 took back the move of Red army: it is on B2 again')
    const redone = unwrap(redoLastBoardChange(undone, CASH1981))
    expect(redone.log.at(-1)?.publicLog).toBe('cash1981 moved Red army to C3 again, after the Undo')
    expect(redone.board.history.at(-1)?.logLength).toBe(redone.log.length)
  })

  it('does not put a shift inside a square into the public log', () => {
    const state = place(game(), 'figures/redarmy', 1, 1)
    const piece = figure(state)
    const shifted = unwrap(movePiece(state, { playerId: CASH1981, pieceId: piece.id, x: piece.x + 4, y: piece.y + 4, snap: false }))
    expect(shifted.log.length).toBe(state.log.length)
  })

  it('charges the shortest distance and records no route when none is sent', () => {
    const state = place(game(), 'figures/redarmy', 1, 1)
    const moved = unwrap(
      travelFigure(state, { playerId: CASH1981, pieceId: figure(state).id, column: 3, row: 1 }),
    )
    const change = moved.board.history.at(-1)?.change
    expect(change).toMatchObject({ kind: 'move', movement: { to: { used: 2 } } })
    expect(change).not.toHaveProperty('route')
    expect(moved.board.history.at(-1)?.description).not.toContain('→')
    expect(moved.log.at(-1)?.publicLog).toBe('cash1981 moved Red army from B2 to D2 (2 squares)')
  })

  it('refuses a route that is too long, broken, repeating, or ends elsewhere than asked', () => {
    const state = place(game(), 'figures/redarmy', 1, 1)
    expect(check(state, [cell(1, 2), cell(2, 2), cell(2, 1)])).toMatchObject({
      ok: false,
      reason: expect.stringContaining('takes 3 movement'),
    })
    expect(check(state, [cell(2, 2)])).toMatchObject({ ok: false, reason: expect.stringContaining('not next to') })
    expect(check(state, [])).toMatchObject({ ok: false })
    const roomy = withSpeed(state, '5')
    expect(check(roomy, [cell(2, 1), cell(1, 1)])).toMatchObject({ ok: false, reason: expect.stringContaining('twice') })
    expect(
      unwrapErr(
        travelFigure(state, { playerId: CASH1981, pieceId: figure(state).id, column: 1, row: 2, route: [cell(2, 1)] }),
      ).kind,
    ).toBe('FIGURE_MOVE_ILLEGAL')
  })

  it('tells crossing a square from ending on it', () => {
    // England may cross the water on A3 but not end there
    const base = place(waterGame(), 'figures/bluearmy', 1, 3, KARANDRAS1)
    const england = withPlayer(base, {
      ...playerOf(base),
      civilization: { name: 'England' } as Playerhand['civilization'],
    })
    expect(check(england, [cell(0, 2), cell(1, 2)])).toMatchObject({ ok: true })
    expect(check(england, [cell(0, 2)])).toMatchObject({ ok: false, reason: expect.stringContaining('cannot end') })
    expect(check(base, [cell(0, 2), cell(1, 2)])).toMatchObject({ ok: false, reason: expect.stringContaining('cannot enter') })

    // A hut ends the move unless Flight flies over it; with Flight a move may also end on it
    let hut = withSpeed(place(game(), 'figures/redarmy', 1, 1), '3')
    hut = place(hut, 'resources/hut', 2, 1)
    expect(check(hut, [cell(2, 1)])).toMatchObject({ ok: true })
    expect(check(hut, [cell(2, 1), cell(3, 1)])).toMatchObject({ ok: false, reason: expect.stringContaining('carry on') })
    const flying = withTech(hut, 'Flight')
    expect(check(flying, [cell(2, 1), cell(3, 1)])).toMatchObject({ ok: true })
    expect(check(flying, [cell(2, 1)])).toMatchObject({ ok: true })
  })

  it('rejects a stale route once the board has changed under it', () => {
    const state = place(game(), 'figures/redarmy', 1, 1)
    const route = [cell(2, 1), cell(2, 2)]
    expect(check(state, route)).toMatchObject({ ok: true })
    const changed = place(state, 'figures/bluearmy', 2, 1, KARANDRAS1)
    expect(check(changed, route)).toMatchObject({ ok: false })
    expect(unwrapErr(travel(changed, route)).kind).toBe('FIGURE_MOVE_ILLEGAL')
  })

  it('plans the shortest route, through waypoints when asked, and says when there is none', () => {
    const state = withSpeed(place(game(), 'figures/redarmy', 1, 1), '5')
    const plan = (via: ReturnType<typeof cell>[], to: ReturnType<typeof cell>) =>
      planRoute(state.board, playerOf(state), figure(state), 1, via, to)

    expect(plan([], cell(3, 1))).toMatchObject({ ok: true, route: [cell(2, 1), cell(3, 1)] })
    const bent = plan([cell(2, 2)], cell(3, 1))
    expect(bent).toMatchObject({ ok: true, destination: { distance: 4 } })
    expect(bent.ok && bent.route.map((step) => `${step.column},${step.row}`)).toContain('2,2')
    // A later square is not taken on the way to an earlier one
    const loop = plan([cell(2, 2)], cell(2, 1))
    expect(loop.ok && loop.route).toEqual([cell(1, 2), cell(2, 2), cell(2, 1)])
    expect(plan([cell(1, 1)], cell(3, 1))).toMatchObject({ ok: false })
    expect(plan([cell(9, 9)], cell(3, 1))).toMatchObject({ ok: false })
    // A waypoint beyond what is left is not planned
    expect(plan([cell(6, 1)], cell(1, 1))).toMatchObject({ ok: false })
  })

  it('plans every square the search reaches, with the distance the search gave', () => {
    let state = withSpeed(place(game(), 'figures/redarmy', 2, 2), '4')
    state = place(state, 'figures/bluearmy', 3, 2, KARANDRAS1)
    const options = figureMovementOptions(state.board, playerOf(state), figure(state), 1)
    if (options === null) throw new Error('expected movement options')
    expect(options.destinations.length).toBeGreaterThan(8)
    for (const destination of options.destinations) {
      const planned = planRoute(state.board, playerOf(state), figure(state), 1, [], destination)
      expect(planned, destination.label).toMatchObject({ ok: true, destination: { distance: destination.distance } })
    }
  })

  it('honours a locked square and a forbidden square on a route', () => {
    const state = place(game(), 'figures/redarmy', 1, 1)
    const locked = checkRoute(state.board, playerOf(state), figure(state), 1, [cell(2, 1)], [cell(1, 1)])
    expect(locked).toMatchObject({ ok: false })
    const forbidden = checkRoute(state.board, playerOf(state), figure(state), 1, [cell(2, 1)], [], [cell(2, 1)])
    expect(forbidden).toMatchObject({ ok: false })
    expect(checkRoute(state.board, playerOf(state), figure(state), 1, [cell(2, 1)], [], [cell(3, 3)])).toMatchObject({
      ok: true,
    })
  })

  it('refuses a step off the map or onto a fractional square', () => {
    const state = place(game(), 'figures/redarmy', 0, 0)
    expect(check(state, [cell(-1, 0)])).toMatchObject({ ok: false })
    expect(check(state, [cell(0.5, 0)])).toMatchObject({ ok: false })
    expect(check(state, [cell(0.5, 0.5)])).toMatchObject({ ok: false })
  })
})

describe('figures arriving on a stack and moving as a group', () => {
  const cell = (column: number, row: number) => ({ column, row })
  const figures = (state: GameState): BoardPiece[] => state.board.pieces.filter((piece) => piece.category === 'figure')
  const withSpeed = (state: GameState, mvmt: string): GameState =>
    withPlayer(state, { ...playerOf(state), stats: { ...playerOf(state).stats, mvmt } })
  /** The player as the web gives it to the movement rules: with the stacking limit the status shows. */
  const stacker = (state: GameState) => ({ ...playerOf(state), stackingLimit: 2 })
  const centreOf = (piece: BoardPiece) => [piece.x + piece.width / 2, piece.y + piece.height / 2] as const

  it('puts a figure that arrives on an occupied square beside the one standing there', () => {
    const state = place(place(withSpeed(game(), '4'), 'figures/redarmy', 1, 1), 'figures/redscout', 3, 3)
    const army = figures(state).find((piece) => piece.assetId.endsWith('army')) as BoardPiece
    const scout = figures(state).find((piece) => piece.assetId.endsWith('scout')) as BoardPiece
    const moved = unwrap(
      travelFigure(state, { playerId: CASH1981, pieceId: scout.id, column: 1, row: 1, route: [cell(3, 2), cell(2, 2), cell(1, 2), cell(1, 1)] }),
    )
    const after = figures(moved)
    const standing = after.find((piece) => piece.id === army.id) as BoardPiece
    const arrived = after.find((piece) => piece.id === scout.id) as BoardPiece
    // The army keeps its place and the scout stands to its right, in the same square, without covering it
    expect(centreOf(standing)).toEqual(centreOf(army))
    expect(centreOf(arrived)[0] - centreOf(standing)[0]).toBeGreaterThanOrEqual(30)
    expect(Math.abs(centreOf(arrived)[1] - centreOf(standing)[1])).toBeLessThan(1)
    expect(Math.floor(centreOf(arrived)[0] / SQUARE_SIZE)).toBe(1)
  })

  it('moves a stack together along one route, charges each figure and writes one public line', () => {
    const base = withSpeed(place(place(game(), 'figures/redarmy', 1, 1), 'figures/redscout', 1, 1), '4')
    const [a, b] = figures(base) as [BoardPiece, BoardPiece]
    const moved = unwrap(
      travelGroup(base, { playerId: CASH1981, pieceIds: [a.id, b.id], column: 2, row: 2, route: [cell(2, 1), cell(2, 2)] }),
    )
    for (const piece of figures(moved)) {
      expect(movementOf(piece, 1)).toMatchObject({ used: 2, locked: false })
      expect(Math.floor(centreOf(piece)[0] / SQUARE_SIZE)).toBe(2)
    }
    // Two figures on the arrival square do not cover each other
    const [first, second] = figures(moved) as [BoardPiece, BoardPiece]
    expect(centreOf(first)).not.toEqual(centreOf(second))
    expect(moved.log.length).toBe(base.log.length + 1)
    expect(moved.log.at(-1)?.publicLog).toBe('cash1981 moved Red army and Red scout together B2 → C2 → C3 (2 squares)')
    expect(moved.board.history.at(-1)?.logLength).toBe(moved.log.length)
  })

  it('refuses the whole group when one figure may not go or the figures are apart', () => {
    const base = withSpeed(place(place(game(), 'figures/redarmy', 1, 1), 'figures/redscout', 1, 1), '2')
    const [a, b] = figures(base) as [BoardPiece, BoardPiece]
    const tooFar = unwrapErr(
      travelGroup(base, { playerId: CASH1981, pieceIds: [a.id, b.id], column: 1, row: 4, route: [cell(1, 2), cell(1, 3), cell(1, 4)] }),
    )
    expect(tooFar.kind).toBe('FIGURE_MOVE_ILLEGAL')

    const apart = place(base, 'figures/redscout', 3, 3)
    const third = figures(apart).find((piece) => centreOf(piece)[0] > 3 * SQUARE_SIZE) as BoardPiece
    expect(unwrapErr(travelGroup(apart, { playerId: CASH1981, pieceIds: [a.id, third.id], column: 2, row: 1, route: [cell(2, 1)] })).kind).toBe('FIGURE_MOVE_ILLEGAL')
    expect(unwrapErr(travelGroup(base, { playerId: CASH1981, pieceIds: [a.id], column: 2, row: 1, route: [cell(2, 1)] })).kind).toBe('FIGURE_MOVE_ILLEGAL')
    // Nothing was changed by any of the refusals
    expect(figures(base).every((piece) => movementOf(piece, 1) === null)).toBe(true)
  })

  it('may end on a hut or another player\'s figures like one figure, and ends the move for everyone', () => {
    const base = withSpeed(place(place(game(), 'figures/redarmy', 1, 1), 'figures/redscout', 1, 1), '4')
    const [a, b] = figures(base) as [BoardPiece, BoardPiece]
    const hut = place(base, 'resources/hut', 2, 1)
    const onHut = groupMovementOptions(hut.board, stacker(hut), [a, b], 1)
    // An army may end on a hut and a scout may not: the group goes only where both may
    expect(onHut?.destinations.find((destination) => destination.column === 2 && destination.row === 1)).toBeUndefined()

    // Two armies may end on another player's army; a scout may not, so the mixed group is not offered that square
    const armies = place(place(withSpeed(game(), '4'), 'figures/redarmy', 1, 1), 'figures/redarmy', 1, 1)
    const [x, y] = figures(armies) as [BoardPiece, BoardPiece]
    const enemy = place(armies, 'figures/bluearmy', 2, 1, KARANDRAS1)
    const options = groupMovementOptions(enemy.board, stacker(enemy), [x, y], 1)
    expect(options?.destinations.find((destination) => destination.column === 2 && destination.row === 1)).toMatchObject({ contact: true, ends: true })
    expect(groupMovementOptions(place(base, 'figures/bluearmy', 2, 1, KARANDRAS1).board, stacker(base), [a, b], 1)?.destinations.some((destination) => destination.column === 2 && destination.row === 1)).toBe(false)
    const moved = unwrap(travelGroup(enemy, { playerId: CASH1981, pieceIds: [x.id, y.id], column: 2, row: 1, route: [cell(2, 1)] }))
    for (const piece of figures(moved).filter((candidate) => candidate.assetId.startsWith('figures/red'))) {
      expect(movementOf(piece, 1)).toMatchObject({ locked: true })
    }
  })

  it('takes the whole group back with one Undo and brings it again with one Redo', () => {
    const base = withSpeed(place(place(game(), 'figures/redarmy', 1, 1), 'figures/redscout', 1, 1), '4')
    const [a, b] = figures(base) as [BoardPiece, BoardPiece]
    const moved = unwrap(travelGroup(base, { playerId: CASH1981, pieceIds: [a.id, b.id], column: 2, row: 1, route: [cell(2, 1)] }))
    expect(new Set(moved.board.history.slice(-2).map((entry) => entry.group)).size).toBe(1)

    const undone = unwrap(undoLastBoardChange(moved, CASH1981))
    for (const piece of figures(undone)) {
      expect(movementOf(piece, 1)).toBeNull()
      expect(Math.floor(centreOf(piece)[0] / SQUARE_SIZE)).toBe(1)
    }
    expect(undone.board.history.length).toBe(base.board.history.length)

    const redone = unwrap(redoLastBoardChange(undone, CASH1981))
    for (const piece of figures(redone)) expect(Math.floor(centreOf(piece)[0] / SQUARE_SIZE)).toBe(2)
    expect(redone.board.redo).toHaveLength(0)
  })

  it('offers a group only the squares all of them reach, with the least movement left', () => {
    const base = place(place(withSpeed(game(), '4'), 'figures/redarmy', 1, 1), 'figures/redscout', 1, 1)
    const [a, b] = figures(base) as [BoardPiece, BoardPiece]
    const moved = unwrap(travelFigure(base, { playerId: CASH1981, pieceId: b.id, column: 2, row: 1, route: [cell(2, 1)] }))
    const army = moved.board.pieces.find((piece) => piece.id === a.id) as BoardPiece
    const scout = moved.board.pieces.find((piece) => piece.id === b.id) as BoardPiece
    // The scout has gone: only one figure is left on B2, so there is no group
    expect(groupMovementOptions(moved.board, stacker(moved), [army, scout], 1)).toBeNull()

    const both = groupMovementOptions(base.board, stacker(base), [a, b], 1)
    expect(both?.remaining).toBe(4)
    expect(both?.destinations.some((destination) => destination.column === 2 && destination.row === 1)).toBe(true)
    const route = planGroupRoute(base.board, stacker(base), [a, b], 1, [], cell(3, 1))
    expect(route.ok && route.route).toEqual([cell(2, 1), cell(3, 1)])
  })

  it('offers a group only squares with room for all of it under the stacking limit', () => {
    const base = withSpeed(place(place(game(), 'figures/redarmy', 1, 1), 'figures/redscout', 1, 1), '4')
    const [a, b] = figures(base) as [BoardPiece, BoardPiece]
    const crowded = place(base, 'figures/redscout', 2, 1)
    const options = groupMovementOptions(crowded.board, stacker(crowded), [a, b], 1)
    // One of ours already stands on C2 and the limit is 2: two more do not fit, one would
    expect(options?.destinations.some((destination) => destination.column === 2 && destination.row === 1)).toBe(false)
    const planned = planGroupRoute(crowded.board, stacker(crowded), [a, b], 1, [], cell(2, 1))
    expect(planned.ok).toBe(false)
    expect(options?.destinations.some((destination) => destination.column === 1 && destination.row === 2)).toBe(true)
  })

  it('writes the group line before the lines of the hut it draws, once for the whole group', () => {
    const armies = place(place(withSpeed(game(), '4'), 'figures/redarmy', 1, 1), 'figures/redarmy', 1, 1)
    const [x, y] = figures(armies) as [BoardPiece, BoardPiece]
    const hut = place(armies, 'resources/hut', 2, 1)
    const moved = unwrap(travelGroup(hut, { playerId: CASH1981, pieceIds: [x.id, y.id], column: 2, row: 1, route: [cell(2, 1)], collectToken: true }))
    const lines = moved.log.slice(hut.log.length).map((line) => line.publicLog)
    expect(lines[0]).toBe('cash1981 moved Red army and Red army together B2 → C2 (1 square)')
    // Both armies stand on the hut's square and neither can move on; the hut is drawn once, after the group line
    expect(figures(moved).every((piece) => movementOf(piece, 1)?.locked === true)).toBe(true)
    expect(moved.board.history.at(-1)?.logLength).toBe(moved.log.length)
    expect(new Set(moved.board.history.slice(hut.board.history.length).map((entry) => entry.group)).size).toBe(1)
  })

  it('does not offer a group a square one figure only reaches by a detour longer than another may walk', () => {
    // An unaccompanied relic on C2 bars the scout but not the army: the army walks B2 → C2 → D2 (2), the scout needs a detour (4)
    const base = withSpeed(place(place(place(game(), 'figures/redarmy', 1, 1), 'figures/redscout', 1, 1), 'relics/atlantis', 2, 1), '4')
    const [army, scout] = figures(base).filter((piece) => piece.assetId.startsWith('figures/red')) as [BoardPiece, BoardPiece]
    const armyUsed: GameState = {
      ...base,
      board: {
        ...base.board,
        pieces: base.board.pieces.map((piece) => (piece.id === army.id ? { ...piece, movement: { turn: 1, used: 2, locked: false, reason: 'travel' as const } } : piece)),
      },
    }
    const members = [armyUsed.board.pieces.find((piece) => piece.id === army.id) as BoardPiece, scout]
    const options = groupMovementOptions(armyUsed.board, stacker(armyUsed), members, 1)
    expect(options?.remaining).toBe(2)
    expect(options?.destinations.every((destination) => destination.distance <= (options?.remaining ?? 0))).toBe(true)
    expect(options?.destinations.some((destination) => destination.column === 3 && destination.row === 1)).toBe(false)
  })

  it('offers a group the least movement any of its figures has left', () => {
    const base = withSpeed(place(place(game(), 'figures/redarmy', 1, 1), 'figures/redscout', 1, 1), '4')
    const [a, b] = figures(base) as [BoardPiece, BoardPiece]
    const tired: GameState = {
      ...base,
      board: {
        ...base.board,
        pieces: base.board.pieces.map((piece) => (piece.id === b.id ? { ...piece, movement: { turn: 1, used: 2, locked: false, reason: 'travel' as const } } : piece)),
      },
    }
    const options = groupMovementOptions(tired.board, stacker(tired), [a, tired.board.pieces.find((piece) => piece.id === b.id) as BoardPiece], 1)
    expect(options?.remaining).toBe(2)
    expect(options?.destinations.every((destination) => destination.distance <= 2)).toBe(true)
    // The one that is tired refuses a longer route for the whole group, and nothing is moved
    const refused = travelGroup(tired, { playerId: CASH1981, pieceIds: [a.id, b.id], column: 1, row: 4, route: [cell(1, 2), cell(1, 3), cell(1, 4)] })
    expect(refused.ok).toBe(false)
    expect(figures(tired).find((piece) => piece.id === a.id)?.movement).toBeUndefined()
  })

  it('writes the group line before what the move itself logs, and adds the battle note', () => {
    const armies = place(place(withSpeed(game(), '4'), 'figures/redarmy', 1, 1), 'figures/redarmy', 1, 1)
    const [x, y] = figures(armies) as [BoardPiece, BoardPiece]
    const enemy = place(armies, 'figures/bluearmy', 2, 1, KARANDRAS1)
    const moved = unwrap(travelGroup(enemy, { playerId: CASH1981, pieceIds: [x.id, y.id], column: 2, row: 1, route: [cell(2, 1)] }))
    expect(moved.log.at(-1)?.publicLog).toBe(
      "cash1981 moved Red army and Red army together B2 → C2 (1 square), onto another player's figures: settle the battle and loot by hand",
    )
    expect(moved.board.history.at(-1)?.logLength).toBe(moved.log.length)
  })

})
