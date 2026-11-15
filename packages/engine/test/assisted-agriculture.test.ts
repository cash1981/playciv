/**
 * Agriculture (issue #354): "Immediately grow your capital into a metropolis." The capital marker is turned over to the
 * metropolis marker on the capital's square and the neighbouring one, in a direction the player names. Only a legal direction
 * is accepted (rulings 116 to 128); the undo vote turns the marker back, walls included.
 *
 * The map is the first two rows of slots (tile12 and tile23b, both land, then two more tiles) so a capital on D4 has all four
 * neighbours on revealed land: every square around each of them is on a tile.
 */

import { describe, expect, it } from 'vitest'

import { movePiece, placePiece, undoLastBoardChange } from '../src/actions/board.js'
import { chooseTech, revealTech } from '../src/actions/player.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { assistedAvailability, performAssistedAction } from '../src/assisted.js'
import { cityCenterCells, cityFootprintsOf } from '../src/blockade.js'
import { SQUARE_SIZE, boardUndoBlocked, findBoardAsset, mapTop, slotOrigin } from '../src/board.js'
import type { BoardPiece } from '../src/board.js'
import { cityProductionsOf } from '../src/city-production.js'
import { growableCapital, metropolisAssetIdOf, metropolisGrowthsOf } from '../src/metropolis.js'
import type { GrowDirection } from '../src/metropolis.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { capitalOf } from '../src/sot.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { GameState, Playerhand } from '../src/state.js'

import { withCivilization } from './culture-advance-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-11-15T10:00:00.000Z'

function game(): GameState {
  const colors: Record<string, string> = { [CASH1981]: 'Red', [KARANDRAS1]: 'Blue', [ITCHI]: 'Green', [CHUL]: 'Yellow' }
  const state = firstCivGame()
  return { ...state, players: state.players.map((p) => ({ ...p, color: colors[p.playerId] ?? p.color })) }
}

function put(state: GameState, assetId: string, column: number, row: number, playerId = CASH1981): GameState {
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`no asset ${assetId}`)
  return unwrap(
    placePiece(state, {
      playerId,
      assetId,
      x: column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2,
      y: mapTop(state.board) + row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2,
    }),
  )
}

/** Tiles in slots 0, 1, 4 and 5 (an 8 x 8 corner of the map). The slot 1 tile can be swapped, a slot can be left out. */
function mapOf(options: { readonly east?: string; readonly lower?: readonly [string, string] | null } = {}): GameState {
  let state = game()
  const lay = (slotIndex: number, assetId: string): void => {
    const slot = state.board.slots[slotIndex]
    if (slot === undefined) throw new Error('no slot')
    const [x, y] = slotOrigin(state.board, slot)
    state = unwrap(placePiece(state, { playerId: CASH1981, assetId, x, y }))
  }
  lay(0, 'tiles/tile12')
  lay(1, options.east ?? 'tiles/tile23b')
  if (options.lower !== null) {
    const [west, east] = options.lower ?? ['tiles/america', 'tiles/china']
    lay(4, west)
    lay(5, east)
  }
  return state
}

const learn = (state: GameState, techName = 'Agriculture'): GameState =>
  unwrap(revealTech(unwrap(chooseTech(state, { playerId: CASH1981, techName })), { playerId: CASH1981, techName }))

/** A capital on D4 (column 3, row 3), Agriculture revealed. */
function ready(options: { readonly capital?: string; readonly at?: readonly [number, number]; readonly map?: GameState } = {}): GameState {
  const [column, row] = options.at ?? [3, 3]
  return learn(put(options.map ?? mapOf(), options.capital ?? 'cities/redcapital2', column, row))
}

const me = (state: GameState): Playerhand => {
  const found = findPlayer(state, CASH1981)
  if (found === undefined) throw new Error('no cash')
  return found
}
const capital = (state: GameState): BoardPiece => {
  const found = state.board.pieces.find((piece) => piece.category === 'city' && piece.assetId.startsWith('cities/red'))
  if (found === undefined) throw new Error('no red city')
  return found
}

const grow = (state: GameState, direction: GrowDirection | undefined, requestId = 'req-1') =>
  performAssistedAction(state, {
    playerId: CASH1981,
    action: 'agriculture',
    requestId,
    at: AT,
    ...(direction === undefined ? {} : { payload: { direction } }),
  })
const grown = (state: GameState, direction: GrowDirection, requestId = 'req-1'): GameState => unwrap(grow(state, direction, requestId))

