/**
 * The resource abilities of the techs outside the unit slice (issue #327, slice 2): the four production boosts,
 * Pottery, Philosophy, Education, Horseback Riding, Mysticism, the cancelling Spy abilities (Writing, Civil Service,
 * Mass Media) and Monarchy. Each is paid through the shared layer (a token first, culture cards last), is once per
 * turn with a confirmed repeat, and is taken back by the undo vote or refused with a reason.
 */

import { describe, expect, it } from 'vitest'

import { draw } from '../src/actions/draw.js'
import { placePiece, setCityProductionOverride, undoLastBoardChange } from '../src/actions/board.js'
import { chooseTech, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { assistedAvailability, availableActionsFor, performAssistedAction } from '../src/assisted.js'
import { buildOptionsOf } from '../src/build-options.js'
import { cityProductionsOf } from '../src/city-production.js'
import { SQUARE_SIZE, findBoardAsset, mapTop, slotOrigin } from '../src/board.js'
import { GREAT_PERSON_CARD_TYPES } from '../src/blockade.js'
import { isUnit } from '../src/item.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { AssistedActionKind, GameState, Playerhand } from '../src/state.js'

import { player, withCardInHand, withHutInHand, withPieceInArea } from './assisted-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-11-13T12:00:00.000Z'

const withTech = (state: GameState, techName: string, playerId = CASH1981): GameState =>
  unwrap(revealTech(unwrap(chooseTech(state, { playerId, techName })), { playerId, techName }))

const upTo = (state: GameState, phase: 'SOT' | 'TRADE' | 'CM'): GameState =>
  unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: phase }))

/** City Management open with the tech revealed. */
const cmTurn = (tech: string): GameState => upTo(withTech(firstCivGame(), tech), 'TRADE')

const press = (
  state: GameState,
  action: AssistedActionKind,
  payload?: Record<string, unknown>,
  requestId = 'req-1',
  confirmedRepeat = false,
) =>
  performAssistedAction(state, {
    playerId: CASH1981,
    action,
    requestId,
    at: AT,
    ...(payload === undefined ? {} : { payload: payload as never }),
    ...(confirmedRepeat ? { confirmedRepeat } : {}),
  })

const votes = (state: GameState, requestId: string) => {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line for the action')
  return entry
}

/** The undo vote, every other player in favour; the last vote's result is returned, as the reducer gives it. */
const tryVote = (state: GameState, requestId: string) => {
  const entry = votes(state, requestId)
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of [KARANDRAS1, ITCHI]) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  return vote(next, { logId: entry.id, playerId: CHUL, vote: true, at: AT })
}
const voted = (state: GameState, requestId: string): GameState => unwrap(tryVote(state, requestId))

const hasHut = (state: GameState, name: string, playerId = CASH1981): boolean =>
  player(state, playerId).items.some((item) => item.kind === 'hut' && item.name === name && !item.used)
const huts = (state: GameState, ...names: string[]): GameState =>
  names.reduce((next, name) => withHutInHand(next, name).state, state)
const withStats = (state: GameState, playerId: string, stats: Partial<Playerhand['stats']>): GameState => ({
  ...state,
  players: state.players.map((candidate) =>
    candidate.playerId === playerId ? { ...candidate, stats: { ...candidate.stats, ...stats } } : candidate,
  ),
})
/**
 * What a view shows apart from the viewer's own list of buttons. `you.availableActions` names every great person
 * (a `not-owned` row "You do not hold Alan Turing.") for everybody, so a name found there says nothing about a held
 * card and a scan that includes it depends on which card was drawn.
 */
const heldFieldsOf = (state: GameState, viewerId: string): string => {
  const view = toPlayerView(state, viewerId)
  const { availableActions: _buttons, playableCards: _playable, ...you } = view.you ?? ({} as NonNullable<typeof view.you>)
  return JSON.stringify({ ...view, you })
}
const usedKeys = (state: GameState): readonly string[] => player(state).playerTurns.at(-1)?.usedActions ?? []
const refused = (result: ReturnType<typeof press>): string => unwrapErr(result).kind

// ---------------------------------------------------------------------------
// A city to boost
// ---------------------------------------------------------------------------

const put = (state: GameState, playerId: string, assetId: string, column: number, row: number): GameState => {
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`no asset ${assetId}`)
  return unwrap(
    placePiece(state, {
      playerId,
      assetId,
      x: column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2,
      y: mapTop(state.board) + row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2,
    }),
  )
}

/** Cash is Red on Monarchy (no Despotism bonus), Karandras Blue; the America tile with a red city on B2: 5 production. */
function cityScene(tech: string): GameState {
  const colors: Record<string, string> = { [CASH1981]: 'Red', [KARANDRAS1]: 'Blue', [ITCHI]: 'Green', [CHUL]: 'Yellow' }
  const base = firstCivGame()
  const coloured: GameState = {
    ...base,
    players: base.players.map((p) => ({
      ...p,
      color: colors[p.playerId] ?? p.color,
      government: p.playerId === CASH1981 ? 'Monarchy' : p.government,
    })),
  }
  const slot = coloured.board.slots[0]
  if (slot === undefined) throw new Error('board has no slots')
  const [x, y] = slotOrigin(coloured.board, slot)
  const withMap = unwrap(placePiece(coloured, { playerId: CASH1981, assetId: 'tiles/america', x, y }))
  return upTo(withTech(put(withMap, CASH1981, 'cities/redcity2', 1, 1), tech), 'TRADE')
}

const cityId = (state: GameState, color: 'red' | 'blue' = 'red'): string => {
  const found = state.board.pieces.find((piece) => piece.category === 'city' && piece.assetId.startsWith(`cities/${color}`))
  if (found === undefined) throw new Error('no city')
  return found.id
}
const productionOf = (state: GameState) => {
  const city = cityProductionsOf(state, player(state))[0]
  if (city === undefined) throw new Error('no city production')
  return city
}

const BOOSTS = [
  ['animalHusbandry', 'Animal Husbandry', 3],
  ['construction', 'Construction', 5],
  ['banking', 'Banking', 7],
  ['plastics', 'Plastics', 10],
] as const

