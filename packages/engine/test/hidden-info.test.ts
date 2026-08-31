/**
 * Skjult informasjon.
 *
 * Java lagret hele itemet på loggdokumentet og lot ressurslaget filtrere. Det
 * var sikkerhetshullet som er notert i todo.txt («hide the drawn item in the
 * public log»). Her sjekkes at projeksjonene ikke lekker.
 */

import { describe, expect, it } from 'vitest'

import { draw } from '../src/actions/draw.js'
import { createLogTexts, javaStringHashCode, uniqueItemNumber } from '../src/log.js'
import { itemName, revealAll } from '../src/item.js'
import { unwrap } from '../src/result.js'
import { findPlayer, toPlayerView, toPublicLog } from '../src/state.js'

import { CASH1981, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

describe('toPublicLog', () => {
  it('fjerner itemet og den private loggteksten', () => {
    const state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'GREAT_PERSON' }))
    const entry = state.log.at(-1)
    if (entry === undefined) throw new Error('ingen loggpost')

    const item = entry.item
    if (item === null) throw new Error('loggposten mangler item')

    const publicEntry = toPublicLog(entry)
    expect(Object.keys(publicEntry)).toEqual(['id', 'username', 'logType', 'publicLog'])
    expect(JSON.stringify(publicEntry)).not.toContain(itemName(item))
  })
})

describe('toPlayerView', () => {
  it('eieren ser sin egen hånd i klartekst', () => {
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

  it('motstandere ser bare antall, ikke innhold', () => {
    let state = firstCivGame()
    for (const sheetName of ['CULTURE_1', 'HUTS', 'INFANTRY'] as const) {
      state = unwrap(draw(state, { playerId: CASH1981, sheetName }))
    }

    const view = toPlayerView(state, KARANDRAS1)
    const cash = view.opponents.find((opponent) => opponent.playerId === CASH1981)

    expect(cash?.numberOfItemsInHand).toBe(3)
    expect(cash).not.toHaveProperty('items')
    // Ingen av kortnavnene i cash1981s hånd skal finnes i Karandras1 sitt syn
    const hand = findPlayer(state, CASH1981)?.items ?? []
    const serialised = JSON.stringify(view)
    for (const item of hand) {
      expect(serialised, `lekket ${revealAll(item)}`).not.toContain(revealAll(item))
    }
  })

  it('andres loggposter kommer bare i offentlig form', () => {
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

  it('viser stokken som antall, ikke som kort', () => {
    const state = firstCivGame()
    const view = toPlayerView(state, CASH1981)

    expect(view.numberOfItemsInDeck).toBe(state.items.length)
    expect(view).not.toHaveProperty('items')
  })

  it('en tilskuer som ikke er med i spillet ser ingen hånd', () => {
    const view = toPlayerView(firstCivGame(), 'tilskuer')
    expect(view.you).toBeNull()
    expect(view.opponents).toHaveLength(4)
  })
})

describe('loggtekster', () => {
  it('ITEM avslører alt privat og bare typen offentlig', () => {
    // Java: DELIM er " - ", og gir det doble mellomrommet etter "drew"
    const texts = createLogTexts('ITEM', 'cash1981', null, 42)
    expect(texts.privateLog).toBe('cash1981 drew  - . Item number #42')
    expect(texts.publicLog).toBe('cash1981 drew  - . Item number #42')
  })

  it('TECH skjuler teknologien offentlig', () => {
    const state = firstCivGame()
    const tech = state.techs[0]
    if (tech === undefined) throw new Error('ingen tech')

    const texts = createLogTexts('TECH', 'cash1981', tech, tech.itemNumber)
    expect(texts.privateLog).toContain(tech.name)
    expect(texts.publicLog).toBe(
      `cash1981 has researched a hidden technology${uniqueItemNumber('cash1981', tech.itemNumber)}`,
    )
    expect(texts.publicLog).not.toContain(tech.name)
  })

  it('SOCIAL_POLICY skjuler kortet offentlig, selv om revealPublic ville avslørt det', () => {
    const state = firstCivGame()
    const policy = state.socialPolicies[0]
    if (policy === undefined) throw new Error('ingen sosialpolitikk')

    const texts = createLogTexts('SOCIAL_POLICY', 'cash1981', policy, policy.itemNumber)
    expect(texts.privateLog).toContain(policy.name)
    expect(texts.publicLog).not.toContain(policy.name)
    expect(texts.publicLog).toContain('has chosen a hidden social policy')
  })

  it('uniqueItemNumber gir forskjellig nummer per spiller for samme kort', () => {
    expect(uniqueItemNumber('cash1981', 42)).not.toBe(uniqueItemNumber('Karandras1', 42))
  })

  it('javaStringHashCode matcher Javas String.hashCode', () => {
    // Kjente verdier fra java.lang.String.hashCode()
    expect(javaStringHashCode('')).toBe(0)
    expect(javaStringHashCode('a')).toBe(97)
    expect(javaStringHashCode('ab')).toBe(3105)
    expect(javaStringHashCode('hello')).toBe(99162322)
    // Den klassiske kollisjonen: "Aa" og "BB" hasher likt
    expect(javaStringHashCode('Aa')).toBe(2112)
    expect(javaStringHashCode('BB')).toBe(2112)
  })
})
