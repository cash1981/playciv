/**
 * Drought, Deforestation and Flooding (issue #352): one disaster token on one map square chosen by the player. The
 * engine lists the legal squares and checks the chosen one again. The rules are the card texts and the human's
 * unofficial rulings 258-271: a token goes under any marker, token or city already on the square.
 */

import { describe, expect, it } from 'vitest'

import { placePiece, removePiece, undoLastBoardChange } from '../src/actions/board.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { performAssistedAction } from '../src/assisted.js'
import { playableCardsOf } from '../src/assisted-cards.js'
import { findBoardAsset, piecesAtStep, slotOrigin } from '../src/board.js'
import type { BoardPiece } from '../src/board.js'
import { mapCellOf } from '../src/blockade.js'
import { applyCancellation } from '../src/cancellation.js'
import { squareCentre } from '../src/build-options.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { toPlayerView } from '../src/state.js'
import { terrainAt, tileTerrainGrid } from '../src/terrain.js'
import type { Terrain } from '../src/terrain.js'

import { player, withCardInHand } from './assisted-fixture.js'
import { CASH1981 as A, KARANDRAS1 as B, CHUL as D, firstCivGame } from './fixture.js'

/** tiles/Aztec in the printed orientation, which is how it is laid (rotation 0): the terrain of each square. */
const GRID: readonly (readonly Terrain[])[] = tileTerrainGrid('tiles/Aztec') ?? []

/** The first square of the tile with this terrain, as a row and column of the tile. */
const firstOf = (terrain: Terrain): { readonly row: number; readonly column: number } => {
  for (const [row, cells] of GRID.entries()) {
    const column = cells.indexOf(terrain)
    if (column >= 0) return { row, column }
  }
  throw new Error(`no ${terrain} square on the tile`)
}
const MOUNTAIN = firstOf('mountain')
const FOREST = firstOf('forest')
const GRASS = firstOf('grassland')
const WATER = firstOf('water')
const DESERT = firstOf('desert')

/** A square of the laid tile, as a row and column of the tile. */
type Spot = { readonly row: number; readonly column: number }

const originCell = (state: GameState): { column: number; row: number } => {
  const slot = state.board.slots[0]
  if (slot === undefined) throw new Error('no slot')
  return { column: slot.x, row: slot.y }
}

const cellOf = (state: GameState, spot: Spot) => ({ column: originCell(state).column + spot.column, row: originCell(state).row + spot.row })

/** A game with tiles/Aztec laid in the first slot. */
function scene(): GameState {
  const state = firstCivGame()
  const slot = state.board.slots[0]
  if (slot === undefined) throw new Error('no slot')
  const [x, y] = slotOrigin(state.board, slot)
  return unwrap(placePiece(state, { playerId: A, assetId: 'tiles/Aztec', x, y }))
}

/** Puts an asset on a square of the tile, centred on it. */
function put(state: GameState, assetId: string, spot: Spot): { state: GameState; piece: BoardPiece } {
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`no asset ${assetId}`)
  const centre = squareCentre(state.board, cellOf(state, spot))
  const placed = unwrap(placePiece(state, { playerId: A, assetId, x: centre.x - asset.width / 2, y: centre.y - asset.height / 2 }))
  const piece = placed.board.pieces.at(-1)
  if (piece === undefined || piece.assetId !== assetId) throw new Error('not placed')
  return { state: placed, piece }
}

const play = (state: GameState, itemId: string, square?: { column: number; row: number }, requestId = 'req-1') =>
  performAssistedAction(state, {
    playerId: A,
    action: 'playCard',
    requestId,
    at: '2026-11-26T10:00:00.000Z',
    payload: { itemId, targets: [], ...(square === undefined ? {} : { disasterSquare: square }) },
  })

const reason = (result: ReturnType<typeof play>): string => {
  const error = unwrapErr(result)
  return 'reason' in error ? String(error.reason) : JSON.stringify(error)
}

