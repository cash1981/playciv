/**
 * The screen the OAuth callback redirects into (issue #121). The server puts
 * one of three fragments on `${appOrigin}/auth/callback`: a session token, a
 * signed pending-registration token, or an error code. The fragment is read
 * once and then dropped from the address bar, so a session token never stays in
 * the URL or the history.
 */

import { useEffect, useRef, useState } from 'react'

import { errorMessage } from '../App.js'
import { api, storeToken } from '../lib/api.js'
import type { PlayerDto } from '../lib/api.js'
import { LoginView } from './LoginView.js'

interface Props {
  readonly onSignedIn: (player: PlayerDto) => void
}

type State =
  | { readonly kind: 'working' }
  | { readonly kind: 'complete'; readonly pending: string }
  | { readonly kind: 'error'; readonly message: string }

/** Provider error codes mapped to something a player can act on. */
export function oauthErrorMessage(code: string): string {
  switch (code) {
    case 'oauth_duplicate_email':
      return 'Several accounts use this email address. Please contact the admin.'
    case 'oauth_denied':
      return 'The sign-in was cancelled.'
    case 'oauth_state':
      return 'The sign-in link has expired. Please try again.'
    default:
      return 'Signing in with the provider failed. Please try again.'
  }
}

export function AuthCallbackView({ onSignedIn }: Props): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: 'working' })
  // React StrictMode runs effects twice in development; the fragment must be
  // consumed exactly once.
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    handled.current = true

    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    // A session or pending token is a credential. Drop the fragment before
    // anything is awaited, so it never stays in the address bar.
    window.history.replaceState(null, '', '/')

    const token = fragment.get('token')
    if (token !== null && token !== '') {
      storeToken(token)
      api
        .me()
        .then(onSignedIn)
        .catch(() => {
          storeToken(null)
          setState({
            kind: 'error',
            message: 'Your session could not be loaded. Please sign in again.',
          })
        })
      return
    }

    const pending = fragment.get('pending')
    if (pending !== null && pending !== '') {
      setState({ kind: 'complete', pending })
      return
    }

    const error = fragment.get('error')
    if (error !== null && error !== '') {
      setState({ kind: 'error', message: oauthErrorMessage(error) })
      return
    }

    setState({ kind: 'error', message: 'Sign-in failed. Please try again.' })
  }, [onSignedIn])

  if (state.kind === 'working') {
    return (
      <div className="center">
        <p className="muted">Signing you in …</p>
      </div>
    )
  }

  // A provider failure lands on the login screen, with the reason shown.
  if (state.kind === 'error') {
    return <LoginView onSignedIn={onSignedIn} initialError={state.message} />
  }

  return <CompletionForm pending={state.pending} onSignedIn={onSignedIn} />
}

interface CompletionProps {
  readonly pending: string
  readonly onSignedIn: (player: PlayerDto) => void
}

/** Username and the security question, exactly as `register` asks them. */
function CompletionForm({ pending, onSignedIn }: CompletionProps): React.JSX.Element {
  const [username, setUsername] = useState('')
  const [securityAnswer, setSecurityAnswer] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setError(null)
    // The same client-side gate the register form applies (issue #40); the
    // server checks it again.
    if (securityAnswer.toUpperCase() !== 'WRITING') {
      setError('Wrong answer to the security question')
      return
    }
    setBusy(true)
    try {
      const result = await api.completeRegistration(pending, username, securityAnswer)
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
      <h1>Complete your registration</h1>
      <p className="muted">
        Pick a username and answer the security question to finish signing in.
      </p>

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
          Security Question: What is China&apos;s starting tech?
          <input
            value={securityAnswer}
            onChange={(event) => setSecurityAnswer(event.target.value)}
          />
        </label>

        <div className="row">
          <button className="primary" type="submit" disabled={busy}>
            Finish
          </button>
        </div>
      </form>
    </div>
  )
}
