// @vitest-environment jsdom

/**
 * The OAuth callback screen (issue #121). The server redirects into
 * `/auth/callback` with a session token, a pending-registration token or an
 * error code in the fragment; the screen reads it once and clears it.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PlayerDto } from '../lib/api.js'
import { api, storeToken } from '../lib/api.js'
import { AuthCallbackView, oauthErrorMessage } from './AuthCallbackView.js'

vi.mock('../lib/api.js', () => ({
  api: {
    me: vi.fn(),
    completeRegistration: vi.fn(),
    providers: vi.fn().mockResolvedValue([]),
    login: vi.fn(),
    register: vi.fn(),
    forgotPassword: vi.fn(),
  },
  storeToken: vi.fn(),
}))

const player: PlayerDto = {
  id: 'p1',
  username: 'cash1981',
  email: 'cash@playciv.app',
  role: 'user',
  disabled: false,
  disableEmail: false,
  emailVerified: true,
}

beforeEach(() => {
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('AuthCallbackView token fragment (issue #121)', () => {
  it('stores the session, loads the player and clears the fragment', async () => {
    const onSignedIn = vi.fn()
    window.location.hash = '#token=session-1'
    vi.mocked(api.me).mockResolvedValue(player)

    render(<AuthCallbackView onSignedIn={onSignedIn} />)

    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(player))
    expect(storeToken).toHaveBeenCalledWith('session-1')
    // The session token must not stay in the address bar or the history.
    expect(window.location.hash).toBe('')
    expect(window.location.pathname).toBe('/')
  })

  it('clears the session and shows the login when the token is rejected', async () => {
    const onSignedIn = vi.fn()
    window.location.hash = '#token=expired'
    vi.mocked(api.me).mockRejectedValue(new Error('unauthorized'))

    render(<AuthCallbackView onSignedIn={onSignedIn} />)

    expect(
      await screen.findByText('Your session could not be loaded. Please sign in again.'),
    ).toBeTruthy()
    expect(storeToken).toHaveBeenLastCalledWith(null)
    expect(onSignedIn).not.toHaveBeenCalled()
  })
})

describe('AuthCallbackView completion step (issue #121)', () => {
  it('completes the registration and stores the new session', async () => {
    const onSignedIn = vi.fn()
    window.location.hash = '#pending=pending-1'
    vi.mocked(api.completeRegistration).mockResolvedValue({ token: 'session-2', player })

    render(<AuthCallbackView onSignedIn={onSignedIn} />)

    fireEvent.change(await screen.findByLabelText('Username'), {
      target: { value: 'social-new' },
    })
    fireEvent.change(
      screen.getByLabelText("Security Question: What is China's starting tech?"),
      { target: { value: 'writing' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))

    await waitFor(() =>
      expect(vi.mocked(api.completeRegistration)).toHaveBeenCalledWith(
        'pending-1',
        'social-new',
        'writing',
      ),
    )
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(player))
    expect(storeToken).toHaveBeenCalledWith('session-2')
  })

  it('refuses a wrong security answer without calling the API', async () => {
    const onSignedIn = vi.fn()
    window.location.hash = '#pending=pending-1'

    render(<AuthCallbackView onSignedIn={onSignedIn} />)

    fireEvent.change(await screen.findByLabelText('Username'), {
      target: { value: 'social-new' },
    })
    fireEvent.change(
      screen.getByLabelText("Security Question: What is China's starting tech?"),
      { target: { value: 'the wheel' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))

    expect(await screen.findByText('Wrong answer to the security question')).toBeTruthy()
    expect(vi.mocked(api.completeRegistration)).not.toHaveBeenCalled()
  })
})

describe('AuthCallbackView error fragment (issue #121)', () => {
  it('shows the login screen with the duplicate-email message', async () => {
    window.location.hash = '#error=oauth_duplicate_email'

    render(<AuthCallbackView onSignedIn={vi.fn()} />)

    expect(
      await screen.findByText('Several accounts use this email address. Please contact the admin.'),
    ).toBeTruthy()
    // The normal login form is behind it, so the player can try again.
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
  })

  it('maps the provider error codes to readable messages', () => {
    expect(oauthErrorMessage('oauth_duplicate_email')).toBe(
      'Several accounts use this email address. Please contact the admin.',
    )
    expect(oauthErrorMessage('oauth_denied')).toBe('The sign-in was cancelled.')
    expect(oauthErrorMessage('oauth_state')).toContain('expired')
    expect(oauthErrorMessage('something_else')).toContain('failed')
  })

  it('shows the login screen when the fragment carries nothing useful', async () => {
    window.location.hash = ''

    render(<AuthCallbackView onSignedIn={vi.fn()} />)

    expect(await screen.findByText('Sign-in failed. Please try again.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
  })
})
