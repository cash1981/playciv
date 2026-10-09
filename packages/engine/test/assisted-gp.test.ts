/**
 * The Great Person space of the culture advance: valid cards only (a marker of the
 * card's type is still in the supply), the Greeks' and Organized Religion's extra
 * candidates, and the marker taken into the player's own area when a card is kept.
 * The advance itself (cost, move, undo of the plain case) is in
 * `assisted-culture-advance.test.ts`.
 *
 * Fame and Fortune p. 11 to 12: a card whose marker type has no piece left is
 * discarded faceup and the player draws again; with no marker of any type the player
 * receives no Great Person.
 */

import { describe, expect, it } from 'vitest'

import { movePiece, removePiece, undoLastBoardChange } from '../src/actions/board.js'
import { discardItem, setPlayerStat } from '../src/actions/player.js'
import { draw } from '../src/actions/draw.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { assistedAvailability, performAssistedAction } from '../src/assisted.js'
import { GREAT_PERSON_CARD_TYPES } from '../src/blockade.js'
import {
  areaAt,
  cultureCellCenter,
  findBoardAsset,
  mapTop,
  playerAreas,
  remainingBoardAssetCount,
} from '../src/board.js'
import type { BoardPiece } from '../src/board.js'
import type { Item } from '../src/item.js'
import { itemName } from '../src/item.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { cultureMarkerLevelOf, findPlayer, toPlayerView, toPublicLog } from '../src/state.js'

import { withPieceInArea } from './assisted-fixture.js'
import { AT, advanceTurn } from './culture-advance-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1 } from './fixture.js'

const OTHERS = [KARANDRAS1, ITCHI, CHUL]
const ALL_MARKERS = GREAT_PERSON_CARD_TYPES.map(([assetId]) => assetId)

const me = (state: GameState) => {
  const found = findPlayer(state, CASH1981)
  if (found === undefined) throw new Error('fixture player missing')
  return found
}

const typeOf = (card: Item): string | null => ('type' in card ? card.type : null)

/** The Great Person cards on the deck, in draw order. */
const gpDeck = (state: GameState): readonly Item[] => state.items.filter((item) => item.sheetName === 'GREAT_PERSON')

/**
 * Puts the first card of each wanted type at the top of the Great Person deck, in the
 * order given, so a test knows what the draw will take. The seeded shuffle is fixed,
 * but its order is not something a test should depend on.
 */
function withTop(state: GameState, types: readonly string[]): GameState {
  const deck = gpDeck(state)
  const used = new Set<string>()
  const top = types.map((type) => {
    const card = deck.find((candidate) => typeOf(candidate) === type && !used.has(candidate.id))
    if (card === undefined) throw new Error(`no ${type} card in the deck`)
    used.add(card.id)
    return card
  })
  const rest = state.items.filter((item) => !used.has(item.id))
  const firstGp = rest.findIndex((item) => item.sheetName === 'GREAT_PERSON')
  const at = firstGp < 0 ? rest.length : firstGp
  return { ...state, items: [...rest.slice(0, at), ...top, ...rest.slice(at)] }
}

const SCIENTIST = 'Scientist'
const GENERAL = 'General'
const ARTIST = 'Artist or Thinker'

/** Three pieces of a marker in another player's area: the supply of that type is used up. */
function exhaust(state: GameState, assetId: string, count = 3): GameState {
  let next = state
  for (let index = 0; index < count; index += 1) next = withPieceInArea(next, assetId, KARANDRAS1).state
  return next
}

const onBoard = (state: GameState, assetId: string): readonly BoardPiece[] =>
  state.board.pieces.filter((piece) => piece.assetId === assetId)

const supplyLeft = (state: GameState, assetId: string): number => {
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error('asset missing')
  return remainingBoardAssetCount(asset, state.board.pieces, state.numOfPlayers) ?? 0
}

/** The Great Person pieces in cash1981's own area. */
function markersInOwnArea(state: GameState, playerId = CASH1981): readonly BoardPiece[] {
  const areas = playerAreas(state.board, state.players)
  return state.board.pieces.filter(
    (piece) =>
      piece.category === 'greatperson' &&
      areaAt(areas, piece.x + piece.width / 2, piece.y + piece.height / 2)?.playerId === playerId,
  )
}

/** Standing on space 2, so the next advance is the Great Person space 3. */
const gpTurn = (options: Parameters<typeof advanceTurn>[0] = {}): GameState => advanceTurn({ step: 2, ...options })

const press = (state: GameState, requestId: string) =>
  performAssistedAction(state, { playerId: CASH1981, action: 'cultureAdvance', requestId, at: AT })

const advance = (state: GameState, requestId: string): GameState => unwrap(press(state, requestId))

const choose = (state: GameState, requestId: string, rewardId: string, itemId: string) =>
  performAssistedAction(state, {
    playerId: CASH1981,
    action: 'chooseReward',
    requestId,
    at: AT,
    payload: { rewardId, itemId },
  })

const effectOf = (state: GameState, requestId: string) => {
  const effect = state.assistedActions.find((record) => record.id === requestId)?.effect
  if (effect === undefined || effect.kind !== 'cultureAdvance') throw new Error('no advance record')
  return effect
}

const logIdOf = (state: GameState, requestId: string): string => {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line for the action')
  return entry.id
}

