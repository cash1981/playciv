import { useCallback, useEffect, useMemo, useState } from 'react'

import { errorMessage, isUnauthorized } from '../App.js'
import { api } from '../lib/api.js'
import type { AdminUserDto, PlayerDto } from '../lib/api.js'
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
  const [sentNotice, setSentNotice] = useState<string | null>(null)

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

  async function sendBroadcast(): Promise<void> {
    if (sending || emailSubject.trim() === '' || emailBody.trim() === '') return
    if (
      !window.confirm(
        includeUnsubscribed
          ? 'Send this email to every player, including those who unsubscribed?'
          : 'Send this email to every player with an email address?',
      )
    ) {
      return
    }
    setSending(true)
    setError(null)
    setSentNotice(null)
    try {
      const { sent, skipped } = await api.broadcastEmail(
        emailSubject,
        emailBody,
        includeUnsubscribed,
      )
      setSentNotice(`Sent to ${sent} players; ${skipped} skipped.`)
      setEmailBody('')
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
        {sentNotice !== null && <div className="notice">{sentNotice}</div>}

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

        <div className="row">
          <button
            className="primary"
            disabled={sending || emailSubject.trim() === '' || emailBody.trim() === ''}
            onClick={() => void sendBroadcast()}
          >
            {sending ? 'Sending …' : 'Send email'}
          </button>
        </div>
      </section>
    </>
  )
}
