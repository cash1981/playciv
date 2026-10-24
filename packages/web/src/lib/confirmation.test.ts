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
    expect(
      confirmationText(
        ['Alice played Khalid, becoming the start player (next turn passes clockwise from Alice)'],
        'Alice',
      ),
    ).toBe('You played Khalid, becoming the start player (next turn passes clockwise from you)')
    expect(confirmationText(["System: Alice's Stonehenge was undone"], 'Alice')).toBe(
      "System: Your Stonehenge was undone",
    )
  })

  it('fixes the third-person verb of the log lines it rewrites', () => {
    expect(confirmationText(['Alice has updated city management phase'], 'Alice')).toBe(
      'You have updated city management phase',
    )
    expect(confirmationText(['Turn 1 - Alice has updated city management phase'], 'Alice')).toBe(
      'Turn 1 - You have updated city management phase',
    )
    expect(confirmationText(['Alice is now the start player'], 'Alice')).toBe('You are now the start player')
    expect(confirmationText(['Alice has discarded Foo'], 'Alice')).toBe('You have discarded Foo')
    expect(confirmationText(['Alice plays Foo'], 'Alice')).toBe('You play Foo')
    expect(confirmationText(['Alice reveals Foo'], 'Alice')).toBe('You reveal Foo')
    expect(confirmationText(['Alice moves a unit to D5'], 'Alice')).toBe('You move a unit to D5')
  })

  it('rewrites the actor again in an undo line', () => {
    expect(
      confirmationText(
        ['System: Alice has removed Foo from Alice and put back in the deck. Deck is reshuffled'],
        'Alice',
      ),
    ).toBe('System: You have removed Foo from you and put back in the deck. Deck is reshuffled')
    expect(confirmationText(['System: Alice has added back Foo to Alice'], 'Alice')).toBe(
      'System: You have added back Foo to you',
    )
  })

  it('leaves another player\'s name, and a line without a viewer name, alone', () => {
    expect(confirmationText(['Bob targeted Alice'], 'Alice')).toBe('Bob targeted Alice')
    expect(confirmationText(['Bob said Alice was right'], 'Alice')).toBe('Bob said Alice was right')
    expect(confirmationText(['Bob drew a card'], 'Alice')).toBe('Bob drew a card')
    expect(confirmationText(['Alice drew a card'], '')).toBe('Alice drew a card')
  })

  it('does not change a card or another player whose name contains the viewer name', () => {
    expect(confirmationText(['Alice offered Alice-Bob a trade'], 'Alice')).toBe('You offered Alice-Bob a trade')
    expect(confirmationText(['Alice offered a trade to Alice-Bob'], 'Alice')).toBe(
      'You offered a trade to Alice-Bob',
    )
    expect(confirmationText(["Alice moved a piece from Alice's area"], 'Alice')).toBe(
      "You moved a piece from Alice's area",
    )
    expect(confirmationText(["Lorenzo used Lorenzo de' Medici: gained 1 culture"], 'Lorenzo')).toBe(
      "You used Lorenzo de' Medici: gained 1 culture",
    )
  })

  it('treats the viewer name as literal text, not a pattern', () => {
    expect(confirmationText(['a.b used a wonder'], 'a.b')).toBe('You used a wonder')
    expect(confirmationText(['axb used a wonder'], 'a.b')).toBe('axb used a wonder')
  })

  it('handles an accented viewer name', () => {
    expect(confirmationText(['José used Stonehenge: gained 1 culture'], 'José')).toBe(
      'You used Stonehenge: gained 1 culture',
    )
  })

  it('leaves a line that does not name the viewer exactly as it is', () => {
    expect(confirmationText(['you was here'], 'Alice')).toBe('you was here')
  })

  it('joins the lines after changing each one', () => {
    expect(confirmationText(['Alice used Stonehenge', "Alice's turn was undone"], 'Alice')).toBe(
      'You used Stonehenge · Your turn was undone',
    )
  })
})