function undoByVote(state: GameState, requestId: string): GameState {
  const logId = logIdOf(state, requestId)
  let next = unwrap(initiateUndo(state, { logId, playerId: CASH1981 }))
  for (const playerId of OTHERS) next = unwrap(vote(next, { logId, playerId, vote: true, at: AT }))
  return next
}

/** Asks for the undo and casts every vote but the last; the last vote is returned for the test to try. */
function almostUndone(state: GameState, requestId: string): { readonly state: GameState; readonly last: () => ReturnType<typeof vote>; readonly logId: string } {
  const logId = logIdOf(state, requestId)
  let next = unwrap(initiateUndo(state, { logId, playerId: CASH1981 }))
  for (const playerId of [KARANDRAS1, ITCHI]) next = unwrap(vote(next, { logId, playerId, vote: true, at: AT }))
  return { state: next, logId, last: () => vote(next, { logId, playerId: CHUL, vote: true, at: AT }) }
}

const publicLines = (state: GameState): readonly string[] =>
  state.log.map(toPublicLog).map((entry) => entry.publicLog).filter((line) => line !== '')

const handItem = (state: GameState, id: string): Item | undefined => me(state).items.find((item) => item.id === id)

describe('one valid card', () => {
  it('goes to the hand hidden and takes its marker into the own area, with one public line naming the marker type', () => {
    const ready = withTop(gpTurn(), [SCIENTIST])
    const [card] = gpDeck(ready)
    const done = advance(ready, 'req-1')

    expect(card === undefined ? undefined : typeOf(card)).toBe(SCIENTIST)
    expect(handItem(done, card?.id ?? '')).toMatchObject({ hidden: true, ownerId: CASH1981 })
    expect(me(done).pendingRewards).toEqual([])
    const markers = markersInOwnArea(done)
    expect(markers.map((piece) => piece.assetId)).toEqual(['great people/scientist'])
    expect(markers[0]).toMatchObject({ category: 'greatperson', placedBy: CASH1981 })
    expect(cultureMarkerLevelOf(done, CASH1981)).toBe(3)
    expect(me(done).stats.culture).toBe(97)

    const added = publicLines(done).slice(publicLines(ready).length)
    expect(added).toEqual([
      'cash1981 advanced on the culture track to space 3 and took a scientist great person marker into reserve',
    ])
    expect(JSON.stringify(done.log.slice(ready.log.length).map(toPublicLog))).not.toContain(itemName(card as Item))
  })

  it('records the marker piece, its place and the board history entry, and the card as kept', () => {
    const ready = withTop(gpTurn(), [SCIENTIST])
    const [card] = gpDeck(ready)
    const done = advance(ready, 'req-1')
    const effect = effectOf(done, 'req-1')
    const marker = markersInOwnArea(done)[0]

    expect(effect.kept).toBe(card?.id)
    expect(effect.drawn).toEqual([card?.id])
    expect(effect.rejected).toEqual([])
    expect(effect.marker).toEqual({
      assetId: 'great people/scientist',
      pieceId: marker?.id,
      position: { x: marker?.x, y: marker?.y },
      historyId: done.board.history.at(-1)?.id,
    })
    const entry = done.board.history.at(-1)
    expect(entry?.change.kind).toBe('place')
    expect(entry?.at).toBe(AT)
    // Counted in with the lines, so stepping through the history shows them together
    expect(entry?.logLength).toBe(done.log.length)
    const lengths = done.board.history.map((candidate) => candidate.logLength)
    expect(lengths).toEqual([...lengths].sort((a, b) => a - b))
  })

  it('tidies the marker into the area grid, so a second one beside it does not pile on top', () => {
    const first = advance(withTop(gpTurn(), [SCIENTIST]), 'req-1')
    const beside = withPieceInArea(first, 'great people/general').state
    const positions = markersInOwnArea(beside).map((piece) => `${piece.x},${piece.y}`)
    expect(positions).toHaveLength(2)
    expect(new Set(positions).size).toBe(2)
  })

  it('a culture event space takes no marker', () => {
    const done = advance(advanceTurn({ step: 0 }), 'req-1')
    expect(done.board.pieces.filter((piece) => piece.category === 'greatperson')).toEqual([])
    expect(effectOf(done, 'req-1').marker).toBeUndefined()
    expect(effectOf(done, 'req-1').rejected).toBeUndefined()
  })

  it('is idempotent by request id: the same press again changes nothing and takes no second marker', () => {
    const done = advance(withTop(gpTurn(), [SCIENTIST]), 'req-1')
    expect(unwrap(press(done, 'req-1'))).toBe(done)
    expect(markersInOwnArea(done)).toHaveLength(1)
  })
})

