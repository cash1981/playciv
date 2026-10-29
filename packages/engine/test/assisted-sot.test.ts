/**
 * The Start of Turn actions that change numbers (assisted play, part 13): social
 * policies, government abilities, changing government and investing a coin. Rules and
 * sources: `docs/agents/decisions.md` ("Assisted play").
 */

import { describe, expect, it } from 'vitest'

import { undoLastBoardChange } from '../src/actions/board.js'
import { chooseTech, removeTech, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { assistedAvailability, performAssistedAction } from '../src/assisted.js'
import type { AssistedActionKind, GameState } from '../src/state.js'
import { toPlayerView } from '../src/state.js'
import { unwrap, unwrapErr } from '../src/result.js'

import { AT, me, put, sotTurn, withAmerica } from './sot-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1 } from './fixture.js'

const OTHERS = [KARANDRAS1, ITCHI, CHUL]

const act = (
  state: GameState,
  action: AssistedActionKind,
  requestId: string,
  payload?: Parameters<typeof performAssistedAction>[1]['payload'],
  options: { confirmedRepeat?: boolean } = {},
) =>
  performAssistedAction(state, {
    playerId: CASH1981,
    action,
    requestId,
    at: AT,
    ...(payload === undefined ? {} : { payload }),
    ...(options.confirmedRepeat === true ? { confirmedRepeat: true } : {}),
  })

const status = (state: GameState, action: AssistedActionKind) => assistedAvailability(state, CASH1981, action)

function undoByVote(state: GameState, requestId: string): GameState {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line for the action')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of OTHERS) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  return next
}

const reasonOf = (result: ReturnType<typeof act>): string => {
  const error = unwrapErr(result)
  if (error.kind !== 'ASSISTED_ACTION_REJECTED') throw new Error(`unexpected error ${error.kind}`)
  return error.reason
}

const afterSot = (state: GameState): GameState =>
  unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'SOT' }))

// ---------------------------------------------------------------------------

describe('the gate every Start of Turn action passes', () => {
  it('is wrong-phase once Start of Turn is done, and not-owned without the card', () => {
    const state = sotTurn({ policies: ['Pacifism'] })
    expect(status(state, 'pacifism').status).toBe('ready')
    expect(status(afterSot(state), 'pacifism')).toMatchObject({
      status: 'wrong-phase',
      reason: 'Only available during your open Start of Turn phase.',
    })
    expect(status(sotTurn(), 'pacifism')).toMatchObject({ status: 'not-owned', reason: 'You have not adopted Pacifism.' })
  })

  it('asks for a policy to be revealed first, and switches policies off under Anarchy', () => {
    const hidden = sotTurn({ hiddenPolicies: ['Pacifism'] })
    expect(status(hidden, 'pacifism')).toMatchObject({ status: 'unavailable', reason: 'Reveal Pacifism before using it.' })
    const anarchy = sotTurn({ policies: ['Pacifism'], government: 'Anarchy' })
    expect(status(anarchy, 'pacifism')).toMatchObject({
      status: 'unavailable',
      reason: 'Your social policies have no effect under Anarchy.',
    })
  })

  it('works before the player has written anything, because the turn record is made on use', () => {
    const state = sotTurn({ policies: ['Pacifism'] })
    expect(me(state).playerTurns).toHaveLength(0)
    const used = unwrap(act(state, 'pacifism', 'req-1'))
    expect(me(used).playerTurns).toHaveLength(1)
    expect(me(used).playerTurns[0]?.usedActions).toEqual(['policy:Pacifism'])
    expect(used.assistedActions[0]).toMatchObject({ phase: 'SOT', turnNumber: 1, usageKey: 'policy:Pacifism' })
  })
})

describe('Expansionism', () => {
  it('gives 1 trade for each city and each city-state you control', () => {
    let state = sotTurn({ policies: ['Expansionsim'], trade: 4 })
    state = put(state, CASH1981, 'cities/redcapital2', 3, 3)
    state = put(state, CASH1981, 'cities/redcity2', 9, 9)
    state = put(state, CASH1981, 'city-states/cs1', 5, 5)
    state = put(state, CASH1981, 'figures/redscout', 5, 5)
    expect(status(state, 'expansionism').reason).toBe('Gain 3 trade: 1 for each of your 2 cities and 1 for each of your 1 city-state.')
    const used = unwrap(act(state, 'expansionism', 'req-1'))
    expect(me(used).stats.trade).toBe(7)
    expect(used.log.at(-1)?.publicLog).toBe('cash1981 used Expansionism: gained 3 trade')
  })

  it('does not count a city-state with only an enemy figure on it, nor a city of another colour', () => {
    let state = sotTurn({ policies: ['Expansionsim'] })
    state = put(state, CASH1981, 'cities/redcapital2', 3, 3)
    state = put(state, KARANDRAS1, 'cities/bluecapital2', 12, 12)
    state = put(state, CASH1981, 'city-states/cs2', 5, 5)
    state = put(state, KARANDRAS1, 'figures/bluescout', 5, 5)
    expect(status(state, 'expansionism').reason).toContain('Gain 1 trade')
  })

  it('is once per turn, and a confirmed repeat is refused', () => {
    const state = unwrap(act(sotTurn({ policies: ['Expansionsim'] }), 'expansionism', 'req-1'))
    expect(status(state, 'expansionism').status).toBe('used')
    expect(toPlayerView(state, CASH1981).you?.availableActions.find((action) => action.action === 'expansionism')).toMatchObject({
      status: 'used',
      repeatable: false,
    })
    expect(reasonOf(act(state, 'expansionism', 'req-2'))).toContain('has already been done this turn')
    expect(unwrapErr(act(state, 'expansionism', 'req-2', undefined, { confirmedRepeat: true }))).toMatchObject({
      status: 'used',
      reason: 'Expansionism has already been done this turn.',
    })
    expect(me(state).playerTurns[0]?.usedActions).toEqual(['policy:Expansionism'])
  })

  it('a policy with a choice to make is also strict once', () => {
    const state = unwrap(act(sotTurn({ policies: ['Patronage'], step: 9, culture: 4 }), 'patronage', 'req-1'))
    expect(status(state, 'patronage').status).toBe('used')
    expect(toPlayerView(state, CASH1981).you?.availableActions.find((action) => action.action === 'patronage')).toMatchObject({
      status: 'used',
      repeatable: false,
    })
    expect(unwrapErr(act(state, 'patronage', 'req-2', undefined, { confirmedRepeat: true }))).toMatchObject({
      status: 'used',
      reason: 'Patronage has already been done this turn.',
    })
  })

  it('takes the trade off again when undone by the vote, and frees the use', () => {
    const base = put(sotTurn({ policies: ['Expansionsim'], trade: 2 }), CASH1981, 'cities/redcapital2', 3, 3)
    const state = unwrap(act(base, 'expansionism', 'req-1'))
    expect(me(state).stats.trade).toBe(3)
    const undone = undoByVote(state, 'req-1')
    expect(me(undone).stats.trade).toBe(2)
    expect(status(undone, 'expansionism').status).toBe('ready')
    expect(undone.log.at(-1)?.publicLog).toBe("System: cash1981's Expansionism was undone: 1 trade removed")
  })
})

