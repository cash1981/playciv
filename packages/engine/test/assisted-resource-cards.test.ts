/**
 * A culture card played as a resource (human, 2026-11-13): when the player has no token, A Gift from Afar,
 * A Generous Gift or A Princely Gift in the hand pays the resource and is discarded, in every resource ability.
 */

import { describe, expect, it } from 'vitest'

import { chooseTech, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { assistedAvailability, availableActionsFor, performAssistedAction } from '../src/assisted.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { toPlayerView, withPlayer } from '../src/state.js'
import type { AssistedActionKind, GameState } from '../src/state.js'

import { player, withCardInHand, withHutInHand, withPieceInArea } from './assisted-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'
import { sotTurn } from './sot-fixture.js'

const AT = '2026-11-13T12:00:00.000Z'

const withTech = (state: GameState, techName: string): GameState =>
  unwrap(revealTech(unwrap(chooseTech(state, { playerId: CASH1981, techName })), { playerId: CASH1981, techName }))

const upTo = (state: GameState, phase: 'TRADE' | 'CM'): GameState =>
  unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: phase }))

const press = (state: GameState, action: AssistedActionKind, payload?: Record<string, unknown>, requestId = 'req-1') =>
  performAssistedAction(state, { playerId: CASH1981, action, requestId, at: AT, ...(payload === undefined ? {} : { payload: payload as never }) })

const voted = (state: GameState, requestId: string): GameState => {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line for the action')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of [KARANDRAS1, ITCHI, CHUL]) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  return next
}

const inHand = (state: GameState, name: string): boolean =>
  player(state).items.some((item) => 'name' in item && item.name === name)
const inDiscard = (state: GameState, name: string): boolean =>
  state.discardedItems.some((item) => 'name' in item && item.name === name)
const handHut = (state: GameState, name: string): boolean =>
  player(state).items.some((item) => item.kind === 'hut' && item.name === name && !item.used)

const GENEROUS = 'A Generous Gift'
const PRINCELY = 'A Princely Gift'
const AFAR = 'A Gift from Afar'
const card = (state: GameState, name: string): GameState => withCardInHand(state, name).state

const movementTurn = (tech: string): GameState => upTo(withTech(firstCivGame(), tech), 'CM')
const cmTurn = (tech: string): GameState => upTo(withTech(firstCivGame(), tech), 'TRADE')

