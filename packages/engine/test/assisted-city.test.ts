/**
 * Founding a city from a scout and sending a scout's square to a city (assisted play,
 * part 13). The rules are the base rulebook p. 13 and 26 to 27 with the W&W and F&F
 * additions, summarised in `docs/agents/tasks/assisted-sot.md`.
 *
 * Every test uses the America tile in the first map slot, printed as (row by row):
 *
 *   row 0: mountain  mountain  water      grassland        A1 B1 C1 D1
 *   row 1: forest    mountain  grassland  water            A2 B2 C2 D2
 *   row 2: desert    desert    mountain   forest           A3 B3 C3 D3
 *   row 3: water     desert    water      forest           A4 B4 C4 D4
 *
 * Only B2, C2, B3 and C3 have eight revealed squares around them, so those are the
 * squares a city can be founded on.
 */

import { describe, expect, it } from 'vitest'

import { movePiece, undoLastBoardChange } from '../src/actions/board.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { assistedAvailability, performAssistedAction } from '../src/assisted.js'
import { mapCellOf } from '../src/blockade.js'
import { SQUARE_SIZE } from '../src/board.js'
import { foundCityCheck } from '../src/city-founding.js'
import { scoutViewsOf } from '../src/assisted-city.js'
import { cityActionsOf } from '../src/city-actions.js'
import { cityProductionsOf } from '../src/city-production.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { scoutAssignmentsOf } from '../src/sot.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { AssistedActionKind, GameState } from '../src/state.js'
import { toPlayerView } from '../src/state.js'

import { AT, me, put, sotTurn, withAmerica } from './sot-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1 } from './fixture.js'

const OTHERS = [KARANDRAS1, ITCHI, CHUL]

const B2 = { column: 1, row: 1 }

/** Cash on the America tile with a scout on B2. */
function withScout(options: Parameters<typeof sotTurn>[0] = {}, cell = B2): GameState {
  return put(withAmerica(sotTurn(options)), CASH1981, 'figures/redscout', cell.column, cell.row)
}

const scoutOf = (state: GameState, playerId = CASH1981) => {
  const colour = me(state, playerId).color?.toLowerCase()
  const piece = state.board.pieces.find((candidate) => candidate.assetId === `figures/${colour}scout`)
  if (piece === undefined) throw new Error('no scout')
  return piece
}

const check = (state: GameState) => foundCityCheck(state, me(state), scoutOf(state))

const found = (state: GameState, figurePieceId: string, requestId = 'req-1', playerId = CASH1981) =>
  performAssistedAction(state, {
    playerId,
    action: 'foundCity',
    requestId,
    at: AT,
    payload: { figurePieceId },
  })

const assign = (state: GameState, scoutPieceId: string, cityPieceId: string | null, requestId = 'req-1') =>
  performAssistedAction(state, {
    playerId: CASH1981,
    action: 'assignScout' as AssistedActionKind,
    requestId,
    at: AT,
    payload: { scoutPieceId, cityPieceId },
  })

const reasonOf = (result: ReturnType<typeof found>): string => {
  const error = unwrapErr(result)
  if (error.kind !== 'ASSISTED_ACTION_REJECTED') throw new Error(`unexpected error ${error.kind}`)
  return error.reason
}

function undoByVote(state: GameState, requestId: string): GameState {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line for the action')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of OTHERS) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  return next
}

const cityAt = (state: GameState, column: number, row: number) =>
  state.board.pieces.find((piece) => {
    const cell = piece.category === 'city' ? mapCellOf(state.board, piece) : null
    return cell !== null && cell.column === column && cell.row === row
  })

// ---------------------------------------------------------------------------

