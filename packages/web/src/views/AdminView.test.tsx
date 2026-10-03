// @vitest-environment jsdom

import { forwardRef, useImperativeHandle } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PlayerDto } from '../lib/api.js'
import { api } from '../lib/api.js'
import type { MarkdownEditorHandle, MarkdownEditorProps } from './MarkdownEditor.js'
import { AdminView } from './AdminView.js'

vi.mock('../lib/api.js', () => ({
  api: {
    adminUsers: vi.fn(),
    updateAdminUser: vi.fn(),
    deleteAdminUser: vi.fn(),
    broadcastEmail: vi.fn(),
  },
}))

/** The editor as a plain textarea, so the test never loads Milkdown Crepe. */
const FakeEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function FakeEditor({ value, onChange, readOnly, ariaLabel }, ref) {
    useImperativeHandle(ref, () => ({ getMarkdown: () => value }))
    return (
      <textarea
        aria-label={ariaLabel}
        readOnly={readOnly}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  },
)

const admin: PlayerDto = {
  id: 'admin-1',
  username: 'cash',
  email: 'cash@playciv.app',
  role: 'admin',
  disabled: false,
}

function renderView(): void {
  render(
    <AdminView
      player={admin}
      onUnauthorized={vi.fn()}
      onBack={vi.fn()}
      editorComponent={FakeEditor}
    />,
  )
}

const subjectField = (): HTMLInputElement =>
  screen.getByLabelText('Subject') as HTMLInputElement
const bodyField = (): HTMLTextAreaElement =>
  screen.getByLabelText('Email body') as HTMLTextAreaElement
const sendButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: 'Send email' }) as HTMLButtonElement

