/**
 * Military Tradition (issue #311): once per turn, a free unit of the player's choice
 * after an army figure is built. The scene is `assisted-units.test.ts`'s: Cash is Red
 * on Monarchy with a city on B2 of the America tile, whose C2 is grassland.
 */

import { describe, expect, it } from 'vitest'

import { placePiece, setCityProductionOverride } from '../src/actions/board.js'
import { chooseSocialPolicy, chooseTech, revealSocialPolicy, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { assistedAvailability, performAssistedAction, takeBackOpenBuild } from '../src/assisted.js'
import { SQUARE_SIZE, findBoardAsset, mapTop, slotOrigin } from '../src/board.js'
import type { BoardPiece } from '../src/board.js'
import type { UnitType } from '../src/build-item.js'
import { describeError } from '../src/errors.js'
import { itemName } from '../src/item.js'
import type { Item } from '../src/item.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { GameState, Playerhand } from '../src/state.js'

import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-10-09T10:00:00.000Z'
const OTHERS = [KARANDRAS1, ITCHI, CHUL]
const C2 = { column: 2, row: 1 }
const POLICY = 'Military Tradition'

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

const me = (state: GameState): Playerhand => {
  const found = findPlayer(state, CASH1981)
  if (found === undefined) throw new Error('no player')
  return found
}

const cityOf = (state: GameState): BoardPiece => {
  const city = state.board.pieces.find((piece) => piece.category === 'city')
  if (city === undefined) throw new Error('no city')
  return city
}

/** Red Cash with a city on B2, City Management open and a production of 20; the policy adopted (and revealed unless told otherwise) and the techs revealed. */
function ready(options: { policy?: 'revealed' | 'hidden' | 'none'; techs?: readonly string[] } = {}): GameState {
  const base = firstCivGame()
  let state: GameState = {
    ...base,
    players: base.players.map((p) => ({
      ...p,
      color: ({ [CASH1981]: 'Red', [KARANDRAS1]: 'Blue', [ITCHI]: 'Green', [CHUL]: 'Yellow' } as Record<string, string>)[p.playerId] ?? p.color,
      government: p.playerId === CASH1981 ? 'Monarchy' : p.government,
    })),
  }
  const slot = state.board.slots[0]
  if (slot === undefined) throw new Error('no slot')
  const [x, y] = slotOrigin(state.board, slot)
  state = unwrap(placePiece(state, { playerId: CASH1981, assetId: 'tiles/america', x, y }))
  state = put(state, 'cities/redcity2', 1, 1)
  for (const techName of options.techs ?? []) {
    state = unwrap(revealTech(unwrap(chooseTech(state, { playerId: CASH1981, techName })), { playerId: CASH1981, techName }))
  }
  const policy = options.policy ?? 'revealed'
  if (policy !== 'none') {
    state = unwrap(chooseSocialPolicy(state, { playerId: CASH1981, name: POLICY }))
    if (policy === 'revealed') state = unwrap(revealSocialPolicy(state, { playerId: CASH1981, name: POLICY }))
  }
  state = unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))
  return unwrap(setCityProductionOverride(state, { playerId: CASH1981, pieceId: cityOf(state).id, value: 20 }))
}

const buildArmy = (state: GameState, requestId = 'army-1'): GameState =>
  unwrap(
    performAssistedAction(state, {
      playerId: CASH1981,
      action: 'build',
      requestId,
      at: AT,
      payload: { cityPieceId: cityOf(state).id, item: { kind: 'army' }, target: C2 },
    }),
  )

const tryFree = (state: GameState, unitType: UnitType, requestId = 'free-1') =>
  performAssistedAction(state, { playerId: CASH1981, action: `militaryTradition:${unitType}`, requestId, at: AT })

const free = (state: GameState, unitType: UnitType, requestId = 'free-1'): GameState => unwrap(tryFree(state, unitType, requestId))

const reasonOf = (state: GameState, unitType: UnitType): string => assistedAvailability(state, CASH1981, `militaryTradition:${unitType}`).reason

function undoByVote(state: GameState, requestId: string): GameState {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no line')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of OTHERS) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  return next
}

const unitsOf = (state: GameState, sheetName: string): readonly Item[] => me(state).items.filter((item) => item.sheetName === sheetName)

