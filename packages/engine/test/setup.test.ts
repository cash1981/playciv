/**
 * The setup before turn 1 (issue #374): the capital, the figures, the social policy, the American great person, the starting
 * trade, the government and Egypt's wonder, the gate on Start of Turn, the reveal undo and what the projections show.
 *
 * Every scene starts from a real reveal (a civilization drawn into cash1981's hand and revealed), so the starting tile is
 * on the map at the first slot and the central squares are B2, C2, B3 and C3.
 */

import { describe, expect, it } from 'vitest'

import {
  movePiece,
  placePiece,
  undoLastBoardChange,
} from '../src/actions/board.js'
import { draw } from '../src/actions/draw.js'
import { chooseSocialPolicy, removeSocialPolicy, revealItem, revealSocialPolicy } from '../src/actions/player.js'
import { markPhasesDone, unmarkPhaseDone } from '../src/actions/turn.js'
import { canInitiateUndo, initiateUndo, vote } from '../src/actions/undo.js'
import { performAssistedAction } from '../src/assisted.js'
import { cityFootprintsOf } from '../src/blockade.js'
import { SQUARE_SIZE, mapTop, areaAt, playerAreas } from '../src/board.js'
import { createGame } from '../src/create-game.js'
import { createPlayerTurn, turnHolder, turnStatus } from '../src/turn.js'
import { migrateGameState } from '../src/migrate.js'
import type { Result } from '../src/result.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { EngineError } from '../src/errors.js'
import {
  countSetupTrade,
  finishSetupStep,
  passSetup,
  placeSetupFigure,
  placeSetupWonder,
  setCapital,
  setupGateOf,
  undoSetupStep,
} from '../src/setup.js'
import type { SetupStepId } from '../src/setup.js'
import type { GameState, Playerhand } from '../src/state.js'
import { activeTurnStatus, findPlayer, toPlayerView } from '../src/state.js'
import { capitalOf } from '../src/sot.js'
import { tradeAroundCitiesOf } from '../src/trade-collection.js'
import { tradeCeilingOf } from '../src/limits.js'

import { CASH1981, CHUL, ITCHI, KARANDRAS1 } from './fixture.js'

const AT = '2026-11-24T10:00:00.000Z'

/** Four players with their own colours: cash1981 is Red, the first seat, and holds the first turn. */
function fourColours(): GameState {
  return createGame({
    name: 'Setup',
    numOfPlayers: 4,
    seed: 'setup test',
    players: [
      { playerId: CASH1981, username: 'cash1981', color: 'Red', gameCreator: true, yourTurn: true },
      { playerId: KARANDRAS1, username: 'Karandras1', color: 'Blue' },
      { playerId: ITCHI, username: 'Itchi', color: 'Green' },
      { playerId: CHUL, username: 'Chul', color: 'Yellow' },
    ],
  })
}

/** cash1981 is dealt the civilization and reveals it, as a new game does. */
function revealed(civ: string, base: GameState = fourColours(), playerId = CASH1981): GameState {
  const card = base.items.find((item) => item.kind === 'civ' && item.name === civ)
  if (card === undefined) throw new Error(`no ${civ} civ in the deck`)
  const handed: GameState = {
    ...base,
    items: base.items.filter((item) => item.id !== card.id),
    players: base.players.map((player) => (player.playerId === playerId ? { ...player, items: [...player.items, { ...card, ownerId: playerId }] } : player)),
  }
  return unwrap(revealItem(handed, { playerId, sheetName: 'CIV', itemNumber: card.itemNumber }))
}

const me = (state: GameState, playerId = CASH1981): Playerhand => {
  const found = findPlayer(state, playerId)
  if (found === undefined) throw new Error('no such player')
  return found
}
const setupView = (state: GameState, playerId = CASH1981) => toPlayerView(state, playerId).you?.setup ?? null
const stepOf = (state: GameState, id: SetupStepId) => {
  const found = setupView(state)?.steps.find((candidate) => candidate.id === id)
  if (found === undefined) throw new Error(`no ${id} step`)
  return found
}
const piecesOf = (state: GameState, assetId: string) => state.board.pieces.filter((piece) => piece.assetId === assetId)
const cellOf = (square: { readonly column: number; readonly row: number }) => ({ column: square.column, row: square.row })

/** The first square the picker offers for the capital. */
function pickCapital(state: GameState) {
  const square = stepOf(state, 'capital').squares[0]
  if (square === undefined) throw new Error('no capital square')
  return square
}

function withCapital(state: GameState): GameState {
  const square = pickCapital(state)
  return unwrap(setCapital(state, { playerId: CASH1981, column: square.column, row: square.row, ...(square.direction === undefined ? {} : { direction: square.direction }), at: AT }))
}

function withFigures(state: GameState, which: readonly ('army' | 'scout' | 'white')[] = ['army', 'scout']): GameState {
  let next = state
  for (const figure of which) {
    const item = stepOf(next, 'figures').items.find((candidate) => candidate.id === figure)
    const square = item?.squares[0]
    if (square === undefined) throw new Error(`no square for the ${figure}`)
    next = unwrap(placeSetupFigure(next, { playerId: CASH1981, figure, column: square.column, row: square.row, at: AT }))
  }
  return next
}

const firstPolicy = (state: GameState): string => {
  const policy = state.socialPolicies[0]
  if (policy === undefined) throw new Error('no social policies')
  return policy.name
}
const withPolicy = (state: GameState, name = firstPolicy(state)): GameState => unwrap(chooseSocialPolicy(state, { playerId: CASH1981, name }))

/** A second policy that is neither the first one nor its flipside (the French start with two). */
const secondPolicy = (state: GameState): string => {
  const first = state.socialPolicies.find((policy) => policy.name === firstPolicy(state))
  const other = state.socialPolicies.find((policy) => policy.name !== first?.name && policy.name !== first?.flipside)
  if (other === undefined) throw new Error('no second policy')
  return other.name
}

/** The error kind of a refused result. */
const kindOf = (result: Result<unknown, EngineError>): string => unwrapErr(result).kind

describe('the reveal', () => {
  it('marks setup as required, creates no capital marker and leaves the other players without setup', () => {
    for (const civ of ['Chinese', 'Indians', 'Romans']) {
      const state = revealed(civ)
      expect(me(state).setup).toEqual({ required: true, finished: false, placed: [], historyIds: [] })
      expect(state.board.pieces.filter((piece) => piece.category === 'city')).toEqual([])
      expect(me(state, KARANDRAS1).setup).toBeUndefined()
    }
  })

  it('gives the Greeks Democracy with its coin, and Romans, Russians and Japanese what they had', () => {
    const greeks = revealed('Greeks')
    expect(me(greeks).government).toBe('Democracy')
    expect(me(greeks).stats.coinSources.democracyGovernment).toBe(1)
    expect(me(revealed('Romans')).government).toBe('Republic')
    expect(me(revealed('Russians')).government).toBe('Communism')
    expect(me(revealed('Japanese')).government).toBe('Feudalism')
    expect(me(revealed('Germans')).government).toBe('Despotism')
    expect(me(revealed('Germans')).stats.coinSources.democracyGovernment).toBe(0)
    // The automatic government row says so
    expect(stepOf(greeks, 'government')).toMatchObject({ status: 'auto', reason: 'Greeks start with Democracy.' })
  })

  it('lists the steps of each civilization: the great person only for the Americans, the wonder only for Egypt', () => {
    const ids = (civ: string) => setupView(revealed(civ))?.steps.map((step) => step.id)
    expect(ids('Chinese')).toEqual(['capital', 'figures', 'policy', 'trade', 'government'])
    expect(ids('Americans')).toEqual(['capital', 'figures', 'policy', 'greatPerson', 'trade', 'government'])
    expect(ids('Egyptians')).toEqual(['capital', 'figures', 'policy', 'trade', 'government', 'wonder'])
  })
})

