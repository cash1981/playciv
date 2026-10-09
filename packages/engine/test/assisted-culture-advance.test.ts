/**
 * The culture advance and the choice of reward (part 2b of the assisted play
 * brief). The costs and card counts are in `culture-track-rules.test.ts`; this
 * file checks the action: what it pays, moves and draws, what is private, and how
 * the undo vote takes it back.
 */

import { describe, expect, it } from 'vitest'

import { movePiece, undoLastBoardChange } from '../src/actions/board.js'
import { discardItem } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { assistedAvailability, performAssistedAction } from '../src/assisted.js'
import { cultureCellCenter, cultureStepOf } from '../src/board.js'
import type { Item } from '../src/item.js'
import { itemName } from '../src/item.js'
import { migrateGameState } from '../src/migrate.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { cultureMarkerLevelOf, findPlayer, toPlayerView, toPublicLog } from '../src/state.js'
import type { PlayerView } from '../src/state.js'

import { AT, advanceTurn, topCards, withStats } from './culture-advance-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const OTHERS = [KARANDRAS1, ITCHI, CHUL]

const me = (state: GameState) => {
  const player = findPlayer(state, CASH1981)
  if (player === undefined) throw new Error('fixture player missing')
  return player
}

const press = (state: GameState, requestId: string) =>
  performAssistedAction(state, { playerId: CASH1981, action: 'cultureAdvance', requestId, at: AT })

const advance = (state: GameState, requestId: string): GameState => unwrap(press(state, requestId))

const choose = (state: GameState, requestId: string, rewardId: string, itemId: string, playerId = CASH1981) =>
  performAssistedAction(state, {
    playerId,
    action: 'chooseReward',
    requestId,
    at: AT,
    payload: { rewardId, itemId },
  })

const logIdOf = (state: GameState, requestId: string): string => {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line for the action')
  return entry.id
}

function undoByVote(state: GameState, requestId: string): GameState {
  const logId = logIdOf(state, requestId)
  let next = unwrap(initiateUndo(state, { logId, playerId: CASH1981 }))
  for (const playerId of OTHERS) next = unwrap(vote(next, { logId, playerId, vote: true, at: AT }))
  return next
}

/** The cards `requestId` drew, from its record. */
const drawnBy = (state: GameState, requestId: string): readonly string[] => {
  const effect = state.assistedActions.find((record) => record.id === requestId)?.effect
  if (effect === undefined || effect.kind !== 'cultureAdvance') throw new Error('no advance record')
  return effect.drawn
}

const handItem = (state: GameState, id: string): Item | undefined => me(state).items.find((item) => item.id === id)

/** Mysticism makes a culture event draw two cards, so there is a choice to make. */
const choiceTurn = (): GameState => advanceTurn({ techs: ['Mysticism'] })

