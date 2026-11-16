/**
 * The stacking limit a revealed tech gives (Masonry 3, Printing Press 4, Biology 5, Replacement Parts 6): the highest counts,
 * a hidden tech gives nothing, a higher typed base wins, and Russia/Pasteur add their bonuses.
 */

import { describe, expect, it } from 'vitest'

import { placePiece } from '../src/actions/board.js'
import { revealItem } from '../src/actions/player.js'
import { findBoardAsset, mapTop, SQUARE_SIZE } from '../src/board.js'
import { stackingLimitOf } from '../src/great-person-effects.js'
import { techStackingOf } from '../src/movement.js'
import { unwrap } from '../src/result.js'
import { toPlayerView, findPlayer } from '../src/state.js'
import type { GameState } from '../src/state.js'

import { withCardInHand } from './assisted-fixture.js'
import { withStats } from './culture-advance-fixture.js'
import { CASH1981, KARANDRAS1, firstCivGame } from './fixture.js'

type Techs = readonly { readonly name: string; readonly hidden: boolean }[]

const withTechs = (state: GameState, techs: Techs): GameState => ({
  ...state,
  players: state.players.map((candidate) =>
    candidate.playerId === CASH1981
      ? { ...candidate, techsChosen: techs.map((tech) => ({ ...tech }) as GameState['players'][number]['techsChosen'][number]) }
      : candidate,
  ),
})

const limit = (state: GameState): number => {
  const player = findPlayer(state, CASH1981)
  if (player === undefined) throw new Error('no player')
  return stackingLimitOf(state, player)
}

describe('stacking limit from techs', () => {
  const base = withStats(firstCivGame(), { stacking: 2 })

  it('each tech alone sets the limit', () => {
    for (const [name, expected] of [['Masonry', 3], ['Printing Press', 4], ['Biology', 5], ['Replacement Parts', 6]] as const) {
      expect(limit(withTechs(base, [{ name, hidden: false }]))).toBe(expected)
    }
    expect(limit(base)).toBe(2)
  })

  it('the highest counts and they do not add up', () => {
    expect(techStackingOf([{ name: 'Masonry', hidden: false }, { name: 'Biology', hidden: false }])).toEqual({ limit: 5, tech: 'Biology' })
    expect(limit(withTechs(base, [{ name: 'Masonry', hidden: false }, { name: 'Printing Press', hidden: false }]))).toBe(4)
  })

  it('a hidden tech gives nothing', () => {
    expect(limit(withTechs(base, [{ name: 'Biology', hidden: true }, { name: 'Masonry', hidden: false }]))).toBe(3)
    expect(limit(withTechs(base, [{ name: 'Biology', hidden: true }]))).toBe(2)
  })

  it('a typed value that is higher still wins', () => {
    expect(limit(withTechs(withStats(firstCivGame(), { stacking: 5 }), [{ name: 'Masonry', hidden: false }]))).toBe(5)
  })

  it('Louis Pasteur adds 1 on top of the tech', () => {
    const card = withCardInHand(withTechs(base, [{ name: 'Printing Press', hidden: false }]), 'Louis Pasteur')
    const state: GameState = {
      ...card.state,
      players: card.state.players.map((candidate) => ({
        ...candidate,
        items: candidate.items.map((item) => (item.id === card.itemId ? { ...item, hidden: false } : item)),
      })),
    }
    expect(limit(state)).toBe(5)
  })

  it('movement receives the effective limit through the player view', () => {
    const state = withTechs(base, [{ name: 'Replacement Parts', hidden: false }])
    expect(toPlayerView(state, CASH1981).you?.stackingLimit).toBe(6)
  })
})

describe('Russian stacking bonus', () => {
  const initial = firstCivGame()
  const civ = initial.items.find((item) => item.kind === 'civ' && item.name === 'Russians')
  if (civ === undefined) throw new Error('missing Russian civilization')
  const dealt: GameState = {
    ...initial,
    items: initial.items.filter((item) => item.id !== civ.id),
    players: initial.players.map((candidate) => candidate.playerId === CASH1981
      ? { ...candidate, items: [...candidate.items, { ...civ, ownerId: CASH1981 }] }
      : candidate),
  }
  const russian = unwrap(revealItem(dealt, { playerId: CASH1981, sheetName: 'CIV', itemNumber: civ.itemNumber }))

  it('applies automatically on civilization reveal without changing the saved base', () => {
    expect(limit(dealt)).toBe(2)
    expect(limit(russian)).toBe(3)
    expect(findPlayer(russian, CASH1981)?.stats.stacking).toBe(2)
  })

  it.each([
    ['Masonry', 2, 4],
    ['Printing Press', 2, 5],
    ['Biology', 2, 6],
    ['Replacement Parts', 2, 7],
    ['Masonry', 3, 4],
    ['Masonry', 7, 8],
  ])('adds to %s with typed base %i', (name, stacking, expected) => {
    const state = withTechs(withStats(russian, { stacking }), [{ name, hidden: false }])
    expect(limit(state)).toBe(expected)
    expect(findPlayer(state, CASH1981)?.stats.stacking).toBe(stacking)
  })

  it.each(['absent', 'hidden', 'active', 'blockaded'] as const)(
    'keeps Russia additive with %s Pasteur in own, opponent and spectator views',
    (eligibility) => {
      let state = withTechs(russian, [{ name: 'Masonry', hidden: false }, { name: 'Biology', hidden: true }])
      if (eligibility !== 'absent') {
        const card = withCardInHand(state, 'Louis Pasteur')
        state = {
          ...card.state,
          players: card.state.players.map((candidate) => ({
            ...candidate,
            items: candidate.items.map((item) => item.id === card.itemId
              ? { ...item, hidden: eligibility === 'hidden' }
              : item),
          })),
        }
        for (const [assetId, playerId] of [
          ['great people/scientist', CASH1981],
          ...(eligibility === 'blockaded' ? [['figures/bluearmy', KARANDRAS1]] as const : []),
        ] as const) {
          const asset = findBoardAsset(assetId)
          if (asset === undefined) throw new Error(`missing ${assetId}`)
          state = unwrap(placePiece(state, {
            playerId, assetId,
            x: Math.round(SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2),
            y: Math.round(mapTop(state.board) + SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2),
          }))
        }
      }
      const before = JSON.stringify(state)
      const expected = eligibility === 'active' ? 5 : 4
      expect(limit(state)).toBe(expected)
      expect(toPlayerView(state, CASH1981).you?.stackingLimit).toBe(expected)
      for (const viewerId of [KARANDRAS1, 'spectator']) {
        const opponent = toPlayerView(state, viewerId).opponents.find((candidate) => candidate.playerId === CASH1981)
        expect(opponent).toHaveProperty('stackingLimit', expected)
      }
      expect(JSON.stringify(state)).toBe(before)
    },
  )
})
