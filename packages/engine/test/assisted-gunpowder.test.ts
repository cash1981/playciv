/**
 * Gunpowder's effect (issue #327): "obsolete an ancient or medieval wonder, or destroy a building of your choice". How it is paid
 * is in `assisted-unit-techs.test.ts` and `assisted-resource-cards.test.ts`; here the two modes: a wonder is marked disabled
 * through the board history as the hand-made disable does, a building is removed from the board, and the undo vote puts either
 * back exactly or is refused with a reason.
 */

import { describe, expect, it } from 'vitest'

import { placePiece, removePiece, setWonderOwner, undoLastBoardChange } from '../src/actions/board.js'
import { chooseTech, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { assistedAvailability, performAssistedAction } from '../src/assisted.js'
import { SQUARE_SIZE, findBoardAsset, mapTop, piecesAtStep } from '../src/board.js'
import { destroyableBuildingsOf } from '../src/destroy-buildings.js'
import { obsoletableWondersOf } from '../src/obsolete-wonders.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'

import { player, withHutInHand } from './assisted-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-11-13T12:00:00.000Z'

const put = (state: GameState, playerId: string, assetId: string, column: number, row: number): GameState => {
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
const idOf = (state: GameState, assetId: string): string => {
  const found = state.board.pieces.filter((piece) => piece.assetId === assetId).at(-1)
  if (found === undefined) throw new Error(`no ${assetId}`)
  return found.id
}
const pieceOf = (state: GameState, id: string) => state.board.pieces.find((piece) => piece.id === id)

const press = (state: GameState, payload: Record<string, unknown>, requestId = 'req-1', confirmedRepeat = false) =>
  performAssistedAction(state, {
    playerId: CASH1981,
    action: 'gunpowder',
    requestId,
    at: AT,
    payload: payload as never,
    ...(confirmedRepeat ? { confirmedRepeat } : {}),
  })
const refused = (result: ReturnType<typeof press>): string => unwrapErr(result).kind
const tryVote = (state: GameState, requestId: string) => {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of [KARANDRAS1, ITCHI]) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  return vote(next, { logId: entry.id, playerId: CHUL, vote: true, at: AT })
}
const hasHut = (state: GameState, name: string): boolean => player(state).items.some((item) => item.kind === 'hut' && item.name === name && !item.used)
const resources = ['Iron', 'Wheat']

/**
 * Cash is Red, Karandras Blue. Karandras: a blue city on J10 with a Library on K10 in its outskirts, the Pyramids (ancient),
 * Machu Picchu (medieval) and Big Ben (modern) owned, and the Colossus unowned. Cash: a red city on B2 with a Market on C2 and
 * Stonehenge owned. Gunpowder revealed, an Iron and a Wheat in hand, City Management open.
 */
function scene() {
  const colors: Record<string, string> = { [CASH1981]: 'Red', [KARANDRAS1]: 'Blue', [ITCHI]: 'Green', [CHUL]: 'Yellow' }
  const base = firstCivGame()
  let state: GameState = { ...base, players: base.players.map((p) => ({ ...p, color: colors[p.playerId] ?? p.color })) }
  state = put(state, KARANDRAS1, 'cities/bluecity2', 9, 9)
  state = put(state, KARANDRAS1, 'buildings/library', 10, 9)
  state = put(state, CASH1981, 'cities/redcity2', 1, 1)
  state = put(state, CASH1981, 'buildings/market', 2, 1)
  const owned = (assetId: string, ownerId: string | null, at: number): GameState => {
    state = put(state, CASH1981, assetId, 14, at)
    return ownerId === null ? state : unwrap(setWonderOwner(state, { playerId: CASH1981, pieceId: idOf(state, assetId), ownerId }))
  }
  state = owned('wonders/pyramids', KARANDRAS1, 2)
  state = owned('wonders/machupichu', KARANDRAS1, 4)
  state = owned('wonders/bigben', KARANDRAS1, 6)
  state = owned('wonders/colossus', null, 8)
  state = owned('wonders/stonehenge', CASH1981, 10)
  state = unwrap(revealTech(unwrap(chooseTech(state, { playerId: CASH1981, techName: 'Gunpowder' })), { playerId: CASH1981, techName: 'Gunpowder' }))
  state = unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))
  state = withHutInHand(withHutInHand(state, 'Iron').state, 'Wheat').state
  return state
}

