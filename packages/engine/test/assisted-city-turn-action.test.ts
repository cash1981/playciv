/**
 * One action per city per turn (base rules p. 15, the FAQ): a city builds, devotes itself to the
 * arts or harvests a resource, and a Building Program is started as the city's action. The game
 * does not forbid a second action; it asks first. The engine refuses an unconfirmed second action
 * of the same city with status `used`, the projection lists what the city has done
 * (`actedThisTurn`) so the client can ask before sending, and a confirmed one says so in the log.
 *
 * The scene is the one of `assisted-gather.test.ts`: America in the first map slot and a red city
 * on B2, with iron on A1 and incense on C3 in its outskirts.
 */

import { describe, expect, it } from 'vitest'

import { placePiece } from '../src/actions/board.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { cityActionsTakenThisTurn, performAssistedAction } from '../src/assisted.js'
import type { AssistedPayload } from '../src/assisted.js'
import { SQUARE_SIZE, findBoardAsset, mapTop, slotOrigin } from '../src/board.js'
import type { BoardPiece } from '../src/board.js'
import { cityActionsOf } from '../src/city-actions.js'
import { describeError } from '../src/errors.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { GameState, Playerhand } from '../src/state.js'

import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-10-10T10:00:00.000Z'

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

/** America and a red city on B2, City Management open; Writing is not needed for a Library on C2 with production left. */
function scene(): GameState {
  const colors: Record<string, string> = { [CASH1981]: 'Red', [KARANDRAS1]: 'Blue', [ITCHI]: 'Green', [CHUL]: 'Yellow' }
  const base = firstCivGame()
  let state: GameState = {
    ...base,
    players: base.players.map((p) => ({ ...p, color: colors[p.playerId] ?? p.color, government: p.playerId === CASH1981 ? 'Monarchy' : p.government })),
  }
  const slot = state.board.slots[0]
  if (slot === undefined) throw new Error('no slot')
  const [x, y] = slotOrigin(state.board, slot)
  state = unwrap(placePiece(state, { playerId: CASH1981, assetId: 'tiles/america', x, y }))
  state = put(state, 'cities/redcity2', 1, 1)
  return unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))
}

const me = (state: GameState): Playerhand => {
  const found = findPlayer(state, CASH1981)
  if (found === undefined) throw new Error('no Cash')
  return found
}
const cityId = (state: GameState): string => (state.board.pieces.find((piece) => piece.category === 'city') as BoardPiece).id

type Kind = 'devoteToTheArts' | 'harvest' | 'startBuildingProgram' | 'build'

function act(state: GameState, kind: Kind, requestId: string, confirmed = false, city = cityId(state)) {
  const payloads: Record<Kind, AssistedPayload> = {
    devoteToTheArts: { cityPieceId: city },
    harvest: { cityPieceId: city, resource: 'iron' },
    startBuildingProgram: { cityPieceId: city },
    build: { cityPieceId: city, item: { kind: 'army' }, target: { column: 2, row: 1 } },
  }
  return performAssistedAction(state, {
    playerId: CASH1981,
    action: kind,
    requestId,
    at: AT,
    payload: payloads[kind],
    ...(confirmed ? { confirmedRepeat: true } : {}),
  })
}

const lastLine = (state: GameState): string => state.log.at(-1)?.publicLog ?? ''

describe('what a city has done this turn', () => {
  it('nothing at first, then each action in the order it was taken, for that city only', () => {
    let state = scene()
    expect(cityActionsTakenThisTurn(state, me(state), cityId(state))).toEqual([])
    state = unwrap(act(state, 'devoteToTheArts', 'a-1'))
    state = unwrap(act(state, 'harvest', 'a-2', true))
    expect(cityActionsTakenThisTurn(state, me(state), cityId(state))).toEqual(['Devote to the Arts', 'Harvest'])
    expect(cityActionsTakenThisTurn(state, me(state), 'another-city')).toEqual([])
    expect(cityActionsOf(state, me(state))[0]?.actedThisTurn).toEqual(['Devote to the Arts', 'Harvest'])
  })

  it('is in the viewer\'s own projection only', () => {
    const state = unwrap(act(scene(), 'harvest', 'a-1'))
    expect(toPlayerView(state, CASH1981).you?.cityActions?.[0]?.actedThisTurn).toEqual(['Harvest'])
    expect(JSON.stringify(toPlayerView(state, KARANDRAS1).opponents)).not.toContain('actedThisTurn')
  })

  it('does not count an action that was undone, or one of an earlier turn', () => {
    const done = unwrap(act(scene(), 'harvest', 'a-1'))
    const entry = done.log.find((candidate) => candidate.assistedActionId === 'a-1')
    if (entry === undefined) throw new Error('no line')
    let undone = unwrap(initiateUndo(done, { logId: entry.id, playerId: CASH1981 }))
    for (const playerId of [KARANDRAS1, ITCHI, CHUL]) undone = unwrap(vote(undone, { logId: entry.id, playerId, vote: true, at: AT }))
    expect(cityActionsTakenThisTurn(undone, me(undone), cityId(undone))).toEqual([])
    expect(unwrap(act(undone, 'devoteToTheArts', 'a-2')).assistedActions).toHaveLength(2)

    const older: GameState = { ...done, assistedActions: done.assistedActions.map((record) => ({ ...record, turnNumber: 0 })) }
    expect(cityActionsTakenThisTurn(older, me(older), cityId(older))).toEqual([])
  })
})