describe('Pacifism', () => {
  it('gives 1 culture, and 2 with a scout on the map', () => {
    const none = sotTurn({ policies: ['Pacifism'], culture: 5 })
    expect(me(unwrap(act(none, 'pacifism', 'req-1'))).stats.culture).toBe(6)
    const scout = put(sotTurn({ policies: ['Pacifism'], culture: 5 }), CASH1981, 'figures/redscout', 4, 4)
    expect(me(unwrap(act(scout, 'pacifism', 'req-1'))).stats.culture).toBe(7)
  })

  it('does not count a scout of another colour, or one outside the map', () => {
    const enemy = put(sotTurn({ policies: ['Pacifism'], culture: 5 }), KARANDRAS1, 'figures/bluescout', 4, 4)
    expect(me(unwrap(act(enemy, 'pacifism', 'req-1'))).stats.culture).toBe(6)
  })
})

describe('government abilities', () => {
  it('Democracy gives 2 trade, and only to a player governed by Democracy', () => {
    const state = sotTurn({ government: 'Democracy', trade: 1 })
    expect(me(unwrap(act(state, 'democracyTrade', 'req-1'))).stats.trade).toBe(3)
    expect(status(sotTurn({ government: 'Monarchy' }), 'democracyTrade')).toMatchObject({
      status: 'not-owned',
      reason: 'Your government is Monarchy, not Democracy.',
    })
  })

  it('Fundamentalism gives 1 culture for each army on the map', () => {
    let state = sotTurn({ government: 'Fundamentalism', culture: 0 })
    state = put(state, CASH1981, 'figures/redarmy', 2, 2)
    state = put(state, CASH1981, 'figures/redarmy', 3, 2)
    state = put(state, KARANDRAS1, 'figures/bluearmy', 4, 4)
    expect(status(state, 'fundamentalismCulture').reason).toBe('Gain 2 culture: 1 for each of your 2 armies on the map.')
    expect(me(unwrap(act(state, 'fundamentalismCulture', 'req-1'))).stats.culture).toBe(2)
  })

  it('a government used once leaves the other government’s ability free after a change', () => {
    const state = unwrap(act(sotTurn({ government: 'Democracy', trade: 0 }), 'democracyTrade', 'req-1'))
    expect(status(state, 'democracyTrade').status).toBe('used')
    // Its own key: nothing about Fundamentalism is used
    expect(status(state, 'fundamentalismCulture').status).toBe('not-owned')
  })
})

