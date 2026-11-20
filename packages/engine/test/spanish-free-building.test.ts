/**
 * The Spanish civilization ability: "When they discover an unexplored map tile, may immediately build a basic
 * (non-upgraded) building in any city for free, even if not unlocked." Each test names the rule it covers.
 *
 * The scene: Spain (red), an explored tile on A1 to D4 with a red capital on B2, a red army on D2 and a red
 * scout on D3, both next to the fog of E.
 */

import { describe, expect, it } from 'vitest'

import { placePiece, undoLastBoardChange } from '../src/actions/board.js'
import { exploreSquare } from '../src/actions/explore.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { assistedAvailability, performAssistedAction } from '../src/assisted.js'
import { SQUARE_SIZE, findBoardAsset, mapTop } from '../src/board.js'
import { basicBuildingChoicesOf } from '../src/build-options.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { GameState, Playerhand } from '../src/state.js'

import { withCivilization } from './culture-advance-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-11-20T10:00:00.000Z'

function put(state: GameState, assetId: string, column: number, row: number): GameState {
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`no asset ${assetId}`)
  return unwrap(
    placePiece(state, {
      playerId: CASH1981,
      assetId,
      x: Math.round(column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2),
      y: Math.round(mapTop(state.board) + row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2),
    }),
  )
}

function scene(civ = 'Spanish'): GameState {
  const base = withCivilization(firstCivGame(), civ)
  const colours = ['Red', 'Blue', 'Green', 'Purple']
  let state: GameState = {
    ...base,
    players: base.players.map((player, index) => ({
      ...player,
      color: colours[index] ?? 'Yellow',
      stats: { ...player.stats, mvmt: '3', stacking: 2 },
    })),
  }
  state = unwrap(placePiece(state, { playerId: CASH1981, assetId: 'tiles/tile05', x: 0, y: mapTop(state.board) }))
  state = put(state, 'cities/redcapital2', 1, 1)
  state = put(state, 'figures/redarmy', 3, 1)
  return put(state, 'figures/redscout', 3, 3)
}

const me = (state: GameState): Playerhand => {
  const found = findPlayer(state, CASH1981)
  if (found === undefined) throw new Error('no player')
  return found
}

const figure = (state: GameState, assetId: string) => {
  const found = state.board.pieces.find((piece) => piece.assetId === assetId)
  if (found === undefined) throw new Error(`no ${assetId}`)
  return found
}

const explore = (state: GameState, assetId = 'figures/redarmy', column = assetId === 'figures/redarmy' ? 4 : 3, row = assetId === 'figures/redarmy' ? 1 : 4) =>
  exploreSquare(state, { playerId: CASH1981, pieceId: figure(state, assetId).id, column, row, at: AT })

const credits = (state: GameState): number =>
  (state.spanishFreeBuildings ?? []).length - state.assistedActions.filter((r) => r.status === 'applied' && r.kind === 'spanishBuild').length

const status = (state: GameState) => assistedAvailability(state, CASH1981, 'spanishBuild')

function squareOf(state: GameState, assetId: string, index = 0) {
  const square = basicBuildingChoicesOf(state, me(state)).find((choice) => choice.assetId === assetId)?.squares[index]
  if (square === undefined) throw new Error(`no square for ${assetId}`)
  return { cityPieceId: square.cityPieceId, assetId, column: square.column, row: square.row }
}

const build = (state: GameState, payload: Record<string, unknown>, requestId = 'sp-1') =>
  performAssistedAction(state, { playerId: CASH1981, action: 'spanishBuild', requestId, at: AT, payload: payload as never })

function undoByVote(state: GameState, requestId: string): GameState {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line for the action')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of [KARANDRAS1, ITCHI, CHUL]) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  return next
}

const buildingsOf = (state: GameState, assetId: string) => state.board.pieces.filter((piece) => piece.assetId === assetId)

/** The state after the army explored E2, and the explorer owes one building. */
const explored = (): GameState => unwrap(explore(scene()))

