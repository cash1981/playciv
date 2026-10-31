/**
 * Frida Kahlo: "Any Time: You may discard this card to discard any culture events you don't want and then
 * draw enough culture events to fill your hand. Draw from the culture deck for the area on the culture
 * track that your culture marker is in."
 *
 * The scene: Japanese with the leader marker on a chosen space of the track, City Management open.
 */

import { describe, expect, it } from 'vitest'

import { initiateUndo, vote } from '../src/actions/undo.js'
import { performAssistedAction } from '../src/assisted.js'
import { playableCardsOf } from '../src/assisted-cards.js'
import { cultureCardsHeld, cultureHandSizeOf } from '../src/culture-hand.js'
import type { Item } from '../src/item.js'
import { itemName } from '../src/item.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { GameState, Playerhand } from '../src/state.js'

import { withCardInHand } from './assisted-fixture.js'
import { advanceTurn, topCards, withCivilization, withMarkerAt } from './culture-advance-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-10-31T10:00:00.000Z'
const OTHERS = [KARANDRAS1, ITCHI, CHUL]

const me = (state: GameState, playerId = CASH1981): Playerhand => {
  const found = findPlayer(state, playerId)
  if (found === undefined) throw new Error(`no player ${playerId}`)
  return found
}

/** The first `count` cards of a culture sheet, taken from the deck into the player's hand, hidden as a drawn card is. */
function withCultureCards(state: GameState, sheetName: Item['sheetName'], count: number): { readonly state: GameState; readonly cards: readonly Item[] } {
  const cards = topCards(state, sheetName, count)
  const ids = new Set(cards.map((card) => card.id))
  return {
    cards,
    state: {
      ...state,
      items: state.items.filter((item) => !ids.has(item.id)),
      players: state.players.map((candidate) =>
        candidate.playerId === CASH1981
          ? { ...candidate, items: [...candidate.items, ...cards.map((card) => ({ ...card, hidden: true, ownerId: CASH1981 }))] }
          : candidate,
      ),
    },
  }
}

/** Step 8 is a level II culture event space; the hand holds two level I cards and Frida. */
function scene(options: { readonly step?: number; readonly culture?: number; readonly techs?: readonly string[] } = {}) {
  const held = withCultureCards(advanceTurn({ step: options.step ?? 8, ...(options.techs === undefined ? {} : { techs: options.techs }) }), 'CULTURE_1', options.culture ?? 2)
  const frida = withCardInHand(held.state, 'Frida Kahlo')
  return { state: frida.state, fridaId: frida.itemId, hand: held.cards }
}

const play = (state: GameState, itemId: string, discard?: readonly string[], requestId = 'f1') =>
  performAssistedAction(state, {
    playerId: CASH1981,
    action: 'playCard',
    requestId,
    at: AT,
    payload: { itemId, targets: [], ...(discard === undefined ? {} : { discard }) },
  })

function undoByVote(state: GameState, requestId: string): GameState {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line for the action')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of OTHERS) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  return next
}

const undoRejection = (state: GameState, requestId: string) => {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line for the action')
  let pending = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of OTHERS.slice(0, -1)) pending = unwrap(vote(pending, { logId: entry.id, playerId, vote: true, at: AT }))
  return vote(pending, { logId: entry.id, playerId: OTHERS[2] as string, vote: true, at: AT })
}

const idsOf = (items: readonly Item[]): readonly string[] => items.map((item) => item.id)
const deckIds = (state: GameState, sheetName: Item['sheetName']): readonly string[] =>
  idsOf(state.items.filter((item) => item.sheetName === sheetName))