describe('a culture card pays a resource when there is no token', () => {
  it('Communism pays its Spy with A Generous Gift, names the card in the public line and discards it', () => {
    const state = card(movementTurn('Communism'), GENEROUS)
    expect(assistedAvailability(state, CASH1981, 'communism').status).toBe('ready')
    const used = unwrap(press(state, 'communism', { square: { column: 3, row: 3 } }))
    expect(inHand(used, GENEROUS)).toBe(false)
    expect(inDiscard(used, GENEROUS)).toBe(true)
    expect(used.log.at(-1)?.publicLog).toMatch(/used Communism: played A Generous Gift item number #\d+ as Spy and locked/)
    expect(used.assistedActions.at(-1)?.effect).toMatchObject({ kind: 'communism', spent: { kind: 'card', resource: 'Spy' } })
  })

  it('Steam Power and Gunpowder are ready with a card, with a warning naming the card', () => {
    const steam = card(cmTurn('Steam Power'), GENEROUS)
    expect(assistedAvailability(steam, CASH1981, 'steamPower')).toMatchObject({ status: 'ready', warning: expect.stringContaining(GENEROUS) })
    const gunpowder = card(card(cmTurn('Gunpowder'), AFAR), PRINCELY)
    expect(assistedAvailability(gunpowder, CASH1981, 'gunpowder')).toMatchObject({
      status: 'ready',
      warning: expect.stringContaining(PRINCELY),
    })
  })

  it('Ecology pays its Wheat with a card, names it, and gives it back on undo', () => {
    const state = card(sotTurn({ techs: ['Ecology'] }), GENEROUS)
    expect(assistedAvailability(state, CASH1981, 'sot:ecology')).toMatchObject({ status: 'ready', warning: expect.stringContaining(GENEROUS) })
    const used = unwrap(press(state, 'sot:ecology'))
    expect(used.log.at(-1)?.publicLog).toMatch(/used Ecology: played A Generous Gift item number #\d+ as Wheat to change an empty/)
    expect(inDiscard(used, GENEROUS)).toBe(true)
    const undone = voted(used, 'req-1')
    expect(inHand(undone, GENEROUS)).toBe(true)
    expect(inDiscard(undone, GENEROUS)).toBe(false)
  })

  it('Currency-style Incense abilities are not paid by a card: no card can be played as Incense', () => {
    const state = card(card(card(cmTurn('Chivalry'), GENEROUS), PRINCELY), AFAR)
    expect(assistedAvailability(state, CASH1981, 'chivalry').status).toBe('needs-resource')
  })

  it('a card that cannot be played as the resource does not pay it', () => {
    // No card allows Incense, and an ordinary culture card allows nothing
    const other = card(movementTurn('Communism'), 'Migrants')
    expect(assistedAvailability(other, CASH1981, 'communism')).toMatchObject({ status: 'needs-resource' })
    expect(unwrapErr(press(other, 'communism', { square: { column: 3, row: 3 } })).kind).toBe('ASSISTED_ACTION_REJECTED')
    expect(inHand(other, 'Migrants')).toBe(true)
    // The refusal does not mention a card for Incense, which none can be
    const incense = assistedAvailability(cmTurn('Chivalry'), CASH1981, 'chivalry')
    expect(incense.reason).not.toContain('culture card')
    expect(incense.reason).toContain('an Incense token')
    expect(assistedAvailability(other, CASH1981, 'communism').reason).toContain('culture card')
  })

  it('a card that is still a candidate of a pending reward is not the player\'s and pays nothing', () => {
    const { state: drawn, itemId } = withCardInHand(sotTurn({ techs: ['Ecology'] }), GENEROUS)
    const waiting = withPlayer(drawn, {
      ...player(drawn),
      pendingRewards: [{ id: 'req-patronage', kind: 'event', level: 1, step: 3, candidateIds: [itemId], keep: 1 }] as never,
    })
    expect(assistedAvailability(waiting, CASH1981, 'sot:ecology').status).toBe('needs-resource')
    expect(unwrapErr(press(waiting, 'sot:ecology')).kind).toBe('ASSISTED_ACTION_REJECTED')
    expect(inHand(waiting, GENEROUS)).toBe(true)
    // The same hand without the pending choice pays with it
    expect(assistedAvailability(drawn, CASH1981, 'sot:ecology').status).toBe('ready')
    // A held card of the same kind next to the candidates still pays
    const another = withCardInHand(waiting, GENEROUS)
    expect(another.itemId).not.toBe(itemId)
    expect(assistedAvailability(another.state, CASH1981, 'sot:ecology').status).toBe('ready')
  })

  it('A Gift from Afar pays but says its coin token goes to another player by hand, in the warning and the log; the others do not', () => {
    const afar = card(movementTurn('Communism'), AFAR)
    const warning = (state: GameState) => (assistedAvailability(state, CASH1981, 'communism') as { warning?: string }).warning
    expect(warning(afar)).toContain('another player of your choice also gets a coin token: give it by hand')
    const used = unwrap(press(afar, 'communism', { square: { column: 3, row: 3 } }))
    expect(used.log.at(-1)?.publicLog).toMatch(/played A Gift from Afar item number #\d+ as Spy \(another player of your choice also gets a coin token: give it by hand\)/)
    expect(inDiscard(used, AFAR)).toBe(true)
    for (const name of [GENEROUS, PRINCELY]) {
      const state = card(movementTurn('Communism'), name)
      expect(warning(state)).not.toContain('coin token')
      expect(unwrap(press(state, 'communism', { square: { column: 3, row: 3 } })).log.at(-1)?.publicLog).not.toContain('coin token')
    }
    // Gunpowder says it too
    const gunpowder = card(card(cmTurn('Gunpowder'), AFAR), GENEROUS)
    expect((assistedAvailability(gunpowder, CASH1981, 'gunpowder') as { warning?: string }).warning).toContain('give it by hand')
    expect(unwrap(press(gunpowder, 'gunpowder', { resources: ['Iron', 'Wheat'] })).log.at(-1)?.publicLog).toContain('give it by hand')
  })

  it('the card with the fewest allowed resources is played first, so A Princely Gift is kept for last', () => {
    // Princely first in hand, Generous second: Spy is paid by Generous
    const state = card(card(movementTurn('Communism'), PRINCELY), GENEROUS)
    expect(player(state).items.findIndex((item) => 'name' in item && item.name === PRINCELY)).toBeLessThan(
      player(state).items.findIndex((item) => 'name' in item && item.name === GENEROUS),
    )
    const used = unwrap(press(state, 'communism', { square: { column: 3, row: 3 } }))
    expect(inDiscard(used, GENEROUS)).toBe(true)
    expect(inHand(used, PRINCELY)).toBe(true)
  })

  it('a token is preferred over a card, and the card stays in the hand with no warning', () => {
    const state = card(withHutInHand(movementTurn('Communism'), 'Spy').state, GENEROUS)
    expect(assistedAvailability(state, CASH1981, 'communism')).not.toHaveProperty('warning')
    const used = unwrap(press(state, 'communism', { square: { column: 3, row: 3 } }))
    expect(handHut(used, 'Spy')).toBe(false)
    expect(inHand(used, GENEROUS)).toBe(true)
    expect(used.log.at(-1)?.publicLog).toContain('spent 1 Spy and locked')
    // A piece in the player area also comes before a card
    const withPiece = card(withPieceInArea(cmTurn('Steam Power'), 'resources/silk').state, GENEROUS)
    expect(availableActionsFor(withPiece, CASH1981).find((entry) => entry.action === 'steamPower')).not.toHaveProperty('warning')
  })

  it('the warning and the card name reach only the owner: nothing about the hand is in an opponent view', () => {
    const state = card(movementTurn('Communism'), GENEROUS)
    const mine = availableActionsFor(state, CASH1981).find((entry) => entry.action === 'communism')
    expect(mine).toMatchObject({ status: 'ready', warning: expect.stringContaining(GENEROUS) })
    expect(JSON.stringify(toPlayerView(state, KARANDRAS1))).not.toContain(GENEROUS)
    // Once played the card is open information in the public log, and only there
    const used = unwrap(press(state, 'communism', { square: { column: 3, row: 3 } }))
    const publicView = JSON.stringify(toPlayerView(used, KARANDRAS1))
    expect(publicView).toContain(GENEROUS)
    expect(publicView).not.toContain('"effect"')
  })

  it('an undo returns the card to the hand and takes it out of the discard pile', () => {
    const state = card(movementTurn('Communism'), GENEROUS)
    const used = unwrap(press(state, 'communism', { square: { column: 3, row: 3 } }))
    const undone = voted(used, 'req-1')
    expect(inHand(undone, GENEROUS)).toBe(true)
    expect(inDiscard(undone, GENEROUS)).toBe(false)
    expect(undone.discardedItems).toHaveLength(state.discardedItems.length)
    expect(undone.log.at(-1)?.publicLog).toContain('the card played as Spy returned')
  })

  it('Marie Curie: an armed substitute replaces a real Uranium token as before, and the arm is used up', () => {
    // Uranium is named; the armed Iron is what is paid, from the Iron token
    const base = withHutInHand(withHutInHand(card(cmTurn('Gunpowder'), GENEROUS), 'Iron').state, 'Wheat').state
    const state = withPlayer(base, { ...player(base), curieSubstitute: 'Iron' })
    const used = unwrap(press(state, 'gunpowder', { resources: ['Uranium', 'Wheat'] }))
    expect(used.assistedActions.at(-1)?.effect).toMatchObject({ spent: [{ kind: 'hut', resource: 'Iron' }, { kind: 'hut', resource: 'Wheat' }] })
    expect(inHand(used, GENEROUS)).toBe(true)
    expect(player(used).curieSubstitute).toBeNull()
    expect(player(voted(used, 'req-1')).curieSubstitute).toBe('Iron')
  })
})

describe('Gunpowder pays each of its two resources token first, else a card, never the same card twice', () => {
  const gunpowder = (state: GameState, resources: readonly string[], requestId = 'req-1') =>
    press(state, 'gunpowder', { resources }, requestId)

  it('one token and one card', () => {
    const state = card(withHutInHand(cmTurn('Gunpowder'), 'Iron').state, GENEROUS)
    const availability = assistedAvailability(state, CASH1981, 'gunpowder')
    expect(availability).toMatchObject({ status: 'ready', warning: expect.stringContaining(GENEROUS) })
    const paid = unwrap(gunpowder(state, ['Iron', 'Wheat']))
    expect(handHut(paid, 'Iron')).toBe(false)
    expect(inDiscard(paid, GENEROUS)).toBe(true)
    expect(paid.log.at(-1)?.publicLog).toMatch(/used Gunpowder: spent Iron and played A Generous Gift item number #\d+ as Iron\. /)
  })

  it('two cards', () => {
    const state = card(card(cmTurn('Gunpowder'), GENEROUS), PRINCELY)
    expect(assistedAvailability(state, CASH1981, 'gunpowder')).toMatchObject({ status: 'ready', warning: expect.stringContaining(' and ') })
    const paid = unwrap(gunpowder(state, ['Iron', 'Wheat']))
    expect(inDiscard(paid, GENEROUS)).toBe(true)
    expect(inDiscard(paid, PRINCELY)).toBe(true)
    expect(paid.log.at(-1)?.publicLog).toMatch(/played A Generous Gift item number #\d+ as Iron and played A Princely Gift item number #\d+ as Iron/)
  })

  it('names are a preference: other tokens pay before any card is played', () => {
    // Silk hut, Wheat hut and a Generous Gift; Iron and Wheat named
    const state = card(withHutInHand(withHutInHand(cmTurn('Gunpowder'), 'Silk').state, 'Wheat').state, GENEROUS)
    expect(assistedAvailability(state, CASH1981, 'gunpowder')).not.toHaveProperty('warning')
    const paid = unwrap(gunpowder(state, ['Iron', 'Wheat']))
    expect(handHut(paid, 'Silk')).toBe(false)
    expect(handHut(paid, 'Wheat')).toBe(false)
    expect(inHand(paid, GENEROUS)).toBe(true)
    expect(paid.log.at(-1)?.publicLog).toContain('used Gunpowder: spent Silk and Wheat. ')
    const undone = voted(paid, 'req-1')
    expect(handHut(undone, 'Silk')).toBe(true)
    expect(handHut(undone, 'Wheat')).toBe(true)
    expect(inHand(undone, GENEROUS)).toBe(true)
  })

  it('a piece in the player area is a token too, so it is used before a card', () => {
    const state = card(withHutInHand(withPieceInArea(cmTurn('Gunpowder'), 'resources/incense').state, 'Wheat').state, GENEROUS)
    const paid = unwrap(gunpowder(state, ['Iron', 'Silk']))
    expect(paid.board.pieces.some((piece) => piece.assetId === 'resources/incense')).toBe(false)
    expect(handHut(paid, 'Wheat')).toBe(false)
    expect(inHand(paid, GENEROUS)).toBe(true)
  })

  it('the names do not steer which card is played: the warning names exactly the cards that are played', () => {
    // Iron hut, A Generous Gift and A Princely Gift; Wheat and Uranium named. Uranium does not pull Princely in
    const state = card(card(withHutInHand(cmTurn('Gunpowder'), 'Iron').state, GENEROUS), PRINCELY)
    const warning = (assistedAvailability(state, CASH1981, 'gunpowder') as { warning?: string }).warning ?? ''
    expect(warning).toContain(GENEROUS)
    expect(warning).not.toContain(PRINCELY)
    const paid = unwrap(gunpowder(state, ['Wheat', 'Uranium']))
    expect(handHut(paid, 'Iron')).toBe(false)
    expect(inDiscard(paid, GENEROUS)).toBe(true)
    expect(inHand(paid, PRINCELY)).toBe(true)

    // No tokens, A Gift from Afar, A Generous Gift and A Princely Gift; Uranium and Iron named
    const bare = card(card(card(cmTurn('Gunpowder'), AFAR), GENEROUS), PRINCELY)
    const bareWarning = (assistedAvailability(bare, CASH1981, 'gunpowder') as { warning?: string }).warning ?? ''
    const playedBare = unwrap(gunpowder(bare, ['Uranium', 'Iron']))
    for (const name of [AFAR, GENEROUS]) {
      expect(bareWarning).toContain(name)
      expect(inDiscard(playedBare, name)).toBe(true)
    }
    expect(bareWarning).not.toContain(PRINCELY)
    expect(inHand(playedBare, PRINCELY)).toBe(true)
  })

  it('never plays one card for both resources, so a single card is not enough', () => {
    const state = card(cmTurn('Gunpowder'), PRINCELY)
    expect(assistedAvailability(state, CASH1981, 'gunpowder').status).toBe('needs-resource')
    expect(unwrapErr(gunpowder(state, ['Iron', 'Wheat'])).kind).toBe('ASSISTED_ACTION_REJECTED')
    expect(inHand(state, PRINCELY)).toBe(true)
  })

  it('tokens are used before any card is, across both resources', () => {
    const state = card(withHutInHand(withHutInHand(cmTurn('Gunpowder'), 'Silk').state, 'Wheat').state, GENEROUS)
    expect(assistedAvailability(state, CASH1981, 'gunpowder')).not.toHaveProperty('warning')
    const paid = unwrap(gunpowder(state, ['Silk', 'Wheat']))
    expect(inHand(paid, GENEROUS)).toBe(true)
  })

  it('an undo returns exactly the card and the tokens that were spent', () => {
    const { state: base } = withPieceInArea(cmTurn('Gunpowder'), 'resources/iron')
    const state = card(base, GENEROUS)
    const before = {
      hand: player(state).items.map((item) => item.id).sort(),
      discard: state.discardedItems.map((item) => item.id).sort(),
      pieces: state.board.pieces.map((piece) => piece.id).sort(),
    }
    const paid = unwrap(gunpowder(state, ['Iron', 'Silk']))
    expect(paid.board.pieces.some((piece) => piece.assetId === 'resources/iron')).toBe(false)
    expect(inDiscard(paid, GENEROUS)).toBe(true)
    const undone = voted(paid, 'req-1')
    expect({
      hand: player(undone).items.map((item) => item.id).sort(),
      discard: undone.discardedItems.map((item) => item.id).sort(),
      pieces: undone.board.pieces.map((piece) => piece.id).sort(),
    }).toEqual(before)
    expect(player(undone).playerTurns.at(-1)?.usedActions).not.toContain('card:Gunpowder')
  })
})
