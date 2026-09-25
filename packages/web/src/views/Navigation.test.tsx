// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Navigation } from './Navigation.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Navigation hamburger menu', () => {
  it('keeps the site links and account actions inside one collapsible menu', () => {
    const { container } = render(
      <Navigation
        player={{ id: 'p1', username: 'cash1981', email: null, role: 'user', disabled: false }}
        screen="lobby"
        theme="dark"
        onNavigate={vi.fn()}
        onSignOut={vi.fn()}
        onToggleTheme={vi.fn()}
      />,
    )

    const menu = container.querySelector('details.main-menu')
    expect(menu).not.toBeNull()
    expect(menu?.querySelector('summary')).not.toBeNull()

    expect(screen.getByRole('navigation').classList.contains('site-navigation')).toBe(true)
    expect(screen.getByRole('navigation').closest('details.main-menu')).toBe(menu)
    expect(
      screen.getByRole('button', { name: 'Sign out' }).closest('.topbar-actions'),
    ).not.toBeNull()
  })

  it('opens and closes with the hamburger summary', () => {
    const { container } = render(
      <Navigation
        player={null}
        screen="lobby"
        theme="dark"
        onNavigate={vi.fn()}
        onSignOut={vi.fn()}
        onToggleTheme={vi.fn()}
      />,
    )

    const menu = container.querySelector('details.main-menu') as HTMLDetailsElement
    const summary = menu.querySelector('summary') as HTMLElement
    expect(menu.hasAttribute('open')).toBe(false)
    fireEvent.click(summary)
    expect(menu.hasAttribute('open')).toBe(true)
    fireEvent.click(summary)
    expect(menu.hasAttribute('open')).toBe(false)
  })

  it('closes the menu after a link inside it is used', () => {
    const { container } = render(
      <Navigation
        player={null}
        screen="lobby"
        theme="dark"
        onNavigate={vi.fn()}
        onSignOut={vi.fn()}
        onToggleTheme={vi.fn()}
      />,
    )

    const menu = container.querySelector('details.main-menu') as HTMLDetailsElement
    menu.setAttribute('open', '')
    fireEvent.click(screen.getByRole('link', { name: 'Highscore' }))
    expect(menu.hasAttribute('open')).toBe(false)
  })

  it('does not close the outer menu when the nested rules submenu is opened', () => {
    const { container } = render(
      <Navigation
        player={null}
        screen="lobby"
        theme="dark"
        onNavigate={vi.fn()}
        onSignOut={vi.fn()}
        onToggleTheme={vi.fn()}
      />,
    )

    const menu = container.querySelector('details.main-menu') as HTMLDetailsElement
    menu.setAttribute('open', '')
    const summary = screen.getByText('Rules and help')
    expect(summary.tagName).toBe('SUMMARY')
    fireEvent.click(summary)
    expect(summary.closest('details')?.hasAttribute('open')).toBe(true)
    expect(menu.hasAttribute('open')).toBe(true)
  })

  it('has no "Back to games" button — the brand link already goes home', () => {
    render(
      <Navigation
        player={{ id: 'p1', username: 'cash1981', email: null, role: 'user', disabled: false }}
        screen="game"
        theme="dark"
        onNavigate={vi.fn()}
        onSignOut={vi.fn()}
        onToggleTheme={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Back to games' })).toBeNull()
  })
})

describe('Navigation game menu section', () => {
  it('is absent when no game page is showing', () => {
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

    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete game' })).toBeNull()
  })

  it('offers Withdraw, confirmed before it fires, but not Delete for a non-owner', () => {
    const onWithdraw = vi.fn()
    const onDelete = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(
      <Navigation
        player={{ id: 'p1', username: 'cash1981', email: null, role: 'user', disabled: false }}
        screen="game"
        theme="dark"
        onNavigate={vi.fn()}
        onSignOut={vi.fn()}
        onToggleTheme={vi.fn()}
        game={{ canWithdraw: true, withdrawDisabled: false, onWithdraw, canDelete: false, deleteDisabled: false, onDelete }}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Delete game' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }))
    expect(window.confirm).toHaveBeenCalledWith('Withdraw from this game?')
    expect(onWithdraw).toHaveBeenCalledOnce()
  })

  it('skips the action when the confirmation is declined', () => {
    const onDelete = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(
      <Navigation
        player={{ id: 'p1', username: 'cash1981', email: null, role: 'admin', disabled: false }}
        screen="game"
        theme="dark"
        onNavigate={vi.fn()}
        onSignOut={vi.fn()}
        onToggleTheme={vi.fn()}
        game={{ canWithdraw: true, withdrawDisabled: false, onWithdraw: vi.fn(), canDelete: true, deleteDisabled: false, onDelete }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete game' }))
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('disables Withdraw/Delete exactly as `withdrawDisabled`/`deleteDisabled` say', () => {
    render(
      <Navigation
        player={{ id: 'p1', username: 'cash1981', email: null, role: 'admin', disabled: false }}
        screen="game"
        theme="dark"
        onNavigate={vi.fn()}
        onSignOut={vi.fn()}
        onToggleTheme={vi.fn()}
        game={{
          canWithdraw: true,
          withdrawDisabled: true,
          onWithdraw: vi.fn(),
          canDelete: true,
          deleteDisabled: false,
          onDelete: vi.fn(),
        }}
      />,
    )

    expect((screen.getByRole('button', { name: 'Withdraw' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Delete game' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('offers Delete but not Withdraw to an admin who never joined the game', () => {
    render(
      <Navigation
        player={{ id: 'admin1', username: 'admin', email: null, role: 'admin', disabled: false }}
        screen="game"
        theme="dark"
        onNavigate={vi.fn()}
        onSignOut={vi.fn()}
        onToggleTheme={vi.fn()}
        game={{
          canWithdraw: false,
          withdrawDisabled: true,
          onWithdraw: vi.fn(),
          canDelete: true,
          deleteDisabled: false,
          onDelete: vi.fn(),
        }}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Delete game' })).not.toBeNull()
  })
})

describe('Navigation rules disclosure', () => {
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

describe('Navigation brand', () => {
  it('shows the coin icon beside the wordmark, both linking home', () => {
    render(
      <Navigation
        player={null}
        screen="lobby"
        theme="dark"
        onNavigate={vi.fn()}
        onSignOut={vi.fn()}
        onToggleTheme={vi.fn()}
      />,
    )

    const brand = screen.getByRole('link', { name: /Civilization playciv/i })
    expect(brand.getAttribute('href')).toBe('/')

    const icon = brand.querySelector('img.brand-icon')
    expect(icon?.getAttribute('src')).toBe('/favicon.ico')
    expect(icon?.getAttribute('alt')).toBe('')
  })
})