describe('where a city can be founded', () => {
  it('accepts a scout on a square with eight revealed squares around it and nothing in the way', () => {
    const result = check(withScout())
    expect(result.ok).toBe(true)
    expect(result.square).toBe('B2')
    expect(result.reasons).toEqual([])
  })

  it('refuses the edge of the map and a water square, and says both', () => {
    const edge = check(withScout({}, { column: 0, row: 0 }))
    expect(edge.ok).toBe(false)
    expect(edge.reasons).toContain('A1 is at the edge of the map or next to a facedown tile: a city needs eight revealed squares around it.')
    const water = check(withScout({}, { column: 2, row: 0 }))
    expect(water.reasons).toContain('C1 is a water square.')
  })

  it('refuses a square next to a facedown tile', () => {
    // C3 has its eight neighbours on the tile, but D3 is next to the edge of it
    const result = check(withScout({}, { column: 3, row: 2 }))
    expect(result.ok).toBe(false)
    expect(result.reasons[0]).toContain('is at the edge of the map or next to a facedown tile')
  })

  it('refuses a hut or a village next to the square, naming where', () => {
    const hut = check(put(withScout(), CASH1981, 'resources/hut', 2, 1))
    expect(hut.reasons).toEqual(['A hut is next to B2 (C2). Take it first.'])
    const village = check(put(withScout(), CASH1981, 'resources/village', 1, 2))
    expect(village.reasons).toEqual(['A village is next to B2 (B3). Take it first.'])
  })

  it('lets the Zulu build next to a hut, and names the hut they may explore, but not next to a village', () => {
    const state = put(withScout({ civ: 'Zulu' }), CASH1981, 'resources/hut', 2, 1)
    const hut = check(state)
    expect(hut.ok).toBe(true)
    expect(hut.zuluHuts).toEqual(['C2'])
    const village = check(put(withScout({ civ: 'Zulu' }), CASH1981, 'resources/village', 1, 2))
    expect(village.ok).toBe(false)
    // Nobody else gets the exception
    expect(check(put(withScout({ civ: 'Romans' }), CASH1981, 'resources/hut', 2, 1)).ok).toBe(false)
  })

  it('refuses an enemy figure next to the square, but not a friendly one, in the square or beside it', () => {
    const enemy = check(put(withScout(), KARANDRAS1, 'figures/bluearmy', 2, 1))
    expect(enemy.reasons).toEqual(['An enemy figure is next to B2 (C2).'])
    const friendly = put(put(withScout(), CASH1981, 'figures/redarmy', 2, 1), CASH1981, 'figures/redarmy', 1, 1)
    expect(check(friendly).ok).toBe(true)
  })

  it('refuses a square less than three squares from any city, whoever owns it, diagonals included', () => {
    const near = check(put(withScout(), KARANDRAS1, 'cities/bluecity2', 3, 3))
    expect(near.reasons).toEqual(['B2 is less than three squares from the city at D4.'])
    const own = check(put(withScout(), CASH1981, 'cities/redcapital2', 1, 3))
    expect(own.reasons[0]).toContain('less than three squares from the city at B4')
  })

  it('allows a city three squares from the nearest one', () => {
    // A city at E5 (4, 4): the distance to B2 is 3 on both axes
    expect(check(put(withScout(), KARANDRAS1, 'cities/bluecity2', 4, 4)).ok).toBe(true)
  })

  it('counts both squares of a metropolis', () => {
    // Anchored on E2 it also holds D2, which is 2 squares from B2: only the second square is too near
    const near = put(withScout(), KARANDRAS1, 'cities/bluemetropolis2', 4, 1)
    expect(check(near).ok).toBe(false)
    // Anchored on F2 it holds E2 and F2, both 3 or more away
    const far = put(withScout(), KARANDRAS1, 'cities/bluemetropolis2', 5, 1)
    expect(check(far).ok).toBe(true)
  })

  it('refuses a third city before Irrigation, and allows it with Irrigation revealed', () => {
    let state = withScout()
    state = put(state, CASH1981, 'cities/redcapital2', 8, 8)
    state = put(state, CASH1981, 'cities/redcity2', 8, 12)
    expect(check(state).reasons).toEqual(['You have 2 cities, the most you can have without Irrigation.'])
    const irrigated = put(put(withScout({ techs: ['Irrigation'] }), CASH1981, 'cities/redcapital2', 8, 8), CASH1981, 'cities/redcity2', 8, 12)
    expect(check(irrigated).ok).toBe(true)
    const fourth = put(irrigated, CASH1981, 'cities/redcity2', 12, 8)
    expect(check(fourth).reasons).toEqual(['You have 3 cities, the most you can have.'])
  })

  it('refuses a square next to a relic or a city-state, and one with a building on it', () => {
    expect(check(put(withScout(), CASH1981, 'relics/atlantis', 2, 1)).reasons).toEqual([
      'A relic is next to B2. No city may be built next to a relic.',
    ])
    expect(check(put(withScout(), CASH1981, 'city-states/cs1', 2, 1)).reasons).toEqual([
      'A city-state is next to B2. No city may be built next to a city-state.',
    ])
    expect(check(put(withScout(), CASH1981, 'buildings/library', 1, 1)).reasons).toEqual([
      'A building, wonder or great person stands on B2. Clear it first.',
    ])
  })

  it('lists every reason at once', () => {
    let state = put(withScout({}, { column: 0, row: 0 }), CASH1981, 'resources/hut', 1, 0)
    state = put(state, KARANDRAS1, 'figures/bluescout', 1, 1)
    expect(check(state).reasons.length).toBeGreaterThanOrEqual(3)
  })
})

