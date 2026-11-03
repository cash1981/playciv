/**
 * Mark Twain (issue #301): "Any Time: You may discard this card to cancel a city action, a resource ability, or a
 * culture event." Cancelling rewinds the game to just before the action (design notes on #301): what came after is
 * lost, the cancelled action still costs (a city action stays the city's action of the turn, a culture event is
 * discarded), Mark Twain is discarded, and the decks drawn from since are shuffled again.
 *
 * The engine is given the earlier state, which the server reads from the stored revisions; here it is the state a
 * test kept before the action.
 */

import { describe, expect, it } from 'vitest'

import { placePiece } from '../src/actions/board.js'
import { draw } from '../src/actions/draw.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo } from '../src/actions/undo.js'
import { cityActionsTakenThisTurn, performAssistedAction } from '../src/assisted.js'
import { playableCardsOf } from '../src/assisted-cards.js'
import { SQUARE_SIZE, findBoardAsset, mapTop, slotOrigin } from '../src/board.js'
import type { BoardPiece } from '../src/board.js'
import { cancelWithTwain, twainTargetsOf } from '../src/twain.js'
import { unwrap } from '../src/result.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { GameState, Playerhand } from '../src/state.js'

import { withCardInHand } from './assisted-fixture.js'
import { CASH1981, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-11-03T10:00:00.000Z'

function put(state: GameState, assetId: string, column: number, row: number): GameState {
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`no asset ${assetId}`)
  return unwrap(
    placePiece(state, {
      playerId: CASH1981,
      assetId,
      x: column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2,
      y: mapTop(state.board) + row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2,
    }),
  )
}

/** America and a red city on B2 for Cash, City Management open, and Mark Twain in Karandras's hand. */
function scene(): { readonly state: GameState; readonly twainId: string } {
  const colors: Record<string, string> = { [CASH1981]: 'Red', [KARANDRAS1]: 'Blue', [ITCHI]: 'Green' }
  const base = firstCivGame()
  let state: GameState = { ...base, players: base.players.map((p) => ({ ...p, color: colors[p.playerId] ?? p.color })) }
  const slot = state.board.slots[0]
  if (slot === undefined) throw new Error('no slot')
  const [x, y] = slotOrigin(state.board, slot)
  state = unwrap(placePiece(state, { playerId: CASH1981, assetId: 'tiles/america', x, y }))
  state = put(state, 'cities/redcity2', 1, 1)
  state = unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))
  const twain = withCardInHand(state, 'Mark Twain', KARANDRAS1)
  return { state: twain.state, twainId: twain.itemId }
}

const player = (state: GameState, playerId: string): Playerhand => {
  const found = findPlayer(state, playerId)
  if (found === undefined) throw new Error(`no ${playerId}`)
  return found
}
const cityId = (state: GameState): string => (state.board.pieces.find((piece) => piece.category === 'city') as BoardPiece).id

const devote = (state: GameState, requestId: string, confirmed = false) =>
  unwrap(
    performAssistedAction(state, {
      playerId: CASH1981,
      action: 'devoteToTheArts',
      requestId,
      at: AT,
      payload: { cityPieceId: cityId(state) },
      ...(confirmed ? { confirmedRepeat: true } : {}),
    }),
  )

const logLineOf = (state: GameState, requestId: string): string => {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error(`no line for ${requestId}`)
  return entry.id
}

