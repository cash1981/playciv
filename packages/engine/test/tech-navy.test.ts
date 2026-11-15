/**
 * Navy (issue #354): "Each time you build an army with a city action, you may place that unit in the
 * outskirts of a city with a shipyard." With Navy revealed, building an army offers the legal squares in
 * the outskirts of any of the player's cities that has a Shipyard as well as the building city's own.
 * Rulings 186 to 189: only an army built by a city action, anywhere in that city's outskirts, a capital's
 * held city-state included, and not on a Shipyard square where an enemy figure stands.
 *
 * Scene: the America tile (see assisted-units.test.ts) with a red city on B2, the building city (outskirts
 * A1 to C3). A red city on D4 has the outskirts C3, D3 (forest) and C4 (water) inside the tile; D3 and C4 lie
 * outside B2's outskirts. A red city on A4 has A3, B3 and B4, of which only B4 is outside B2's outskirts.
 */

import { describe, expect, it } from 'vitest'

import { placePiece } from '../src/actions/board.js'
import { chooseTech, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { performAssistedAction } from '../src/assisted.js'
import { mapCellOf } from '../src/blockade.js'
import { SQUARE_SIZE, findBoardAsset, mapTop, slotOrigin } from '../src/board.js'
import type { BoardPiece } from '../src/board.js'
import { buildOptionsOf, buildSquareRefusal } from '../src/build-options.js'
import type { BuildItem } from '../src/build-item.js'
import type { BuildChoice, BuildPayload } from '../src/build-options.js'
import { describeError } from '../src/errors.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { GameState, Playerhand } from '../src/state.js'

import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-10-09T10:00:00.000Z'
const SHIPYARD = 'buildings/shipyard'

type Cell = { readonly column: number; readonly row: number }
const D3: Cell = { column: 3, row: 2 }
const C4: Cell = { column: 2, row: 3 }
const B4: Cell = { column: 1, row: 3 }
const C3: Cell = { column: 2, row: 2 }
const D1: Cell = { column: 3, row: 0 }

const ARMY: BuildItem = { kind: 'army' }
const SCOUT: BuildItem = { kind: 'scout' }

function put(state: GameState, playerId: string, assetId: string, cell: Cell): GameState {
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`no asset ${assetId}`)
  return unwrap(
    placePiece(state, {
      playerId,
      assetId,
      x: cell.column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2,
      y: mapTop(state.board) + cell.row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2,
      rotation: 0,
    }),
  )
}

function game(): GameState {
  const colors: Record<string, string> = { [CASH1981]: 'Red', [KARANDRAS1]: 'Blue', [ITCHI]: 'Green', [CHUL]: 'Yellow' }
  const state = firstCivGame()
  const slot = state.board.slots[0]
  if (slot === undefined) throw new Error('board has no slots')
  const [x, y] = slotOrigin(state.board, slot)
  const withTile = unwrap(placePiece(state, { playerId: CASH1981, assetId: 'tiles/america', x, y }))
  return {
    ...withTile,
    players: withTile.players.map((p) => ({
      ...p,
      color: colors[p.playerId] ?? p.color,
      government: p.playerId === CASH1981 ? 'Monarchy' : p.government,
    })),
  }
}

/** Reveals the techs, or only chooses them when `hidden`. */
function learn(state: GameState, techs: readonly string[], hidden = false): GameState {
  return techs.reduce((next, techName) => {
    const chosen = unwrap(chooseTech(next, { playerId: CASH1981, techName }))
    return hidden ? chosen : unwrap(revealTech(chosen, { playerId: CASH1981, techName }))
  }, state)
}

interface SceneOptions {
  readonly techs?: readonly string[]
  readonly hiddenTechs?: readonly string[]
  /** A red city on D4 with a Shipyard on C4. */
  readonly d4?: boolean
  /** A red city on A4 with no Shipyard. */
  readonly a4?: boolean
  /** Put the Shipyard on D3 instead of C4. */
  readonly dockOn?: Cell
}

