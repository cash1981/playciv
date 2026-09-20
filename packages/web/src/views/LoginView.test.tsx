// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../lib/api.js'
import { LoginView } from './LoginView.js'

vi.mock('../lib/api.js', () => ({
  api: {
    login: vi.fn(),
    register: vi.fn(),
    forgotPassword: vi.fn().mockResolvedValue({ ok: true }),
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
