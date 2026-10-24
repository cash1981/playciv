/**
 * The status board (issue #43), which replaces the manual spreadsheet the
 * players used to keep next to the game: trade, culture and victory points,
 * plus a few numbers derived from the board itself. The coin sources get their
 * own file, `coin-sources.test.ts`.
 *
 * There is no old system to port here — Java had no board and no status
 * board at all — so these tests are written directly against the brief.
 */

import { describe, expect, it } from 'vitest'

import { placePiece } from '../src/actions/board.js'
import { draw } from '../src/actions/draw.js'
import { chooseTech, revealItem, revealTech, setCoinSource, setPlayerStat } from '../src/actions/player.js'
import { EMPTY_COIN_SOURCES } from '../src/coins.js'
import { tradeCeilingOf } from '../src/limits.js'
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
      coinSources: EMPTY_COIN_SOURCES,
      trade: 0,
      culture: 0,
      cultureHandSize: 2,
      infantry: 1,
      artillery: 1,
      mounted: 1,
      aircraft: false,
      stacking: 2,
      mvmt: '2',
      combat: 0,
      combatHandSize: '',
      efta: 0,
      infra: 0,
      mic: 0,
      pe: 0,
    })
  })

  it('fills new status fields on an older saved player and replaces the legacy coin number', () => {
    const original = firstCivGame()
    const older = {
      ...original,
      players: original.players.map((player) => ({
        ...player,
        stats: { coins: 9, trade: 2, culture: 4 },
      })),
    } as unknown as GameState

    const migrated = migrateGameState(older)
    const stats = findPlayer(migrated, CASH1981)?.stats
    expect(stats).toEqual({ ...DEFAULT_PLAYER_STATS, trade: 2, culture: 4 })
    // The single legacy number is replaced by the counters, per the human:
    // "Det tallet som står der idag på coins tallet på eksisterende spill skal
    // erstattes med det nye."
    expect(Object.hasOwn(stats ?? {}, 'coins')).toBe(false)
  })

  it('normalises a numeric Movement from a game saved before issue #102', () => {
    const original = firstCivGame()
    const older = {
      ...original,
      players: original.players.map((player) => ({
        ...player,
        stats: { ...player.stats, mvmt: 3 },
      })),
    } as unknown as GameState

    expect(findPlayer(migrateGameState(older), CASH1981)?.stats.mvmt).toBe('3')
  })

  it('sets a stat on the target and writes a public log entry', () => {
    const state = unwrap(
      setPlayerStat(firstCivGame(), {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        stat: 'culture',
        value: 7,
      }),
    )

    expect(findPlayer(state, CASH1981)?.stats.culture).toBe(7)
    const entry = state.log.at(-1)
    expect(entry?.publicLog).toBe('cash1981 set their culture to 7')
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

  it('leaves the other stats untouched', () => {
    let state = unwrap(
      setPlayerStat(firstCivGame(), {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        stat: 'culture',
        value: 5,
      }),
    )

    expect(findPlayer(state, CASH1981)?.stats).toEqual({
      ...DEFAULT_PLAYER_STATS,
      culture: 5,
    })
  })

  it('rejects an editor who is not a member of the game', () => {
    const error = unwrapErr(
      setPlayerStat(firstCivGame(), {
        editorPlayerId: 'not-a-player',
        targetPlayerId: CASH1981,
        stat: 'trade',
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
        stat: 'trade',
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
          stat: 'culture',
          value,
        }),
      )
      expect(error).toEqual({ kind: 'INVALID_STAT_VALUE', value })
    },
  )

  describe('the trade ceiling', () => {
    const setTrade = (value: number) =>
      setPlayerStat(firstCivGame(), { editorPlayerId: CASH1981, targetPlayerId: CASH1981, stat: 'trade', value })

    it('takes 27, the end of the trade track, and refuses anything above it', () => {
      expect(unwrap(setTrade(27)).players.find((p) => p.playerId === CASH1981)?.stats.trade).toBe(27)
      expect(unwrapErr(setTrade(28))).toEqual({ kind: 'TRADE_ABOVE_CEILING', value: 28, ceiling: 27 })
    })

    it('ends at 25 for the Japanese, the one exception', () => {
      const japanese = {
        ...firstCivGame(),
        players: firstCivGame().players.map((p) =>
          p.playerId === CASH1981 ? { ...p, civilization: { kind: 'civ', name: 'Japanese' } as never } : p,
        ),
      }
      const set = (value: number) =>
        setPlayerStat(japanese, { editorPlayerId: CASH1981, targetPlayerId: CASH1981, stat: 'trade', value })
      expect(unwrap(set(25)).players.find((p) => p.playerId === CASH1981)?.stats.trade).toBe(25)
      expect(unwrapErr(set(26))).toEqual({ kind: 'TRADE_ABOVE_CEILING', value: 26, ceiling: 25 })
      // the editor's own civilization does not matter, only the player whose trade it is
      expect(tradeCeilingOf('Greeks')).toBe(27)
      expect(tradeCeilingOf(null)).toBe(27)
    })

    it('leaves the other stats without a ceiling', () => {
      const state = unwrap(
        setPlayerStat(firstCivGame(), { editorPlayerId: CASH1981, targetPlayerId: CASH1981, stat: 'culture', value: 40 }),
      )
      expect(state.players.find((p) => p.playerId === CASH1981)?.stats.culture).toBe(40)
    })
  })

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

  it('refuses to set combat, which is calculated from the board (issue #197)', () => {
    const error = unwrapErr(
      setPlayerStat(firstCivGame(), {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        stat: 'combat',
        value: 3,
      }),
    )
    expect(error).toEqual({ kind: 'STAT_NOT_EDITABLE', stat: 'combat' })
  })

  it('accepts a Movement expression with a printed natural-religion bonus', () => {
    const state = unwrap(
      setPlayerStat(firstCivGame(), {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        stat: 'mvmt',
        value: '3+1',
      }),
    )
    expect(findPlayer(state, CASH1981)?.stats.mvmt).toBe('3+1')
    expect(state.log.at(-1)?.publicLog).toBe('cash1981 set their movement to 3+1')
  })

  it('accepts more than one Movement bonus, and a plain number normalised to text', () => {
    let state = unwrap(
      setPlayerStat(firstCivGame(), {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        stat: 'mvmt',
        value: '2+1+1',
      }),
    )
    expect(findPlayer(state, CASH1981)?.stats.mvmt).toBe('2+1+1')

    state = unwrap(
      setPlayerStat(state, {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        stat: 'mvmt',
        value: 4,
      }),
    )
    // A bare number is stored in its canonical string form.
    expect(findPlayer(state, CASH1981)?.stats.mvmt).toBe('4')
  })

  it.each(['3+', '+1', 'three', '', '3 + 1', '-1'])(
    'rejects an invalid Movement value: %s',
    (value) => {
      const error = unwrapErr(
        setPlayerStat(firstCivGame(), {
          editorPlayerId: CASH1981,
          targetPlayerId: CASH1981,
          stat: 'mvmt',
          value,
        }),
      )
      expect(error).toEqual({ kind: 'INVALID_STAT_VALUE', value })
    },
  )

  it('rejects a Movement expression for a numeric stat', () => {
    const error = unwrapErr(
      setPlayerStat(firstCivGame(), {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        stat: 'culture',
        // @ts-expect-error — a Movement expression is not a valid culture value
        value: '3+1',
      }),
    )
    expect(error).toEqual({ kind: 'INVALID_STAT_VALUE', value: '3+1' })
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
      setCoinSource(fourColorGame(), {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        source: 'codeOfLaws',
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
    expect(cash?.stats).toEqual({
      ...DEFAULT_PLAYER_STATS,
      coinSources: { ...EMPTY_COIN_SOURCES, codeOfLaws: 4 },
    })
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
        stat: 'combatHandSize',
        value: '+9',
      }),
    )

    const view = toPlayerView(state, ITCHI)
    const cash = view.opponents.find((opponent) => opponent.playerId === CASH1981)

    // The stat is public...
    expect(cash?.stats.combatHandSize).toBe('+9')
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

describe('Aircraft unlocked', () => {
  const setAircraft = (state: GameState, value: unknown) =>
    setPlayerStat(state, {
      editorPlayerId: CASH1981,
      targetPlayerId: KARANDRAS1,
      stat: 'aircraft',
      value: value as boolean,
    })

  it('can be ticked and unticked by hand, with a public log line', () => {
    const ticked = unwrap(setAircraft(firstCivGame(), true))
    expect(findPlayer(ticked, KARANDRAS1)?.stats.aircraft).toBe(true)
    expect(findPlayer(ticked, CASH1981)?.stats.aircraft).toBe(false)
    expect(ticked.log.at(-1)?.publicLog).toBe("cash1981 set Karandras1's aircraft unlocked to yes")

    const unticked = unwrap(setAircraft(ticked, false))
    expect(findPlayer(unticked, KARANDRAS1)?.stats.aircraft).toBe(false)
  })

  it.each([1, 'true', null])('rejects %s, which is not a boolean', (value) => {
    expect(unwrapErr(setAircraft(firstCivGame(), value)).kind).toBe('INVALID_STAT_VALUE')
  })

  it('rejects a boolean for a numeric stat', () => {
    const error = unwrapErr(
      setPlayerStat(firstCivGame(), {
        editorPlayerId: CASH1981,
        targetPlayerId: CASH1981,
        stat: 'culture',
        value: true as unknown as number,
      }),
    )
    expect(error.kind).toBe('INVALID_STAT_VALUE')
  })

  it('is set when the player reveals Flight, but not by merely choosing it', () => {
    const chosen = unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Flight' }))
    expect(findPlayer(chosen, CASH1981)?.stats.aircraft).toBe(false)
    const revealed = unwrap(revealTech(chosen, { playerId: CASH1981, techName: 'Flight' }))
    expect(findPlayer(revealed, CASH1981)?.stats.aircraft).toBe(true)
    expect(findPlayer(revealed, KARANDRAS1)?.stats.aircraft).toBe(false)
  })

  it('is not set by revealing any other tech', () => {
    const chosen = unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Education' }))
    const revealed = unwrap(revealTech(chosen, { playerId: CASH1981, techName: 'Education' }))
    expect(findPlayer(revealed, CASH1981)?.stats.aircraft).toBe(false)
  })

  it('does not overrule a player who unticked it when Flight is revealed a second time', () => {
    let state = unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Flight' }))
    state = unwrap(revealTech(state, { playerId: CASH1981, techName: 'Flight' }))
    state = unwrap(setPlayerStat(state, {
      editorPlayerId: CASH1981, targetPlayerId: CASH1981, stat: 'aircraft', value: false,
    }))
    state = unwrap(revealTech(state, { playerId: CASH1981, techName: 'Flight' }))
    expect(findPlayer(state, CASH1981)?.stats.aircraft).toBe(false)
  })

  it('is public status: an opponent sees it only once Flight has been revealed or it was ticked', () => {
    const chosen = unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Flight' }))
    const opponentSees = (state: GameState) =>
      toPlayerView(state, KARANDRAS1).opponents.find((o) => o.playerId === CASH1981)?.stats.aircraft
    expect(opponentSees(chosen)).toBe(false)
    expect(opponentSees(unwrap(revealTech(chosen, { playerId: CASH1981, techName: 'Flight' })))).toBe(true)
  })

  it('is filled in as false on a game saved before it existed', () => {
    const original = firstCivGame()
    const older = {
      ...original,
      players: original.players.map((player) => {
        const { aircraft: _aircraft, ...stats } = player.stats
        return { ...player, stats }
      }),
    } as unknown as GameState
    expect(findPlayer(migrateGameState(older), CASH1981)?.stats.aircraft).toBe(false)
  })
})
