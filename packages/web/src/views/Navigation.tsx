import { useRef } from 'react'

import type { PlayerDto } from '../lib/api.js'
import type { Theme } from '../theme.js'

const helpLinks = [
  { href: '/help/Civ_Tech_FF-WW.-1.jpg', label: 'Fame and Fortune / Wisdom and Warfare overview' },
  { href: '/help/civilization-rules.pdf', label: 'Base game rulebook' },
  { href: '/help/civ-fame-and-fortune-rules.pdf', label: 'Fame and Fortune rulebook' },
  { href: '/help/CI03_WW_Rulebook.pdf', label: 'Wisdom and Warfare rulebook' },
  { href: '/help/Civilization FAQ_v2.0.pdf', label: 'Official FAQ 2.0' },
  { href: 'https://boardgamegeek.com/thread/1111649/civilization-summary-official-and-unofficial-rules', label: 'Unofficial rules summary' },
  { href: '/help/Civ_Tech_FF-WW.-2.jpg', label: 'Fame and Fortune / Wisdom and Warfare tech overview' },
] as const

/**
 * The game-scoped menu actions `GameView` exposes to this menu (issue #177):
 * Withdraw and Delete game move out of the game page's own button row and
 * into the site menu's "Game" section — the same navbar old-civ-web's
 * `nav.html` used for its "Game options"/"Admin settings" dropdowns. `null`
 * (or the prop left out) means no game page is showing, so the section is
 * not rendered. Confirmation dialogs stay at the click site, in this
 * component; `onWithdraw`/`onDelete` are the already-confirmed actions.
 */
export interface GameMenuActions {
  /** `false` for an admin viewing a game they never joined — see `canDelete`. */
  readonly canWithdraw: boolean
  readonly withdrawDisabled: boolean
  readonly onWithdraw: () => void
  readonly canDelete: boolean
  readonly deleteDisabled: boolean
  readonly onDelete: () => void
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
  const menuRef = useRef<HTMLDetailsElement>(null)

  // Close the menu after any link or button inside it is used. Clicking the
  // nested "Rules and help" summary itself does not match `a, button`, so it
  // only opens that submenu without closing this one.
  const closeMenuAfterAction = (event: React.MouseEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement
    if (target.closest('a, button') !== null) menuRef.current?.removeAttribute('open')
  }

  return (
    <header className="topbar">
      <a className="brand" href="/" onClick={(event) => navigate(event, '/', onNavigate)}>
        <img className="brand-icon" src="/favicon.ico" alt="" />
        <strong>Civilization</strong>
        <span className="muted">playciv</span>
      </a>
      <span className="brand-spacer" />
      <details className="navigation-menu main-menu" ref={menuRef}>
        <summary aria-label="Menu">
          <span className="hamburger-icon" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </summary>
        <div className="navigation-dropdown main-dropdown" onClick={closeMenuAfterAction}>
          <nav className="site-navigation" aria-label="Main navigation">
            <a href="/faq">FAQ</a>
            <a href="/about">About</a>
            <a href="/highscore" onClick={(event) => navigate(event, '/highscore', onNavigate)}>Highscore</a>
            <details className="navigation-menu rules-menu">
              <summary>Rules and help</summary>
              <div className="navigation-dropdown">
                {helpLinks.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            </details>
          </nav>

          {game !== null && (
            <div className="navigation-game-actions" role="group" aria-label="Game">
              <h3>Game</h3>
              {game.canWithdraw && (
                <button
                  className="danger"
                  disabled={game.withdrawDisabled}
                  onClick={() => {
                    if (window.confirm('Withdraw from this game?')) game.onWithdraw()
                  }}
                >
                  Withdraw
                </button>
              )}
              {game.canDelete && (
                <button
                  className="danger"
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

          <div className="topbar-actions">
            {player !== null && player.role === 'admin' && screen !== 'admin' && (
              <button onClick={() => onNavigate('/admin')}>Admin</button>
            )}
            <button onClick={onToggleTheme} aria-label={`Switch to ${nextTheme} theme`}>
              {theme === 'dark' ? 'Light theme' : 'Dark theme'}
            </button>
            {player === null ? (
              <span className="muted">Not signed in</span>
            ) : (
              <>
                <span className="muted">{player.username}</span>
                <button onClick={onSignOut}>Sign out</button>
              </>
            )}
          </div>
        </div>
      </details>
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
