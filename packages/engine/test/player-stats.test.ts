/**
 * The status board (issue #43), which replaces the manual spreadsheet the
 * players used to keep next to the game: coins, trade, culture and victory
 * points, plus a few numbers derived from the board itself.
 *
 * There is no old system to port here — Java had no board and no status
 * board at all — so these tests are written directly against the brief.
 */

import { describe, expect, it } from 'vitest'

import { placePiece } from '../src/actions/board.js'
import { draw } from '../src/actions/draw.js'
import { chooseTech, revealItem, setPlayerStat } from '../src/actions/player.js'
import { createGame } from '../src/create-game.js'
import { migrateGameState } from '../src/migrate.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'
import {
  buildingCountOf,
  cityCountOf,
  cultureMarkerLevelOf,
  DEFAULT_PLAYER_STATS,
  findPlayer,
  toPlayerView,
} from '../src/state.js'

import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

/**
 * `firstCivGame` gives every player the colour Red (it only needs stable
 * ids, not distinct colours), which does not exercise colour-based ownership.
 * This fixture gives each of the four players their own colour instead.
 */
function fourColorGame(): GameState {
  return createGame({
    name: 'Four colours',
    numOfPlayers: 4,
    seed: 'status board test',
    players: [
      { playerId: CASH1981, username: 'cash1981', color: 'Red', gameCreator: true, yourTurn: true },
      { playerId: KARANDRAS1, username: 'Karandras1', color: 'Blue' },
      { playerId: ITCHI, username: 'Itchi', color: 'Green' },
      { playerId: CHUL, username: 'Chul', color: 'Yellow' },
    ],
  })
}

/** Draws and reveals a civilization for a player, placing their leader marker. */
function chooseCiv(start: GameState, playerId: string): GameState {
  const drawn = unwrap(draw(start, { playerId, sheetName: 'CIV' }))
  const civ = findPlayer(drawn, playerId)?.items.find((item) => item.kind === 'civ')
  if (civ?.kind !== 'civ') throw new Error('no civ in the hand')
  return unwrap(revealItem(drawn, { playerId, sheetName: 'CIV', itemNumber: civ.itemNumber }))
}

