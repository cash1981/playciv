/**
 * Port av `no.asgari.civilization.server.action.UndoActionTest`.
 *
 * Java-testene navigerte gjennom Mongo og var avhengige av rekkefølgen testene
 * kjørte i (`@Before` som bare gjorde noe hvis samlingen var tom). Her er hver
 * test selvstendig, men scenarioene er de samme.
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
  if (logId === undefined) throw new Error('ingen loggpost')

  const state = unwrap(initiateUndo(drawn, { logId, playerId: CASH1981 }))
  return { state, logId }
}

describe('initiateUndo', () => {
  it('oppretter en avstemning der initiator har stemt ja', () => {
    const { state, logId } = drawCivAndInitiateUndo()
    const entry = state.log.find((candidate) => candidate.id === logId)

    expect(entry?.undo).not.toBeNull()
    expect(Object.keys(entry?.undo?.votes ?? {})).toHaveLength(1)
    expect(entry?.undo?.votes[CASH1981]).toBe(true)
    expect(entry?.undo?.done).toBe(false)
    expect(entry?.undo?.numberOfVotesRequired).toBe(4)
  })

  it('logger UNDO-forespørselen', () => {
    const { state } = drawCivAndInitiateUndo()
    expect(state.log.at(-1)?.logType).toBe('UNDO')
    expect(state.log.at(-1)?.publicLog).toContain('has requested undo of')
  })

  it('kan ikke initieres to ganger', () => {
    const { state, logId } = drawCivAndInitiateUndo()
    const error = unwrapErr(initiateUndo(state, { logId, playerId: KARANDRAS1 }))
    expect(error).toEqual({ kind: 'UNDO_ALREADY_INITIATED', logId })
  })

  it('en loggpost uten item kan ikke angres', () => {
    // Java: barbarlogger har ingen draw, så Preconditions.checkNotNull feilet.
    // Det er derfor barbarer aldri kunne angres.
    const state = firstCivGame()
    const logId = 'finnes-ikke'
    expect(unwrapErr(initiateUndo(state, { logId, playerId: CASH1981 }))).toEqual({
      kind: 'LOG_ENTRY_NOT_FOUND',
      logId,
    })
  })

  it('en spiller utenfor spillet kan ikke initiere undo', () => {
    const drawn = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'CIV' }))
    const logId = drawn.log.at(-1)?.id as string
    expect(unwrapErr(initiateUndo(drawn, { logId, playerId: 'ingen' })).kind).toBe(
      'PLAYER_NOT_FOUND',
    )
  })
})

/** Java: `performAVoteAndCheckIt` og `voteAndCountRemaingVotes`. */
describe('vote', () => {
  it('en stemme til gir to registrerte stemmer', () => {
    const { state, logId } = drawCivAndInitiateUndo()
    const after = unwrap(vote(state, { logId, playerId: KARANDRAS1, vote: true }))
    const entry = after.log.find((candidate) => candidate.id === logId)

    expect(Object.keys(entry?.undo?.votes ?? {})).toHaveLength(2)
    expect(entry?.undo?.done).toBe(false)
  })

  it('votesRemaining teller ned mot antall spillere', () => {
    const { state, logId } = drawCivAndInitiateUndo()
    const after = unwrap(vote(state, { logId, playerId: ITCHI, vote: true }))
    const entry = after.log.find((candidate) => candidate.id === logId)

    // Java: 4 spillere, 2 stemmer avgitt
    expect(entry?.undo && votesRemaining(entry.undo)).toBe(2)
  })

  it('logger stemmen offentlig med itemets offentlige navn', () => {
    const { state, logId } = drawCivAndInitiateUndo()
    const after = unwrap(vote(state, { logId, playerId: KARANDRAS1, vote: true }))

    expect(after.log.at(-1)?.publicLog).toBe(
      `Karandras1 has voted yes to undo Civ with item number ${
        state.log.find((c) => c.id === logId)?.item?.itemNumber
      }`,
    )
  })

  it('avstemning uten initiering avvises', () => {
    const drawn = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'CIV' }))
    const logId = drawn.log.at(-1)?.id as string
    expect(unwrapErr(vote(drawn, { logId, playerId: CASH1981, vote: true }))).toEqual({
      kind: 'UNDO_NOT_INITIATED',
      logId,
    })
  })
})

