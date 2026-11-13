/**
 * The card abilities of the unit techs (issue #327): Mathematics and Ballistics (Iron wounds in a battle),
 * Gunpowder (Any 2) and Combustion (once per turn, a building or walls).
 */

import { describe, expect, it } from 'vitest'

import { endBattleAction, initiateBattle, killArenaUnit, placeUnitInArena, techWound } from '../src/actions/arena.js'
import { draw, drawUnitsForBattle } from '../src/actions/draw.js'
import { undoLastBoardChange } from '../src/actions/board.js'
import { chooseTech, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { assistedAvailability, performAssistedAction, availableActionsFor } from '../src/assisted.js'
import type { AssistedActionKind } from '../src/state.js'
import { techWoundsOwed } from '../src/battle-cards.js'
import { combustionTargets } from '../src/combustion.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { GameState } from '../src/state.js'

import { player, withHutInHand, withPieceInArea } from './assisted-fixture.js'
import { coverMap } from './cover-map.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'
import { put, sotTurn } from './sot-fixture.js'

const AT = '2026-11-13T12:00:00.000Z'

const withTech = (state: GameState, techName: string, playerId = CASH1981, reveal = true): GameState => {
  const chosen = unwrap(chooseTech(state, { playerId, techName }))
  return reveal ? unwrap(revealTech(chosen, { playerId, techName })) : chosen
}

const voted = (state: GameState, requestId: string): GameState => {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line for the action')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of [KARANDRAS1, ITCHI, CHUL]) {
    next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  }
  return next
}

const press = (
  state: GameState,
  action: AssistedActionKind,
  requestId = 'req-1',
  payload?: Record<string, unknown>,
  confirmedRepeat = false,
  playerId = CASH1981,
) =>
  performAssistedAction(state, {
    playerId,
    action,
    requestId,
    at: AT,
    ...(payload === undefined ? {} : { payload: payload as never }),
    ...(confirmedRepeat ? { confirmedRepeat } : {}),
  })

const hasHut = (state: GameState, name: string, playerId = CASH1981): boolean =>
  player(state, playerId).items.some((item) => item.kind === 'hut' && item.name === name && !item.used)

// ---------------------------------------------------------------------------
// Mathematics and Ballistics
// ---------------------------------------------------------------------------

/** Cash (attacker) and Karandras (defender) each have `count` infantry in the arena, 3 health each. */
function fight(count = 2): GameState {
  let state = firstCivGame()
  for (const playerId of [CASH1981, KARANDRAS1]) {
    for (let i = 0; i < count; i++) state = unwrap(draw(state, { playerId, sheetName: 'INFANTRY', confirmedOutOfTurn: true }))
    state = unwrap(drawUnitsForBattle(state, { playerId, numberOfDraws: count }))
  }
  state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))
  for (const [playerId, side, first] of [
    [CASH1981, 'attacker', 0],
    [KARANDRAS1, 'defender', 10],
  ] as const) {
    for (const [index, unit] of (findPlayer(state, playerId)?.battlehand ?? []).entries()) {
      state = unwrap(placeUnitInArena(state, { playerId, unitId: unit.id, side, position: first + index, attack: 1, health: 3 }))
    }
  }
  return state
}

const enemyUnits = (state: GameState) => (state.battle?.arena ?? []).filter((unit) => unit.placedBy === KARANDRAS1)
const ownUnits = (state: GameState) => (state.battle?.arena ?? []).filter((unit) => unit.placedBy === CASH1981)

const WOUND_TECHS = [
  ['mathematics', 'Mathematics', 3],
  ['ballistics', 'Ballistics', 6],
] as const