describe('a card whose marker type is exhausted', () => {
  it('is discarded faceup with a public line, and another card is drawn', () => {
    const exhausted = exhaust(withTop(gpTurn(), [SCIENTIST, GENERAL]), 'great people/scientist')
    const [first, second] = gpDeck(exhausted)
    expect(first && typeOf(first)).toBe(SCIENTIST)
    const done = advance(exhausted, 'req-1')

    expect(done.discardedItems.map((item) => item.id)).toContain(first?.id)
    expect(handItem(done, first?.id ?? '')).toBeUndefined()
    expect(handItem(done, second?.id ?? '')).toBeDefined()
    expect(markersInOwnArea(done).map((piece) => piece.assetId)).toEqual(['great people/general'])
    expect(effectOf(done, 'req-1').rejected).toEqual([first?.id])
    expect(effectOf(done, 'req-1').drawn).toEqual([second?.id])

    const added = publicLines(done).slice(publicLines(exhausted).length)
    // The rejected card is public by the rulebook: named, with the type that was out
    expect(added).toEqual([
      `cash1981 drew the Great Person card ${itemName(first as Item)}, but no scientist marker is left, so it was discarded faceup`,
      'cash1981 advanced on the culture track to space 3 and took a general great person marker into reserve',
    ])
    // The card that was kept is not named
    expect(added.join('\n')).not.toContain(itemName(second as Item))
  })

  it('the rejected card has no item log line and is not in any hand', () => {
    const exhausted = exhaust(withTop(gpTurn(), [SCIENTIST, GENERAL]), 'great people/scientist')
    const done = advance(exhausted, 'req-1')
    expect(done.log.slice(exhausted.log.length).every((entry) => entry.item === null)).toBe(true)
    for (const player of done.players) {
      expect(player.items.some((item) => item.sheetName === 'GREAT_PERSON' && player.playerId !== CASH1981)).toBe(false)
    }
  })

  it('with every type exhausted nothing is received, and the advance still moves and is paid', () => {
    let state = gpTurn()
    for (const assetId of ALL_MARKERS) state = exhaust(state, assetId)
    const total = gpDeck(state).length
    expect(assistedAvailability(state, CASH1981, 'cultureAdvance').status).toBe('ready')

    const done = advance(state, 'req-1')

    expect(cultureMarkerLevelOf(done, CASH1981)).toBe(3)
    expect(me(done).stats.culture).toBe(97)
    expect(me(done).items).toEqual([])
    expect(me(done).pendingRewards).toEqual([])
    expect(markersInOwnArea(done)).toEqual([])
    // Every card was drawn once, discarded faceup, and none came back: the draw ended
    expect(gpDeck(done)).toEqual([])
    expect(done.discardedItems.filter((item) => item.sheetName === 'GREAT_PERSON')).toHaveLength(total)
    const lines = publicLines(done).slice(publicLines(state).length)
    expect(lines).toHaveLength(total + 1)
    expect(lines.at(-1)).toBe(
      'cash1981 advanced on the culture track to space 3 and gained no Great Person, because no marker was available',
    )
    expect(effectOf(done, 'req-1')).toMatchObject({ drawn: [], kept: null, marker: null })
    expect(effectOf(done, 'req-1').rejected).toHaveLength(total)
  })

  it('stops cleanly when the deck is empty and the discards hold only unusable cards: one reshuffle, no loop', () => {
    let state = gpTurn()
    for (const assetId of ALL_MARKERS) state = exhaust(state, assetId)
    const cards = gpDeck(state)
    const emptied: GameState = {
      ...state,
      items: state.items.filter((item) => item.sheetName !== 'GREAT_PERSON'),
      discardedItems: [...state.discardedItems, ...cards],
    }
    const done = advance(emptied, 'req-1')
    expect(done.log.filter((entry) => entry.logType === 'SHUFFLE')).toHaveLength(1)
    expect(gpDeck(done)).toEqual([])
    expect(done.discardedItems.filter((item) => item.sheetName === 'GREAT_PERSON')).toHaveLength(cards.length)
    expect(cultureMarkerLevelOf(done, CASH1981)).toBe(3)
  })

  it('with no Great Person card anywhere the advance still moves and is paid', () => {
    const state = gpTurn()
    const none: GameState = {
      ...state,
      items: state.items.filter((item) => item.sheetName !== 'GREAT_PERSON'),
      discardedItems: state.discardedItems.filter((item) => item.sheetName !== 'GREAT_PERSON'),
    }
    const done = advance(none, 'req-1')
    expect(cultureMarkerLevelOf(done, CASH1981)).toBe(3)
    expect(me(done).stats.culture).toBe(97)
    expect(publicLines(done).at(-1)).toContain('gained no Great Person')
  })

  it('a card in the discard pile with a marker left is found by the one reshuffle', () => {
    const state = gpTurn()
    const [card] = gpDeck(state)
    const emptied: GameState = {
      ...state,
      items: state.items.filter((item) => item.sheetName !== 'GREAT_PERSON'),
      discardedItems: [...state.discardedItems, ...(card === undefined ? [] : [card])],
    }
    const done = advance(emptied, 'req-1')
    expect(handItem(done, card?.id ?? '')).toBeDefined()
    expect(markersInOwnArea(done)).toHaveLength(1)
  })

  it('never takes a marker the box does not hold: the supply stays at 3 for every type', () => {
    // Two scientists are out, so exactly one is left; taking it makes three
    const ready = exhaust(withTop(gpTurn(), [SCIENTIST]), 'great people/scientist', 2)
    const done = advance(ready, 'req-1')
    expect(onBoard(done, 'great people/scientist')).toHaveLength(3)
    for (const assetId of ALL_MARKERS) expect(supplyLeft(done, assetId)).toBeGreaterThanOrEqual(0)

    // With all three out, a scientist card is rejected, so the count cannot reach four
    const full = exhaust(withTop(gpTurn(), [SCIENTIST, GENERAL]), 'great people/scientist', 3)
    const after = advance(full, 'req-1')
    expect(onBoard(after, 'great people/scientist')).toHaveLength(3)
    expect(onBoard(after, 'great people/general')).toHaveLength(1)
  })
})