describe('step 1: the capital', () => {
  it('offers only squares in the middle of the starting tile, and refuses any other', () => {
    const state = revealed('Germans')
    expect(stepOf(state, 'capital').squares.map((square) => square.label)).toEqual(['B2', 'C2', 'B3', 'C3'])
    expect(stepOf(state, 'capital').status).toBe('todo')
    // A corner of the tile, a square of another tile and a square off the map
    for (const [column, row] of [[0, 0], [3, 3], [9, 9], [-1, 1], [1.5, 1]] as const) {
      expect(kindOf(setCapital(state, { playerId: CASH1981, column, row }))).toBe('SETUP_REFUSED')
    }
    // Nothing was put on the board by any of the refusals
    expect(state.board.pieces.filter((piece) => piece.category === 'city')).toEqual([])
  })

  it('never offers or accepts a water square (the Aztec tile has water in the middle)', () => {
    const state = revealed('Aztecs')
    const offered = stepOf(state, 'capital').squares.map((square) => square.label)
    expect(offered).not.toContain('C3')
    expect(offered).toHaveLength(3)
    const refused = unwrapErr(setCapital(state, { playerId: CASH1981, column: 2, row: 2 }))
    expect(refused).toMatchObject({ kind: 'SETUP_REFUSED' })
    expect(JSON.stringify(refused)).toContain('water')
  })

  it('puts a plain capital marker of the player colour on the square, with a public line', () => {
    const state = withCapital(revealed('Germans'))
    const capital = capitalOf(state, me(state))
    expect(capital?.assetId).toBe('cities/redcapital2')
    expect(stepOf(state, 'capital')).toMatchObject({ status: 'done' })
    expect(state.log.at(-1)).toMatchObject({ logType: 'SETUP', publicLog: 'cash1981 placed their capital on B2 in setup' })
    expect(me(state).setup?.placed).toEqual([{ slot: 'capital', pieceId: capital?.id, created: true }])
  })

  it('gives the Chinese a walled capital', () => {
    const state = withCapital(revealed('Chinese'))
    expect(capitalOf(state, me(state))?.assetId).toBe('cities/redcapitalwalled2')
    expect(state.log.at(-1)?.publicLog).toBe('cash1981 placed their walled capital on B2 in setup')
  })

  it('gives the Indians a metropolis on two central squares and needs a direction', () => {
    const base = revealed('Indians')
    expect(stepOf(base, 'capital').squares.map((square) => square.label)).toEqual(['B2 and C2', 'B2 and B3', 'C2 and C3', 'B3 and C3'])
    expect(kindOf(setCapital(base, { playerId: CASH1981, column: 1, row: 1 }))).toBe('SETUP_REFUSED')
    // The square next to it lies off the tile's middle
    expect(kindOf(setCapital(base, { playerId: CASH1981, column: 1, row: 1, direction: 'north' }))).toBe('SETUP_REFUSED')
    expect(kindOf(setCapital(base, { playerId: CASH1981, column: 1, row: 1, direction: 'west' }))).toBe('SETUP_REFUSED')
    const state = unwrap(setCapital(base, { playerId: CASH1981, column: 1, row: 1, direction: 'east' }))
    const capital = capitalOf(state, me(state))
    expect(capital?.assetId).toBe('cities/redmetropolis2')
    const footprint = cityFootprintsOf(state, 'red')[0]
    expect(footprint?.centers.map((cell) => `${cell.column},${cell.row}`).sort()).toEqual(['1,1', '2,1'])
    expect(state.log.at(-1)?.publicLog).toBe('cash1981 placed their metropolis on B2 and C2 in setup')
    // A direction for a plain capital is refused
    expect(kindOf(setCapital(revealed('Germans'), { playerId: CASH1981, column: 1, row: 1, direction: 'east' }))).toBe('SETUP_REFUSED')
  })

  it('refuses a square that has another city on it or too close to one', () => {
    const state = revealed('Germans')
    const blocked = unwrap(placePiece(state, { playerId: KARANDRAS1, assetId: 'cities/bluecity2', x: 2 * SQUARE_SIZE + 4, y: mapTop(state.board) + 2 * SQUARE_SIZE + 4 }))
    // C3 holds the blue city: it and every square within two of it are refused
    expect(stepOf(blocked, 'capital').squares).toEqual([])
    expect(stepOf(blocked, 'capital').status).toBe('blocked')
    expect(JSON.stringify(unwrapErr(setCapital(blocked, { playerId: CASH1981, column: 2, row: 2 })))).toContain('city')
  })

  it('moves to another central square, lifting back the trade, the figures and Egypt wonder, and asks nothing twice', () => {
    let state = revealed('Egyptians')
    state = withCapital(state)
    state = withFigures(state)
    const wonder = stepOf(state, 'wonder').squares[0]
    if (wonder === undefined) throw new Error('no wonder square')
    state = unwrap(placeSetupWonder(state, { playerId: CASH1981, ...cellOf(wonder), at: AT }))
    state = unwrap(countSetupTrade(state, { playerId: CASH1981, at: AT }))
    const tradeBefore = me(state).stats.trade
    const counted = me(state).setup?.trade ?? -1
    expect(piecesOf(state, 'figures/redarmy')).toHaveLength(1)
    const armyId = piecesOf(state, 'figures/redarmy')[0]?.id
    const wonderPiece = state.board.pieces.find((piece) => piece.category === 'wonder' && piece.ownerId === CASH1981)
    expect(wonderPiece).toBeDefined()

    const target = stepOf(state, 'capital').squares[0]
    if (target === undefined) throw new Error('nowhere to move to')
    expect(target.label).not.toBe('B2')
    const moved = unwrap(setCapital(state, { playerId: CASH1981, ...cellOf(target), at: AT }))

    // One capital, on the new square; the trade is taken back; the colour figures are gone from the board and the supply is whole
    expect(piecesOf(moved, 'cities/redcapital2')).toHaveLength(1)
    expect(capitalOf(moved, me(moved))?.assetId).toBe('cities/redcapital2')
    expect(me(moved).stats.trade).toBe(Math.max(0, tradeBefore - counted))
    expect(me(moved).setup?.trade).toBeUndefined()
    expect(piecesOf(moved, 'figures/redarmy')).toEqual([])
    expect(piecesOf(moved, 'figures/redscout')).toEqual([])
    expect(moved.board.pieces.some((piece) => piece.id === armyId)).toBe(false)
    // Egypt's wonder lies in the area again, still the same piece and still the player's
    const lifted = moved.board.pieces.find((piece) => piece.id === wonderPiece?.id)
    expect(lifted?.ownerId).toBe(CASH1981)
    expect(areaAt(playerAreas(moved.board, moved.players), (lifted?.x ?? 0) + (lifted?.width ?? 0) / 2, (lifted?.y ?? 0) + (lifted?.height ?? 0) / 2)?.playerId).toBe(CASH1981)
    expect(stepOf(moved, 'figures').status).toBe('todo')
    expect(stepOf(moved, 'trade').status).toBe('todo')
    expect(stepOf(moved, 'wonder').status).toBe('todo')
    expect(me(moved).setup?.placed.map((entry) => entry.slot)).toEqual(['capital'])
    expect(moved.log.at(-1)?.publicLog).toMatch(/^cash1981 moved their capital to \w+ in setup; the starting trade, the army, the scout, Egypt's wonder went back$/)
    // Asking for the square it already stands on again changes nothing
    expect(unwrap(setCapital(moved, { playerId: CASH1981, ...cellOf(target) }))).toBe(moved)
  })

  it('moves a figure the player placed by hand nowhere: only what setup placed is lifted', () => {
    let state = withCapital(revealed('Germans'))
    state = unwrap(placePiece(state, { playerId: CASH1981, assetId: 'figures/redarmy', x: 8 * SQUARE_SIZE, y: mapTop(state.board) + 8 * SQUARE_SIZE }))
    const target = stepOf(state, 'capital').squares[0]
    if (target === undefined) throw new Error('nowhere to move to')
    const moved = unwrap(setCapital(state, { playerId: CASH1981, ...cellOf(target) }))
    expect(piecesOf(moved, 'figures/redarmy')).toHaveLength(1)
  })

  it('reuses a marker that already lies in the player area instead of making a second one', () => {
    const base = revealed('Chinese')
    const area = playerAreas(base.board, base.players).find((candidate) => candidate.playerId === CASH1981)
    const waiting = unwrap(placePiece(base, { playerId: CASH1981, assetId: 'cities/redcapitalwalled2', x: (area?.x ?? 0) + 20, y: (area?.y ?? 0) + 20 }))
    const markerId = piecesOf(waiting, 'cities/redcapitalwalled2')[0]?.id
    expect(capitalOf(waiting, me(waiting))).toBeUndefined()
    const state = withCapital(waiting)
    expect(piecesOf(state, 'cities/redcapitalwalled2')).toHaveLength(1)
    expect(capitalOf(state, me(state))?.id).toBe(markerId)
    expect(me(state).setup?.placed).toEqual([{ slot: 'capital', pieceId: markerId, created: false }])
    // Taking it back puts the same marker in the area again, and it is reused once more
    const back = unwrap(undoSetupStep(state, { playerId: CASH1981, step: 'capital', at: AT }))
    expect(piecesOf(back, 'cities/redcapitalwalled2').map((piece) => piece.id)).toEqual([markerId])
    expect(capitalOf(back, me(back))).toBeUndefined()
    expect(capitalOf(withCapital(back), me(back))?.id).toBe(markerId)
  })

  it('reuses a waiting Indian metropolis marker laid on its side', () => {
    const base = revealed('Indians')
    const area = playerAreas(base.board, base.players).find((candidate) => candidate.playerId === CASH1981)
    const waiting = unwrap(placePiece(base, { playerId: CASH1981, assetId: 'cities/redmetropolis2', x: (area?.x ?? 0) + 20, y: (area?.y ?? 0) + 20 }))
    const markerId = piecesOf(waiting, 'cities/redmetropolis2')[0]?.id
    // B2 and B3 lie one above the other, so the marker is turned
    const state = unwrap(setCapital(waiting, { playerId: CASH1981, column: 1, row: 1, direction: 'south' }))
    expect(capitalOf(state, me(state))?.id).toBe(markerId)
    expect(capitalOf(state, me(state))?.rotation).toBe(90)
    const back = unwrap(undoSetupStep(state, { playerId: CASH1981, step: 'capital' }))
    expect(piecesOf(back, 'cities/redmetropolis2')[0]?.rotation).toBe(0)
  })

  it('is not done any more when the capital is taken off the map by hand, and can be placed again', () => {
    let state = withCapital(revealed('Germans'))
    const capital = capitalOf(state, me(state))
    state = unwrap(movePiece(state, { playerId: CASH1981, pieceId: capital?.id as string, x: 0, y: 0 }))
    expect(stepOf(state, 'capital').status).toBe('todo')
    // The stale entry is not progress, so the reveal can still be taken back
    const reveal = state.log.find((entry) => entry.logType === 'REVEAL' && entry.item?.kind === 'civ')
    expect(reveal !== undefined && canInitiateUndo(state, reveal)).toBe(true)
    expect(setupView(state)?.steps.find((step) => step.id === 'figures')?.status).toBe('blocked')
    const again = withCapital(state)
    expect(stepOf(again, 'capital').status).toBe('done')
    expect(me(again).setup?.placed).toHaveLength(1)
  })

  it('cannot move a capital that setup did not place', () => {
    let state = revealed('Germans')
    state = unwrap(placePiece(state, { playerId: CASH1981, assetId: 'cities/redcapital2', x: 1 * SQUARE_SIZE + 4, y: mapTop(state.board) + SQUARE_SIZE + 4 }))
    expect(stepOf(state, 'capital')).toMatchObject({ status: 'done', canUndo: false, squares: [] })
    expect(kindOf(setCapital(state, { playerId: CASH1981, column: 2, row: 2 }))).toBe('SETUP_REFUSED')
  })

  it('is taken back only while nothing that needs it is done, and then the marker is gone', () => {
    let state = withCapital(revealed('Germans'))
    expect(stepOf(state, 'capital')).toMatchObject({ canUndo: true, undoReason: null })
    state = unwrap(countSetupTrade(state, { playerId: CASH1981 }))
    expect(stepOf(state, 'capital')).toMatchObject({ canUndo: false, undoReason: 'Take back the starting trade first.' })
    expect(kindOf(undoSetupStep(state, { playerId: CASH1981, step: 'capital' }))).toBe('SETUP_REFUSED')
    state = unwrap(undoSetupStep(state, { playerId: CASH1981, step: 'trade' }))
    state = withFigures(state, ['army'])
    expect(kindOf(undoSetupStep(state, { playerId: CASH1981, step: 'capital' }))).toBe('SETUP_REFUSED')
    state = unwrap(undoSetupStep(state, { playerId: CASH1981, step: 'figure', figure: 'army' }))
    const undone = unwrap(undoSetupStep(state, { playerId: CASH1981, step: 'capital', at: AT }))
    expect(piecesOf(undone, 'cities/redcapital2')).toEqual([])
    expect(undone.log.at(-1)?.publicLog).toBe('cash1981 took their capital back in setup')
  })

  it('refuses setup to a player with no setup, with no civilization, or after setup is over', () => {
    expect(kindOf(setCapital(fourColours(), { playerId: CASH1981, column: 1, row: 1 }))).toBe('SETUP_REFUSED')
    expect(kindOf(setCapital(revealed('Germans'), { playerId: 'someone-else', column: 1, row: 1 }))).toBe('NO_ACCESS')
    // Karandras1 has no setup although cash1981 does
    expect(kindOf(setCapital(revealed('Germans'), { playerId: KARANDRAS1, column: 1, row: 1 }))).toBe('SETUP_REFUSED')
    const finished = finishedGame()
    expect(kindOf(setCapital(finished, { playerId: CASH1981, column: 2, row: 2 }))).toBe('SETUP_REFUSED')
    expect(kindOf(countSetupTrade(finished, { playerId: CASH1981 }))).toBe('SETUP_REFUSED')
  })
})

describe('step 2: the figures', () => {
  it('waits for the capital, then offers the outskirts squares for each figure', () => {
    const before = revealed('Germans')
    expect(stepOf(before, 'figures')).toMatchObject({ status: 'blocked', reason: 'Place your capital first.' })
    expect(kindOf(placeSetupFigure(before, { playerId: CASH1981, figure: 'army', column: 0, row: 0 }))).toBe('SETUP_REFUSED')
    const state = withCapital(before)
    const figures = stepOf(state, 'figures')
    expect(figures.status).toBe('todo')
    expect(figures.items.map((item) => [item.id, item.status])).toEqual([['army', 'todo'], ['scout', 'todo']])
    // The capital is on B2 and its outskirts are A1 to C3 without B2; A3 is water on this tile
    expect(figures.items[0]?.squares.map((square) => square.label)).toEqual(['A1', 'B1', 'C1', 'A2', 'C2', 'B3', 'C3'])
  })

  it('creates a colour army and a scout from the supply, one per action, and says so publicly', () => {
    let state = withCapital(revealed('Germans'))
    state = unwrap(placeSetupFigure(state, { playerId: CASH1981, figure: 'army', column: 0, row: 0, at: AT }))
    expect(piecesOf(state, 'figures/redarmy')).toHaveLength(1)
    expect(state.log.at(-1)?.publicLog).toBe('cash1981 placed their army on A1 in setup')
    expect(stepOf(state, 'figures').status).toBe('todo')
    state = unwrap(placeSetupFigure(state, { playerId: CASH1981, figure: 'scout', column: 2, row: 1, at: AT }))
    expect(piecesOf(state, 'figures/redscout')).toHaveLength(1)
    expect(stepOf(state, 'figures')).toMatchObject({ status: 'done' })
    // A second army is refused, and the same request again changes nothing
    expect(kindOf(placeSetupFigure(state, { playerId: CASH1981, figure: 'army', column: 1, row: 0 }))).toBe('SETUP_REFUSED')
    expect(unwrap(placeSetupFigure(state, { playerId: CASH1981, figure: 'army', column: 0, row: 0 }))).toBe(state)
  })

  it('refuses squares outside the outskirts, the city centre, water and an unknown figure', () => {
    const state = withCapital(revealed('Aztecs'))
    // B2 is the capital's square for the first offered square; D4 is two squares away, the sea is the water square C3
    const capital = capitalOf(state, me(state))
    expect(capital).toBeDefined()
    for (const [column, row] of [[3, 3], [5, 5], [1, 1]] as const) {
      expect(kindOf(placeSetupFigure(state, { playerId: CASH1981, figure: 'army', column, row }))).toBe('SETUP_REFUSED')
    }
    expect(unwrapErr(placeSetupFigure(state, { playerId: CASH1981, figure: 'army', column: 2, row: 2 }))).toMatchObject({ kind: 'SETUP_REFUSED' })
    // The Aztec capital is on B2 and C3 is water: neither the army nor the scout may stand there
    expect(stepOf(state, 'figures').items[0]?.squares.map((square) => square.label)).not.toContain('C3')
    expect(kindOf(placeSetupFigure(state, { playerId: CASH1981, figure: 'white', column: 0, row: 0 }))).toBe('SETUP_REFUSED')
  })

  it('respects the stacking limit and keeps a scout off a square with a foreign figure', () => {
    let state = withCapital(revealed('Germans'))
    state = { ...state, players: state.players.map((player) => (player.playerId === CASH1981 ? { ...player, stats: { ...player.stats, stacking: 1 } } : player)) }
    state = unwrap(placeSetupFigure(state, { playerId: CASH1981, figure: 'army', column: 0, row: 0 }))
    expect(stepOf(state, 'figures').items.find((item) => item.id === 'scout')?.squares.map((square) => square.label)).not.toContain('A1')
    expect(kindOf(placeSetupFigure(state, { playerId: CASH1981, figure: 'scout', column: 0, row: 0 }))).toBe('SETUP_REFUSED')

    const hostile = unwrap(placePiece(state, { playerId: KARANDRAS1, assetId: 'figures/bluearmy', x: 2 * SQUARE_SIZE + 20, y: mapTop(state.board) + 0 * SQUARE_SIZE + 20 }))
    expect(stepOf(hostile, 'figures').items.find((item) => item.id === 'scout')?.squares.map((square) => square.label)).not.toContain('C1')
    expect(kindOf(placeSetupFigure(hostile, { playerId: CASH1981, figure: 'scout', column: 2, row: 0 }))).toBe('SETUP_REFUSED')
  })

  it('refuses when the supply is used up and returns it on undo', () => {
    let state = withCapital(revealed('Germans'))
    // The six red armies are all on the board elsewhere
    for (let index = 0; index < 6; index += 1) {
      state = unwrap(placePiece(state, { playerId: CASH1981, assetId: 'figures/redarmy', x: 8 * SQUARE_SIZE + index * 5, y: 60 }))
    }
    expect(stepOf(state, 'figures').items[0]).toMatchObject({ id: 'army', status: 'blocked' })
    expect(kindOf(placeSetupFigure(state, { playerId: CASH1981, figure: 'army', column: 0, row: 0 }))).toBe('SETUP_REFUSED')

    let fresh = withFigures(withCapital(revealed('Germans')))
    const before = piecesOf(fresh, 'figures/redarmy').length
    fresh = unwrap(undoSetupStep(fresh, { playerId: CASH1981, step: 'figure', figure: 'army', at: AT }))
    expect(piecesOf(fresh, 'figures/redarmy').length).toBe(before - 1)
    expect(stepOf(fresh, 'figures').items.find((item) => item.id === 'army')).toMatchObject({ status: 'todo', canUndo: false })
    expect(fresh.log.at(-1)?.publicLog).toBe('cash1981 took their army back in setup')
  })

  it('moves the Russian white army out of the area, and puts it back on undo', () => {
    let state = withCapital(revealed('Russians'))
    const white = piecesOf(state, 'figures/whitearmy')
    expect(white).toHaveLength(1)
    const whiteId = white[0]?.id
    expect(stepOf(state, 'figures').items.map((item) => item.id)).toEqual(['army', 'scout', 'white'])
    expect(stepOf(state, 'figures').items[2]?.label).toBe('White army (Russians)')
    state = withFigures(state, ['army', 'scout', 'white'])
    // The very same piece moved, no second white army was made
    expect(piecesOf(state, 'figures/whitearmy').map((piece) => piece.id)).toEqual([whiteId])
    expect(state.log.at(-1)?.publicLog).toBe('cash1981 placed their white army on A1 in setup')
    expect(me(state).setup?.placed.find((entry) => entry.slot === 'white')).toEqual({ slot: 'white', pieceId: whiteId, created: false })
    expect(stepOf(state, 'figures').status).toBe('done')
    const back = unwrap(undoSetupStep(state, { playerId: CASH1981, step: 'figure', figure: 'white' }))
    const piece = piecesOf(back, 'figures/whitearmy')[0]
    expect(piece?.id).toBe(whiteId)
    expect(areaAt(playerAreas(back.board, back.players), (piece?.x ?? 0) + (piece?.width ?? 0) / 2, (piece?.y ?? 0) + (piece?.height ?? 0) / 2)?.playerId).toBe(CASH1981)
    expect(stepOf(back, 'figures').status).toBe('todo')
  })

  it('moves the Spanish white scout, and only the Russians and Spanish have a white figure', () => {
    let state = withCapital(revealed('Spanish'))
    expect(stepOf(state, 'figures').items.find((item) => item.id === 'white')?.label).toBe('White scout (Spanish)')
    state = withFigures(state, ['army', 'scout', 'white'])
    expect(piecesOf(state, 'figures/whitescout')).toHaveLength(1)
    expect(stepOf(state, 'figures').status).toBe('done')
    expect(stepOf(withCapital(revealed('Chinese')), 'figures').items.map((item) => item.id)).toEqual(['army', 'scout'])
  })

  it('counts a figure the player put on the map by hand as done, but cannot take it back', () => {
    let state = withCapital(revealed('Germans'))
    state = unwrap(placePiece(state, { playerId: CASH1981, assetId: 'figures/redscout', x: 0 * SQUARE_SIZE + 20, y: mapTop(state.board) + 20 }))
    const scout = stepOf(state, 'figures').items.find((item) => item.id === 'scout')
    expect(scout).toMatchObject({ status: 'done', canUndo: false })
    expect(kindOf(undoSetupStep(state, { playerId: CASH1981, step: 'figure', figure: 'scout' }))).toBe('SETUP_REFUSED')
  })
})

describe('step 3: the social policy', () => {
  it('is done at one policy, and chooseSocialPolicy is unchanged', () => {
    const state = revealed('Germans')
    expect(stepOf(state, 'policy')).toMatchObject({ status: 'todo', canUndo: false })
    const chosen = withPolicy(state)
    expect(stepOf(chosen, 'policy')).toMatchObject({ status: 'done' })
    // The flipside rule still holds
    const first = chosen.socialPolicies.find((policy) => policy.name === firstPolicy(chosen))
    if (first?.flipside === null || first?.flipside === undefined) throw new Error('first policy has no flipside')
    expect(kindOf(chooseSocialPolicy(chosen, { playerId: CASH1981, name: first.flipside }))).toBe('SOCIAL_POLICY_FLIPSIDE_TAKEN')
  })
})

describe('step 3: the social policy of the French (issue #378)', () => {
  it('needs two starting policies, and a Germans player one', () => {
    const state = revealed('French')
    expect(stepOf(state, 'policy')).toMatchObject({ status: 'todo' })
    const one = withPolicy(state)
    expect(stepOf(one, 'policy')).toMatchObject({ status: 'todo' })
    expect(stepOf(one, 'policy').reason).toContain('1 of 2')
    expect(setupGateOf(withFigures(withCapital(one)), me(one))).toContain('social policy')
    const two = withPolicy(one, secondPolicy(one))
    expect(stepOf(two, 'policy')).toMatchObject({ status: 'done' })
    expect(setupGateOf(withFigures(withCapital(two)), me(two))).toContain('starting trade')
    expect(setupGateOf(withFigures(withCapital(two)), me(two))).not.toContain('social policy')
  })

  it('refuses a third starting policy: the French start with two', () => {
    const one = withPolicy(revealed('French'))
    const two = withPolicy(one, secondPolicy(one))
    const third = two.socialPolicies.find((policy) => !me(two).socialPolicies.some((held) => held.name === policy.name || held.name === policy.flipside))
    if (third === undefined) throw new Error('no third policy')
    expect(kindOf(chooseSocialPolicy(two, { playerId: CASH1981, name: third.name }))).toBe('SOCIAL_POLICY_LIMIT')
  })

  it('does not reopen a setup that was finished with one policy', () => {
    // An older game: the French finished with one policy (here one is returned after finishing)
    const finished = finishedGame('French')
    const french = unwrap(removeSocialPolicy(finished, { playerId: CASH1981, name: firstPolicy(finished) }))
    expect(me(french).socialPolicies).toHaveLength(1)
    expect(me(french).setup).toMatchObject({ finished: true })
    expect(setupGateOf(french, me(french))).toBeUndefined()
    expect(toPlayerView(french, CASH1981).you?.setup).toBeNull()
  })
})

describe('step 5: the starting trade', () => {
  it('needs the capital', () => {
    const state = revealed('Germans')
    expect(stepOf(state, 'trade')).toMatchObject({ status: 'blocked', reason: 'Place your capital first.' })
    expect(kindOf(countSetupTrade(state, { playerId: CASH1981 }))).toBe('SETUP_REFUSED')
  })

  it('counts what the Trade phase counts, adds it once, and undo takes back exactly it', () => {
    const state = withCapital(revealed('Germans'))
    const around = tradeAroundCitiesOf(state, me(state))
    expect(around).toBeGreaterThan(0)
    const counted = unwrap(countSetupTrade(state, { playerId: CASH1981, at: AT }))
    expect(me(counted).stats.trade).toBe(me(state).stats.trade + around)
    expect(me(counted).setup?.trade).toBe(around)
    expect(stepOf(counted, 'trade')).toMatchObject({ status: 'done', canUndo: true, reason: `${around} trade was counted around your capital.` })
    expect(counted.log.at(-1)?.publicLog).toBe(`cash1981 counted ${around} trade around their capital in setup`)
    // The same request again is not counted twice
    expect(unwrap(countSetupTrade(counted, { playerId: CASH1981 }))).toBe(counted)

    const undone = unwrap(undoSetupStep(counted, { playerId: CASH1981, step: 'trade', at: AT }))
    expect(me(undone).stats.trade).toBe(me(state).stats.trade)
    expect(me(undone).setup?.trade).toBeUndefined()
    // Taking back what is not counted changes nothing, so a retry of an undo that went through answers the same
    expect(unwrap(undoSetupStep(undone, { playerId: CASH1981, step: 'trade' }))).toBe(undone)

    // Trade edited below the counted amount since: the undo stops at 0
    const spent = { ...counted, players: counted.players.map((player) => (player.playerId === CASH1981 ? { ...player, stats: { ...player.stats, trade: 1 } } : player)) }
    expect(me(unwrap(undoSetupStep(spent, { playerId: CASH1981, step: 'trade' }))).stats.trade).toBe(0)
  })

  it('is capped by the trade track', () => {
    const state = withCapital(revealed('Germans'))
    const full = { ...state, players: state.players.map((player) => (player.playerId === CASH1981 ? { ...player, stats: { ...player.stats, trade: tradeCeilingOf('Germans') - 1 } } : player)) }
    const counted = unwrap(countSetupTrade(full, { playerId: CASH1981 }))
    expect(me(counted).stats.trade).toBe(tradeCeilingOf('Germans'))
    expect(me(counted).setup?.trade).toBe(1)
    expect(me(unwrap(undoSetupStep(counted, { playerId: CASH1981, step: 'trade' }))).stats.trade).toBe(tradeCeilingOf('Germans') - 1)
  })

  it('leaves turn 1 Trade to collect its own, on top of the starting count', () => {
    const state = finishedGame('Germans')
    const turn = me(state).playerTurns.find((candidate) => candidate.turnNumber === 1)
    const around = me(state).setup?.trade ?? 0
    expect(around).toBeGreaterThan(0)
    // Marking Start of Turn done collected the city trade once more, which is the normal Trade collection
    expect(turn?.tradeCollected).toBe(around)
    expect(me(state).stats.trade).toBe(2 * around)
  })
})

describe('step 7: the Egyptian wonder', () => {
  it('needs the capital, offers empty squares in the outskirts and moves the same piece out of the area', () => {
    const base = revealed('Egyptians')
    const wonder = base.board.pieces.find((piece) => piece.category === 'wonder' && piece.ownerId === CASH1981)
    expect(wonder).toBeDefined()
    expect(stepOf(base, 'wonder')).toMatchObject({ status: 'blocked', reason: 'Place your capital first.' })
    expect(kindOf(placeSetupWonder(base, { playerId: CASH1981, column: 0, row: 0 }))).toBe('SETUP_REFUSED')

    let state = withCapital(base)
    const squares = stepOf(state, 'wonder').squares
    expect(squares.length).toBeGreaterThan(0)
    const target = squares[0]
    if (target === undefined) throw new Error('no square')
    state = unwrap(placeSetupWonder(state, { playerId: CASH1981, ...cellOf(target), at: AT }))
    const placed = state.board.pieces.find((piece) => piece.id === wonder?.id)
    expect(placed?.ownerId).toBe(CASH1981)
    expect(stepOf(state, 'wonder')).toMatchObject({ status: 'done', canUndo: true })
    expect(state.log.at(-1)?.publicLog).toBe(`cash1981 placed ${wonder?.label} on ${target.label} in setup`)
    // The same request again changes nothing; another square is refused while it stands
    expect(unwrap(placeSetupWonder(state, { playerId: CASH1981, ...cellOf(target) }))).toBe(state)
    const other = squares[1]
    expect(kindOf(placeSetupWonder(state, { playerId: CASH1981, column: other?.column ?? 0, row: other?.row ?? 0 }))).toBe('SETUP_REFUSED')

    const back = unwrap(undoSetupStep(state, { playerId: CASH1981, step: 'wonder', at: AT }))
    expect(stepOf(back, 'wonder').status).toBe('todo')
    expect(back.board.pieces.some((piece) => piece.id === wonder?.id)).toBe(true)
  })

  it('refuses an occupied or far square, and every other civilization', () => {
    const state = withCapital(revealed('Egyptians'))
    const first = stepOf(state, 'wonder').squares[0]
    if (first === undefined) throw new Error('no square')
    const taken = unwrap(placePiece(state, { playerId: CASH1981, assetId: 'buildings/library', x: first.column * SQUARE_SIZE + 20, y: mapTop(state.board) + first.row * SQUARE_SIZE + 20 }))
    expect(stepOf(taken, 'wonder').squares.map((square) => square.label)).not.toContain(first.label)
    expect(kindOf(placeSetupWonder(taken, { playerId: CASH1981, column: first.column, row: first.row }))).toBe('SETUP_REFUSED')
    expect(kindOf(placeSetupWonder(state, { playerId: CASH1981, column: 7, row: 7 }))).toBe('SETUP_REFUSED')
    expect(kindOf(placeSetupWonder(withCapital(revealed('Germans')), { playerId: CASH1981, column: 0, row: 0 }))).toBe('SETUP_REFUSED')
    expect(setupView(withCapital(revealed('Germans')))?.steps.some((step) => step.id === 'wonder')).toBe(false)
  })
})

describe('step 4: the American great person', () => {
  const greatPerson = (state: GameState, requestId = 'gp-1', playerId = CASH1981) =>
    performAssistedAction(state, { playerId, action: 'setupGreatPerson', requestId, at: AT })
  const policies = (state: GameState, ...names: string[]): GameState =>
    names.reduce((next, name) => unwrap(revealSocialPolicy(unwrap(chooseSocialPolicy(next, { playerId: CASH1981, name })), { playerId: CASH1981, name })), state)
  const cardsOf = (state: GameState) => me(state).items.filter((item) => item.kind === 'greatperson')

  it('is blocked until a policy is chosen and revealed', () => {
    const base = revealed('Americans')
    expect(stepOf(base, 'greatPerson')).toMatchObject({ status: 'blocked' })
    expect(stepOf(base, 'greatPerson').reason).toContain('Choose your social policy first')
    expect(kindOf(greatPerson(base))).toBe('ASSISTED_ACTION_REJECTED')
    const hidden = withPolicy(base)
    expect(stepOf(hidden, 'greatPerson').reason).toContain('Reveal your social policy first')
    expect(JSON.stringify(unwrapErr(greatPerson(hidden)))).toContain('Reveal your social policy first')
    expect(cardsOf(hidden)).toEqual([])
    expect(stepOf(policies(base, firstPolicy(base)), 'greatPerson')).toMatchObject({ status: 'todo', reason: 'Draw 1 great person card and keep one.' })
  })

  it('draws one card, keeps it with its marker in the area, and cannot be repeated', () => {
    const ready = policies(revealed('Americans'), 'Pacifism')
    const deckBefore = ready.items.filter((item) => item.sheetName === 'GREAT_PERSON').length
    const drawn = unwrap(greatPerson(ready))
    expect(cardsOf(drawn)).toHaveLength(1)
    expect(drawn.items.filter((item) => item.sheetName === 'GREAT_PERSON')).toHaveLength(deckBefore - 1)
    const record = drawn.assistedActions.find((candidate) => candidate.id === 'gp-1')
    expect(record).toMatchObject({ kind: 'setupGreatPerson', status: 'applied', effect: { kind: 'setupGreatPerson' } })
    const marker = record?.effect.kind === 'setupGreatPerson' ? record.effect.marker : null
    expect(marker).not.toBeNull()
    const piece = drawn.board.pieces.find((candidate) => candidate.id === marker?.pieceId)
    expect(piece?.category).toBe('greatperson')
    expect(areaAt(playerAreas(drawn.board, drawn.players), (piece?.x ?? 0) + (piece?.width ?? 0) / 2, (piece?.y ?? 0) + (piece?.height ?? 0) / 2)?.playerId).toBe(CASH1981)
    expect(stepOf(drawn, 'greatPerson')).toMatchObject({ status: 'done', canUndo: false })
    // Once only, whatever the request id
    expect(kindOf(greatPerson(drawn, 'gp-2'))).toBe('ASSISTED_ACTION_REJECTED')
    expect(unwrapErr(greatPerson(drawn, 'gp-2'))).toMatchObject({ status: 'used' })
    expect(unwrapErr(performAssistedAction(drawn, { playerId: CASH1981, action: 'setupGreatPerson', requestId: 'gp-3', at: AT, confirmedRepeat: true }))).toMatchObject({ status: 'used' })
    // The same request again changes nothing
    expect(unwrap(greatPerson(drawn))).toBe(drawn)
  })

  it('draws two with a revealed Organized Religion; the keep goes through chooseReward and the discard is public', () => {
    const ready = policies(revealed('Americans'), 'Organized Religion')
    const drawn = unwrap(greatPerson(ready))
    const reward = me(drawn).pendingRewards[0]
    expect(reward?.candidateIds).toHaveLength(2)
    expect(cardsOf(drawn)).toHaveLength(2)
    expect(drawn.board.pieces.length).toBe(ready.board.pieces.length)
    expect(stepOf(drawn, 'greatPerson')).toMatchObject({ status: 'todo', reason: 'Choose which great person card to keep.' })
    expect(setupGateOf(drawn, me(drawn))).toContain('great person')

    const kept = reward?.candidateIds[0] as string
    const other = reward?.candidateIds[1] as string
    const chosen = unwrap(
      performAssistedAction(drawn, { playerId: CASH1981, action: 'chooseReward', requestId: 'choose-1', at: AT, payload: { rewardId: reward?.id as string, itemId: kept } as never }),
    )
    expect(cardsOf(chosen).map((item) => item.id)).toEqual([kept])
    expect(chosen.discardedItems.some((item) => item.id === other)).toBe(true)
    expect(me(chosen).pendingRewards).toEqual([])
    const record = chosen.assistedActions.find((candidate) => candidate.id === 'gp-1')
    expect(record?.effect).toMatchObject({ kind: 'setupGreatPerson', kept })
    expect(record?.effect.kind === 'setupGreatPerson' && record.effect.marker).toBeTruthy()
    expect(stepOf(chosen, 'greatPerson')).toMatchObject({ status: 'done' })
    // The marker the keep took cannot be taken back by the board Undo
    expect(undoLastBoardChange(chosen, CASH1981)).toMatchObject({ ok: false })
  })

  it('is undone by the vote, which puts the cards back in the deck and takes the marker off', () => {
    const ready = policies(revealed('Americans'), 'Organized Religion')
    let state = unwrap(greatPerson(ready))
    const reward = me(state).pendingRewards[0]
    state = unwrap(
      performAssistedAction(state, { playerId: CASH1981, action: 'chooseReward', requestId: 'choose-1', at: AT, payload: { rewardId: reward?.id as string, itemId: reward?.candidateIds[0] as string } as never }),
    )
    const entry = state.log.find((candidate) => candidate.assistedActionId === 'gp-1')
    if (entry === undefined) throw new Error('no log line')
    let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
    for (const playerId of [KARANDRAS1, ITCHI, CHUL]) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
    expect(cardsOf(next)).toEqual([])
    expect(me(next).pendingRewards).toEqual([])
    expect(next.board.pieces.length).toBe(ready.board.pieces.length)
    expect(next.items.filter((item) => item.sheetName === 'GREAT_PERSON')).toHaveLength(ready.items.filter((item) => item.sheetName === 'GREAT_PERSON').length)
    expect(next.assistedActions.find((candidate) => candidate.id === 'gp-1')?.status).toBe('undone')
    // The board Undo cannot walk past the takeback into the forward move of the marker (the undo floor)
    expect(undoLastBoardChange(next, CASH1981).ok).toBe(false)
    // Drawn again afterwards: setup is still open and the draw is possible
    expect(unwrap(greatPerson(next, 'gp-4')).assistedActions.at(-1)).toMatchObject({ id: 'gp-4', status: 'applied' })
  })

  it('is for the Americans only, and not after setup is over', () => {
    const germans = policies(revealed('Germans'), 'Pacifism')
    expect(kindOf(greatPerson(germans))).toBe('ASSISTED_ACTION_REJECTED')
    expect(JSON.stringify(unwrapErr(greatPerson(germans)))).toContain('Only the Americans')
    const done = finishedGame('Americans')
    expect(JSON.stringify(unwrapErr(greatPerson(done, 'late')))).toMatch(/Setup is over|already drawn/)
  })

  it('names no card in the public log, in an opponent view or in the discarded line of the drawn card', () => {
    const ready = policies(revealed('Americans'), 'Organized Religion')
    const drawn = unwrap(greatPerson(ready))
    const names = cardsOf(drawn).map((item) => ('name' in item ? item.name : ''))
    expect(names.every((name) => name !== '')).toBe(true)
    const line = drawn.log.find((entry) => entry.assistedActionId === 'gp-1')
    expect(line?.publicLog).toMatch(/^cash1981 drew a great person in setup: drew 2 Great Person cards \(item numbers #\d+, #\d+\)$/)
    for (const viewer of [KARANDRAS1, ITCHI, CHUL, 'a-spectator']) {
      // `you.availableActions` names every great person for everybody (a "not-owned" row), so it is left out of the scan
      const { you, ...rest } = toPlayerView(drawn, viewer)
      const { availableActions: _buttons, playableCards: _playable, ...yours } = you ?? ({} as NonNullable<typeof you>)
      const seen = JSON.stringify({ ...rest, you: yours })
      for (const name of names) expect(seen).not.toContain(name)
      expect(seen).not.toContain('privateLog')
    }
    // The owner's private log does name them
    expect(drawn.log.some((entry) => entry.playerId === CASH1981 && names.some((name) => entry.privateLog.includes(name)))).toBe(true)
  })
})

describe('the gate on Start of Turn', () => {
  const mark = (state: GameState, upToPhase: 'SOT' | 'TRADE' | 'CM' | 'MOVEMENT' | 'RESEARCH' = 'SOT', playerId = CASH1981) =>
    markPhasesDone(state, { playerId, turnNumber: 1, upToPhase, at: AT })

  it('refuses Start of Turn, and every phase that passes it, until setup is done, naming what is missing', () => {
    const state = revealed('Germans')
    for (const phase of ['SOT', 'TRADE', 'CM', 'MOVEMENT', 'RESEARCH'] as const) {
      const refused = unwrapErr(mark(state, phase))
      expect(refused).toEqual({
        kind: 'SETUP_INCOMPLETE',
        reason: 'Finish your setup before Start of Turn can be marked done: still to do: capital, figures, social policy, starting trade. Open the Setup tab.',
      })
    }
    // Step by step the list shrinks
    const capital = withCapital(state)
    expect(JSON.stringify(unwrapErr(mark(capital)))).toContain('still to do: figures, social policy, starting trade.')
    const traded = unwrap(countSetupTrade(withPolicy(withFigures(capital)), { playerId: CASH1981 }))
    expect(setupGateOf(traded, me(traded))).toBeUndefined()
    expect(setupView(traded)?.blocksTurn).toBeNull()
    expect(setupView(state)?.blocksTurn).toContain('still to do: capital, figures, social policy, starting trade')
  })

  it('asks the Americans for the great person and the Egyptians for the wonder as well', () => {
    expect(JSON.stringify(unwrapErr(mark(revealed('Americans'))))).toContain('social policy, great person, starting trade')
    expect(JSON.stringify(unwrapErr(mark(revealed('Egyptians'))))).toContain('starting trade, Egypt\'s wonder')
    const egypt = unwrap(countSetupTrade(withPolicy(withFigures(withCapital(revealed('Egyptians')))), { playerId: CASH1981 }))
    expect(JSON.stringify(unwrapErr(mark(egypt)))).toContain("still to do: Egypt's wonder.")
  })

  it('lets it through when every step is done, records that setup is finished, and then never closes again', () => {
    const state = finishedGame()
    expect(me(state).setup).toMatchObject({ required: true, finished: true })
    expect(me(state).playerTurns.find((turn) => turn.turnNumber === 1)?.done.SOT).toBe(true)
    expect(state.log.some((entry) => entry.logType === 'SETUP' && entry.publicLog === 'cash1981 finished setup')).toBe(true)
    expect(toPlayerView(state, CASH1981).you?.setup).toBeNull()
    // The capital is lifted off by hand afterwards, and Start of Turn is reopened and marked again: still allowed
    const capital = capitalOf(state, me(state))
    const gone = unwrap(movePiece(state, { playerId: CASH1981, pieceId: capital?.id as string, x: 0, y: 0 }))
    expect(capitalOf(gone, me(gone))).toBeUndefined()
    const reopened = unwrap(unmarkPhaseDone(gone, { playerId: CASH1981, turnNumber: 1, phase: 'SOT' }))
    expect(unwrap(mark(reopened)).players.find((player) => player.playerId === CASH1981)?.playerTurns.find((turn) => turn.turnNumber === 1)?.done.SOT).toBe(true)
  })

  it('does nothing for a player with no setup record (a game saved before setup), and holds each player to their own setup', () => {
    const legacy = revealed('Germans')
    const { setup: _setup, ...without } = me(legacy)
    void _setup
    const saved = { ...legacy, players: legacy.players.map((player) => (player.playerId === CASH1981 ? without : player)) }
    expect(unwrap(mark(saved)).log.at(-1)?.publicLog).toContain('marked start of turn phase done')
    expect(toPlayerView(saved, CASH1981).you?.setup).toBeNull()
    // Karandras1 has no setup while cash1981's is open: he is not held back, and she is
    expect(unwrap(mark(legacy, 'SOT', KARANDRAS1))).toBeDefined()
    expect(kindOf(mark(legacy))).toBe('SETUP_INCOMPLETE')
    // And the other way round: cash1981 finished, Karandras1 still has his to do
    const both = revealed('Chinese', finishedGame('Germans'), KARANDRAS1)
    expect(kindOf(mark(both, 'SOT', KARANDRAS1))).toBe('SETUP_INCOMPLETE')
    expect(unwrap(mark(both, 'TRADE', CASH1981))).toBeDefined()
  })
})

describe('undoing the civilization reveal', () => {
  const revealEntry = (state: GameState) => {
    const entry = state.log.find((candidate) => candidate.logType === 'REVEAL' && candidate.item?.kind === 'civ' && candidate.playerId === CASH1981)
    if (entry === undefined) throw new Error('no reveal line')
    return entry
  }

  it('is refused while setup has progress, with a clear error, and allowed once the steps are undone', () => {
    const started = withCapital(revealed('Germans'))
    const entry = revealEntry(started)
    expect(canInitiateUndo(started, entry)).toBe(false)
    expect(unwrapErr(initiateUndo(started, { logId: entry.id, playerId: CASH1981 }))).toEqual({ kind: 'CIV_REVEAL_SETUP_STARTED', logId: entry.id })
    const back = unwrap(undoSetupStep(started, { playerId: CASH1981, step: 'capital' }))
    expect(canInitiateUndo(back, revealEntry(back))).toBe(true)
    expect(unwrap(initiateUndo(back, { logId: revealEntry(back).id, playerId: CASH1981 }))).toBeDefined()
  })

  it('counts the trade, a figure and the great person as progress too', () => {
    const traded = unwrap(countSetupTrade(withCapital(revealed('Germans')), { playerId: CASH1981 }))
    expect(canInitiateUndo(traded, revealEntry(traded))).toBe(false)
    const figure = withFigures(withCapital(revealed('Germans')), ['army'])
    expect(canInitiateUndo(figure, revealEntry(figure))).toBe(false)
    const american = unwrap(performAssistedAction(unwrap(revealSocialPolicy(withPolicy(revealed('Americans'), 'Pacifism'), { playerId: CASH1981, name: 'Pacifism' })), { playerId: CASH1981, action: 'setupGreatPerson', requestId: 'gp-1', at: AT }))
    expect(canInitiateUndo(american, revealEntry(american))).toBe(false)
  })

  it('is refused at the vote when setup moved on after the vote was asked', () => {
    const base = revealed('Germans')
    const entry = revealEntry(base)
    let state = unwrap(initiateUndo(base, { logId: entry.id, playerId: CASH1981 }))
    state = withCapital(state)
    for (const playerId of [KARANDRAS1, ITCHI]) state = unwrap(vote(state, { logId: entry.id, playerId, vote: true }))
    expect(unwrapErr(vote(state, { logId: entry.id, playerId: CHUL, vote: true }))).toEqual({ kind: 'CIV_REVEAL_SETUP_STARTED', logId: entry.id })
  })

  it('takes the Greek Democracy coin and the setup record away with the reveal', () => {
    const greeks = revealed('Greeks')
    const entry = revealEntry(greeks)
    let state = unwrap(initiateUndo(greeks, { logId: entry.id, playerId: CASH1981 }))
    for (const playerId of [KARANDRAS1, ITCHI, CHUL]) state = unwrap(vote(state, { logId: entry.id, playerId, vote: true }))
    expect(me(state).civilization).toBeNull()
    expect(me(state).government).toBe('Despotism')
    expect(me(state).stats.coinSources.democracyGovernment).toBe(0)
    expect(me(state).setup).toBeUndefined()
  })
})

describe('the board Undo', () => {
  it('leaves every piece and takeback of setup to setup itself', () => {
    let state = withFigures(withCapital(revealed('Germans')), ['army'])
    expect(unwrapErr(undoLastBoardChange(state, CASH1981))).toEqual({ kind: 'BOARD_UNDO_ASSISTED' })
    state = unwrap(undoSetupStep(state, { playerId: CASH1981, step: 'figure', figure: 'army' }))
    // The removal of the created army is sealed as well: Undo would bring the army back without the record
    expect(unwrapErr(undoLastBoardChange(state, CASH1981))).toEqual({ kind: 'BOARD_UNDO_ASSISTED' })
    const record = me(state).setup?.historyIds ?? []
    expect(record.length).toBeGreaterThanOrEqual(3)
    expect(record.every((id) => state.board.history.some((entry) => entry.id === id))).toBe(true)
  })

  it('still undoes a piece the player placed by hand', () => {
    const state = unwrap(placePiece(withCapital(revealed('Germans')), { playerId: CASH1981, assetId: 'figures/redarmy', x: 8 * SQUARE_SIZE, y: mapTop(fourColours().board) + 8 * SQUARE_SIZE }))
    expect(undoLastBoardChange(state, CASH1981).ok).toBe(true)
  })
})

describe('what each viewer sees', () => {
  it('gives the owner the steps and nobody else a thing', () => {
    const state = withFigures(withCapital(revealed('Germans')), ['army'])
    const own = toPlayerView(state, CASH1981)
    expect(own.you?.setup?.steps.map((step) => step.id)).toContain('capital')
    expect(own.you?.setup?.blocksTurn).toContain('still to do')
    for (const viewer of [KARANDRAS1, ITCHI, CHUL]) {
      const view = toPlayerView(state, viewer)
      expect(view.you?.setup).toBeNull()
      const theirs = view.opponents.find((opponent) => opponent.playerId === CASH1981)
      expect(theirs).toBeDefined()
      expect(Object.keys(theirs ?? {})).not.toContain('setup')
      expect(JSON.stringify(view)).not.toContain('historyIds')
      expect(JSON.stringify(view)).not.toContain('blocksTurn')
    }
    const spectator = toPlayerView(state, 'a-spectator')
    expect(spectator.you).toBeNull()
    expect(JSON.stringify(spectator)).not.toContain('blocksTurn')
    expect(JSON.stringify(spectator)).not.toContain('"placed"')
  })

  it('shows no setup to a player with no setup record', () => {
    expect(toPlayerView(revealed('Germans'), KARANDRAS1).you?.setup).toBeNull()
    expect(toPlayerView(fourColours(), CASH1981).you?.setup).toBeNull()
  })
})

describe('undoing a step that is not done', () => {
  it('changes nothing for the capital, a figure, the trade and the wonder, but still refuses what setup did not place', () => {
    const fresh = revealed('Egyptians')
    expect(unwrap(undoSetupStep(fresh, { playerId: CASH1981, step: 'capital' }))).toBe(fresh)
    expect(unwrap(undoSetupStep(fresh, { playerId: CASH1981, step: 'figure', figure: 'army' }))).toBe(fresh)
    expect(unwrap(undoSetupStep(fresh, { playerId: CASH1981, step: 'trade' }))).toBe(fresh)
    expect(unwrap(undoSetupStep(fresh, { playerId: CASH1981, step: 'wonder' }))).toBe(fresh)
    // A second undo after one that went through
    const placed = withFigures(withCapital(fresh), ['army'])
    const once = unwrap(undoSetupStep(placed, { playerId: CASH1981, step: 'figure', figure: 'army' }))
    expect(unwrap(undoSetupStep(once, { playerId: CASH1981, step: 'figure', figure: 'army' }))).toBe(once)
    // A figure and a wonder on the map that setup did not place are still refused
    const byHand = unwrap(placePiece(withCapital(fresh), { playerId: CASH1981, assetId: 'figures/redscout', x: 20, y: mapTop(fresh.board) + 20 }))
    expect(kindOf(undoSetupStep(byHand, { playerId: CASH1981, step: 'figure', figure: 'scout' }))).toBe('SETUP_REFUSED')
    // A missing figure name is still a malformed request
    expect(kindOf(undoSetupStep(fresh, { playerId: CASH1981, step: 'figure' }))).toBe('SETUP_REFUSED')
  })
})

describe('moving the capital onto a square the wonder holds', () => {
  it.each(['Egyptians', 'Indians'])('offers only squares setCapital accepts, with a figure of setup\'s on the board, as the %s', (civ) => {
    let state = withCapital(revealed(civ))
    state = withFigures(state, ['army'])
    const offered = stepOf(state, 'capital').squares
    expect(offered.length).toBeGreaterThan(0)
    // Every offered square is accepted, whatever setup holds on it
    for (const square of offered) {
      const moved = setCapital(state, { playerId: CASH1981, ...cellOf(square), ...(square.direction === undefined ? {} : { direction: square.direction }) })
      expect(moved.ok, square.label).toBe(true)
    }
  })

  it('lists the square of the wonder Egypt placed on a central square, and the move onto it works', () => {
    let state = withCapital(revealed('Egyptians'))
    // Put the wonder on a central square of the tile that is in the capital's outskirts
    const central = stepOf(state, 'wonder').squares.find((square) => [1, 2].includes(square.column) && [1, 2].includes(square.row))
    if (central === undefined) throw new Error('no central wonder square')
    state = unwrap(placeSetupWonder(state, { playerId: CASH1981, ...cellOf(central), at: AT }))
    const squares = stepOf(state, 'capital').squares
    expect(squares.map((square) => square.label)).toContain(central.label)
    const moved = unwrap(setCapital(state, { playerId: CASH1981, ...cellOf(central), at: AT }))
    expect(capitalOf(moved, me(moved))).toBeDefined()
    expect(stepOf(moved, 'wonder').status).toBe('todo')
  })
})

describe('when setup opens', () => {
  const turnsDone = (state: GameState, upTo: number): GameState => ({
    ...state,
    players: state.players.map((player) => ({
      ...player,
      playerTurns: Array.from({ length: upTo }, (_, index) => ({
        ...createPlayerTurn(player.username, index + 1),
        done: { SOT: true, TRADE: true, CM: true, MOVEMENT: true, RESEARCH: true },
      })),
    })),
  })

  it('opens it for a reveal while the first Start of Turn is still to do, for any seat', () => {
    expect(me(revealed('Germans', fourColours(), KARANDRAS1), KARANDRAS1).setup?.required).toBe(true)
  })

  it('opens none for a reveal after the player marked turn 1 Start of Turn done: no setup, no tab, no gate', () => {
    const base = fourColours()
    const marked = unwrap(markPhasesDone(base, { playerId: CASH1981, turnNumber: 1, upToPhase: 'SOT', at: AT }))
    const state = revealed('Chinese', marked)
    expect(me(state).setup).toBeUndefined()
    expect(toPlayerView(state, CASH1981).you?.setup).toBeNull()
    expect(setupGateOf(state, me(state))).toBeUndefined()
    expect(unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE', at: AT }))).toBeDefined()
    expect(kindOf(setCapital(state, { playerId: CASH1981, column: 1, row: 1 }))).toBe('SETUP_REFUSED')
  })

  it('opens none for a reveal in a later turn', () => {
    const state = revealed('Germans', turnsDone(fourColours(), 2))
    expect(me(state).setup).toBeUndefined()
    expect(toPlayerView(state, CASH1981).you?.setup).toBeNull()
    expect(unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 3, upToPhase: 'SOT', at: AT }))).toBeDefined()
  })

  it('lets a player who marked Start of Turn done undo the reveal and reveal again without setup', () => {
    const marked = unwrap(markPhasesDone(fourColours(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'SOT', at: AT }))
    const state = revealed('Germans', marked)
    const entry = state.log.find((candidate) => candidate.logType === 'REVEAL' && candidate.item?.kind === 'civ')
    expect(entry !== undefined && canInitiateUndo(state, entry)).toBe(true)
  })
})

describe('saved games', () => {
  it('loads a save without any setup record and leaves it without one', () => {
    const state = fourColours()
    const older = { ...state, players: state.players.map(({ setup: _setup, ...player }) => player) }
    const migrated = migrateGameState(older as never)
    expect(migrated.players.every((player) => player.setup === undefined)).toBe(true)
    expect(migrated.players.every((player) => setupGateOf(migrated, player) === undefined)).toBe(true)
  })

  it('keeps a setup record through a load', () => {
    const state = withCapital(revealed('Germans'))
    expect(me(migrateGameState(state)).setup).toEqual(me(state).setup)
  })
})

/**
 * cash1981 has done every step and marked Start of Turn done: the capital, the figures, a policy (and for the Americans the
 * great person), the starting trade and, for Egypt, the wonder.
 */
function finishedGame(civ = 'Germans'): GameState {
  let state = withCapital(revealed(civ))
  const white = civ === 'Russians' || civ === 'Spanish'
  state = withFigures(state, white ? ['army', 'scout', 'white'] : ['army', 'scout'])
  if (civ === 'Americans') {
    state = unwrap(revealSocialPolicy(withPolicy(state, 'Pacifism'), { playerId: CASH1981, name: 'Pacifism' }))
    state = unwrap(performAssistedAction(state, { playerId: CASH1981, action: 'setupGreatPerson', requestId: 'gp-finish', at: AT }))
  } else {
    state = withPolicy(state)
    if (civ === 'French') state = withPolicy(state, secondPolicy(state))
  }
  if (civ === 'Egyptians') {
    const square = stepOf(state, 'wonder').squares[0]
    if (square === undefined) throw new Error('no wonder square')
    state = unwrap(placeSetupWonder(state, { playerId: CASH1981, ...cellOf(square), at: AT }))
  }
  state = unwrap(countSetupTrade(state, { playerId: CASH1981, at: AT }))
  return unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'SOT', at: AT }))
}