describe.each(WOUND_TECHS)('%s (%s, up to %i wounds)', (kind, tech, wounds) => {
  const armed = (): GameState => withHutInHand(withTech(fight(), tech), 'Iron').state
  const used = (): GameState => unwrap(press(armed(), kind))
  const wound = (state: GameState, unitId: string) => techWound(state, { playerId: CASH1981, tech, arenaUnitId: unitId })

  it('is not available outside a battle, and says so', () => {
    const state = withHutInHand(withTech(firstCivGame(), tech), 'Iron').state
    expect(assistedAvailability(state, CASH1981, kind)).toMatchObject({ status: 'wrong-phase' })
    expect(unwrapErr(press(state, kind)).kind).toBe('ASSISTED_ACTION_REJECTED')
  })

  it('is not available without the tech revealed, or to a player outside the battle', () => {
    const hidden = withHutInHand(withTech(fight(), tech, CASH1981, false), 'Iron').state
    expect(assistedAvailability(hidden, CASH1981, kind)).toMatchObject({ status: 'unavailable' })
    expect(assistedAvailability(withHutInHand(fight(), 'Iron').state, CASH1981, kind)).toMatchObject({ status: 'not-owned' })
    const bystander = withHutInHand(withTech(fight(), tech, ITCHI), 'Iron', ITCHI).state
    expect(assistedAvailability(bystander, ITCHI, kind)).toMatchObject({ status: 'unavailable' })
    expect(unwrapErr(press(bystander, kind, 'req-itchi', undefined, false, ITCHI)).kind).toBe('ASSISTED_ACTION_REJECTED')
  })

  it('needs an Iron token', () => {
    const state = withTech(fight(), tech)
    expect(assistedAvailability(state, CASH1981, kind)).toMatchObject({ status: 'needs-resource' })
    expect(unwrapErr(press(state, kind)).kind).toBe('ASSISTED_ACTION_REJECTED')
    // Another resource does not pay for it
    expect(assistedAvailability(withHutInHand(state, 'Wheat').state, CASH1981, kind).status).toBe('needs-resource')
  })

  it('spends the Iron, owes the wounds and writes a public line', () => {
    const state = used()
    expect(hasHut(state, 'Iron')).toBe(false)
    expect(techWoundsOwed(state.battle!, CASH1981, tech)).toBe(wounds)
    expect(state.log.at(-1)?.publicLog).toContain(`used ${tech}: spent 1 Iron to deal up to ${wounds} wounds`)
    expect(player(state).playerTurns.at(-1)?.usedActions).toContain(`card:${tech}`)
    expect(assistedAvailability(state, CASH1981, kind).status).toBe('used')
  })

  it('also pays with an Iron piece in the player area, and an undo puts that piece back', () => {
    const { state: piece } = withPieceInArea(withTech(fight(), tech), 'resources/iron')
    const paid = unwrap(press(piece, kind))
    expect(paid.board.pieces.some((candidate) => candidate.assetId === 'resources/iron')).toBe(false)
    const undone = voted(paid, 'req-1')
    expect(undone.board.pieces.filter((candidate) => candidate.assetId === 'resources/iron')).toHaveLength(1)
    expect(undoLastBoardChange(paid, CASH1981)).toMatchObject({ ok: false })
  })

  it('deals the wounds one at a time, spread over the enemy units however the player chooses', () => {
    let state = used()
    const [first, second] = enemyUnits(state)
    if (first === undefined || second === undefined) throw new Error('missing enemy units')
    state = unwrap(wound(state, first.id))
    state = unwrap(wound(state, second.id))
    expect(enemyUnits(state).map((unit) => unit.health)).toEqual([2, 2])
    expect(techWoundsOwed(state.battle!, CASH1981, tech)).toBe(wounds - 2)
    expect(state.log.at(-1)?.publicLog).toContain(`uses ${tech}: deals 1 wound`)
    // The player may stop early: nothing forces the rest
    expect(state.battle?.arena.some((unit) => unit.killed)).toBe(false)
  })

  it('kills a unit taken to 0 health, and never deals more than it was paid for', () => {
    let state = used()
    const [first, second] = enemyUnits(state)
    if (first === undefined || second === undefined) throw new Error('missing enemy units')
    for (let i = 0; i < 3; i++) state = unwrap(wound(state, first.id))
    expect(enemyUnits(state)[0]).toMatchObject({ health: 0, killed: true })
    expect(unwrapErr(wound(state, first.id)).kind).toBe('BATTLE_CARD_REFUSED')
    // The rest goes to the other unit; 3 + 3 health is more than Mathematics owes in total
    let dealt = 3
    while (dealt < wounds) {
      state = unwrap(wound(state, second.id))
      dealt += 1
    }
    expect(techWoundsOwed(state.battle!, CASH1981, tech)).toBe(0)
    const refused = unwrapErr(wound(state, second.id))
    expect(refused.kind).toBe('BATTLE_CARD_REFUSED')
  })

  it('deals nothing that was not paid for, to own units, to a killed unit or for another tech', () => {
    const unpaid = withTech(fight(), tech)
    const target = enemyUnits(unpaid)[0]
    if (target === undefined) throw new Error('missing enemy unit')
    expect(unwrapErr(wound(unpaid, target.id)).kind).toBe('BATTLE_CARD_REFUSED')

    const paid = used()
    const own = ownUnits(paid)[0]
    if (own === undefined) throw new Error('missing own unit')
    expect(unwrapErr(wound(paid, own.id)).kind).toBe('BATTLE_CARD_REFUSED')
    expect(unwrapErr(wound(paid, 'nobody')).kind).toBe('ARENA_UNIT_NOT_FOUND')
    // The opponent paid nothing, so their wound is refused even though the battle has the entry
    expect(unwrapErr(techWound(paid, { playerId: KARANDRAS1, tech, arenaUnitId: own.id })).kind).toBe('BATTLE_CARD_REFUSED')
    const other = tech === 'Mathematics' ? 'Ballistics' : 'Mathematics'
    expect(unwrapErr(techWound(paid, { playerId: CASH1981, tech: other, arenaUnitId: target.id })).kind).toBe('BATTLE_CARD_REFUSED')

    const killed = unwrap(killArenaUnit(paid, { playerId: KARANDRAS1, arenaUnitId: target.id }))
    expect(unwrapErr(wound(killed, target.id)).kind).toBe('BATTLE_CARD_REFUSED')
  })

  it('a second use in the same turn needs the confirmation and another Iron', () => {
    const state = withHutInHand(used(), 'Iron').state
    expect(unwrapErr(press(state, kind, 'req-2')).kind).toBe('ASSISTED_ACTION_REJECTED')
    const again = unwrap(press(state, kind, 'req-2', undefined, true))
    expect(techWoundsOwed(again.battle!, CASH1981, tech)).toBe(wounds * 2)
  })

  it('an undo by vote returns the Iron and the wounds are no longer owed', () => {
    const undone = voted(used(), 'req-1')
    expect(hasHut(undone, 'Iron')).toBe(true)
    expect(undone.battle?.techWounds).toBeUndefined()
    expect(player(undone).playerTurns.at(-1)?.usedActions).not.toContain(`card:${tech}`)
    expect(undone.log.at(-1)?.publicLog).toContain(`${tech} was undone`)
    // The wound can no longer be dealt
    const target = enemyUnits(undone)[0]
    if (target === undefined) throw new Error('missing enemy unit')
    expect(unwrapErr(wound(undone, target.id)).kind).toBe('BATTLE_CARD_REFUSED')
  })

  it('an undo is refused once a wound has been dealt, and nothing changes', () => {
    let state = used()
    const target = enemyUnits(state)[0]
    if (target === undefined) throw new Error('missing enemy unit')
    state = unwrap(wound(state, target.id))
    const entry = state.log.find((candidate) => candidate.assistedActionId === 'req-1')
    if (entry === undefined) throw new Error('no log line')
    let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
    for (const playerId of [KARANDRAS1, ITCHI]) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
    const refused = unwrapErr(vote(next, { logId: entry.id, playerId: CHUL, vote: true, at: AT }))
    expect(refused.kind).toBe('ASSISTED_UNDO_BLOCKED')
    // The refused vote is an error value, so the state it was asked on stands: still applied, Iron still paid, wound still dealt
    expect(next.assistedActions.find((record) => record.id === 'req-1')?.status).toBe('applied')
    expect(hasHut(next, 'Iron')).toBe(false)
    expect(next.battle?.techWounds?.[0]?.dealt).toBe(1)
  })

  it('an undo is refused once the battle is over and gone, since wounds already dealt cannot be ruled out', () => {
    const paid = used()
    const ended = unwrap(endBattleAction(paid, { playerId: CASH1981 }))
    // A new battle closes the window of the one set aside
    const next = unwrap(initiateBattle(ended, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))
    expect(next.endedBattle).toBeNull()
    const entry = next.log.find((candidate) => candidate.assistedActionId === 'req-1')
    if (entry === undefined) throw new Error('no log line')
    let asked = unwrap(initiateUndo(next, { logId: entry.id, playerId: CASH1981 }))
    for (const playerId of [KARANDRAS1, ITCHI]) asked = unwrap(vote(asked, { logId: entry.id, playerId, vote: true, at: AT }))
    const refused = unwrapErr(vote(asked, { logId: entry.id, playerId: CHUL, vote: true, at: AT }))
    expect(refused).toMatchObject({ kind: 'ASSISTED_UNDO_BLOCKED' })
    expect(JSON.stringify(refused)).toContain('battle is over')
    expect(hasHut(asked, 'Iron')).toBe(false)
  })

  it('an undo after End battle works on the battle set aside while no wound was dealt, and not after one', () => {
    const ended = unwrap(endBattleAction(used(), { playerId: CASH1981 }))
    expect(ended.battle).toBeNull()
    expect(ended.endedBattle?.battle.techWounds).toHaveLength(1)
    const undone = voted(ended, 'req-1')
    expect(hasHut(undone, 'Iron')).toBe(true)
    expect(undone.endedBattle?.battle.techWounds).toBeUndefined()

    let dealt = used()
    const target = enemyUnits(dealt)[0]
    if (target === undefined) throw new Error('missing enemy unit')
    dealt = unwrap(wound(dealt, target.id))
    const endedAfter = unwrap(endBattleAction(dealt, { playerId: CASH1981 }))
    const entry = endedAfter.log.find((candidate) => candidate.assistedActionId === 'req-1')
    if (entry === undefined) throw new Error('no log line')
    let asked = unwrap(initiateUndo(endedAfter, { logId: entry.id, playerId: CASH1981 }))
    for (const playerId of [KARANDRAS1, ITCHI]) asked = unwrap(vote(asked, { logId: entry.id, playerId, vote: true, at: AT }))
    expect(unwrapErr(vote(asked, { logId: entry.id, playerId: CHUL, vote: true, at: AT })).kind).toBe('ASSISTED_UNDO_BLOCKED')
  })

  it('a confirmed repeat owes a second set of wounds: the first is dealt first, and the second can be undone alone', () => {
    const first = used()
    const state = unwrap(press(withHutInHand(first, 'Iron').state, kind, 'req-2', undefined, true))
    const target = enemyUnits(state)[0]
    if (target === undefined) throw new Error('missing enemy unit')
    const hit = unwrap(wound(state, target.id))
    const [one, two] = hit.battle?.techWounds ?? []
    expect([one?.actionId, one?.dealt, two?.actionId, two?.dealt]).toEqual(['req-1', 1, 'req-2', 0])

    // The second record holds no dealt wound, so it can go while the first one's wound stays
    const undone = voted(hit, 'req-2')
    expect(hasHut(undone, 'Iron')).toBe(true)
    expect(undone.battle?.techWounds?.map((entry) => entry.actionId)).toEqual(['req-1'])
    expect(undone.assistedActions.find((record) => record.id === 'req-1')?.status).toBe('applied')
    // Another use stays held by the first record, so the key is not freed
    expect(player(undone).playerTurns.at(-1)?.usedActions).toContain(`card:${tech}`)

    // The first record's wound is dealt, so its undo is refused
    const entry = hit.log.find((candidate) => candidate.assistedActionId === 'req-1')
    if (entry === undefined) throw new Error('no log line')
    let asked = unwrap(initiateUndo(hit, { logId: entry.id, playerId: CASH1981 }))
    for (const playerId of [KARANDRAS1, ITCHI]) asked = unwrap(vote(asked, { logId: entry.id, playerId, vote: true, at: AT }))
    expect(unwrapErr(vote(asked, { logId: entry.id, playerId: CHUL, vote: true, at: AT })).kind).toBe('ASSISTED_UNDO_BLOCKED')
  })

  it('is listed in availableActions with its tech name and the Battle group, for the viewer only', () => {
    const state = armed()
    const mine = availableActionsFor(state, CASH1981).find((entry) => entry.action === kind)
    expect(mine).toMatchObject({ techName: tech, group: 'Battle', phase: 'ANY', status: 'ready' })
    // The wounds owed are plain battle state and the tech is revealed, so nothing private is in the opponent's view
    const paid = used()
    const view = JSON.stringify(toPlayerView(paid, KARANDRAS1))
    expect(view).not.toContain('resources/iron')
    expect(view).toContain('techWounds')
  })
})

