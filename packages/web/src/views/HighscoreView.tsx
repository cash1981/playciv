/**
 * The public Highscore page. Port of `old-civ-web/app/views/highscore.html`
 * and `HighscoreController.js`: two top-level tabs (Player / Civilization),
 * each with sub-tabs Total wins and 2 / 3 / 4 / 5 player game.
 *
 * The captions read from the player table on every tab, exactly as the
 * AngularJS controller did — all its caption bindings came from
 * `playerHighscore`, even on the civilization tabs.
 */

import { useEffect, useMemo, useState } from 'react'

import { errorMessage } from '../App.js'
import { api } from '../lib/api.js'
import type { HighscoreResult, WinnerEntry } from '../lib/api.js'
import { SortableTable } from './SortableTable.js'
import type { SortableColumn } from './SortableTable.js'
import { Tabs } from './Tabs.js'

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

/** The leading number of a `percentWin` string like "50.0 %"; 0 when absent. */
function percentValue(entry: WinnerEntry): number {
  return Number.parseFloat(entry.percentWin) || 0
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

  const nameHeader = top === 'players' ? 'Username' : 'Civilization'
  // Stable so `SortableTable`'s sort memo is not invalidated every render; only
  // the name header depends on `top`. The three numeric columns override the
  // string/text default and open descending, as before.
  const columns = useMemo<readonly SortableColumn<WinnerEntry>[]>(
    () => [
      {
        key: 'username',
        header: nameHeader,
        sortValue: (entry) => entry.username,
        render: (entry) => entry.username,
        initialDirection: 'asc',
      },
      {
        key: 'totalWins',
        header: 'Total wins',
        sortValue: (entry) => entry.totalWins,
        render: (entry) => entry.totalWins,
        initialDirection: 'desc',
      },
      {
        key: 'attempts',
        header: 'Number of attempts',
        sortValue: (entry) => entry.attempts,
        render: (entry) => entry.attempts,
        initialDirection: 'desc',
      },
      {
        key: 'percentWin',
        header: 'Efficiency',
        sortValue: (entry) => percentValue(entry),
        render: (entry) => entry.percentWin,
        initialDirection: 'desc',
      },
    ],
    [nameHeader],
  )

  if (error !== null) return <div className="error">{error}</div>
  if (data === null) return <p className="muted">Loading …</p>

  const config = CONFIG[count]
  const table = top === 'players' ? data.players : data.civs
  const rows: readonly WinnerEntry[] = table[config.list]

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
        <SortableTable
          key={`${top}-${count}`}
          rows={rows}
          columns={columns}
          rowKey={(entry) => entry.username}
          initialSortKey="totalWins"
          emptyMessage="No games yet."
        />
      </div>
    </>
  )
}