describe('Greeks and Organized Religion', () => {
  const greeks = (types: readonly string[], options: Parameters<typeof advanceTurn>[0] = {}): GameState =>
    withTop(gpTurn({ civ: 'Greeks', ...options }), types)

  it('the Greeks choose between two valid cards, Organized Religion adds a third, and they stack', () => {
    const two = advance(greeks([SCIENTIST, GENERAL]), 'req-1')
    expect(me(two).pendingRewards[0]?.candidateIds).toHaveLength(2)

    const three = advance(greeks([SCIENTIST, GENERAL, ARTIST], { policies: ['Organized Religion'] }), 'req-1')
    expect(me(three).pendingRewards[0]?.candidateIds).toHaveLength(3)
    expect(publicLines(three).at(-1)).toBe('cash1981 advanced on the culture track to space 3 and drew 3 Great Person cards')

    const one = advance(withTop(gpTurn({ policies: ['Organized Religion'] }), [SCIENTIST, GENERAL]), 'req-1')
    expect(me(one).pendingRewards[0]?.candidateIds).toHaveLength(2)
  })

  it('invalid cards do not count: it draws on until it has the valid ones', () => {
    const base = greeks([SCIENTIST, GENERAL, ARTIST, 'Humanitarian'], { policies: ['Organized Religion'] })
    const state = exhaust(base, 'great people/scientist')
    const done = advance(state, 'req-1')
    const [rejected] = gpDeck(state)
    const candidates = me(done).pendingRewards[0]?.candidateIds ?? []
    expect(candidates).toHaveLength(3)
    expect(candidates).not.toContain(rejected?.id)
    expect(effectOf(done, 'req-1').rejected).toEqual([rejected?.id])
    expect(done.discardedItems.map((item) => item.id)).toContain(rejected?.id)
    // No marker is taken before a card is kept
    expect(markersInOwnArea(done)).toEqual([])
  })

  it('keeping one takes its marker; the others are discarded; the public line names the marker only', () => {
    const pending = advance(greeks([SCIENTIST, GENERAL]), 'req-1')
    const [scientist, general] = me(pending).pendingRewards[0]?.candidateIds ?? []
    const chosen = unwrap(choose(pending, 'req-2', 'req-1', general ?? ''))

    expect(markersInOwnArea(chosen).map((piece) => piece.assetId)).toEqual(['great people/general'])
    expect(handItem(chosen, general ?? '')).toMatchObject({ hidden: true })
    expect(handItem(chosen, scientist ?? '')).toBeUndefined()
    expect(chosen.discardedItems.map((item) => item.id)).toContain(scientist)
    expect(me(chosen).pendingRewards).toEqual([])
    expect(publicLines(chosen).at(-1)).toBe('cash1981 took a general great person marker into reserve')
    expect(publicLines(chosen).join('\n')).not.toContain('kept a card')
    const effect = effectOf(chosen, 'req-1')
    expect(effect.kept).toBe(general)
    expect(effect.marker).toMatchObject({ assetId: 'great people/general', pieceId: markersInOwnArea(chosen)[0]?.id })
    // The private line still names the cards
    const privateLine = chosen.log.at(-1)
    expect(privateLine?.privateLog).toContain(`kept ${itemName(handItem(chosen, general ?? '') as Item)}`)
    expect(chosen.board.history.at(-1)?.logLength).toBe(chosen.log.length)
  })

  it('only one valid card left resolves at once and takes the marker, even for the Greeks', () => {
    let state = greeks([GENERAL])
    // Every type but generals is used up, and only one general card is left to draw
    for (const assetId of ALL_MARKERS.filter((id) => id !== 'great people/general')) state = exhaust(state, assetId)
    const onlyGeneral = gpDeck(state).filter((card) => typeOf(card) === GENERAL)[0]
    state = { ...state, items: state.items.filter((item) => item.sheetName !== 'GREAT_PERSON' || item.id === onlyGeneral?.id || typeOf(item) !== GENERAL) }
    const done = advance(state, 'req-1')

    expect(me(done).pendingRewards).toEqual([])
    expect(handItem(done, onlyGeneral?.id ?? '')).toBeDefined()
    expect(markersInOwnArea(done).map((piece) => piece.assetId)).toEqual(['great people/general'])
    expect(publicLines(done).at(-1)).toBe(
      'cash1981 advanced on the culture track to space 3 and took a general great person marker into reserve',
    )
    expect(effectOf(done, 'req-1').kept).toBe(onlyGeneral?.id)
  })

  it('the choice survives a refresh: a new projection and a retried press draw nothing', () => {
    const pending = advance(greeks([SCIENTIST, GENERAL]), 'req-1')
    const first = toPlayerView(pending, CASH1981)
    const second = toPlayerView(pending, CASH1981)
    expect(second.you?.pendingRewards).toEqual(first.you?.pendingRewards)
    expect(first.you?.pendingRewards[0]?.candidates).toHaveLength(2)
    expect(second.numberOfItemsInDeck).toBe(first.numberOfItemsInDeck)
    expect(unwrap(press(pending, 'req-1'))).toBe(pending)
  })

  it('refuses a card whose marker ran out while the choice was waiting, and changes nothing; another card still works', () => {
    const pending = advance(greeks([SCIENTIST, GENERAL]), 'req-1')
    const [scientist, general] = me(pending).pendingRewards[0]?.candidateIds ?? []
    // Someone puts the last scientist markers on the board by hand
    const taken = exhaust(pending, 'great people/scientist')
    const refused = unwrapErr(choose(taken, 'req-2', 'req-1', scientist ?? ''))
    expect(refused).toMatchObject({ kind: 'ASSISTED_ACTION_REJECTED', status: 'unavailable' })
    expect(refused.kind === 'ASSISTED_ACTION_REJECTED' && refused.reason).toMatch(/No scientist marker is left/)
    expect(me(taken).pendingRewards).toHaveLength(1)

    const other = unwrap(choose(taken, 'req-3', 'req-1', general ?? ''))
    expect(markersInOwnArea(other).map((piece) => piece.assetId)).toEqual(['great people/general'])
  })

  it('a pending choice blocks the next advance, as before', () => {
    const pending = advance(greeks([SCIENTIST, GENERAL]), 'req-1')
    expect(assistedAvailability(pending, CASH1981, 'cultureAdvance')).toMatchObject({
      status: 'unavailable',
      reason: expect.stringContaining('Choose the card to keep'),
    })
  })

  it('a reward from before the markers existed keeps the by-hand step: no marker, the old line', () => {
    const pending = advance(greeks([SCIENTIST, GENERAL]), 'req-1')
    const old: GameState = {
      ...pending,
      assistedActions: pending.assistedActions.map((record) => {
        if (record.effect.kind !== 'cultureAdvance') return record
        const { rejected: _rejected, marker: _marker, ...rest } = record.effect
        return { ...record, effect: rest }
      }),
    }
    const [keep] = me(old).pendingRewards[0]?.candidateIds ?? []
    const chosen = unwrap(choose(old, 'req-2', 'req-1', keep ?? ''))
    expect(chosen.board.pieces.filter((piece) => piece.category === 'greatperson')).toEqual([])
    expect(publicLines(chosen).at(-1)).toBe('cash1981 kept a card')
    // Its undo is the old one: no marker to remove
    const undone = undoByVote(chosen, 'req-1')
    expect(cultureMarkerLevelOf(undone, CASH1981)).toBe(2)
  })
})

