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
  vi.mocked(api.broadcastEmail).mockResolvedValue({ sent: 2, skipped: 1 })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('admin email broadcast form (issue #92)', () => {
  it('sends the subject, body and checkbox and shows the counts', async () => {
    renderView()

    fireEvent.change(subjectField(), { target: { value: 'A message' } })
    fireEvent.change(bodyField(), { target: { value: 'Hello **everyone**' } })
    fireEvent.click(screen.getByLabelText('Also send to players who have unsubscribed'))
    fireEvent.click(sendButton())

    await waitFor(
      () => {
        expect(vi.mocked(api.broadcastEmail)).toHaveBeenCalledWith(
          'A message',
          'Hello **everyone**',
          true,
        )
      },
      // The suite runs alongside the other packages; give the async send room.
      { timeout: 5_000 },
    )
    expect(
      await screen.findByText('Sent to 2 players; 1 skipped.', undefined, { timeout: 5_000 }),
    ).toBeTruthy()
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
})