/** cash1981 has done every step but has not marked Start of Turn done. */
function completedGame(civ = 'Germans'): GameState {
  let state = withFigures(withCapital(revealed(civ)))
  state = withPolicy(state)
  return unwrap(countSetupTrade(state, { playerId: CASH1981, at: AT }))
}

describe('Finish setup', () => {
  const finish = (state: GameState, playerId = CASH1981) => finishSetupStep(state, { playerId, at: AT })
  const setupLines = (state: GameState) => state.log.filter((entry) => entry.logType === 'SETUP' && entry.publicLog === 'cash1981 finished setup')

  it('is refused while a step is missing, with the gate reason, and changes nothing', () => {
    const state = withCapital(revealed('Germans'))
    const refused = unwrapErr(finish(state))
    expect(refused).toEqual({ kind: 'SETUP_REFUSED', step: 'finish', reason: setupGateOf(state, me(state)) })
    expect(JSON.stringify(refused)).toContain('still to do: figures, social policy, starting trade')
    expect(me(state).setup?.finished).toBe(false)
  })

  it('finishes once every step is done: logs once, takes the tab away and marks no phase', () => {
    const state = completedGame()
    expect(setupView(state)?.blocksTurn).toBeNull()
    const done = unwrap(finish(state))
    expect(me(done).setup).toMatchObject({ required: true, finished: true })
    expect(setupLines(done)).toHaveLength(1)
    expect(setupView(done)).toBeNull()
    expect(me(done).playerTurns.find((turn) => turn.turnNumber === 1)?.done.SOT ?? false).toBe(false)
    // A repeat changes and logs nothing
    expect(unwrap(finish(done))).toBe(done)
    // Start of Turn done is allowed now and does not write the line a second time
    const marked = unwrap(markPhasesDone(done, { playerId: CASH1981, turnNumber: 1, upToPhase: 'SOT', at: AT }))
    expect(setupLines(marked)).toHaveLength(1)
    expect(me(marked).playerTurns.find((turn) => turn.turnNumber === 1)?.done.SOT).toBe(true)
  })

  it('and Start of Turn done without it still finishes setup once', () => {
    const marked = unwrap(markPhasesDone(completedGame(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'SOT', at: AT }))
    expect(setupLines(marked)).toHaveLength(1)
  })

  it('is refused without a civilization or without a setup', () => {
    expect(kindOf(finish(fourColours()))).toBe('SETUP_REFUSED')
    const legacy = revealed('Germans')
    const { setup: _setup, ...without } = me(legacy)
    void _setup
    const saved = { ...legacy, players: legacy.players.map((player) => (player.playerId === CASH1981 ? without : player)) }
    expect(kindOf(finish(saved))).toBe('SETUP_REFUSED')
  })

  it('keeps the steps open to a player who finished: setup is over for them', () => {
    const done = unwrap(finish(completedGame()))
    expect(kindOf(countSetupTrade(done, { playerId: CASH1981 }))).toBe('SETUP_REFUSED')
  })
})