describe('founding a city', () => {
  it('replaces the scout with a city marker on the square, and says so in the log', () => {
    const state = withScout()
    const scout = scoutOf(state)
    const result = unwrap(found(state, scout.id))
    expect(result.board.pieces.some((piece) => piece.id === scout.id)).toBe(false)
    const city = cityAt(result, 1, 1)
    expect(city?.assetId).toBe('cities/redcity2')
    expect(result.log.at(-1)?.publicLog).toBe(
      'cash1981 founded a city on B2 with a scout, and may now adopt another social policy',
    )
    expect(result.assistedActions[0]).toMatchObject({ kind: 'foundCity', phase: 'SOT', usageKey: null, status: 'applied' })
    // The city counts and the supply is used
    expect(toPlayerView(result, CASH1981).you?.cityCount).toBe(1)
  })

  it('adds the policy note only while the player has fewer policies than cities', () => {
    const state = withScout({ policies: ['Pacifism'] })
    const result = unwrap(found(state, scoutOf(state).id))
    // One policy and one city: nothing more to adopt
    expect(result.log.at(-1)?.publicLog).toBe('cash1981 founded a city on B2 with a scout')
    // A second city with one policy: another can be adopted
    const first = put(withAmerica(sotTurn({ policies: ['Pacifism'], techs: ['Irrigation'] })), CASH1981, 'cities/redcapital2', 8, 8)
    const withFigure = put(first, CASH1981, 'figures/redscout', 1, 1)
    const second = unwrap(found(withFigure, scoutOf(withFigure).id))
    expect(second.log.at(-1)?.publicLog).toBe('cash1981 founded a city on B2 with a scout, and may now adopt another social policy')
  })

  it('needs Start of Turn to be open', () => {
    const state = unwrap(markPhasesDone(withScout(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'SOT' }))
    expect(assistedAvailability(state, CASH1981, 'foundCity').status).toBe('wrong-phase')
    expect(reasonOf(found(state, scoutOf(state).id))).toBe('Only available during your open Start of Turn phase.')
  })

  it('refuses a figure that is not the player’s own scout, and a request without a figure', () => {
    const state = put(withScout(), KARANDRAS1, 'figures/bluescout', 1, 2)
    const blue = scoutOf(state, KARANDRAS1)
    expect(reasonOf(found(state, blue.id))).toBe('That figure is not yours, or it is not on the map.')
    expect(reasonOf(found(state, 'nothing'))).toBe('That figure is not yours, or it is not on the map.')
    const empty = performAssistedAction(state, { playerId: CASH1981, action: 'foundCity', requestId: 'req-2' })
    expect(reasonOf(empty)).toBe('Choose the scout that stands where the city goes.')
  })

  it('refuses where the rules refuse, with the reasons', () => {
    const state = put(withScout(), KARANDRAS1, 'figures/bluearmy', 2, 1)
    expect(reasonOf(found(state, scoutOf(state).id))).toBe('An enemy figure is next to B2 (C2).')
    expect(state.board.pieces.some((piece) => piece.category === 'city')).toBe(false)
  })

  it('lets an army found a city under the Republic only', () => {
    const base = put(withAmerica(sotTurn({ techs: ['Code of Laws'], government: 'Republic' })), CASH1981, 'figures/redarmy', 1, 1)
    const army = base.board.pieces.find((piece) => piece.assetId === 'figures/redarmy')
    if (army === undefined) throw new Error('no army')
    const republic = unwrap(found(base, army.id))
    expect(republic.log.at(-1)?.publicLog).toContain('founded a city on B2 with an army')
    const despotic = put(withAmerica(sotTurn()), CASH1981, 'figures/redarmy', 1, 1)
    const piece = despotic.board.pieces.find((candidate) => candidate.assetId === 'figures/redarmy')
    expect(reasonOf(found(despotic, piece?.id ?? ''))).toBe('You have no scout on the map to found a city with.')
  })

  it('destroys a city-state on the square for 3 culture, and an undo stands it up again', () => {
    const state = put(withScout({ culture: 4 }), CASH1981, 'city-states/cs2', 1, 1)
    const result = unwrap(found(state, scoutOf(state).id))
    expect(result.board.pieces.some((piece) => piece.category === 'citystate')).toBe(false)
    expect(me(result).stats.culture).toBe(7)
    expect(result.log.at(-1)?.publicLog).toContain('destroying the city-state there (+3 culture)')
    const undone = undoByVote(result, 'req-1')
    expect(undone.board.pieces.some((piece) => piece.category === 'citystate')).toBe(true)
    expect(me(undone).stats.culture).toBe(4)
    expect(cityAt(undone, 1, 1)).toBeUndefined()
  })

  it('names the huts a Zulu city is next to', () => {
    const state = put(withScout({ civ: 'Zulu' }), CASH1981, 'resources/hut', 2, 1)
    const result = unwrap(found(state, scoutOf(state).id))
    expect(result.log.at(-1)?.publicLog).toContain('next to a hut they may explore (C2)')
  })

  it('gives the Romans a free advance on the culture track, and nobody else', () => {
    const roman = withScout({ civ: 'Romans', step: 9, culture: 0, trade: 0 })
    const result = unwrap(found(roman, scoutOf(roman).id))
    expect(result.log.some((entry) => entry.publicLog.startsWith('cash1981 advanced for free on the culture track to space 10'))).toBe(true)
    expect(me(result).stats.culture).toBe(0)
    const record = result.assistedActions[0]
    if (record === undefined || record.effect.kind !== 'foundCity') throw new Error('no record')
    expect(record.effect.advance).toMatchObject({ kind: 'cultureAdvance', fromStep: 9, toStep: 10 })
    // The line of the advance cannot be undone by itself
    expect(result.log.filter((entry) => entry.assistedActionId === 'req-1')).toHaveLength(1)

    const japanese = withScout({ civ: 'Japanese', step: 9 })
    const plain = unwrap(found(japanese, scoutOf(japanese).id))
    expect(plain.assistedActions[0]?.effect).toMatchObject({ kind: 'foundCity', advance: null })
  })

  it('does not stop a Roman at the end of the track', () => {
    const roman = withScout({ civ: 'Romans', step: 21 })
    const result = unwrap(found(roman, scoutOf(roman).id))
    expect(result.assistedActions[0]?.effect).toMatchObject({ kind: 'foundCity', advance: null })
  })

  it('takes the city back on undo: the scout stands again, the Roman marker moves back, and the line stays', () => {
    const roman = withScout({ civ: 'Romans', step: 9 })
    const scout = scoutOf(roman)
    const result = unwrap(found(roman, scout.id))
    const undone = undoByVote(result, 'req-1')
    expect(cityAt(undone, 1, 1)).toBeUndefined()
    const back = undone.board.pieces.find((piece) => piece.id === scout.id)
    expect(back).toMatchObject({ x: scout.x, y: scout.y })
    expect(undone.log.some((entry) => entry.publicLog.includes('founded a city on B2'))).toBe(true)
    expect(undone.log.at(-1)?.publicLog).toBe(
      "System: cash1981's city on B2 was undone: the scout is back, and the free advance was taken back",
    )
    const marker = undone.board.pieces.find((piece) => piece.assetId.startsWith('leaders/'))
    const before = roman.board.pieces.find((piece) => piece.assetId.startsWith('leaders/'))
    expect(marker?.x).toBe(before?.x)
    // And it can be founded again
    expect(unwrap(found(undone, scout.id, 'req-2')).assistedActions.at(-1)?.status).toBe('applied')
  })

  it('leaves the city, the scout and a Roman advance to the undo vote: the board’s own Undo refuses', () => {
    const state = withScout({ civ: 'Romans', step: 9 })
    const result = unwrap(found(state, scoutOf(state).id))
    // The marker's move, the city and the scout's removal were each recorded in the board history
    let walked = result
    for (let count = 0; count < 3; count += 1) {
      expect(unwrapErr(undoLastBoardChange(walked, CASH1981)).kind).toBe('BOARD_UNDO_ASSISTED')
      // Nothing can be taken back one by one: peel an entry off to look at the one before it
      walked = { ...walked, board: { ...walked.board, history: walked.board.history.slice(0, -1) } }
    }
  })

  it('refuses the undo once the city was used, and when the culture of its city-state is spent', () => {
    const base = withScout({ culture: 4 })
    const state = put(base, CASH1981, 'city-states/cs2', 1, 1)
    const result = unwrap(found(state, scoutOf(state).id))
    const city = cityAt(result, 1, 1)
    if (city === undefined) throw new Error('no city')
    const refusal = (from: GameState): string => {
      const entry = from.log.find((candidate) => candidate.assistedActionId === 'req-1')
      if (entry === undefined) throw new Error('no line')
      let next = unwrap(initiateUndo(from, { logId: entry.id, playerId: CASH1981 }))
      next = unwrap(vote(next, { logId: entry.id, playerId: KARANDRAS1, vote: true, at: AT }))
      next = unwrap(vote(next, { logId: entry.id, playerId: ITCHI, vote: true, at: AT }))
      const error = unwrapErr(vote(next, { logId: entry.id, playerId: CHUL, vote: true, at: AT }))
      if (error.kind !== 'ASSISTED_UNDO_BLOCKED') throw new Error(`unexpected error ${error.kind}`)
      return error.reason
    }
    // The 3 culture of the city-state was spent
    const spent: GameState = {
      ...result,
      players: result.players.map((player) =>
        player.playerId === CASH1981 ? { ...player, stats: { ...player.stats, culture: 2 } } : player,
      ),
    }
    expect(refusal(spent)).toMatch(/Only 2 culture is left, so the 3 culture from the city-state on B2 cannot be taken back/)
    // A later action of the city
    const devoted: GameState = {
      ...result,
      assistedActions: [
        ...result.assistedActions,
        {
          id: 'later',
          kind: 'devoteToTheArts',
          playerId: CASH1981,
          turnNumber: result.assistedActions[0]?.turnNumber ?? 1,
          phase: 'CM',
          usageKey: null,
          at: null,
          logId: 'none',
          status: 'applied',
          effect: { kind: 'devoteToTheArts', cityPieceId: city.id, cityLabel: 'City B2', culture: 1 },
        },
      ],
    }
    expect(refusal(devoted)).toBe('The city on B2 was used after it was founded (devoteToTheArts). Undo that first.')
  })

  it('refuses a second Roman city while the card choice of the first free advance is waiting, and says so in the view', () => {
    const roman = withScout({ civ: 'Romans', step: 9, techs: ['Mysticism'] })
    const first = unwrap(found(roman, scoutOf(roman).id))
    expect(me(first).pendingRewards).toHaveLength(1)
    // A scout on the same square again (the city taken off by hand), with the first advance's choice still waiting
    const city = cityAt(first, 1, 1)
    const cleared: GameState = { ...first, board: { ...first.board, pieces: first.board.pieces.filter((piece) => piece.id !== city?.id) } }
    const second = put(cleared, CASH1981, 'figures/redscout', 1, 1)
    const scout = scoutOf(second)
    expect(reasonOf(found(second, scout.id, 'req-2'))).toMatch(/advance one space for free with every city, and that is stopped now/)
    const view = scoutViewsOf(second, me(second)).find((entry) => entry.pieceId === scout.id)
    expect(view?.found.ok).toBe(false)
    expect(view?.found.reasons.join(' ')).toMatch(/advance one space for free with every city, and that is stopped now/)
  })

  it('refuses the undo when the city has been moved', () => {
    const state = withScout()
    const result = unwrap(found(state, scoutOf(state).id))
    const city = cityAt(result, 1, 1)
    if (city === undefined) throw new Error('no city')
    const moved = unwrap(movePiece(result, { playerId: CASH1981, pieceId: city.id, x: city.x + SQUARE_SIZE * 5, y: city.y, snap: false }))
    const entry = moved.log.find((candidate) => candidate.assistedActionId === 'req-1')
    if (entry === undefined) throw new Error('no line')
    let next = unwrap(initiateUndo(moved, { logId: entry.id, playerId: CASH1981 }))
    next = unwrap(vote(next, { logId: entry.id, playerId: KARANDRAS1, vote: true, at: AT }))
    next = unwrap(vote(next, { logId: entry.id, playerId: ITCHI, vote: true, at: AT }))
    expect(unwrapErr(vote(next, { logId: entry.id, playerId: CHUL, vote: true, at: AT })).kind).toBe('ASSISTED_UNDO_BLOCKED')
  })

  it('shows the viewer each figure with what stops it, and no other player', () => {
    const state = put(withScout(), KARANDRAS1, 'figures/bluearmy', 2, 1)
    const own = toPlayerView(state, CASH1981).you?.startOfTurn
    expect(own?.scouts).toHaveLength(1)
    expect(own?.scouts[0]).toMatchObject({ square: 'B2', terrain: 'mountain', figure: 'scout', canSend: true })
    expect(own?.scouts[0]?.found.reasons).toEqual(['An enemy figure is next to B2 (C2).'])
    expect(own?.cityLimit).toEqual({ have: 0, max: 2 })
    expect(own?.scoutsNow.status).toBe('ready')
    const closed = unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'SOT' }))
    expect(toPlayerView(closed, CASH1981).you?.startOfTurn?.scoutsNow).toEqual({
      status: 'wrong-phase',
      reason: 'Only available during your open Start of Turn phase.',
    })
    expect(toPlayerView(state, KARANDRAS1).you?.startOfTurn?.scouts).toEqual([])
    expect(JSON.stringify(toPlayerView(state, KARANDRAS1).opponents)).not.toContain('startOfTurn')
  })
})

