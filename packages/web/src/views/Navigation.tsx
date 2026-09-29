import { useEffect, useRef, useState } from 'react'

import type { PlayerDto } from '../lib/api.js'
import type { Theme } from '../theme.js'
import { EndGameDialog } from './EndGameDialog.js'
import { GreatPersonsDialog } from './GreatPersonsDialog.js'
import './Navigation.css'

/**
 * The Rules submenu (issue #209). Same files as the old flat "Rules and help"
 * list, now grouped; only the labels changed.
 */
const ruleGroups = [
  {
    label: 'Rulebooks',
    links: [
      { href: '/help/civilization-rules.pdf', label: 'Base game' },
      { href: '/help/civ-fame-and-fortune-rules.pdf', label: 'Fame and Fortune' },
      { href: '/help/CI03_WW_Rulebook.pdf', label: 'Wisdom and Warfare' },
    ],
  },
  {
    label: 'Help',
    links: [
      { href: '/help/Civilization FAQ_v2.0.pdf', label: 'Official FAQ 2.0' },
      { href: 'https://boardgamegeek.com/thread/1111649/civilization-summary-official-and-unofficial-rules', label: 'Unofficial rules summary' },
    ],
  },
  {
    label: 'Charts (F&F / W&W)',
    links: [
      { href: '/help/Civ_Tech_FF-WW.-1.jpg', label: 'Overview' },
      { href: '/help/Civ_Tech_FF-WW.-2.jpg', label: 'Tech overview' },
    ],
  },
] as const

type Submenu = 'rules' | 'actions'

/**
 * The game-scoped menu actions `GameView` exposes to this menu (issue #177):
 * Withdraw and Delete game move out of the game page's own button row and
 * into the site menu's "Actions" submenu — the same navbar old-civ-web's
 * `nav.html` used for its "Game options"/"Admin settings" dropdowns. `null`
 * (or the prop left out) means no game page is showing, so the submenu is
 * not rendered. Confirmation dialogs stay at the click site, in this
 * component; `onWithdraw`/`onDelete` are the already-confirmed actions.
 *
 * End game opens a dialog with a winner picker instead of a plain confirm, so
 * `onEnd` receives the chosen username, or `undefined` for "No winner".
 */
export interface GameMenuActions {
  /** `false` for an admin viewing a game they never joined — see `canDelete`. */
  readonly canWithdraw: boolean
  readonly withdrawDisabled: boolean
  readonly onWithdraw: () => void
  readonly canDelete: boolean
  readonly deleteDisabled: boolean
  readonly onDelete: () => void
  /** Creator or admin, and the game has not ended yet. */
  readonly canEnd: boolean
  readonly endDisabled: boolean
  /** Usernames offered as winner, from the projected view. */
  readonly endPlayers: readonly string[]
  readonly onEnd: (winner: string | undefined) => void
}

interface NavigationProps {
  readonly player: PlayerDto | null
  readonly screen: 'lobby' | 'admin' | 'highscore' | 'faq' | 'about' | 'game'
  readonly theme: Theme
  readonly onNavigate: (path: string) => void
  readonly onSignOut: () => void
  readonly onToggleTheme: () => void
  /** Set only while a game page is showing — see `GameMenuActions`. */
  readonly game?: GameMenuActions | null
}

