/**
 * Signing in, registering and the forgot-password form. Java: `AuthResource`
 * and the AngularJS login page. Issue #37 added the third mode.
 */

import { useState } from 'react'

import { errorMessage } from '../App.js'
import { api, storeToken } from '../lib/api.js'
import type { PlayerDto } from '../lib/api.js'

interface Props {
  readonly onSignedIn: (player: PlayerDto) => void
}

type Mode = 'login' | 'register' | 'forgot'

export function LoginView({ onSignedIn }: Props): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [securityAnswer, setSecurityAnswer] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function switchMode(next: Mode): void {
    setMode(next)
    setError(null)
    setNotice(null)
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      if (mode === 'forgot') {
        await api.forgotPassword(email, password)
        // The server answers 200 whether or not the address is registered, so
        // this message is intentionally the same either way.
        setNotice('Email verification is sent. Check your inbox and open the link.')
        setPassword('')
        return
      }

      // Issue #40. The old client refused a wrong answer before sending
      // anything (`RegisterController.js:37`); the server checks it again.
      if (mode === 'register' && securityAnswer.toUpperCase() !== 'WRITING') {
        setError('Wrong answer to the security question')
        return
      }

      const result =
        mode === 'login'
          ? await api.login(username, password)
          : await api.register(username, password, email, securityAnswer)
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
      <p className="muted">Civilization the boardgame. Sign in to continue.</p>

      {error !== null && <div className="error">{error}</div>}
      {notice !== null && <div className="notice">{notice}</div>}

      <form className="panel" onSubmit={submit}>
        {mode === 'forgot' && (
          <p className="muted">
            Enter your email and your new password. An email will be sent with a verification
            link.
          </p>
        )}

        {mode !== 'forgot' && (
          <label>
            Username
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
            />
          </label>
        )}

        <label>
          {mode === 'forgot' ? 'New password' : 'Password'}
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
          />
        </label>

        {mode !== 'login' && (
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required={mode === 'forgot'}
            />
          </label>
        )}

        {mode === 'register' && (
          <label>
            Security Question: What is China&apos;s starting tech?
            <input
              value={securityAnswer}
              onChange={(event) => setSecurityAnswer(event.target.value)}
            />
          </label>
        )}

        <div className="row">
          <button className="primary" type="submit" disabled={busy}>
            {mode === 'login' ? 'Sign in' : mode === 'register' ? 'Register' : 'Send'}
          </button>
          {mode === 'login' ? (
            <>
              <button type="button" onClick={() => switchMode('register')}>
                Create an account
              </button>
              <button type="button" onClick={() => switchMode('forgot')}>
                Forgot password?
              </button>
            </>
          ) : (
            <button type="button" onClick={() => switchMode('login')}>
              I have an account
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
