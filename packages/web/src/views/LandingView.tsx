/** The public lobby: games, highscore and the read-only lobby chat. */

import { useCallback, useEffect, useState } from 'react'

import { errorMessage, isUnauthorized } from '../App.js'
import { api } from '../lib/api.js'
import type { ChatMessageDto, PlayerDto, PublicGameSummary } from '../lib/api.js'
import { GameList } from './GameList.js'
import { HighscoreView } from './HighscoreView.js'
import { LobbyChat } from './LobbyChat.js'

interface Props {
  readonly player: PlayerDto | null
  readonly onOpenGame: (gameId: string) => void
  readonly onSignIn: () => void
}

export function LandingView({ player, onOpenGame, onSignIn }: Props): React.JSX.Element {
  const [games, setGames] = useState<readonly PublicGameSummary[]>([])
  const [chat, setChat] = useState<readonly ChatMessageDto[]>([])
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

  const run = useCallback(
    async (action: () => Promise<unknown>): Promise<void> => {
      setBusy(true)
      setError(null)
      try {
        await action()
        await reload()
      } catch (caught) {
        if (isUnauthorized(caught)) return onSignIn()
        setError(errorMessage(caught))
        // Re-throw so a caller that owns its own input (the chat box) knows the
        // action failed and can keep the text instead of clearing it.
        throw caught
      } finally {
        setBusy(false)
      }
    },
    [reload, onSignIn],
  )

  // Stable identity so `GameList`'s memoised column arrays (and through them
  // `SortableTable`'s sort memo) survive a re-render.
  const joinGame = useCallback(
    (gameId: string): void => {
      void run(async () => {
        await api.join(gameId)
        onOpenGame(gameId)
      }).catch(() => undefined)
    },
    [run, onOpenGame],
  )

  const sendChat = useCallback(
    (text: string): Promise<void> =>
      run(async () => {
        await api.sendLobbyChat(text)
      }),
    [run],
  )

  return (
    <>
      <section className="landing-intro">
        <h1>
          Play Civilization <span className="beta-badge">Beta</span>
        </h1>
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

      {/* Full width, not in `.grid`: the seven-column game table is wider than a
          grid column's share and used to draw over the chat panel. */}
      <section className="panel">
        <h2>Active and finished games</h2>
        <GameList
          games={games}
          player={player}
          busy={busy}
          onOpenGame={onOpenGame}
          onJoin={joinGame}
        />
      </section>

      {player !== null && (
        <section className="panel">
          <h2>New game</h2>
          <form
            className="row new-game-form"
            onSubmit={(event) => {
              event.preventDefault()
              void run(async () => {
                const created = await api.createGame(name, numOfPlayers)
                setName('')
                onOpenGame(created.id)
              }).catch(() => undefined)
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

      <section className="panel">
        <h2>Lobby chat</h2>
        <LobbyChat messages={chat} player={player} busy={busy} onSend={sendChat} />
      </section>
    </>
  )
}