describe('availability', () => {
  it('is ready with the destination and the cost in the reason', () => {
    const state = advanceTurn({ step: 7 })
    expect(assistedAvailability(state, CASH1981, 'cultureAdvance')).toEqual({
      status: 'ready',
      reason: 'Advance to space 8 (culture II event): 5 culture and 3 trade.',
    })
  })

  it('names a Great Person space and a cost with no trade', () => {
    expect(assistedAvailability(advanceTurn({ step: 2 }), CASH1981, 'cultureAdvance').reason).toBe(
      'Advance to space 3 (Great Person): 3 culture.',
    )
  })

  it('is wrong-phase unless City Management is open', () => {
    const closed = unwrap(
      markPhasesDone(
        withStats(firstCivGame(), {}),
        { playerId: CASH1981, turnNumber: 1, upToPhase: 'SOT' },
      ),
    )
    expect(assistedAvailability(closed, CASH1981, 'cultureAdvance').status).toBe('wrong-phase')
    const noTurn = advanceTurn()
    const done = unwrap(markPhasesDone(noTurn, { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' }))
    expect(assistedAvailability(done, CASH1981, 'cultureAdvance').status).toBe('wrong-phase')
  })

  it('is unavailable with no marker on the track', () => {
    const state = advanceTurn()
    const noCiv = { ...state, players: state.players.map((p) => (p.playerId === CASH1981 ? { ...p, civilization: null } : p)) }
    expect(assistedAvailability(noCiv, CASH1981, 'cultureAdvance')).toMatchObject({
      status: 'unavailable',
      reason: 'Your leader marker is not on the culture track.',
    })
  })

  it('is unavailable at step 21, where there is no next space', () => {
    const state = advanceTurn({ step: 21 })
    expect(cultureMarkerLevelOf(state, CASH1981)).toBe(21)
    expect(assistedAvailability(state, CASH1981, 'cultureAdvance')).toMatchObject({
      status: 'unavailable',
      reason: 'Your marker is already on the Culture Victory space.',
    })
  })

  it('is needs-resource, with the missing amounts, when culture or trade falls short', () => {
    const short = advanceTurn({ step: 7, culture: 2, trade: 1 })
    expect(assistedAvailability(short, CASH1981, 'cultureAdvance')).toEqual({
      status: 'needs-resource',
      reason: 'Advance to space 8 (culture II event): 5 culture and 3 trade. You are missing 3 culture and 2 trade.',
    })
    const tradeOnly = advanceTurn({ step: 7, culture: 5, trade: 2 })
    expect(assistedAvailability(tradeOnly, CASH1981, 'cultureAdvance').reason).toMatch(/You are missing 1 trade\.$/)
    const exact = advanceTurn({ step: 7, culture: 5, trade: 3 })
    expect(assistedAvailability(exact, CASH1981, 'cultureAdvance').status).toBe('ready')
  })

  it('is unavailable when the deck and the discard pile hold none of the cards', () => {
    const state = advanceTurn()
    const empty = { ...state, items: state.items.filter((item) => item.sheetName !== 'CULTURE_1') }
    expect(assistedAvailability(empty, CASH1981, 'cultureAdvance')).toMatchObject({ status: 'unavailable' })
    expect(unwrapErr(press(empty, 'req-1')).kind).toBe('ASSISTED_ACTION_REJECTED')
  })

  it('is listed in the projection as a button, and chooseReward is not', () => {
    const actions = toPlayerView(advanceTurn(), CASH1981).you?.availableActions.map((entry) => entry.action)
    expect(actions).toContain('cultureAdvance')
    expect(actions).not.toContain('chooseReward')
  })
})

describe('advancing', () => {
  it('pays, moves the marker one space, draws one card and keeps it at once', () => {
    const ready = advanceTurn({ culture: 10 })
    const [card] = topCards(ready, 'CULTURE_1', 1)
    const done = advance(ready, 'req-1')

    expect(me(done).stats.culture).toBe(7)
    expect(me(done).stats.trade).toBe(100)
    expect(cultureMarkerLevelOf(done, CASH1981)).toBe(1)
    expect(handItem(done, card?.id ?? '')).toMatchObject({ hidden: true, ownerId: CASH1981 })
    expect(done.items.some((item) => item.id === card?.id)).toBe(false)
    expect(me(done).pendingRewards).toEqual([])
    expect(done.items).toHaveLength(ready.items.length - 1)
    expect(me(done).items).toHaveLength(me(ready).items.length + 1)
  })

  it('charges the culture and the trade of the level moved to', () => {
    const done = advance(advanceTurn({ step: 7, culture: 20, trade: 20 }), 'req-1')
    expect(me(done).stats.culture).toBe(15)
    expect(me(done).stats.trade).toBe(17)
    expect(cultureMarkerLevelOf(done, CASH1981)).toBe(8)
  })

  it('records the move in the board history, so the history bar shows it', () => {
    const ready = advanceTurn()
    const done = advance(ready, 'req-1')
    const entry = done.board.history.at(-1)
    expect(entry?.change.kind).toBe('move')
    expect(entry?.playerId).toBe(CASH1981)
    expect(entry?.description).toBe('cash1981 moved Japanese (Red) from culture START to culture 1')
    expect(entry?.at).toBe(AT)
    expect(done.board.history).toHaveLength(ready.board.history.length + 1)
    // The marker is exactly where the next space puts its centre, not snapped to a lane
    const piece = done.board.pieces.find((candidate) => candidate.assetId === 'leaders/japanese_red')
    expect(piece === undefined ? null : cultureStepOf(done.board, piece)).toBe(1)
  })

  it('writes one public line without card names or numbers, one private line with the name, and no item line', () => {
    const ready = advanceTurn()
    const [card] = topCards(ready, 'CULTURE_1', 1)
    const done = advance(ready, 'req-1')
    const added = done.log.slice(ready.log.length)

    const publicLines = added.filter((entry) => entry.publicLog !== '')
    expect(publicLines.map((entry) => entry.publicLog)).toEqual([
      'cash1981 advanced on the culture track to space 1 and drew 1 culture I card',
    ])
    expect(publicLines[0]?.assistedActionId).toBe('req-1')
    const privateLines = added.filter((entry) => entry.privateLog !== '')
    expect(privateLines).toHaveLength(1)
    expect(privateLines[0]?.playerId).toBe(CASH1981)
    expect(privateLines[0]?.privateLog).toContain(itemName(card as Item))
    expect(privateLines[0]?.publicLog).toBe('')
    // No line carries the item, so the old item undo cannot target a single card
    expect(added.every((entry) => entry.item === null)).toBe(true)
    expect(JSON.stringify(added.map(toPublicLog))).not.toContain(card?.id ?? 'x')
    expect(JSON.stringify(added.map(toPublicLog))).not.toContain(itemName(card as Item))
  })

  it('is repeatable: no usage key, never used, and each press needs its own request id', () => {
    const ready = advanceTurn({ culture: 50 })
    const first = advance(ready, 'req-1')
    expect(first.assistedActions[0]).toMatchObject({ id: 'req-1', usageKey: null, status: 'applied' })
    expect(me(first).playerTurns[0]?.usedActions).toEqual([])
    expect(assistedAvailability(first, CASH1981, 'cultureAdvance').status).toBe('ready')

    const second = advance(first, 'req-2')
    expect(cultureMarkerLevelOf(second, CASH1981)).toBe(2)
    expect(me(second).stats.culture).toBe(50 - 3 - 3)
    expect(second.assistedActions.map((record) => record.id)).toEqual(['req-1', 'req-2'])
  })

  it('the same request id again changes nothing', () => {
    const first = advance(advanceTurn(), 'req-1')
    const again = unwrap(press(first, 'req-1'))
    expect(again).toBe(first)
    expect(cultureMarkerLevelOf(again, CASH1981)).toBe(1)
  })

  it('refuses without paying when culture is short, and changes nothing', () => {
    const short = advanceTurn({ culture: 2 })
    const refused = unwrapErr(press(short, 'req-1'))
    expect(refused).toMatchObject({ kind: 'ASSISTED_ACTION_REJECTED', status: 'needs-resource' })
    expect(short.assistedActions).toEqual([])
    expect(cultureMarkerLevelOf(short, CASH1981)).toBe(0)
  })

  it('refuses outside City Management', () => {
    const state = advanceTurn()
    const reopened = {
      ...state,
      players: state.players.map((player) => ({
        ...player,
        playerTurns: player.playerTurns.map((turn) => ({ ...turn, done: { ...turn.done, TRADE: false } })),
      })),
    }
    const refused = unwrapErr(press(reopened, 'req-1'))
    expect(refused).toMatchObject({ kind: 'ASSISTED_ACTION_REJECTED', status: 'wrong-phase' })
  })

  it('a Great Person space draws from the Great Person deck', () => {
    const ready = advanceTurn({ step: 2 })
    const [card] = topCards(ready, 'GREAT_PERSON', 1)
    const done = advance(ready, 'req-1')
    expect(cultureMarkerLevelOf(done, CASH1981)).toBe(3)
    expect(handItem(done, card?.id ?? '')).toBeDefined()
    expect(done.log.find((entry) => entry.assistedActionId === 'req-1')?.publicLog).toContain('drew 1 Great Person card')
  })

  it('a level 2 event draws from the culture II deck and a level 3 from the culture III deck', () => {
    for (const [step, sheet] of [[7, 'CULTURE_2'], [14, 'CULTURE_3']] as const) {
      const ready = advanceTurn({ step: step === 7 ? 7 : 14 })
      const [card] = topCards(ready, sheet, 1)
      const done = advance(ready, 'req-1')
      expect(handItem(done, card?.id ?? '')?.sheetName).toBe(sheet)
    }
  })

  it('reshuffles the discards back when the deck has none of the cards, as the Draw button does', () => {
    const ready = advanceTurn()
    const level1 = ready.items.filter((item) => item.sheetName === 'CULTURE_1')
    const emptied: GameState = {
      ...ready,
      items: ready.items.filter((item) => item.sheetName !== 'CULTURE_1'),
      discardedItems: [...ready.discardedItems, ...level1],
    }
    const done = advance(emptied, 'req-1')
    expect(done.log.some((entry) => entry.logType === 'SHUFFLE')).toBe(true)
    expect(me(done).items.some((item) => item.sheetName === 'CULTURE_1')).toBe(true)
    expect(done.discardedItems.some((item) => item.sheetName === 'CULTURE_1')).toBe(false)
    expect(done.items.filter((item) => item.sheetName === 'CULTURE_1')).toHaveLength(level1.length - 1)
  })

  it('with only one card left, draws that one and resolves at once', () => {
    const ready = choiceTurn()
    const level1 = ready.items.filter((item) => item.sheetName === 'CULTURE_1')
    const one = { ...ready, items: ready.items.filter((item) => item.sheetName !== 'CULTURE_1' || item.id === level1[0]?.id) }
    const done = advance(one, 'req-1')
    expect(me(done).pendingRewards).toEqual([])
    expect(done.assistedActions[0]?.effect).toMatchObject({ kept: level1[0]?.id })
  })
})

describe('a choice of reward', () => {
  it('draws two cards with Mysticism, puts both in the hand hidden and waits for the choice', () => {
    const ready = choiceTurn()
    const candidates = topCards(ready, 'CULTURE_1', 2)
    const done = advance(ready, 'req-1')

    expect(drawnBy(done, 'req-1')).toEqual(candidates.map((card) => card.id))
    expect(me(done).pendingRewards).toEqual([
      { id: 'req-1', kind: 'event', level: 1, step: 1, candidateIds: candidates.map((card) => card.id), keep: 1 },
    ])
    for (const card of candidates) expect(handItem(done, card.id)).toMatchObject({ hidden: true })
    expect(done.items).toHaveLength(ready.items.length - 2)
    expect(done.log.filter((entry) => entry.publicLog.includes('advanced on the culture track'))[0]?.publicLog).toBe(
      'cash1981 advanced on the culture track to space 1 and drew 2 culture I cards',
    )
  })

  it('three cards on a Great Person space with Organized Religion and the Greeks', () => {
    const ready = advanceTurn({ step: 2, civ: 'Greeks', policies: ['Organized Religion'] })
    const done = advance(ready, 'req-1')
    expect(me(done).pendingRewards[0]?.candidateIds).toHaveLength(3)
    expect(done.log.filter((entry) => entry.publicLog.includes('advanced'))[0]?.publicLog).toBe(
      'cash1981 advanced on the culture track to space 3 and drew 3 Great Person cards',
    )
  })

  it('refuses a second advance while the choice is pending, and allows it after', () => {
    const pending = advance(choiceTurn(), 'req-1')
    expect(assistedAvailability(pending, CASH1981, 'cultureAdvance')).toMatchObject({
      status: 'unavailable',
      reason: expect.stringContaining('Choose the card to keep'),
    })
    expect(unwrapErr(press(pending, 'req-2')).kind).toBe('ASSISTED_ACTION_REJECTED')

    const [keep] = drawnBy(pending, 'req-1')
    const chosen = unwrap(choose(pending, 'req-2', 'req-1', keep ?? ''))
    expect(assistedAvailability(chosen, CASH1981, 'cultureAdvance').status).toBe('ready')
    expect(cultureMarkerLevelOf(advance(chosen, 'req-3'), CASH1981)).toBe(2)
  })

  it('keeps the chosen card and discards the others, hidden, like discardItem', () => {
    const pending = advance(choiceTurn(), 'req-1')
    const [first, second] = drawnBy(pending, 'req-1')
    const chosen = unwrap(choose(pending, 'req-2', 'req-1', second ?? ''))

    expect(handItem(chosen, second ?? '')).toBeDefined()
    expect(handItem(chosen, first ?? '')).toBeUndefined()
    expect(chosen.discardedItems.find((item) => item.id === first)).toMatchObject({ hidden: true })
    expect(me(chosen).pendingRewards).toEqual([])
    expect(me(chosen).items).toHaveLength(me(pending).items.length - 1)
    expect(chosen.assistedActions.find((record) => record.id === 'req-1')?.effect).toMatchObject({ kept: second })
    // The choice is a record of its own, but it is not in the public list of actions
    expect(chosen.assistedActions.find((record) => record.id === 'req-2')).toMatchObject({
      kind: 'chooseReward',
      usageKey: null,
    })
    expect(toPlayerView(chosen, KARANDRAS1).assistedActions.map((entry) => entry.id)).toEqual(['req-1'])
  })

  it('writes a public line that says only that a card was kept, and a private one that names the cards', () => {
    const pending = advance(choiceTurn(), 'req-1')
    const [first, second] = drawnBy(pending, 'req-1').map((id) => handItem(pending, id) as Item)
    const chosen = unwrap(choose(pending, 'req-2', 'req-1', first?.id ?? ''))
    const added = chosen.log.slice(pending.log.length)

    expect(added.filter((entry) => entry.publicLog !== '').map((entry) => entry.publicLog)).toEqual([
      'cash1981 kept a card',
    ])
    const privateLine = added.find((entry) => entry.privateLog !== '')
    expect(privateLine?.playerId).toBe(CASH1981)
    expect(privateLine?.privateLog).toContain(itemName(first as Item))
    expect(privateLine?.privateLog).toContain(itemName(second as Item))
    expect(added.every((entry) => entry.item === null)).toBe(true)
  })

  it('is idempotent by request id', () => {
    const pending = advance(choiceTurn(), 'req-1')
    const [keep] = drawnBy(pending, 'req-1')
    const first = unwrap(choose(pending, 'req-2', 'req-1', keep ?? ''))
    expect(unwrap(choose(first, 'req-2', 'req-1', keep ?? ''))).toBe(first)
  })

  it('a stale or unknown reward is a clear error and changes nothing', () => {
    const pending = advance(choiceTurn(), 'req-1')
    const [keep] = drawnBy(pending, 'req-1')

    const unknown = unwrapErr(choose(pending, 'req-2', 'no-such-reward', keep ?? ''))
    expect(unknown).toMatchObject({ kind: 'ASSISTED_ACTION_REJECTED', status: 'unavailable' })
    expect(unknown.kind === 'ASSISTED_ACTION_REJECTED' && unknown.reason).toMatch(/not waiting any more/)

    const chosen = unwrap(choose(pending, 'req-2', 'req-1', keep ?? ''))
    const stale = unwrapErr(choose(chosen, 'req-3', 'req-1', keep ?? ''))
    expect(stale).toMatchObject({ kind: 'ASSISTED_ACTION_REJECTED', status: 'unavailable', reason: 'You have no card choice waiting.' })
  })

  it('refuses a card that is not one of the candidates, another player and a card that left the hand', () => {
    const pending = advance(choiceTurn(), 'req-1')
    const [keep] = drawnBy(pending, 'req-1')
    const other = me(pending).items.find((item) => item.id !== keep && !drawnBy(pending, 'req-1').includes(item.id))

    const notCandidate = unwrapErr(choose(pending, 'req-2', 'req-1', other?.id ?? 'nothing'))
    expect(notCandidate).toMatchObject({ reason: 'That card is not one of the choices.' })

    // The reward belongs to cash1981: nobody else has a choice waiting, whatever they send
    const theirs = unwrapErr(choose(pending, 'req-3', 'req-1', keep ?? '', KARANDRAS1))
    expect(theirs).toMatchObject({ kind: 'ASSISTED_ACTION_REJECTED', reason: 'You have no card choice waiting.' })

    const gone = {
      ...pending,
      players: pending.players.map((p) =>
        p.playerId === CASH1981 ? { ...p, items: p.items.filter((item) => item.id !== keep) } : p,
      ),
    }
    expect(unwrapErr(choose(gone, 'req-4', 'req-1', keep ?? ''))).toMatchObject({
      reason: 'That card is no longer in your hand.',
    })
  })

  it('a request id of an earlier advance cannot be reused for a choice', () => {
    const pending = advance(choiceTurn(), 'req-1')
    const [keep] = drawnBy(pending, 'req-1')
    expect(unwrapErr(choose(pending, 'req-1', 'req-1', keep ?? ''))).toMatchObject({
      reason: 'This request id was already used.',
    })
  })
})

describe('step 21, the Culture Victory space', () => {
  it('draws a level 3 card, writes the public Culture Victory line and ends nothing', () => {
    const ready = advanceTurn({ step: 20 })
    const [card] = topCards(ready, 'CULTURE_3', 1)
    const done = advance(ready, 'req-1')

    expect(cultureMarkerLevelOf(done, CASH1981)).toBe(21)
    expect(handItem(done, card?.id ?? '')).toBeDefined()
    expect(me(done).stats.culture).toBe(93)
    expect(me(done).stats.trade).toBe(94)
    const lines = done.log.slice(ready.log.length).filter((entry) => entry.publicLog !== '')
    expect(lines.map((entry) => entry.publicLog)).toEqual([
      'cash1981 advanced on the culture track to space 21 and drew 1 culture III card',
      'cash1981 has reached the Culture Victory space on the culture track',
    ])
    // Only the advance line is a target for the undo vote
    expect(lines.map((entry) => entry.assistedActionId)).toEqual(['req-1', undefined])
    expect(done.winner).toBeNull()
    expect(done.active).toBe(true)
    expect(assistedAvailability(done, CASH1981, 'cultureAdvance').status).toBe('unavailable')
  })
})

describe('what the others can see', () => {
  const secrets = (state: GameState, requestId: string) => {
    const ids = drawnBy(state, requestId)
    const names = ids.map((id) => itemName(me(state).items.find((item) => item.id === id) as Item))
    return { ids, names }
  }

  it('shows another player and a spectator no candidate, no pending reward and no card name', () => {
    const pending = advance(choiceTurn(), 'req-1')
    const { ids, names } = secrets(pending, 'req-1')

    for (const viewerId of [...OTHERS, '']) {
      const view = toPlayerView(pending, viewerId)
      const json = JSON.stringify(view)
      for (const id of ids) expect(json).not.toContain(id)
      for (const name of names) expect(json).not.toContain(name)
      expect(JSON.stringify(view.opponents)).not.toContain('pendingRewards')
      expect(json).not.toContain('candidate')
      expect(json).not.toContain('"effect"')
      // A viewer's own list is their own: empty for everyone but the owner, and absent for a spectator
      if (viewerId === '') expect(json).not.toContain('pendingRewards')
      else expect(view.you?.pendingRewards).toEqual([])
    }
  })

  it('shows no card in the public log, the public record list or the item counts of the hand', () => {
    const pending = advance(choiceTurn(), 'req-1')
    const { ids, names } = secrets(pending, 'req-1')
    const publicView = JSON.stringify([pending.log.map(toPublicLog), toPlayerView(pending, '').assistedActions])
    for (const text of [...ids, ...names]) expect(publicView).not.toContain(text)

    // The opponent sees counts, as after any draw
    const opponent = toPlayerView(pending, KARANDRAS1).opponents.find((entry) => entry.playerId === CASH1981)
    expect(opponent?.publicHand.cultureCards).toBe(2)
    expect(JSON.stringify(opponent)).not.toContain('candidate')
  })

  it('shows the owner the choice with the candidate cards in the clear', () => {
    const pending = advance(choiceTurn(), 'req-1')
    const { ids, names } = secrets(pending, 'req-1')
    const view = toPlayerView(pending, CASH1981)
    const reward = view.you?.pendingRewards[0]

    expect(reward).toMatchObject({ id: 'req-1', kind: 'event', level: 1, step: 1, keep: 1 })
    expect(reward?.candidates.map((item) => item.id)).toEqual(ids)
    expect(reward?.candidates.map(itemName)).toEqual(names)
    const privateLine = view.log.find((entry) => 'privateLog' in entry && entry.privateLog.includes(names[0] ?? 'x'))
    expect(privateLine).toBeDefined()
  })

  it('a refresh resumes the same choice: a new projection draws nothing and returns the same candidates', () => {
    const pending = advance(choiceTurn(), 'req-1')
    const first: PlayerView = toPlayerView(pending, CASH1981)
    const second: PlayerView = toPlayerView(pending, CASH1981)
    expect(second.you?.pendingRewards).toEqual(first.you?.pendingRewards)
    expect(second.numberOfItemsInDeck).toBe(first.numberOfItemsInDeck)
    // A retry of the press after the refresh does not draw either
    const retried = unwrap(press(pending, 'req-1'))
    expect(retried).toBe(pending)
    expect(toPlayerView(retried, CASH1981).you?.pendingRewards).toEqual(first.you?.pendingRewards)
  })

  it('after the choice the owner no longer has a pending reward and the discard pile is the only trace', () => {
    const pending = advance(choiceTurn(), 'req-1')
    const [keep] = drawnBy(pending, 'req-1')
    const chosen = unwrap(choose(pending, 'req-2', 'req-1', keep ?? ''))
    expect(toPlayerView(chosen, CASH1981).you?.pendingRewards).toEqual([])
    const publicLines = chosen.log.map(toPublicLog).map((entry) => entry.publicLog)
    expect(publicLines.filter((line) => line.includes('kept'))).toEqual(['cash1981 kept a card'])
  })
})

describe('undoing an advance with the vote', () => {
  it('takes back a resolved advance: marker, culture, trade and the card back to the deck', () => {
    const ready = advanceTurn({ step: 7, culture: 20, trade: 20 })
    const done = advance(ready, 'req-1')
    const [card] = drawnBy(done, 'req-1')
    const undone = undoByVote(done, 'req-1')

    expect(cultureMarkerLevelOf(undone, CASH1981)).toBe(7)
    expect(me(undone).stats.culture).toBe(20)
    expect(me(undone).stats.trade).toBe(20)
    expect(handItem(undone, card ?? '')).toBeUndefined()
    expect(undone.items.some((item) => item.id === card)).toBe(true)
    expect(undone.items).toHaveLength(ready.items.length)
    expect(undone.assistedActions[0]?.status).toBe('undone')
    expect(undone.log.at(-1)?.publicLog).toBe(
      "System: cash1981's culture advance was undone: the leader marker is back on space 7, 5 culture and 3 trade returned and the drawn cards were put back in the deck",
    )
    // The original line stays, and the move back is on the board history
    expect(undone.log.some((entry) => entry.assistedActionId === 'req-1')).toBe(true)
    expect(undone.board.history.at(-1)?.change.kind).toBe('move')
    expect(me(undone).items).toHaveLength(me(ready).items.length)
  })

  it('shuffles the deck the way an item undo does', () => {
    const done = advance(advanceTurn(), 'req-1')
    const undone = undoByVote(done, 'req-1')
    const before = done.rng
    expect(undone.rng).not.toEqual(before)
    // The card is back somewhere in the deck, not necessarily on top
    expect(undone.items.map((item) => item.id).sort()).toEqual(
      [...done.items.map((item) => item.id), ...drawnBy(done, 'req-1')].sort(),
    )
  })

  it('undone before the choice: both candidates go back and the pending reward is removed', () => {
    const ready = choiceTurn()
    const pending = advance(ready, 'req-1')
    const ids = drawnBy(pending, 'req-1')
    const undone = undoByVote(pending, 'req-1')

    expect(me(undone).pendingRewards).toEqual([])
    for (const id of ids) {
      expect(handItem(undone, id)).toBeUndefined()
      expect(undone.items.some((item) => item.id === id)).toBe(true)
    }
    expect(undone.items).toHaveLength(ready.items.length)
    expect(cultureMarkerLevelOf(undone, CASH1981)).toBe(0)
    expect(me(undone).stats.culture).toBe(100)
    // A choice for the undone advance is stale now
    expect(unwrapErr(choose(undone, 'req-9', 'req-1', ids[0] ?? '')).kind).toBe('ASSISTED_ACTION_REJECTED')
  })

  it('undone after the choice: the kept card leaves the hand and the discarded one leaves the discard pile', () => {
    const ready = choiceTurn()
    const pending = advance(ready, 'req-1')
    const [first, second] = drawnBy(pending, 'req-1')
    const chosen = unwrap(choose(pending, 'req-2', 'req-1', second ?? ''))
    expect(chosen.discardedItems.some((item) => item.id === first)).toBe(true)

    const undone = undoByVote(chosen, 'req-1')
    expect(handItem(undone, second ?? '')).toBeUndefined()
    expect(undone.discardedItems.some((item) => item.id === first)).toBe(false)
    expect(undone.items.some((item) => item.id === first)).toBe(true)
    expect(undone.items.some((item) => item.id === second)).toBe(true)
    expect(undone.items).toHaveLength(ready.items.length)
    expect(undone.discardedItems).toHaveLength(ready.discardedItems.length)
    expect(cultureMarkerLevelOf(undone, CASH1981)).toBe(0)
  })

  it('can be advanced again after an undo with a new request id', () => {
    const undone = undoByVote(advance(advanceTurn(), 'req-1'), 'req-1')
    const again = advance(undone, 'req-2')
    expect(cultureMarkerLevelOf(again, CASH1981)).toBe(1)
    expect(unwrapErr(initiateUndo(undone, { logId: logIdOf(undone, 'req-1'), playerId: KARANDRAS1 })).kind).toBe(
      'ASSISTED_ACTION_ALREADY_UNDONE',
    )
  })

  it('one no refuses it and changes nothing', () => {
    const done = advance(advanceTurn(), 'req-1')
    const logId = logIdOf(done, 'req-1')
    let next = unwrap(initiateUndo(done, { logId, playerId: KARANDRAS1 }))
    next = unwrap(vote(next, { logId, playerId: ITCHI, vote: false }))
    next = unwrap(vote(next, { logId, playerId: CHUL, vote: true }))
    next = unwrap(vote(next, { logId, playerId: CASH1981, vote: true }))
    expect(next.assistedActions[0]?.status).toBe('applied')
    expect(cultureMarkerLevelOf(next, CASH1981)).toBe(1)
  })

  it('fails like a missing hut when the kept card has left the hand, and the vote stays open', () => {
    const pending = advance(choiceTurn(), 'req-1')
    const [keep] = drawnBy(pending, 'req-1')
    const chosen = unwrap(choose(pending, 'req-2', 'req-1', keep ?? ''))
    const kept = handItem(chosen, keep ?? '') as Item
    // The player discards the kept card by hand (it goes to the discard pile, not the deck)
    const discarded = unwrap(
      discardItem(chosen, { playerId: CASH1981, sheetName: kept.sheetName, itemNumber: kept.itemNumber, name: itemName(kept) }),
    )

    const logId = logIdOf(discarded, 'req-1')
    let next = unwrap(initiateUndo(discarded, { logId, playerId: CASH1981 }))
    next = unwrap(vote(next, { logId, playerId: KARANDRAS1, vote: true }))
    next = unwrap(vote(next, { logId, playerId: ITCHI, vote: true }))
    const failing = vote(next, { logId, playerId: CHUL, vote: true })
    expect(unwrapErr(failing).kind).toBe('ITEM_NOT_FOUND')
    // The last vote was not recorded, so the vote is still open and nothing was reversed
    expect(next.assistedActions[0]?.status).toBe('applied')
    expect(next.log.find((entry) => entry.id === logId)?.undo?.done).toBe(false)
    expect(cultureMarkerLevelOf(next, CASH1981)).toBe(1)
  })

  it('is blocked, not half done, when the marker has been moved on since', () => {
    const done = advance(advanceTurn({ culture: 50 }), 'req-1')
    const twice = advance(done, 'req-2')
    const logId = logIdOf(twice, 'req-1')
    let next = unwrap(initiateUndo(twice, { logId, playerId: CASH1981 }))
    next = unwrap(vote(next, { logId, playerId: KARANDRAS1, vote: true }))
    next = unwrap(vote(next, { logId, playerId: ITCHI, vote: true }))
    const failing = unwrapErr(vote(next, { logId, playerId: CHUL, vote: true }))
    expect(failing.kind).toBe('ASSISTED_UNDO_BLOCKED')
    expect(me(next).stats.culture).toBe(50 - 3 - 3)
    expect(cultureMarkerLevelOf(next, CASH1981)).toBe(2)

    // The later advance can be undone first, and then the earlier one
    const undoneSecond = undoByVote(twice, 'req-2')
    expect(cultureMarkerLevelOf(undoneSecond, CASH1981)).toBe(1)
    const undoneFirst = undoByVote(undoneSecond, 'req-1')
    expect(cultureMarkerLevelOf(undoneFirst, CASH1981)).toBe(0)
    expect(me(undoneFirst).stats.culture).toBe(50)
  })

  it('is blocked when the marker has been dragged off the space by hand', () => {
    const done = advance(advanceTurn(), 'req-1')
    const piece = done.board.pieces.find((candidate) => candidate.assetId === 'leaders/japanese_red')
    const target = cultureCellCenter(done.board, 5)
    const dragged = unwrap(
      movePiece(done, {
        playerId: CASH1981,
        pieceId: piece?.id ?? '',
        x: Math.round(target.x - (piece?.width ?? 0) / 2),
        y: piece?.y ?? 0,
        snap: false,
      }),
    )
    const logId = logIdOf(dragged, 'req-1')
    let next = unwrap(initiateUndo(dragged, { logId, playerId: CASH1981 }))
    for (const playerId of [KARANDRAS1, ITCHI]) next = unwrap(vote(next, { logId, playerId, vote: true }))
    expect(unwrapErr(vote(next, { logId, playerId: CHUL, vote: true })).kind).toBe('ASSISTED_UNDO_BLOCKED')
  })

  it('shows nothing private in the request, the votes and the new line', () => {
    const pending = advance(choiceTurn(), 'req-1')
    const { ids, names } = (() => {
      const drawn = drawnBy(pending, 'req-1')
      return { ids: drawn, names: drawn.map((id) => itemName(handItem(pending, id) as Item)) }
    })()
    const undone = undoByVote(pending, 'req-1')
    const added = undone.log.slice(pending.log.length).map(toPublicLog)
    const json = JSON.stringify(added)
    for (const text of [...ids, ...names]) expect(json).not.toContain(text)
    for (const viewerId of [...OTHERS, '']) {
      const view = JSON.stringify(toPlayerView(undone, viewerId))
      for (const text of [...ids, ...names]) expect(view).not.toContain(text)
    }
  })
})

describe('the board history and a culture advance', () => {
  it('the board Undo refuses to take back the marker move of an applied advance, and changes nothing', () => {
    const done = advance(advanceTurn(), 'req-1')
    const snapshot = JSON.stringify(done)
    expect(unwrapErr(undoLastBoardChange(done, CASH1981))).toEqual({ kind: 'BOARD_UNDO_ASSISTED' })
    expect(JSON.stringify(done)).toBe(snapshot)
  })

  it('an ordinary move of the marker before the advance can still be undone once the advance is undone', () => {
    const undone = undoByVote(advance(advanceTurn(), 'req-1'), 'req-1')
    // The move back is an ordinary board change again, and so is the placing before it
    const back = unwrap(undoLastBoardChange(undone, CASH1981))
    expect(back.board.history.length).toBe(undone.board.history.length - 1)
    expect(unwrapErr(undoLastBoardChange(advance(advanceTurn(), 'req-1'), CASH1981)).kind).toBe('BOARD_UNDO_ASSISTED')
  })
})

describe('old saves', () => {
  it('a hand saved before pending rewards gets an empty list, and a new game has one', () => {
    expect(me(firstCivGame()).pendingRewards).toEqual([])
    const old = JSON.parse(JSON.stringify(firstCivGame())) as { players: Record<string, unknown>[] }
    for (const player of old.players) delete player['pendingRewards']
    const migrated = migrateGameState(old as unknown as GameState)
    expect(migrated.players.every((player) => Array.isArray(player.pendingRewards) && player.pendingRewards.length === 0)).toBe(true)
  })
})
