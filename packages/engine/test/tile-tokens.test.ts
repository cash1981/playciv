/**
 * Hut and village tokens on the map (issue #364): placed when a tile is laid, kept on their printed squares
 * when the tile is turned, and collected by a figure that ends its move on one.
 */

import { describe, expect, it } from 'vitest'

import {
  movePiece,
  placePiece,
  rotatePiece,
  undoLastBoardChange,
} from '../src/actions/board.js'
import { drawTileAt } from '../src/actions/draw.js'
import { exploreSquare } from '../src/actions/explore.js'
import { travelFigureCollecting } from '../src/actions/token-collection.js'
import { mapCellOf } from '../src/blockade.js'
import { SQUARE_SIZE, areaAt, findBoardAsset, mapTop, playerAreas } from '../src/board.js'
import type { BoardPiece, Rotation } from '../src/board.js'
import { itemName } from '../src/item.js'
import { unwrap } from '../src/result.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { GameState, Playerhand } from '../src/state.js'
import { tileSquareAt } from '../src/terrain.js'
import { tileTokenSquares } from '../src/tile-icons.js'
import { lookUnderTokens, mapTokensOf } from '../src/zheng-he.js'

import { CASH1981, KARANDRAS1, firstCivGame } from './fixture.js'

function game(): GameState {
  const base = firstCivGame()
  const colours = ['Red', 'Blue', 'Green', 'Purple']
  return {
    ...base,
    players: base.players.map((player, index) => ({
      ...player,
      color: colours[index] ?? 'Yellow',
      stats: { ...player.stats, mvmt: '3', stacking: 2 },
    })),
  }
}

const me = (state: GameState, playerId = CASH1981): Playerhand => {
  const found = findPlayer(state, playerId)
  if (found === undefined) throw new Error(`no player ${playerId}`)
  return found
}

/** The deck's next exploration tile is the one with this printed number. */
function withTopTile(state: GameState, name: string): GameState {
  const index = state.items.findIndex((item) => item.sheetName === 'TILES' && item.name === name)
  if (index < 0) throw new Error(`no tile ${name} in the deck`)
  const items = [...state.items]
  const [tile] = items.splice(index, 1)
  const first = items.findIndex((item) => item.sheetName === 'TILES')
  items.splice(first, 0, tile as (typeof items)[number])
  return { ...state, items }
}

function put(state: GameState, assetId: string, column: number, row: number): GameState {
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`missing asset ${assetId}`)
  return unwrap(
    placePiece(state, {
      playerId: CASH1981,
      assetId,
      x: Math.round(column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2),
      y: Math.round(mapTop(state.board) + row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2),
    }),
  )
}

const tokensOf = (state: GameState) =>
  mapTokensOf(state.board).map((token) => ({ kind: token.sheet, column: token.cell.column, row: token.cell.row }))

const tileOf = (state: GameState, assetId: string): BoardPiece => {
  const tile = state.board.pieces.find((piece) => piece.assetId === assetId)
  if (tile === undefined) throw new Error(`no ${assetId} on the board`)
  return tile
}

/** Tile 4 has a village on printed row 1, column 1 and a hut on row 3, column 3. */
const START = (): GameState => put(game(), 'tiles/tile05', 0, 0)
const EXPLORING = (): GameState => {
  const withArmy = put(START(), 'figures/redarmy', 3, 1)
  return withTopTile(withArmy, '4')
}
const explore = (state: GameState): GameState => {
  const army = state.board.pieces.find((piece) => piece.category === 'figure')
  if (army === undefined) throw new Error('no army')
  return unwrap(exploreSquare(state, { playerId: CASH1981, pieceId: army.id, column: 4, row: 1 }))
}