const withCard = (state: GameState, name: string) => withCardInHand(state, name)
const squaresOf = (state: GameState, itemId: string) =>
  playableCardsOf(state, player(state)).find((card) => card.itemId === itemId)?.squares ?? []
const isLegal = (state: GameState, itemId: string, spot: Spot): boolean => {
  const cell = cellOf(state, spot)
  return squaresOf(state, itemId).some((square) => square.column === cell.column && square.row === cell.row)
}
const tokens = (state: GameState): readonly BoardPiece[] => state.board.pieces.filter((piece) => piece.category === 'disaster')
const terrainOfSpot = (state: GameState, spot: Spot) => {
  const centre = squareCentre(state.board, cellOf(state, spot))
  return terrainAt(state.board, centre.x, centre.y)
}
const undoByVote = (state: GameState, requestId = 'req-1'): GameState => {
  const logId = state.assistedActions.find((record) => record.id === requestId)?.logId ?? ''
  let current = unwrap(initiateUndo(state, { logId, playerId: A }))
  for (const voter of state.players.filter((candidate) => candidate.playerId !== A)) {
    current = unwrap(vote(current, { logId, playerId: voter.playerId, vote: true }))
  }
  return current
}
const indexOfPiece = (state: GameState, id: string): number => state.board.pieces.findIndex((piece) => piece.id === id)

describe('the squares each disaster lists', () => {
  const countOf = (terrain: string): number => GRID.flat().filter((cell) => cell === terrain).length

  it('lists every non-mountain square of the laid tile for Drought and Flooding, desert and water ones too', () => {
    for (const name of ['Drought', 'Flooding']) {
      const { state, itemId } = withCard(scene(), name)
      const squares = squaresOf(state, itemId)
      expect(squares).toHaveLength(16 - countOf('mountain'))
      expect(isLegal(state, itemId, MOUNTAIN)).toBe(false)
      expect(isLegal(state, itemId, WATER)).toBe(true)
      expect(isLegal(state, itemId, DESERT)).toBe(true)
      expect(isLegal(state, itemId, GRASS)).toBe(true)
      expect(squares[0]?.label).toMatch(/^[A-Z]\d+$/)
    }
  })

  it('lists only the forest squares for Deforestation', () => {
    const { state, itemId } = withCard(scene(), 'Deforestation')
    expect(squaresOf(state, itemId)).toHaveLength(countOf('forest'))
    expect(isLegal(state, itemId, FOREST)).toBe(true)
    expect(isLegal(state, itemId, GRASS)).toBe(false)
  })

  it('offers no square and is not playable without a laid tile, with a reason', () => {
    const { state, itemId } = withCard(firstCivGame(), 'Drought')
    const card = playableCardsOf(state, player(state)).find((candidate) => candidate.itemId === itemId)
    expect(card).toMatchObject({ status: 'unavailable', squares: [] })
    expect(card?.reason).toContain('No square on the map')
    expect(reason(play(state, itemId, { column: 0, row: 0 }))).toContain('No square on the map')
  })

  it('treats a square that an earlier disaster token made forest as a forest square for Deforestation', () => {
    // An existing Forest token (asset disasters/forest) on a grassland square
    const withForest = put(scene(), 'disasters/forest', GRASS)
    const { state, itemId } = withCard(withForest.state, 'Deforestation')
    expect(isLegal(state, itemId, GRASS)).toBe(true)
    // ... and a forest square an earlier Drought turned into desert is no longer one
    const dry = put(scene(), 'disasters/drought', FOREST)
    const second = withCard(dry.state, 'Deforestation')
    expect(isLegal(second.state, second.itemId, FOREST)).toBe(false)
  })
})

