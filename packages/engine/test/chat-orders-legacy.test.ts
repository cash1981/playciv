/**
 * Chat orders (issue #215): moving the orders of the old Turn orders panel into
 * the single chat. The engine only decides what: the public history goes to the
 * timeline (the server writes the rows) and the unpublished drafts go to the
 * owner's private note.
 */

import { describe, expect, it } from 'vitest'

import { appendLog } from '../src/log.js'
import { migrateGameState } from '../src/migrate.js'
import type { GameState } from '../src/state.js'
import { toPlayerView } from '../src/state.js'
import type { TurnPhase } from '../src/turn.js'
import { draftsToPrivateNote, publicOrderVersions, pendingDrafts, publicOrdersWithoutVersions, unpublishedDrafts } from '../src/turn.js'

import { CASH1981, CHUL, KARANDRAS1, firstCivGame } from './fixture.js'
import { savedOrder } from './saved-orders.js'

const write = (
  state: GameState,
  playerId: string,
  turnNumber: number,
  phase: TurnPhase,
  order: string,
  at?: string,
): GameState => savedOrder(state, playerId, turnNumber, phase, order, at)

describe('legacyOrdersCopied', () => {
  it('is true in a new game, which writes its orders to the timeline itself, and not in the player view', () => {
    const state = firstCivGame()
    expect(state.legacyOrdersCopied).toBe(true)
    expect(Object.keys(toPlayerView(state, CASH1981))).not.toContain('legacyOrdersCopied')
  })

  it('migrates to false for an old save, and to true for a game already in chat mode', () => {
    const old = { ...firstCivGame() } as Record<string, unknown>
    delete old['legacyOrdersCopied']
    expect(migrateGameState(old as unknown as GameState).legacyOrdersCopied).toBe(false)

    const inChatMode = { ...old, chatOrders: true }
    expect(migrateGameState(inChatMode as unknown as GameState).legacyOrdersCopied).toBe(true)
    // What is stored wins
    expect(migrateGameState({ ...firstCivGame(), legacyOrdersCopied: true }).legacyOrdersCopied).toBe(true)
    expect(migrateGameState({ ...firstCivGame(), legacyOrdersCopied: false }).legacyOrdersCopied).toBe(false)
  })
})

