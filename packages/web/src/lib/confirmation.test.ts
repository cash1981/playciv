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

  it('speaks the viewer\'s own name as you and your, at the start and mid-line', () => {
    expect(confirmationText(['Alice used Stonehenge: gained 1 culture'], 'Alice')).toBe(
      'You used Stonehenge: gained 1 culture',
    )
    expect(confirmationText(["Alice's Stonehenge was undone: 1 culture removed"], 'Alice')).toBe(
      'Your Stonehenge was undone: 1 culture removed',
    )
    expect(confirmationText(['Alice played Khalid, but Alice was already the start player'], 'Alice')).toBe(
      'You played Khalid, but you were already the start player',
    )
  })

  it('leaves another player\'s name, and a line without a viewer name, alone', () => {
    expect(confirmationText(['Bob targeted Alice'], 'Alice')).toBe('Bob targeted you')
    expect(confirmationText(['Bob drew a card'], 'Alice')).toBe('Bob drew a card')
    expect(confirmationText(['Alice drew a card'], '')).toBe('Alice drew a card')
  })

  it('treats the viewer name as literal text, not a pattern', () => {
    expect(confirmationText(['a.b used a wonder'], 'a.b')).toBe('You used a wonder')
    expect(confirmationText(['axb used a wonder'], 'a.b')).toBe('axb used a wonder')
  })

  it('joins the lines after changing each one', () => {
    expect(confirmationText(['Alice used Stonehenge', "Alice's turn was undone"], 'Alice')).toBe(
      'You used Stonehenge · Your turn was undone',
    )
  })
})
