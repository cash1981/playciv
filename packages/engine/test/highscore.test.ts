/**
 * Java counterpart: `GameActionTest` around `getPlayerHighScore` and
 * `getCivHighscore` (`GameAction.java`).
 */

import { describe, expect, it } from 'vitest'

import type { FinishedGame } from '../src/highscore.js'
import { formatPercentWin, highscore } from '../src/highscore.js'

const player = (username: string, civName: string | null = null) => ({ username, civName })

const game = (
  numOfPlayers: number,
  winner: string,
  players: readonly { readonly username: string; readonly civName: string | null }[],
): FinishedGame => ({ numOfPlayers, winner, players })

describe('formatPercentWin', () => {
  it('is "0 %" when there are no wins', () => {
    expect(formatPercentWin(0, 5)).toBe('0 %')
  })

  it('is "0 %" when there are no attempts', () => {
    expect(formatPercentWin(3, 0)).toBe('0 %')
  })

  it('rounds to two decimals', () => {
    expect(formatPercentWin(1, 3)).toBe('33.33 %')
  })

  it('keeps a trailing ".0" for a whole number, like Java\'s Double.toString', () => {
    expect(formatPercentWin(1, 2)).toBe('50.0 %')
    expect(formatPercentWin(1, 1)).toBe('100.0 %')
  })
})

describe('highscore — players', () => {
  it('counts total games and distinct participants', () => {
    const games = [
      game(4, 'cash', [player('cash'), player('Karandras1'), player('a'), player('b')]),
      game(2, 'Karandras1', [player('cash'), player('Karandras1')]),
    ]
    const result = highscore(games)
    expect(result.players.totalNumberOfGames).toBe(2)
    expect(result.players.totalNumberOfPlayers).toBe(4)
  })

  it('gives a player who lost every game a real attempts count and a percentWin below 100', () => {
    // "cash" wins nothing, but played in every one of these three games.
    const games = [
      game(4, 'Karandras1', [player('cash'), player('Karandras1')]),
      game(4, 'Karandras1', [player('cash'), player('Karandras1')]),
      game(2, 'Karandras1', [player('cash'), player('Karandras1')]),
    ]
    const result = highscore(games)
    // "cash" never won, so with no registry supplied there is nothing to
    // name them by in the total table — see the module comment.
    expect(result.players.winners.find((entry) => entry.username === 'cash')).toBeUndefined()

    // The 4-player bucket lists every participant, winner or not.
    const cashAtFour = result.players.fourWinners.find((entry) => entry.username === 'cash')
    expect(cashAtFour).toEqual({ username: 'cash', totalWins: 0, attempts: 2, percentWin: '0 %' })

    const karandrasAtFour = result.players.fourWinners.find(
      (entry) => entry.username === 'Karandras1',
    )
    expect(karandrasAtFour).toEqual({
      username: 'Karandras1',
      totalWins: 2,
      attempts: 2,
      percentWin: '100.0 %',
    })
  })

  it('includes a never-won registered user from the supplied registry, with 0 wins', () => {
    const games = [game(2, 'cash', [player('cash'), player('Karandras1')])]
    const result = highscore(games, ['cash', 'Karandras1', 'never-played'])

    expect(result.players.totalNumberOfPlayers).toBe(3)
    expect(result.players.winners).toEqual(
      expect.arrayContaining([
        { username: 'cash', totalWins: 1, attempts: 1, percentWin: '100.0 %' },
        { username: 'Karandras1', totalWins: 0, attempts: 1, percentWin: '0 %' },
        { username: 'never-played', totalWins: 0, attempts: 0, percentWin: '0 %' },
      ]),
    )
  })

  it('sorts by totalWins descending, ties broken by username in descending UTF-16 order', () => {
    // Java: Collections.sort ascending then Collections.reverse, which flips
    // the username tiebreak along with the primary order. "cash1981" sorts
    // after "Karandras1" in UTF-16 (lower-case letters have higher code
    // points), so with equal wins "cash1981" comes first here.
    const games = [
      game(4, 'Karandras1', [player('Karandras1'), player('cash1981')]),
      game(4, 'cash1981', [player('Karandras1'), player('cash1981')]),
    ]
    const result = highscore(games)
    expect(result.players.winners.map((entry) => entry.username)).toEqual([
      'cash1981',
      'Karandras1',
    ])
  })

  it('returns empty tables for no games', () => {
    const result = highscore([])
    expect(result.players.totalNumberOfGames).toBe(0)
    expect(result.players.totalNumberOfPlayers).toBe(0)
    expect(result.players.winners).toEqual([])
  })
})

describe('highscore — civilizations', () => {
  it('excludes a game where a player has no resolved civilization', () => {
    const games = [
      game(4, 'cash', [player('cash', 'Egyptians'), player('Karandras1', 'Romans')]),
      game(3, 'cash', [player('cash', 'Egyptians'), player('a', null)]),
    ]
    const result = highscore(games)

    expect(result.civs.totalNumberOfGames).toBe(1)
    expect(result.civs.winners).toEqual([
      { username: 'Egyptians', totalWins: 1, attempts: 1, percentWin: '100.0 %' },
    ])
    // The player table is unaffected by the missing civilization.
    expect(result.players.totalNumberOfGames).toBe(2)
  })

  it('never gives a losing-only civilization its own row', () => {
    // Romans loses both games, so — unlike the player tables — it gets no
    // row of its own; only the winning civ, Egyptians, does. See the module
    // comment on this Java asymmetry.
    const games = [
      game(2, 'cash', [player('cash', 'Egyptians'), player('Karandras1', 'Romans')]),
      game(2, 'cash', [player('cash', 'Egyptians'), player('Karandras1', 'Romans')]),
    ]
    const result = highscore(games)
    expect(result.civs.winners).toEqual([
      { username: 'Egyptians', totalWins: 2, attempts: 2, percentWin: '100.0 %' },
    ])
    expect(result.civs.winners.find((entry) => entry.username === 'Romans')).toBeUndefined()
  })
})