const growthOf = (state: GameState, direction: GrowDirection) => {
  const piece = growableCapital(state, me(state))
  if (piece === undefined) throw new Error('no capital marker')
  const found = metropolisGrowthsOf(state, me(state), piece).find((growth) => growth.direction === direction)
  if (found === undefined) throw new Error('no growth')
  return found
}
const reasonOf = (state: GameState, direction: GrowDirection): string => growthOf(state, direction).reasons.join(' ')

const availability = (state: GameState) => assistedAvailability(state, CASH1981, 'agriculture')
const refusal = (state: GameState, direction: GrowDirection | undefined, requestId = 'req-1'): string => {
  const error = unwrapErr(grow(state, direction, requestId))
  if (error.kind !== 'ASSISTED_ACTION_REJECTED') throw new Error(`unexpected ${error.kind}`)
  return error.reason
}

function undoByVote(state: GameState, requestId = 'req-1') {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no line')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of [KARANDRAS1, ITCHI]) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  return vote(next, { logId: entry.id, playerId: CHUL, vote: true, at: AT })
}

const cells = (state: GameState, piece: BoardPiece) => cityCenterCells(state.board, piece)

describe('the four directions of a capital on D4', () => {
  it('are all legal on open land, and the button is ready', () => {
    const state = ready()
    for (const direction of ['north', 'west', 'east', 'south'] as const) expect(reasonOf(state, direction), direction).toBe('')
    expect(availability(state)).toMatchObject({ status: 'ready' })
  })

  it.each([
    ['north', 'D3', 3, 2],
    ['west', 'C4', 2, 3],
    ['east', 'E4', 4, 3],
    ['south', 'D5', 3, 4],
  ] as const)('%s: the metropolis lies on D4 and %s, with D4 as its anchor', (direction, square, column, row) => {
    const before = ready()
    const done = grown(before, direction)
    const city = capital(done)
    // The same piece, so every record that names the capital still does
    expect(city.id).toBe(capital(before).id)
    expect(city.assetId).toBe('cities/redmetropolis2')
    expect(city.width).toBe(170)
    expect(cells(done, city)).toEqual([
      { column: 3, row: 3 },
      { column, row },
    ])
    expect(cityFootprintsOf(done, 'red')[0]?.centers).toHaveLength(2)
    expect(done.log.find((line) => line.assistedActionId === 'req-1')?.publicLog).toBe(
      `cash1981 used Agriculture: grew their capital on D4 into a metropolis: D4 and ${square} to the ${direction} are its two city squares`,
    )
    // The metropolis is the capital for everything that asks for one, and keeps the capital's name
    expect(capitalOf(done, me(done))?.id).toBe(city.id)
    expect(cityProductionsOf(done, me(done))[0]?.label).toBe('Metropolis D4')
  })

  it('lies on its side for north and south, flat for west and east', () => {
    expect(capital(grown(ready(), 'north')).rotation).toBe(90)
    expect(capital(grown(ready(), 'south')).rotation).toBe(90)
    expect(capital(grown(ready(), 'west')).rotation).toBe(0)
    expect(capital(grown(ready(), 'east')).rotation).toBe(0)
  })

  it('is one board history entry, counted with the line of the action', () => {
    const before = ready()
    const done = grown(before, 'east')
    expect(done.board.history).toHaveLength(before.board.history.length + 1)
    const entry = done.board.history.at(-1)
    expect(entry?.change).toMatchObject({ kind: 'flip', pieceId: capital(before).id })
    expect(entry?.logLength).toBe(done.log.findIndex((line) => line.assistedActionId === 'req-1') + 1)
    expect(done.board.pieces).toHaveLength(before.board.pieces.length)
  })

  it('costs nothing: no resource is spent', () => {
    const before = ready()
    const done = grown(before, 'west')
    expect(me(done).items).toEqual(me(before).items)
    expect(me(done).stats).toEqual(me(before).stats)
  })
})