describe('Mathematics against barbarians, and with no battle', () => {
  it('the player who controls the barbarians is no combatant: no button, no wound', () => {
    // KARANDRAS1 is to Cash's left, so controls the barbarians
    let state = withHutInHand(withTech(firstCivGame(), 'Mathematics', KARANDRAS1), 'Iron', KARANDRAS1).state
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: 'barbarians' }))
    expect(state.battle?.defender).toEqual({ kind: 'barbarians', playerId: KARANDRAS1 })
    expect(assistedAvailability(state, KARANDRAS1, 'mathematics')).toMatchObject({ status: 'unavailable' })
    expect(unwrapErr(press(state, 'mathematics', 'req-b', undefined, false, KARANDRAS1)).kind).toBe('ASSISTED_ACTION_REJECTED')
    expect(unwrapErr(techWound(state, { playerId: KARANDRAS1, tech: 'Mathematics', arenaUnitId: 'any' })).kind).toBe('NOT_IN_THIS_BATTLE')
  })

  it('techWound with no battle on is refused', () => {
    expect(unwrapErr(techWound(firstCivGame(), { playerId: CASH1981, tech: 'Mathematics', arenaUnitId: 'any' })).kind).toBe('NO_BATTLE_ACTIVE')
  })
})

// ---------------------------------------------------------------------------
// Gunpowder
// ---------------------------------------------------------------------------

