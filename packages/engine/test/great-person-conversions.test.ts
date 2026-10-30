/**
 * Frank Lloyd Wright and Albert Einstein: Great Persons that turn resources into
 * other resources. Each test names the printed ability it covers.
 */

import { describe, expect, it } from 'vitest'

import { placePiece } from '../src/actions/board.js'
import { findBoardAsset, mapTop, slotOrigin, SQUARE_SIZE } from '../src/board.js'
import { chooseTech, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { assistedAvailability, performAssistedAction } from '../src/assisted.js'
import { playableCardsOf } from '../src/assisted-cards.js'
import { cultureMarkerLevelOf, toPlayerView } from '../src/state.js'
import type { GameState, Playerhand } from '../src/state.js'
import { findPlayer } from '../src/state.js'
import { unwrap } from '../src/result.js'

import { withCardInHand } from './assisted-fixture.js'
import { openCityManagement, withCivilization, withMarkerAt, withStats } from './culture-advance-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-10-30T10:00:00.000Z'
const OTHERS = [KARANDRAS1, ITCHI, CHUL]

const me = (state: GameState): Playerhand => {
  const found = findPlayer(state, CASH1981)
  if (found === undefined) throw new Error('no cash1981')
  return found
}

const play = (
  state: GameState,
  requestId: string,
  itemId: string,
  convert?: { readonly from: 'trade' | 'culture'; readonly amount: number },
) =>
  performAssistedAction(state, {
    playerId: CASH1981,
    action: 'playCard',
    requestId,
    at: AT,
    payload: { itemId, targets: [], ...(convert === undefined ? {} : { convert }) },
  })

function undoByVote(state: GameState, requestId: string): GameState {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line for the action')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of OTHERS) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  return next
}

/** The colours the city rules read, the America tile and a red city on B2, as the city action tests set it up. */
function cityScene(): GameState {
  const colors: Record<string, string> = { [CASH1981]: 'Red', [KARANDRAS1]: 'Blue', [ITCHI]: 'Green', [CHUL]: 'Yellow' }
  const base = firstCivGame()
  const coloured = { ...base, players: base.players.map((candidate) => ({ ...candidate, color: colors[candidate.playerId] ?? null })) }
  const slot = coloured.board.slots[0]
  if (slot === undefined) throw new Error('board has no slots')
  const [x, y] = slotOrigin(coloured.board, slot)
  const tiled = unwrap(placePiece(coloured, { playerId: CASH1981, assetId: 'tiles/america', x, y }))
  return put(tiled, CASH1981, 'cities/redcity2', 1, 1)
}

/** A piece centred on the map square (column, row). */
function put(state: GameState, playerId: string, assetId: string, column: number, row: number): GameState {
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`no asset ${assetId}`)
  return unwrap(
    placePiece(state, {
      playerId,
      assetId,
      x: column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2,
      y: mapTop(state.board) + row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2,
    }),
  )
}

const GRANARY = 'buildings/granary'

describe('Frank Lloyd Wright', () => {
  // Cash's city is on B2; A1, A3 and C2 are in its outskirts, E6 is outside them
  const scene = (): GameState => {
    let state = cityScene()
    state = put(state, CASH1981, GRANARY, 0, 0)
    state = put(state, CASH1981, GRANARY, 0, 2)
    state = put(state, KARANDRAS1, GRANARY, 2, 1) // another player's building in Cash's outskirts
    state = put(state, CASH1981, GRANARY, 4, 5) // Cash's own building outside every outskirts
    // Opening the turn collects the city's trade, so the figures are set after it
    return withStats(openCityManagement(state), { trade: 4, culture: 2 })
  }

  it('gains trade and culture equal to the buildings in your cities, and takes both back on undo', () => {
    const card = withCardInHand(scene(), 'Frank Lloyd Wright')
    const played = unwrap(play(card.state, 'flw-1', card.itemId))
    // Three buildings stand in the outskirts of the red city, whoever placed them; the one outside does not count
    expect(me(played).stats.trade).toBe(7)
    expect(me(played).stats.culture).toBe(5)
    expect(played.log.at(-1)?.publicLog).toContain('gaining 3 trade and 3 culture for 3 buildings')
    expect(me(played).items.some((item) => item.id === card.itemId)).toBe(false)

    const undone = undoByVote(played, 'flw-1')
    expect(me(undone).stats.trade).toBe(4)
    expect(me(undone).stats.culture).toBe(2)
    expect(me(undone).items.some((item) => item.id === card.itemId)).toBe(true)
  })

  it('gives nothing for buildings when you have no city, and never lifts trade past the track ceiling', () => {
    const noCity = withCardInHand(
      openCityManagement(withStats(put(firstCivGame(), CASH1981, GRANARY, 0, 0), { trade: 4 })),
      'Frank Lloyd Wright',
    )
    const none = unwrap(play(noCity.state, 'flw-0', noCity.itemId))
    expect(me(none).stats.trade).toBe(4)
    expect(me(none).stats.culture).toBe(0)

    const nearCeiling = withCardInHand(withStats(withCivilization(scene(), 'Japanese'), { trade: 24 }), 'Frank Lloyd Wright')
    const played = unwrap(play(nearCeiling.state, 'flw-2', nearCeiling.itemId))
    expect(me(played).stats.trade).toBe(25) // Japanese ceiling
    expect(me(played).stats.culture).toBe(2 + 3)
    expect(played.log.at(-1)?.publicLog).toContain('gaining 1 trade and 3 culture')
  })
})