describe('a direction that is not legal', () => {
  it('is refused with the reason, and nothing changes', () => {
    // C2 is row 1: north of it is the edge of the revealed map
    const state = ready({ at: [3, 0] })
    expect(reasonOf(state, 'north')).toContain('at the edge of the map')
    const error = refusal(state, 'north')
    expect(error).toContain('cannot grow north')
    expect(error).toContain('at the edge of the map')
  })

  it('is not offered by the plan: the other directions of the same capital still work', () => {
    const state = ready({ at: [3, 1] })
    expect(reasonOf(state, 'north')).toContain('edge of the map')
    for (const direction of ['west', 'east', 'south'] as const) expect(reasonOf(state, direction), direction).toBe('')
    expect(capital(grown(state, 'south')).assetId).toBe('cities/redmetropolis2')
  })

  it('a water square cannot be the second city square', () => {
    // america in slot 1: its square at row 3, column 0 (E4) is water
    const state = ready({ map: mapOf({ east: 'tiles/america' }) })
    expect(reasonOf(state, 'east')).toBe('E4 is a water square.')
    expect(refusal(state, 'east')).toContain('E4 is a water square.')
  })

  it('squares next to a facedown tile cannot hold a metropolis', () => {
    const state = ready({ map: mapOf({ lower: null }), at: [3, 2] })
    expect(reasonOf(state, 'south')).toContain('facedown tile')
    expect(reasonOf(state, 'east')).toBe('')
  })

  it('a hut, a village, a city-state or a relic in the new outskirts stops it, and only in the new ones', () => {
    // East of D4: the new outskirts are column F (index 5), rows 3 to 5; E4 is the new city square
    for (const [assetId, text] of [
      ['resources/hut', 'A hut would stand in the new outskirts (F3)'],
      ['resources/village', 'A village would stand in the new outskirts (F3)'],
      ['city-states/cs1', 'A city-state would stand in the new outskirts (F3)'],
    ] as const) {
      const state = put(ready(), assetId, 5, 2)
      expect(reasonOf(state, 'east'), assetId).toContain(text)
      expect(reasonOf(state, 'west'), `${assetId} not in the west outskirts`).toBe('')
    }
    const withRelic = put(ready(), 'relics/atlantis', 5, 2)
    expect(reasonOf(withRelic, 'east')).toContain('A relic would stand in the new outskirts (F3)')
    // A hut on the capital's own outskirts (C4 and D3 are old squares for the east growth) is not new
    expect(reasonOf(put(ready(), 'resources/hut', 2, 2), 'east')).toBe('')
  })

  it('the Zulu may grow beside a hut, and the line says so; a village still stops them', () => {
    const zulu = (state: GameState): GameState => withCivilization(state, 'Zulu')
    const withHut = zulu(put(ready(), 'resources/hut', 5, 2))
    expect(reasonOf(withHut, 'east')).toBe('')
    expect(growthOf(withHut, 'east').zuluHuts).toEqual(['F3'])
    expect(unwrap(grow(withHut, 'east')).log.find((line) => line.assistedActionId === 'req-1')?.publicLog).toContain('a hut in the new outskirts they may explore (F3)')
    expect(reasonOf(zulu(put(ready(), 'resources/village', 5, 2)), 'east')).toContain('A village would stand')
  })

  it('another city whose outskirts would overlap stops it (three squares from the new square, anyone\'s)', () => {
    // A blue city on G4 (column 6) is two squares from E4 (east) and three from D4's west square C4 is far
    const state = put(ready(), 'cities/bluecity2', 6, 3, KARANDRAS1)
    expect(reasonOf(state, 'east')).toBe('E4 is less than three squares from the city at G4, so their outskirts would overlap.')
    expect(reasonOf(state, 'west')).toBe('')
    // A city three squares from the new square is fine
    expect(reasonOf(put(ready(), 'cities/bluecity2', 7, 3, KARANDRAS1), 'east')).toBe('')
  })

  it('an enemy figure on the new square stops it, but one in the outskirts does not (rulings 120 and 121)', () => {
    const onSquare = put(ready(), 'figures/bluearmy', 4, 3, KARANDRAS1)
    expect(reasonOf(onSquare, 'east')).toBe('An enemy figure stands on E4.')
    expect(refusal(onSquare, 'east')).toContain('An enemy figure stands on E4.')
    const inOutskirts = put(ready(), 'figures/bluescout', 5, 2, KARANDRAS1)
    expect(reasonOf(inOutskirts, 'east')).toBe('')
    expect(capital(grown(inOutskirts, 'east')).assetId).toBe('cities/redmetropolis2')
    // and one in the capital's old outskirts, or on the capital's own square, never mattered
    expect(reasonOf(put(ready(), 'figures/bluescout', 2, 2, KARANDRAS1), 'east')).toBe('')
  })

  it('a figure of your own, a building, a wonder or a great person on the new square are not carried out, so the square is not offered', () => {
    expect(reasonOf(put(ready(), 'figures/redscout', 4, 3), 'east')).toContain('Your figure stands on E4.')
    expect(reasonOf(put(ready(), 'buildings/library', 4, 3), 'east')).toContain('A building, wonder or great person stands on E4. Clear it first.')
    expect(reasonOf(put(ready(), 'great people/artist', 4, 3), 'east')).toContain('A building, wonder or great person stands on E4.')
    // a figure on the capital's own square stays there
    expect(reasonOf(put(ready(), 'figures/redscout', 3, 3), 'east')).toBe('')
  })

  it('says why no direction works when none does', () => {
    let state = ready()
    for (const [column, row] of [[3, 2], [2, 3], [4, 3], [3, 4]] as const) state = put(state, 'figures/bluearmy', column, row, KARANDRAS1)
    const status = availability(state)
    expect(status.status).toBe('unavailable')
    expect(status.reason).toContain('Your capital cannot grow now:')
    for (const part of ['North (D3)', 'West (C4)', 'East (E4)', 'South (D5)']) expect(status.reason).toContain(part)
    expect(unwrapErr(grow(state, 'east')).kind).toBe('ASSISTED_ACTION_REJECTED')
  })

  it('needs a direction, and one of the four', () => {
    expect(refusal(ready(), undefined)).toContain('Choose the side')
    expect(refusal(ready(), 'up' as never)).toContain('Choose the side')
  })
})

