/**
 * Undoing an assisted action with the vote the game already has (issue #260).
 * The item undo and its privacy rules are covered by `undo-action.test.ts` and
 * `undo-hidden-info.test.ts`, which this file does not touch.
 */

import { describe, expect, it } from 'vitest'

import { chooseTech, purchaseCoin, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { assistedAvailability, performAssistedAction } from '../src/assisted.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { toPlayerView } from '../src/state.js'

import { chivalryTurn, player, withHutInHand, withPieceInArea } from './assisted-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const OTHERS = [KARANDRAS1, ITCHI, CHUL]

const press = (state: GameState, requestId: string, action: 'chivalry' | 'democracy' = 'chivalry'): GameState =>
  unwrap(performAssistedAction(state, { playerId: CASH1981, action, requestId, at: '2026-10-01T10:00:00.000Z' }))

function logIdOf(state: GameState, requestId: string): string {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line for the action')
  return entry.id
}

function allVoteYes(state: GameState, logId: string, voters: readonly string[] = OTHERS): GameState {
  return voters.reduce(
    (next, playerId) => unwrap(vote(next, { logId, playerId, vote: true, at: '2026-10-01T10:05:00.000Z' })),
    state,
  )
}

/** Chivalry done with the incense piece. */
function afterPiece(): { state: GameState; pieceId: string; x: number; y: number; logId: string } {
  const { state, piece } = withPieceInArea(chivalryTurn(), 'resources/incense')
  const done = press(state, 'req-1')
  return { state: done, pieceId: piece.id, x: piece.x, y: piece.y, logId: logIdOf(done, 'req-1') }
}

/** Chivalry done with an Incense hut, and the piece still in the area. */
function afterHut(): { state: GameState; hutId: string; pieceId: string; logId: string } {
  const withPiece = withPieceInArea(chivalryTurn(), 'resources/incense')
  const withHut = withHutInHand(withPiece.state, 'Incense')
  const done = press(withHut.state, 'req-1')
  return { state: done, hutId: withHut.hutId, pieceId: withPiece.piece.id, logId: logIdOf(done, 'req-1') }
}

describe('asking to undo an assisted action', () => {
  it('can be started by any player, and the asker has voted yes', () => {
    const { state, logId } = afterPiece()
    const asked = unwrap(initiateUndo(state, { logId, playerId: KARANDRAS1 }))
    const entry = asked.log.find((candidate) => candidate.id === logId)
    expect(entry?.undo?.votes).toEqual({ [KARANDRAS1]: true })
    expect(entry?.undo?.numberOfVotesRequired).toBe(4)
    expect(asked.log.at(-1)?.logType).toBe('UNDO')
    expect(asked.log.at(-1)?.publicLog).toBe('Karandras1 has requested undo of Chivalry used by cash1981')
  })

  it('the request and the votes are public lines that name nothing private', () => {
    const { state, hutId, logId } = afterHut()
    let next = unwrap(initiateUndo(state, { logId, playerId: KARANDRAS1 }))
    next = unwrap(vote(next, { logId, playerId: ITCHI, vote: true }))
    expect(next.log.at(-1)?.publicLog).toBe('Itchi has voted yes to undo Chivalry used by cash1981')
    expect(next.log.at(-1)?.logType).toBe('VOTE')

    for (const viewerId of [KARANDRAS1, ITCHI, CHUL, '']) {
      const json = JSON.stringify(toPlayerView(next, viewerId))
      expect(json).not.toContain(hutId)
      expect(json).not.toContain('"effect"')
    }
    // The requester is not the actor and gets no more than the public wording
    expect(next.log.find((entry) => entry.username === 'Karandras1' && entry.logType === 'UNDO')?.item).toBeNull()
  })

  it('cannot be started twice on the same line', () => {
    const { state, logId } = afterPiece()
    const asked = unwrap(initiateUndo(state, { logId, playerId: CASH1981 }))
    expect(unwrapErr(initiateUndo(asked, { logId, playerId: KARANDRAS1 })).kind).toBe('UNDO_ALREADY_INITIATED')
  })

  it('a line with neither an item nor an assisted action still has nothing to undo', () => {
    const { state } = afterPiece()
    const plain = state.log.find((entry) => entry.logType === 'TRADE')
    if (plain === undefined) throw new Error('no phase line')
    expect(unwrapErr(initiateUndo(state, { logId: plain.id, playerId: CASH1981 })).kind).toBe('NOTHING_TO_UNDO')
    expect(unwrapErr(vote(state, { logId: plain.id, playerId: CASH1981, vote: true })).kind).toBe('UNDO_NOT_INITIATED')
  })
})

describe('a passed vote reverses the action', () => {
  it('puts the exact piece back where it was, takes the culture back and frees the use', () => {
    const { state, pieceId, x, y, logId } = afterPiece()
    const before = state.log.length

    const undone = allVoteYes(unwrap(initiateUndo(state, { logId, playerId: CASH1981 })), logId)

    expect(player(undone).stats.culture).toBe(0)
    const back = undone.board.pieces.find((piece) => piece.id === pieceId)
    expect(back).toMatchObject({ assetId: 'resources/incense', x, y })
    // Through the board history, as a placement
    expect(undone.board.history.at(-1)?.change).toMatchObject({ kind: 'place', piece: { id: pieceId } })
    expect(player(undone).playerTurns[0]?.usedActions).not.toContain('card:Chivalry')
    expect(undone.assistedActions[0]?.status).toBe('undone')
    // The piece is back in the area, so the action can be pressed again
    expect(assistedAvailability(undone, CASH1981, 'chivalry').status).toBe('ready')

    // The original line stays, and a new one says what was reversed
    expect(undone.log.find((entry) => entry.id === logId)?.publicLog).toBe(
      'cash1981 used Chivalry: spent 1 Incense and gained 5 culture',
    )
    expect(undone.log.length).toBeGreaterThan(before)
    expect(undone.log.at(-1)).toMatchObject({
      username: 'System',
      publicLog: "System: cash1981's Chivalry was undone: 5 culture removed and the Incense token returned",
    })
    expect(undone.log.at(-1)?.assistedActionId).toBeUndefined()
  })

  it('puts the exact hut back in the hand, not just any hut', () => {
    const { state, hutId, pieceId, logId } = afterHut()

    const undone = allVoteYes(unwrap(initiateUndo(state, { logId, playerId: CASH1981 })), logId)

    const hut = player(undone).items.find((item) => item.id === hutId)
    expect(hut).toMatchObject({ kind: 'hut', name: 'Incense', hidden: true, used: false })
    expect(undone.discardedItems.some((item) => item.id === hutId)).toBe(false)
    expect(player(undone).stats.culture).toBe(0)
    // The piece was never touched
    expect(undone.board.pieces.some((piece) => piece.id === pieceId)).toBe(true)
    expect(undone.board.history).toHaveLength(state.board.history.length)
    expect(undone.assistedActions[0]?.status).toBe('undone')
  })

  it('the public text of an undo names no hut, and the actor reads the same', () => {
    const { state, hutId, logId } = afterHut()
    const undone = allVoteYes(unwrap(initiateUndo(state, { logId, playerId: CASH1981 })), logId)
    for (const viewerId of [CASH1981, KARANDRAS1, '']) {
      const view = toPlayerView(undone, viewerId)
      expect(JSON.stringify(view.log)).not.toContain(hutId)
      expect(JSON.stringify(view.assistedActions)).not.toContain(hutId)
    }
    expect(toPlayerView(undone, KARANDRAS1).assistedActions[0]?.status).toBe('undone')
  })

  it('one no changes nothing', () => {
    const { state, logId, pieceId } = afterPiece()
    let next = unwrap(initiateUndo(state, { logId, playerId: CASH1981 }))
    next = unwrap(vote(next, { logId, playerId: KARANDRAS1, vote: false }))
    next = unwrap(vote(next, { logId, playerId: ITCHI, vote: true }))
    next = unwrap(vote(next, { logId, playerId: CHUL, vote: true }))

    expect(player(next).stats.culture).toBe(5)
    expect(next.board.pieces.some((piece) => piece.id === pieceId)).toBe(false)
    expect(player(next).playerTurns[0]?.usedActions).toContain('card:Chivalry')
    expect(next.assistedActions[0]?.status).toBe('applied')
    expect(next.log.at(-1)?.logType).toBe('VOTE')
    expect(next.log.find((entry) => entry.id === logId)?.undo?.done).toBe(false)
  })

  it('stays open until everybody has voted', () => {
    const { state, logId } = afterPiece()
    const partway = allVoteYes(unwrap(initiateUndo(state, { logId, playerId: CASH1981 })), logId, [KARANDRAS1, ITCHI])
    expect(partway.assistedActions[0]?.status).toBe('applied')
    expect(player(partway).stats.culture).toBe(5)
  })

  it('refuses a second undo of the same action', () => {
    const { state, logId } = afterPiece()
    const undone = allVoteYes(unwrap(initiateUndo(state, { logId, playerId: CASH1981 })), logId)

    expect(unwrapErr(initiateUndo(undone, { logId, playerId: KARANDRAS1 })).kind).toBe('ASSISTED_ACTION_ALREADY_UNDONE')
    // A vote cast again on the finished entry cannot run the reversal twice
    expect(unwrapErr(vote(undone, { logId, playerId: KARANDRAS1, vote: true })).kind).toBe('ASSISTED_ACTION_ALREADY_UNDONE')
    expect(player(undone).stats.culture).toBe(0)
  })

  it('a requestId that was undone does not redo the action when it is retried', () => {
    const { state, logId } = afterPiece()
    const undone = allVoteYes(unwrap(initiateUndo(state, { logId, playerId: CASH1981 })), logId)
    const retried = unwrap(performAssistedAction(undone, { playerId: CASH1981, action: 'chivalry', requestId: 'req-1' }))
    expect(retried).toBe(undone)
  })
})

describe('doing it again after an undo', () => {
  it('works with a new requestId, uses the token that is back and can be undone again', () => {
    const { state, pieceId, logId } = afterPiece()
    const undone = allVoteYes(unwrap(initiateUndo(state, { logId, playerId: CASH1981 })), logId)

    expect(assistedAvailability(undone, CASH1981, 'chivalry').status).toBe('ready')
    const again = press(undone, 'req-2')

    expect(player(again).stats.culture).toBe(5)
    expect(again.board.pieces.some((piece) => piece.id === pieceId)).toBe(false)
    expect(again.assistedActions.map((record) => [record.id, record.status])).toEqual([
      ['req-1', 'undone'],
      ['req-2', 'applied'],
    ])
    expect(player(again).playerTurns[0]?.usedActions.filter((key) => key === 'card:Chivalry')).toHaveLength(1)

    const logId2 = logIdOf(again, 'req-2')
    const undoneAgain = allVoteYes(unwrap(initiateUndo(again, { logId: logId2, playerId: KARANDRAS1 })), logId2, [CASH1981, ITCHI, CHUL])
    expect(player(undoneAgain).stats.culture).toBe(0)
    expect(undoneAgain.board.pieces.some((piece) => piece.id === pieceId)).toBe(true)
    expect(undoneAgain.assistedActions.map((record) => record.status)).toEqual(['undone', 'undone'])
  })
})

describe('undoing a purchase', () => {
  it('gives the trade back, removes the coin and frees the use', () => {
    let state = firstCivGame()
    state = unwrap(chooseTech(state, { playerId: CASH1981, techName: 'Democracy' }))
    state = unwrap(revealTech(state, { playerId: CASH1981, techName: 'Democracy' }))
    state = unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))
    state = {
      ...state,
      players: state.players.map((candidate) =>
        candidate.playerId === CASH1981 ? { ...candidate, stats: { ...candidate.stats, trade: 6 } } : candidate,
      ),
    }
    const bought = press(state, 'req-d', 'democracy')
    expect(player(bought).stats).toMatchObject({ trade: 0, coinSources: { democracy: 1 } })

    const logId = logIdOf(bought, 'req-d')
    const undone = allVoteYes(unwrap(initiateUndo(bought, { logId, playerId: CASH1981 })), logId)

    expect(player(undone).stats).toMatchObject({ trade: 6, coinSources: { democracy: 0 } })
    expect(player(undone).playerTurns[0]?.usedActions).not.toContain('coin-purchase:democracy')
    expect(assistedAvailability(undone, CASH1981, 'democracy').status).toBe('ready')
  })

  it('a purchase made through the old route has no record and cannot be undone', () => {
    let state = firstCivGame()
    state = unwrap(chooseTech(state, { playerId: CASH1981, techName: 'Printing Press' }))
    state = unwrap(revealTech(state, { playerId: CASH1981, techName: 'Printing Press' }))
    state = unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))
    state = {
      ...state,
      players: state.players.map((candidate) =>
        candidate.playerId === CASH1981 ? { ...candidate, stats: { ...candidate.stats, culture: 5 } } : candidate,
      ),
    }
    const bought = unwrap(purchaseCoin(state, { playerId: CASH1981, source: 'printingPress' }))
    const line = bought.log.at(-1)
    if (line === undefined) throw new Error('no line')
    expect(unwrapErr(initiateUndo(bought, { logId: line.id, playerId: CASH1981 })).kind).toBe('NOTHING_TO_UNDO')
  })
})
