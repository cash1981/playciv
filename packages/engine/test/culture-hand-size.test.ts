/**
 * The derived culture hand size. There is no old system behind the numbers:
 * they come from the human's table (base 2, Pottery, Civil Service and Theology
 * +1 each, Computers +1 per 5 coins, Valmiki +2, EftA Level I +1).
 */

import { describe, expect, it } from 'vitest'

import { placePiece, setWonderOwner } from '../src/actions/board.js'
import { chooseTech, discardItem, revealItem, revealTech, setPlayerStat } from '../src/actions/player.js'
import { isInWondersArea, wondersArea } from '../src/board.js'
import { cultureHandSizeOf } from '../src/culture-hand.js'
import type { GreatPersonItem } from '../src/item.js'
import { migrateGameState } from '../src/migrate.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { DEFAULT_PLAYER_STATS, findPlayer, toPlayerView } from '../src/state.js'

import { CASH1981, ITCHI, firstCivGame } from './fixture.js'

function sizeOf(state: GameState): number {
  const player = findPlayer(state, CASH1981)
  if (player === undefined) throw new Error('no such player')
  return cultureHandSizeOf(state, player)
}

/** Picks a tech and reveals it, so it counts for everyone. */
function withTech(state: GameState, techName: string, reveal = true): GameState {
  const chosen = unwrap(chooseTech(state, { playerId: CASH1981, techName }))
  return reveal ? unwrap(revealTech(chosen, { playerId: CASH1981, techName })) : chosen
}

/** Puts coins on the player's free-form counter. Set directly, so no source cap gets in the way. */
function withCoins(state: GameState, coins: number): GameState {
  return {
    ...state,
    players: state.players.map((player) =>
      player.playerId === CASH1981
        ? {
            ...player,
            stats: {
              ...player.stats,
              coinSources: { ...player.stats.coinSources, sheet: coins },
            },
          }
        : player,
    ),
  }
}

function withEfta(state: GameState, value: number): GameState {
  return unwrap(
    setPlayerStat(state, { editorPlayerId: CASH1981, targetPlayerId: CASH1981, stat: 'efta', value }),
  )
}

function withValmiki(state: GameState, hidden: boolean): GameState {
  const valmiki: GreatPersonItem = {
    id: 'valmiki-test',
    itemNumber: 4242,
    kind: 'greatperson',
    sheetName: 'GREAT_PERSON',
    name: 'Valmiki',
    type: 'Artist or Thinker',
    description: 'Your culture hand size is increased by 2.',
    used: false,
    hidden,
    ownerId: CASH1981,
  }
  return {
    ...state,
    players: state.players.map((player) =>
      player.playerId === CASH1981 ? { ...player, items: [...player.items, valmiki] } : player,
    ),
  }
}

