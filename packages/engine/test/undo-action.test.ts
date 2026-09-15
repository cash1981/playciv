/**
 * Port of `no.asgari.civilization.server.action.UndoActionTest`.
 *
 * The Java tests navigated through Mongo and depended on the order they ran in
 * (a `@Before` that only did anything when the collection was empty). Each test
 * here stands on its own, but the scenarios are the same.
 */

import { describe, expect, it } from 'vitest'

import { draw } from '../src/actions/draw.js'
import { chooseTech, discardItem } from '../src/actions/player.js'
import {
  activeUndos,
  finishedUndos,
  initiateUndo,
  playerPutsItemBackInDeck,
  playersActiveUndos,
  vote,
} from '../src/actions/undo.js'
import { itemName } from '../src/item.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { findPlayer } from '../src/state.js'
import { resultOfVotes, votesRemaining } from '../src/undo.js'

import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const handOf = (state: GameState, playerId: string) =>
  findPlayer(state, playerId)?.items ?? []

/** Java: `createADrawAndInitiateAVoteForUndo`. */
function drawCivAndInitiateUndo(): { state: GameState; logId: string } {
  const drawn = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'CIV' }))
  const logId = drawn.log.at(-1)?.id
  if (logId === undefined) throw new Error('no log entry')

  const state = unwrap(initiateUndo(drawn, { logId, playerId: CASH1981 }))
  return { state, logId }
}

describe('initiateUndo', () => {
  it('creates a vote where the initiator has voted yes', () => {
    const { state, logId } = drawCivAndInitiateUndo()
    const entry = state.log.find((candidate) => candidate.id === logId)

    expect(entry?.undo).not.toBeNull()
    expect(Object.keys(entry?.undo?.votes ?? {})).toHaveLength(1)
    expect(entry?.undo?.votes[CASH1981]).toBe(true)
    expect(entry?.undo?.done).toBe(false)
    expect(entry?.undo?.numberOfVotesRequired).toBe(4)
  })

  it('logs the undo request', () => {
    const { state } = drawCivAndInitiateUndo()
    expect(state.log.at(-1)?.logType).toBe('UNDO')
    expect(state.log.at(-1)?.publicLog).toContain('has requested undo of')
  })

  it('cannot be started twice', () => {
    const { state, logId } = drawCivAndInitiateUndo()
    const error = unwrapErr(initiateUndo(state, { logId, playerId: KARANDRAS1 }))
    expect(error).toEqual({ kind: 'UNDO_ALREADY_INITIATED', logId })
  })

  it('a log entry with no item cannot be undone', () => {
    // Java: barbarian logs carry no draw, so Preconditions.checkNotNull failed.
    // That is why barbarians could never be undone.
    const state = firstCivGame()
    const logId = 'no-such-entry'
    expect(unwrapErr(initiateUndo(state, { logId, playerId: CASH1981 }))).toEqual({
      kind: 'LOG_ENTRY_NOT_FOUND',
      logId,
    })
  })

  it('a player outside the game cannot start an undo', () => {
    const drawn = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'CIV' }))
    const logId = drawn.log.at(-1)?.id as string
    expect(unwrapErr(initiateUndo(drawn, { logId, playerId: 'nobody' })).kind).toBe(
      'PLAYER_NOT_FOUND',
    )
  })
})