describe('Rationalism', () => {
  it('spends 6 trade for a level I tech and 11 for a level II, each once', () => {
    const state = sotTurn({ policies: ['Rationalism'], trade: 20 })
    expect(status(state, 'rationalismI').reason).toContain('Spend 6 trade')
    expect(status(state, 'rationalismII').reason).toContain('Spend 11 trade')
    const one = unwrap(act(state, 'rationalismI', 'req-1'))
    expect(me(one).stats.trade).toBe(14)
    expect(me(one).techGrants).toEqual([{ id: 'req-1', source: 'Rationalism', level: 1, turnNumber: 1 }])
    expect(status(one, 'rationalismI').status).toBe('used')
    // The level II ability is its own use
    const two = unwrap(act(one, 'rationalismII', 'req-2'))
    expect(me(two).stats.trade).toBe(3)
    expect(me(two).techGrants).toHaveLength(2)
    expect(two.log.at(-1)?.publicLog).toBe('cash1981 used Rationalism: spent 11 trade to learn a level II tech')
  })

  it('needs the trade, and says how much is missing', () => {
    const state = sotTurn({ policies: ['Rationalism'], trade: 8 })
    expect(status(state, 'rationalismI').status).toBe('ready')
    expect(status(state, 'rationalismII')).toMatchObject({
      status: 'needs-resource',
      reason: 'Spend 11 trade to learn a level II tech. You have 8.',
    })
  })

  it('spends the grant when a tech of that level is revealed in Start of Turn, and logs it', () => {
    const state = unwrap(act(sotTurn({ policies: ['Rationalism'], trade: 20 }), 'rationalismI', 'req-1'))
    const chosen = unwrap(chooseTech(state, { playerId: CASH1981, techName: 'Pottery' }))
    const learned = unwrap(revealTech(chosen, { playerId: CASH1981, techName: 'Pottery' }))
    // Spent, but kept on the player so that removing Pottery gives it back
    expect(me(learned).techGrants).toEqual([expect.objectContaining({ id: 'req-1', usedFor: 'Pottery' })])
    expect(toPlayerView(learned, CASH1981).you?.startOfTurn?.techGrants).toEqual([])
    expect(learned.log.at(-1)?.publicLog).toBe('cash1981 learned Pottery with Rationalism')
    expect(me(learned).techRevealTurns['Pottery']).toBe(1)
  })

  it('leaves the grant alone for a tech of another level', () => {
    const state = unwrap(act(sotTurn({ policies: ['Rationalism'], trade: 20 }), 'rationalismI', 'req-1'))
    const chosen = unwrap(chooseTech(state, { playerId: CASH1981, techName: 'Chivalry' }))
    const learned = unwrap(revealTech(chosen, { playerId: CASH1981, techName: 'Chivalry' }))
    expect(me(learned).techGrants).toHaveLength(1)
    expect(learned.log.at(-1)?.publicLog).not.toContain('with Rationalism')
  })

  it('refunds the trade on undo, and refuses once the tech was learned', () => {
    const state = unwrap(act(sotTurn({ policies: ['Rationalism'], trade: 20 }), 'rationalismI', 'req-1'))
    const undone = undoByVote(state, 'req-1')
    expect(me(undone).stats.trade).toBe(20)
    expect(me(undone).techGrants).toEqual([])

    const chosen = unwrap(chooseTech(state, { playerId: CASH1981, techName: 'Pottery' }))
    const learned = unwrap(revealTech(chosen, { playerId: CASH1981, techName: 'Pottery' }))
    const entry = learned.log.find((candidate) => candidate.assistedActionId === 'req-1')
    if (entry === undefined) throw new Error('no line')
    let next = unwrap(initiateUndo(learned, { logId: entry.id, playerId: CASH1981 }))
    next = unwrap(vote(next, { logId: entry.id, playerId: KARANDRAS1, vote: true, at: AT }))
    next = unwrap(vote(next, { logId: entry.id, playerId: ITCHI, vote: true, at: AT }))
    const refusal = unwrapErr(vote(next, { logId: entry.id, playerId: CHUL, vote: true, at: AT }))
    expect(refusal).toMatchObject({
      kind: 'ASSISTED_UNDO_BLOCKED',
      reason: 'You learned Pottery with it. Remove Pottery first, then undo this.',
    })

    // What the refusal says works: removing the tech gives the free tech back, and the undo then goes through
    const without = unwrap(removeTech(learned, { playerId: CASH1981, techName: 'Pottery' }))
    expect(toPlayerView(without, CASH1981).you?.startOfTurn?.techGrants).toEqual([
      { id: 'req-1', source: 'Rationalism', level: 1 },
    ])
    const undoneAfterRemoval = undoByVote(without, 'req-1')
    expect(me(undoneAfterRemoval).stats.trade).toBe(20)
    expect(me(undoneAfterRemoval).techGrants).toEqual([])
  })

  it('gives the free tech back when the vote takes the reveal back', () => {
    const state = unwrap(act(sotTurn({ policies: ['Rationalism'], trade: 20 }), 'rationalismI', 'req-1'))
    const chosen = unwrap(chooseTech(state, { playerId: CASH1981, techName: 'Pottery' }))
    const learned = unwrap(revealTech(chosen, { playerId: CASH1981, techName: 'Pottery' }))
    const reveal = learned.log.find((entry) => entry.item?.kind === 'tech' && entry.item.name === 'Pottery' && entry.logType === 'REVEAL')
    if (reveal === undefined) throw new Error('no reveal line')
    let next = unwrap(initiateUndo(learned, { logId: reveal.id, playerId: CASH1981 }))
    for (const playerId of OTHERS) next = unwrap(vote(next, { logId: reveal.id, playerId, vote: true, at: AT }))
    expect(me(next).techsChosen.some((tech) => tech.name === 'Pottery')).toBe(false)
    expect(me(next).techGrants).toEqual([expect.not.objectContaining({ usedFor: expect.anything() })])
  })
})

