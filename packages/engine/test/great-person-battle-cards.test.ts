/**
 * The battle Great Persons (issue #301): Leonidas, Joan of Arc, Florence Nightingale and Sun Tzu.
 *
 * Leonidas and Joan of Arc are for the defender, Leonidas only with fewer units played than the opponent
 * ("Det krever ikke at Leonidas er faceup" - the human). A card is ready for a combatant in any phase of the
 * turn while a battle is on.
 */

import { describe, expect, it } from 'vitest'

import { endBattleAction, initiateBattle, killArenaUnit, moveArenaUnit, placeUnitInArena, sunTzuPass, undoEndBattle } from '../src/actions/arena.js'
import { draw, drawUnitsForBattle } from '../src/actions/draw.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { performAssistedAction } from '../src/assisted.js'
import { playableCardsOf } from '../src/assisted-cards.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { battleSummaries, findPlayer, toPlayerView, withPlayer } from '../src/state.js'
import type { GameState } from '../src/state.js'

import { withCardInHand } from './assisted-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-11-02T10:00:00.000Z'

/** cash1981 attacks karandras1; each side has put `attackers` and `defenders` infantry in the arena. */
function fight(attackers: number, defenders: number, initial: GameState = firstCivGame()): GameState {
  let state = initial
  for (const [playerId, count] of [
    [CASH1981, attackers],
    [KARANDRAS1, defenders],
  ] as const) {
    for (let i = 0; i < count; i++) state = unwrap(draw(state, { playerId, sheetName: 'INFANTRY', confirmedOutOfTurn: true }))
    state = unwrap(drawUnitsForBattle(state, { playerId, numberOfDraws: count }))
  }
  state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))
  const place = (playerId: string, side: 'attacker' | 'defender', first: number): void => {
    for (const [index, unit] of (findPlayer(state, playerId)?.battlehand ?? []).entries()) {
      state = unwrap(
        placeUnitInArena(state, { playerId, unitId: unit.id, side, position: first + index, attack: 1, health: 3 }),
      )
    }
  }
  place(CASH1981, 'attacker', 0)
  place(KARANDRAS1, 'defender', 10)
  return state
}

const holding = (state: GameState, name: string, playerId: string): { readonly state: GameState; readonly cardId: string } => {
  const card = withCardInHand(state, name, playerId)
  return { state: card.state, cardId: card.itemId }
}

const withStat = (state: GameState, playerId: string, stat: 'culture' | 'trade', value: number): GameState => {
  const player = findPlayer(state, playerId)
  if (player === undefined) throw new Error('no player')
  return withPlayer(state, { ...player, stats: { ...player.stats, [stat]: value } })
}

const play = (state: GameState, playerId: string, cardId: string, requestId = 'b1') =>
  performAssistedAction(state, { playerId, action: 'playCard', requestId, at: AT, payload: { itemId: cardId, targets: [] } })

const statusOf = (state: GameState, playerId: string, name: string) => {
  const player = findPlayer(state, playerId)
  const card = player === undefined ? undefined : playableCardsOf(state, player).find((candidate) => candidate.name === name)
  if (card === undefined) throw new Error(`${name} is not listed`)
  return card
}

const bonusOf = (state: GameState, playerId: string): number =>
  battleSummaries(state).find((summary) => summary.playerId === playerId)?.combatBonus ?? 0

function undoByVote(state: GameState, playerId: string, requestId: string): GameState {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line for the action')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId }))
  for (const voter of [CASH1981, KARANDRAS1, ITCHI, CHUL].filter((id) => id !== playerId)) {
    next = unwrap(vote(next, { logId: entry.id, playerId: voter, vote: true, at: AT }))
  }
  return next
}

describe('a battle card outside a battle', () => {
  it('is not ready, and says it is played during a battle', () => {
    const { state } = holding(firstCivGame(), 'Leonidas', KARANDRAS1)
    const card = statusOf(state, KARANDRAS1, 'Leonidas')
    expect(card.status).toBe('wrong-phase')
    expect(card.reason).toBe('Played during a battle.')
  })
})

