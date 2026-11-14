import { describe, expect, it } from 'vitest'

import { MAX_COMBAT_HAND_SIZE_LENGTH } from '@civ/engine'

import { parseStatInput } from './statInput.js'

describe('parseStatInput number', () => {
  it('reads a whole number, trimmed, and zero is a value', () => {
    expect(parseStatInput('number', '7')).toEqual({ ok: true, value: 7 })
    expect(parseStatInput('number', '  12 ')).toEqual({ ok: true, value: 12 })
    expect(parseStatInput('number', '0')).toEqual({ ok: true, value: 0 })
  })

  it('refuses empty and partial input instead of reading it as 0', () => {
    for (const raw of ['', '   ', '-', '+', '.']) {
      expect(parseStatInput('number', raw)).toEqual({ ok: false })
    }
  })

  it('refuses negative, fractional and non-numeric input', () => {
    for (const raw of ['-1', '1.5', 'abc', '3+1', '1 2']) {
      expect(parseStatInput('number', raw)).toEqual({ ok: false })
    }
  })

  it('takes a number up to the maximum and refuses one above it', () => {
    expect(parseStatInput('number', '27', 27)).toEqual({ ok: true, value: 27 })
    expect(parseStatInput('number', '28', 27)).toEqual({ ok: false })
    expect(parseStatInput('number', '0', 0)).toEqual({ ok: true, value: 0 })
    expect(parseStatInput('number', '1', 0)).toEqual({ ok: false })
    // Without a maximum there is no cap.
    expect(parseStatInput('number', '1000')).toEqual({ ok: true, value: 1000 })
  })
})

describe('parseStatInput movement', () => {
  it('accepts a number or a sum and trims it', () => {
    for (const raw of ['3', '3+1', '2+1+1', ' 3+1 ']) {
      expect(parseStatInput('movement', raw)).toEqual({ ok: true, value: raw.trim() })
    }
  })

  it('refuses a typo, an empty value and text', () => {
    for (const raw of ['', '3+', '+1', 'fast', '3 + a']) {
      expect(parseStatInput('movement', raw)).toEqual({ ok: false })
    }
  })

  it('ignores the maximum, which only caps numbers', () => {
    expect(parseStatInput('movement', '30', 5)).toEqual({ ok: true, value: '30' })
  })
})

describe('parseStatInput freeText', () => {
  it('accepts anything up to the length limit, trimmed, and an empty value clears it', () => {
    expect(parseStatInput('freeText', ' 5+2 ')).toEqual({ ok: true, value: '5+2' })
    expect(parseStatInput('freeText', '+1')).toEqual({ ok: true, value: '+1' })
    expect(parseStatInput('freeText', '')).toEqual({ ok: true, value: '' })
    const longest = 'x'.repeat(MAX_COMBAT_HAND_SIZE_LENGTH)
    expect(parseStatInput('freeText', longest)).toEqual({ ok: true, value: longest })
  })

  it('refuses text over the limit, counted after trimming', () => {
    expect(parseStatInput('freeText', 'x'.repeat(MAX_COMBAT_HAND_SIZE_LENGTH + 1))).toEqual({ ok: false })
    expect(parseStatInput('freeText', ` ${'x'.repeat(MAX_COMBAT_HAND_SIZE_LENGTH)} `)).toEqual({
      ok: true,
      value: 'x'.repeat(MAX_COMBAT_HAND_SIZE_LENGTH),
    })
  })
})