describe('placing tokens on a laid tile', () => {
  it('puts a village and a hut on the printed squares of an explored tile', () => {
    const explored = explore(EXPLORING())
    // The tile fills squares E1 to H4 and is laid turned 90 degrees, as the army explored from the west: its village is
    // printed on row 1, column 1 and its hut on row 3, column 3, which that turn puts on row 1, column 2 and row 3, column 0
    expect(tileOf(explored, 'tiles/tile04').rotation).toBe(90)
    expect(tokensOf(explored)).toEqual([
      { kind: 'VILLAGES', column: 6, row: 1 },
      { kind: 'HUTS', column: 4, row: 3 },
    ])
    const village = mapTokensOf(explored.board)[0]
    expect(village?.piece.x).toBe(Math.round(6 * SQUARE_SIZE + (SQUARE_SIZE - (village?.piece.width ?? 0)) / 2))
    expect(village?.piece.tileId).toBe(tileOf(explored, 'tiles/tile04').id)
  })

  it('lays the relic marker of an explored tile on its printed square, with the tile turned', () => {
    const state = withTopTile(put(START(), 'figures/redarmy', 3, 1), '15')
    expect(tileTokenSquares('tiles/tile15a')).toEqual([{ row: 1, column: 2, assetId: 'relics/atlantis' }])
    const explored = explore(state)
    // Printed on row 1, column 2; the tile is turned 90 degrees, which puts it on row 2, column 2 of the tile (G3)
    const relic = explored.board.pieces.find((piece) => piece.category === 'relic')
    expect(relic?.assetId).toBe('relics/atlantis')
    expect(mapCellOf(explored.board, relic as BoardPiece)).toEqual({ column: 6, row: 2 })
    // Hut and village tokens only: a relic is not drawn from
    expect(tokensOf(explored)).toEqual([])

    // The marker goes before the tile on Undo, and is not laid a second time
    const undone = unwrap(undoLastBoardChange(explored, CASH1981))
    expect(undone.board.pieces.some((piece) => piece.category === 'relic')).toBe(false)
  })

  it('keeps the relic marker on its printed square when the tile is turned', () => {
    const explored = explore(withTopTile(put(START(), 'figures/redarmy', 3, 1), '15'))
    const turned = unwrap(rotatePiece(explored, { playerId: CASH1981, pieceId: tileOf(explored, 'tiles/tile15a').id, rotation: 0 }))
    const relic = turned.board.pieces.find((piece) => piece.category === 'relic')
    expect(mapCellOf(turned.board, relic as BoardPiece)).toEqual({ column: 6, row: 1 })
  })

  it('does not place them for a tile that is not on a map slot, and places them once when it arrives', () => {
    const base = game()
    const area = playerAreas(base.board, base.players).find((candidate) => candidate.playerId === CASH1981)
    if (area === undefined) throw new Error('no area')
    let state = unwrap(placePiece(base, { playerId: CASH1981, assetId: 'tiles/tile04', x: area.x + 10, y: area.y + 40 }))
    expect(tokensOf(state)).toEqual([])
    const tile = tileOf(state, 'tiles/tile04')

    state = unwrap(movePiece(state, { playerId: CASH1981, pieceId: tile.id, x: 4 * SQUARE_SIZE, y: mapTop(state.board) }))
    expect(tokensOf(state)).toHaveLength(2)

    // Setting it into another slot afterwards adds nothing, and the tokens go with the tile
    const before = tokensOf(state)
    const moved = unwrap(movePiece(state, { playerId: CASH1981, pieceId: tile.id, x: 8 * SQUARE_SIZE, y: mapTop(state.board) }))
    expect(tokensOf(moved)).toEqual(before.map((token) => ({ ...token, column: token.column + 4 })))

    // One Undo puts the tile and its tokens back
    expect(tokensOf(unwrap(undoLastBoardChange(moved, CASH1981)))).toEqual(before)
  })

  it('takes the tokens along when a laid tile is moved off the map and back again, without a second set', () => {
    const laid = explore(EXPLORING())
    const tile = tileOf(laid, 'tiles/tile04')
    const area = playerAreas(laid.board, laid.players).find((candidate) => candidate.playerId === CASH1981)
    if (area === undefined) throw new Error('no area')
    const away = unwrap(movePiece(laid, { playerId: CASH1981, pieceId: tile.id, x: area.x + 10, y: area.y + 40 }))
    expect(tokensOf(away)).toHaveLength(0)
    const back = unwrap(movePiece(away, { playerId: CASH1981, pieceId: tile.id, x: 4 * SQUARE_SIZE, y: mapTop(away.board) }))
    expect(tokensOf(back)).toHaveLength(2)
  })

  it('lays them for a manual tile draw that lands on a map slot', () => {
    const state = unwrap(drawTileAt(withTopTile(game(), '4'), CASH1981, [0, mapTop(game().board)]))
    expect(tokensOf(state)).toHaveLength(2)
  })

  it('is taken back by Undo in order: both tokens, then the tile, then the movement', () => {
    const state = EXPLORING()
    let explored = explore(state)
    const kinds = []
    for (let step = 0; step < 4; step++) {
      explored = unwrap(undoLastBoardChange(explored, CASH1981))
      kinds.push([tokensOf(explored).length, explored.board.pieces.filter((piece) => piece.category === 'tile').length])
    }
    expect(kinds).toEqual([[1, 2], [0, 2], [0, 1], [0, 1]])
    expect(explored.board.pieces.find((piece) => piece.category === 'figure')?.movement).toBeUndefined()
  })
})

