/**
 * Chat orders (issue #215), slice 3: the new turn, the start player marker.
 * New in the port, so there is no Java counterpart; the rules are in
 * `docs/agents/tasks/chat-orders.md`, "Slice 3".
 */

import { describe, expect, it } from 'vitest'

import {
  movePiece,
  placePiece,
  placeStartMarker,
  redoLastBoardChange,
  removePiece,
  undoLastBoardChange,
} from '../src/actions/board.js'
import { withdrawFromGame } from '../src/actions/game.js'
import { markPhasesDone, unmarkPhaseDone } from '../src/actions/turn.js'
import { START_PLAYER_ID, areaAt, findBoardAsset, mapTop, playerAreas } from '../src/board.js'
import type { BoardPiece } from '../src/board.js'
import { migrateGameState } from '../src/migrate.js'
import { unwrap } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { toPlayerView } from '../src/state.js'
import { startPlayerOf, turnHolder, turnStatus } from '../src/turn.js'

import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

// Seats in the fixture: cash1981 1, Karandras1 2, Itchi 3, Chul 4
const SEATS = [CASH1981, KARANDRAS1, ITCHI, CHUL] as const

/**
 * A game with the start marker already in the start player's area and turn 1
 * recorded as started by them, which is how a game looks once the marker has been
 * put there. A new game has no marker yet (see 'a board with no marker').
 */
const markedGame = (): GameState => {
  const start = firstCivGame()
  const starter = startPlayerOf(start)
  if (starter === undefined) throw new Error('no start player')
  return {
    ...placeStartMarker(start, starter, starter.playerId, 't0'),
    startPlayerId: starter.playerId,
    turnStarters: { 1: starter.username },
  }
}

const marker = (state: GameState): BoardPiece | undefined =>
  state.board.pieces.find((piece) => piece.assetId === START_PLAYER_ID)

/** The username of the player whose area holds the marker's centre, if any. */
const markerArea = (state: GameState): string | undefined => {
  const piece = marker(state)
  if (piece === undefined) return undefined
  return areaAt(
    playerAreas(state.board, state.players),
    piece.x + piece.width / 2,
    piece.y + piece.height / 2,
  )?.username
}

const markers = (state: GameState): number =>
  state.board.pieces.filter((piece) => piece.assetId === START_PLAYER_ID).length

/** Everybody in `who` marks every phase of the turn done, in the given order. */
const finishTurn = (
  state: GameState,
  turnNumber: number,
  who: readonly string[] = SEATS,
): GameState =>
  who.reduce(
    (current, playerId) =>
      unwrap(markPhasesDone(current, { playerId, turnNumber, upToPhase: 'RESEARCH', at: `t${turnNumber}` })),
    state,
  )

const startLines = (state: GameState): string[] =>
  state.log.map((entry) => entry.publicLog).filter((line) => line.includes('starts with the Start of turn phase'))

