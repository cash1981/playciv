// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { handleTabKeyDown } from './tabKeys.js'

afterEach(cleanup)

describe('handleTabKeyDown', () => {
  it('moves focus and selection with the arrow keys, Home and End, wrapping at the ends', () => {
    const selected: string[] = []
    render(
      <div role="tablist">
        {['One', 'Two', 'Three'].map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            onClick={() => selected.push(name)}
            onKeyDown={handleTabKeyDown}
          >
            {name}
          </button>
        ))}
      </div>,
    )

    const one = screen.getByRole('tab', { name: 'One' })
    one.focus()
    fireEvent.keyDown(one, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Two' }))

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Two' }), { key: 'End' })
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Three' }))

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Three' }), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(one)

    fireEvent.keyDown(one, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Three' }))

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Three' }), { key: 'Home' })
    expect(document.activeElement).toBe(one)

    expect(selected).toEqual(['Two', 'Three', 'One', 'Three', 'One'])
  })

  it('ignores other keys', () => {
    const selected: string[] = []
    render(
      <div role="tablist">
        <button type="button" role="tab" onClick={() => selected.push('One')} onKeyDown={handleTabKeyDown}>
          One
        </button>
        <button type="button" role="tab" onClick={() => selected.push('Two')} onKeyDown={handleTabKeyDown}>
          Two
        </button>
      </div>,
    )

    fireEvent.keyDown(screen.getByRole('tab', { name: 'One' }), { key: 'a' })
    expect(selected).toEqual([])
  })
})