describe('undoing a Great Person advance with the vote', () => {
  it('a resolved advance: the marker leaves the board through the history, the card goes back, culture and trade return', () => {
    const ready = withTop(gpTurn(), [SCIENTIST])
    const [card] = gpDeck(ready)
    const done = advance(ready, 'req-1')
    const undone = undoByVote(done, 'req-1')

    expect(markersInOwnArea(undone)).toEqual([])
    expect(undone.board.pieces.filter((piece) => piece.category === 'greatperson')).toEqual([])
    expect(undone.board.history.at(-1)?.change.kind).toBe('move')
    expect(undone.board.history.some((entry) => entry.change.kind === 'remove')).toBe(true)
    expect(handItem(undone, card?.id ?? '')).toBeUndefined()
    expect(undone.items.some((item) => item.id === card?.id)).toBe(true)
    expect(undone.items).toHaveLength(ready.items.length)
    expect(me(undone).stats.culture).toBe(100)
    expect(cultureMarkerLevelOf(undone, CASH1981)).toBe(2)
    expect(undone.assistedActions[0]?.status).toBe('undone')
    expect(undone.log.at(-1)?.publicLog).toBe(
      "System: cash1981's culture advance was undone: the leader marker is back on space 2, 3 culture returned and the drawn cards were put back in the deck and the scientist great person marker was removed",
    )
    const lengths = undone.board.history.map((entry) => entry.logLength)
    expect(lengths).toEqual([...lengths].sort((a, b) => a - b))
  })

  it('rejected cards go back to the deck too', () => {
    const exhausted = exhaust(withTop(gpTurn(), [SCIENTIST, GENERAL]), 'great people/scientist')
    const [rejected, kept] = gpDeck(exhausted)
    const undone = undoByVote(advance(exhausted, 'req-1'), 'req-1')
    expect(undone.discardedItems.some((item) => item.id === rejected?.id)).toBe(false)
    expect(undone.items.some((item) => item.id === rejected?.id)).toBe(true)
    expect(undone.items.some((item) => item.id === kept?.id)).toBe(true)
    expect(undone.items).toHaveLength(exhausted.items.length)
    expect(undone.discardedItems).toHaveLength(exhausted.discardedItems.length)
    expect(markersInOwnArea(undone)).toEqual([])
  })

  it('before choosing: every candidate goes back, the choice is dropped and no marker was ever taken', () => {
    const ready = withTop(gpTurn({ civ: 'Greeks' }), [SCIENTIST, GENERAL])
    const pending = advance(ready, 'req-1')
    const ids = me(pending).pendingRewards[0]?.candidateIds ?? []
    const undone = undoByVote(pending, 'req-1')

    expect(me(undone).pendingRewards).toEqual([])
    for (const id of ids) {
      expect(handItem(undone, id)).toBeUndefined()
      expect(undone.items.some((item) => item.id === id)).toBe(true)
    }
    expect(undone.items).toHaveLength(ready.items.length)
    expect(undone.log.at(-1)?.publicLog).not.toContain('marker was removed')
    expect(unwrapErr(choose(undone, 'req-9', 'req-1', ids[0] ?? '')).kind).toBe('ASSISTED_ACTION_REJECTED')
  })

  it('after choosing: the marker, the kept card and the discarded one all go back', () => {
    const ready = withTop(gpTurn({ civ: 'Greeks' }), [SCIENTIST, GENERAL])
    const pending = advance(ready, 'req-1')
    const [scientist, general] = me(pending).pendingRewards[0]?.candidateIds ?? []
    const chosen = unwrap(choose(pending, 'req-2', 'req-1', scientist ?? ''))
    expect(markersInOwnArea(chosen)).toHaveLength(1)

    const undone = undoByVote(chosen, 'req-1')
    expect(markersInOwnArea(undone)).toEqual([])
    expect(handItem(undone, scientist ?? '')).toBeUndefined()
    expect(undone.discardedItems.some((item) => item.id === general)).toBe(false)
    expect(undone.items).toHaveLength(ready.items.length)
    expect(undone.discardedItems).toHaveLength(ready.discardedItems.length)
    expect(cultureMarkerLevelOf(undone, CASH1981)).toBe(2)
  })

  it('a no-result advance is undone without a marker', () => {
    let state = gpTurn()
    for (const assetId of ALL_MARKERS) state = exhaust(state, assetId)
    const done = advance(state, 'req-1')
    const undone = undoByVote(done, 'req-1')
    expect(gpDeck(undone)).toHaveLength(gpDeck(state).length)
    expect(undone.discardedItems.filter((item) => item.sheetName === 'GREAT_PERSON')).toEqual([])
    expect(cultureMarkerLevelOf(undone, CASH1981)).toBe(2)
  })

  it('is refused, and the vote stays open, when the marker was moved out of the owner area', () => {
    const done = advance(withTop(gpTurn(), [SCIENTIST]), 'req-1')
    const piece = markersInOwnArea(done)[0] as BoardPiece
    const onMap = unwrap(
      movePiece(done, { playerId: CASH1981, pieceId: piece.id, x: 200, y: mapTop(done.board) + 100, snap: false }),
    )
    expect(markersInOwnArea(onMap)).toEqual([])
    const attempt = almostUndone(onMap, 'req-1')
    const refused = unwrapErr(attempt.last())
    expect(refused).toMatchObject({ kind: 'ASSISTED_UNDO_BLOCKED', logId: attempt.logId })
    expect(refused.kind === 'ASSISTED_UNDO_BLOCKED' && refused.reason).toMatch(/left its owner/)
    expect(attempt.state.assistedActions[0]?.status).toBe('applied')
    expect(attempt.state.log.find((entry) => entry.id === attempt.logId)?.undo?.done).toBe(false)
    expect(cultureMarkerLevelOf(attempt.state, CASH1981)).toBe(3)
    expect(me(attempt.state).stats.culture).toBe(97)
    expect(handItem(attempt.state, effectOf(done, 'req-1').kept ?? '')).toBeDefined()
  })

  it('is refused when the marker was moved into another player area, or taken off the board', () => {
    const done = advance(withTop(gpTurn(), [SCIENTIST]), 'req-1')
    const piece = markersInOwnArea(done)[0] as BoardPiece
    const theirs = playerAreas(done.board, done.players).find((area) => area.playerId === KARANDRAS1)
    const given = unwrap(
      movePiece(done, { playerId: CASH1981, pieceId: piece.id, x: (theirs?.x ?? 0) + 30, y: (theirs?.y ?? 0) + 60, snap: false }),
    )
    expect(unwrapErr(almostUndone(given, 'req-1').last()).kind).toBe('ASSISTED_UNDO_BLOCKED')

    const removed = unwrap(removePiece(done, { playerId: CASH1981, pieceId: piece.id }))
    const gone = unwrapErr(almostUndone(removed, 'req-1').last())
    expect(gone.kind).toBe('ASSISTED_UNDO_BLOCKED')
    expect(gone.kind === 'ASSISTED_UNDO_BLOCKED' && gone.reason).toMatch(/no longer on the board/)
  })

  it('still undoes when the marker was only moved to another place in the owner area', () => {
    const done = advance(withTop(gpTurn(), [SCIENTIST]), 'req-1')
    const piece = markersInOwnArea(done)[0] as BoardPiece
    const area = playerAreas(done.board, done.players).find((candidate) => candidate.playerId === CASH1981)
    const nudged = unwrap(
      movePiece(done, { playerId: CASH1981, pieceId: piece.id, x: (area?.x ?? 0) + 200, y: (area?.y ?? 0) + 150, snap: false }),
    )
    const undone = undoByVote(nudged, 'req-1')
    expect(undone.board.pieces.some((candidate) => candidate.id === piece.id)).toBe(false)
  })

  it('is refused when the kept card has left the hand, and the marker stays', () => {
    const done = advance(withTop(gpTurn(), [SCIENTIST]), 'req-1')
    const kept = handItem(done, effectOf(done, 'req-1').kept ?? '') as Item
    const discarded = unwrap(
      discardItem(done, { playerId: CASH1981, sheetName: kept.sheetName, itemNumber: kept.itemNumber, name: itemName(kept) }),
    )
    const attempt = almostUndone(discarded, 'req-1')
    expect(unwrapErr(attempt.last()).kind).toBe('ITEM_NOT_FOUND')
    expect(markersInOwnArea(attempt.state)).toHaveLength(1)
    expect(attempt.state.assistedActions[0]?.status).toBe('applied')
  })

  it('a marker that was removed by hand after the undo is not removed twice', () => {
    const done = advance(withTop(gpTurn(), [SCIENTIST]), 'req-1')
    const undone = undoByVote(done, 'req-1')
    expect(unwrapErr(initiateUndo(undone, { logId: logIdOf(undone, 'req-1'), playerId: CASH1981 })).kind).toBe(
      'ASSISTED_ACTION_ALREADY_UNDONE',
    )
  })
})