/** City Management open with the building city (B2) first on the board. */
function scene(options: SceneOptions = {}): GameState {
  let state = put(game(), CASH1981, 'cities/redcity2', { column: 1, row: 1 })
  if (options.d4 !== false) {
    state = put(state, CASH1981, 'cities/redcity2', { column: 3, row: 3 })
    state = put(state, CASH1981, SHIPYARD, options.dockOn ?? C4)
  }
  if (options.a4 === true) state = put(state, CASH1981, 'cities/redcity2', { column: 0, row: 3 })
  state = learn(learn(state, options.techs ?? ['Navy']), options.hiddenTechs ?? [], true)
  return unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))
}

const me = (state: GameState): Playerhand => {
  const found = findPlayer(state, CASH1981)
  if (found === undefined) throw new Error('no player')
  return found
}

const buildingCity = (state: GameState): BoardPiece => {
  const city = state.board.pieces.find((piece) => piece.category === 'city')
  if (city === undefined) throw new Error('no city')
  return city
}

const choiceOf = (state: GameState, item: BuildItem): BuildChoice | undefined =>
  buildOptionsOf(state, me(state))[0]?.choices.find((choice) => choice.item.kind === item.kind)

const labels = (state: GameState, item: BuildItem = ARMY): readonly string[] =>
  (choiceOf(state, item)?.squares ?? []).map((square) => square.label)

const refusalOf = (state: GameState, at: Cell, item: BuildItem = ARMY): string | undefined =>
  buildSquareRefusal(state, me(state), buildingCity(state).id, item as never, at)

function tryBuild(state: GameState, at: Cell, requestId = 'req-1') {
  const payload: BuildPayload = { cityPieceId: buildingCity(state).id, item: { kind: 'army' }, target: at }
  return performAssistedAction(state, { playerId: CASH1981, action: 'build', requestId, at: AT, payload })
}

const armiesOf = (state: GameState): readonly BoardPiece[] =>
  state.board.pieces.filter((piece) => piece.assetId === 'figures/redarmy')