describe('publicOrderVersions', () => {
  it('returns every revealed version, oldest first, with its owner, turn and phase', () => {
    let state = firstCivGame()
    state = write(state, KARANDRAS1, 1, 'TRADE', 'karandras trade', '2026-01-01T10:00:00.000Z')
    state = write(state, CASH1981, 1, 'SOT', 'cash first', '2026-01-01T09:00:00.000Z')
    // Edited and revealed again: both versions are public history
    state = write(state, CASH1981, 1, 'SOT', 'cash second', '2026-01-01T11:00:00.000Z')
    state = write(state, CASH1981, 2, 'CM', 'cash turn two', '2026-01-02T09:00:00.000Z')

    expect(publicOrderVersions(state).map((v) => [v.username, v.turnNumber, v.phase, v.markdown, v.index])).toEqual([
      ['cash1981', 1, 'SOT', 'cash first', 0],
      ['Karandras1', 1, 'TRADE', 'karandras trade', 0],
      ['cash1981', 1, 'SOT', 'cash second', 1],
      ['cash1981', 2, 'CM', 'cash turn two', 0],
    ])
  })

  it('never returns a draft that was not revealed, or a private note', () => {
    let state = firstCivGame()
    state = write(state, CASH1981, 1, 'SOT', 'public order', '2026-01-01T09:00:00.000Z')
    state = write(state, CASH1981, 1, 'TRADE', 'SECRET-DRAFT')
    // Edited after the reveal: the new text is private until it is revealed again
    state = write(state, CASH1981, 1, 'SOT', 'SECRET-EDIT')
    state = {
      ...state,
      players: state.players.map((player) =>
        player.playerId === CASH1981 ? { ...player, gamenote: 'SECRET-NOTE' } : player,
      ),
    }

    const versions = publicOrderVersions(state)

    expect(versions.map((v) => v.markdown)).toEqual(['public order'])
    expect(JSON.stringify(versions)).not.toContain('SECRET')
  })

  it('leaves out a version with no usable time instead of inventing one', () => {
    let state = write(firstCivGame(), CASH1981, 1, 'SOT', 'good', '2026-01-01T09:00:00.000Z')
    const key = '1cash1981'
    const turn = state.publicTurns[key]
    if (turn === undefined) throw new Error('no public turn')
    state = {
      ...state,
      publicTurns: {
        ...state.publicTurns,
        [key]: {
          ...turn,
          history: {
            ...turn.history,
            SOT: [
              { markdown: 'no time', at: '' },
              { markdown: 'garbage time', at: 'yesterday' },
              ...turn.history.SOT,
            ],
          },
        },
      },
    }

    const versions = publicOrderVersions(state)

    expect(versions.map((v) => v.markdown)).toEqual(['good'])
    // The index is the place in the history, so it stays stable when others are skipped
    expect(versions[0]?.index).toBe(2)
  })

  it('has nothing for an order revealed before versions were kept', () => {
    const state = write(firstCivGame(), CASH1981, 1, 'SOT', 'old order', '2026-01-01T09:00:00.000Z')
    const key = '1cash1981'
    const turn = state.publicTurns[key]
    if (turn === undefined) throw new Error('no public turn')
    const legacy = { ...state, publicTurns: { ...state.publicTurns, [key]: { ...turn, history: { ...turn.history, SOT: [] } } } }
    expect(publicOrderVersions(legacy)).toEqual([])
  })
})

