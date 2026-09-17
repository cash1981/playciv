/** The public lobby: games, highscore and the read-only lobby chat. */

import { useCallback, useEffect, useState } from 'react'

import { errorMessage, isUnauthorized } from '../App.js'
import { api } from '../lib/api.js'
import type { PlayerDto, PublicGameSummary } from '../lib/api.js'
import { HighscoreView } from './HighscoreView.js'

interface Props {
  readonly player: PlayerDto | null
  readonly onOpenGame: (gameId: string) => void
  readonly onSignIn: () => void
}

export function LandingView({ player, onOpenGame, onSignIn }: Props): React.JSX.Element {
  const [games, setGames] = useState<readonly PublicGameSummary[]>([])
  const [chat, setChat] = useState<readonly { readonly id: string; readonly username: string; readonly message: string; readonly createdAt: string }[]>([])
  const [message, setMessage] = useState('')
  const [name, setName] = useState('')
  const [numOfPlayers, setNumOfPlayers] = useState(4)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      const [nextGames, nextChat] = await Promise.all([api.publicGames(), api.lobbyChat()])
      setGames(nextGames)
      setChat(nextChat)
      setError(null)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await action()
      await reload()
    } catch (caught) {
      if (isUnauthorized(caught)) return onSignIn()
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="landing-intro">
        <h1>Play Civilization</h1>
        <p className="muted">
          Browse active and finished games, compare the highscore and follow the lobby chat.
        </p>
        {player === null && (
          <button className="primary" onClick={onSignIn}>
            Sign in to create, join or chat
          </button>
        )}
      </section>

      {error !== null && <div className="error">{error}</div>}

      <div className="grid">
        <section className="panel">
          <h2>Active and finished games</h2>
          {games.length === 0 && <p className="muted">No games yet.</p>}
          <ul className="list">
            {games.map((game) => {
              const full = game.players.length >= game.numOfPlayers
              const alreadyJoined = player !== null && game.youAreIn
              return (
                <li key={game.id}>
                  <strong>{game.name}</strong>
                  <span className="muted">
                    {game.players.length}/{game.numOfPlayers}
                  </span>
                  {!game.active && <span className="tag">ended</span>}
                  {game.winner !== null && <span className="tag revealed">{game.winner} won</span>}
                  {game.active && game.nameOfUsersTurn !== '' && (
                    <span className="tag">{game.nameOfUsersTurn}’s turn</span>
                  )}
                  <span className="spacer" style={{ flex: 1 }} />
                  {player !== null && alreadyJoined && (
                    <button className="small" onClick={() => onOpenGame(game.id)}>
                      Open
                    </button>
                  )}
                  {player !== null && !alreadyJoined && game.active && (
                    <button
                      className="small"
                      disabled={busy || full}
                      onClick={() => void run(async () => {
                        await api.join(game.id)
                        onOpenGame(game.id)
                      })}
                    >
                      {full ? 'Full' : 'Join'}
                    </button>
                  )}
                  {player === null && game.active && !full && (
                    <span className="muted">Sign in to join</span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        <section className="panel">
          <h2>Lobby chat</h2>
          <ul className="list scroll">
            {chat.map((entry) => (
              <li key={entry.id}>
                <strong>{entry.username}</strong>{' '}
                <span>{entry.message}</span>
              </li>
            ))}
            {chat.length === 0 && <li className="muted">Quiet in here.</li>}
          </ul>
          {player === null ? (
            <p className="muted">Sign in to join the conversation.</p>
          ) : (
            <form
              className="row"
              style={{ marginTop: '0.5rem' }}
              onSubmit={(event) => {
                event.preventDefault()
                const text = message.trim()
                if (text === '') return
                void run(async () => {
                  await api.sendLobbyChat(text)
                  setMessage('')
                })
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
        </section>
      </div>

      {player !== null && (
        <section className="panel">
          <h2>New game</h2>
          <form
            className="row"
            onSubmit={(event) => {
              event.preventDefault()
              void run(async () => {
                const created = await api.createGame(name, numOfPlayers)
                setName('')
                onOpenGame(created.id)
              })
            }}
          >
            <input
              aria-label="Game name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Game name"
              required
            />
            <select
              aria-label="Number of players"
              value={numOfPlayers}
              onChange={(event) => setNumOfPlayers(Number(event.target.value))}
            >
              {[2, 3, 4, 5].map((count) => <option key={count} value={count}>{count} players</option>)}
            </select>
            <button className="primary" type="submit" disabled={busy || name.trim() === ''}>Create</button>
          </form>
        </section>
      )}

      <HighscoreView />
    </>
  )
}