describe('Leonidas', () => {
  it('is ready for the defender with fewer units, while facedown and in any phase', () => {
    const { state } = holding(fight(3, 2), 'Leonidas', KARANDRAS1)
    const card = statusOf(state, KARANDRAS1, 'Leonidas')
    expect(card.status).toBe('ready')
    expect(card.automatic).toContain('8')
  })

  it('adds 8 to the defender combat bonus, keeps the card faceup and says so in the public log', () => {
    const base = fight(3, 2)
    const before = bonusOf(base, KARANDRAS1)
    const { state, cardId } = holding(base, 'Leonidas', KARANDRAS1)
    const after = unwrap(play(state, KARANDRAS1, cardId))
    expect(bonusOf(after, KARANDRAS1)).toBe(before + 8)
    expect(bonusOf(after, CASH1981)).toBe(bonusOf(base, CASH1981))
    // Leonidas is revealed, not discarded: he stays in the hand, faceup, and works again in a later battle
    expect(findPlayer(after, KARANDRAS1)?.items.find((item) => item.id === cardId)?.hidden).toBe(false)
    expect(after.log.at(-1)?.publicLog).toContain('used Leonidas (battle)')
    expect(after.log.at(-1)?.publicLog).toContain('combat bonus')
  })

  it('is refused for the attacker, and with as many units or more than the opponent', () => {
    const attacker = statusOf(holding(fight(1, 2), 'Leonidas', CASH1981).state, CASH1981, 'Leonidas')
    expect(attacker.status).toBe('wrong-phase')
    expect(attacker.reason).toContain('defender')
    const equal = statusOf(holding(fight(2, 2), 'Leonidas', KARANDRAS1).state, KARANDRAS1, 'Leonidas')
    expect(equal.status).toBe('wrong-phase')
    expect(equal.reason).toContain('fewer units')
    const more = statusOf(holding(fight(1, 2), 'Leonidas', KARANDRAS1).state, KARANDRAS1, 'Leonidas')
    expect(more.status).toBe('wrong-phase')
  })

  it('is refused for a player who is not in the battle', () => {
    const { state } = holding(fight(3, 2), 'Leonidas', ITCHI)
    expect(statusOf(state, ITCHI, 'Leonidas').reason).toBe('You are not fighting in this battle.')
  })

  it('takes the bonus back when the play is undone', () => {
    const base = fight(3, 2)
    const { state, cardId } = holding(base, 'Leonidas', KARANDRAS1)
    const played = unwrap(play(state, KARANDRAS1, cardId))
    const undone = undoByVote(played, KARANDRAS1, 'b1')
    expect(bonusOf(undone, KARANDRAS1)).toBe(bonusOf(base, KARANDRAS1))
    expect(findPlayer(undone, KARANDRAS1)?.items.find((item) => item.id === cardId)?.hidden).toBe(true)
  })

  it('requires later uses to be undone before an earlier use of the same card', () => {
    const { state, cardId } = holding(fight(3, 2), 'Leonidas', KARANDRAS1)
    const first = unwrap(play(state, KARANDRAS1, cardId, 'b1'))
    const ended = unwrap(endBattleAction(first, { playerId: CASH1981 }))
    const nextBattle = fight(3, 2, ended)
    const second = unwrap(play(nextBattle, KARANDRAS1, cardId, 'b2'))
    const earlier = second.log.find((entry) => entry.assistedActionId === 'b1')
    if (earlier === undefined) throw new Error('no log line for the earlier action')

    let pending = unwrap(initiateUndo(second, { logId: earlier.id, playerId: KARANDRAS1 }))
    pending = unwrap(vote(pending, { logId: earlier.id, playerId: CASH1981, vote: true, at: AT }))
    pending = unwrap(vote(pending, { logId: earlier.id, playerId: ITCHI, vote: true, at: AT }))
    expect(unwrapErr(vote(pending, { logId: earlier.id, playerId: CHUL, vote: true, at: AT }))).toMatchObject({
      kind: 'ASSISTED_UNDO_BLOCKED',
      reason: 'A later use of Leonidas is still applied. Undo it first.',
    })

    const secondUndone = undoByVote(pending, KARANDRAS1, 'b2')
    expect(findPlayer(secondUndone, KARANDRAS1)?.items.find((item) => item.id === cardId)?.hidden).toBe(false)
    const bothUndone = unwrap(vote(secondUndone, { logId: earlier.id, playerId: CHUL, vote: true, at: AT }))
    expect(findPlayer(bothUndone, KARANDRAS1)?.items.find((item) => item.id === cardId)?.hidden).toBe(true)
    expect(bothUndone.assistedActions.map((record) => record.status)).toEqual(['undone', 'undone'])
  })

  it('works once in a battle, and again in the next one', () => {
    const { state, cardId } = holding(fight(3, 2), 'Leonidas', KARANDRAS1)
    const played = unwrap(play(state, KARANDRAS1, cardId))
    const second = statusOf(played, KARANDRAS1, 'Leonidas')
    expect(second.status).toBe('wrong-phase')
    expect(second.reason).toContain('already been played')
    // A new battle has no bonus on it
    const next = unwrap(
      initiateBattle(unwrap(endBattleAction(played, { playerId: CASH1981 })), { initiatorId: CASH1981, opponentId: KARANDRAS1 }),
    )
    expect(statusOf(next, KARANDRAS1, 'Leonidas').reason).not.toContain('already been played')
  })
})