/** Java: `allPlayersVoteYesThenPerformUndo`. */
describe('alle stemmer ja', () => {
  const voteAllYes = (start: GameState, logId: string): GameState => {
    let state = start
    for (const playerId of [KARANDRAS1, ITCHI, CHUL]) {
      state = unwrap(vote(state, { logId, playerId, vote: true }))
    }
    return state
  }

  it('legger det trukne itemet tilbake i stokken', () => {
    const { state: initiated, logId } = drawCivAndInitiateUndo()
    const item = initiated.log.find((candidate) => candidate.id === logId)?.item
    if (item == null) throw new Error('ingen item')

    expect(handOf(initiated, CASH1981).map((i) => i.id)).toContain(item.id)
    expect(initiated.items.some((i) => i.id === item.id)).toBe(false)

    const state = voteAllYes(initiated, logId)

    expect(handOf(state, CASH1981).map((i) => i.id)).not.toContain(item.id)
    expect(state.items.some((i) => i.id === item.id)).toBe(true)
    expect(state.items.find((i) => i.id === item.id)?.ownerId).toBeNull()
  })

  it('markerer undoet som ferdig', () => {
    const { state: initiated, logId } = drawCivAndInitiateUndo()
    const state = voteAllYes(initiated, logId)
    const entry = state.log.find((candidate) => candidate.id === logId)

    expect(entry?.undo?.done).toBe(true)
    expect(entry?.undo && resultOfVotes(entry.undo)).toBe(true)
    expect(Object.values(entry?.undo?.votes ?? {})).not.toContain(false)
  })

  it('logger at stokken er blandet på nytt', () => {
    const { state: initiated, logId } = drawCivAndInitiateUndo()
    const state = voteAllYes(initiated, logId)

    expect(
      state.log.some((entry) =>
        entry.publicLog.includes('and put back in the deck. Deck is reshuffled'),
      ),
    ).toBe(true)
  })

  it('én nei-stemme gjør at itemet blir liggende i hånden', () => {
    const { state: initiated, logId } = drawCivAndInitiateUndo()
    const item = initiated.log.find((candidate) => candidate.id === logId)?.item
    if (item == null) throw new Error('ingen item')

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
describe('undo av teknologi', () => {
  it('kan initieres på et tech-valg', () => {
    const chosen = unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Navy' }))
    const logId = chosen.log.at(-1)?.id as string

    const state = unwrap(initiateUndo(chosen, { logId, playerId: CASH1981 }))
    expect(state.log.find((entry) => entry.id === logId)?.undo).not.toBeNull()
  })

  it('fjerner teknologien fra hånden når alle har stemt ja', () => {
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

/** Undo av en kasting skal legge itemet tilbake i hånden, ikke i stokken. */
describe('undo av kasting', () => {
  it('gir kortet tilbake til spilleren', () => {
    let state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'CULTURE_1' }))
    const card = handOf(state, CASH1981)[0]
    if (card === undefined) throw new Error('ingen kulturkort')

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

/** Java: `UndoAction.playerPutsItemBackInDeck` — ingen avstemning. */
describe('playerPutsItemBackInDeck', () => {
  it('legger et item fra hånden tilbake i stokken', () => {
    const drawn = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'HUTS' }))
    const hut = handOf(drawn, CASH1981)[0]
    if (hut === undefined) throw new Error('ingen hut')

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

  it('et item spilleren ikke har gir ITEM_NOT_FOUND', () => {
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
describe('oppslag', () => {
  it('aktive undos er de som ikke er gjennomført', () => {
    const { state } = drawCivAndInitiateUndo()
    expect(activeUndos(state)).toHaveLength(1)
    expect(finishedUndos(state)).toHaveLength(0)
  })

  it('ferdige undos er de som er gjennomført', () => {
    const { state: initiated, logId } = drawCivAndInitiateUndo()
    let state = initiated
    for (const playerId of [KARANDRAS1, ITCHI, CHUL]) {
      state = unwrap(vote(state, { logId, playerId, vote: true }))
    }

    expect(finishedUndos(state)).toHaveLength(1)
    expect(activeUndos(state)).toHaveLength(0)
  })

  it('en spillers aktive undos filtreres på brukernavn', () => {
    const { state } = drawCivAndInitiateUndo()
    expect(playersActiveUndos(state, 'cash1981')).toHaveLength(1)
    expect(playersActiveUndos(state, 'Itchi')).toHaveLength(0)
  })
})

describe('renhet', () => {
  it('vote muterer ikke inn-tilstanden', () => {
    const { state, logId } = drawCivAndInitiateUndo()
    const snapshot = JSON.stringify(state)

    unwrap(vote(state, { logId, playerId: KARANDRAS1, vote: true }))

    expect(JSON.stringify(state)).toBe(snapshot)
  })
})
