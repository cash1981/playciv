/**
 * Georgy Zhukov and Gustavus Adolphus (issue #301).
 *
 * Zhukov: "Each time one of your units is killed during a battle, deal 1 wound to an enemy unit of your choice."
 * Gustavus Adolphus: kill the units of the battle force (they cannot be saved) and build as many new ones
 * ("man får lov å velge samme antall nye og de som er unlocked" - the human).
 */

import { describe, expect, it } from 'vitest'

import { endBattleAction, initiateBattle, killArenaUnit, moveArenaUnit, placeUnitInArena, setArenaUnitStat, zhukovWound } from '../src/actions/arena.js'
import { draw, drawUnitsForBattle } from '../src/actions/draw.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { performAssistedAction } from '../src/assisted.js'
import { playableCardsOf } from '../src/assisted-cards.js'
import { zhukovOwed } from '../src/battle-cards.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { GameState } from '../src/state.js'

import { withCardInHand } from './assisted-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-11-02T12:00:00.000Z'
const ZHUKOV = 'Georgy Zhukov'
const GUSTAVUS = 'Gustavus Adolphus'

/** Each side has `drawn` units in the battlehand and has placed the first `placed` of them in the arena. */
function fight(drawn: readonly [number, number], placed: readonly [number, number]): GameState {
  let state = firstCivGame()
  for (const [playerId, count] of [
    [CASH1981, drawn[0]],
    [KARANDRAS1, drawn[1]],
  ] as const) {
    for (let i = 0; i < count; i++) state = unwrap(draw(state, { playerId, sheetName: 'INFANTRY', confirmedOutOfTurn: true }))
    state = unwrap(drawUnitsForBattle(state, { playerId, numberOfDraws: count }))
  }
  state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))
  const place = (playerId: string, side: 'attacker' | 'defender', first: number, count: number): void => {
    for (const [index, unit] of (findPlayer(state, playerId)?.battlehand ?? []).slice(0, count).entries()) {
      state = unwrap(placeUnitInArena(state, { playerId, unitId: unit.id, side, position: first + index, attack: 1, health: 3 }))
    }
  }
  place(CASH1981, 'attacker', 0, placed[0])
  place(KARANDRAS1, 'defender', 10, placed[1])
  return state
}

const holding = (state: GameState, name: string, playerId: string) => {
  const card = withCardInHand(state, name, playerId)
  return { state: card.state, cardId: card.itemId }
}

const play = (state: GameState, playerId: string, cardId: string, requestId = 'g1', units?: readonly string[]) =>
  performAssistedAction(state, {
    playerId,
    action: 'playCard',
    requestId,
    at: AT,
    payload: { itemId: cardId, targets: [], ...(units === undefined ? {} : { units }) },
  })

const statusOf = (state: GameState, playerId: string, name: string) => {
  const card = playableCardsOf(state, findPlayer(state, playerId)!).find((candidate) => candidate.name === name)
  if (card === undefined) throw new Error(`${name} is not listed`)
  return card
}

function undoByVote(state: GameState, playerId: string, requestId: string) {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line for the action')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId }))
  for (const voter of [CASH1981, KARANDRAS1, ITCHI, CHUL].filter((id) => id !== playerId)) {
    next = unwrap(vote(next, { logId: entry.id, playerId: voter, vote: true, at: AT }))
  }
  return next
}

const unitOf = (state: GameState, playerId: string, index = 0) => {
  const unit = (state.battle?.arena ?? []).filter((candidate) => candidate.placedBy === playerId)[index]
  if (unit === undefined) throw new Error('no arena unit')
  return unit
}

const kill = (state: GameState, playerId: string, index = 0): GameState =>
  unwrap(killArenaUnit(state, { playerId, arenaUnitId: unitOf(state, playerId, index).id }))