describe('Joan of Arc', () => {
  it('adds the unspent culture to the defender combat bonus', () => {
    const base = withStat(fight(2, 2), KARANDRAS1, 'culture', 17)
    const { state, cardId } = holding(base, 'Joan of Arc', KARANDRAS1)
    const after = unwrap(play(state, KARANDRAS1, cardId))
    expect(bonusOf(after, KARANDRAS1)).toBe(bonusOf(base, KARANDRAS1) + 17)
    expect(findPlayer(after, KARANDRAS1)?.stats.culture).toBe(17)
  })

  it('is for the defender, and needs culture', () => {
    const attacker = holding(withStat(fight(2, 2), CASH1981, 'culture', 9), 'Joan of Arc', CASH1981).state
    expect(statusOf(attacker, CASH1981, 'Joan of Arc').reason).toContain('defender')
    const broke = holding(withStat(fight(2, 2), KARANDRAS1, 'culture', 0), 'Joan of Arc', KARANDRAS1).state
    expect(statusOf(broke, KARANDRAS1, 'Joan of Arc').status).toBe('wrong-phase')
  })

  it('takes the bonus back when the play is undone', () => {
    const base = withStat(fight(2, 2), KARANDRAS1, 'culture', 5)
    const { state, cardId } = holding(base, 'Joan of Arc', KARANDRAS1)
    const undone = undoByVote(unwrap(play(state, KARANDRAS1, cardId)), KARANDRAS1, 'b1')
    expect(bonusOf(undone, KARANDRAS1)).toBe(bonusOf(base, KARANDRAS1))
  })
})

describe('Florence Nightingale', () => {
  const killOne = (state: GameState, playerId: string): GameState => {
    const unit = state.battle?.arena.find((candidate) => candidate.placedBy === playerId)
    if (unit === undefined) throw new Error('no unit')
    return unwrap(killArenaUnit(state, { playerId, arenaUnitId: unit.id }))
  }

  it('needs a killed unit of the player', () => {
    const { state } = holding(fight(2, 2), 'Florence Nightingale', CASH1981)
    expect(statusOf(state, CASH1981, 'Florence Nightingale').status).toBe('wrong-phase')
    const killed = holding(killOne(fight(2, 2), CASH1981), 'Florence Nightingale', CASH1981).state
    expect(statusOf(killed, CASH1981, 'Florence Nightingale').status).toBe('ready')
    // The opponent's dead unit is not theirs to save
    const theirs = holding(killOne(fight(2, 2), KARANDRAS1), 'Florence Nightingale', CASH1981).state
    expect(statusOf(theirs, CASH1981, 'Florence Nightingale').status).toBe('wrong-phase')
  })

  it('marks every killed unit of the player as saved and leaves the others alone', () => {
    const base = killOne(killOne(fight(2, 2), CASH1981), KARANDRAS1)
    const { state, cardId } = holding(base, 'Florence Nightingale', CASH1981)
    const after = unwrap(play(state, CASH1981, cardId))
    const arena = after.battle?.arena ?? []
    expect(arena.filter((unit) => unit.placedBy === CASH1981 && unit.killed).every((unit) => unit.saved === true)).toBe(true)
    expect(arena.filter((unit) => unit.placedBy === CASH1981 && !unit.killed).every((unit) => unit.saved === undefined)).toBe(true)
    expect(arena.filter((unit) => unit.placedBy === KARANDRAS1).every((unit) => unit.saved === undefined)).toBe(true)
    expect(after.log.at(-1)?.publicLog).toContain('saving 1 killed unit')
    // The saved unit still counts as killed for the result
    expect(battleSummaries(after).find((summary) => summary.playerId === CASH1981)?.unitCount).toBe(1)
  })

  it('takes the mark back when the play is undone', () => {
    const base = killOne(fight(2, 2), CASH1981)
    const { state, cardId } = holding(base, 'Florence Nightingale', CASH1981)
    const undone = undoByVote(unwrap(play(state, CASH1981, cardId)), CASH1981, 'b1')
    expect(undone.battle?.arena.some((unit) => unit.saved !== undefined)).toBe(false)
  })
})

