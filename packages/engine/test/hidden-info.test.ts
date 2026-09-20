/**
 * Hidden information.
 *
 * Java stored the whole item on the log document and let the resource layer
 * filter it. That was the security hole noted in todo.txt ("hide the drawn item
 * in the public log"). These tests check that the projections do not leak.
 */

import { describe, expect, it } from 'vitest'

import { draw } from '../src/actions/draw.js'
import {
  chooseSocialPolicy,
  chooseTech,
  revealItem,
  revealSocialPolicy,
  revealedTechsForAllPlayers,
} from '../src/actions/player.js'
import type { CivItem } from '../src/item.js'
import { itemName, revealAll } from '../src/item.js'
import { createLogTexts, javaStringHashCode, uniqueItemNumber } from '../src/log.js'
import { unwrap } from '../src/result.js'
import { findPlayer, toPlayerView, toPublicLog } from '../src/state.js'

import { CASH1981, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

describe('toPublicLog', () => {
  it('strips the item and the private log text', () => {
    const state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'GREAT_PERSON' }))
    const entry = state.log.at(-1)
    if (entry === undefined) throw new Error('no log entry')

    const item = entry.item
    if (item === null) throw new Error('the log entry has no item')

    const publicEntry = toPublicLog(entry)
    expect(Object.keys(publicEntry)).toEqual(['id', 'username', 'logType', 'publicLog'])
    expect(JSON.stringify(publicEntry)).not.toContain(itemName(item))
  })
})

describe('toPlayerView', () => {
  it('the owner sees their own hand in the clear', () => {
    let state = firstCivGame()
    for (const sheetName of ['CULTURE_1', 'HUTS', 'INFANTRY'] as const) {
      state = unwrap(draw(state, { playerId: CASH1981, sheetName }))
    }

    const view = toPlayerView(state, CASH1981)
    expect(view.you?.items).toHaveLength(3)
    expect(view.you?.items.map((item) => item.sheetName)).toEqual([
      'CULTURE_1',
      'HUTS',
      'INFANTRY',
    ])
  })

  it('opponents see counts only, not contents', () => {
    let state = firstCivGame()
    for (const sheetName of ['CULTURE_1', 'HUTS', 'INFANTRY'] as const) {
      state = unwrap(draw(state, { playerId: CASH1981, sheetName }))
    }

    const view = toPlayerView(state, KARANDRAS1)
    const cash = view.opponents.find((opponent) => opponent.playerId === CASH1981)

    expect(cash?.numberOfItemsInHand).toBe(3)
    expect(cash).not.toHaveProperty('items')
    // None of the card names in cash1981's hand may appear in Karandras1's view
    const hand = findPlayer(state, CASH1981)?.items ?? []
    const serialised = JSON.stringify(view)
    for (const item of hand) {
      expect(serialised, `leaked ${revealAll(item)}`).not.toContain(revealAll(item))
    }
  })

  it('log entries belonging to others arrive in public form only', () => {
    const state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'CIV' }))

    const own = toPlayerView(state, CASH1981)
    const other = toPlayerView(state, ITCHI)

    const ownEntry = own.log.at(-1)
    const otherEntry = other.log.at(-1)

    expect(ownEntry).toHaveProperty('item')
    expect(ownEntry).toHaveProperty('privateLog')
    expect(otherEntry).not.toHaveProperty('item')
    expect(otherEntry).not.toHaveProperty('privateLog')
  })

  it('shows the deck as a count, not as cards', () => {
    const state = firstCivGame()
    const view = toPlayerView(state, CASH1981)

    expect(view.numberOfItemsInDeck).toBe(state.items.length)
    expect(view).not.toHaveProperty('items')
  })

  it('an onlooker who is not in the game sees no hand', () => {
    const view = toPlayerView(firstCivGame(), 'onlooker')
    expect(view.you).toBeNull()
    expect(view.opponents).toHaveLength(4)
    expect(view.opponents.every((opponent) => opponent.government === 'Despotism')).toBe(true)
    expect(view.opponents.every((opponent) => !('items' in opponent))).toBe(true)
  })

  it('a hidden technology stays out of another player\'s public techs view', () => {
    // CASH1981 reveals a civilization first, so they show up in
    // revealedTechsForAllPlayers with their (public) starting technology —
    // otherwise the public-projection assertions below would pass vacuously
    // against an empty list, since revealedTechsForAllPlayers only returns
    // players who have chosen a civilization.
    let state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'CIV' }))
    const civ = findPlayer(state, CASH1981)?.items.find(
      (item): item is CivItem => item.kind === 'civ',
    )
    if (civ === undefined) throw new Error('no civ drawn')
    state = unwrap(revealItem(state, { playerId: CASH1981, sheetName: 'CIV', itemNumber: civ.itemNumber }))

    // A level-1 tech that is not the starting technology, so choosing it
    // stays hidden rather than being published by the civ reveal.
    const tech = state.techs.find((candidate) => candidate.name !== civ.startingTech.name)
    if (tech === undefined) throw new Error('no tech')

    const chosen = unwrap(chooseTech(state, { playerId: CASH1981, techName: tech.name }))

    // The owner sees it, still hidden, in their own hand.
    const owner = toPlayerView(chosen, CASH1981)
    expect(owner.you?.techsChosen.some((item) => item.name === tech.name)).toBe(true)

    // Another player sees the opponent as a count only, and the general
    // catalogue of undrawn/uncommitted techs (in state.techs, sent to every
    // viewer so they can choose one) is not what is under test here — the
    // opponent projection and the public "revealed by everyone" list are.
    const other = toPlayerView(chosen, ITCHI)
    const cash = other.opponents.find((opponent) => opponent.playerId === CASH1981)
    expect(cash).not.toHaveProperty('techsChosen')
    expect(JSON.stringify(cash)).not.toContain(tech.name)

    // The public projection: CASH1981 is present (civ revealed), carries the
    // starting technology in the clear, and does not carry the hidden one.
    // This is the assertion the reviewer found was vacuous before the civ
    // reveal was added — it now fails if hidden filtering ever regresses.
    const publicTechs = revealedTechsForAllPlayers(chosen)
    const cashPublic = publicTechs.find((entry) => entry.civilization === civ.name)
    expect(cashPublic).toBeDefined()
    expect(cashPublic?.techs.map((entry) => entry.name)).toContain(civ.startingTech.name)
    expect(cashPublic?.techs.map((entry) => entry.name)).not.toContain(tech.name)
  })

  it('a hidden social policy stays out of another player\'s view, and shows in the public log once revealed', () => {
    const game = firstCivGame()
    const policy = game.socialPolicies[0]
    if (policy === undefined) throw new Error('no social policy')

    const chosen = unwrap(chooseSocialPolicy(game, { playerId: CASH1981, name: policy.name }))

    // The owner sees it, still hidden, in their own hand.
    const owner = toPlayerView(chosen, CASH1981)
    expect(owner.you?.socialPolicies.some((item) => item.name === policy.name)).toBe(true)

    // Another player sees only a count, not the card, and the name does not
    // leak anywhere in their view — including the log line for choosing it.
    const other = toPlayerView(chosen, ITCHI)
    const cash = other.opponents.find((opponent) => opponent.playerId === CASH1981)
    expect(cash).not.toHaveProperty('socialPolicies')
    expect(JSON.stringify(other)).not.toContain(policy.name)

    const revealed = unwrap(
      revealSocialPolicy(chosen, { playerId: CASH1981, name: policy.name }),
    )
    const entry = revealed.log.at(-1)
    if (entry === undefined) throw new Error('no log entry')
    expect(toPublicLog(entry).publicLog).toContain(policy.name)
  })
})

