/**
 * The conquest rewards of the Romans and the Chinese (the civ cards, issue #368): a conquest is recognised from an army's
 * move onto a village or another player's city and a battle that army won, and it only ever makes an offer the player
 * answers (`claimConquest`). Nothing is gained without the answer.
 *
 * The scene is the America tile in the first map slot (columns 0 to 3, rows 0 to 3). cash1981 is Red, karandras1 Blue,
 * itchi Green. A village lies on C2 (column 2, row 1) and the army starts on C3 below it; the city tests put a blue city
 * and a blue army on C2 instead.
 */

import { describe, expect, it } from 'vitest'

import { endBattleAction, initiateBattle, killArenaUnit, placeUnitInArena, undoEndBattle } from '../src/actions/arena.js'
import { movePiece, undoLastBoardChange } from '../src/actions/board.js'
import { mapTokensOf } from '../src/zheng-he.js'
import { draw, drawUnitsForBattle } from '../src/actions/draw.js'
import { travelFigureCollecting } from '../src/actions/token-collection.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { performAssistedAction } from '../src/assisted.js'
import { mapCellOf } from '../src/blockade.js'
import { SQUARE_SIZE, cultureStepOf } from '../src/board.js'
import type { BoardPiece } from '../src/board.js'
import { describeError } from '../src/errors.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { battleSummaries, battleWinner, findPlayer, toPlayerView } from '../src/state.js'

import { AT, me, put, sotTurn, withAmerica } from './sot-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1 } from './fixture.js'

const OTHERS = [KARANDRAS1, ITCHI, CHUL]
const C2 = { column: 2, row: 1 }
const C3 = { column: 2, row: 2 }

interface Options {
  readonly civ?: string
  readonly step?: number
  readonly culture?: number
  readonly techs?: readonly string[]
}

/** cash1981 with an army on C3 and a village on C2. */
function villageScene(options: Options = {}): GameState {
  const base = withAmerica(sotTurn({ civ: 'Romans', step: 9, culture: 5, trade: 0, ...options }))
  return put(put(base, CASH1981, 'figures/redarmy', C3.column, C3.row), CASH1981, 'resources/village', C2.column, C2.row)
}

/** cash1981 with an army on C3 and karandras1's city and army on C2. */
function cityScene(options: Options = {}): GameState {
  const base = withAmerica(sotTurn({ civ: 'Romans', step: 9, culture: 5, trade: 0, ...options }))
  const withCity = put(put(base, KARANDRAS1, 'cities/bluecity2', C2.column, C2.row), KARANDRAS1, 'figures/bluearmy', C2.column, C2.row)
  return put(withCity, CASH1981, 'figures/redarmy', C3.column, C3.row)
}

/** The Roman village scene with no leader marker on the culture track. */
const withAmericaNoMarker = (): GameState => {
  const scene = villageScene()
  return { ...scene, board: { ...scene.board, pieces: scene.board.pieces.filter((piece) => !piece.assetId.startsWith('leaders/')) } }
}

const pieceOf = (state: GameState, assetId: string): BoardPiece => {
  const found = state.board.pieces.find((piece) => piece.assetId === assetId)
  if (found === undefined) throw new Error(`no ${assetId}`)
  return found
}

/** The army moves onto C2 (the village, or the city). `collectToken` says whether the village token is drawn. */
const march = (state: GameState, collectToken = false, playerId = CASH1981, assetId = 'figures/redarmy'): GameState =>
  unwrap(
    travelFigureCollecting(state, {
      playerId,
      pieceId: pieceOf(state, assetId).id,
      column: C2.column,
      row: C2.row,
      ...(collectToken ? { collectToken } : {}),
    }),
  )

const lines = (state: GameState): string[] => state.log.map((entry) => entry.publicLog)
const offersOf = (state: GameState) => state.conquestOffers ?? []

/**
 * cash1981 (attacker, two units of 3 health each, or `health`) fights `opponent`, the barbarians (karandras1 controls them)
 * or a player (two units of 3 health). Nothing is killed yet.
 */
function fight(state: GameState, opponent: 'barbarians' | string, health = 3): GameState {
  let next = state
  const prepare = (playerId: string): GameState => {
    let drawn = next
    for (let i = 0; i < 2; i++) drawn = unwrap(draw(drawn, { playerId, sheetName: 'INFANTRY', confirmedOutOfTurn: true }))
    return unwrap(drawUnitsForBattle(drawn, { playerId, numberOfDraws: 2 }))
  }
  next = prepare(CASH1981)
  if (opponent !== 'barbarians') next = prepare(opponent)
  // The move of a village fight has started the battle already
  if (next.battle === null) next = unwrap(initiateBattle(next, { initiatorId: CASH1981, opponentId: opponent }))
  const place = (playerId: string, side: 'attacker' | 'defender', first: number, hp: number, from: 'battlehand' | 'barbarians'): void => {
    for (const [index, unit] of (findPlayer(next, playerId)?.[from] ?? []).entries()) {
      next = unwrap(placeUnitInArena(next, { playerId, unitId: unit.id, side, position: first + index, attack: 1, health: hp }))
    }
  }
  place(CASH1981, 'attacker', 0, health, 'battlehand')
  if (opponent === 'barbarians') place(KARANDRAS1, 'defender', 10, 3, 'barbarians')
  else place(opponent, 'defender', 10, 3, 'battlehand')
  return next
}

/** The defenders' health spread so that their total equals the attackers': neither has more, whatever bonus either side has. */
function evenTotals(state: GameState): GameState {
  const arena = state.battle?.arena ?? []
  const total = arena.filter((unit) => unit.side === 'attacker').reduce((sum, unit) => sum + unit.health, 0)
  const defenders = arena.filter((unit) => unit.side === 'defender')
  let left = total
  const health = new Map(
    defenders.map((unit, index) => {
      const share = index === defenders.length - 1 ? left : Math.floor(total / defenders.length)
      left -= share
      return [unit.id, share] as const
    }),
  )
  return {
    ...state,
    battle: state.battle === null ? null : { ...state.battle, arena: state.battle.arena.map((unit) => (health.has(unit.id) ? { ...unit, health: health.get(unit.id) ?? 0 } : unit)) },
  }
}

