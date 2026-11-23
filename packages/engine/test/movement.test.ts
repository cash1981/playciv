/**
 * Figure movement (issue #302): cardinal steps up to the travel speed, water
 * rules, the once-a-turn lock, and the undo that gives the move back.
 */

import { describe, expect, it } from 'vitest'

import { movePiece, placePiece, travelFigure, undoLastBoardChange } from '../src/actions/board.js'
import {
  SQUARE_SIZE,
  findBoardAsset,
  mapTop,
  type BoardPiece,
} from '../src/board.js'
import {
  arrangeWithinSquare,
  figureMovementOptions,
  movementOf,
  movementTotal,
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
      // Flight crosses the marker but cannot end on it (unofficial rule 283).
      expect(flown.destinations.some((cell) => cell.column === 2 && cell.row === 1)).toBe(false)
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
