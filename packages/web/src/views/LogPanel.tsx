/**
 * The log and undo voting.
 *
 * The public log comes from the server's `publicLog` field and never carries
 * the contents of a hidden card. The private log is filtered down to the
 * player's own entries on the server side. Chat lives in the chat and orders
 * timeline (`ChatOrdersPanel`).
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { errorMessage } from '../App.js'
import { trackActivity } from '../lib/activity.js'
import { KING_NAME } from '@civ/engine'

import { stopCancelPick, useCancelPick } from '../lib/cancelPick.js'
import { api } from '../lib/api.js'
import type { GameRevisionView, LogEntryDto, PendingUndoDto, PlayerView } from '../lib/api.js'
import { formatTimestamp } from '../lib/formatTimestamp.js'
import { revealPanel } from '../lib/reveal.js'
import { showToast } from '../lib/toasts.js'
import { CollapsiblePanel } from './CollapsiblePanel.js'

interface Props {
  readonly gameId: string
  readonly busy: boolean
  readonly run: (action: () => Promise<PlayerView | unknown>) => Promise<void>
  readonly reloadCount: number
  readonly historical?: GameRevisionView | null
  readonly readOnly?: boolean
  /** The viewer's projection; its cancellation data drives the cancel mode (a cancellation card, or King). */
  readonly view?: PlayerView
}

type Tab = 'public' | 'private'

const VOTES_ID = 'undo-votes'

export function LogPanel({ gameId, busy, run, reloadCount, historical = null, readOnly = false, view }: Props): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('public')
  const [publicLog, setPublicLog] = useState<readonly LogEntryDto[]>([])
  const [privateLog, setPrivateLog] = useState<readonly LogEntryDto[]>([])
  const [pending, setPending] = useState<readonly PendingUndoDto[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const requestEpoch = useRef(0)
  const reminded = useRef(false)
  // Only a player can vote; the load callback reads this instead of depending on the view
  const isPlayer = useRef(true)
  isPlayer.current = view?.you !== null
  const cancelPick = useCancelPick()
  // One request id per intent, so a retry after a lost response is the same cancellation
  const intent = useRef<{ key: string; id: string } | null>(null)
  const submitCancellation = (logId: string, itemId: string): void => {
    const key = `${logId}/${itemId}`
    if (intent.current?.key !== key) intent.current = { key, id: crypto.randomUUID() }
    const id = intent.current.id
    void run(() => api.cancellation(gameId, { logId, itemId }, view?.rev ?? 0, id))
  }

  // The eligible log lines of the card that started the cancel mode: only these can be picked
  const choice = view?.cancellations?.responseCards.find((card) => card.itemId === cancelPick?.itemId)
  const cancellable = new Set(choice?.targets.filter((target) => target.blocked === null).map((target) => target.logId))
  // King needs no mode: a cancellation of his holder's city action carries a Protect button of its own
  const kingFor = (logId: string) => view?.cancellations?.responseCards.find((card) =>
    card.name === KING_NAME && card.targets.some((target) => target.logId === logId && target.blocked === null))
  // The mode ends when the card is gone (played, discarded or blockaded)
  const modeOver = cancelPick !== null && choice === undefined
  useEffect(() => {
    if (modeOver) stopCancelPick()
  }, [modeOver])
  // Leaving the game ends the mode too
  useEffect(() => stopCancelPick, [])

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
      // Once per page load: a vote that waits for this player is easy to miss
      if (undos.length > 0 && !reminded.current && isPlayer.current) {
        reminded.current = true
        showToast(
          'notice',
          undos.length === 1 ? 'An undo is waiting for your vote.' : `${undos.length} undos are waiting for your vote.`,
          { label: 'Go to vote', onClick: () => revealPanel('log', VOTES_ID) },
        )
      }
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
    <CollapsiblePanel id="log" title="Log" defaultOpen>
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
        <button className="small" onClick={() => void trackActivity(load())}>
          Refresh
        </button>
      </div>

      {cancelPick !== null && !modeOver && (
        <div className="cancel-mode" role="status">
          <span>
            Cancel with {cancelPick.name}: choose the action to cancel below.
            {cancellable.size === 0 && ' No action in the log can be cancelled with it.'}
          </span>
          <button className="small" onClick={() => stopCancelPick()}>
            Stop
          </button>
        </div>
      )}

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
            {tab === 'public' && cancelPick !== null && !modeOver && cancellable.has(entry.id) && (
              <button
                className="small danger"
                disabled={busy || readOnly}
                aria-label={`Cancel: ${entry.message}`}
                onClick={() => {
                  if (!window.confirm(`Cancel with ${cancelPick.name}: "${entry.message}"? It takes effect at once.`)) return
                  stopCancelPick()
                  submitCancellation(entry.id, cancelPick.itemId)
                }}
              >
                Cancel
              </button>
            )}
            {tab === 'public' && kingFor(entry.id) !== undefined && (
              <button
                className="small success"
                disabled={busy || readOnly}
                aria-label={`Protect with King: ${entry.message}`}
                onClick={() => {
                  const king = kingFor(entry.id)
                  if (king === undefined || !window.confirm(`Protect with ${king.name}: "${entry.message}"? It takes effect at once.`)) return
                  submitCancellation(entry.id, king.itemId)
                }}
              >
                Protect
              </button>
            )}
            {/* The server sets canUndo on the public log only for a line an assisted action wrote. */}
            {entry.canUndo === true && (
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

      <h3 id={VOTES_ID} style={{ marginTop: '1rem' }}>Undo waiting for your vote</h3>
      <ul className={pending.length > 0 ? 'list vote-needed' : 'list'}>
        {pending.map((undo) => (
          <li key={undo.id} style={{ display: 'block' }}>
            <div className="vote-message">{undo.message}</div>
            <div className="row" style={{ marginTop: '0.25rem' }}>
              <span className="muted">
                {undo.votesCast}/{undo.votesRequired} votes
              </span>
              <span style={{ flex: 1 }} />
              <button
                className="small success"
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
