// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Navigation } from './Navigation.js'
import type { GameMenuActions } from './Navigation.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const user = { id: 'p1', username: 'cash1981', email: null, role: 'user' as const, disabled: false }
const admin = { id: 'a1', username: 'admin', email: null, role: 'admin' as const, disabled: false }

type Player = typeof user | typeof admin | null

function menu(
  overrides: {
    player?: Player
    screen?: 'lobby' | 'admin' | 'highscore' | 'faq' | 'about' | 'game'
    theme?: 'dark' | 'light'
    game?: GameMenuActions | null
    onNavigate?: (path: string) => void
    onSignOut?: () => void
    onToggleTheme?: () => void
  } = {},
): React.JSX.Element {
  return (
    <Navigation
      player={overrides.player === undefined ? null : overrides.player}
      screen={overrides.screen ?? 'lobby'}
      theme={overrides.theme ?? 'dark'}
      onNavigate={overrides.onNavigate ?? vi.fn()}
      onSignOut={overrides.onSignOut ?? vi.fn()}
      onToggleTheme={overrides.onToggleTheme ?? vi.fn()}
      game={overrides.game ?? null}
    />
  )
}

const hamburger = (): HTMLElement => screen.getByRole('button', { name: 'Menu' })
const closeButton = (): HTMLElement => screen.getByRole('button', { name: 'Close menu' })
const isOpen = (): boolean => document.querySelector('.nav-sheet') !== null

/** Opens the menu the way a user does, with the hamburger. */
function openMenu(): void {
  fireEvent.click(hamburger())
}

/** Folds out a submenu of the open menu: 'Rules' or 'Actions'. */
function openSubmenu(name: 'Rules' | 'Actions'): void {
  fireEvent.click(screen.getByRole('button', { name }))
}

/** The End game fields, for tests that are not about ending a game. */
const noEnd = { canEnd: false, endDisabled: false, endPlayers: [] as readonly string[], onEnd: vi.fn() }

const gameMenu = (overrides: Partial<GameMenuActions> = {}): GameMenuActions => ({
  canWithdraw: true,
  withdrawDisabled: false,
  onWithdraw: vi.fn(),
  canDelete: true,
  deleteDisabled: false,
  onDelete: vi.fn(),
  canEnd: true,
  endDisabled: false,
  endPlayers: ['cash1981', 's3s3', 'ola'],
  onEnd: vi.fn(),
  ...overrides,
})

