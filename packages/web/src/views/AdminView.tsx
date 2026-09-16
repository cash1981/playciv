import { useCallback, useEffect, useState } from 'react'

import { errorMessage, isUnauthorized } from '../App.js'
import { api } from '../lib/api.js'
import type { AdminUserDto, PlayerDto } from '../lib/api.js'

interface Props {
  readonly player: PlayerDto
  readonly onUnauthorized: () => void
  readonly onBack: () => void
}

export function AdminView({ player, onUnauthorized, onBack }: Props): React.JSX.Element {
  const [users, setUsers] = useState<readonly AdminUserDto[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

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

  async function update(user: AdminUserDto, changes: Parameters<typeof api.updateAdminUser>[1]): Promise<void> {
    setBusyId(user.id)
    setError(null)
    try {
      const updated = await api.updateAdminUser(user.id, changes)
      setUsers((current) => current.map((candidate) => (candidate.id === updated.id ? updated : candidate)))
    } catch (caught) {
      if (isUnauthorized(caught)) return onUnauthorized()
      setError(errorMessage(caught))
    } finally {
      setBusyId(null)
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

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>User administration</h1>
        <button onClick={onBack}>Back to games</button>
      </div>
      <p className="muted">Manage roles and access. Passwords are never shown here.</p>
      {error !== null && <div className="error">{error}</div>}

      <section className="panel">
        <ul className="list">
          {users.map((user) => {
            const busy = busyId === user.id
            const isCurrent = user.id === player.id
            return (
              <li key={user.id}>
                <div style={{ minWidth: '12rem' }}>
                  <strong>{user.username}</strong>
                  <div className="muted">{user.email ?? 'No email'}</div>
                </div>
                <label className="inline-label">
                  Role
                  <select
                    value={user.role}
                    disabled={busy || isCurrent}
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
                    disabled={busy || isCurrent}
                    onChange={(event) => void update(user, { disabled: !event.target.checked })}
                  />
                  Enabled
                </label>
                <span className="spacer" style={{ flex: 1 }} />
                <button
                  className="danger small"
                  disabled={busy || isCurrent}
                  onClick={() => void remove(user)}
                >
                  Delete
                </button>
              </li>
            )
          })}
        </ul>
        {users.length === 0 && <p className="muted">No users found.</p>}
      </section>
    </>
  )
}