function gunpowderTurn(): GameState {
  const state = withTech(firstCivGame(), 'Gunpowder')
  return unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))
}

describe('Gunpowder (Any 2, City Management)', () => {
  const rich = (): GameState => withHutInHand(withHutInHand(gunpowderTurn(), 'Iron').state, 'Wheat').state

  it('needs two tokens of any kind, in City Management with the tech revealed', () => {
    expect(assistedAvailability(gunpowderTurn(), CASH1981, 'gunpowder')).toMatchObject({ status: 'needs-resource' })
    const one = withHutInHand(gunpowderTurn(), 'Iron').state
    expect(assistedAvailability(one, CASH1981, 'gunpowder').status).toBe('needs-resource')
    expect(assistedAvailability(rich(), CASH1981, 'gunpowder').status).toBe('ready')
    expect(assistedAvailability(withHutInHand(withHutInHand(gunpowderTurn(), 'Iron').state, 'Iron').state, CASH1981, 'gunpowder').status).toBe('ready')

    const hidden = withHutInHand(withHutInHand(unwrap(markPhasesDone(withTech(firstCivGame(), 'Gunpowder', CASH1981, false), { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' })), 'Iron').state, 'Wheat').state
    expect(assistedAvailability(hidden, CASH1981, 'gunpowder').status).toBe('unavailable')
    const sot = withHutInHand(withHutInHand(withTech(firstCivGame(), 'Gunpowder'), 'Iron').state, 'Wheat').state
    expect(assistedAvailability(sot, CASH1981, 'gunpowder').status).toBe('wrong-phase')
  })

  it('pays the two tokens the player named, logs it and says the effect is made by hand', () => {
    const state = rich()
    const paid = unwrap(press(state, 'gunpowder', 'req-1', { resources: ['Iron', 'Wheat'] }))
    expect(hasHut(paid, 'Iron')).toBe(false)
    expect(hasHut(paid, 'Wheat')).toBe(false)
    expect(paid.log.at(-1)?.publicLog).toContain('used Gunpowder: spent Iron and Wheat')
    expect(paid.log.at(-1)?.publicLog).toContain('by hand')
    expect(assistedAvailability(paid, CASH1981, 'gunpowder').status).toBe('used')
    expect(paid.assistedActions.at(-1)?.effect).toMatchObject({ kind: 'gunpowder' })
  })

  it('pays the same resource twice when the player holds two, and leaves the other tokens alone', () => {
    const state = withHutInHand(withHutInHand(withHutInHand(gunpowderTurn(), 'Iron').state, 'Iron').state, 'Silk').state
    const paid = unwrap(press(state, 'gunpowder', 'req-1', { resources: ['iron', 'Iron'] }))
    expect(hasHut(paid, 'Iron')).toBe(false)
    expect(hasHut(paid, 'Silk')).toBe(true)
  })

  it('pays with pieces in the player area as well as huts', () => {
    const base = withHutInHand(gunpowderTurn(), 'Iron').state
    const { state } = withPieceInArea(base, 'resources/wheat')
    const paid = unwrap(press(state, 'gunpowder', 'req-1', { resources: ['Iron', 'Wheat'] }))
    expect(paid.board.pieces.some((piece) => piece.assetId === 'resources/wheat')).toBe(false)
    expect(hasHut(paid, 'Iron')).toBe(false)
  })

  it('refuses a payment that is not exactly two known resources the player holds', () => {
    const state = rich()
    for (const resources of [['Iron'], ['Iron', 'Wheat', 'Silk'], ['Iron', 'Gold'], ['Iron', 'Iron'], [1, 2]]) {
      expect(unwrapErr(press(state, 'gunpowder', 'req-1', { resources })).kind).toBe('ASSISTED_ACTION_REJECTED')
    }
    expect(unwrapErr(press(state, 'gunpowder', 'req-1')).kind).toBe('ASSISTED_ACTION_REJECTED')
    expect(unwrapErr(press(state, 'gunpowder', 'req-1', { resources: 'Iron' })).kind).toBe('ASSISTED_ACTION_REJECTED')
    // A refusal pays nothing
    expect(hasHut(state, 'Iron')).toBe(true)
    expect(state.assistedActions).toHaveLength(0)
  })

  it('is once per turn, with a confirmed repeat', () => {
    const state = withHutInHand(withHutInHand(rich(), 'Silk').state, 'Incense').state
    const first = unwrap(press(state, 'gunpowder', 'req-1', { resources: ['Iron', 'Wheat'] }))
    expect(unwrapErr(press(first, 'gunpowder', 'req-2', { resources: ['Silk', 'Incense'] })).kind).toBe('ASSISTED_ACTION_REJECTED')
    const second = unwrap(press(first, 'gunpowder', 'req-2', { resources: ['Silk', 'Incense'] }, true))
    expect(second.log.at(-1)?.publicLog).toContain('confirmed by the player')
  })

  it('an undo by vote returns exactly the tokens that were spent', () => {
    const base = withHutInHand(rich(), 'Silk').state
    const { state, piece } = withPieceInArea(base, 'resources/iron')
    const paid = unwrap(press(state, 'gunpowder', 'req-1', { resources: ['Iron', 'Silk'] }))
    // An Iron hut comes before an Iron piece, so the hut is paid and the piece stays
    expect(hasHut(paid, 'Iron')).toBe(false)
    expect(paid.board.pieces.some((candidate) => candidate.id === piece.id)).toBe(true)
    const undone = voted(paid, 'req-1')
    expect(hasHut(undone, 'Iron')).toBe(true)
    expect(hasHut(undone, 'Silk')).toBe(true)
    expect(hasHut(undone, 'Wheat')).toBe(true)
    expect(player(undone).playerTurns.at(-1)?.usedActions).not.toContain('card:Gunpowder')

    // Two pieces paid, two pieces back, where they were
    const pieces = withPieceInArea(withPieceInArea(gunpowderTurn(), 'resources/iron').state, 'resources/wheat').state
    const before = [...pieces.board.pieces].map((candidate) => candidate.id).sort()
    const piecesPaid = unwrap(press(pieces, 'gunpowder', 'req-p', { resources: ['Iron', 'Wheat'] }))
    expect(piecesPaid.board.pieces).toHaveLength(pieces.board.pieces.length - 2)
    expect(undoLastBoardChange(piecesPaid, CASH1981)).toMatchObject({ ok: false })
    const piecesBack = voted(piecesPaid, 'req-p')
    expect([...piecesBack.board.pieces].map((candidate) => candidate.id).sort()).toEqual(before)
  })
})

// ---------------------------------------------------------------------------
// Combustion
// ---------------------------------------------------------------------------

function combustionTurn(): GameState {
  const state = coverMap(sotTurn({ techs: ['Combustion'] }))
  return unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' }))
}

describe('Combustion (once per turn, in Movement)', () => {
  const onBuilding = (): GameState => put(put(combustionTurn(), CASH1981, 'buildings/granary', 3, 3), CASH1981, 'figures/redarmy', 3, 3)
  const onWalls = (): GameState => put(put(combustionTurn(), KARANDRAS1, 'cities/bluecitywalled2', 5, 4), CASH1981, 'figures/redarmy', 5, 4)

  it('is ready in the open Movement phase only, with the tech revealed', () => {
    expect(assistedAvailability(combustionTurn(), CASH1981, 'combustion').status).toBe('ready')
    const cm = unwrap(markPhasesDone(sotTurn({ techs: ['Combustion'] }), { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))
    expect(assistedAvailability(cm, CASH1981, 'combustion').status).toBe('wrong-phase')
    expect(assistedAvailability(unwrap(markPhasesDone(sotTurn(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' })), CASH1981, 'combustion').status).toBe('not-owned')
  })

  it('finds the squares where an army stands on a building or on a walled city', () => {
    expect(combustionTargets(onBuilding().board, player(onBuilding()))).toMatchObject([{ column: 3, row: 3, walls: false }])
    expect(combustionTargets(onWalls().board, player(onWalls()))).toMatchObject([{ column: 5, row: 4, walls: true }])
    // A building with no army on it, and an army on an empty square, are not targets
    const idle = put(put(combustionTurn(), CASH1981, 'buildings/granary', 3, 3), CASH1981, 'figures/redarmy', 4, 4)
    expect(combustionTargets(idle.board, player(idle))).toEqual([])
    // A scout is not an army
    const scout = put(put(combustionTurn(), CASH1981, 'buildings/granary', 3, 3), CASH1981, 'figures/redscout', 3, 3)
    expect(combustionTargets(scout.board, player(scout))).toEqual([])
  })

  it('never targets the walls of the player own city, but still those of another player', () => {
    const own = put(put(combustionTurn(), CASH1981, 'cities/redcitywalled2', 5, 4), CASH1981, 'figures/redarmy', 5, 4)
    expect(combustionTargets(own.board, player(own))).toEqual([])
    const refused = unwrapErr(press(own, 'combustion', 'req-1', { square: { column: 5, row: 4 } }))
    expect(refused.kind).toBe('ASSISTED_ACTION_REJECTED')
    expect(own.assistedActions).toHaveLength(0)
    // Cash is Red; a Blue walled city on the same square is a target
    expect(combustionTargets(onWalls().board, player(onWalls()))).toMatchObject([{ column: 5, row: 4, walls: true }])
    expect(unwrap(press(onWalls(), 'combustion', 'req-2', { square: { column: 5, row: 4 } })).assistedActions).toHaveLength(1)
  })

  it('logs the destruction of a building, once per turn, and says the removal is by hand', () => {
    const used = unwrap(press(onBuilding(), 'combustion', 'req-1', { square: { column: 3, row: 3 } }))
    expect(used.log.at(-1)?.publicLog).toContain('used Combustion: an army destroys')
    expect(used.log.at(-1)?.publicLog).toContain('Remove the building from the map by hand')
    expect(used.assistedActions.at(-1)?.effect).toMatchObject({ kind: 'combustion', walls: false, square: { column: 3, row: 3 } })
    // The engine does not remove the building: that is manual
    expect(used.board.pieces.some((piece) => piece.assetId === 'buildings/granary')).toBe(true)
    expect(assistedAvailability(used, CASH1981, 'combustion').status).toBe('used')
    expect(unwrapErr(press(used, 'combustion', 'req-2', { square: { column: 3, row: 3 } })).kind).toBe('ASSISTED_ACTION_REJECTED')
    expect(unwrap(press(used, 'combustion', 'req-2', { square: { column: 3, row: 3 } }, true)).log.at(-1)?.publicLog).toContain('confirmed by the player')
  })

  it('names the walls of a walled city an army attacks', () => {
    const used = unwrap(press(onWalls(), 'combustion', 'req-1', { square: { column: 5, row: 4 } }))
    expect(used.log.at(-1)?.publicLog).toContain('the walls of')
    expect(used.log.at(-1)?.publicLog).toContain('unwalled side by hand')
    expect(used.assistedActions.at(-1)?.effect).toMatchObject({ kind: 'combustion', walls: true })
  })

  it('refuses a square with no army on a building or walled city, or off the map', () => {
    const state = onBuilding()
    expect(unwrapErr(press(state, 'combustion', 'req-1', { square: { column: 4, row: 4 } })).kind).toBe('ASSISTED_ACTION_REJECTED')
    expect(unwrapErr(press(state, 'combustion', 'req-1', { square: { column: 999, row: 999 } })).kind).toBe('ASSISTED_ACTION_REJECTED')
    expect(unwrapErr(press(state, 'combustion', 'req-1')).kind).toBe('ASSISTED_ACTION_REJECTED')
    expect(state.assistedActions).toHaveLength(0)
  })

  it('an undo by vote frees the use for the turn', () => {
    const used = unwrap(press(onBuilding(), 'combustion', 'req-1', { square: { column: 3, row: 3 } }))
    const undone = voted(used, 'req-1')
    expect(assistedAvailability(undone, CASH1981, 'combustion').status).toBe('ready')
    expect(undone.log.at(-1)?.publicLog).toContain('Combustion was undone')
  })
})