describe('when Agriculture is not offered', () => {
  it('without Agriculture revealed', () => {
    const state = put(mapOf(), 'cities/redcapital2', 3, 3)
    expect(availability(state).status).toBe('not-owned')
    const chosen = unwrap(chooseTech(state, { playerId: CASH1981, techName: 'Agriculture' }))
    expect(availability(chosen)).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('Agriculture') })
    expect(unwrapErr(grow(chosen, 'east')).kind).toBe('ASSISTED_ACTION_REJECTED')
    expect(capital(chosen).assetId).toBe('cities/redcapital2')
  })

  it('with no capital on the map', () => {
    const state = learn(mapOf())
    expect(availability(state)).toMatchObject({ status: 'unavailable', reason: 'You have no capital on the map to grow.' })
    // A city that is not the capital cannot grow
    const city = learn(put(mapOf(), 'cities/redcity2', 3, 3))
    expect(availability(city).reason).toBe('You have no capital on the map to grow.')
  })

  it('when the capital is a metropolis already, and once grown it is not offered again', () => {
    const done = grown(ready(), 'east')
    expect(availability(done)).toMatchObject({ status: 'unavailable' })
    expect(growableCapital(done, me(done))).toBeUndefined()
    // Any request id: the capital marker is gone, so there is nothing left to grow, in any phase and any turn
    expect(refusal(done, 'west', 'req-9')).toContain('already a metropolis')
    const placedMetropolis = learn(put(mapOf(), 'cities/redmetropolis2', 3, 3))
    expect(availability(placedMetropolis).reason).toBe('Your capital is already a metropolis.')
  })

  it('is not tied to a phase: it works before any phase is open, and in the middle of another player\'s turn', () => {
    // The fixture is at the start of the first turn; the action is the same for a player who is not on turn (ruling 128)
    expect(availability(ready())).toMatchObject({ status: 'ready' })
    const other: GameState = { ...ready() }
    expect(unwrap(performAssistedAction(other, { playerId: CASH1981, action: 'agriculture', requestId: 'r', at: AT, payload: { direction: 'east' } })).board.pieces.some((p) => p.assetId === 'cities/redmetropolis2')).toBe(true)
  })
})

describe('walls', () => {
  it('a walled capital becomes a walled metropolis, and the walls come back with the undo', () => {
    const before = ready({ capital: 'cities/redcapitalwalled2' })
    expect(metropolisAssetIdOf('cities/redcapitalwalled2')).toBe('cities/redmetropoliswalled2')
    const done = grown(before, 'south')
    expect(capital(done).assetId).toBe('cities/redmetropoliswalled2')
    expect(done.log.find((line) => line.assistedActionId === 'req-1')?.publicLog).toContain(', and the walls stay')
    const undone = unwrap(undoByVote(done))
    expect(capital(undone)).toEqual(capital(before))
  })

  it('an unwalled capital gets the plain metropolis', () => {
    expect(capital(grown(ready(), 'south')).assetId).toBe('cities/redmetropolis2')
  })

  it('has artwork for every colour of metropolis, walled or not', () => {
    for (const colour of ['blue', 'green', 'purple', 'red', 'yellow']) {
      for (const walled of ['', 'walled']) {
        const capitalAsset = `cities/${colour}capital${walled}2`
        const metropolis = metropolisAssetIdOf(capitalAsset)
        expect(metropolis === undefined ? undefined : findBoardAsset(metropolis), capitalAsset).toBeDefined()
      }
    }
  })
})