/** Java: `performAVoteAndCheckIt` and `voteAndCountRemaingVotes`. */
describe('vote', () => {
  it('one more vote makes two recorded votes', () => {
    const { state, logId } = drawCivAndInitiateUndo()
    const after = unwrap(vote(state, { logId, playerId: KARANDRAS1, vote: true }))
    const entry = after.log.find((candidate) => candidate.id === logId)

    expect(Object.keys(entry?.undo?.votes ?? {})).toHaveLength(2)
    expect(entry?.undo?.done).toBe(false)
  })

  it('votesRemaining counts down towards the number of players', () => {
    const { state, logId } = drawCivAndInitiateUndo()
    const after = unwrap(vote(state, { logId, playerId: ITCHI, vote: true }))
    const entry = after.log.find((candidate) => candidate.id === logId)

    // Java: four players, two votes cast
    expect(entry?.undo && votesRemaining(entry.undo)).toBe(2)
  })

  it('logs the vote publicly with the public name of the item', () => {
    const { state, logId } = drawCivAndInitiateUndo()
    const after = unwrap(vote(state, { logId, playerId: KARANDRAS1, vote: true }))

    expect(after.log.at(-1)?.publicLog).toBe(
      `Karandras1 has voted yes to undo Civ with item number ${
        state.log.find((c) => c.id === logId)?.item?.itemNumber
      }`,
    )
  })

  it('voting without a started undo is refused', () => {
    const drawn = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'CIV' }))
    const logId = drawn.log.at(-1)?.id as string
    expect(unwrapErr(vote(drawn, { logId, playerId: CASH1981, vote: true }))).toEqual({
      kind: 'UNDO_NOT_INITIATED',
      logId,
    })
  })
})

/** Java: `allPlayersVoteYesThenPerformUndo`. */
describe('everyone votes yes', () => {
  const voteAllYes = (start: GameState, logId: string): GameState => {
    let state = start
    for (const playerId of [KARANDRAS1, ITCHI, CHUL]) {
      state = unwrap(vote(state, { logId, playerId, vote: true }))
    }
    return state
  }

  it('puts the drawn item back into the deck', () => {
    const { state: initiated, logId } = drawCivAndInitiateUndo()
    const item = initiated.log.find((candidate) => candidate.id === logId)?.item
    if (item == null) throw new Error('no item')

    expect(handOf(initiated, CASH1981).map((i) => i.id)).toContain(item.id)
    expect(initiated.items.some((i) => i.id === item.id)).toBe(false)

    const state = voteAllYes(initiated, logId)

    expect(handOf(state, CASH1981).map((i) => i.id)).not.toContain(item.id)
    expect(state.items.some((i) => i.id === item.id)).toBe(true)
    expect(state.items.find((i) => i.id === item.id)?.ownerId).toBeNull()
  })

  it('marks the undo as done', () => {
    const { state: initiated, logId } = drawCivAndInitiateUndo()
    const state = voteAllYes(initiated, logId)
    const entry = state.log.find((candidate) => candidate.id === logId)

    expect(entry?.undo?.done).toBe(true)
    expect(entry?.undo && resultOfVotes(entry.undo)).toBe(true)
    expect(Object.values(entry?.undo?.votes ?? {})).not.toContain(false)
  })

  it('logs that the deck was reshuffled', () => {
    const { state: initiated, logId } = drawCivAndInitiateUndo()
    const state = voteAllYes(initiated, logId)

    expect(
      state.log.some((entry) =>
        entry.publicLog.includes('and put back in the deck. Deck is reshuffled'),
      ),
    ).toBe(true)
  })

  it('a single no leaves the item in the hand', () => {
    const { state: initiated, logId } = drawCivAndInitiateUndo()
    const item = initiated.log.find((candidate) => candidate.id === logId)?.item
    if (item == null) throw new Error('no item')

    let state = unwrap(vote(initiated, { logId, playerId: KARANDRAS1, vote: false }))
    state = unwrap(vote(state, { logId, playerId: ITCHI, vote: true }))
    state = unwrap(vote(state, { logId, playerId: CHUL, vote: true }))

    const entry = state.log.find((candidate) => candidate.id === logId)
    expect(entry?.undo && resultOfVotes(entry.undo)).toBe(false)
    expect(entry?.undo?.done).toBe(false)
    expect(handOf(state, CASH1981).map((i) => i.id)).toContain(item.id)
  })
})