const killSide = (state: GameState, side: 'attacker' | 'defender'): GameState =>
  (state.battle?.arena ?? [])
    .filter((unit) => unit.side === side)
    .reduce((next, unit) => unwrap(killArenaUnit(next, { playerId: CASH1981, arenaUnitId: unit.id })), state)

/** A battle cash1981 wins: the other side is wiped out. */
const won = (state: GameState, opponent: 'barbarians' | string, health = 3): GameState =>
  unwrap(endBattleAction(killSide(fight(state, opponent, health), 'defender'), { playerId: CASH1981 }))

/** The Roman leader marker's space on the culture track. */
const stepOf = (state: GameState): number | null => {
  const marker = state.board.pieces.find((piece) => piece.assetId.startsWith('leaders/') && piece.assetId.endsWith('_red'))
  return marker === undefined ? null : cultureStepOf(state.board, marker)
}

const claim = (state: GameState, offerId: string, accept: boolean, requestId = 'claim-1', playerId = CASH1981) =>
  performAssistedAction(state, { playerId, action: 'claimConquest', requestId, at: AT, payload: { offerId, accept } })

function undoByVote(state: GameState, requestId: string): GameState {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line for the action')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of OTHERS) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  return next
}

/** The vote on the action's line as far as it goes: the result of the last vote, which carries out the undo. */
function voteAll(state: GameState, requestId: string) {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line for the action')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of OTHERS.slice(0, -1)) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  return vote(next, { logId: entry.id, playerId: OTHERS.at(-1) ?? '', vote: true, at: AT })
}

const reasonOf = (result: ReturnType<typeof claim>): string => {
  const error = unwrapErr(result)
  if (error.kind !== 'ASSISTED_ACTION_REJECTED') throw new Error(`unexpected error ${error.kind}`)
  return error.reason
}

// ---------------------------------------------------------------------------

describe('what an army move records as a pending conquest', () => {
  it('records a Roman army that ends on a village, with or without drawing the token', () => {
    for (const collect of [false, true]) {
      const moved = march(villageScene(), collect)
      expect(moved.pendingConquests).toEqual([
        { playerId: CASH1981, pieceId: pieceOf(moved, 'figures/redarmy').id, column: 2, row: 1, square: 'C2', kind: 'village' },
      ])
      expect(offersOf(moved)).toEqual([])
    }
  })

  it('records a Chinese army on a village, but not on another player’s city: that is for the Romans', () => {
    const village = march(villageScene({ civ: 'Chinese' }))
    expect(village.pendingConquests?.map((entry) => entry.kind)).toEqual(['village'])
    const city = march(cityScene({ civ: 'Chinese' }))
    expect(city.pendingConquests).toBeUndefined()
  })

  it('records the army of any civ on a village, and a collected village only for a civ with an extra', () => {
    const japanese = march(villageScene({ civ: 'Japanese' }))
    expect(japanese.pendingConquests?.map((entry) => entry.kind)).toEqual(['village'])
    // Drawn on the move (a Zulu army), nothing is left to offer a civ without an extra; the Chinese still have their +3
    expect(march(villageScene({ civ: 'Zulu' }), true).pendingConquests).toBeUndefined()
    expect(march(villageScene({ civ: 'Chinese' }), true).pendingConquests?.map((entry) => entry.kind)).toEqual(['village'])
    // Another player's city is for the Romans alone
    expect(march(cityScene({ civ: 'Japanese' })).pendingConquests).toBeUndefined()
  })

  it('records a Roman army that ends on another player’s city', () => {
    const moved = march(cityScene())
    expect(moved.pendingConquests?.map((entry) => ({ kind: entry.kind, square: entry.square }))).toEqual([{ kind: 'city', square: 'C2' }])
  })

  it('records nothing for a scout, for another civ, for an own city or an empty square', () => {
    // A scout cannot stand on a village or among another player's figures, so it goes to an empty city: it conquers nothing
    const emptyCity = put(withAmerica(sotTurn({ civ: 'Romans', step: 9 })), KARANDRAS1, 'cities/bluecity2', C2.column, C2.row)
    const scout = put(emptyCity, CASH1981, 'figures/redscout', C3.column, C3.row)
    const scouted = march(scout, false, CASH1981, 'figures/redscout')
    expect(mapCellOf(scouted.board, pieceOf(scouted, 'figures/redscout'))).toEqual(C2)
    expect(scouted.pendingConquests).toBeUndefined()
    // The Romans' own city
    const own = put(put(withAmerica(sotTurn({ civ: 'Romans', step: 9 })), CASH1981, 'cities/redcity2', C2.column, C2.row), CASH1981, 'figures/redarmy', C3.column, C3.row)
    expect(march(own).pendingConquests).toBeUndefined()
    // An empty square
    const empty = put(withAmerica(sotTurn({ civ: 'Romans', step: 9 })), CASH1981, 'figures/redarmy', C3.column, C3.row)
    expect(march(empty).pendingConquests).toBeUndefined()
  })

  it('keeps one pending conquest per player: a newer move replaces the older, another player’s stays', () => {
    // Two armies, each next to a village of its own: C3 to C2, and A3 to B3
    const base = put(put(villageScene(), CASH1981, 'figures/redarmy', 0, 2), CASH1981, 'resources/village', 1, 2)
    const [first, second] = base.board.pieces.filter((piece) => piece.assetId === 'figures/redarmy')
    if (first === undefined || second === undefined) throw new Error('two armies expected')
    const other = { playerId: KARANDRAS1, pieceId: 'other', column: 0, row: 0, square: 'A1', kind: 'village' as const }
    const travel = (state: GameState, pieceId: string, column: number, row: number) =>
      unwrap(travelFigureCollecting(state, { playerId: CASH1981, pieceId, column, row }))
    const onFirst = travel({ ...base, pendingConquests: [other] }, first.id, C2.column, C2.row)
    expect(onFirst.pendingConquests?.map((entry) => entry.square)).toEqual(['A1', 'C2'])
    const onSecond = travel(onFirst, second.id, 1, 2)
    // The Roman entry is the newer one, for the second army on B3; karandras1's is untouched
    expect(onSecond.pendingConquests?.map((entry) => entry.square)).toEqual(['A1', 'B3'])
    expect(onSecond.pendingConquests?.find((entry) => entry.playerId === CASH1981)?.pieceId).toBe(second.id)
  })
})