describe('passing the turn on in setup', () => {
  const pass = (state: GameState, playerId = CASH1981) => passSetup(state, { playerId, at: AT })
  const passLines = (state: GameState) => state.log.filter((entry) => entry.logType === 'SETUP' && entry.publicLog.endsWith('passed the turn on in setup'))

  it('works right after the reveal, marks no phase, logs one public line and changes nothing else', () => {
    const state = revealed('Germans')
    const passed = unwrap(pass(state))
    expect(me(passed).setup).toEqual({ ...me(state).setup, passed: true })
    expect(passLines(passed).map((entry) => entry.publicLog)).toEqual(['cash1981 passed the turn on in setup'])
    expect(passLines(passed)[0]?.privateLog).toBe('')
    expect(me(passed).playerTurns).toEqual(me(state).playerTurns)
    expect(passed.board).toBe(state.board)
    expect(setupView(passed)).toMatchObject({ passed: true })
    expect(setupView(state)).toMatchObject({ passed: false })
    expect(setupGateOf(passed, me(passed))).toBe(setupGateOf(state, me(state)))
  })

  it('is idempotent: the same state, no second line', () => {
    const passed = unwrap(pass(revealed('Germans')))
    const again = unwrap(pass(passed))
    expect(again).toBe(passed)
    expect(passLines(again)).toHaveLength(1)
  })

  it('leaves every step doable, and Start of Turn still refused until setup is finished', () => {
    const passed = unwrap(pass(revealed('Germans')))
    const worked = withPolicy(withFigures(withCapital(passed)))
    expect(me(worked).setup?.passed).toBe(true)
    expect(kindOf(markPhasesDone(worked, { playerId: CASH1981, turnNumber: 1, upToPhase: 'SOT', at: AT }))).toBe('SETUP_INCOMPLETE')
    const finished = unwrap(finishSetupStep(unwrap(countSetupTrade(worked, { playerId: CASH1981, at: AT })), { playerId: CASH1981, at: AT }))
    expect(me(finished).setup).toMatchObject({ finished: true, passed: true })
  })

  it('is refused without a civilization, without a setup and after setup is over', () => {
    expect(kindOf(pass(fourColours()))).toBe('SETUP_REFUSED')
    expect(JSON.stringify(unwrapErr(pass(fourColours())))).toContain('Reveal your civilization first')
    const legacy = revealed('Germans')
    const { setup: _setup, ...without } = me(legacy)
    void _setup
    const saved = { ...legacy, players: legacy.players.map((player) => (player.playerId === CASH1981 ? without : player)) }
    expect(JSON.stringify(unwrapErr(pass(saved)))).toContain('You have no setup to do')
    const over = unwrap(finishSetupStep(completedGame(), { playerId: CASH1981, at: AT }))
    expect(JSON.stringify(unwrapErr(pass(over)))).toContain('Setup is over')
    expect(kindOf(pass(revealed('Germans'), 'nobody'))).toBe('NO_ACCESS')
  })

  it('names no card to the others and gives them no setup', () => {
    const passed = unwrap(pass(revealed('Americans')))
    const theirs = toPlayerView(passed, KARANDRAS1)
    expect(JSON.stringify(theirs.opponents)).not.toContain('passed')
    expect(JSON.stringify(theirs.opponents)).not.toContain('blocksTurn')
    expect(theirs.you?.setup).toBeNull()
    expect(theirs.log.filter((entry) => entry.logType === 'SETUP').map((entry) => entry.publicLog)).toEqual(['cash1981 passed the turn on in setup'])
    expect(toPlayerView(passed, CASH1981).you?.setup?.passed).toBe(true)
  })
})

