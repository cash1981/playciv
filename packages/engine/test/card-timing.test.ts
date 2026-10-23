/**
 * The timing of a card is read from its own effect text, so these tests use the
 * texts the sheets print, including the two spellings of the separator.
 */

import { describe, expect, it } from 'vitest'

import {
  CARD_TIMING_TEXT,
  cardPlayRuleOf,
  discardsWhenUsed,
  timingsOf,
} from '../src/card-timing.js'

describe('timingsOf', () => {
  it('reads the phase a card is played in from the start of its text', () => {
    expect(timingsOf('Start of Turn: Choose another player. That player must discard one coin token.')).toEqual(['SOT'])
    expect(timingsOf('Start of turn : Choose a building within 4 squares.')).toEqual(['SOT'])
    expect(timingsOf('City Management: Choose one of your cities.')).toEqual(['CM'])
    expect(timingsOf('Movement: Choose a figure within 4 squares.')).toEqual(['MOVEMENT'])
    expect(timingsOf('Battle: Before drawing your battle force, build 1 unlocked unit for free.')).toEqual(['BATTLE'])
    expect(timingsOf('Research: You may discard this card when adding a tech.')).toEqual(['RESEARCH'])
    expect(timingsOf('Any Time: Cancel a culture event.')).toEqual(['ANY'])
  })

  it('treats "Start of Any Phase" as any time', () => {
    expect(timingsOf('Start of Any Phase: You may discard this card to become the first player.')).toEqual(['ANY'])
  })

  it('reads both timings of a card with two, in the order the card names them', () => {
    expect(
      timingsOf('Start of Turn : Gain 7 trades. / City Management : Take an additional action with one of your non-capital cities.'),
    ).toEqual(['SOT', 'CM'])
    expect(timingsOf('City Management : Switch one of your social policies. / Movement : Move one of your figures.')).toEqual([
      'CM',
      'MOVEMENT',
    ])
  })

  it('has no timing for a passive card, and ignores a phase word inside a sentence', () => {
    expect(timingsOf('Your culture hand size is increased by 2.')).toEqual([])
    expect(timingsOf('+1 coin.')).toEqual([])
    expect(timingsOf('Spend 6 trade. Movement: is not a heading here')).toEqual([])
    expect(timingsOf(null)).toEqual([])
  })

  it('has words for every timing', () => {
    for (const timing of ['SOT', 'TRADE', 'CM', 'MOVEMENT', 'RESEARCH', 'BATTLE', 'ANY'] as const) {
      expect(CARD_TIMING_TEXT[timing].length).toBeGreaterThan(0)
    }
  })
})

describe('cardPlayRuleOf', () => {
  it('names one player for Counterfeiters and none for Drought', () => {
    expect(cardPlayRuleOf('Counterfeiters').targets).toEqual({ kind: 'players', min: 1, max: 1 })
    expect(cardPlayRuleOf('Drought').targets).toEqual({ kind: 'none' })
  })

  it('names every other player for Bank Scandal and up to two for Depression', () => {
    expect(cardPlayRuleOf('Bank Scandal').targets).toEqual({ kind: 'allOthers' })
    expect(cardPlayRuleOf('Depression').targets).toEqual({ kind: 'players', min: 1, max: 2 })
  })

  it('plays the gift cards as a resource, and A Princely Gift also as Uranium', () => {
    expect(cardPlayRuleOf('A Gift from Afar').resources).toEqual(['Iron', 'Wheat', 'Spy', 'Silk'])
    expect(cardPlayRuleOf('A Princely Gift').resources).toContain('Uranium')
    expect(cardPlayRuleOf('A Generous Gift').resources).not.toContain('Uranium')
  })

  it('gives a card the table does not know an optional single player', () => {
    expect(cardPlayRuleOf('A Card From The Future').targets).toEqual({ kind: 'players', min: 0, max: 1 })
  })
})

describe('discardsWhenUsed', () => {
  it('is true when the text says to discard the card and false otherwise', () => {
    expect(discardsWhenUsed('Any Time: You may discard this card to gain 27 trade.')).toBe(true)
    expect(discardsWhenUsed('Start of Turn: Gain 1 culture for every 3 coins you have.')).toBe(false)
    expect(discardsWhenUsed(null)).toBe(false)
  })
})