describe('Albert Einstein', () => {
  const einstein = (stats: { readonly trade: number; readonly culture: number }) =>
    withCardInHand(openCityManagement(withStats(firstCivGame(), stats)), 'Albert Einstein')

  it('turns the chosen trade into the same amount of culture, and back on undo', () => {
    const card = einstein({ trade: 8, culture: 1 })
    const played = unwrap(play(card.state, 'e-1', card.itemId, { from: 'trade', amount: 5 }))
    expect(me(played).stats.trade).toBe(3)
    expect(me(played).stats.culture).toBe(6)
    expect(played.log.at(-1)?.publicLog).toContain('turning 5 trade into 5 culture')

    const undone = undoByVote(played, 'e-1')
    expect(me(undone).stats.trade).toBe(8)
    expect(me(undone).stats.culture).toBe(1)
  })

  it('turns culture into trade, within the trade track', () => {
    const card = einstein({ trade: 20, culture: 9 })
    const played = unwrap(play(card.state, 'e-2', card.itemId, { from: 'culture', amount: 7 }))
    expect(me(played).stats.trade).toBe(27)
    expect(me(played).stats.culture).toBe(2)

    const over = play(card.state, 'e-3', card.itemId, { from: 'culture', amount: 8 })
    expect(over.ok).toBe(false)
  })

  it('offers only as much culture as the trade track has room for', () => {
    const card = einstein({ trade: 20, culture: 9 })
    const listed = playableCardsOf(card.state, me(card.state)).find((entry) => entry.itemId === card.itemId)
    expect(listed?.conversion).toEqual({ trade: 20, culture: 7 })
  })

  it('undoes culture into trade, and refuses an undo that would invent resources', () => {
    const card = einstein({ trade: 5, culture: 9 })
    const played = unwrap(play(card.state, 'e-5', card.itemId, { from: 'culture', amount: 4 }))
    expect(me(played).stats.trade).toBe(9)
    expect(me(played).stats.culture).toBe(5)
    const undone = undoByVote(played, 'e-5')
    expect(me(undone).stats.trade).toBe(5)
    expect(me(undone).stats.culture).toBe(9)

    // The trade was spent since: the undo cannot take back what is gone
    const spent = withStats(played, { trade: 1 })
    expect(() => undoByVote(spent, 'e-5')).toThrow(/ASSISTED_UNDO_BLOCKED.*already spent/)
    // Trade then turned into culture, and later filled to the ceiling: giving it back would pass the track
    const second = einstein({ trade: 8, culture: 0 })
    const toCulture = unwrap(play(second.state, 'e-6', second.itemId, { from: 'trade', amount: 5 }))
    expect(() => undoByVote(withStats(toCulture, { trade: 27 }), 'e-6')).toThrow(/ASSISTED_UNDO_BLOCKED.*trade track/)
  })

  it('refuses a missing choice, more than you hold, and a fraction, keeping the card', () => {
    const card = einstein({ trade: 3, culture: 3 })
    for (const convert of [undefined, { from: 'trade' as const, amount: 4 }, { from: 'trade' as const, amount: 0 }, { from: 'trade' as const, amount: 1.5 }]) {
      expect(play(card.state, 'e-4', card.itemId, convert).ok).toBe(false)
    }
    expect(me(card.state).items.some((item) => item.id === card.itemId)).toBe(true)
  })

  it('tells the UI how much can be turned each way, to its owner only', () => {
    const card = einstein({ trade: 6, culture: 2 })
    const listed = playableCardsOf(card.state, me(card.state)).find((entry) => entry.name === 'Albert Einstein')
    expect(listed?.conversion).toEqual({ trade: 6, culture: 2 })
    const other = playableCardsOf(card.state, findPlayer(card.state, KARANDRAS1) as Playerhand)
    expect(other.some((entry) => entry.name === 'Albert Einstein')).toBe(false)
    expect(JSON.stringify(toPlayerView(card.state, KARANDRAS1))).not.toContain(card.itemId)
  })
})