describe('Mark Twain cancelling a city action', () => {
  it('rewinds to before the action, loses what came after, keeps the city\'s action spent and discards Twain', () => {
    const { state: before, twainId } = scene()
    const devoted = devote(before, 'd-1')
    // A later action of the same player that the rewind takes with it
    const later = devote(devoted, 'd-2', true)
    expect(player(later, CASH1981).stats.culture).toBeGreaterThan(player(before, CASH1981).stats.culture)

    const cancelled = unwrap(cancelWithTwain(later, before, { holderId: KARANDRAS1, logId: logLineOf(later, 'd-1'), at: AT }))
    // The culture of both devotions is gone, as the game was before the first
    expect(player(cancelled, CASH1981).stats).toEqual(player(before, CASH1981).stats)
    // The first action stays on the record as cancelled, the second is gone
    expect(cancelled.assistedActions.map((record) => record.status)).toEqual(['cancelled'])
    expect(cityActionsTakenThisTurn(cancelled, player(cancelled, CASH1981), cityId(cancelled))).toEqual([
      'Devote to the Arts (cancelled by Mark Twain)',
    ])
    // Twain is discarded and no longer in the hand
    expect(player(cancelled, KARANDRAS1).items.some((item) => item.id === twainId)).toBe(false)
    expect(cancelled.discardedItems.some((item) => item.id === twainId)).toBe(true)
    // The log keeps the cancelled action's line and says what the rewind did
    expect(cancelled.log.some((entry) => entry.id === logLineOf(later, 'd-1'))).toBe(true)
    expect(cancelled.log.some((entry) => entry.id === logLineOf(later, 'd-2'))).toBe(false)
    const line = cancelled.log.at(-1)?.publicLog ?? ''
    expect(line).toContain('cancelled the city action of')
    expect(line).toContain('1 later action')
    expect(line).toContain('Mark Twain is discarded')
  })

  it('cannot be undone afterwards, and the city has to be confirmed for another action', () => {
    const { state: before } = scene()
    const devoted = devote(before, 'd-1')
    const cancelled = unwrap(cancelWithTwain(devoted, before, { holderId: KARANDRAS1, logId: logLineOf(devoted, 'd-1') }))
    expect(initiateUndo(cancelled, { logId: logLineOf(devoted, 'd-1'), playerId: CASH1981 }).ok).toBe(false)
    const again = performAssistedAction(cancelled, {
      playerId: CASH1981,
      action: 'devoteToTheArts',
      requestId: 'd-3',
      at: AT,
      payload: { cityPieceId: cityId(cancelled) },
    })
    expect(again.ok).toBe(false)
  })

  it('keeps the private notes, and shuffles the deck the later action drew from', () => {
    const { state: start } = scene()
    const noted: GameState = {
      ...start,
      players: start.players.map((p) => (p.playerId === CASH1981 ? { ...p, gamenote: 'my plan' } : p)),
    }
    const devoted = devote(noted, 'd-1')
    // The player then draws a card, after the action that is cancelled
    const drawn = unwrap(draw(devoted, { playerId: CASH1981, sheetName: 'CULTURE_1', confirmedOutOfTurn: true }))
    expect(drawn.items.length).toBe(devoted.items.length - 1)

    // A state kept from a stored revision has its private notes blanked
    const stored: GameState = { ...noted, players: noted.players.map((p) => ({ ...p, gamenote: '' })) }
    const cancelled = unwrap(cancelWithTwain(drawn, stored, { holderId: KARANDRAS1, logId: logLineOf(drawn, 'd-1') }))
    expect(player(cancelled, CASH1981).gamenote).toBe('my plan')
    // The drawn card is back in the deck (Twain left the deck's size alone) and the hand has not got it
    expect(cancelled.items.length).toBe(devoted.items.length)
    expect(cancelled.items.map((item) => item.id).sort()).toEqual(devoted.items.map((item) => item.id).sort())
    // The deck has been shuffled again, not left as the player saw it
    expect(cancelled.items.filter((item) => item.sheetName === 'CULTURE_1').map((item) => item.id)).not.toEqual(
      devoted.items.filter((item) => item.sheetName === 'CULTURE_1').map((item) => item.id),
    )
    expect(cancelled.rng).not.toEqual(devoted.rng)
  })
})

describe('Mark Twain cancelling a culture event', () => {
  it('discards the event, not returning it to the hand', () => {
    const { state: start } = scene()
    const event = withCardInHand(start, 'Supply Drop', CASH1981)
    const played = unwrap(
      performAssistedAction(event.state, {
        playerId: CASH1981,
        action: 'playCard',
        requestId: 'e-1',
        at: AT,
        payload: { itemId: event.itemId, targets: [] },
      }),
    )
    const cancelled = unwrap(cancelWithTwain(played, event.state, { holderId: KARANDRAS1, logId: logLineOf(played, 'e-1') }))
    expect(player(cancelled, CASH1981).items.some((item) => item.id === event.itemId)).toBe(false)
    expect(cancelled.discardedItems.some((item) => item.id === event.itemId)).toBe(true)
    expect(cancelled.log.at(-1)?.publicLog).toContain('cancelled the culture event of')
    expect(cancelled.log.at(-1)?.publicLog).toContain('The event card is discarded')
  })
})

