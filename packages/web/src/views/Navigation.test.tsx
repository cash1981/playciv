// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Navigation } from './Navigation.js'

afterEach(cleanup)

describe('Navigation mobile structure', () => {
  it('keeps primary links and account actions in responsive containers', () => {
    render(
      <Navigation
        player={{ id: 'p1', username: 'cash1981', email: null, role: 'user', disabled: false }}
        screen="lobby"
        theme="dark"
        onNavigate={vi.fn()}
        onSignOut={vi.fn()}
        onToggleTheme={vi.fn()}
      />,
    )

    expect(screen.getByRole('navigation').classList.contains('site-navigation')).toBe(true)
    expect(screen.getByRole('navigation').parentElement?.classList.contains('topbar')).toBe(true)
    expect(
      screen.getByRole('button', { name: 'Sign out' }).parentElement?.classList.contains('topbar-actions'),
    ).toBe(true)
  })

  it('keeps the rules disclosure usable as a native details control', () => {
    render(
      <Navigation
        player={null}
        screen="lobby"
        theme="light"
        onNavigate={vi.fn()}
        onSignOut={vi.fn()}
        onToggleTheme={vi.fn()}
      />,
    )

    const summary = screen.getByText('Rules and help')
    expect(summary.tagName).toBe('SUMMARY')
    fireEvent.click(summary)
    expect(summary.closest('details')?.hasAttribute('open')).toBe(true)
  })
})
