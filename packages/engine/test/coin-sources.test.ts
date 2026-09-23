/**
 * The coin sources on the status board — one counter per source per player.
 *
 * There is no old-system counterpart: neither `old-civ-rest` nor `old-civ-web`
 * modelled coin sources, and the old spreadsheet kept a single coin number. The
 * specification is the human's `Civ_Tech_FF-WW.-1.jpg` reference sheet, so
 * these tests are written against the brief rather than a Java test.
 */

import { describe, expect, it } from 'vitest'

import { setCoinSource } from '../src/actions/player.js'
import { COIN_SOURCES, EMPTY_COIN_SOURCES, findCoinSource, totalCoins } from '../src/coins.js'
import { migrateGameState } from '../src/migrate.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { findPlayer } from '../src/state.js'
import type { GameState } from '../src/state.js'

import { CASH1981, KARANDRAS1, firstCivGame } from './fixture.js'

describe('COIN_SOURCES', () => {
  it('is the reference sheet’s fifteen rows, in order, with the printed limits', () => {
    expect(COIN_SOURCES.map((source) => source.label)).toEqual([
      'Code of Laws (I)',
      'Pottery (I)',
      'Civil Service (II)',
      'Democracy (II)',
      'Printing Press (II)',
      'Bureaucracy (II)',
      'Railroad (III)',
      'Computers (IV)',
      'Bank (Building)',
      'Democracy (Govt)',
      'Great People',
      'Terrain',
      'Panama Canal',
      'Organized Religion',
      'Sheet',
    ])
    // The four "Up to 4" coin-token techs, the "1 coin" printed sources, and
    // the two the human said are unlimited (Sheet and Panama Canal).
    expect(COIN_SOURCES.map((source) => source.max)).toEqual([
      4, 4, 1, 4, 4, 1, 1, 1, 1, 1, 1, 1, null, 1, null,
    ])
  })

  it('gives every source a helper text from the sheet’s second column', () => {
    for (const source of COIN_SOURCES) {
      expect(source.help.length).toBeGreaterThan(0)
    }
    expect(findCoinSource('codeOfLaws')?.help).toBe('Up to 4 for winning battles')
    expect(findCoinSource('sheet')?.help).toBe('Coins from culture cards, loot or village etc.')
  })

  it('has one zeroed entry per source, and none it does not know', () => {
    expect(Object.keys(EMPTY_COIN_SOURCES).sort()).toEqual(
      COIN_SOURCES.map((source) => source.key).sort(),
    )
    expect(Object.values(EMPTY_COIN_SOURCES).every((value) => value === 0)).toBe(true)
  })

  it('findCoinSource returns undefined for a key that is not in the table', () => {
    expect(findCoinSource('fame')).toBeUndefined()
  })
})

describe('totalCoins', () => {
  it('adds every counter up', () => {
    expect(totalCoins(EMPTY_COIN_SOURCES)).toBe(0)
    expect(totalCoins({ ...EMPTY_COIN_SOURCES, codeOfLaws: 4, sheet: 3, terrain: 1 })).toBe(8)
  })
})

