// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react'
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
    document.body.append(opener.current)
    const { unmount } = render(
      <ReferenceDialog titleId="t" title="Reference" onClose={() => {}} returnFocusTo={opener}>
        <p>body</p>
      </ReferenceDialog>,
    )
    fireEvent.keyDown(document, { key: 'Tab' })
    unmount()
    const ours = focus.mock.contexts.flatMap((context, index) =>
      context === opener.current || (context as HTMLElement).textContent === 'Close'
        ? [focus.mock.calls[index]]
        : [],
    )
    expect(focus.mock.contexts).toContain(opener.current)
    expect(ours.length).toBeGreaterThanOrEqual(2)
    for (const call of ours) expect(call?.[0]).toEqual({ preventScroll: true })
  })

  it('returns focus to the control that opened it, not the shared ref', () => {
    const opener = document.createElement('button')
    const other = { current: document.createElement('button') }
    document.body.append(opener, other.current)
    opener.focus()
    const { unmount } = render(
      <ReferenceDialog titleId="t" title="Reference" onClose={() => {}} returnFocusTo={other}>
        <p>body</p>
      </ReferenceDialog>,
    )
    unmount()
    expect(document.activeElement).toBe(opener)
  })
})
