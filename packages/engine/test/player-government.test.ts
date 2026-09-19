/**
 * Government was manual bookkeeping in the old asset spreadsheet. These
 * tests cover the in-app replacement and the official starting exceptions.
 */

import { describe, expect, it } from 'vitest'

import { revealItem, setPlayerGovernment } from '../src/actions/player.js'
import type { Government } from '../src/government.js'
import { DEFAULT_GOVERNMENT, startingGovernmentFor } from '../src/government.js'
import type { CivItem } from '../src/item.js'
import { migrateGameState } from '../src/migrate.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { findPlayer, toPlayerView } from '../src/state.js'

import { CASH1981, KARANDRAS1, firstCivGame } from './fixture.js'

function revealNamedCivilization(state: GameState, playerId: string, name: string): GameState {
  const civ = state.items.find(
    (item): item is CivItem => item.kind === 'civ' && item.name === name,
  )
  if (civ === undefined) throw new Error(`no civilization named ${name}`)

  const owned = { ...civ, ownerId: playerId }
  const withCivInHand: GameState = {
    ...state,
    items: state.items.filter((item) => item.id !== civ.id),
    players: state.players.map((player) =>
      player.playerId === playerId
        ? { ...player, items: [...player.items, owned] }
        : player,
    ),
  }

  return unwrap(
    revealItem(withCivInHand, {
      playerId,
      sheetName: 'CIV',
      itemNumber: civ.itemNumber,
    }),
  )
}

describe('player government', () => {
  it('starts new players in Despotism and migrates older hands to it', () => {
    const original = firstCivGame()
    expect(findPlayer(original, CASH1981)?.government).toBe(DEFAULT_GOVERNMENT)

    const older = {
      ...original,
      players: original.players.map(({ government: _government, ...player }) => player),
    } as unknown as GameState

    expect(findPlayer(migrateGameState(older), CASH1981)?.government).toBe('Despotism')
  })

  it.each([
    ['Romans', 'Republic'],
    ['Russians', 'Communism'],
    ['Japanese', 'Feudalism'],
    ['Americans', 'Despotism'],
  ] as const)(
    'sets %s to its documented starting government %s when revealed',
    (civilization, expected) => {
      const state = revealNamedCivilization(firstCivGame(), CASH1981, civilization)
      expect(findPlayer(state, CASH1981)?.government).toBe(expected)
      expect(startingGovernmentFor(civilization)).toBe(expected)
    },
  )

  it('lets one member update another player and writes a public log entry', () => {
    const state = unwrap(
      setPlayerGovernment(firstCivGame(), {
        editorPlayerId: CASH1981,
        targetPlayerId: KARANDRAS1,
        government: 'Monarchy',
      }),
    )

    expect(findPlayer(state, KARANDRAS1)?.government).toBe('Monarchy')
    expect(state.log.at(-1)?.publicLog).toBe("cash1981 set Karandras1's government to Monarchy")
    expect(state.log.at(-1)?.privateLog).toBe('')
  })

  it('logs a self-edit without naming the player twice', () => {
    const state = unwrap(
      setPlayerGovernment(firstCivGame(), {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        government: 'Democracy',
      }),
    )

    expect(state.log.at(-1)?.publicLog).toBe('cash1981 set their government to Democracy')
  })

  it('rejects a non-member editor and target', () => {
    expect(
      unwrapErr(
        setPlayerGovernment(firstCivGame(), {
          editorPlayerId: 'outsider',
          targetPlayerId: CASH1981,
          government: 'Republic',
        }),
      ).kind,
    ).toBe('NO_ACCESS')

    expect(
      unwrapErr(
        setPlayerGovernment(firstCivGame(), {
          editorPlayerId: CASH1981,
          targetPlayerId: 'outsider',
          government: 'Republic',
        }),
      ).kind,
    ).toBe('NO_ACCESS')
  })

  it('rejects a value outside the replacement government cards', () => {
    const error = unwrapErr(
      setPlayerGovernment(firstCivGame(), {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        government: 'Empire' as Government,
      }),
    )

    expect(error).toEqual({ kind: 'UNKNOWN_GOVERNMENT', government: 'Empire' })
  })

  it('projects government publicly without exposing another hand', () => {
    const state = unwrap(
      setPlayerGovernment(firstCivGame(), {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        government: 'Fundamentalism',
      }),
    )
    const view = toPlayerView(state, KARANDRAS1)
    const cash = view.opponents.find((opponent) => opponent.playerId === CASH1981)

    expect(cash?.government).toBe('Fundamentalism')
    expect(cash).not.toHaveProperty('items')
    expect(cash).not.toHaveProperty('techsChosen')
  })
})
