/**
 * Hidden information in the city production projection.
 *
 * `cities` is on every player's public view and is derived from the public
 * board and from revealed cards only. A hidden tech, a hidden Great Person card
 * and a hidden social policy must change no number and leave no trace in it, or
 * the figure would tell an opponent what the player holds.
 */

import { describe, expect, it } from 'vitest'

import { placePiece } from '../src/actions/board.js'
import {
  chooseSocialPolicy,
  chooseTech,
  revealSocialPolicy,
  revealTech,
} from '../src/actions/player.js'
import { SQUARE_SIZE, findBoardAsset, mapTop, slotOrigin } from '../src/board.js'
import { cityProductionsOf } from '../src/city-production.js'
import type { GreatPersonItem } from '../src/item.js'
import { unwrap } from '../src/result.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { GameState } from '../src/state.js'

import { CASH1981, KARANDRAS1, firstCivGame } from './fixture.js'

const SPECTATOR = 'someone-outside-the-game'

/** Cash is Red on Monarchy, with a red city on B2 over the England tile. */
function scene(): GameState {
  const base = firstCivGame()
  const colored: GameState = {
    ...base,
    players: base.players.map((p) => ({
      ...p,
      color: p.playerId === CASH1981 ? 'Red' : p.playerId === KARANDRAS1 ? 'Blue' : p.color,
      government: p.playerId === CASH1981 ? 'Monarchy' : p.government,
    })),
  }
  const slot = colored.board.slots[0]
  if (slot === undefined) throw new Error('board has no slots')
  const [x, y] = slotOrigin(colored.board, slot)
  const tiled = unwrap(placePiece(colored, { playerId: CASH1981, assetId: 'tiles/England', x, y }))
  const asset = findBoardAsset('cities/redcity2')
  if (asset === undefined) throw new Error('no city asset')
  return unwrap(
    placePiece(tiled, {
      playerId: CASH1981,
      assetId: 'cities/redcity2',
      x: SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2,
      y: mapTop(tiled.board) + SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2,
    }),
  )
}

/** Hand-held secrets, all hidden, and a pile of coins so Military Science would matter if it leaked. */
function withHiddenCards(state: GameState): GameState {
  const susan: GreatPersonItem = {
    id: 'susan-hidden',
    itemNumber: 9001,
    kind: 'greatperson',
    sheetName: 'GREAT_PERSON',
    name: 'Susan B. Anthony',
    type: 'Humanitarian',
    description: 'Hand-held secret.',
    used: false,
    hidden: true,
    ownerId: CASH1981,
  }
  const withTech = unwrap(chooseTech(state, { playerId: CASH1981, techName: 'Military Science' }))
  const withPolicy = unwrap(chooseSocialPolicy(withTech, { playerId: CASH1981, name: 'Urban Development' }))
  return {
    ...withPolicy,
    players: withPolicy.players.map((p) =>
      p.playerId === CASH1981
        ? {
            ...p,
            items: [...p.items, susan],
            stats: { ...p.stats, coinSources: { ...p.stats.coinSources, sheet: 9 } },
          }
        : p,
    ),
  }
}

const cash = (state: GameState) => {
  const found = findPlayer(state, CASH1981)
  if (found === undefined) throw new Error('no Cash')
  return found
}

describe('city production and hidden information', () => {
  it('hidden cards add nothing to any number and name nothing in the output', () => {
    const plain = scene()
    const hidden = withHiddenCards(plain)

    // The cards really are in the hand and hidden, so the test can fail.
    expect(cash(hidden).techsChosen.some((tech) => tech.name === 'Military Science' && tech.hidden)).toBe(true)
    expect(cash(hidden).socialPolicies.some((policy) => policy.name === 'Urban Development' && policy.hidden)).toBe(true)
    expect(cash(hidden).items.some((item) => item.kind === 'greatperson' && item.hidden)).toBe(true)

    const before = cityProductionsOf(plain, cash(plain))
    const after = cityProductionsOf(hidden, cash(hidden))
    expect(after).toEqual(before)
    expect(before[0]?.estimate).toBe(7)

    const serialised = JSON.stringify(after)
    for (const secret of ['Susan', 'Anthony', 'Military Science', 'Urban Development', 'Humanitarian']) {
      expect(serialised, `leaked ${secret}`).not.toContain(secret)
    }
  })

  it('the same cards, once revealed, do change the figures', () => {
    let state = withHiddenCards(scene())
    state = unwrap(revealTech(state, { playerId: CASH1981, techName: 'Military Science' }))
    state = unwrap(revealSocialPolicy(state, { playerId: CASH1981, name: 'Urban Development' }))
    state = {
      ...state,
      players: state.players.map((p) => ({
        ...p,
        items: p.items.map((item) => (item.kind === 'greatperson' ? { ...item, hidden: false } : item)),
      })),
    }
    const city = cityProductionsOf(state, cash(state))[0]
    // Military Science with 9 coins is +3 and Susan B. Anthony +2. Urban Development is only a note.
    expect(city?.estimate).toBe(7 + 3 + 2)
    expect(city?.notes.some((note) => note.includes('Urban Development'))).toBe(true)
  })

  it('an opponent and a spectator are given the same cities for a player, hidden cards or not', () => {
    const state = withHiddenCards(scene())
    const asOpponent = toPlayerView(state, KARANDRAS1).opponents.find((o) => o.playerId === CASH1981)
    const asSpectator = toPlayerView(state, SPECTATOR).opponents.find((o) => o.playerId === CASH1981)
    expect(asOpponent?.cities).toHaveLength(1)
    expect(asOpponent?.cities).toEqual(asSpectator?.cities)

    // The owner's own list is the same list: hidden cards add nothing for them either.
    expect(toPlayerView(state, CASH1981).you?.cities).toEqual(asOpponent?.cities)
  })

  it('an opponent’s view of the cities carries no card, tech or policy names', () => {
    const state = withHiddenCards(scene())
    const view = toPlayerView(state, KARANDRAS1)
    const cities = JSON.stringify(view.opponents.map((opponent) => opponent.cities))
    for (const secret of ['Susan B. Anthony', 'Military Science', 'Urban Development']) {
      expect(cities, `leaked ${secret}`).not.toContain(secret)
    }
    // The spectator gets no own view at all, and so no own cities.
    expect(toPlayerView(state, SPECTATOR).you).toBeNull()
  })

  it('the number follows what is public: coins that are typed in change it only once the tech is revealed', () => {
    const revealed = unwrap(
      revealTech(unwrap(chooseTech(scene(), { playerId: CASH1981, techName: 'Military Science' })), {
        playerId: CASH1981,
        techName: 'Military Science',
      }),
    )
    const rich: GameState = {
      ...revealed,
      players: revealed.players.map((p) =>
        p.playerId === CASH1981
          ? { ...p, stats: { ...p.stats, coinSources: { ...p.stats.coinSources, sheet: 6 } } }
          : p,
      ),
    }
    const seen = toPlayerView(rich, KARANDRAS1).opponents.find((o) => o.playerId === CASH1981)?.cities[0]
    expect(seen?.modifiers.find((m) => m.label === 'Military Science')?.amount).toBe(2)
  })
})
