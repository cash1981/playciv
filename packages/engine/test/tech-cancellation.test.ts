/**
 * Writing, Civil Service and Mass Media cancel with a Spy, like Mark Twain with a card: the game rewinds to before
 * the target, the Spy is spent and the tech is used for the turn. Who may cancel and counter what follows the printed
 * texts: Writing a city action, Civil Service a culture event, Mass Media a resource ability: any recorded ability of
 * a tech that spent a resource (Pottery, Horseback Riding...), which Twain and Primetime TV stop as well.
 * Specification: `docs/agents/decisions.md` ("Cancellation").
 */

import { describe, expect, it } from 'vitest'

import { placePiece } from '../src/actions/board.js'
import { chooseTech, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { assistedAvailability, availableActionsFor, performAssistedAction } from '../src/assisted.js'
import { resourceAbilityOf, useTurnAction } from '../src/assisted-core.js'
import { currentTurnOf } from '../src/assisted-tech-abilities.js'
import { mapTop, slotOrigin, SQUARE_SIZE } from '../src/board.js'
import { applyCancellation } from '../src/cancellation.js'
import type { CancellationCommand } from '../src/cancellation.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { toPlayerView } from '../src/state.js'
import type { GameState } from '../src/state.js'

import { player, withCardInHand, withHutInHand, withPieceInArea } from './assisted-fixture.js'
import { CASH1981 as A, CHUL as D, KARANDRAS1 as B, ITCHI as C, firstCivGame } from './fixture.js'

const run = (state: GameState, baseline: GameState | undefined, playerId: string, requestId: string, cmd: CancellationCommand) =>
  applyCancellation(state, { playerId, requestId, command: cmd }, baseline)
const withTech = (state: GameState, techName: string, playerId: string): GameState =>
  unwrap(revealTech(unwrap(chooseTech(state, { playerId, techName })), { playerId, techName }))
const spyOf = (state: GameState, playerId: string) =>
  player(state, playerId).items.find((item) => item.kind === 'hut' && item.name === 'Spy')
const payment = (id: string, kind: 'hut' | 'village' | 'card' | 'piece' = 'hut') => ({ resource: 'Spy', kind, id })
const used = (state: GameState, playerId: string, tech: string): boolean =>
  player(state, playerId).playerTurns.some((turn) => turn.usedActions.includes(`card:${tech}`))
const discarded = (state: GameState, id: string): boolean => state.discardedItems.some((item) => item.id === id)
const refusal = (result: ReturnType<typeof run>): string => JSON.stringify(unwrapErr(result))

/** A has a city, and plays a city action (`devote`) or a culture event (`event`) that B reacts to. */
function scene() {
  let state = firstCivGame()
  state = { ...state, players: state.players.map((p) => ({ ...p, color: p.playerId === A ? 'Red' : p.playerId === B ? 'Blue' : 'Green' })) }
  const slot = state.board.slots[0]
  if (slot === undefined) throw new Error('no slot')
  const [x, y] = slotOrigin(state.board, slot)
  state = unwrap(placePiece(state, { playerId: A, assetId: 'tiles/america', x, y }))
  state = unwrap(placePiece(state, { playerId: A, assetId: 'cities/redcapital2', x: SQUARE_SIZE + 4, y: mapTop(state.board) + SQUARE_SIZE + 4 }))
  const cityId = state.board.pieces.at(-1)?.id ?? ''
  state = unwrap(markPhasesDone(state, { playerId: A, turnNumber: 1, upToPhase: 'TRADE' }))
  return { state, cityId }
}
/** B holds Writing (or another tech) and a Spy hut. */
const withSpyAndTech = (state: GameState, tech: string, owner = B) => {
  const hut = withHutInHand(withTech(state, tech, owner), 'Spy', owner)
  return { state: hut.state, spyId: hut.hutId }
}
const devote = (state: GameState, cityId: string, id = 'target') =>
  unwrap(performAssistedAction(state, { playerId: A, action: 'devoteToTheArts', requestId: id, payload: { cityPieceId: cityId } }))
const playCard = (state: GameState, owner: string, itemId: string, id: string) =>
  unwrap(performAssistedAction(state, { playerId: owner, action: 'playCard', requestId: id, payload: { itemId, targets: [] } }))
const logOf = (state: GameState, id: string): string => {
  const logId = state.assistedActions.find((r) => r.id === id)?.logId
  if (logId === undefined) throw new Error('missing action')
  return logId
}

describe('Writing cancels a city action', () => {
  it('rewinds it, spends the Spy, uses the tech for the turn and logs what happened', () => {
    const base = scene()
    const { state: baseline, spyId } = withSpyAndTech(base.state, 'Writing')
    const current = devote(baseline, base.cityId)
    const done = unwrap(run(current, baseline, B, 'w1', { logId: logOf(current, 'target'), tech: 'Writing', payment: payment(spyId) }))
    expect(player(done).stats).toEqual(player(baseline).stats)
    expect(done.assistedActions.map((r) => r.status)).toEqual(['cancelled'])
    expect(spyOf(done, B)).toBeUndefined()
    expect(discarded(done, spyId)).toBe(true)
    expect(used(done, B, 'Writing')).toBe(true)
    expect(done.log.at(-1)?.publicLog).toMatch(/^Karandras1 cancelled ".*" with Writing \(.*Spy.*\)\. Everything played after it is undone/)
    expect(done.cancellations?.events).toMatchObject([{ kind: 'cancel', playerId: B, tech: 'Writing', payment: payment(spyId) }])
  })

  it('pays with a culture card that can be played as a Spy', () => {
    const base = scene()
    const gift = withCardInHand(withTech(base.state, 'Writing', B), 'A Gift from Afar', B)
    const current = devote(gift.state, base.cityId)
    const done = unwrap(run(current, gift.state, B, 'w1', { logId: logOf(current, 'target'), tech: 'Writing', payment: payment(gift.itemId, 'card') }))
    expect(discarded(done, gift.itemId)).toBe(true)
    expect(player(done, B).items.some((item) => item.id === gift.itemId)).toBe(false)
  })

  it('may not cancel a culture event, or its own action', () => {
    const base = scene()
    const { state: baseline, spyId } = withSpyAndTech(base.state, 'Writing')
    const event = withCardInHand(baseline, 'Supply Drop', A)
    const current = playCard(event.state, A, event.itemId, 'target')
    expect(refusal(run(current, event.state, B, 'w1', { logId: logOf(current, 'target'), tech: 'Writing', payment: payment(spyId) })))
      .toContain('The printed card text does not permit this target.')
    const own = withSpyAndTech(base.state, 'Writing', A)
    const mine = devote(own.state, base.cityId)
    expect(refusal(run(mine, own.state, A, 'w2', { logId: logOf(mine, 'target'), tech: 'Writing', payment: payment(own.spyId) })))
      .toContain('The printed card text does not permit this target.')
  })

  it('needs a revealed tech, one use a turn and a Spy held both before the action and now', () => {
    const base = scene()
    const { state: baseline, spyId } = withSpyAndTech(base.state, 'Writing')
    const current = devote(baseline, base.cityId)
    const logId = logOf(current, 'target')
    const cmd = { logId, tech: 'Writing', payment: payment(spyId) }
    // No Writing at all
    const without = withHutInHand(base.state, 'Spy', B)
    const noTech = devote(without.state, base.cityId)
    expect(refusal(run(noTech, without.state, B, 'a', { logId: logOf(noTech, 'target'), tech: 'Writing', payment: payment(without.hutId) }))).toContain('Writing')
    // The Spy is not the one named, or it is only a piece, or it was obtained after the action
    expect(refusal(run(current, baseline, B, 'b', { ...cmd, payment: payment('nope') }))).toContain('Spy')
    expect(refusal(run(current, baseline, B, 'c', { ...cmd, payment: payment(spyId, 'piece') }))).toContain('Spy')
    const later = withHutInHand(current, 'Spy', B)
    expect(refusal(run(later.state, baseline, B, 'd', { ...cmd, payment: payment(later.hutId) }))).toContain('Spy')
    // Used this turn already
    const marked = useTurnAction(current, player(current, B), currentTurnOf(current, player(current, B)), 'card:Writing', player(current, B).stats)
    expect(refusal(run(marked, baseline, B, 'f', cmd))).toContain('already been used this turn')
    const first = unwrap(run(current, baseline, B, 'e', cmd))
    expect(used(first, B, 'Writing')).toBe(true)
    // A tech that cancels is one of three
    expect(refusal(run(current, baseline, B, 'g', { ...cmd, tech: 'Pottery' }))).toContain('Writing, Civil Service and Mass Media')
    expect(refusal(run(current, baseline, B, 'h', { logId, tech: 'Writing', itemId: spyId, payment: payment(spyId) }))).toContain('Writing, Civil Service and Mass Media')
  })
})

describe('Civil Service cancels a culture event', () => {
  it('rewinds it, spends the Spy and the cancelled event card', () => {
    const base = scene()
    const { state: ready, spyId } = withSpyAndTech(base.state, 'Civil Service')
    const event = withCardInHand(ready, 'Supply Drop', A)
    const current = playCard(event.state, A, event.itemId, 'target')
    const done = unwrap(run(current, event.state, B, 'c1', { logId: logOf(current, 'target'), tech: 'Civil Service', payment: payment(spyId) }))
    expect(discarded(done, spyId)).toBe(true)
    expect(discarded(done, event.itemId)).toBe(true)
    expect(used(done, B, 'Civil Service')).toBe(true)
    expect(done.assistedActions.map((r) => r.status)).toEqual(['cancelled'])
  })

  it('cannot cancel a city action, and neither can Mass Media', () => {
    const base = scene()
    const { state: baseline, spyId } = withSpyAndTech(base.state, 'Civil Service')
    const current = devote(baseline, base.cityId)
    expect(refusal(run(current, baseline, B, 'c1', { logId: logOf(current, 'target'), tech: 'Civil Service', payment: payment(spyId) })))
      .toContain('The printed card text does not permit this target.')
    const mass = withSpyAndTech(base.state, 'Mass Media')
    const action = devote(mass.state, base.cityId)
    expect(refusal(run(action, mass.state, B, 'm1', { logId: logOf(action, 'target'), tech: 'Mass Media', payment: payment(mass.spyId) })))
      .toContain('The printed card text does not permit this target.')
  })
})

/** A holds Pottery with Iron and Wheat in City Management; B reacts. */
function potteryScene() {
  const base = scene()
  const iron = withHutInHand(withTech(base.state, 'Pottery', A), 'Iron', A)
  const wheat = withHutInHand(iron.state, 'Wheat', A)
  const current = unwrap(performAssistedAction(wheat.state, { playerId: A, action: 'pottery', requestId: 'target', payload: { resources: ['Iron', 'Wheat'] } }))
  return { base, baseline: wheat.state, current, ironId: iron.hutId, wheatId: wheat.hutId }
}
/** A holds Horseback Riding with two Silk in Trade; B reacts. */
function horsebackScene() {
  const silk = withHutInHand(withHutInHand(withTech(firstCivGame(), 'Horseback Riding', A), 'Silk', A).state, 'Silk', A)
  const baseline = unwrap(markPhasesDone(silk.state, { playerId: A, turnNumber: 1, upToPhase: 'SOT' }))
  const current = unwrap(performAssistedAction(baseline, { playerId: A, action: 'horsebackRiding', requestId: 'target', payload: { targetId: B } }))
  const spent = current.assistedActions[0]?.effect
  const paid = spent?.kind === 'horsebackRiding' ? spent.spent[0] : undefined
  return { baseline, current, paidId: paid !== undefined && paid.kind !== 'piece' ? paid.itemId : '' }
}
const trade = (state: GameState, playerId: string): number => player(state, playerId).stats.trade

describe('a resource ability can be cancelled', () => {
  it('Mark Twain rewinds Horseback Riding: the trade is gone, the Silk stays spent and the ability is used up', () => {
    const scenery = horsebackScene()
    const twain = withCardInHand(scenery.baseline, 'Mark Twain', B)
    const current = unwrap(performAssistedAction(twain.state, { playerId: A, action: 'horsebackRiding', requestId: 'target', payload: { targetId: B } }))
    expect([trade(current, A), trade(current, B)]).not.toEqual([0, 0])
    const done = unwrap(run(current, twain.state, B, 't1', { logId: logOf(current, 'target'), itemId: twain.itemId }))
    expect([trade(done, A), trade(done, B)]).toEqual([0, 0])
    expect(done.assistedActions.map((r) => r.status)).toEqual(['cancelled'])
    expect(discarded(done, scenery.paidId)).toBe(true)
    expect(player(done, A).items.filter((item) => item.kind === 'hut' && item.name === 'Silk')).toHaveLength(1)
    expect(used(done, A, 'Horseback Riding')).toBe(true)
    expect(assistedAvailability(done, A, 'horsebackRiding').status).toBe('used')
    expect(discarded(done, twain.itemId)).toBe(true)
    expect(done.log.at(-1)?.publicLog).toMatch(/^Karandras1 cancelled ".*Horseback Riding.*" with Mark Twain\. .*What the ability spent stays spent, and it counts as used this turn\.$/)
    expect(done.log.some((entry) => entry.publicLog.startsWith('Cancelled: cash1981 used Horseback Riding'))).toBe(true)
  })

  it('Philosophy: all three resources are lost, the great person is not gained and Philosophy cannot be used again', () => {
    const base = scene()
    const hand = ['Iron', 'Wheat', 'Silk'].reduce((acc, name) => {
      const given = withHutInHand(acc.state, name, A)
      return { state: given.state, ids: [...acc.ids, given.hutId] }
    }, { state: withTech(base.state, 'Philosophy', A), ids: [] as string[] })
    const twain = withCardInHand(hand.state, 'Mark Twain', B)
    const greatPersons = (state: GameState) => player(state, A).items.filter((item) => item.kind === 'greatperson').length
    const current = unwrap(performAssistedAction(twain.state, { playerId: A, action: 'philosophy', requestId: 'target', payload: { resources: ['Iron', 'Wheat', 'Silk'] } }))
    expect(greatPersons(current)).toBe(greatPersons(twain.state) + 1)
    const done = unwrap(run(current, twain.state, B, 't1', { logId: logOf(current, 'target'), itemId: twain.itemId }))
    expect(greatPersons(done)).toBe(greatPersons(twain.state))
    expect(hand.ids.map((id) => discarded(done, id))).toEqual([true, true, true])
    expect(hand.ids.some((id) => player(done, A).items.some((item) => item.id === id))).toBe(false)
    expect(used(done, A, 'Philosophy')).toBe(true)
    expect(assistedAvailability(done, A, 'philosophy').status).not.toBe('ready')
    // The card it drew went back into the deck
    expect(done.items.length).toBe(twain.state.items.length)
  })

  it('shuffles the deck the drawn card went back into, twice, so nobody knows where it lies; the others stay as they were', () => {
    const base = scene()
    const hand = ['Iron', 'Wheat', 'Silk'].reduce((acc, name) => withHutInHand(acc, name, A).state, withTech(base.state, 'Philosophy', A))
    const twain = withCardInHand(hand, 'Mark Twain', B)
    const current = unwrap(performAssistedAction(twain.state, { playerId: A, action: 'philosophy', requestId: 'target', payload: { resources: ['Iron', 'Wheat', 'Silk'] } }))
    const done = unwrap(run(current, twain.state, B, 't1', { logId: logOf(current, 'target'), itemId: twain.itemId }))
    const order = (state: GameState, sheet: string): string[] => state.items.filter((item) => item.sheetName === sheet).map((item) => item.id)
    const before = order(twain.state, 'GREAT_PERSON')
    const after = order(done, 'GREAT_PERSON')
    // The drawn card (the top of the deck before the ability) is back, among the same cards, in another order
    expect([...after].sort()).toEqual([...before].sort())
    expect(after).not.toEqual(before)
    expect(after[0]).not.toBe(before[0])
    // The random stream moved on and no other deck was touched
    expect(done.rng).not.toEqual(twain.state.rng)
    for (const sheet of ['CULTURE_1', 'CULTURE_2', 'CULTURE_3', 'HUTS', 'VILLAGES']) expect(order(done, sheet)).toEqual(order(twain.state, sheet))
  })

  it('Ecology, a Start of Turn ability paid with Wheat, is one too: the Wheat is lost and it cannot be used again', () => {
    const wheat = withHutInHand(withTech(firstCivGame(), 'Ecology', A), 'Wheat', A)
    const twain = withCardInHand(wheat.state, 'Mark Twain', B)
    const current = unwrap(performAssistedAction(twain.state, { playerId: A, action: 'sot:ecology', requestId: 'target', payload: {} }))
    expect(current.assistedActions[0]?.status).toBe('applied')
    expect(player(current, A).items.some((item) => item.id === wheat.hutId)).toBe(false)
    const done = unwrap(run(current, twain.state, B, 't1', { logId: logOf(current, 'target'), itemId: twain.itemId }))
    expect(done.assistedActions.map((r) => r.status)).toEqual(['cancelled'])
    expect(discarded(done, wheat.hutId)).toBe(true)
    expect(player(done, A).items.some((item) => item.id === wheat.hutId)).toBe(false)
    expect(assistedAvailability(done, A, 'sot:ecology').status).toBe('used')
  })

  it('Currency, Chivalry and Metal Casting (one Incense for culture) are resource abilities too', () => {
    const base = scene()
    const incense = withHutInHand(withTech(base.state, 'Currency', A), 'Incense', A)
    const twain = withCardInHand(incense.state, 'Mark Twain', B)
    const current = unwrap(performAssistedAction(twain.state, { playerId: A, action: 'currency', requestId: 'target', payload: {} }))
    expect(player(current, A).stats.culture).toBeGreaterThan(player(twain.state, A).stats.culture)
    const done = unwrap(run(current, twain.state, B, 't1', { logId: logOf(current, 'target'), itemId: twain.itemId }))
    expect(player(done, A).stats.culture).toBe(player(twain.state, A).stats.culture)
    expect(discarded(done, incense.hutId)).toBe(true)
    expect(used(done, A, 'Currency')).toBe(true)
    expect(assistedAvailability(done, A, 'currency').status).toBe('used')
  })

  it('loses a culture card that paid the resource too (A Gift from Afar as Silk)', () => {
    const gift = withCardInHand(withTech(firstCivGame(), 'Horseback Riding', A), 'A Gift from Afar', A)
    const twain = withCardInHand(gift.state, 'Mark Twain', B)
    const ready = unwrap(markPhasesDone(twain.state, { playerId: A, turnNumber: 1, upToPhase: 'SOT' }))
    const current = unwrap(performAssistedAction(ready, { playerId: A, action: 'horsebackRiding', requestId: 'target', payload: { targetId: B } }))
    expect(discarded(current, gift.itemId)).toBe(true)
    const done = unwrap(run(current, ready, B, 't1', { logId: logOf(current, 'target'), itemId: twain.itemId }))
    expect(discarded(done, gift.itemId)).toBe(true)
    expect(player(done, A).items.some((item) => item.id === gift.itemId)).toBe(false)
    expect(trade(done, A)).toBe(trade(ready, A))
    expect(used(done, A, 'Horseback Riding')).toBe(true)
  })

  it('Marie Curie: the substitute the cancelled use consumed is not armed again, even when a card paid it', () => {
    const base = scene()
    const princely = withCardInHand(withTech(base.state, 'Atomic Theory', A), 'A Princely Gift', A)
    const armed = { ...princely.state, players: princely.state.players.map((p) => p.playerId === A ? { ...p, curieSubstitute: 'Silk' } : p) }
    const twain = withCardInHand(armed, 'Mark Twain', B)
    const current = unwrap(performAssistedAction(twain.state, { playerId: A, action: 'atomicTheory', requestId: 'target', payload: { mode: 'extraActions' } }))
    expect(player(current, A).curieSubstitute).toBeNull()
    expect(discarded(current, princely.itemId)).toBe(true)
    const done = unwrap(run(current, twain.state, B, 't1', { logId: logOf(current, 'target'), itemId: twain.itemId }))
    expect(player(done, A).curieSubstitute).toBeNull()
    expect(discarded(done, princely.itemId)).toBe(true)
    expect(used(done, A, 'Atomic Theory')).toBe(true)
  })

  it('a cancelled use keeps holding the turn\'s key when the first use of a confirmed repeat is undone', () => {
    const base = scene()
    let working = withTech(base.state, 'Pottery', A)
    for (const name of ['Iron', 'Wheat', 'Silk', 'Incense']) working = withHutInHand(working, name, A).state
    const twain = withCardInHand(working, 'Mark Twain', B)
    const first = unwrap(performAssistedAction(twain.state, { playerId: A, action: 'pottery', requestId: 'first', payload: { resources: ['Iron', 'Wheat'] } }))
    const second = unwrap(performAssistedAction(first, { playerId: A, action: 'pottery', requestId: 'second', confirmedRepeat: true, payload: { resources: ['Silk', 'Incense'] } }))
    const cancelled = unwrap(run(second, first, B, 't1', { logId: logOf(second, 'second'), itemId: twain.itemId }))
    expect(cancelled.assistedActions.map((r) => r.status)).toEqual(['applied', 'cancelled'])
    // The first use is undone by the table's vote
    const line = cancelled.log.find((entry) => entry.assistedActionId === 'first')
    if (line === undefined) throw new Error('no line for the first use')
    let voting = unwrap(initiateUndo(cancelled, { logId: line.id, playerId: A }))
    for (const playerId of [B, C]) voting = unwrap(vote(voting, { logId: line.id, playerId, vote: true, at: '2026-11-15T12:00:00.000Z' }))
    const undone = unwrap(vote(voting, { logId: line.id, playerId: D, vote: true, at: '2026-11-15T12:00:00.000Z' }))
    expect(undone.assistedActions.map((r) => r.status)).toEqual(['undone', 'cancelled'])
    expect(used(undone, A, 'Pottery')).toBe(true)
  })

  it('keeps a Silk that was only a piece on the map spent too', () => {
    const piece = withPieceInArea(withTech(firstCivGame(), 'Horseback Riding', A), 'resources/silk', A)
    const ready = unwrap(markPhasesDone(piece.state, { playerId: A, turnNumber: 1, upToPhase: 'SOT' }))
    const twain = withCardInHand(ready, 'Mark Twain', B)
    const current = unwrap(performAssistedAction(twain.state, { playerId: A, action: 'horsebackRiding', requestId: 'target', payload: { targetId: B } }))
    expect(current.board.pieces.some((p) => p.id === piece.piece.id)).toBe(false)
    const done = unwrap(run(current, twain.state, B, 't1', { logId: logOf(current, 'target'), itemId: twain.itemId }))
    expect(done.board.pieces.some((p) => p.id === piece.piece.id)).toBe(false)
    expect(trade(done, A)).toBe(trade(twain.state, A))
    expect(used(done, A, 'Horseback Riding')).toBe(true)
  })

  it('Mass Media cancels Pottery with a Spy: no coin, both resources and the Spy spent, both techs used', () => {
    const { current, baseline, ironId, wheatId } = potteryScene()
    expect(player(current, A).stats.coinSources.pottery).toBe(1)
    const mass = withSpyAndTech(baseline, 'Mass Media')
    const before = unwrap(performAssistedAction(mass.state, { playerId: A, action: 'pottery', requestId: 'target', payload: { resources: ['Iron', 'Wheat'] } }))
    const done = unwrap(run(before, mass.state, B, 'm1', { logId: logOf(before, 'target'), tech: 'Mass Media', payment: payment(mass.spyId) }))
    expect(player(done, A).stats.coinSources.pottery).toBe(0)
    expect([ironId, wheatId, mass.spyId].map((id) => discarded(done, id))).toEqual([true, true, true])
    expect(used(done, A, 'Pottery')).toBe(true)
    expect(used(done, B, 'Mass Media')).toBe(true)
    expect(done.assistedActions.map((r) => r.status)).toEqual(['cancelled'])
    expect(done.cancellations?.events).toMatchObject([{ kind: 'cancel', tech: 'Mass Media' }])
  })

  it('Primetime TV cancels it too; Jousting Tourney, Bread and Circuses, Writing and Civil Service cannot', () => {
    const { baseline } = potteryScene()
    let working = baseline
    const ids: Record<string, string> = {}
    for (const name of ['Primetime TV', 'Jousting Tourney', 'Bread and Circuses']) {
      const given = withCardInHand(working, name, B)
      working = given.state
      ids[name] = given.itemId
    }
    const writing = withSpyAndTech(working, 'Writing')
    const civil = withSpyAndTech(writing.state, 'Civil Service')
    const current = unwrap(performAssistedAction(civil.state, { playerId: A, action: 'pottery', requestId: 'target', payload: { resources: ['Iron', 'Wheat'] } }))
    const logId = logOf(current, 'target')
    const denied = 'The printed card text does not permit this target.'
    for (const name of ['Jousting Tourney', 'Bread and Circuses']) {
      expect(refusal(run(current, civil.state, B, name, { logId, itemId: ids[name] ?? '' }))).toContain(denied)
    }
    expect(refusal(run(current, civil.state, B, 'w', { logId, tech: 'Writing', payment: payment(writing.spyId) }))).toContain(denied)
    expect(refusal(run(current, civil.state, B, 'c', { logId, tech: 'Civil Service', payment: payment(civil.spyId) }))).toContain(denied)
    const done = unwrap(run(current, civil.state, B, 'p', { logId, itemId: ids['Primetime TV'] ?? '' }))
    expect(done.assistedActions.map((r) => r.status)).toEqual(['cancelled'])
    expect(player(done, A).stats.coinSources.pottery).toBe(0)
    expect(used(done, A, 'Pottery')).toBe(true)
  })

  it('Mass Media cannot cancel a culture event', () => {
    const base = scene()
    const mass = withSpyAndTech(base.state, 'Mass Media')
    const event = withCardInHand(mass.state, 'Supply Drop', A)
    const played = playCard(event.state, A, event.itemId, 'target')
    expect(refusal(run(played, event.state, B, 'm', { logId: logOf(played, 'target'), tech: 'Mass Media', payment: payment(mass.spyId) })))
      .toContain('The printed card text does not permit this target.')
  })

  it('a countered cancellation of an ability puts it back, and nothing is spent twice', () => {
    const { baseline, ironId, wheatId } = potteryScene()
    const mass = withSpyAndTech(baseline, 'Mass Media')
    const tv = withCardInHand(mass.state, 'Primetime TV', A)
    const current = unwrap(performAssistedAction(tv.state, { playerId: A, action: 'pottery', requestId: 'target', payload: { resources: ['Iron', 'Wheat'] } }))
    const first = unwrap(run(current, tv.state, B, 'cancel', { logId: logOf(current, 'target'), tech: 'Mass Media', payment: payment(mass.spyId) }))
    const back = unwrap(run(first, current, A, 'counter', { logId: 'cancellation:cancel', itemId: tv.itemId }))
    expect(back.assistedActions.map((r) => r.status)).toEqual(['applied'])
    expect(player(back, A).stats.coinSources.pottery).toBe(1)
    for (const id of [ironId, wheatId, mass.spyId, tv.itemId]) expect(back.discardedItems.filter((item) => item.id === id)).toHaveLength(1)
    expect(used(back, A, 'Pottery')).toBe(true)
  })

  it('an ability that costs nothing, or only a note, is not one: Bureaucracy, a free Start of Turn note, Combustion', () => {
    expect(resourceAbilityOf({ effect: { kind: 'bureaucracy', spent: [] } })).toBeUndefined()
    expect(resourceAbilityOf({ effect: { kind: 'sotNote', subject: 'Plastics', spent: null } })).toBeUndefined()
    expect(resourceAbilityOf({ effect: { kind: 'combustion', pieceId: 'p', square: { column: 1, row: 1 }, walls: false, subject: 'x' } })).toBeUndefined()
    expect(resourceAbilityOf({ effect: { kind: 'cancelAbility', tech: 'Writing', spent: [{ kind: 'hut', resource: 'Spy', itemId: 'x' }], targetId: 't', note: '' } })).toBeUndefined()
    expect(resourceAbilityOf({ effect: { kind: 'sotNote', subject: 'Ecology', spent: { kind: 'hut', resource: 'Wheat', itemId: 'w' } } })).toHaveLength(1)
    expect(resourceAbilityOf({ effect: { kind: 'techWounds', tech: 'Ballistics', wounds: 1, battleId: 'b', spent: { kind: 'hut', resource: 'Iron', itemId: 'i' } } })).toHaveLength(1)
    for (const kind of ['chivalry', 'currency', 'metalCasting'] as const) {
      expect(resourceAbilityOf({ effect: { kind, culture: 3, spent: { kind: 'hut', resource: 'Incense', itemId: 'i' } } })).toHaveLength(1)
    }
  })

  it('is offered in the view of whoever may stop it, and Twain says why it is blocked for the owner', () => {
    const { baseline, current } = potteryScene()
    const mass = withSpyAndTech(withCardInHand(current, 'Mark Twain', B).state, 'Mass Media')
    const logId = logOf(current, 'target')
    const viewer = toPlayerView(mass.state, B).cancellations
    expect(viewer?.techCancels).toMatchObject([{ tech: 'Mass Media', targets: [{ logId, blocked: null }] }])
    expect(viewer?.responseCards.find((card) => card.name === 'Mark Twain')?.targets).toMatchObject([{ logId, blocked: null }])
    const owner = withCardInHand(current, 'Mark Twain', A)
    expect(toPlayerView(owner.state, A).cancellations?.responseCards.find((card) => card.name === 'Mark Twain')?.targets)
      .toMatchObject([{ logId, blocked: expect.stringContaining('Your own action') }])
    expect(toPlayerView(baseline, B).cancellations?.techCancels).toEqual([])
  })
})

describe('countering a tech cancellation (a resource ability)', () => {
  /** A has a city action; B cancels it with Writing; the others hold the counters (A: Primetime TV, Twain, King; C: Jousting). */
  function cancelled(twainOwner = A) {
    const base = scene()
    let state = withSpyAndTech(base.state, 'Writing')
    const spyId = state.spyId
    let working = state.state
    const ids: Record<string, string> = {}
    for (const [key, name, owner] of [['tv', 'Primetime TV', A], ['twain', 'Mark Twain', twainOwner], ['joust', 'Jousting Tourney', C], ['king', 'Dr. Martin Luther King', A]] as const) {
      const given = withCardInHand(working, name, owner)
      working = given.state
      ids[key] = given.itemId
    }
    const current = devote(working, base.cityId)
    const done = unwrap(run(current, working, B, 'cancel', { logId: logOf(current, 'target'), tech: 'Writing', payment: payment(spyId) }))
    return { before: current, done, ids, spyId, cityId: base.cityId, working }
  }
  const counterWith = (s: ReturnType<typeof cancelled>, owner: string, cmd: Omit<CancellationCommand, 'logId'>) =>
    run(s.done, s.before, owner, 'counter', { logId: 'cancellation:cancel', ...cmd })

  it('Primetime TV counters it: the city action stands again, the Spy and Primetime TV are both spent', () => {
    const s = cancelled()
    const back = unwrap(counterWith(s, A, { itemId: s.ids['tv'] ?? '' }))
    // Back to the game before the cancellation: the city action is in force again
    expect(back.assistedActions.map((r) => r.status)).toEqual(['applied'])
    expect(player(back).stats).toEqual(player(s.before).stats)
    expect(discarded(back, s.spyId)).toBe(true)
    expect(discarded(back, s.ids['tv'] ?? '')).toBe(true)
    expect(used(back, B, 'Writing')).toBe(true)
    expect(back.cancellations?.events.map((e) => e.kind)).toEqual(['cancel', 'counter'])
    expect(back.log.at(-1)?.publicLog).toContain('cancelled the cancellation')
    expect(back.log.at(-1)?.publicLog).toContain('with Primetime TV')
  })

  it("another player's Twain counters it, but never its own player's", () => {
    const s = cancelled()
    const back = unwrap(counterWith(s, A, { itemId: s.ids['twain'] ?? '' }))
    expect(discarded(back, s.spyId)).toBe(true)
    expect(discarded(back, s.ids['twain'] ?? '')).toBe(true)
    // B holds Twain and Writing: B cannot counter B's own Writing event with Twain
    const own = cancelled(B)
    expect(refusal(counterWith(own, B, { itemId: own.ids['twain'] ?? '' }))).toContain('The printed card text does not permit this target.')
  })

  it('Jousting Tourney cannot, Writing is not a culture event', () => {
    const s = cancelled()
    expect(refusal(counterWith(s, C, { itemId: s.ids['joust'] ?? '' }))).toContain('The printed card text does not permit this target.')
  })

  it('Writing and Bread and Circuses cannot counter it either', () => {
    const base = scene()
    const writing = withSpyAndTech(base.state, 'Writing')
    const own = withSpyAndTech(writing.state, 'Writing', A)
    const bread = withCardInHand(own.state, 'Bread and Circuses', A)
    const current = devote(bread.state, base.cityId)
    const first = unwrap(run(current, bread.state, B, 'cancel', { logId: logOf(current, 'target'), tech: 'Writing', payment: payment(writing.spyId) }))
    const counter = (cmd: Omit<CancellationCommand, 'logId'>) => run(first, current, A, 'counter', { logId: 'cancellation:cancel', ...cmd })
    expect(refusal(counter({ tech: 'Writing', payment: payment(own.spyId) }))).toContain('The printed card text does not permit this target.')
    expect(refusal(counter({ itemId: bread.itemId }))).toContain('The printed card text does not permit this target.')
  })

  it('Mass Media counters it, Civil Service and Writing do not', () => {
    const base = scene()
    const writing = withSpyAndTech(base.state, 'Writing')
    const mass = withSpyAndTech(withTech(writing.state, 'Civil Service', A), 'Mass Media', A)
    const civil = withHutInHand(mass.state, 'Spy', A)
    const current = devote(civil.state, base.cityId)
    const first = unwrap(run(current, civil.state, B, 'cancel', { logId: logOf(current, 'target'), tech: 'Writing', payment: payment(writing.spyId) }))
    const attempt = (tech: string, spy: string) => run(first, current, A, 'counter', { logId: 'cancellation:cancel', tech, payment: payment(spy) })
    expect(refusal(attempt('Civil Service', civil.hutId))).toContain('The printed card text does not permit this target.')
    const back = unwrap(attempt('Mass Media', mass.spyId))
    expect(discarded(back, mass.spyId)).toBe(true)
    expect(discarded(back, writing.spyId)).toBe(true)
    expect(used(back, A, 'Mass Media')).toBe(true)
    expect(back.cancellations?.events.at(-1)).toMatchObject({ kind: 'counter', tech: 'Mass Media' })
  })

  it('King protects his holder: the action stands, the Spy is not lost and King is revealed', () => {
    const s = cancelled()
    const back = unwrap(counterWith(s, A, { itemId: s.ids['king'] ?? '' }))
    expect(discarded(back, s.spyId)).toBe(false)
    expect(spyOf(back, B)).toBeDefined()
    expect(used(back, B, 'Writing')).toBe(false)
    expect(player(back).items.find((item) => item.id === s.ids['king'])?.hidden).toBe(false)
    expect(back.cancellations?.events.at(-1)).toMatchObject({ kind: 'protect' })
  })
})

describe('Civil Service counters a culture cancellation', () => {
  it('stops the event of Jousting Tourney, which is itself a culture event', () => {
    const base = scene()
    let working = withTech(base.state, 'Civil Service', C)
    const spy = withHutInHand(working, 'Spy', C)
    working = spy.state
    const event = withCardInHand(working, 'Supply Drop', A)
    const joust = withCardInHand(event.state, 'Jousting Tourney', B)
    const current = playCard(joust.state, A, event.itemId, 'target')
    const first = unwrap(run(current, joust.state, B, 'cancel', { logId: logOf(current, 'target'), itemId: joust.itemId }))
    const back = unwrap(run(first, current, C, 'counter', { logId: 'cancellation:cancel', tech: 'Civil Service', payment: payment(spy.hutId) }))
    // Back to the game before the Jousting cancellation: the culture event is in force again
    expect(back.assistedActions.map((r) => r.status)).toEqual(['applied'])
    expect(discarded(back, spy.hutId)).toBe(true)
    expect(discarded(back, joust.itemId)).toBe(true)
    expect(used(back, C, 'Civil Service')).toBe(true)
  })
})

describe('which Spies can pay a cancel', () => {
  it('lists the tech neither in the view nor as a ready button without a Spy item', () => {
    const base = scene()
    const tech = withTech(base.state, 'Writing', B)
    expect(toPlayerView(tech, B).cancellations?.techCancels).toEqual([])
    expect(availableActionsFor(tech, B).find((entry) => entry.action === 'writing')).toMatchObject({ status: 'needs-resource' })
  })

  it('lists the ids of the Spies that can still pay, so a stale pick is seen', () => {
    const base = scene()
    const { state, spyId } = withSpyAndTech(base.state, 'Writing')
    expect(toPlayerView(state, B).cancellations?.techCancels).toMatchObject([{ tech: 'Writing', spies: [spyId] }])
    expect(availableActionsFor(state, B).find((entry) => entry.action === 'writing')?.payment?.options).toMatchObject([{ choice: { kind: 'hut', id: spyId } }])
  })
})

describe('what the viewer is shown', () => {
  it('lists the tech with its targets only for a player who can use it, and nothing about anybody else', () => {
    const base = scene()
    const { state: baseline } = withSpyAndTech(base.state, 'Writing')
    const current = devote(baseline, base.cityId)
    const mine = toPlayerView(current, B).cancellations?.techCancels
    expect(mine).toMatchObject([{ tech: 'Writing', targets: [{ logId: logOf(current, 'target'), blocked: null }] }])
    expect(toPlayerView(current, A).cancellations?.techCancels).toEqual([])
    expect(toPlayerView(base.state, B).cancellations?.techCancels).toEqual([])
    const text = JSON.stringify(toPlayerView(current, C).cancellations)
    expect(text).not.toContain('payment')
    expect(text).not.toContain('Spy')
  })
})
