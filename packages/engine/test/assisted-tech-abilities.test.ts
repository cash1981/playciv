/**
 * The resource abilities of the techs outside the unit slice (issue #327, slice 2): the four production boosts,
 * Pottery, Philosophy, Education, Horseback Riding, Mysticism, the cancelling Spy abilities (Writing, Civil Service,
 * Mass Media) and Monarchy. Each is paid through the shared layer (a token first, culture cards last), is once per
 * turn with a confirmed repeat, and is taken back by the undo vote or refused with a reason.
 */

import { describe, expect, it } from 'vitest'

import { endBattleAction, initiateBattle, placeUnitInArena, undoEndBattle } from '../src/actions/arena.js'
import { draw, drawUnitsForBattle } from '../src/actions/draw.js'
import { placePiece, removePiece, setCityProductionOverride, setWonderOwner, undoLastBoardChange } from '../src/actions/board.js'
import { chooseTech, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { assistedAvailability, availableActionsFor, performAssistedAction } from '../src/assisted.js'
import { buildOptionsOf } from '../src/build-options.js'
import { cityProductionsOf } from '../src/city-production.js'
import { SQUARE_SIZE, findBoardAsset, mapTop, piecesAtStep, slotOrigin } from '../src/board.js'
import { GREAT_PERSON_CARD_TYPES } from '../src/blockade.js'
import { isUnit } from '../src/item.js'
import { obsoletableWondersOf } from '../src/obsolete-wonders.js'
import { nextId, nextInt } from '../src/random.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { toPlayerView } from '../src/state.js'
import type { AssistedActionKind, GameState, Playerhand } from '../src/state.js'

import { player, resourcePattern, resourceText, withCardInHand, withHutInHand, withPieceInArea } from './assisted-fixture.js'
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
    expect(used.log.at(-1)?.publicLog).toMatch(new RegExp(`used ${tech}: spent 1 ${resourcePattern(state, 'Wheat')}, so .* produces ${amount} extra production this turn`))
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
    expect(used.log.at(-1)?.publicLog).toMatch(new RegExp(`used Pottery: spent ${resourcePattern(used, 'Iron')} and ${resourcePattern(used, 'Wheat')} and added 1 coin \\(\\d+\\) to Pottery`))
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
    expect(used.log.at(-1)?.publicLog).toMatch(new RegExp(`spent ${resourcePattern(state, 'Iron')} and played A Generous Gift item number #\\d+ as `))
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
    expect(publicLine).toMatch(new RegExp(`used Philosophy: spent ${resourcePattern(state, 'Iron')}, ${resourcePattern(state, 'Wheat')} and ${resourcePattern(state, 'Silk')}, and took a .* great person marker into reserve \\(item number #\\d+\\)`))
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

  it('paid with cards alone, the vote undo leaves no board entry the board Undo could use to bring the marker back alone', () => {
    const cards = ['A Generous Gift', 'A Princely Gift', 'A Gift from Afar']
    const state = cards.reduce((held, name) => withCardInHand(held, name).state, cmTurn('Philosophy'))
    const used = unwrap(press(state, 'philosophy', { resources: ['Iron', 'Wheat', 'Silk'] }))
    expect(used.board.pieces.length).toBe(state.board.pieces.length + 1)
    const undone = voted(used, 'req-1')
    expect(undone.board.pieces.length).toBe(state.board.pieces.length)
    // The marker's removal is the last board entry, and Undo must not walk back past it to put the marker on again
    expect(undoLastBoardChange(undone, CASH1981)).toMatchObject({ ok: false })
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

describe('Education (Incense, Iron, Silk and Wheat, City Management: a free tech)', () => {
  const FOUR = ['Incense', 'Iron', 'Silk', 'Wheat']
  const ready = (): GameState => huts(cmTurn('Education'), ...FOUR)
  const cardsHeld = (state: GameState, ...names: string[]): GameState => names.reduce((next, name) => withCardInHand(next, name).state, state)
  const inHand = (state: GameState, name: string): boolean => player(state).items.some((item) => 'name' in item && item.name === name)

  it('needs one of each of the four: two of one kind do not make two kinds, and a different kind never stands in', () => {
    expect(assistedAvailability(ready(), CASH1981, 'education').status).toBe('ready')
    expect(assistedAvailability(ready(), CASH1981, 'education')).not.toHaveProperty('warning')
    expect(assistedAvailability(huts(cmTurn('Education'), 'Incense', 'Iron', 'Iron', 'Wheat'), CASH1981, 'education').status).toBe('needs-resource')
    expect(assistedAvailability(huts(cmTurn('Education'), 'Incense', 'Iron', 'Wheat'), CASH1981, 'education').status).toBe('needs-resource')
    // Spy is not one of the four
    expect(assistedAvailability(huts(cmTurn('Education'), 'Incense', 'Iron', 'Wheat', 'Spy'), CASH1981, 'education').status).toBe('needs-resource')
    expect(assistedAvailability(huts(withTech(firstCivGame(), 'Education'), ...FOUR), CASH1981, 'education').status).toBe('wrong-phase')
  })

  it('pays one token of each, takes no names, and grants a free tech that is spent by revealing one in City Management', () => {
    // The payload is not read: whatever it carries, the same four are paid
    const used = unwrap(press(ready(), 'education', { resources: ['Spy', 'Spy', 'Spy', 'Spy'] }))
    expect(FOUR.map((name) => hasHut(used, name))).toEqual([false, false, false, false])
    expect(player(used).techGrants).toEqual([{ id: 'req-1', source: 'Education', level: null, turnNumber: 1, phase: 'CM' }])
    expect(used.log.at(-1)?.publicLog).toMatch(new RegExp(`used Education: spent ${resourcePattern(used, 'Incense')}, ${resourcePattern(used, 'Iron')}, ${resourcePattern(used, 'Silk')} and ${resourcePattern(used, 'Wheat')}, and may learn a new tech of their choice for free`))
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
    const used = unwrap(press(ready(), 'education'))
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

  it('an Incense token is always needed: no culture card can be played as Incense, and the reason says so', () => {
    const noIncense = cardsHeld(huts(cmTurn('Education'), 'Iron', 'Silk', 'Wheat'), 'A Gift from Afar', 'A Generous Gift', 'A Princely Gift')
    expect(assistedAvailability(noIncense, CASH1981, 'education')).toMatchObject({
      status: 'needs-resource',
      reason: expect.stringContaining('No culture card can be played as Incense, so a token is always needed'),
    })
    expect(refused(press(noIncense, 'education'))).toBe('ASSISTED_ACTION_REJECTED')
    expect(hasHut(noIncense, 'Iron')).toBe(true)
    expect(player(noIncense).techGrants).toEqual([])
    expect(noIncense.assistedActions).toHaveLength(0)
  })

  it('pays each kind that has no token with a culture card that can be played as it, several cards at once, each card once, and warns first naming every card', () => {
    const state = cardsHeld(huts(cmTurn('Education'), 'Incense', 'Wheat'), 'A Gift from Afar', 'A Generous Gift')
    const availability = assistedAvailability(state, CASH1981, 'education')
    expect(availability).toMatchObject({ status: 'ready', warning: expect.stringContaining('A Gift from Afar') })
    expect(availability).toMatchObject({ warning: expect.stringContaining('A Generous Gift') })
    // The Gift from Afar's coin token goes to another player by hand, and the warning says so
    expect(availability).toMatchObject({ warning: expect.stringContaining('give it by hand') })
    const used = unwrap(press(state, 'education'))
    const line = used.log.at(-1)?.publicLog ?? ''
    expect(line).toMatch(new RegExp(`spent ${resourcePattern(state, 'Incense')} and ${resourcePattern(state, 'Wheat')} and played A Gift from Afar item number #\\d+ as Iron \\(another player of your choice also gets a coin token: give it by hand\\) and played A Generous Gift item number #\\d+ as Silk`))
    expect(line).toContain('give it by hand')
    expect(inHand(used, 'A Gift from Afar') || inHand(used, 'A Generous Gift')).toBe(false)
    expect(used.discardedItems.filter((item) => 'name' in item && (item.name === 'A Gift from Afar' || item.name === 'A Generous Gift'))).toHaveLength(2)
    // Undo puts both cards back in the hand and the tokens too
    const undone = voted(used, 'req-1')
    expect(inHand(undone, 'A Gift from Afar') && inHand(undone, 'A Generous Gift')).toBe(true)
    expect(hasHut(undone, 'Incense') && hasHut(undone, 'Wheat')).toBe(true)
    expect(player(undone).techGrants).toEqual([])
  })

  it('does not count one card twice: two missing kinds need two cards', () => {
    const one = cardsHeld(huts(cmTurn('Education'), 'Incense', 'Wheat'), 'A Princely Gift')
    expect(assistedAvailability(one, CASH1981, 'education').status).toBe('needs-resource')
    expect(refused(press(one, 'education'))).toBe('ASSISTED_ACTION_REJECTED')
    expect(inHand(one, 'A Princely Gift')).toBe(true)
    // Three cards cover Iron, Silk and Wheat with only the Incense token
    const three = cardsHeld(huts(cmTurn('Education'), 'Incense'), 'A Gift from Afar', 'A Generous Gift', 'A Princely Gift')
    expect(assistedAvailability(three, CASH1981, 'education').status).toBe('ready')
    expect(player(unwrap(press(three, 'education'))).items.filter((item) => 'name' in item && item.name.startsWith('A ') && item.name.includes('Gift'))).toHaveLength(0)
  })

  it('an undo by vote returns the tokens and takes the grant while it is unused; refused once a tech was learned with it', () => {
    const used = unwrap(press(ready(), 'education'))
    const undone = voted(used, 'req-1')
    expect(FOUR.every((name) => hasHut(undone, name))).toBe(true)
    expect(player(undone).techGrants).toEqual([])
    expect(usedKeys(undone)).not.toContain('card:Education')

    const learned = unwrap(revealTech(unwrap(chooseTech(used, { playerId: CASH1981, techName: 'Currency' })), { playerId: CASH1981, techName: 'Currency' }))
    expect(unwrapErr(tryVote(learned, 'req-1')).kind).toBe('ASSISTED_UNDO_BLOCKED')
  })

  it('is once per turn, with a confirmed repeat', () => {
    const first = unwrap(press(ready(), 'education'))
    const more = huts(first, ...FOUR)
    expect(refused(press(more, 'education', undefined, 'req-2'))).toBe('ASSISTED_ACTION_REJECTED')
    expect(player(unwrap(press(more, 'education', undefined, 'req-2', true))).techGrants).toHaveLength(2)
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
    expect(used.log.at(-1)?.publicLog).toBe(`cash1981 used Horseback Riding: spent 1 ${resourceText(used, 'Silk')}, gaining 9 (12) trade, and Karandras1 gained 6 (6) trade`)
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
    expect(used.log.at(-1)?.publicLog).toMatch(new RegExp(`^cash1981 used Mysticism: spent 1 ${resourcePattern(used, 'Spy')}, so Karandras1 discards a coin from Code of Laws \\(I\\) \\(\\d+ left\\)$`))
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
    expect(line).toContain(`used ${tech}: spent 1 ${resourceText(used, 'Spy')}, cancelling ${what} of Karandras1 (Build in Capital)`)
    expect(line).toContain('settle it by hand')
    if (kind === 'massMedia') expect(line).toContain('the resources spent on it are lost')
    expect(used.assistedActions.at(-1)?.effect).toMatchObject({ kind: 'cancelAbility', tech, targetId: KARANDRAS1, note: 'Build in Capital' })
    // Nothing else about the other player changed
    expect(player(used, KARANDRAS1)).toEqual(player(ready(), KARANDRAS1))
  })

  it('flattens line breaks and control characters in the note, so the public line stays one line', () => {
    const used = unwrap(press(ready(), kind, { targetId: ITCHI, note: 'Build\nin\r\n  Capital\u0000!' }))
    expect(used.log.at(-1)?.publicLog).toContain('(Build in Capital !)')
    expect(used.log.at(-1)?.publicLog).not.toMatch(/[\u0000-\u001f]/)
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

  /** A wonder piece on the board, owned by `ownerId` (or by nobody). */
  const withWonder = (state: GameState, assetId: string, ownerId: string | null): { readonly state: GameState; readonly pieceId: string } => {
    const asset = findBoardAsset(assetId)
    if (asset === undefined) throw new Error(`no asset ${assetId}`)
    const placed = unwrap(placePiece(state, { playerId: CASH1981, assetId, x: 40, y: mapTop(state.board) + 40 + state.board.pieces.length * 3 }))
    const piece = placed.board.pieces.at(-1)
    if (piece === undefined) throw new Error('no wonder placed')
    return { state: ownerId === null ? placed : unwrap(setWonderOwner(placed, { playerId: CASH1981, pieceId: piece.id, ownerId })), pieceId: piece.id }
  }
  const wonderOf = (state: GameState, pieceId: string) => state.board.pieces.find((piece) => piece.id === pieceId)
  /** Silk in hand, and the Pyramids (ancient) owned by Karandras, Big Ben (modern) by Cash and Stonehenge (ancient) by Cash. */
  const scene = () => {
    const pyramids = withWonder(ready(), 'wonders/pyramids', KARANDRAS1)
    const bigBen = withWonder(pyramids.state, 'wonders/bigben', CASH1981)
    const stonehenge = withWonder(bigBen.state, 'wonders/stonehenge', CASH1981)
    return { state: stonehenge.state, pyramids: pyramids.pieceId, bigBen: bigBen.pieceId, stonehenge: stonehenge.pieceId }
  }
  const obsolete = (state: GameState, wonderPieceId: string, requestId = 'req-1', confirmed = false) =>
    press(state, 'monarchy', { mode: 'obsolete', wonderPieceId }, requestId, confirmed)
  /**
   * A refusal made on a state that holds the Silk it would spend: it is an error and the state is byte for byte what it was
   * (no record, no log line, the Silk still in the hand).
   */
  const refusedUntouched = (state: GameState, payload: Record<string, unknown>, requestId = 'req-1', confirmed = false): void => {
    expect(hasHut(state, 'Silk')).toBe(true)
    const before = JSON.stringify(state)
    expect(refused(press(state, 'monarchy', payload, requestId, confirmed))).toBe('ASSISTED_ACTION_REJECTED')
    expect(JSON.stringify(state)).toBe(before)
  }

  it('obsolete disables the chosen ancient wonder: the owner is cleared, the piece stays, the Silk is paid and the line names the wonder and its former owner', () => {
    const { state, pyramids } = scene()
    const used = unwrap(obsolete(state, pyramids))
    expect(hasHut(used, 'Silk')).toBe(false)
    expect(wonderOf(used, pyramids)).toMatchObject({ ownerId: null, disabled: true })
    expect(used.board.pieces.some((piece) => piece.id === pyramids)).toBe(true)
    expect(used.log.find((entry) => entry.assistedActionId === 'req-1')?.publicLog).toBe(
      `cash1981 used Monarchy: spent 1 ${resourceText(used, 'Silk')}, obsoleting The Pyramids of Karandras1: the wonder is disabled`,
    )
    expect(used.assistedActions.at(-1)?.effect).toMatchObject({ kind: 'monarchy', mode: 'obsolete', wonder: { pieceId: pyramids, ownerId: KARANDRAS1 } })
    expect(usedKeys(used)).toContain('card:Monarchy')
  })

  it('may disable the player\'s own ancient wonder, but not a modern one, an unowned one or one already disabled', () => {
    const { state, pyramids, bigBen, stonehenge } = scene()
    expect(wonderOf(unwrap(obsolete(state, stonehenge)), stonehenge)).toMatchObject({ ownerId: null, disabled: true })
    const market = withWonder(state, 'wonders/colossus', null)
    for (const id of [bigBen, market.pieceId, 'nope']) refusedUntouched(market.state, { mode: 'obsolete', wonderPieceId: id })
    const once = unwrap(obsolete(state, pyramids))
    refusedUntouched(huts(once, 'Silk'), { mode: 'obsolete', wonderPieceId: pyramids }, 'req-2', true)
    refusedUntouched(state, { mode: 'obsolete' })
    // A good press on the same kind of state does spend the Silk, so the checks above are not vacuous
    expect(hasHut(unwrap(obsolete(market.state, pyramids)), 'Silk')).toBe(false)
  })

  it('goes through the board history like the hand-made disable, and a replay shows it', () => {
    const { state, pyramids } = scene()
    const used = unwrap(obsolete(state, pyramids))
    const entry = used.board.history.at(-1)
    expect(entry).toMatchObject({ change: { kind: 'owner', pieceId: pyramids, from: KARANDRAS1, to: null, disabled: { from: false, to: true } } })
    expect(entry?.description).toBe('cash1981 disabled The Pyramids')
    expect(used.assistedActions.at(-1)?.effect).toMatchObject({ wonder: { historyId: entry?.id } })
    const hand = unwrap(setWonderOwner(state, { playerId: CASH1981, pieceId: pyramids, ownerId: null, disable: true }))
    expect(hand.board.history.at(-1)?.change).toEqual(entry?.change)
    const replayed = piecesAtStep(used.board.history, used.board.history.length).find((piece) => piece.id === pyramids)
    expect(replayed).toMatchObject({ ownerId: null, disabled: true })
    // Stepping back one change shows the wonder with its owner again
    expect(piecesAtStep(used.board.history, used.board.history.length - 1).find((piece) => piece.id === pyramids)).toMatchObject({ ownerId: KARANDRAS1 })
    // The line is counted into the history entry, so stepping through shows them together
    expect(entry?.logLength).toBe(used.log.length)
  })

  it('the board Undo cannot take the disable back alone: only the vote can', () => {
    const { state, pyramids } = scene()
    const used = unwrap(obsolete(state, pyramids))
    expect(undoLastBoardChange(used, CASH1981)).toMatchObject({ ok: false })
    const undone = voted(used, 'req-1')
    expect(wonderOf(undone, pyramids)).toMatchObject({ ownerId: KARANDRAS1, disabled: false })
    // After the vote the board Undo cannot walk back through the restoration either
    expect(undoLastBoardChange(undone, CASH1981)).toMatchObject({ ok: false })
  })

  it('an undo by vote restores owner and flag, returns the Silk and frees the use', () => {
    const { state, pyramids } = scene()
    const undone = voted(unwrap(obsolete(state, pyramids)), 'req-1')
    expect(hasHut(undone, 'Silk')).toBe(true)
    expect(usedKeys(undone)).not.toContain('card:Monarchy')
    expect(undone.log.at(-1)?.publicLog).toContain('The Pyramids is enabled again and back with Karandras1')
    // It may be obsoleted again
    expect(wonderOf(unwrap(obsolete(undone, pyramids, 'req-2')), pyramids)).toMatchObject({ ownerId: null, disabled: true })
  })

  it('refuses the undo, changing nothing, when the wonder owner or disabled mark changed since, or the wonder is gone', () => {
    const { state, pyramids } = scene()
    const used = unwrap(obsolete(state, pyramids))
    const reassigned = unwrap(setWonderOwner(used, { playerId: CASH1981, pieceId: pyramids, ownerId: ITCHI }))
    expect(JSON.stringify(unwrapErr(tryVote(reassigned, 'req-1')))).toContain('was changed since')
    const enabledByHand = unwrap(setWonderOwner(used, { playerId: CASH1981, pieceId: pyramids, ownerId: KARANDRAS1 }))
    expect(unwrapErr(tryVote(enabledByHand, 'req-1')).kind).toBe('ASSISTED_UNDO_BLOCKED')
    const gone = unwrap(removePiece(used, { playerId: CASH1981, pieceId: pyramids }))
    expect(JSON.stringify(unwrapErr(tryVote(gone, 'req-1')))).toContain('no longer on the board')
    expect(hasHut(reassigned, 'Silk')).toBe(false)
  })

  it('the button stays ready for the kill mode when no wonder can be obsoleted, and says why obsolete is not possible', () => {
    const none = ready()
    expect(assistedAvailability(none, CASH1981, 'monarchy')).toMatchObject({ status: 'ready', warning: expect.stringContaining('No ancient wonder is owned by a player') })
    expect(assistedAvailability(scene().state, CASH1981, 'monarchy')).not.toHaveProperty('warning')
    const modernOnly = withWonder(ready(), 'wonders/bigben', CASH1981).state
    expect(assistedAvailability(modernOnly, CASH1981, 'monarchy')).toMatchObject({ warning: expect.stringContaining('No ancient wonder') })
    expect(obsoletableWondersOf(scene().state.board, scene().state.players).map((wonder) => [wonder.label, wonder.ownerUsername])).toEqual([
      ['The Pyramids', 'Karandras1'],
      ['Stonehenge', 'cash1981'],
    ])
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
    expect(line).toMatch(new RegExp(`^cash1981 used Monarchy: spent 1 ${resourcePattern(used, 'Silk')}, killing \\w+ ${killed.attack}\\.${killed.health} item number #${killed.itemNumber} from Karandras1's hand$`))
    // The same state kills the same card: the pick comes from the game's seed
    const again = unwrap(press(state, 'monarchy', { mode: 'kill', targetId: KARANDRAS1 }))
    expect(unitsOf(again).map((unit) => unit.id)).toEqual(after.map((unit) => unit.id))
  })

  it('picks the card the seed names, a different seed another card, and leaves the advanced seed in the state', () => {
    const state = drawUnits(ready(), KARANDRAS1, 'INFANTRY', 'MOUNTED', 'ARTILLERY', 'INFANTRY')
    const units = unitsOf(state)
    expect(units).toHaveLength(4)
    const indexFor = (rng: number): number => nextInt(rng, units.length)[0]
    // Two seeds that name different cards, found by looking, so the test does not rest on luck
    const first = 1
    const second = Array.from({ length: 200 }, (_, at) => at + 2).find((seed) => indexFor(seed) !== indexFor(first))
    if (second === undefined) throw new Error('no seed names another card')
    for (const rng of [first, second]) {
      const used = unwrap(press({ ...state, rng }, 'monarchy', { mode: 'kill', targetId: KARANDRAS1 }))
      const killed = units[indexFor(rng)]
      expect(used.discardedItems.some((item) => item.id === killed?.id)).toBe(true)
      expect(unitsOf(used).map((unit) => unit.id)).toEqual(units.filter((unit) => unit.id !== killed?.id).map((unit) => unit.id))
      // The pick consumed a step of the seed, and the one log line then took its id from what was left
      expect(used.rng).toBe(nextId(nextInt(rng, units.length)[1])[1])
    }
    const a = unwrap(press({ ...state, rng: first }, 'monarchy', { mode: 'kill', targetId: KARANDRAS1 }))
    const b = unwrap(press({ ...state, rng: second }, 'monarchy', { mode: 'kill', targetId: KARANDRAS1 }))
    expect(unitsOf(a).map((unit) => unit.id)).not.toEqual(unitsOf(b).map((unit) => unit.id))
  })

  it('refuses a kill when the opponent holds no unit card, and spends nothing', () => {
    const state = ready()
    expect(unitsOf(state)).toHaveLength(0)
    refusedUntouched(state, { mode: 'kill', targetId: KARANDRAS1 })
    expect(usedKeys(state)).not.toContain('card:Monarchy')
    // With a unit in the hand the same press spends the Silk
    expect(hasHut(unwrap(press(drawUnits(state, KARANDRAS1, 'INFANTRY'), 'monarchy', { mode: 'kill', targetId: KARANDRAS1 })), 'Silk')).toBe(false)
  })

  describe('while a battle is on', () => {
    /** Cash attacks Karandras; Karandras holds three infantry, one of them placed in the arena. */
    function battle(): GameState {
      let state = drawUnits(ready(), KARANDRAS1, 'INFANTRY', 'INFANTRY', 'INFANTRY')
      state = unwrap(drawUnitsForBattle(drawUnits(state, CASH1981, 'INFANTRY'), { playerId: CASH1981, numberOfDraws: 1 }))
      state = unwrap(drawUnitsForBattle(state, { playerId: KARANDRAS1, numberOfDraws: 1 }))
      state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))
      const placed = player(state, KARANDRAS1).battlehand[0]
      if (placed === undefined) throw new Error('no battlehand unit')
      return unwrap(placeUnitInArena(state, { playerId: KARANDRAS1, unitId: placed.id, side: 'defender', position: 1, attack: 1, health: 3 }))
    }

    it('refuses a kill with a reason, spends nothing and leaves the hand alone; obsolete is not limited', () => {
      const state = battle()
      expect(state.battle).not.toBeNull()
      refusedUntouched(state, { mode: 'kill', targetId: KARANDRAS1 })
      expect(JSON.stringify(unwrapErr(press(state, 'monarchy', { mode: 'kill', targetId: KARANDRAS1 })))).toContain('A battle is on')
      expect(unitsOf(state)).toHaveLength(3)
      // The button says so but stays ready, since obsolete works
      expect(assistedAvailability(state, CASH1981, 'monarchy')).toMatchObject({ status: 'ready', warning: expect.stringContaining('A battle is on') })
      // Without a battle only the missing wonder is mentioned
      expect((assistedAvailability(ready(), CASH1981, 'monarchy') as { warning?: string }).warning).not.toContain('A battle is on')
      const owned = withWonder(state, 'wonders/pyramids', KARANDRAS1)
      expect(unwrap(obsolete(owned.state, owned.pieceId)).assistedActions).toHaveLength(1)
    })

    it('allows the kill once the battle is over: a unit End battle sent back to the hand is an ordinary unit, and undoing End battle still works', () => {
      const ended = unwrap(endBattleAction(battle(), { playerId: CASH1981 }))
      expect(ended.battle).toBeNull()
      expect(ended.endedBattle).not.toBeNull()
      expect((assistedAvailability(ended, CASH1981, 'monarchy') as { warning?: string }).warning ?? '').not.toContain('A battle is on')
      const fought = (ended.endedBattle?.battle.arena ?? []).map((unit) => unit.unit.id)
      expect(fought).toHaveLength(1)
      const units = unitsOf(ended)
      expect(units).toHaveLength(3)
      expect(units.some((unit) => fought.includes(unit.id))).toBe(true)
      // A seed that names the unit that fought, found by looking, so the test does not rest on luck
      const index = units.findIndex((unit) => fought.includes(unit.id))
      const seed = Array.from({ length: 200 }, (_, at) => at + 1).find((rng) => nextInt(rng, units.length)[0] === index)
      if (seed === undefined) throw new Error('no seed names that unit')
      const used = unwrap(press({ ...ended, rng: seed }, 'monarchy', { mode: 'kill', targetId: KARANDRAS1 }))
      expect(unitsOf(used)).toHaveLength(2)
      expect(used.discardedItems.some((item) => fought.includes(item.id))).toBe(true)
      // The card has left the hand: End battle can still be undone; the battle comes back as it was and the hand without the card
      const back = unwrap(undoEndBattle(used, { playerId: CASH1981 }))
      expect(back.battle).not.toBeNull()
      expect(unitsOf(back)).toHaveLength(2)
      // Undoing the kill now brings the card back locked in the reopened battle, whose arena still holds its unit
      const restored = voted(back, 'req-1')
      const returned = unitsOf(restored).filter((unit) => fought.includes(unit.id))
      expect(returned).toHaveLength(1)
      expect(returned.every((unit) => unit.inBattle)).toBe(true)
      expect(player(restored, KARANDRAS1).battlehand.filter((unit) => fought.includes(unit.id)).every((unit) => unit.inBattle)).toBe(true)
    })
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
    const { state, pyramids, stonehenge } = scene()
    const first = unwrap(obsolete(state, pyramids))
    const again = huts(first, 'Silk')
    expect(refused(obsolete(again, stonehenge, 'req-2'))).toBe('ASSISTED_ACTION_REJECTED')
    expect(unwrap(obsolete(again, stonehenge, 'req-2', true)).log.find((entry) => entry.assistedActionId === 'req-2')?.publicLog).toContain('confirmed by the player')
  })
})

// ---------------------------------------------------------------------------
// The shared layer, generalised
// ---------------------------------------------------------------------------

describe('Any N shares the token-first, culture-cards-last rule', () => {
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
})
