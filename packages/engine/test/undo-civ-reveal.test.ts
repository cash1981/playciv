/**
 * Undoing the reveal of a civilization: the table votes, and when it passes
 * everything the reveal handed out by itself goes back. What the player drew or
 * chose on their own stays in the hand.
 */

import { describe, expect, it } from 'vitest'

import {
  placePiece,
  redoLastBoardChange,
  removePiece,
  undoLastBoardChange,
} from '../src/actions/board.js'
import { draw } from '../src/actions/draw.js'
import { chooseTech, discardItem, removeTech, revealItem } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { canInitiateUndo, initiateUndo, playerPutsItemBackInDeck, vote } from '../src/actions/undo.js'
import { DEFAULT_GOVERNMENT } from '../src/government.js'
import { isUnit, itemName } from '../src/item.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameLogEntry, GameState } from '../src/state.js'
import { findPlayer, toPlayerView, withPlayer } from '../src/state.js'
import { turnHolder } from '../src/turn.js'

import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const handOf = (state: GameState, playerId: string) => findPlayer(state, playerId)?.items ?? []
const wondersOnBoard = (state: GameState) =>
  state.board.pieces.filter((piece) => piece.category === 'wonder')
const wondersInDeck = (state: GameState) => state.items.filter((item) => item.kind === 'wonder')

/** Draws `civs` civilization cards for the player, then reveals the first one. */
function drawCivsAndReveal(start: GameState, playerId: string, civs: number): GameState {
  let state = start
  for (let i = 0; i < civs; i++) state = unwrap(draw(state, { playerId, sheetName: 'CIV' }))
  return revealHidden(state, playerId)
}

function revealHidden(state: GameState, playerId: string): GameState {
  const civ = handOf(state, playerId).find((item) => item.kind === 'civ' && item.hidden)
  if (civ === undefined) throw new Error('no hidden civ in the hand')
  return unwrap(revealItem(state, { playerId, sheetName: 'CIV', itemNumber: civ.itemNumber }))
}

/** Hands a specific civilization to a player, bypassing the random CIV draw. */
function giveCiv(state: GameState, playerId: string, name: string): GameState {
  const civ = state.items.find((item) => item.kind === 'civ' && item.name === name)
  if (civ === undefined) throw new Error(`no ${name} civ in the deck`)
  return {
    ...state,
    items: state.items.filter((item) => item.id !== civ.id),
    players: state.players.map((player) =>
      player.playerId === playerId
        ? { ...player, items: [...player.items, { ...civ, ownerId: playerId }] }
        : player,
    ),
  }
}

/** Every player draws and reveals a civ in seat order, handing the turn on each time. */
function revealEveryCiv(start: GameState): GameState {
  let state = start
  const order = [...state.players]
    .sort((a, b) => a.playernumber - b.playernumber)
    .map((player) => player.playerId)
  for (const playerId of order) {
    state = unwrap(draw(state, { playerId, sheetName: 'CIV' }))
    state = revealHidden(state, playerId)
    state = unwrap(markPhasesDone(state, { playerId, turnNumber: 1, upToPhase: 'SOT' }))
  }
  return state
}

function civRevealOf(state: GameState, playerId: string): GameLogEntry {
  const entry = state.log.find(
    (candidate) =>
      candidate.logType === 'REVEAL' &&
      candidate.item?.kind === 'civ' &&
      candidate.playerId === playerId,
  )
  if (entry === undefined) throw new Error('no civ reveal in the log')
  return entry
}

/** The owner asks for the undo and everyone else votes `vote` on it. */
function undoByVote(state: GameState, ownerId: string, answer = true): GameState {
  const logId = civRevealOf(state, ownerId).id
  let next = unwrap(initiateUndo(state, { logId, playerId: ownerId }))
  for (const player of state.players) {
    if (player.playerId === ownerId) continue
    next = unwrap(vote(next, { logId, playerId: player.playerId, vote: answer }))
  }
  return next
}