describe('turning the tile', () => {
  it.each([90, 180, 270, 0] as Rotation[])('keeps the tokens on their printed squares at %i degrees, and Undo puts them back', (rotation) => {
    const explored = explore(EXPLORING())
    const tile = tileOf(explored, 'tiles/tile04')
    const turned = unwrap(rotatePiece(explored, { playerId: CASH1981, pieceId: tile.id, rotation }))
    const squares = mapTokensOf(turned.board).map((token) => {
      const square = tileSquareAt(turned.board, token.piece.x + token.piece.width / 2, token.piece.y + token.piece.height / 2)
      return { kind: token.sheet, row: square?.row, column: square?.column }
    })
    expect(squares).toEqual(
      expect.arrayContaining([
        { kind: 'VILLAGES', row: 1, column: 1 },
        { kind: 'HUTS', row: 3, column: 3 },
      ]),
    )
    // Each token is centred on its square
    for (const token of mapTokensOf(turned.board)) {
      expect(Math.abs(token.piece.x + token.piece.width / 2 - (token.cell.column + 0.5) * SQUARE_SIZE)).toBeLessThanOrEqual(1)
    }
    if (rotation !== 0) {
      const back = unwrap(undoLastBoardChange(turned, CASH1981))
      expect(tokensOf(back)).toEqual(tokensOf(explored))
    }
  })

  it('moves the tokens back to the printed squares when the laid tile is turned upright', () => {
    const explored = explore(EXPLORING())
    const tile = tileOf(explored, 'tiles/tile04')
    const turned = unwrap(rotatePiece(explored, { playerId: CASH1981, pieceId: tile.id, rotation: 0 }))
    expect(tokensOf(turned)).toEqual([
      { kind: 'VILLAGES', column: 5, row: 1 },
      { kind: 'HUTS', column: 7, row: 3 },
    ])
  })
})