describe('setPlayerStat', () => {
  it('starts the status board with the requested defaults', () => {
    expect(findPlayer(firstCivGame(), CASH1981)?.stats).toMatchObject({
      coins: 0,
      trade: 0,
      culture: 0,
      infantry: 1,
      artillery: 1,
      mounted: 1,
      stacking: 2,
      mvmt: 2,
      combat: 0,
      handSize: 0,
      efta: 0,
      infra: 0,
      mic: 0,
      pe: 0,
    })
  })

  it('fills new status fields on an older saved player without losing old values', () => {
    const original = firstCivGame()
    const older = {
      ...original,
      players: original.players.map((player) => ({
        ...player,
        stats: { coins: 9, trade: 2, culture: 4 },
      })),
    } as unknown as GameState

    const migrated = migrateGameState(older)
    expect(findPlayer(migrated, CASH1981)?.stats).toEqual({
      ...DEFAULT_PLAYER_STATS,
      coins: 9,
      trade: 2,
      culture: 4,
    })
  })

  it('sets a stat on the target and writes a public log entry', () => {
    const state = unwrap(
      setPlayerStat(firstCivGame(), {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        stat: 'coins',
        value: 7,
      }),
    )

    expect(findPlayer(state, CASH1981)?.stats.coins).toBe(7)
    const entry = state.log.at(-1)
    expect(entry?.publicLog).toBe('cash1981 set their coins to 7')
    expect(entry?.privateLog).toBe('')
  })

  it('lets one member set another member\'s stat — shared bookkeeping, not a private hand', () => {
    const state = unwrap(
      setPlayerStat(firstCivGame(), {
        editorPlayerId: CASH1981,
        targetPlayerId: KARANDRAS1,
        stat: 'trade',
        value: 3,
      }),
    )

    expect(findPlayer(state, KARANDRAS1)?.stats.trade).toBe(3)
    expect(findPlayer(state, CASH1981)?.stats.trade).toBe(0)
    expect(state.log.at(-1)?.publicLog).toBe("cash1981 set Karandras1's trade to 3")
  })

  it('leaves the other three stats untouched', () => {
    let state = unwrap(
      setPlayerStat(firstCivGame(), {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        stat: 'coins',
        value: 5,
      }),
    )
    state = unwrap(
      setPlayerStat(state, {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        stat: 'combat',
        value: 2,
      }),
    )

    expect(findPlayer(state, CASH1981)?.stats).toEqual({
      ...DEFAULT_PLAYER_STATS,
      coins: 5,
      combat: 2,
    })
  })

  it('rejects an editor who is not a member of the game', () => {
    const error = unwrapErr(
      setPlayerStat(firstCivGame(), {
        editorPlayerId: 'not-a-player',
        targetPlayerId: CASH1981,
        stat: 'coins',
        value: 1,
      }),
    )
    expect(error.kind).toBe('NO_ACCESS')
  })

  it('rejects a target who is not a member of the game', () => {
    const error = unwrapErr(
      setPlayerStat(firstCivGame(), {
        editorPlayerId: CASH1981,
        targetPlayerId: 'not-a-player',
        stat: 'coins',
        value: 1,
      }),
    )
    expect(error.kind).toBe('NO_ACCESS')
  })

  it('rejects an unknown stat key', () => {
    const error = unwrapErr(
      setPlayerStat(firstCivGame(), {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        // @ts-expect-error — deliberately outside PlayerStats, to check the runtime guard
        stat: 'fame',
        value: 1,
      }),
    )
    expect(error).toEqual({ kind: 'UNKNOWN_STAT', stat: 'fame' })
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid value: %s',
    (value) => {
      const error = unwrapErr(
        setPlayerStat(firstCivGame(), {
          editorPlayerId: CASH1981,
          targetPlayerId: CASH1981,
          stat: 'coins',
          value,
        }),
      )
      expect(error).toEqual({ kind: 'INVALID_STAT_VALUE', value })
    },
  )

  it('accepts zero, the lowest valid value', () => {
    const state = unwrap(
      setPlayerStat(firstCivGame(), {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        stat: 'culture',
        value: 0,
      }),
    )
    expect(findPlayer(state, CASH1981)?.stats.culture).toBe(0)
  })

  it('accepts a negative combat modifier', () => {
    const state = unwrap(
      setPlayerStat(firstCivGame(), {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        stat: 'combat',
        value: -1,
      }),
    )
    expect(findPlayer(state, CASH1981)?.stats.combat).toBe(-1)
  })
})

describe('cultureMarkerLevelOf', () => {
  it('is null before a civilization has been chosen', () => {
    expect(cultureMarkerLevelOf(firstCivGame(), CASH1981)).toBeNull()
  })

  it('is null for a player who does not exist', () => {
    expect(cultureMarkerLevelOf(firstCivGame(), 'not-a-player')).toBeNull()
  })

  it('is 0 (START) right after the civilization is revealed', () => {
    const state = chooseCiv(firstCivGame(), CASH1981)
    expect(cultureMarkerLevelOf(state, CASH1981)).toBe(0)
  })
})

describe('cityCountOf and buildingCountOf', () => {
  it('counts city pieces placed in the player\'s colour', () => {
    let state = fourColorGame()
    // cash1981 plays Red in the fixture
    state = unwrap(
      placePiece(state, { playerId: CASH1981, assetId: 'cities/redcity2', x: 0, y: 300 }),
    )
    state = unwrap(
      placePiece(state, { playerId: CASH1981, assetId: 'cities/redcapital2', x: 200, y: 300 }),
    )
    // Ownership follows the piece's colour, not who placed it: a blue city
    // placed by cash1981 (Red) counts for Karandras1 (Blue), not for cash1981.
    state = unwrap(
      placePiece(state, { playerId: CASH1981, assetId: 'cities/bluecity2', x: 400, y: 300 }),
    )

    expect(cityCountOf(state, CASH1981)).toBe(2)
    expect(cityCountOf(state, KARANDRAS1)).toBe(1)
    expect(cityCountOf(state, ITCHI)).toBe(0)
  })

  it('is 0 for a player with no colour', () => {
    expect(cityCountOf(firstCivGame(), 'not-a-player')).toBe(0)
  })

  it('counts building pieces by who placed them, since buildings carry no colour', () => {
    let state = firstCivGame()
    state = unwrap(
      placePiece(state, { playerId: CASH1981, assetId: 'buildings/library', x: 0, y: 300 }),
    )
    state = unwrap(
      placePiece(state, { playerId: KARANDRAS1, assetId: 'buildings/market', x: 200, y: 300 }),
    )

    expect(buildingCountOf(state, CASH1981)).toBe(1)
    expect(buildingCountOf(state, KARANDRAS1)).toBe(1)
    expect(buildingCountOf(state, ITCHI)).toBe(0)
  })
})

describe('projections carry the status board', () => {
  it('toPlayerView exposes stats and the derived board numbers for yourself and opponents', () => {
    let state = unwrap(
      setPlayerStat(fourColorGame(), {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        stat: 'coins',
        value: 4,
      }),
    )
    state = unwrap(
      placePiece(state, { playerId: CASH1981, assetId: 'cities/redcity2', x: 0, y: 300 }),
    )

    const view = toPlayerView(state, KARANDRAS1)

    expect(view.you?.stats).toEqual(DEFAULT_PLAYER_STATS)
    expect(view.you?.cultureMarkerLevel).toBeNull()
    expect(view.you?.cityCount).toBe(0)
    expect(view.you?.buildingCount).toBe(0)

    const cash = view.opponents.find((opponent) => opponent.playerId === CASH1981)
    expect(cash?.stats).toEqual({ ...DEFAULT_PLAYER_STATS, coins: 4 })
    expect(cash?.cityCount).toBe(1)
    expect(cash?.buildingCount).toBe(0)
    expect(cash?.cultureMarkerLevel).toBeNull()
  })

  it('never leaks another player\'s hand or hidden techs alongside the public stats', () => {
    let state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'GREAT_PERSON' }))
    state = unwrap(chooseTech(state, { playerId: CASH1981, techName: 'Navy' }))
    state = unwrap(
      setPlayerStat(state, {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        stat: 'handSize',
        value: 9,
      }),
    )

    const view = toPlayerView(state, ITCHI)
    const cash = view.opponents.find((opponent) => opponent.playerId === CASH1981)

    // The stat is public...
    expect(cash?.stats.handSize).toBe(9)
    // ...but the hand it sits alongside is still a count, not the cards
    expect(cash).not.toHaveProperty('items')
    expect(cash).not.toHaveProperty('techsChosen')
    expect(cash?.revealedTechs).toEqual([])
    expect(cash?.numberOfItemsInHand).toBe(1)

    // A member not shown here (CHUL) proves opponents beyond the pair above
    // are unaffected by the edit.
    expect(findPlayer(state, CHUL)?.stats).toEqual(DEFAULT_PLAYER_STATS)
  })
})