describe('publicOrdersWithoutVersions', () => {
  /** An order revealed before versions were kept: the text is public, the history is empty. */
  const bareReveal = (state: GameState, playerId: string, turnNumber: number, phase: TurnPhase, order: string): GameState => {
    const published = write(state, playerId, turnNumber, phase, order, '2026-01-01T00:00:00.000Z')
    const erase = <T extends { readonly history: Record<TurnPhase, readonly unknown[]> }>(turn: T): T => ({
      ...turn,
      history: { ...turn.history, [phase]: [] },
    })
    return {
      ...published,
      players: published.players.map((player) => ({ ...player, playerTurns: player.playerTurns.map(erase) })),
      publicTurns: Object.fromEntries(Object.entries(published.publicTurns).map(([key, turn]) => [key, erase(turn)])),
    }
  }
  const logReveal = (state: GameState, username: string, turnNumber: number, label: string, createdAt: string | null): GameState =>
    appendLog(state, {
      username,
      logType: 'REVEAL',
      privateLog: `Turn ${turnNumber} - ${username} revealed ${label} phase`,
      publicLog: `Turn ${turnNumber} - ${username} revealed ${label} phase`,
      createdAt,
    })

  it('returns a revealed text with an empty history, dated from the reveal log line', () => {
    let state = bareReveal(firstCivGame(), CASH1981, 2, 'CM', 'cash city management')
    state = logReveal(state, 'cash1981', 2, 'trade', '2026-02-01T08:00:00.000Z')
    state = logReveal(state, 'cash1981', 2, 'city management', '2026-02-01T09:00:00.000Z')
    state = logReveal(state, 'Karandras1', 2, 'city management', '2026-02-01T10:00:00.000Z')

    expect(publicOrderVersions(state)).toEqual([])
    expect(publicOrdersWithoutVersions(state)).toEqual([
      {
        username: 'cash1981',
        turnNumber: 2,
        phase: 'CM',
        markdown: 'cash city management',
        at: '2026-02-01T09:00:00.000Z',
        index: 0,
      },
    ])
  })

  it('takes the newest reveal line with a usable time, then the game date, then the epoch', () => {
    let state = bareReveal(firstCivGame(), CASH1981, 1, 'SOT', 'text')
    state = logReveal(state, 'cash1981', 1, 'start of turn', '2026-03-01T09:00:00.000Z')
    state = logReveal(state, 'cash1981', 1, 'start of turn', null)
    state = logReveal(state, 'cash1981', 1, 'start of turn', 'yesterday')
    expect(publicOrdersWithoutVersions(state).map((v) => v.at)).toEqual(['2026-03-01T09:00:00.000Z'])

    const noLine = { ...bareReveal(firstCivGame(), CASH1981, 1, 'SOT', 'text'), createdAt: '2026-01-05T00:00:00.000Z' }
    expect(publicOrdersWithoutVersions(noLine).map((v) => v.at)).toEqual(['2026-01-05T00:00:00.000Z'])
    expect(publicOrdersWithoutVersions({ ...noLine, createdAt: null }).map((v) => v.at)).toEqual(['1970-01-01T00:00:00.000Z'])
    expect(publicOrdersWithoutVersions({ ...noLine, createdAt: 'garbage' }).map((v) => v.at)).toEqual(['1970-01-01T00:00:00.000Z'])
  })

  it('dates each of several phases and users from its own newest usable reveal line, falling back per phase', () => {
    let state = bareReveal(firstCivGame(), CASH1981, 1, 'SOT', 'cash sot')
    state = bareReveal(state, CASH1981, 1, 'TRADE', 'cash trade')
    state = bareReveal(state, CASH1981, 2, 'TRADE', 'cash turn 2 trade')
    state = bareReveal(state, KARANDRAS1, 1, 'TRADE', 'karandras trade')
    state = bareReveal(state, KARANDRAS1, 1, 'MOVEMENT', 'karandras movement')
    state = { ...state, createdAt: '2026-01-05T00:00:00.000Z' }
    state = logReveal(state, 'cash1981', 1, 'start of turn', '2026-03-01T01:00:00.000Z')
    state = logReveal(state, 'cash1981', 1, 'start of turn', '2026-03-01T02:00:00.000Z')
    state = logReveal(state, 'cash1981', 1, 'start of turn', null)
    state = logReveal(state, 'Karandras1', 1, 'trade', '2026-03-01T03:00:00.000Z')
    state = logReveal(state, 'cash1981', 1, 'trade', '2026-03-01T04:00:00.000Z')
    state = logReveal(state, 'CASH1981', 1, 'TRADE', '2026-03-01T05:00:00.000Z')
    state = logReveal(state, 'cash1981', 1, 'trade', 'not a date')
    // Same user and phase, other turn; and a line with no usable time at all for Karandras1 movement
    state = logReveal(state, 'cash1981', 2, 'trade', '2026-03-01T06:00:00.000Z')
    state = logReveal(state, 'Karandras1', 1, 'movement', null)

    const at = (username: string, turnNumber: number, phase: TurnPhase): string | undefined =>
      publicOrdersWithoutVersions(state).find(
        (version) => version.username === username && version.turnNumber === turnNumber && version.phase === phase,
      )?.at
    // The newest usable line wins; a later line without a usable time is passed over
    expect(at('cash1981', 1, 'SOT')).toBe('2026-03-01T02:00:00.000Z')
    // Matching ignores case, and the newest of the case variants is taken
    expect(at('cash1981', 1, 'TRADE')).toBe('2026-03-01T05:00:00.000Z')
    expect(at('Karandras1', 1, 'TRADE')).toBe('2026-03-01T03:00:00.000Z')
    expect(at('cash1981', 2, 'TRADE')).toBe('2026-03-01T06:00:00.000Z')
    // No usable line for this phase: the game date, not another phase's time
    expect(at('Karandras1', 1, 'MOVEMENT')).toBe('2026-01-05T00:00:00.000Z')
    expect(publicOrdersWithoutVersions({ ...state, createdAt: null }).find((v) => v.phase === 'MOVEMENT')?.at).toBe(
      '1970-01-01T00:00:00.000Z',
    )
  })

  it('skips a phase that has versions, a blank text and a phase that is not revealed', () => {
    let state = write(firstCivGame(), CASH1981, 1, 'SOT', 'versioned', '2026-01-01T09:00:00.000Z')
    state = bareReveal(state, CASH1981, 1, 'TRADE', '   ')
    state = write(state, CASH1981, 1, 'CM', 'unrevealed')
    expect(publicOrdersWithoutVersions(state)).toEqual([])
  })

  it('reads only the public copy: an unrevealed draft and an edit made after the reveal never appear', () => {
    let state = bareReveal(firstCivGame(), CASH1981, 1, 'SOT', 'public text')
    state = write(state, CASH1981, 1, 'TRADE', 'SECRET-DRAFT')
    // Edited after the reveal: the player's own turn holds the new text, the public copy is masked
    state = write(state, CASH1981, 1, 'SOT', 'SECRET-EDIT')
    state = {
      ...state,
      players: state.players.map((player) =>
        player.playerId === CASH1981 ? { ...player, gamenote: 'SECRET-NOTE' } : player,
      ),
    }
    const secrets = JSON.stringify(publicOrdersWithoutVersions(state))
    expect(secrets).not.toContain('SECRET')

    // A phase still revealed in the public copy returns the text that was revealed, not a later edit
    const stillPublic = bareReveal(firstCivGame(), CASH1981, 1, 'SOT', 'revealed text')
    const edited: GameState = {
      ...stillPublic,
      players: stillPublic.players.map((player) => ({
        ...player,
        playerTurns: player.playerTurns.map((turn) => ({ ...turn, orders: { ...turn.orders, SOT: 'SECRET-LATER-EDIT' } })),
      })),
    }
    expect(publicOrdersWithoutVersions(edited).map((v) => v.markdown)).toEqual(['revealed text'])
  })

  it('is oldest first, by the date it was given', () => {
    let state = bareReveal(firstCivGame(), CASH1981, 1, 'SOT', 'later')
    state = bareReveal(state, KARANDRAS1, 1, 'SOT', 'earlier')
    state = logReveal(state, 'cash1981', 1, 'start of turn', '2026-01-02T00:00:00.000Z')
    state = logReveal(state, 'Karandras1', 1, 'start of turn', '2026-01-01T00:00:00.000Z')
    expect(publicOrdersWithoutVersions(state).map((v) => v.markdown)).toEqual(['earlier', 'later'])
  })
})