describe('starting the next turn', () => {
  it('moves the marker one seat clockwise when the last player finishes Research', () => {
    let state = markedGame()
    state = finishTurn(state, 1, [CASH1981, KARANDRAS1, ITCHI])
    // Not over yet: Chul is still working
    expect(turnStatus(state).currentTurn).toBe(1)
    expect(markerArea(state)).toBe('cash1981')
    expect(state.turnStarters[2]).toBeUndefined()

    state = unwrap(markPhasesDone(state, { playerId: CHUL, turnNumber: 1, upToPhase: 'RESEARCH', at: 'end' }))

    expect(turnStatus(state).currentTurn).toBe(2)
    expect(markerArea(state)).toBe('Karandras1')
    expect(startPlayerOf(state)?.username).toBe('Karandras1')
    expect(state.startPlayerId).toBe(KARANDRAS1)
    expect(state.turnStarters).toEqual({ 1: 'cash1981', 2: 'Karandras1' })
    expect(startLines(state)).toEqual(['Turn 2: Karandras1 starts with the Start of turn phase'])
    expect(toPlayerView(state, ITCHI).activeTurn?.startPlayer).toBe('Karandras1')
    // The marker move is a board history entry in the name of the player who finished
    const entry = state.board.history.at(-1)
    expect(entry?.change.kind).toBe('move')
    expect(entry?.playerId).toBe(CHUL)
    expect(entry?.at).toBe('end')
  })

  it('goes round the table and wraps from the last seat to the first', () => {
    let state = markedGame()
    const seen: (string | undefined)[] = [markerArea(state)]
    for (const turn of [1, 2, 3, 4]) {
      state = finishTurn(state, turn)
      seen.push(markerArea(state))
    }
    expect(seen).toEqual(['cash1981', 'Karandras1', 'Itchi', 'Chul', 'cash1981'])
    expect(state.turnStarters).toEqual({
      1: 'cash1981',
      2: 'Karandras1',
      3: 'Itchi',
      4: 'Chul',
      5: 'cash1981',
    })
  })

  it('the turn holder counts from the new start player', () => {
    let state = markedGame()
    expect(turnHolder(state)?.username).toBe('cash1981')
    state = finishTurn(state, 1)
    expect(turnHolder(state)?.username).toBe('Karandras1')
    state = finishTurn(state, 2)
    expect(turnHolder(state)?.username).toBe('Itchi')
  })

  it('unmarking Research and marking it again does not rotate a second time', () => {
    let state = finishTurn(markedGame(), 1)
    const historyLength = state.board.history.length
    expect(markerArea(state)).toBe('Karandras1')

    state = unwrap(unmarkPhaseDone(state, { playerId: CHUL, turnNumber: 1, phase: 'RESEARCH' }))
    // Back in turn 1, but the started turn 2 is not rolled back
    expect(turnStatus(state).currentTurn).toBe(1)
    expect(state.turnStarters[2]).toBe('Karandras1')
    expect(markerArea(state)).toBe('Karandras1')
    // and the title of turn 1 still names who started it
    expect(toPlayerView(state, CHUL).activeTurn?.startPlayer).toBe('cash1981')

    state = unwrap(markPhasesDone(state, { playerId: CHUL, turnNumber: 1, upToPhase: 'RESEARCH' }))

    expect(turnStatus(state).currentTurn).toBe(2)
    expect(markerArea(state)).toBe('Karandras1')
    expect(state.board.history).toHaveLength(historyLength)
    expect(startLines(state)).toHaveLength(1)
    expect(toPlayerView(state, CHUL).activeTurn?.startPlayer).toBe('Karandras1')
  })

  it('marking a phase other than the last does not start anything', () => {
    const state = unwrap(markPhasesDone(markedGame(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'MOVEMENT' }))
    expect(state.turnStarters).toEqual({ 1: 'cash1981' })
    expect(startLines(state)).toHaveLength(0)
  })

  it('places a marker when the board has lost it', () => {
    let state = markedGame()
    const piece = marker(state)
    if (piece === undefined) throw new Error('no marker')
    state = unwrap(removePiece(state, { playerId: CASH1981, pieceId: piece.id }))
    expect(markers(state)).toBe(0)

    state = finishTurn(state, 1)

    expect(markers(state)).toBe(1)
    // With no marker to count from, the last known start player is cash1981
    expect(markerArea(state)).toBe('Karandras1')
  })
})

describe('a board with no marker', () => {
  // A new game, and a game adopted from the old baton view, has no marker until
  // the first turn starts. The start player is then read from `startPlayerId`,
  // and from seat 1 when that is empty too.
  it('names seat 1 as the start player and lets them hold the turn', () => {
    const state = firstCivGame()
    expect(marker(state)).toBeUndefined()
    expect(startPlayerOf(state)?.username).toBe('cash1981')
    expect(turnHolder(state)?.username).toBe('cash1981')
    expect(toPlayerView(state, KARANDRAS1).activeTurn?.startPlayer).toBe('cash1981')
  })

  it('the first rotation places the marker one seat on, as a board history entry', () => {
    const state = finishTurn(firstCivGame(), 1)

    expect(markers(state)).toBe(1)
    expect(markerArea(state)).toBe('Karandras1')
    expect(state.board.history.at(-1)?.change.kind).toBe('place')
    expect(state.turnStarters).toEqual({ 2: 'Karandras1' })
    expect(state.startPlayerId).toBe(KARANDRAS1)
    expect(startLines(state)).toEqual(['Turn 2: Karandras1 starts with the Start of turn phase'])
  })

  it('counts the rotation from `startPlayerId` when it is set', () => {
    const state = finishTurn({ ...firstCivGame(), startPlayerId: ITCHI }, 1)

    expect(markerArea(state)).toBe('Chul')
    expect(state.turnStarters[2]).toBe('Chul')
  })

  it('starts a turn the baseline has already passed from the baseline, with no gap', () => {
    const state = finishTurn({ ...firstCivGame(), chatOrdersStartTurn: 21 }, 21)

    expect(turnStatus(state).currentTurn).toBe(22)
    expect(state.turnStarters).toEqual({ 22: 'Karandras1' })
    expect(markerArea(state)).toBe('Karandras1')
  })
})