describe('Gunpowder: obsolete an ancient or medieval wonder', () => {
  const obsolete = (state: GameState, wonderPieceId: string, requestId = 'req-1', confirmed = false) =>
    press(state, { resources, mode: 'obsolete', wonderPieceId }, requestId, confirmed)

  it('lists the ancient and medieval wonders a player owns, the player\'s own included, and not modern, unowned or disabled ones', () => {
    const state = scene()
    const eras = ['Ancient', 'Medieval'] as const
    expect(obsoletableWondersOf(state.board, state.players, eras).map((wonder) => [wonder.label, wonder.ownerUsername])).toEqual([
      ['The Pyramids', 'Karandras1'],
      ['Machu Pichu', 'Karandras1'],
      ['Stonehenge', 'cash1981'],
    ])
    const disabled = unwrap(setWonderOwner(state, { playerId: CASH1981, pieceId: idOf(state, 'wonders/pyramids'), ownerId: null, disable: true }))
    expect(obsoletableWondersOf(disabled.board, disabled.players, eras).map((wonder) => wonder.label)).not.toContain('The Pyramids')
  })

  it('disables an ancient and a medieval wonder through the board history like the hand-made disable, paying the two resources', () => {
    for (const assetId of ['wonders/pyramids', 'wonders/machupichu']) {
      const state = scene()
      const id = idOf(state, assetId)
      const used = unwrap(obsolete(state, id))
      expect(pieceOf(used, id)).toMatchObject({ ownerId: null, disabled: true })
      expect(hasHut(used, 'Iron') || hasHut(used, 'Wheat')).toBe(false)
      expect(used.log.find((entry) => entry.assistedActionId === 'req-1')?.publicLog).toMatch(/^cash1981 used Gunpowder: spent Iron and Wheat, obsoleting .* of Karandras1: the wonder is disabled$/)
      const entry = used.board.history.at(-1)
      const hand = unwrap(setWonderOwner(state, { playerId: CASH1981, pieceId: id, ownerId: null, disable: true }))
      expect(entry?.change).toEqual(hand.board.history.at(-1)?.change)
      expect(piecesAtStep(used.board.history, used.board.history.length).find((piece) => piece.id === id)).toMatchObject({ ownerId: null, disabled: true })
      expect(used.assistedActions.at(-1)?.effect).toMatchObject({ kind: 'gunpowder', mode: 'obsolete', wonder: { pieceId: id, historyId: entry?.id } })
    }
  })

  it('may obsolete the player\'s own wonder', () => {
    const state = scene()
    expect(pieceOf(unwrap(obsolete(state, idOf(state, 'wonders/stonehenge'))), idOf(state, 'wonders/stonehenge'))).toMatchObject({ ownerId: null, disabled: true })
  })

  it('refuses a modern wonder, an unowned one, a disabled one, a building and a malformed payload, with nothing spent', () => {
    const state = scene()
    const gone = unwrap(setWonderOwner(state, { playerId: CASH1981, pieceId: idOf(state, 'wonders/pyramids'), ownerId: null, disable: true }))
    for (const [base, payload] of [
      [state, { resources, mode: 'obsolete', wonderPieceId: idOf(state, 'wonders/bigben') }],
      [state, { resources, mode: 'obsolete', wonderPieceId: idOf(state, 'wonders/colossus') }],
      [gone, { resources, mode: 'obsolete', wonderPieceId: idOf(state, 'wonders/pyramids') }],
      [state, { resources, mode: 'obsolete', wonderPieceId: idOf(state, 'buildings/library') }],
      [state, { resources, mode: 'obsolete', wonderPieceId: 'nope' }],
      [state, { resources, mode: 'obsolete' }],
      [state, { resources, mode: 'raze' }],
      [state, { resources }],
    ] as const) {
      expect(refused(press(base, payload as never))).toBe('ASSISTED_ACTION_REJECTED')
    }
    expect(hasHut(state, 'Iron') && hasHut(state, 'Wheat')).toBe(true)
    expect(state.assistedActions).toHaveLength(0)
  })

  it('the board Undo cannot take the disable back alone; the vote restores owner and flag, returns the tokens and frees the use', () => {
    const state = scene()
    const id = idOf(state, 'wonders/pyramids')
    const used = unwrap(obsolete(state, id))
    expect(undoLastBoardChange(used, CASH1981)).toMatchObject({ ok: false })
    const undone = unwrap(tryVote(used, 'req-1'))
    expect(pieceOf(undone, id)).toMatchObject({ ownerId: KARANDRAS1, disabled: false })
    expect(hasHut(undone, 'Iron') && hasHut(undone, 'Wheat')).toBe(true)
    expect(player(undone).playerTurns.at(-1)?.usedActions).not.toContain('card:Gunpowder')
    expect(undone.log.at(-1)?.publicLog).toContain('is enabled again and back with Karandras1')
    expect(undoLastBoardChange(undone, CASH1981)).toMatchObject({ ok: false })
  })

  it('refuses the undo when the owner or the disabled mark changed since, or the wonder is gone', () => {
    const state = scene()
    const id = idOf(state, 'wonders/pyramids')
    const used = unwrap(obsolete(state, id))
    const reassigned = unwrap(setWonderOwner(used, { playerId: CASH1981, pieceId: id, ownerId: ITCHI }))
    expect(JSON.stringify(unwrapErr(tryVote(reassigned, 'req-1')))).toContain('was changed since')
    const gone = unwrap(removePiece(used, { playerId: CASH1981, pieceId: id }))
    expect(JSON.stringify(unwrapErr(tryVote(gone, 'req-1')))).toContain('no longer on the board')
  })
})

