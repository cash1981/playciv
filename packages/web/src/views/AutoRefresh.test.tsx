// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AutoRefreshStatus, AutoRefreshSwitch } from './AutoRefresh.js'

afterEach(cleanup)

describe('AutoRefreshSwitch', () => {
  it('says on, and that it checks every so many seconds', () => {
    render(<AutoRefreshSwitch on seconds={10} onToggle={() => undefined} />)
    const toggle = screen.getByRole('switch', { name: 'Auto-refresh on' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(toggle.classList.contains('on')).toBe(true)
    expect(toggle.title).toBe('Checking for changes every 10 seconds. Turn off.')
  })

  it('says off, with a different look and a way to turn it on', () => {
    render(<AutoRefreshSwitch on={false} seconds={10} onToggle={() => undefined} />)
    const toggle = screen.getByRole('switch', { name: 'Auto-refresh off' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(toggle.classList.contains('off')).toBe(true)
    expect(toggle.classList.contains('on')).toBe(false)
    expect(toggle.title).toBe('Not checking for changes. Turn on.')
  })

  it('toggles on click', () => {
    const onToggle = vi.fn()
    render(<AutoRefreshSwitch on={false} seconds={10} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})

describe('AutoRefreshStatus', () => {
  it('uses the same words as the switch, on and off', () => {
    const { container, rerender } = render(<AutoRefreshStatus on />)
    expect(container.textContent).toBe('Auto-refresh on')
    expect(container.querySelector('.auto-refresh-status')?.getAttribute('title')).toBe(
      'New messages show up by themselves',
    )
    rerender(<AutoRefreshStatus on={false} />)
    expect(container.textContent).toBe('Auto-refresh off')
    expect(container.querySelector('.auto-refresh-status')?.getAttribute('title')).toBe(
      'New messages will not show up by themselves',
    )
  })
})