describe('after the battle, and against barbarians', () => {
  it('does not bring an undone card bonus back with Undo end battle', () => {
    const base = withStat(fight(2, 2), KARANDRAS1, 'culture', 5)
    const { state, cardId } = holding(base, 'Joan of Arc', KARANDRAS1)
    const played = unwrap(play(state, KARANDRAS1, cardId))
    const ended = unwrap(endBattleAction(played, { playerId: CASH1981 }))
    const undone = undoByVote(ended, KARANDRAS1, 'b1')
    const back = unwrap(undoEndBattle(undone, { playerId: CASH1981 }))
    expect(bonusOf(back, KARANDRAS1)).toBe(bonusOf(base, KARANDRAS1))
    // and the card can be played again for its own culture alone
    const again = unwrap(play(back, KARANDRAS1, cardId, 'b2'))
    expect(bonusOf(again, KARANDRAS1)).toBe(bonusOf(base, KARANDRAS1) + 5)
  })

  it('gives the controller of the barbarians no card, and the barbarians no bonus', () => {
    let state = firstCivGame()
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: 'barbarians' }))
    const controller = state.battle!.defender.playerId
    const held = holding(withStat(state, controller, 'culture', 9), 'Joan of Arc', controller).state
    expect(statusOf(held, controller, 'Joan of Arc').reason).toBe('You are not fighting in this battle.')
    expect(bonusOf(held, controller)).toBe(0)
    // Even a bonus recorded for the controller does not reach the barbarians
    const forced = { ...held, battle: { ...held.battle!, cardBonuses: [{ playerId: controller, card: 'Leonidas', amount: 8, actionId: 'x' }] } }
    expect(bonusOf(forced, controller)).toBe(0)
  })
})

describe('Florence Nightingale and replaced units', () => {
  it('saves a killed unit that another unit has replaced on its front', () => {
    let state = fight(3, 2)
    const [dead, mover] = (state.battle?.arena ?? []).filter((unit) => unit.side === 'attacker')
    state = unwrap(killArenaUnit(state, { playerId: CASH1981, arenaUnitId: dead!.id }))
    state = unwrap(moveArenaUnit(state, { playerId: CASH1981, arenaUnitId: mover!.id, position: dead!.position }))
    expect(state.battle?.departedUnits.some((unit) => unit.id === dead!.id)).toBe(true)

    const { state: held, cardId } = holding(state, 'Florence Nightingale', CASH1981)
    expect(statusOf(held, CASH1981, 'Florence Nightingale').status).toBe('ready')
    const after = unwrap(play(held, CASH1981, cardId))
    expect(after.battle?.departedUnits.find((unit) => unit.id === dead!.id)?.saved).toBe(true)
    expect(after.log.at(-1)?.publicLog).toContain('saving 1 killed unit')
    const undone = undoByVote(after, CASH1981, 'b1')
    expect(undone.battle?.departedUnits.find((unit) => unit.id === dead!.id)?.saved).toBeUndefined()
  })
})