describe('Patronage', () => {
  it('spends 1 culture for a culture event card of the level the marker is in, and the choice is private', () => {
    const state = sotTurn({ policies: ['Patronage'], step: 9, culture: 4 })
    expect(status(state, 'patronage').reason).toBe(
      'Spend 1 culture to draw 1 culture II card, of the level your marker is in, and keep one.',
    )
    const used = unwrap(act(state, 'patronage', 'req-1'))
    expect(me(used).stats.culture).toBe(3)
    expect(used.log.find((entry) => entry.assistedActionId === 'req-1')?.publicLog).toBe(
      'cash1981 used Patronage: spent 1 culture and drew 1 culture II card',
    )
    // One card is kept without a choice, and it is in the hand, hidden
    const record = used.assistedActions[0]
    if (record === undefined || record.effect.kind !== 'patronage') throw new Error('no patronage record')
    const kept = record.effect.kept
    expect(kept).not.toBeNull()
    expect(me(used).items.some((item) => item.id === kept)).toBe(true)
    expect(JSON.stringify(toPlayerView(used, KARANDRAS1))).not.toContain(kept ?? 'x')
  })

  it('draws two with Mysticism and waits for the choice, which is made with chooseReward', () => {
    const state = sotTurn({ policies: ['Patronage'], techs: ['Mysticism'], step: 2, culture: 4 })
    const used = unwrap(act(state, 'patronage', 'req-1'))
    expect(me(used).pendingRewards).toHaveLength(1)
    const reward = me(used).pendingRewards[0]
    if (reward === undefined) throw new Error('no reward')
    expect(reward.level).toBe(1)
    expect(reward.candidateIds).toHaveLength(2)
    const keep = reward.candidateIds[0] ?? ''
    const chosen = unwrap(
      performAssistedAction(used, {
        playerId: CASH1981,
        action: 'chooseReward',
        requestId: 'req-2',
        at: AT,
        payload: { rewardId: 'req-1', itemId: keep },
      }),
    )
    expect(me(chosen).pendingRewards).toEqual([])
    expect(chosen.assistedActions[0]?.effect).toMatchObject({ kind: 'patronage', kept: keep })
    expect(me(chosen).items.some((item) => item.id === reward.candidateIds[1])).toBe(false)
  })

  it('takes the culture and the cards back on undo', () => {
    const state = sotTurn({ policies: ['Patronage'], step: 9, culture: 4 })
    const used = unwrap(act(state, 'patronage', 'req-1'))
    const undone = undoByVote(used, 'req-1')
    expect(me(undone).stats.culture).toBe(4)
    expect(me(undone).items).toHaveLength(me(state).items.length)
    expect(status(undone, 'patronage').status).toBe('ready')
  })

  it('does not work until the marker has advanced once: the start space has no level', () => {
    const atStart = sotTurn({ policies: ['Patronage'], step: 0, culture: 4 })
    expect(status(atStart, 'patronage')).toMatchObject({
      status: 'unavailable',
      reason: expect.stringContaining('Advance on the culture track at least once first'),
    })
    expect(status(sotTurn({ policies: ['Patronage'], step: 1, culture: 4 }), 'patronage').status).toBe('ready')
    expect(status(sotTurn({ policies: ['Patronage'], step: 7, culture: 4 }), 'patronage').reason).toContain('culture I card')
  })

  it('needs culture, a marker on the track and no choice waiting', () => {
    expect(status(sotTurn({ policies: ['Patronage'], step: 9, culture: 0 }), 'patronage').status).toBe('needs-resource')
    const noMarker = { ...sotTurn({ policies: ['Patronage'], culture: 4 }) }
    const stripped = { ...noMarker, board: { ...noMarker.board, pieces: noMarker.board.pieces.filter((piece) => piece.category !== 'leader') } }
    expect(status(stripped, 'patronage')).toMatchObject({ status: 'unavailable', reason: 'Your leader marker is not on the culture track.' })
    const waiting = unwrap(act(sotTurn({ policies: ['Patronage'], techs: ['Mysticism'], step: 9, culture: 4 }), 'patronage', 'req-1'))
    // A new turn would free the use; the choice still waits
    const fresh: GameState = {
      ...waiting,
      players: waiting.players.map((candidate) =>
        candidate.playerId === CASH1981
          ? { ...me(waiting), playerTurns: me(waiting).playerTurns.map((turn) => ({ ...turn, usedActions: [] })) }
          : candidate,
      ),
    }
    expect(status(fresh, 'patronage').reason).toBe('Choose the card to keep from your last advance first.')
  })
})

