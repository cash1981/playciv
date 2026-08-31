/**
 * Tester for spilldelen av `GameAction`.
 *
 * Java testet dette via `GameResourceTest` over HTTP. Testene her går rett på
 * domenelogikken, med Java-metoden navngitt.
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
import { createGame } from '../src/create-game.js'
import { itemName } from '../src/item.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { findPlayer, findPlayerByUsername } from '../src/state.js'

import { CASH1981, KARANDRAS1, firstCivGame } from './fixture.js'

/** Et spill der bare oppretteren har blitt med, så det ikke er startet. */
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

describe('joinGame', () => {
  it('legger til spilleren med neste ledige farge og logger det', () => {
    const state = unwrap(
      joinGame(newGameWithCreator(), { playerId: KARANDRAS1, username: 'Karandras1' }),
    )

    expect(state.players).toHaveLength(2)
    expect(findPlayer(state, KARANDRAS1)?.color).toBe('Yellow')
    expect(state.log.at(-1)?.publicLog).toBe(
      'System: Karandras1 joined the game and is playing color Yellow',
    )
  })

  it('respekterer en ønsket farge', () => {
    const state = unwrap(
      joinGame(newGameWithCreator(), {
        playerId: KARANDRAS1,
        username: 'Karandras1',
        color: 'Blue',
      }),
    )
    expect(findPlayer(state, KARANDRAS1)?.color).toBe('Blue')
  })

  it('samme spiller kan ikke bli med to ganger', () => {
    const error = unwrapErr(
      joinGame(newGameWithCreator(), { playerId: CASH1981, username: 'cash1981' }),
    )
    expect(error).toEqual({ kind: 'ALREADY_JOINED', playerId: CASH1981 })
  })

  it('et fullt spill avviser flere spillere', () => {
    const error = unwrapErr(joinGame(firstCivGame(), { playerId: 'ny', username: 'Ny' }))
    expect(error).toEqual({ kind: 'GAME_IS_FULL', numOfPlayers: 4 })
  })

  it('siste spiller starter spillet', () => {
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

  it('en ny spiller overtar hånden til en som har trukket seg', () => {
    // Java: joinGame plukket withdrawnPlayers.remove(0) og skrev om loggen
    let state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'HUTS' }))
    const handSize = findPlayer(state, CASH1981)?.items.length

    state = unwrap(withdrawFromGame(state, KARANDRAS1))
    expect(state.withdrawnPlayers).toHaveLength(1)

    state = unwrap(joinGame(state, { playerId: 'ny', username: 'Nykommer' }))

    expect(state.withdrawnPlayers).toHaveLength(0)
    expect(findPlayer(state, 'ny')?.username).toBe('Nykommer')
    // Karandras1 hadde ingen items, så hånden er tom, men fargen følger med
    expect(findPlayer(state, 'ny')?.color).toBe('Red')
    // Loggpostene til den som trakk seg skrives om
    expect(state.log.some((entry) => entry.username === 'Karandras1')).toBe(false)
    // cash1981 sin hånd er urørt
    expect(findPlayer(state, CASH1981)?.items).toHaveLength(handSize ?? 0)
  })
})

describe('nextAvailableColor', () => {
  it('følger rekkefølgen Green, Yellow, Purple, Red, Blue', () => {
    let state = createGame({ name: 'farger', numOfPlayers: 5, seed: 'farger', players: [] })
    const picked: string[] = []

    for (let i = 0; i < 5; i++) {
      const color = nextAvailableColor(state)
      if (color === undefined) throw new Error('ingen farge')
      picked.push(color)
      state = unwrap(joinGame(state, { playerId: `p${i}`, username: `P${i}`, color }))
    }

    expect(picked).toEqual(['Green', 'Yellow', 'Purple', 'Red', 'Blue'])
  })

  it('gir undefined når alle fem er tatt', () => {
    let state = createGame({ name: 'farger', numOfPlayers: 6, seed: 'farger', players: [] })
    for (let i = 0; i < 5; i++) {
      state = unwrap(joinGame(state, { playerId: `p${i}`, username: `P${i}` }))
    }
    expect(nextAvailableColor(state)).toBeUndefined()
  })
})