describe('cultureHandSizeOf', () => {
  it('is 2 for a player with nothing', () => {
    expect(sizeOf(firstCivGame())).toBe(2)
  })

  it.each(['Pottery', 'Civil Service', 'Theology'])('counts %s as +1', (tech) => {
    expect(sizeOf(withTech(firstCivGame(), tech))).toBe(3)
  })

  it('counts a tech that does not raise it as nothing', () => {
    expect(sizeOf(withTech(firstCivGame(), 'Navy'))).toBe(2)
  })

  it('adds the techs together', () => {
    let state = withTech(firstCivGame(), 'Pottery')
    state = withTech(state, 'Civil Service')
    state = withTech(state, 'Theology')
    expect(sizeOf(state)).toBe(5)
  })

  it.each([
    [0, 2],
    [4, 2],
    [5, 3],
    [9, 3],
    [10, 4],
    [23, 6],
  ])('gives Computers +1 per 5 coins, rounded down: %i coins give %i', (coins, expected) => {
    const state = withCoins(withTech(firstCivGame(), 'Computers'), coins)
    // The Computers coin that revealing the tech gives is a counter of its own;
    // clear it so the number of coins is exactly what the test says.
    const cleared = {
      ...state,
      players: state.players.map((player) => ({
        ...player,
        stats: { ...player.stats, coinSources: { ...player.stats.coinSources, computers: 0 } },
      })),
    }
    expect(sizeOf(cleared)).toBe(expected)
  })

  it('counts the coins on the Computers card itself towards the total', () => {
    const state = withCoins(withTech(firstCivGame(), 'Computers'), 4)
    // 4 on the sheet plus the 1 Computers gives when revealed is 5 coins.
    expect(sizeOf(state)).toBe(3)
  })

  it('gives nothing for coins without Computers', () => {
    expect(sizeOf(withCoins(firstCivGame(), 50))).toBe(2)
  })

  it('counts Valmiki as +2', () => {
    expect(sizeOf(withValmiki(firstCivGame(), false))).toBe(4)
  })

  it('takes Valmiki\'s +2 away again when the card is discarded', () => {
    const state = withValmiki(firstCivGame(), false)
    expect(sizeOf(state)).toBe(4)
    const discarded = unwrap(
      discardItem(state, { playerId: CASH1981, sheetName: 'GREAT_PERSON', itemNumber: 4242, name: 'Valmiki' }),
    )
    expect(sizeOf(discarded)).toBe(2)
  })

  it('gives nothing for a hidden tech or a hidden Valmiki, to the owner as well', () => {
    let state = withTech(firstCivGame(), 'Pottery', false)
    state = withTech(state, 'Theology', false)
    state = withValmiki(state, true)
    expect(sizeOf(state)).toBe(2)
    expect(toPlayerView(state, CASH1981).you?.stats.cultureHandSize).toBe(2)
  })

  it('ignores another Great Person', () => {
    const state = withValmiki(firstCivGame(), false)
    const renamed = {
      ...state,
      players: state.players.map((player) => ({
        ...player,
        items: player.items.map((item) => (item.kind === 'greatperson' ? { ...item, name: 'Homer' } : item)),
      })),
    }
    expect(sizeOf(renamed)).toBe(2)
  })

  it.each([
    [0, 2],
    [1, 3],
    [3, 3],
  ])('gives EftA +1 from the first investment and no more: %i investments give %i', (efta, expected) => {
    expect(sizeOf(withEfta(firstCivGame(), efta))).toBe(expected)
  })

  it('gives the owner of Cristo Redentor +4, and nobody else', () => {
    const state = firstCivGame()
    const area = wondersArea(state.board)
    const placed = unwrap(placePiece(state, {
      playerId: CASH1981, assetId: 'wonders/cristoredentor', x: area.x + 20, y: area.y + 40,
    }))
    const wonder = placed.board.pieces.at(-1)
    if (wonder === undefined) throw new Error('the wonder should be on the board')
    expect(isInWondersArea(placed.board, wonder)).toBe(true)
    // Unowned: nobody gets it.
    expect(sizeOf(placed)).toBe(2)

    const owned = unwrap(setWonderOwner(placed, {
      playerId: CASH1981, pieceId: wonder.id, ownerId: CASH1981,
    }))
    expect(sizeOf(owned)).toBe(6)
    expect(toPlayerView(owned, ITCHI).opponents.find((o) => o.playerId === CASH1981)?.stats.cultureHandSize).toBe(6)

    const other = unwrap(setWonderOwner(placed, {
      playerId: CASH1981, pieceId: wonder.id, ownerId: ITCHI,
    }))
    expect(sizeOf(other)).toBe(2)
    expect(toPlayerView(other, ITCHI).you?.stats.cultureHandSize).toBe(6)
  })

  it('counts an owned Cristo Redentor that sits outside the Wonders area', () => {
    const placed = unwrap(placePiece(firstCivGame(), {
      playerId: CASH1981, assetId: 'wonders/cristoredentor', x: 40, y: 300, ownerId: CASH1981,
    }))
    expect(sizeOf(placed)).toBe(6)
  })

  it('adds every source together', () => {
    let state = withTech(firstCivGame(), 'Pottery')
    state = withTech(state, 'Civil Service')
    state = withTech(state, 'Theology')
    state = withTech(state, 'Computers')
    state = withCoins(state, 14)
    state = withValmiki(state, false)
    state = withEfta(state, 2)
    state = unwrap(placePiece(state, {
      playerId: CASH1981, assetId: 'wonders/cristoredentor', x: 40, y: 300, ownerId: CASH1981,
    }))
    // Base 2 + 3 techs + Computers (14 sheet + 1 Computers = 15 coins, 3 cards) + Valmiki 2 + EftA 1 + Cristo Redentor 4
    expect(sizeOf(state)).toBe(2 + 3 + 3 + 2 + 1 + 4)
  })

  it('gives Computers nothing for a negative coin total, so it cannot cancel another card', () => {
    let state = withTech(firstCivGame(), 'Pottery')
    state = withTech(state, 'Computers')
    state = withCoins(state, -40)
    // Pottery +1; Computers would be -8 without the clamp, which would pull the sum below 3.
    expect(sizeOf(state)).toBe(3)
  })

  it('never goes below 2, even with a negative EftA', () => {
    const state = {
      ...firstCivGame(),
      players: firstCivGame().players.map((player) => ({
        ...player,
        stats: { ...player.stats, efta: -3 },
      })),
    }
    expect(sizeOf(state)).toBe(2)
  })
})

