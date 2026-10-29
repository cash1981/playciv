/**
 * Playing a culture event or Great Person card (assisted play, part 13). The game
 * takes the card out of the hand and writes who played what against whom; it applies
 * nothing to the target. Specification: `docs/agents/decisions.md` ("Assisted play").
 */

import { describe, expect, it } from 'vitest'

import { undoLastBoardChange } from '../src/actions/board.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { assistedAvailability, performAssistedAction } from '../src/assisted.js'
import { playableCardsOf } from '../src/assisted-cards.js'
import { itemName } from '../src/item.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { toPlayerView } from '../src/state.js'
import { startPlayerOf } from '../src/turn.js'

import { player, startOfTurn, tradeTurn, withCardInHand } from './assisted-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1 } from './fixture.js'

const AT = '2026-10-23T10:00:00.000Z'

const play = (
  state: GameState,
  requestId: string,
  itemId: string,
  options: { targets?: readonly string[]; resource?: string; playerId?: string } = {},
) =>
  performAssistedAction(state, {
    playerId: options.playerId ?? CASH1981,
    action: 'playCard',
    requestId,
    at: AT,
    payload: {
      itemId,
      targets: options.targets ?? [],
      ...(options.resource === undefined ? {} : { resource: options.resource }),
    },
  })

const cardOf = (state: GameState, name: string, playerId = CASH1981) => {
  const found = playableCardsOf(state, player(state, playerId)).find((card) => card.name === name)
  if (found === undefined) throw new Error(`${name} is not in the playable list`)
  return found
}