describe('the marker moved by hand', () => {
  const dragTo = (state: GameState, username: string): GameState => {
    const piece = marker(state)
    const area = playerAreas(state.board, state.players).find((candidate) => candidate.username === username)
    if (piece === undefined || area === undefined) throw new Error('nothing to drag')
    return unwrap(
      movePiece(state, {
        playerId: CASH1981,
        pieceId: piece.id,
        x: area.x + area.width / 2 - piece.width / 2,
        y: area.y + area.height / 2 - piece.height / 2,
      }),
    )
  }

  it('makes the owner of the area the start player and says so in the log', () => {
    const state = dragTo(markedGame(), 'Chul')

    expect(markerArea(state)).toBe('Chul')
    expect(startPlayerOf(state)?.username).toBe('Chul')
    expect(state.log.at(-1)?.publicLog).toBe('Chul is now the start player')
    expect(state.startPlayerId).toBe(CHUL)
    // The log line is counted in the move's history entry
    expect(state.board.history.at(-1)?.logLength).toBe(state.log.length)
  })

  it('counts the next rotation from them', () => {
    const state = finishTurn(dragTo(markedGame(), 'Chul'), 1)
    expect(markerArea(state)).toBe('cash1981')
    expect(state.turnStarters[2]).toBe('cash1981')
  })

  it('says nothing when the marker stays with the same player', () => {
    const before = markedGame()
    const logLength = before.log.length
    const state = dragTo(before, 'cash1981')
    expect(state.log).toHaveLength(logLength)
  })

  it('keeps the last known start player when the marker is left in no area', () => {
    let state = dragTo(markedGame(), 'Itchi')
    const piece = marker(state)
    if (piece === undefined) throw new Error('no marker')
    state = unwrap(movePiece(state, { playerId: CASH1981, pieceId: piece.id, x: 200, y: mapTop(state.board) + 200 }))

    expect(markerArea(state)).toBeUndefined()
    expect(startPlayerOf(state)?.username).toBe('Itchi')
    expect(state.log.at(-1)?.publicLog).toBe('Itchi is now the start player')
    expect(finishTurn(state, 1).turnStarters[2]).toBe('Chul')
  })

})

