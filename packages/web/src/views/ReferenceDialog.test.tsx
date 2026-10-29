// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ReferenceDialog } from './ReferenceDialog.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ReferenceDialog focus (issue #296)', () => {
  it('moves focus without scrolling on open and on close', () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    const opener = { current: document.createElement('button') }
    const { unmount } = render(
      <ReferenceDialog titleId="t" title="Reference" onClose={() => {}} returnFocusTo={opener}>
        <p>body</p>
      </ReferenceDialog>,
    )
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
    unmount()
    const ours = focus.mock.contexts.flatMap((context, index) =>
      context === opener.current || (context as HTMLElement).textContent === 'Close'
        ? [focus.mock.calls[index]]
        : [],
    )
    expect(ours.length).toBeGreaterThanOrEqual(2)
    for (const call of ours) expect(call?.[0]).toEqual({ preventScroll: true })
  })
})