describe('setCoinSource', () => {
  it('sets one counter and writes a public log entry', () => {
    const state = unwrap(
      setCoinSource(firstCivGame(), {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        source: 'pottery',
        value: 3,
      }),
    )

    expect(findPlayer(state, CASH1981)?.stats.coinSources.pottery).toBe(3)
    const entry = state.log.at(-1)
    expect(entry?.publicLog).toBe('cash1981 set their coins on Pottery (I) to 3')
    expect(entry?.privateLog).toBe('')
  })

  it('lets one member set another member’s counter — shared bookkeeping', () => {
    const state = unwrap(
      setCoinSource(firstCivGame(), {
        editorPlayerId: CASH1981,
        targetPlayerId: KARANDRAS1,
        source: 'railroad',
        value: 1,
      }),
    )

    expect(findPlayer(state, KARANDRAS1)?.stats.coinSources.railroad).toBe(1)
    expect(findPlayer(state, CASH1981)?.stats.coinSources.railroad).toBe(0)
    expect(state.log.at(-1)?.publicLog).toBe(
      "cash1981 set Karandras1's coins on Railroad (III) to 1",
    )
  })

  it('accepts a source at its printed limit and refuses one above it', () => {
    const atLimit = unwrap(
      setCoinSource(firstCivGame(), {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        source: 'codeOfLaws',
        value: 4,
      }),
    )
    expect(findPlayer(atLimit, CASH1981)?.stats.coinSources.codeOfLaws).toBe(4)

    const error = unwrapErr(
      setCoinSource(firstCivGame(), {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        source: 'codeOfLaws',
        value: 5,
      }),
    )
    expect(error).toEqual({ kind: 'INVALID_COIN_VALUE', value: 5, max: 4 })
  })

  it('refuses a second coin on a one-coin source', () => {
    const error = unwrapErr(
      setCoinSource(firstCivGame(), {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        source: 'bank',
        value: 2,
      }),
    )
    expect(error).toEqual({ kind: 'INVALID_COIN_VALUE', value: 2, max: 1 })
  })

  it('has no limit on the Sheet pile or Panama Canal', () => {
    let state = unwrap(
      setCoinSource(firstCivGame(), {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        source: 'sheet',
        value: 12,
      }),
    )
    state = unwrap(
      setCoinSource(state, {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        source: 'panamaCanal',
        value: 9,
      }),
    )

    expect(findPlayer(state, CASH1981)?.stats.coinSources.sheet).toBe(12)
    expect(findPlayer(state, CASH1981)?.stats.coinSources.panamaCanal).toBe(9)
    expect(totalCoins(findPlayer(state, CASH1981)?.stats.coinSources ?? EMPTY_COIN_SOURCES)).toBe(21)
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses an invalid count: %s',
    (value) => {
      const error = unwrapErr(
        setCoinSource(firstCivGame(), {
          editorPlayerId: CASH1981,
          targetPlayerId: CASH1981,
          source: 'sheet',
          value,
        }),
      )
      expect(error).toEqual({ kind: 'INVALID_COIN_VALUE', value, max: null })
    },
  )

  it('refuses a source outside the reference sheet', () => {
    const error = unwrapErr(
      setCoinSource(firstCivGame(), {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        source: 'fame',
        value: 1,
      }),
    )
    expect(error).toEqual({ kind: 'UNKNOWN_COIN_SOURCE', source: 'fame' })
  })

  it('refuses an editor or a target who is not a member of the game', () => {
    const editor = unwrapErr(
      setCoinSource(firstCivGame(), {
        editorPlayerId: 'not-a-player',
        targetPlayerId: CASH1981,
        source: 'sheet',
        value: 1,
      }),
    )
    expect(editor.kind).toBe('NO_ACCESS')

    const target = unwrapErr(
      setCoinSource(firstCivGame(), {
        editorPlayerId: CASH1981,
        targetPlayerId: 'not-a-player',
        source: 'sheet',
        value: 1,
      }),
    )
    expect(target.kind).toBe('NO_ACCESS')
  })

  it('changes only the named counter', () => {
    let state = unwrap(
      setCoinSource(firstCivGame(), {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        source: 'codeOfLaws',
        value: 2,
      }),
    )
    state = unwrap(
      setCoinSource(state, {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        source: 'sheet',
        value: 1,
      }),
    )

    expect(findPlayer(state, CASH1981)?.stats.coinSources).toEqual({
      ...EMPTY_COIN_SOURCES,
      codeOfLaws: 2,
      sheet: 1,
    })
  })
})

describe('coin sources in old saves', () => {
  it('fills a source that did not exist when the game was saved', () => {
    const original = firstCivGame()
    const partial: Record<string, number> = { ...EMPTY_COIN_SOURCES }
    delete partial['sheet']
    const older = {
      ...original,
      players: original.players.map((player) => ({
        ...player,
        stats: { ...player.stats, coinSources: partial },
      })),
    } as unknown as GameState

    expect(findPlayer(migrateGameState(older), CASH1981)?.stats.coinSources).toEqual(
      EMPTY_COIN_SOURCES,
    )
  })
})