describe('what Mark Twain may not cancel', () => {
  const asHolder = (state: GameState) => player(state, KARANDRAS1)

  it('lists the other players\' actions of the open phase to the holder, with the lines a rewind would lose', () => {
    const { state: before } = scene()
    const later = devote(devote(before, 'd-1'), 'd-2', true)
    const targets = twainTargetsOf(later, asHolder(later))
    expect(targets.map((target) => target.logId)).toEqual([logLineOf(later, 'd-1'), logLineOf(later, 'd-2')])
    expect(targets[0]?.kind).toBe('city')
    expect(targets[0]?.rolledBack).toHaveLength(1)
    expect(targets[1]?.rolledBack).toHaveLength(0)
    // Cash has no Mark Twain, and it is the card's list in the viewer's own cards only
    expect(twainTargetsOf(later, player(later, CASH1981))).toEqual([])
    const card = playableCardsOf(later, asHolder(later)).find((entry) => entry.name === 'Mark Twain')
    expect(card?.twain?.length).toBe(2)
  })

  it('refuses a city action of a player with a faceup Dr. Martin Luther King', () => {
    const { state: start } = scene()
    const king = withCardInHand(start, 'Dr. Martin Luther King', CASH1981)
    const faceup: GameState = {
      ...king.state,
      players: king.state.players.map((p) =>
        p.playerId === CASH1981 ? { ...p, items: p.items.map((item) => (item.id === king.itemId ? { ...item, hidden: false } : item)) } : p,
      ),
    }
    const devoted = devote(faceup, 'd-1')
    expect(twainTargetsOf(devoted, asHolder(devoted))).toEqual([])
    const refused = cancelWithTwain(devoted, faceup, { holderId: KARANDRAS1, logId: logLineOf(devoted, 'd-1') })
    expect(refused.ok).toBe(false)
    expect(JSON.stringify(refused)).toContain('Dr. Martin Luther King is faceup')

    // A hidden Dr. King protects nothing
    const hidden = devote(king.state, 'd-1')
    expect(twainTargetsOf(hidden, asHolder(hidden))).toHaveLength(1)
  })

  it('refuses when another player has acted since, which the rewind would erase', () => {
    const { state: before } = scene()
    const devoted = devote(before, 'd-1')
    const interleaved = unwrap(draw(devoted, { playerId: ITCHI, sheetName: 'CULTURE_1', confirmedOutOfTurn: true }))
    expect(twainTargetsOf(interleaved, asHolder(interleaved))).toEqual([])
    const refused = cancelWithTwain(interleaved, before, { holderId: KARANDRAS1, logId: logLineOf(interleaved, 'd-1') })
    expect(refused.ok).toBe(false)
    expect(JSON.stringify(refused)).toContain('Another player has acted since')
  })

  it('refuses one\'s own action, an action of an earlier turn and a holder without the card', () => {
    const { state: before } = scene()
    const devoted = devote(before, 'd-1')
    expect(cancelWithTwain(devoted, before, { holderId: CASH1981, logId: logLineOf(devoted, 'd-1') }).ok).toBe(false)
    expect(cancelWithTwain(devoted, before, { holderId: ITCHI, logId: logLineOf(devoted, 'd-1') }).ok).toBe(false)
    const older: GameState = { ...devoted, assistedActions: devoted.assistedActions.map((record) => ({ ...record, turnNumber: 0 })) }
    expect(cancelWithTwain(older, before, { holderId: KARANDRAS1, logId: logLineOf(devoted, 'd-1') }).ok).toBe(false)
  })

  it('shows nothing about the cancelled action beyond its public line to other players', () => {
    const { state: before } = scene()
    const devoted = devote(before, 'd-1')
    const cancelled = unwrap(cancelWithTwain(devoted, before, { holderId: KARANDRAS1, logId: logLineOf(devoted, 'd-1') }))
    const seen = toPlayerView(cancelled, ITCHI)
    expect(seen.assistedActions.map((action) => action.status)).toEqual(['cancelled'])
    expect(JSON.stringify(seen.assistedActions)).not.toContain('effect')
  })
})

describe('Dr. Martin Luther King', () => {
  it('is a passive card the player makes faceup, and is then in effect', () => {
    const { state: start } = scene()
    const king = withCardInHand(start, 'Dr. Martin Luther King', CASH1981)
    const listed = playableCardsOf(king.state, player(king.state, CASH1981)).find((entry) => entry.itemId === king.itemId)
    expect(listed).toMatchObject({ passive: true, status: 'ready' })
    expect(listed?.automatic).toContain('city actions cannot be canceled')

    const used = unwrap(
      performAssistedAction(king.state, {
        playerId: CASH1981,
        action: 'playCard',
        requestId: 'k-1',
        at: AT,
        payload: { itemId: king.itemId, targets: [] },
      }),
    )
    expect(player(used, CASH1981).items.find((item) => item.id === king.itemId)?.hidden).toBe(false)
    expect(playableCardsOf(used, player(used, CASH1981)).find((entry) => entry.itemId === king.itemId)?.inEffect).toBe(true)
  })
})