describe('when Military Tradition gives a free unit', () => {
  it('only after an army figure was built with Build this turn', () => {
    const state = ready()
    expect(assistedAvailability(state, CASH1981, 'militaryTradition:infantry')).toEqual({
      status: 'unavailable',
      reason: 'Build an army figure with Build this turn first.',
    })
    expect(assistedAvailability(buildArmy(state), CASH1981, 'militaryTradition:infantry').status).toBe('ready')
  })

  it('not for an army build that was undone, nor for an army put on the map by hand', () => {
    const undone = undoByVote(buildArmy(ready()), 'army-1')
    expect(reasonOf(undone, 'infantry')).toBe('Build an army figure with Build this turn first.')
    const byHand = put(ready(), 'figures/redarmy', 2, 1)
    expect(reasonOf(byHand, 'infantry')).toBe('Build an army figure with Build this turn first.')
  })

  it('only with the policy adopted and revealed', () => {
    expect(reasonOf(buildArmy(ready({ policy: 'none' })), 'infantry')).toBe('You have not adopted Military Tradition.')
    expect(reasonOf(buildArmy(ready({ policy: 'hidden' })), 'infantry')).toBe('Reveal Military Tradition before using it.')
  })

  it('aircraft only with a revealed Flight', () => {
    const built = buildArmy(ready())
    expect(assistedAvailability(built, CASH1981, 'militaryTradition:aircraft')).toMatchObject({ status: 'not-owned' })
    expect(reasonOf(built, 'aircraft')).toContain('Aircraft units need Flight.')
    expect(assistedAvailability(buildArmy(ready({ techs: ['Flight'] })), CASH1981, 'militaryTradition:aircraft').status).toBe('ready')
  })

  it('once per turn, whichever type was chosen', () => {
    const done = free(buildArmy(ready()), 'mounted')
    for (const unitType of ['infantry', 'artillery', 'mounted'] as const) {
      expect(assistedAvailability(done, CASH1981, `militaryTradition:${unitType}`)).toEqual({
        status: 'used',
        reason: 'Military Tradition has already given a free unit this turn.',
      })
    }
    expect(describeError(unwrapErr(tryFree(done, 'infantry', 'free-2')))).toContain('already given a free unit this turn')
    // Without Flight the aircraft button stays out of the list, not shown as used
    expect(assistedAvailability(done, CASH1981, 'militaryTradition:aircraft').status).toBe('not-owned')
  })
})

