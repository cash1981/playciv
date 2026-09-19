/**
 * The log and undo voting.
 *
 * The public log comes from the server's `publicLog` field and never carries
 * the contents of a hidden card. The private log is filtered down to the
 * player's own entries on the server side. Chat lives in its own `ChatPanel`
 * (issue #68).
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { errorMessage } from '../App.js'
import { api } from '../lib/api.js'
import type { GameRevisionView, LogEntryDto, PendingUndoDto, PlayerView } from '../lib/api.js'
import { formatTimestamp } from '../lib/formatTimestamp.js'
import { CollapsiblePanel } from './CollapsiblePanel.js'

interface Props {
  readonly gameId: string
  readonly busy: boolean
  readonly run: (action: () => Promise<PlayerView | unknown>) => Promise<void>
  readonly reloadCount: number
  readonly historical?: GameRevisionView | null
  readonly readOnly?: boolean
}

type Tab = 'public' | 'private'

export function LogPanel({ gameId, busy, run, reloadCount, historical = null, readOnly = false }: Props): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('public')
  const [publicLog, setPublicLog] = useState<readonly LogEntryDto[]>([])
  const [privateLog, setPrivateLog] = useState<readonly LogEntryDto[]>([])
  const [pending, setPending] = useState<readonly PendingUndoDto[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const requestEpoch = useRef(0)

  const load = useCallback(async () => {
    const epoch = ++requestEpoch.current
    try {
      if (historical !== null) {
        setPublicLog(historical.publicLog)
        setPrivateLog(historical.privateLog)
        setPending([])
        setLoadError(null)
        return
      }
      const [pub, priv, undos] = await Promise.all([
        api.publicLog(gameId),
        api.privateLog(gameId),
        api.pendingUndos(gameId),
      ])
      if (epoch !== requestEpoch.current) return
      setPublicLog(pub)
      setPrivateLog(priv)
      setPending(undos)
      setLoadError(null)
    } catch (caught) {
      if (epoch !== requestEpoch.current) return
      setLoadError(errorMessage(caught))
    }
  }, [gameId, historical])

  useEffect(() => {
    void load()
  }, [load, reloadCount])

  const entries = tab === 'public' ? publicLog : privateLog

  return (
    <CollapsiblePanel id="log" title="Log" defaultOpen={false}>
      {loadError !== null && <div className="error">{loadError}</div>}

      <div className="row">
        <button
          className="small"
          disabled={tab === 'public'}
          onClick={() => setTab('public')}
        >
          Public
        </button>
        <button
          className="small"
          disabled={tab === 'private'}
          onClick={() => setTab('private')}
        >
          Private
        </button>
        <span style={{ flex: 1 }} />
        <button className="small" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      <ul className="list log">
        {entries.map((entry) => (
          <li key={entry.id}>
            {formatTimestamp(entry.createdAt) !== '' && (
              <time className="log-time" dateTime={entry.createdAt ?? undefined}>
                {formatTimestamp(entry.createdAt)}
              </time>
            )}
            <span>{entry.message}</span>{' '}
            {entry.hasUndo && <span className="tag">undo pending</span>}
            {tab === 'private' && entry.canUndo === true && (
              <button
                className="small"
                disabled={busy || readOnly}
                onClick={() => void run(() => api.initiateUndo(gameId, entry.id))}
              >
                Ask for undo
              </button>
            )}
          </li>
        ))}
        {entries.length === 0 && <li className="muted">Nothing here yet.</li>}
      </ul>

      <h3 style={{ marginTop: '1rem' }}>Undo waiting for your vote</h3>
      <ul className="list">
        {pending.map((undo) => (
          <li key={undo.id} style={{ display: 'block' }}>
            <div>{undo.message}</div>
            <div className="row" style={{ marginTop: '0.25rem' }}>
              <span className="muted">
                {undo.votesCast}/{undo.votesRequired} votes
              </span>
              <span style={{ flex: 1 }} />
              <button
                className="small"
                disabled={busy || readOnly}
                onClick={() => void run(() => api.voteUndo(gameId, undo.id, true))}
              >
                Yes
              </button>
              <button
                className="small danger"
                disabled={busy || readOnly}
                onClick={() => void run(() => api.voteUndo(gameId, undo.id, false))}
              >
                No
              </button>
            </div>
          </li>
        ))}
        {pending.length === 0 && <li className="muted">None.</li>}
      </ul>
    </CollapsiblePanel>
  )
}