describe('the board Undo', () => {
  it('refuses to undo the marker placement alone, and changes nothing', () => {
    const done = advance(withTop(gpTurn(), [SCIENTIST]), 'req-1')
    expect(done.board.history.at(-1)?.change.kind).toBe('place')
    const snapshot = JSON.stringify(done)
    expect(unwrapErr(undoLastBoardChange(done, CASH1981))).toEqual({ kind: 'BOARD_UNDO_ASSISTED' })
    expect(JSON.stringify(done)).toBe(snapshot)
  })

  it('refuses it after a choice too', () => {
    const pending = advance(withTop(gpTurn({ civ: 'Greeks' }), [SCIENTIST, GENERAL]), 'req-1')
    const [keep] = me(pending).pendingRewards[0]?.candidateIds ?? []
    const chosen = unwrap(choose(pending, 'req-2', 'req-1', keep ?? ''))
    expect(unwrapErr(undoLastBoardChange(chosen, CASH1981))).toEqual({ kind: 'BOARD_UNDO_ASSISTED' })
  })

  it('an ordinary move of the marker can be undone, and then the placement is protected again', () => {
    const done = advance(withTop(gpTurn(), [SCIENTIST]), 'req-1')
    const piece = markersInOwnArea(done)[0] as BoardPiece
    const area = playerAreas(done.board, done.players).find((candidate) => candidate.playerId === CASH1981)
    const moved = unwrap(
      movePiece(done, { playerId: CASH1981, pieceId: piece.id, x: (area?.x ?? 0) + 200, y: (area?.y ?? 0) + 150, snap: false }),
    )
    const back = unwrap(undoLastBoardChange(moved, CASH1981))
    expect(back.board.pieces.find((candidate) => candidate.id === piece.id)).toMatchObject({ x: piece.x, y: piece.y })
    expect(unwrapErr(undoLastBoardChange(back, CASH1981)).kind).toBe('BOARD_UNDO_ASSISTED')
  })
})

