/**
 * Zheng He: "Any Time: You may discard this card to look under every hut and village token on the map
 * and/or owned by other players."
 *
 * The pieces on the map are anonymous, so the look fixes what lies under each one: the item is taken out of
 * the deck and set under the piece, and the piece's draw gives it back.
 */

import { describe, expect, it } from 'vitest'

import { draw } from '../src/actions/draw.js'
import { movePiece, placePiece, removePiece, undoLastBoardChange } from '../src/actions/board.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { performAssistedAction } from '../src/assisted.js'
import { shuffleDeckTwice } from '../src/assisted-culture.js'
import { SQUARE_SIZE, findBoardAsset, mapTop } from '../src/board.js'
import { itemName } from '../src/item.js'
import type { HutItem, Item } from '../src/item.js'
import { unwrap } from '../src/result.js'
import { lookUnderTokens } from '../src/zheng-he.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { GameState, Playerhand } from '../src/state.js'

import { withCardInHand, withHutInHand } from './assisted-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-10-31T10:00:00.000Z'
const OTHERS = [KARANDRAS1, ITCHI, CHUL]

const me = (state: GameState, playerId = CASH1981): Playerhand => {
  const found = findPlayer(state, playerId)
  if (found === undefined) throw new Error(`no player ${playerId}`)
  return found
}

/** One explored tile (squares A1 to D4) with a hut on C2 and a village on B4. */
function scene(): { readonly state: GameState; readonly cardId: string; readonly hutPieceId: string; readonly villagePieceId: string } {
  const base = firstCivGame()
  let state = unwrap(placePiece(base, { playerId: CASH1981, assetId: 'tiles/tile05', x: 0, y: mapTop(base.board) }))
  const put = (assetId: string, column: number, row: number): string => {
    const asset = findBoardAsset(assetId)
    if (asset === undefined) throw new Error(`missing asset ${assetId}`)
    state = unwrap(
      placePiece(state, {
        playerId: CASH1981,
        assetId,
        x: Math.round(column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2),
        y: Math.round(mapTop(state.board) + row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2),
      }),
    )
    return (state.board.pieces.at(-1) as { id: string }).id
  }
  const hutPieceId = put('resources/hut', 2, 1)
  const villagePieceId = put('resources/village', 1, 3)
  const card = withCardInHand(state, 'Zheng He')
  return { state: card.state, cardId: card.itemId, hutPieceId, villagePieceId }
}

const play = (state: GameState, cardId: string, requestId = 'z1') =>
  performAssistedAction(state, { playerId: CASH1981, action: 'playCard', requestId, at: AT, payload: { itemId: cardId, targets: [] } })

const topOf = (state: GameState, sheetName: Item['sheetName'], index = 0): Item => {
  const item = state.items.filter((candidate) => candidate.sheetName === sheetName)[index]
  if (item === undefined) throw new Error(`no ${sheetName} item`)
  return item
}

const privateLines = (state: GameState): readonly string[] =>
  state.log.filter((entry) => entry.playerId === CASH1981 && entry.privateLog.startsWith('Zheng He')).map((entry) => entry.privateLog)

const drawn = (state: GameState, sheetName: 'HUTS' | 'VILLAGES', playerId = CASH1981): Item => {
  const next = unwrap(draw(state, { playerId, sheetName, confirmedOutOfTurn: true }))
  const item = me(next, playerId).items.at(-1)
  if (item === undefined) throw new Error('nothing drawn')
  return item
}

function undoByVote(state: GameState, requestId: string): GameState {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line for the action')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of OTHERS) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  return next
}