describe('sending a scout’s square to a city', () => {
  const FOREST_A2 = { column: 0, row: 1 }
  const FOREST_D3 = { column: 3, row: 2 }

  /** A red city on B2 and a second red city far away, with a scout on the given square. */
  function twoCities(scoutCell: { column: number; row: number }): GameState {
    let state = withAmerica(sotTurn({ techs: ['Irrigation'] }))
    state = put(state, CASH1981, 'cities/redcapital2', 1, 1)
    state = put(state, CASH1981, 'cities/redcity2', 8, 8)
    return put(state, CASH1981, 'figures/redscout', scoutCell.column, scoutCell.row)
  }

  const cities = (state: GameState) => cityProductionsOf(state, me(state))
  const near = (state: GameState) => cities(state).find((city) => city.label.endsWith('B2'))
  const far = (state: GameState) => cities(state).find((city) => city.label.endsWith('I9'))

  it('counts the square of a scout that was not sent for the capital', () => {
    const state = twoCities(FOREST_D3)
    const withoutScout: GameState = { ...state, board: { ...state.board, pieces: state.board.pieces.filter((piece) => piece.id !== scoutOf(state).id) } }
    expect(near(state)?.outskirts).toBe((near(withoutScout)?.outskirts ?? 0) + 2)
    expect(near(state)?.outskirtsDetail.find((entry) => entry.square === 'D3')).toMatchObject({
      source: 'forest, sent by your scout',
      amount: 2,
      scout: true,
    })
    expect(far(state)?.outskirts).toBe(0)
    expect(near(state)?.notes.join(' ')).toContain('a scout you did not send counts for your capital')
  })

  it('adds the production of a forest outside the outskirts to the city the scout sends it to', () => {
    const state = twoCities(FOREST_D3)
    const capitalBefore = near(state)?.outskirts ?? 0
    const sent = unwrap(assign(state, scoutOf(state).id, far(state)?.pieceId ?? ''))
    expect(far(sent)?.outskirts).toBe(2)
    expect(far(sent)?.outskirtsDetail.find((entry) => entry.square === 'D3')).toMatchObject({
      source: 'forest, sent by your scout',
      amount: 2,
      scout: true,
    })
    expect(near(sent)?.outskirts).toBe(capitalBefore - 2)
    expect(sent.log.at(-1)?.publicLog).toBe('cash1981 sent the square of the scout on D3 to City I9')
  })

  it('names the capital in the log when a scout is sent to it', () => {
    const state = twoCities(FOREST_D3)
    const sent = unwrap(assign(state, scoutOf(state).id, near(state)?.pieceId ?? ''))
    expect(sent.log.at(-1)?.publicLog).toBe('cash1981 sent the square of the scout on D3 to Capital B2')
    expect(near(sent)?.outskirts).toBe(near(state)?.outskirts)
  })

  it('takes the square away from the city it belongs to when the scout sends it to another city', () => {
    const state = twoCities(FOREST_A2)
    const home = near(state)?.outskirts ?? 0
    expect(far(state)?.outskirts).toBe(0)
    const sent = unwrap(assign(state, scoutOf(state).id, far(state)?.pieceId ?? ''))
    expect(near(sent)?.outskirts).toBe(home - 2)
    expect(near(sent)?.outskirtsDetail.find((entry) => entry.square === 'A2')).toMatchObject({
      source: 'sent by your scout',
      amount: 0,
      sentTo: 'City I9',
    })
    expect(far(sent)?.outskirts).toBe(2)
  })

  it('changes nothing when the scout sends its square to the city it is already in', () => {
    const state = twoCities(FOREST_A2)
    const sent = unwrap(assign(state, scoutOf(state).id, near(state)?.pieceId ?? ''))
    expect(near(sent)?.outskirts).toBe(near(state)?.outskirts)
  })

  it('counts a building on the square the way the building says, and says in the notes what is left out', () => {
    let state = twoCities(FOREST_D3)
    state = put(state, CASH1981, 'buildings/workshop', 3, 2)
    const sent = unwrap(assign(state, scoutOf(state).id, near(state)?.pieceId ?? ''))
    expect(near(sent)?.outskirtsDetail.find((entry) => entry.square === 'D3')?.amount).toBe(3)
    expect(near(sent)?.notes.join(' ')).toContain('its trade and coin icons are not counted')
  })

  describe('and what it gathers in Devote to the Arts and Harvest', () => {
    // The America tile prints wheat on D4, which is outside the outskirts of B2 and of the far city
    const WHEAT_D4 = { column: 3, row: 3 }
    const scoutChoices = (state: GameState, label: string) =>
      cityActionsOf(state, me(state))
        .find((options) => options.label.endsWith(label))
        ?.harvest.choices.filter((choice) => choice.scoutPieceId !== null)
        .map((choice) => choice.resource)

    it('offers a scout that was not sent to the capital only', () => {
      const state = twoCities(WHEAT_D4)
      expect(scoutChoices(state, 'B2')).toEqual(['wheat'])
      expect(scoutChoices(state, 'I9')).toEqual([])
      const notes = (label: string) =>
        cityActionsOf(state, me(state)).find((options) => options.label.endsWith(label))?.harvest.notes.join(' ')
      expect(notes('B2')).toContain('did not send anywhere gathers for your capital and for no other city')
      expect(notes('I9')).not.toContain('did not send anywhere')
    })

    it('offers a scout that was sent to another city to that city only', () => {
      const state = twoCities(WHEAT_D4)
      const sent = unwrap(assign(state, scoutOf(state).id, far(state)?.pieceId ?? ''))
      expect(scoutChoices(sent, 'B2')).toEqual([])
      expect(scoutChoices(sent, 'I9')).toEqual(['wheat'])
      expect(cityActionsOf(sent, me(sent)).find((options) => options.label.endsWith('I9'))?.harvest.notes.join(' ')).toContain(
        'sent to this city in the Start of Turn gathers here and for no other city',
      )
    })

    it('follows the latest choice, and gives the scout back to the capital when the sending stops', () => {
      const state = twoCities(WHEAT_D4)
      const first = unwrap(assign(state, scoutOf(state).id, far(state)?.pieceId ?? ''))
      const second = unwrap(assign(first, scoutOf(first).id, near(first)?.pieceId ?? '', 'req-2'))
      expect(scoutChoices(second, 'B2')).toEqual(['wheat'])
      expect(scoutChoices(second, 'I9')).toEqual([])
      const again = unwrap(assign(second, scoutOf(second).id, far(second)?.pieceId ?? '', 'req-3'))
      expect(scoutChoices(again, 'I9')).toEqual(['wheat'])
      const stopped = unwrap(assign(again, scoutOf(again).id, null, 'req-4'))
      expect(scoutChoices(stopped, 'B2')).toEqual(['wheat'])
      expect(scoutChoices(stopped, 'I9')).toEqual([])
    })

    it('offers a scout to every city when no capital is marked on the map, and says why', () => {
      let state = withAmerica(sotTurn({ techs: ['Irrigation'] }))
      state = put(state, CASH1981, 'cities/redcity2', 1, 1)
      state = put(state, CASH1981, 'cities/redcity2', 8, 8)
      state = put(state, CASH1981, 'figures/redscout', WHEAT_D4.column, WHEAT_D4.row)
      expect(scoutChoices(state, 'B2')).toEqual(['wheat'])
      expect(scoutChoices(state, 'I9')).toEqual(['wheat'])
      expect(cityActionsOf(state, me(state))[0]?.harvest.notes.join(' ')).toContain('Your capital is not marked on the map')
      expect(scoutViewsOf(state, me(state))[0]).toMatchObject({ assignedTo: null, assignedByDefault: false })
    })
  })

  describe('the capital as the default', () => {
    it('shows each scout where it goes, and whether the player chose it', () => {
      const state = twoCities(FOREST_D3)
      const capital = near(state)?.pieceId
      expect(scoutViewsOf(state, me(state))[0]).toMatchObject({ assignedTo: capital, assignedByDefault: true })
      const sent = unwrap(assign(state, scoutOf(state).id, far(state)?.pieceId ?? ''))
      expect(scoutViewsOf(sent, me(sent))[0]).toMatchObject({ assignedTo: far(sent)?.pieceId, assignedByDefault: false })
      const chosen = unwrap(assign(state, scoutOf(state).id, capital ?? ''))
      expect(scoutViewsOf(chosen, me(chosen))[0]).toMatchObject({ assignedTo: capital, assignedByDefault: false })
    })

    it('sends the scout back to the capital when the choice is undone', () => {
      const state = twoCities(FOREST_D3)
      const sent = unwrap(assign(state, scoutOf(state).id, far(state)?.pieceId ?? ''))
      const undone = undoByVote(sent, 'req-1')
      expect(scoutViewsOf(undone, me(undone))[0]).toMatchObject({ assignedTo: near(undone)?.pieceId, assignedByDefault: true })
      expect(near(undone)?.outskirts).toBe(near(state)?.outskirts)
    })

    it('takes a square a scout stands on from the other city it lies next to, in the gathering as in the production', () => {
      // D4 holds wheat. It lies in the outskirts of a second city on E5, and the scout there goes to the capital on B2
      let state = withAmerica(sotTurn({ techs: ['Irrigation'] }))
      state = put(state, CASH1981, 'cities/redcapital2', 1, 1)
      state = put(state, CASH1981, 'cities/redcity2', 4, 4)
      state = put(state, CASH1981, 'figures/redscout', 3, 3)
      const harvest = (from: GameState, label: string) =>
        cityActionsOf(from, me(from)).find((options) => options.label.endsWith(label))?.harvest
      const wheat = (from: GameState, label: string) =>
        harvest(from, label)?.choices.filter((choice) => choice.resource === 'wheat').map((choice) => choice.scoutPieceId !== null)
      expect(wheat(state, 'B2')).toEqual([true])
      expect(wheat(state, 'E5')).toEqual([])
      expect(harvest(state, 'E5')?.notes.join(' ')).toContain('D4 is sent to another city by a scout and gives nothing here.')
      const own = cities(state).find((city) => city.label.endsWith('E5'))
      expect(own?.outskirtsDetail.find((entry) => entry.square === 'D4')).toMatchObject({ amount: 0, sentTo: 'Capital B2' })
      // Sent to the city next to it, the square stays where it is
      const sent = unwrap(assign(state, scoutOf(state).id, cities(state).find((city) => city.label.endsWith('E5'))?.pieceId ?? ''))
      expect(wheat(sent, 'E5')).toEqual([false])
      expect(wheat(sent, 'B2')).toEqual([])
    })

    it('gives nothing for a scout on a city centre, and counts a square once for two scouts', () => {
      const base = twoCities(FOREST_D3)
      const capital = near(base)?.outskirts ?? 0
      // A second scout on the same forest adds nothing
      const twin = put(base, CASH1981, 'figures/redscout', FOREST_D3.column, FOREST_D3.row)
      expect(near(twin)?.outskirts).toBe(capital)
      // A scout on the capital's own centre square sends nothing
      const centre = put(withAmerica(sotTurn({ techs: ['Irrigation'] })), CASH1981, 'cities/redcapital2', 1, 1)
      const onCentre = put(centre, CASH1981, 'figures/redscout', 1, 1)
      expect(near(onCentre)?.outskirts).toBe(near(centre)?.outskirts)
      expect(scoutViewsOf(onCentre, me(onCentre))[0]).toMatchObject({ assignedTo: null })
    })

    it('has no capital when its marker is not on the map', () => {
      let state = withAmerica(sotTurn({ techs: ['Irrigation'] }))
      state = put(state, CASH1981, 'cities/redcity2', 4, 4)
      state = put(state, CASH1981, 'figures/redscout', 6, 6)
      const withMarker = put(state, CASH1981, 'cities/redcapital2', 1, 1)
      const capital = withMarker.board.pieces.find((piece) => piece.assetId === 'cities/redcapital2')
      if (capital === undefined) throw new Error('no capital')
      expect(scoutViewsOf(withMarker, me(withMarker))[0]?.assignedTo).toBe(capital.id)
      // The capital marker moves to the player's area: no capital on the map
      const off: GameState = { ...withMarker, board: { ...withMarker.board, pieces: withMarker.board.pieces.map((piece) => (piece.id === capital.id ? { ...piece, x: -500, y: -500 } : piece)) } }
      expect(scoutViewsOf(off, me(off))[0]).toMatchObject({ assignedTo: null, assignedByDefault: false })
    })

    it('logs clearing an English army’s send as stopping, not as going back to the capital', () => {
      let english = withAmerica(sotTurn({ civ: 'England' }))
      english = put(english, CASH1981, 'cities/redcapital2', 1, 1)
      english = put(english, CASH1981, 'figures/redarmy', 3, 2)
      const army = english.board.pieces.find((piece) => piece.assetId === 'figures/redarmy')
      const cityId = near(english)?.pieceId ?? ''
      const sent = unwrap(assign(english, army?.id ?? '', cityId))
      const stopped = unwrap(assign(sent, army?.id ?? '', null, 'req-2'))
      expect(stopped.log.at(-1)?.publicLog).toBe('cash1981 stopped sending the square of the scout on D3 to a city')
    })

    it('does not send an English army to the capital on its own', () => {
      let english = withAmerica(sotTurn({ civ: 'England' }))
      english = put(english, CASH1981, 'cities/redcapital2', 1, 1)
      english = put(english, CASH1981, 'figures/redarmy', 3, 2)
      expect(scoutViewsOf(english, me(english)).find((view) => view.figure === 'army')).toMatchObject({ assignedTo: null, assignedByDefault: false })
    })
  })

  it('lets the latest choice win, lets a scout stop sending, and gives back the earlier choice when one is undone', () => {
    const state = twoCities(FOREST_A2)
    const scout = scoutOf(state)
    const toFar = unwrap(assign(state, scout.id, far(state)?.pieceId ?? '', 'req-1'))
    const toNear = unwrap(assign(toFar, scout.id, near(state)?.pieceId ?? '', 'req-2'))
    expect(scoutAssignmentsOf(toNear, me(toNear))).toHaveLength(1)
    expect(far(toNear)?.outskirts).toBe(0)
    const stopped = unwrap(assign(toFar, scout.id, null, 'req-3'))
    expect(scoutAssignmentsOf(stopped, me(stopped))).toEqual([])
    expect(stopped.log.at(-1)?.publicLog).toBe('cash1981 sent the square of the scout on A2 back to the capital')
    expect(near(stopped)?.outskirts).toBe(near(state)?.outskirts)

    // Undoing the latest choice brings the one before back
    const undone = undoByVote(toNear, 'req-2')
    expect(far(undone)?.outskirts).toBe(2)
  })

  it('stops counting once the scout has moved off the square, and once the turn has gone on', () => {
    const state = twoCities(FOREST_D3)
    const scout = scoutOf(state)
    const sent = unwrap(assign(state, scout.id, far(state)?.pieceId ?? ''))
    expect(scoutAssignmentsOf(sent, me(sent))).toHaveLength(1)
    expect(far(sent)?.outskirts).toBe(2)
    const moved = unwrap(movePiece(sent, { playerId: CASH1981, pieceId: scout.id, x: scout.x + SQUARE_SIZE, y: scout.y, snap: false }))
    expect(scoutAssignmentsOf(moved, me(moved))).toEqual([])
    expect(far(moved)?.outskirts).toBe(0)
    // A record from an earlier turn does not count
    const later: GameState = { ...sent, assistedActions: sent.assistedActions.map((record) => ({ ...record, turnNumber: 0 })) }
    expect(scoutAssignmentsOf(later, me(later))).toEqual([])
    expect(far(later)?.outskirts).toBe(0)
  })

  it('ignores a scout whose city is gone', () => {
    const state = twoCities(FOREST_D3)
    const sent = unwrap(assign(state, scoutOf(state).id, far(state)?.pieceId ?? ''))
    const farId = far(sent)?.pieceId
    const without: GameState = { ...sent, board: { ...sent.board, pieces: sent.board.pieces.filter((piece) => piece.id !== farId) } }
    expect(scoutAssignmentsOf(without, me(without))).toEqual([])
  })

  it('needs Start of Turn, a scout of the player’s own and a city of the player’s own', () => {
    const state = twoCities(FOREST_D3)
    const scout = scoutOf(state)
    const closed = unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'SOT' }))
    expect(reasonOf(assign(closed, scout.id, near(state)?.pieceId ?? ''))).toBe('Only available during your open Start of Turn phase.')
    expect(reasonOf(assign(state, 'nothing', near(state)?.pieceId ?? ''))).toBe('That figure is not one of your scouts on the map.')
    expect(reasonOf(assign(state, scout.id, 'nothing'))).toBe('That is not one of your cities on the map.')
    const empty = performAssistedAction(state, { playerId: CASH1981, action: 'assignScout' as AssistedActionKind, requestId: 'req-9' })
    expect(reasonOf(empty)).toBe('Choose the scout and the city.')
  })

  it('has no button to press without a scout or a city', () => {
    expect(assistedAvailability(sotTurn(), CASH1981, 'assignScout' as AssistedActionKind).reason).toBe('You have no scout on the map.')
    const scoutOnly = put(withAmerica(sotTurn()), CASH1981, 'figures/redscout', 3, 2)
    expect(assistedAvailability(scoutOnly, CASH1981, 'assignScout' as AssistedActionKind).reason).toBe(
      'You have no city on the map to send a square to.',
    )
  })

  it('lets the English send the square of an army, and nobody else', () => {
    let english = withAmerica(sotTurn({ civ: 'England' }))
    english = put(english, CASH1981, 'cities/redcapital2', 1, 1)
    english = put(english, CASH1981, 'figures/redarmy', 3, 2)
    const army = english.board.pieces.find((piece) => piece.assetId === 'figures/redarmy')
    const cityId = near(english)?.pieceId ?? ''
    expect(assign(english, army?.id ?? '', cityId).ok).toBe(true)
    let other = withAmerica(sotTurn({ civ: 'Japanese' }))
    other = put(other, CASH1981, 'cities/redcapital2', 1, 1)
    other = put(other, CASH1981, 'figures/redarmy', 3, 2)
    const otherArmy = other.board.pieces.find((piece) => piece.assetId === 'figures/redarmy')
    expect(unwrapErr(assign(other, otherArmy?.id ?? '', near(other)?.pieceId ?? '')).kind).toBe('ASSISTED_ACTION_REJECTED')
  })

  it('does not change what another player sees of the cities, except the production figure', () => {
    const state = twoCities(FOREST_D3)
    const sent = unwrap(assign(state, scoutOf(state).id, far(state)?.pieceId ?? ''))
    const theirs = toPlayerView(sent, KARANDRAS1).opponents.find((opponent) => opponent.playerId === CASH1981)
    expect(theirs?.cities?.find((city) => city.label.endsWith('I9'))?.outskirts).toBe(2)
    expect(theirs?.cities?.find((city) => city.label.endsWith('B2'))?.outskirts).toBe(near(sent)?.outskirts)
  })

})