describe('Florence Nightingale after End battle', () => {
  const killOne = (state: GameState, playerId: string): GameState => {
    const unit = state.battle?.arena.find((candidate) => candidate.placedBy === playerId)
    return unwrap(killArenaUnit(state, { playerId, arenaUnitId: unit!.id }))
  }
  /** cash1981 lost a unit, and karandras1 pressed End battle. */
  const ended = (): { readonly state: GameState; readonly cardId: string } => {
    const fought = killOne(fight(2, 2), CASH1981)
    const { state, cardId } = holding(fought, 'Florence Nightingale', CASH1981)
    return { state: unwrap(endBattleAction(state, { playerId: KARANDRAS1 })), cardId }
  }

  it('can be played by either combatant on the battle that has just ended', () => {
    const { state } = ended()
    expect(state.battle).toBeNull()
    const card = statusOf(state, CASH1981, 'Florence Nightingale')
    expect(card.status).toBe('ready')
    expect(card.reason).toContain('just ended')
  })

  it('marks the killed units of the final arena as saved, and the undo takes the mark back', () => {
    const { state, cardId } = ended()
    const after = unwrap(play(state, CASH1981, cardId))
    const saved = after.endedBattle!.battle.arena.filter((unit) => unit.placedBy === CASH1981 && unit.killed)
    expect(saved.length).toBeGreaterThan(0)
    expect(saved.every((unit) => unit.saved === true)).toBe(true)
    expect(toPlayerView(after, KARANDRAS1).lastBattle?.arena.some((unit) => unit.saved === true)).toBe(true)
    expect(after.log.at(-1)?.publicLog).toContain('saving 1 killed unit')
    const undone = undoByVote(after, CASH1981, 'b1')
    expect(undone.endedBattle!.battle.arena.some((unit) => unit.saved !== undefined)).toBe(false)
    // The ender's Undo end battle brings the battle back with the mark, when it was kept
    const back = unwrap(undoEndBattle(after, { playerId: KARANDRAS1 }))
    expect(back.battle?.arena.some((unit) => unit.saved === true)).toBe(true)
  })

  it('is refused by a player who was not in the battle, without a killed unit, and once a new battle has started', () => {
    const outsider = holding(killOne(fight(2, 2), CASH1981), 'Florence Nightingale', ITCHI).state
    const left = unwrap(endBattleAction(outsider, { playerId: KARANDRAS1 }))
    expect(statusOf(left, ITCHI, 'Florence Nightingale').status).toBe('wrong-phase')
    const spared = unwrap(endBattleAction(holding(fight(2, 2), 'Florence Nightingale', CASH1981).state, { playerId: KARANDRAS1 }))
    expect(statusOf(spared, CASH1981, 'Florence Nightingale').status).toBe('wrong-phase')
    const next = unwrap(initiateBattle(ended().state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))
    expect(statusOf(next, CASH1981, 'Florence Nightingale').status).toBe('wrong-phase')
  })

  it('does not extend to Leonidas, whose bonus was counted when the battle ended', () => {
    const { state } = holding(unwrap(endBattleAction(fight(3, 2), { playerId: CASH1981 })), 'Leonidas', KARANDRAS1)
    expect(statusOf(state, KARANDRAS1, 'Leonidas').status).toBe('wrong-phase')
  })
})

describe('only the owner of a Great Person card can play it', () => {
  it('refuses the other combatant, in the battle and after End battle', () => {
    const killed = (() => {
      const state = fight(2, 2)
      const unit = state.battle!.arena.find((candidate) => candidate.placedBy === CASH1981)!
      return unwrap(killArenaUnit(state, { playerId: CASH1981, arenaUnitId: unit.id }))
    })()
    for (const [name, owner, other] of [
      ['Florence Nightingale', CASH1981, KARANDRAS1],
      ['Leonidas', KARANDRAS1, CASH1981],
      ['Joan of Arc', KARANDRAS1, CASH1981],
    ] as const) {
      const { state, cardId } = holding(withStat(killed, KARANDRAS1, 'culture', 5), name, owner)
      // It is not in the other player's list, and a play of its id is refused
      expect(playableCardsOf(state, findPlayer(state, other)!).some((card) => card.name === name)).toBe(false)
      expect(unwrapErr(play(state, other, cardId)).kind).toBe('ASSISTED_ACTION_REJECTED')
      const over = unwrap(endBattleAction(state, { playerId: other }))
      expect(unwrapErr(play(over, other, cardId)).kind).toBe('ASSISTED_ACTION_REJECTED')
    }
  })
})