describe('more than one start player marker', () => {
  // The palette does not limit the marker, so a second one can be placed. The
  // one touched last wins.
  const dropMarker = (state: GameState, x: number, y: number): GameState =>
    unwrap(placePiece(state, { playerId: CASH1981, assetId: START_PLAYER_ID, x, y }))

  const centreOfArea = (state: GameState, username: string): { x: number; y: number } => {
    const area = playerAreas(state.board, state.players).find((candidate) => candidate.username === username)
    if (area === undefined) throw new Error(`no area for ${username}`)
    const asset = findBoardAsset(START_PLAYER_ID)
    if (asset === undefined) throw new Error('no marker asset')
    return { x: area.x + (area.width - asset.width) / 2, y: area.y + (area.height - asset.height) / 2 }
  }

  /** Who owns the area each marker is in, oldest first; `undefined` for one outside every area. */
  const owners = (state: GameState): (string | undefined)[] =>
    state.board.pieces
      .filter((piece) => piece.assetId === START_PLAYER_ID)
      .map(
        (piece) =>
          areaAt(
            playerAreas(state.board, state.players),
            piece.x + piece.width / 2,
            piece.y + piece.height / 2,
          )?.username,
      )

  it('a second marker placed in another area makes that area\'s owner the start player', () => {
    const start = markedGame()
    const at = centreOfArea(start, 'Itchi')

    const state = dropMarker(start, at.x, at.y)

    expect(owners(state)).toEqual(['cash1981', 'Itchi'])
    expect(startPlayerOf(state)?.username).toBe('Itchi')
    expect(state.log.at(-1)?.publicLog).toBe('Itchi is now the start player')
    expect(state.startPlayerId).toBe(ITCHI)
    expect(turnHolder(state)?.username).toBe('Itchi')
  })

  it('rotation moves the marker that decides, and the title, holder and log agree', () => {
    const start = markedGame()
    const at = centreOfArea(start, 'Itchi')
    const two = dropMarker(start, at.x, at.y)
    const deciding = two.board.pieces.filter((piece) => piece.assetId === START_PLAYER_ID)[1]

    const state = finishTurn(two, 1)

    // From Itchi the next seat is Chul. The older marker stays where it was.
    expect(startPlayerOf(state)?.username).toBe('Chul')
    expect(owners(state)).toEqual(['cash1981', 'Chul'])
    expect(state.board.pieces.filter((piece) => piece.assetId === START_PLAYER_ID)[1]?.id).toBe(deciding?.id)
    expect(startLines(state)).toEqual(['Turn 2: Chul starts with the Start of turn phase'])
    expect(toPlayerView(state, CASH1981).activeTurn?.startPlayer).toBe('Chul')
    expect(turnHolder(state)?.username).toBe('Chul')
    expect(state.turnStarters[2]).toBe('Chul')
  })

  it('keeps deciding after the first rotation, when the moved piece sits last in the list', () => {
    const start = markedGame()
    // The first marker is the one that rotates; a second is dropped in an area later
    let state = finishTurn(start, 1)
    expect(startPlayerOf(state)?.username).toBe('Karandras1')
    expect(owners(state)).toEqual(['Karandras1'])

    const at = centreOfArea(state, 'Chul')
    state = dropMarker(state, at.x, at.y)
    expect(startPlayerOf(state)?.username).toBe('Chul')

    state = finishTurn(state, 2)
    expect(startPlayerOf(state)?.username).toBe('cash1981')
    expect(toPlayerView(state, ITCHI).activeTurn?.startPlayer).toBe('cash1981')
  })

  it('ignores a marker outside every player area', () => {
    let state = markedGame()
    const logLength = state.log.length
    state = dropMarker(state, 200, mapTop(state.board) + 200)

    expect(owners(state)).toEqual(['cash1981', undefined])
    expect(startPlayerOf(state)?.username).toBe('cash1981')
    expect(state.log).toHaveLength(logLength)

    // It cannot take over after a rotation either: the marker in the area moves
    state = finishTurn(state, 1)
    expect(startPlayerOf(state)?.username).toBe('Karandras1')
    expect(owners(state)).toEqual([undefined, 'Karandras1'])
    expect(toPlayerView(state, CHUL).activeTurn?.startPlayer).toBe('Karandras1')
    expect(turnHolder(state)?.username).toBe('Karandras1')
  })

  it('with every marker outside the areas, the last one is what rotation moves', () => {
    let state = markedGame()
    const first = marker(state)
    if (first === undefined) throw new Error('no marker')
    state = unwrap(movePiece(state, { playerId: CASH1981, pieceId: first.id, x: 200, y: mapTop(state.board) + 200 }))
    state = dropMarker(state, 400, mapTop(state.board) + 200)
    const last = state.board.pieces.filter((piece) => piece.assetId === START_PLAYER_ID)[1]
    expect(owners(state)).toEqual([undefined, undefined])

    state = finishTurn(state, 1)

    // Last known start player was cash1981, so the next seat is Karandras1
    expect(startPlayerOf(state)?.username).toBe('Karandras1')
    expect(owners(state)).toEqual([undefined, 'Karandras1'])
    expect(state.board.pieces.filter((piece) => piece.assetId === START_PLAYER_ID)[1]?.id).toBe(last?.id)
  })

})