describe('changing government', () => {
  const change = (state: GameState, government: string, requestId = 'req-1') =>
    act(state, 'switchGovernment', requestId, { government: government as 'Democracy' })

  it('takes a government learned in this Start of Turn at once, without Anarchy', () => {
    const state = sotTurn({ techs: ['Democracy'] })
    const options = toPlayerView(state, CASH1981).you?.startOfTurn?.government.options
    expect(options?.find((option) => option.government === 'Democracy')).toMatchObject({ route: 'direct' })
    const changed = unwrap(change(state, 'Democracy'))
    expect(me(changed).government).toBe('Democracy')
    expect(me(changed).stats.coinSources.democracyGovernment).toBe(1)
    expect(changed.log.at(-1)?.publicLog).toBe('cash1981 changed government from Despotism to Democracy')
  })

  it('takes a government unlocked last turn at once, and Anarchy only for an older one', () => {
    const base = sotTurn({ techs: ['Democracy', 'Chivalry'] })
    const player = me(base)
    // Democracy was learned last turn (turn 0 here is "turn - 1"), Chivalry long ago
    const aged: GameState = {
      ...base,
      players: base.players.map((candidate) =>
        candidate.playerId === CASH1981
          ? { ...player, techRevealTurns: { Democracy: 0, Chivalry: -5 } }
          : candidate,
      ),
    }
    const options = toPlayerView(aged, CASH1981).you?.startOfTurn?.government.options ?? []
    expect(options.find((option) => option.government === 'Democracy')?.route).toBe('direct')
    expect(options.find((option) => option.government === 'Feudalism')?.route).toBe('anarchy')
    expect(reasonOf(change(aged, 'Feudalism'))).toContain('only change to Feudalism through Anarchy')
    const anarchy = unwrap(change(aged, 'Anarchy'))
    expect(me(anarchy).government).toBe('Anarchy')
    expect(anarchy.log.at(-1)?.publicLog).toContain('(Anarchy: your capital takes no action this turn')
  })

  it('takes any known government from Anarchy', () => {
    const base = sotTurn({ techs: ['Chivalry'], government: 'Anarchy' })
    const aged: GameState = {
      ...base,
      players: base.players.map((candidate) =>
        candidate.playerId === CASH1981 ? { ...me(base), techRevealTurns: { Chivalry: -5 } } : candidate,
      ),
    }
    const options = toPlayerView(aged, CASH1981).you?.startOfTurn?.government.options ?? []
    expect(options.every((option) => option.route === 'direct')).toBe(true)
    expect(me(unwrap(change(aged, 'Feudalism'))).government).toBe('Feudalism')
  })

  it('is once per Start of Turn, and a confirmed repeat does not lift it', () => {
    const state = unwrap(change(sotTurn({ techs: ['Democracy', 'Chivalry'] }), 'Democracy'))
    expect(status(state, 'switchGovernment')).toMatchObject({
      status: 'used',
      reason: 'Changing government has already been done this turn.',
    })
    expect(reasonOf(act(state, 'switchGovernment', 'req-2', { government: 'Feudalism' }, { confirmedRepeat: true }))).toBe(
      'Changing government has already been done this turn.',
    )
  })

  it('refuses a government that is not unlocked, the one already in play and a bad target', () => {
    const state = sotTurn({ techs: ['Democracy'] })
    expect(reasonOf(change(state, 'Monarchy'))).toBe('You have not unlocked Monarchy.')
    expect(reasonOf(change(state, 'Despotism'))).toBe('Your government is Despotism already.')
    expect(reasonOf(act(state, 'switchGovernment', 'req-3'))).toBe('Choose the government.')
  })

  it('lets a player who is immune to Anarchy take any unlocked government, and not enter Anarchy', () => {
    let state = sotTurn({ techs: ['Chivalry'] })
    state = {
      ...state,
      players: state.players.map((candidate) =>
        candidate.playerId === CASH1981
          ? {
              ...me(state),
              techRevealTurns: { Chivalry: -5 },
              items: [
                ...me(state).items,
                { id: 'mlk', kind: 'greatperson', name: 'Dr. Martin Luther King', type: 'Humanitarian', hidden: false } as never,
              ],
            }
          : candidate,
      ),
    }
    const options = toPlayerView(state, CASH1981).you?.startOfTurn?.government
    expect(options?.options.find((option) => option.government === 'Feudalism')?.route).toBe('direct')
    expect(options?.canEnterAnarchy).toBe(false)
    expect(reasonOf(change(state, 'Anarchy'))).toBe('You are immune to Anarchy, or already in it.')
  })

  it('puts the governments back on undo, with the Democracy coin as it was', () => {
    const state = unwrap(change(sotTurn({ techs: ['Democracy'] }), 'Democracy'))
    const undone = undoByVote(state, 'req-1')
    expect(me(undone).government).toBe('Despotism')
    expect(me(undone).stats.coinSources.democracyGovernment).toBe(0)
    expect(status(undone, 'switchGovernment').status).toBe('ready')
  })

  it('refuses the undo when the government was changed by hand in the meantime', () => {
    const state = unwrap(change(sotTurn({ techs: ['Democracy'] }), 'Democracy'))
    const handed: GameState = {
      ...state,
      players: state.players.map((candidate) =>
        candidate.playerId === CASH1981 ? { ...me(state), government: 'Monarchy' } : candidate,
      ),
    }
    const entry = handed.log.find((candidate) => candidate.assistedActionId === 'req-1')
    if (entry === undefined) throw new Error('no line')
    let next = unwrap(initiateUndo(handed, { logId: entry.id, playerId: CASH1981 }))
    next = unwrap(vote(next, { logId: entry.id, playerId: KARANDRAS1, vote: true, at: AT }))
    next = unwrap(vote(next, { logId: entry.id, playerId: ITCHI, vote: true, at: AT }))
    expect(unwrapErr(vote(next, { logId: entry.id, playerId: CHUL, vote: true, at: AT })).kind).toBe('ASSISTED_UNDO_BLOCKED')
  })

  it('records the turn a government tech is revealed, so a later switch can tell', () => {
    const state = sotTurn({ techs: ['Theology'] })
    expect(me(state).techRevealTurns['Theology']).toBe(1)
  })
})