describe('Drought', () => {
  it('puts a desert token on the chosen square, logs it, and makes the square desert', () => {
    const { state, itemId } = withCard(scene(), 'Drought')
    const cell = cellOf(state, GRASS)
    expect(terrainOfSpot(state, GRASS)).toBe('grassland')
    const played = unwrap(play(state, itemId, cell))
    expect(tokens(played)).toHaveLength(1)
    expect(tokens(played)[0]?.assetId).toBe('disasters/drought')
    expect(terrainOfSpot(played, GRASS)).toBe('desert')
    expect(played.log.at(-1)?.publicLog).toMatch(
      /^cash1981 played Drought item number #\d+ \(start of turn\), placing a disaster token on [A-Z]\d+, which is now a desert square$/,
    )
    expect(played.discardedItems.some((item) => item.id === itemId)).toBe(true)
    // The token is centred on its square
    const token = tokens(played)[0]
    expect(token === undefined ? null : mapCellOf(played.board, token)).toEqual(cell)
  })

  it('is undone by the vote: exactly the token it placed is taken off and the card returns', () => {
    const { state, itemId } = withCard(put(scene(), 'resources/wheat', GRASS).state, 'Drought')
    const played = unwrap(play(state, itemId, cellOf(state, GRASS)))
    const undone = undoByVote(played)
    expect(undone.board.pieces).toEqual(state.board.pieces)
    expect(terrainOfSpot(undone, GRASS)).toBe('grassland')
    expect(player(undone).items.some((item) => item.id === itemId)).toBe(true)
    expect(undone.log.at(-1)?.publicLog).toContain('the disaster token was taken off')
  })

  it('keeps an earlier disaster token on the square: a second one goes on top and the newest wins', () => {
    const first = put(scene(), 'disasters/water', DESERT)
    const { state, itemId } = withCard(first.state, 'Drought')
    expect(terrainOfSpot(state, DESERT)).toBe('water')
    expect(isLegal(state, itemId, DESERT)).toBe(true)
    const played = unwrap(play(state, itemId, cellOf(state, DESERT)))
    expect(tokens(played)).toHaveLength(2)
    expect(terrainOfSpot(played, DESERT)).toBe('desert')
    // Undo takes off the new token only and leaves the old one
    const undone = undoByVote(played)
    expect(tokens(undone).map((piece) => piece.id)).toEqual([first.piece.id])
    expect(terrainOfSpot(undone, DESERT)).toBe('water')
  })

  it.each([
    ['a Great Person marker', 'great people/builder'],
    ['a hut token', 'resources/hut'],
    ['a village token', 'resources/village'],
    ['a city marker', 'cities/redcity2'],
    ['a City-state marker', 'city-states/cs1'],
    ['an army', 'figures/redarmy'],
  ])('goes on a square with %s, and the token lies under it', (_name, assetId) => {
    const placed = put(scene(), assetId, GRASS)
    const { state, itemId } = withCard(placed.state, 'Drought')
    expect(isLegal(state, itemId, GRASS)).toBe(true)
    const played = unwrap(play(state, itemId, cellOf(state, GRASS)))
    const token = tokens(played)[0]
    if (token === undefined) throw new Error('no token')
    expect(indexOfPiece(played, token.id)).toBeLessThan(indexOfPiece(played, placed.piece.id))
    expect(terrainOfSpot(played, GRASS)).toBe('desert')
    // The token survives the marker being removed
    const removed = unwrap(removePiece(played, { playerId: A, pieceId: placed.piece.id }))
    expect(tokens(removed).map((piece) => piece.id)).toEqual([token.id])
    expect(terrainOfSpot(removed, GRASS)).toBe('desert')
    // An undo of the card with the marker still on the square takes off the token and leaves the marker
    const undone = undoByVote(played)
    expect(undone.board.pieces).toEqual(state.board.pieces)
  })

  it('is replayed and walked back in the board history with the token under the figure', () => {
    const placed = put(scene(), 'figures/redarmy', GRASS)
    const { state, itemId } = withCard(placed.state, 'Drought')
    const played = unwrap(play(state, itemId, cellOf(state, GRASS)))
    // The history replays to the same stack, and the step before the token has the figure alone
    expect(piecesAtStep(played.board.history, played.board.history.length)).toEqual(played.board.pieces)
    expect(piecesAtStep(played.board.history, played.board.history.length - 1).some((piece) => piece.category === 'disaster')).toBe(false)
    // The plain board Undo cannot take the token off alone: only the vote does, with the card
    expect(unwrapErr(undoLastBoardChange(played, A)).kind).toBe('BOARD_UNDO_ASSISTED')
    expect(tokens(played)).toHaveLength(1)
    expect(undoByVote(played).board.pieces).toEqual(placed.state.board.pieces)
  })

  it('goes above a disaster token that was placed by hand above a city, so the new token decides the terrain', () => {
    const city = put(scene(), 'cities/redcity2', GRASS)
    const hand = put(city.state, 'disasters/water', GRASS)
    // The hand-placed token lies above the city, so the lowest piece on the square is below it
    expect(indexOfPiece(hand.state, hand.piece.id)).toBeGreaterThan(indexOfPiece(hand.state, city.piece.id))
    const { state, itemId } = withCard(hand.state, 'Drought')
    expect(terrainOfSpot(state, GRASS)).toBe('water')
    const played = unwrap(play(state, itemId, cellOf(state, GRASS)))
    const added = tokens(played).find((piece) => piece.id !== hand.piece.id)
    if (added === undefined) throw new Error('no token')
    expect(indexOfPiece(played, added.id)).toBeGreaterThan(indexOfPiece(played, hand.piece.id))
    expect(terrainOfSpot(played, GRASS)).toBe('desert')
    expect(undoByVote(played).board.pieces).toEqual(state.board.pieces)
  })

  it('puts the token under the lowest marker when several stand on the square, above an older token', () => {
    const old = put(scene(), 'disasters/water', GRASS)
    const first = put(old.state, 'great people/builder', GRASS)
    const second = put(first.state, 'figures/redarmy', GRASS)
    const { state, itemId } = withCard(second.state, 'Drought')
    const played = unwrap(play(state, itemId, cellOf(state, GRASS)))
    const added = tokens(played).find((piece) => piece.id !== old.piece.id)
    if (added === undefined) throw new Error('no token')
    expect(indexOfPiece(played, added.id)).toBeGreaterThan(indexOfPiece(played, old.piece.id))
    expect(indexOfPiece(played, added.id)).toBeLessThan(indexOfPiece(played, first.piece.id))
    expect(indexOfPiece(played, first.piece.id)).toBeLessThan(indexOfPiece(played, second.piece.id))
  })

  it.each([
    ['a building', 'buildings/library'],
    ['a wonder', 'wonders/pyramids'],
  ])('is refused on a square with %s', (_name, assetId) => {
    const placed = put(scene(), assetId, GRASS)
    const { state, itemId } = withCard(placed.state, 'Drought')
    expect(isLegal(state, itemId, GRASS)).toBe(false)
    expect(reason(play(state, itemId, cellOf(state, GRASS)))).toContain('no building or wonder')
    expect(player(state).items.some((item) => item.id === itemId)).toBe(true)
  })

  it('is refused on a mountain square, also with a marker on it, and on a relic token that is still on the map', () => {
    const { state, itemId } = withCard(put(scene(), 'resources/village', MOUNTAIN).state, 'Drought')
    expect(reason(play(state, itemId, cellOf(state, MOUNTAIN)))).toContain('mountain')
    const relic = withCard(put(scene(), 'relics/ark_of_the_covenant', GRASS).state, 'Drought')
    expect(isLegal(relic.state, relic.itemId, GRASS)).toBe(false)
    expect(reason(play(relic.state, relic.itemId, cellOf(relic.state, GRASS)))).toContain('relic')
  })

  it('allows the square of a relic token that a player has taken', () => {
    const placed = put(scene(), 'relics/ark_of_the_covenant', GRASS)
    const taken = unwrap(removePiece(placed.state, { playerId: A, pieceId: placed.piece.id }))
    const { state, itemId } = withCard(taken, 'Drought')
    expect(isLegal(state, itemId, GRASS)).toBe(true)
  })

  it('does not let a resource token block it', () => {
    const { state, itemId } = withCard(put(scene(), 'resources/wheat', GRASS).state, 'Drought')
    expect(isLegal(state, itemId, GRASS)).toBe(true)
    expect(tokens(unwrap(play(state, itemId, cellOf(state, GRASS))))).toHaveLength(1)
  })

  it('refuses no square, a square off the map and a square of no tile, and plays nothing', () => {
    const { state, itemId } = withCard(scene(), 'Drought')
    expect(reason(play(state, itemId))).toContain('Choose the square')
    expect(reason(play(state, itemId, { column: 999, row: 999 }))).toContain('not a square of the map')
    // A map square in another slot has no tile laid yet
    const other = state.board.slots[1]
    if (other === undefined) throw new Error('no second slot')
    expect(reason(play(state, itemId, { column: other.x, row: other.y }))).toContain('no known terrain')
    expect(tokens(state)).toHaveLength(0)
    expect(player(state).items.some((item) => item.id === itemId)).toBe(true)
  })

  it('is rewound by a cancel card', () => {
    const joust = withCardInHand(scene(), 'Jousting Tourney', D)
    const card = withCard(joust.state, 'Drought')
    const baseline = card.state
    const played = unwrap(play(baseline, card.itemId, cellOf(baseline, GRASS), 'target'))
    expect(tokens(played)).toHaveLength(1)
    const logId = played.assistedActions.find((record) => record.id === 'target')?.logId ?? ''
    const cancelled = unwrap(applyCancellation(played, { playerId: D, requestId: 'cancel', command: { logId, itemId: joust.itemId } }, baseline))
    expect(tokens(cancelled)).toHaveLength(0)
    expect(terrainOfSpot(cancelled, GRASS)).toBe('grassland')
  })

  it('blocks the undo when the token has been taken off by hand, and says why', () => {
    const { state, itemId } = withCard(scene(), 'Drought')
    const played = unwrap(play(state, itemId, cellOf(state, GRASS)))
    const token = tokens(played)[0]
    if (token === undefined) throw new Error('no token')
    const gone = unwrap(removePiece(played, { playerId: A, pieceId: token.id }))
    const logId = gone.assistedActions[0]?.logId ?? ''
    const asked = unwrap(initiateUndo(gone, { logId, playerId: A }))
    let current = asked
    for (const voter of gone.players.filter((candidate) => candidate.playerId !== A)) {
      const voted = vote(current, { logId, playerId: voter.playerId, vote: true })
      if (voted.ok) current = voted.value
      else expect(JSON.stringify(voted.error)).toContain('no longer on the board')
    }
    expect(player(current).items.some((item) => item.id === itemId)).toBe(false)
  })
})