describe('a won battle makes an offer', () => {
  it('makes a Roman offer for a village after a win over the barbarians, and uses the pending conquest up', () => {
    const ended = won(march(villageScene()), 'barbarians')
    expect(offersOf(ended)).toEqual([{ id: expect.any(String), playerId: CASH1981, kind: 'village', square: 'C2', civ: 'Romans' }])
    expect(ended.pendingConquests).toBeUndefined()
    expect(ended.endedBattle?.conquest?.offerIds).toEqual([offersOf(ended)[0]?.id])
    // Nothing is gained yet
    expect(stepOf(ended)).toBe(9)
    expect(me(ended).stats.culture).toBe(5)
  })

  it('makes a Chinese offer for a village, and a Roman one for a city won against its owner', () => {
    const chinese = won(march(villageScene({ civ: 'Chinese' })), 'barbarians')
    expect(offersOf(chinese)).toMatchObject([{ playerId: CASH1981, kind: 'village', civ: 'Chinese' }])
    expect(me(chinese).stats.culture).toBe(5)
    // The city's defence adds 6, so the Romans bring more health than they need to
    const city = won(march(cityScene()), KARANDRAS1, 5)
    expect(offersOf(city)).toMatchObject([{ playerId: CASH1981, kind: 'city', square: 'C2', civ: 'Romans' }])
  })

  it('makes no offer after a loss, after a draw (the defender wins it), or when the army moved away', () => {
    const lost = unwrap(endBattleAction(killSide(fight(march(villageScene()), 'barbarians'), 'attacker'), { playerId: CASH1981 }))
    expect(offersOf(lost)).toEqual([])
    expect(lost.pendingConquests).toBeUndefined()
    // A real draw: the defenders' health is set so both sides total the same, and a draw goes to the defender
    const even = evenTotals(fight(march(villageScene()), 'barbarians'))
    const [attackerTotals, defenderTotals] = ['attacker', 'defender'].map((side) => battleSummaries(even).find((summary) => summary.side === side))
    expect((attackerTotals?.totalHealth ?? -1) + (attackerTotals?.combatBonus ?? 0)).toBe((defenderTotals?.totalHealth ?? -2) + (defenderTotals?.combatBonus ?? 0))
    expect(battleWinner(battleSummaries(even))?.side).toBe('defender')
    const drawn = unwrap(endBattleAction(even, { playerId: CASH1981 }))
    expect(offersOf(drawn)).toEqual([])
    expect(drawn.pendingConquests).toBeUndefined()
    // One health more for the attacker is a win, so the draw really was the tie-break and nothing else
    const ahead: GameState = { ...even, battle: even.battle === null ? null : { ...even.battle, arena: even.battle.arena.map((unit, index) => (unit.side === 'attacker' && index === 0 ? { ...unit, health: unit.health + 1 } : unit)) } }
    expect(offersOf(unwrap(endBattleAction(ahead, { playerId: CASH1981 })))).toHaveLength(1)
    // The army left the village square before the battle ended
    const moved = march(villageScene())
    const army = pieceOf(moved, 'figures/redarmy')
    const away = unwrap(movePiece(moved, { playerId: CASH1981, pieceId: army.id, x: army.x, y: army.y + SQUARE_SIZE, snap: false }))
    expect(offersOf(won(away, 'barbarians'))).toEqual([])
  })

  it('makes no offer when the battle is not against the matching side', () => {
    // A village is won over the barbarians, not over a player; a city over its owner, not over the barbarians or a third player
    expect(offersOf(won(march(villageScene()), KARANDRAS1))).toEqual([])
    expect(offersOf(won(march(cityScene()), 'barbarians', 5))).toEqual([])
    expect(offersOf(won(march(cityScene()), ITCHI, 5))).toEqual([])
  })

  it('makes no offer to a player who did not make the move, and uses up the pending conquest of every combatant', () => {
    // karandras1 holds a pending conquest of their own, and fights cash1981, who has none
    const scene = { ...villageScene(), pendingConquests: [{ playerId: KARANDRAS1, pieceId: 'blue', column: 2, row: 1, square: 'C2', kind: 'village' as const }] }
    const ended = won(scene, KARANDRAS1)
    expect(offersOf(ended)).toEqual([])
    expect(ended.pendingConquests).toBeUndefined()
  })

  it('leaves the pending conquest of the player who only controls the barbarians alone, and uses up the combatant’s', () => {
    // karandras1 controls the barbarians cash1981 fights: they are no combatant, so their own pending conquest (a village
    // of theirs elsewhere) stays; itchi fights nobody and keeps theirs too
    const entry = (playerId: string) => ({ playerId, pieceId: `${playerId}-army`, column: 0, row: 0, square: 'A1', kind: 'village' as const })
    const marched = march(villageScene())
    const scene = { ...marched, pendingConquests: [...(marched.pendingConquests ?? []), entry(KARANDRAS1), entry(ITCHI)] }
    const ended = won(scene, 'barbarians')
    // cash1981's own entry was used up (and made the offer); the controller's and the bystander's remain
    expect(offersOf(ended)).toHaveLength(1)
    expect(ended.pendingConquests?.map((pending) => pending.playerId)).toEqual([KARANDRAS1, ITCHI])
  })

  it('leaves a battle with no pending conquest exactly as it was', () => {
    const ended = won(villageScene(), 'barbarians')
    expect(ended.endedBattle?.conquest).toBeUndefined()
    expect(ended.pendingConquests).toBeUndefined()
    expect(ended.conquestOffers).toBeUndefined()
  })
})