describe('Feudalism: harvest a resource', () => {
  const harvest = (state: GameState, cityPieceId: string, resource: string, requestId = 'req-1') =>
    act(state, 'feudalismHarvest', requestId, { cityPieceId, resource })

  /**
   * A capital on B2 of the America tile. The tile prints iron on A1, silk on B2 (the city's own
   * square), incense on C3 and wheat on D4, so the outskirts of B2 hold iron and incense only.
   */
  function feudal(): { state: GameState; cityId: string } {
    let state = withAmerica(sotTurn({ government: 'Feudalism' }))
    state = put(state, CASH1981, 'cities/redcapital2', 1, 1)
    const city = state.board.pieces.find((piece) => piece.category === 'city')
    if (city === undefined) throw new Error('no city')
    return { state, cityId: city.id }
  }

  it('places the resource token in the player’s own area and says where it was harvested', () => {
    const { state, cityId } = feudal()
    const used = unwrap(harvest(state, cityId, 'iron'))
    const piece = used.board.pieces.find((candidate) => candidate.assetId === 'resources/iron')
    expect(piece).toBeDefined()
    expect(used.log.at(-1)?.publicLog).toMatch(/^cash1981 used the Feudalism government: harvested Iron in the outskirts of Capital [A-Z]\d+$/)
    expect(status(used, 'feudalismHarvest').status).toBe('used')
  })

  it('takes the resource from the map: only what the outskirts hold, in any case of letters', () => {
    const { state, cityId } = feudal()
    expect(unwrap(harvest(state, cityId, 'Incense')).board.pieces.some((piece) => piece.assetId === 'resources/incense')).toBe(true)
    // Silk is on the city's own square and wheat is two squares away: neither is in the outskirts
    expect(reasonOf(harvest(state, cityId, 'silk'))).toMatch(/has no Silk icon in its outskirts\.$/)
    expect(reasonOf(harvest(state, cityId, 'Wheat'))).toMatch(/has no Wheat icon in its outskirts\.$/)
  })

  it('harvests a resource under a scout that gathers for the city, which is the capital by default', () => {
    const { state, cityId } = feudal()
    // Wheat is printed on D4, outside the outskirts of B2; a scout stands on it
    const scouted = put(state, CASH1981, 'figures/redscout', 3, 3)
    const view = toPlayerView(scouted, CASH1981).you?.startOfTurn?.feudalism
    expect(view?.cities[0]?.choices.map((choice) => choice.resource).sort()).toEqual(['incense', 'iron', 'wheat'])
    const used = unwrap(harvest(scouted, cityId, 'wheat'))
    expect(used.board.pieces.some((piece) => piece.assetId === 'resources/wheat')).toBe(true)
    // Another city does not get the scout's square
    let two = put(scouted, CASH1981, 'cities/redcity2', 8, 8)
    const other = two.board.pieces.find((piece) => piece.assetId === 'cities/redcity2')
    two = { ...two }
    expect(reasonOf(harvest(two, other?.id ?? '', 'wheat'))).toMatch(/has no Wheat icon/)
  })

  it('harvests a resource in a city’s outskirts that a scout there sends to the capital, through the capital', () => {
    let state = withAmerica(sotTurn({ government: 'Feudalism', techs: ['Irrigation'] }))
    state = put(put(state, CASH1981, 'cities/redcapital2', 1, 1), CASH1981, 'cities/redcity2', 4, 4)
    state = put(state, CASH1981, 'figures/redscout', 3, 3)
    const capital = state.board.pieces.find((piece) => piece.assetId === 'cities/redcapital2')
    expect(unwrap(harvest(state, capital?.id ?? '', 'wheat')).board.pieces.some((piece) => piece.assetId === 'resources/wheat')).toBe(true)
  })

  it('refuses a resource that is not harvestable, a city that is not yours and a second use', () => {
    const { state, cityId } = feudal()
    expect(reasonOf(harvest(state, cityId, 'Uranium'))).toBe('Choose a resource: Wheat, Silk, Incense, Iron.')
    expect(reasonOf(harvest(state, 'no-such-city', 'iron'))).toBe('That is not one of your cities on the map.')
    const used = unwrap(harvest(state, cityId, 'iron'))
    expect(reasonOf(harvest(used, cityId, 'incense', 'req-2'))).toContain('has already been used this turn')
  })

  it('refuses a resource the market has no token of left', () => {
    const { state, cityId } = feudal()
    // Four players: the market holds four of each kind. Put them all on the board
    let drained = state
    for (let count = 0; count < 4; count += 1) drained = put(drained, KARANDRAS1, 'resources/iron', 5, 5)
    expect(reasonOf(harvest(drained, cityId, 'iron'))).toBe('The market has no iron token left.')
    expect(status(drained, 'feudalismHarvest').status).toBe('ready')
  })

  it('needs the Feudalism government, a city and a resource in the outskirts', () => {
    expect(status(sotTurn({ government: 'Monarchy' }), 'feudalismHarvest').status).toBe('not-owned')
    expect(status(sotTurn({ government: 'Feudalism' }), 'feudalismHarvest')).toMatchObject({
      status: 'unavailable',
      reason: 'You have no city on the map.',
    })
    // A city with no icon around it, and a city that has some
    const bare = put(sotTurn({ government: 'Feudalism' }), CASH1981, 'cities/redcapital2', 8, 8)
    expect(status(bare, 'feudalismHarvest')).toMatchObject({
      status: 'unavailable',
      reason: expect.stringContaining('resource icon in its outskirts'),
    })
    expect(status(feudal().state, 'feudalismHarvest').status).toBe('ready')
  })

  it('shows the player the resources of each city’s outskirts, from the map', () => {
    const { state, cityId } = feudal()
    const view = toPlayerView(state, CASH1981).you?.startOfTurn?.feudalism
    expect(view?.cities).toHaveLength(1)
    expect(view?.cities[0]).toMatchObject({ pieceId: cityId })
    expect(view?.cities[0]?.choices.map((choice) => choice.resource).sort()).toEqual(['incense', 'iron'])
  })

  it('leaves the token to the undo vote: the board’s own Undo refuses', () => {
    const { state, cityId } = feudal()
    const used = unwrap(harvest(state, cityId, 'iron'))
    expect(unwrapErr(undoLastBoardChange(used, CASH1981)).kind).toBe('BOARD_UNDO_ASSISTED')
  })

  it('takes the token back to the market on undo', () => {
    const { state, cityId } = feudal()
    const used = unwrap(harvest(state, cityId, 'incense'))
    const undone = undoByVote(used, 'req-1')
    expect(undone.board.pieces.some((candidate) => candidate.assetId === 'resources/incense')).toBe(false)
    expect(status(undone, 'feudalismHarvest').status).toBe('ready')
  })
})

