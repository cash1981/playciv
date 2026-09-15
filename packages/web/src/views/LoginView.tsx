/** Signing in and registering. Java: `AuthResource` and the AngularJS login page. */

import { useState } from 'react'

import { errorMessage } from '../App.js'
import { api, storeToken } from '../lib/api.js'
import type { PlayerDto } from '../lib/api.js'

interface Props {
  readonly onSignedIn: (player: PlayerDto) => void
}

export function LoginView({ onSignedIn }: Props): React.JSX.Element {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const result =
        mode === 'login'
          ? await api.login(username, password)
          : await api.register(username, password, email)
      storeToken(result.token)
      onSignedIn(result.player)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="center">
      <h1>Civilization</h1>
      <p className="muted">Play by forum. Sign in to continue.</p>

      {error !== null && <div className="error">{error}</div>}

      <form className="panel" onSubmit={submit}>
        <label>
          Username
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
          />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
          />
        </label>

        {mode === 'register' && (
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
            />
          </label>
        )}

        <div className="row">
          <button className="primary" type="submit" disabled={busy}>
            {mode === 'login' ? 'Sign in' : 'Register'}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login')
              setError(null)
            }}
          >
            {mode === 'login' ? 'Create an account' : 'I have an account'}
          </button>
        </div>
      </form>
    </div>
  )
}