describe('log texts', () => {
  it('ITEM reveals everything privately and only the type publicly', () => {
    // Java: DELIM is " - ", which gives the double space after "drew"
    const texts = createLogTexts('ITEM', 'cash1981', null, 42)
    expect(texts.privateLog).toBe('cash1981 drew  - . Item number #42')
    expect(texts.publicLog).toBe('cash1981 drew  - . Item number #42')
  })

  it('TECH hides the technology publicly', () => {
    const state = firstCivGame()
    const tech = state.techs[0]
    if (tech === undefined) throw new Error('no tech')

    const texts = createLogTexts('TECH', 'cash1981', tech, tech.itemNumber)
    expect(texts.privateLog).toContain(tech.name)
    expect(texts.publicLog).toBe(
      `cash1981 has researched a hidden technology${uniqueItemNumber('cash1981', tech.itemNumber)}`,
    )
    expect(texts.publicLog).not.toContain(tech.name)
  })

  it('SOCIAL_POLICY hides the card publicly, even though revealPublic would show it', () => {
    const state = firstCivGame()
    const policy = state.socialPolicies[0]
    if (policy === undefined) throw new Error('no social policy')

    const texts = createLogTexts('SOCIAL_POLICY', 'cash1981', policy, policy.itemNumber)
    expect(texts.privateLog).toContain(policy.name)
    expect(texts.publicLog).not.toContain(policy.name)
    expect(texts.publicLog).toContain('has chosen a hidden social policy')
  })

  it('uniqueItemNumber gives a different number per player for the same card', () => {
    expect(uniqueItemNumber('cash1981', 42)).not.toBe(uniqueItemNumber('Karandras1', 42))
  })

  it('javaStringHashCode matches the Java String.hashCode', () => {
    // Known values from java.lang.String.hashCode()
    expect(javaStringHashCode('')).toBe(0)
    expect(javaStringHashCode('a')).toBe(97)
    expect(javaStringHashCode('ab')).toBe(3105)
    expect(javaStringHashCode('hello')).toBe(99162322)
    // The classic collision: "Aa" and "BB" hash the same
    expect(javaStringHashCode('Aa')).toBe(2112)
    expect(javaStringHashCode('BB')).toBe(2112)
  })
})