describe('Zheng He', () => {
  it('writes one private line for each token on the map, with its square', () => {
    const { state, cardId } = scene()
    const hut = topOf(state, 'HUTS')
    const village = topOf(state, 'VILLAGES')
    const played = unwrap(play(state, cardId))
    expect(privateLines(played)).toEqual([
      `Zheng He: the hut on C2 is ${itemName(hut)}`,
      `Zheng He: the village on B4 is ${itemName(village)}`,
    ])
    expect(me(played).items.some((item) => item.id === cardId)).toBe(false)
    expect(played.discardedItems.some((item) => item.id === cardId)).toBe(true)
    expect(played.log.find((entry) => entry.assistedActionId === 'z1')?.publicLog).toBe(
      "cash1981 played Zheng He (any time) and discarded it, looking under the hut and village tokens on the map and in the other players' hands",
    )
  })

  it('names the huts and villages the other players hold, one line each', () => {
    const { state, cardId } = scene()
    const held = withHutInHand(state, (topOf(state, 'HUTS', 2) as HutItem).name, KARANDRAS1)
    const played = unwrap(play(held.state, cardId))
    const lines = privateLines(played)
    expect(lines).toHaveLength(3)
    expect(lines[2]).toMatch(/^Zheng He: Karandras1 holds the hut /)
    // Nobody else reads a word of it
    expect(played.log.filter((entry) => entry.playerId !== CASH1981).some((entry) => entry.privateLog.includes('Zheng He:'))).toBe(false)
  })

  it('fixes what lies under a token: a piece that leaves the map gives that item to the next draw', () => {
    const { state, cardId, hutPieceId, villagePieceId } = scene()
    const hut = topOf(state, 'HUTS')
    const village = topOf(state, 'VILLAGES')
    const played = unwrap(play(state, cardId))
    // The two items are out of the deck, and a draw by anybody never takes one while the token lies on the map
    expect(played.items.some((item) => item.id === hut.id || item.id === village.id)).toBe(false)
    expect(drawn(played, 'HUTS', KARANDRAS1).id).not.toBe(hut.id)
    // The hut is collected, and the next hut drawn is the one that lay under it
    const collected = unwrap(removePiece(played, { playerId: CASH1981, pieceId: hutPieceId }))
    expect(drawn(collected, 'HUTS').id).toBe(hut.id)
    // The village is still under its piece
    expect(drawn(collected, 'VILLAGES').id).not.toBe(village.id)
    expect(collected.underTokens?.map((token) => token.pieceId)).toEqual([hutPieceId, villagePieceId])
  })

  it('gives one item for each draw and keeps the rest under their pieces, out of reach of a shuffle', () => {
    const base = scene()
    const asset = findBoardAsset('resources/hut')
    if (asset === undefined) throw new Error('missing hut asset')
    const withSecond = unwrap(
      placePiece(base.state, {
        playerId: CASH1981,
        assetId: 'resources/hut',
        x: Math.round(3 * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2),
        y: Math.round(mapTop(base.state.board) + 2 * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2),
      }),
    )
    const secondPieceId = (withSecond.board.pieces.at(-1) as { id: string }).id
    const first = topOf(withSecond, 'HUTS')
    const second = topOf(withSecond, 'HUTS', 1)
    const played = unwrap(play(withSecond, base.cardId))
    expect(privateLines(played)).toContain(`Zheng He: the hut on D3 is ${itemName(second)}`)
    let gone = unwrap(removePiece(played, { playerId: CASH1981, pieceId: base.hutPieceId }))
    gone = unwrap(removePiece(gone, { playerId: CASH1981, pieceId: secondPieceId }))
    const taken = unwrap(draw(gone, { playerId: CASH1981, sheetName: 'HUTS', confirmedOutOfTurn: true }))
    expect(me(taken).items.at(-1)?.id).toBe(first.id)
    // The other is still under its piece, so a shuffle of the whole deck cannot touch it
    expect(taken.underTokens?.some((token) => token.item.id === second.id)).toBe(true)
    expect(drawn(shuffleDeckTwice(taken), 'HUTS').id).toBe(second.id)
  })

  it('keeps the identity when a removed piece is put back by a board undo after another sheet was drawn', () => {
    const { state, cardId, hutPieceId } = scene()
    const played = unwrap(play(state, cardId))
    const removed = unwrap(removePiece(played, { playerId: CASH1981, pieceId: hutPieceId }))
    const other = unwrap(draw(removed, { playerId: CASH1981, sheetName: 'VILLAGES', confirmedOutOfTurn: true }))
    expect(other.underTokens?.some((token) => token.pieceId === hutPieceId)).toBe(true)
    const back = unwrap(undoLastBoardChange(other, CASH1981))
    expect(back.board.pieces.some((piece) => piece.id === hutPieceId)).toBe(true)
    expect(back.underTokens?.some((token) => token.pieceId === hutPieceId)).toBe(true)
  })

  it('follows a piece moved to another square, and the next look names the new square', () => {
    const { state, cardId, hutPieceId } = scene()
    const hut = topOf(state, 'HUTS')
    const played = unwrap(play(state, cardId))
    const piece = played.board.pieces.find((candidate) => candidate.id === hutPieceId)
    if (piece === undefined) throw new Error('no hut piece')
    const moved = unwrap(movePiece(played, { playerId: CASH1981, pieceId: hutPieceId, x: piece.x + SQUARE_SIZE, y: piece.y, snap: false }))
    expect(lookUnderTokens(moved, []).lines[0]).toBe(`Zheng He: the hut on D2 is ${itemName(hut)}`)
  })

  it('is not changed by a shuffle of the deck', () => {
    const { state, cardId, hutPieceId } = scene()
    const hut = topOf(state, 'HUTS')
    const played = unwrap(play(state, cardId))
    const shuffled = shuffleDeckTwice(shuffleDeckTwice(played))
    expect(shuffled.underTokens).toEqual(played.underTokens)
    const collected = unwrap(removePiece(shuffled, { playerId: CASH1981, pieceId: hutPieceId }))
    expect(drawn(collected, 'HUTS').id).toBe(hut.id)
  })

  it('leaves a token placed after the look anonymous', () => {
    const { state, cardId } = scene()
    const played = unwrap(play(state, cardId))
    const next = topOf(played, 'HUTS')
    const asset = findBoardAsset('resources/hut')
    if (asset === undefined) throw new Error('missing hut asset')
    const later = unwrap(
      placePiece(played, {
        playerId: CASH1981,
        assetId: 'resources/hut',
        x: Math.round(3 * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2),
        y: Math.round(mapTop(played.board) + 2 * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2),
      }),
    )
    expect(later.underTokens).toHaveLength(2)
    expect(drawn(later, 'HUTS').id).toBe(next.id)
  })

  it('reads a token that already has an identity again without taking another item', () => {
    const { state, cardId } = scene()
    const first = unwrap(play(state, cardId))
    const again = lookUnderTokens(first, [])
    expect(again.bound).toEqual([])
    expect(again.state.items).toEqual(first.items)
    expect(again.lines).toEqual(privateLines(first))
  })

  it('reads what it can when the deck has fewer huts than tokens', () => {
    const { state, cardId } = scene()
    const asset = findBoardAsset('resources/hut')
    if (asset === undefined) throw new Error('missing hut asset')
    const two = unwrap(
      placePiece(state, {
        playerId: CASH1981,
        assetId: 'resources/hut',
        x: Math.round(3 * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2),
        y: Math.round(mapTop(state.board) + 2 * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2),
      }),
    )
    const onlyOne = { ...two, items: two.items.filter((item) => item.sheetName !== 'HUTS' || item.id === topOf(two, 'HUTS').id) }
    const lines = privateLines(unwrap(play(onlyOne, cardId)))
    expect(lines.filter((line) => line.includes('cannot be read'))).toEqual(['Zheng He: the hut on D3 cannot be read, no huts are left in the deck'])
    expect(lines.some((line) => line.startsWith('Zheng He: the hut on C2 is '))).toBe(true)
  })

  it('says so when the deck has no hut left for a token, and when there is nothing to see', () => {
    const { state, cardId } = scene()
    const noHuts = { ...state, items: state.items.filter((item) => item.sheetName !== 'HUTS') }
    expect(privateLines(unwrap(play(noHuts, cardId)))[0]).toBe('Zheng He: the hut on C2 cannot be read, no huts are left in the deck')

    const empty = withCardInHand(firstCivGame(), 'Zheng He')
    expect(privateLines(unwrap(play(empty.state, empty.itemId)))).toEqual([
      "Zheng He: there is no hut or village on the map or in another player's hand",
    ])
  })

  it('on undo puts the items under the tokens back, reshuffles both decks and says so', () => {
    const { state, cardId } = scene()
    const hut = topOf(state, 'HUTS')
    const village = topOf(state, 'VILLAGES')
    const played = unwrap(play(state, cardId))
    const undone = undoByVote(played, 'z1')
    expect(undone.underTokens).toEqual([])
    expect(undone.items.some((item) => item.id === hut.id)).toBe(true)
    expect(undone.items.some((item) => item.id === village.id)).toBe(true)
    expect(me(undone).items.some((item) => item.id === cardId)).toBe(true)
    expect(undone.items).toHaveLength(state.items.length)
    // The order of the huts is no longer the order the player saw
    const before = state.items.filter((item) => item.sheetName === 'HUTS').map((item) => item.id)
    expect(undone.items.filter((item) => item.sheetName === 'HUTS').map((item) => item.id)).not.toEqual(before)
    expect(undone.log.some((entry) => entry.playerId === CASH1981 && entry.privateLog.includes('the look was undone'))).toBe(true)
  })

  it('on undo leaves alone an item a draw has already taken from under its token', () => {
    const { state, cardId, hutPieceId } = scene()
    const hut = topOf(state, 'HUTS')
    const played = unwrap(play(state, cardId))
    const collected = unwrap(removePiece(played, { playerId: CASH1981, pieceId: hutPieceId }))
    const taken = unwrap(draw(collected, { playerId: CASH1981, sheetName: 'HUTS', confirmedOutOfTurn: true }))
    const undone = undoByVote(taken, 'z1')
    expect(me(undone).items.filter((item) => item.id === hut.id)).toHaveLength(1)
    expect(undone.items.some((item) => item.id === hut.id)).toBe(false)
    expect(undone.underTokens).toEqual([])
  })

  it('keeps the identities, the item names and the effect out of every projection', () => {
    const { state, cardId } = scene()
    const hut = topOf(state, 'HUTS')
    const played = unwrap(play(state, cardId))
    for (const viewer of [CASH1981, ...OTHERS, 'player-nobody']) {
      const text = JSON.stringify(toPlayerView(played, viewer))
      expect(text).not.toContain('underTokens')
      expect(text).not.toContain('zhengHe')
      expect(text).not.toContain(hut.id)
    }
    const others = JSON.stringify(toPlayerView(played, KARANDRAS1).log)
    expect(others).not.toContain('Zheng He:')
  })
})
