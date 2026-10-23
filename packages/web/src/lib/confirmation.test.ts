import { describe, expect, it } from 'vitest'

import { DONE_TEXT, confirmationText } from './confirmation.js'

describe('confirmationText', () => {
  it('says Done with nothing to report', () => {
    expect(confirmationText([])).toBe(DONE_TEXT)
    expect(confirmationText(['  ', ''])).toBe(DONE_TEXT)
  })

  it('joins several lines', () => {
    expect(confirmationText(['one', 'two'])).toBe('one · two')
  })

  it('shortens a very long line', () => {
    const long = confirmationText(['x'.repeat(500)])
    expect(long.length).toBe(280)
    expect(long.endsWith('…')).toBe(true)
  })
})