describe('undo by vote', () => {
  it('puts the capital marker back exactly as it stood, for every direction, and the action can be done again', () => {
    for (const direction of ['north', 'west', 'east', 'south'] as const) {
      const before = ready()
      const done = grown(before, direction)
      const undone = unwrap(undoByVote(done))
      expect(capital(undone), direction).toEqual(capital(before))
      expect(growableCapital(undone, me(undone))?.id).toBe(capital(before).id)
      expect(availability(undone).status).toBe('ready')
      expect(capital(grown(undone, direction, 'req-2')).assetId).toBe('cities/redmetropolis2')
    }
  })

  it('keeps the other pieces and takes nothing else back', () => {
    const before = put(ready(), 'markers/Building Program', 3, 3)
    const done = grown(before, 'east')
    expect(done.board.pieces.some((piece) => piece.assetId === 'markers/Building Program')).toBe(true)
    const undone = unwrap(undoByVote(done))
    expect(undone.board.pieces.map((piece) => piece.id).sort()).toEqual(before.board.pieces.map((piece) => piece.id).sort())
  })

  it('is refused when the metropolis was moved, and the line says so', () => {
    const done = grown(ready(), 'east')
    const city = capital(done)
    const moved = unwrap(movePiece(done, { playerId: CASH1981, pieceId: city.id, x: city.x + 5, y: city.y }))
    const refused = undoByVote(moved)
    expect(refused.ok).toBe(false)
    expect(JSON.stringify(unwrapErr(refused))).toContain('moved or turned')
    expect(capital(moved).assetId).toBe('cities/redmetropolis2')
  })

  it('is refused when the metropolis is gone', () => {
    const done = grown(ready(), 'east')
    const gone = { ...done, board: { ...done.board, pieces: done.board.pieces.filter((piece) => piece.category !== 'city') } }
    expect(JSON.stringify(unwrapErr(undoByVote(gone)))).toContain('no longer on the board')
  })

  it('is refused when the marker shows another face now (walls built meanwhile)', () => {
    const done = grown(ready(), 'east')
    const city = capital(done)
    const walled = { ...done, board: { ...done.board, pieces: done.board.pieces.map((piece) => (piece.id === city.id ? { ...piece, assetId: 'cities/redmetropoliswalled2' } : piece)) } }
    expect(JSON.stringify(unwrapErr(undoByVote(walled)))).toContain('not the metropolis as the action left it')
  })

  it('cannot be done with the board Undo: the turning over belongs to the action', () => {
    expect(unwrapErr(undoLastBoardChange(grown(ready(), 'east'), CASH1981))).toEqual({ kind: 'BOARD_UNDO_ASSISTED' })
  })

  it('the board Undo does not walk past the undo vote into the forward flip', () => {
    const undone = unwrap(undoByVote(grown(ready(), 'east')))
    // The vote wrote its own reverse entry and set the floor, so nothing is left for the board Undo to step into
    expect(boardUndoBlocked(undone.board)).toBe(true)
    expect(undoLastBoardChange(undone, CASH1981).ok).toBe(false)
    expect(capital(undone).assetId).toBe('cities/redcapital2')
  })
})

describe('the projection', () => {
  it('gives only the owner the button, with a public reason, and nothing about the hand leaks', () => {
    const state = ready()
    const own = JSON.stringify(toPlayerView(state, CASH1981).you?.availableActions?.find((entry) => entry.action === 'agriculture'))
    expect(own).toContain('"status":"ready"')
    // An opponent's own view lists the action as not theirs, and their view of the opponents says nothing of it
    const other = toPlayerView(state, KARANDRAS1)
    expect(other.you?.availableActions?.find((entry) => entry.action === 'agriculture')?.status).toBe('not-owned')
    expect(JSON.stringify(other.opponents)).not.toContain('agriculture')
    // The refusal text names squares and public pieces only
    const blocked = put(state, 'figures/bluearmy', 4, 3, KARANDRAS1)
    expect(JSON.stringify(toPlayerView(blocked, CASH1981).you?.availableActions)).not.toContain('Karandras1')
  })
})
