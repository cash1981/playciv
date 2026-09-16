/**
 * The root component. Replaces the AngularJS app in old-civ-web.
 *
 * Three screens: sign-in, the game list and the game itself. No router library —
 * the state is small enough for a union to carry it.
 */

import { useCallback, useEffect, useState } from 'react'

import { ApiError, api, storeToken, storedToken } from './lib/api.js'
import type { PlayerDto } from './lib/api.js'
import { GameView } from './views/GameView.js'
import { LobbyView } from './views/LobbyView.js'
import { LoginView } from './views/LoginView.js'
import { AdminView } from './views/AdminView.js'

type Screen =
  | { readonly name: 'lobby' }
  | { readonly name: 'admin' }
  | { readonly name: 'game'; readonly gameId: string }

function screenFromPath(pathname: string): Screen {
  if (pathname === '/admin' || pathname === '/admin/') return { name: 'admin' }
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
  const [checking, setChecking] = useState(true)
  const [screen, setScreen] = useState<Screen>(() => screenFromPath(window.location.pathname))

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

  if (checking) {
    return (
      <div className="app">
        <p className="muted">Loading …</p>
      </div>
    )
  }

  if (player === null) {
    return (
      <div className="app">
        <LoginView onSignedIn={setPlayer} />
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <strong>Civilization</strong>
        <span className="muted">playciv</span>
        <span className="spacer" />
        {screen.name === 'game' && (
          <button onClick={backToGames}>Back to games</button>
        )}
        {screen.name === 'admin' && (
          <button onClick={backToGames}>Back to games</button>
        )}
        {player.role === 'admin' && screen.name !== 'admin' && (
          <button onClick={openAdmin}>Admin</button>
        )}
        <span className="muted">{player.username}</span>
        <button onClick={signOut}>Sign out</button>
      </header>

      {screen.name === 'lobby' ? (
        <LobbyView
          player={player}
          onOpenGame={openGame}
          onUnauthorized={signOut}
        />
      ) : screen.name === 'admin' ? (
        player.role === 'admin' ? (
          <AdminView player={player} onUnauthorized={signOut} onBack={backToGames} />
        ) : (
          <LobbyView player={player} onOpenGame={openGame} onUnauthorized={signOut} />
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
