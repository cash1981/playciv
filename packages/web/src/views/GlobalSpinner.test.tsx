// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { beginActivity } from '../lib/activity.js'
import { GlobalSpinner, SPINNER_DELAY_MS, SPINNER_MIN_VISIBLE_MS } from './GlobalSpinner.js'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const ring = (container: HTMLElement): Element | null =>
  container.querySelector('.global-spinner-ring')

describe('GlobalSpinner', () => {
  it('stays hidden for work that finishes quickly', () => {
    const { container } = render(<GlobalSpinner />)
    let done = (): void => {}
    act(() => { done = beginActivity() })
    act(() => { vi.advanceTimersByTime(SPINNER_DELAY_MS - 1) })
    act(() => done())
    act(() => { vi.advanceTimersByTime(SPINNER_MIN_VISIBLE_MS) })

    expect(ring(container)).toBeNull()
  })

  it('appears after the delay, announces itself, and never takes clicks', () => {
    const { container } = render(<GlobalSpinner />)
    const region = container.querySelector('.global-spinner')
    expect(region?.getAttribute('role')).toBe('status')

    let done = (): void => {}
    act(() => { done = beginActivity() })
    expect(ring(container)).toBeNull()
    act(() => { vi.advanceTimersByTime(SPINNER_DELAY_MS) })

    expect(ring(container)).not.toBeNull()
    expect(region?.getAttribute('data-active')).toBe('true')
    expect(region?.textContent).toContain('Working')
    act(() => done())
  })

  it('stays up for the minimum time after the work ends, then goes away', () => {
    const { container } = render(<GlobalSpinner />)
    let done = (): void => {}
    act(() => { done = beginActivity() })
    act(() => { vi.advanceTimersByTime(SPINNER_DELAY_MS) })
    act(() => done())

    act(() => { vi.advanceTimersByTime(SPINNER_MIN_VISIBLE_MS - 1) })
    expect(ring(container)).not.toBeNull()
    act(() => { vi.advanceTimersByTime(1) })
    expect(ring(container)).toBeNull()
  })

  it('does not flicker off when one piece of work hands over to the next', () => {
    const { container } = render(<GlobalSpinner />)
    let write = (): void => {}
    act(() => { write = beginActivity() })
    act(() => { vi.advanceTimersByTime(SPINNER_DELAY_MS + SPINNER_MIN_VISIBLE_MS) })
    expect(ring(container)).not.toBeNull()

    // The write ends and the reload starts in the same tick.
    let reload = (): void => {}
    act(() => {
      reload = beginActivity()
      write()
    })
    act(() => { vi.advanceTimersByTime(5000) })
    expect(ring(container)).not.toBeNull()
    act(() => reload())
  })
})