describe('the manual paths stay', () => {
  it('the Draw button for a Great Person draws a card and takes no marker, filtering nothing', () => {
    // The scientist supply is used up, and the Draw button still takes a scientist card, as it always did
    const state = exhaust(withTop(advanceTurn(), [SCIENTIST]), 'great people/scientist')
    const [card] = gpDeck(state)
    const drawn = unwrap(draw(state, { playerId: CASH1981, sheetName: 'GREAT_PERSON', confirmedOutOfTurn: true }))

    expect(handItem(drawn, card?.id ?? '')).toMatchObject({ hidden: true })
    expect(drawn.board.pieces).toEqual(state.board.pieces)
    expect(drawn.board.history).toEqual(state.board.history)
    expect(drawn.assistedActions).toEqual([])
    expect(drawn.discardedItems).toEqual(state.discardedItems)
    const added = drawn.log.slice(state.log.length)
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({ logType: 'ITEM', item: { id: card?.id } })
  })

  it('after the assisted flow a player can still draw a Great Person by hand, and places a marker by hand', () => {
    const done = advance(withTop(gpTurn(), [SCIENTIST]), 'req-1')
    const drawn = unwrap(draw(done, { playerId: CASH1981, sheetName: 'GREAT_PERSON', confirmedOutOfTurn: true }))
    expect(me(drawn).items.filter((item) => item.sheetName === 'GREAT_PERSON')).toHaveLength(2)
    expect(markersInOwnArea(drawn)).toHaveLength(1)
    const placed = withPieceInArea(drawn, 'great people/artist')
    expect(markersInOwnArea(placed.state)).toHaveLength(2)
  })

  it('the marker can be moved and removed by hand', () => {
    const done = advance(withTop(gpTurn(), [SCIENTIST]), 'req-1')
    const piece = markersInOwnArea(done)[0] as BoardPiece
    const moved = unwrap(movePiece(done, { playerId: CASH1981, pieceId: piece.id, x: 300, y: mapTop(done.board) + 120, snap: false }))
    expect(moved.board.pieces.find((candidate) => candidate.id === piece.id)).toMatchObject({ x: 300 })
    const removed = unwrap(removePiece(moved, { playerId: CASH1981, pieceId: piece.id }))
    expect(removed.board.pieces.some((candidate) => candidate.id === piece.id)).toBe(false)
    // The supply is free again
    expect(supplyLeft(removed, 'great people/scientist')).toBe(3)
  })

  it('the culture marker can be dragged and the counters edited after the flow', () => {
    const done = advance(withTop(gpTurn(), [SCIENTIST]), 'req-1')
    const leader = done.board.pieces.find((piece) => piece.assetId === 'leaders/japanese_red') as BoardPiece
    const target = cultureCellCenter(done.board, 9)
    const dragged = unwrap(
      movePiece(done, { playerId: CASH1981, pieceId: leader.id, x: Math.round(target.x - leader.width / 2), y: leader.y, snap: false }),
    )
    expect(cultureMarkerLevelOf(dragged, CASH1981)).toBe(9)
    const edited = unwrap(
      setPlayerStat(dragged, { editorPlayerId: CASH1981, targetPlayerId: CASH1981, stat: 'culture', value: 42 }),
    )
    expect(me(edited).stats.culture).toBe(42)
    const trade = unwrap(
      setPlayerStat(edited, { editorPlayerId: KARANDRAS1, targetPlayerId: CASH1981, stat: 'trade', value: 7 }),
    )
    expect(me(trade).stats.trade).toBe(7)
  })

  it('the board Undo still works on a manual change made before the advance', () => {
    const ready = withTop(gpTurn(), [SCIENTIST])
    const manual = withPieceInArea(ready, 'great people/artist').state
    // An advance after it protects only its own entries; once undone the older one is ordinary
    const undone = undoByVote(advance(manual, 'req-1'), 'req-1')
    const back = unwrap(undoLastBoardChange(undone, CASH1981))
    expect(back.board.history.length).toBe(undone.board.history.length - 1)
  })
})