describe('Gunpowder: destroy a building', () => {
  const destroy = (state: GameState, buildingPieceId: string, requestId = 'req-1', confirmed = false) =>
    press(state, { resources, mode: 'destroy', buildingPieceId }, requestId, confirmed)

  it('lists every building on a map square, whoever\'s, with the square and the player whose outskirts hold it', () => {
    const state = scene()
    expect(destroyableBuildingsOf(state, state.players).map((building) => [building.label, building.square, building.ownerUsername])).toEqual([
      ['Library', 'K10', 'Karandras1'],
      ['Market', 'C2', 'cash1981'],
    ])
  })

  it('removes the building from the board through the history, naming it, its square and whose outskirts it stood in', () => {
    const state = scene()
    const id = idOf(state, 'buildings/library')
    const used = unwrap(destroy(state, id))
    expect(pieceOf(used, id)).toBeUndefined()
    expect(used.board.pieces).toHaveLength(state.board.pieces.length - 1)
    expect(used.log.find((entry) => entry.assistedActionId === 'req-1')?.publicLog).toBe(
      "cash1981 used Gunpowder: spent Iron and Wheat, destroying Library on K10 (in Karandras1's outskirts)",
    )
    const entry = used.board.history.at(-1)
    expect(entry?.change).toMatchObject({ kind: 'remove', piece: { id } })
    expect(used.assistedActions.at(-1)?.effect).toMatchObject({ kind: 'gunpowder', mode: 'destroy', building: { label: 'Library', square: 'K10', historyId: entry?.id } })
    // A replay shows the building gone, one step back shows it
    expect(piecesAtStep(used.board.history, used.board.history.length).some((piece) => piece.id === id)).toBe(false)
    expect(piecesAtStep(used.board.history, used.board.history.length - 1).some((piece) => piece.id === id)).toBe(true)
    // The player's own building may be chosen too
    const own = unwrap(destroy(state, idOf(state, 'buildings/market')))
    expect(own.log.find((entry) => entry.assistedActionId === 'req-1')?.publicLog).toContain("destroying Market on C2 (in cash1981's outskirts)")
  })

  it('names a building outside every outskirts as such', () => {
    const state = put(scene(), CASH1981, 'buildings/harbor', 6, 14)
    const used = unwrap(destroy(state, idOf(state, 'buildings/harbor')))
    expect(used.log.find((entry) => entry.assistedActionId === 'req-1')?.publicLog).toContain("destroying Harbor on G15 (in no player's outskirts)")
  })

  it('refuses a wonder, a city, a missing id and a malformed payload, with nothing spent', () => {
    const state = scene()
    for (const buildingPieceId of [idOf(state, 'wonders/pyramids'), idOf(state, 'cities/bluecity2'), 'nope']) {
      expect(refused(destroy(state, buildingPieceId))).toBe('ASSISTED_ACTION_REJECTED')
    }
    expect(refused(press(state, { resources, mode: 'destroy' }))).toBe('ASSISTED_ACTION_REJECTED')
    expect(hasHut(state, 'Iron') && hasHut(state, 'Wheat')).toBe(true)
    expect(state.board.pieces.some((piece) => piece.assetId === 'buildings/library')).toBe(true)
  })

  it('the board Undo cannot take the removal back alone; the vote puts the building back exactly and returns the tokens', () => {
    const state = scene()
    const id = idOf(state, 'buildings/library')
    const before = pieceOf(state, id)
    const used = unwrap(destroy(state, id))
    expect(undoLastBoardChange(used, CASH1981)).toMatchObject({ ok: false })
    const undone = unwrap(tryVote(used, 'req-1'))
    expect(pieceOf(undone, id)).toEqual(before)
    expect(hasHut(undone, 'Iron') && hasHut(undone, 'Wheat')).toBe(true)
    expect(undone.log.at(-1)?.publicLog).toContain('Library was put back on K10')
    expect(undoLastBoardChange(undone, CASH1981)).toMatchObject({ ok: false })
  })

  it('refuses the undo when the piece is on the board again or another building or wonder now stands on its square', () => {
    const state = scene()
    const id = idOf(state, 'buildings/library')
    const used = unwrap(destroy(state, id))
    const back: GameState = { ...used, board: { ...used.board, pieces: [...used.board.pieces, pieceOf(state, id)!] } }
    expect(JSON.stringify(unwrapErr(tryVote(back, 'req-1')))).toContain('is on the board again')
    const taken = put(used, CASH1981, 'buildings/market', 10, 9)
    expect(JSON.stringify(unwrapErr(tryVote(taken, 'req-1')))).toContain('Another building or wonder now stands on K10')
    // Nothing else changed: a building on another square does not stop it
    const elsewhere = put(used, CASH1981, 'buildings/market', 12, 12)
    expect(pieceOf(unwrap(tryVote(elsewhere, 'req-1')), id)).toBeDefined()
  })
})