describe('Deforestation', () => {
  it('puts a grassland token on a forest square and makes it grassland', () => {
    const { state, itemId } = withCard(scene(), 'Deforestation')
    expect(terrainOfSpot(state, FOREST)).toBe('forest')
    const played = unwrap(play(state, itemId, cellOf(state, FOREST)))
    expect(tokens(played)[0]?.assetId).toBe('disasters/grassland')
    expect(terrainOfSpot(played, FOREST)).toBe('grassland')
    expect(undoByVote(played).board.pieces).toEqual(state.board.pieces)
  })

  it('is refused on a square that is not forest, naming its terrain', () => {
    const { state, itemId } = withCard(scene(), 'Deforestation')
    expect(reason(play(state, itemId, cellOf(state, GRASS)))).toContain('is a grassland square, and Deforestation needs a forest square')
    expect(reason(play(state, itemId, cellOf(state, MOUNTAIN)))).toContain('mountain')
  })

  it('goes on a forest square with a village token, under it, and is refused with a building there', () => {
    const village = put(scene(), 'resources/village', FOREST)
    const { state, itemId } = withCard(village.state, 'Deforestation')
    const played = unwrap(play(state, itemId, cellOf(state, FOREST)))
    const token = tokens(played)[0]
    if (token === undefined) throw new Error('no token')
    expect(indexOfPiece(played, token.id)).toBeLessThan(indexOfPiece(played, village.piece.id))
    const built = withCard(put(scene(), 'buildings/library', FOREST).state, 'Deforestation')
    expect(reason(play(built.state, built.itemId, cellOf(built.state, FOREST)))).toContain('no building or wonder')
  })

  it('goes on a forest square that already holds a disaster token only while that token still shows forest', () => {
    const grass = put(scene(), 'disasters/grassland', FOREST)
    const { state, itemId } = withCard(grass.state, 'Deforestation')
    expect(isLegal(state, itemId, FOREST)).toBe(false)
  })
})