describe('catching up when the turn advances some other way', () => {
  it('starts the turn when the withdrawal of the last unfinished player ends it', () => {
    let state = finishTurn(markedGame(), 1, [CASH1981, KARANDRAS1, ITCHI])
    expect(turnStatus(state).currentTurn).toBe(1)

    state = unwrap(withdrawFromGame(state, CHUL))

    expect(turnStatus(state).currentTurn).toBe(2)
    expect(markerArea(state)).toBe('Karandras1')
    expect(state.turnStarters[2]).toBe('Karandras1')
    expect(startLines(state)).toHaveLength(1)
    // Nobody to name as the actor, so the new start player is, and can undo it
    expect(state.board.history.at(-1)?.playerId).toBe(KARANDRAS1)
    state = unwrap(undoLastBoardChange(state, KARANDRAS1))
    expect(startPlayerOf(state)?.username).toBe('cash1981')
  })

  it('rotates once per turn when the current turn jumps by two, and leaves no gap', () => {
    // Everybody finishes turn 2 first, so finishing turn 1 takes the game from 1 to 3
    let state = finishTurn(markedGame(), 2)
    expect(turnStatus(state).currentTurn).toBe(1)
    expect(state.turnStarters).toEqual({ 1: 'cash1981' })
    state = finishTurn(state, 1, [CASH1981, KARANDRAS1, ITCHI])
    expect(state.turnStarters).toEqual({ 1: 'cash1981' })

    state = unwrap(markPhasesDone(state, { playerId: CHUL, turnNumber: 1, upToPhase: 'RESEARCH', at: 'jump' }))

    expect(turnStatus(state).currentTurn).toBe(3)
    expect(state.turnStarters).toEqual({ 1: 'cash1981', 2: 'Karandras1', 3: 'Itchi' })
    expect(markerArea(state)).toBe('Itchi')
    expect(startLines(state)).toEqual([
      'Turn 2: Karandras1 starts with the Start of turn phase',
      'Turn 3: Itchi starts with the Start of turn phase',
    ])
    expect(toPlayerView(state, CHUL).activeTurn?.startPlayer).toBe('Itchi')
    expect(turnHolder(state)?.username).toBe('Itchi')
  })

  it('does not rotate again when a Research is unmarked and marked after a jump', () => {
    let state = finishTurn(markedGame(), 2)
    state = finishTurn(state, 1)
    expect(turnStatus(state).currentTurn).toBe(3)
    const historyLength = state.board.history.length

    state = unwrap(unmarkPhaseDone(state, { playerId: CHUL, turnNumber: 2, phase: 'RESEARCH' }))
    expect(turnStatus(state).currentTurn).toBe(2)
    state = unwrap(markPhasesDone(state, { playerId: CHUL, turnNumber: 2, upToPhase: 'RESEARCH' }))

    expect(turnStatus(state).currentTurn).toBe(3)
    expect(state.board.history).toHaveLength(historyLength)
    expect(startLines(state)).toHaveLength(2)
    expect(state.turnStarters).toEqual({ 1: 'cash1981', 2: 'Karandras1', 3: 'Itchi' })
  })

  it('undoes the board entries of a jump one turn at a time', () => {
    let state = finishTurn(markedGame(), 2)
    state = finishTurn(state, 1)
    expect(markerArea(state)).toBe('Itchi')

    state = unwrap(undoLastBoardChange(state, CHUL))
    expect(markerArea(state)).toBe('Karandras1')
    state = unwrap(undoLastBoardChange(state, CHUL))
    expect(markerArea(state)).toBe('cash1981')
    expect(startPlayerOf(state)?.username).toBe('cash1981')
  })
})

describe('withdrawn players', () => {
  it('are skipped when the marker rotates', () => {
    let state = markedGame()
    state = unwrap(withdrawFromGame(state, KARANDRAS1))
    expect(state.players.map((player) => player.username)).toEqual(['cash1981', 'Itchi', 'Chul'])

    state = finishTurn(state, 1, [CASH1981, ITCHI, CHUL])

    expect(markerArea(state)).toBe('Itchi')
    expect(state.turnStarters[2]).toBe('Itchi')
  })

  it('give way to the next seat when the last known start player has withdrawn', () => {
    let state = finishTurn(markedGame(), 1)
    expect(state.startPlayerId).toBe(KARANDRAS1)
    const piece = marker(state)
    if (piece === undefined) throw new Error('no marker')
    state = unwrap(removePiece(state, { playerId: CASH1981, pieceId: piece.id }))
    state = unwrap(withdrawFromGame(state, KARANDRAS1))

    expect(startPlayerOf(state)?.username).toBe('Itchi')
    expect(turnHolder(state)?.username).toBe('Itchi')
  })

  it('never hold the turn back or start it', () => {
    let state = unwrap(withdrawFromGame(markedGame(), ITCHI))
    state = unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'SOT' }))
    expect(turnHolder(state)?.username).toBe('Karandras1')
    expect(turnHolder(state, 3)?.username).toBe('Chul')
  })
})