describe('investing a coin', () => {
  const invest = (state: GameState, source: string, card: string, requestId = 'req-1') =>
    act(state, 'invest', requestId, { source, card: card as 'infra' })

  it('moves one coin token from the sheet to an investment card, once per turn', () => {
    const state = sotTurn({ stats: { coinSources: { ...me(sotTurn()).stats.coinSources, sheet: 2 } } })
    const used = unwrap(invest(state, 'sheet', 'infra'))
    expect(me(used).stats.coinSources.sheet).toBe(1)
    expect(me(used).stats.infra).toBe(1)
    expect(used.log.at(-1)?.publicLog).toBe('cash1981 invested a coin in Infrastructure (1 marker on it)')
    expect(status(used, 'invest').status).toBe('used')
    expect(reasonOf(invest(used, 'sheet', 'efta', 'req-2'))).toBe('Investing has already been done this turn.')
    expect(reasonOf(act(used, 'invest', 'req-3', { source: 'sheet', card: 'efta' }, { confirmedRepeat: true }))).toBe(
      'Investing has already been done this turn.',
    )
  })

  it('can take the coin from a tech card that holds tokens, and from nothing else', () => {
    const base = sotTurn({ techs: ['Code of Laws'] })
    const sources = { ...me(base).stats.coinSources, codeOfLaws: 2, civilService: 1, bank: 1 }
    const state: GameState = {
      ...base,
      players: base.players.map((candidate) =>
        candidate.playerId === CASH1981 ? { ...me(base), stats: { ...me(base).stats, coinSources: sources } } : candidate,
      ),
    }
    const used = unwrap(invest(state, 'codeOfLaws', 'mic'))
    expect(me(used).stats.coinSources.codeOfLaws).toBe(1)
    expect(me(used).stats.mic).toBe(1)
    expect(reasonOf(invest(state, 'civilService', 'mic'))).toBe(
      'That coin cannot be invested. Only coin tokens on your sheet and on tech cards can.',
    )
    expect(reasonOf(invest(state, 'bank', 'mic'))).toBe(
      'That coin cannot be invested. Only coin tokens on your sheet and on tech cards can.',
    )
  })

  it('needs a coin token, and says printed coins do not count', () => {
    expect(status(sotTurn(), 'invest')).toMatchObject({
      status: 'needs-resource',
      reason:
        'You have no coin token to invest. Only coins on your sheet and on tech cards can be invested, not printed coins.',
    })
    const sheet = { ...me(sotTurn()).stats.coinSources, sheet: 1 }
    expect(reasonOf(invest(sotTurn({ stats: { coinSources: sheet } }), 'pottery', 'infra'))).toBe(
      'There is no coin there to invest.',
    )
  })

  it('is wrong-phase after Start of Turn, and refuses an unknown card', () => {
    const base = sotTurn({ stats: { coinSources: { ...me(sotTurn()).stats.coinSources, sheet: 1 } } })
    expect(status(afterSot(base), 'invest').status).toBe('wrong-phase')
    expect(reasonOf(invest(base, 'sheet', 'nothing'))).toBe('Choose one of your four investment cards.')
  })

  it('gives a free tech when Public Education reaches 3 markers', () => {
    const sheet = { ...me(sotTurn()).stats.coinSources, sheet: 1 }
    const state = sotTurn({ stats: { coinSources: sheet, pe: 2 } })
    const used = unwrap(invest(state, 'sheet', 'pe'))
    expect(me(used).techGrants).toEqual([{ id: 'req-1', source: 'Public Education', level: null, turnNumber: 1 }])
    expect(used.log.at(-1)?.publicLog).toContain('its ability activated, so they may learn a tech for free')
    // Any level can be learned with it
    const chosen = unwrap(chooseTech(used, { playerId: CASH1981, techName: 'Chivalry' }))
    const learned = unwrap(revealTech(chosen, { playerId: CASH1981, techName: 'Chivalry' }))
    expect(me(learned).techGrants).toEqual([expect.objectContaining({ id: 'req-1', usedFor: 'Chivalry' })])
    expect(learned.log.at(-1)?.publicLog).toBe('cash1981 learned Chivalry with Public Education')
  })

  it('gives no tech at 1 marker', () => {
    const sheet = { ...me(sotTurn()).stats.coinSources, sheet: 1 }
    const used = unwrap(invest(sotTurn({ stats: { coinSources: sheet } }), 'sheet', 'pe'))
    expect(me(used).techGrants).toEqual([])
  })

  it('lets the Arabs advance one space for free, with the card they draw', () => {
    const sheet = { ...me(sotTurn()).stats.coinSources, sheet: 1 }
    const state = sotTurn({ civ: 'Arabs', step: 9, culture: 0, trade: 0, stats: { coinSources: sheet } })
    const used = unwrap(invest(state, 'sheet', 'infra'))
    const lines = used.log.map((entry) => entry.publicLog)
    expect(lines.some((line) => line.startsWith('cash1981 advanced for free on the culture track to space 10'))).toBe(true)
    expect(me(used).stats.culture).toBe(0)
    expect(me(used).stats.trade).toBe(0)
    const record = used.assistedActions[0]
    if (record === undefined || record.effect.kind !== 'invest') throw new Error('no invest record')
    expect(record.effect.advance).toMatchObject({ kind: 'cultureAdvance', fromStep: 9, toStep: 10, culture: 0, trade: 0 })
    // Only the line of the investment can be undone by a vote
    expect(used.log.filter((entry) => entry.assistedActionId === 'req-1')).toHaveLength(1)
  })

  it('lets the Arabs choose the card of a free advance with Mysticism, through the investment’s record', () => {
    const sheet = { ...me(sotTurn()).stats.coinSources, sheet: 1 }
    const state = sotTurn({ civ: 'Arabs', step: 9, techs: ['Mysticism'], stats: { coinSources: sheet } })
    const used = unwrap(invest(state, 'sheet', 'infra'))
    const reward = me(used).pendingRewards[0]
    if (reward === undefined) throw new Error('no reward')
    expect(reward.id).toBe('req-1')
    const keep = reward.candidateIds[0] ?? ''
    const chosen = unwrap(
      performAssistedAction(used, {
        playerId: CASH1981,
        action: 'chooseReward',
        requestId: 'req-2',
        at: AT,
        payload: { rewardId: 'req-1', itemId: keep },
      }),
    )
    const effect = chosen.assistedActions.find((record) => record.id === 'req-1')?.effect
    expect(effect?.kind === 'invest' && effect.advance?.kept).toBe(keep)
    expect(me(chosen).pendingRewards).toEqual([])
  })

  it('does not advance anyone else, and does not stop an Arab at the end of the track', () => {
    const sheet = { ...me(sotTurn()).stats.coinSources, sheet: 1 }
    const other = unwrap(invest(sotTurn({ civ: 'Japanese', step: 9, stats: { coinSources: sheet } }), 'sheet', 'infra'))
    expect(other.assistedActions[0]?.effect).toMatchObject({ kind: 'invest', advance: null })
    const end = unwrap(invest(sotTurn({ civ: 'Arabs', step: 21, stats: { coinSources: sheet } }), 'sheet', 'infra'))
    expect(end.assistedActions[0]?.effect).toMatchObject({ kind: 'invest', advance: null })
    expect(me(end).stats.infra).toBe(1)
  })

  it('refuses the investment of an Arab while a card choice waits, so nothing is half done', () => {
    const sheet = { ...me(sotTurn()).stats.coinSources, sheet: 2 }
    const first = unwrap(
      invest(sotTurn({ civ: 'Arabs', step: 9, techs: ['Mysticism'], stats: { coinSources: sheet } }), 'sheet', 'infra'),
    )
    // A new Start of Turn is needed for a second investment, so test the guard on the advance itself
    const reopened: GameState = {
      ...first,
      players: first.players.map((candidate) =>
        candidate.playerId === CASH1981
          ? { ...me(first), playerTurns: me(first).playerTurns.map((turn) => ({ ...turn, usedActions: [] })) }
          : candidate,
      ),
    }
    expect(reasonOf(invest(reopened, 'sheet', 'efta', 'req-2'))).toContain('Choose the card to keep from your last advance first.')
    expect(me(reopened).stats.efta).toBe(0)
  })

  it('takes the coin, the marker and the free advance back on undo', () => {
    const sheet = { ...me(sotTurn()).stats.coinSources, sheet: 1 }
    const state = sotTurn({ civ: 'Arabs', step: 9, stats: { coinSources: sheet } })
    const used = unwrap(invest(state, 'sheet', 'infra'))
    const undone = undoByVote(used, 'req-1')
    expect(me(undone).stats.coinSources.sheet).toBe(1)
    expect(me(undone).stats.infra).toBe(0)
    expect(undone.assistedActions[0]?.status).toBe('undone')
    expect(undone.log.at(-1)?.publicLog).toBe(
      "System: cash1981's investment was undone: the coin is back and the marker is off Infrastructure, and the free advance was taken back",
    )
    const marker = undone.board.pieces.find((piece) => piece.assetId.startsWith('leaders/'))
    const before = state.board.pieces.find((piece) => piece.assetId.startsWith('leaders/'))
    expect(marker?.x).toBe(before?.x)
    expect(status(undone, 'invest').status).toBe('ready')
  })
})