describe('a second action of the same city', () => {
  const pairs: readonly (readonly [Kind, Kind])[] = [
    ['devoteToTheArts', 'harvest'],
    ['harvest', 'devoteToTheArts'],
    ['startBuildingProgram', 'devoteToTheArts'],
    ['devoteToTheArts', 'startBuildingProgram'],
    ['harvest', 'build'],
    ['build', 'harvest'],
  ]

  it.each(pairs)('%s and then %s is refused as used until the player confirms', (first, second) => {
    const done = unwrap(act(scene(), first, 'a-1'))
    const refused = act(done, second, 'a-2')
    const error = unwrapErr(refused)
    expect(error).toMatchObject({ kind: 'ASSISTED_ACTION_REJECTED', status: 'used' })
    expect(describeError(error)).toContain('City B2 has already acted this turn')
    // Nothing changed: the refusal is an error and the state it was asked about still has one record and one line
    expect(refused.ok).toBe(false)
    expect(done.assistedActions).toHaveLength(1)

    const confirmed = unwrap(act(done, second, 'a-2', true))
    expect(confirmed.assistedActions).toHaveLength(2)
    expect(lastLine(confirmed)).toContain('(a second action of this city this turn, confirmed by the player)')
    // The first action's line says nothing of the kind
    expect(confirmed.log.find((entry) => entry.assistedActionId === 'a-1')?.publicLog).not.toContain('second action')
  })

  it('names what the city has done in the refusal', () => {
    let state = unwrap(act(scene(), 'devoteToTheArts', 'a-1'))
    state = unwrap(act(state, 'harvest', 'a-2', true))
    expect(describeError(unwrapErr(act(state, 'startBuildingProgram', 'a-3')))).toContain('(Devote to the Arts, Harvest)')
  })

  it('is no question for another city of the player', () => {
    let state = put(scene(), 'cities/redcity2', 5, 5)
    const [first, second] = state.board.pieces.filter((piece) => piece.category === 'city')
    state = unwrap(act(state, 'devoteToTheArts', 'a-1', false, (first as BoardPiece).id))
    const next = unwrap(act(state, 'devoteToTheArts', 'a-2', false, (second as BoardPiece).id))
    expect(lastLine(next)).not.toContain('second action')
  })

  it('a confirmation with no earlier action is harmless and leaves no note', () => {
    expect(lastLine(unwrap(act(scene(), 'devoteToTheArts', 'a-1', true)))).not.toContain('second action')
  })

  it('a build that cannot be made is refused for that reason, before the question', () => {
    const done = unwrap(act(scene(), 'harvest', 'a-1'))
    const impossible = performAssistedAction(done, {
      playerId: CASH1981,
      action: 'build',
      requestId: 'a-2',
      at: AT,
      payload: { cityPieceId: cityId(done), item: { kind: 'army' }, target: { column: 9, row: 9 } },
    })
    const error = unwrapErr(impossible)
    expect(error).toMatchObject({ kind: 'ASSISTED_ACTION_REJECTED', status: 'unavailable' })
  })

  it('every other refusal comes before the question, in all four actions', () => {
    const done = unwrap(act(scene(), 'devoteToTheArts', 'a-1'))
    const city = cityId(done)
    const run = (action: Kind, payload: AssistedPayload) =>
      describeError(unwrapErr(performAssistedAction(done, { playerId: CASH1981, action, requestId: 'a-2', at: AT, payload })))
    // Harvest: a resource the city has no icon for, then one the market is out of
    expect(run('harvest', { cityPieceId: city, resource: 'wheat' })).toContain('has no wheat icon')
    expect(run('harvest', { cityPieceId: city, resource: 'gold' })).toContain('resource must be one of')
    // Devote: a typed number out of range and an unknown scout
    expect(run('devoteToTheArts', { cityPieceId: city, culture: 500 })).toContain('culture must be a whole number')
    expect(run('devoteToTheArts', { cityPieceId: city, scoutPieceIds: ['nope'] })).toContain('A scout is not yours')
    // Start Building Program: a marker already there
    const marked = unwrap(act(scene(), 'startBuildingProgram', 'm-1'))
    const again = performAssistedAction(marked, {
      playerId: CASH1981,
      action: 'startBuildingProgram',
      requestId: 'm-2',
      at: AT,
      payload: { cityPieceId: cityId(marked) },
    })
    expect(describeError(unwrapErr(again))).toContain('already has a Building Program marker')
    // Build: no such square (asserted above for the first action; here a unit with a target)
    expect(run('build', { cityPieceId: city, item: { kind: 'unit', unitType: 'infantry' }, target: { column: 2, row: 1 } } as AssistedPayload)).toContain('is a card and has no square')
  })

  it('upgrading buildings is not a city action and never asks', () => {
    const done = unwrap(act(scene(), 'harvest', 'a-1'))
    // No tech unlocks an upgrade here; the refusal is about that and not about the city
    const result = performAssistedAction(done, { playerId: CASH1981, action: 'upgradeBuildings', requestId: 'a-2', at: AT })
    expect(describeError(unwrapErr(result))).not.toContain('already acted')
  })
})