describe('who holds the turn while setup is passed on', () => {
  const holderOf = (state: GameState) => turnHolder(state)?.username
  const pass = (state: GameState, playerId: string) => unwrap(passSetup(state, { playerId, at: AT }))
  const reveal = (state: GameState, playerId: string, civ = 'Germans') => revealed(civ, state, playerId)
  const sotDone = (state: GameState, playerId: string) => unwrap(markPhasesDone(state, { playerId, turnNumber: 1, upToPhase: 'SOT', at: AT }))

  it('changes nothing before somebody passes, even with players who have no civilization', () => {
    const state = revealed('Germans')
    expect(holderOf(state)).toBe('cash1981')
    expect(activeTurnStatus(state)?.stage).toBeUndefined()
  })

  it('goes to the next player without a civilization once the first one passed, and says it is the setup stage', () => {
    const state = pass(revealed('Germans'), CASH1981)
    expect(holderOf(state)).toBe('Karandras1')
    const status = activeTurnStatus(state)
    expect(status).toMatchObject({ username: 'Karandras1', stage: 'setup', phase: 'SOT' })
    expect(Object.keys(status ?? {})).toContain('stage')
  })

  it('walks the seats clockwise as each one reveals and passes, and ends on the first with an open setup', () => {
    let state = pass(revealed('Germans'), CASH1981)
    state = pass(reveal(state, KARANDRAS1, 'Chinese'), KARANDRAS1)
    expect(holderOf(state)).toBe('Itchi')
    // Itchi has revealed but not passed: the stage still waits for them
    state = reveal(state, ITCHI, 'Romans')
    expect(holderOf(state)).toBe('Itchi')
    expect(activeTurnStatus(state)?.stage).toBe('setup')
    state = pass(state, ITCHI)
    expect(holderOf(state)).toBe('Chul')
    state = pass(reveal(state, CHUL, 'Russians'), CHUL)
    // Everybody has passed: the normal rule lands on the first player, whose setup is open
    expect(holderOf(state)).toBe('cash1981')
    expect(activeTurnStatus(state)?.stage).toBeUndefined()
    expect(activeTurnStatus(state)?.phase).toBe('SOT')
  })

  it('starts from the start player and wraps around the table', () => {
    let state = pass(revealed('Germans', fourColours(), ITCHI), ITCHI)
    expect(turnHolder(state, 3)?.username).toBe('Chul')
    // Seat 3 starts, the stage wraps past seat 4 to seat 1
    state = pass(reveal(state, CHUL, 'Japanese'), CHUL)
    expect(turnHolder(state, 3)?.username).toBe('cash1981')
  })

  it('skips a player who finished setup, and one who marked Start of Turn done', () => {
    // cash1981 finishes without passing, Karandras1 passes, Itchi has no civilization yet
    let state = unwrap(finishSetupStep(completedGame(), { playerId: CASH1981, at: AT }))
    state = pass(reveal(state, KARANDRAS1, 'Chinese'), KARANDRAS1)
    expect(holderOf(state)).toBe('Itchi')
    // Itchi marks Start of Turn done (no setup record to gate): the stage moves on to Chul
    state = sotDone(state, ITCHI)
    expect(holderOf(state)).toBe('Chul')
    expect(activeTurnStatus(state)?.stage).toBe('setup')
  })

  it('falls back to the normal rule when nobody is left who needs a civilization or an unpassed setup', () => {
    // Two players have revealed and passed; the others have marked Start of Turn done
    let state = pass(revealed('Germans'), CASH1981)
    state = pass(reveal(state, KARANDRAS1, 'Chinese'), KARANDRAS1)
    state = sotDone(sotDone(state, ITCHI), CHUL)
    // Nobody waits for a civilization: the earliest open phase is Start of Turn, first open from the start player
    expect(holderOf(state)).toBe('cash1981')
    expect(activeTurnStatus(state)?.stage).toBeUndefined()
  })

  it('stays on when the passer finishes setup afterwards: the next player still chooses a civilization', () => {
    let state = pass(revealed('Germans'), CASH1981)
    expect(holderOf(state)).toBe('Karandras1')
    state = unwrap(finishSetupStep(unwrap(countSetupTrade(withPolicy(withFigures(withCapital(state))), { playerId: CASH1981, at: AT })), { playerId: CASH1981, at: AT }))
    expect(me(state).setup).toMatchObject({ finished: true, passed: true })
    expect(holderOf(state)).toBe('Karandras1')
    expect(activeTurnStatus(state)).toMatchObject({ username: 'Karandras1', stage: 'setup' })
    // The next player also passes: the normal rule applies, and cash1981 (setup finished, Start of Turn open) is first again
    state = pass(reveal(state, KARANDRAS1, 'Chinese'), KARANDRAS1)
    state = sotDone(sotDone(state, ITCHI), CHUL)
    expect(holderOf(state)).toBe('cash1981')
    expect(activeTurnStatus(state)?.stage).toBeUndefined()
    // Start of Turn done by cash1981 moves it to the player whose setup is open
    state = sotDone(state, CASH1981)
    expect(holderOf(state)).toBe('Karandras1')
  })

  it('ends when every passer has marked Start of Turn done', () => {
    let state = pass(revealed('Germans'), CASH1981)
    state = unwrap(finishSetupStep(unwrap(countSetupTrade(withPolicy(withFigures(withCapital(state))), { playerId: CASH1981, at: AT })), { playerId: CASH1981, at: AT }))
    state = sotDone(state, CASH1981)
    expect(activeTurnStatus(state)?.stage).toBeUndefined()
    expect(holderOf(state)).toBe('Karandras1')
  })

  it('gives the passer the out-of-turn draw refusal and the stage holder none (the same holder drives the warning)', () => {
    const state = pass(revealed('Germans'), CASH1981)
    expect(unwrapErr(draw(state, { playerId: CASH1981, sheetName: 'CIV' })).kind).toBe('NOT_YOUR_TURN')
    expect(draw(state, { playerId: KARANDRAS1, sheetName: 'CIV' }).ok).toBe(true)
  })

  it('drops the pass with the civilization reveal: undoing it returns the holder to that player', () => {
    // cash1981 and Karandras1 pass; the turn goes to Itchi
    let state = pass(revealed('Germans'), CASH1981)
    state = pass(reveal(state, KARANDRAS1, 'Chinese'), KARANDRAS1)
    expect(holderOf(state)).toBe('Itchi')
    const entry = state.log.find((candidate) => candidate.logType === 'REVEAL' && candidate.item?.kind === 'civ' && candidate.playerId === CASH1981)
    if (entry === undefined) throw new Error('no reveal line')
    state = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
    for (const playerId of [KARANDRAS1, ITCHI, CHUL]) state = unwrap(vote(state, { logId: entry.id, playerId, vote: true }))
    expect(me(state).civilization).toBeNull()
    expect(me(state).setup).toBeUndefined()
    // Karandras1's pass keeps the stage on, and cash1981 has no civilization again
    expect(holderOf(state)).toBe('cash1981')
    expect(activeTurnStatus(state)?.stage).toBe('setup')
  })

  it('does not come back in turn 2 from a stale pass, and picks no seat without a civilization there', () => {
    // cash1981 passed in turn 1; Karandras1 never revealed a civilization. Every player's turn 1 is over (set directly)
    const passed = pass(revealed('Germans'), CASH1981)
    const over: GameState = {
      ...passed,
      players: passed.players.map((player) => ({
        ...player,
        playerTurns: [{ ...createPlayerTurn(player.username, 1), done: { SOT: true, TRADE: true, CM: true, MOVEMENT: true, RESEARCH: true } }],
      })),
    }
    const second = turnStatus(over)
    expect(second.currentTurn).toBe(2)
    expect(me(over).setup?.passed).toBe(true)
    const status = activeTurnStatus(over)
    expect(status?.turnNumber).toBe(2)
    expect(status?.stage).toBeUndefined()
    // The holder is the normal one: the same as with the stale flag stripped
    const stripped: GameState = {
      ...over,
      players: over.players.map((player) => (player.setup === undefined ? player : { ...player, setup: { ...player.setup, passed: false } })),
    }
    expect(holderOf(over)).toBe(holderOf(stripped))
    expect(activeTurnStatus(over)?.username).toBe(activeTurnStatus(stripped)?.username)
  })

  it('is off once the passer has marked Start of Turn done, in turn 1 and after', () => {
    let state = unwrap(passSetup(completedGame(), { playerId: CASH1981, at: AT }))
    expect(activeTurnStatus(state)?.stage).toBe('setup')
    state = sotDone(unwrap(finishSetupStep(state, { playerId: CASH1981, at: AT })), CASH1981)
    // Karandras1 has no civilization, but nobody waits for one any more
    expect(activeTurnStatus(state)?.stage).toBeUndefined()
    expect(holderOf(state)).toBe('Karandras1')
    // Reopening Start of Turn puts the pass back in play, as setup itself reopens with it
    const reopened = unwrap(unmarkPhaseDone(state, { playerId: CASH1981, turnNumber: 1, phase: 'SOT' }))
    expect(activeTurnStatus(reopened)?.stage).toBe('setup')
    // Turn 2: everybody has ended turn 1
    for (const playerId of [CASH1981, KARANDRAS1, ITCHI, CHUL]) {
      state = unwrap(markPhasesDone(state, { playerId, turnNumber: 1, upToPhase: 'RESEARCH', at: AT }))
    }
    const status = activeTurnStatus(state)
    expect(status?.turnNumber).toBe(2)
    expect(status?.stage).toBeUndefined()
  })

  it('works with two and with three players', () => {
    const two = createGame({
      name: 'Two',
      numOfPlayers: 2,
      seed: 'two',
      players: [
        { playerId: CASH1981, username: 'cash1981', color: 'Red', gameCreator: true, yourTurn: true },
        { playerId: KARANDRAS1, username: 'Karandras1', color: 'Blue' },
      ],
    })
    let state = pass(revealed('Germans', two), CASH1981)
    expect(holderOf(state)).toBe('Karandras1')
    state = pass(reveal(state, KARANDRAS1, 'Chinese'), KARANDRAS1)
    expect(holderOf(state)).toBe('cash1981')

    const three = createGame({
      name: 'Three',
      numOfPlayers: 3,
      seed: 'three',
      players: [
        { playerId: CASH1981, username: 'cash1981', color: 'Red', gameCreator: true, yourTurn: true },
        { playerId: KARANDRAS1, username: 'Karandras1', color: 'Blue' },
        { playerId: ITCHI, username: 'Itchi', color: 'Green' },
      ],
    })
    state = pass(revealed('Germans', three), CASH1981)
    expect(holderOf(state)).toBe('Karandras1')
    state = pass(reveal(state, KARANDRAS1, 'Chinese'), KARANDRAS1)
    expect(holderOf(state)).toBe('Itchi')
  })
})
