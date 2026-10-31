/**
 * A. P. Giannini: "Each time you invest a coin, build an unlocked building in one of your cities for free."
 * Each test names the printed ability it covers.
 *
 * The scene: America, a red capital on B2 and a red city on E2, Start of Turn open, Writing (Library) and
 * Pottery (Granary) revealed, one coin on the sheet.
 */

import { describe, expect, it } from 'vitest'

import { placePiece, undoLastBoardChange } from '../src/actions/board.js'
import { chooseTech, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { mapCellOf } from '../src/blockade.js'
import { assistedAvailability, cityActionsTakenThisTurn, performAssistedAction } from '../src/assisted.js'
import { SQUARE_SIZE, areaAt, boardAreas, findBoardAsset, mapTop, slotOrigin } from '../src/board.js'
import type { BoardPiece } from '../src/board.js'
import { freeBuildingChoicesOf } from '../src/build-options.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { GameState, Playerhand } from '../src/state.js'

import { withCardInHand } from './assisted-fixture.js'
import { withStats } from './culture-advance-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-10-31T10:00:00.000Z'
const OTHERS = [KARANDRAS1, ITCHI, CHUL]
const LIBRARY = 'buildings/library'
const MARKET = 'buildings/market'
const TEMPLE = 'buildings/temple'
const UNIVERSITY = 'buildings/university'
const SCIENTIST = 'great people/scientist'

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

/** Start of Turn is open (no phase is marked done), with the techs revealed and a coin to invest. */
function scene(extraTechs: readonly string[] = []): GameState {
  const colors: Record<string, string> = { [CASH1981]: 'Red', [KARANDRAS1]: 'Blue', [ITCHI]: 'Green', [CHUL]: 'Yellow' }
  const base = firstCivGame()
  let state: GameState = { ...base, players: base.players.map((p) => ({ ...p, color: colors[p.playerId] ?? p.color })) }
  const slot = state.board.slots[0]
  if (slot === undefined) throw new Error('no slot')
  const [x, y] = slotOrigin(state.board, slot)
  state = unwrap(placePiece(state, { playerId: CASH1981, assetId: 'tiles/america', x, y }))
  state = put(state, 'cities/redcapital2', 1, 1)
  state = put(state, 'cities/redcity2', 4, 1)
  for (const techName of ['Writing', 'Pottery', ...extraTechs]) {
    state = unwrap(chooseTech(state, { playerId: CASH1981, techName }))
    state = unwrap(revealTech(state, { playerId: CASH1981, techName }))
  }
  const coins = me(state).stats.coinSources
  return withStats(state, { coinSources: { ...coins, sheet: 2 } })
}

const me = (state: GameState, playerId = CASH1981): Playerhand => {
  const found = findPlayer(state, playerId)
  if (found === undefined) throw new Error(`no player ${playerId}`)
  return found
}

const revealCard = (state: GameState, itemId: string): GameState => ({
  ...state,
  players: state.players.map((candidate) =>
    candidate.playerId === CASH1981
      ? { ...candidate, items: candidate.items.map((item) => (item.id === itemId ? { ...item, hidden: false } : item)) }
      : candidate,
  ),
})

/** Giannini in the hand, faceup as the Play button leaves him. */
function withGianniniFaceup(state: GameState): { readonly state: GameState; readonly itemId: string } {
  const card = withCardInHand(state, 'A. P. Giannini')
  return { itemId: card.itemId, state: revealCard(card.state, card.itemId) }
}

const invest = (state: GameState, requestId = 'inv-1') =>
  performAssistedAction(state, {
    playerId: CASH1981,
    action: 'invest',
    requestId,
    at: AT,
    payload: { source: 'sheet', card: 'infra' },
  })

const freeBuild = (state: GameState, payload: Record<string, unknown>, requestId = 'free-1') =>
  performAssistedAction(state, {
    playerId: CASH1981,
    action: 'gianniniBuild',
    requestId,
    at: AT,
    payload: payload as never,
  })

const status = (state: GameState) => assistedAvailability(state, CASH1981, 'gianniniBuild')

/** The first square of a building in the choices, as a payload. */
function firstSquare(state: GameState, assetId: string) {
  const square = freeBuildingChoicesOf(state, me(state)).find((choice) => choice.assetId === assetId)?.squares[0]
  if (square === undefined) throw new Error(`no square for ${assetId}`)
  return { cityPieceId: square.cityPieceId, assetId, column: square.column, row: square.row, label: square.label }
}

const libraries = (state: GameState) => state.board.pieces.filter((piece) => piece.assetId === LIBRARY)

function undoByVote(state: GameState, requestId: string): GameState {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line for the action')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of OTHERS) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  return next
}

function undoRejection(state: GameState, requestId: string) {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line for the action')
  let pending = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of OTHERS.slice(0, -1)) pending = unwrap(vote(pending, { logId: entry.id, playerId, vote: true, at: AT }))
  return vote(pending, { logId: entry.id, playerId: OTHERS[2] as string, vote: true, at: AT })
}

