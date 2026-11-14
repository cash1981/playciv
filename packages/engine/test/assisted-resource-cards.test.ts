/**
 * A culture card played as a resource (human, 2026-11-13): when the player has no token, A Gift from Afar,
 * A Generous Gift or A Princely Gift in the hand pays the resource and is discarded, in every resource ability.
 */

import { describe, expect, it } from 'vitest'

import { placePiece } from '../src/actions/board.js'
import { SQUARE_SIZE, findBoardAsset, mapTop } from '../src/board.js'
import { chooseTech, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { assistedAvailability, availableActionsFor, performAssistedAction, resourceCostOf } from '../src/assisted.js'
import type { AssistedPayload } from '../src/assisted-core.js'
import { ANY_RESOURCES, spendChosenResources } from '../src/assisted-resources.js'
import type { ResourcePaymentChoice } from '../src/assisted-resources.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { toPlayerView, withPlayer } from '../src/state.js'
import type { AssistedActionKind, GameState } from '../src/state.js'

import { player, resourcePattern, resourceText, withCardInHand, withHutInHand, withPieceInArea } from './assisted-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'
import { sotTurn } from './sot-fixture.js'

const AT = '2026-11-13T12:00:00.000Z'

const withTech = (state: GameState, techName: string): GameState =>
  unwrap(revealTech(unwrap(chooseTech(state, { playerId: CASH1981, techName })), { playerId: CASH1981, techName }))

const upTo = (state: GameState, phase: 'TRADE' | 'CM'): GameState =>
  unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: phase }))


/**
 * Gunpowder now does something: it obsoletes a wonder or destroys a building (issue #327). These tests are about how it is paid,
 * so the turn has one building on the map to destroy and a payload that names only the resources destroys it.
 */
const withLibrary = (state: GameState): GameState => {
  const asset = findBoardAsset('buildings/library')
  if (asset === undefined) throw new Error('no library asset')
  return unwrap(placePiece(state, { playerId: CASH1981, assetId: 'buildings/library', x: 4 * SQUARE_SIZE + 10, y: mapTop(state.board) + 4 * SQUARE_SIZE + 10 }))
}
const withTarget = (state: GameState, action: string, payload?: AssistedPayload): AssistedPayload | undefined => {
  if (action !== 'gunpowder' || payload === undefined || 'mode' in payload) return payload
  const building = state.board.pieces.find((piece) => piece.category === 'building')
  if (building === undefined) throw new Error('no target building')
  return { ...payload, mode: 'destroy', buildingPieceId: building.id }
}

const press = (state: GameState, action: AssistedActionKind, payload?: AssistedPayload, requestId = 'req-1') => {
  const sent = withTarget(state, action, payload)
  return performAssistedAction(state, { playerId: CASH1981, action, requestId, at: AT, ...(sent === undefined ? {} : { payload: sent }) })
}

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

const NO_WONDER_WARNING = 'No ancient or medieval wonder is owned by a player, so there is none to obsolete.'
const GENEROUS = 'A Generous Gift'
const PRINCELY = 'A Princely Gift'
const AFAR = 'A Gift from Afar'
const card = (state: GameState, name: string): GameState => withCardInHand(state, name).state

