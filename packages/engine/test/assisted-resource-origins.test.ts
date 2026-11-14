import { describe, expect, it } from 'vitest'

import { placePiece, undoLastBoardChange } from '../src/actions/board.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { performAssistedAction, reverseAssistedAction } from '../src/assisted.js'
import {
  resourcePaymentOptions, returnResource, returnResources, spendAnyResources,
  spendChosenResources, spendEachResource, spendResource,
} from '../src/assisted-resources.js'
import { mapTop } from '../src/board.js'
import { itemNumberText } from '../src/log.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'

import { chivalryTurn, player, withCardInHand, withHutInHand, withPieceInArea, withVillageInHand } from './assisted-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'
import { sotTurn } from './sot-fixture.js'

const AT = '2026-11-13T21:00:00.000Z'
const text = (state: GameState, id: string): string => {
  const item = player(state).items.find((candidate) => candidate.id === id)
  if (item === undefined || (item.kind !== 'hut' && item.kind !== 'village')) throw new Error('missing held resource')
  return `${item.name} (${item.kind}) ${itemNumberText(state.logSecret, player(state).username, item)}`
}

describe('shared held-resource origins and collected icons', () => {
  it.each([false, true])('Any N removes two own icons and numbers each Wheat separately (explicit=%s)', (explicit) => {
    const first = withHutInHand(chivalryTurn('Pottery'), 'Wheat')
    const second = withHutInHand(first.state, 'Wheat')
    const one = withPieceInArea(second.state, 'resources/hut')
    const two = withPieceInArea(one.state, 'resources/hut')
    const spare = withPieceInArea(two.state, 'resources/hut')
    const state = spare.state
    const before = JSON.stringify(state)
    const used = unwrap(performAssistedAction(state, {
      playerId: CASH1981, action: 'pottery', requestId: 'two-wheat', at: AT,
      payload: explicit
        ? { resources: ['Wheat', 'Wheat'], payments: [first.hutId, second.hutId].map((id) => ({ resource: 'Wheat', kind: 'hut' as const, id })) }
        : { resources: ['Wheat', 'Wheat'] },
    }))
    expect(used.log.at(-1)?.publicLog).toBe(`cash1981 used Pottery: spent ${text(state, first.hutId)} and ${text(state, second.hutId)} and added 1 coin (1) to Pottery`)
    expect(first.hutId).not.toBe(second.hutId)
    expect(text(state, first.hutId)).not.toBe(text(state, second.hutId))
    expect(used.board.pieces).not.toContainEqual(one.piece)
    expect(used.board.pieces).not.toContainEqual(two.piece)
    expect(used.board.pieces).toContainEqual(spare.piece)
    expect(used.assistedActions.at(-1)?.effect).toMatchObject({
      spent: [{ itemId: first.hutId, tokenPiece: one.piece }, { itemId: second.hutId, tokenPiece: two.piece }],
    })
    expect(JSON.stringify(state)).toBe(before)
    // The undo floor normally blocks this first; exposing the history still must not refund an icon alone.
    expect(unwrapErr(undoLastBoardChange({ ...used, board: { ...used.board, undoFloor: 0 } }, CASH1981))).toEqual({ kind: 'BOARD_UNDO_ASSISTED' })
    const record = used.assistedActions.at(-1)
    if (record === undefined) throw new Error('missing action')
    const undone = unwrap(reverseAssistedAction(used, record.id, AT))
    expect(undone.board.pieces).toEqual(expect.arrayContaining([one.piece, two.piece, spare.piece]))
    expect(player(undone).items).toEqual(expect.arrayContaining([...player(state).items]))
    expect(undone.discardedItems).toEqual(state.discardedItems)
  })

  it.each(['Iron', 'Uranium', 'Spy'])('a real %s village pays automatically and explicitly with village provenance', (resource) => {
    const held = withVillageInHand(firstCivGame(), resource)
    const hutIcon = withPieceInArea(held.state, 'resources/hut')
    const villageIcon = withPieceInArea(hutIcon.state, 'resources/village')
    const state = villageIcon.state
    const choice = { resource, kind: 'village' as const, id: held.itemId }
    expect(resourcePaymentOptions(state, CASH1981, [resource])).toContainEqual({ choice, label: `${resource} (village in hand)` })
    for (const explicit of [false, true]) {
      const paid = unwrap(spendResource(state, CASH1981, resource, AT, false, explicit ? choice : undefined))
      expect(paid.spent).toEqual({ kind: 'village', resource, itemId: held.itemId, tokenPiece: villageIcon.piece })
      expect(paid.said).toBe(`spent 1 ${text(state, held.itemId)}`)
      expect(paid.state.board.pieces).toContainEqual(hutIcon.piece)
      expect(paid.state.board.pieces).not.toContainEqual(villageIcon.piece)
      const restored = unwrap(returnResource(paid.state, player(paid.state), paid.spent, AT))
      expect(restored.board.pieces).toContainEqual(villageIcon.piece)
      expect(player(restored).items).toEqual(player(state).items)
      expect(restored.discardedItems).toEqual(state.discardedItems)
    }
    expect(spendResource(state, CASH1981, resource, AT, false, { ...choice, kind: 'hut' }).ok).toBe(false)
  })

  it('Ecology and each-resource logs share the same held-item wording, leaving board-resource text plain', () => {
    const wheat = withHutInHand(sotTurn({ techs: ['Ecology'] }), 'Wheat')
    const icon = withPieceInArea(wheat.state, 'resources/hut')
    const used = unwrap(performAssistedAction(icon.state, { playerId: CASH1981, action: 'sot:ecology', requestId: 'ecology', at: AT }))
    expect(used.log.at(-1)?.publicLog).toContain(`used Ecology: spent 1 ${text(icon.state, wheat.hutId)} to change an empty`)
    expect(used.log.at(-1)?.publicLog).not.toContain('spent spent')
    const iron = withVillageInHand(icon.state, 'Iron')
    const silk = withPieceInArea(iron.state, 'resources/silk')
    const paid = unwrap(spendEachResource(silk.state, CASH1981, ['Wheat', 'Iron', 'Silk'], AT))
    expect(paid.said).toBe(`spent ${text(silk.state, wheat.hutId)}, ${text(silk.state, iron.itemId)} and Silk`)
  })

  it('never removes map, foreign, outside, different-kind or still-bound icons, and allows a missing icon', () => {
    const held = withHutInHand(firstCivGame(), 'Wheat')
    const foreign = withPieceInArea(held.state, 'resources/hut', KARANDRAS1)
    const village = withPieceInArea(foreign.state, 'resources/village')
    const bound = withPieceInArea(village.state, 'resources/hut')
    const hiddenItem = bound.state.items.find((item) => item.kind === 'hut')
    if (hiddenItem === undefined || hiddenItem.kind !== 'hut') throw new Error('missing hidden hut')
    const mapped = unwrap(placePiece(bound.state, { playerId: CASH1981, assetId: 'resources/hut', x: 100, y: mapTop(bound.state.board) + 100 }))
    const outside = unwrap(placePiece(mapped, { playerId: CASH1981, assetId: 'resources/hut', x: -1000, y: -1000 }))
    const state = { ...outside, items: outside.items.filter((item) => item.id !== hiddenItem.id), underTokens: [{ pieceId: bound.piece.id, item: hiddenItem }] }
    const snapshot = JSON.stringify(state)
    const paid = unwrap(spendResource(state, CASH1981, 'Wheat', AT))
    expect(paid.spent).not.toHaveProperty('tokenPiece')
    expect(paid.state.board).toEqual(state.board)
    expect(paid.state.underTokens).toBe(state.underTokens)
    expect(paid.state.items).toEqual(state.items)
    expect(JSON.stringify(state)).toBe(snapshot)
  })

  it('refused automatic, explicit and each multi-payments leave the source hand and icons untouched', () => {
    const held = withHutInHand(firstCivGame(), 'Wheat')
    const icon = withPieceInArea(held.state, 'resources/hut')
    const state = icon.state
    const snapshot = JSON.stringify(state)
    expect(spendAnyResources(state, CASH1981, ['Wheat', 'Wheat'], AT).ok).toBe(false)
    expect(spendEachResource(state, CASH1981, ['Wheat', 'Iron'], AT).ok).toBe(false)
    expect(spendChosenResources(state, CASH1981, [null, null], [
      { resource: 'Wheat', kind: 'hut', id: held.hutId },
      { resource: 'Iron', kind: 'village', id: 'missing' },
    ], AT).ok).toBe(false)
    expect(JSON.stringify(state)).toBe(snapshot)
  })

  it('restores a mixed card/icon refund exactly, including ID, rotation and coordinates', () => {
    const held = withHutInHand(firstCivGame(), 'Wheat')
    const icon = withPieceInArea(held.state, 'resources/hut')
    const rotated: GameState = { ...icon.state, board: { ...icon.state.board, pieces: icon.state.board.pieces.map((piece) => piece.id === icon.piece.id ? { ...piece, rotation: 90, x: piece.x + 7, y: piece.y + 9 } : piece) } }
    const gift = withCardInHand(rotated, 'A Generous Gift')
    const paid = unwrap(spendChosenResources(gift.state, CASH1981, [null, null], [
      { resource: 'Wheat', kind: 'hut', id: held.hutId }, { resource: 'Iron', kind: 'card', id: gift.itemId },
    ], AT))
    const restored = unwrap(returnResources(paid.state, player(paid.state), paid.spent, AT))
    expect(restored.board.pieces).toEqual(rotated.board.pieces)
    expect(player(restored).items).toEqual(expect.arrayContaining([...player(gift.state).items]))
    expect(restored.discardedItems).toEqual(gift.state.discardedItems)
  })

  it('refuses occupied icon IDs and aggregate supply exhaustion before refunding anything', () => {
    const first = withHutInHand(firstCivGame(), 'Wheat')
    const second = withHutInHand(first.state, 'Wheat')
    const one = withPieceInArea(second.state, 'resources/hut')
    const two = withPieceInArea(one.state, 'resources/hut')
    const paid = unwrap(spendAnyResources(two.state, CASH1981, ['Wheat', 'Wheat'], AT))
    const collision = { ...paid.state, board: { ...paid.state.board, pieces: [...paid.state.board.pieces, { ...one.piece, assetId: 'resources/village' }] } }
    const snapshot = JSON.stringify(collision)
    expect(unwrapErr(returnResources(collision, player(collision), paid.spent, AT, 'owning-log'))).toMatchObject({ kind: 'ASSISTED_UNDO_BLOCKED', logId: 'owning-log', reason: expect.stringContaining('already on the board') })
    expect(JSON.stringify(collision)).toBe(snapshot)
    // Hut/village icons are unlimited. Use finite board-resource payments to check the shared refund preflight.
    const wheatOne = withPieceInArea(firstCivGame(), 'resources/wheat')
    const wheatTwo = withPieceInArea(wheatOne.state, 'resources/wheat')
    const finite = unwrap(spendAnyResources(wheatTwo.state, CASH1981, ['Wheat', 'Wheat'], AT))
    // Leave one slot: either piece alone fits, but the complete two-piece refund must refuse.
    let full = finite.state
    while (true) {
      const placed = placePiece(full, { playerId: CASH1981, assetId: 'resources/wheat', x: -1000, y: -1000 })
      if (!placed.ok) break
      full = placed.value
    }
    const roomForOne = { ...full, board: { ...full.board, pieces: full.board.pieces.slice(0, -1) } }
    const before = JSON.stringify(roomForOne)
    expect(unwrapErr(returnResources(roomForOne, player(roomForOne), finite.spent, AT, 'owning-log'))).toMatchObject({ kind: 'ASSISTED_UNDO_BLOCKED', logId: 'owning-log', reason: expect.stringContaining('(1 left)') })
    expect(JSON.stringify(roomForOne)).toBe(before)
  })

  it('old hut payment records without tokenPiece still restore the held item, not an invented icon', () => {
    const held = withHutInHand(firstCivGame(), 'Wheat')
    const paid = unwrap(spendResource(held.state, CASH1981, 'Wheat', AT))
    const restored = unwrap(returnResource(paid.state, player(paid.state), { kind: 'hut', resource: 'Wheat', itemId: held.hutId }, AT))
    expect(player(restored).items).toEqual(player(held.state).items)
    expect(restored.board).toEqual(held.state.board)
  })

  it('a duplicate icon blocks the owning Ecology undo atomically, with the original log ID', () => {
    const held = withHutInHand(sotTurn({ techs: ['Ecology'] }), 'Wheat')
    const icon = withPieceInArea(held.state, 'resources/hut')
    const used = unwrap(performAssistedAction(icon.state, { playerId: CASH1981, action: 'sot:ecology', requestId: 'blocked-ecology', at: AT }))
    const record = used.assistedActions.at(-1)
    if (record === undefined) throw new Error('missing action')
    const collision = { ...used, board: { ...used.board, pieces: [...used.board.pieces, icon.piece] } }
    const before = JSON.stringify(collision)
    expect(unwrapErr(reverseAssistedAction(collision, record.id, AT))).toMatchObject({
      kind: 'ASSISTED_UNDO_BLOCKED', logId: record.logId, reason: expect.stringContaining('already on the board'),
    })
    expect(JSON.stringify(collision)).toBe(before)
    expect(player(collision).items.some((item) => item.id === held.hutId)).toBe(false)
  })

  it.each(['collision', 'supply'])('a real Pottery undo vote reports its original log ID on a %s refusal', (refusal) => {
    const held = withHutInHand(chivalryTurn('Pottery'), 'Wheat')
    const icon = withPieceInArea(held.state, 'resources/hut')
    const boardWheat = withPieceInArea(icon.state, 'resources/wheat')
    const used = unwrap(performAssistedAction(boardWheat.state, {
      playerId: CASH1981, action: 'pottery', requestId: 'voted-refund', at: AT,
      payload: { resources: ['Wheat', 'Wheat'] },
    }))
    const record = used.assistedActions.at(-1)
    if (record === undefined) throw new Error('missing action')
    expect(record.logId).not.toBe('')
    let conflicted = refusal === 'collision'
      ? { ...used, board: { ...used.board, pieces: [...used.board.pieces, icon.piece] } }
      : used
    if (refusal === 'supply') {
      for (let count = 0; count < used.numOfPlayers; count += 1) {
        conflicted = withPieceInArea(conflicted, 'resources/wheat').state
      }
    }
    let pending = unwrap(initiateUndo(conflicted, { logId: record.logId, playerId: CASH1981 }))
    for (const playerId of [KARANDRAS1, ITCHI]) {
      pending = unwrap(vote(pending, { logId: record.logId, playerId, vote: true, at: AT }))
    }
    const before = JSON.stringify(pending)
    expect(unwrapErr(vote(pending, { logId: record.logId, playerId: CHUL, vote: true, at: AT }))).toMatchObject({
      kind: 'ASSISTED_UNDO_BLOCKED',
      logId: record.logId,
      reason: expect.stringContaining(refusal === 'collision' ? 'already on the board' : 'would use more of the supply'),
    })
    expect(JSON.stringify(pending)).toBe(before)
    expect(player(pending).stats.coinSources.pottery).toBe(1)
    expect(player(pending).items.some((item) => item.id === held.hutId)).toBe(false)
  })
})
