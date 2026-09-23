// @vitest-environment jsdom

/**
 * The unverified-account banner (issue #42): it names the current address, or
 * asks for one when the account has none, and re-sends the verification link.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PlayerDto } from '../lib/api.js'
import { api } from '../lib/api.js'
import { VerifyEmailBanner } from './VerifyEmailBanner.js'

vi.mock('../lib/api.js', () => ({
  api: { verifyEmailResend: vi.fn() },
  // `errorMessage` narrows on `ApiError`; the failure test needs the class.
  ApiError: class ApiError extends Error {},
}))

const unverified: PlayerDto = {
  id: 'p1',
  username: 'cash1981',
  email: 'cash@playciv.app',
  role: 'user',
  disabled: false,
  disableEmail: false,
  emailVerified: false,
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('VerifyEmailBanner (issue #42)', () => {
  it('re-sends to the current address and says so', async () => {
    vi.mocked(api.verifyEmailResend).mockResolvedValue({ ok: true })
    render(<VerifyEmailBanner player={unverified} />)

    expect(screen.getByText(/cash@playciv.app/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send new verification email' }))

    await waitFor(() =>
      expect(vi.mocked(api.verifyEmailResend)).toHaveBeenCalledWith(undefined),
    )
    expect(
      await screen.findByText('Verification email sent to cash@playciv.app.'),
    ).toBeTruthy()
  })

  it('asks for an address when the account has none', async () => {
    vi.mocked(api.verifyEmailResend).mockResolvedValue({ ok: true })
    render(<VerifyEmailBanner player={{ ...unverified, email: null }} />)

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'new@playciv.app' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send verification email' }))

    await waitFor(() =>
      expect(vi.mocked(api.verifyEmailResend)).toHaveBeenCalledWith('new@playciv.app'),
    )
    expect(
      await screen.findByText('Verification email sent to new@playciv.app.'),
    ).toBeTruthy()
  })

  it('shows the server error when the re-send fails', async () => {
    vi.mocked(api.verifyEmailResend).mockRejectedValue(new Error('EMAIL_TAKEN'))
    render(<VerifyEmailBanner player={unverified} />)

    fireEvent.click(screen.getByRole('button', { name: 'Send new verification email' }))

    expect(await screen.findByText('EMAIL_TAKEN')).toBeTruthy()
  })
})