describe('collecting a token by ending a move on it', () => {
  const scene = (): { state: GameState; armyId: string; hutId: string } => {
    let state = put(put(START(), 'figures/redarmy', 3, 2), 'resources/hut', 3, 1)
    const army = state.board.pieces.find((piece) => piece.category === 'figure') as BoardPiece
    const hut = state.board.pieces.find((piece) => piece.assetId === 'resources/hut') as BoardPiece
    state = { ...state, log: [...state.log] }
    return { state, armyId: army.id, hutId: hut.id }
  }
  const go = (state: GameState, armyId: string, collectToken?: boolean): GameState =>
    unwrap(
      travelFigureCollecting(state, {
        playerId: CASH1981,
        pieceId: armyId,
        column: 3,
        row: 1,
        ...(collectToken === undefined ? {} : { collectToken }),
      }),
    )

  it('leaves the token on its square unless the player confirms', () => {
    const { state, armyId, hutId } = scene()
    const moved = go(state, armyId)
    expect(moved.board.pieces.find((piece) => piece.id === hutId)?.y).toBe(state.board.pieces.find((piece) => piece.id === hutId)?.y)
    expect(me(moved).items).toHaveLength(me(state).items.length)
    expect(moved.tokenCollections).toBeUndefined()
  })

  it("leaves the token while another player's figures stand on its square: the battle comes first", () => {
    const { state, armyId } = scene()
    const contested = put(state, 'figures/bluearmy', 3, 1)
    const moved = go(contested, armyId, true)
    expect(mapTokensOf(moved.board)).toHaveLength(1)
    expect(me(moved).items).toHaveLength(me(contested).items.length)
    expect(moved.tokenCollections).toBeUndefined()
  })

  it('moves the token into the area, draws the card privately and logs only that a hut was drawn', () => {
    const { state, armyId, hutId } = scene()
    const topHut = state.items.find((item) => item.sheetName === 'HUTS')
    const moved = go(state, armyId, true)

    const token = moved.board.pieces.find((piece) => piece.id === hutId) as BoardPiece
    const area = areaAt(
      playerAreas(moved.board, moved.players),
      token.x + token.width / 2,
      token.y + token.height / 2,
    )
    expect(area?.playerId).toBe(CASH1981)
    expect(mapTokensOf(moved.board)).toHaveLength(0)

    const drawn = me(moved).items.find((item) => item.id === topHut?.id)
    expect(drawn?.sheetName).toBe('HUTS')
    expect(moved.log.some((entry) => entry.publicLog.includes('drew the hut from the token on D2'))).toBe(true)
    // The public line names no card
    expect(moved.log.filter((entry) => entry.publicLog.includes('token on D2')).every((entry) => !entry.publicLog.includes(drawn === undefined ? '\u0000' : itemName(drawn)))).toBe(true)

    // Nothing of the card is in what another player sees
    const other = JSON.stringify(toPlayerView(moved, KARANDRAS1))
    expect(other).not.toContain(topHut?.id ?? 'x')
    expect(other).not.toContain('tokenCollections')
  })

  it('is taken back by two Undos: the token and card first, then the move', () => {
    const { state, armyId, hutId } = scene()
    const topHut = state.items.find((item) => item.sheetName === 'HUTS')
    const moved = go(state, armyId, true)

    const first = unwrap(undoLastBoardChange(moved, CASH1981))
    expect(mapTokensOf(first.board).map((token) => token.piece.id)).toEqual([hutId])
    expect(me(first).items.some((item) => item.id === topHut?.id)).toBe(false)
    // The card stays with its token instead of becoming the next card of the deck, which nobody should know
    expect(first.items.find((item) => item.sheetName === 'HUTS')?.id).not.toBe(topHut?.id)
    expect(first.underTokens?.find((token) => token.pieceId === hutId)?.item.id).toBe(topHut?.id)
    expect(first.tokenCollections ?? []).toHaveLength(0)
    // and the draw's own log line can no longer be voted back
    expect(first.log.filter((entry) => entry.item?.id === topHut?.id).every((entry) => entry.superseded === true && entry.undo === null)).toBe(true)
    expect(first.board.redo).toHaveLength(0)

    const second = unwrap(undoLastBoardChange(first, CASH1981))
    const army = second.board.pieces.find((piece) => piece.id === armyId) as BoardPiece
    expect(army.y).toBe((state.board.pieces.find((piece) => piece.id === armyId) as BoardPiece).y)
  })

  it('gives what Zheng He saw under the token, and puts it back under it on Undo', () => {
    const { state, armyId, hutId } = scene()
    const looked = lookUnderTokens(state, [])
    const looking = looked.state
    const seen = looking.underTokens?.find((token) => token.pieceId === hutId)?.item
    expect(seen).toBeDefined()

    const moved = go(looking, armyId, true)
    expect(me(moved).items.some((item) => item.id === seen?.id)).toBe(true)
    expect(moved.underTokens?.some((token) => token.pieceId === hutId) ?? false).toBe(false)

    const undone = unwrap(undoLastBoardChange(moved, CASH1981))
    expect(me(undone).items.some((item) => item.id === seen?.id)).toBe(false)
    expect(undone.underTokens?.find((token) => token.pieceId === hutId)?.item.id).toBe(seen?.id)
  })

  it('refuses the Undo once the card has left the hand', () => {
    const { state, armyId } = scene()
    const moved = go(state, armyId, true)
    const gone: GameState = {
      ...moved,
      players: moved.players.map((player) =>
        player.playerId === CASH1981 ? { ...player, items: player.items.filter((item) => item.sheetName !== 'HUTS') } : player,
      ),
    }
    const refused = undoLastBoardChange(gone, CASH1981)
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error.kind).toBe('BOARD_UNDO_TOKEN_CARD_GONE')
  })

  it('clears the redo stack when it takes a collection back, so a Redo cannot move the token without its card', () => {
    const { state, armyId, hutId } = scene()
    let moved = go(state, armyId, true)
    // The player nudges the token in their area, undoes that, then undoes the collection
    const token = moved.board.pieces.find((piece) => piece.id === hutId) as BoardPiece
    moved = unwrap(movePiece(moved, { playerId: CASH1981, pieceId: hutId, x: token.x + 5, y: token.y, snap: false }))
    moved = unwrap(undoLastBoardChange(moved, CASH1981))
    expect(moved.board.redo).toHaveLength(1)
    const undone = unwrap(undoLastBoardChange(moved, CASH1981))
    expect(undone.board.redo).toHaveLength(0)
    expect(mapTokensOf(undone.board)).toHaveLength(1)
  })

  it('does not carry a collected token or a loose piece lying under a tile in an area when the tile is moved', () => {
    const base = game()
    const area = playerAreas(base.board, base.players).find((candidate) => candidate.playerId === CASH1981)
    if (area === undefined) throw new Error('no area')
    let state = unwrap(placePiece(base, { playerId: CASH1981, assetId: 'tiles/tile04', x: area.x + 10, y: area.y + 40 }))
    const tile = tileOf(state, 'tiles/tile04')
    // A loose hut lies in the area under the tile's footprint
    state = unwrap(placePiece(state, { playerId: CASH1981, assetId: 'resources/hut', x: tile.x + 50, y: tile.y + 50 }))
    const hut = state.board.pieces.find((piece) => piece.assetId === 'resources/hut') as BoardPiece
    state = unwrap(movePiece(state, { playerId: CASH1981, pieceId: tile.id, x: 4 * SQUARE_SIZE, y: mapTop(state.board) }))
    expect(state.board.pieces.find((piece) => piece.id === hut.id)?.x).toBe(hut.x)
    expect(tokensOf(state)).toHaveLength(2)
  })

  it('seals the draw line against an independent undo vote and still moves the token off the map when the area is full', () => {
    const { state, armyId, hutId } = scene()
    const area = playerAreas(state.board, state.players).find((candidate) => candidate.playerId === CASH1981)
    if (area === undefined) throw new Error('no area')
    // Fill the area with markers, so no tidy slot is free
    let full = state
    for (let index = 0; index < 400; index++) {
      const placed = placePiece(full, { playerId: CASH1981, assetId: 'markers/coin1', x: area.x + 20 + (index % 20) * 30, y: area.y + 60 + Math.floor(index / 20) * 30 })
      if (!placed.ok) break
      full = placed.value
    }
    const moved = go(full, armyId, true)
    const token = moved.board.pieces.find((piece) => piece.id === hutId) as BoardPiece
    expect(mapTokensOf(moved.board).some((candidate) => candidate.piece.id === hutId)).toBe(false)
    expect(areaAt(playerAreas(moved.board, moved.players), token.x + token.width / 2, token.y + token.height / 2)?.playerId).toBe(CASH1981)
    const card = me(moved).items.find((item) => item.sheetName === 'HUTS')
    expect(moved.log.filter((entry) => entry.item?.id === card?.id && entry.logType === 'ITEM').every((entry) => entry.superseded === true && entry.undo === null)).toBe(true)
  })
})

