import { useCallback, useEffect, useMemo, useState } from 'react'

import { errorMessage, isUnauthorized } from '../App.js'
import { api } from '../lib/api.js'
import type { AdminUserDto, BroadcastQueueDto, BroadcastResultDto, PlayerDto } from '../lib/api.js'
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
