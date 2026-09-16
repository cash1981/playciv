/**
 * Tests for the game part of `GameAction`.
 *
 * Java tested this through `GameResourceTest` over HTTP. These go straight at
 * the domain logic, naming the Java method each time.
 */

import { describe, expect, it } from 'vitest'

import { draw } from '../src/actions/draw.js'
import {
  allRevealedItems,
  endGame,
  joinGame,
  nextAvailableColor,
  startIfAllPlayers,
  withdrawFromGame,
} from '../src/actions/game.js'
import { discardItem, revealItem } from '../src/actions/player.js'
import { mapTop, squareOf } from '../src/board.js'
import { createGame } from '../src/create-game.js'
import { itemName } from '../src/item.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { findPlayer, findPlayerByUsername } from '../src/state.js'

import { CASH1981, KARANDRAS1, firstCivGame } from './fixture.js'

/** A game only the creator has joined, so it has not started. */
function newGameWithCreator(): GameState {
  return createGame({
    name: 'Fourth civ game',
    numOfPlayers: 4,
    seed: 'join',
    players: [
      { playerId: CASH1981, username: 'cash1981', color: 'Green', gameCreator: true },
    ],
  })
}

describe('createGame board geometry', () => {
  it('creates an 8 by 8 board with labels A1 through H8 for two players', () => {
    const state = createGame({ name: 'two-player', numOfPlayers: 2, seed: 'two-player' })

    expect(state.board.columns).toBe(8)
    expect(state.board.rows).toBe(8)

    const topLeft = {
      id: 'top-left',
      assetId: 'test',
      path: 'test.png',
      label: 'Test',
      category: 'marker' as const,
      x: 0,
      y: mapTop(state.board),
      width: 1,
      height: 1,
      rotation: 0 as const,
      placedBy: null,
    }
    const bottomRight = {
      ...topLeft,
      id: 'bottom-right',
      x: 7 * 94,
      y: mapTop(state.board) + 7 * 94,
    }

    expect(squareOf(state.board, topLeft)).toBe('A1')
    expect(squareOf(state.board, bottomRight)).toBe('H8')
  })

  it.each([3, 4, 5])('keeps the 16 by 16 board for %s players', (numOfPlayers) => {
    const state = createGame({
      name: 'standard-map',
      numOfPlayers,
      seed: `players-${numOfPlayers}`,
    })

    expect(state.board.columns).toBe(16)
    expect(state.board.rows).toBe(16)
  })
})

describe('joinGame', () => {
  it('adds the player with the next free colour and logs it', () => {
    const state = unwrap(
      joinGame(newGameWithCreator(), { playerId: KARANDRAS1, username: 'Karandras1' }),
    )

    expect(state.players).toHaveLength(2)
    expect(findPlayer(state, KARANDRAS1)?.color).toBe('Yellow')
    expect(state.log.at(-1)?.publicLog).toBe(
      'System: Karandras1 joined the game and is playing color Yellow',
    )
  })

  it('respects a requested colour', () => {
    const state = unwrap(
      joinGame(newGameWithCreator(), {
        playerId: KARANDRAS1,
        username: 'Karandras1',
        color: 'Blue',
      }),
    )
    expect(findPlayer(state, KARANDRAS1)?.color).toBe('Blue')
  })

  it('the same player cannot join twice', () => {
    const error = unwrapErr(
      joinGame(newGameWithCreator(), { playerId: CASH1981, username: 'cash1981' }),
    )
    expect(error).toEqual({ kind: 'ALREADY_JOINED', playerId: CASH1981 })
  })

  it('a full game turns further players away', () => {
    const error = unwrapErr(joinGame(firstCivGame(), { playerId: 'newcomer', username: 'Newcomer' }))
    expect(error).toEqual({ kind: 'GAME_IS_FULL', numOfPlayers: 4 })
  })

  it('the last player starts the game', () => {
    let state = newGameWithCreator()
    for (const [index, username] of ['Karandras1', 'Itchi', 'Chul'].entries()) {
      state = unwrap(joinGame(state, { playerId: `p${index}`, username }))
    }

    expect(state.players).toHaveLength(4)
    expect(state.players.filter((player) => player.yourTurn)).toHaveLength(1)
    expect(state.players.map((player) => player.playernumber).sort()).toEqual([1, 2, 3, 4])
    expect(state.log.some((e) => e.publicLog.includes('Game has now started'))).toBe(true)
    expect(state.log.some((e) => e.publicLog.includes('player is'))).toBe(true)
  })

  it('a new player takes over the hand of someone who withdrew', () => {
    // Java: joinGame took withdrawnPlayers.remove(0) and rewrote the log
    let state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'HUTS' }))
    const handSize = findPlayer(state, CASH1981)?.items.length

    state = unwrap(withdrawFromGame(state, KARANDRAS1))
    expect(state.withdrawnPlayers).toHaveLength(1)

    state = unwrap(joinGame(state, { playerId: 'newcomer', username: 'Newcomer' }))

    expect(state.withdrawnPlayers).toHaveLength(0)
    expect(findPlayer(state, 'newcomer')?.username).toBe('Newcomer')
    // Karandras1 held no items, so the hand is empty, but the colour follows
    expect(findPlayer(state, 'newcomer')?.color).toBe('Red')
    // The log entries of whoever withdrew are rewritten
    expect(state.log.some((entry) => entry.username === 'Karandras1')).toBe(false)
    // cash1981's hand is untouched
    expect(findPlayer(state, CASH1981)?.items).toHaveLength(handSize ?? 0)
  })
})