describe.each(BOOSTS)('%s (%s: Wheat, one city produces %i more this turn)', (kind, tech, amount) => {
  const ready = (): GameState => huts(cityScene(tech), 'Wheat')

  it('is ready with Wheat in City Management and the tech revealed, and says what is missing otherwise', () => {
    expect(assistedAvailability(ready(), CASH1981, kind).status).toBe('ready')
    expect(assistedAvailability(cityScene(tech), CASH1981, kind).status).toBe('needs-resource')
    expect(assistedAvailability(huts(cityScene(tech), 'Iron'), CASH1981, kind).status).toBe('needs-resource')
    expect(assistedAvailability(huts(firstCivGame(), 'Wheat'), CASH1981, kind).status).toBe('not-owned')
    const sot = huts(withTech(firstCivGame(), tech), 'Wheat')
    expect(assistedAvailability(sot, CASH1981, kind).status).toBe('wrong-phase')
    const hidden = huts(upTo(unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName: tech })), 'TRADE'), 'Wheat')
    expect(assistedAvailability(hidden, CASH1981, kind).status).toBe('unavailable')
  })

  it('pays the Wheat and adds the bonus to the chosen city: its estimate and the production a Build uses', () => {
    const state = ready()
    expect(productionOf(state).estimate).toBe(5)
    const used = unwrap(press(state, kind, { cityPieceId: cityId(state) }))
    expect(hasHut(used, 'Wheat')).toBe(false)
    expect(used.log.at(-1)?.publicLog).toMatch(new RegExp(`used ${tech}: spent 1 Wheat, so .* produces ${amount} extra production this turn`))
    expect(productionOf(used)).toMatchObject({ boost: amount, estimate: 5 + amount, effective: 5 + amount })
    expect(productionOf(used).modifiers).toContainEqual({ label: tech, amount, applied: true, note: 'This turn only.' })
    expect(buildOptionsOf(used, player(used))[0]?.production).toBe(5 + amount)
    expect(buildOptionsOf(state, player(state))[0]?.production).toBe(5)
    expect(assistedAvailability(used, CASH1981, kind).status).toBe('used')
    expect(used.assistedActions.at(-1)?.effect).toMatchObject({ kind: 'productionBoost', tech, amount })
  })

  it('adds to a number set by hand and to the Building Program figure, and ends with the turn', () => {
    const used = unwrap(press(ready(), kind, { cityPieceId: cityId(ready()) }))
    const hand = unwrap(setCityProductionOverride(used, { playerId: CASH1981, pieceId: cityId(used), value: 4 }))
    expect(productionOf(hand)).toMatchObject({ override: 4, boost: amount, effective: 4 + amount })
    expect(buildOptionsOf(hand, player(hand))[0]).toMatchObject({ production: 4 + amount, productionSource: 'override', boost: amount })
    // Another turn's record gives nothing
    const later: GameState = { ...used, assistedActions: used.assistedActions.map((record) => ({ ...record, turnNumber: 2 })) }
    expect(productionOf(later).boost).toBe(0)
  })

  it('refuses a missing city, a city that is not the player\'s and a malformed payload, and pays nothing', () => {
    const state = put(ready(), KARANDRAS1, 'cities/bluecity2', 9, 9)
    for (const payload of [undefined, {}, { cityPieceId: 7 }, { cityPieceId: 'no-such-piece' }, { cityPieceId: cityId(state, 'blue') }]) {
      expect(refused(press(state, kind, payload))).toBe('ASSISTED_ACTION_REJECTED')
    }
    expect(hasHut(state, 'Wheat')).toBe(true)
    expect(state.assistedActions).toHaveLength(0)
  })

  it('is once per turn; a confirmed repeat adds a second bonus to the city', () => {
    const state = huts(ready(), 'Wheat')
    const first = unwrap(press(state, kind, { cityPieceId: cityId(state) }))
    expect(refused(press(first, kind, { cityPieceId: cityId(first) }, 'req-2'))).toBe('ASSISTED_ACTION_REJECTED')
    const second = unwrap(press(first, kind, { cityPieceId: cityId(first) }, 'req-2', true))
    expect(productionOf(second).boost).toBe(amount * 2)
    expect(second.log.at(-1)?.publicLog).toContain('confirmed by the player')
  })

  it('an undo by vote returns the Wheat and takes the bonus off; the board Undo does not move the removed token', () => {
    const { state: base, piece } = withPieceInArea(cityScene(tech), 'resources/wheat')
    const used = unwrap(press(base, kind, { cityPieceId: cityId(base) }))
    expect(used.board.pieces.some((candidate) => candidate.id === piece.id)).toBe(false)
    expect(undoLastBoardChange(used, CASH1981)).toMatchObject({ ok: false })
    const undone = voted(used, 'req-1')
    expect(undone.board.pieces.some((candidate) => candidate.id === piece.id)).toBe(true)
    expect(productionOf(undone).boost).toBe(0)
    expect(productionOf(undone).estimate).toBe(5)
    expect(usedKeys(undone)).not.toContain(`card:${tech}`)
    expect(undone.log.at(-1)?.publicLog).toContain(`was undone`)
  })
})