describe('undo of a civilization reveal', () => {
  it('puts the civ cards, units, tile, marker, tech and government back', () => {
    const before = firstCivGame()
    const revealed = drawCivsAndReveal(before, CASH1981, 3)
    const player = findPlayer(revealed, CASH1981)
    expect(player?.civilization).not.toBeNull()
    expect(handOf(revealed, CASH1981).some(isUnit)).toBe(true)
    expect(revealed.board.pieces.length).toBeGreaterThan(0)

    const undone = undoByVote(revealed, CASH1981)
    const after = findPlayer(undone, CASH1981)

    expect(after?.civilization).toBeNull()
    expect(after?.techsChosen).toEqual([])
    expect(after?.government).toBe(DEFAULT_GOVERNMENT)
    // All three civ cards are back in the hand, hidden, and none are discarded
    const civs = handOf(undone, CASH1981).filter((item) => item.kind === 'civ')
    expect(civs).toHaveLength(3)
    expect(civs.every((item) => item.hidden)).toBe(true)
    expect(undone.discardedItems.filter((item) => item.kind === 'civ')).toEqual([])
    // Starting units are in the deck again; the starting tile and marker are gone
    expect(handOf(undone, CASH1981).some(isUnit)).toBe(false)
    expect(undone.board.pieces).toEqual([])
    // The deck holds exactly what it did before the reveal, bar the three civs drawn
    const deckIds = (state: GameState) => state.items.map((item) => item.id).sort()
    const drawnCivIds = new Set(civs.map((item) => item.id))
    expect(deckIds(undone)).toEqual(
      deckIds({ ...before, items: before.items.filter((item) => !drawnCivIds.has(item.id)) }),
    )
  })

  it.each([
    ['Spanish', 'figures/whitescout'],
    ['Russians', 'figures/whitearmy'],
  ])('takes the white figure of the %s back with the rest of the setup', (civ, white) => {
    const revealed = revealHidden(giveCiv(firstCivGame(), CASH1981, civ), CASH1981)
    expect(revealed.board.pieces.some((piece) => piece.assetId === white)).toBe(true)

    const undone = undoByVote(revealed, CASH1981)
    expect(undone.board.pieces).toEqual([])

    // A new reveal hands out one white figure again, not a second one
    const again = revealHidden(undone, CASH1981)
    expect(again.board.pieces.filter((piece) => piece.assetId === white)).toHaveLength(1)
  })

  it('keeps what the player drew on their own', () => {
    let state = firstCivGame()
    state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'CULTURE_1' }))
    const culture = handOf(state, CASH1981).find((item) => item.kind === 'cultureI')
    state = drawCivsAndReveal(state, CASH1981, 2)

    const undone = undoByVote(state, CASH1981)

    expect(handOf(undone, CASH1981).map((item) => item.id)).toContain(culture?.id)
    expect(culture).toBeDefined()
  })

  it('takes a starting unit back even after it was discarded', () => {
    let state = drawCivsAndReveal(firstCivGame(), CASH1981, 1)
    const unit = handOf(state, CASH1981).find(isUnit)
    if (unit === undefined) throw new Error('no starting unit')
    state = unwrap(discardItem(state, { playerId: CASH1981, sheetName: unit.sheetName, itemNumber: unit.itemNumber, name: itemName(unit) }))
    expect(state.discardedItems.some((item) => item.id === unit.id)).toBe(true)

    const undone = undoByVote(state, CASH1981)

    expect(undone.discardedItems.some((item) => item.id === unit.id)).toBe(false)
    expect(undone.items.some((item) => item.id === unit.id)).toBe(true)
  })

  it("returns Egypt's own wonder to the deck", () => {
    const before = giveCiv(firstCivGame(), CASH1981, 'Egyptians')
    const revealed = revealHidden(before, CASH1981)
    expect(wondersOnBoard(revealed)).toHaveLength(1)
    const wondersBefore = wondersInDeck(before).length

    const undone = undoByVote(revealed, CASH1981)

    expect(wondersOnBoard(undone)).toEqual([])
    expect(wondersInDeck(undone)).toHaveLength(wondersBefore)
  })

  it('clears the coin counters of the starting tech and the Democracy card', () => {
    const revealed = revealHidden(giveCiv(firstCivGame(), CASH1981, 'Romans'), CASH1981)
    const player = findPlayer(revealed, CASH1981)
    if (player === undefined) throw new Error('no player')
    // The Romans start with Code of Laws, a coin tech; the player then edits both counters
    const edited = withPlayer(revealed, {
      ...player,
      stats: {
        ...player.stats,
        coinSources: { ...player.stats.coinSources, codeOfLaws: 2, democracyGovernment: 1 },
      },
    })

    const undone = undoByVote(edited, CASH1981)

    const sources = findPlayer(undone, CASH1981)?.stats.coinSources
    expect(sources?.codeOfLaws).toBe(0)
    expect(sources?.democracyGovernment).toBe(0)
  })

  it("does not let the owner's board Undo bring back a piece whose card is in the deck", () => {
    const revealed = revealHidden(giveCiv(firstCivGame(), CASH1981, 'Egyptians'), CASH1981)
    const undone = undoByVote(revealed, CASH1981)
    expect(undone.board.pieces).toEqual([])

    expect(unwrapErr(undoLastBoardChange(undone, CASH1981))).toEqual({
      kind: 'NOTHING_TO_UNDO_ON_BOARD',
    })
    expect(undone.board.history.at(-1)?.username).toBe('System')
  })

  it('rejects a late vote on an undo that has already run, so a new reveal stays', () => {
    const revealed = drawCivsAndReveal(firstCivGame(), CASH1981, 2)
    const logId = civRevealOf(revealed, CASH1981).id
    const undone = undoByVote(revealed, CASH1981)
    const again = revealHidden(undone, CASH1981)

    expect(unwrapErr(vote(again, { logId, playerId: KARANDRAS1, vote: true }))).toEqual({
      kind: 'UNDO_ALREADY_DONE',
      logId,
    })
    expect(findPlayer(again, CASH1981)?.civilization).not.toBeNull()
  })

  it('keeps a copy of the starting tech the player chose again themselves', () => {
    const revealed = revealHidden(giveCiv(firstCivGame(), CASH1981, 'Romans'), CASH1981)
    const startingTech = findPlayer(revealed, CASH1981)?.civilization?.startingTech
    if (startingTech === undefined) throw new Error('no starting tech')
    let state = unwrap(removeTech(revealed, { playerId: CASH1981, techName: startingTech.name }))
    state = unwrap(chooseTech(state, { playerId: CASH1981, techName: startingTech.name }))
    const own = findPlayer(state, CASH1981)?.techsChosen.find((t) => t.name === startingTech.name)
    expect(own?.id).not.toBe(startingTech.id)

    const undone = undoByVote(state, CASH1981)

    expect(findPlayer(undone, CASH1981)?.techsChosen.map((t) => t.id)).toEqual([own?.id])
  })

  it('does not take a starting unit into the deck still flagged as in battle', () => {
    const revealed = drawCivsAndReveal(firstCivGame(), CASH1981, 1)
    const unit = handOf(revealed, CASH1981).find(isUnit)
    if (unit === undefined) throw new Error('no starting unit')
    const player = findPlayer(revealed, CASH1981)
    if (player === undefined) throw new Error('no player')
    const inArena = withPlayer(revealed, {
      ...player,
      items: player.items.map((item) => (item.id === unit.id ? { ...item, inBattle: true } : item)),
    })

    const undone = undoByVote(inArena, CASH1981)

    const back = undone.items.find((item) => item.id === unit.id)
    expect(back && isUnit(back) ? back.inBattle : undefined).toBe(false)
  })

  it('does not let Redo bring back a placement undone by hand before the vote', () => {
    const revealed = revealHidden(giveCiv(firstCivGame(), CASH1981, 'Egyptians'), CASH1981)
    const handUndone = unwrap(undoLastBoardChange(revealed, CASH1981))
    expect(handUndone.board.redo.length).toBeGreaterThan(0)

    const undone = undoByVote(handUndone, CASH1981)

    expect(unwrapErr(redoLastBoardChange(undone, CASH1981))).toEqual({
      kind: 'NOTHING_TO_REDO_ON_BOARD',
    })
  })

  it('leaves a starting unit alone that was put back and then drawn again as an ordinary card', () => {
    let state = drawCivsAndReveal(firstCivGame(), CASH1981, 1)
    const units = handOf(state, CASH1981).filter(isUnit)
    const [again, ...others] = units
    if (again === undefined) throw new Error('no starting unit')
    state = unwrap(
      playerPutsItemBackInDeck(state, {
        playerId: CASH1981,
        sheetName: again.sheetName,
        name: itemName(again),
      }),
    )
    // Make the very same card the next one drawn from its pile
    const back = state.items.find((item) => item.id === again.id)
    if (back === undefined) throw new Error('unit not back in the deck')
    state = { ...state, items: [back, ...state.items.filter((item) => item.id !== again.id)] }
    state = unwrap(draw(state, { playerId: CASH1981, sheetName: again.sheetName }))
    expect(handOf(state, CASH1981).some((item) => item.id === again.id)).toBe(true)

    const undone = undoByVote(state, CASH1981)

    // The card drawn by hand stays; the other starting units go back to the deck
    expect(handOf(undone, CASH1981).some((item) => item.id === again.id)).toBe(true)
    for (const unit of others) {
      expect(undone.items.some((item) => item.id === unit.id)).toBe(true)
    }
  })

  it('does not let Undo bring back a piece the owner removed by hand before the vote', () => {
    const revealed = revealHidden(giveCiv(firstCivGame(), CASH1981, 'Egyptians'), CASH1981)
    const wonder = wondersOnBoard(revealed)[0]
    if (wonder === undefined) throw new Error('no wonder piece')
    // Every piece is gone by hand, so the vote has nothing left to remove itself
    let state = revealed
    for (const piece of revealed.board.pieces) {
      state = unwrap(removePiece(state, { playerId: CASH1981, pieceId: piece.id }))
    }
    const undone = undoByVote(state, CASH1981)
    expect(wondersInDeck(undone).some((item) => item.sheetName === 'ANCIENT_WONDERS')).toBe(true)

    expect(unwrapErr(undoLastBoardChange(undone, CASH1981))).toEqual({
      kind: 'NOTHING_TO_UNDO_ON_BOARD',
    })
    expect(undone.board.pieces).toEqual([])
  })

  it('still lets a player undo board changes made after the vote', () => {
    const undone = undoByVote(drawCivsAndReveal(firstCivGame(), CASH1981, 1), CASH1981)
    const placed = unwrap(
      placePiece(undone, { playerId: CASH1981, assetId: 'wonders/bigben', x: 0, y: 0 }),
    )
    expect(placed.board.pieces).toHaveLength(1)

    const back = unwrap(undoLastBoardChange(placed, CASH1981))

    expect(back.board.pieces).toEqual([])
  })

  it('logs the undo publicly as the System', () => {
    const undone = undoByVote(drawCivsAndReveal(firstCivGame(), CASH1981, 1), CASH1981)
    const line = undone.log.at(-1)

    expect(line?.username).toBe('System')
    expect(line?.publicLog).toContain("has undone cash1981's reveal of")
    expect(line?.publicLog).toContain('Deck is reshuffled')
  })

  it('does nothing while a vote is open or when someone votes no', () => {
    const revealed = drawCivsAndReveal(firstCivGame(), CASH1981, 1)
    const logId = civRevealOf(revealed, CASH1981).id
    const open = unwrap(initiateUndo(revealed, { logId, playerId: CASH1981 }))
    expect(findPlayer(open, CASH1981)?.civilization).not.toBeNull()

    const refused = undoByVote(revealed, CASH1981, false)
    expect(findPlayer(refused, CASH1981)?.civilization).not.toBeNull()
    expect(handOf(refused, CASH1981).some(isUnit)).toBe(true)
    expect(refused.board.pieces.length).toBe(revealed.board.pieces.length)
  })

  it('lets the player reveal again and get everything dealt anew', () => {
    const undone = undoByVote(drawCivsAndReveal(firstCivGame(), CASH1981, 2), CASH1981)

    const again = revealHidden(undone, CASH1981)
    const player = findPlayer(again, CASH1981)

    expect(player?.civilization).not.toBeNull()
    expect(player?.techsChosen).toHaveLength(1)
    expect(handOf(again, CASH1981).some(isUnit)).toBe(true)
    expect(again.board.pieces.length).toBeGreaterThan(0)
  })

  it('cannot be undone twice', () => {
    const undone = undoByVote(drawCivsAndReveal(firstCivGame(), CASH1981, 1), CASH1981)
    const logId = civRevealOf(undone, CASH1981).id

    expect(unwrapErr(initiateUndo(undone, { logId, playerId: CASH1981 })).kind).toBe(
      'UNDO_ALREADY_INITIATED',
    )
    expect(canInitiateUndo(undone, civRevealOf(undone, CASH1981))).toBe(false)
  })

  describe('a reveal made before reveals were recorded', () => {
    /** The same game as it was saved before `civSetup` existed. */
    const asLegacy = (state: GameState): GameState => ({
      ...state,
      log: state.log.map(({ civSetup: _recorded, ...entry }) => entry),
    })

    it('is rebuilt from the log and the board, and rolled back the same way', () => {
      const before = firstCivGame()
      const legacy = asLegacy(drawCivsAndReveal(before, CASH1981, 3))
      expect(canInitiateUndo(legacy, civRevealOf(legacy, CASH1981))).toBe(true)

      const undone = undoByVote(legacy, CASH1981)
      const after = findPlayer(undone, CASH1981)

      expect(after?.civilization).toBeNull()
      expect(after?.techsChosen).toEqual([])
      expect(handOf(undone, CASH1981).filter((item) => item.kind === 'civ')).toHaveLength(3)
      expect(handOf(undone, CASH1981).some(isUnit)).toBe(false)
      expect(undone.board.pieces).toEqual([])
      const ids = undone.items.map((item) => item.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('unsticks a player who already put the units back and discarded the civ by hand', () => {
      let state = drawCivsAndReveal(firstCivGame(), CASH1981, 2)
      const chosen = findPlayer(state, CASH1981)?.civilization
      if (chosen === null || chosen === undefined) throw new Error('no civilization')
      for (const unit of handOf(state, CASH1981).filter(isUnit)) {
        state = unwrap(
          playerPutsItemBackInDeck(state, {
            playerId: CASH1981,
            sheetName: unit.sheetName,
            name: itemName(unit),
          }),
        )
      }
      state = unwrap(
        discardItem(state, {
          playerId: CASH1981,
          sheetName: 'CIV',
          itemNumber: chosen.itemNumber,
          name: itemName(chosen),
        }),
      )
      // The player still holds the civilization, and no civ card in the hand can be revealed
      expect(findPlayer(state, CASH1981)?.civilization).not.toBeNull()
      const legacy = asLegacy(state)

      const undone = undoByVote(legacy, CASH1981)

      expect(findPlayer(undone, CASH1981)?.civilization).toBeNull()
      expect(findPlayer(undone, CASH1981)?.techsChosen).toEqual([])
      const ids = undone.items.map((item) => item.id)
      expect(new Set(ids).size).toBe(ids.length)
      // The card discarded by hand stays discarded; the other civ is back to reveal
      expect(undone.discardedItems.some((item) => item.id === chosen.id)).toBe(true)
      const again = revealHidden(undone, CASH1981)
      expect(findPlayer(again, CASH1981)?.civilization).not.toBeNull()
    })

    it('is refused for Egypt, whose own wonder is not tied to the reveal', () => {
      const legacy = asLegacy(revealHidden(giveCiv(firstCivGame(), CASH1981, 'Egyptians'), CASH1981))
      const entry = civRevealOf(legacy, CASH1981)

      expect(canInitiateUndo(legacy, entry)).toBe(false)
      expect(unwrapErr(initiateUndo(legacy, { logId: entry.id, playerId: CASH1981 }))).toEqual({
        kind: 'CIV_REVEAL_NOT_UNDOABLE',
        logId: entry.id,
      })
    })

    it('is refused once the shared wonders are dealt', () => {
      const legacy = asLegacy(revealEveryCiv(firstCivGame()))
      expect(legacy.wondersDealt).toBe(true)

      expect(canInitiateUndo(legacy, civRevealOf(legacy, CASH1981))).toBe(false)
    })
  })

  describe('after the table is complete', () => {
    it('takes the start-of-game wonder deal back and deals it again on the next reveal', () => {
      const full = revealEveryCiv(firstCivGame())
      expect(full.wondersDealt).toBe(true)
      expect(wondersOnBoard(full)).toHaveLength(4)
      const wondersBefore = wondersInDeck(full).length

      // The player holding the turn is the one who can reveal again afterwards
      const holder = turnHolder(full)?.playerId as string
      const undone = undoByVote(full, holder)

      expect(undone.wondersDealt).toBe(false)
      expect(wondersOnBoard(undone)).toEqual([])
      expect(wondersInDeck(undone)).toHaveLength(wondersBefore + 4)
      expect(findPlayer(undone, holder)?.civilization).toBeNull()

      const again = revealHidden(undone, holder)
      expect(again.wondersDealt).toBe(true)
      expect(wondersOnBoard(again)).toHaveLength(4)
    })

    it("takes Egypt's wonder and the 3 + 1 deal back together", () => {
      let start = giveCiv(firstCivGame(), CASH1981, 'Egyptians')
      const wondersBefore = wondersInDeck(start).length
      const order = [CASH1981, KARANDRAS1, ITCHI, CHUL]
      for (const playerId of order) {
        if (playerId !== CASH1981) start = unwrap(draw(start, { playerId, sheetName: 'CIV' }))
        start = revealHidden(start, playerId)
        start = unwrap(markPhasesDone(start, { playerId, turnNumber: 1, upToPhase: 'SOT' }))
      }
      expect(wondersOnBoard(start)).toHaveLength(5)

      const undone = undoByVote(start, CASH1981)

      expect(wondersOnBoard(undone)).toEqual([])
      expect(wondersInDeck(undone)).toHaveLength(wondersBefore)
      expect(undone.wondersDealt).toBe(false)
    })

    it('rolls the deal back whichever reveal triggered it, without losing the deal record', () => {
      const full = revealEveryCiv(firstCivGame())
      const dealtBy = full.log.find((entry) => entry.civSetup?.dealt !== undefined)
      const other = [CASH1981, KARANDRAS1, ITCHI, CHUL].find(
        (id) => id !== dealtBy?.playerId,
      ) as string

      const undone = undoByVote(full, other)

      expect(undone.wondersDealt).toBe(false)
      expect(wondersOnBoard(undone)).toEqual([])
      // The other reveal is still in place, just without a deal to undo
      expect(findPlayer(undone, dealtBy?.playerId as string)?.civilization).not.toBeNull()
      expect(undone.log.some((entry) => entry.civSetup?.dealt !== undefined)).toBe(false)
    })
  })

  describe('hidden information', () => {
    it('keeps the setup record out of what opponents are sent', () => {
      const revealed = drawCivsAndReveal(firstCivGame(), CASH1981, 1)
      const unitId = handOf(revealed, CASH1981).find(isUnit)?.id as string

      const opponent = JSON.stringify(toPlayerView(revealed, KARANDRAS1))

      expect(opponent).not.toContain('civSetup')
      expect(opponent).not.toContain(unitId)
    })
  })
})
