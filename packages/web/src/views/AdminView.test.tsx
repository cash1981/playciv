// @vitest-environment jsdom

import { forwardRef, useImperativeHandle } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  AdminUserDto,
  BroadcastQueueDto,
  CleanupPreviewDto,
  MigrateChatPreviewDto,
  MigrateChatResultDto,
  PlayerDto,
} from '../lib/api.js'
import { ApiError, api } from '../lib/api.js'
import type { MarkdownEditorHandle, MarkdownEditorProps } from './MarkdownEditor.js'
import { AdminView } from './AdminView.js'

vi.mock('../lib/api.js', async (importOriginal) => ({
  // Keep the real ApiError: the view's error handling checks for it.
  ...(await importOriginal<typeof import('../lib/api.js')>()),
  api: {
    adminUsers: vi.fn(),
    updateAdminUser: vi.fn(),
    deleteAdminUser: vi.fn(),
    broadcastEmail: vi.fn(),
    queueBroadcast: vi.fn(),
    broadcastQueue: vi.fn(),
    runBroadcastQueue: vi.fn(),
    cancelBroadcastQueue: vi.fn(),
    releaseStuckBroadcastQueue: vi.fn(),
    cleanupPreview: vi.fn(),
    cleanFinishedGames: vi.fn(),
    migrateChatPreview: vi.fn(),
    migrateChat: vi.fn(),
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
      run: {
        ran: true,
        sent: 50,
        failed: 0,
        released: 0,
        indeterminate: 0,
        stopReason: null,
        finished: false,
      },
      queue: queueDto({ counts: { pending: 50, sending: 0, sent: 50, failed: 0 } }),
    })
    renderView()

    fireEvent.click(await screen.findByRole('button', { name: 'Send next batch now' }, { timeout: 5_000 }))

    expect(await screen.findByText('Sent 50, failed 0.', undefined, { timeout: 5_000 })).toBeTruthy()
    expect(vi.mocked(api.runBroadcastQueue)).toHaveBeenCalledTimes(1)
    // The confirmation said how many would go out: perRun 50 of the 100 pending.
    expect(String(vi.mocked(window.confirm).mock.calls[0]?.[0])).toContain('Up to 50 of the 100 pending')
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

  it('does not send the next batch when the confirmation is declined', async () => {
    vi.mocked(api.broadcastQueue).mockResolvedValue({ queue: queueDto() })
    vi.mocked(window.confirm).mockReturnValue(false)
    renderView()

    fireEvent.click(await screen.findByRole('button', { name: 'Send next batch now' }, { timeout: 5_000 }))

    expect(vi.mocked(api.runBroadcastQueue)).not.toHaveBeenCalled()
  })

  it('releases stuck rows only after a warning to check the Resend log', async () => {
    vi.mocked(api.broadcastQueue).mockResolvedValue({
      queue: queueDto({ counts: { pending: 0, sending: 2, sent: 98, failed: 0 }, stuck: ['a@example.com', 'b@example.com'] }),
    })
    vi.mocked(api.releaseStuckBroadcastQueue).mockResolvedValue({
      released: 2,
      queue: queueDto({ counts: { pending: 2, sending: 0, sent: 98, failed: 0 }, stuck: [] }),
    })
    renderView()

    fireEvent.click(await screen.findByRole('button', { name: 'Release stuck rows' }, { timeout: 5_000 }))

    const question = String(vi.mocked(window.confirm).mock.calls[0]?.[0])
    expect(question).toContain("Check Resend's email log first")
    expect(question).toContain('send them twice')
    expect(question).toContain('Do not use this while a run may be in progress')
    expect(await screen.findByText(/Released 2 stuck rows/, undefined, { timeout: 5_000 })).toBeTruthy()
    expect(vi.mocked(api.releaseStuckBroadcastQueue)).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Release stuck rows' })).toBeNull()
  })

  it('shows the server message when a release is refused because a run just started', async () => {
    vi.mocked(api.broadcastQueue).mockResolvedValue({
      queue: queueDto({ counts: { pending: 0, sending: 1, sent: 99, failed: 0 }, stuck: ['a@example.com'] }),
    })
    vi.mocked(api.releaseStuckBroadcastQueue).mockRejectedValue(
      new ApiError(409, 'RUN_IN_PROGRESS', 'A run started less than five minutes ago; wait and try again'),
    )
    renderView()

    fireEvent.click(await screen.findByRole('button', { name: 'Release stuck rows' }, { timeout: 5_000 }))

    expect(
      await screen.findByText('A run started less than five minutes ago; wait and try again', undefined, {
        timeout: 5_000,
      }),
    ).toBeTruthy()
    // The stuck row is still listed.
    expect(document.body.textContent).toContain('a@example.com')
  })

  it('says when a run could not confirm some mails instead of reading as nothing happened', async () => {
    vi.mocked(api.broadcastQueue).mockResolvedValue({ queue: queueDto() })
    vi.mocked(api.runBroadcastQueue).mockResolvedValue({
      run: {
        ran: true,
        sent: 0,
        failed: 0,
        released: 0,
        indeterminate: 50,
        stopReason: 'Could not get an answer from the mail provider: fetch failed.',
        finished: false,
      },
      queue: queueDto({ counts: { pending: 50, sending: 50, sent: 0, failed: 0 }, stuck: ['a@example.com'] }),
    })
    renderView()

    fireEvent.click(await screen.findByRole('button', { name: 'Send next batch now' }, { timeout: 5_000 }))

    expect(await screen.findByText(/50 not confirmed/, undefined, { timeout: 5_000 })).toBeTruthy()
    expect(document.body.textContent).toContain('Could not get an answer from the mail provider')
  })

  it('does not release stuck rows when the warning is declined', async () => {
    vi.mocked(api.broadcastQueue).mockResolvedValue({
      queue: queueDto({ counts: { pending: 0, sending: 1, sent: 99, failed: 0 }, stuck: ['a@example.com'] }),
    })
    vi.mocked(window.confirm).mockReturnValue(false)
    renderView()

    fireEvent.click(await screen.findByRole('button', { name: 'Release stuck rows' }, { timeout: 5_000 }))

    expect(vi.mocked(api.releaseStuckBroadcastQueue)).not.toHaveBeenCalled()
  })

  it('offers no release button on a queue that is no longer active', async () => {
    vi.mocked(api.broadcastQueue).mockResolvedValue({
      queue: queueDto({ status: 'cancelled', counts: { pending: 0, sending: 1, sent: 99, failed: 0 }, stuck: ['a@example.com'] }),
    })
    renderView()

    expect(await screen.findByText('Stuck: 1', undefined, { timeout: 5_000 })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Release stuck rows' })).toBeNull()
  })

  it('reads the status when the panel opens and not again however long it stays open', async () => {
    // Fake timers before the first render, so a polling interval or a timeout
    // chain started on mount would fire inside the advance below.
    vi.useFakeTimers()
    try {
      renderView()
      await vi.advanceTimersByTimeAsync(0)
      expect(vi.mocked(api.broadcastQueue)).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(60 * 60 * 1000)

      expect(vi.mocked(api.broadcastQueue)).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('clean up finished games panel', () => {
  const MB = 1024 * 1024
  const preview = (): CleanupPreviewDto => ({
    games: [
      { id: 'g-big', name: 'Big game', revisions: 120, removableRevisions: 119, removableBytes: 25 * MB },
      { id: 'g-small', name: 'Small game', revisions: 10, removableRevisions: 9, removableBytes: 2 * MB },
    ],
    totalRevisions: 128,
    totalBytes: 27 * MB,
  })
  const emptyPreview: CleanupPreviewDto = { games: [], totalRevisions: 0, totalBytes: 0 }

  async function openList(): Promise<void> {
    fireEvent.click(await screen.findByRole('button', { name: 'Show what can be cleaned' }, { timeout: 5_000 }))
    await screen.findByText('Big game', undefined, { timeout: 5_000 })
  }

  it('reads nothing until asked, then shows each game, its size and the total', async () => {
    vi.mocked(api.cleanupPreview).mockResolvedValue(preview())
    renderView()
    await screen.findByText('Clean up finished games', undefined, { timeout: 5_000 })
    expect(vi.mocked(api.cleanupPreview)).not.toHaveBeenCalled()

    await openList()

    expect(vi.mocked(api.cleanupPreview)).toHaveBeenCalledTimes(1)
    expect(screen.getByText('119 of 120')).toBeTruthy()
    expect(screen.getByText('25.0 MB')).toBeTruthy()
    expect(screen.getByText('2.0 MB')).toBeTruthy()
    // The total row.
    expect(screen.getByText('128')).toBeTruthy()
    expect(screen.getByText('27.0 MB')).toBeTruthy()
  })

  it('says what is kept and what is lost, how the size may not drop, and how to undo', async () => {
    renderView()
    const panel = (await screen.findByText('Clean up finished games', undefined, { timeout: 5_000 })).closest('section')
    const text = panel?.textContent ?? ''
    expect(text).toContain('final board, the log and the chat stay')
    expect(text).toContain('may not report a smaller size at once')
    expect(text).toContain('wrangler d1 time-travel info playciv')
  })

  it('names the game and the size in the confirmation, and cleans just that game', async () => {
    vi.mocked(api.cleanupPreview).mockResolvedValueOnce(preview()).mockResolvedValueOnce({
      games: [preview().games[1] as CleanupPreviewDto['games'][number]],
      totalRevisions: 9,
      totalBytes: 2 * MB,
    })
    vi.mocked(api.cleanFinishedGames).mockResolvedValue({
      games: [{ id: 'g-big', name: 'Big game', removedRevisions: 119, removedBytes: 25 * MB }],
      totalRevisions: 119,
      totalBytes: 25 * MB,
      remaining: 0,
    })
    renderView()
    await openList()

    fireEvent.click(screen.getByRole('button', { name: 'Clean up Big game' }))

    const question = String(vi.mocked(window.confirm).mock.calls[0]?.[0])
    expect(question).toContain('Big game')
    expect(question).toContain('119 of its 120')
    expect(question).toContain('25.0 MB')
    expect(question).toContain('replay of the game is lost')
    expect(question).toContain('final board, the log and the chat stay')
    expect(await screen.findByText(/Removed 119 saved states \(about 25.0 MB\) from 1 game\./, undefined, { timeout: 5_000 })).toBeTruthy()
    expect(vi.mocked(api.cleanFinishedGames)).toHaveBeenCalledWith('g-big')
    // The list is read again, and the cleaned game is gone from it.
    await waitFor(() => expect(screen.queryByText('Big game')).toBeNull(), { timeout: 5_000 })
    expect(vi.mocked(api.cleanupPreview)).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Small game')).toBeTruthy()
  })

  it('cleans every game with one request and tells when more are left', async () => {
    vi.mocked(api.cleanupPreview).mockResolvedValueOnce(preview()).mockResolvedValueOnce(preview())
    vi.mocked(api.cleanFinishedGames).mockResolvedValue({
      games: [{ id: 'g-big', name: 'Big game', removedRevisions: 119, removedBytes: 25 * MB }],
      totalRevisions: 119,
      totalBytes: 25 * MB,
      remaining: 1,
    })
    renderView()
    await openList()

    fireEvent.click(screen.getByRole('button', { name: 'Clean up all' }))

    const question = String(vi.mocked(window.confirm).mock.calls[0]?.[0])
    expect(question).toContain('2 finished games')
    expect(question).toContain('128 saved states')
    expect(question).toContain('27.0 MB')
    expect(question).toContain('limited number of games')
    expect(question).not.toMatch(/at most \d+/)
    expect(question).toContain('replay of the game is lost')
    expect(await screen.findByText(/1 more game is left; press "Clean up all" again/, undefined, { timeout: 5_000 })).toBeTruthy()
    // No game id: the server takes the largest finished games.
    expect(vi.mocked(api.cleanFinishedGames)).toHaveBeenCalledWith(undefined)
    expect(vi.mocked(api.cleanupPreview)).toHaveBeenCalledTimes(2)
  })

  it('cleans nothing when the confirmation is declined', async () => {
    vi.mocked(api.cleanupPreview).mockResolvedValue(preview())
    vi.mocked(window.confirm).mockReturnValue(false)
    renderView()
    await openList()

    fireEvent.click(screen.getByRole('button', { name: 'Clean up Big game' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clean up all' }))

    expect(vi.mocked(window.confirm)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(api.cleanFinishedGames)).not.toHaveBeenCalled()
  })

  it('shows the server message when the game turns out to be running, and keeps the list', async () => {
    vi.mocked(api.cleanupPreview).mockResolvedValue(preview())
    vi.mocked(api.cleanFinishedGames).mockRejectedValue(
      new ApiError(409, 'GAME_ACTIVE', 'The game is still running; only finished games can be cleaned up'),
    )
    renderView()
    await openList()

    fireEvent.click(screen.getByRole('button', { name: 'Clean up Small game' }))

    expect(
      await screen.findByText('The game is still running; only finished games can be cleaned up', undefined, {
        timeout: 5_000,
      }),
    ).toBeTruthy()
    expect(screen.getByText('Small game')).toBeTruthy()
  })

  it('says so when no finished game has anything to clean', async () => {
    vi.mocked(api.cleanupPreview).mockResolvedValue(emptyPreview)
    renderView()

    fireEvent.click(await screen.findByRole('button', { name: 'Show what can be cleaned' }, { timeout: 5_000 }))

    expect(await screen.findByText('No finished game has anything to clean up.', undefined, { timeout: 5_000 })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Clean up all' })).toBeNull()
  })
})

describe('move old games to the single chat panel', () => {
  const preview = (): MigrateChatPreviewDto => ({
    games: [
      { id: 'g-old', name: 'Old game', active: true, orderRows: 14, drafts: 2 },
      { id: 'g-done', name: 'Finished game', active: false, orderRows: 1, drafts: 0 },
    ],
    totalOrderRows: 15,
    totalDrafts: 2,
    unchecked: 0,
  })
  const emptyPreview: MigrateChatPreviewDto = { games: [], totalOrderRows: 0, totalDrafts: 0, unchecked: 0 }
  const result = (overrides: Partial<MigrateChatResultDto> = {}): MigrateChatResultDto => ({
    games: [{ id: 'g-old', name: 'Old game', orderRows: 14, drafts: 2 }],
    totalOrderRows: 14,
    totalDrafts: 2,
    skipped: 0,
    partial: null,
    remaining: 0,
    ...overrides,
  })

  async function openList(): Promise<void> {
    fireEvent.click(await screen.findByRole('button', { name: 'Show what can be moved' }, { timeout: 5_000 }))
    await screen.findByText('Old game', undefined, { timeout: 5_000 })
  }

  it('reads nothing until asked, then shows each game, its orders, its drafts and the totals', async () => {
    vi.mocked(api.migrateChatPreview).mockResolvedValue(preview())
    renderView()
    await screen.findByText('Move old games to the single chat', undefined, { timeout: 5_000 })
    expect(vi.mocked(api.migrateChatPreview)).not.toHaveBeenCalled()

    await openList()

    expect(vi.mocked(api.migrateChatPreview)).toHaveBeenCalledTimes(1)
    expect(screen.getByText('14')).toBeTruthy()
    // The finished game is marked, and is listed like any other
    expect(screen.getByText('Finished game')).toBeTruthy()
    expect(screen.getByText('ended')).toBeTruthy()
    // The total row.
    expect(screen.getByText('15')).toBeTruthy()
  })

  it('says what is copied and that a draft stays private', async () => {
    renderView()
    const panel = (await screen.findByText('Move old games to the single chat', undefined, { timeout: 5_000 })).closest('section')
    const text = panel?.textContent ?? ''
    expect(text).toContain('copies the public orders into the timeline')
    expect(text).toContain('private note')
    expect(text).toContain('never published are not shown to anyone else')
  })

  it('names the game and the counts in the confirmation, and moves just that game', async () => {
    vi.mocked(api.migrateChatPreview).mockResolvedValueOnce(preview()).mockResolvedValueOnce({
      games: [preview().games[1] as MigrateChatPreviewDto['games'][number]],
      totalOrderRows: 1,
      totalDrafts: 0,
      unchecked: 0,
    })
    vi.mocked(api.migrateChat).mockResolvedValue(result())
    renderView()
    await openList()

    fireEvent.click(screen.getByRole('button', { name: 'Move Old game' }))

    const question = String(vi.mocked(window.confirm).mock.calls[0]?.[0])
    expect(question).toContain('Old game')
    expect(question).toContain('14 orders')
    expect(question).toContain('2 unpublished drafts')
    expect(question).toContain('private note')
    expect(await screen.findByText(/Moved 1 game: 14 orders copied, 2 drafts added to private notes\./, undefined, { timeout: 5_000 })).toBeTruthy()
    expect(screen.getByText(/Nothing is left to move\./)).toBeTruthy()
    expect(vi.mocked(api.migrateChat)).toHaveBeenCalledWith('g-old')
    // The list is read again, and the moved game is gone from it.
    await waitFor(() => expect(screen.queryByText('Old game')).toBeNull(), { timeout: 5_000 })
    expect(vi.mocked(api.migrateChatPreview)).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Finished game')).toBeTruthy()
  })

  it('names the game own button when a single game run ends partial, not Move all', async () => {
    vi.mocked(api.migrateChatPreview).mockResolvedValue(preview())
    vi.mocked(api.migrateChat).mockResolvedValue(result({ games: [], totalOrderRows: 0, totalDrafts: 0, partial: 'g-old', remaining: 1 }))
    renderView()
    await openList()

    fireEvent.click(screen.getByRole('button', { name: 'Move Old game' }))

    const notice = await screen.findByText(/Game g-old was only partly copied/, undefined, { timeout: 5_000 })
    expect(vi.mocked(api.migrateChat)).toHaveBeenCalledWith('g-old')
    expect(notice.textContent).toContain('press "Move" on Old game again.')
    expect(notice.textContent).not.toContain('Move all')
  })

  it('moves every game with one request and tells how many are left, until none are', async () => {
    vi.mocked(api.migrateChatPreview).mockResolvedValue(preview())
    vi.mocked(api.migrateChat)
      .mockResolvedValueOnce(result({ remaining: 1, skipped: 1, partial: 'g-done' }))
      .mockResolvedValueOnce(result({
        games: [{ id: 'g-done', name: 'Finished game', orderRows: 1, drafts: 0 }],
        totalOrderRows: 1,
        totalDrafts: 0,
        remaining: 0,
      }))
    renderView()
    await openList()

    fireEvent.click(screen.getByRole('button', { name: 'Move all' }))

    const question = String(vi.mocked(window.confirm).mock.calls[0]?.[0])
    expect(question).toContain('2 games')
    expect(question).toContain('15 orders')
    expect(question).toContain('2 unpublished drafts')
    expect(question).toContain('limited number of games')
    const first = await screen.findByText(/1 game is left; press "Move all" again\./, undefined, { timeout: 5_000 })
    expect(first.textContent).toContain('Moved 1 game: 14 orders copied, 2 drafts added to private notes.')
    expect(first.textContent).toContain('1 game was skipped because it changed meanwhile.')
    expect(first.textContent).toContain('Game g-done was only partly copied')
    // No game id: the server takes every game that has not been moved.
    expect(vi.mocked(api.migrateChat)).toHaveBeenCalledWith(undefined)

    fireEvent.click(screen.getByRole('button', { name: 'Move all' }))

    expect(await screen.findByText(/Moved 1 game: 1 order copied, 0 drafts added to private notes\. Nothing is left to move\./, undefined, { timeout: 5_000 })).toBeTruthy()
    expect(vi.mocked(api.migrateChat)).toHaveBeenCalledTimes(2)
  })

  it('moves nothing when the confirmation is declined', async () => {
    vi.mocked(api.migrateChatPreview).mockResolvedValue(preview())
    vi.mocked(window.confirm).mockReturnValue(false)
    renderView()
    await openList()

    fireEvent.click(screen.getByRole('button', { name: 'Move Old game' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move all' }))

    expect(vi.mocked(window.confirm)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(api.migrateChat)).not.toHaveBeenCalled()
  })

  it('shows the server message when the game changed, and keeps the list', async () => {
    vi.mocked(api.migrateChatPreview).mockResolvedValue(preview())
    vi.mocked(api.migrateChat).mockRejectedValue(
      new ApiError(409, 'CONFLICT', 'The game changed while it was being migrated; try again'),
    )
    renderView()
    await openList()

    fireEvent.click(screen.getByRole('button', { name: 'Move Old game' }))

    expect(
      await screen.findByText('The game changed while it was being migrated; try again', undefined, { timeout: 5_000 }),
    ).toBeTruthy()
    expect(screen.getByText('Old game')).toBeTruthy()
  })

  it('says how many games were not checked, and does not claim that every game has been moved', async () => {
    vi.mocked(api.migrateChatPreview).mockResolvedValue({ ...preview(), unchecked: 3 })
    renderView()
    await openList()

    expect(screen.getByText('3 more games were not checked, run the move again.')).toBeTruthy()
    expect(screen.queryByText('Every game has been moved to the single chat.')).toBeNull()
  })

  it('says it in the singular, and offers Move all when only unchecked games are left', async () => {
    vi.mocked(api.migrateChatPreview).mockResolvedValue({ ...emptyPreview, unchecked: 1 })
    vi.mocked(api.migrateChat).mockResolvedValue(result({ games: [], totalOrderRows: 0, totalDrafts: 0 }))
    renderView()

    fireEvent.click(await screen.findByRole('button', { name: 'Show what can be moved' }, { timeout: 5_000 }))

    expect(await screen.findByText('1 more game was not checked, run the move again.', undefined, { timeout: 5_000 })).toBeTruthy()
    expect(screen.queryByText('Every game has been moved to the single chat.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Move all' }))
    expect(String(vi.mocked(window.confirm).mock.calls[0]?.[0])).toContain('were not checked yet')
    await waitFor(() => expect(vi.mocked(api.migrateChat)).toHaveBeenCalledWith(undefined), { timeout: 5_000 })
  })

  it('shows no unchecked line when every game was checked', async () => {
    vi.mocked(api.migrateChatPreview).mockResolvedValue(preview())
    renderView()
    await openList()

    expect(screen.queryByText(/not checked, run the move again/)).toBeNull()
  })

  it('says so when every game has been moved', async () => {
    vi.mocked(api.migrateChatPreview).mockResolvedValue(emptyPreview)
    renderView()

    fireEvent.click(await screen.findByRole('button', { name: 'Show what can be moved' }, { timeout: 5_000 }))

    expect(await screen.findByText('Every game has been moved to the single chat.', undefined, { timeout: 5_000 })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Move all' })).toBeNull()
  })
})