describe('Gunpowder: availability', () => {
  /** The turn with no building on the map and no wonder owned. */
  const bare = (): GameState => {
    const state = scene()
    return {
      ...state,
      board: { ...state.board, pieces: state.board.pieces.filter((piece) => piece.category !== 'building' && !(piece.category === 'wonder')) },
    }
  }

  it('is not usable with nothing to obsolete and nothing to destroy, and says why', () => {
    expect(assistedAvailability(bare(), CASH1981, 'gunpowder')).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('nothing to do') })
    expect(refused(press(bare(), { resources, mode: 'destroy', buildingPieceId: 'x' }))).toBe('ASSISTED_ACTION_REJECTED')
    expect(hasHut(bare(), 'Iron')).toBe(true)
  })

  it('stays ready with one of the two possible and says which is not', () => {
    const noWonder = { ...scene(), board: { ...scene().board, pieces: scene().board.pieces.filter((piece) => piece.category !== 'wonder') } }
    expect(assistedAvailability(noWonder, CASH1981, 'gunpowder')).toMatchObject({ status: 'ready', warning: expect.stringContaining('No ancient or medieval wonder') })
    const noBuilding = { ...scene(), board: { ...scene().board, pieces: scene().board.pieces.filter((piece) => piece.category !== 'building') } }
    expect(assistedAvailability(noBuilding, CASH1981, 'gunpowder')).toMatchObject({ status: 'ready', warning: expect.stringContaining('No building stands on the map') })
    expect(assistedAvailability(scene(), CASH1981, 'gunpowder')).not.toHaveProperty('warning')
  })
})