describe('answering an offer', () => {
  const offered = (options: Options = {}): GameState => won(march(villageScene(options)), 'barbarians')
  const offerId = (state: GameState): string => {
    const id = offersOf(state)[0]?.id
    if (id === undefined) throw new Error('no offer')
    return id
  }

  it('gives the Romans their free advance on accepting, and closes the offer', () => {
    const state = offered()
    const result = unwrap(claim(state, offerId(state), true))
    expect(stepOf(result)).toBe(10)
    expect(offersOf(result)).toEqual([])
    expect(me(result).stats.culture).toBe(5)
    expect(lines(result)).toContain('cash1981 took the free advance for conquering the village on C2 as the Romans')
    expect(lines(result).some((line) => line.startsWith('cash1981 advanced for free on the culture track to space 10'))).toBe(true)
    // One line is the target of the undo vote; the advance's own line carries no action id
    expect(result.log.filter((entry) => entry.assistedActionId === 'claim-1')).toHaveLength(1)
    expect(result.assistedActions.at(-1)).toMatchObject({ kind: 'claimConquest', status: 'applied', effect: { kind: 'conquestClaim', accepted: true, culture: 0 } })
  })

  it('gives the Chinese 3 culture on accepting, in the lines’ format, and nothing else', () => {
    const state = offered({ civ: 'Chinese', culture: 5 })
    const result = unwrap(claim(state, offerId(state), true))
    expect(me(result).stats.culture).toBe(8)
    expect(lines(result)).toContain('cash1981 gained 3 (8) culture for conquering the village on C2 as the Chinese')
    expect(offersOf(result)).toEqual([])
    expect(stepOf(result)).toBe(stepOf(state))
  })

  it('closes the offer on declining, gains nothing, and says so', () => {
    const roman = offered()
    const declined = unwrap(claim(roman, offerId(roman), false))
    expect(stepOf(declined)).toBe(9)
    expect(offersOf(declined)).toEqual([])
    expect(lines(declined)).toContain('cash1981 declined the free advance for conquering the village on C2 as the Romans')
    const chinese = offered({ civ: 'Chinese' })
    const noThanks = unwrap(claim(chinese, offerId(chinese), false))
    expect(me(noThanks).stats.culture).toBe(5)
    expect(lines(noThanks)).toContain('cash1981 declined the 3 culture for conquering the village on C2 as the Chinese')
  })

  it('refuses an answer from another player, and a made-up or closed offer, and keeps the offer', () => {
    const state = offered()
    const id = offerId(state)
    // karandras1 has no offer at all, itchi neither
    expect(reasonOf(claim(state, id, true, 'x-1', KARANDRAS1))).toBe('You have no conquest to answer.')
    // Even a player with an offer of their own cannot answer cash1981's
    const both: GameState = { ...state, conquestOffers: [...offersOf(state), { id: 'theirs', playerId: KARANDRAS1, kind: 'village', square: 'A1', civ: 'Chinese' }] }
    expect(reasonOf(claim(both, id, true, 'x-2', KARANDRAS1))).toBe('That conquest offer is not yours.')
    expect(offersOf(both)).toHaveLength(2)
    expect(reasonOf(claim(state, 'no-such-offer', true, 'x-3'))).toBe('That conquest offer is not open.')
    // Answered once, it is closed: a second press with a new request id finds no offer
    const answered = unwrap(claim(state, id, true))
    expect(reasonOf(claim(answered, id, true, 'claim-2'))).toBe('You have no conquest to answer.')
    // A retry of the same request is harmless and gives the same state
    expect(unwrap(claim(answered, id, true))).toBe(answered)
    // A payload that is not an offer and a flag
    const bad = performAssistedAction(state, { playerId: CASH1981, action: 'claimConquest', requestId: 'x-4', at: AT, payload: { offerId: id } as never })
    expect(reasonOf(bad)).toBe('Choose the conquest offer and whether to take it.')
  })

  it('refuses a Roman advance that is stopped now, says why, and keeps the offer', () => {
    // Mysticism draws two cards on an event space, so the first advance leaves a card choice waiting
    const first = offered({ techs: ['Mysticism'] })
    const afterFirst = unwrap(claim(first, offerId(first), true))
    expect(me(afterFirst).pendingRewards).toHaveLength(1)
    const second: GameState = { ...afterFirst, conquestOffers: [{ id: 'second', playerId: CASH1981, kind: 'city', square: 'D4', civ: 'Romans' }] }
    expect(reasonOf(claim(second, 'second', true, 'claim-2'))).toMatch(/advance one space for free for a conquest, and that is stopped now: .*Choose the card to keep/)
    expect(offersOf(second)).toHaveLength(1)
    // The view says it too, so the prompt can show it before the press
    expect(toPlayerView(second, CASH1981).you?.conquestOffers[0]?.blocked).toMatch(/Choose the card to keep/)
    // Declining is never stopped
    expect(unwrap(claim(second, 'second', false, 'claim-3')).conquestOffers).toBeUndefined()
  })

  it('closes and logs the offer at the end of the track, with nothing gained', () => {
    const state = offered({ step: 21 })
    const result = unwrap(claim(state, offerId(state), true))
    expect(offersOf(result)).toEqual([])
    expect(stepOf(result)).toBe(21)
    expect(lines(result)).toContain(
      'cash1981 took the free advance for conquering the village on C2 as the Romans, but there is nothing to advance: your marker is already on the Culture Victory space.',
    )
    expect(result.assistedActions.at(-1)?.effect).toMatchObject({ kind: 'conquestClaim', accepted: true, advance: null })
  })

  it('words the answer to a city offer as a city, and gives the Romans the advance for it', () => {
    const city = won(march(cityScene()), KARANDRAS1, 5)
    const result = unwrap(claim(city, offerId(city), true))
    expect(lines(result)).toContain('cash1981 took the free advance for conquering the city on C2 as the Romans')
    expect(stepOf(result)).toBe(10)
  })
})