describe('the Chinese and huts', () => {
  const chinese = (civ: string, culture = 5) => {
    const scene = put(put(START(), 'figures/redarmy', 3, 2), 'resources/hut', 3, 1)
    const withCiv: GameState = {
      ...scene,
      players: scene.players.map((player) =>
        player.playerId === CASH1981
          ? { ...player, civilization: { kind: 'civ', name: civ } as unknown as Playerhand['civilization'], stats: { ...player.stats, culture } }
          : player,
      ),
    }
    const army = withCiv.board.pieces.find((piece) => piece.category === 'figure') as BoardPiece
    return { state: withCiv, armyId: army.id }
  }
  const collect = (state: GameState, armyId: string) =>
    unwrap(travelFigureCollecting(state, { playerId: CASH1981, pieceId: armyId, column: 3, row: 1, collectToken: true }))

  it('gain 3 (8) culture and say so publicly when a figure collects a hut, and nobody else does', () => {
    const { state, armyId } = chinese('Chinese')
    const moved = collect(state, armyId)
    expect(me(moved).stats.culture).toBe(8)
    expect(moved.log.some((entry) => entry.publicLog === 'cash1981 gained 3 (8) culture from the hut on D2 as the Chinese')).toBe(true)
    // The line is counted into the token's board entry, and no other player's view carries the card
    expect(moved.board.history.at(-1)?.logLength).toBe(moved.log.length)
    const drawn = me(moved).items.find((item) => item.sheetName === 'HUTS')
    expect(JSON.stringify(toPlayerView(moved, KARANDRAS1))).not.toContain(drawn?.id ?? 'x')

    const roman = chinese('Romans')
    const plain = collect(roman.state, roman.armyId)
    expect(me(plain).stats.culture).toBe(5)
    expect(plain.log.some((entry) => entry.publicLog.includes('as the Chinese'))).toBe(false)
  })

  it('gain 3 culture for a village too, say village in the line, and lose it again with the board Undo', () => {
    const scene = put(put(START(), 'figures/redarmy', 3, 2), 'resources/village', 3, 1)
    const state: GameState = {
      ...scene,
      players: scene.players.map((player) =>
        player.playerId === CASH1981
          ? { ...player, civilization: { kind: 'civ', name: 'Chinese' } as unknown as Playerhand['civilization'], stats: { ...player.stats, culture: 5 } }
          : player,
      ),
    }
    const army = state.board.pieces.find((piece) => piece.category === 'figure') as BoardPiece
    const moved = collect(state, army.id)
    expect(me(moved).stats.culture).toBe(8)
    expect(moved.log.some((entry) => entry.publicLog === 'cash1981 gained 3 (8) culture from the village on D2 as the Chinese')).toBe(true)
    const undone = unwrap(undoLastBoardChange(moved, CASH1981))
    expect(me(undone).stats.culture).toBe(5)
    expect(undone.log.at(-1)?.publicLog).toContain('put the village token on D2 back')
    expect(undone.log.at(-1)?.publicLog).toContain('took back 3 (5) culture')
  })

  it('gain nothing when the figure does not collect, and nothing for a relic', () => {
    const { state, armyId } = chinese('Chinese')
    const declined = unwrap(travelFigureCollecting(state, { playerId: CASH1981, pieceId: armyId, column: 3, row: 1 }))
    expect(me(declined).stats.culture).toBe(5)

    const relic = put(put(START(), 'figures/redarmy', 3, 2), 'relics/atlantis', 3, 1)
    const chineseRelic: GameState = {
      ...relic,
      players: relic.players.map((player) =>
        player.playerId === CASH1981
          ? { ...player, civilization: { kind: 'civ', name: 'Chinese' } as unknown as Playerhand['civilization'], stats: { ...player.stats, culture: 5 } }
          : player,
      ),
    }
    const relicArmy = chineseRelic.board.pieces.find((piece) => piece.category === 'figure') as BoardPiece
    expect(me(collect(chineseRelic, relicArmy.id)).stats.culture).toBe(5)
  })

  it('lose the culture again when the board Undo returns the token, and the Undo is refused once it is spent', () => {
    const { state, armyId } = chinese('Chinese')
    const moved = collect(state, armyId)
    const undone = unwrap(undoLastBoardChange(moved, CASH1981))
    expect(me(undone).stats.culture).toBe(5)
    expect(undone.log.at(-1)?.publicLog).toContain('took back 3 (5) culture')

    const spent: GameState = {
      ...moved,
      players: moved.players.map((player) =>
        player.playerId === CASH1981 ? { ...player, stats: { ...player.stats, culture: 1 } } : player,
      ),
    }
    const refused = undoLastBoardChange(spent, CASH1981)
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error.kind).toBe('BOARD_UNDO_TOKEN_CULTURE_SPENT')
  })
})