const movementTurn = (tech: string): GameState => upTo(withTech(firstCivGame(), tech), 'CM')
const cmTurn = (tech: string): GameState => upTo(withTech(tech === 'Gunpowder' ? withLibrary(firstCivGame()) : firstCivGame(), tech), 'TRADE')

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
      pendingRewards: [{ id: 'req-patronage', kind: 'event', level: 1, step: 3, candidateIds: [itemId], keep: 1 }],
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

  describe('explicit resource payment choices', () => {
    const paymentOf = (state: GameState, action: AssistedActionKind) => {
      const payment = availableActionsFor(state, CASH1981).find((entry) => entry.action === action)?.payment
      if (payment === undefined) throw new Error(`no payment metadata for ${action}`)
      return payment
    }
    const choice = (resource: string, kind: ResourcePaymentChoice['kind'], id: string): ResourcePaymentChoice => ({ resource, kind, id })

    it('every resource-paying action declares its fixed, Any or each cost', () => {
      const fixed: Readonly<Record<string, readonly string[]>> = {
        Incense: ['chivalry', 'currency', 'metalCasting'],
        Wheat: ['animalHusbandry', 'construction', 'banking', 'plastics', 'sot:ecology'],
        Silk: ['horsebackRiding', 'monarchy', 'steamPower'],
        Spy: ['mysticism', 'writing', 'civilService', 'massMedia', 'communism'],
        Iron: ['mathematics', 'ballistics', 'metalworking'],
        Uranium: ['atomicTheory'],
      }
      for (const [resource, actions] of Object.entries(fixed)) {
        for (const action of actions) expect(resourceCostOf(action), action).toEqual([resource])
      }
      expect(resourceCostOf('gunpowder')).toEqual([null, null])
      expect(resourceCostOf('pottery')).toEqual([null, null])
      expect(resourceCostOf('philosophy')).toEqual([null, null, null])
      expect(resourceCostOf('education')).toEqual(['Incense', 'Iron', 'Silk', 'Wheat'])
      expect(resourceCostOf('bureaucracy')).toBeUndefined()
      expect(resourceCostOf('cultureAdvance')).toBeUndefined()
    })

    it('consumes exactly the selected culture card despite holding tokens and another eligible card, and undo returns its ID', () => {
      const hut = withHutInHand(sotTurn({ techs: ['Ecology'] }), 'Wheat')
      const first = withCardInHand(hut.state, GENEROUS)
      const chosen = withCardInHand(first.state, GENEROUS)
      const state = chosen.state
      expect(paymentOf(state, 'sot:ecology')).toMatchObject({
        cost: ['Wheat'],
        options: expect.arrayContaining([
          { choice: choice('Wheat', 'hut', hut.hutId), label: 'Wheat (hand)' },
          { choice: choice('Wheat', 'card', chosen.itemId), label: 'A Generous Gift (as Wheat)' },
        ]),
      })
      const snapshot = JSON.stringify(state)
      const used = unwrap(press(state, 'sot:ecology', { payments: [choice('Wheat', 'card', chosen.itemId)] }))
      expect(JSON.stringify(state)).toBe(snapshot)
      expect(player(used).items.some((item) => item.id === hut.hutId)).toBe(true)
      expect(player(used).items.some((item) => item.id === first.itemId)).toBe(true)
      expect(used.discardedItems.some((item) => item.id === chosen.itemId)).toBe(true)
      expect(used.assistedActions.at(-1)?.effect).toMatchObject({ spent: { kind: 'card', resource: 'Wheat', itemId: chosen.itemId } })
      expect(used.log.at(-1)?.publicLog).toMatch(/played A Generous Gift item number #\d+ as Wheat/)
      const undone = voted(used, 'req-1')
      expect(player(undone).items.map((item) => item.id).sort()).toEqual(player(state).items.map((item) => item.id).sort())
      expect(undone.discardedItems).toEqual(state.discardedItems)
    })

    it('lets a fixed Incense ability choose a specific player-area piece instead of a held hut', () => {
      const hut = withHutInHand(cmTurn('Currency'), 'Incense')
      const first = withPieceInArea(hut.state, 'resources/incense')
      const second = withPieceInArea(first.state, 'resources/incense')
      expect(paymentOf(second.state, 'currency').options).toContainEqual({
        choice: choice('Incense', 'piece', second.piece.id), label: 'Incense (player area)',
      })
      const used = unwrap(press(second.state, 'currency', { payments: [choice('Incense', 'piece', second.piece.id)] }))
      expect(player(used).items.some((item) => item.id === hut.hutId)).toBe(true)
      expect(used.board.pieces).toContainEqual(first.piece)
      expect(used.board.pieces.some((piece) => piece.id === second.piece.id)).toBe(false)
      expect(voted(used, 'req-1').board.pieces).toContainEqual(second.piece)
    })

    it('Any costs honor chosen resources and cards, rather than the legacy token-first preference list', () => {
      const iron = withHutInHand(cmTurn('Pottery'), 'Iron')
      const wheat = withHutInHand(iron.state, 'Wheat')
      const gift = withCardInHand(wheat.state, GENEROUS)
      const used = unwrap(press(gift.state, 'pottery', {
        resources: ['Iron', 'Iron'],
        payments: [choice('Silk', 'card', gift.itemId), choice('Wheat', 'hut', wheat.hutId)],
      }))
      expect(used.assistedActions.at(-1)?.effect).toMatchObject({
        spent: [{ kind: 'card', resource: 'Silk', itemId: gift.itemId }, { kind: 'hut', resource: 'Wheat', itemId: wheat.hutId }],
      })
      expect(player(used).items.some((item) => item.id === iron.hutId)).toBe(true)
      expect(player(voted(used, 'req-1')).items.map((item) => item.id).sort()).toEqual(player(gift.state).items.map((item) => item.id).sort())
    })

    it('Education pays its ordered each-resource slots with the exact selected tokens and separate cards', () => {
      const incense = withHutInHand(cmTurn('Education'), 'Incense')
      const iron = withHutInHand(incense.state, 'Iron')
      const silk = withPieceInArea(iron.state, 'resources/silk')
      const first = withCardInHand(silk.state, GENEROUS)
      const second = withCardInHand(first.state, GENEROUS)
      const payments = [choice('Incense', 'hut', incense.hutId), choice('Iron', 'card', first.itemId), choice('Silk', 'piece', silk.piece.id), choice('Wheat', 'card', second.itemId)]
      const used = unwrap(press(second.state, 'education', { payments }))
      expect(used.assistedActions.at(-1)?.effect).toMatchObject({
        spent: [{ itemId: incense.hutId }, { itemId: first.itemId }, { piece: { id: silk.piece.id } }, { itemId: second.itemId }],
      })
      expect(player(used).items.some((item) => item.id === iron.hutId)).toBe(true)
      expect(player(used).techGrants).toMatchObject([{ source: 'Education', phase: 'CM' }])
      const undone = voted(used, 'req-1')
      expect(undone.board.pieces).toContainEqual(silk.piece)
      expect(player(undone).items.map((item) => item.id).sort()).toEqual(player(second.state).items.map((item) => item.id).sort())
      const swapped = [payments[1], payments[0], payments[2], payments[3]].filter((entry): entry is ResourcePaymentChoice => entry !== undefined)
      expect(press(second.state, 'education', { payments: swapped }).ok).toBe(false)
    })

    it('rejects bad counts, duplicate physical IDs, wrong resources and unsupported payments without changing anything', () => {
      const hut = withHutInHand(card(cmTurn('Pottery'), GENEROUS), 'Iron')
      const giftId = player(hut.state).items.find((item) => 'name' in item && item.name === GENEROUS)?.id
      if (giftId === undefined) throw new Error('no gift')
      const iron = choice('Iron', 'hut', hut.hutId)
      const gift = choice('Wheat', 'card', giftId)
      const snapshot = JSON.stringify(hut.state)
      for (const payments of [
        [], [iron], [iron, gift, gift],
        [iron, iron],
        [choice('Iron', 'card', giftId), gift],
        [iron, choice('Wheat', 'card', hut.hutId)],
        [iron, choice('Banana', 'card', giftId)],
      ]) {
        expect(press(hut.state, 'pottery', { resources: ['Iron', 'Wheat'], payments }).ok, JSON.stringify(payments)).toBe(false)
        expect(JSON.stringify(hut.state)).toBe(snapshot)
      }
      const ecology = card(sotTurn({ techs: ['Ecology'] }), GENEROUS)
      expect(press(ecology, 'sot:ecology', { payments: [choice('Iron', 'card', giftId)] }).ok).toBe(false)
      expect(press(ecology, 'cultureAdvance', { payments: [] }).ok).toBe(false)
    })

    it('offers only unused, owned, nonpending hand items and pieces in the own player area, and refuses excluded IDs', () => {
      const held = withHutInHand(cmTurn('Pottery'), 'Wheat')
      const usedHut = withHutInHand(held.state, 'Iron')
      const ownPiece = withPieceInArea(usedHut.state, 'resources/silk')
      const foreignPiece = withPieceInArea(ownPiece.state, 'resources/iron', KARANDRAS1)
      const foreignCard = withCardInHand(foreignPiece.state, GENEROUS, KARANDRAS1)
      const gift = withCardInHand(foreignCard.state, GENEROUS)
      const usedCard = withCardInHand(gift.state, AFAR)
      const pending = withCardInHand(usedCard.state, PRINCELY)
      const wrongOwner = withCardInHand(pending.state, GENEROUS)
      const mapPiece = { ...ownPiece.piece, id: 'map-resource', x: 4 * SQUARE_SIZE, y: mapTop(wrongOwner.state.board) + 4 * SQUARE_SIZE }
      const outside = { ...ownPiece.piece, id: 'outside-resource', x: -500, y: -500 }
      const base = { ...wrongOwner.state, board: { ...wrongOwner.state.board, pieces: [...wrongOwner.state.board.pieces, mapPiece, outside] } }
      const state = withPlayer(base, {
        ...player(base),
        items: player(base).items.map((item) => item.id === usedHut.hutId || item.id === usedCard.itemId ? { ...item, used: true }
          : item.id === wrongOwner.itemId ? { ...item, ownerId: KARANDRAS1 } : item),
        pendingRewards: [{ id: 'pending', kind: 'event', level: 3, step: 15, candidateIds: [pending.itemId], keep: 1 }],
      })
      const options = paymentOf(state, 'pottery').options
      expect(options.map((option) => option.choice.id)).toEqual(expect.arrayContaining([held.hutId, ownPiece.piece.id, gift.itemId]))
      expect(options.filter((option) => option.choice.id === gift.itemId).map((option) => option.choice.resource).sort()).toEqual(['Iron', 'Silk', 'Spy', 'Wheat'])
      const excluded = [
        choice('Iron', 'hut', usedHut.hutId), choice('Iron', 'piece', foreignPiece.piece.id),
        choice('Silk', 'piece', mapPiece.id), choice('Silk', 'piece', outside.id),
        choice('Iron', 'card', foreignCard.itemId), choice('Iron', 'card', usedCard.itemId),
        choice('Iron', 'card', pending.itemId), choice('Iron', 'card', wrongOwner.itemId),
      ]
      const snapshot = JSON.stringify(state)
      for (const unavailable of excluded) {
        expect(options.some((option) => option.choice.id === unavailable.id)).toBe(false)
        expect(press(state, 'pottery', { resources: ['Wheat', 'Iron'], payments: [choice('Wheat', 'hut', held.hutId), unavailable] }).ok).toBe(false)
        expect(JSON.stringify(state)).toBe(snapshot)
      }
      // Every ordinary kind is exposed for Any costs, including Spy and Uranium huts.
      let all = state
      for (const resource of ANY_RESOURCES) all = withHutInHand(all, resource).state
      expect(new Set(paymentOf(all, 'pottery').options.filter((option) => !option.usesCurie).map((option) => option.choice.resource))).toEqual(new Set(ANY_RESOURCES))
    })

    it('does not silently replace a chosen piece that moved out of the player area', () => {
      const first = withPieceInArea(cmTurn('Currency'), 'resources/incense')
      const replacement = withHutInHand(first.state, 'Incense')
      const payments = [choice('Incense', 'piece', first.piece.id)]
      const stale = { ...replacement.state, board: { ...replacement.state.board, pieces: replacement.state.board.pieces.map((piece) =>
        piece.id === first.piece.id ? { ...piece, x: -500, y: -500 } : piece) } }
      const snapshot = JSON.stringify(stale)
      expect(press(stale, 'currency', { payments }).ok).toBe(false)
      expect(JSON.stringify(stale)).toBe(snapshot)
      expect(unwrap(press(stale, 'currency')).discardedItems.some((item) => item.id === replacement.hutId)).toBe(true)
    })

    it('offers normal Uranium and Curie choices, consumes substitution once, and restores it on undo', () => {
      const first = withHutInHand(cmTurn('Gunpowder'), 'Iron')
      const second = withHutInHand(first.state, 'Iron')
      const uranium = withHutInHand(second.state, 'Uranium')
      const state = withPlayer(uranium.state, { ...player(uranium.state), curieSubstitute: 'Iron' })
      const options = paymentOf(state, 'atomicTheory').options
      expect(options).toContainEqual({ choice: choice('Uranium', 'hut', first.hutId), label: 'Iron (hand) (as Uranium)', usesCurie: true })
      expect(options).toContainEqual({ choice: choice('Uranium', 'hut', uranium.hutId), label: 'Uranium (hand)' })
      const curieChoice = choice('Uranium', 'hut', first.hutId)
      const bothAsUranium = [curieChoice, choice('Uranium', 'hut', second.hutId)]
      const snapshot = JSON.stringify(state)
      expect(spendChosenResources(state, CASH1981, [null, null], bothAsUranium).ok).toBe(false)
      expect(JSON.stringify(state)).toBe(snapshot)
      const used = unwrap(press(state, 'gunpowder', { resources: ['Uranium', 'Uranium'], payments: [curieChoice, choice('Uranium', 'hut', uranium.hutId)] }))
      expect(player(used).curieSubstitute).toBeNull()
      expect(used.assistedActions.at(-1)?.effect).toMatchObject({
        spent: [{ resource: 'Iron', itemId: first.hutId, curieSubstitute: 'Iron' }, { resource: 'Uranium', itemId: uranium.hutId }],
      })
      expect(player(voted(used, 'req-1')).curieSubstitute).toBe('Iron')
    })

    it('does not hide real Uranium from explicit payments when Curie is armed but its substitute is missing', () => {
      const uranium = withHutInHand(cmTurn('Gunpowder'), 'Uranium')
      const wheat = withHutInHand(uranium.state, 'Wheat')
      const state = withPlayer(wheat.state, { ...player(wheat.state), curieSubstitute: 'Iron' })
      expect(assistedAvailability(state, CASH1981, 'gunpowder').status).toBe('ready')
      const payments = [choice('Uranium', 'hut', uranium.hutId), choice('Wheat', 'hut', wheat.hutId)]
      expect(press(state, 'gunpowder', { resources: ['Uranium', 'Wheat'] }).ok).toBe(false)
      const used = unwrap(press(state, 'gunpowder', { resources: ['Uranium', 'Wheat'], payments }))
      expect(player(used).curieSubstitute).toBe('Iron')
      expect(used.assistedActions.at(-1)?.effect).toMatchObject({
        spent: [{ resource: 'Uranium', itemId: uranium.hutId }, { resource: 'Wheat', itemId: wheat.hutId }],
      })
      const atomic = withHutInHand(cmTurn('Atomic Theory'), 'Uranium')
      const fixed = withPlayer(atomic.state, { ...player(atomic.state), curieSubstitute: 'Iron' })
      expect(assistedAvailability(fixed, CASH1981, 'atomicTheory').status).toBe('ready')
      expect(spendChosenResources(fixed, CASH1981, ['Uranium'], [choice('Uranium', 'hut', atomic.hutId)]).ok).toBe(true)
    })
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
    expect(used.log.at(-1)?.publicLog).toContain(`spent 1 ${resourceText(state, 'Spy')} and locked`)
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
    expect(paid.log.at(-1)?.publicLog).toMatch(new RegExp(`used Gunpowder: spent ${resourcePattern(state, 'Iron')} and played A Generous Gift item number #\\d+ as Iron, destroying `))
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
    // Only the missing wonder is mentioned: no card would be played
    expect((assistedAvailability(state, CASH1981, 'gunpowder') as { warning?: string }).warning).toBe(NO_WONDER_WARNING)
    const paid = unwrap(gunpowder(state, ['Iron', 'Wheat']))
    expect(handHut(paid, 'Silk')).toBe(false)
    expect(handHut(paid, 'Wheat')).toBe(false)
    expect(inHand(paid, GENEROUS)).toBe(true)
    expect(paid.log.at(-1)?.publicLog).toContain(`used Gunpowder: spent ${resourceText(state, 'Silk')} and ${resourceText(state, 'Wheat')}, destroying `)
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
    // Only the missing wonder is mentioned: no card would be played
    expect((assistedAvailability(state, CASH1981, 'gunpowder') as { warning?: string }).warning).toBe(NO_WONDER_WARNING)
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
