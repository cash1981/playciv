/**
 * Logg, undo-avstemning og chat.
 *
 * Den offentlige loggen kommer fra serverens `publicLog`-felt og inneholder
 * aldri innholdet i et skjult kort. Den private loggen er filtrert på
 * spillerens egne poster på serversiden.
 */

import { useCallback, useEffect, useState } from 'react'

import { errorMessage } from '../App.js'
import { api } from '../lib/api.js'
import type { ChatMessageDto, LogEntryDto, PendingUndoDto, PlayerDto, PlayerView } from '../lib/api.js'

interface Props {
  readonly gameId: string
  readonly busy: boolean
  readonly run: (action: () => Promise<PlayerView | unknown>) => Promise<void>
  readonly player: PlayerDto
  readonly reloadCount: number
}

type Tab = 'public' | 'private'

export function LogPanel({ gameId, busy, run, player, reloadCount }: Props): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('public')
  const [publicLog, setPublicLog] = useState<readonly LogEntryDto[]>([])
  const [privateLog, setPrivateLog] = useState<readonly LogEntryDto[]>([])
  const [pending, setPending] = useState<readonly PendingUndoDto[]>([])
  const [chat, setChat] = useState<readonly ChatMessageDto[]>([])
  const [message, setMessage] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [pub, priv, undos, messages] = await Promise.all([
        api.publicLog(gameId),
        api.privateLog(gameId),
        api.pendingUndos(gameId),
        api.chat(gameId),
      ])
      setPublicLog(pub)
      setPrivateLog(priv)
      setPending(undos)
      setChat(messages)
      setLoadError(null)
    } catch (caught) {
      setLoadError(errorMessage(caught))
    }
  }, [gameId])

  useEffect(() => {
    void load()
  }, [load, reloadCount])

  const entries = tab === 'public' ? publicLog : privateLog

  return (
    <section className="panel">
      <h2>Logg</h2>
      {loadError !== null && <div className="error">{loadError}</div>}

      <div className="row">
        <button
          className="small"
          disabled={tab === 'public'}
          onClick={() => setTab('public')}
        >
          Offentlig
        </button>
        <button
          className="small"
          disabled={tab === 'private'}
          onClick={() => setTab('private')}
        >
          Privat
        </button>
        <span style={{ flex: 1 }} />
        <button className="small" onClick={() => void load()}>
          Oppdater
        </button>
      </div>

      <ul className="list log">
        {entries.map((entry) => (
          <li key={entry.id}>
            <span>{entry.message}</span>{' '}
            {entry.hasUndo && <span className="tag">undo pågår</span>}
            {tab === 'private' && entry.canUndo === true && (
              <button
                className="small"
                disabled={busy}
                onClick={() => void run(() => api.initiateUndo(gameId, entry.id))}
              >
                Be om undo
              </button>
            )}
          </li>
        ))}
        {entries.length === 0 && <li className="muted">Ingenting her ennå.</li>}
      </ul>

      <h3 style={{ marginTop: '1rem' }}>Undo som venter på din stemme</h3>
      <ul className="list">
        {pending.map((undo) => (
          <li key={undo.id} style={{ display: 'block' }}>
            <div>{undo.message}</div>
            <div className="row" style={{ marginTop: '0.25rem' }}>
              <span className="muted">
                {undo.votesCast}/{undo.votesRequired} stemmer
              </span>
              <span style={{ flex: 1 }} />
              <button
                className="small"
                disabled={busy}
                onClick={() => void run(() => api.voteUndo(gameId, undo.id, true))}
              >
                Ja
              </button>
              <button
                className="small danger"
                disabled={busy}
                onClick={() => void run(() => api.voteUndo(gameId, undo.id, false))}
              >
                Nei
              </button>
            </div>
          </li>
        ))}
        {pending.length === 0 && <li className="muted">Ingen.</li>}
      </ul>

      <h3 style={{ marginTop: '1rem' }}>Chat</h3>
      <ul className="list scroll">
        {chat.map((entry) => (
          <li key={entry.id}>
            <strong>{entry.username}</strong>
            <span>{entry.message}</span>
          </li>
        ))}
        {chat.length === 0 && <li className="muted">Stille her.</li>}
      </ul>
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
            await load()
          })
        }}
      >
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={`Skriv som ${player.username} …`}
          style={{ flex: 1 }}
        />
        <button disabled={busy || message.trim() === ''}>Send</button>
      </form>
    </section>
  )
}