describe('the credit for a tile', () => {
  it('is one free building for a Spanish army that explores, said in a public line without numbers and a private line with them', () => {
    const state = explored()
    expect(credits(state)).toBe(1)
    const line = state.log.find((entry) => entry.publicLog.includes('free basic building'))
    expect(line?.publicLog).toBe('cash1981 may build a free basic building for discovering E2 as the Spanish')
    expect(line?.publicLog).not.toMatch(/\d+ free/)
    expect(line?.privateLog).toBe('cash1981 gained 1 free building as the Spanish, 1 free buildings left')
  })

  it('is one for a Spanish scout that explores', () => {
    expect(credits(unwrap(explore(scene(), 'figures/redscout')))).toBe(1)
  })

  it('is one per tile explored: two explorations are two credits, with the new total in the private line', () => {
    const first = explored()
    const second = unwrap(explore(first, 'figures/redscout'))
    expect(credits(second)).toBe(2)
    expect(second.log.some((entry) => entry.privateLog === 'cash1981 gained 1 free building as the Spanish, 2 free buildings left')).toBe(true)
  })

  it('is none for another civilization', () => {
    const state = unwrap(explore(scene('Americans')))
    expect(credits(state)).toBe(0)
    expect(state.spanishFreeBuildings ?? []).toHaveLength(0)
    expect(status(state).status).toBe('not-owned')
  })

  it('is none when the exploration fails, and the state is untouched', () => {
    const state = scene()
    const refused = explore(state, 'figures/redarmy', 6, 1)
    expect(refused.ok).toBe(false)
    expect(state.spanishFreeBuildings).toBeUndefined()
  })
})

describe('the choices', () => {
  it('offer a building that is not unlocked, and no upgraded form', () => {
    const choices = basicBuildingChoicesOf(explored(), me(explored())).map((choice) => choice.assetId)
    // No tech is revealed in the scene
    for (const basic of ['buildings/library', 'buildings/granary', 'buildings/market', 'buildings/temple', 'buildings/barracks']) {
      expect(choices).toContain(basic)
    }
    for (const upgraded of ['buildings/university', 'buildings/aqueduct', 'buildings/bank', 'buildings/cathedral', 'buildings/academy', 'buildings/ironmine', 'buildings/militarydock']) {
      expect(choices).not.toContain(upgraded)
    }
  })

  it('keep a basic building offered although its upgrade is unlocked', () => {
    const state = explored()
    const withUpgrade = {
      ...state,
      players: state.players.map((player) =>
        player.playerId === CASH1981
          ? { ...player, techsChosen: [{ name: 'Education', hidden: false } as never], }
          : player,
      ),
    }
    expect(basicBuildingChoicesOf(withUpgrade, me(withUpgrade)).map((choice) => choice.assetId)).toContain('buildings/library')
  })

  it('apply the star limit: a second limited building stands only on the first one and replaces it', () => {
    const state = unwrap(build(explored(), squareOf(explored(), 'buildings/temple')))
    const again = {
      ...state,
      spanishFreeBuildings: [...(state.spanishFreeBuildings ?? []), { playerId: CASH1981, historyId: 'extra' }],
    }
    const market = basicBuildingChoicesOf(again, me(again)).find((choice) => choice.assetId === 'buildings/market')
    expect(market?.squares).toHaveLength(1)
    expect(market?.squares[0]?.replaces).toMatchObject({ assetId: 'buildings/temple' })
    // A building that is not limited is not held to that square
    const library = basicBuildingChoicesOf(again, me(again)).find((choice) => choice.assetId === 'buildings/library')
    expect((library?.squares.length ?? 0) > 1).toBe(true)
  })
})

describe('building it', () => {
  it('puts the building on the square, spends the credit, and logs the building and city publicly and the count privately', () => {
    const state = explored()
    const built = unwrap(build(state, squareOf(state, 'buildings/library')))
    expect(buildingsOf(built, 'buildings/library')).toHaveLength(1)
    expect(credits(built)).toBe(0)
    const line = built.log.find((entry) => entry.assistedActionId === 'sp-1')
    expect(line?.publicLog).toMatch(/^cash1981 built a Library on [A-Z]\d+ for free as the Spanish$/)
    expect(built.log.some((entry) => entry.privateLog === 'cash1981 used 1 free building as the Spanish, 0 free buildings left')).toBe(true)
    // Nothing was paid or counted as a city action
    expect(me(built).stats).toEqual(me(state).stats)
  })

  it('is refused without a credit, for a building that is not basic, and on a square outside the choices', () => {
    const state = explored()
    expect(JSON.stringify(unwrapErr(build(scene(), squareOf(state, 'buildings/library'))))).toContain('no free building left')
    const library = squareOf(state, 'buildings/library')
    expect(JSON.stringify(unwrapErr(build(state, { ...library, assetId: 'buildings/university' })))).toBeTruthy()
    expect(build(state, { ...library, column: 9, row: 9 }).ok).toBe(false)
    expect(build(state, { cityPieceId: 'x', assetId: 'buildings/library', column: 2, row: 1 }).ok).toBe(false)
  })

  it('is undone by the vote: the building is off and the credit is back', () => {
    const state = explored()
    const built = unwrap(build(state, squareOf(state, 'buildings/library')))
    const undone = undoByVote(built, 'sp-1')
    expect(buildingsOf(undone, 'buildings/library')).toHaveLength(0)
    expect(credits(undone)).toBe(1)
    expect(status(undone).status).toBe('ready')
  })

  it('puts back the building it replaced when undone', () => {
    const first = unwrap(build(explored(), squareOf(explored(), 'buildings/temple')))
    const two = unwrap(explore(first, 'figures/redscout'))
    const replacing = unwrap(build(two, squareOf(two, 'buildings/market'), 'sp-2'))
    expect(buildingsOf(replacing, 'buildings/temple')).toHaveLength(0)
    const undone = undoByVote(replacing, 'sp-2')
    expect(buildingsOf(undone, 'buildings/temple')).toHaveLength(1)
    expect(buildingsOf(undone, 'buildings/market')).toHaveLength(0)
    expect(credits(undone)).toBe(1)
  })

  it('is shown as unavailable with a reason, the credit kept, when every city is full', () => {
    const noCity = {
      ...explored(),
      board: { ...explored().board, pieces: explored().board.pieces.filter((piece) => piece.category !== 'city') },
    }
    const answer = status(noCity)
    expect(answer.status).toBe('unavailable')
    expect(answer.reason).toContain('No basic building has an empty legal square')
    expect(answer.reason).toContain('(1 left)')
    expect(toPlayerView(noCity, CASH1981).you?.startOfTurn?.spanish).toMatchObject({ status: 'unavailable', choices: [] })
    expect(credits(noCity)).toBe(1)
  })
})