/** Giannini faceup and a coin invested: the state in which the free building is ready. */
function invested(): GameState {
  return unwrap(invest(withGianniniFaceup(scene()).state))
}

/** The same, with more techs revealed and pieces put on the board before the invest. */
function investedWith(techs: readonly string[], setup: (state: GameState) => GameState): GameState {
  return unwrap(invest(withGianniniFaceup(setup(scene(techs))).state))
}

describe('A. P. Giannini', () => {
  it('offers no free building before a coin is invested', () => {
    const state = withGianniniFaceup(scene()).state
    expect(status(state).status).toBe('unavailable')
    expect(status(state).reason).toContain('Invest a coin')
    expect(toPlayerView(state, CASH1981).you?.startOfTurn?.giannini).toMatchObject({ status: 'unavailable', choices: [] })
  })

  it('is not offered once Start of Turn is over', () => {
    const state = unwrap(markPhasesDone(invested(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'SOT' }))
    expect(status(state).status).toBe('wrong-phase')
  })

  it('cannot have his card undone while the free building stands, and can after the building is undone', () => {
    const card = withCardInHand(scene(), 'A. P. Giannini')
    const faceup = unwrap(
      performAssistedAction(card.state, {
        playerId: CASH1981,
        action: 'playCard',
        requestId: 'play-g',
        at: AT,
        payload: { itemId: card.itemId, targets: [] },
      }),
    )
    const built = unwrap(freeBuild(unwrap(invest(faceup)), firstSquare(unwrap(invest(faceup)), LIBRARY)))
    expect(JSON.stringify(unwrapErr(undoRejection(built, 'play-g')))).toContain('Undo that building first')
    const buildingUndone = undoByVote(built, 'free-1')
    const investUndone = undoByVote(buildingUndone, 'inv-1')
    expect(me(undoByVote(investUndone, 'play-g')).items.some((item) => item.id === card.itemId)).toBe(true)
  })

  it('has no section at all while his card is not faceup', () => {
    const hidden = withCardInHand(scene(), 'A. P. Giannini').state
    expect(toPlayerView(hidden, CASH1981).you?.startOfTurn?.giannini).toBeNull()
    expect(toPlayerView(scene(), CASH1981).you?.startOfTurn?.giannini).toBeNull()
  })

  it('builds an unlocked building for free after the invest, in one of the cities, and says so', () => {
    const state = invested()
    expect(status(state).status).toBe('ready')
    const choices = freeBuildingChoicesOf(state, me(state))
    expect(choices.map((choice) => choice.assetId)).toContain(LIBRARY)
    expect(toPlayerView(state, CASH1981).you?.startOfTurn?.giannini).toMatchObject({ status: 'ready', choices })

    const target = firstSquare(state, LIBRARY)
    const built = unwrap(freeBuild(state, target))
    expect(libraries(built)).toHaveLength(1)
    expect(built.log.at(-1)?.publicLog).toBe(`cash1981 built a Library on ${target.label} for free with A. P. Giannini`)
    // Free: no trade is paid, and it is not a city action (no Lovelace credit, no "has already acted")
    expect(me(built).stats.trade).toBe(me(state).stats.trade)
    expect(cityActionsTakenThisTurn(built, me(built), target.cityPieceId)).toEqual([])
    expect(status(built).status).toBe('used')
    expect(toPlayerView(built, CASH1981).you?.startOfTurn?.giannini).toMatchObject({ status: 'used', choices: [] })
  })

  it('lists only buildings the player has unlocked, and refuses one that is not', () => {
    const state = invested()
    const ids = freeBuildingChoicesOf(state, me(state)).map((choice) => choice.assetId)
    expect(ids).toEqual(expect.arrayContaining([LIBRARY, 'buildings/granary']))
    expect(ids).not.toContain(MARKET)
    const square = firstSquare(state, LIBRARY)
    const refused = freeBuild(state, { ...square, assetId: MARKET })
    expect(refused.ok).toBe(false)
    expect(libraries(unwrap(freeBuild(state, square)))).toHaveLength(1)
    expect(state.board.pieces.some((piece) => piece.assetId === MARKET)).toBe(false)
  })

  it('gives one building for one invest: a second free building the same turn is refused', () => {
    const state = invested()
    const built = unwrap(freeBuild(state, firstSquare(state, LIBRARY)))
    const second = freeBuild(built, firstSquare(built, LIBRARY), 'free-2')
    expect(second.ok).toBe(false)
    expect(JSON.stringify(unwrapErr(second))).toContain('already been done')
    expect(libraries(built)).toHaveLength(1)
  })

  it('gives nothing for a coin invested while the card was facedown, even if he is revealed afterwards', () => {
    const card = withCardInHand(scene(), 'A. P. Giannini')
    const afterInvest = unwrap(invest(card.state))
    const revealed = revealCard(afterInvest, card.itemId)
    expect(status(revealed).status).toBe('unavailable')
    expect(freeBuild(revealed, { cityPieceId: 'x', assetId: LIBRARY, column: 2, row: 1 }).ok).toBe(false)
    expect(toPlayerView(revealed, CASH1981).you?.startOfTurn?.giannini).toMatchObject({ status: 'unavailable', choices: [] })
  })

  it('refuses a square that is not legal, an off-map one and a malformed payload, and changes nothing', () => {
    const state = invested()
    const good = firstSquare(state, LIBRARY)
    // The capital's own square, a square far from any city and a city that is not the player's
    const bad = [
      { ...good, column: 1, row: 1 },
      { ...good, column: 40, row: 40 },
      { ...good, column: -1 },
      { ...good, row: 1.5 },
      { ...good, column: 1000 },
      { ...good, cityPieceId: 'nobody' },
      { ...good, assetId: 'buildings/nothing' },
      { cityPieceId: good.cityPieceId, assetId: LIBRARY },
    ]
    for (const payload of bad) {
      const refused = freeBuild(state, payload)
      expect(refused.ok).toBe(false)
    }
    expect(JSON.stringify(unwrapErr(freeBuild(state, { ...good, column: 1, row: 1 })))).toContain('B2')
    expect(state.assistedActions).toHaveLength(1)
    expect(status(state).status).toBe('ready')
  })

  it('no longer lists a square that a building fills as an empty one, only as one that building would be replaced on', () => {
    const state = invested()
    const good = firstSquare(state, LIBRARY)
    const built = unwrap(freeBuild(state, good))
    // As in Build, the filled square is still a square for a building that replaces it, and says so; it is no longer a plain one
    const left = freeBuildingChoicesOf(built, me(built)).flatMap((choice) => choice.squares)
    const there = left.filter((square) => square.column === good.column && square.row === good.row)
    expect(there.length).toBeGreaterThan(0)
    expect(there.every((square) => square.replaces?.assetId === LIBRARY)).toBe(true)
  })

  it('keeps the board Undo from taking the building off alone, before or after the vote', () => {
    const state = invested()
    const built = unwrap(freeBuild(state, firstSquare(state, LIBRARY)))
    expect(unwrapErr(undoLastBoardChange(built, CASH1981)).kind).toBe('BOARD_UNDO_ASSISTED')

    const undone = undoByVote(built, 'free-1')
    expect(undone.board.redo).toEqual([])
    expect(undoLastBoardChange(undone, CASH1981).ok).toBe(false)
  })

  it('takes the building off on the voted undo and frees the credit', () => {
    const state = invested()
    const target = firstSquare(state, LIBRARY)
    const built = unwrap(freeBuild(state, target))
    const undone = undoByVote(built, 'free-1')
    expect(libraries(undone)).toHaveLength(0)
    expect(status(undone).status).toBe('ready')
    expect(undone.log.at(-1)?.publicLog).toContain('free Library from A. P. Giannini was undone')
    const again = unwrap(freeBuild(undone, target, 'free-2'))
    expect(libraries(again)).toHaveLength(1)
  })

  it('refuses to undo the building once it has been moved', () => {
    const state = invested()
    const built = unwrap(freeBuild(state, firstSquare(state, LIBRARY)))
    const piece = libraries(built)[0]
    if (piece === undefined) throw new Error('no library')
    const moved = { ...built, board: { ...built.board, pieces: built.board.pieces.map((p) => (p.id === piece.id ? { ...p, x: p.x + 4 * SQUARE_SIZE } : p)) } }
    expect(unwrapErr(undoRejection(moved, 'free-1')).kind).toBe('ASSISTED_UNDO_BLOCKED')
  })

  it('refuses the undo while a later build that replaced the free building can still put it back', () => {
    const state = invested()
    const built = unwrap(freeBuild(state, firstSquare(state, LIBRARY)))
    const piece = libraries(built)[0]
    if (piece === undefined) throw new Error('no library')
    const gone = { ...built, board: { ...built.board, pieces: built.board.pieces.filter((p) => p.id !== piece.id) } }
    const replacing = {
      ...gone,
      assistedActions: [
        ...gone.assistedActions,
        {
          id: 'later-build',
          kind: 'build' as const,
          playerId: CASH1981,
          turnNumber: 1,
          phase: 'CM' as const,
          usageKey: null,
          at: AT,
          logId: 'later-build-log',
          status: 'applied' as const,
          effect: { kind: 'build', replaced: { piece, historyId: 'h' } } as never,
        },
      ],
    }
    expect(JSON.stringify(unwrapErr(undoRejection(replacing, 'free-1')))).toContain('Undo that first')
  })

  it('lets the undo through when the building was taken off by hand, so the investment is not stuck', () => {
    const state = invested()
    const built = unwrap(freeBuild(state, firstSquare(state, LIBRARY)))
    const piece = libraries(built)[0]
    if (piece === undefined) throw new Error('no library')
    const gone = { ...built, board: { ...built.board, pieces: built.board.pieces.filter((p) => p.id !== piece.id) } }
    const undone = undoByVote(gone, 'free-1')
    expect(status(undone).status).toBe('ready')
    const investUndone = undoByVote(undone, 'inv-1')
    expect(me(investUndone).stats.coinSources.sheet).toBe(2)
  })

  it('refuses to undo the invest while the free building stands, and allows it once the building is undone', () => {
    const state = invested()
    const built = unwrap(freeBuild(state, firstSquare(state, LIBRARY)))
    const refused = undoRejection(built, 'inv-1')
    expect(unwrapErr(refused)).toMatchObject({ kind: 'ASSISTED_UNDO_BLOCKED', reason: 'Undo the free building from A. P. Giannini first.' })

    const buildingUndone = undoByVote(built, 'free-1')
    const investUndone = undoByVote(buildingUndone, 'inv-1')
    expect(me(investUndone).stats.coinSources.sheet).toBe(2)
    expect(status(investUndone).status).toBe('unavailable')
  })

  it('shows the choices to the player only', () => {
    const state = invested()
    const mine = toPlayerView(state, CASH1981)
    expect(mine.you?.startOfTurn?.giannini?.choices.length).toBeGreaterThan(0)

    const theirs = toPlayerView(state, KARANDRAS1)
    expect(theirs.you?.startOfTurn?.giannini).toBeNull()
    const serialised = JSON.stringify(theirs)
    // The other player sees the public line of the invest, not his choices, and no effect
    expect(serialised).not.toContain('cityLabel')
    expect(serialised).not.toContain('"giannini":true')
    expect(JSON.stringify(theirs.opponents)).not.toContain('giannini')
  })

  it('is not mistaken for a Devote to the Arts payload', () => {
    const state = invested()
    const refused = performAssistedAction(state, {
      playerId: CASH1981,
      action: 'devoteToTheArts',
      requestId: 'devote-1',
      at: AT,
      payload: firstSquare(state, LIBRARY) as never,
    })
    expect(refused.ok).toBe(false)
    expect(libraries(state)).toHaveLength(0)
  })
})