describe('what the others can see', () => {
  const secretsOf = (state: GameState, requestId: string) => {
    const effect = effectOf(state, requestId)
    const ids = [...effect.drawn]
    const cards = ids.map((id) => handItem(state, id) as Item)
    return { ids, names: cards.map(itemName) }
  }

  const viewers = [...OTHERS, ''] as const

  it('a kept card is never named or identified to anyone else, but the marker type is public', () => {
    const done = advance(withTop(gpTurn(), [SCIENTIST]), 'req-1')
    const { ids, names } = secretsOf(done, 'req-1')
    for (const viewerId of viewers) {
      const view = toPlayerView(done, viewerId)
      const json = JSON.stringify(view)
      for (const id of ids) expect(json).not.toContain(id)
      for (const name of names) expect(json).not.toContain(name)
      expect(json).not.toContain('"effect"')
      expect(json).not.toContain('"marker":')
      // The marker is a board piece and the line says its type
      expect(view.board.pieces.some((piece) => piece.assetId === 'great people/scientist')).toBe(true)
      expect(JSON.stringify(view.log)).toContain('took a scientist great person marker into reserve')
      // The opponents carry counts that changed on any draw, nothing about the card
      expect(JSON.stringify(view.opponents)).not.toContain('great people')
    }
    const opponent = toPlayerView(done, KARANDRAS1).opponents.find((entry) => entry.playerId === CASH1981)
    expect(JSON.stringify(opponent)).not.toContain('pendingRewards')
    expect(JSON.stringify(done.log.map(toPublicLog))).not.toContain(names[0] ?? 'x')
  })

  it('pending candidates are visible to the owner only', () => {
    const pending = advance(withTop(gpTurn({ civ: 'Greeks' }), [SCIENTIST, GENERAL]), 'req-1')
    const { ids, names } = secretsOf(pending, 'req-1')
    expect(ids).toHaveLength(2)
    for (const viewerId of viewers) {
      const json = JSON.stringify(toPlayerView(pending, viewerId))
      for (const secret of [...ids, ...names]) expect(json).not.toContain(secret)
      expect(json).not.toContain('candidate')
      // The list is the viewer's own: empty for everyone but the owner, and absent for a spectator
      if (viewerId === '') expect(json).not.toContain('pendingRewards')
      else expect(toPlayerView(pending, viewerId).you?.pendingRewards).toEqual([])
    }
    expect(JSON.stringify(toPlayerView(pending, CASH1981).you?.pendingRewards)).toContain(ids[0] ?? 'x')
    // Nothing on the board gives the type away before a card is kept
    expect(pending.board.pieces.filter((piece) => piece.category === 'greatperson')).toEqual([])
  })

  it('a rejected card is public, named in the public log and the discard pile', () => {
    const exhausted = exhaust(withTop(gpTurn(), [SCIENTIST, GENERAL]), 'great people/scientist')
    const [rejected] = gpDeck(exhausted)
    const done = advance(exhausted, 'req-1')
    for (const viewerId of viewers) {
      const view = toPlayerView(done, viewerId)
      expect(JSON.stringify(view.log)).toContain(itemName(rejected as Item))
      expect(view.numberOfDiscardedItems).toBe(exhausted.discardedItems.length + 1)
    }
    // The card that was kept is not
    const kept = secretsOf(done, 'req-1')
    for (const viewerId of viewers) {
      for (const name of kept.names) {
        if (name !== itemName(rejected as Item)) expect(JSON.stringify(toPlayerView(done, viewerId).log)).not.toContain(name)
      }
    }
  })

  it('the undo request, votes and the new line carry nothing private', () => {
    const pending = advance(withTop(gpTurn({ civ: 'Greeks' }), [SCIENTIST, GENERAL]), 'req-1')
    const { ids, names } = secretsOf(pending, 'req-1')
    const chosen = unwrap(choose(pending, 'req-2', 'req-1', ids[0] ?? ''))
    const undone = undoByVote(chosen, 'req-1')
    const added = JSON.stringify(undone.log.slice(chosen.log.length).map(toPublicLog))
    for (const secret of [...ids, ...names]) expect(added).not.toContain(secret)
    for (const viewerId of viewers) {
      const json = JSON.stringify(toPlayerView(undone, viewerId))
      for (const secret of [...ids, ...names]) expect(json).not.toContain(secret)
    }
  })
})
