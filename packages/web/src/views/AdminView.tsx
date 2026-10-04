import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { errorMessage, isUnauthorized } from '../App.js'
import { api } from '../lib/api.js'
import type {
  AdminUserDto,
  BroadcastQueueDto,
  BroadcastResultDto,
  CleanupCandidateDto,
  CleanupPreviewDto,
  CompactCandidateDto,
  CompactPreviewDto,
  MigrateChatGameDto,
  MigrateChatPreviewDto,
  PlayerDto,
} from '../lib/api.js'
import { MarkdownEditor } from './MarkdownEditor.js'
import type { MarkdownEditorComponent } from './MarkdownEditor.js'

interface Props {
  readonly player: PlayerDto
  readonly onUnauthorized: () => void
  readonly onBack: () => void
  /** Injectable so tests can swap the WYSIWYG editor for a plain textarea. */
  readonly editorComponent?: MarkdownEditorComponent | undefined
}

/** Users shown per page. The list is paged in the browser, not on the server. */
const PAGE_SIZE = 10

/** Java's subject was "Message from cash at playciv.com"; the domain moved. */
const DEFAULT_SUBJECT = 'Message from cash at playciv.app'

/**
 * The skip box takes addresses separated by newlines, commas or spaces, so a
 * list copied from a spreadsheet or from the last run's result both work.
 */
function parseAddressList(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((address) => address.trim())
    .filter((address) => address !== '')
}

/** The server accepts a limit of 1 to this; the field is invalid outside it. */
const MAX_LIMIT = 5000

/** The limit field: empty means no limit, anything but a whole number from 1 to 5000 is invalid. */
function parseLimit(text: string): number | undefined | 'invalid' {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  return /^[0-9]+$/.test(trimmed) && Number(trimmed) >= 1 && Number(trimmed) <= MAX_LIMIT
    ? Number(trimmed)
    : 'invalid'
}