/** Java: `checkThatYouCanUndoTech`. */
describe('undoing a tech', () => {
  it('can be started on a tech choice', () => {
    const chosen = unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Navy' }))
    const logId = chosen.log.at(-1)?.id as string

    const state = unwrap(initiateUndo(chosen, { logId, playerId: CASH1981 }))
    expect(state.log.find((entry) => entry.id === logId)?.undo).not.toBeNull()
  })

  it('removes the tech from the hand once everyone has voted yes', () => {
    const chosen = unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Navy' }))
    const logId = chosen.log.at(-1)?.id as string

    let state = unwrap(initiateUndo(chosen, { logId, playerId: CASH1981 }))
    for (const playerId of [KARANDRAS1, ITCHI, CHUL]) {
      state = unwrap(vote(state, { logId, playerId, vote: true }))
    }

    expect(findPlayer(state, CASH1981)?.techsChosen).toHaveLength(0)
    expect(state.log.at(-1)?.publicLog).toContain('has removed Navy from cash1981')
  })
})

/** Undoing a discard puts the item back in the hand, not in the deck. */
describe('undoing a discard', () => {
  it('gives the card back to the player', () => {
    let state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'CULTURE_1' }))
    const card = handOf(state, CASH1981)[0]
    if (card === undefined) throw new Error('no culture card')

    state = unwrap(
      discardItem(state, {
        playerId: CASH1981,
        sheetName: 'CULTURE_1',
        itemNumber: card.itemNumber,
        name: itemName(card),
      }),
    )
    const logId = state.log.at(-1)?.id as string

    state = unwrap(initiateUndo(state, { logId, playerId: CASH1981 }))
    for (const playerId of [KARANDRAS1, ITCHI, CHUL]) {
      state = unwrap(vote(state, { logId, playerId, vote: true }))
    }

    expect(state.discardedItems).toHaveLength(0)
    expect(handOf(state, CASH1981).map((i) => i.id)).toEqual([card.id])
    expect(state.log.at(-1)?.publicLog).toContain('has added back')
  })
})

/** Java: `UndoAction.playerPutsItemBackInDeck` — no vote. */
describe('playerPutsItemBackInDeck', () => {
  it('puts an item from the hand back into the deck', () => {
    const drawn = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'HUTS' }))
    const hut = handOf(drawn, CASH1981)[0]
    if (hut === undefined) throw new Error('no hut')

    const state = unwrap(
      playerPutsItemBackInDeck(drawn, {
        playerId: CASH1981,
        sheetName: 'HUTS',
        name: itemName(hut),
      }),
    )

    expect(handOf(state, CASH1981)).toHaveLength(0)
    expect(state.items.some((item) => item.id === hut.id)).toBe(true)
  })

  it('an item the player does not hold gives ITEM_NOT_FOUND', () => {
    const error = unwrapErr(
      playerPutsItemBackInDeck(firstCivGame(), {
        playerId: CASH1981,
        sheetName: 'HUTS',
        name: 'Wheat',
      }),
    )
    expect(error.kind).toBe('ITEM_NOT_FOUND')
  })
})

/** Java: `getAllActiveUndos`, `getPlayersActiveUndoes`, `getAllFinishedUndos`. */
describe('lookups', () => {
  it('active undos are the ones not yet carried out', () => {
    const { state } = drawCivAndInitiateUndo()
    expect(activeUndos(state)).toHaveLength(1)
    expect(finishedUndos(state)).toHaveLength(0)
  })

  it('finished undos are the ones carried out', () => {
    const { state: initiated, logId } = drawCivAndInitiateUndo()
    let state = initiated
    for (const playerId of [KARANDRAS1, ITCHI, CHUL]) {
      state = unwrap(vote(state, { logId, playerId, vote: true }))
    }

    expect(finishedUndos(state)).toHaveLength(1)
    expect(activeUndos(state)).toHaveLength(0)
  })

  it('the active undos of a player are filtered on username', () => {
    const { state } = drawCivAndInitiateUndo()
    expect(playersActiveUndos(state, 'cash1981')).toHaveLength(1)
    expect(playersActiveUndos(state, 'Itchi')).toHaveLength(0)
  })
})

describe('purity', () => {
  it('vote does not mutate the input state', () => {
    const { state, logId } = drawCivAndInitiateUndo()
    const snapshot = JSON.stringify(state)

    unwrap(vote(state, { logId, playerId: KARANDRAS1, vote: true }))

    expect(JSON.stringify(state)).toBe(snapshot)
  })
})