describe('Andrew Carnegie', () => {
  const press = (state: GameState, requestId: string, action: 'cultureAdvance' | 'cultureAdvanceSkip' = 'cultureAdvance') =>
    performAssistedAction(state, { playerId: CASH1981, action, requestId, at: AT })

  const choose = (state: GameState, requestId: string) => {
    const reward = me(state).pendingRewards[0]
    const itemId = reward?.candidateIds[0]
    if (reward === undefined || itemId === undefined) throw new Error('no card choice waiting')
    return unwrap(
      performAssistedAction(state, { playerId: CASH1981, action: 'chooseReward', requestId, at: AT, payload: { rewardId: reward.id, itemId } }),
    )
  }

  /** The leader on the start space, plenty of culture and trade, `coins` coins and Carnegie in hand. */
  const carnegieTurn = (coins: number, step = 0, mysticism = false) => {
    let state = withCivilization(firstCivGame(), 'Japanese')
    if (mysticism) {
      state = unwrap(chooseTech(state, { playerId: CASH1981, techName: 'Mysticism' }))
      state = unwrap(revealTech(state, { playerId: CASH1981, techName: 'Mysticism' }))
    }
    state = withMarkerAt(state, step, 'Japanese')
    state = openCityManagement(state)
    state = withStats(state, { culture: 100, trade: 25, coinSources: { ...me(state).stats.coinSources, sheet: coins } })
    return withCardInHand(state, 'Andrew Carnegie')
  }

  it('earns one free advance for every 3 coins and undoes it', () => {
    const card = carnegieTurn(7)
    const played = unwrap(play(card.state, 'c-1', card.itemId))
    expect(me(played).freeAdvances).toBe(2)
    expect(me(played).stats.culture).toBe(100)
    expect(played.log.at(-1)?.publicLog).toContain('earning 2 free culture advances to make one space at a time')

    expect(me(undoByVote(played, 'c-1')).freeAdvances).toBe(0)
    const poor = carnegieTurn(2)
    expect(JSON.stringify(play(poor.state, 'c-0', poor.itemId))).toContain('at least 3 coins')
  })

  it('advances one space at a time for free, with the card choice in between, and gives an advance back on undo', () => {
    // Mysticism draws two cards, so the first advance leaves a card choice
    const card = carnegieTurn(6, 0, true)
    const played = unwrap(play(card.state, 'c-2', card.itemId))
    expect(assistedAvailability(played, CASH1981, 'cultureAdvance').reason).toContain('free with Andrew Carnegie (2 left)')

    const first = unwrap(press(played, 'a-1'))
    expect(cultureMarkerLevelOf(first, CASH1981)).toBe(1)
    expect(me(first).stats.culture).toBe(100)
    expect(me(first).stats.trade).toBe(25)
    expect(me(first).freeAdvances).toBe(1)
    expect(first.log.find((entry) => entry.assistedActionId === 'a-1')?.publicLog).toContain('for free with Andrew Carnegie')

    // The cards the space gave have to be settled before the next advance
    expect(me(first).pendingRewards).toHaveLength(1)
    expect(assistedAvailability(first, CASH1981, 'cultureAdvance').status).toBe('unavailable')
    expect(press(first, 'a-blocked').ok).toBe(false)
    expect(me(first).freeAdvances).toBe(1)
    const settled = choose(first, 'r-1')
    const second = unwrap(press(settled, 'a-2'))
    expect(cultureMarkerLevelOf(second, CASH1981)).toBe(2)
    expect(me(second).freeAdvances).toBe(0)
    expect(me(second).stats.culture).toBe(100)

    // With none left the advance costs what it costs again
    expect(assistedAvailability(second, CASH1981, 'cultureAdvance').reason).not.toContain('Carnegie')

    // An undone advance gives its free advance back, and the card cannot be undone while one is spent
    const undone = undoByVote(second, 'a-2')
    expect(me(undone).freeAdvances).toBe(1)
    expect(me(undone).stats.culture).toBe(100)
    expect(() => undoByVote(first, 'c-2')).toThrow(/ASSISTED_UNDO_BLOCKED.*already been made/)
  })

  it('is spent in City Management of the turn it was earned in, and no more are banked than spaces remain', () => {
    const card = carnegieTurn(30, 20)
    const played = unwrap(play(card.state, 'c-5', card.itemId))
    // One space is left on the track, so only one advance is earned from ten
    expect(me(played).freeAdvances).toBe(1)
    expect(played.log.at(-1)?.publicLog).toContain('earning 1 free culture advance ')

    // Another turn, or City Management closed: nothing is free any more
    const closed = unwrap(markPhasesDone(played, { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' }))
    expect(assistedAvailability(closed, CASH1981, 'cultureAdvance').status).toBe('wrong-phase')
    const stale = { ...played, players: played.players.map((hand) => (hand.playerId === CASH1981 ? { ...hand, freeAdvancesTurn: 0 } : hand)) }
    expect(assistedAvailability(stale, CASH1981, 'cultureAdvance').reason).not.toContain('Carnegie')
  })

  it('gives free advances once a turn, so an undo of the card cannot take another grant', () => {
    const card = carnegieTurn(6)
    const played = unwrap(play(card.state, 'c-6', card.itemId))
    // Carnegie is discarded when played: put him back in the hand as a redraw would
    const discarded = played.discardedItems.find((item) => item.id === card.itemId)
    if (discarded === undefined) throw new Error('Carnegie was not discarded')
    const again = {
      ...played,
      discardedItems: played.discardedItems.filter((item) => item.id !== card.itemId),
      players: played.players.map((hand) =>
        hand.playerId === CASH1981 ? { ...hand, items: [...hand.items, { ...discarded, hidden: true, ownerId: CASH1981 }] } : hand,
      ),
    }
    expect(JSON.stringify(play(again, 'c-7', card.itemId))).toContain('already given free advances this turn')

    // Undone, the turn is free of a grant again and the card can be played anew
    const undone = undoByVote(played, 'c-6')
    expect(me(undone).freeAdvancesTurn).toBe(0)
    expect(me(undone).items.some((item) => item.id === card.itemId)).toBe(true)
    expect(me(unwrap(play(undone, 'c-8', card.itemId))).freeAdvances).toBe(2)
  })

  it('does not hand an advance undone from an earlier turn to a later bank', () => {
    const card = carnegieTurn(3)
    const played = unwrap(play(card.state, 'c-9', card.itemId))
    const advanced = unwrap(press(played, 'a-9'))
    // A later turn's bank: the credit the undone advance would give back is long expired
    const later = {
      ...advanced,
      players: advanced.players.map((hand) =>
        hand.playerId === CASH1981 ? { ...hand, freeAdvances: 1, freeAdvancesTurn: 2 } : hand,
      ),
    }
    expect(me(undoByVote(later, 'a-9')).freeAdvances).toBe(1)
    // In its own turn it does come back
    expect(me(undoByVote(advanced, 'a-9')).freeAdvances).toBe(1)
  })

  it('refuses without a leader marker on the culture track', () => {
    let state = withCivilization(firstCivGame(), 'Japanese')
    state = withStats(openCityManagement(state), { coinSources: { ...me(state).stats.coinSources, sheet: 6 } })
    const card = withCardInHand(state, 'Andrew Carnegie')
    expect(JSON.stringify(play(card.state, 'c-6', card.itemId))).toContain('not on the culture track')
  })

  it('can skip occupied spaces with Shakespeare while it spends the free advance', () => {
    let state = withCivilization(firstCivGame(), 'Japanese')
    state = withCivilization(state, 'Americans', KARANDRAS1)
    state = withMarkerAt(state, 0, 'Japanese')
    state = withMarkerAt(state, 1, 'Americans', KARANDRAS1)
    state = openCityManagement(state)
    state = withStats(state, { culture: 100, trade: 25, coinSources: { ...me(state).stats.coinSources, sheet: 3 } })
    const carnegie = withCardInHand(state, 'Andrew Carnegie')
    const shakespeare = withCardInHand(carnegie.state, 'William Shakespeare')
    const ready = {
      ...shakespeare.state,
      players: shakespeare.state.players.map((candidate) =>
        candidate.playerId === CASH1981
          ? { ...candidate, items: candidate.items.map((item) => (item.id === shakespeare.itemId ? { ...item, hidden: false } : item)) }
          : candidate,
      ),
    }
    const played = unwrap(play(ready, 'c-3', carnegie.itemId))
    const skipped = unwrap(press(played, 'skip-1', 'cultureAdvanceSkip'))
    expect(cultureMarkerLevelOf(skipped, CASH1981)).toBe(2)
    expect(me(skipped).freeAdvances).toBe(0)
    expect(me(skipped).stats.culture).toBe(100)

    const undone = undoByVote(skipped, 'skip-1')
    expect(cultureMarkerLevelOf(undone, CASH1981)).toBe(0)
    expect(me(undone).freeAdvances).toBe(1)
  })

  it('keeps the banked advances out of every other view', () => {
    const card = carnegieTurn(3)
    const played = unwrap(play(card.state, 'c-4', card.itemId))
    const other = toPlayerView(played, KARANDRAS1)
    expect(JSON.stringify(other.opponents.find((entry) => entry.playerId === CASH1981))).not.toContain('freeAdvances')
    expect(JSON.stringify(toPlayerView(played, 'spectator'))).not.toContain('freeAdvances')
  })
})