describe('Navigation hamburger menu', () => {
  it('keeps the site links and account actions inside one menu that starts closed', () => {
    render(menu({ player: user }))

    expect(hamburger().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()

    openMenu()

    expect(hamburger().getAttribute('aria-expanded')).toBe('true')
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(within(nav).getByRole('link', { name: 'FAQ' })).not.toBeNull()
    expect(within(nav).getByRole('link', { name: 'About' })).not.toBeNull()
    expect(within(nav).getByRole('link', { name: 'Highscore' })).not.toBeNull()
    expect(within(nav).getByRole('button', { name: 'Great persons' })).not.toBeNull()
    expect(within(nav).getByRole('button', { name: 'Rules' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Sign out' }).closest('.nav-footer')).not.toBeNull()
  })

  it('opens and closes with the hamburger', () => {
    render(menu())

    openMenu()
    expect(isOpen()).toBe(true)
    fireEvent.click(hamburger())
    expect(isOpen()).toBe(false)
  })

  it('has a header with a close button that sits outside the scrolling list', () => {
    render(menu())
    openMenu()

    const sheet = document.querySelector('.nav-sheet') as HTMLElement
    const header = sheet.querySelector('.nav-sheet-header') as HTMLElement
    const body = sheet.querySelector('.nav-sheet-body') as HTMLElement
    // The header is a sibling of the scrolling body, not inside it, so it stays
    // in view however far the list is scrolled.
    expect(header.parentElement).toBe(sheet)
    expect(body.parentElement).toBe(sheet)
    expect(header.contains(closeButton())).toBe(true)
    expect(body.contains(closeButton())).toBe(false)
    expect(within(header).getByText('Menu')).not.toBeNull()
  })

  it('the close button closes the menu and returns focus to the hamburger', () => {
    render(menu())
    openMenu()

    fireEvent.click(closeButton())

    expect(isOpen()).toBe(false)
    expect(hamburger().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(hamburger())
  })

  it('moves focus to the close button when the menu opens', () => {
    render(menu())
    openMenu()
    expect(document.activeElement).toBe(closeButton())
  })

  it('Escape closes the menu and returns focus to the hamburger', () => {
    render(menu())
    openMenu()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(isOpen()).toBe(false)
    expect(document.activeElement).toBe(hamburger())
  })

  it('closes when the page outside the menu is pressed, but not on a press inside it', () => {
    render(menu())
    openMenu()

    fireEvent.pointerDown(screen.getByRole('link', { name: 'FAQ' }))
    expect(isOpen()).toBe(true)

    fireEvent.pointerDown(document.body)
    expect(isOpen()).toBe(false)
  })

  it('closes the menu after a link inside it is used', () => {
    const onNavigate = vi.fn()
    render(menu({ onNavigate }))
    openMenu()

    fireEvent.click(screen.getByRole('link', { name: 'Highscore' }))

    expect(onNavigate).toHaveBeenCalledWith('/highscore')
    expect(isOpen()).toBe(false)
    expect(document.activeElement).toBe(hamburger())
  })

  it('closes the menu after a rules link is chosen', () => {
    render(menu())
    openMenu()
    openSubmenu('Rules')

    // jsdom does not follow links; the click is what the menu reacts to.
    fireEvent.click(screen.getByRole('link', { name: 'Base game' }))

    expect(isOpen()).toBe(false)
  })

  it('does not close the menu when a submenu is toggled', () => {
    render(menu())
    openMenu()
    const rules = screen.getByRole('button', { name: 'Rules' })

    fireEvent.click(rules)
    expect(rules.getAttribute('aria-expanded')).toBe('true')
    expect(isOpen()).toBe(true)

    fireEvent.click(rules)
    expect(rules.getAttribute('aria-expanded')).toBe('false')
    expect(isOpen()).toBe(true)
  })

  it('has no "Back to games" button, since the brand link already goes home', () => {
    render(menu({ player: user, screen: 'game' }))
    openMenu()

    expect(screen.queryByRole('button', { name: 'Back to games' })).toBeNull()
  })
})

describe('Navigation footer', () => {
  it('shows the theme toggle, the username and Sign out for a signed-in user, and no Admin', () => {
    const onToggleTheme = vi.fn()
    const onSignOut = vi.fn()
    render(menu({ player: user, theme: 'dark', onToggleTheme, onSignOut }))
    openMenu()

    const footer = document.querySelector('.nav-footer') as HTMLElement
    expect(within(footer).getByText('cash1981')).not.toBeNull()
    expect(within(footer).queryByRole('button', { name: 'Admin' })).toBeNull()

    fireEvent.click(within(footer).getByRole('button', { name: 'Switch to light theme' }))
    expect(onToggleTheme).toHaveBeenCalledOnce()
    expect(isOpen()).toBe(false)

    openMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(onSignOut).toHaveBeenCalledOnce()
  })

  it('offers Admin to an admin, except on the admin page itself', () => {
    const onNavigate = vi.fn()
    const { unmount } = render(menu({ player: admin, onNavigate }))
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Admin' }))
    expect(onNavigate).toHaveBeenCalledWith('/admin')
    unmount()

    render(menu({ player: admin, screen: 'admin' }))
    openMenu()
    expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull()
  })

  it('says so when nobody is signed in, and has no Sign out', () => {
    render(menu({ player: null, theme: 'light' }))
    openMenu()

    expect(screen.getByText('Not signed in')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Switch to dark theme' }).textContent).toBe('Dark theme')
  })
})

describe('Navigation Rules submenu', () => {
  it('is a disclosure button, closed at first, named Rules', () => {
    render(menu())
    openMenu()

    const rules = screen.getByRole('button', { name: 'Rules' })
    expect(rules.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('link', { name: 'Base game' })).toBeNull()
    expect(screen.queryByText('Rules and help')).toBeNull()
  })

  it('folds out inline, inside the navigation, with three labelled groups', () => {
    render(menu())
    openMenu()
    openSubmenu('Rules')

    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    const submenu = within(nav).getByRole('group', { name: 'Rules' })
    const groups = within(submenu)
      .getAllByRole('group')
      .map((group) => ({
        label: group.getAttribute('aria-label'),
        links: within(group)
          .getAllByRole('link')
          .map((link) => link.textContent),
      }))

    expect(groups).toEqual([
      { label: 'Rulebooks', links: ['Base game', 'Fame and Fortune', 'Wisdom and Warfare'] },
      { label: 'Help', links: ['Official FAQ 2.0', 'Unofficial rules summary'] },
      { label: 'Charts (F&F / W&W)', links: ['Overview', 'Tech overview'] },
    ])
    expect(within(submenu).getByText('Rulebooks')).not.toBeNull()
  })

  it('keeps every link on the file it pointed at before, in a new tab', () => {
    render(menu())
    openMenu()
    openSubmenu('Rules')

    const hrefs: Record<string, string> = {
      'Base game': '/help/civilization-rules.pdf',
      'Fame and Fortune': '/help/civ-fame-and-fortune-rules.pdf',
      'Wisdom and Warfare': '/help/CI03_WW_Rulebook.pdf',
      'Official FAQ 2.0': '/help/Civilization FAQ_v2.0.pdf',
      'Unofficial rules summary':
        'https://boardgamegeek.com/thread/1111649/civilization-summary-official-and-unofficial-rules',
      Overview: '/help/Civ_Tech_FF-WW.-1.jpg',
      'Tech overview': '/help/Civ_Tech_FF-WW.-2.jpg',
    }
    for (const [name, href] of Object.entries(hrefs)) {
      const link = screen.getByRole('link', { name })
      expect(link.getAttribute('href')).toBe(href)
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noopener noreferrer')
      expect(link.querySelector('svg.nav-external')).not.toBeNull()
    }
  })

  it('keeps only one submenu open at a time', () => {
    render(menu({ player: user, screen: 'game', game: gameMenu() }))
    openMenu()

    openSubmenu('Rules')
    expect(screen.getByRole('link', { name: 'Base game' })).not.toBeNull()

    openSubmenu('Actions')
    expect(screen.queryByRole('link', { name: 'Base game' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Rules' }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('button', { name: 'Actions' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('starts folded again the next time the menu opens', () => {
    render(menu())
    openMenu()
    openSubmenu('Rules')
    fireEvent.click(closeButton())

    openMenu()

    expect(screen.getByRole('button', { name: 'Rules' }).getAttribute('aria-expanded')).toBe('false')
  })
})

describe('Navigation Actions submenu', () => {
  it('does not come back folded out after the game page went away and returned', () => {
    const game = gameMenu()
    const { rerender } = render(menu({ player: user, screen: 'game', game }))
    openMenu()
    openSubmenu('Actions')
    expect(screen.getByRole('button', { name: 'End game' })).toBeTruthy()

    rerender(menu({ player: user, screen: 'lobby', game: null }))
    expect(screen.queryByRole('button', { name: 'Actions' })).toBeNull()

    rerender(menu({ player: user, screen: 'game', game }))
    expect(screen.getByRole('button', { name: 'Actions' }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'End game' })).toBeNull()
  })

  it('is absent when no game page is showing', () => {
    render(menu({ player: user }))
    openMenu()

    expect(screen.queryByRole('button', { name: 'Actions' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete game' })).toBeNull()
    expect(screen.queryByText('Game')).toBeNull()
  })

  it('folds out Withdraw, End game and Delete game inline when the creator opens it', () => {
    render(menu({ player: user, screen: 'game', game: gameMenu() }))
    openMenu()

    const toggle = screen.getByRole('button', { name: 'Actions' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull()

    fireEvent.click(toggle)

    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(isOpen()).toBe(true)
    const submenu = screen.getByRole('group', { name: 'Actions' })
    expect(within(submenu).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Withdraw',
      'End game',
      'Delete game',
    ])
  })

  it('offers Withdraw, confirmed before it fires, but not Delete for a non-owner', () => {
    const onWithdraw = vi.fn()
    const onDelete = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(
      menu({
        player: user,
        screen: 'game',
        game: { canWithdraw: true, withdrawDisabled: false, onWithdraw, canDelete: false, deleteDisabled: false, onDelete, ...noEnd },
      }),
    )
    openMenu()
    openSubmenu('Actions')

    expect(screen.queryByRole('button', { name: 'Delete game' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'End game' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }))
    expect(window.confirm).toHaveBeenCalledWith('Withdraw from this game?')
    expect(onWithdraw).toHaveBeenCalledOnce()
    expect(isOpen()).toBe(false)
  })

  it('skips the action when the confirmation is declined', () => {
    const onDelete = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(
      menu({
        player: admin,
        screen: 'game',
        game: { canWithdraw: true, withdrawDisabled: false, onWithdraw: vi.fn(), canDelete: true, deleteDisabled: false, onDelete, ...noEnd },
      }),
    )
    openMenu()
    openSubmenu('Actions')

    fireEvent.click(screen.getByRole('button', { name: 'Delete game' }))

    expect(window.confirm).toHaveBeenCalledWith('Delete this game permanently?')
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('confirms Delete game before it fires', () => {
    const onDelete = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(menu({ player: admin, screen: 'game', game: gameMenu({ onDelete }) }))
    openMenu()
    openSubmenu('Actions')

    fireEvent.click(screen.getByRole('button', { name: 'Delete game' }))

    expect(onDelete).toHaveBeenCalledOnce()
  })

  it('disables Withdraw/Delete exactly as `withdrawDisabled`/`deleteDisabled` say', () => {
    render(
      menu({
        player: admin,
        screen: 'game',
        game: { canWithdraw: true, withdrawDisabled: true, onWithdraw: vi.fn(), canDelete: true, deleteDisabled: false, onDelete: vi.fn(), ...noEnd },
      }),
    )
    openMenu()
    openSubmenu('Actions')

    expect((screen.getByRole('button', { name: 'Withdraw' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Delete game' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('offers Delete but not Withdraw to an admin who never joined the game', () => {
    render(
      menu({
        player: admin,
        screen: 'game',
        game: { canWithdraw: false, withdrawDisabled: true, onWithdraw: vi.fn(), canDelete: true, deleteDisabled: false, onDelete: vi.fn(), ...noEnd },
      }),
    )
    openMenu()
    openSubmenu('Actions')

    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Delete game' })).not.toBeNull()
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

describe('Navigation great persons reference', () => {
  it.each([
    ['signed out', null],
    ['signed in', user],
  ])('offers Great persons when %s', (_label, player) => {
    render(menu({ player }))
    openMenu()
    expect(screen.getByRole('button', { name: 'Great persons' })).not.toBeNull()
  })

  it('opens the dialog and keeps it open after the menu closes', () => {
    render(menu())
    openMenu()

    fireEvent.click(screen.getByRole('button', { name: 'Great persons' }))

    expect(isOpen()).toBe(false)
    const dialog = screen.getByRole('dialog', { name: 'Great persons' })
    expect(dialog.closest('.nav-sheet')).toBeNull()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    // The opener is in the closed menu, so focus goes to the hamburger.
    expect(document.activeElement).toBe(hamburger())
  })
})

describe('Navigation end game dialog', () => {
  const menuElement = (game: GameMenuActions): React.JSX.Element =>
    menu({ player: user, screen: 'game', game })

  /** Opens the menu and its Actions submenu, then clicks End game. */
  const openDialog = (): HTMLElement => {
    openMenu()
    openSubmenu('Actions')
    fireEvent.click(screen.getByRole('button', { name: 'End game' }))
    return screen.getByRole('dialog', { name: 'End game' })
  }

  it('has no End game button when `canEnd` is false', () => {
    render(menuElement(gameMenu({ canEnd: false })))
    openMenu()
    openSubmenu('Actions')
    expect(screen.queryByRole('button', { name: 'End game' })).toBeNull()
  })

  it('opens a dialog listing No winner first, then every player', () => {
    render(menuElement(gameMenu()))

    const dialog = openDialog()

    // The dialog lives outside the closed menu, so it stays visible.
    expect(isOpen()).toBe(false)
    expect(dialog.closest('.nav-sheet')).toBeNull()
    const options = within(dialog).getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual(['No winner', 'cash1981', 's3s3', 'ola'])
    expect((within(dialog).getByRole('combobox', { name: 'Winner' }) as HTMLSelectElement).value).toBe('')
  })

  it('ends the game with the chosen winner and closes the dialog', () => {
    const onEnd = vi.fn()
    render(menuElement(gameMenu({ onEnd })))
    const dialog = openDialog()

    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Winner' }), { target: { value: 's3s3' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'End game' }))

    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledWith('s3s3')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('ends the game with no winner when No winner is kept', () => {
    const onEnd = vi.fn()
    render(menuElement(gameMenu({ onEnd })))
    const dialog = openDialog()

    fireEvent.click(within(dialog).getByRole('button', { name: 'End game' }))

    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledWith(undefined)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Cancel closes the dialog without ending the game', () => {
    const onEnd = vi.fn()
    render(menuElement(gameMenu({ onEnd })))
    const dialog = openDialog()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(onEnd).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(hamburger())
  })

  it('Escape closes the dialog without ending the game', () => {
    const onEnd = vi.fn()
    render(menuElement(gameMenu({ onEnd })))
    openDialog()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onEnd).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('disables the menu button while busy', () => {
    render(menuElement(gameMenu({ endDisabled: true })))
    openMenu()
    openSubmenu('Actions')
    expect((screen.getByRole('button', { name: 'End game' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('disables the confirm button if a busy state starts while the dialog is open', () => {
    const { rerender } = render(menuElement(gameMenu()))
    openDialog()

    rerender(menuElement(gameMenu({ endDisabled: true })))

    const dialog = screen.getByRole('dialog', { name: 'End game' })
    expect((within(dialog).getByRole('button', { name: 'End game' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('closes the dialog when the game can no longer be ended', () => {
    const { rerender } = render(menuElement(gameMenu()))
    openDialog()

    rerender(menuElement(gameMenu({ canEnd: false })))

    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
