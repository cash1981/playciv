// @vitest-environment jsdom

import { forwardRef, useImperativeHandle } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdminUserDto, BroadcastQueueDto, PlayerDto } from '../lib/api.js'
import { api } from '../lib/api.js'
import type { MarkdownEditorHandle, MarkdownEditorProps } from './MarkdownEditor.js'
import { AdminView } from './AdminView.js'

vi.mock('../lib/api.js', () => ({
  api: {
    adminUsers: vi.fn(),
    updateAdminUser: vi.fn(),
    deleteAdminUser: vi.fn(),
    broadcastEmail: vi.fn(),
    queueBroadcast: vi.fn(),
    broadcastQueue: vi.fn(),
    runBroadcastQueue: vi.fn(),
    cancelBroadcastQueue: vi.fn(),
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
  vi.mocked(api.broadcastQueue).mockResolvedValue({ queue: null })
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

  it('clears the body when nothing is deferred, even if an address failed', async () => {
    vi.mocked(api.broadcastEmail).mockResolvedValueOnce({
      sent: 5,
      sentTo: ['a@example.com'],
      skipped: { noAddress: 0, unsubscribed: 0, excluded: 0 },
      failed: [{ email: 'bad', reason: 'Not a valid email address' }],
      deferred: 0,
      stopReason: null,
    })
    renderView()

    fireEvent.change(bodyField(), { target: { value: 'Body' } })
    fireEvent.click(sendButton())

    expect(await screen.findByText('Sent to 5 players.', undefined, { timeout: 5_000 })).toBeTruthy()
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

const queueDto = (overrides: Partial<BroadcastQueueDto> = {}): BroadcastQueueDto => ({
  id: 'q1',
  subject: 'News',
  status: 'active',
  perRun: 50,
  includeUnsubscribed: false,
  createdAt: '2026-10-04T10:00:00.000Z',
  lastRunAt: null,
  counts: { pending: 100, sending: 0, sent: 0, failed: 0 },
  failed: [],
  stuck: [],
  ...overrides,
})

const user = (id: string, overrides: Partial<AdminUserDto> = {}): AdminUserDto => ({
  id,
  username: id,
  email: `${id}@example.com`,
  role: 'user',
  disabled: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
})

const queueButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: 'Queue it' }) as HTMLButtonElement
const perDayField = (): HTMLInputElement => screen.getByLabelText('Per day') as HTMLInputElement

describe('admin broadcast queue panel', () => {
  it('queues the composer message with the per-day number and the skip list', async () => {
    vi.mocked(api.queueBroadcast).mockResolvedValue({
      queue: queueDto(),
      skipped: { noAddress: 1, unsubscribed: 2, excluded: 3 },
      rejected: [{ email: 'bad', reason: 'Not a valid email address' }],
    })
    renderView()

    fireEvent.change(subjectField(), { target: { value: '  Queued  ' } })
    fireEvent.change(bodyField(), { target: { value: 'Hello' } })
    fireEvent.click(screen.getByLabelText('Also send to players who have unsubscribed'))
    fireEvent.change(screen.getByLabelText('Skip these addresses'), {
      target: { value: 'a@example.com, b@example.com\nc@example.com' },
    })
    fireEvent.change(perDayField(), { target: { value: '25' } })
    fireEvent.click(queueButton())

    await waitFor(
      () => {
        expect(vi.mocked(api.queueBroadcast)).toHaveBeenCalledWith('Queued', 'Hello', true, {
          perRun: 25,
          exclude: ['a@example.com', 'b@example.com', 'c@example.com'],
        })
      },
      { timeout: 5_000 },
    )
    expect(await screen.findByText(/Queued for 100 players/, undefined, { timeout: 5_000 })).toBeTruthy()
    expect(document.body.textContent).toContain('1 with an invalid address (bad)')
    // The message is stored on the server now, so the composer lets go of it.
    expect(bodyField().value).toBe('')
  })

  it('defaults to 50 a day', () => {
    renderView()
    expect(perDayField().value).toBe('50')
  })

  it('names the recipients and the days in the confirmation', async () => {
    vi.mocked(api.adminUsers).mockResolvedValue([
      ...Array.from({ length: 120 }, (_, index) => user(`u${index}`)),
      user('quiet', { email: null }),
      user('out', { disableEmail: true }),
      user('skipped', { email: 'skipped@example.com' }),
    ])
    renderView()
    // Wait for the user list to load before counting from it.
    await screen.findByText(/Page 1/, undefined, { timeout: 5_000 })

    fireEvent.change(bodyField(), { target: { value: 'Body' } })
    fireEvent.change(screen.getByLabelText('Skip these addresses'), {
      target: { value: 'SKIPPED@example.com' },
    })
    fireEvent.click(queueButton())

    const question = String(vi.mocked(window.confirm).mock.calls[0]?.[0])
    // 120 with an address, not the one without, the unsubscribed or the skipped.
    expect(question).toContain('about 120 players')
    expect(question).toContain('50 a day')
    expect(question).toContain('about 3 days')
  })

  it('does not queue when the confirmation is declined, or per day is out of range', () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    renderView()
    fireEvent.change(bodyField(), { target: { value: 'Body' } })

    fireEvent.click(queueButton())
    expect(vi.mocked(api.queueBroadcast)).not.toHaveBeenCalled()

    for (const bad of ['0', '101', '2.5', '']) {
      fireEvent.change(perDayField(), { target: { value: bad } })
      expect(queueButton().disabled).toBe(true)
    }
    fireEvent.change(perDayField(), { target: { value: '100' } })
    expect(queueButton().disabled).toBe(false)
  })

  it('shows the counts, last run, next run, failed rows and stuck rows of an active queue', async () => {
    vi.mocked(api.broadcastQueue).mockResolvedValue({
      queue: queueDto({
        counts: { pending: 40, sending: 2, sent: 50, failed: 1 },
        lastRunAt: '2026-10-04T17:00:00.000Z',
        failed: [{ email: 'bad@example.com', reason: 'Invalid `to` field.' }],
        stuck: ['stuck1@example.com', 'stuck2@example.com'],
      }),
    })
    renderView()

    expect(await screen.findByText('Sent: 50', undefined, { timeout: 5_000 })).toBeTruthy()
    const text = document.body.textContent ?? ''
    expect(text).toContain('Pending: 40')
    expect(text).toContain('Failed: 1')
    expect(text).toContain('Stuck: 2')
    expect(text).toContain('Next run: 17:00 UTC')
    expect(text).toContain('bad@example.com: Invalid `to` field.')
    expect(text).toContain('stuck1@example.com')
    expect(text).toContain('not sent again by themselves')
    expect(screen.getByRole('button', { name: 'Send next batch now' })).toBeTruthy()
    // One queue at a time: queueing another is not offered.
    fireEvent.change(bodyField(), { target: { value: 'Body' } })
    expect(queueButton().disabled).toBe(true)
  })

  it('shows a finished queue without the run and cancel buttons', async () => {
    vi.mocked(api.broadcastQueue).mockResolvedValue({
      queue: queueDto({ status: 'done', counts: { pending: 0, sending: 0, sent: 100, failed: 0 } }),
    })
    renderView()

    expect(await screen.findByText('Sent: 100', undefined, { timeout: 5_000 })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send next batch now' })).toBeNull()
    expect(document.body.textContent).not.toContain('Next run')
  })

  it('sends the next batch now and shows what it did', async () => {
    vi.mocked(api.broadcastQueue).mockResolvedValue({ queue: queueDto() })
    vi.mocked(api.runBroadcastQueue).mockResolvedValue({
      run: { ran: true, sent: 50, failed: 0, released: 0, stopReason: null, finished: false },
      queue: queueDto({ counts: { pending: 50, sending: 0, sent: 50, failed: 0 } }),
    })
    renderView()

    fireEvent.click(await screen.findByRole('button', { name: 'Send next batch now' }, { timeout: 5_000 }))

    expect(await screen.findByText('Sent 50, failed 0.', undefined, { timeout: 5_000 })).toBeTruthy()
    expect(vi.mocked(api.runBroadcastQueue)).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Pending: 50', undefined, { timeout: 5_000 })).toBeTruthy()
  })

  it('cancels the queue after a confirmation', async () => {
    vi.mocked(api.broadcastQueue).mockResolvedValue({ queue: queueDto() })
    vi.mocked(api.cancelBroadcastQueue).mockResolvedValue({ queue: queueDto({ status: 'cancelled' }) })
    renderView()

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }, { timeout: 5_000 }))

    expect(await screen.findByText('The queue was cancelled.', undefined, { timeout: 5_000 })).toBeTruthy()
    expect(vi.mocked(api.cancelBroadcastQueue)).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Send next batch now' })).toBeNull()
  })

  it('does not cancel when the confirmation is declined', async () => {
    vi.mocked(api.broadcastQueue).mockResolvedValue({ queue: queueDto() })
    vi.mocked(window.confirm).mockReturnValue(false)
    renderView()

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }, { timeout: 5_000 }))

    expect(vi.mocked(api.cancelBroadcastQueue)).not.toHaveBeenCalled()
  })

  it('reads the status when the panel opens, not on a timer', async () => {
    renderView()
    await waitFor(() => expect(vi.mocked(api.broadcastQueue)).toHaveBeenCalledTimes(1))

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(vi.mocked(api.broadcastQueue)).toHaveBeenCalledTimes(1)
  })
})
