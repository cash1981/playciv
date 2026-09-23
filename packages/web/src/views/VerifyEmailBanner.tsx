/**
 * The unverified-account notice (issue #42). An account may sign in and read,
 * but the server refuses every write until the address is proven; this is the
 * reminder and the way to get another link. The UI only hides the work — the
 * server is the gate.
 */

import { useState } from 'react'

import { errorMessage } from '../App.js'
import { api } from '../lib/api.js'
import type { PlayerDto } from '../lib/api.js'

interface Props {
  readonly player: PlayerDto
}

export function VerifyEmailBanner({ player }: Props): React.JSX.Element {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // A provider that returned no address leaves nothing to send to, so the
  // notice asks for one first.
  const needsAddress = player.email === null

  async function resend(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (needsAddress && email.trim() === '') return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const target = needsAddress ? email.trim() : player.email
      await api.verifyEmailResend(needsAddress ? target : undefined)
      setNotice(`Verification email sent to ${target ?? ''}.`)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="verify-banner">
      <p>
        Your email address is not verified yet.{' '}
        {needsAddress
          ? 'Add an address and we will send you a verification link.'
          : `We sent a verification link to ${player.email}. Open it to finish.`}
      </p>

      {error !== null && <div className="error">{error}</div>}
      {notice !== null && <div className="notice">{notice}</div>}

      <form className="row" onSubmit={resend}>
        {needsAddress && (
          <label className="inline-label">
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>
        )}
        <button className="primary" type="submit" disabled={busy}>
          {needsAddress ? 'Send verification email' : 'Send new verification email'}
        </button>
      </form>
    </section>
  )
}