describe('what other players can see', () => {
  it('shows nothing of the choices behind the actions to anyone else', () => {
    const state = sotTurn({ policies: ['Rationalism'], trade: 20 })
    const used = unwrap(act(state, 'rationalismI', 'req-1'))
    for (const viewerId of [KARANDRAS1, ITCHI, CHUL, '']) {
      const view = toPlayerView(used, viewerId)
      expect(view.you === null || view.you.startOfTurn !== null).toBe(true)
      // The grant sits in the owner's hand only; no opponent entry carries it
      expect(JSON.stringify(view.opponents)).not.toContain('techGrants')
      expect(JSON.stringify(view.opponents)).not.toContain('"effect"')
      expect(JSON.stringify(view)).not.toContain('"effect"')
    }
    // The owner sees the grant waiting
    expect(toPlayerView(used, CASH1981).you?.startOfTurn?.techGrants).toEqual([
      { id: 'req-1', source: 'Rationalism', level: 1 },
    ])
  })

  it('does not show a policy that is adopted but not revealed, nor the investment choices', () => {
    const state = sotTurn({ hiddenPolicies: ['Pacifism'] })
    const view = toPlayerView(state, KARANDRAS1)
    expect(JSON.stringify(view.opponents)).not.toContain('Pacifism')
    expect(JSON.stringify(view.opponents)).not.toContain('startOfTurn')
  })

  it('lets a spectator see no choices at all', () => {
    const view = toPlayerView(sotTurn({ policies: ['Pacifism'] }), '')
    expect(view.you).toBeNull()
  })
})
