/**
 * The coin sources on the status board — one counter per source per player.
 *
 * There is no old-system counterpart: neither `old-civ-rest` nor `old-civ-web`
 * modelled coin sources, and the old spreadsheet kept a single coin number. The
 * specification is the human's `Civ_Tech_FF-WW.-1.jpg` reference sheet, so
 * these tests are written against the brief rather than a Java test.
 */

import { describe, expect, it } from 'vitest'

import {
  chooseSocialPolicy,
  chooseTech,
  removeSocialPolicy,
  removeTech,
  setCoinSource,
  setPlayerGovernment,
} from '../src/actions/player.js'
import { movePiece, placePiece, setWonderOwner } from '../src/actions/board.js'
import {
  ALWAYS_AVAILABLE_COIN_SOURCES,
  COIN_SOURCES,
  EMPTY_COIN_SOURCES,
  findCoinSource,
  socialPolicyCoinSource,
  techCoinSource,
  totalCoins,
} from '../src/coins.js'
import { migrateGameState } from '../src/migrate.js'
import { isInWondersArea, wondersArea } from '../src/board.js'
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

  it('gives every source a helper text from the sheet’s second column, except Great People', () => {
    for (const source of COIN_SOURCES) {
      if (source.key === 'greatPeople') continue
      expect(source.help.length).toBeGreaterThan(0)
    }
    // Issue #158: the human asked for "50% chance of providing 1 coin" to go.
    expect(findCoinSource('greatPeople')?.help).toBe('')
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

/** Issue #158: which sources are real for a player, and what clears them. */
describe('coin source availability', () => {
  it('maps each coin-token tech name to its source, and no other tech', () => {
    expect(techCoinSource('Code of Laws')).toBe('codeOfLaws')
    expect(techCoinSource('Pottery')).toBe('pottery')
    expect(techCoinSource('Civil Service')).toBe('civilService')
    expect(techCoinSource('Democracy')).toBe('democracy')
    expect(techCoinSource('Printing Press')).toBe('printingPress')
    expect(techCoinSource('Bureaucracy')).toBe('bureaucracy')
    expect(techCoinSource('Railroad')).toBe('railroad')
    expect(techCoinSource('Computers')).toBe('computers')
    expect(techCoinSource('Navy')).toBeUndefined()
  })

  it('maps Organized Religion to its source but not its flipside', () => {
    expect(socialPolicyCoinSource('Organized Religion')).toBe('organizedReligion')
    // Natural Religion is the printed flipside and carries a different effect.
    expect(socialPolicyCoinSource('Natural Religion')).toBeUndefined()
    expect(socialPolicyCoinSource('Urban Development')).toBeUndefined()
  })

  it('leaves no source without an availability rule', () => {
    // If a row is ever added to COIN_SOURCES without being wired into one of
    // the four rules, this test fails rather than the row silently vanishing
    // from the Coins tab.
    const reachable = new Set<string>(ALWAYS_AVAILABLE_COIN_SOURCES)
    for (const techName of [
      'Code of Laws',
      'Pottery',
      'Civil Service',
      'Democracy',
      'Printing Press',
      'Bureaucracy',
      'Railroad',
      'Computers',
    ]) {
      const key = techCoinSource(techName)
      if (key !== undefined) reachable.add(key)
    }
    const policy = socialPolicyCoinSource('Organized Religion')
    if (policy !== undefined) reachable.add(policy)
    reachable.add('democracyGovernment')
    reachable.add('panamaCanal')

    expect([...reachable].sort()).toEqual(COIN_SOURCES.map((source) => source.key).sort())
  })
})

describe('totalCoins', () => {
  it('adds every counter up', () => {
    expect(totalCoins(EMPTY_COIN_SOURCES)).toBe(0)
    expect(totalCoins({ ...EMPTY_COIN_SOURCES, codeOfLaws: 4, sheet: 3, terrain: 1 })).toBe(8)
  })
})

describe('setCoinSource', () => {
  it('raises the four technology limits by two only for The Internet owner', () => {
    const state = firstCivGame()
    const area = wondersArea(state.board)
    const placed = unwrap(placePiece(state, {
      playerId: CASH1981, assetId: 'wonders/internet', x: area.x + 20, y: area.y + 40,
    }))
    const wonder = placed.board.pieces.at(-1)
    if (wonder === undefined) throw new Error('The Internet should be on the board')
    expect(isInWondersArea(placed.board, wonder)).toBe(true)
    const owned = unwrap(setWonderOwner(placed, {
      playerId: CASH1981, pieceId: wonder.id, ownerId: KARANDRAS1,
    }))
    for (const source of ['codeOfLaws', 'pottery', 'democracy', 'printingPress']) {
      expect(unwrap(setCoinSource(owned, {
        editorPlayerId: CASH1981, targetPlayerId: KARANDRAS1, source, value: 6,
      }))).toBeDefined()
      expect(unwrapErr(setCoinSource(owned, {
        editorPlayerId: CASH1981, targetPlayerId: KARANDRAS1, source, value: 7,
      }))).toEqual({ kind: 'INVALID_COIN_VALUE', value: 7, max: 6 })
      expect(unwrapErr(setCoinSource(owned, {
        editorPlayerId: CASH1981, targetPlayerId: CASH1981, source, value: 5,
      }))).toEqual({ kind: 'INVALID_COIN_VALUE', value: 5, max: 4 })
    }
  })

  it('lets a player lower a counter after losing The Internet even while it is over the new cap', () => {
    const state = firstCivGame()
    const area = wondersArea(state.board)
    const placed = unwrap(placePiece(state, {
      playerId: CASH1981, assetId: 'wonders/internet', x: area.x + 20, y: area.y + 40,
    }))
    const wonder = placed.board.pieces.at(-1)
    if (wonder === undefined) throw new Error('The Internet should be on the board')
    const owned = unwrap(setWonderOwner(placed, {
      playerId: CASH1981, pieceId: wonder.id, ownerId: CASH1981,
    }))
    const six = unwrap(setCoinSource(owned, {
      editorPlayerId: CASH1981, targetPlayerId: CASH1981, source: 'pottery', value: 6,
    }))
    const unowned = unwrap(setWonderOwner(six, {
      playerId: CASH1981, pieceId: wonder.id, ownerId: null,
    }))
    const five = unwrap(setCoinSource(unowned, {
      editorPlayerId: CASH1981, targetPlayerId: CASH1981, source: 'pottery', value: 5,
    }))
    expect(findPlayer(five, CASH1981)?.stats.coinSources.pottery).toBe(5)
    expect(unwrapErr(setCoinSource(five, {
      editorPlayerId: CASH1981, targetPlayerId: CASH1981, source: 'pottery', value: 6,
    }))).toEqual({ kind: 'INVALID_COIN_VALUE', value: 6, max: 4 })
  })

  it('does not apply The Internet bonus after the wonder leaves the shared Wonders area', () => {
    const state = firstCivGame()
    const area = wondersArea(state.board)
    const placed = unwrap(placePiece(state, {
      playerId: CASH1981, assetId: 'wonders/internet', x: area.x + 20, y: area.y + 40,
    }))
    const wonder = placed.board.pieces.at(-1)
    if (wonder === undefined) throw new Error('The Internet should be on the board')
    const owned = unwrap(setWonderOwner(placed, {
      playerId: CASH1981, pieceId: wonder.id, ownerId: CASH1981,
    }))
    const moved = unwrap(movePiece(owned, {
      playerId: CASH1981, pieceId: wonder.id, x: 300, y: 300,
    }))
    expect(unwrapErr(setCoinSource(moved, {
      editorPlayerId: CASH1981, targetPlayerId: CASH1981, source: 'pottery', value: 5,
    }))).toEqual({ kind: 'INVALID_COIN_VALUE', value: 5, max: 4 })
  })

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

describe('a counter does not outlive its source (issue #158)', () => {
  it('clears a tech’s counter when the tech is removed, and keeps the others', () => {
    let state = unwrap(
      chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Code of Laws' }),
    )
    state = unwrap(
      setCoinSource(state, {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        source: 'codeOfLaws',
        value: 3,
      }),
    )
    state = unwrap(
      setCoinSource(state, {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        source: 'sheet',
        value: 2,
      }),
    )

    state = unwrap(removeTech(state, { playerId: CASH1981, techName: 'Code of Laws' }))

    expect(findPlayer(state, CASH1981)?.stats.coinSources).toEqual({
      ...EMPTY_COIN_SOURCES,
      sheet: 2,
    })
  })

  it('leaves every counter alone when the removed tech has no coin source', () => {
    let state = unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Navy' }))
    state = unwrap(
      setCoinSource(state, {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        source: 'bureaucracy',
        value: 1,
      }),
    )

    state = unwrap(removeTech(state, { playerId: CASH1981, techName: 'Navy' }))

    expect(findPlayer(state, CASH1981)?.stats.coinSources.bureaucracy).toBe(1)
  })

  it('clears the Organized Religion counter when the policy is removed', () => {
    const game = firstCivGame()
    const policy = game.socialPolicies.find(
      (candidate) => candidate.name === 'Organized Religion',
    )
    if (policy === undefined) throw new Error('Organized Religion is missing from the data set')

    let state = unwrap(chooseSocialPolicy(game, { playerId: CASH1981, name: policy.name }))
    state = unwrap(
      setCoinSource(state, {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        source: 'organizedReligion',
        value: 1,
      }),
    )
    state = unwrap(
      setCoinSource(state, {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        source: 'terrain',
        value: 1,
      }),
    )

    state = unwrap(removeSocialPolicy(state, { playerId: CASH1981, name: policy.name }))

    expect(findPlayer(state, CASH1981)?.stats.coinSources).toEqual({
      ...EMPTY_COIN_SOURCES,
      terrain: 1,
    })
  })

  it('clears the Democracy (Govt) counter when the government leaves Democracy', () => {
    let state = unwrap(
      setPlayerGovernment(firstCivGame(), {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        government: 'Democracy',
      }),
    )
    state = unwrap(
      setCoinSource(state, {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        source: 'democracyGovernment',
        value: 1,
      }),
    )
    state = unwrap(
      setCoinSource(state, {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        source: 'greatPeople',
        value: 1,
      }),
    )

    state = unwrap(
      setPlayerGovernment(state, {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        government: 'Monarchy',
      }),
    )

    expect(findPlayer(state, CASH1981)?.stats.coinSources).toEqual({
      ...EMPTY_COIN_SOURCES,
      greatPeople: 1,
    })
  })

  it('does not touch another player’s counters when a source is removed', () => {
    let state = unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Pottery' }))
    state = unwrap(
      setCoinSource(state, {
        editorPlayerId: CASH1981,
        targetPlayerId: KARANDRAS1,
        source: 'pottery',
        value: 2,
      }),
    )

    state = unwrap(removeTech(state, { playerId: CASH1981, techName: 'Pottery' }))

    expect(findPlayer(state, CASH1981)?.stats.coinSources.pottery).toBe(0)
    expect(findPlayer(state, KARANDRAS1)?.stats.coinSources.pottery).toBe(2)
  })

  it('adds no log line of its own when a removal clears a counter', () => {
    let state = unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Pottery' }))
    state = unwrap(
      setCoinSource(state, {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        source: 'pottery',
        value: 1,
      }),
    )
    const afterCoinLog = state.log.length

    state = unwrap(removeTech(state, { playerId: CASH1981, techName: 'Pottery' }))

    expect(state.log.length).toBe(afterCoinLog + 1)
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