describe('A. P. Giannini: a building that replaces one', () => {
  // The capital is on B2. A2 (column 0, row 1) holds the Temple, a limited ("star") building, so a Market (also limited) may only go there
  const A2 = { column: 0, row: 1 }
  const C2 = { column: 2, row: 1 }
  const withTemple = (state: GameState): GameState => put(state, TEMPLE, A2.column, A2.row)
  const piecesOf = (state: GameState, assetId: string): readonly BoardPiece[] => state.board.pieces.filter((piece) => piece.assetId === assetId)
  const capitalSquares = (state: GameState, assetId: string) =>
    (freeBuildingChoicesOf(state, me(state)).find((choice) => choice.assetId === assetId)?.squares ?? []).filter(
      (square) => square.cityLabel.includes('B2'),
    )
  const marketOnTemple = (state: GameState) => ({
    ...firstSquare(state, MARKET),
    ...A2,
  })
  const templeScene = (): GameState => investedWith(['Currency'], withTemple)

  it('offers a limited building in a city that has one only on that building, saying what it replaces', () => {
    const state = templeScene()
    expect(capitalSquares(state, MARKET)).toEqual([
      expect.objectContaining({ ...A2, label: 'A2', replaces: { assetId: TEMPLE, label: 'Temple', kind: 'building' } }),
    ])
    expect(capitalSquares(state, MARKET)[0]?.note).toContain('Replaces your Temple')
    // The other city has no limited building: its squares are empty ones
    const elsewhere = (freeBuildingChoicesOf(state, me(state)).find((choice) => choice.assetId === MARKET)?.squares ?? []).filter(
      (square) => !square.cityLabel.includes('B2'),
    )
    expect(elsewhere.length).toBeGreaterThan(0)
    expect(elsewhere.every((square) => square.replaces === undefined)).toBe(true)
    expect(toPlayerView(state, CASH1981).you?.startOfTurn?.giannini?.choices).toEqual(freeBuildingChoicesOf(state, me(state)))
  })

  it('takes the old building off, builds the new one on its square and says so in the log', () => {
    const state = templeScene()
    const temple = piecesOf(state, TEMPLE)[0] as BoardPiece
    const built = unwrap(freeBuild(state, marketOnTemple(state)))
    expect(piecesOf(built, TEMPLE)).toEqual([])
    const market = piecesOf(built, MARKET)
    expect(market).toHaveLength(1)
    expect(mapCellOf(built.board, market[0] as BoardPiece)).toEqual(A2)
    expect(built.log.at(-1)?.publicLog).toBe('cash1981 built a Market on A2 for free with A. P. Giannini, replacing the Temple')
    const effect = built.assistedActions.find((record) => record.id === 'free-1')?.effect
    if (effect?.kind !== 'gianniniBuild') throw new Error('no free building')
    expect(effect.replaced?.piece).toEqual(temple)
    expect(effect.reserved).toBeUndefined()
    // The removal belongs to the same log line as the placement, so stepping through the history shows them together
    const removal = built.board.history.find((entry) => entry.id === effect.replaced?.historyId)
    expect(removal?.change.kind).toBe('remove')
    expect(removal?.logLength).toBe(built.log.length)
    expect(built.board.history.find((entry) => entry.id === effect.historyId)?.logLength).toBe(built.log.length)
    expect(me(built).stats.trade).toBe(me(state).stats.trade)
  })

  it('puts the exact old building back on the voted undo, and the free building can be taken again', () => {
    const state = templeScene()
    const temple = piecesOf(state, TEMPLE)[0] as BoardPiece
    const built = unwrap(freeBuild(state, marketOnTemple(state)))
    const undone = undoByVote(built, 'free-1')
    expect(piecesOf(undone, MARKET)).toEqual([])
    expect(piecesOf(undone, TEMPLE)).toEqual([temple])
    expect(undone.log.at(-1)?.publicLog).toBe(
      "System: cash1981's free Market from A. P. Giannini was undone: it is off A2 and the free building can be taken again, and the Temple it replaced was put back",
    )
    expect(status(undone).status).toBe('ready')
    expect(piecesOf(unwrap(freeBuild(undone, marketOnTemple(undone), 'free-2')), MARKET)).toHaveLength(1)
  })

  it('keeps the board Undo from taking either the new building or the removal alone', () => {
    const built = unwrap(freeBuild(templeScene(), marketOnTemple(templeScene())))
    expect(unwrapErr(undoLastBoardChange(built, CASH1981)).kind).toBe('BOARD_UNDO_ASSISTED')
    // The removal is the entry before the placement: with the placement out of the way it is the last one
    const effect = built.assistedActions.find((record) => record.id === 'free-1')?.effect
    if (effect?.kind !== 'gianniniBuild') throw new Error('no free building')
    const lastIsRemoval = { ...built, board: { ...built.board, history: built.board.history.filter((entry) => entry.id !== effect.historyId) } }
    expect(lastIsRemoval.board.history.at(-1)?.id).toBe(effect.replaced?.historyId)
    expect(unwrapErr(undoLastBoardChange(lastIsRemoval, CASH1981)).kind).toBe('BOARD_UNDO_ASSISTED')
    // After the vote the entries are ordinary again, but the board Undo may not walk back past the undo's own entries
    expect(undoByVote(built, 'free-1').board.redo).toEqual([])
  })

  it('refuses the undo while the new building has been moved, and puts the old one back when it was taken off by hand', () => {
    const state = templeScene()
    const temple = piecesOf(state, TEMPLE)[0] as BoardPiece
    const built = unwrap(freeBuild(state, marketOnTemple(state)))
    const market = piecesOf(built, MARKET)[0] as BoardPiece
    const moved = { ...built, board: { ...built.board, pieces: built.board.pieces.map((p) => (p.id === market.id ? { ...p, x: p.x + 4 * SQUARE_SIZE } : p)) } }
    expect(unwrapErr(undoRejection(moved, 'free-1')).kind).toBe('ASSISTED_UNDO_BLOCKED')
    expect(piecesOf(moved, TEMPLE)).toEqual([])

    const gone = { ...built, board: { ...built.board, pieces: built.board.pieces.filter((p) => p.id !== market.id) } }
    const undone = undoByVote(gone, 'free-1')
    expect(piecesOf(undone, TEMPLE)).toEqual([temple])
    expect(status(undone).status).toBe('ready')
  })

  it('refuses to undo the invest while the replacing building stands, and allows it once that is undone', () => {
    const state = templeScene()
    const built = unwrap(freeBuild(state, marketOnTemple(state)))
    expect(unwrapErr(undoRejection(built, 'inv-1'))).toMatchObject({
      kind: 'ASSISTED_UNDO_BLOCKED',
      reason: 'Undo the free building from A. P. Giannini first.',
    })
    const investUndone = undoByVote(undoByVote(built, 'free-1'), 'inv-1')
    expect(me(investUndone).stats.coinSources.sheet).toBe(2)
    expect(piecesOf(investUndone, TEMPLE)).toHaveLength(1)
  })

  it('refuses a limited building on a square that does not hold the city\'s limited building, and changes nothing', () => {
    const state = investedWith(['Currency'], (base) => put(withTemple(base), LIBRARY, C2.column, C2.row))
    // The Library's square is not the Temple's, an empty one is not either: a city holds one limited building
    for (const square of [C2, { column: 1, row: 0 }]) {
      const refused = freeBuild(state, { ...marketOnTemple(state), ...square })
      expect(refused.ok).toBe(false)
    }
    expect(JSON.stringify(unwrapErr(freeBuild(state, { ...marketOnTemple(state), ...C2 })))).toContain('Temple')
    expect(state.assistedActions).toHaveLength(1)
    expect(piecesOf(state, MARKET)).toEqual([])
    expect(piecesOf(state, TEMPLE)).toHaveLength(1)
    // The Temple's own square is fine
    expect(freeBuild(state, marketOnTemple(state)).ok).toBe(true)
  })

  it('leaves a building that is not limited on the empty squares of a city with a Temple', () => {
    const state = templeScene()
    const squares = capitalSquares(state, 'buildings/granary')
    expect(squares.length).toBeGreaterThan(0)
    expect(squares.every((square) => square.replaces === undefined)).toBe(true)
    expect(squares.some((square) => square.column === A2.column && square.row === A2.row)).toBe(false)
    const built = unwrap(freeBuild(state, firstSquare(state, 'buildings/granary')))
    expect(piecesOf(built, TEMPLE)).toHaveLength(1)
    expect(built.log.at(-1)?.publicLog).not.toContain('replacing')
  })

  it('lets a building with none left in the supply replace only one of its own supply', () => {
    // Five Libraries far away and the player's own on C2 are the six of the Library; a Granary on A2 is of another supply
    const far = (state: GameState): GameState =>
      Array.from({ length: 5 }, (_, index) => index).reduce(
        (next, index) => put(next, LIBRARY, 6 + index, 8),
        put(put(state, LIBRARY, C2.column, C2.row), 'buildings/granary', A2.column, A2.row),
      )
    const state = investedWith([], far)
    expect(capitalSquares(state, LIBRARY)).toEqual([
      expect.objectContaining({ ...C2, replaces: { assetId: LIBRARY, label: 'Library', kind: 'building' } }),
    ])
    // The other city has no Library to replace, so nothing there
    expect(freeBuildingChoicesOf(state, me(state)).find((choice) => choice.assetId === LIBRARY)?.squares).toHaveLength(1)
    // Another building is not held back by the Library's supply and still sees the squares as before
    expect(freeBuild(state, { ...firstSquare(state, LIBRARY), ...A2 }).ok).toBe(false)
    const built = unwrap(freeBuild(state, firstSquare(state, LIBRARY)))
    expect(piecesOf(built, LIBRARY)).toHaveLength(6)
    expect(built.log.at(-1)?.publicLog).toContain('replacing the Library')
    // With the whole supply on the board and none of the player's own to replace, the building is not offered at all
    const none = investedWith(['Printing Press'], (base) =>
      Array.from({ length: 5 }, (_, index) => index).reduce((next, index) => put(next, LIBRARY, 6 + index, 8), put(base, UNIVERSITY, 11, 8)),
    )
    expect(freeBuildingChoicesOf(none, me(none)).find((choice) => choice.assetId === UNIVERSITY)).toBeUndefined()
  })

  describe('a Great Person on the square', () => {
    const withPerson = (state: GameState): GameState => put(state, SCIENTIST, C2.column, C2.row)
    const areaOwnerOf = (state: GameState, piece: BoardPiece): string | undefined =>
      areaAt(boardAreas(state.board, state.players), piece.x + piece.width / 2, piece.y + piece.height / 2)?.playerId
    const libraryOnPerson = (state: GameState) => ({ ...firstSquare(state, LIBRARY), ...C2 })

    it('is offered as a replacement, goes to the player area and comes back on the voted undo', () => {
      const state = investedWith([], withPerson)
      expect(capitalSquares(state, LIBRARY).find((square) => square.column === C2.column)?.replaces).toEqual({
        assetId: SCIENTIST,
        label: 'Scientist',
        kind: 'greatperson',
      })
      const person = piecesOf(state, SCIENTIST)[0] as BoardPiece
      const built = unwrap(freeBuild(state, libraryOnPerson(state)))
      const held = piecesOf(built, SCIENTIST)[0] as BoardPiece
      expect(held.id).toBe(person.id)
      expect(mapCellOf(built.board, held)).toBeNull()
      expect(areaOwnerOf(built, held)).toBe(CASH1981)
      expect(built.log.at(-1)?.publicLog).toBe(
        'cash1981 built a Library on C2 for free with A. P. Giannini, replacing the Scientist (Great Person), which goes back to the player area',
      )
      const effect = built.assistedActions.find((record) => record.id === 'free-1')?.effect
      if (effect?.kind !== 'gianniniBuild') throw new Error('no free building')
      expect(effect.reserved?.piece).toEqual(person)
      expect(effect.replaced).toBeUndefined()
      expect(unwrapErr(undoLastBoardChange(built, CASH1981)).kind).toBe('BOARD_UNDO_ASSISTED')

      const undone = undoByVote(built, 'free-1')
      expect(piecesOf(undone, SCIENTIST)).toEqual([person])
      expect(piecesOf(undone, LIBRARY)).toEqual([])
      expect(undone.log.at(-1)?.publicLog).toContain('and the Scientist it replaced was put back')
    })

    it('refuses the undo when the Great Person has been placed somewhere else since', () => {
      const state = investedWith([], withPerson)
      const built = unwrap(freeBuild(state, libraryOnPerson(state)))
      const held = piecesOf(built, SCIENTIST)[0] as BoardPiece
      const elsewhere = {
        ...built,
        board: { ...built.board, pieces: built.board.pieces.map((p) => (p.id === held.id ? { ...p, x: C2.column * SQUARE_SIZE, y: mapTop(built.board) + 3 * SQUARE_SIZE } : p)) },
      }
      const refused = undoRejection(elsewhere, 'free-1')
      expect(unwrapErr(refused)).toMatchObject({ kind: 'ASSISTED_UNDO_BLOCKED' })
      expect(JSON.stringify(unwrapErr(refused))).toContain('Scientist')
      // Nothing was changed by the refusal
      expect(piecesOf(elsewhere, LIBRARY)).toHaveLength(1)
    })
  })
})