describe('taking the answer back', () => {
  const offered = (options: Options = {}): GameState => won(march(villageScene(options)), 'barbarians')
  const idOf = (state: GameState): string => offersOf(state)[0]?.id ?? ''

  it('takes the Roman advance back with the vote, opens the offer again and lets it be answered anew', () => {
    const state = offered()
    const id = idOf(state)
    const accepted = unwrap(claim(state, id, true))
    const undone = undoByVote(accepted, 'claim-1')
    expect(stepOf(undone)).toBe(9)
    expect(offersOf(undone)).toEqual(offersOf(state))
    expect(undone.log.at(-1)?.publicLog).toBe(
      "System: cash1981's answer to the conquest of the village on C2 was undone: the village token is back on the map, the free advance was taken back, the offer is open again",
    )
    expect(undone.assistedActions.at(-1)?.status).toBe('undone')
    // The board Undo cannot walk the marker forward again past the take-back
    expect(undoLastBoardChange(undone, CASH1981).ok).toBe(false)
    // Answered again, with a new request, it gives the advance once more
    expect(stepOf(unwrap(claim(undone, id, true, 'claim-2')))).toBe(10)
  })

  it('takes the Chinese culture back when all of it is still there, and says how much is left', () => {
    const state = offered({ civ: 'Chinese', culture: 5 })
    const accepted = unwrap(claim(state, idOf(state), true))
    expect(me(accepted).stats.culture).toBe(8)
    const whole = undoByVote(accepted, 'claim-1')
    expect(me(whole).stats.culture).toBe(5)
    expect(whole.log.at(-1)?.publicLog).toContain('took back 3 (5) culture')
    expect(whole.log.at(-1)?.publicLog).toContain('the offer is open again')
    // Earned since: only the 3 goes
    const earned: GameState = { ...accepted, players: accepted.players.map((player) => (player.playerId === CASH1981 ? { ...player, stats: { ...player.stats, culture: 10 } } : player)) }
    expect(me(undoByVote(earned, 'claim-1')).stats.culture).toBe(7)
  })

  it('refuses to take the Chinese culture back once it is spent, changes nothing, and so cannot be farmed', () => {
    const state = offered({ civ: 'Chinese', culture: 5 })
    const accepted = unwrap(claim(state, idOf(state), true))
    const spent: GameState = { ...accepted, players: accepted.players.map((player) => (player.playerId === CASH1981 ? { ...player, stats: { ...player.stats, culture: 1 } } : player)) }
    const refused = unwrapErr(voteAll(spent, 'claim-1'))
    expect(refused.kind).toBe('ASSISTED_UNDO_BLOCKED')
    expect(describeError(refused)).toContain('Only 1 culture is left')
    // The offer stays closed, so the village and the 3 culture cannot be had again
    expect(offersOf(spent)).toEqual([])
    expect(spent.assistedActions.at(-1)?.status).toBe('applied')
  })

  it('opens a declined offer again', () => {
    const state = offered()
    const declined = unwrap(claim(state, idOf(state), false))
    const undone = undoByVote(declined, 'claim-1')
    expect(offersOf(undone)).toEqual(offersOf(state))
    expect(stepOf(undone)).toBe(9)
    expect(undone.log.at(-1)?.publicLog).toContain('the offer is open again')
  })

  it('refuses to take the advance back once the marker has moved on, and keeps the answer', () => {
    const state = offered()
    const accepted = unwrap(claim(state, idOf(state), true))
    // The marker has moved on to space 11 by a later advance
    const marker = accepted.board.pieces.find((piece) => piece.assetId.startsWith('leaders/')) as BoardPiece
    const moved = unwrap(movePiece(accepted, { playerId: CASH1981, pieceId: marker.id, x: marker.x + 40, y: marker.y, snap: false }))
    const entry = moved.log.find((candidate) => candidate.assistedActionId === 'claim-1')
    if (entry === undefined) throw new Error('no line')
    let next = unwrap(initiateUndo(moved, { logId: entry.id, playerId: CASH1981 }))
    next = unwrap(vote(next, { logId: entry.id, playerId: KARANDRAS1, vote: true, at: AT }))
    next = unwrap(vote(next, { logId: entry.id, playerId: ITCHI, vote: true, at: AT }))
    const refused = unwrapErr(vote(next, { logId: entry.id, playerId: CHUL, vote: true, at: AT }))
    expect(refused.kind).toBe('ASSISTED_UNDO_BLOCKED')
  })
})

describe('undoing the end of the battle', () => {
  const fought = (): GameState => fight(march(villageScene()), 'barbarians')
  const finished = (state: GameState): GameState => unwrap(endBattleAction(killSide(state, 'defender'), { playerId: CASH1981 }))

  it('withdraws an unanswered offer and gives the pending conquest back, so ending again offers again', () => {
    const ended = finished(fought())
    expect(offersOf(ended)).toHaveLength(1)
    const undone = unwrap(undoEndBattle(ended, { playerId: CASH1981 }))
    expect(undone.conquestOffers).toBeUndefined()
    expect(undone.pendingConquests).toHaveLength(1)
    expect(lines(undone).at(-1)).toContain('and the conquest offer is withdrawn')
    // The battle is back as it was: end it again and the offer comes again, with its own id
    const again = unwrap(endBattleAction(undone, { playerId: CASH1981 }))
    expect(offersOf(again)).toHaveLength(1)
    expect(offersOf(again)[0]?.id).not.toBe(offersOf(ended)[0]?.id)
  })

  it('keeps a newer pending conquest of the player instead of the one it gives back', () => {
    const ended = finished(fought())
    const newer = { playerId: CASH1981, pieceId: 'newer', column: 0, row: 0, square: 'A1', kind: 'village' as const }
    const undone = unwrap(undoEndBattle({ ...ended, pendingConquests: [newer] }, { playerId: CASH1981 }))
    expect(undone.pendingConquests).toEqual([newer])
  })

  it('refuses while the offer was answered, accepted or declined, says to undo that first, and changes nothing', () => {
    const ended = finished(fought())
    const id = offersOf(ended)[0]?.id ?? ''
    for (const accept of [true, false]) {
      const answered = unwrap(claim(ended, id, accept))
      const refused = undoEndBattle(answered, { playerId: CASH1981 })
      expect(refused.ok).toBe(false)
      if (refused.ok) continue
      expect(refused.error.kind).toBe('ASSISTED_UNDO_BLOCKED')
      const reason = describeError(refused.error)
      expect(reason).toContain('C2')
      expect(reason).toContain(accept ? 'was taken' : 'was declined')
      expect(reason).toContain('Undo that first, then undo the end of the battle')
      // Once the answer is undone, the offer is open again and the end of the battle can be undone
      const reopened = undoByVote(answered, 'claim-1')
      const undone = unwrap(undoEndBattle(reopened, { playerId: CASH1981 }))
      expect(undone.conquestOffers).toBeUndefined()
      expect(undone.battle).not.toBeNull()
    }
  })
})

