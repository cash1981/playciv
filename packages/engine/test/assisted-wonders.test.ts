/**
 * The Build action for wonders (base rules p. 17): a city produces one of the wonders
 * faceup in the market (its cost is a lower one with the tech named on the card), and the
 * wonder stands in the city's outskirts and belongs to the player. One wonder
 * per city, any terrain but water. Buildings are tested in `assisted-build.test.ts`.
 *
 * The scene is that file's: Cash is Red on Monarchy and the America tile lies in the
 * first map slot with a red city on its square B2, whose outskirts are A1 mountain, B1
 * mountain, C1 water, A2 forest, C2 grassland, A3 desert, B3 desert and C3 mountain.
 * The market is the shared Wonders area: the test puts the wonders it needs there. The
 * cost of a wonder is checked against production and the rest rushed with trade, as for
 * a building, and building one draws the next into the market (four of each era, ancient first), from a
 * deck the test sets up so the draws are known.
 */

import { describe, expect, it } from 'vitest'

import {
  movePiece,
  placePiece,
  removePiece,
  setCityProductionOverride,
  setWonderOwner,
  undoLastBoardChange,
} from '../src/actions/board.js'
import { chooseTech, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { performAssistedAction, takeBackOpenBuild } from '../src/assisted.js'
import { mapCellOf } from '../src/blockade.js'
import { SQUARE_SIZE, findBoardAsset, isInWondersArea, mapTop, slotOrigin, wonderAssetId, wondersArea } from '../src/board.js'
import type { BoardPiece } from '../src/board.js'
import { buildOptionsOf, buildSquareRefusal, marketWondersOf } from '../src/build-options.js'
import type { BuildChoice, CityBuildOptions } from '../src/build-options.js'
import { describeError } from '../src/errors.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { Item } from '../src/item.js'
import { findPlayer } from '../src/state.js'
import type { GameState, Playerhand } from '../src/state.js'

import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-10-09T10:00:00.000Z'
const OTHERS = [KARANDRAS1, ITCHI, CHUL]

const COLOSSUS = 'wonders/colossus'
const STONEHENGE = 'wonders/stonehenge'
const PYRAMIDS = 'wonders/pyramids'
const C2 = { column: 2, row: 1 }
const C1 = { column: 2, row: 0 }
const A1 = { column: 0, row: 0 }

function game(): GameState {
  const colors: Record<string, string> = { [CASH1981]: 'Red', [KARANDRAS1]: 'Blue', [ITCHI]: 'Green', [CHUL]: 'Yellow' }
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

function put(state: GameState, playerId: string, assetId: string, column: number, row: number): GameState {
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

/** A wonder in the market: a piece in the shared Wonders area that nobody owns. */
function inMarket(state: GameState, assetId: string, slot = 0): GameState {
  const area = wondersArea(state.board)
  return unwrap(
    placePiece(state, { playerId: CASH1981, assetId, x: area.x + 8 + slot * 10, y: area.y + 40 + slot * 90 }),
  )
}

const piecesOf = (state: GameState, assetId: string): readonly BoardPiece[] =>
  state.board.pieces.filter((piece) => piece.assetId === assetId)

const me = (state: GameState): Playerhand => {
  const found = findPlayer(state, CASH1981)
  if (found === undefined) throw new Error('no cash')
  return found
}

const cityOf = (state: GameState): BoardPiece => {
  const city = state.board.pieces.find((piece) => piece.category === 'city')
  if (city === undefined) throw new Error('no city')
  return city
}

function learn(state: GameState, ...techs: readonly string[]): GameState {
  return techs.reduce(
    (next, techName) =>
      unwrap(revealTech(unwrap(chooseTech(next, { playerId: CASH1981, techName })), { playerId: CASH1981, techName })),
    state,
  )
}

/** The America tile, a red city on B2, City Management open, the techs revealed, the trade in hand and a production set by hand. */
function ready(
  options: {
    techs?: readonly string[]
    trade?: number
    production?: number | null
    market?: readonly string[]
    /**
     * The wonder cards by name: those first in the order they are drawn per era, then the rest of the
     * nine of each era that are not on the board; or `{ only }` for a deck with just these.
     */
    deck?: readonly string[] | { readonly only: readonly string[] }
  } = {},
): GameState {
  const slot = game().board.slots[0]
  if (slot === undefined) throw new Error('no slot')
  let state = game()
  const [x, y] = slotOrigin(state.board, slot)
  state = unwrap(placePiece(state, { playerId: CASH1981, assetId: 'tiles/america', x, y }))
  state = put(state, CASH1981, 'cities/redcity2', 1, 1)
  state = learn(state, ...(options.techs ?? []))
  state = unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))
  state = {
    ...state,
    players: state.players.map((p) =>
      p.playerId === CASH1981 ? { ...p, stats: { ...p.stats, trade: options.trade ?? 0 } } : p,
    ),
  }
  const production = options.production === undefined ? 15 : options.production
  if (production !== null) {
    state = unwrap(setCityProductionOverride(state, { playerId: CASH1981, pieceId: cityOf(state).id, value: production }))
  }
  ;(options.market ?? [COLOSSUS, STONEHENGE]).forEach((assetId, index) => {
    state = inMarket(state, assetId, index)
  })
  return withWonderDeck(state, options.deck ?? DECK)
}

/** One wonder of each of the first two eras and a modern one, so the next draw is known. */
const DECK = ['The Great Wall', 'The Oracle', 'Notre-Dame', 'Big Ben']

/**
 * The wonder cards of the deck. A wonder piece on the board has left the deck, so its card is not in
 * it (that is what counts a wonder as out). `names` are drawn first, in order; `{ only }` leaves just
 * those cards.
 */
function withWonderDeck(state: GameState, names: readonly string[] | { readonly only: readonly string[] }): GameState {
  const wonders = state.items.filter((item) => item.kind === 'wonder')
  const named = (list: readonly string[]): Item[] =>
    list.map((name): Item => {
      const found = wonders.find((item) => item.name === name)
      if (found === undefined) throw new Error(`no wonder card ${name}`)
      return found
    })
  const only = !Array.isArray(names)
  const first = named(only ? (names as { only: readonly string[] }).only : (names as readonly string[]))
  const rest = only ? [] : wonders
  const onBoard = new Set(state.board.pieces.filter((piece) => piece.category === 'wonder').map((piece) => piece.assetId))
  const left = [...first, ...rest.filter((card) => !first.includes(card))].filter(
    (card) => !onBoard.has(wonderAssetId((card as { name: string }).name)),
  )
  return { ...state, items: [...state.items.filter((item) => item.kind !== 'wonder'), ...left] }
}

const deckNames = (state: GameState): string[] =>
  state.items.filter((item) => item.kind === 'wonder').map((item) => (item as { name: string }).name)

const optionsOf = (state: GameState): CityBuildOptions => {
  const found = buildOptionsOf(state, me(state))[0]
  if (found === undefined) throw new Error('no build options')
  return found
}
const wonderChoice = (options: CityBuildOptions, assetId: string): BuildChoice | undefined =>
  options.choices.find((choice) => choice.item.kind === 'wonder' && choice.assetId === assetId)
const wonderReason = (options: CityBuildOptions, assetId: string): string =>
  options.unavailable.find((entry) => entry.item.kind === 'wonder' && entry.assetId === assetId)?.reason ?? ''

const tryBuild = (
  state: GameState,
  assetId: string,
  at: { readonly column: number; readonly row: number },
  requestId = 'req-1',
  rush?: boolean,
) =>
  performAssistedAction(state, {
    playerId: CASH1981,
    action: 'build',
    requestId,
    at: AT,
    payload: {
      cityPieceId: cityOf(state).id,
      item: { kind: 'wonder', assetId },
      target: at,
      ...(rush === undefined ? {} : { rush }),
    },
  })
const build = (
  state: GameState,
  assetId: string,
  at: { readonly column: number; readonly row: number },
  requestId = 'req-1',
  rush?: boolean,
): GameState => unwrap(tryBuild(state, assetId, at, requestId, rush))

function undoByVote(state: GameState, requestId: string): GameState {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no line')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of OTHERS) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  return next
}

describe('the market', () => {
  it('is the wonders in the shared Wonders area that nobody owns', () => {
    const state = ready()
    const market = marketWondersOf(state.board, state.board.pieces)
    expect(market.map((piece) => piece.assetId)).toEqual([COLOSSUS, STONEHENGE])
    expect(market.every((piece) => isInWondersArea(state.board, piece))).toBe(true)

    // Owned, or standing on the map, is not in the market
    const colossus = piecesOf(state, COLOSSUS)[0] as BoardPiece
    const owned = unwrap(setWonderOwner(state, { playerId: CASH1981, pieceId: colossus.id, ownerId: KARANDRAS1 }))
    expect(marketWondersOf(owned.board, owned.board.pieces).map((piece) => piece.assetId)).toEqual([STONEHENGE])
    const onMap = put(state, CASH1981, PYRAMIDS, 9, 9)
    expect(marketWondersOf(onMap.board, onMap.board.pieces).map((piece) => piece.assetId)).toEqual([COLOSSUS, STONEHENGE])
  })
})

describe('what a city may build of the wonders', () => {
  it('offers each wonder of the market with its cost, on every square but water', () => {
    const options = optionsOf(ready())
    const colossus = wonderChoice(options, COLOSSUS)
    expect(colossus).toMatchObject({ placement: 'square', label: 'The Colossus', cost: 15, costNote: '10 with Metalworking', tradeToPay: 0 })
    // The outskirts of B2 without the water square C1
    expect(colossus?.squares.map((square) => square.label)).toEqual(['A1', 'B1', 'A2', 'C2', 'A3', 'B3', 'C3'])
    const stonehenge = wonderChoice(options, STONEHENGE)
    expect(stonehenge).toMatchObject({ cost: 10, tradeToPay: 0 })
    expect(stonehenge?.costNote).toBeUndefined()
    // Only the market is offered: nothing else is a wonder choice
    expect(options.choices.filter((choice) => choice.item.kind === 'wonder')).toHaveLength(2)
  })

  it('costs less when the player knows the tech on the card, and says what it costs without', () => {
    const withTech = optionsOf(ready({ techs: ['Metalworking'] }))
    expect(wonderChoice(withTech, COLOSSUS)).toMatchObject({ cost: 10, costNote: '15 without Metalworking' })
  })

  it('a tech that is chosen but not revealed gives no discount', () => {
    const chosen = unwrap(chooseTech(ready(), { playerId: CASH1981, techName: 'Metalworking' }))
    expect(wonderChoice(optionsOf(chosen), COLOSSUS)).toMatchObject({ cost: 15, costNote: '10 with Metalworking' })
  })

  it('a wonder without a discount costs the same for everybody', () => {
    const options = optionsOf(ready({ market: ['wonders/statueofzeus'] }))
    expect(wonderChoice(options, 'wonders/statueofzeus')).toMatchObject({ cost: 15 })
  })

  it('the cost is checked like a building: what the production lacks is rushed with trade', () => {
    const options = optionsOf(ready({ production: 10, trade: 15 }))
    expect(wonderChoice(options, COLOSSUS)).toMatchObject({ cost: 15, tradeToPay: 15 })
    expect(wonderChoice(options, STONEHENGE)).toMatchObject({ cost: 10, tradeToPay: 0 })
  })

  it('a wonder the production and the trade cannot cover is not offered, with the reason', () => {
    const options = optionsOf(ready({ production: 10, trade: 14 }))
    expect(wonderChoice(options, COLOSSUS)).toBeUndefined()
    expect(wonderReason(options, COLOSSUS)).toBe(
      'Costs 15 production and City B2 has 10 (the number you set by hand). Covering the missing 5 takes 15 trade and you have 14. ' +
        'If the city makes more than that, set its production by hand on the city.',
    )
    expect(wonderChoice(options, STONEHENGE)).toMatchObject({ cost: 10, tradeToPay: 0 })
  })

  it('the discount of the tech lowers what is rushed', () => {
    const options = optionsOf(ready({ techs: ['Metalworking'], production: 7, trade: 9 }))
    expect(wonderChoice(options, COLOSSUS)).toMatchObject({ cost: 10, costNote: '15 without Metalworking', tradeToPay: 9 })
  })

  it('a city holds one wonder: with one in its outskirts a new wonder may only take its square', () => {
    const state = put(ready(), KARANDRAS1, PYRAMIDS, 0, 2)
    const options = optionsOf(state)
    // Not owned by anybody (it was put there by hand), so it is the city's own to replace
    for (const assetId of [COLOSSUS, STONEHENGE]) {
      expect(wonderChoice(options, assetId)?.squares, assetId).toEqual([
        {
          column: 0,
          row: 2,
          label: 'A3',
          note: 'Replaces the Pyramids, which is destroyed and cannot be built again for the rest of the game.',
          replaces: { assetId: PYRAMIDS, label: 'The Pyramids', kind: 'wonder' },
        },
      ])
    }
  })

  it('a wonder that belongs to another player cannot be replaced, and then no square is left', () => {
    const placed = put(ready(), KARANDRAS1, PYRAMIDS, 0, 2)
    const pyramids = piecesOf(placed, PYRAMIDS)[0] as BoardPiece
    const state = unwrap(setWonderOwner(placed, { playerId: CASH1981, pieceId: pyramids.id, ownerId: KARANDRAS1 }))
    const options = optionsOf(state)
    expect(wonderChoice(options, COLOSSUS)).toBeUndefined()
    expect(wonderReason(options, COLOSSUS)).toBe(
      'No legal square. A wonder needs any terrain except water: 1 square has the wrong terrain, ' +
        "1 square holds another player's wonder, which cannot be replaced, " +
        '6 squares are not allowed because the city already has its one wonder, The Pyramids, which a new one can only replace.',
    )
  })

  it('a limited building in the outskirts does not stop a wonder', () => {
    const state = put(ready(), CASH1981, 'buildings/temple', 0, 2)
    expect(wonderChoice(optionsOf(state), COLOSSUS)).toBeDefined()
  })

  it('a building of the player is replaced by a wonder, and the square says so', () => {
    const state = put(ready(), CASH1981, 'buildings/library', 2, 1)
    const square = wonderChoice(optionsOf(state), COLOSSUS)?.squares.find((candidate) => candidate.label === 'C2')
    expect(square).toMatchObject({
      note: 'Replaces your Library, which is taken off the board and goes back to the supply.',
      replaces: { assetId: 'buildings/library', label: 'Library', kind: 'building' },
    })
    expect(buildSquareRefusal(state, me(state), cityOf(state).id, { kind: 'wonder', assetId: COLOSSUS }, C2)).toBeUndefined()
  })

  it('a Great Person of the player is replaced by a wonder, and a city-state keeps its square taken', () => {
    const person = put(ready(), CASH1981, 'great people/scientist', 2, 1)
    const square = wonderChoice(optionsOf(person), COLOSSUS)?.squares.find((candidate) => candidate.label === 'C2')
    expect(square?.replaces).toEqual({ assetId: 'great people/scientist', label: 'Scientist', kind: 'greatperson' })
    expect(buildSquareRefusal(person, me(person), cityOf(person).id, { kind: 'wonder', assetId: COLOSSUS }, C2)).toBeUndefined()

    const state = put(ready(), KARANDRAS1, 'city-states/cs1', 2, 1)
    expect(wonderChoice(optionsOf(state), COLOSSUS)?.squares.map((candidate) => candidate.label)).not.toContain('C2')
    expect(buildSquareRefusal(state, me(state), cityOf(state).id, { kind: 'wonder', assetId: COLOSSUS }, C2)).toBe(
      `C2 is already taken: ${findBoardAsset('city-states/cs1')?.label} stands there.`,
    )
  })

  it('the water square is refused with the reason', () => {
    const state = ready()
    expect(buildSquareRefusal(state, me(state), cityOf(state).id, { kind: 'wonder', assetId: COLOSSUS }, C1)).toBe(
      'C1 is water, and a wonder needs any terrain except water.',
    )
  })

  it('outside City Management nothing is offered', () => {
    const closed = unwrap(markPhasesDone(ready(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' }))
    const options = optionsOf(closed)
    expect(options.status).toBe('wrong-phase')
    expect(options.choices).toEqual([])
  })
})

const buildLine = (state: GameState, requestId = 'req-1'): string =>
  state.log.find((entry) => entry.assistedActionId === requestId)?.publicLog ?? ''

describe('building a wonder', () => {
  it('moves it out of the market onto the square, centred, and makes the player its owner', () => {
    const before = ready()
    const market = piecesOf(before, COLOSSUS)[0] as BoardPiece
    const done = build(before, COLOSSUS, C2)

    const wonders = piecesOf(done, COLOSSUS)
    // The same piece, not a new one
    expect(wonders).toHaveLength(1)
    const piece = wonders[0] as BoardPiece
    expect(piece.id).toBe(market.id)
    expect(mapCellOf(done.board, piece)).toEqual(C2)
    expect(Math.abs(piece.x + piece.width / 2 - (C2.column + 0.5) * SQUARE_SIZE)).toBeLessThanOrEqual(0.5)
    expect(piece.ownerId).toBe(CASH1981)
    expect(isInWondersArea(done.board, piece)).toBe(false)

    const effect = done.assistedActions[0]?.effect
    if (effect?.kind !== 'build' || !('wonder' in effect) || effect.wonder === undefined) throw new Error('no wonder effect')
    const moved = done.board.history.find((entry) => entry.id === effect.historyId)
    const owned = done.board.history.find((entry) => entry.id === effect.wonder?.ownerHistoryId)
    expect(moved?.change).toMatchObject({ kind: 'move', pieceId: piece.id, from: { x: market.x, y: market.y } })
    expect(owned?.change).toMatchObject({ kind: 'owner', pieceId: piece.id, from: null, to: CASH1981 })
    // Both are counted with the build's line, so stepping through the history shows them together
    const lineAt = done.log.findIndex((entry) => entry.assistedActionId === 'req-1') + 1
    expect(moved?.logLength).toBe(lineAt)
    expect(owned?.logLength).toBe(lineAt)
    expect(buildLine(done)).toBe('cash1981 built the Colossus in City B2 on square C2')
    expect(effect).toMatchObject({
      item: { kind: 'wonder', assetId: COLOSSUS },
      pieceId: piece.id,
      wonder: { from: { x: market.x, y: market.y } },
    })
  })

  it('a rush pays the trade and needs the flag, and the vote undo gives it back', () => {
    const state = ready({ production: 10, trade: 16 })
    expect(describeError(unwrapErr(tryBuild(state, COLOSSUS, C2)))).toContain('Confirm paying 15 trade to build it.')
    const done = build(state, COLOSSUS, C2, 'req-1', true)
    expect(me(done).stats.trade).toBe(1)
    expect(buildLine(done)).toBe('cash1981 built the Colossus in City B2 on square C2, paying 15 trade for the missing production')
    expect(piecesOf(done, COLOSSUS)[0]?.ownerId).toBe(CASH1981)
    expect(me(undoByVote(done, 'req-1')).stats.trade).toBe(16)
  })

  it('refuses a wonder that is not in the market, with the reason', () => {
    const state = ready({ market: [STONEHENGE] })
    expect(describeError(unwrapErr(tryBuild(state, COLOSSUS, C2)))).toBe(
      'The Colossus is not a wonder that can be built: it is not in the market.',
    )
  })

  it('refuses the water square, and a second wonder anywhere but on the first', () => {
    expect(describeError(unwrapErr(tryBuild(ready(), COLOSSUS, C1)))).toContain('C1 is water, and a wonder needs any terrain except water.')
    const first = build(ready(), COLOSSUS, C2)
    const second = describeError(unwrapErr(tryBuild(first, STONEHENGE, A1, 'req-2')))
    expect(second).toContain("A1 cannot be used: The Colossus is the city's one wonder, and a new one can only replace it.")
  })

  it('a building program marker is used up, as with a building', () => {
    const marked = put(ready({ production: null }), CASH1981, 'markers/Building Program', 1, 1)
    const done = build(marked, STONEHENGE, C2)
    expect(piecesOf(done, 'markers/Building Program')).toEqual([])
    expect(buildLine(done)).toBe('cash1981 built Stonehenge in City B2 on square C2, using up the Building Program marker')
  })

  it('the board Undo cannot take back the move, the new owner or the drawn wonder alone', () => {
    const done = build(ready(), COLOSSUS, C2)
    // The last entry is the wonder drawn into the market
    expect(done.board.history.at(-1)?.change.kind).toBe('place')
    expect(unwrapErr(undoLastBoardChange(done, CASH1981))).toEqual({ kind: 'BOARD_UNDO_ASSISTED' })
  })

  it('every refusal leaves the game as it was', () => {
    const state = ready()
    const snapshot = JSON.stringify(state)
    for (const attempt of [tryBuild(state, COLOSSUS, C1), tryBuild(state, PYRAMIDS, C2, 'req-2')]) {
      expect(attempt.ok).toBe(false)
    }
    expect(JSON.stringify(state)).toBe(snapshot)
  })
})

describe('the next wonder is drawn into the market', () => {
  const marketNames = (state: GameState): string[] =>
    marketWondersOf(state.board, state.board.pieces).map((piece) => piece.label)

  it('after a build, from the first era that has fewer than four wonders out, with a line that names it', () => {
    const done = build(ready(), COLOSSUS, C2)
    // Two ancient wonders were out (the market), so the next ancient one comes
    expect(marketNames(done)).toEqual(['The Great Wall', 'Stonehenge'])
    expect(done.log.at(-1)?.publicLog).toBe('System: drew The Great Wall and placed it in the Wonders area')
    expect(deckNames(done).slice(0, 3)).toEqual(['The Oracle', 'Notre-Dame', 'Big Ben'])
    expect(deckNames(done)).not.toContain('The Great Wall')
    const effect = done.assistedActions[0]?.effect
    expect(effect?.kind === 'build' && 'drawn' in effect && effect.drawn).toMatchObject({ item: { name: 'The Great Wall' } })
    // The drawn wonder is on the market, owned by nobody, and counted with its own line
    const drawn = piecesOf(done, 'wonders/greatwall')[0] as BoardPiece
    expect(isInWondersArea(done.board, drawn)).toBe(true)
    expect(drawn.ownerId ?? null).toBeNull()
    expect(done.board.history.at(-1)?.logLength).toBe(done.log.length)
  })

  it('goes on with ancient wonders until four are out, then medieval ones, then modern ones', () => {
    // Four ancient wonders are out, so the medieval ones follow
    const four = ready({
      market: [COLOSSUS, STONEHENGE, PYRAMIDS, 'wonders/oracle'],
      deck: ['The Great Wall', 'Notre-Dame', 'Angkor Wat', 'Big Ben'],
    })
    const afterFour = build(four, COLOSSUS, C2)
    expect(marketNames(afterFour)).toContain('Notre-Dame')
    expect(marketNames(afterFour)).not.toContain('The Great Wall')
    expect(afterFour.log.at(-1)?.publicLog).toBe('System: drew Notre-Dame and placed it in the Wonders area')

    // Four ancient and four medieval are out, so the modern one comes
    const eight = ready({
      market: [COLOSSUS, STONEHENGE, PYRAMIDS, 'wonders/oracle', 'wonders/notredame', 'wonders/angkorwat', 'wonders/tajmahal', 'wonders/louvre'],
      deck: ['The Great Wall', 'Machu Pichu', 'Big Ben'],
    })
    const afterEight = build(eight, COLOSSUS, C2)
    expect(afterEight.log.at(-1)?.publicLog).toBe('System: drew Big Ben and placed it in the Wonders area')
  })

  it('counts the wonders that are owned or built, not only those in the market', () => {
    // Two in the market, two standing on the map elsewhere: four ancient cards have left the deck
    const state = ready({ market: [COLOSSUS, STONEHENGE] })
    const owned = withWonderDeck(put(put(state, KARANDRAS1, PYRAMIDS, 9, 9), KARANDRAS1, 'wonders/oracle', 12, 9), ['The Great Wall', 'Notre-Dame'])
    const done = build(owned, COLOSSUS, C2)
    expect(done.log.at(-1)?.publicLog).toBe('System: drew Notre-Dame and placed it in the Wonders area')
  })

  it('skips an era that has no card left, and draws nothing when twelve are out or the deck is empty', () => {
    const medieval = ['Notre-Dame', 'Angkor Wat', 'Brandenburg Gate', 'Himeji Samurai Castle', "Leonardo's Workshop", 'Machu Pichu', 'Porcelain Tower', 'Taj Mahal', 'The Louvre']
    const noAncient = build(ready({ deck: { only: medieval } }), COLOSSUS, C2)
    expect(noAncient.log.at(-1)?.publicLog).toBe('System: drew Notre-Dame and placed it in the Wonders area')

    const empty = build(ready({ deck: { only: [] } }), COLOSSUS, C2)
    expect(empty.log.at(-1)?.publicLog).toBe('cash1981 built the Colossus in City B2 on square C2')
    expect(marketNames(empty)).toEqual(['Stonehenge'])
    const effect = empty.assistedActions[0]?.effect
    expect(effect?.kind === 'build' && 'drawn' in effect && effect.drawn).toBeFalsy()
  })
})

describe('undoing a wonder', () => {
  it('by the vote puts it back in the market where it stood, unowned, and the drawn wonder back in the deck', () => {
    const before = ready()
    const market = piecesOf(before, COLOSSUS)[0] as BoardPiece
    const undone = undoByVote(build(before, COLOSSUS, C2), 'req-1')

    const piece = piecesOf(undone, COLOSSUS)[0] as BoardPiece
    expect(piece.id).toBe(market.id)
    expect({ x: piece.x, y: piece.y }).toEqual({ x: market.x, y: market.y })
    expect(piece.ownerId ?? null).toBeNull()
    expect(marketWondersOf(undone.board, undone.board.pieces).map((p) => p.assetId)).toEqual([COLOSSUS, STONEHENGE])
    // The wonder that was drawn is the next card of its deck again
    expect(piecesOf(undone, 'wonders/greatwall')).toEqual([])
    expect(deckNames(undone).slice(0, 4)).toEqual(['The Great Wall', 'The Oracle', 'Notre-Dame', 'Big Ben'])
    expect(undone.assistedActions[0]?.status).toBe('undone')
    expect(undone.log.at(-1)?.publicLog).toBe(
      "System: cash1981's Colossus on C2 was undone: the wonder was put back in the market and The Great Wall went back in the deck",
    )
    // It can be built again
    expect(wonderChoice(optionsOf(undone), COLOSSUS)).toBeDefined()
  })

  it('is refused by the vote when the wonder drawn into the market has been taken since', () => {
    const done = build(ready(), COLOSSUS, C2)
    const drawn = piecesOf(done, 'wonders/greatwall')[0] as BoardPiece
    const taken = unwrap(setWonderOwner(done, { playerId: KARANDRAS1, pieceId: drawn.id, ownerId: KARANDRAS1 }))
    const entry = taken.log.find((candidate) => candidate.assistedActionId === 'req-1')
    let next = unwrap(initiateUndo(taken, { logId: entry?.id ?? '', playerId: CASH1981 }))
    for (const playerId of [KARANDRAS1, ITCHI]) next = unwrap(vote(next, { logId: entry?.id ?? '', playerId, vote: true, at: AT }))
    const refused = unwrapErr(vote(next, { logId: entry?.id ?? '', playerId: CHUL, vote: true, at: AT }))
    expect(refused).toMatchObject({ kind: 'ASSISTED_UNDO_BLOCKED' })
    expect(refused.kind === 'ASSISTED_UNDO_BLOCKED' && refused.reason).toContain('The Great Wall was drawn into the market after this build and is no longer there')
  })

  it('is refused by the vote when the wonder has been moved off its square', () => {
    const done = build(ready(), COLOSSUS, C2)
    const piece = piecesOf(done, COLOSSUS)[0] as BoardPiece
    const moved = unwrap(
      movePiece(done, { playerId: CASH1981, pieceId: piece.id, x: 3 * SQUARE_SIZE + 4, y: mapTop(done.board) + 3 * SQUARE_SIZE + 4 }),
    )
    const entry = moved.log.find((candidate) => candidate.assistedActionId === 'req-1')
    let next = unwrap(initiateUndo(moved, { logId: entry?.id ?? '', playerId: CASH1981 }))
    for (const playerId of [KARANDRAS1, ITCHI]) next = unwrap(vote(next, { logId: entry?.id ?? '', playerId, vote: true, at: AT }))
    const refused = unwrapErr(vote(next, { logId: entry?.id ?? '', playerId: CHUL, vote: true, at: AT }))
    expect(refused).toMatchObject({ kind: 'ASSISTED_UNDO_BLOCKED', reason: 'The Colossus has left C2. Move it back first.' })
  })

  it('removing the wonder by hand before End turn puts it back in the market, and after End turn removes it as any piece', () => {
    const done = build(ready(), COLOSSUS, C2)
    const piece = piecesOf(done, COLOSSUS)[0] as BoardPiece

    const result = takeBackOpenBuild(done, { playerId: CASH1981, pieceId: piece.id, at: AT })
    if (result === undefined) throw new Error('the wonder is not an open build')
    const taken = unwrap(result)
    expect(marketWondersOf(taken.board, taken.board.pieces).map((p) => p.assetId)).toEqual([COLOSSUS, STONEHENGE])
    expect(deckNames(taken)[0]).toBe('The Great Wall')
    expect(taken.log.at(-1)?.publicLog).toBe(
      "System: cash1981's Colossus on C2 was undone: the wonder was put back in the market and The Great Wall went back in the deck. It was removed before End turn.",
    )

    const late = unwrap(markPhasesDone(done, { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' }))
    expect(takeBackOpenBuild(late, { playerId: CASH1981, pieceId: piece.id, at: AT })).toBeUndefined()
    expect(unwrap(removePiece(late, { playerId: CASH1981, pieceId: piece.id })).board.pieces.some((p) => p.id === piece.id)).toBe(false)
  })

  it('removing it by hand is a plain removal when the wonder drawn after it has been taken', () => {
    const done = build(ready(), COLOSSUS, C2)
    const piece = piecesOf(done, COLOSSUS)[0] as BoardPiece
    const drawn = piecesOf(done, 'wonders/greatwall')[0] as BoardPiece
    const taken = unwrap(setWonderOwner(done, { playerId: KARANDRAS1, pieceId: drawn.id, ownerId: KARANDRAS1 }))
    expect(takeBackOpenBuild(taken, { playerId: CASH1981, pieceId: piece.id, at: AT })).toBeUndefined()
  })

  it('puts a taken-back wonder where it stood: the drawn wonder is out of that spot first', () => {
    const done = build(ready(), COLOSSUS, C2)
    const market = (done.assistedActions[0]?.effect as { wonder?: { from: { x: number; y: number } } }).wonder?.from as { x: number; y: number }
    const piece = piecesOf(done, COLOSSUS)[0] as BoardPiece
    const result = takeBackOpenBuild(done, { playerId: CASH1981, pieceId: piece.id, at: AT })
    if (result === undefined) throw new Error('not an open build')
    const back = piecesOf(unwrap(result), COLOSSUS)[0] as BoardPiece
    expect({ x: back.x, y: back.y }).toEqual(market)
  })

  it('puts a taken-back wonder on the next free spot when another wonder has been placed on its own', () => {
    const done = build(ready({ deck: { only: [] } }), COLOSSUS, C2)
    const piece = piecesOf(done, COLOSSUS)[0] as BoardPiece
    const from = (done.assistedActions[0]?.effect as { wonder?: { from: { x: number; y: number } } }).wonder?.from as { x: number; y: number }
    const refilled = unwrap(placePiece(done, { playerId: CASH1981, assetId: PYRAMIDS, x: from.x, y: from.y }))

    const result = takeBackOpenBuild(refilled, { playerId: CASH1981, pieceId: piece.id, at: AT })
    if (result === undefined) throw new Error('not an open build')
    const taken = unwrap(result)
    const back = piecesOf(taken, COLOSSUS)[0] as BoardPiece
    const pyramids = piecesOf(taken, PYRAMIDS)[0] as BoardPiece
    expect(isInWondersArea(taken.board, back)).toBe(true)
    expect(isInWondersArea(taken.board, pyramids)).toBe(true)
    // The two do not sit on top of each other
    expect(Math.abs(back.x - pyramids.x) >= back.width / 2 || Math.abs(back.y - pyramids.y) >= back.height / 2).toBe(true)
  })

  it('puts a taken-back wonder back with a used Building Program marker restored, and the board Undo cannot undo it', () => {
    const marked = put(ready({ production: null }), CASH1981, 'markers/Building Program', 1, 1)
    const marker = piecesOf(marked, 'markers/Building Program')[0] as BoardPiece
    const done = build(marked, STONEHENGE, C2)
    expect(piecesOf(done, 'markers/Building Program')).toEqual([])
    const piece = piecesOf(done, STONEHENGE)[0] as BoardPiece

    const result = takeBackOpenBuild(done, { playerId: CASH1981, pieceId: piece.id, at: AT })
    if (result === undefined) throw new Error('not an open build')
    const taken = unwrap(result)
    expect(piecesOf(taken, 'markers/Building Program')).toEqual([marker])
    expect(marketWondersOf(taken.board, taken.board.pieces).map((p) => p.assetId)).toContain(STONEHENGE)
    expect(unwrapErr(undoLastBoardChange(taken, CASH1981)).kind).toBe('NOTHING_TO_UNDO_ON_BOARD')
  })

  it('after the vote undo the board Undo has nothing to go back to, so the drawn wonder cannot be brought back with its card in the deck', () => {
    const marked = put(ready({ production: null, trade: 60 }), CASH1981, 'markers/Building Program', 1, 1)
    const undone = undoByVote(build(marked, COLOSSUS, C2, 'req-1', true), 'req-1')
    expect(deckNames(undone)[0]).toBe('The Great Wall')
    expect(unwrapErr(undoLastBoardChange(undone, CASH1981)).kind).toBe('NOTHING_TO_UNDO_ON_BOARD')
    expect(undone.board.redo).toEqual([])
    expect(piecesOf(undone, 'wonders/greatwall')).toEqual([])
  })

  it('two builds: the older one cannot be undone once the wonder it drew is the newer one, but the newer one can, and then the older', () => {
    // A: Colossus in B2 draws The Great Wall. B: a second city builds The Great Wall and draws The Oracle.
    // The second city has no production set by hand, so it rushes with the trade
    const state = put(ready({ production: 15, trade: 60 }), CASH1981, 'cities/redcity2', 3, 3)
    const first = build(state, COLOSSUS, C2, 'req-1')
    const second = unwrap(
      performAssistedAction(first, {
        playerId: CASH1981,
        action: 'build',
        requestId: 'req-2',
        at: AT,
        payload: {
          cityPieceId: (first.board.pieces.filter((piece) => piece.category === 'city')[1] as BoardPiece).id,
          item: { kind: 'wonder', assetId: 'wonders/greatwall' },
          target: { column: 3, row: 2 },
          rush: true,
        },
      }),
    )
    expect(second.log.at(-1)?.publicLog).toBe('System: drew The Oracle and placed it in the Wonders area')

    // The wonder the first build drew is owned now: the first build cannot be undone
    const stuck = (() => {
      const entry = second.log.find((candidate) => candidate.assistedActionId === 'req-1')
      let next = unwrap(initiateUndo(second, { logId: entry?.id ?? '', playerId: CASH1981 }))
      for (const playerId of [KARANDRAS1, ITCHI]) next = unwrap(vote(next, { logId: entry?.id ?? '', playerId, vote: true, at: AT }))
      return unwrapErr(vote(next, { logId: entry?.id ?? '', playerId: CHUL, vote: true, at: AT }))
    })()
    expect(stuck.kind === 'ASSISTED_UNDO_BLOCKED' && stuck.reason).toContain('The Great Wall was drawn into the market after this build and is no longer there')

    // The newer build goes first: The Oracle back in the deck, The Great Wall back in the market
    const newerUndone = undoByVote(second, 'req-2')
    expect(piecesOf(newerUndone, 'wonders/oracle')).toEqual([])
    expect(marketWondersOf(newerUndone.board, newerUndone.board.pieces).map((piece) => piece.assetId)).toContain('wonders/greatwall')
    // Then the older one, which now finds its drawn wonder in the market again
    const bothUndone = undoByVote(newerUndone, 'req-1')
    expect(piecesOf(bothUndone, 'wonders/greatwall')).toEqual([])
    // The cards are back; the order of the two is the order they were put back in
    expect(deckNames(bothUndone)).toEqual(expect.arrayContaining(['The Great Wall', 'The Oracle']))
    expect(deckNames(bothUndone).filter((name) => name === 'The Great Wall' || name === 'The Oracle')).toHaveLength(2)
    expect(marketWondersOf(bothUndone.board, bothUndone.board.pieces).map((piece) => piece.assetId)).toEqual([COLOSSUS, STONEHENGE])
  })

  it('a drawn wonder that was moved out of the Wonders area or removed also stops the undo, and a take-back becomes a plain removal', () => {
    const done = build(ready(), COLOSSUS, C2)
    const drawn = piecesOf(done, 'wonders/greatwall')[0] as BoardPiece
    const piece = piecesOf(done, COLOSSUS)[0] as BoardPiece
    const moved = unwrap(movePiece(done, { playerId: KARANDRAS1, pieceId: drawn.id, x: 5 * SQUARE_SIZE, y: mapTop(done.board) + 8 * SQUARE_SIZE, snap: false }))
    const removed = unwrap(removePiece(done, { playerId: KARANDRAS1, pieceId: drawn.id }))
    for (const state of [moved, removed]) {
      expect(takeBackOpenBuild(state, { playerId: CASH1981, pieceId: piece.id, at: AT })).toBeUndefined()
    }
  })

  it('a wonder piece taken off the board does not make room for another of its era: the count is of the cards out of the deck', () => {
    const before = ready()
    const stonehenge = piecesOf(before, STONEHENGE)[0] as BoardPiece
    const lost = unwrap(removePiece(before, { playerId: CASH1981, pieceId: stonehenge.id }))
    // Its card is out of the deck, so the ancient count is as before: the next ancient wonder still comes
    expect(deckNames(lost)).not.toContain('Stonehenge')
    const done = build(lost, COLOSSUS, C2)
    expect(done.log.at(-1)?.publicLog).toBe('System: drew The Great Wall and placed it in the Wonders area')
  })
})

describe('replacing a wonder or a building with a wonder (base rules p. 17)', () => {
  /** An own Colossus on C2, with the Stonehenge and the Pyramids in the market. */
  function withOwnColossus(): GameState {
    const placed = put(ready({ market: [STONEHENGE, PYRAMIDS] }), CASH1981, COLOSSUS, C2.column, C2.row)
    const colossus = piecesOf(placed, COLOSSUS)[0] as BoardPiece
    // A wonder on the board has left its deck, so its card is taken out of it
    return withWonderDeck(unwrap(setWonderOwner(placed, { playerId: CASH1981, pieceId: colossus.id, ownerId: CASH1981 })), DECK)
  }

  it('a second wonder may only replace the first, so the first one is the only square', () => {
    const options = optionsOf(withOwnColossus())
    for (const assetId of [STONEHENGE, PYRAMIDS]) {
      const squares = wonderChoice(options, assetId)?.squares ?? []
      expect(squares.map((square) => square.label), assetId).toEqual(['C2'])
      expect(squares[0]?.replaces).toEqual({ assetId: COLOSSUS, label: 'The Colossus', kind: 'wonder' })
    }
  })

  it('destroys the old wonder for good: it leaves the board and is not in the market or the deck', () => {
    const before = withOwnColossus()
    const colossus = piecesOf(before, COLOSSUS)[0] as BoardPiece
    const done = build(before, STONEHENGE, C2)

    expect(piecesOf(done, COLOSSUS)).toEqual([])
    expect(deckNames(done)).not.toContain('The Colossus')
    expect(marketWondersOf(done.board, done.board.pieces).map((piece) => piece.label)).not.toContain('The Colossus')
    const stonehenge = piecesOf(done, STONEHENGE)[0] as BoardPiece
    expect(mapCellOf(done.board, stonehenge)).toEqual(C2)
    expect(stonehenge.ownerId).toBe(CASH1981)
    expect(buildLine(done)).toBe('cash1981 built Stonehenge in City B2 on square C2, replacing the Colossus, which is destroyed')

    const effect = done.assistedActions[0]?.effect
    if (effect?.kind !== 'build' || !('replaced' in effect) || effect.replaced === undefined) throw new Error('no replaced piece')
    expect(effect.replaced.piece).toEqual({ ...colossus, ownerId: CASH1981 })
    // The next wonder is still drawn into the market, as for any wonder that is built
    expect(done.log.at(-1)?.publicLog).toContain('drew')
  })

  it('the vote undo brings the old wonder back, owned and in its place, and the new one back to the market', () => {
    const before = withOwnColossus()
    const colossus = piecesOf(before, COLOSSUS)[0] as BoardPiece
    const undone = undoByVote(build(before, STONEHENGE, C2), 'req-1')

    expect(piecesOf(undone, COLOSSUS)).toEqual([{ ...colossus, ownerId: CASH1981 }])
    expect(marketWondersOf(undone.board, undone.board.pieces).map((piece) => piece.assetId)).toEqual([PYRAMIDS, STONEHENGE])
    expect(undone.log.at(-1)?.publicLog).toContain('and the Colossus it replaced was put back')
  })

  it('removing the new wonder by hand before End turn takes the whole build back, the old wonder too', () => {
    const before = withOwnColossus()
    const colossus = piecesOf(before, COLOSSUS)[0] as BoardPiece
    const done = build(before, STONEHENGE, C2)
    const stonehenge = piecesOf(done, STONEHENGE)[0] as BoardPiece
    const result = takeBackOpenBuild(done, { playerId: CASH1981, pieceId: stonehenge.id, at: AT })
    if (result === undefined) throw new Error('the wonder is not an open build')
    const taken = unwrap(result)
    expect(piecesOf(taken, COLOSSUS)).toEqual([{ ...colossus, ownerId: CASH1981 }])
    expect(marketWondersOf(taken.board, taken.board.pieces).map((piece) => piece.assetId)).toEqual([PYRAMIDS, STONEHENGE])
  })

  it('a wonder replaces a building of the player when the city has no wonder, and the building goes back to the supply', () => {
    const state = put(ready(), CASH1981, 'buildings/library', C2.column, C2.row)
    const done = build(state, COLOSSUS, C2)
    expect(piecesOf(done, 'buildings/library')).toEqual([])
    expect(buildLine(done)).toBe('cash1981 built the Colossus in City B2 on square C2, replacing the Library')
    const undone = undoByVote(done, 'req-1')
    expect(piecesOf(undone, 'buildings/library')).toHaveLength(1)
    expect(piecesOf(undone, COLOSSUS)[0] && isInWondersArea(undone.board, piecesOf(undone, COLOSSUS)[0] as BoardPiece)).toBe(true)
  })

  it('a building replaces a wonder of the player, which is destroyed', () => {
    // The Library goes on grassland, and C2 is the only grassland square
    const state = learn(withOwnColossus(), 'Writing')
    const library = (buildOptionsOf(state, me(state))[0] as CityBuildOptions).choices.find((choice) => choice.assetId === 'buildings/library')
    expect(library?.squares.map((square) => square.replaces?.assetId)).toEqual([COLOSSUS])
    const done = unwrap(
      performAssistedAction(state, {
        playerId: CASH1981,
        action: 'build',
        requestId: 'req-1',
        at: AT,
        payload: { cityPieceId: cityOf(state).id, item: { kind: 'building', assetId: 'buildings/library' }, target: C2 },
      }),
    )
    expect(piecesOf(done, COLOSSUS)).toEqual([])
    expect(buildLine(done)).toBe('cash1981 built a Library in City B2 on square C2, replacing the Colossus, which is destroyed')
    const undone = undoByVote(done, 'req-1')
    expect(piecesOf(undone, COLOSSUS)).toHaveLength(1)
    expect(piecesOf(undone, 'buildings/library')).toEqual([])
  })

  it('a wonder replaces a Great Person of the player, which goes back to the player area, and the undo brings it back', () => {
    const before = put(ready(), CASH1981, 'great people/scientist', C2.column, C2.row)
    const person = piecesOf(before, 'great people/scientist')[0] as BoardPiece
    const done = build(before, COLOSSUS, C2)
    const held = piecesOf(done, 'great people/scientist')[0] as BoardPiece
    expect(held.id).toBe(person.id)
    expect(mapCellOf(done.board, held)).toBeNull()
    expect(buildLine(done)).toBe(
      'cash1981 built the Colossus in City B2 on square C2, replacing the Scientist (Great Person), which goes back to the player area',
    )
    expect(piecesOf(undoByVote(done, 'req-1'), 'great people/scientist')).toEqual([person])
  })
})