describe('Navy: the squares of an army', () => {
  it('without Navy the army goes only in the outskirts of the building city', () => {
    const state = scene({ techs: [] })
    expect(labels(state)).toEqual(['A1', 'B1', 'A2', 'C2', 'A3', 'B3', 'C3'])
    expect(refusalOf(state, D3)).toBe('D3 is not in the outskirts of that city.')
  })

  it('a chosen but unrevealed Navy changes nothing', () => {
    const state = scene({ techs: [], hiddenTechs: ['Navy'] })
    expect(labels(state)).not.toContain('D3')
    expect(refusalOf(state, D3)).toBe('D3 is not in the outskirts of that city.')
  })

  it('with Navy revealed the outskirts of another own city with a Shipyard are added, in reading order', () => {
    const state = scene()
    expect(labels(state)).toEqual(['A1', 'B1', 'A2', 'C2', 'A3', 'B3', 'C3', 'D3'])
    expect(refusalOf(state, D3)).toBeUndefined()
  })

  it('the Shipyard need not stand on the square: anywhere in that city\'s outskirts', () => {
    expect(labels(scene({ dockOn: D3 }))).toContain('D3')
    expect(labels(scene({ dockOn: C4 }))).toContain('D3')
  })

  it('a city of the player without a Shipyard adds nothing', () => {
    const state = scene({ a4: true })
    expect(labels(state)).not.toContain('B4')
    expect(refusalOf(state, B4)).toBe('B4 is not in the outskirts of that city or of one of your cities with a Shipyard.')
    // With a Shipyard in that city its outskirts count
    expect(labels(put(state, CASH1981, SHIPYARD, B4))).toContain('B4')
  })

  it('a city without a Shipyard adds nothing even when another city has one', () => {
    const state = scene({ d4: false, a4: true })
    expect(labels(state)).toEqual(['A1', 'B1', 'A2', 'C2', 'A3', 'B3', 'C3'])
  })

  it('another player\'s city or Shipyard does not count', () => {
    let state = put(game(), CASH1981, 'cities/redcity2', { column: 1, row: 1 })
    state = put(state, KARANDRAS1, 'cities/bluecity2', { column: 3, row: 3 })
    state = put(state, KARANDRAS1, SHIPYARD, C4)
    state = unwrap(markPhasesDone(learn(state, ['Navy']), { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))
    expect(labels(state)).not.toContain('D3')
    expect(refusalOf(state, D3)).toContain('not in the outskirts')
  })

  it('the building city\'s own Shipyard adds nothing: its own outskirts are the same squares', () => {
    const state = put(scene({ d4: false }), CASH1981, SHIPYARD, { column: 2, row: 0 })
    expect(labels(state)).toEqual(['A1', 'B1', 'A2', 'C2', 'A3', 'B3', 'C3'])
  })

  it('a water square in a Shipyard city\'s outskirts needs Sailing, Steam Power or Flight', () => {
    const without = scene()
    expect(labels(without)).not.toContain('C4')
    expect(refusalOf(without, C4)).toBe('C4 is water, and a figure may stand in water only with a revealed Sailing, Steam Power or Flight.')
    for (const tech of ['Sailing', 'Steam Power', 'Flight']) {
      const withWater = scene({ techs: ['Navy', tech] })
      expect(labels(withWater), tech).toContain('C4')
      expect(refusalOf(withWater, C4), tech).toBeUndefined()
    }
    // A water tech that is only chosen does not open it
    expect(labels(scene({ hiddenTechs: ['Sailing'] }))).not.toContain('C4')
  })

  it('the army rules apply: the stacking limit, a city centre, a hut', () => {
    const crowded = put(put(scene(), CASH1981, 'figures/redarmy', D3), CASH1981, 'figures/redarmy', D3)
    expect(labels(crowded)).not.toContain('D3')
    expect(refusalOf(crowded, D3)).toBe('D3 already holds 2 of your figures, which is your stacking limit of 2.')
    const hut = put(scene(), KARANDRAS1, 'resources/hut', D3)
    expect(labels(hut)).not.toContain('D3')
    expect(refusalOf(hut, D3)).toContain('D3 has a hut marker')
  })

  it('an enemy figure on a square of the Shipyard city is allowed with a note, but not on the Shipyard itself (ruling 189)', () => {
    const base = scene({ techs: ['Navy', 'Sailing'], dockOn: C4 })
    const onSquare = put(base, KARANDRAS1, 'figures/bluearmy', D3)
    const square = choiceOf(onSquare, ARMY)?.squares.find((candidate) => candidate.label === 'D3')
    expect(square?.note).toContain('An enemy figure stands here')
    const onDock = put(base, KARANDRAS1, 'figures/bluescout', C4)
    expect(labels(onDock)).not.toContain('C4')
    expect(refusalOf(onDock, C4)).toBe('C4 holds the Shipyard and an enemy figure stands on it, so an army cannot be placed there.')
    // Without an enemy there the Shipyard square is fine
    expect(labels(base)).toContain('C4')
  })

  it('a square the building city can use on its own is not refused for the Shipyard rule', () => {
    // Shipyard on C3, which is in the outskirts of B2 as well as of D4, with an enemy on it
    const state = put(put(scene({ dockOn: C3 }), KARANDRAS1, 'figures/bluearmy', C3), KARANDRAS1, 'figures/bluearmy', D3)
    expect(labels(state)).toContain('C3')
    expect(labels(state)).toContain('D3')
  })

  it('a held city-state of a capital with a Shipyard is a square for another city (rulings 39 and 188)', () => {
    let state = put(game(), CASH1981, 'cities/redcity2', { column: 1, row: 1 })
    state = put(state, CASH1981, 'cities/redcapital2', { column: 3, row: 3 })
    state = put(state, CASH1981, SHIPYARD, C4)
    state = put(put(state, KARANDRAS1, 'city-states/cs1', D1), CASH1981, 'figures/redarmy', D1)
    const open = (techs: readonly string[]): GameState =>
      unwrap(markPhasesDone(learn(state, techs), { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))
    expect(labels(open(['Navy']))).toContain('D1')
    expect(refusalOf(open(['Navy']), D1)).toBeUndefined()
    expect(labels(open([]))).not.toContain('D1')
    // Not held by the player: not a square
    const unheld = unwrap(markPhasesDone(learn(put(put(game(), CASH1981, 'cities/redcity2', { column: 1, row: 1 }), KARANDRAS1, 'city-states/cs1', D1), ['Navy']), { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))
    expect(labels(unheld)).not.toContain('D1')
  })

  it('a scout and the other items are unchanged', () => {
    const state = scene({ techs: ['Navy', 'Sailing'] })
    const withTrade: GameState = {
      ...state,
      players: state.players.map((p) => (p.playerId === CASH1981 ? { ...p, stats: { ...p.stats, trade: 3 } } : p)),
    }
    expect(labels(withTrade, SCOUT)).toEqual(['A1', 'B1', 'C1', 'A2', 'C2', 'A3', 'B3', 'C3'])
    expect(refusalOf(withTrade, D3, SCOUT)).toBe('D3 is not in the outskirts of that city.')
    expect(refusalOf(withTrade, C4, SCOUT)).toBe('C4 is not in the outskirts of that city.')
    // The Shipyard building itself goes in the building city's outskirts only (it is not an army)
    const dock = buildOptionsOf(state, me(state))[0]?.choices.find((choice) => choice.item.kind === 'building' && choice.item.assetId === SHIPYARD)
    expect((dock?.squares ?? []).map((square) => square.label)).not.toContain('D3')
  })
})

describe('Navy: building the army', () => {
  it('builds in the Shipyard city\'s outskirts, paid and logged by the building city', () => {
    const before = scene()
    const done = unwrap(tryBuild(before, D3))
    const army = armiesOf(done)
    expect(army).toHaveLength(1)
    expect(mapCellOf(done.board, army[0] as BoardPiece)).toEqual(D3)
    expect(done.log.at(-1)?.publicLog).toBe('cash1981 built an army in City B2 on square D3')
    expect(done.assistedActions).toHaveLength(1)
  })

  it('refuses a square outside both sets and says why', () => {
    const message = describeError(unwrapErr(tryBuild(scene({ techs: [] }), D3)))
    expect(message).toContain('D3 is not in the outskirts of that city.')
    const withNavy = describeError(unwrapErr(tryBuild(scene(), B4)))
    expect(withNavy).toContain('B4 is not in the outskirts of that city or of one of your cities with a Shipyard.')
    const water = describeError(unwrapErr(tryBuild(scene(), C4)))
    expect(water).toContain('C4 is water')
  })

  it('one vote undo removes the army again', () => {
    const done = unwrap(tryBuild(scene(), D3))
    const logId = done.log.find((entry) => entry.assistedActionId === 'req-1')?.id ?? ''
    let next = unwrap(initiateUndo(done, { logId, playerId: CASH1981 }))
    for (const playerId of [KARANDRAS1, ITCHI, CHUL]) next = unwrap(vote(next, { logId, playerId, vote: true, at: AT }))
    expect(armiesOf(next)).toEqual([])
    expect(next.assistedActions[0]?.status).toBe('undone')
  })
})

describe('Navy: hidden information', () => {
  it('a chosen Navy changes no square and nothing in another viewer\'s projection', () => {
    const hidden = scene({ techs: [], hiddenTechs: ['Navy'] })
    const plain = scene({ techs: [] })
    expect(buildOptionsOf(hidden, me(hidden)).map((city) => city.choices.filter((choice) => choice.item.kind === 'army'))).toEqual(
      buildOptionsOf(plain, me(plain)).map((city) => city.choices.filter((choice) => choice.item.kind === 'army')),
    )
    // The squares are in the owner's projection only: no opponent or spectator sees options or squares
    expect(toPlayerView(hidden, CASH1981).you?.buildOptions[0]?.choices.find((choice) => choice.item.kind === 'army')?.squares.map((square) => square.label)).not.toContain('D3')
    const revealed = scene()
    for (const state of [hidden, revealed]) {
      for (const viewerId of [KARANDRAS1, ITCHI, CHUL, 'spectator']) {
        const view = toPlayerView(state, viewerId)
        const json = JSON.stringify(view)
        expect(json, viewerId).not.toContain('"choices"')
        expect(json, viewerId).not.toContain('"squares"')
        expect(view.you?.buildOptions ?? [], viewerId).toEqual([])
      }
    }
  })
})