describe('a production boost reaches a Build', () => {
  it('lets a city build what it could not pay for with its own production', () => {
    // A Workshop costs 7; the city makes 5, so it is short until Construction adds 5
    const state = withStats(huts(cityScene('Construction'), 'Wheat'), CASH1981, { trade: 20 })
    const before = buildOptionsOf(state, player(state))[0]
    const workshop = before?.choices.find((choice) => choice.assetId === 'buildings/workshop')
    expect(workshop?.tradeToPay).toBeGreaterThan(0)
    const used = unwrap(press(state, 'construction', { cityPieceId: cityId(state) }))
    const after = buildOptionsOf(used, player(used))[0]?.choices.find((choice) => choice.assetId === 'buildings/workshop')
    expect(after?.tradeToPay).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Pottery
// ---------------------------------------------------------------------------

describe('Pottery (Any 2, City Management: one coin on the tech, max 4)', () => {
  const ready = (): GameState => huts(cmTurn('Pottery'), 'Iron', 'Wheat')

  it('needs two resources of any kind, City Management and the tech revealed', () => {
    expect(assistedAvailability(cmTurn('Pottery'), CASH1981, 'pottery').status).toBe('needs-resource')
    expect(assistedAvailability(huts(cmTurn('Pottery'), 'Iron'), CASH1981, 'pottery').status).toBe('needs-resource')
    expect(assistedAvailability(ready(), CASH1981, 'pottery').status).toBe('ready')
    expect(assistedAvailability(huts(withTech(firstCivGame(), 'Pottery'), 'Iron', 'Wheat'), CASH1981, 'pottery').status).toBe('wrong-phase')
  })

  it('pays the two resources named and adds one coin to the Pottery counter, in the public line', () => {
    const used = unwrap(press(ready(), 'pottery', { resources: ['Iron', 'Wheat'] }))
    expect(hasHut(used, 'Iron')).toBe(false)
    expect(hasHut(used, 'Wheat')).toBe(false)
    expect(player(used).stats.coinSources.pottery).toBe(1)
    expect(used.log.at(-1)?.publicLog).toMatch(/used Pottery: spent Iron and Wheat and added 1 coin \(\d+\) to Pottery/)
    expect(assistedAvailability(used, CASH1981, 'pottery').status).toBe('used')
    expect(toPlayerView(used, KARANDRAS1).opponents.find((opponent) => opponent.playerId === CASH1981)?.stats.coinSources.pottery).toBe(1)
  })

  it('stops at 4 coins', () => {
    const full = withStats(ready(), CASH1981, { coinSources: { ...player(ready()).stats.coinSources, pottery: 4 } })
    expect(assistedAvailability(full, CASH1981, 'pottery')).toMatchObject({ status: 'unavailable', reason: 'Pottery is already at its coin capacity.' })
    expect(refused(press(full, 'pottery', { resources: ['Iron', 'Wheat'] }))).toBe('ASSISTED_ACTION_REJECTED')
    const three = withStats(ready(), CASH1981, { coinSources: { ...player(ready()).stats.coinSources, pottery: 3 } })
    expect(player(unwrap(press(three, 'pottery', { resources: ['Iron', 'Wheat'] }))).stats.coinSources.pottery).toBe(4)
  })

  it('refuses a payment that is not exactly two known resources', () => {
    const state = ready()
    for (const resources of [['Iron'], ['Iron', 'Wheat', 'Silk'], ['Iron', 'Gold'], [1, 2], 'Iron', undefined]) {
      expect(refused(press(state, 'pottery', { resources }))).toBe('ASSISTED_ACTION_REJECTED')
    }
    expect(hasHut(state, 'Iron')).toBe(true)
    expect(player(state).stats.coinSources.pottery).toBe(0)
  })

  it('pays a culture card for the resource it lacks, names it, and is once per turn with a confirmed repeat', () => {
    const state = withCardInHand(huts(cmTurn('Pottery'), 'Iron'), 'A Generous Gift').state
    expect(assistedAvailability(state, CASH1981, 'pottery')).toMatchObject({ status: 'ready', warning: expect.stringContaining('A Generous Gift') })
    const used = unwrap(press(state, 'pottery', { resources: ['Iron', 'Wheat'] }))
    expect(used.log.at(-1)?.publicLog).toMatch(/spent Iron and played A Generous Gift item number #\d+ as /)
    const again = huts(used, 'Silk', 'Wheat')
    expect(refused(press(again, 'pottery', { resources: ['Silk', 'Wheat'] }, 'req-2'))).toBe('ASSISTED_ACTION_REJECTED')
    expect(player(unwrap(press(again, 'pottery', { resources: ['Silk', 'Wheat'] }, 'req-2', true))).stats.coinSources.pottery).toBe(2)
  })

  it('an undo by vote returns exactly the tokens and takes the coin off; refused when the coin is gone', () => {
    const base = huts(withPieceInArea(cmTurn('Pottery'), 'resources/iron').state, 'Silk')
    const used = unwrap(press(base, 'pottery', { resources: ['Iron', 'Silk'] }))
    const undone = voted(used, 'req-1')
    expect(hasHut(undone, 'Silk')).toBe(true)
    expect(undone.board.pieces.some((piece) => piece.assetId === 'resources/iron')).toBe(true)
    expect(player(undone).stats.coinSources.pottery).toBe(0)
    expect(usedKeys(undone)).not.toContain('card:Pottery')

    // The coin was removed by hand, so there is nothing to take off: the vote is refused and nothing moves
    const gone = withStats(used, CASH1981, { coinSources: { ...player(used).stats.coinSources, pottery: 0 } })
    expect(unwrapErr(tryVote(gone, 'req-1')).kind).toBe('ASSISTED_UNDO_BLOCKED')
  })
})

// ---------------------------------------------------------------------------
// Philosophy
// ---------------------------------------------------------------------------

describe('Philosophy (Any 3, City Management: a random great person)', () => {
  const ready = (): GameState => huts(cmTurn('Philosophy'), 'Iron', 'Wheat', 'Silk')
  const greatPersons = (state: GameState, playerId = CASH1981) => player(state, playerId).items.filter((item) => item.kind === 'greatperson')

  it('needs three resources', () => {
    expect(assistedAvailability(huts(cmTurn('Philosophy'), 'Iron', 'Wheat'), CASH1981, 'philosophy').status).toBe('needs-resource')
    expect(assistedAvailability(ready(), CASH1981, 'philosophy').status).toBe('ready')
  })

  it('pays the three, draws the top great person into the hand with its marker, and keeps the name private', () => {
    const state = ready()
    const top = state.items.find((item) => item.sheetName === 'GREAT_PERSON')
    if (top === undefined || !('name' in top)) throw new Error('no great person in the deck')
    const used = unwrap(press(state, 'philosophy', { resources: ['Iron', 'Wheat', 'Silk'] }))
    expect(['Iron', 'Wheat', 'Silk'].map((name) => hasHut(used, name))).toEqual([false, false, false])
    expect(greatPersons(used).map((item) => item.id)).toEqual([top.id])
    expect(used.items.some((item) => item.id === top.id)).toBe(false)
    expect(used.board.pieces.length).toBe(state.board.pieces.length + 1)

    const publicLine = used.log.find((entry) => entry.assistedActionId === 'req-1')?.publicLog ?? ''
    expect(publicLine).toMatch(/used Philosophy: spent Iron, Wheat and Silk, and took a .* great person marker into reserve \(item number #\d+\)/)
    expect(publicLine).not.toContain(top.name)

    // The owner reads the name in their own log; no other view holds the name, the card or its id
    const own = JSON.stringify(toPlayerView(used, CASH1981))
    expect(own).toContain(top.name)
    expect(used.log.some((entry) => entry.playerId === CASH1981 && entry.privateLog.includes(top.name))).toBe(true)
    for (const viewer of [KARANDRAS1, ITCHI, CHUL]) {
      const theirs = heldFieldsOf(used, viewer)
      expect(theirs).not.toContain(top.name)
      expect(theirs).not.toContain(top.id)
      expect(theirs).not.toContain('privateLog')
    }
    expect(toPlayerView(used, KARANDRAS1).opponents.find((opponent) => opponent.playerId === CASH1981)?.publicHand.greatPersons).toBe(1)
  })

  it('is blocked, and refuses without paying, when no Great Person marker of any type is left', () => {
    // Another player's pieces use up all three markers of every type
    let state = ready()
    for (const [assetId] of GREAT_PERSON_CARD_TYPES) {
      for (let index = 0; index < 3; index += 1) state = withPieceInArea(state, assetId, KARANDRAS1).state
    }
    expect(assistedAvailability(state, CASH1981, 'philosophy')).toMatchObject({ status: 'unavailable' })
    expect(refused(press(state, 'philosophy', { resources: ['Iron', 'Wheat', 'Silk'] }))).toBe('ASSISTED_ACTION_REJECTED')
    expect(hasHut(state, 'Iron')).toBe(true)
    expect(state.assistedActions).toHaveLength(0)
  })

  it('an undo by vote puts the card back in the deck and takes the marker and the tokens', () => {
    const state = ready()
    const used = unwrap(press(state, 'philosophy', { resources: ['Iron', 'Wheat', 'Silk'] }))
    expect(undoLastBoardChange(used, CASH1981)).toMatchObject({ ok: false })
    const undone = voted(used, 'req-1')
    expect(greatPersons(undone)).toHaveLength(0)
    expect(undone.items.filter((item) => item.sheetName === 'GREAT_PERSON')).toHaveLength(state.items.filter((item) => item.sheetName === 'GREAT_PERSON').length)
    expect(undone.board.pieces.length).toBe(state.board.pieces.length)
    expect(['Iron', 'Wheat', 'Silk'].map((name) => hasHut(undone, name))).toEqual([true, true, true])
    expect(usedKeys(undone)).not.toContain('card:Philosophy')
  })

  it('refuses the undo, and keeps everything, once the card has left the hand', () => {
    const used = unwrap(press(ready(), 'philosophy', { resources: ['Iron', 'Wheat', 'Silk'] }))
    const card = greatPersons(used)[0]
    if (card === undefined) throw new Error('no card')
    const spent: GameState = {
      ...used,
      players: used.players.map((p) => (p.playerId === CASH1981 ? { ...p, items: p.items.filter((item) => item.id !== card.id) } : p)),
    }
    expect(unwrapErr(tryVote(spent, 'req-1')).kind).toBe('ASSISTED_UNDO_BLOCKED')
  })
})

// ---------------------------------------------------------------------------
// Education
// ---------------------------------------------------------------------------

describe('Education (4 different resources, City Management: a free tech)', () => {
  const FOUR = ['Iron', 'Wheat', 'Silk', 'Incense']
  const ready = (): GameState => huts(cmTurn('Education'), ...FOUR)

  it('needs four different resources: two of one kind do not make four', () => {
    expect(assistedAvailability(ready(), CASH1981, 'education').status).toBe('ready')
    expect(assistedAvailability(huts(cmTurn('Education'), 'Iron', 'Iron', 'Wheat', 'Silk'), CASH1981, 'education').status).toBe('needs-resource')
    expect(assistedAvailability(huts(cmTurn('Education'), 'Iron', 'Wheat', 'Silk'), CASH1981, 'education').status).toBe('needs-resource')
    // The kinds may be any four of the six
    expect(assistedAvailability(huts(cmTurn('Education'), 'Spy', 'Wheat', 'Silk', 'Iron'), CASH1981, 'education').status).toBe('ready')
  })

  it('pays one token of each named kind and grants a free tech that is spent by revealing one in City Management', () => {
    const used = unwrap(press(ready(), 'education', { resources: FOUR }))
    expect(FOUR.map((name) => hasHut(used, name))).toEqual([false, false, false, false])
    expect(player(used).techGrants).toEqual([{ id: 'req-1', source: 'Education', level: null, turnNumber: 1, phase: 'CM' }])
    expect(used.log.at(-1)?.publicLog).toMatch(/used Education: spent Iron, Wheat, Silk and Incense, and may learn a new tech of their choice for free/)
    expect(toPlayerView(used, CASH1981).you?.startOfTurn?.techGrants).toEqual([{ id: 'req-1', source: 'Education', level: null, phase: 'CM' }])

    // Choosing and revealing a tech now spends it
    const learned = unwrap(revealTech(unwrap(chooseTech(used, { playerId: CASH1981, techName: 'Currency' })), { playerId: CASH1981, techName: 'Currency' }))
    expect(player(learned).techGrants[0]).toMatchObject({ usedFor: 'Currency' })
    expect(learned.log.at(-1)?.publicLog).toBe('cash1981 learned Currency with Education')
    // And a second reveal learns nothing for free
    const second = unwrap(revealTech(unwrap(chooseTech(learned, { playerId: CASH1981, techName: 'Masonry' })), { playerId: CASH1981, techName: 'Masonry' }))
    expect(second.log.at(-1)?.publicLog).not.toContain('with Education')
  })

  it('does not give the free tech in the Start of Turn, and an ordinary grant is not spent in City Management', () => {
    const used = unwrap(press(ready(), 'education', { resources: FOUR }))
    const open: GameState = {
      ...used,
      players: used.players.map((p) =>
        p.playerId === CASH1981
          ? { ...p, playerTurns: p.playerTurns.map((turn) => ({ ...turn, done: { ...turn.done, CM: false, TRADE: false, SOT: false } })) }
          : p,
      ),
    }
    const sot = unwrap(revealTech(unwrap(chooseTech(open, { playerId: CASH1981, techName: 'Currency' })), { playerId: CASH1981, techName: 'Currency' }))
    expect(player(sot).techGrants[0]?.usedFor).toBeUndefined()

    const plain: GameState = {
      ...cmTurn('Education'),
      players: cmTurn('Education').players.map((p) =>
        p.playerId === CASH1981 ? { ...p, techGrants: [{ id: 'g', source: 'Rationalism', level: null, turnNumber: 1 }] } : p,
      ),
    }
    const cm = unwrap(revealTech(unwrap(chooseTech(plain, { playerId: CASH1981, techName: 'Currency' })), { playerId: CASH1981, techName: 'Currency' }))
    expect(player(cm).techGrants[0]?.usedFor).toBeUndefined()
  })

  it('refuses names that repeat a kind, fewer than four and unknown ones, and a kind it cannot pay, without paying', () => {
    const state = huts(ready(), 'Iron')
    for (const resources of [
      ['Iron', 'Iron', 'Wheat', 'Silk'],
      ['Iron', 'Wheat', 'Silk'],
      ['Iron', 'Wheat', 'Silk', 'Gold'],
      // Spy is not held and no card can pay it; Iron does not stand in for it, because the kinds must differ
      ['Iron', 'Wheat', 'Silk', 'Spy'],
      undefined,
    ]) {
      expect(refused(press(state, 'education', { resources }))).toBe('ASSISTED_ACTION_REJECTED')
    }
    expect(FOUR.every((name) => hasHut(state, name))).toBe(true)
    expect(player(state).techGrants).toEqual([])
  })

  it('pays a kind that has no token with a culture card that can be played as it, and says so first', () => {
    const state = withCardInHand(huts(cmTurn('Education'), 'Iron', 'Wheat', 'Silk'), 'A Generous Gift').state
    expect(assistedAvailability(state, CASH1981, 'education')).toMatchObject({ status: 'ready', warning: expect.stringContaining('A Generous Gift') })
    const used = unwrap(press(state, 'education', { resources: ['Iron', 'Wheat', 'Silk', 'Spy'] }))
    expect(used.log.at(-1)?.publicLog).toMatch(/spent Iron, Wheat and Silk and played A Generous Gift item number #\d+ as Spy/)
    expect(used.discardedItems.some((item) => 'name' in item && item.name === 'A Generous Gift')).toBe(true)
    // Undo puts the card back in the hand
    const undone = voted(used, 'req-1')
    expect(player(undone).items.some((item) => 'name' in item && item.name === 'A Generous Gift')).toBe(true)
    expect(player(undone).techGrants).toEqual([])
  })

  it('an undo by vote returns the tokens and takes the grant while it is unused; refused once a tech was learned with it', () => {
    const used = unwrap(press(ready(), 'education', { resources: FOUR }))
    const undone = voted(used, 'req-1')
    expect(FOUR.every((name) => hasHut(undone, name))).toBe(true)
    expect(player(undone).techGrants).toEqual([])
    expect(usedKeys(undone)).not.toContain('card:Education')

    const learned = unwrap(revealTech(unwrap(chooseTech(used, { playerId: CASH1981, techName: 'Currency' })), { playerId: CASH1981, techName: 'Currency' }))
    expect(unwrapErr(tryVote(learned, 'req-1')).kind).toBe('ASSISTED_UNDO_BLOCKED')
  })

  it('is once per turn, with a confirmed repeat', () => {
    const first = unwrap(press(ready(), 'education', { resources: FOUR }))
    const more = huts(first, ...FOUR)
    expect(refused(press(more, 'education', { resources: FOUR }, 'req-2'))).toBe('ASSISTED_ACTION_REJECTED')
    expect(player(unwrap(press(more, 'education', { resources: FOUR }, 'req-2', true))).techGrants).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Horseback Riding
// ---------------------------------------------------------------------------

describe('Horseback Riding (Silk, Trade: 9 trade, another player 6)', () => {
  const trade = (): GameState => huts(upTo(withTech(firstCivGame(), 'Horseback Riding'), 'SOT'), 'Silk')
  const tradeOf = (state: GameState, playerId = CASH1981): number => player(state, playerId).stats.trade

  it('is available only in the open Trade phase, with Silk', () => {
    expect(assistedAvailability(trade(), CASH1981, 'horsebackRiding').status).toBe('ready')
    expect(assistedAvailability(huts(upTo(withTech(firstCivGame(), 'Horseback Riding'), 'SOT'), 'Iron'), CASH1981, 'horsebackRiding').status).toBe('needs-resource')
    expect(assistedAvailability(huts(withTech(firstCivGame(), 'Horseback Riding'), 'Silk'), CASH1981, 'horsebackRiding')).toMatchObject({ status: 'wrong-phase', reason: 'Only available during your open Trade phase.' })
    expect(assistedAvailability(huts(upTo(withTech(firstCivGame(), 'Horseback Riding'), 'TRADE'), 'Silk'), CASH1981, 'horsebackRiding').status).toBe('wrong-phase')
    expect(availableActionsFor(trade(), CASH1981).find((entry) => entry.action === 'horsebackRiding')?.phase).toBe('TRADE')
  })

  it('pays the Silk, gives the player 9 and the chosen player 6, and logs both counters', () => {
    const base = withStats(trade(), CASH1981, { trade: 3 })
    const used = unwrap(press(base, 'horsebackRiding', { targetId: KARANDRAS1 }))
    expect(hasHut(used, 'Silk')).toBe(false)
    expect(tradeOf(used)).toBe(12)
    expect(tradeOf(used, KARANDRAS1)).toBe(6)
    expect(tradeOf(used, ITCHI)).toBe(0)
    expect(used.log.at(-1)?.publicLog).toBe('cash1981 used Horseback Riding: spent 1 Silk, gaining 9 (12) trade, and Karandras1 gained 6 (6) trade')
    expect(assistedAvailability(used, CASH1981, 'horsebackRiding').status).toBe('used')
  })

  it('stops each gain at the end of the trade track and undoes exactly what was added', () => {
    const base = withStats(withStats(trade(), CASH1981, { trade: 25 }), KARANDRAS1, { trade: 24 })
    const used = unwrap(press(base, 'horsebackRiding', { targetId: KARANDRAS1 }))
    expect(tradeOf(used)).toBe(27)
    expect(tradeOf(used, KARANDRAS1)).toBe(27)
    const undone = voted(used, 'req-1')
    expect(tradeOf(undone)).toBe(25)
    expect(tradeOf(undone, KARANDRAS1)).toBe(24)
  })

  it('refuses yourself, a missing or unknown player and a malformed payload, and pays nothing', () => {
    const state = trade()
    for (const payload of [undefined, {}, { targetId: CASH1981 }, { targetId: 'nobody' }, { targetId: 7 }]) {
      expect(refused(press(state, 'horsebackRiding', payload))).toBe('ASSISTED_ACTION_REJECTED')
    }
    expect(hasHut(state, 'Silk')).toBe(true)
    expect(tradeOf(state)).toBe(0)
  })

  it('an undo by vote returns the Silk and takes both gains back; refused when either player has spent the trade', () => {
    const used = unwrap(press(trade(), 'horsebackRiding', { targetId: KARANDRAS1 }))
    const undone = voted(used, 'req-1')
    expect(hasHut(undone, 'Silk')).toBe(true)
    expect([tradeOf(undone), tradeOf(undone, KARANDRAS1)]).toEqual([0, 0])
    expect(usedKeys(undone)).not.toContain('card:Horseback Riding')

    const targetSpent = withStats(used, KARANDRAS1, { trade: 2 })
    expect(unwrapErr(tryVote(targetSpent, 'req-1')).kind).toBe('ASSISTED_UNDO_BLOCKED')
    const mineSpent = withStats(used, CASH1981, { trade: 4 })
    expect(unwrapErr(tryVote(mineSpent, 'req-1')).kind).toBe('ASSISTED_UNDO_BLOCKED')
  })

  it('is once per turn, with a confirmed repeat', () => {
    const first = unwrap(press(trade(), 'horsebackRiding', { targetId: KARANDRAS1 }))
    const again = huts(first, 'Silk')
    expect(refused(press(again, 'horsebackRiding', { targetId: ITCHI }, 'req-2'))).toBe('ASSISTED_ACTION_REJECTED')
    expect(tradeOf(unwrap(press(again, 'horsebackRiding', { targetId: ITCHI }, 'req-2', true)), ITCHI)).toBe(6)
  })
})

// ---------------------------------------------------------------------------
// Mysticism
// ---------------------------------------------------------------------------

describe('Mysticism (Spy, City Management: an opponent discards a coin token of your choice)', () => {
  const coins = (state: GameState, playerId: string, sources: Record<string, number>): GameState =>
    withStats(state, playerId, { coinSources: { ...player(state, playerId).stats.coinSources, ...sources } })
  const ready = (): GameState => coins(huts(cmTurn('Mysticism'), 'Spy'), KARANDRAS1, { sheet: 2, codeOfLaws: 1 })
  const counter = (state: GameState, source: 'sheet' | 'codeOfLaws' | 'pottery'): number => player(state, KARANDRAS1).stats.coinSources[source]

  it('needs a Spy in City Management', () => {
    expect(assistedAvailability(ready(), CASH1981, 'mysticism').status).toBe('ready')
    expect(assistedAvailability(coins(cmTurn('Mysticism'), KARANDRAS1, { sheet: 2 }), CASH1981, 'mysticism').status).toBe('needs-resource')
  })

  it('takes one coin off the counter the player named, pays the Spy and logs it', () => {
    const used = unwrap(press(ready(), 'mysticism', { targetId: KARANDRAS1, source: 'codeOfLaws' }))
    expect(hasHut(used, 'Spy')).toBe(false)
    expect(counter(used, 'codeOfLaws')).toBe(0)
    expect(counter(used, 'sheet')).toBe(2)
    expect(used.log.at(-1)?.publicLog).toMatch(/^cash1981 used Mysticism: spent 1 Spy, so Karandras1 discards a coin from Code of Laws \(I\) \(\d+ left\)$/)
  })

  it('refuses an opponent with no coin on the counter, a counter that holds no tokens, yourself and bad payloads, and keeps the Spy', () => {
    const state = ready()
    for (const payload of [
      { targetId: KARANDRAS1, source: 'pottery' },
      { targetId: ITCHI, source: 'sheet' },
      // Printed coins and wonder coins are not tokens
      { targetId: KARANDRAS1, source: 'civilService' },
      { targetId: KARANDRAS1, source: 'panamaCanal' },
      { targetId: KARANDRAS1, source: 'nonsense' },
      { targetId: CASH1981, source: 'sheet' },
      { targetId: KARANDRAS1 },
      { source: 'sheet' },
      undefined,
    ]) {
      expect(refused(press(state, 'mysticism', payload))).toBe('ASSISTED_ACTION_REJECTED')
    }
    expect(hasHut(state, 'Spy')).toBe(true)
    expect(counter(state, 'sheet')).toBe(2)
  })

  it('an undo by vote returns the Spy and gives the coin back', () => {
    const used = unwrap(press(ready(), 'mysticism', { targetId: KARANDRAS1, source: 'sheet' }))
    const undone = voted(used, 'req-1')
    expect(hasHut(undone, 'Spy')).toBe(true)
    expect(counter(undone, 'sheet')).toBe(2)
    expect(usedKeys(undone)).not.toContain('card:Mysticism')
  })

  it('is once per turn, with a confirmed repeat', () => {
    const first = unwrap(press(ready(), 'mysticism', { targetId: KARANDRAS1, source: 'sheet' }))
    const again = huts(first, 'Spy')
    expect(refused(press(again, 'mysticism', { targetId: KARANDRAS1, source: 'sheet' }, 'req-2'))).toBe('ASSISTED_ACTION_REJECTED')
    expect(counter(unwrap(press(again, 'mysticism', { targetId: KARANDRAS1, source: 'sheet' }, 'req-2', true)), 'sheet')).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Writing, Civil Service, Mass Media
// ---------------------------------------------------------------------------

describe.each([
  ['writing', 'Writing', 'a city action', 'ANY'],
  ['civilService', 'Civil Service', 'a culture event', 'ANY'],
  ['massMedia', 'Mass Media', 'a resource ability', 'ANY'],
] as const)('%s (%s: a Spy cancels %s)', (kind, tech, what, phase) => {
  const ready = (): GameState => huts(cmTurn(tech), 'Spy')

  it('needs a Spy and the right phase', () => {
    expect(assistedAvailability(ready(), CASH1981, kind).status).toBe('ready')
    expect(assistedAvailability(cmTurn(tech), CASH1981, kind).status).toBe('needs-resource')
    const early = huts(withTech(firstCivGame(), tech), 'Spy')
    // Any open phase will do, the Start of Turn too: players act at different paces and nothing is blocked anyway
    expect(assistedAvailability(early, CASH1981, kind).status).toBe('ready')
    expect(availableActionsFor(ready(), CASH1981).find((entry) => entry.action === kind)?.phase).toBe(phase)
  })

  it('pays the Spy, names the player and what is cancelled, and says the game does not stop it', () => {
    const used = unwrap(press(ready(), kind, { targetId: KARANDRAS1, note: 'Build in Capital' }))
    expect(hasHut(used, 'Spy')).toBe(false)
    const line = used.log.at(-1)?.publicLog ?? ''
    expect(line).toContain(`used ${tech}: spent 1 Spy, cancelling ${what} of Karandras1 (Build in Capital)`)
    expect(line).toContain('settle it by hand')
    if (kind === 'massMedia') expect(line).toContain('the resources spent on it are lost')
    expect(used.assistedActions.at(-1)?.effect).toMatchObject({ kind: 'cancelAbility', tech, targetId: KARANDRAS1, note: 'Build in Capital' })
    // Nothing else about the other player changed
    expect(player(used, KARANDRAS1)).toEqual(player(ready(), KARANDRAS1))
  })

  it('works without a note, refuses yourself, a stranger and a long note, and pays nothing', () => {
    expect(unwrap(press(ready(), kind, { targetId: ITCHI })).log.at(-1)?.publicLog).toContain(`cancelling ${what} of Itchi`)
    for (const payload of [undefined, {}, { targetId: CASH1981 }, { targetId: 'nobody' }, { targetId: ITCHI, note: 'x'.repeat(81) }, { targetId: ITCHI, note: 4 }]) {
      expect(refused(press(ready(), kind, payload))).toBe('ASSISTED_ACTION_REJECTED')
    }
    expect(hasHut(ready(), 'Spy')).toBe(true)
  })

  it('is once per turn, with a confirmed repeat', () => {
    const first = unwrap(press(ready(), kind, { targetId: ITCHI }))
    const again = huts(first, 'Spy')
    expect(refused(press(again, kind, { targetId: ITCHI }, 'req-2'))).toBe('ASSISTED_ACTION_REJECTED')
    expect(unwrap(press(again, kind, { targetId: ITCHI }, 'req-2', true)).log.at(-1)?.publicLog).toContain('confirmed by the player')
  })

  it('an undo by vote returns the Spy and frees the use', () => {
    const used = unwrap(press(ready(), kind, { targetId: ITCHI }))
    const undone = voted(used, 'req-1')
    expect(hasHut(undone, 'Spy')).toBe(true)
    expect(usedKeys(undone)).not.toContain(`card:${tech}`)
    expect(undone.log.at(-1)?.publicLog).toContain(`${tech} was undone`)
  })

  it('pays its Spy with a culture card that can be played as one', () => {
    const state = withCardInHand(cmTurn(tech), 'A Princely Gift').state
    expect(assistedAvailability(state, CASH1981, kind)).toMatchObject({ status: 'ready', warning: expect.stringContaining('A Princely Gift') })
    const used = unwrap(press(state, kind, { targetId: ITCHI }))
    expect(used.log.at(-1)?.publicLog).toMatch(/played A Princely Gift item number #\d+ as Spy, cancelling/)
  })
})

// ---------------------------------------------------------------------------
// Monarchy
// ---------------------------------------------------------------------------

describe('Monarchy (Silk, City Management: obsolete a wonder, or kill a random unit)', () => {
  const ready = (): GameState => huts(cmTurn('Monarchy'), 'Silk')
  const drawUnits = (state: GameState, playerId: string, ...sheets: ('INFANTRY' | 'MOUNTED' | 'ARTILLERY')[]): GameState =>
    sheets.reduce((next, sheetName) => unwrap(draw(next, { playerId, sheetName, confirmedOutOfTurn: true })), state)
  const unitsOf = (state: GameState, playerId = KARANDRAS1) => player(state, playerId).items.filter(isUnit)

  it('needs a Silk in City Management', () => {
    expect(assistedAvailability(ready(), CASH1981, 'monarchy').status).toBe('ready')
    expect(assistedAvailability(cmTurn('Monarchy'), CASH1981, 'monarchy').status).toBe('needs-resource')
  })

  it('obsolete only pays the Silk and logs, since obsolescence is not tracked', () => {
    const used = unwrap(press(ready(), 'monarchy', { mode: 'obsolete' }))
    expect(hasHut(used, 'Silk')).toBe(false)
    expect(used.log.at(-1)?.publicLog).toBe('cash1981 used Monarchy: spent 1 Silk, obsoleting 1 ancient wonder (by hand: obsolescence is not tracked)')
    expect(used.assistedActions.at(-1)?.effect).toMatchObject({ kind: 'monarchy', mode: 'obsolete' })
    const undone = voted(used, 'req-1')
    expect(hasHut(undone, 'Silk')).toBe(true)
    expect(usedKeys(undone)).not.toContain('card:Monarchy')
  })

  it('kill discards one unit card from the chosen opponent\'s hand and names it in full with its item number', () => {
    const state = drawUnits(ready(), KARANDRAS1, 'INFANTRY', 'MOUNTED', 'ARTILLERY')
    const before = unitsOf(state)
    expect(before).toHaveLength(3)
    const used = unwrap(press(state, 'monarchy', { mode: 'kill', targetId: KARANDRAS1 }))
    const after = unitsOf(used)
    expect(after).toHaveLength(2)
    const killed = before.find((unit) => !after.some((kept) => kept.id === unit.id))
    if (killed === undefined) throw new Error('no unit was killed')
    expect(used.discardedItems.some((item) => item.id === killed.id)).toBe(true)
    expect(unitsOf(used, ITCHI)).toHaveLength(0)
    const line = used.log.at(-1)?.publicLog ?? ''
    expect(line).toMatch(new RegExp(`^cash1981 used Monarchy: spent 1 Silk, killing \\w+ ${killed.attack}\\.${killed.health} item number #${killed.itemNumber} from Karandras1's hand$`))
    // The same state kills the same card: the pick comes from the game's seed
    const again = unwrap(press(state, 'monarchy', { mode: 'kill', targetId: KARANDRAS1 }))
    expect(unitsOf(again).map((unit) => unit.id)).toEqual(after.map((unit) => unit.id))
  })

  it('refuses a kill when the opponent holds no unit card, and spends nothing', () => {
    const state = ready()
    expect(unitsOf(state)).toHaveLength(0)
    expect(refused(press(state, 'monarchy', { mode: 'kill', targetId: KARANDRAS1 }))).toBe('ASSISTED_ACTION_REJECTED')
    expect(hasHut(state, 'Silk')).toBe(true)
    expect(state.assistedActions).toHaveLength(0)
    expect(usedKeys(state)).not.toContain('card:Monarchy')
    // A unit already placed in a battle is not a standing force that can be killed
    const placed = drawUnits(state, KARANDRAS1, 'INFANTRY')
    const inArena: GameState = {
      ...placed,
      players: placed.players.map((p) =>
        p.playerId === KARANDRAS1 ? { ...p, items: p.items.map((item) => (isUnit(item) ? { ...item, inBattle: true } : item)) } : p,
      ),
    }
    expect(refused(press(inArena, 'monarchy', { mode: 'kill', targetId: KARANDRAS1 }))).toBe('ASSISTED_ACTION_REJECTED')
  })

  it('refuses yourself, a stranger, a missing mode and extra shapes', () => {
    const state = drawUnits(ready(), KARANDRAS1, 'INFANTRY')
    for (const payload of [undefined, {}, { mode: 'raze' }, { mode: 'kill' }, { mode: 'kill', targetId: CASH1981 }, { mode: 'kill', targetId: 'nobody' }]) {
      expect(refused(press(state, 'monarchy', payload))).toBe('ASSISTED_ACTION_REJECTED')
    }
    expect(hasHut(state, 'Silk')).toBe(true)
    expect(unitsOf(state)).toHaveLength(1)
  })

  it('an undo by vote returns the Silk and the card to the opponent\'s hand while it is still in the discard pile', () => {
    const state = drawUnits(ready(), KARANDRAS1, 'INFANTRY', 'MOUNTED')
    const used = unwrap(press(state, 'monarchy', { mode: 'kill', targetId: KARANDRAS1 }))
    const undone = voted(used, 'req-1')
    expect(hasHut(undone, 'Silk')).toBe(true)
    expect(unitsOf(undone).map((unit) => unit.id).sort()).toEqual(unitsOf(state).map((unit) => unit.id).sort())
    expect(undone.discardedItems.some((item) => unitsOf(state).some((unit) => unit.id === item.id))).toBe(false)
    expect(usedKeys(undone)).not.toContain('card:Monarchy')

    // The card has been shuffled back into the deck since: the undo is refused and nothing changes
    const killed = unitsOf(state).find((unit) => !unitsOf(used).some((kept) => kept.id === unit.id))
    if (killed === undefined) throw new Error('no unit was killed')
    const gone: GameState = { ...used, discardedItems: used.discardedItems.filter((item) => item.id !== killed.id) }
    expect(unwrapErr(tryVote(gone, 'req-1')).kind).toBe('ASSISTED_UNDO_BLOCKED')
  })

  it('keeps the victim\'s hand private: the unit is named only after the kill, and nobody else sees the cards left', () => {
    const state = drawUnits(ready(), KARANDRAS1, 'INFANTRY', 'MOUNTED', 'ARTILLERY')
    const used = unwrap(press(state, 'monarchy', { mode: 'kill', targetId: KARANDRAS1 }))
    const kept = unitsOf(used)
    // Before the kill no line names a unit of the victim's hand, and neither does any view of another player
    expect(state.log.some((entry) => entry.publicLog.includes('item number'))).toBe(false)
    expect(heldFieldsOf(state, CASH1981)).not.toContain(unitsOf(state)[0]?.id ?? 'x')
    // After it the public line names only the discarded unit; the units left stay in the victim's hand alone
    const viewOfCash = heldFieldsOf(used, CASH1981)
    for (const unit of kept) expect(viewOfCash).not.toContain(unit.id)
    const view = toPlayerView(used, ITCHI)
    expect(JSON.stringify(view.assistedActions)).not.toContain('killed')
    expect(JSON.stringify(view.assistedActions)).not.toContain('effect')
    const entry = view.log.find((candidate) => 'assistedActionId' in candidate && candidate.assistedActionId === 'req-1')
    expect(entry && 'privateLog' in entry).toBe(false)
  })

  it('is once per turn, with a confirmed repeat', () => {
    const first = unwrap(press(ready(), 'monarchy', { mode: 'obsolete' }))
    const again = huts(first, 'Silk')
    expect(refused(press(again, 'monarchy', { mode: 'obsolete' }, 'req-2'))).toBe('ASSISTED_ACTION_REJECTED')
    expect(unwrap(press(again, 'monarchy', { mode: 'obsolete' }, 'req-2', true)).log.at(-1)?.publicLog).toContain('confirmed by the player')
  })
})

// ---------------------------------------------------------------------------
// The shared layer, generalised
// ---------------------------------------------------------------------------

describe('Any N and N different resources share the token-first, culture-cards-last rule', () => {
  const card = (state: GameState, name: string): GameState => withCardInHand(state, name).state

  it('three resources use tokens of every kind before any card is played', () => {
    const state = card(huts(cmTurn('Philosophy'), 'Iron', 'Wheat'), 'A Generous Gift')
    // Two tokens and one card: the card is the shortfall and is named
    expect(assistedAvailability(state, CASH1981, 'philosophy')).toMatchObject({ status: 'ready', warning: expect.stringContaining('A Generous Gift') })
    // Three tokens: no card is played, so no warning
    const rich = card(huts(cmTurn('Philosophy'), 'Iron', 'Wheat', 'Silk'), 'A Generous Gift')
    expect(assistedAvailability(rich, CASH1981, 'philosophy').status).toBe('ready')
    expect(assistedAvailability(rich, CASH1981, 'philosophy')).not.toHaveProperty('warning')
    const used = unwrap(press(rich, 'philosophy', { resources: ['Iron', 'Wheat', 'Silk'] }))
    expect(player(used).items.some((item) => 'name' in item && item.name === 'A Generous Gift')).toBe(true)
  })

  it('does not count one card twice for two kinds', () => {
    // A single card cannot make four different resources
    const state = card(huts(cmTurn('Education'), 'Iron', 'Wheat'), 'A Generous Gift')
    expect(assistedAvailability(state, CASH1981, 'education').status).toBe('needs-resource')
    expect(findPlayer(state, CASH1981)).toBeDefined()
  })
})