describe('what the views show', () => {
  const offered = (): GameState => won(march(villageScene()), 'barbarians')

  it('shows the owner their open offer, with nothing that names a piece or a pending conquest', () => {
    const state = offered()
    const view = toPlayerView(state, CASH1981)
    expect(view.you?.conquestOffers).toEqual([{ id: offersOf(state)[0]?.id, kind: 'village', square: 'C2', civ: 'Romans', blocked: null, nothing: null, villageGone: false }])
    expect(JSON.stringify(view)).not.toContain('pendingConquests')
    // The offer is shown to its owner alone, so it does not carry the owner's id
    expect(view.you?.conquestOffers[0]).not.toHaveProperty('playerId')
  })

  it('shows nobody else the offer or the pending conquest, whichever way they look', () => {
    const marched = march(villageScene())
    const state = won(marched, 'barbarians')
    const offerId = offersOf(state)[0]?.id ?? 'missing'
    for (const viewer of [KARANDRAS1, ITCHI, CHUL, 'a-spectator']) {
      for (const [label, from] of [['pending', marched], ['offered', state]] as const) {
        const view = toPlayerView(from, viewer)
        const text = JSON.stringify(view)
        // Nobody sees the pending conquest, and the offer's id (which answers it) is not in anyone else's view
        expect(text, `${label} as ${viewer}`).not.toContain('pendingConquests')
        expect(text, `${label} as ${viewer}`).not.toContain(offerId)
        expect(view.you?.conquestOffers ?? [], `${label} as ${viewer}`).toEqual([])
      }
    }
    // The owner's own view of a pending move carries no offer either, and never the pending conquest
    expect(toPlayerView(marched, CASH1981).you?.conquestOffers).toEqual([])
    expect(JSON.stringify(toPlayerView(marched, CASH1981))).not.toContain('pendingConquests')
  })

  it('says before the press that a Roman advance has nothing to move: no marker on the track, or the end of it', () => {
    const noMarker = won(march(withAmericaNoMarker()), 'barbarians')
    expect(toPlayerView(noMarker, CASH1981).you?.conquestOffers[0]).toMatchObject({ blocked: null, nothing: 'Your leader marker is not on the culture track.' })
    const lastSpace = won(march(villageScene({ step: 21 })), 'barbarians')
    expect(toPlayerView(lastSpace, CASH1981).you?.conquestOffers[0]).toMatchObject({ blocked: null, nothing: 'Your marker is already on the Culture Victory space.' })
    // An advance that can be made says neither, and the Chinese have no advance to speak of
    expect(toPlayerView(offered(), CASH1981).you?.conquestOffers[0]).toMatchObject({ blocked: null, nothing: null })
    const chinese = won(march(villageScene({ civ: 'Chinese' })), 'barbarians')
    expect(toPlayerView(chinese, CASH1981).you?.conquestOffers[0]).toMatchObject({ blocked: null, nothing: null })
  })

  it('leaves a player without an offer with an empty list, and the Romans’ blocked reason null', () => {
    expect(toPlayerView(offered(), KARANDRAS1).you?.conquestOffers).toEqual([])
    expect(toPlayerView(villageScene(), CASH1981).you?.conquestOffers).toEqual([])
  })

  it('writes a public line for the answer that names no card and nothing hidden', () => {
    const state = offered()
    const result = unwrap(claim(state, offersOf(state)[0]?.id ?? '', true))
    const answer = result.log.find((entry) => entry.assistedActionId === 'claim-1')
    expect(answer?.privateLog).toBe('')
    expect(answer?.item).toBeNull()
  })
})

describe('a conquest does not change the huts', () => {
  it('still gives the Chinese 3 culture the moment a hut is collected, with no battle and no offer', () => {
    const base = withAmerica(sotTurn({ civ: 'Chinese', step: 9, culture: 5, trade: 0 }))
    const scene = put(put(base, CASH1981, 'figures/redarmy', C3.column, C3.row), CASH1981, 'resources/hut', C2.column, C2.row)
    const moved = march(scene, true)
    expect(me(moved).stats.culture).toBe(8)
    expect(lines(moved)).toContain('cash1981 gained 3 (8) culture from the hut on C2 as the Chinese')
    expect(moved.pendingConquests).toBeUndefined()
    expect(mapCellOf(moved.board, pieceOf(moved, 'figures/redarmy'))).toEqual(C2)
  })
})

// ---------------------------------------------------------------------------
// The village is got by fighting the barbarians for it, and taken from the offer after a won battle, for every civ

/** The army ends its move on the village and fights the barbarians for it. */
const fightMarch = (state: GameState): GameState =>
  unwrap(travelFigureCollecting(state, { playerId: CASH1981, pieceId: pieceOf(state, 'figures/redarmy').id, column: C2.column, row: C2.row, fightVillage: true }))