export function AdminView({
  player,
  onUnauthorized,
  onBack,
  editorComponent: EditorComponent = MarkdownEditor,
}: Props): React.JSX.Element {
  const [users, setUsers] = useState<readonly AdminUserDto[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)

  /** The broadcast composer (issue #92): subject, Markdown body and the override. */
  const [emailSubject, setEmailSubject] = useState(DEFAULT_SUBJECT)
  const [emailBody, setEmailBody] = useState('')
  const [includeUnsubscribed, setIncludeUnsubscribed] = useState(false)
  const [sending, setSending] = useState(false)
  const [skipAddresses, setSkipAddresses] = useState('')
  const [limitText, setLimitText] = useState('')
  const [broadcastResult, setBroadcastResult] = useState<BroadcastResultDto | null>(null)

  /** The user being edited, and the draft values for the free-text fields. */
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftUsername, setDraftUsername] = useState('')
  const [draftEmail, setDraftEmail] = useState('')

  const reload = useCallback(async () => {
    try {
      setUsers(await api.adminUsers())
      setError(null)
    } catch (caught) {
      if (isUnauthorized(caught)) return onUnauthorized()
      setError(errorMessage(caught))
    }
  }, [onUnauthorized])

  useEffect(() => {
    void reload()
  }, [reload])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return users
    return users.filter(
      (user) =>
        user.username.toLowerCase().includes(needle) ||
        (user.email ?? '').toLowerCase().includes(needle),
    )
  }, [users, query])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  // A shorter list (after a search or a delete) can leave the page out of range.
  const safePage = Math.min(page, pageCount - 1)
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  function search(value: string): void {
    setQuery(value)
    setPage(0)
  }

  function startEdit(user: AdminUserDto): void {
    setEditingId(user.id)
    setDraftUsername(user.username)
    setDraftEmail(user.email ?? '')
    setError(null)
  }

  async function update(
    user: AdminUserDto,
    changes: Parameters<typeof api.updateAdminUser>[1],
  ): Promise<void> {
    setBusyId(user.id)
    setError(null)
    try {
      const updated = await api.updateAdminUser(user.id, changes)
      setUsers((current) =>
        current.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      )
    } catch (caught) {
      if (isUnauthorized(caught)) {
        onUnauthorized()
        return
      }
      setError(errorMessage(caught))
      throw caught
    } finally {
      setBusyId(null)
    }
  }

  async function saveEdit(user: AdminUserDto): Promise<void> {
    const username = draftUsername.trim()
    const email = draftEmail.trim()
    const changes: Parameters<typeof api.updateAdminUser>[1] = {
      ...(username !== user.username ? { username } : {}),
      ...(email !== (user.email ?? '') ? { email: email === '' ? null : email } : {}),
    }
    // Nothing actually changed — just leave edit mode.
    if (Object.keys(changes).length === 0) {
      setEditingId(null)
      return
    }
    try {
      await update(user, changes)
      setEditingId(null)
    } catch {
      // update() already surfaced the error; stay in edit mode to fix or retry.
    }
  }

  async function remove(user: AdminUserDto): Promise<void> {
    if (!window.confirm(`Delete ${user.username} permanently?`)) return
    setBusyId(user.id)
    setError(null)
    try {
      await api.deleteAdminUser(user.id)
      setUsers((current) => current.filter((candidate) => candidate.id !== user.id))
    } catch (caught) {
      if (isUnauthorized(caught)) return onUnauthorized()
      setError(errorMessage(caught))
    } finally {
      setBusyId(null)
    }
  }

  const limit = parseLimit(limitText)

  async function sendBroadcast(): Promise<void> {
    if (sending || emailSubject.trim() === '' || emailBody.trim() === '' || limit === 'invalid') {
      return
    }
    const exclude = parseAddressList(skipAddresses)
    const audience = includeUnsubscribed
      ? 'every player, including those who unsubscribed'
      : 'every player with an email address'
    const question =
      `Send this email to ${audience}` +
      (limit === undefined ? '' : `, at most ${limit} of them`) +
      (exclude.length === 0 ? '' : `, skipping ${exclude.length} listed addresses`) +
      '?'
    if (!window.confirm(question)) return
    setSending(true)
    setError(null)
    setBroadcastResult(null)
    try {
      const result = await api.broadcastEmail(emailSubject.trim(), emailBody, includeUnsubscribed, {
        exclude,
        ...(limit === undefined ? {} : { limit }),
      })
      setBroadcastResult(result)
      // Keep the message while the run is unfinished, so it can be sent again
      // for the rest without being retyped. A failed address does not count as
      // unfinished: one malformed stored address would keep the old message in
      // the composer for good.
      if (result.deferred === 0 && result.stopReason === null) {
        setEmailBody('')
      }
    } catch (caught) {
      if (isUnauthorized(caught)) return onUnauthorized()
      setError(errorMessage(caught))
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>User administration</h1>
        <button onClick={onBack}>Back to games</button>
      </div>
      <p className="muted">Manage roles and access. Passwords are never shown here.</p>
      {error !== null && <div className="error">{error}</div>}

      <section className="panel">
        <div className="row" style={{ marginBottom: '0.75rem' }}>
          <input
            type="search"
            placeholder="Search username or email"
            value={query}
            onChange={(event) => search(event.target.value)}
            style={{ flex: 1, minWidth: '12rem' }}
          />
          <span className="muted" style={{ whiteSpace: 'nowrap' }}>
            {filtered.length} {filtered.length === 1 ? 'user' : 'users'}
          </span>
        </div>

        <ul className="list">
          {visible.map((user) => {
            const busy = busyId === user.id
            const isCurrent = user.id === player.id
            const editing = editingId === user.id

            return (
              <li key={user.id}>
                {editing ? (
                  <div className="admin-edit" style={{ minWidth: '16rem', flex: 1 }}>
                    <label className="inline-label">
                      Username
                      <input
                        value={draftUsername}
                        disabled={busy}
                        onChange={(event) => setDraftUsername(event.target.value)}
                      />
                    </label>
                    <label className="inline-label">
                      Email
                      <input
                        type="email"
                        placeholder="No email"
                        value={draftEmail}
                        disabled={busy}
                        onChange={(event) => setDraftEmail(event.target.value)}
                      />
                    </label>
                  </div>
                ) : (
                  <div style={{ minWidth: '12rem' }}>
                    <strong>{user.username}</strong>
                    <div className="muted">{user.email ?? 'No email'}</div>
                  </div>
                )}

                <label className="inline-label">
                  Role
                  <select
                    value={user.role}
                    disabled={busy || isCurrent || editing}
                    onChange={(event) =>
                      void update(user, { role: event.target.value as 'user' | 'admin' })
                    }
                  >
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </label>
                <label className="inline-label">
                  <input
                    type="checkbox"
                    checked={!user.disabled}
                    disabled={busy || isCurrent || editing}
                    onChange={(event) => void update(user, { disabled: !event.target.checked })}
                  />
                  Enabled
                </label>
                <span className="spacer" style={{ flex: 1 }} />

                {editing ? (
                  <>
                    <button
                      className="small primary"
                      disabled={busy || draftUsername.trim() === ''}
                      onClick={() => void saveEdit(user)}
                    >
                      Save
                    </button>
                    <button className="small" disabled={busy} onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    className="small"
                    disabled={busy || editingId !== null}
                    title="Edit username or email"
                    onClick={() => startEdit(user)}
                  >
                    Edit
                  </button>
                )}
                <button
                  className="danger small"
                  disabled={busy || isCurrent || editing}
                  onClick={() => void remove(user)}
                >
                  Delete
                </button>
              </li>
            )
          })}
        </ul>
        {filtered.length === 0 && <p className="muted">No users found.</p>}

        {pageCount > 1 && (
          <div className="pager">
            <button className="small" disabled={safePage <= 0} onClick={() => setPage(safePage - 1)}>
              ‹ Prev
            </button>
            <span className="muted">
              Page {safePage + 1} / {pageCount}
            </span>
            <button
              className="small"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(safePage + 1)}
            >
              Next ›
            </button>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Send email to all players</h2>
        <p className="muted">
          The body is written in Markdown and sent as a formatted email, with the Markdown
          source as the plain-text fallback. Every account with an email address gets its own
          copy, greeted with its username and carrying the unsubscribe link.
        </p>
        {broadcastResult !== null && <BroadcastSummary result={broadcastResult} />}

        <label className="inline-label">
          Subject
          <input
            value={emailSubject}
            disabled={sending}
            onChange={(event) => setEmailSubject(event.target.value)}
            style={{ flex: 1, minWidth: '12rem' }}
          />
        </label>

        <EditorComponent
          value={emailBody}
          onChange={setEmailBody}
          readOnly={sending}
          ariaLabel="Email body"
          placeholder="Write the message in Markdown …"
        />

        <label className="inline-label">
          <input
            type="checkbox"
            checked={includeUnsubscribed}
            disabled={sending}
            onChange={(event) => setIncludeUnsubscribed(event.target.checked)}
          />
          Also send to players who have unsubscribed
        </label>

        <label>
          Skip these addresses
          <textarea
            value={skipAddresses}
            disabled={sending}
            placeholder="One per line, or separated by commas or spaces"
            onChange={(event) => setSkipAddresses(event.target.value)}
          />
        </label>

        <label className="inline-label">
          Send to at most
          <input
            type="number"
            min={1}
            max={MAX_LIMIT}
            step={1}
            value={limitText}
            disabled={sending}
            placeholder="no limit"
            onChange={(event) => setLimitText(event.target.value)}
            style={{ width: '7rem' }}
          />
          accounts
        </label>
        {limit === 'invalid' && (
          <div className="error">The limit must be a whole number from 1 to 5000.</div>
        )}

        <div className="row">
          <button
            className="primary"
            disabled={
              sending || emailSubject.trim() === '' || emailBody.trim() === '' || limit === 'invalid'
            }
            onClick={() => void sendBroadcast()}
          >
            {sending ? 'Sending …' : 'Send email'}
          </button>
        </div>
      </section>

      <BroadcastQueuePanel
        users={users}
        subject={emailSubject}
        body={emailBody}
        includeUnsubscribed={includeUnsubscribed}
        skipAddresses={skipAddresses}
        busy={sending}
        onUnauthorized={onUnauthorized}
        onQueued={() => setEmailBody('')}
      />

      <FinishedGameCleanupPanel onUnauthorized={onUnauthorized} />

      <MigrateChatPanel onUnauthorized={onUnauthorized} />

      <RevisionCompactionPanel onUnauthorized={onUnauthorized} />
    </>
  )
}

/** The readable outcome of one broadcast, with the addresses to skip next time. */
function BroadcastSummary({ result }: { readonly result: BroadcastResultDto }): React.JSX.Element {
  const { skipped } = result
  return (
    <div className="notice">
      <p>
        <strong>Sent to {result.sent} players.</strong>
      </p>
      <ul>
        <li>
          Skipped: {skipped.noAddress} without an address, {skipped.unsubscribed} unsubscribed,{' '}
          {skipped.excluded} on the skip list
        </li>
        <li>Failed: {result.failed.length}</li>
        <li>Not attempted yet: {result.deferred}</li>
      </ul>
      {result.failed.length > 0 && (
        <ul aria-label="Failed addresses">
          {result.failed.map((failure, index) => (
            // Two accounts may share an address, so the address is not a key.
            <li key={index}>
              {failure.email}: {failure.reason}
            </li>
          ))}
        </ul>
      )}
      {result.stopReason !== null && (
        <p>
          <strong>The run stopped early.</strong> {result.stopReason}
        </p>
      )}
      {result.sentTo.length > 0 && (
        <>
          <label>
            Addresses sent in this run
            <textarea readOnly value={result.sentTo.join('\n')} />
          </label>
          <p className="muted">
            Paste these into the skip box on the next run so nobody gets the mail twice, and
            leave the message as it is when you resume.
          </p>
        </>
      )}
    </div>
  )
}

const PER_DAY_DEFAULT = '50'
const PER_DAY_MAX = 100

/** The "Per day" field: a whole number from 1 to 100, or `'invalid'`. */
function parsePerDay(text: string): number | 'invalid' {
  const trimmed = text.trim()
  return /^[0-9]+$/.test(trimmed) && Number(trimmed) >= 1 && Number(trimmed) <= PER_DAY_MAX
    ? Number(trimmed)
    : 'invalid'
}

interface QueuePanelProps {
  readonly users: readonly AdminUserDto[]
  /** The composer's subject, message, checkbox and skip box: the queue reuses them. */
  readonly subject: string
  readonly body: string
  readonly includeUnsubscribed: boolean
  readonly skipAddresses: string
  /** The direct send is running. */
  readonly busy: boolean
  readonly onUnauthorized: () => void
  /** The message was queued, so the composer can let go of it. */
  readonly onQueued: () => void
}

/**
 * "Send over several days": queues the composer's message for the daily job
 * (17:00 UTC), which sends the next `perDay` recipients each time. The status
 * is read when the panel opens and after each action, never on a timer.
 */
function BroadcastQueuePanel({
  users,
  subject,
  body,
  includeUnsubscribed,
  skipAddresses,
  busy,
  onUnauthorized,
  onQueued,
}: QueuePanelProps): React.JSX.Element {
  const [perDayText, setPerDayText] = useState(PER_DAY_DEFAULT)
  const [queue, setQueue] = useState<BroadcastQueueDto | null>(null)
  const [working, setWorking] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const perDay = parsePerDay(perDayText)
  const active = queue?.status === 'active'

  useEffect(() => {
    let current = true
    api
      .broadcastQueue()
      .then((answer) => {
        if (current) setQueue(answer.queue)
      })
      .catch((caught: unknown) => {
        if (isUnauthorized(caught)) return onUnauthorized()
        if (current) setError(errorMessage(caught))
      })
    return () => {
      current = false
    }
  }, [onUnauthorized])

  /** Runs one action, reporting a failure here and a lapsed session to the app. */
  async function act(action: () => Promise<void>): Promise<void> {
    setWorking(true)
    setError(null)
    setNotice(null)
    try {
      await action()
    } catch (caught) {
      if (isUnauthorized(caught)) return onUnauthorized()
      setError(errorMessage(caught))
    } finally {
      setWorking(false)
    }
  }

  /** The accounts the queue would take, as far as the user list shows: the server decides. */
  function estimateRecipients(exclude: readonly string[]): number {
    const skipped = new Set(exclude.map((address) => address.toLowerCase()))
    return users.filter(
      (user) =>
        user.email !== null &&
        user.email.trim() !== '' &&
        (includeUnsubscribed || user.disableEmail !== true) &&
        !skipped.has(user.email.trim().toLowerCase()),
    ).length
  }

  async function queueIt(): Promise<void> {
    if (working || busy || active || perDay === 'invalid') return
    if (subject.trim() === '' || body.trim() === '') return
    const exclude = parseAddressList(skipAddresses)
    const recipients = estimateRecipients(exclude)
    const days = Math.max(1, Math.ceil(recipients / perDay))
    if (
      !window.confirm(
        `Queue this email for about ${recipients} players, ${perDay} a day? ` +
          `It will take about ${days} ${days === 1 ? 'day' : 'days'}, ` +
          'and the recipients are fixed now.',
      )
    ) {
      return
    }
    await act(async () => {
      const answer = await api.queueBroadcast(subject.trim(), body, includeUnsubscribed, {
        perRun: perDay,
        exclude,
      })
      setQueue(answer.queue)
      const total = answer.queue.counts.pending
      const left = answer.skipped
      setNotice(
        `Queued for ${total} players. Left out: ${left.noAddress} without an address, ` +
          `${left.unsubscribed} unsubscribed, ${left.excluded} on the skip list` +
          (answer.rejected.length === 0
            ? '.'
            : `, ${answer.rejected.length} with an invalid address (${answer.rejected
                .map((entry) => entry.email)
                .join(', ')}).`),
      )
      onQueued()
    })
  }

  async function runNow(): Promise<void> {
    if (queue === null) return
    const batch = Math.min(queue.perRun, queue.counts.pending)
    if (
      !window.confirm(
        `Send the next batch now? Up to ${batch} of the ${queue.counts.pending} pending ` +
          'recipients will be mailed.',
      )
    ) {
      return
    }
    await act(async () => {
      const answer = await api.runBroadcastQueue()
      setQueue(answer.queue)
      const { run } = answer
      setNotice(
        `Sent ${run.sent}, failed ${run.failed}` +
          (run.released > 0 ? `, ${run.released} put back for the next run` : '') +
          (run.indeterminate > 0
            ? `, ${run.indeterminate} not confirmed (they may have been delivered; see the stuck rows)`
            : '') +
          (run.finished ? '. The queue is finished.' : '.') +
          (run.stopReason === null ? '' : ` The run stopped early: ${run.stopReason}`),
      )
    })
  }

  async function releaseStuck(): Promise<void> {
    if (
      !window.confirm(
        "Check Resend's email log first. These mails may already have been delivered, " +
          'and releasing them can send them twice. Do not use this while a run may be in ' +
          'progress (the 17:00 UTC run, or "Send next batch now"). Release the stuck rows anyway?',
      )
    ) {
      return
    }
    await act(async () => {
      const answer = await api.releaseStuckBroadcastQueue()
      setQueue(answer.queue)
      setNotice(`Released ${answer.released} stuck rows; the next run will send them.`)
    })
  }

  async function cancel(): Promise<void> {
    if (!window.confirm('Cancel this queue? Recipients still pending will not be sent.')) return
    await act(async () => {
      const answer = await api.cancelBroadcastQueue()
      setQueue(answer.queue)
      setNotice('The queue was cancelled.')
    })
  }

  return (
    <section className="panel">
      <h2>Send over several days</h2>
      <p className="muted">
        Uses the subject, message, unsubscribe checkbox and skip box above. The recipients are
        fixed when you queue it, and a daily job at 17:00 UTC sends the next batch until
        everyone has had it. Resend&apos;s free plan allows 100 mails a day, shared with the
        game mails, so 50 a day is the default.
      </p>
      {error !== null && <div className="error">{error}</div>}
      {notice !== null && <div className="notice">{notice}</div>}

      <label className="inline-label">
        Per day
        <input
          type="number"
          min={1}
          max={PER_DAY_MAX}
          step={1}
          value={perDayText}
          disabled={working || active}
          onChange={(event) => setPerDayText(event.target.value)}
          style={{ width: '7rem' }}
        />
      </label>
      {perDay === 'invalid' && (
        <div className="error">Per day must be a whole number from 1 to {PER_DAY_MAX}.</div>
      )}
      <div className="row">
        <button
          className="primary"
          disabled={
            working ||
            busy ||
            active ||
            perDay === 'invalid' ||
            subject.trim() === '' ||
            body.trim() === ''
          }
          onClick={() => void queueIt()}
        >
          Queue it
        </button>
        {active && <span className="muted">A queue is already running.</span>}
      </div>

      {queue !== null && (
        <QueueStatus
          queue={queue}
          disabled={working}
          onReleaseStuck={() => void releaseStuck()}
        />
      )}
      {active && (
        <div className="row">
          <button disabled={working} onClick={() => void runNow()}>
            Send next batch now
          </button>
          <button disabled={working} onClick={() => void cancel()}>
            Cancel
          </button>
        </div>
      )}
    </section>
  )
}

function QueueStatus({
  queue,
  disabled,
  onReleaseStuck,
}: {
  readonly queue: BroadcastQueueDto
  readonly disabled: boolean
  readonly onReleaseStuck: () => void
}): React.JSX.Element {
  const { counts } = queue
  return (
    <div className="notice">
      <p>
        <strong>{queue.subject}</strong> ({queue.status}, {queue.perRun} a day)
      </p>
      <ul>
        <li>Sent: {counts.sent}</li>
        <li>Pending: {counts.pending}</li>
        <li>Failed: {counts.failed}</li>
        <li>Stuck: {queue.stuck.length}</li>
      </ul>
      <p>
        Last run: {queue.lastRunAt === null ? 'never' : new Date(queue.lastRunAt).toLocaleString()}
        {queue.status === 'active' && ' · Next run: 17:00 UTC'}
      </p>
      {queue.failed.length > 0 && (
        <ul aria-label="Failed queue addresses">
          {queue.failed.map((failure, index) => (
            // Two accounts may share an address, so the address is not a key.
            <li key={index}>
              {failure.email}: {failure.reason}
            </li>
          ))}
        </ul>
      )}
      {queue.stuck.length > 0 && (
        <>
          <p>
            These were taken by a run that never reported back, so they may have been mailed.
            They are not sent again by themselves, and the queue stays open until they are
            released or it is cancelled. Check Resend&apos;s log and decide.
          </p>
          <ul aria-label="Stuck queue addresses">
            {queue.stuck.map((email, index) => (
              <li key={index}>{email}</li>
            ))}
          </ul>
          {queue.status === 'active' && (
            <div className="row">
              <button disabled={disabled} onClick={onReleaseStuck}>
                Release stuck rows
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** Megabytes as the panel shows them; a sliver is "under 0.1 MB", not "0.0 MB". */
function formatMegabytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024)
  return bytes > 0 && megabytes < 0.05 ? 'under 0.1 MB' : `${megabytes.toFixed(1)} MB`
}

/** What each confirmation says, and what it keeps: the replay goes, the final state stays. */
const CLEANUP_LOSS =
  'The step by step replay of the game is lost. The final board, the log and the chat stay.'

/**
 * "Clean up finished games": shrinks games that have ended to their newest
 * revision. The dry run is read when the admin asks for it, and again after each
 * cleanup, never on a timer. A server cap per request means "Clean up all" may
 * need pressing more than once.
 */
function FinishedGameCleanupPanel({
  onUnauthorized,
}: {
  readonly onUnauthorized: () => void
}): React.JSX.Element {
  const [preview, setPreview] = useState<CleanupPreviewDto | null>(null)
  const [working, setWorking] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  /** Runs one action, reporting a failure here and a lapsed session to the app. */
  async function act(action: () => Promise<void>): Promise<void> {
    setWorking(true)
    setError(null)
    try {
      await action()
    } catch (caught) {
      if (isUnauthorized(caught)) return onUnauthorized()
      setError(errorMessage(caught))
    } finally {
      setWorking(false)
    }
  }

  async function load(): Promise<void> {
    setNotice(null)
    await act(async () => {
      setPreview(await api.cleanupPreview())
    })
  }

  async function cleanOne(game: CleanupCandidateDto): Promise<void> {
    if (working) return
    if (
      !window.confirm(
        `Clean up ${game.name}? ${game.removableRevisions} of its ${game.revisions} saved ` +
          `states (about ${formatMegabytes(game.removableBytes)}) will be removed. ${CLEANUP_LOSS}`,
      )
    ) {
      return
    }
    await run(game.id)
  }

  async function cleanAll(): Promise<void> {
    if (working || preview === null || preview.games.length === 0) return
    if (
      !window.confirm(
        `Clean up ${preview.games.length} finished ${preview.games.length === 1 ? 'game' : 'games'}? ` +
          `${preview.totalRevisions} saved states (about ${formatMegabytes(preview.totalBytes)}) ` +
          `will be removed, the largest games first. Each press handles a limited number of games; press again if some remain. ${CLEANUP_LOSS}`,
      )
    ) {
      return
    }
    await run(undefined)
  }

  async function run(gameId: string | undefined): Promise<void> {
    setNotice(null)
    await act(async () => {
      const result = await api.cleanFinishedGames(gameId)
      setNotice(
        `Removed ${result.totalRevisions} saved states (about ${formatMegabytes(result.totalBytes)}) ` +
          `from ${result.games.length} ${result.games.length === 1 ? 'game' : 'games'}.` +
          (result.remaining > 0
            ? ` ${result.remaining} more ${result.remaining === 1 ? 'game is' : 'games are'} left; press "Clean up all" again.`
            : ''),
      )
      // Refresh from the server rather than subtracting here: it is the source of the numbers.
      setPreview(await api.cleanupPreview())
    })
  }

  return (
    <section className="panel">
      <h2>Clean up finished games</h2>
      <p className="muted">
        A finished game keeps a saved state after every move, only so it can be replayed step
        by step. Cleaning removes all of them except the last: the final board, the log and the
        chat stay, and so do the highscore and ratings. Games that are still running are never
        touched. The database may not report a smaller size at once, because D1 reuses the
        freed space. To undo a mistake, restore the database with D1 Time Travel (
        <code>wrangler d1 time-travel info playciv</code>).
      </p>
      {error !== null && <div className="error">{error}</div>}
      {notice !== null && <div className="notice">{notice}</div>}

      <div className="row">
        <button disabled={working} onClick={() => void load()}>
          {preview === null ? 'Show what can be cleaned' : 'Refresh'}
        </button>
      </div>

      {preview !== null && preview.games.length === 0 && (
        <p className="muted">No finished game has anything to clean up.</p>
      )}
      {preview !== null && preview.games.length > 0 && (
        <>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Game</th>
                  <th>Saved states</th>
                  <th>Would free</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {preview.games.map((game) => (
                  <tr key={game.id}>
                    <td>{game.name}</td>
                    <td>
                      {game.removableRevisions} of {game.revisions}
                    </td>
                    <td>{formatMegabytes(game.removableBytes)}</td>
                    <td>
                      <button
                        className="small"
                        disabled={working}
                        aria-label={`Clean up ${game.name}`}
                        onClick={() => void cleanOne(game)}
                      >
                        Clean up
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td>{preview.totalRevisions}</td>
                  <td>{formatMegabytes(preview.totalBytes)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="row">
            <button className="danger" disabled={working} onClick={() => void cleanAll()}>
              Clean up all
            </button>
          </div>
        </>
      )}
    </section>
  )
}

/** What the migration confirmation says it does, and what it never does. */
const MIGRATE_CHAT_EFFECT =
  'Public orders are copied into the chat and orders timeline, and an unpublished draft is ' +
  'added to its owner\'s private note, so nothing private reaches anyone else. Running it again ' +
  'changes nothing for games that are done.'

const countOf = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`

/**
 * "Move old games to the single chat": copies the old Turn orders panel data of
 * games that still have it into the timeline. The dry run is read when the admin
 * asks for it, and again after each run. The server spends a limited number of
 * database calls per request, so a run may need pressing more than once; the panel
 * says how many games are left.
 */
function MigrateChatPanel({
  onUnauthorized,
}: {
  readonly onUnauthorized: () => void
}): React.JSX.Element {
  const [preview, setPreview] = useState<MigrateChatPreviewDto | null>(null)
  const [working, setWorking] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  /** Runs one action, reporting a failure here and a lapsed session to the app. */
  async function act(action: () => Promise<void>): Promise<void> {
    setWorking(true)
    setError(null)
    try {
      await action()
    } catch (caught) {
      if (isUnauthorized(caught)) return onUnauthorized()
      setError(errorMessage(caught))
    } finally {
      setWorking(false)
    }
  }

  async function load(): Promise<void> {
    setNotice(null)
    await act(async () => {
      setPreview(await api.migrateChatPreview())
    })
  }

  async function migrateOne(game: MigrateChatGameDto): Promise<void> {
    if (working) return
    if (
      !window.confirm(
        `Move ${game.name} to the single chat? ${countOf(game.orderRows, 'order', 'orders')} will be copied ` +
          `into the timeline and ${countOf(game.drafts, 'unpublished draft', 'unpublished drafts')} added to private notes. ` +
          MIGRATE_CHAT_EFFECT,
      )
    ) {
      return
    }
    await run(game)
  }

  async function migrateAll(): Promise<void> {
    if (working || preview === null || (preview.games.length === 0 && preview.unchecked === 0)) return
    const question =
      preview.games.length === 0
        ? `Check ${countOf(preview.unchecked, 'game', 'games')} that ${preview.unchecked === 1 ? 'was' : 'were'} not checked yet and move what is missing? ` +
          `Each press handles a limited number of games; press again while some remain. ${MIGRATE_CHAT_EFFECT}`
        : `Move ${countOf(preview.games.length, 'game', 'games')} to the single chat? ` +
          `${countOf(preview.totalOrderRows, 'order', 'orders')} will be copied into the timeline and ` +
          `${countOf(preview.totalDrafts, 'unpublished draft', 'unpublished drafts')} added to private notes. ` +
          `Each press handles a limited number of games; press again while some remain. ${MIGRATE_CHAT_EFFECT}`
    if (!window.confirm(question)) {
      return
    }
    await run(undefined)
  }

  /** One game, or every game that has not been moved when `game` is left out. */
  async function run(game?: MigrateChatGameDto): Promise<void> {
    setNotice(null)
    await act(async () => {
      const result = await api.migrateChat(game?.id)
      const left =
        result.remaining > 0
          ? game === undefined
            ? ` ${countOf(result.remaining, 'game is', 'games are')} left; press "Move all" again.`
            : ` ${game.name} is not fully moved yet; press "Move" on ${game.name} again.`
          : ' Nothing is left to move.'
      setNotice(
        `Moved ${countOf(result.games.length, 'game', 'games')}: ` +
          `${countOf(result.totalOrderRows, 'order', 'orders')} copied, ` +
          `${countOf(result.totalDrafts, 'draft', 'drafts')} added to private notes.` +
          (result.skipped > 0
            ? ` ${countOf(result.skipped, 'game was', 'games were')} skipped because ${result.skipped === 1 ? 'it' : 'they'} changed meanwhile.`
            : '') +
          (result.partial !== null
            ? ` Game ${result.partial} was only partly copied; the rest follows on the next press.`
            : '') +
          left,
      )
      // Refresh from the server rather than subtracting here: it is the source of the numbers.
      setPreview(await api.migrateChatPreview())
    })
  }

  return (
    <section className="panel">
      <h2>Move old games to the single chat</h2>
      <p className="muted">
        Every game opens as one chat and orders timeline. A game saved before that still has its
        orders in the old Turn orders panel, and its database rows have not been copied. This
        copies the public orders into the timeline, finished games included, and appends an
        unpublished draft to its owner&apos;s private note. Orders that were never published are
        not shown to anyone else. A game is moved once, and the run is safe to repeat.
      </p>
      {error !== null && <div className="error">{error}</div>}
      {notice !== null && <div className="notice">{notice}</div>}

      <div className="row">
        <button disabled={working} onClick={() => void load()}>
          {preview === null ? 'Show what can be moved' : 'Refresh'}
        </button>
      </div>

      {preview !== null && preview.games.length === 0 && preview.unchecked === 0 && (
        <p className="muted">Every game has been moved to the single chat.</p>
      )}
      {preview !== null && preview.unchecked > 0 && (
        <p className="muted">
          {countOf(preview.unchecked, 'more game was', 'more games were')} not checked, run the move again.
        </p>
      )}
      {preview !== null && preview.games.length > 0 && (
        <>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Game</th>
                  <th>Orders to copy</th>
                  <th>Drafts to move</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {preview.games.map((game) => (
                  <tr key={game.id}>
                    <td>
                      {game.name}
                      {!game.active && <span className="tag">ended</span>}
                    </td>
                    <td>{game.orderRows}</td>
                    <td>{game.drafts}</td>
                    <td>
                      <button
                        className="small"
                        disabled={working}
                        aria-label={`Move ${game.name}`}
                        onClick={() => void migrateOne(game)}
                      >
                        Move
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td>{preview.totalOrderRows}</td>
                  <td>{preview.totalDrafts}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
      {preview !== null && (preview.games.length > 0 || preview.unchecked > 0) && (
        <div className="row">
          <button className="danger" disabled={working} onClick={() => void migrateAll()}>
            Move all
          </button>
        </div>
      )}
    </section>
  )
}

/** A safety stop for the "keep pressing" loop of the compaction; far more than any database needs. */
const COMPACT_MAX_REQUESTS = 2000

/** What each compaction confirmation says: nothing is lost, and the owner's safety net comes first. */
const COMPACT_REASSURANCE =
  'The saved states are rebuilt and checked against the originals before anything is replaced, ' +
  'so every game reads the same afterwards. A game that is still running keeps its newest saved state untouched.'

/**
 * "Compact revision history": turns the old full copies of the game state, one per
 * move, into small differences. Nothing about the games changes for the players.
 * The server does a limited amount per request, so a press keeps asking until the
 * server says nothing is left, a game fails its check, or a request makes no
 * progress. The dry run is read when the admin asks, and again when a run ends.
 */
function RevisionCompactionPanel({
  onUnauthorized,
}: {
  readonly onUnauthorized: () => void
}): React.JSX.Element {
  const [preview, setPreview] = useState<CompactPreviewDto | null>(null)
  const [working, setWorking] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [problems, setProblems] = useState<readonly string[]>([])
  const [error, setError] = useState<string | null>(null)
  // A run in flight must stop asking when the page is left.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  /** Runs one action, reporting a failure here and a lapsed session to the app. */
  async function act(action: () => Promise<void>): Promise<void> {
    setWorking(true)
    setError(null)
    try {
      await action()
    } catch (caught) {
      if (isUnauthorized(caught)) return onUnauthorized()
      setError(errorMessage(caught))
    } finally {
      if (mounted.current) {
        setWorking(false)
        setProgress(null)
      }
    }
  }

  async function load(): Promise<void> {
    setNotice(null)
    setProblems([])
    await act(async () => {
      setPreview(await api.compactPreview())
    })
  }

  async function compactOne(game: CompactCandidateDto): Promise<void> {
    if (working) return
    if (
      !window.confirm(
        `Compact ${game.name}? ${game.fullRevisions} of its ${game.revisions} saved states ` +
          `(about ${formatMegabytes(game.freeableBytes)} to free) will be replaced by small differences. ` +
          `It takes several requests; they follow one another by themselves. ${COMPACT_REASSURANCE}`,
      )
    ) {
      return
    }
    await run(game.id)
  }

  async function compactAll(): Promise<void> {
    if (working || preview === null || preview.games.length === 0) return
    if (
      !window.confirm(
        `Compact ${preview.games.length} ${preview.games.length === 1 ? 'game' : 'games'}? ` +
          `${preview.totalRevisions} saved states (about ${formatMegabytes(preview.totalBytes)} to free) ` +
          `will be replaced by small differences. It takes many requests; they follow one another by ` +
          `themselves, and it can be stopped by leaving this page. ${COMPACT_REASSURANCE}`,
      )
    ) {
      return
    }
    await run(undefined)
  }

  async function run(gameId: string | undefined): Promise<void> {
    setNotice(null)
    setProblems([])
    await act(async () => {
      let handled = 0
      let freed = 0
      let requests = 0
      const failed: string[] = []
      let remaining = 0
      let stoppedWithoutProgress = false
      while (mounted.current && requests < COMPACT_MAX_REQUESTS) {
        const result = await api.compactRevisions(gameId)
        requests += 1
        let step = 0
        for (const game of result.games) {
          if (game.status === 'compacted') {
            step += game.converted + game.keyframes
          } else {
            const text = `${game.name}: saved state ${game.revision} did not check out, so the game was left as it was.`
            if (!failed.includes(text)) failed.push(text)
          }
        }
        handled += step
        freed += result.totalBytes
        remaining = result.remainingRevisions
        if (mounted.current) {
          setProgress(`Compacted ${handled} saved states so far; ${remaining} left.`)
        }
        if (result.remaining === 0) break
        if (step === 0) {
          // Only games that fail their check are left: asking again would change nothing.
          stoppedWithoutProgress = true
          break
        }
      }
      if (!mounted.current) return
      setProblems(failed)
      setNotice(
        `Compacted ${handled} saved states (about ${formatMegabytes(freed)} freed) in ${requests} ` +
          `${requests === 1 ? 'request' : 'requests'}.` +
          (stoppedWithoutProgress
            ? failed.length > 0
              ? ` ${remaining} saved states could not be compacted; see below.`
              : // Nothing failed and nothing moved: another press (or tab) got there first.
                ` Nothing was compacted by this press; ${remaining} saved states are left, and you can press again.`
            : remaining > 0
              ? ` ${remaining} saved states are left; press again to continue.`
              : ''),
      )
      // Refresh from the server rather than subtracting here: it is the source of the numbers.
      const refreshed = await api.compactPreview()
      if (mounted.current) setPreview(refreshed)
    })
  }

  return (
    <section className="panel">
      <h2>Compact revision history</h2>
      <p className="muted">
        Until now every move saved a complete copy of the game, about 400 KB each. New moves are
        saved as small differences instead; this converts the old copies the same way. Replay,
        history and the games themselves read exactly as before. Running games are compacted too,
        except their newest saved state. Do not start this without a restore point: take a D1 Time
        Travel bookmark first (<code>wrangler d1 time-travel info playciv</code>), and restore to
        it if anything looks wrong. The database may not report a smaller size at once, because D1
        reuses the freed space.
      </p>
      {error !== null && <div className="error">{error}</div>}
      {progress !== null && <div className="notice">{progress}</div>}
      {notice !== null && <div className="notice">{notice}</div>}
      {problems.length > 0 && (
        <div className="error">
          {problems.map((problem) => (
            <div key={problem}>{problem}</div>
          ))}
        </div>
      )}

      <div className="row">
        <button disabled={working} onClick={() => void load()}>
          {preview === null ? 'Show what can be compacted' : 'Refresh'}
        </button>
      </div>

      {preview !== null && preview.games.length === 0 && (
        <p className="muted">No game has old saved states left to compact.</p>
      )}
      {preview !== null && preview.games.length > 0 && (
        <>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Game</th>
                  <th>Full saved states</th>
                  <th>Would free</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {preview.games.map((game) => (
                  <tr key={game.id}>
                    <td>
                      {game.name}
                      {game.active ? ' (running)' : ''}
                    </td>
                    <td>
                      {game.fullRevisions} of {game.revisions}
                    </td>
                    <td>{formatMegabytes(game.freeableBytes)}</td>
                    <td>
                      <button
                        className="small"
                        disabled={working}
                        aria-label={`Compact ${game.name}`}
                        onClick={() => void compactOne(game)}
                      >
                        Compact
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td>{preview.totalRevisions}</td>
                  <td>{formatMegabytes(preview.totalBytes)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="row">
            <button className="danger" disabled={working} onClick={() => void compactAll()}>
              Compact all
            </button>
          </div>
        </>
      )}
    </section>
  )
}
