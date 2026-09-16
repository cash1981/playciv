/**
 * The public Highscore page. Port of `old-civ-web/app/views/highscore.html`
 * and `HighscoreController.js`: two top-level tabs (Player / Civilization),
 * each with sub-tabs Total wins and 2 / 3 / 4 / 5 player game.
 *
 * The captions read from the player table on every tab, exactly as the
 * AngularJS controller did — all its caption bindings came from
 * `playerHighscore`, even on the civilization tabs.
 */

import { useEffect, useState } from 'react'

import { errorMessage } from '../App.js'
import { api } from '../lib/api.js'
import type { HighscoreResult, WinnerEntry } from '../lib/api.js'
import { SortableTable } from './SortableTable.js'

type TopTab = 'players' | 'civs'
type CountTab = 'total' | 'two' | 'three' | 'four' | 'five'

interface CountConfig {
  readonly key: CountTab
  readonly label: string
  /** The `WinnerEntry[]` field on a table for this player count. */
  readonly list: 'winners' | 'twoWinners' | 'threeWinners' | 'fourWinners' | 'fiveWinners'
  /** null on the Total tab, else the player count for the caption. */
  readonly players: number | null
  /** The matching total-games field on the player table, for the caption. */
  readonly gamesTotal:
    | 'twoPlayerGamesTotal'
    | 'threePlayerGamesTotal'
    | 'fourPlayerGamesTotal'
    | 'fivePlayerGamesTotal'
    | null
}

const COUNTS: readonly CountConfig[] = [
  { key: 'total', label: 'Total wins', list: 'winners', players: null, gamesTotal: null },
  { key: 'two', label: '2 player game', list: 'twoWinners', players: 2, gamesTotal: 'twoPlayerGamesTotal' },
  { key: 'three', label: '3 player game', list: 'threeWinners', players: 3, gamesTotal: 'threePlayerGamesTotal' },
  { key: 'four', label: '4 player game', list: 'fourWinners', players: 4, gamesTotal: 'fourPlayerGamesTotal' },
  { key: 'five', label: '5 player game', list: 'fiveWinners', players: 5, gamesTotal: 'fivePlayerGamesTotal' },
]

const CONFIG = Object.fromEntries(COUNTS.map((entry) => [entry.key, entry])) as Record<
  CountTab,
  CountConfig
>

function Tabs<T extends string>(props: {
  readonly tabs: readonly { readonly key: T; readonly label: string }[]
  readonly active: T
  readonly onSelect: (key: T) => void
}): React.JSX.Element {
  return (
    <div className="tabs">
      {props.tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          aria-pressed={tab.key === props.active}
          className={tab.key === props.active ? 'tab active' : 'tab'}
          onClick={() => props.onSelect(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

export function HighscoreView(): React.JSX.Element {
  const [data, setData] = useState<HighscoreResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [top, setTop] = useState<TopTab>('players')
  const [count, setCount] = useState<CountTab>('total')

  useEffect(() => {
    let cancelled = false
    api
      .highscore()
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(errorMessage(caught))
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error !== null) return <div className="error">{error}</div>
  if (data === null) return <p className="muted">Loading …</p>

  const config = CONFIG[count]
  const table = top === 'players' ? data.players : data.civs
  const rows: readonly WinnerEntry[] = table[config.list]
  const nameHeader = top === 'players' ? 'Username' : 'Civilization'

  const caption =
    config.players === null ? (
      <>
        Total number of players: {data.players.totalNumberOfPlayers}
        <br />
        Total number of games: {data.players.totalNumberOfGames}
      </>
    ) : (
      <>
        Total number of {config.players} player games played:{' '}
        {config.gamesTotal === null ? 0 : data.players[config.gamesTotal]}
      </>
    )

  return (
    <>
      <h1>Highscore</h1>
      <p className="muted">Who is the best? And which Civs are the strongest?</p>

      <div className="panel">
        <Tabs
          tabs={[
            { key: 'players', label: 'Player highscore' },
            { key: 'civs', label: 'Civilization highscore' },
          ]}
          active={top}
          onSelect={setTop}
        />

        <Tabs tabs={COUNTS} active={count} onSelect={setCount} />

        <p className="highscore-caption">{caption}</p>

        {/* A fresh table per tab, so each opens at page 1 sorted totalWins desc,
            the way the original gave every tab its own NgTableParams. */}
        <SortableTable key={`${top}-${count}`} rows={rows} nameHeader={nameHeader} />
      </div>
    </>
  )
}
