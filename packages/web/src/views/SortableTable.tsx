/**
 * The highscore table. A faithful port of the old-civ-web ng-table: four
 * columns, click a header to sort, default `totalWins` descending, ten rows
 * per page with a pager.
 *
 * The one deliberate difference from ng-table: `WinnerEntry.percentWin` is a
 * preformatted string (`"50.0 %"`), and the original sorted it as text, which
 * puts `"100.0 %"` before `"50.0 %"`. We sort the three numeric columns
 * (`totalWins`, `attempts`, `percentWin`) numerically and only `username` as
 * text. This is a UI choice, not a game rule.
 */

import { useMemo, useState } from 'react'

import type { WinnerEntry } from '../lib/api.js'

type Column = 'username' | 'totalWins' | 'attempts' | 'percentWin'
type Direction = 'asc' | 'desc'

const PAGE_SIZE = 10

interface Props {
  readonly rows: readonly WinnerEntry[]
  /** "Username" for players, "Civilization" for civs. */
  readonly nameHeader: string
}

/** The leading number of a `percentWin` string like "50.0 %"; 0 when absent. */
function percentValue(entry: WinnerEntry): number {
  return Number.parseFloat(entry.percentWin) || 0
}

function compare(a: WinnerEntry, b: WinnerEntry, column: Column): number {
  switch (column) {
    case 'username':
      return a.username.localeCompare(b.username)
    case 'totalWins':
      return a.totalWins - b.totalWins
    case 'attempts':
      return a.attempts - b.attempts
    case 'percentWin':
      return percentValue(a) - percentValue(b)
  }
}

export function SortableTable({ rows, nameHeader }: Props): React.JSX.Element {
  const [column, setColumn] = useState<Column>('totalWins')
  const [direction, setDirection] = useState<Direction>('desc')
  const [page, setPage] = useState(1)

  const sorted = useMemo(() => {
    const factor = direction === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => compare(a, b, column) * factor)
  }, [rows, column, direction])

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const current = Math.min(page, pageCount)
  const visible = sorted.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)

  function sortBy(next: Column): void {
    if (next === column) {
      setDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setColumn(next)
      // Numbers open descending (highest first); the name opens ascending.
      setDirection(next === 'username' ? 'asc' : 'desc')
    }
    setPage(1)
  }

  const header = (label: string, key: Column) => {
    const active = column === key
    return (
      <th
        scope="col"
        aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <button type="button" className="sort" onClick={() => sortBy(key)}>
          {label}
          <span className="sort-indicator">{active ? (direction === 'asc' ? '▲' : '▼') : ''}</span>
        </button>
      </th>
    )
  }

  return (
    <>
      <table className="highscore-table">
        <thead>
          <tr>
            {header(nameHeader, 'username')}
            {header('Total wins', 'totalWins')}
            {header('Number of attempts', 'attempts')}
            {header('Efficiency', 'percentWin')}
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr>
              <td colSpan={4} className="muted">
                No games yet.
              </td>
            </tr>
          ) : (
            visible.map((entry) => (
              <tr key={entry.username}>
                <td>{entry.username}</td>
                <td>{entry.totalWins}</td>
                <td>{entry.attempts}</td>
                <td>{entry.percentWin}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {pageCount > 1 && (
        <div className="pager">
          <button
            type="button"
            className="small"
            disabled={current <= 1}
            onClick={() => setPage(current - 1)}
          >
            Prev
          </button>
          <span className="muted">
            Page {current} of {pageCount}
          </span>
          <button
            type="button"
            className="small"
            disabled={current >= pageCount}
            onClick={() => setPage(current + 1)}
          >
            Next
          </button>
        </div>
      )}
    </>
  )
}
