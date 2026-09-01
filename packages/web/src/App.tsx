/**
 * Rot-komponenten. Erstatter AngularJS-appen i old-civ-web.
 *
 * Tre skjermbilder: innlogging, spillisten og selve spillet. Ingen ruter-
 * bibliotek — tilstanden er liten nok til at en union holder.
 */

import { useCallback, useEffect, useState } from 'react'

import { ApiError, api, storeToken, storedToken } from './lib/api.js'
import type { PlayerDto } from './lib/api.js'
import { GameView } from './views/GameView.js'
import { LobbyView } from './views/LobbyView.js'
import { LoginView } from './views/LoginView.js'

type Screen = { readonly name: 'lobby' } | { readonly name: 'game'; readonly gameId: string }

export function App(): React.JSX.Element {
  const [player, setPlayer] = useState<PlayerDto | null>(null)
  const [checking, setChecking] = useState(true)
  const [screen, setScreen] = useState<Screen>({ name: 'lobby' })

  // Et lagret token kan være utløpt, så det må prøves mot serveren
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
    setScreen({ name: 'lobby' })
  }, [])

  if (checking) {
    return (
      <div className="app">
        <p className="muted">Laster …</p>
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
        <span className="muted">play by forum</span>
        <span className="spacer" />
        {screen.name === 'game' && (
          <button onClick={() => setScreen({ name: 'lobby' })}>Til spillisten</button>
        )}
        <span className="muted">{player.username}</span>
        <button onClick={signOut}>Logg ut</button>
      </header>

      {screen.name === 'lobby' ? (
        <LobbyView
          player={player}
          onOpenGame={(gameId) => setScreen({ name: 'game', gameId })}
          onUnauthorized={signOut}
        />
      ) : (
        <GameView gameId={screen.gameId} player={player} onUnauthorized={signOut} />
      )}
    </div>
  )
}

/** Gjør en feil om til noe som kan vises. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return String(error)
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401
}