describe('Georgy Zhukov', () => {
  const armed = () => {
    const { state, cardId } = holding(fight([2, 2], [2, 2]), ZHUKOV, CASH1981)
    return { state: unwrap(play(state, CASH1981, cardId)), cardId }
  }

  it('is ready for either combatant, stays faceup and works once per battle', () => {
    const base = holding(fight([2, 2], [2, 2]), ZHUKOV, KARANDRAS1).state
    expect(statusOf(base, KARANDRAS1, ZHUKOV).status).toBe('ready')
    const { state, cardId } = holding(fight([2, 2], [2, 2]), ZHUKOV, CASH1981)
    const played = unwrap(play(state, CASH1981, cardId))
    expect(findPlayer(played, CASH1981)?.items.find((item) => item.id === cardId)?.hidden).toBe(false)
    expect(played.log.at(-1)?.publicLog).toContain('used Georgy Zhukov (battle)')
    expect(statusOf(played, CASH1981, ZHUKOV).reason).toContain('already been played')
  })

  it('owes a wound for each of the player units killed after the card was played, and none before', () => {
    const early = kill(fight([2, 2], [2, 2]), CASH1981, 0)
    const { state, cardId } = holding(early, ZHUKOV, CASH1981)
    const played = unwrap(play(state, CASH1981, cardId))
    expect(zhukovOwed(played.battle!, CASH1981)).toBe(0)
    const after = kill(played, CASH1981, 1)
    expect(zhukovOwed(after.battle!, CASH1981)).toBe(1)
    // The opponent's dead units earn nothing
    expect(zhukovOwed(kill(played, KARANDRAS1).battle!, CASH1981)).toBe(0)
  })

  it('deals 1 wound to a living enemy unit, once for each kill', () => {
    const killed = kill(armed().state, CASH1981)
    const target = unitOf(killed, KARANDRAS1)
    const hit = unwrap(zhukovWound(killed, { playerId: CASH1981, arenaUnitId: target.id }))
    expect(hit.battle?.arena.find((unit) => unit.id === target.id)?.health).toBe(target.health - 1)
    expect(hit.log.at(-1)?.publicLog).toContain('Georgy Zhukov')
    expect(zhukovOwed(hit.battle!, CASH1981)).toBe(0)
    expect(unwrapErr(zhukovWound(hit, { playerId: CASH1981, arenaUnitId: target.id })).kind).toBe('BATTLE_CARD_REFUSED')
  })

  it('kills an enemy unit taken to 0 health', () => {
    const target = unitOf(armed().state, KARANDRAS1)
    const weak = unwrap(setArenaUnitStat(armed().state, { playerId: KARANDRAS1, arenaUnitId: target.id, key: 'health', value: 1 }))
    const owed = kill(weak, CASH1981)
    const dead = unwrap(zhukovWound(owed, { playerId: CASH1981, arenaUnitId: target.id }))
    expect(dead.battle?.arena.find((unit) => unit.id === target.id)).toMatchObject({ health: 0, killed: true })
    expect(dead.log.at(-1)?.publicLog).toContain('which is killed')
    // Wounds are owed only to a side that played him
    expect(zhukovOwed(dead.battle!, KARANDRAS1)).toBe(0)
  })

  it('counts the units that were dead when he was played by id, so a taken-back kill does not hide a real one', () => {
    const early = kill(fight([2, 2], [2, 2]), CASH1981, 0)
    const { state, cardId } = holding(early, ZHUKOV, CASH1981)
    const played = unwrap(play(state, CASH1981, cardId))
    const revived = kill(played, CASH1981, 0)
    expect(revived.battle?.arena.find((unit) => unit.id === unitOf(revived, CASH1981, 0).id)?.killed).toBe(false)
    expect(zhukovOwed(kill(revived, CASH1981, 1).battle!, CASH1981)).toBe(1)
  })

  it('counts a killed unit that another unit replaced on its front, and one Nightingale saved', () => {
    const { state, cardId } = holding(fight([3, 2], [3, 2]), ZHUKOV, CASH1981)
    const played = unwrap(play(state, CASH1981, cardId))
    const [dead, mover] = (played.battle?.arena ?? []).filter((unit) => unit.side === 'attacker')
    let next = unwrap(killArenaUnit(played, { playerId: CASH1981, arenaUnitId: dead!.id }))
    next = unwrap(moveArenaUnit(next, { playerId: CASH1981, arenaUnitId: mover!.id, position: dead!.position }))
    expect(next.battle?.departedUnits.some((unit) => unit.id === dead!.id)).toBe(true)
    expect(zhukovOwed(next.battle!, CASH1981)).toBe(1)
    const { state: held, cardId: florence } = holding(next, 'Florence Nightingale', CASH1981)
    const saved = unwrap(play(held, CASH1981, florence, 'g3'))
    expect(zhukovOwed(saved.battle!, CASH1981)).toBe(1)
  })

  it('is refused for the controller of the barbarians', () => {
    const barbarians = unwrap(initiateBattle(firstCivGame(), { initiatorId: CASH1981, opponentId: 'barbarians' }))
    const controller = barbarians.battle!.defender.playerId
    expect(statusOf(holding(barbarians, ZHUKOV, controller).state, controller, ZHUKOV).reason).toBe('You are not fighting in this battle.')
  })

  it('refuses a friendly unit, a killed unit, and a player who has not played him', () => {
    const killed = kill(armed().state, CASH1981)
    expect(unwrapErr(zhukovWound(killed, { playerId: CASH1981, arenaUnitId: unitOf(killed, CASH1981, 1).id })).kind).toBe('BATTLE_CARD_REFUSED')
    const dead = kill(killed, KARANDRAS1)
    expect(unwrapErr(zhukovWound(dead, { playerId: CASH1981, arenaUnitId: unitOf(dead, KARANDRAS1).id })).kind).toBe('BATTLE_CARD_REFUSED')
    expect(unwrapErr(zhukovWound(killed, { playerId: KARANDRAS1, arenaUnitId: unitOf(killed, CASH1981).id })).kind).toBe('BATTLE_CARD_REFUSED')
  })

  it('can be undone until he has dealt a wound', () => {
    const { state, cardId } = holding(fight([2, 2], [2, 2]), ZHUKOV, CASH1981)
    const played = unwrap(play(state, CASH1981, cardId))
    const undone = undoByVote(played, CASH1981, 'g1')
    expect(undone.battle?.zhukov ?? []).toHaveLength(0)

    const hit = unwrap(zhukovWound(kill(played, CASH1981), { playerId: CASH1981, arenaUnitId: unitOf(played, KARANDRAS1).id }))
    const entry = hit.log.find((candidate) => candidate.assistedActionId === 'g1')!
    const started = unwrap(initiateUndo(hit, { logId: entry.id, playerId: CASH1981 }))
    let blocked = started
    let error: unknown
    for (const voter of [KARANDRAS1, ITCHI, CHUL]) {
      const result = vote(blocked, { logId: entry.id, playerId: voter, vote: true, at: AT })
      if (!result.ok) error = result.error
      else blocked = result.value
    }
    expect(JSON.stringify(error)).toContain('dealt wounds')
  })
})