describe('undo and redo', () => {
  it('undoing the turn start puts the marker, and so the start player, back', () => {
    let state = finishTurn(markedGame(), 1)
    expect(startPlayerOf(state)?.username).toBe('Karandras1')

    // Chul finished last, so the marker move is Chul's own last board change
    state = unwrap(undoLastBoardChange(state, CHUL))

    expect(markerArea(state)).toBe('cash1981')
    expect(startPlayerOf(state)?.username).toBe('cash1981')
    expect(toPlayerView(state, CHUL).activeTurn?.startPlayer).toBe('cash1981')
    expect(turnHolder(state)?.username).toBe('cash1981')

    state = unwrap(redoLastBoardChange(state, CHUL))
    expect(startPlayerOf(state)?.username).toBe('Karandras1')
  })

  it('undoing a manual marker move restores the previous start player', () => {
    const start = markedGame()
    const piece = marker(start)
    const area = playerAreas(start.board, start.players).find((candidate) => candidate.username === 'Chul')
    if (piece === undefined || area === undefined) throw new Error('nothing to drag')
    let state = unwrap(movePiece(start, { playerId: KARANDRAS1, pieceId: piece.id, x: area.x, y: area.y }))
    expect(startPlayerOf(state)?.username).toBe('Chul')

    state = unwrap(undoLastBoardChange(state, KARANDRAS1))

    expect(startPlayerOf(state)?.username).toBe('cash1981')
  })
})

describe('what is public and what migrates', () => {
  it('carries the start player as a username and no private field', () => {
    let state = finishTurn(markedGame(), 1)
    state = {
      ...state,
      players: state.players.map((player) =>
        player.playerId === CASH1981
          ? { ...player, gamenote: 'SECRET-NOTE', playerTurns: player.playerTurns.map((turn) => ({ ...turn, orders: { ...turn.orders, SOT: 'SECRET-ORDER' } })) }
          : player,
      ),
    }

    const json = JSON.stringify(toPlayerView(state, KARANDRAS1))

    expect(json).toContain('"startPlayer":"Karandras1"')
    expect(json).not.toContain('SECRET-NOTE')
    expect(json).not.toContain('SECRET-ORDER')
    // An allowlist, so a new field on the view or on the active turn has to be
    // looked at: the engine's own `turnStarters` and `startPlayerId` are not on it.
    const view = toPlayerView(state, KARANDRAS1)
    expect(Object.keys(view).sort()).toEqual(
      [
        'active', 'activeTurn', 'battle', 'battleSummary', 'blockadedPieceIds', 'board',
        'boardAreas', 'gameType', 'id', 'log', 'name', 'numOfPlayers', 'numberOfDiscardedItems',
        'numberOfItemsInDeck', 'opponents', 'rev', 'techs', 'winner', 'you',
      ].sort(),
    )
    expect(Object.keys(view.activeTurn ?? {}).sort()).toEqual(
      ['phase', 'playerId', 'startPlayer', 'turnNumber', 'username', 'waitingFor'],
    )
  })

  it('an old saved game migrates to no start player and no starters', () => {
    const old = { ...firstCivGame() } as Record<string, unknown>
    delete old['startPlayerId']
    delete old['turnStarters']
    const migrated = migrateGameState(old as unknown as GameState)
    expect(migrated.startPlayerId).toBeNull()
    expect(migrated.turnStarters).toEqual({})
    expect(firstCivGame().startPlayerId).toBeNull()
    expect(firstCivGame().turnStarters).toEqual({})
  })

  it('keeps what a game already has', () => {
    const state = finishTurn(markedGame(), 1)
    const migrated = migrateGameState(state)
    expect(migrated.startPlayerId).toBe(KARANDRAS1)
    expect(migrated.turnStarters).toEqual(state.turnStarters)
  })
})