const villageTokens = (state: GameState) => mapTokensOf(state.board).filter((token) => token.sheet === 'VILLAGES')
const villageCards = (state: GameState) => me(state).items.filter((item) => item.kind === 'village')
const armyCell = (state: GameState) => mapCellOf(state.board, pieceOf(state, 'figures/redarmy'))
/** The village fight, won, with the army still on the village. */
const wonVillage = (options: Options = {}): GameState =>
  unwrap(endBattleAction(killSide(fight(fightMarch(villageScene(options)), 'barbarians'), 'defender'), { playerId: CASH1981 }))

describe('fighting for a village', () => {
  it('moves the army onto the village, starts the battle against the barbarians and leaves the token and the hand alone', () => {
    const scene = villageScene()
    const fighting = fightMarch(scene)
    expect(armyCell(fighting)).toEqual(C2)
    expect(fighting.battle).toMatchObject({ attacker: { kind: 'player', playerId: CASH1981 }, defender: { kind: 'barbarians' } })
    expect(lines(fighting).some((line) => line.startsWith('cash1981 has initiated a battle against the Barbarians (controlled by '))).toBe(true)
    // The token stays where it is, no card is drawn, and the conquest is recorded for the won battle
    expect(villageTokens(fighting)).toHaveLength(1)
    expect(villageCards(fighting)).toHaveLength(0)
    expect(me(fighting).items).toHaveLength(me(scene).items.length)
    expect(fighting.tokenCollections).toBeUndefined()
    expect(fighting.pendingConquests?.map((entry) => entry.kind)).toEqual(['village'])
  })

  it('never collects the token, even when the move also asks to', () => {
    const scene = villageScene()
    const both = unwrap(
      travelFigureCollecting(scene, { playerId: CASH1981, pieceId: pieceOf(scene, 'figures/redarmy').id, column: C2.column, row: C2.row, fightVillage: true, collectToken: true }),
    )
    expect(villageTokens(both)).toHaveLength(1)
    expect(both.tokenCollections).toBeUndefined()
    expect(both.battle).not.toBeNull()
  })

  it('is just a move without a village, while a battle is active, or with another player’s figures on the square', () => {
    const start = (state: GameState, column = C2.column, row = C2.row) =>
      unwrap(travelFigureCollecting(state, { playerId: CASH1981, pieceId: pieceOf(state, 'figures/redarmy').id, column, row, fightVillage: true }))
    // An empty square
    const empty = withAmerica(sotTurn({ civ: 'Romans', step: 9 }))
    const onEmpty = start(put(empty, CASH1981, 'figures/redarmy', C3.column, C3.row))
    expect(onEmpty.battle).toBeNull()
    expect(armyCell(onEmpty)).toEqual(C2)
    // A battle that is already on: no second battle, and the move is made
    const scene = villageScene()
    const busy = unwrap(initiateBattle(scene, { initiatorId: KARANDRAS1, opponentId: ITCHI }))
    const during = start(busy)
    expect(during.battle?.attacker.playerId).toBe(KARANDRAS1)
    expect(armyCell(during)).toEqual(C2)
    // A blue army on the village: the move ends in contact, which the players settle by hand
    const contested = start(put(scene, KARANDRAS1, 'figures/bluearmy', C2.column, C2.row))
    expect(contested.battle).toBeNull()
    expect(contested.pendingConquests?.map((entry) => entry.kind) ?? []).toEqual(['village'])
    expect(villageTokens(contested)).toHaveLength(1)
  })

  it('offers the village to every civ after a won battle, and gains nothing before the answer', () => {
    for (const civ of ['Romans', 'Chinese', 'Japanese', 'Zulu']) {
      const ended = wonVillage({ civ })
      expect(offersOf(ended), civ).toMatchObject([{ playerId: CASH1981, kind: 'village', square: 'C2', civ }])
      expect(villageTokens(ended), civ).toHaveLength(1)
      expect(villageCards(ended), civ).toHaveLength(0)
      expect(toPlayerView(ended, CASH1981).you?.conquestOffers[0], civ).toMatchObject({ villageGone: false })
    }
  })

  it('gives a civ without an extra the token in its area and the card in its hand, and nothing else', () => {
    const ended = wonVillage({ civ: 'Japanese' })
    const before = me(ended)
    const accepted = unwrap(claim(ended, offersOf(ended)[0]?.id ?? '', true))
    expect(offersOf(accepted)).toEqual([])
    expect(villageTokens(accepted)).toHaveLength(0)
    expect(villageCards(accepted)).toHaveLength(1)
    expect(me(accepted).stats.culture).toBe(before.stats.culture)
    expect(lines(accepted)).toContain('cash1981 conquered the village on C2 as the Japanese')
    expect(lines(accepted)).toContain('cash1981 took the village token on C2 into their area')
    expect(accepted.tokenCollections).toHaveLength(1)
    expect(accepted.assistedActions.at(-1)).toMatchObject({ effect: { kind: 'conquestClaim', accepted: true, culture: 0, advance: null, village: { itemId: villageCards(accepted)[0]?.id } } })
    // The card is private: the public lines never name it
    expect(toPlayerView(accepted, KARANDRAS1).you?.items ?? []).not.toContainEqual(expect.objectContaining({ id: villageCards(accepted)[0]?.id }))
  })

  it('gives the Romans the village and the advance, and the Chinese the village and 3 culture', () => {
    const roman = wonVillage()
    const advanced = unwrap(claim(roman, offersOf(roman)[0]?.id ?? '', true))
    expect(villageCards(advanced)).toHaveLength(1)
    expect(villageTokens(advanced)).toHaveLength(0)
    expect(stepOf(advanced)).toBe(10)
    const chinese = wonVillage({ civ: 'Chinese', culture: 5 })
    const gained = unwrap(claim(chinese, offersOf(chinese)[0]?.id ?? '', true))
    expect(villageCards(gained)).toHaveLength(1)
    expect(villageTokens(gained)).toHaveLength(0)
    expect(me(gained).stats.culture).toBe(8)
  })

  it('leaves the token on the map when the offer is declined, so it can still be drawn by hand', () => {
    for (const civ of ['Japanese', 'Romans', 'Chinese']) {
      const ended = wonVillage({ civ })
      const declined = unwrap(claim(ended, offersOf(ended)[0]?.id ?? '', false))
      expect(villageTokens(declined), civ).toHaveLength(1)
      expect(villageCards(declined), civ).toHaveLength(0)
      expect(declined.tokenCollections, civ).toBeUndefined()
      expect(stepOf(declined), civ).toBe(9)
      expect(me(declined).stats.culture, civ).toBe(5)
      // By hand, from the draw panel
      const token = villageTokens(declined)[0]
      if (token === undefined) throw new Error('no token')
      const drawn = unwrap(draw(declined, { playerId: CASH1981, sheetName: 'VILLAGES', fromPieceId: token.piece.id, confirmedOutOfTurn: true }))
      expect(villageCards(drawn), civ).toHaveLength(1)
    }
  })

  it('says that the token is gone when it left the square, and still gives the extra', () => {
    const withoutToken = (state: GameState): GameState => ({
      ...state,
      board: { ...state.board, pieces: state.board.pieces.filter((piece) => !villageTokens(state).some((token) => token.piece.id === piece.id)) },
    })
    for (const [civ, offerText] of [['Chinese', 'gained 3 (8) culture'], ['Romans', 'took the free advance'], ['Japanese', 'conquered the village']] as const) {
      const ended = withoutToken(wonVillage({ civ, culture: 5 }))
      expect(toPlayerView(ended, CASH1981).you?.conquestOffers[0], civ).toMatchObject({ villageGone: true })
      const accepted = unwrap(claim(ended, offersOf(ended)[0]?.id ?? '', true))
      expect(lines(accepted).some((line) => line.includes(offerText)), civ).toBe(true)
      expect(lines(accepted), civ).toContain('cash1981 could not take the village: its token on C2 is no longer there')
      expect(villageCards(accepted), civ).toHaveLength(0)
      expect(accepted.assistedActions.at(-1)?.effect, civ).toMatchObject({ village: null })
    }
    const chinese = unwrap(claim(withoutToken(wonVillage({ civ: 'Chinese', culture: 5 })), offersOf(wonVillage({ civ: 'Chinese' }))[0]?.id ?? '', true))
    expect(me(chinese).stats.culture).toBe(8)
  })
})

