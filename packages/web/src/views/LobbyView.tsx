/** Spillisten: opprett spill, bli med, åpne. Java: `GameResource`-oversikten. */

import { useCallback, useEffect, useState } from 'react'

import { errorMessage, isUnauthorized } from '../App.js'
import { api } from '../lib/api.js'
import type { GameSummary, PlayerDto } from '../lib/api.js'

interface Props {
  readonly player: PlayerDto
  readonly onOpenGame: (gameId: string) => void
  readonly onUnauthorized: () => void
}

export function LobbyView({ player, onOpenGame, onUnauthorized }: Props): React.JSX.Element {
  const [games, setGames] = useState<readonly GameSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [numOfPlayers, setNumOfPlayers] = useState(4)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      setGames(await api.games())
      setError(null)
    } catch (caught) {
      if (isUnauthorized(caught)) return onUnauthorized()
      setError(errorMessage(caught))
    }
  }, [onUnauthorized])

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
      if (isUnauthorized(caught)) return onUnauthorized()
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h1>Spill</h1>
      {error !== null && <div className="error">{error}</div>}

      <div className="grid">
        <section className="panel">
          <h2>Nytt spill</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void run(async () => {
                await api.createGame(name, numOfPlayers)
                setName('')
              })
            }}
          >
            <label>
              Navn
              <input value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
            <label>
              Antall spillere
              <select
                value={numOfPlayers}
                onChange={(event) => setNumOfPlayers(Number(event.target.value))}
              >
                {/* Java: @Min(2) @Max(5) på CreateNewGameDTO */}
                {[2, 3, 4, 5].map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary" type="submit" disabled={busy || name.trim() === ''}>
              Opprett
            </button>
          </form>
        </section>

        <section className="panel">
          <h2>Pågående og avsluttede</h2>
          {games.length === 0 && <p className="muted">Ingen spill ennå.</p>}
          <ul className="list">
            {games.map((game) => {
              const full = game.players.length >= game.numOfPlayers
              return (
                <li key={game.id}>
                  <strong>{game.name}</strong>
                  <span className="muted">
                    {game.players.length}/{game.numOfPlayers}
                  </span>
                  {!game.active && <span className="tag">avsluttet</span>}
                  {game.winner !== null && <span className="tag revealed">{game.winner} vant</span>}
                  {game.active && game.nameOfUsersTurn !== '' && (
                    <span className={game.nameOfUsersTurn === player.username ? 'tag turn' : 'tag'}>
                      {game.nameOfUsersTurn === player.username
                        ? 'din tur'
                        : `${game.nameOfUsersTurn} sin tur`}
                    </span>
                  )}
                  <span className="spacer" style={{ flex: 1 }} />
                  {game.youAreIn ? (
                    <button className="small" onClick={() => onOpenGame(game.id)}>
                      Åpne
                    </button>
                  ) : (
                    <button
                      className="small"
                      disabled={busy || full || !game.active}
                      onClick={() => void run(() => api.join(game.id))}
                    >
                      {full ? 'Fullt' : 'Bli med'}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      </div>
    </>
  )
}
