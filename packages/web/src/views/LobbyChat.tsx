/**
 * The lobby chat panel on the front page. Split out of `LandingView` so it can
 * own its message input and its pager: the server returns the last three months
 * newest first, and this pages through them ten at a time with the shared
 * `Pager`.
 */

import { useState } from 'react'

import type { ChatMessageDto, PlayerDto } from '../lib/api.js'
import { ChatTimestamp } from './ChatTimestamp.js'
import { Pager } from './Pager.js'

interface Props {
  /** Newest first. */
  readonly messages: readonly ChatMessageDto[]
  readonly player: PlayerDto | null
  readonly busy: boolean
  readonly onSend: (message: string) => Promise<void>
}

const PAGE_SIZE = 10

export function LobbyChat({ messages, player, busy, onSend }: Props): React.JSX.Element {
  const [message, setMessage] = useState('')
  const [page, setPage] = useState(1)

  const pageCount = Math.max(1, Math.ceil(messages.length / PAGE_SIZE))
  // Clamp: the list can shrink under the pager (a page's worth of messages
  // ageing out), and a stale page number must not show an empty page.
  const current = Math.min(page, pageCount)
  const visible = messages.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)

  async function submit(): Promise<void> {
    const text = message.trim()
    if (text === '') return
    try {
      await onSend(text)
      setMessage('')
      setPage(1)
    } catch {
      // `LandingView` shows the error; keep the text so it can be retried.
    }
  }

  return (
    <>
      <ul className="list scroll">
        {visible.map((entry) => (
          <li key={entry.id}>
            <ChatTimestamp createdAt={entry.createdAt} />
            <strong>{entry.username}</strong> <span>{entry.message}</span>
          </li>
        ))}
        {messages.length === 0 && <li className="muted">Quiet in here.</li>}
      </ul>

      <Pager page={current} pageCount={pageCount} onPage={setPage} />

      {player === null ? (
        <p className="muted">Sign in to join the conversation.</p>
      ) : (
        <form
          className="row"
          style={{ marginTop: '0.5rem' }}
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <input
            aria-label="Lobby chat message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={`Write as ${player.username} …`}
            style={{ flex: 1 }}
          />
          <button disabled={busy || message.trim() === ''}>Send</button>
        </form>
      )}
    </>
  )
}