describe('taking back the village', () => {
  const accepted = (options: Options = {}): GameState => {
    const ended = wonVillage(options)
    return unwrap(claim(ended, offersOf(ended)[0]?.id ?? '', true))
  }

  it('puts the token back on its square and the card back, opens the offer again and ends in the starting state', () => {
    for (const civ of ['Japanese', 'Romans', 'Chinese']) {
      const ended = wonVillage({ civ, culture: 5 })
      const taken = unwrap(claim(ended, offersOf(ended)[0]?.id ?? '', true))
      const undone = undoByVote(taken, 'claim-1')
      expect(villageTokens(undone), civ).toHaveLength(1)
      expect(villageTokens(undone)[0]?.cell, civ).toEqual(C2)
      expect(villageCards(undone), civ).toHaveLength(0)
      expect(me(undone).stats.culture, civ).toBe(5)
      expect(stepOf(undone), civ).toBe(9)
      expect(offersOf(undone), civ).toEqual(offersOf(ended))
      expect(undone.tokenCollections ?? [], civ).toEqual([])
      expect(undone.log.at(-1)?.publicLog, civ).toContain('the village token is back on the map')
      // The board Undo cannot walk past it into the forward move
      expect(undoLastBoardChange(undone, CASH1981).ok, civ).toBe(false)
    }
  })

  it('cannot be farmed: answering again after an undo gives the village and the extra once, not twice', () => {
    const ended = wonVillage({ civ: 'Chinese', culture: 5 })
    const id = offersOf(ended)[0]?.id ?? ''
    const again = unwrap(claim(undoByVote(unwrap(claim(ended, id, true)), 'claim-1'), id, true, 'claim-2'))
    expect(me(again).stats.culture).toBe(8)
    expect(villageCards(again)).toHaveLength(1)
    expect(villageTokens(again)).toHaveLength(0)
  })

  it('is refused, with a reason, while the village card has left the hand, and changes nothing', () => {
    for (const civ of ['Japanese', 'Romans']) {
      const taken = accepted({ civ })
      const card = villageCards(taken)[0]
      if (card === undefined) throw new Error('no card')
      const gone: GameState = { ...taken, players: taken.players.map((player) => (player.playerId === CASH1981 ? { ...player, items: player.items.filter((item) => item.id !== card.id) } : player)) }
      const refused = unwrapErr(voteAll(gone, 'claim-1'))
      expect(refused.kind, civ).toBe('ASSISTED_UNDO_BLOCKED')
      expect(describeError(refused), civ).toContain('The village card from C2 has left the hand')
      expect(offersOf(gone), civ).toEqual([])
      expect(gone.assistedActions.at(-1)?.status, civ).toBe('applied')
      expect(villageTokens(gone), civ).toHaveLength(0)
    }
  })

  it('keeps the token and the card out of reach of the board Undo: only the claim undo gives them back', () => {
    const taken = accepted({ civ: 'Japanese' })
    expect(undoLastBoardChange(taken, CASH1981).ok).toBe(false)
    const undone = undoByVote(taken, 'claim-1')
    expect(villageTokens(undone)).toHaveLength(1)
    expect(villageCards(undone)).toHaveLength(0)
    expect(offersOf(undone)).toHaveLength(1)
  })

  it('refuses to undo the end of the battle while the village was taken, and allows it after the take-back', () => {
    const ended = wonVillage({ civ: 'Japanese' })
    const taken = unwrap(claim(ended, offersOf(ended)[0]?.id ?? '', true))
    expect(undoEndBattle(taken, { playerId: CASH1981 }).ok).toBe(false)
    const undone = unwrap(undoEndBattle(undoByVote(taken, 'claim-1'), { playerId: CASH1981 }))
    expect(undone.conquestOffers).toBeUndefined()
    expect(villageTokens(undone)).toHaveLength(1)
  })
})