describe('the free unit', () => {
  it('is a card of the chosen type in the hand, for nothing', () => {
    const built = buildArmy(ready())
    const done = free(built, 'artillery')
    expect(unitsOf(done, 'ARTILLERY')).toHaveLength(unitsOf(built, 'ARTILLERY').length + 1)
    expect(me(done).stats.trade).toBe(me(built).stats.trade)
    const line = done.log.find((entry) => entry.assistedActionId === 'free-1')
    expect(line?.publicLog).toBe('cash1981 used Military Tradition and drew a free artillery unit')
  })

  it('names the card in a private line only, and no other viewer sees it', () => {
    const built = buildArmy(ready())
    const done = free(built, 'infantry')
    const card = unitsOf(done, 'INFANTRY').find((item) => !unitsOf(built, 'INFANTRY').some((before) => before.id === item.id))
    if (card === undefined) throw new Error('no card drawn')
    expect(done.log.at(-1)?.privateLog).toBe(`cash1981 drew ${itemName(card)} (Infantry) with Military Tradition`)
    const secret = [`${itemName(card)} (Infantry)`, `drew ${itemName(card)}`]
    for (const viewerId of [KARANDRAS1, ITCHI, CHUL, 'spectator']) {
      const json = JSON.stringify(toPlayerView(done, viewerId))
      for (const text of secret) expect(json, `${viewerId} must not see ${text}`).not.toContain(text)
    }
    expect(JSON.stringify(toPlayerView(done, KARANDRAS1).assistedActions)).not.toContain('"card"')
  })

  it('is undone by the vote: the card goes back in its deck and the button is free again', () => {
    const built = buildArmy(ready())
    const done = free(built, 'mounted')
    const undone = undoByVote(done, 'free-1')
    expect(unitsOf(undone, 'MOUNTED')).toHaveLength(unitsOf(built, 'MOUNTED').length)
    expect(undone.items.filter((item) => item.sheetName === 'MOUNTED')).toHaveLength(built.items.filter((item) => item.sheetName === 'MOUNTED').length)
    expect(assistedAvailability(undone, CASH1981, 'militaryTradition:infantry').status).toBe('ready')
  })

  it('holds the army build: its undo waits for the free unit\'s, and removing the army is a plain removal', () => {
    const done = free(buildArmy(ready()), 'infantry')
    const entry = done.log.find((candidate) => candidate.assistedActionId === 'army-1')
    if (entry === undefined) throw new Error('no line')
    let next = unwrap(initiateUndo(done, { logId: entry.id, playerId: CASH1981 }))
    for (const playerId of [KARANDRAS1, ITCHI]) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
    const refused = unwrapErr(vote(next, { logId: entry.id, playerId: CHUL, vote: true, at: AT }))
    expect(refused.kind === 'ASSISTED_UNDO_BLOCKED' && refused.reason).toBe(
      'Military Tradition gave a free unit for this army. Undo the free unit first.',
    )
    const army = done.board.pieces.find((piece) => piece.category === 'figure' && piece.assetId === 'figures/redarmy')
    if (army === undefined) throw new Error('no army')
    // Without the free unit the same removal takes the build back
    const control = takeBackOpenBuild(buildArmy(ready()), { playerId: CASH1981, pieceId: army.id, at: AT })
    expect(control?.ok).toBe(true)
    expect(takeBackOpenBuild(done, { playerId: CASH1981, pieceId: army.id, at: AT })).toBeUndefined()
    expect(unitsOf(done, 'INFANTRY').length).toBeGreaterThan(0)
    // After the free unit's undo the army build can be undone
    const both = undoByVote(undoByVote(done, 'free-1'), 'army-1')
    expect(both.board.pieces.some((piece) => piece.assetId === 'figures/redarmy')).toBe(false)
  })

  it('cannot be undone once its card has left the hand', () => {
    const built = buildArmy(ready())
    const done = free(built, 'artillery')
    const card = unitsOf(done, 'ARTILLERY').find((item) => !unitsOf(built, 'ARTILLERY').some((before) => before.id === item.id))
    if (card === undefined) throw new Error('no card drawn')
    const gone: GameState = {
      ...done,
      players: done.players.map((p) => (p.playerId === CASH1981 ? { ...p, items: p.items.filter((item) => item.id !== card.id) } : p)),
    }
    const entry = gone.log.find((candidate) => candidate.assistedActionId === 'free-1')
    if (entry === undefined) throw new Error('no line')
    let next = unwrap(initiateUndo(gone, { logId: entry.id, playerId: CASH1981 }))
    for (const playerId of [KARANDRAS1, ITCHI]) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
    const refused = unwrapErr(vote(next, { logId: entry.id, playerId: CHUL, vote: true, at: AT }))
    expect(refused.kind === 'ASSISTED_UNDO_BLOCKED' && refused.reason).toBe(
      'The free artillery unit card is no longer in your hand, so it cannot be undone.',
    )
  })

  it('with two armies built this turn, either army build can still be undone', () => {
    let state = put(ready(), 'cities/redcity2', 3, 3)
    state = unwrap(setCityProductionOverride(state, { playerId: CASH1981, pieceId: (state.board.pieces.filter((piece) => piece.category === 'city')[1] as BoardPiece).id, value: 20 }))
    state = buildArmy(state)
    const second = state.board.pieces.filter((piece) => piece.category === 'city')[1] as BoardPiece
    state = unwrap(
      performAssistedAction(state, {
        playerId: CASH1981,
        action: 'build',
        requestId: 'army-2',
        at: AT,
        payload: { cityPieceId: second.id, item: { kind: 'army' }, target: { column: 3, row: 2 } },
      }),
    )
    const done = free(state, 'infantry')
    const undone = undoByVote(done, 'army-1')
    expect(undone.assistedActions.find((record) => record.id === 'army-1')?.status).toBe('undone')
    // The second army now carries the free unit alone
    const entry = undone.log.find((candidate) => candidate.assistedActionId === 'army-2')
    if (entry === undefined) throw new Error('no line')
    let next = unwrap(initiateUndo(undone, { logId: entry.id, playerId: CASH1981 }))
    for (const playerId of [KARANDRAS1, ITCHI]) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
    expect(unwrapErr(vote(next, { logId: entry.id, playerId: CHUL, vote: true, at: AT })).kind).toBe('ASSISTED_UNDO_BLOCKED')
  })
})