describe('which cards can be played, and when', () => {
  it('lists a Start of Turn card as ready while Start of Turn is open', () => {
    const { state } = withCardInHand(startOfTurn(), 'Counterfeiters')
    const card = cardOf(state, 'Counterfeiters')
    expect(card.status).toBe('ready')
    expect(card.timings).toEqual(['SOT'])
    expect(card.kind).toBe('culture')
    expect(card.discards).toBe(true)
    expect(card.targets).toEqual({ kind: 'players', min: 1, max: 1 })
  })

  it('is wrong-phase for that card once Start of Turn is done, with a reason that says where it is played', () => {
    const { state } = withCardInHand(tradeTurn(), 'Counterfeiters')
    const card = cardOf(state, 'Counterfeiters')
    expect(card.status).toBe('wrong-phase')
    expect(card.reason).toBe('Played in start of turn. You are in trade.')
  })

  it('lists an Any Time card as ready in every phase, and when every phase is done', () => {
    const { state } = withCardInHand(startOfTurn(), 'Bread and Circuses')
    expect(cardOf(state, 'Bread and Circuses').status).toBe('ready')
    const traded = withCardInHand(tradeTurn(), 'Bread and Circuses').state
    expect(cardOf(traded, 'Bread and Circuses').status).toBe('ready')
    const finished = unwrap(markPhasesDone(traded, { playerId: CASH1981, turnNumber: 1, upToPhase: 'RESEARCH' }))
    expect(cardOf(finished, 'Bread and Circuses').status).toBe('ready')
  })

  it('is ready for a card with two timings in either of its phases, and not in the others', () => {
    const { state } = withCardInHand(startOfTurn(), 'Supply Drop')
    expect(cardOf(state, 'Supply Drop').timings).toEqual(['SOT', 'CM'])
    expect(cardOf(state, 'Supply Drop').status).toBe('ready')
    const trade = withCardInHand(tradeTurn(), 'Supply Drop').state
    expect(cardOf(trade, 'Supply Drop').status).toBe('wrong-phase')
    const cm = withCardInHand(
      unwrap(markPhasesDone(startOfTurn(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' })),
      'Supply Drop',
    ).state
    expect(cardOf(cm, 'Supply Drop').status).toBe('ready')
  })

  it('never makes a Battle card ready', () => {
    const { state } = withCardInHand(startOfTurn(), 'Duty and Honor')
    const card = cardOf(state, 'Duty and Honor')
    expect(card.status).toBe('wrong-phase')
    expect(card.reason).toBe('Played during a battle.')
  })

  it('lists an automated passive Great Person as a Use button, and an unautomated one not at all', () => {
    const passive = withCardInHand(startOfTurn(), 'Valmiki').state
    const valmiki = cardOf(passive, 'Valmiki')
    expect(valmiki.kind).toBe('greatPerson')
    expect(valmiki.passive).toBe(true)
    expect(valmiki.timings).toEqual(['ANY'])
    expect(valmiki.status).toBe('ready')
    expect(valmiki.discards).toBe(false)

    const ford = withCardInHand(startOfTurn(), 'Henry Ford').state
    const henryFord = cardOf(ford, 'Henry Ford')
    expect(henryFord.passive).toBe(true)
    expect(henryFord.status).toBe('ready')
    expect(henryFord.discards).toBe(false)

    const unimplemented = withCardInHand(startOfTurn(), 'Dr. Martin Luther King').state
    expect(playableCardsOf(unimplemented, player(unimplemented)).some((card) => card.name === 'Dr. Martin Luther King')).toBe(false)

    const anyTime = withCardInHand(startOfTurn(), 'Marco Polo').state
    const card = cardOf(anyTime, 'Marco Polo')
    expect(card.kind).toBe('greatPerson')
    expect(card.status).toBe('ready')
    expect(card.discards).toBe(true)
  })

  it('says a Great Person that stays faceup does not discard', () => {
    const { state } = withCardInHand(startOfTurn(), 'William Shakespeare')
    expect(cardOf(state, 'William Shakespeare').discards).toBe(false)
  })

  it('lists nothing for a player with an empty hand', () => {
    expect(playableCardsOf(startOfTurn(), player(startOfTurn()))).toEqual([])
  })

  it('lets a player try to play, and says why not in the answer, not in the availability', () => {
    expect(assistedAvailability(startOfTurn(), CASH1981, 'playCard').status).toBe('ready')
    expect(assistedAvailability(startOfTurn(), 'player-nobody', 'playCard').status).toBe('unavailable')
  })
})

describe('playing a card', () => {
  it('takes the card out of the hand, puts it on the discard pile faceup and logs who it names', () => {
    const { state, itemId } = withCardInHand(startOfTurn(), 'Counterfeiters')
    const played = unwrap(play(state, 'req-1', itemId, { targets: [KARANDRAS1] }))

    expect(player(played).items.some((item) => item.id === itemId)).toBe(false)
    expect(played.discardedItems.some((item) => item.id === itemId)).toBe(true)
    expect(played.log.at(-1)?.publicLog).toBe('cash1981 played Counterfeiters (start of turn), targeting Karandras1')
    expect(played.log.at(-1)?.assistedActionId).toBe('req-1')
    expect(played.assistedActions).toHaveLength(1)
    expect(played.assistedActions[0]).toMatchObject({
      kind: 'playCard',
      playerId: CASH1981,
      phase: 'SOT',
      usageKey: null,
      status: 'applied',
    })
  })

  it('applies nothing to the target or to the player', () => {
    const { state, itemId } = withCardInHand(startOfTurn(), 'Counterfeiters')
    const played = unwrap(play(state, 'req-1', itemId, { targets: [KARANDRAS1] }))
    expect(player(played, KARANDRAS1)).toEqual(player(state, KARANDRAS1))
    expect(player(played).stats).toEqual(player(state).stats)
    expect(played.board).toEqual(state.board)
  })

  it('names two players for Depression, and every other player for Bank Scandal', () => {
    const depression = withCardInHand(startOfTurn(), 'Depression')
    const two = unwrap(play(depression.state, 'req-1', depression.itemId, { targets: [KARANDRAS1, ITCHI] }))
    expect(two.log.at(-1)?.publicLog).toBe('cash1981 played Depression (start of turn), targeting Karandras1 and Itchi')

    const scandal = withCardInHand(startOfTurn(), 'Bank Scandal')
    const all = unwrap(play(scandal.state, 'req-1', scandal.itemId))
    expect(all.log.at(-1)?.publicLog).toBe('cash1981 played Bank Scandal (start of turn), targeting every other player')
  })

  it('names nobody for a card that names no player', () => {
    const { state, itemId } = withCardInHand(startOfTurn(), 'Drought')
    const played = unwrap(play(state, 'req-1', itemId))
    expect(played.log.at(-1)?.publicLog).toBe('cash1981 played Drought (start of turn)')
  })

  it('plays a gift as a resource and names who gets the coin', () => {
    const { state, itemId } = withCardInHand(startOfTurn(), 'A Gift from Afar')
    const played = unwrap(play(state, 'req-1', itemId, { targets: [CHUL], resource: 'Iron' }))
    expect(played.log.at(-1)?.publicLog).toBe('cash1981 played A Gift from Afar (any time) as Iron, targeting Chul')
  })

  it('discards a Great Person whose text says to discard it, and keeps one that does not faceup in the hand', () => {
    const marco = withCardInHand(startOfTurn(), 'Marco Polo')
    const discarded = unwrap(play(marco.state, 'req-1', marco.itemId))
    expect(discarded.discardedItems.some((item) => item.id === marco.itemId)).toBe(true)
    expect(discarded.log.at(-1)?.publicLog).toBe('cash1981 played Marco Polo (any time) and discarded it, gaining 27 trade')

    const shakespeare = withCardInHand(startOfTurn(), 'William Shakespeare')
    const kept = unwrap(play(shakespeare.state, 'req-2', shakespeare.itemId))
    const card = player(kept).items.find((item) => item.id === shakespeare.itemId)
    expect(card?.hidden).toBe(false)
    expect(kept.discardedItems.some((item) => item.id === shakespeare.itemId)).toBe(false)
    expect(kept.log.at(-1)?.publicLog).toBe('cash1981 used William Shakespeare (any time)')
  })

  it('can be played again with a new request id, since a card is its own use', () => {
    const shakespeare = withCardInHand(startOfTurn(), 'William Shakespeare')
    const first = unwrap(play(shakespeare.state, 'req-1', shakespeare.itemId))
    const second = unwrap(play(first, 'req-2', shakespeare.itemId))
    expect(second.assistedActions).toHaveLength(2)
  })

  it('does the same once for the same request id, the way a retry sends it', () => {
    const { state, itemId } = withCardInHand(startOfTurn(), 'Counterfeiters')
    const once = unwrap(play(state, 'req-1', itemId, { targets: [KARANDRAS1] }))
    const twice = unwrap(play(once, 'req-1', itemId, { targets: [KARANDRAS1] }))
    expect(twice).toBe(once)
  })
})

describe('what is refused', () => {
  const refusal = (result: ReturnType<typeof play>): string => {
    const error = unwrapErr(result)
    if (error.kind !== 'ASSISTED_ACTION_REJECTED') throw new Error(`unexpected error ${error.kind}`)
    return error.reason
  }

  it('refuses a card that is not in the hand, and another player’s card', () => {
    const { state, itemId } = withCardInHand(startOfTurn(), 'Counterfeiters')
    expect(refusal(play(state, 'req-1', 'not-a-card'))).toBe('That card is not in your hand, or cannot be played.')
    expect(refusal(play(state, 'req-2', itemId, { playerId: KARANDRAS1, targets: [CASH1981] }))).toBe(
      'That card is not in your hand, or cannot be played.',
    )
  })

  it('refuses a card that is one of the choices of a card choice still waiting, and changes nothing', () => {
    const { state, itemId } = withCardInHand(startOfTurn(), 'Counterfeiters')
    const waiting: GameState = {
      ...state,
      players: state.players.map((candidate) =>
        candidate.playerId === CASH1981
          ? {
              ...candidate,
              pendingRewards: [{ id: 'req-0', kind: 'event' as const, level: 1 as const, step: 1, candidateIds: [itemId, 'other'], keep: 1 as const }],
            }
          : candidate,
      ),
    }
    expect(cardOf(waiting, 'Counterfeiters')).toMatchObject({
      status: 'unavailable',
      reason: 'Counterfeiters is one of the cards you are choosing between. Choose the card to keep first.',
    })
    expect(refusal(play(waiting, 'req-1', itemId, { targets: [KARANDRAS1] }))).toBe(
      'Counterfeiters is one of the cards you are choosing between. Choose the card to keep first.',
    )
    expect(waiting.discardedItems).toHaveLength(0)
  })

  it('refuses a card in the wrong phase, and changes nothing', () => {
    const { state, itemId } = withCardInHand(tradeTurn(), 'Counterfeiters')
    const result = play(state, 'req-1', itemId, { targets: [KARANDRAS1] })
    expect(refusal(result)).toBe('Played in start of turn. You are in trade.')
    expect(state.discardedItems).toHaveLength(0)
  })

  it('refuses a card that needs a player when none is chosen, and more than the card allows', () => {
    const counterfeit = withCardInHand(startOfTurn(), 'Counterfeiters')
    expect(refusal(play(counterfeit.state, 'req-1', counterfeit.itemId))).toBe('Counterfeiters names 1 other player.')
    expect(refusal(play(counterfeit.state, 'req-2', counterfeit.itemId, { targets: [KARANDRAS1, ITCHI] }))).toBe(
      'Counterfeiters names 1 other player.',
    )
    const depression = withCardInHand(startOfTurn(), 'Depression')
    expect(
      refusal(play(depression.state, 'req-3', depression.itemId, { targets: [KARANDRAS1, ITCHI, CHUL] })),
    ).toBe('Depression names 1 to 2 other players.')
  })

  it('refuses the player themselves, an unknown player and the same player twice', () => {
    const { state, itemId } = withCardInHand(startOfTurn(), 'Depression')
    const wording = 'Choose other players of this game, each once.'
    expect(refusal(play(state, 'req-1', itemId, { targets: [CASH1981] }))).toBe(wording)
    expect(refusal(play(state, 'req-2', itemId, { targets: ['player-nobody'] }))).toBe(wording)
    expect(refusal(play(state, 'req-3', itemId, { targets: [KARANDRAS1, KARANDRAS1] }))).toBe(wording)
  })

  it('refuses a player for a card that names none', () => {
    const { state, itemId } = withCardInHand(startOfTurn(), 'Drought')
    expect(refusal(play(state, 'req-1', itemId, { targets: [KARANDRAS1] }))).toBe('Drought names no player.')
  })

  it('refuses a missing or wrong resource, and a resource for a card that is not played as one', () => {
    const gift = withCardInHand(startOfTurn(), 'A Generous Gift')
    expect(refusal(play(gift.state, 'req-1', gift.itemId))).toBe('Choose a resource: Iron, Wheat, Spy, Silk.')
    expect(refusal(play(gift.state, 'req-2', gift.itemId, { resource: 'Uranium' }))).toBe(
      'Choose a resource: Iron, Wheat, Spy, Silk.',
    )
    const drought = withCardInHand(startOfTurn(), 'Drought')
    expect(refusal(play(drought.state, 'req-3', drought.itemId, { resource: 'Iron' }))).toBe(
      'Drought is not played as a resource.',
    )
  })

  it('refuses a request without a payload', () => {
    const { state } = withCardInHand(startOfTurn(), 'Counterfeiters')
    const result = performAssistedAction(state, { playerId: CASH1981, action: 'playCard', requestId: 'req-1' })
    expect(refusal(result)).toBe('Choose the card to play.')
  })

  it('refuses a request id that another player already used', () => {
    const { state, itemId } = withCardInHand(startOfTurn(), 'Counterfeiters')
    const played = unwrap(play(state, 'req-1', itemId, { targets: [KARANDRAS1] }))
    const other = withCardInHand(played, 'Drought', KARANDRAS1)
    expect(refusal(play(other.state, 'req-1', other.itemId, { playerId: KARANDRAS1 }))).toBe(
      'This request id was already used.',
    )
  })
})

describe('undoing a played card with the vote', () => {
  const OTHERS = [KARANDRAS1, ITCHI, CHUL]
  const voted = (state: GameState, logId: string): GameState =>
    OTHERS.reduce((next, playerId) => unwrap(vote(next, { logId, playerId, vote: true, at: AT })), state)

  it('puts a discarded card back in the hand after a unanimous yes, and writes a new line', () => {
    const { state, itemId } = withCardInHand(startOfTurn(), 'Counterfeiters')
    const played = unwrap(play(state, 'req-1', itemId, { targets: [KARANDRAS1] }))
    const logId = played.log.at(-1)?.id ?? ''
    const asked = unwrap(initiateUndo(played, { logId, playerId: CASH1981 }))
    expect(asked.log.at(-1)?.publicLog).toBe('cash1981 has requested undo of Counterfeiters used by cash1981')
    const undone = voted(asked, logId)

    expect(player(undone).items.some((item) => item.id === itemId)).toBe(true)
    expect(undone.discardedItems.some((item) => item.id === itemId)).toBe(false)
    expect(undone.assistedActions[0]?.status).toBe('undone')
    expect(undone.log.at(-1)?.publicLog).toBe(
      "System: cash1981's Counterfeiters was undone: the card is back in their hand",
    )
    // The line about the play stays
    expect(undone.log.some((entry) => entry.publicLog.includes('played Counterfeiters'))).toBe(true)
    // And it can be played again
    expect(unwrap(play(undone, 'req-2', itemId, { targets: [ITCHI] })).discardedItems).toHaveLength(1)
  })

  it('turns a used Great Person facedown again', () => {
    const { state, itemId } = withCardInHand(startOfTurn(), 'William Shakespeare')
    const used = unwrap(play(state, 'req-1', itemId))
    const logId = used.log.at(-1)?.id ?? ''
    const undone = voted(unwrap(initiateUndo(used, { logId, playerId: CASH1981 })), logId)
    expect(player(undone).items.find((item) => item.id === itemId)?.hidden).toBe(true)
  })

  it('refuses, with the vote left open, when the card has left the discard pile', () => {
    const { state, itemId } = withCardInHand(startOfTurn(), 'Counterfeiters')
    const played = unwrap(play(state, 'req-1', itemId, { targets: [KARANDRAS1] }))
    const logId = played.log.at(-1)?.id ?? ''
    const reshuffled: GameState = { ...played, discardedItems: [] }
    let next = unwrap(initiateUndo(reshuffled, { logId, playerId: CASH1981 }))
    next = unwrap(vote(next, { logId, playerId: KARANDRAS1, vote: true, at: AT }))
    next = unwrap(vote(next, { logId, playerId: ITCHI, vote: true, at: AT }))
    const result = vote(next, { logId, playerId: CHUL, vote: true, at: AT })
    expect(unwrapErr(result).kind).toBe('ASSISTED_UNDO_BLOCKED')
  })
})

describe('what other players can see', () => {
  it('shows another player and a spectator no playable cards and not the card in the hand', () => {
    const { state, itemId } = withCardInHand(startOfTurn(), 'Counterfeiters')
    expect(toPlayerView(state, CASH1981).you?.playableCards.map((card) => card.name)).toEqual(['Counterfeiters'])
    for (const viewerId of [KARANDRAS1, ITCHI, CHUL, '']) {
      const view = toPlayerView(state, viewerId)
      expect(JSON.stringify(view)).not.toContain(itemId)
      expect(JSON.stringify(view)).not.toContain('Counterfeiters')
      expect(view.you === null || view.you.playableCards.length === 0).toBe(true)
    }
  })

  it('shows a played card by name only through the public line, and keeps the effect out of the view', () => {
    const { state, itemId } = withCardInHand(startOfTurn(), 'Counterfeiters')
    const played = unwrap(play(state, 'req-1', itemId, { targets: [KARANDRAS1] }))
    const json = JSON.stringify(toPlayerView(played, KARANDRAS1))
    expect(json).not.toContain('"effect"')
    expect(json).not.toContain('"discarded"')
    const listed = toPlayerView(played, KARANDRAS1).assistedActions?.find((record) => record.id === 'req-1')
    expect(listed?.label).toBe('Counterfeiters')
    expect(listed?.text).toBe('cash1981 played Counterfeiters (start of turn), targeting Karandras1')
  })
})

describe('Great Persons the game carries out', () => {
  const OTHERS = [KARANDRAS1, ITCHI, CHUL]
  const undoneBy = (state: GameState): GameState => {
    const logId = state.log.at(-1)?.id ?? ''
    const asked = unwrap(initiateUndo(state, { logId, playerId: CASH1981 }))
    return OTHERS.reduce((next, playerId) => unwrap(vote(next, { logId, playerId, vote: true, at: AT })), asked)
  }
  const withTrade = (state: GameState, trade: number): GameState => ({
    ...state,
    players: state.players.map((candidate) =>
      candidate.playerId === CASH1981 ? { ...candidate, stats: { ...candidate.stats, trade } } : candidate,
    ),
  })

  it('gives Marco Polo 27 trade, never past the ceiling, and takes exactly that back on undo', () => {
    const { state, itemId } = withCardInHand(withTrade(startOfTurn(), 10), 'Marco Polo')
    const played = unwrap(play(state, 'req-1', itemId))
    expect(player(played).stats.trade).toBe(27)
    expect(played.log.at(-1)?.publicLog).toBe('cash1981 played Marco Polo (any time) and discarded it, gaining 17 trade')
    expect(player(undoneBy(played)).stats.trade).toBe(10)
  })

  it('draws a free aircraft card for Orville Wright, privately, and puts it back on undo', () => {
    const { state, itemId } = withCardInHand(startOfTurn(), 'Orville Wright')
    const before = player(state).items.length
    const played = unwrap(play(state, 'req-1', itemId))
    const hand = player(played).items
    expect(hand).toHaveLength(before) // Orville left, one aircraft card came in
    expect(hand.some((item) => item.id === itemId)).toBe(false)
    expect(played.log.at(-1)?.publicLog).toBe(
      'cash1981 played Orville Wright (start of turn) and discarded it, building an aircraft unit for free',
    )
    const undone = undoneBy(played)
    expect(player(undone).items).toHaveLength(before)
    expect(player(undone).items.some((item) => item.id === itemId)).toBe(true)
  })

  it('moves the start player marker to Khalid, and back on undo', () => {
    const { state, itemId } = withCardInHand(startOfTurn(), 'Khalid ibn al-Walid', CHUL)
    const before = startPlayerOf(state)?.playerId
    expect(before).not.toBe(CHUL)
    const played = unwrap(play(state, 'req-1', itemId, { playerId: CHUL }))
    expect(startPlayerOf(played)?.playerId).toBe(CHUL)
    expect(played.log.at(-1)?.publicLog).toBe(
      'Chul played Khalid ibn al-Walid (any time) and discarded it, becoming the start player (next turn passes clockwise from Chul)',
    )
    // The marker cannot be stepped back on the board alone
    expect(unwrapErr(undoLastBoardChange(played, CHUL)).kind).toBe('BOARD_UNDO_ASSISTED')

    const logId = played.log.at(-1)?.id ?? ''
    const asked = unwrap(initiateUndo(played, { logId, playerId: CHUL }))
    const undone = [CASH1981, KARANDRAS1, ITCHI].reduce(
      (next, playerId) => unwrap(vote(next, { logId, playerId, vote: true, at: AT })),
      asked,
    )
    expect(startPlayerOf(undone)?.playerId).toBe(before)
  })
})

describe('Captain James Cook doubles travel speed for the turn', () => {
  const movementTurn = (): GameState =>
    unwrap(markPhasesDone(startOfTurn(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' }))

  it('writes a once-per-turn marker when played and frees it on undo', () => {
    const { state, itemId } = withCardInHand(movementTurn(), 'Captain James Cook')
    const played = unwrap(play(state, 'req-cook', itemId))
    const holder = player(played)
    expect(holder.playerTurns.find((turn) => turn.turnNumber === 1)?.usedActions).toContain(
      'card:Captain James Cook',
    )
    expect(played.discardedItems.some((card) => itemName(card) === 'Captain James Cook')).toBe(true)

    const logId = played.assistedActions.at(-1)?.logId
    if (logId === undefined) throw new Error('missing assisted action')
    const asked = unwrap(initiateUndo(played, { logId, playerId: CASH1981 }))
    const undone = [KARANDRAS1, ITCHI, CHUL].reduce(
      (next, playerId) => unwrap(vote(next, { logId, playerId, vote: true, at: AT })),
      asked,
    )
    const after = player(undone)
    expect(after.playerTurns.find((turn) => turn.turnNumber === 1)?.usedActions).not.toContain(
      'card:Captain James Cook',
    )
    expect(after.items.some((card) => itemName(card) === 'Captain James Cook')).toBe(true)
  })
})
