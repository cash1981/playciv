/**
 * Start a Building Program and upgrade buildings (task `assisted-city-actions`,
 * issue #264 and #250 slice C): the derived options, the two assisted actions and
 * the undo vote that takes each back.
 *
 * Every test builds the scene of `assisted-build.test.ts`. Cash is Red on Monarchy,
 * the America tile lies in the first map slot and a red city stands on its square
 * B2. The eight outskirts squares of a city on B2 are A1, B1, C1, A2, C2, A3, B3 and
 * C3, that is columns 0 to 2 and rows 0 to 2 without the centre. Karandras is Blue,
 * Itchi Green and Chul Yellow.
 */

import { describe, expect, it } from 'vitest'

import {
  movePiece,
  placePiece,
  removePiece,
  undoLastBoardChange,
} from '../src/actions/board.js'
import { chooseTech, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { performAssistedAction } from '../src/assisted.js'
import { mapCellOf } from '../src/blockade.js'
import {
  SQUARE_SIZE,
  findBoardAsset,
  mapTop,
  piecesAtStep,
  remainingBoardAssetCount,
  slotOrigin,
} from '../src/board.js'
import type { BoardPiece, Rotation } from '../src/board.js'
import { combatBonusOf } from '../src/combat-bonus.js'
import { buildOptionsOf, squareCentre } from '../src/build-options.js'
import type { BuildPayload } from '../src/build-options.js'
import { cityActionsOf, describeUpgrades, upgradeOptionsOf } from '../src/city-actions.js'
import { BUILDING_UPGRADES } from '../src/building-data.js'
import { describeError } from '../src/errors.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { buildingCountOf, findPlayer } from '../src/state.js'
import type { GameState, Playerhand } from '../src/state.js'

import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-10-10T10:00:00.000Z'
const OTHERS = [KARANDRAS1, ITCHI, CHUL]

const MARKER = 'markers/Building Program'
const GRANARY = 'buildings/granary'
const AQUEDUCT = 'buildings/aqueduct'
const LIBRARY = 'buildings/library'
const UNIVERSITY = 'buildings/university'
const BARRACKS = 'buildings/barracks'
const ACADEMY = 'buildings/academy'
const SHIPYARD = 'buildings/shipyard'
const MILITARY_DOCK = 'buildings/militarydock'

const A1 = { column: 0, row: 0 }
const C2 = { column: 2, row: 1 }
const A3 = { column: 0, row: 2 }
const C3 = { column: 2, row: 2 }

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

function learnFor(state: GameState, playerId: string, ...techs: readonly string[]): GameState {
  return techs.reduce(
    (next, techName) =>
      unwrap(revealTech(unwrap(chooseTech(next, { playerId, techName })), { playerId, techName })),
    state,
  )
}
const learn = (state: GameState, ...techs: readonly string[]): GameState => learnFor(state, CASH1981, ...techs)

/** Start of Turn and Trade done, so City Management is open. */
const openTurn = (state: GameState, playerId = CASH1981): GameState =>
  unwrap(markPhasesDone(state, { playerId, turnNumber: 1, upToPhase: 'TRADE' }))

/** The scene with City Management open and the techs revealed. */
const ready = (...techs: readonly string[]): GameState => openTurn(learn(scene(), ...techs))

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

const piecesOf = (state: GameState, assetId: string): readonly BoardPiece[] =>
  state.board.pieces.filter((piece) => piece.assetId === assetId)

const lastLine = (state: GameState): string => state.log.at(-1)?.publicLog ?? ''

const cellOf = (state: GameState, piece: BoardPiece) => {
  const cell = mapCellOf(state.board, piece)
  if (cell === null) throw new Error('piece is off the map')
  return [cell.column, cell.row]
}

/** A piece by id, position and turn, for comparing lists of pieces. */
const keyOf = (piece: BoardPiece): string => `${piece.id}@${piece.x},${piece.y}@${piece.rotation}`

const pieceAt = (state: GameState, assetId: string, column: number, row: number): BoardPiece => {
  const found = piecesOf(state, assetId).find((piece) => {
    const cell = mapCellOf(state.board, piece)
    return cell?.column === column && cell.row === row
  })
  if (found === undefined) throw new Error(`no ${assetId} on ${column},${row}`)
  return found
}

// -- the Building Program ---------------------------------------------------------

const tryStart = (state: GameState, requestId = 'start-1', playerId = CASH1981, cityPieceId = cityOf(state).id) =>
  performAssistedAction(state, {
    playerId,
    action: 'startBuildingProgram',
    requestId,
    at: AT,
    payload: { cityPieceId },
  })

const startProgram = (state: GameState, requestId = 'start-1', cityPieceId = cityOf(state).id): GameState =>
  unwrap(tryStart(state, requestId, CASH1981, cityPieceId))

const refusal = (result: ReturnType<typeof tryStart>): string => describeError(unwrapErr(result))

const optionOf = (state: GameState, index = 0) => {
  const found = cityActionsOf(state, me(state))[index]
  if (found === undefined) throw new Error('no city action options')
  return found
}

// -- the build action, only to see how the marker behaves with it ----------------

function tryBuild(state: GameState, assetId: string, at: { column: number; row: number }, requestId = 'build-1') {
  const payload: BuildPayload = {
    cityPieceId: cityOf(state).id,
    item: { kind: 'building', assetId },
    target: at,
  }
  return performAssistedAction(state, { playerId: CASH1981, action: 'build', requestId, at: AT, payload })
}
const build = (state: GameState, assetId: string, at: { column: number; row: number }, requestId = 'build-1') =>
  unwrap(tryBuild(state, assetId, at, requestId))

// -- the upgrade ------------------------------------------------------------------

const tryUpgrade = (state: GameState, requestId = 'up-1', family?: string, playerId = CASH1981) =>
  performAssistedAction(state, {
    playerId,
    action: 'upgradeBuildings',
    requestId,
    at: AT,
    ...(family === undefined ? {} : { payload: { family } }),
  })

const upgrade = (state: GameState, requestId = 'up-1', family?: string): GameState =>
  unwrap(tryUpgrade(state, requestId, family))

/**
 * Cash has Engineering and Printing Press revealed and City Management open. In the
 * outskirts of the red city on B2: a Granary on A1, a Library on A3, a Granary on C2
 * and a Granary Karandras put on C3 (the owner is the city, never who placed it).
 * Not in them: a Granary of Cash's on E6, and Karandras's own city on H2 with a
 * Granary on H3.
 */
function upgradeScene(techs: readonly string[] = ['Engineering', 'Printing Press']): GameState {
  let state = ready(...techs)
  state = put(state, CASH1981, GRANARY, 0, 0, 90)
  state = put(state, CASH1981, LIBRARY, 0, 2)
  state = put(state, CASH1981, GRANARY, 2, 1)
  state = put(state, KARANDRAS1, GRANARY, 2, 2)
  state = put(state, CASH1981, GRANARY, 4, 5)
  state = put(state, KARANDRAS1, 'cities/bluecity2', 7, 1)
  state = put(state, KARANDRAS1, GRANARY, 7, 2)
  return state
}

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

const blockedReason = (result: ReturnType<typeof vote>): string => {
  const error = unwrapErr(result)
  return error.kind === 'ASSISTED_UNDO_BLOCKED' ? error.reason : ''
}

// ---------------------------------------------------------------------------
// Start a Building Program
// ---------------------------------------------------------------------------

describe('what a city offers: start a Building Program', () => {
  it('a city in an open City Management phase is ready and has no marker', () => {
    expect(optionOf(ready())).toEqual({
      cityPieceId: cityOf(ready()).id,
      label: 'City B2',
      startBuildingProgram: { status: 'ready', reason: 'Ready to start a Building Program.', hasMarker: false },
    })
  })

  it('outside City Management it says wrong-phase with the phase reason', () => {
    const closed = scene()
    expect(optionOf(closed).startBuildingProgram).toEqual({
      status: 'wrong-phase',
      reason: 'Only available during your open City Management phase.',
      hasMarker: false,
    })
    const done = unwrap(markPhasesDone(ready(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' }))
    expect(optionOf(done).startBuildingProgram.status).toBe('wrong-phase')
  })

  it('a city with the marker says so, in any phase', () => {
    const marked = put(ready(), CASH1981, MARKER, 1, 1)
    expect(optionOf(marked).startBuildingProgram).toEqual({
      status: 'unavailable',
      reason: 'This city already has a Building Program marker.',
      hasMarker: true,
    })
    expect(optionOf(put(scene(), CASH1981, MARKER, 1, 1)).startBuildingProgram).toMatchObject({
      status: 'wrong-phase',
      hasMarker: true,
    })
  })

  it('a marker on another square is not the city\'s', () => {
    expect(optionOf(put(ready(), CASH1981, MARKER, 2, 1)).startBuildingProgram.status).toBe('ready')
  })

  it('every city of the player gets an entry, and a player without a colour or a city gets none', () => {
    const two = put(ready(), CASH1981, 'cities/redcity2', 9, 9)
    expect(cityActionsOf(two, me(two)).map((city) => city.label)).toEqual(['City B2', 'City J10'])
    expect(cityActionsOf(two, me(two, KARANDRAS1))).toEqual([])
    expect(cityActionsOf(two, { ...me(two), color: null })).toEqual([])
  })

  it('a marker on one city leaves the other city ready', () => {
    const two = put(put(ready(), CASH1981, 'cities/redcity2', 9, 9), CASH1981, MARKER, 9, 9)
    expect(cityActionsOf(two, me(two)).map((city) => city.startBuildingProgram.status)).toEqual(['ready', 'unavailable'])
  })
})

describe('starting a Building Program', () => {
  it('puts the marker centred on the city centre, writes one public line and records what undo needs', () => {
    const before = ready()
    const done = startProgram(before)

    const [marker] = piecesOf(done, MARKER)
    expect(marker).toBeDefined()
    const centre = squareCentre(done.board, { column: 1, row: 1 })
    // Placing rounds to whole pixels, so the centre is within half a pixel of the square's
    expect(Math.abs((marker?.x ?? 0) + (marker?.width ?? 0) / 2 - centre.x)).toBeLessThanOrEqual(0.5)
    expect(Math.abs((marker?.y ?? 0) + (marker?.height ?? 0) / 2 - centre.y)).toBeLessThanOrEqual(0.5)
    expect(cellOf(done, marker as BoardPiece)).toEqual([1, 1])

    expect(done.log).toHaveLength(before.log.length + 1)
    expect(lastLine(done)).toBe('cash1981 started a Building Program in City B2')
    expect(done.log.at(-1)).toMatchObject({ assistedActionId: 'start-1', privateLog: '' })

    const record = done.assistedActions[0]
    expect(record).toMatchObject({ id: 'start-1', kind: 'startBuildingProgram', status: 'applied', usageKey: null, phase: 'CM' })
    const entry = done.board.history.at(-1)
    expect(record?.effect).toEqual({
      kind: 'startBuildingProgram',
      cityPieceId: cityOf(before).id,
      cityLabel: 'City B2',
      square: { column: 1, row: 1, label: 'B2' },
      pieceId: marker?.id,
      position: { x: marker?.x, y: marker?.y },
      historyId: entry?.id,
    })
    expect(entry?.change).toMatchObject({ kind: 'place', piece: { id: marker?.id } })
  })

  it('the city then produces with the doubled outskirts, and says it has the marker', () => {
    const done = startProgram(ready())
    expect(buildOptionsOf(done, me(done))[0]).toMatchObject({ production: 10, productionSource: 'building-program' })
    expect(optionOf(done).startBuildingProgram).toMatchObject({ status: 'unavailable', hasMarker: true })
  })

  it('is free: no trade, no culture, no used turn action', () => {
    const before = ready()
    const done = startProgram(before)
    expect(me(done).stats).toEqual(me(before).stats)
    expect(me(done).playerTurns).toEqual(me(before).playerTurns)
  })

  it('a second city of the player starts its own, and each keeps one', () => {
    const two = put(ready(), CASH1981, 'cities/redcity2', 9, 9)
    const done = startProgram(startProgram(two, 'start-1', cityOf(two, 0).id), 'start-2', cityOf(two, 1).id)
    expect(piecesOf(done, MARKER).map((piece) => cellOf(done, piece))).toEqual([[1, 1], [9, 9]])
    expect(lastLine(done)).toBe('cash1981 started a Building Program in City J10')
  })

  it('counts the line into its board entry, so stepping through the history shows them together', () => {
    const done = startProgram(ready())
    expect(done.board.history.at(-1)?.logLength).toBe(done.log.length)
    const lengths = done.board.history.map((entry) => entry.logLength)
    expect(lengths).toEqual([...lengths].sort((a, b) => a - b))
    const replayed = piecesAtStep(done.board.history, done.board.history.length)
    expect([...replayed].map(keyOf).sort()).toEqual([...done.board.pieces].map(keyOf).sort())
  })

  it('does not leave the input state changed', () => {
    const before = ready()
    const snapshot = JSON.stringify(before)
    startProgram(before)
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})

describe('the marker and a metropolis', () => {
  // Horizontal, anchor C2 and second centre B2; vertical, anchor B3 and second centre B2
  const horizontal = (): GameState => putMetropolis(openTurn(learn(withAmerica(game()))), 2, 1, 0)
  const vertical = (): GameState => putMetropolis(openTurn(learn(withAmerica(game()))), 1, 2, 90)

  it('puts the marker on the anchor centre of a horizontal metropolis', () => {
    const done = startProgram(horizontal())
    expect(piecesOf(done, MARKER).map((piece) => cellOf(done, piece))).toEqual([[2, 1]])
    expect(lastLine(done)).toMatch(/^cash1981 started a Building Program in Metropolis /)
  })

  it('puts the marker on the anchor centre of a vertical metropolis', () => {
    const done = startProgram(vertical())
    expect(piecesOf(done, MARKER).map((piece) => cellOf(done, piece))).toEqual([[1, 2]])
  })

  it.each([
    ['horizontal, on the anchor', horizontal, 2, 1],
    ['horizontal, on the second centre', horizontal, 1, 1],
    ['vertical, on the anchor', vertical, 1, 2],
    ['vertical, on the second centre', vertical, 1, 1],
  ] as const)('a marker on either centre counts as having one: %s', (_name, make, column, row) => {
    const marked = put(make(), CASH1981, MARKER, column, row)
    expect(optionOf(marked).startBuildingProgram).toMatchObject({ status: 'unavailable', hasMarker: true })
    const result = tryStart(marked)
    expect(unwrapErr(result)).toMatchObject({ kind: 'ASSISTED_ACTION_REJECTED', status: 'unavailable' })
    expect(refusal(result)).toContain('This city already has a Building Program marker.')
    expect(piecesOf(marked, MARKER)).toHaveLength(1)
  })

  it('a marker in an outskirts square of the metropolis is not on a centre', () => {
    expect(optionOf(put(horizontal(), CASH1981, MARKER, 0, 1)).startBuildingProgram.status).toBe('ready')
  })
})

describe('a start that is not allowed', () => {
  it('a city that already has a marker cannot start another, and nothing changes', () => {
    const done = startProgram(ready())
    const snapshot = JSON.stringify(done)
    const result = tryStart(done, 'start-2')
    expect(unwrapErr(result)).toMatchObject({ kind: 'ASSISTED_ACTION_REJECTED', status: 'unavailable' })
    expect(refusal(result)).toContain('This city already has a Building Program marker.')
    expect(JSON.stringify(done)).toBe(snapshot)
    expect(piecesOf(done, MARKER)).toHaveLength(1)
  })

  it('a marker placed by hand counts, whoever placed it', () => {
    const marked = put(ready(), KARANDRAS1, MARKER, 1, 1)
    expect(refusal(tryStart(marked))).toContain('already has a Building Program marker')
  })

  it('outside City Management it is refused as wrong-phase', () => {
    expect(unwrapErr(tryStart(scene()))).toMatchObject({ kind: 'ASSISTED_ACTION_REJECTED', status: 'wrong-phase' })
    const done = unwrap(markPhasesDone(ready(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' }))
    expect(unwrapErr(tryStart(done))).toMatchObject({ status: 'wrong-phase' })
    expect(piecesOf(done, MARKER)).toEqual([])
  })

  it('someone who is not in the game cannot start one', () => {
    expect(unwrapErr(tryStart(ready(), 'start-1', 'spectator'))).toEqual({ kind: 'NO_ACCESS', playerId: 'spectator' })
  })

  it('another player cannot start one on the city of Cash', () => {
    const state = openTurn(ready(), KARANDRAS1)
    const result = tryStart(state, 'start-1', KARANDRAS1, cityOf(state).id)
    expect(refusal(result)).toBe('You have no city on the map to start a Building Program in.')
  })

  it('a city that is not the player\'s, or does not exist, is refused', () => {
    const state = put(openTurn(ready(), KARANDRAS1), KARANDRAS1, 'cities/bluecity2', 9, 9)
    const blue = state.board.pieces.filter((piece) => piece.category === 'city')[1] as BoardPiece
    expect(refusal(tryStart(state, 'start-1', CASH1981, blue.id))).toBe('That city is not yours, or it is no longer on the map.')
    expect(refusal(tryStart(state, 'start-1', CASH1981, 'no-such-city'))).toBe('That city is not yours, or it is no longer on the map.')
  })

  it('a payload that is missing or of another action is refused', () => {
    const state = ready()
    expect(refusal(performAssistedAction(state, { playerId: CASH1981, action: 'startBuildingProgram', requestId: 'start-1' }))).toBe('Say which city.')
    const build = performAssistedAction(state, {
      playerId: CASH1981,
      action: 'startBuildingProgram',
      requestId: 'start-1',
      payload: { cityPieceId: cityOf(state).id, item: { kind: 'army' }, target: A1 },
    })
    expect(refusal(build)).toBe('Say which city.')
  })

  it('a city piece off the map cannot start one', () => {
    const state = put(ready(), CASH1981, 'cities/redcity2', 9, 9)
    const off = unwrap(
      movePiece(state, { playerId: CASH1981, pieceId: cityOf(state, 1).id, x: -400, y: -400, snap: false }),
    )
    expect(cityActionsOf(off, me(off)).map((city) => city.cityPieceId)).toEqual([cityOf(off, 0).id])
    expect(refusal(tryStart(off, 'start-1', CASH1981, cityOf(off, 1).id))).toBe('That city is not yours, or it is no longer on the map.')
  })
})

describe('the request id', () => {
  it('the same request id twice starts one program and returns the same state', () => {
    const done = startProgram(ready())
    expect(unwrap(tryStart(done))).toBe(done)
    expect(piecesOf(done, MARKER)).toHaveLength(1)
    expect(done.assistedActions).toHaveLength(1)
  })

  it('a request id used by another action or player is refused', () => {
    const done = startProgram(ready())
    expect(refusal(tryUpgrade(done, 'start-1'))).toBe('This request id was already used.')
  })

  it('a stale second press with a new request id is refused, not applied twice', () => {
    const done = startProgram(ready())
    expect(unwrapErr(tryStart(done, 'start-2')).kind).toBe('ASSISTED_ACTION_REJECTED')
    expect(done.assistedActions).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Undoing a start
// ---------------------------------------------------------------------------

describe('undoing a start with the vote', () => {
  it('removes the marker, marks the record undone and writes the System line', () => {
    const done = startProgram(ready())
    const marker = piecesOf(done, MARKER)[0] as BoardPiece
    const undone = undoByVote(done, 'start-1')

    expect(piecesOf(undone, MARKER)).toEqual([])
    expect(undone.assistedActions[0]?.status).toBe('undone')
    expect(lastLine(undone)).toBe("System: cash1981's Building Program in City B2 was undone: the marker was removed")
    expect(undone.board.history.at(-1)?.change).toMatchObject({ kind: 'remove', piece: { id: marker.id } })
    // The city can start one again
    expect(optionOf(undone).startBuildingProgram.status).toBe('ready')
    expect(buildOptionsOf(undone, me(undone))[0]?.productionSource).toBe('estimate')
  })

  it('counts the entries of the undo with the System line', () => {
    const undone = undoByVote(startProgram(ready()), 'start-1')
    expect(undone.board.history.at(-1)?.logLength).toBe(undone.log.length)
  })

  it('cannot be undone twice', () => {
    const undone = undoByVote(startProgram(ready()), 'start-1')
    expect(unwrapErr(initiateUndo(undone, { logId: logIdOf(undone, 'start-1'), playerId: CASH1981 })).kind).toBe(
      'ASSISTED_ACTION_ALREADY_UNDONE',
    )
  })

  it('is refused when the marker has left the centre, and the vote stays open', () => {
    const done = startProgram(ready())
    const marker = piecesOf(done, MARKER)[0] as BoardPiece
    const moved = unwrap(
      movePiece(done, {
        playerId: CASH1981,
        pieceId: marker.id,
        x: 3 * SQUARE_SIZE + 4,
        y: mapTop(done.board) + 3 * SQUARE_SIZE + 4,
      }),
    )
    const attempt = almostUndone(moved, 'start-1')
    const result = attempt.last()
    expect(unwrapErr(result)).toMatchObject({ kind: 'ASSISTED_UNDO_BLOCKED', logId: attempt.logId })
    expect(blockedReason(result)).toBe('The Building Program marker has left the centre of City B2. Move it back first.')
    expect(attempt.state.assistedActions[0]?.status).toBe('applied')
    expect(piecesOf(attempt.state, MARKER)).toHaveLength(1)
  })

  it('is refused when the marker is gone', () => {
    const done = startProgram(ready())
    const marker = piecesOf(done, MARKER)[0] as BoardPiece
    const gone = unwrap(removePiece(done, { playerId: CASH1981, pieceId: marker.id }))
    const result = almostUndone(gone, 'start-1').last()
    expect(blockedReason(result)).toContain('is no longer on the board')
  })

  it('still works when the marker was nudged within the centre square', () => {
    const done = startProgram(ready())
    const marker = piecesOf(done, MARKER)[0] as BoardPiece
    const nudged = unwrap(movePiece(done, { playerId: CASH1981, pieceId: marker.id, x: marker.x + 5, y: marker.y - 5, snap: false }))
    expect(piecesOf(undoByVote(nudged, 'start-1'), MARKER)).toEqual([])
  })
})

describe('the Building Program and the build action, in both orders', () => {
  const started = (): GameState => startProgram(ready('Writing'))

  it('the next build uses the doubled figure and the marker', () => {
    const marked = started()
    const marker = piecesOf(marked, MARKER)[0] as BoardPiece
    const city = buildOptionsOf(marked, me(marked))[0]
    expect(city?.production).toBe(10)
    const done = build(marked, LIBRARY, C2)
    expect(piecesOf(done, MARKER)).toEqual([])
    expect(lastLine(done)).toBe('cash1981 built a Library in City B2 on square C2, using up the Building Program marker')
    expect(done.assistedActions[1]?.effect).toMatchObject({ kind: 'build', marker: { piece: { id: marker.id } } })
  })

  it('start, build, undo the build, undo the start', () => {
    const marked = started()
    const marker = piecesOf(marked, MARKER)[0] as BoardPiece
    const built = build(marked, LIBRARY, C2)

    // The build undone brings the very same marker back, so the start can be undone after it
    const buildUndone = undoByVote(built, 'build-1')
    expect(piecesOf(buildUndone, MARKER)).toEqual([marker])
    const startUndone = undoByVote(buildUndone, 'start-1')
    expect(piecesOf(startUndone, MARKER)).toEqual([])
    expect(piecesOf(startUndone, LIBRARY)).toEqual([])
    expect(startUndone.assistedActions.map((record) => record.status)).toEqual(['undone', 'undone'])
  })

  it('undoing the start while the build stands is refused, with the vote open', () => {
    const built = build(started(), LIBRARY, C2)
    expect(piecesOf(built, MARKER)).toEqual([])
    const attempt = almostUndone(built, 'start-1')
    const result = attempt.last()
    expect(unwrapErr(result)).toMatchObject({ kind: 'ASSISTED_UNDO_BLOCKED' })
    expect(blockedReason(result)).toBe(
      'The Building Program marker of City B2 is no longer on the board (a build may have used it up), so this cannot be undone.',
    )
    // Nothing moved: the build stands, the start is still applied
    expect(attempt.state.assistedActions.map((record) => record.status)).toEqual(['applied', 'applied'])
    expect(piecesOf(attempt.state, LIBRARY)).toHaveLength(1)
  })

  it('build then start: the new marker is for the next build, and undoing the start leaves the building', () => {
    const built = build(ready('Writing'), LIBRARY, C2)
    const marked = startProgram(built, 'start-1')
    expect(piecesOf(marked, MARKER)).toHaveLength(1)
    const undone = undoByVote(marked, 'start-1')
    expect(piecesOf(undone, MARKER)).toEqual([])
    expect(piecesOf(undone, LIBRARY)).toHaveLength(1)
    expect(undone.assistedActions.map((record) => record.status)).toEqual(['applied', 'undone'])
  })

  it('undoing the build, which put the marker back, is not blocked by the start being undone first when the marker is there', () => {
    const marked = started()
    const built = build(marked, LIBRARY, C2)
    const buildUndone = undoByVote(built, 'build-1')
    // A later start is refused: the restored marker is on the centre again
    expect(refusal(tryStart(buildUndone, 'start-2'))).toContain('already has a Building Program marker')
  })
})

describe('the board Undo and a start', () => {
  it('refuses to take back the marker alone', () => {
    const done = startProgram(ready())
    const snapshot = JSON.stringify(done)
    expect(done.board.history.at(-1)?.change.kind).toBe('place')
    expect(unwrapErr(undoLastBoardChange(done, CASH1981))).toEqual({ kind: 'BOARD_UNDO_ASSISTED' })
    expect(JSON.stringify(done)).toBe(snapshot)
  })

  it('works on an ordinary change again once the start is undone', () => {
    const undone = undoByVote(startProgram(ready()), 'start-1')
    const back = unwrap(undoLastBoardChange(undone, CASH1981))
    expect(back.board.history).toHaveLength(undone.board.history.length - 1)
  })

  it('does not stop a later ordinary change from being undone', () => {
    const done = startProgram(ready())
    const marker = piecesOf(done, MARKER)[0] as BoardPiece
    const moved = unwrap(movePiece(done, { playerId: CASH1981, pieceId: marker.id, x: marker.x + 3, y: marker.y, snap: false }))
    expect(unwrap(undoLastBoardChange(moved, CASH1981)).board.history).toHaveLength(done.board.history.length)
  })
})

// ---------------------------------------------------------------------------
// Upgrade options
// ---------------------------------------------------------------------------

describe('what can be upgraded', () => {
  const families = (state: GameState) => upgradeOptionsOf(state, me(state)).map((option) => option.label)

  it('lists only the families whose upgraded tech is revealed and that have a building in the player\'s cities', () => {
    expect(families(upgradeScene(['Engineering']))).toEqual(['Granary to Aqueduct'])
    expect(families(upgradeScene(['Printing Press']))).toEqual(['Library to University'])
    expect(families(upgradeScene(['Engineering', 'Printing Press']))).toEqual(['Granary to Aqueduct', 'Library to University'])
  })

  it('names the family, the count and the squares in board order', () => {
    const [granary, library] = upgradeOptionsOf(upgradeScene(), me(upgradeScene()))
    expect(granary).toEqual({
      basicAssetId: GRANARY,
      upgradedAssetId: AQUEDUCT,
      basicLabel: 'Granary',
      upgradedLabel: 'Aqueduct',
      label: 'Granary to Aqueduct',
      count: 3,
      squares: [
        { ...A1, label: 'A1' },
        { ...C2, label: 'C2' },
        { ...C3, label: 'C3' },
      ],
    })
    expect(library).toMatchObject({ label: 'Library to University', count: 1, squares: [{ ...A3, label: 'A3' }] })
  })

  it('nothing without a revealed tech of the upgraded form', () => {
    expect(families(upgradeScene([]))).toEqual([])
    // The basic form's tech is not the upgraded form's
    expect(families(upgradeScene(['Pottery', 'Writing']))).toEqual([])
  })

  it('a tech that is chosen but not revealed unlocks nothing', () => {
    const hidden = unwrap(chooseTech(upgradeScene([]), { playerId: CASH1981, techName: 'Engineering' }))
    expect(families(hidden)).toEqual([])
    expect(JSON.stringify(upgradeOptionsOf(hidden, me(hidden)))).not.toContain('Engineering')
    // Revealing it is what unlocks it
    const revealed = unwrap(revealTech(hidden, { playerId: CASH1981, techName: 'Engineering' }))
    expect(families(revealed)).toEqual(['Granary to Aqueduct'])
  })

  it('every family of the table is listed when its tech is revealed and a building stands', () => {
    // Banking, Theology, Military Science (Academy and Military Dock) and Railroad as well
    let state = ready('Engineering', 'Printing Press', 'Banking', 'Theology', 'Military Science', 'Railroad')
    const basics = Object.keys(BUILDING_UPGRADES)
    const squares = [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2]] as const
    basics.forEach((assetId, index) => {
      const [column, row] = squares[index] ?? [0, 0]
      state = put(state, CASH1981, assetId, column, row)
    })
    expect(upgradeOptionsOf(state, me(state)).map((option) => option.basicAssetId)).toEqual(basics)
    expect(upgradeOptionsOf(state, me(state)).map((option) => option.upgradedAssetId)).toEqual(Object.values(BUILDING_UPGRADES))
  })

  it('Military Science alone unlocks the Academy and the Military Dock, not the Metalworking or Navy forms', () => {
    let state = ready('Military Science')
    state = put(put(state, CASH1981, BARRACKS, 0, 0), CASH1981, SHIPYARD, 2, 0)
    expect(upgradeOptionsOf(state, me(state)).map((option) => [option.basicAssetId, option.upgradedAssetId])).toEqual([
      [BARRACKS, ACADEMY],
      [SHIPYARD, MILITARY_DOCK],
    ])
  })

  it('only buildings in the outskirts of the player\'s own cities count', () => {
    const state = upgradeScene(['Engineering'])
    const [granary] = upgradeOptionsOf(state, me(state))
    // A1, C2 and C3 (placed by Karandras, in Cash's outskirts); not E6, and not Blue's H3
    expect(granary?.squares.map((square) => square.label)).toEqual(['A1', 'C2', 'C3'])
    // Karandras's own view: his city on H2 has a Granary on H3 but he has not revealed Engineering
    expect(upgradeOptionsOf(state, me(state, KARANDRAS1))).toEqual([])
    const blue = learnFor(state, KARANDRAS1, 'Engineering')
    expect(upgradeOptionsOf(blue, me(blue, KARANDRAS1)).map((option) => option.squares.map((square) => square.label))).toEqual([['H3']])
  })

  it('a building on a city centre or outside every outskirts is not listed', () => {
    let state = ready('Engineering')
    state = put(put(state, CASH1981, GRANARY, 1, 1), CASH1981, GRANARY, 3, 3)
    expect(upgradeOptionsOf(state, me(state))).toEqual([])
  })

  it('both metropolis orientations count the buildings in their ten outskirts squares, and none beyond them', () => {
    // Horizontal, centres B2 and C2: outskirts are columns 0 to 3, rows 0 to 2
    let horizontal = putMetropolis(openTurn(learn(withAmerica(game()), 'Engineering')), 2, 1, 0)
    horizontal = put(put(put(horizontal, CASH1981, GRANARY, 0, 0), CASH1981, GRANARY, 3, 2), CASH1981, GRANARY, 4, 1)
    expect(upgradeOptionsOf(horizontal, me(horizontal))[0]?.squares.map((square) => square.label)).toEqual(['A1', 'D3'])
    // Vertical, centres B2 and B3: outskirts are columns 0 to 2, rows 0 to 3
    let vertical = putMetropolis(openTurn(learn(withAmerica(game()), 'Engineering')), 1, 2, 90)
    vertical = put(put(put(vertical, CASH1981, GRANARY, 0, 0), CASH1981, GRANARY, 2, 3), CASH1981, GRANARY, 3, 1)
    expect(upgradeOptionsOf(vertical, me(vertical))[0]?.squares.map((square) => square.label)).toEqual(['A1', 'C4'])
  })

  it('a building in the outskirts of two of the player\'s cities is listed once', () => {
    // A second city on D2 shares the squares of column C with B2
    let state = ready('Engineering')
    state = put(put(state, CASH1981, 'cities/redcity2', 3, 1), CASH1981, GRANARY, 2, 0)
    expect(upgradeOptionsOf(state, me(state))[0]).toMatchObject({ count: 1, squares: [{ label: 'C1' }] })
  })

  it('is available in any phase, and for the same squares in each', () => {
    const open = upgradeOptionsOf(upgradeScene(), me(upgradeScene()))
    const closed = upgradeScene()
    const research = unwrap(markPhasesDone(closed, { playerId: CASH1981, turnNumber: 1, upToPhase: 'MOVEMENT' }))
    expect(upgradeOptionsOf(research, me(research))).toEqual(open)
  })

  it('a player without a colour or a city has none', () => {
    const state = upgradeScene()
    expect(upgradeOptionsOf(state, { ...me(state), color: null })).toEqual([])
    expect(upgradeOptionsOf(state, me(state, ITCHI))).toEqual([])
  })
})

describe('the sentence for an upgrade', () => {
  it('names the count, both forms in plural and the squares', () => {
    expect(
      describeUpgrades([
        { basicAssetId: GRANARY, squareLabel: 'B3' },
        { basicAssetId: GRANARY, squareLabel: 'C4' },
      ]),
    ).toBe('2 Granaries to Aqueducts at B3 and C4')
  })

  it('keeps the singular for one, a name ending in s for several, and lists families in the table order', () => {
    expect(describeUpgrades([{ basicAssetId: LIBRARY, squareLabel: 'A3' }])).toBe('1 Library to University at A3')
    expect(
      describeUpgrades([
        { basicAssetId: BARRACKS, squareLabel: 'A1' },
        { basicAssetId: BARRACKS, squareLabel: 'B1' },
        { basicAssetId: BARRACKS, squareLabel: 'C1' },
        { basicAssetId: GRANARY, squareLabel: 'D1' },
      ]),
    ).toBe('1 Granary to Aqueduct at D1; 3 Barracks to Academies at A1, B1 and C1')
  })
})

// ---------------------------------------------------------------------------
// Upgrading
// ---------------------------------------------------------------------------

describe('upgrading every family', () => {
  it('flips each basic building to the upgraded form on the same square, in board order', () => {
    const before = upgradeScene()
    const granaries = piecesOf(before, GRANARY)
    const done = upgrade(before)

    // A1, C2 and C3 flipped; E6 and Blue's H3 are untouched
    const flippedSquares = piecesOf(done, AQUEDUCT).map((piece) => cellOf(done, piece))
    expect(flippedSquares).toEqual([[0, 0], [2, 1], [2, 2]])
    expect(piecesOf(done, UNIVERSITY).map((piece) => cellOf(done, piece))).toEqual([[0, 2]])
    expect(piecesOf(done, LIBRARY)).toEqual([])
    expect(piecesOf(done, GRANARY).map((piece) => cellOf(done, piece))).toEqual([[4, 5], [7, 2]])
    // The ones left are exactly the same pieces as before
    expect(piecesOf(done, GRANARY).map(keyOf)).toEqual([pieceAt(before, GRANARY, 4, 5), pieceAt(before, GRANARY, 7, 2)].map(keyOf))
    expect(granaries).toHaveLength(5)
  })

  it('writes one public line naming the family and the squares', () => {
    const before = upgradeScene()
    const done = upgrade(before)
    expect(done.log).toHaveLength(before.log.length + 1)
    expect(lastLine(done)).toBe('cash1981 upgraded 3 Granaries to Aqueducts at A1, C2 and C3; 1 Library to University at A3')
    expect(done.log.at(-1)).toMatchObject({ assistedActionId: 'up-1', privateLog: '' })
  })

  it('a flipped piece keeps its square, its centre and its turn, and is a new piece of the upgraded asset', () => {
    const before = upgradeScene()
    const old = piecesOf(before, GRANARY)[0] as BoardPiece
    expect(old.rotation).toBe(90)
    const done = upgrade(before, 'up-1', GRANARY)
    const [flipped] = piecesOf(done, AQUEDUCT)
    expect(flipped?.rotation).toBe(90)
    expect(flipped?.id).not.toBe(old.id)
    expect(flipped?.category).toBe('building')
    // Both forms differ by a few pixels in size: the centre is the one thing kept
    expect(Math.abs((flipped?.x ?? 0) + (flipped?.width ?? 0) / 2 - (old.x + old.width / 2))).toBeLessThanOrEqual(0.5)
    expect(Math.abs((flipped?.y ?? 0) + (flipped?.height ?? 0) / 2 - (old.y + old.height / 2))).toBeLessThanOrEqual(0.5)
    expect(cellOf(done, flipped as BoardPiece)).toEqual(cellOf(before, old))
  })

  it('goes through the board history, a removal then a placement for each building', () => {
    const before = upgradeScene()
    const done = upgrade(before)
    const entries = done.board.history.slice(before.board.history.length)
    expect(entries.map((entry) => entry.change.kind)).toEqual(['remove', 'place', 'remove', 'place', 'remove', 'place', 'remove', 'place'])
    // Board order: A1, A3 (the Library), C2, C3 is the order the pieces were put, so A1, A3 ... checked by the squares in the record
    const effect = done.assistedActions[0]?.effect
    expect(effect?.kind).toBe('upgradeBuildings')
    if (effect?.kind !== 'upgradeBuildings') return
    expect(effect.flipped.map((flip) => flip.square.label)).toEqual(['A1', 'A3', 'C2', 'C3'])
    expect(effect.flipped.map((flip) => [flip.removedHistoryId, flip.placedHistoryId])).toEqual(
      entries.reduce<string[][]>((pairs, entry, index) => (index % 2 === 0 ? [...pairs, [entry.id]] : [...pairs.slice(0, -1), [...(pairs.at(-1) ?? []), entry.id]]), []),
    )
    for (const flip of effect.flipped) {
      expect(flip.from.id).toEqual(expect.any(String))
      expect(done.board.pieces.some((piece) => piece.id === flip.pieceId)).toBe(true)
      expect(done.board.pieces.some((piece) => piece.id === flip.from.id)).toBe(false)
    }
    expect(done.assistedActions[0]).toMatchObject({ kind: 'upgradeBuildings', status: 'applied', usageKey: null })
  })

  it('counts the line into every board entry, so stepping through the history shows them together', () => {
    const before = upgradeScene()
    const done = upgrade(before)
    for (const entry of done.board.history.slice(before.board.history.length)) expect(entry.logLength).toBe(done.log.length)
    const lengths = done.board.history.map((entry) => entry.logLength)
    expect(lengths).toEqual([...lengths].sort((a, b) => a - b))
    const replayed = piecesAtStep(done.board.history, done.board.history.length)
    expect([...replayed].map(keyOf).sort()).toEqual([...done.board.pieces].map(keyOf).sort())
  })

  it('the supply count does not change, since both forms share one pool', () => {
    const before = upgradeScene()
    const granary = findBoardAsset(GRANARY)
    const aqueduct = findBoardAsset(AQUEDUCT)
    const library = findBoardAsset(LIBRARY)
    if (granary === undefined || aqueduct === undefined || library === undefined) throw new Error('missing asset')
    const remaining = (state: GameState) =>
      [granary, aqueduct, library].map((asset) => remainingBoardAssetCount(asset, state.board.pieces, state.numOfPlayers))
    const done = upgrade(before)
    expect(remaining(done)).toEqual(remaining(before))
    // 5 of the 6 Granary family pieces are on the board, so the count is a real one
    expect(remaining(before)[0]).toBe(1)
    expect(done.board.pieces.length).toBe(before.board.pieces.length)
  })

  it('costs nothing and uses no turn action or Building Program marker', () => {
    const before = put(upgradeScene(), CASH1981, MARKER, 1, 1)
    const done = upgrade(before)
    expect(me(done).stats).toEqual(me(before).stats)
    expect(me(done).playerTurns).toEqual(me(before).playerTurns)
    expect(piecesOf(done, MARKER).map((piece) => piece.id)).toEqual(piecesOf(before, MARKER).map((piece) => piece.id))
  })

  it('leaves another player\'s building, one outside every city and the city centre alone', () => {
    const before = upgradeScene()
    const done = upgrade(before)
    // E6 is Cash's own but in no city of hers; H3 is in Karandras's city
    for (const [column, row] of [[4, 5], [7, 2]] as const) {
      expect(keyOf(pieceAt(done, GRANARY, column, row))).toBe(keyOf(pieceAt(before, GRANARY, column, row)))
    }
    expect(piecesOf(done, 'cities/redcity2').map(keyOf)).toEqual(piecesOf(before, 'cities/redcity2').map(keyOf))
    expect(piecesOf(done, 'cities/bluecity2').map(keyOf)).toEqual(piecesOf(before, 'cities/bluecity2').map(keyOf))
  })

  it('upgrades the buildings in the outskirts of both orientations of a metropolis', () => {
    for (const [column, row, rotation, expected] of [
      [2, 1, 0, [[0, 0], [3, 2]]],
      [1, 2, 90, [[0, 0], [2, 3]]],
    ] as const) {
      let state = putMetropolis(openTurn(learn(withAmerica(game()), 'Engineering')), column, row, rotation)
      for (const [c, r] of expected) state = put(state, CASH1981, GRANARY, c, r)
      state = put(state, CASH1981, GRANARY, 5, 5)
      const done = upgrade(state)
      expect(piecesOf(done, AQUEDUCT).map((piece) => cellOf(done, piece))).toEqual(expected)
      expect(piecesOf(done, GRANARY).map((piece) => cellOf(done, piece))).toEqual([[5, 5]])
    }
  })
})

describe('upgrading one family', () => {
  it('flips that family only', () => {
    const before = upgradeScene()
    const done = upgrade(before, 'up-1', LIBRARY)
    expect(piecesOf(done, UNIVERSITY)).toHaveLength(1)
    expect(piecesOf(done, GRANARY).map(keyOf)).toEqual(piecesOf(before, GRANARY).map(keyOf))
    expect(piecesOf(done, AQUEDUCT)).toEqual([])
    expect(lastLine(done)).toBe('cash1981 upgraded 1 Library to University at A3')
  })

  it('the other family can be flipped afterwards, with a new request id', () => {
    const first = upgrade(upgradeScene(), 'up-1', LIBRARY)
    const second = upgrade(first, 'up-2', GRANARY)
    expect(piecesOf(second, AQUEDUCT)).toHaveLength(3)
    expect(lastLine(second)).toBe('cash1981 upgraded 3 Granaries to Aqueducts at A1, C2 and C3')
  })

  it('a family whose tech is not revealed is refused, naming the building', () => {
    const state = upgradeScene(['Engineering'])
    expect(refusal(tryUpgrade(state, 'up-1', LIBRARY))).toBe(
      'You have not revealed the tech of the University, so the Library cannot be upgraded.',
    )
  })

  it('a family with no building in the player\'s cities is refused', () => {
    const state = upgradeScene(['Engineering', 'Banking'])
    expect(refusal(tryUpgrade(state, 'up-1', 'buildings/market'))).toBe('No Market of yours stands in the outskirts of your cities.')
  })

  it('an asset that has no upgraded form, an unknown asset and a family that is not text are refused', () => {
    const state = upgradeScene()
    expect(refusal(tryUpgrade(state, 'up-1', 'buildings/harbor'))).toBe('buildings/harbor is not a building that has an upgraded form.')
    expect(refusal(tryUpgrade(state, 'up-2', AQUEDUCT))).toBe('buildings/aqueduct is not a building that has an upgraded form.')
    expect(refusal(tryUpgrade(state, 'up-3', 'constructor'))).toBe('constructor is not a building that has an upgraded form.')
    const odd = performAssistedAction(state, {
      playerId: CASH1981,
      action: 'upgradeBuildings',
      requestId: 'up-4',
      payload: { family: 7 as unknown as string },
    })
    expect(refusal(odd)).toBe('family must be the asset id of a basic building.')
  })
})

describe('an upgrade that is not allowed', () => {
  it('without a revealed upgrade tech it says so', () => {
    expect(refusal(tryUpgrade(upgradeScene([])))).toBe('None of your revealed techs unlocks an upgraded building.')
  })

  it('with the tech but no basic building in a city it says so', () => {
    const state = ready('Engineering')
    expect(refusal(tryUpgrade(state))).toBe(
      'No basic building of yours stands in the outskirts of your cities with its upgrade unlocked.',
    )
  })

  it('an unrevealed tech unlocks nothing', () => {
    const hidden = unwrap(chooseTech(upgradeScene([]), { playerId: CASH1981, techName: 'Engineering' }))
    expect(unwrapErr(tryUpgrade(hidden)).kind).toBe('ASSISTED_ACTION_REJECTED')
    expect(piecesOf(hidden, AQUEDUCT)).toEqual([])
  })

  it('someone who is not in the game cannot upgrade', () => {
    expect(unwrapErr(tryUpgrade(upgradeScene(), 'up-1', undefined, 'spectator'))).toEqual({
      kind: 'NO_ACCESS',
      playerId: 'spectator',
    })
  })

  it('another player cannot upgrade Cash\'s buildings', () => {
    const state = upgradeScene()
    const blue = learnFor(state, KARANDRAS1, 'Engineering')
    const done = unwrap(tryUpgrade(blue, 'up-1', undefined, KARANDRAS1))
    // Karandras flips only what stands in the outskirts of his own city
    expect(piecesOf(done, AQUEDUCT).map((piece) => cellOf(done, piece))).toEqual([[7, 2]])
    expect(piecesOf(done, GRANARY)).toHaveLength(4)
  })

  it('every refusal leaves the game exactly as it was', () => {
    const state = upgradeScene(['Engineering'])
    const snapshot = JSON.stringify(state)
    tryUpgrade(state, 'up-1', LIBRARY)
    tryUpgrade(state, 'up-2', 'buildings/harbor')
    tryUpgrade(upgradeScene([]))
    expect(JSON.stringify(state)).toBe(snapshot)
  })

  it('a payload of another action is not a family, and means every family', () => {
    const state = upgradeScene(['Engineering'])
    const done = unwrap(
      performAssistedAction(state, {
        playerId: CASH1981,
        action: 'upgradeBuildings',
        requestId: 'up-1',
        at: AT,
        payload: { rewardId: 'x', itemId: 'y' },
      }),
    )
    expect(piecesOf(done, AQUEDUCT)).toHaveLength(3)
  })
})

describe('an upgrade and who the piece is attributed to', () => {
  // Combat bonus and building count read `placedBy`. A Barracks is worth 2 and an Academy 4,
  // and nobody else in the fixture has a combat bonus of their own.
  const figures = (state: GameState) => ({
    cashBonus: combatBonusOf(state, me(state)),
    karandrasBonus: combatBonusOf(state, me(state, KARANDRAS1)),
    cashBuildings: buildingCountOf(state, CASH1981),
    karandrasBuildings: buildingCountOf(state, KARANDRAS1),
  })

  it('upgrading a Barracks another player placed keeps its bonus and count with the placer', () => {
    // Karandras put a Barracks on B1, a square of Cash's outskirts
    const before = put(upgradeScene(['Military Science']), KARANDRAS1, BARRACKS, 1, 0)
    expect(figures(before)).toEqual({ cashBonus: 0, karandrasBonus: 2, cashBuildings: 4, karandrasBuildings: 3 })

    const done = upgrade(before, 'up-1', BARRACKS)
    const [academy] = piecesOf(done, ACADEMY)
    expect(piecesOf(done, BARRACKS)).toEqual([])
    expect(academy?.placedBy).toBe(KARANDRAS1)
    // Only the form changes, so the bonus is the Academy's under the original placer
    expect(figures(done)).toEqual({ cashBonus: 0, karandrasBonus: 4, cashBuildings: 4, karandrasBuildings: 3 })
    // The line and the board history still name the player who pressed the button
    expect(done.board.history.slice(before.board.history.length).map((entry) => entry.playerId)).toEqual([CASH1981, CASH1981])

    expect(figures(undoByVote(done, 'up-1'))).toEqual(figures(before))
  })

  it('upgrading a player\'s own Barracks changes only their own figures', () => {
    const before = put(upgradeScene(['Military Science']), CASH1981, BARRACKS, 1, 0)
    expect(figures(before)).toEqual({ cashBonus: 2, karandrasBonus: 0, cashBuildings: 5, karandrasBuildings: 2 })

    const done = upgrade(before, 'up-1', BARRACKS)
    expect(piecesOf(done, ACADEMY)[0]?.placedBy).toBe(CASH1981)
    expect(figures(done)).toEqual({ cashBonus: 4, karandrasBonus: 0, cashBuildings: 5, karandrasBuildings: 2 })

    const undone = undoByVote(done, 'up-1')
    expect(figures(undone)).toEqual(figures(before))
    expect(piecesOf(undone, BARRACKS).map((piece) => piece.placedBy)).toEqual([CASH1981])
  })

  it('a piece with no placer is still not attributed to anyone after the flip', () => {
    const base = put(upgradeScene(['Military Science']), CASH1981, BARRACKS, 1, 0)
    const unattributed: GameState = {
      ...base,
      board: {
        ...base.board,
        pieces: base.board.pieces.map((piece) => (piece.assetId === BARRACKS ? { ...piece, placedBy: null } : piece)),
      },
    }
    const done = upgrade(unattributed, 'up-1', BARRACKS)
    expect(piecesOf(done, ACADEMY).map((piece) => piece.placedBy)).toEqual([null])
  })
})

describe('the phase of an upgrade', () => {
  it('works with City Management closed, since the tech may be learned in Research', () => {
    const closed = learn(scene(), 'Engineering')
    const withPieces = put(put(closed, CASH1981, GRANARY, 0, 0), CASH1981, GRANARY, 2, 1)
    expect(upgradeOptionsOf(withPieces, me(withPieces))).toHaveLength(1)
    expect(piecesOf(upgrade(withPieces), AQUEDUCT)).toHaveLength(2)
  })

  it('works in the Research phase', () => {
    const state = upgradeScene(['Engineering'])
    const research = unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'MOVEMENT' }))
    expect(piecesOf(upgrade(research), AQUEDUCT)).toHaveLength(3)
    // The record names the phase the player was in, not City Management
    expect(upgrade(research).assistedActions[0]?.phase).toBe('RESEARCH')
  })
})

describe('the upgrade and the request id', () => {
  it('the same request id twice flips once and returns the same state', () => {
    const done = upgrade(upgradeScene())
    expect(unwrap(tryUpgrade(done))).toBe(done)
    expect(piecesOf(done, AQUEDUCT)).toHaveLength(3)
    expect(done.assistedActions).toHaveLength(1)
  })

  it('a stale second press with a new request id finds nothing to flip and is refused', () => {
    const done = upgrade(upgradeScene())
    expect(refusal(tryUpgrade(done, 'up-2'))).toBe(
      'No basic building of yours stands in the outskirts of your cities with its upgrade unlocked.',
    )
    expect(done.assistedActions).toHaveLength(1)
  })

  it('a stale press for one family, after it was flipped, is refused', () => {
    const done = upgrade(upgradeScene(), 'up-1', GRANARY)
    expect(refusal(tryUpgrade(done, 'up-2', GRANARY))).toBe('No Granary of yours stands in the outskirts of your cities.')
  })

  it('a stale press for a family whose building was removed in between is refused', () => {
    const state = upgradeScene()
    const library = piecesOf(state, LIBRARY)[0] as BoardPiece
    const gone = unwrap(removePiece(state, { playerId: CASH1981, pieceId: library.id }))
    expect(refusal(tryUpgrade(gone, 'up-1', LIBRARY))).toBe('No Library of yours stands in the outskirts of your cities.')
    // With nothing at all left to flip, the general reason is given
    const none = upgradeScene(['Printing Press'])
    const empty = unwrap(removePiece(none, { playerId: CASH1981, pieceId: (piecesOf(none, LIBRARY)[0] as BoardPiece).id }))
    expect(refusal(tryUpgrade(empty, 'up-1', LIBRARY))).toBe(
      'No basic building of yours stands in the outskirts of your cities with its upgrade unlocked.',
    )
  })
})

// ---------------------------------------------------------------------------
// Undoing an upgrade
// ---------------------------------------------------------------------------

describe('undoing an upgrade with the vote', () => {
  it('puts back the same basic pieces on their squares, and removes the upgraded ones', () => {
    const before = upgradeScene()
    const done = upgrade(before)
    const undone = undoByVote(done, 'up-1')

    expect(piecesOf(undone, AQUEDUCT)).toEqual([])
    expect(piecesOf(undone, UNIVERSITY)).toEqual([])
    expect([...undone.board.pieces].map(keyOf).sort()).toEqual([...before.board.pieces].map(keyOf).sort())
    expect(undone.assistedActions[0]?.status).toBe('undone')
    expect(lastLine(undone)).toBe(
      "System: cash1981's upgrade of 3 Granaries to Aqueducts at A1, C2 and C3; 1 Library to University at A3 was undone: the basic buildings were put back",
    )
    // The options are back, as before
    expect(upgradeOptionsOf(undone, me(undone))).toEqual(upgradeOptionsOf(before, me(before)))
  })

  it('does not change the supply count', () => {
    const before = upgradeScene()
    const granary = findBoardAsset(GRANARY)
    if (granary === undefined) throw new Error('missing asset')
    const undone = undoByVote(upgrade(before), 'up-1')
    expect(remainingBoardAssetCount(granary, undone.board.pieces, undone.numOfPlayers)).toBe(
      remainingBoardAssetCount(granary, before.board.pieces, before.numOfPlayers),
    )
  })

  it('counts the entries of the undo with the System line, in order, and replays to the same pieces', () => {
    const undone = undoByVote(upgrade(upgradeScene()), 'up-1')
    const lengths = undone.board.history.map((entry) => entry.logLength)
    expect(lengths).toEqual([...lengths].sort((a, b) => a - b))
    expect(undone.board.history.at(-1)?.logLength).toBe(undone.log.length)
    const replayed = piecesAtStep(undone.board.history, undone.board.history.length)
    expect([...replayed].map(keyOf).sort()).toEqual([...undone.board.pieces].map(keyOf).sort())
  })

  it('can be flipped again after the undo', () => {
    const undone = undoByVote(upgrade(upgradeScene()), 'up-1')
    expect(piecesOf(upgrade(undone, 'up-2'), AQUEDUCT)).toHaveLength(3)
  })

  it('cannot be undone twice', () => {
    const undone = undoByVote(upgrade(upgradeScene()), 'up-1')
    expect(unwrapErr(initiateUndo(undone, { logId: logIdOf(undone, 'up-1'), playerId: CASH1981 })).kind).toBe(
      'ASSISTED_ACTION_ALREADY_UNDONE',
    )
  })

  it('is refused when one upgraded piece has left its square, and nothing is changed', () => {
    const done = upgrade(upgradeScene())
    const last = piecesOf(done, AQUEDUCT).at(-1) as BoardPiece
    const moved = unwrap(
      movePiece(done, {
        playerId: CASH1981,
        pieceId: last.id,
        x: 3 * SQUARE_SIZE + 4,
        y: mapTop(done.board) + 3 * SQUARE_SIZE + 4,
      }),
    )
    const attempt = almostUndone(moved, 'up-1')
    const result = attempt.last()
    expect(unwrapErr(result)).toMatchObject({ kind: 'ASSISTED_UNDO_BLOCKED', logId: attempt.logId })
    expect(blockedReason(result)).toBe('The Aqueduct has left C3. Move it back first.')
    // All or nothing: the pieces that could have been put back were not
    expect(attempt.state.assistedActions[0]?.status).toBe('applied')
    expect(piecesOf(attempt.state, AQUEDUCT)).toHaveLength(3)
    expect(piecesOf(attempt.state, GRANARY)).toHaveLength(2)
  })

  it('is refused when one upgraded piece is gone', () => {
    const done = upgrade(upgradeScene())
    const first = piecesOf(done, UNIVERSITY)[0] as BoardPiece
    const gone = unwrap(removePiece(done, { playerId: CASH1981, pieceId: first.id }))
    const result = almostUndone(gone, 'up-1').last()
    expect(blockedReason(result)).toBe('The University on A3 is no longer on the board, so the upgrade cannot be undone.')
  })

  it('still works when a piece was nudged within its square', () => {
    const done = upgrade(upgradeScene())
    const piece = piecesOf(done, AQUEDUCT)[0] as BoardPiece
    const nudged = unwrap(movePiece(done, { playerId: CASH1981, pieceId: piece.id, x: piece.x + 5, y: piece.y - 5, snap: false }))
    expect(piecesOf(undoByVote(nudged, 'up-1'), AQUEDUCT)).toEqual([])
  })

  it('undoing one family leaves the other flipped', () => {
    const both = upgrade(upgrade(upgradeScene(), 'up-1', LIBRARY), 'up-2', GRANARY)
    const undone = undoByVote(both, 'up-1')
    expect(piecesOf(undone, LIBRARY)).toHaveLength(1)
    expect(piecesOf(undone, UNIVERSITY)).toEqual([])
    expect(piecesOf(undone, AQUEDUCT)).toHaveLength(3)
  })
})

describe('the upgrade and an assisted build of the same piece', () => {
  it('the build cannot be undone while its building stands flipped, and can after the upgrade is undone', () => {
    // Pottery builds a Granary on C2 (grassland); Engineering, learned afterwards, flips it
    const built = build(ready('Pottery'), GRANARY, C2, 'build-1')
    const flipped = upgrade(learn(built, 'Engineering'), 'up-1')
    expect(piecesOf(flipped, AQUEDUCT)).toHaveLength(1)

    const refusedBuildUndo = almostUndone(flipped, 'build-1').last()
    expect(blockedReason(refusedBuildUndo)).toBe('The Granary is no longer on the board, so the build cannot be undone.')

    const upgradeUndone = undoByVote(flipped, 'up-1')
    const buildUndone = undoByVote(upgradeUndone, 'build-1')
    expect(piecesOf(buildUndone, GRANARY)).toEqual([])
    expect(piecesOf(buildUndone, AQUEDUCT)).toEqual([])
  })
})

describe('the board Undo and an upgrade', () => {
  it('refuses every entry the upgrade wrote, whichever is last', () => {
    const before = upgradeScene()
    const done = upgrade(before)
    const entries = done.board.history.slice(before.board.history.length)
    expect(entries).toHaveLength(8)
    for (const entry of entries) {
      const index = done.board.history.findIndex((candidate) => candidate.id === entry.id)
      const cut: GameState = { ...done, board: { ...done.board, history: done.board.history.slice(0, index + 1) } }
      expect(unwrapErr(undoLastBoardChange(cut, CASH1981))).toEqual({ kind: 'BOARD_UNDO_ASSISTED' })
    }
    const snapshot = JSON.stringify(done)
    expect(unwrapErr(undoLastBoardChange(done, CASH1981))).toEqual({ kind: 'BOARD_UNDO_ASSISTED' })
    expect(JSON.stringify(done)).toBe(snapshot)
  })

  it('does not refuse the entries before the upgrade', () => {
    // The last piece put down is Cash's own, so the board Undo is hers to take
    const before = put(upgradeScene(), CASH1981, GRANARY, 5, 5)
    const done = upgrade(before)
    const cut: GameState = { ...done, board: { ...done.board, history: before.board.history } }
    expect(unwrap(undoLastBoardChange(cut, CASH1981)).board.history).toHaveLength(before.board.history.length - 1)
  })

  it('works on an ordinary change again once the upgrade is undone', () => {
    const undone = undoByVote(upgrade(upgradeScene()), 'up-1')
    expect(unwrap(undoLastBoardChange(undone, CASH1981)).board.history).toHaveLength(undone.board.history.length - 1)
  })
})

describe('both actions are not buttons', () => {
  it('neither is listed among the available actions, and both are registered', async () => {
    const { ASSISTED_ACTION_KINDS, isAssistedActionKind } = await import('../src/assisted.js')
    expect(ASSISTED_ACTION_KINDS).not.toContain('startBuildingProgram')
    expect(ASSISTED_ACTION_KINDS).not.toContain('upgradeBuildings')
    expect(isAssistedActionKind('startBuildingProgram')).toBe(true)
    expect(isAssistedActionKind('upgradeBuildings')).toBe(true)
  })
})