describe('draftsToPrivateNote', () => {
  const withNote = (state: GameState, playerId: string, gamenote: string | null): GameState => ({
    ...state,
    players: state.players.map((player) => (player.playerId === playerId ? { ...player, gamenote } : player)),
  })
  const noteOf = (state: GameState, playerId: string): string | null | undefined =>
    state.players.find((player) => player.playerId === playerId)?.gamenote

  it('puts an unpublished draft in its owner\'s note, under a heading, and nowhere else', () => {
    let state = write(firstCivGame(), CASH1981, 3, 'TRADE', 'sell the silk')
    state = write(state, KARANDRAS1, 1, 'SOT', 'karandras draft')

    const moved = draftsToPrivateNote(state)

    expect(noteOf(moved, CASH1981)).toBe('### Turn 3, trade (unpublished draft)\n\nsell the silk')
    expect(noteOf(moved, KARANDRAS1)).toBe('### Turn 1, start of turn (unpublished draft)\n\nkarandras draft')
    // Nothing public changed, and the players' own turns are as they were
    expect(moved.publicTurns).toBe(state.publicTurns)
    expect(moved.log).toBe(state.log)
    expect(moved.players.map((player) => player.playerTurns)).toEqual(state.players.map((player) => player.playerTurns))
  })

  it('does not show a draft to another player in the projection, and shows it to the owner', () => {
    const moved = draftsToPrivateNote(write(firstCivGame(), CASH1981, 2, 'CM', 'SECRET-DRAFT-TEXT'))

    expect(JSON.stringify(toPlayerView(moved, KARANDRAS1))).not.toContain('SECRET-DRAFT-TEXT')
    expect(toPlayerView(moved, CASH1981).you?.gamenote).toContain('SECRET-DRAFT-TEXT')
  })

  it('adds to a note that already has text, after it and a blank line, in turn and phase order', () => {
    let state = withNote(firstCivGame(), CASH1981, 'my own note\n')
    state = write(state, CASH1981, 2, 'SOT', 'second turn')
    state = write(state, CASH1981, 1, 'MOVEMENT', 'first turn movement')
    state = write(state, CASH1981, 1, 'TRADE', 'first turn trade')

    expect(noteOf(draftsToPrivateNote(state), CASH1981)).toBe(
      [
        'my own note',
        '### Turn 1, trade (unpublished draft)\n\nfirst turn trade',
        '### Turn 1, movement (unpublished draft)\n\nfirst turn movement',
        '### Turn 2, start of turn (unpublished draft)\n\nsecond turn',
      ].join('\n\n'),
    )
  })

  it('does not copy an order that was published, only a draft written after it', () => {
    let state = write(firstCivGame(), CASH1981, 1, 'SOT', 'published order', '2026-01-01T09:00:00.000Z')
    expect(noteOf(draftsToPrivateNote(state), CASH1981)).toBeNull()

    // Edited after the reveal: the new text is private again, the old one stays public
    state = write(state, CASH1981, 1, 'SOT', 'edited, not yet published')
    const note = noteOf(draftsToPrivateNote(state), CASH1981)
    expect(note).toContain('edited, not yet published')
    expect(note).not.toContain('published order')
  })

  it('adds nothing for an empty or blank draft, and returns the same state', () => {
    let state = write(firstCivGame(), CASH1981, 1, 'SOT', '')
    state = write(state, CASH1981, 1, 'TRADE', '   \n ')
    expect(unpublishedDrafts(state)).toEqual([])
    expect(draftsToPrivateNote(state)).toBe(state)
  })

  it('a second run adds nothing more', () => {
    const once = draftsToPrivateNote(write(firstCivGame(), CASH1981, 1, 'CM', 'a draft'))
    expect(draftsToPrivateNote(once)).toEqual(once)
  })

  it('pendingDrafts leaves out a draft whose section the note holds, and is empty after the move', () => {
    let state = write(firstCivGame(), CASH1981, 1, 'SOT', 'in the note')
    state = write(state, CASH1981, 2, 'TRADE', 'not yet')
    state = write(state, KARANDRAS1, 1, 'CM', 'theirs')
    state = withNote(state, CASH1981, '### Turn 1, start of turn (unpublished draft)\n\nin the note')
    expect(unpublishedDrafts(state)).toHaveLength(3)
    expect(pendingDrafts(state).map((draft) => draft.markdown)).toEqual(['not yet', 'theirs'])
    expect(pendingDrafts(draftsToPrivateNote(state))).toEqual([])
  })

  it('also moves the draft of a player who has withdrawn, into that player\'s own note', () => {
    const state = write(firstCivGame(), CHUL, 1, 'SOT', 'chul draft')
    const chul = state.players.find((player) => player.playerId === CHUL)
    if (chul === undefined) throw new Error('no Chul')
    const gone: GameState = {
      ...state,
      players: state.players.filter((player) => player.playerId !== CHUL),
      withdrawnPlayers: [chul],
    }
    expect(draftsToPrivateNote(gone).withdrawnPlayers[0]?.gamenote).toContain('chul draft')
  })
})