describe('nextAvailableColor', () => {
  it('follows the order Green, Yellow, Purple, Red, Blue', () => {
    let state = createGame({ name: 'colors', numOfPlayers: 5, seed: 'colors', players: [] })
    const picked: string[] = []

    for (let i = 0; i < 5; i++) {
      const color = nextAvailableColor(state)
      if (color === undefined) throw new Error('no color')
      picked.push(color)
      state = unwrap(joinGame(state, { playerId: `p${i}`, username: `P${i}`, color }))
    }

    expect(picked).toEqual(['Green', 'Yellow', 'Purple', 'Red', 'Blue'])
  })

  it('gives undefined once all five are taken', () => {
    let state = createGame({ name: 'colors', numOfPlayers: 6, seed: 'colors', players: [] })
    for (let i = 0; i < 5; i++) {
      state = unwrap(joinGame(state, { playerId: `p${i}`, username: `P${i}` }))
    }
    expect(nextAvailableColor(state)).toBeUndefined()
  })
})

describe('startIfAllPlayers', () => {
  it('does nothing when the game is already under way', () => {
    const before = firstCivGame()
    expect(startIfAllPlayers(before)).toBe(before)
  })

  it('does nothing while players are still missing', () => {
    const before = newGameWithCreator()
    expect(startIfAllPlayers(before)).toBe(before)
  })
})

describe('withdrawFromGame', () => {
  it('moves the player to withdrawnPlayers and logs it', () => {
    const state = unwrap(withdrawFromGame(firstCivGame(), KARANDRAS1))

    expect(state.players).toHaveLength(3)
    expect(state.withdrawnPlayers.map((player) => player.username)).toEqual(['Karandras1'])
    expect(state.log.at(-1)?.publicLog).toBe('Karandras1 withdrew from game')
  })

  it('the game creator passes the role on', () => {
    const state = unwrap(withdrawFromGame(firstCivGame(), CASH1981))

    expect(state.players.filter((player) => player.gameCreator)).toHaveLength(1)
    expect(state.log.some((entry) => entry.publicLog.includes('Is now game creator'))).toBe(true)
  })

  it('the last player, being the creator, has to end the game instead', () => {
    const error = unwrapErr(withdrawFromGame(newGameWithCreator(), CASH1981))
    expect(error).toEqual({ kind: 'GAME_CREATOR_MUST_END_GAME', playerId: CASH1981 })
  })

  it('a player outside the game is refused', () => {
    const error = unwrapErr(withdrawFromGame(firstCivGame(), 'outsider'))
    expect(error).toEqual({ kind: 'NO_ACCESS', playerId: 'outsider' })
  })
})

describe('endGame', () => {
  it('the game creator ends the game with a winner', () => {
    const state = unwrap(
      endGame(firstCivGame(), { playerId: CASH1981, username: 'cash1981', winner: 'Itchi' }),
    )

    expect(state.active).toBe(false)
    expect(state.winner).toBe('Itchi')
    expect(state.log.some((e) => e.publicLog.includes('Itchi won the game'))).toBe(true)
    expect(state.log.at(-1)?.publicLog).toBe('System: cash1981 Ended this game')
  })

  it('can be ended without a winner', () => {
    const state = unwrap(endGame(firstCivGame(), { playerId: CASH1981, username: 'cash1981' }))
    expect(state.active).toBe(false)
    expect(state.winner).toBeNull()
  })

  it('only the game creator can end it', () => {
    const error = unwrapErr(
      endGame(firstCivGame(), { playerId: KARANDRAS1, username: 'Karandras1' }),
    )
    expect(error).toEqual({ kind: 'ONLY_GAME_CREATOR_CAN_END_GAME', playerId: KARANDRAS1 })
  })

  it('admin can end a game without being in it', () => {
    const state = unwrap(endGame(firstCivGame(), { playerId: 'admin-id', username: 'admin' }))
    expect(state.active).toBe(false)
  })

  it('a winner who is not in the game is refused', () => {
    const error = unwrapErr(
      endGame(firstCivGame(), { playerId: CASH1981, username: 'cash1981', winner: 'Unknown' }),
    )
    expect(error).toEqual({ kind: 'PLAYER_NOT_FOUND', playerId: 'Unknown' })
    expect(findPlayerByUsername(firstCivGame(), 'Unknown')).toBeUndefined()
  })
})

/** Java: `GameAction.getAllRevealedItems` — what the iframe spreadsheet showed. */
describe('allRevealedItems', () => {
  it('is empty in a freshly started game', () => {
    expect(allRevealedItems(firstCivGame())).toHaveLength(0)
  })

  it('holds discarded and revealed items, but not hidden ones', () => {
    let state = firstCivGame()
    state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'HUTS' }))
    state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'CULTURE_1' }))

    const hut = findPlayer(state, CASH1981)?.items.find((item) => item.sheetName === 'HUTS')
    const card = findPlayer(state, CASH1981)?.items.find(
      (item) => item.sheetName === 'CULTURE_1',
    )
    if (hut === undefined || card === undefined) throw new Error('missing items')

    state = unwrap(
      revealItem(state, { playerId: CASH1981, sheetName: 'HUTS', itemNumber: hut.itemNumber }),
    )
    state = unwrap(
      discardItem(state, {
        playerId: CASH1981,
        sheetName: 'CULTURE_1',
        itemNumber: card.itemNumber,
        name: itemName(card),
      }),
    )

    const revealed = allRevealedItems(state)
    expect(revealed.map((item) => item.id).sort()).toEqual([hut.id, card.id].sort())
  })
})