describe('Gustavus Adolphus', () => {
  /** cash1981 has three units: one in the arena, two still in the battlehand. */
  const base = () => holding(fight([3, 2], [1, 2]), GUSTAVUS, CASH1981)

  it('counts the living arena units and the battlehand units still in hand', () => {
    const { state } = base()
    expect(statusOf(state, CASH1981, GUSTAVUS)).toMatchObject({
      status: 'ready',
      gustavus: { count: 3, sheets: ['INFANTRY', 'MOUNTED', 'ARTILLERY'] },
    })
  })

  it('kills the arena unit for good, discards the unplaced ones and builds as many new units of the chosen types', () => {
    const { state, cardId } = base()
    const before = findPlayer(state, CASH1981)!
    const arenaUnit = unitOf(state, CASH1981)
    const waiting = before.battlehand.filter((unit) => !unit.inBattle).map((unit) => unit.id)
    const after = unwrap(play(state, CASH1981, cardId, 'g1', ['INFANTRY', 'MOUNTED', 'ARTILLERY']))

    expect(unitOf(after, CASH1981)).toMatchObject({ id: arenaUnit.id, killed: true, gustavus: true })
    const player = findPlayer(after, CASH1981)!
    for (const id of waiting) {
      expect(player.items.some((item) => item.id === id)).toBe(false)
      expect(after.discardedItems.some((item) => item.id === id)).toBe(true)
    }
    const fresh = player.battlehand.filter((unit) => !unit.inBattle)
    expect(fresh.map((unit) => unit.kind).sort()).toEqual(['artillery', 'infantry', 'mounted'])
    expect(fresh.every((unit) => player.items.some((item) => item.id === unit.id))).toBe(true)
    const lines = after.log.filter((entry) => entry.playerId === CASH1981 && entry.privateLog.startsWith('Gustavus Adolphus'))
    expect(lines).toHaveLength(4)
    expect(after.log.find((entry) => entry.assistedActionId === 'g1')?.publicLog).toContain('building 3 units')
  })

  it('needs one deck for each unit, and only decks the player has unlocked', () => {
    const { state, cardId } = base()
    expect(unwrapErr(play(state, CASH1981, cardId, 'g1', ['INFANTRY'])).kind).toBe('ASSISTED_ACTION_REJECTED')
    expect(unwrapErr(play(state, CASH1981, cardId, 'g1', ['INFANTRY', 'INFANTRY', 'AIRCRAFT'])).kind).toBe('ASSISTED_ACTION_REJECTED')
    expect(unwrapErr(play(state, CASH1981, cardId, 'g1')).kind).toBe('ASSISTED_ACTION_REJECTED')
  })

  it('is refused with no units in the battle force, and for someone outside the battle', () => {
    const empty = holding(fight([0, 2], [0, 2]), GUSTAVUS, CASH1981).state
    expect(statusOf(empty, CASH1981, GUSTAVUS).status).toBe('wrong-phase')
    const outside = holding(fight([1, 1], [1, 1]), GUSTAVUS, ITCHI).state
    expect(statusOf(outside, ITCHI, GUSTAVUS).reason).toBe('You are not fighting in this battle.')
  })

  it('leaves the units it killed beyond Florence Nightingale', () => {
    const { state, cardId } = base()
    const after = unwrap(play(state, CASH1981, cardId, 'g1', ['INFANTRY', 'INFANTRY', 'INFANTRY']))
    const { state: held } = holding(after, 'Florence Nightingale', CASH1981)
    expect(statusOf(held, CASH1981, 'Florence Nightingale').status).toBe('wrong-phase')
  })

  it('is undone: the arena unit lives, the discarded units return and the new cards go back to the deck', () => {
    const { state, cardId } = base()
    const before = findPlayer(state, CASH1981)!
    const after = unwrap(play(state, CASH1981, cardId, 'g1', ['INFANTRY', 'MOUNTED', 'ARTILLERY']))
    const undone = undoByVote(after, CASH1981, 'g1')
    expect(unitOf(undone, CASH1981)).toMatchObject({ killed: false })
    expect(unitOf(undone, CASH1981).gustavus).toBeUndefined()
    const player = findPlayer(undone, CASH1981)!
    expect(player.battlehand.map((unit) => unit.id).sort()).toEqual(before.battlehand.map((unit) => unit.id).sort())
    expect(new Set(player.items.map((item) => item.id))).toEqual(new Set([...before.items.map((item) => item.id), cardId]))
  })

  it('cannot be undone once a new unit has been put in the arena', () => {
    const { state, cardId } = base()
    const after = unwrap(play(state, CASH1981, cardId, 'g1', ['INFANTRY', 'MOUNTED', 'ARTILLERY']))
    const fresh = findPlayer(after, CASH1981)!.battlehand.find((unit) => !unit.inBattle)!
    const placed = unwrap(placeUnitInArena(after, { playerId: CASH1981, unitId: fresh.id, side: 'attacker', position: 4, attack: 1, health: 1 }))
    const entry = placed.log.find((candidate) => candidate.assistedActionId === 'g1')!
    let next = unwrap(initiateUndo(placed, { logId: entry.id, playerId: CASH1981 }))
    let error: unknown
    for (const voter of [KARANDRAS1, ITCHI, CHUL]) {
      const result = vote(next, { logId: entry.id, playerId: voter, vote: true, at: AT })
      if (!result.ok) error = result.error
      else next = result.value
    }
    expect(JSON.stringify(error)).toContain('no longer free')
  })

  it('cannot be undone once a new unit has fought, not even after End battle', () => {
    const { state, cardId } = base()
    const after = unwrap(play(state, CASH1981, cardId, 'g1', ['INFANTRY', 'MOUNTED', 'ARTILLERY']))
    const fresh = findPlayer(after, CASH1981)!.battlehand.find((unit) => !unit.inBattle)!
    const fought = unwrap(placeUnitInArena(after, { playerId: CASH1981, unitId: fresh.id, side: 'attacker', position: 4, attack: 1, health: 1 }))
    const ended = unwrap(endBattleAction(fought, { playerId: CASH1981 }))
    const entry = ended.log.find((candidate) => candidate.assistedActionId === 'g1')!
    let next = unwrap(initiateUndo(ended, { logId: entry.id, playerId: CASH1981 }))
    let error: unknown
    for (const voter of [KARANDRAS1, ITCHI, CHUL]) {
      const result = vote(next, { logId: entry.id, playerId: voter, vote: true, at: AT })
      if (!result.ok) error = result.error
      else next = result.value
    }
    expect(JSON.stringify(error)).toContain('has been in the arena')
  })

  it('keeps the private lines about the drawn cards out of the other players log', () => {
    const { state, cardId } = base()
    const after = unwrap(play(state, CASH1981, cardId, 'g1', ['INFANTRY', 'MOUNTED', 'ARTILLERY']))
    const fresh = findPlayer(after, CASH1981)!.battlehand.filter((unit) => !unit.inBattle).map((unit) => unit.id)
    const seen = JSON.stringify(toPlayerView(after, KARANDRAS1).log)
    for (const id of fresh) expect(seen).not.toContain(id)
    expect(seen).not.toContain('you built a')
  })
})