describe('Frida Kahlo', () => {
  it('lists the culture cards of the hand for the player to choose from', () => {
    const { state, fridaId, hand } = scene()
    const listed = playableCardsOf(state, me(state)).find((card) => card.itemId === fridaId)
    expect(listed?.status).toBe('ready')
    expect(listed?.automatic).toContain('discards the culture cards you choose')
    expect(listed?.cultureHand).toEqual(hand.map((card) => ({ itemId: card.id, name: itemName(card) })))
    // Every other card says nothing
    const other = withCardInHand(state, 'Jacques Cousteau')
    expect(playableCardsOf(other.state, me(other.state)).find((card) => card.itemId === other.itemId)?.cultureHand).toBeNull()
  })

  it('discards the chosen card and draws back up to the hand size from the deck of the marker area', () => {
    const { state, fridaId, hand } = scene()
    const [keep, throwAway] = hand as readonly [Item, Item]
    const nextTwo = topCards(state, 'CULTURE_2', 1)
    expect(cultureHandSizeOf(state, me(state))).toBe(2)

    const played = unwrap(play(state, fridaId, [throwAway.id]))
    const after = me(played).items
    expect(after.some((item) => item.id === fridaId)).toBe(false)
    expect(after.some((item) => item.id === throwAway.id)).toBe(false)
    expect(after.some((item) => item.id === keep.id)).toBe(true)
    expect(played.discardedItems.map((item) => item.id)).toEqual(expect.arrayContaining([fridaId, throwAway.id]))
    expect(cultureCardsHeld(me(played))).toBe(2)
    // Marker on space 8: the level II deck, top card first, hidden and owned like any drawn card
    const drawn = after.find((item) => item.id === nextTwo[0]?.id)
    expect(drawn).toMatchObject({ sheetName: 'CULTURE_2', hidden: true, ownerId: CASH1981 })
    expect(deckIds(played, 'CULTURE_2')).not.toContain(drawn?.id)
    expect(played.log.find((entry) => entry.assistedActionId === 'f1')?.publicLog).toBe(
      'cash1981 played Frida Kahlo (any time) and discarded it, discarding 1 culture card and drawing 1 from the Culture II deck',
    )
  })

  it('draws from the deck of the level the marker is in', () => {
    const { state, fridaId, hand } = scene({ step: 15 })
    const played = unwrap(play(state, fridaId, [hand[0]?.id as string, hand[1]?.id as string]))
    const drawn = me(played).items.filter((item) => item.kind.startsWith('culture'))
    expect(drawn).toHaveLength(2)
    expect(drawn.every((item) => item.sheetName === 'CULTURE_3')).toBe(true)
    expect(played.log.at(-2)?.publicLog).toContain('discarding 2 culture cards and drawing 2 from the Culture III deck')
  })

  it('draws up to the hand size without a discard', () => {
    const { state, fridaId, hand } = scene({ culture: 1 })
    const played = unwrap(play(state, fridaId))
    expect(cultureCardsHeld(me(played))).toBe(2)
    expect(me(played).items.some((item) => item.id === hand[0]?.id)).toBe(true)
    expect(played.log.find((entry) => entry.assistedActionId === 'f1')?.publicLog).toContain(', drawing 1 from the Culture II deck')
  })

  it('draws nothing when the hand is already full, and says so', () => {
    const { state, fridaId } = scene()
    const played = unwrap(play(state, fridaId, []))
    expect(cultureCardsHeld(me(played))).toBe(2)
    expect(deckIds(played, 'CULTURE_2')).toEqual(deckIds(state, 'CULTURE_2'))
    expect(played.log.find((entry) => entry.assistedActionId === 'f1')?.publicLog).toContain('already full, so nothing was drawn')
    expect(me(played).items.some((item) => item.id === fridaId)).toBe(false)
  })

  it('reshuffles the discard pile of that level when its deck has run out', () => {
    const { state, fridaId, hand } = scene()
    // Only the level II discard pile holds cards: the deck is empty, so the draw reshuffles the pile
    const level2 = state.items.filter((item) => item.sheetName === 'CULTURE_2')
    const emptied: GameState = {
      ...state,
      items: state.items.filter((item) => item.sheetName !== 'CULTURE_2'),
      discardedItems: [...state.discardedItems, ...level2.slice(0, 3)],
    }
    const played = unwrap(play(emptied, fridaId, idsOf(hand)))
    expect(cultureCardsHeld(me(played))).toBe(2)
    expect(me(played).items.filter((item) => item.kind.startsWith('culture')).every((item) => item.sheetName === 'CULTURE_2')).toBe(true)
  })

  it('refuses a marker that is not on the track and keeps the card in the hand', () => {
    const held = withCultureCards(withCivilization(firstCivGame(), 'Japanese'), 'CULTURE_1', 2)
    const frida = withCardInHand(held.state, 'Frida Kahlo')
    const refused = unwrapErr(play(frida.state, frida.itemId, [held.cards[0]?.id as string]))
    expect(JSON.stringify(refused)).toContain('not on the culture track')
    expect(me(frida.state).items.some((item) => item.id === frida.itemId)).toBe(true)
  })

  it('refuses a marker at the start, where there is no level, and keeps the card', () => {
    const { state, fridaId } = scene({ step: 0 })
    expect(JSON.stringify(unwrapErr(play(state, fridaId, [])))).toContain('start of the culture track')
    expect(me(state).items.some((item) => item.id === fridaId)).toBe(true)
    expect(state.discardedItems.some((item) => item.id === fridaId)).toBe(false)
  })

  it('draws from the deck of the area a Great Person space or the last space is in, as Patronage does', () => {
    const cases: readonly [number, Item['sheetName']][] = [
      [3, 'CULTURE_1'],
      [7, 'CULTURE_1'],
      [12, 'CULTURE_2'],
      [18, 'CULTURE_3'],
      [21, 'CULTURE_3'],
    ]
    for (const [step, sheet] of cases) {
      const { state, fridaId, hand } = scene({ step })
      const played = unwrap(play(state, fridaId, [hand[0]?.id as string]))
      const drawn = me(played).items.filter((item) => item.sheetName === sheet && !hand.some((card) => card.id === item.id))
      expect(drawn.length).toBeGreaterThan(0)
    }
  })

  it('refuses ids that are not culture cards of the hand, or are named twice, and changes nothing', () => {
    const { state, fridaId, hand } = scene()
    const great = withCardInHand(state, 'Jacques Cousteau')
    const stranger = state.items.find((item) => item.sheetName === 'CULTURE_1')?.id as string
    const attempts: readonly (readonly string[])[] = [
      [stranger],
      [great.itemId],
      [fridaId],
      [hand[0]?.id as string, hand[0]?.id as string],
      ['nonsense'],
    ]
    for (const discard of attempts) {
      const result = discard.includes(great.itemId) ? play(great.state, fridaId, discard) : play(state, fridaId, discard)
      const refused = unwrapErr(result)
      expect(JSON.stringify(refused)).toMatch(/culture card/)
    }
    // Another player's culture card is not the player's to discard
    const theirs = withCultureCards({ ...state, players: state.players }, 'CULTURE_1', 1).cards[0] as Item
    const given = {
      ...state,
      items: state.items.filter((item) => item.id !== theirs.id),
      players: state.players.map((candidate) =>
        candidate.playerId === KARANDRAS1 ? { ...candidate, items: [...candidate.items, { ...theirs, ownerId: KARANDRAS1, hidden: true }] } : candidate,
      ),
    }
    expect(JSON.stringify(unwrapErr(play(given, fridaId, [theirs.id])))).toContain('your own hand')
  })

  it('does not let a card still being chosen between be discarded', () => {
    const { state, fridaId, hand } = scene()
    const waiting: GameState = {
      ...state,
      players: state.players.map((candidate) =>
        candidate.playerId === CASH1981
          ? {
              ...candidate,
              pendingRewards: [{ id: 'r1', kind: 'event', level: 1, step: 2, candidateIds: idsOf(hand), keep: 1 }],
            }
          : candidate,
      ),
    }
    const listed = playableCardsOf(waiting, me(waiting)).find((card) => card.itemId === fridaId)
    expect(listed?.cultureHand).toEqual([])
    expect(JSON.stringify(unwrapErr(play(waiting, fridaId, [hand[0]?.id as string])))).toContain('Choose the card to keep')
  })

  it('is played at any time, also before City Management opens', () => {
    const held = withCultureCards(withMarkerAt(withCivilization(firstCivGame(), 'Japanese'), 8), 'CULTURE_1', 1)
    const frida = withCardInHand(held.state, 'Frida Kahlo')
    const listed = playableCardsOf(frida.state, me(frida.state)).find((card) => card.itemId === frida.itemId)
    expect(listed?.status).toBe('ready')
    expect(cultureCardsHeld(me(unwrap(play(frida.state, frida.itemId, []))))).toBe(2)
  })

  it('can be undone when the discards were reshuffled and drawn again', () => {
    // Marker on level I, and the deck holds nothing of level I: the two discards are the only cards to draw
    const { state, fridaId, hand } = scene({ step: 2 })
    const bare: GameState = { ...state, items: state.items.filter((item) => item.sheetName !== 'CULTURE_1') }
    const played = unwrap(play(bare, fridaId, idsOf(hand)))
    expect(me(played).items.filter((item) => item.sheetName === 'CULTURE_1').map((item) => item.id).sort()).toEqual(idsOf(hand).slice().sort())
    expect(played.discardedItems.some((item) => item.sheetName === 'CULTURE_1')).toBe(false)

    const undone = undoByVote(played, 'f1')
    expect(me(undone).items.map((item) => item.id).sort()).toEqual(me(bare).items.map((item) => item.id).sort())
    expect(deckIds(undone, 'CULTURE_1')).toEqual([])
    expect(undone.discardedItems.map((item) => item.id)).toEqual(bare.discardedItems.map((item) => item.id))
  })

  it('is undone by the vote: the drawn cards are in the deck again, the discards in the hand, and Frida too', () => {
    const { state, fridaId, hand } = scene()
    const discard = [hand[1]?.id as string]
    const played = unwrap(play(state, fridaId, discard))
    const drawnId = me(played).items.find((item) => item.sheetName === 'CULTURE_2')?.id as string

    const undone = undoByVote(played, 'f1')
    expect(deckIds(undone, 'CULTURE_2').slice().sort()).toEqual(deckIds(state, 'CULTURE_2').slice().sort())
    expect(deckIds(undone, 'CULTURE_2')).toContain(drawnId)
    expect(undone.items.find((item) => item.id === drawnId)).toMatchObject({ hidden: true, ownerId: null })
    expect(me(undone).items.map((item) => item.id).sort()).toEqual(me(state).items.map((item) => item.id).sort())
    expect(me(undone).items.find((item) => item.id === hand[1]?.id)).toEqual(me(state).items.find((item) => item.id === hand[1]?.id))
    expect(undone.discardedItems.map((item) => item.id)).toEqual(state.discardedItems.map((item) => item.id))
    // Nothing of another sheet moved
    expect(deckIds(undone, 'CULTURE_1')).toEqual(deckIds(state, 'CULTURE_1'))
  })

  it('is undone when nothing was drawn or discarded', () => {
    const { state, fridaId } = scene()
    const undone = undoByVote(unwrap(play(state, fridaId, [])), 'f1')
    expect(me(undone).items.map((item) => item.id).sort()).toEqual(me(state).items.map((item) => item.id).sort())
  })

  it('cannot be undone once a drawn card has left the hand', () => {
    const { state, fridaId, hand } = scene()
    const played = unwrap(play(state, fridaId, [hand[0]?.id as string]))
    const drawnId = me(played).items.find((item) => item.sheetName === 'CULTURE_2')?.id as string
    const spent: GameState = {
      ...played,
      players: played.players.map((candidate) =>
        candidate.playerId === CASH1981 ? { ...candidate, items: candidate.items.filter((item) => item.id !== drawnId) } : candidate,
      ),
      discardedItems: [...played.discardedItems, ...played.items.filter((item) => item.id === drawnId)],
    }
    const blocked = undoRejection(spent, 'f1')
    expect(JSON.stringify(unwrapErr(blocked))).toContain('no longer in')
    expect(me(spent).items.some((item) => item.id === fridaId)).toBe(false)
  })

  it('cannot be undone once a discarded card has left the discard pile', () => {
    const { state, fridaId, hand } = scene()
    const gone = hand[0]?.id as string
    const played = unwrap(play(state, fridaId, [gone]))
    const taken: GameState = { ...played, discardedItems: played.discardedItems.filter((item) => item.id !== gone) }
    expect(JSON.stringify(unwrapErr(undoRejection(taken, 'f1')))).toContain('no longer in the discard pile')
  })

  it('keeps the card names out of the public log and out of every other view', () => {
    const { state, fridaId, hand } = scene()
    const played = unwrap(play(state, fridaId, [hand[0]?.id as string]))
    const drawnName = itemName(me(played).items.find((item) => item.sheetName === 'CULTURE_2') as Item)
    const names = [itemName(hand[0] as Item), drawnName]

    const line = played.log.find((entry) => entry.assistedActionId === 'f1')
    for (const name of names) expect(line?.publicLog).not.toContain(name)
    // The private line names them, for the player only
    expect(played.log.some((entry) => names.every((name) => entry.privateLog.includes(name)))).toBe(true)

    for (const viewerId of [KARANDRAS1, ITCHI, 'spectator']) {
      const view = toPlayerView(played, viewerId)
      expect(view.you?.playableCards ?? []).toEqual([])
      const serialised = JSON.stringify(view)
      for (const name of names) expect(serialised).not.toContain(name)
      // The key itself ("cultureHandSize" is a different, public field)
      expect(serialised).not.toContain('"cultureHand"')
    }
    // The player's own view lists the hand to choose from
    const own = toPlayerView(state, CASH1981)
    expect(own.you?.playableCards.find((card) => card.itemId === fridaId)?.cultureHand).toHaveLength(2)
  })

  it('shows another player no culture hand before the card is played either', () => {
    const { state, hand } = scene()
    for (const viewerId of [KARANDRAS1, 'spectator']) {
      const serialised = JSON.stringify(toPlayerView(state, viewerId))
      expect(serialised).not.toContain('"cultureHand"')
      for (const card of hand) expect(serialised).not.toContain(itemName(card))
    }
  })

  describe('with Mysticism', () => {
    const mysticism = () => scene({ step: 8, techs: ['Mysticism'] })
    const choose = (state: GameState, rewardId: string, itemId: string, requestId: string) =>
      performAssistedAction(state, { playerId: CASH1981, action: 'chooseReward', requestId, at: AT, payload: { rewardId, itemId } })

    it('draws a pair for every place in the hand, and the player keeps one of each', () => {
      const { state, fridaId, hand } = mysticism()
      const played = unwrap(play(state, fridaId, idsOf(hand)))
      const pending = me(played).pendingRewards
      expect(pending).toHaveLength(2)
      expect(pending.map((reward) => reward.id)).toEqual(['f1', 'f1:2'])
      expect(pending.every((reward) => reward.candidateIds.length === 2 && reward.level === 2)).toBe(true)
      expect(played.log.find((line) => line.assistedActionId === 'f1')?.publicLog).toContain('keeping one of each pair')

      const first = unwrap(choose(played, 'f1', pending[0]?.candidateIds[0] as string, 'c1'))
      const second = unwrap(choose(first, 'f1:2', pending[1]?.candidateIds[1] as string, 'c2'))
      expect(me(second).pendingRewards).toHaveLength(0)
      expect(cultureCardsHeld(me(second))).toBe(2)
    })

    it('waits for the choices before it can be played again', () => {
      const { state, fridaId, hand } = mysticism()
      const played = unwrap(play(state, fridaId, idsOf(hand)))
      // The first Frida goes back to the hand, as another copy of the card would be
      const again = played.discardedItems.find((item) => item.id === fridaId)
      if (again === undefined) throw new Error('Frida is not in the discard pile')
      const more: GameState = {
        ...played,
        discardedItems: played.discardedItems.filter((item) => item.id !== fridaId),
        players: played.players.map((candidate) =>
          candidate.playerId === CASH1981 ? { ...candidate, items: [...candidate.items, { ...again, hidden: true }] } : candidate,
        ),
      }
      expect(JSON.stringify(unwrapErr(play(more, fridaId, [], 'f2')))).toContain('Choose the card to keep')
    })

    it('is undone after the choices: kept and rejected cards go back to the deck, the discards to the hand', () => {
      const { state, fridaId, hand } = mysticism()
      const before = deckIds(state, 'CULTURE_2')
      const played = unwrap(play(state, fridaId, idsOf(hand)))
      const pending = me(played).pendingRewards
      const first = unwrap(choose(played, 'f1', pending[0]?.candidateIds[0] as string, 'c1'))
      const second = unwrap(choose(first, 'f1:2', pending[1]?.candidateIds[0] as string, 'c2'))

      const undone = undoByVote(second, 'f1')
      expect([...deckIds(undone, 'CULTURE_2')].sort()).toEqual([...before].sort())
      expect([...idsOf(me(undone).items.filter((item) => item.sheetName === 'CULTURE_1'))].sort()).toEqual([...idsOf(hand)].sort())
      expect(me(undone).items.some((item) => item.id === fridaId)).toBe(true)
      expect(me(undone).pendingRewards).toHaveLength(0)
    })

    it('is undone before the choices too, dropping the waiting choices', () => {
      const { state, fridaId, hand } = mysticism()
      const played = unwrap(play(state, fridaId, idsOf(hand)))
      expect(me(played).pendingRewards).toHaveLength(2)
      const undone = undoByVote(played, 'f1')
      expect(me(undone).pendingRewards).toHaveLength(0)
      expect(cultureCardsHeld(me(undone))).toBe(2)
    })
  })
})
