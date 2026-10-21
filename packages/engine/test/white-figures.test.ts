/**
 * Russia's white army (issue #204) and Spain's white scout: one extra figure on
 * top of the 6 armies and 2 scouts of the player's colour. Revealing the civ
 * puts it in the player's own area; removing it puts it back in the supply.
 */

import { describe, expect, it } from 'vitest'

import { placePiece, removePiece } from '../src/actions/board.js'
import { revealItem } from '../src/actions/player.js'
import {
  areaAt,
  findBoardAsset,
  playerAreas,
  remainingBoardAssetCount,
  whiteFigureCivilization,
  whiteFigureFor,
} from '../src/board.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { findPlayer } from '../src/state.js'

import { CASH1981, KARANDRAS1, firstCivGame } from './fixture.js'

/** Hands a specific civilization to a player and reveals it. */
function revealCiv(state: GameState, playerId: string, name: string): GameState {
  const civ = state.items.find((item) => item.kind === 'civ' && item.name === name)
  if (civ === undefined) throw new Error(`no ${name} civ in the deck`)
  const given: GameState = {
    ...state,
    items: state.items.filter((item) => item.id !== civ.id),
    players: state.players.map((player) =>
      player.playerId === playerId
        ? { ...player, items: [...player.items, { ...civ, ownerId: playerId }] }
        : player,
    ),
  }
  return unwrap(revealItem(given, { playerId, sheetName: 'CIV', itemNumber: civ.itemNumber }))
}

const piecesOf = (state: GameState, assetId: string) =>
  state.board.pieces.filter((piece) => piece.assetId === assetId)

const remaining = (state: GameState, assetId: string): number | undefined => {
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`no ${assetId} asset`)
  return remainingBoardAssetCount(asset, state.board.pieces, state.numOfPlayers)
}

describe('the white figures', () => {
  it('has a white scout next to the white army', () => {
    expect(findBoardAsset('figures/whitescout')).toMatchObject({
      category: 'figure',
      label: 'White scout',
      width: 51,
      height: 34,
    })
  })

  it('belongs to Russia (army) and Spain (scout)', () => {
    expect(whiteFigureCivilization('figures/whitearmy')).toBe('Russians')
    expect(whiteFigureCivilization('figures/whitescout')).toBe('Spanish')
    expect(whiteFigureCivilization('figures/redscout')).toBeUndefined()
    expect(whiteFigureFor('Russians')).toBe('figures/whitearmy')
    expect(whiteFigureFor('Spanish')).toBe('figures/whitescout')
    expect(whiteFigureFor('Romans')).toBeUndefined()
  })

  it('refuses the white scout to every civ but Spain', () => {
    const state = revealCiv(firstCivGame(), CASH1981, 'Russians')
    const input = { assetId: 'figures/whitescout', x: 0, y: 0 }
    for (const playerId of [CASH1981, KARANDRAS1]) {
      expect(unwrapErr(placePiece(state, { ...input, playerId }))).toEqual({
        kind: 'BOARD_ASSET_CIV_ONLY',
        assetId: 'figures/whitescout',
        civilization: 'Spanish',
      })
    }
  })
})

describe.each([
  ['Spanish', 'figures/whitescout', 'figures/whitearmy'],
  ['Russians', 'figures/whitearmy', 'figures/whitescout'],
])('revealing the %s', (civilization, white, other) => {
  const reveal = () => revealCiv(firstCivGame(), CASH1981, civilization)

  it('puts the white figure in the player’s own area, so none is left to place', () => {
    const state = reveal()
    const [figure, ...rest] = piecesOf(state, white)
    expect(rest).toEqual([])
    if (figure === undefined) throw new Error(`no ${white} on the board`)
    expect(figure.placedBy).toBe(CASH1981)

    const area = areaAt(
      playerAreas(state.board, state.players),
      figure.x + figure.width / 2,
      figure.y + figure.height / 2,
    )
    expect(area?.playerId).toBe(CASH1981)
    expect(remaining(state, white)).toBe(0)
    // The other white figure is not Cash's
    expect(piecesOf(state, other)).toEqual([])
  })

  it('leaves the six armies and two scouts of the colour untouched', () => {
    const state = reveal()
    expect(remaining(state, 'figures/redarmy')).toBe(6)
    expect(remaining(state, 'figures/redscout')).toBe(2)
  })

  it('puts the figure back in the supply when it is removed, and lets it be placed again', () => {
    const state = reveal()
    const figure = piecesOf(state, white)[0]
    if (figure === undefined) throw new Error(`no ${white} on the board`)

    const removed = unwrap(removePiece(state, { playerId: CASH1981, pieceId: figure.id }))
    expect(piecesOf(removed, white)).toEqual([])
    expect(remaining(removed, white)).toBe(1)

    const again = unwrap(placePiece(removed, { playerId: CASH1981, assetId: white, x: 0, y: 0 }))
    expect(piecesOf(again, white)).toHaveLength(1)
    expect(remaining(again, white)).toBe(0)
  })
})

describe('revealing another civ', () => {
  it('places no white figure', () => {
    const state = revealCiv(firstCivGame(), CASH1981, 'Romans')
    expect(piecesOf(state, 'figures/whitearmy')).toEqual([])
    expect(piecesOf(state, 'figures/whitescout')).toEqual([])
    expect(findPlayer(state, CASH1981)?.civilization?.name).toBe('Romans')
  })
})