describe('Flooding', () => {
  it('puts a water token on a non-mountain square, on land or on water', () => {
    const { state, itemId } = withCard(scene(), 'Flooding')
    const played = unwrap(play(state, itemId, cellOf(state, GRASS)))
    expect(tokens(played)[0]?.assetId).toBe('disasters/water')
    expect(terrainOfSpot(played, GRASS)).toBe('water')
    const onWater = unwrap(play(state, itemId, cellOf(state, WATER)))
    expect(terrainOfSpot(onWater, WATER)).toBe('water')
    expect(undoByVote(played).board.pieces).toEqual(state.board.pieces)
    expect(reason(play(state, itemId, cellOf(state, MOUNTAIN)))).toContain('mountain')
  })

  it.each([
    ['a figure', 'figures/redarmy'],
    ['a hut token', 'resources/hut'],
    ['a village token', 'resources/village'],
    ['a relic token', 'relics/ark_of_the_covenant'],
    ['a Great Person marker', 'great people/builder'],
    ['a disaster token', 'disasters/drought'],
  ])('is refused on a square with %s', (_name, assetId) => {
    const { state, itemId } = withCard(put(scene(), assetId, GRASS).state, 'Flooding')
    expect(isLegal(state, itemId, GRASS)).toBe(false)
    expect(reason(play(state, itemId, cellOf(state, GRASS)))).toContain(assetId.startsWith('relics/') ? 'relic' : 'Flooding needs a square with no')
    expect(tokens(state).length).toBe(assetId.startsWith('disasters/') ? 1 : 0)
  })

  it.each([
    ['a building', 'buildings/library'],
    ['a wonder', 'wonders/pyramids'],
    ['a city marker', 'cities/redcity2'],
    ['a City-state marker', 'city-states/cs1'],
  ])('is not refused for %s (the rulings do not list it) and the token lies under it', (_name, assetId) => {
    const placed = put(scene(), assetId, GRASS)
    const { state, itemId } = withCard(placed.state, 'Flooding')
    expect(isLegal(state, itemId, GRASS)).toBe(true)
    const played = unwrap(play(state, itemId, cellOf(state, GRASS)))
    const token = tokens(played)[0]
    if (token === undefined) throw new Error('no token')
    expect(indexOfPiece(played, token.id)).toBeLessThan(indexOfPiece(played, placed.piece.id))
  })

  it('is not blocked by a resource token', () => {
    const { state, itemId } = withCard(put(scene(), 'resources/wheat', GRASS).state, 'Flooding')
    expect(isLegal(state, itemId, GRASS)).toBe(true)
  })
})

describe('what the other players see', () => {
  it('lists the squares only in the own playable list, and the token only as a board piece', () => {
    const { state, itemId } = withCard(scene(), 'Drought')
    const own = toPlayerView(state, A).you?.playableCards.find((card) => card.itemId === itemId)
    expect(own?.squares?.length).toBeGreaterThan(0)
    expect(JSON.stringify(toPlayerView(state, B))).not.toContain('Drought')
    const played = unwrap(play(state, itemId, cellOf(state, GRASS)))
    const theirs = JSON.stringify(toPlayerView(played, B))
    expect(theirs).not.toContain('"squares"')
    expect(theirs).not.toContain('"effect"')
  })
})
