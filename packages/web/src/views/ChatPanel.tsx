/**
 * Per-game chat, split out of the Log panel into its own collapsible section
 * (issue #68) so it can be hidden independently of the log/undo voting.
 *
 * `api.chat` returns the whole history in one call — there is no server-side
 * paging for it (unlike the Revealed panel) — so pagination here is a plain
 * client-side slice of the array already in memory.
 */

import { useCallback, useEffect, useState } from 'react'

import { errorMessage } from '../App.js'
import { api } from '../lib/api.js'
import type { ChatMessageDto, PlayerDto, PlayerView } from '../lib/api.js'
import { ChatTimestamp } from './ChatTimestamp.js'
import { CollapsiblePanel } from './CollapsiblePanel.js'

const PAGE_SIZE = 10

interface Props {
  readonly gameId: string
  readonly busy: boolean
  readonly run: (action: () => Promise<PlayerView | unknown>) => Promise<void>
  readonly player: PlayerDto
  readonly reloadCount: number
}

export function ChatPanel({ gameId, busy, run, player, reloadCount }: Props): React.JSX.Element {
  const [chat, setChat] = useState<readonly ChatMessageDto[]>([])
  const [message, setMessage] = useState('')
  const [page, setPage] = useState(1)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setChat(await api.chat(gameId))
      setLoadError(null)
    } catch (caught) {
      setLoadError(errorMessage(caught))
    }
  }, [gameId])

  useEffect(() => {
    void load()
  }, [load, reloadCount])

  // Newest first, paged 10 at a time.
  const newestFirst = [...chat].reverse()
  const totalPages = Math.max(1, Math.ceil(newestFirst.length / PAGE_SIZE))
  const shown = newestFirst.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  return (
    <CollapsiblePanel id="chat" title={`Chat (${chat.length})`}>
      {loadError !== null && <div className="error">{loadError}</div>}

      <ul className="list scroll">
        {shown.map((entry) => (
          <li key={entry.id}>
            <ChatTimestamp createdAt={entry.createdAt} />
            <strong>{entry.username}</strong>
            <span>{entry.message}</span>
          </li>
        ))}
        {shown.length === 0 && <li className="muted">Quiet in here.</li>}
      </ul>

      <div className="row" style={{ marginTop: '0.5rem', alignItems: 'center' }}>
        <button className="small" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
          Previous
        </button>
        <span className="muted">
          Page {Math.min(page, totalPages)} of {totalPages}
        </span>
        <button
          className="small"
          disabled={page >= totalPages}
          onClick={() => setPage((current) => current + 1)}
        >
          Next
        </button>
        <span style={{ flex: 1 }} />
        <button className="small" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      <form
        className="row"
        style={{ marginTop: '0.5rem' }}
        onSubmit={(event) => {
          event.preventDefault()
          const text = message.trim()
          if (text === '') return
          void run(async () => {
            await api.sendChat(gameId, text)
            setMessage('')
            setPage(1)
            await load()
          })
        }}
      >
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={`Write as ${player.username} …`}
          style={{ flex: 1 }}
        />
        <button disabled={busy || message.trim() === ''}>Send</button>
      </form>
    </CollapsiblePanel>
  )
}