export function Navigation({
  player,
  screen,
  theme,
  onNavigate,
  onSignOut,
  onToggleTheme,
  game = null,
}: NavigationProps): React.JSX.Element {
  const nextTheme = theme === 'dark' ? 'light' : 'dark'
  const [open, setOpen] = useState(false)
  // One submenu open at a time keeps the sheet short on a phone.
  const [submenu, setSubmenu] = useState<Submenu | null>(null)
  // The dialogs live outside the menu so they survive it closing.
  const [showGreatPersons, setShowGreatPersons] = useState(false)
  const [showEndGame, setShowEndGame] = useState(false)
  // Focus returns to the hamburger: the opener sits in the menu, which is
  // unmounted (and cannot take focus) by the time a dialog closes.
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const closeMenu = (): void => {
    setOpen(false)
    setSubmenu(null)
    menuButtonRef.current?.focus()
  }

  // Escape closes the menu, and so does a press outside it (only reachable on
  // desktop, where the menu is a dropdown; on a phone the sheet covers the page).
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      setSubmenu(null)
      menuButtonRef.current?.focus()
    }
    const onPointerDown = (event: Event): void => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      setOpen(false)
      setSubmenu(null)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  // Land on the close button so a keyboard or screen reader user starts inside
  // the sheet. Programmatic focus after a tap shows no focus ring.
  useEffect(() => {
    if (open) closeButtonRef.current?.focus()
  }, [open])

  // Choosing a link or action closes the menu; a submenu toggle (it carries
  // `aria-expanded`) only folds itself open or shut.
  const closeMenuAfterAction = (event: React.MouseEvent<HTMLDivElement>): void => {
    const control = (event.target as HTMLElement).closest('a, button')
    if (control !== null && !control.hasAttribute('aria-expanded')) closeMenu()
  }

  // Actions vanishes when the game page goes away; it must not come back folded out.
  useEffect(() => {
    if (game === null) setSubmenu((current) => (current === 'actions' ? null : current))
  }, [game])

  const toggleSubmenu = (name: Submenu): void => setSubmenu((current) => (current === name ? null : name))

  return (
    <header className="topbar">
      <a className="brand" href="/" onClick={(event) => navigate(event, '/', onNavigate)}>
        <img className="brand-icon" src="/favicon.ico" alt="" />
        <strong>Civilization</strong>
        <span className="muted">playciv</span>
      </a>
      <span className="brand-spacer" />
      <div className="main-menu" ref={menuRef}>
        <button
          type="button"
          className="nav-trigger"
          ref={menuButtonRef}
          aria-label="Menu"
          aria-expanded={open}
          onClick={() => {
            if (open) closeMenu()
            else setOpen(true)
          }}
        >
          <span className="hamburger-icon" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </button>
        {open && (
          <div className="nav-sheet" id="main-menu-sheet">
            <div className="nav-sheet-header">
              <span className="nav-sheet-title">Menu</span>
              <button
                type="button"
                className="nav-close"
                ref={closeButtonRef}
                aria-label="Close menu"
                onClick={closeMenu}
              >
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
                  <path d="M3 3l10 10M13 3L3 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="nav-sheet-body" onClick={closeMenuAfterAction}>
              <nav className="site-navigation" aria-label="Main navigation">
                <a className="nav-row" href="/faq">FAQ</a>
                <a className="nav-row" href="/about">About</a>
                <a className="nav-row" href="/highscore" onClick={(event) => navigate(event, '/highscore', onNavigate)}>
                  Highscore
                </a>
                <button type="button" className="nav-row" onClick={() => setShowGreatPersons(true)}>
                  Great persons
                </button>
                <button
                  type="button"
                  className="nav-row nav-toggle"
                  aria-expanded={submenu === 'rules'}
                  onClick={() => toggleSubmenu('rules')}
                >
                  <span>Rules</span>
                  <Chevron />
                </button>
                {submenu === 'rules' && (
                  <div className="nav-submenu" id="nav-submenu-rules" role="group" aria-label="Rules">
                    {ruleGroups.map((group) => (
                      <div key={group.label} className="nav-group" role="group" aria-label={group.label}>
                        <div className="nav-group-label" aria-hidden="true">{group.label}</div>
                        {group.links.map((link) => (
                          <a
                            key={link.href}
                            className="nav-sub-row"
                            href={link.href}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <span>{link.label}</span>
                            <ExternalIcon />
                          </a>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </nav>

              {game !== null && (
                <div className="nav-actions">
                  <button
                    type="button"
                    className="nav-row nav-toggle"
                    aria-expanded={submenu === 'actions'}
                    onClick={() => toggleSubmenu('actions')}
                  >
                    <span>Actions</span>
                    <Chevron />
                  </button>
                  {submenu === 'actions' && (
                    <div className="nav-submenu" id="nav-submenu-actions" role="group" aria-label="Actions">
                      {game.canWithdraw && (
                        <button
                          type="button"
                          className="nav-sub-row nav-danger"
                          disabled={game.withdrawDisabled}
                          onClick={() => {
                            if (window.confirm('Withdraw from this game?')) game.onWithdraw()
                          }}
                        >
                          Withdraw
                        </button>
                      )}
                      {game.canEnd && (
                        <button
                          type="button"
                          className="nav-sub-row nav-danger"
                          disabled={game.endDisabled}
                          onClick={() => setShowEndGame(true)}
                        >
                          End game
                        </button>
                      )}
                      {game.canDelete && (
                        <button
                          type="button"
                          className="nav-sub-row nav-danger"
                          disabled={game.deleteDisabled}
                          onClick={() => {
                            if (window.confirm('Delete this game permanently?')) game.onDelete()
                          }}
                        >
                          Delete game
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="nav-footer">
                <button type="button" className="nav-pill" onClick={onToggleTheme} aria-label={`Switch to ${nextTheme} theme`}>
                  {theme === 'dark' ? 'Light theme' : 'Dark theme'}
                </button>
                {player !== null && player.role === 'admin' && screen !== 'admin' && (
                  <button type="button" className="nav-pill" onClick={() => onNavigate('/admin')}>
                    Admin
                  </button>
                )}
                {player === null ? (
                  <span className="nav-user muted">Not signed in</span>
                ) : (
                  <>
                    <span className="nav-user muted">{player.username}</span>
                    <button type="button" className="nav-pill" onClick={onSignOut}>
                      Sign out
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      {showGreatPersons && (
        <GreatPersonsDialog
          returnFocusTo={menuButtonRef}
          onClose={() => setShowGreatPersons(false)}
        />
      )}
      {showEndGame && game !== null && game.canEnd && (
        <EndGameDialog
          players={game.endPlayers}
          busy={game.endDisabled}
          returnFocusTo={menuButtonRef}
          onClose={() => setShowEndGame(false)}
          onConfirm={(winner) => {
            setShowEndGame(false)
            game.onEnd(winner)
          }}
        />
      )}
    </header>
  )
}

function navigate(
  event: React.MouseEvent<HTMLAnchorElement>,
  path: string,
  onNavigate: (path: string) => void,
): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  onNavigate(path)
}

/** Small chevron; the stylesheet turns it over while its submenu is open. */
function Chevron(): React.JSX.Element {
  return (
    <svg className="nav-chevron" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      <path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Marks the Rules entries as opening in a new tab. */
function ExternalIcon(): React.JSX.Element {
  return (
    <svg className="nav-external" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      <path d="M5 2.5H2.5v7h7V7M7 2.5h2.5V5M9.5 2.5L5.5 6.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
