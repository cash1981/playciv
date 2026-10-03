/**
 * Chat orders (issue #215): moving the orders of the old Turn orders panel into
 * the single chat. The engine only decides what: the public history goes to the
 * timeline (the server writes the rows) and the unpublished drafts go to the
 * owner's private note.
 */

import { describe, expect, it } from 'vitest'

import { revealTurnOrder, updateTurn } from '../src/actions/turn.js'
import { migrateGameState } from '../src/migrate.js'
import { unwrap } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { toPlayerView } from '../src/state.js'
import type { TurnPhase } from '../src/turn.js'
import { draftsToPrivateNote, publicOrderVersions, unpublishedDrafts } from '../src/turn.js'

import { CASH1981, CHUL, KARANDRAS1, firstCivGame } from './fixture.js'

const write = (
  state: GameState,
  playerId: string,
  turnNumber: number,
  phase: TurnPhase,
  order: string,
  at?: string,
): GameState => {
  const written = unwrap(updateTurn(state, { playerId, turnNumber, phase, order }))
  return at === undefined
    ? written
    : unwrap(revealTurnOrder(written, { playerId, turnNumber, phase, at }))
}

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