beforeEach(() => {
  vi.mocked(api.adminUsers).mockResolvedValue([])
  vi.mocked(api.broadcastEmail).mockResolvedValue({
    sent: 2,
    sentTo: ['a@example.com', 'b@example.com'],
    skipped: { noAddress: 1, unsubscribed: 3, excluded: 4 },
    failed: [],
    deferred: 0,
    stopReason: null,
  })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('admin email broadcast form (issue #92)', () => {
  it('sends the subject, body and checkbox and shows the result', async () => {
    renderView()

    // Padded subject: the trim is what reaches the API.
    fireEvent.change(subjectField(), { target: { value: '  A message  ' } })
    fireEvent.change(bodyField(), { target: { value: 'Hello **everyone**' } })
    fireEvent.click(screen.getByLabelText('Also send to players who have unsubscribed'))
    fireEvent.click(sendButton())

    await waitFor(
      () => {
        expect(vi.mocked(api.broadcastEmail)).toHaveBeenCalledWith(
          'A message',
          'Hello **everyone**',
          true,
          { exclude: [] },
        )
      },
      // The suite runs alongside the other packages; give the async send room.
      { timeout: 5_000 },
    )
    expect(await screen.findByText('Sent to 2 players.', undefined, { timeout: 5_000 })).toBeTruthy()
    // The body is cleared on success, ready for the next message.
    expect(bodyField().value).toBe('')
  })

  it('defaults the subject to the old wording with the current domain', () => {
    renderView()
    expect(subjectField().value).toBe('Message from cash at playciv.app')
  })

  it('keeps the send button disabled until there is a subject and a body', () => {
    renderView()

    // Default subject, empty body.
    expect(sendButton().disabled).toBe(true)

    fireEvent.change(bodyField(), { target: { value: 'Body' } })
    expect(sendButton().disabled).toBe(false)

    fireEvent.change(subjectField(), { target: { value: '   ' } })
    expect(sendButton().disabled).toBe(true)
  })

  it('does not send when the confirmation is declined', () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    renderView()

    fireEvent.change(bodyField(), { target: { value: 'Body' } })
    fireEvent.click(sendButton())

    expect(vi.mocked(api.broadcastEmail)).not.toHaveBeenCalled()
  })

  it('sends the skip list split on newlines, commas and spaces, and the limit', async () => {
    renderView()

    fireEvent.change(bodyField(), { target: { value: 'Body' } })
    fireEvent.change(screen.getByLabelText('Skip these addresses'), {
      target: { value: ' a@example.com,b@example.com\n\n  c@example.com d@example.com ,\n' },
    })
    fireEvent.change(screen.getByLabelText(/Send to at most/), { target: { value: '50' } })
    fireEvent.click(sendButton())

    await waitFor(
      () => {
        expect(vi.mocked(api.broadcastEmail)).toHaveBeenCalledWith(
          'Message from cash at playciv.app',
          'Body',
          false,
          {
            exclude: ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com'],
            limit: 50,
          },
        )
      },
      { timeout: 5_000 },
    )
  })

  it('mentions the limit in the confirmation', () => {
    renderView()

    fireEvent.change(bodyField(), { target: { value: 'Body' } })
    fireEvent.change(screen.getByLabelText(/Send to at most/), { target: { value: '30' } })
    fireEvent.click(sendButton())

    expect(vi.mocked(window.confirm).mock.calls[0]?.[0]).toContain('at most 30')
  })

  it('will not send while the limit is not a whole number of at least 1', () => {
    renderView()

    fireEvent.change(bodyField(), { target: { value: 'Body' } })
    for (const bad of ['0', '-3', '2.5']) {
      fireEvent.change(screen.getByLabelText(/Send to at most/), { target: { value: bad } })
      expect(sendButton().disabled).toBe(true)
    }
    fireEvent.change(screen.getByLabelText(/Send to at most/), { target: { value: '' } })
    expect(sendButton().disabled).toBe(false)
  })

  it('keeps the message body when the run did not finish, and clears it when it did', async () => {
    vi.mocked(api.broadcastEmail).mockResolvedValueOnce({
      sent: 100,
      sentTo: ['a@example.com'],
      skipped: { noAddress: 0, unsubscribed: 0, excluded: 0 },
      failed: [],
      deferred: 50,
      stopReason: 'Stopped after 45 seconds',
    })
    renderView()

    fireEvent.change(bodyField(), { target: { value: 'Body' } })
    fireEvent.click(sendButton())
    expect(await screen.findByText('Sent to 100 players.', undefined, { timeout: 5_000 })).toBeTruthy()
    expect(bodyField().value).toBe('Body')

    // The rerun finishes everything (the default mock), so the body goes.
    fireEvent.click(sendButton())
    expect(await screen.findByText('Sent to 2 players.', undefined, { timeout: 5_000 })).toBeTruthy()
    expect(bodyField().value).toBe('')
  })

  it('will not send a limit above 5000', () => {
    renderView()

    fireEvent.change(bodyField(), { target: { value: 'Body' } })
    fireEvent.change(screen.getByLabelText(/Send to at most/), { target: { value: '5001' } })
    expect(sendButton().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/Send to at most/), { target: { value: '5000' } })
    expect(sendButton().disabled).toBe(false)
  })

  it('summarises every count, each failure, the stop reason and the sent addresses', async () => {
    vi.mocked(api.broadcastEmail).mockResolvedValue({
      sent: 2,
      sentTo: ['a@example.com', 'b@example.com'],
      skipped: { noAddress: 11, unsubscribed: 12, excluded: 13 },
      failed: [{ email: 'bad@example.com', reason: 'Invalid `to` field.' }],
      deferred: 14,
      stopReason: 'Daily email quota exceeded',
    })
    renderView()

    fireEvent.change(bodyField(), { target: { value: 'Body' } })
    fireEvent.click(sendButton())

    expect(await screen.findByText('Sent to 2 players.', undefined, { timeout: 5_000 })).toBeTruthy()
    const text = document.body.textContent ?? ''
    expect(text).toContain('11 without an address')
    expect(text).toContain('12 unsubscribed')
    expect(text).toContain('13 on the skip list')
    expect(text).toContain('Not attempted yet: 14')
    expect(text).toContain('bad@example.com: Invalid `to` field.')
    expect(text).toContain('Daily email quota exceeded')
    const sentBox = screen.getByLabelText('Addresses sent in this run') as HTMLTextAreaElement
    expect(sentBox.readOnly).toBe(true)
    expect(sentBox.value).toBe('a@example.com\nb@example.com')
    expect(text).toContain('Paste these into the skip box')
  })
})
