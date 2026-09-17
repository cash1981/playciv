/**
 * The root component. Replaces the AngularJS app in old-civ-web.
 *
 * The small route state covers the landing page, admin, game and highscore.
 * No router library — the state is small enough for a union to
 * carry it.
 */

import { useCallback, useEffect, useState } from 'react'

import { ApiError, api, storeToken, storedToken } from './lib/api.js'
import type { PlayerDto } from './lib/api.js'
import { GameView } from './views/GameView.js'
import { HighscoreView } from './views/HighscoreView.js'
import { LandingView } from './views/LandingView.js'
import { LoginView } from './views/LoginView.js'
import { AdminView } from './views/AdminView.js'
import { Navigation } from './views/Navigation.js'
import { FaqView } from './views/FaqView.js'
import { AboutView } from './views/AboutView.js'
import { applyTheme, saveTheme, storedTheme, type Theme } from './theme.js'

type Screen =
  | { readonly name: 'lobby' }
  | { readonly name: 'admin' }
  | { readonly name: 'highscore' }
  | { readonly name: 'faq' }
  | { readonly name: 'about' }
  | { readonly name: 'game'; readonly gameId: string }

function screenFromPath(pathname: string): Screen {
  if (pathname === '/admin' || pathname === '/admin/') return { name: 'admin' }
  if (/^\/highscore\/?$/.test(pathname)) return { name: 'highscore' }
  if (/^\/faq\/?$/.test(pathname)) return { name: 'faq' }
  if (/^\/about\/?$/.test(pathname)) return { name: 'about' }
  const match = /^\/game\/([^/]+)\/?$/.exec(pathname)
  if (match === null) return { name: 'lobby' }

  const encodedGameId = match[1]
  if (encodedGameId === undefined) return { name: 'lobby' }
  try {
    return { name: 'game', gameId: decodeURIComponent(encodedGameId) }
  } catch {
    return { name: 'lobby' }
  }
}

export function App(): React.JSX.Element {
  const [player, setPlayer] = useState<PlayerDto | null>(null)
  const [showLogin, setShowLogin] = useState(false)
  const [checking, setChecking] = useState(true)
  const [screen, setScreen] = useState<Screen>(() => screenFromPath(window.location.pathname))
  const [theme, setTheme] = useState<Theme>(() => storedTheme())

  useEffect(() => {
    applyTheme(theme)
    saveTheme(theme)
  }, [theme])

  useEffect(() => {
    const onPopState = () => setScreen(screenFromPath(window.location.pathname))
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // A stored token may have expired, so it has to be tried against the server
  useEffect(() => {
    if (storedToken() === null) {
      setChecking(false)
      return
    }
    api
      .me()
      .then(setPlayer)
      .catch(() => storeToken(null))
      .finally(() => setChecking(false))
  }, [])

  const signOut = useCallback(() => {
    storeToken(null)
    setPlayer(null)
    setShowLogin(false)
    window.history.replaceState(null, '', '/')
    setScreen({ name: 'lobby' })
  }, [])

  const openGame = useCallback((gameId: string) => {
    window.history.pushState(null, '', `/game/${encodeURIComponent(gameId)}`)
    setScreen({ name: 'game', gameId })
  }, [])

  const openAdmin = useCallback(() => {
    window.history.pushState(null, '', '/admin')
    setScreen({ name: 'admin' })
  }, [])

  const backToGames = useCallback(() => {
    window.history.replaceState(null, '', '/')
    setScreen({ name: 'lobby' })
  }, [])

  const openHighscore = useCallback(() => {
    window.history.pushState(null, '', '/highscore')
    setScreen({ name: 'highscore' })
  }, [])

  const navigate = useCallback((path: string) => {
    if (path === '/') {
      backToGames()
    } else if (path === '/admin') {
      openAdmin()
    } else if (path === '/highscore') {
      openHighscore()
    } else if (path === '/faq') {
      window.history.pushState(null, '', '/faq')
      setScreen({ name: 'faq' })
    } else {
      window.history.pushState(null, '', path)
      setScreen({ name: 'lobby' })
    }
  }, [backToGames, openAdmin, openHighscore])

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }, [])

  if (checking) {
    return (
      <div className="app">
        <p className="muted">Loading …</p>
      </div>
    )
  }

  // The FAQ is public: it renders whether or not anyone is signed in.
  if (screen.name === 'faq') {
    return (
      <div className="app">
        <Navigation player={player} screen={screen.name} theme={theme} onNavigate={navigate} onSignOut={signOut} onToggleTheme={toggleTheme} />
        <FaqView />
      </div>
    )
  }

  // The About page is public: it renders whether or not anyone is signed in.
  if (screen.name === 'about') {
    return (
      <div className="app">
        <Navigation player={player} screen={screen.name} theme={theme} onNavigate={navigate} onSignOut={signOut} onToggleTheme={toggleTheme} />
        <AboutView />
      </div>
    )
  }

  // The highscore is public: it renders whether or not anyone is signed in.
  if (screen.name === 'highscore') {
    return (
      <div className="app">
        <Navigation player={player} screen={screen.name} theme={theme} onNavigate={navigate} onSignOut={signOut} onToggleTheme={toggleTheme} />
        <HighscoreView />
      </div>
    )
  }

  if (player === null) {
    if (showLogin) {
      return (
        <div className="app">
          <Navigation player={null} screen={screen.name} theme={theme} onNavigate={navigate} onSignOut={signOut} onToggleTheme={toggleTheme} />
          <button onClick={() => setShowLogin(false)}>Back</button>
          <LoginView
            onSignedIn={(signedIn) => {
              setPlayer(signedIn)
              setShowLogin(false)
            }}
          />
        </div>
      )
    }
    return (
      <div className="app">
        <Navigation player={null} screen={screen.name} theme={theme} onNavigate={navigate} onSignOut={signOut} onToggleTheme={toggleTheme} />
        <LandingView player={null} onOpenGame={openGame} onSignIn={() => setShowLogin(true)} />
      </div>
    )
  }

  return (
    <div className="app">
      <Navigation player={player} screen={screen.name} theme={theme} onNavigate={navigate} onSignOut={signOut} onToggleTheme={toggleTheme} />

      {screen.name === 'lobby' ? (
        <LandingView player={player} onOpenGame={openGame} onSignIn={signOut} />
      ) : screen.name === 'admin' ? (
        player.role === 'admin' ? (
          <AdminView player={player} onUnauthorized={signOut} onBack={backToGames} />
        ) : (
          <LandingView player={player} onOpenGame={openGame} onSignIn={signOut} />
        )
      ) : (
        <GameView
          gameId={screen.gameId}
          player={player}
          onUnauthorized={signOut}
          onDeleted={backToGames}
        />
      )}
    </div>
  )
}

/** Turns an error into something that can be shown. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return String(error)
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401
}
