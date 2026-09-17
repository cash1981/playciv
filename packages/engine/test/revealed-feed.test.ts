/**
 * Tests for `revealedFeed` — the chronological feed behind the Revealed and
 * Discarded Items panel (issue #51).
 *
 * The feed shows only public information: discarded items and non-hidden hand
 * items. A hidden hand item and a hidden tech must never appear. An item that is
 * revealed and later discarded is one row carrying both facts.
 */

import { describe, expect, it } from 'vitest'

import { draw } from '../src/actions/draw.js'
import { revealedFeed } from '../src/actions/game.js'
import { chooseTech, discardItem, revealItem, revealTech } from '../src/actions/player.js'
import { itemName } from '../src/item.js'
import { unwrap } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { findPlayer } from '../src/state.js'

import { CASH1981, firstCivGame } from './fixture.js'

function handItem(state: GameState, sheetName: string) {
  const item = findPlayer(state, CASH1981)?.items.find((it) => it.sheetName === sheetName)
  if (item === undefined) throw new Error(`no ${sheetName} in hand`)
  return item
}

describe('revealedFeed', () => {
  it('is empty in a freshly started game', () => {
    expect(revealedFeed(firstCivGame())).toHaveLength(0)
  })

  it('shows a revealed-but-kept item with the revealing player', () => {
    let state = firstCivGame()
    state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'HUTS' }))
    const hut = handItem(state, 'HUTS')
    state = unwrap(
      revealItem(state, { playerId: CASH1981, sheetName: 'HUTS', itemNumber: hut.itemNumber }),
    )

    const feed = revealedFeed(state)
    expect(feed).toHaveLength(1)
    expect(feed[0]?.item.id).toBe(hut.id)
    expect(feed[0]?.revealed).toBe(true)
    expect(feed[0]?.discarded).toBe(false)
    expect(feed[0]?.username).toBe('cash1981')
  })

  it('does not show a hidden hand item', () => {
    let state = firstCivGame()
    // Drawn but never revealed: it stays hidden in the hand.
    state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'HUTS' }))
    expect(revealedFeed(state)).toHaveLength(0)
  })

  it('shows a revealed-then-discarded item once, carrying both facts', () => {
    let state = firstCivGame()
    state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'CULTURE_1' }))
    const card = handItem(state, 'CULTURE_1')
    state = unwrap(
      revealItem(state, {
        playerId: CASH1981,
        sheetName: 'CULTURE_1',
        itemNumber: card.itemNumber,
      }),
    )
    state = unwrap(
      discardItem(state, {
        playerId: CASH1981,
        sheetName: 'CULTURE_1',
        itemNumber: card.itemNumber,
        name: itemName(card),
      }),
    )

    const feed = revealedFeed(state)
    const rows = feed.filter((entry) => entry.item.itemNumber === card.itemNumber)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.revealed).toBe(true)
    expect(rows[0]?.discarded).toBe(true)
    expect(rows[0]?.username).toBe('cash1981')
  })

  it('shows a discarded item even when it was never revealed', () => {
    let state = firstCivGame()
    state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'CULTURE_1' }))
    const card = handItem(state, 'CULTURE_1')
    state = unwrap(
      discardItem(state, {
        playerId: CASH1981,
        sheetName: 'CULTURE_1',
        itemNumber: card.itemNumber,
        name: itemName(card),
      }),
    )

    const feed = revealedFeed(state)
    expect(feed).toHaveLength(1)
    expect(feed[0]?.revealed).toBe(false)
    expect(feed[0]?.discarded).toBe(true)
  })

  it('never lets a technology into the feed, even one with a REVEAL log entry', () => {
    let state = firstCivGame()
    // Techs live in techsChosen, never in the hand or discard pile. Reveal one so
    // a REVEAL log entry carries it: the feed's log walk must still refuse to add
    // it, because the walk only ever enriches a row already in the public set.
    state = unwrap(chooseTech(state, { playerId: CASH1981, techName: 'Navy' }))
    state = unwrap(revealTech(state, { playerId: CASH1981, techName: 'Navy' }))
    expect(state.log.some((entry) => entry.logType === 'REVEAL' && entry.item?.kind === 'tech')).toBe(
      true,
    )
    expect(revealedFeed(state).some((entry) => entry.item.kind === 'tech')).toBe(false)
  })

  it('does not resurrect a card that has left the public set', () => {
    // The property that protects hidden information: the log walk never adds a
    // row, it only enriches one already seeded from the public set. Reveal and
    // discard a card, then take it out of the discard pile (as a reshuffle
    // returns it to the deck). Its REVEAL/DISCARD log entries survive, but the
    // card is no longer public, so it must vanish from the feed rather than be
    // resurrected — otherwise a later hidden redraw would leak.
    let state = firstCivGame()
    state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'CULTURE_1' }))
    const card = handItem(state, 'CULTURE_1')
    state = unwrap(
      revealItem(state, {
        playerId: CASH1981,
        sheetName: 'CULTURE_1',
        itemNumber: card.itemNumber,
      }),
    )
    state = unwrap(
      discardItem(state, {
        playerId: CASH1981,
        sheetName: 'CULTURE_1',
        itemNumber: card.itemNumber,
        name: itemName(card),
      }),
    )
    expect(revealedFeed(state).some((entry) => entry.item.itemNumber === card.itemNumber)).toBe(true)

    const reshuffled: GameState = {
      ...state,
      discardedItems: state.discardedItems.filter((item) => item.itemNumber !== card.itemNumber),
    }
    expect(state.log.some((entry) => entry.logType === 'REVEAL' && entry.item?.itemNumber === card.itemNumber)).toBe(
      true,
    )
    expect(
      revealedFeed(reshuffled).some((entry) => entry.item.itemNumber === card.itemNumber),
    ).toBe(false)
  })

  it('orders the feed newest first by log timestamp', () => {
    let state = firstCivGame()
    state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'HUTS' }))
    const hut = handItem(state, 'HUTS')
    state = unwrap(
      revealItem(state, { playerId: CASH1981, sheetName: 'HUTS', itemNumber: hut.itemNumber }),
    )
    state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'CULTURE_1' }))
    const card = handItem(state, 'CULTURE_1')
    state = unwrap(
      revealItem(state, {
        playerId: CASH1981,
        sheetName: 'CULTURE_1',
        itemNumber: card.itemNumber,
      }),
    )

    // The engine leaves createdAt null (time is passed in by the server); stamp
    // the reveal entries so the hut looks older than the culture card.
    const stamped: GameState = {
      ...state,
      log: state.log.map((entry) => {
        if (entry.logType !== 'REVEAL' || entry.item === null) return entry
        if (entry.item.itemNumber === hut.itemNumber) {
          return { ...entry, createdAt: '2026-01-01T10:00:00.000Z' }
        }
        if (entry.item.itemNumber === card.itemNumber) {
          return { ...entry, createdAt: '2026-01-02T10:00:00.000Z' }
        }
        return entry
      }),
    }

    const feed = revealedFeed(stamped)
    expect(feed.map((entry) => entry.item.itemNumber)).toEqual([card.itemNumber, hut.itemNumber])
  })
})
