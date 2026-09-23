// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../lib/api.js'
import { LoginView } from './LoginView.js'

vi.mock('../lib/api.js', () => ({
  api: {
    login: vi.fn(),
    register: vi.fn().mockResolvedValue({
      token: 'token',
      player: {
        id: 'p1',
        username: 'cash1981',
        email: null,
        role: 'user',
        disabled: false,
        disableEmail: false,
        emailVerified: true,
      },
    }),
    forgotPassword: vi.fn().mockResolvedValue({ ok: true }),
    providers: vi.fn().mockResolvedValue([]),
  },
  storeToken: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('LoginView forgot password (issue #37)', () => {
  it('sends the email and the new password and shows the confirmation', async () => {
    render(<LoginView onSignedIn={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'cash@playciv.com' },
    })
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'hemmelig' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(vi.mocked(api.forgotPassword)).toHaveBeenCalledWith('cash@playciv.com', 'hemmelig')
    })
    expect(await screen.findByText(/Email verification is sent/)).toBeTruthy()
  })
})

/** Fill the register form; `answer` is typed into the security-question field. */
function fillRegisterForm(answer: string): void {
  fireEvent.click(screen.getByRole('button', { name: 'Create an account' }))
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'cash1981' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hemmelig' } })
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'cash@playciv.com' },
  })
  fireEvent.change(
    screen.getByLabelText("Security Question: What is China's starting tech?"),
    { target: { value: answer } },
  )
  fireEvent.click(screen.getByRole('button', { name: 'Register' }))
}

describe('LoginView register security question (issue #40)', () => {
  it('refuses a wrong answer without calling the API', async () => {
    render(<LoginView onSignedIn={vi.fn()} />)
    fillRegisterForm('the wheel')

    expect(await screen.findByText('Wrong answer to the security question')).toBeTruthy()
    expect(vi.mocked(api.register)).not.toHaveBeenCalled()
  })

  it('sends the answer to the API when it is right', async () => {
    const onSignedIn = vi.fn()
    render(<LoginView onSignedIn={onSignedIn} />)
    fillRegisterForm('writing')

    await waitFor(() => {
      expect(vi.mocked(api.register)).toHaveBeenCalledWith(
        'cash1981',
        'hemmelig',
        'cash@playciv.com',
        'writing',
      )
    })
    expect(onSignedIn).toHaveBeenCalled()
  })
})

describe('LoginView social providers (issue #121)', () => {
  it('links to each configured provider', async () => {
    vi.mocked(api.providers).mockResolvedValue([
      { id: 'google', displayName: 'Google' },
      { id: 'discord', displayName: 'Discord' },
    ])
    render(<LoginView onSignedIn={vi.fn()} />)

    const google = await screen.findByRole('link', { name: 'Sign in with Google' })
    expect(google.getAttribute('href')).toBe('/api/auth/oauth/google')
    expect(
      screen.getByRole('link', { name: 'Sign in with Discord' }).getAttribute('href'),
    ).toBe('/api/auth/oauth/discord')
  })

  it('hides the section when no provider is configured', async () => {
    vi.mocked(api.providers).mockResolvedValue([])
    render(<LoginView onSignedIn={vi.fn()} />)

    await waitFor(() => expect(vi.mocked(api.providers)).toHaveBeenCalled())
    expect(screen.queryByText('or sign in with')).toBeNull()
  })

  it('hides the section when the provider call fails', async () => {
    vi.mocked(api.providers).mockRejectedValue(new Error('down'))
    render(<LoginView onSignedIn={vi.fn()} />)

    await waitFor(() => expect(vi.mocked(api.providers)).toHaveBeenCalled())
    expect(screen.queryByText('or sign in with')).toBeNull()
  })
})
