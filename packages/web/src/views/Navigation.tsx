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

interface NavigationProps {
  readonly player: PlayerDto | null
  readonly screen: 'lobby' | 'admin' | 'highscore' | 'faq' | 'about' | 'game'
  readonly theme: Theme
  readonly onNavigate: (path: string) => void
  readonly onSignOut: () => void
  readonly onToggleTheme: () => void
}

export function Navigation({
  player,
  screen,
  theme,
  onNavigate,
  onSignOut,
  onToggleTheme,
}: NavigationProps): React.JSX.Element {
  const nextTheme = theme === 'dark' ? 'light' : 'dark'

  return (
    <header className="topbar">
      <a className="brand" href="/" onClick={(event) => navigate(event, '/', onNavigate)}>
        <strong>Civilization</strong>
        <span className="muted">playciv</span>
      </a>
      <nav className="site-navigation" aria-label="Main navigation">
        <a href="/faq">FAQ</a>
        <a href="/about">About</a>
        <a href="/highscore" onClick={(event) => navigate(event, '/highscore', onNavigate)}>Highscore</a>
        <details className="navigation-menu">
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
      <span className="spacer" />
      {player !== null && screen === 'game' && (
        <button onClick={() => onNavigate('/')}>Back to games</button>
      )}
      {player !== null && screen === 'admin' && (
        <button onClick={() => onNavigate('/')}>Back to games</button>
      )}
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