describe('scouts and relics', () => {
  const travel = (state: GameState, pieceId: string, column: number, row: number, collectToken = false) =>
    travelFigureCollecting(state, { playerId: CASH1981, pieceId, column, row, ...(collectToken ? { collectToken } : {}) })
  const pieceOf = (state: GameState, assetId: string): BoardPiece => {
    const found = state.board.pieces.find((piece) => piece.assetId === assetId)
    if (found === undefined) throw new Error(`no ${assetId}`)
    return found
  }

  it('keeps a scout off a hut or a village, and does not let it cross one to a square it could not otherwise reach', () => {
    for (const marker of ['resources/hut', 'resources/village']) {
      const state = put(put(START(), 'figures/redscout', 3, 2), marker, 3, 1)
      const scout = pieceOf(state, 'figures/redscout')
      expect(travel(state, scout.id, 3, 1).ok).toBe(false)
      // Going round the marker takes four steps and the speed is 3
      expect(travel(state, scout.id, 3, 0).ok).toBe(false)
      expect(travel(state, scout.id, 2, 1).ok).toBe(true)
    }
  })

  it('lets a scout onto a hut, but not a village or a relic, under a revealed Pacifism', () => {
    const policyOf = (hidden: boolean) => [{ name: 'Pacifism', hidden } as Playerhand['socialPolicies'][number]]
    const withPolicy = (state: GameState, hidden: boolean): GameState => ({
      ...state,
      players: state.players.map((player) => (player.playerId === CASH1981 ? { ...player, socialPolicies: policyOf(hidden) } : player)),
    })
    for (const [marker, allowed] of [['resources/hut', true], ['resources/village', false], ['relics/atlantis', false]] as const) {
      const state = withPolicy(put(put(START(), 'figures/redscout', 3, 2), marker, 3, 1), false)
      expect(travel(state, pieceOf(state, 'figures/redscout').id, 3, 1).ok).toBe(allowed)
    }
    // A policy that is not revealed has no effect
    const hidden = withPolicy(put(put(START(), 'figures/redscout', 3, 2), 'resources/hut', 3, 1), true)
    expect(travel(hidden, pieceOf(hidden, 'figures/redscout').id, 3, 1).ok).toBe(false)
  })

  it('keeps a scout off a relic unless an army of its owner already stands there', () => {
    const base = put(put(START(), 'figures/redscout', 3, 2), 'relics/atlantis', 3, 1)
    const scout = pieceOf(base, 'figures/redscout')
    expect(travel(base, scout.id, 3, 1).ok).toBe(false)
    const accompanied = put(base, 'figures/redarmy', 3, 1)
    expect(travel(accompanied, scout.id, 3, 1).ok).toBe(true)
  })

  it('lets a scout enter the square alone once the relic marker has been taken', () => {
    const state = put(put(put(START(), 'figures/redarmy', 3, 2), 'figures/redscout', 2, 1), 'relics/atlantis', 3, 1)
    const scout = pieceOf(state, 'figures/redscout')
    expect(travel(state, scout.id, 3, 1).ok).toBe(false)
    const taken = unwrap(travel(state, pieceOf(state, 'figures/redarmy').id, 3, 1, true))
    // The army moves on and leaves the square; the marker is gone, so nothing keeps the scout out
    const armyId = pieceOf(taken, 'figures/redarmy').id
    const cleared = unwrap(movePiece(taken, { playerId: CASH1981, pieceId: armyId, x: 0, y: mapTop(taken.board) + 5 * SQUARE_SIZE }))
    expect(travel(cleared, pieceOf(cleared, 'figures/redscout').id, 3, 1).ok).toBe(true)
  })

  it('lets an army end on a relic square, and removes the marker only when the player confirms', () => {
    const state = put(put(START(), 'figures/redarmy', 3, 2), 'relics/atlantis', 3, 1)
    const army = pieceOf(state, 'figures/redarmy')
    const left = unwrap(travel(state, army.id, 3, 1))
    expect(left.board.pieces.some((piece) => piece.category === 'relic')).toBe(true)
    expect(left.board.pieces.find((piece) => piece.id === army.id)?.movement?.locked).toBe(false)

    const taken = unwrap(travel(state, army.id, 3, 1, true))
    expect(taken.board.pieces.some((piece) => piece.category === 'relic')).toBe(false)
    const last = taken.board.history.at(-1)
    expect(last?.change.kind).toBe('remove')
    expect(last?.playerId).toBe(CASH1981)
    // Taking the relic ends the army's movement for the turn
    expect(taken.board.pieces.find((piece) => piece.id === army.id)?.movement?.locked).toBe(true)
    expect(taken.log.some((entry) => entry.publicLog.includes('took the Atlantis relic on D2'))).toBe(true)

    // Undo puts the marker back first, then takes the move back
    const undone = unwrap(undoLastBoardChange(taken, CASH1981))
    expect(undone.board.pieces.some((piece) => piece.category === 'relic')).toBe(true)
    expect(undone.board.pieces.find((piece) => piece.id === army.id)?.movement?.locked).toBe(true)
  })

  it('leaves the marker when the army moves onto another player\'s figures: the battle comes first', () => {
    const state = put(put(put(START(), 'figures/redarmy', 3, 2), 'relics/atlantis', 3, 1), 'figures/bluearmy', 3, 1)
    const army = pieceOf(state, 'figures/redarmy')
    const moved = unwrap(travel(state, army.id, 3, 1, true))
    expect(moved.board.pieces.some((piece) => piece.category === 'relic')).toBe(true)
  })

  it('does not take a relic for a scout that is allowed to stand on it', () => {
    const state = put(put(put(START(), 'figures/redarmy', 3, 1), 'figures/redscout', 3, 2), 'relics/atlantis', 3, 1)
    const scout = pieceOf(state, 'figures/redscout')
    const moved = unwrap(travel(state, scout.id, 3, 1, true))
    expect(moved.board.pieces.some((piece) => piece.category === 'relic')).toBe(true)
  })
})