describe('Sun Tzu', () => {
  const withSunTzu = (state: GameState, playerId: string, trade: number): GameState =>
    withStat(holding(state, 'Sun Tzu', playerId).state, playerId, 'trade', trade)

  it('is not a card to play: it has its own button', () => {
    const state = withSunTzu(fight(1, 1), KARANDRAS1, 10)
    expect(playableCardsOf(state, findPlayer(state, KARANDRAS1)!).some((card) => card.name === 'Sun Tzu')).toBe(false)
  })

  it('spends 3 trade, turns the card faceup and passes the battle turn', () => {
    const state = withSunTzu(fight(1, 1), KARANDRAS1, 10)
    const turn = state.battle?.turn
    const after = unwrap(sunTzuPass(state, { playerId: KARANDRAS1 }))
    expect(findPlayer(after, KARANDRAS1)?.stats.trade).toBe(7)
    expect(after.battle?.turn).not.toBe(turn)
    expect(findPlayer(after, KARANDRAS1)?.items.find((item) => item.kind === 'greatperson' && item.name === 'Sun Tzu')?.hidden).toBe(false)
    expect(after.log.at(-1)?.publicLog).toContain('Sun Tzu')
  })

  it('works once per battle', () => {
    const state = withSunTzu(fight(1, 1), KARANDRAS1, 10)
    const once = unwrap(sunTzuPass(state, { playerId: KARANDRAS1 }))
    expect(unwrapErr(sunTzuPass(once, { playerId: KARANDRAS1 })).kind).toBe('BATTLE_CARD_REFUSED')
  })

  it('is refused while Sun Tzu is one of the cards still being chosen between', () => {
    const state = withSunTzu(fight(1, 1), KARANDRAS1, 10)
    const card = findPlayer(state, KARANDRAS1)!.items.find((item) => item.kind === 'greatperson' && item.name === 'Sun Tzu')!
    const choosing = withPlayer(state, {
      ...findPlayer(state, KARANDRAS1)!,
      pendingRewards: [{ id: 'r1', kind: 'GREAT_PERSON', level: 1, step: 1, candidateIds: [card.id], keep: 1 }] as never,
    })
    expect(unwrapErr(sunTzuPass(choosing, { playerId: KARANDRAS1 })).kind).toBe('BATTLE_CARD_REFUSED')
  })

  it('is refused without the card, without 3 trade and for someone outside the battle', () => {
    expect(unwrapErr(sunTzuPass(fight(1, 1), { playerId: KARANDRAS1 })).kind).toBe('BATTLE_CARD_REFUSED')
    expect(unwrapErr(sunTzuPass(withSunTzu(fight(1, 1), KARANDRAS1, 2), { playerId: KARANDRAS1 })).kind).toBe('BATTLE_CARD_REFUSED')
    expect(unwrapErr(sunTzuPass(withSunTzu(fight(1, 1), ITCHI, 5), { playerId: ITCHI })).kind).toBe('NOT_IN_THIS_BATTLE')
    expect(unwrapErr(sunTzuPass(firstCivGame(), { playerId: KARANDRAS1 })).kind).toBe('NO_BATTLE_ACTIVE')
  })
})

describe('the projection', () => {
  it('shows the card bonus to everyone and does not show the card in hand once played', () => {
    const { state, cardId } = holding(withStat(fight(2, 2), KARANDRAS1, 'culture', 5), 'Joan of Arc', KARANDRAS1)
    const after = unwrap(play(state, KARANDRAS1, cardId))
    const view = toPlayerView(after, CASH1981)
    expect(view.battle?.cardBonuses?.[0]?.amount).toBe(5)
    expect(JSON.stringify(view.opponents)).not.toContain(cardId)
  })
})
