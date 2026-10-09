/**
 * Undoing an assisted action with the vote the game already has (issue #260).
 * The item undo and its privacy rules are covered by `undo-action.test.ts` and
 * `undo-hidden-info.test.ts`, which this file does not touch.
 */

import { describe, expect, it } from 'vitest'

import { redoLastBoardChange, removePiece, undoLastBoardChange } from '../src/actions/board.js'
import { chooseTech, purchaseCoin, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { assistedAvailability, performAssistedAction } from '../src/assisted.js'
import { describeError } from '../src/errors.js'
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

describe('the board history and an assisted spend', () => {
  it('the board Undo refuses to put back the piece Chivalry spent, and changes nothing', () => {
    const { state, pieceId } = afterPiece()
    const snapshot = JSON.stringify(state)

    const refused = unwrapErr(undoLastBoardChange(state, CASH1981))

    expect(refused).toEqual({ kind: 'BOARD_UNDO_ASSISTED' })
    expect(describeError(refused)).toContain('assisted action')
    expect(JSON.stringify(state)).toBe(snapshot)
    expect(state.board.pieces.some((piece) => piece.id === pieceId)).toBe(false)
    expect(player(state).stats.culture).toBe(5)
    // Nothing was moved onto the redo stack either
    expect(unwrapErr(redoLastBoardChange(state, CASH1981)).kind).toBe('NOTHING_TO_REDO_ON_BOARD')
  })

  it('another player still gets the old refusal, not the assisted one', () => {
    const { state } = afterPiece()
    expect(unwrapErr(undoLastBoardChange(state, KARANDRAS1)).kind).toBe('BOARD_UNDO_NOT_YOURS')
  })

  it('works as normal after the vote has undone the action, and redo stays consistent', () => {
    const { state, pieceId, logId } = afterPiece()
    const undone = allVoteYes(unwrap(initiateUndo(state, { logId, playerId: CASH1981 })), logId)
    expect(undone.board.pieces.some((piece) => piece.id === pieceId)).toBe(true)

    // The piece the vote put back is the actor's own last change: take it off again
    const off = unwrap(undoLastBoardChange(undone, CASH1981))
    expect(off.board.pieces.some((piece) => piece.id === pieceId)).toBe(false)
    // And the old removal is an ordinary entry now, because its action is undone
    const back = unwrap(undoLastBoardChange(off, CASH1981))
    expect(back.board.pieces.some((piece) => piece.id === pieceId)).toBe(true)
    expect(player(back).stats.culture).toBe(0)

    const redone = unwrap(redoLastBoardChange(unwrap(redoLastBoardChange(back, CASH1981)), CASH1981))
    expect(redone.board.pieces.some((piece) => piece.id === pieceId)).toBe(true)
    expect(redone.board.history.length).toBe(undone.board.history.length)
  })

  it('an assisted spend freezes the earlier board undos until the vote reverses it, then they walk back one step each', () => {
    // An ordinary change first (an iron piece), then the incense piece, then the spend
    const first = withPieceInArea(chivalryTurn(), 'resources/iron')
    const second = withPieceInArea(first.state, 'resources/incense')
    const spent = press(second.state, 'req-1')
    const logId = logIdOf(spent, 'req-1')
    const hasPiece = (state: GameState, pieceId: string): boolean =>
      state.board.pieces.some((piece) => piece.id === pieceId)
    expect(spent.board.history.map((entry) => entry.change.kind)).toEqual(['place', 'place', 'remove'])

    // Frozen: the spend is the last change, and nothing earlier can be reached past it
    expect(unwrapErr(undoLastBoardChange(spent, CASH1981))).toEqual({ kind: 'BOARD_UNDO_ASSISTED' })
    expect(hasPiece(spent, first.piece.id)).toBe(true)

    const undone = allVoteYes(unwrap(initiateUndo(spent, { logId, playerId: CASH1981 })), logId)
    expect(hasPiece(undone, second.piece.id)).toBe(true)
    expect(undone.board.history.map((entry) => entry.change.kind)).toEqual(['place', 'place', 'remove', 'place'])

    // Step 1: the piece restore the vote made comes off again
    const step1 = unwrap(undoLastBoardChange(undone, CASH1981))
    expect(step1.board.history).toHaveLength(3)
    expect(hasPiece(step1, second.piece.id)).toBe(false)
    expect(hasPiece(step1, first.piece.id)).toBe(true)
    // Step 2: the old spend is an ordinary entry now, so the piece comes back
    const step2 = unwrap(undoLastBoardChange(step1, CASH1981))
    expect(step2.board.history).toHaveLength(2)
    expect(hasPiece(step2, second.piece.id)).toBe(true)
    expect(hasPiece(step2, first.piece.id)).toBe(true)
    // Step 3: the incense placement
    const step3 = unwrap(undoLastBoardChange(step2, CASH1981))
    expect(step3.board.history).toHaveLength(1)
    expect(hasPiece(step3, second.piece.id)).toBe(false)
    expect(hasPiece(step3, first.piece.id)).toBe(true)
    // Step 4: the earlier ordinary change
    const step4 = unwrap(undoLastBoardChange(step3, CASH1981))
    expect(step4.board.history).toHaveLength(0)
    expect(hasPiece(step4, first.piece.id)).toBe(false)
    expect(unwrapErr(undoLastBoardChange(step4, CASH1981)).kind).toBe('NOTHING_TO_UNDO_ON_BOARD')
  })

  it('a second press with the same piece is refused again, and only that entry', () => {
    const { state, logId } = afterPiece()
    const undone = allVoteYes(unwrap(initiateUndo(state, { logId, playerId: CASH1981 })), logId)
    const again = press(undone, 'req-2')
    expect(unwrapErr(undoLastBoardChange(again, CASH1981)).kind).toBe('BOARD_UNDO_ASSISTED')
  })

  it('a hut spend leaves the piece on the board, so the board Undo is not touched', () => {
    const { state, pieceId } = afterHut()
    // The last board change is the actor placing the piece, which stays theirs to undo
    const undone = unwrap(undoLastBoardChange(state, CASH1981))
    expect(undone.board.pieces.some((piece) => piece.id === pieceId)).toBe(false)
  })

  it('an ordinary removal by the same player is still undoable', () => {
    const { state, piece } = withPieceInArea(chivalryTurn(), 'resources/incense')
    const removed = unwrap(removePiece(state, { playerId: CASH1981, pieceId: piece.id }))
    const back = unwrap(undoLastBoardChange(removed, CASH1981))
    expect(back.board.pieces.some((candidate) => candidate.id === piece.id)).toBe(true)
  })

  it('counts the reversal line in the board history, so stepping through shows it', () => {
    const { state, pieceId, logId } = afterPiece()
    const undone = allVoteYes(unwrap(initiateUndo(state, { logId, playerId: CASH1981 })), logId)

    const last = undone.board.history.at(-1)
    expect(last?.change).toMatchObject({ kind: 'place', piece: { id: pieceId } })
    expect(undone.log.at(-1)?.publicLog).toContain('was undone')
    expect(last?.logLength).toBe(undone.log.length)
    // The invariant replay relies on: never decreasing along the history
    const lengths = undone.board.history.map((entry) => entry.logLength)
    expect(lengths).toEqual([...lengths].sort((a, b) => a - b))
  })
})