describe('startIfAllPlayers', () => {
  it('gjør ingenting når spillet allerede er i gang', () => {
    const before = firstCivGame()
    expect(startIfAllPlayers(before)).toBe(before)
  })

  it('gjør ingenting når det mangler spillere', () => {
    const before = newGameWithCreator()
    expect(startIfAllPlayers(before)).toBe(before)
  })
})

describe('withdrawFromGame', () => {
  it('flytter spilleren til withdrawnPlayers og logger det', () => {
    const state = unwrap(withdrawFromGame(firstCivGame(), KARANDRAS1))

    expect(state.players).toHaveLength(3)
    expect(state.withdrawnPlayers.map((player) => player.username)).toEqual(['Karandras1'])
    expect(state.log.at(-1)?.publicLog).toBe('Karandras1 withdrew from game')
  })

  it('spilloppretteren gir rollen videre', () => {
    const state = unwrap(withdrawFromGame(firstCivGame(), CASH1981))

    expect(state.players.filter((player) => player.gameCreator)).toHaveLength(1)
    expect(state.log.some((entry) => entry.publicLog.includes('Is now game creator'))).toBe(true)
  })

  it('siste spiller, som er oppretter, må avslutte spillet i stedet', () => {
    const error = unwrapErr(withdrawFromGame(newGameWithCreator(), CASH1981))
    expect(error).toEqual({ kind: 'GAME_CREATOR_MUST_END_GAME', playerId: CASH1981 })
  })

  it('en spiller utenfor spillet avvises', () => {
    const error = unwrapErr(withdrawFromGame(firstCivGame(), 'ingen'))
    expect(error).toEqual({ kind: 'NO_ACCESS', playerId: 'ingen' })
  })
})

describe('endGame', () => {
  it('spilloppretteren avslutter spillet med vinner', () => {
    const state = unwrap(
      endGame(firstCivGame(), { playerId: CASH1981, username: 'cash1981', winner: 'Itchi' }),
    )

    expect(state.active).toBe(false)
    expect(state.winner).toBe('Itchi')
    expect(state.log.some((e) => e.publicLog.includes('Itchi won the game'))).toBe(true)
    expect(state.log.at(-1)?.publicLog).toBe('System: cash1981 Ended this game')
  })

  it('kan avsluttes uten vinner', () => {
    const state = unwrap(endGame(firstCivGame(), { playerId: CASH1981, username: 'cash1981' }))
    expect(state.active).toBe(false)
    expect(state.winner).toBeNull()
  })

  it('bare spilloppretteren kan avslutte', () => {
    const error = unwrapErr(
      endGame(firstCivGame(), { playerId: KARANDRAS1, username: 'Karandras1' }),
    )
    expect(error).toEqual({ kind: 'ONLY_GAME_CREATOR_CAN_END_GAME', playerId: KARANDRAS1 })
  })

  it('admin kan avslutte uten å være med i spillet', () => {
    const state = unwrap(endGame(firstCivGame(), { playerId: 'admin-id', username: 'admin' }))
    expect(state.active).toBe(false)
  })

  it('en vinner som ikke er med i spillet avvises', () => {
    const error = unwrapErr(
      endGame(firstCivGame(), { playerId: CASH1981, username: 'cash1981', winner: 'Ukjent' }),
    )
    expect(error).toEqual({ kind: 'PLAYER_NOT_FOUND', playerId: 'Ukjent' })
    expect(findPlayerByUsername(firstCivGame(), 'Ukjent')).toBeUndefined()
  })
})

/** Java: `GameAction.getAllRevealedItems` — det regnearket i iframe viste. */
describe('allRevealedItems', () => {
  it('er tom i et nystartet spill', () => {
    expect(allRevealedItems(firstCivGame())).toHaveLength(0)
  })

  it('inneholder kastede og avslørte items, men ikke skjulte', () => {
    let state = firstCivGame()
    state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'HUTS' }))
    state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'CULTURE_1' }))

    const hut = findPlayer(state, CASH1981)?.items.find((item) => item.sheetName === 'HUTS')
    const card = findPlayer(state, CASH1981)?.items.find(
      (item) => item.sheetName === 'CULTURE_1',
    )
    if (hut === undefined || card === undefined) throw new Error('mangler items')

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