describe('undoing the exploration', () => {
  it('takes the credit back while it is unused, and offers no redo', () => {
    let undone = explored()
    const tileId = undone.board.pieces.find((piece) => piece.category === 'tile' && piece.x > 0)?.id
    while (undone.board.pieces.some((piece) => piece.id === tileId)) undone = unwrap(undoLastBoardChange(undone, CASH1981))
    expect(credits(undone)).toBe(0)
    expect(undone.spanishFreeBuildings ?? []).toHaveLength(0)
    expect(undone.board.redo).toHaveLength(0)
  })

  it('is refused with its own error when the tile is the last entry and the credit is spent', () => {
    const state = explored()
    const built = unwrap(build(state, squareOf(state, 'buildings/library')))
    // The board Undo cannot reach the tile through the building's own entries (they belong to the vote), so this takes
    // those entries off the history, as a guard of last resort for any other way the tile can become the last entry
    const history = built.board.history.filter((entry) => entry.change.kind !== 'place' || entry.change.piece.assetId !== 'buildings/library')
    let next: GameState = { ...built, board: { ...built.board, history } }
    const lastIsTile = (current: GameState): boolean => {
      const change = current.board.history.at(-1)?.change
      return change?.kind === 'place' && change.piece.category === 'tile'
    }
    while (!lastIsTile(next)) next = unwrap(undoLastBoardChange(next, CASH1981))
    expect(lastIsTile(next)).toBe(true)
    expect(unwrapErr(undoLastBoardChange(next, CASH1981)).kind).toBe('BOARD_UNDO_SPANISH_BUILDING_USED')
    // Nothing changed: the grant is still there
    expect(next.spanishFreeBuildings).toHaveLength(1)
  })

  it('walks back through the tokens, the tile and the movement when the credit is unused', () => {
    let next = explored()
    while (next.board.history.length > 0 && credits(next) > 0) next = unwrap(undoLastBoardChange(next, CASH1981))
    expect(credits(next)).toBe(0)
    expect(unwrapErr(build(next, { cityPieceId: 'x', assetId: 'buildings/library', column: 2, row: 1 })).kind).toBe('ASSISTED_ACTION_REJECTED')
  })
})

describe('what a player can see', () => {
  it('carries no credit field in anyone view, and shows the section only to the Spanish owner', () => {
    const state = explored()
    for (const playerId of [CASH1981, KARANDRAS1, ITCHI, CHUL]) {
      const text = JSON.stringify(toPlayerView(state, playerId))
      expect(text).not.toContain('spanishFreeBuildings')
    }
    const own = toPlayerView(state, CASH1981).you?.startOfTurn?.spanish
    expect(own).toMatchObject({ status: 'ready', reason: expect.stringContaining('1 of 1 left') })
    const other = toPlayerView(state, KARANDRAS1)
    expect(other.you?.startOfTurn?.spanish ?? null).toBeNull()
    // Neither the credit text nor the private line reaches the others
    expect(JSON.stringify(other)).not.toContain('free buildings left')
    expect(JSON.stringify(other)).not.toContain('of 1 left')
  })

  it('shows nothing before a tile is explored', () => {
    expect(toPlayerView(scene(), CASH1981).you?.startOfTurn?.spanish ?? null).toBeNull()
  })
})