describe('culture hand size in the projections', () => {
  function seenByOpponent(state: GameState): number | undefined {
    return toPlayerView(state, ITCHI).opponents.find((o) => o.playerId === CASH1981)?.stats.cultureHandSize
  }

  it('shows the same number to the owner and to an opponent', () => {
    let state = withTech(firstCivGame(), 'Pottery')
    state = withValmiki(state, false)
    expect(toPlayerView(state, CASH1981).you?.stats.cultureHandSize).toBe(5)
    expect(seenByOpponent(state)).toBe(5)
  })

  it('does not let an opponent count a hidden tech or a hidden Valmiki', () => {
    let state = withTech(firstCivGame(), 'Pottery', false)
    state = withTech(state, 'Theology', false)
    state = withValmiki(state, true)
    // A 7 here would tell Itchi that Cash holds two +1 techs and Valmiki.
    expect(seenByOpponent(state)).toBe(2)
  })

  it('counts a tech once it is revealed, and the others stay out', () => {
    let state = withTech(firstCivGame(), 'Pottery')
    state = withTech(state, 'Theology', false)
    state = withValmiki(state, true)
    expect(seenByOpponent(state)).toBe(3)
  })

  it('counts Valmiki once it is revealed, and not before', () => {
    const hiddenState = withValmiki(firstCivGame(), true)
    expect(seenByOpponent(hiddenState)).toBe(2)

    const revealed = unwrap(
      revealItem(hiddenState, { playerId: CASH1981, sheetName: 'GREAT_PERSON', itemNumber: 4242 }),
    )
    expect(seenByOpponent(revealed)).toBe(4)
  })

  it('does not reveal a hidden Computers through the coin total', () => {
    const state = withCoins(withTech(firstCivGame(), 'Computers', false), 25)
    expect(seenByOpponent(state)).toBe(2)
  })

  it('uses the public EftA investment for opponents too', () => {
    expect(seenByOpponent(withEfta(firstCivGame(), 1))).toBe(3)
  })

  it('ignores whatever is stored in the stat', () => {
    const state = firstCivGame()
    const tampered = {
      ...state,
      players: state.players.map((player) => ({
        ...player,
        stats: { ...player.stats, cultureHandSize: 99 },
      })),
    }
    expect(toPlayerView(tampered, CASH1981).you?.stats.cultureHandSize).toBe(2)
    expect(seenByOpponent(tampered)).toBe(2)
  })
})

describe('culture hand size stat', () => {
  it('defaults to 2', () => {
    expect(DEFAULT_PLAYER_STATS.cultureHandSize).toBe(2)
  })

  it('cannot be typed in', () => {
    const error = unwrapErr(
      setPlayerStat(firstCivGame(), {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        stat: 'cultureHandSize',
        value: 7,
      }),
    )
    expect(error).toEqual({ kind: 'STAT_NOT_EDITABLE', stat: 'cultureHandSize' })
  })

  it('is filled in on an older saved game', () => {
    const original = firstCivGame()
    const older = {
      ...original,
      players: original.players.map((player) => ({ ...player, stats: { trade: 1 } })),
    } as unknown as GameState
    expect(findPlayer(migrateGameState(older), CASH1981)?.stats.cultureHandSize).toBe(2)
  })
})

describe('combat hand size stat', () => {
  function setCombatHand(state: GameState, value: number | string) {
    return setPlayerStat(state, {
      editorPlayerId: CASH1981,
      targetPlayerId: CASH1981,
      stat: 'combatHandSize',
      value,
    })
  }

  it('starts empty', () => {
    expect(findPlayer(firstCivGame(), CASH1981)?.stats.combatHandSize).toBe('')
  })

  it.each(['+1', '+2', '5+1', '5 + 2'])('accepts %s as typed', (text) => {
    const state = unwrap(setCombatHand(firstCivGame(), text))
    expect(findPlayer(state, CASH1981)?.stats.combatHandSize).toBe(text)
  })

  it('trims the text and accepts a bare number as its text', () => {
    expect(findPlayer(unwrap(setCombatHand(firstCivGame(), '  +1 ')), CASH1981)?.stats.combatHandSize).toBe('+1')
    expect(findPlayer(unwrap(setCombatHand(firstCivGame(), 4)), CASH1981)?.stats.combatHandSize).toBe('4')
  })

  it('clears with empty text', () => {
    const set = unwrap(setCombatHand(firstCivGame(), '+1'))
    expect(findPlayer(unwrap(setCombatHand(set, '')), CASH1981)?.stats.combatHandSize).toBe('')
  })

  it('words the log line when the text is cleared', () => {
    const set = unwrap(setCombatHand(firstCivGame(), '+1'))
    const cleared = unwrap(setCombatHand(set, ''))
    expect(cleared.log.at(-1)?.publicLog).toBe('cash1981 set their combat hand size to empty')
  })

  it('refuses text longer than 20 characters', () => {
    const error = unwrapErr(setCombatHand(firstCivGame(), 'x'.repeat(21)))
    expect(error.kind).toBe('INVALID_STAT_VALUE')
  })

  it('carries a number from the old Hand Size over as text, and drops 0', () => {
    const original = firstCivGame()
    const older = (handSize: number) =>
      ({
        ...original,
        // The saved stats are from before the rename: `handSize`, and no `combatHandSize`.
        players: original.players.map((player) => ({ ...player, stats: { trade: 1, handSize } })),
      }) as unknown as GameState
    expect(findPlayer(migrateGameState(older(6)), CASH1981)?.stats.combatHandSize).toBe('6')
    expect(findPlayer(migrateGameState(older(0)), CASH1981)?.stats.combatHandSize).toBe('')
  })

  it('shows to opponents like any other public stat', () => {
    const state = unwrap(setCombatHand(firstCivGame(), '+2'))
    const cash = toPlayerView(state, ITCHI).opponents.find((o) => o.playerId === CASH1981)
    expect(cash?.stats.combatHandSize).toBe('+2')
  })
})
