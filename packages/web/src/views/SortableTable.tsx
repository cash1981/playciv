/**
 * A sortable, paged table. The highscore was the first user (port of
 * old-civ-web's ng-table); the game list reuses the same component, so the
 * columns and the page size are props now.
 *
 * The one deliberate difference from ng-table: `sortValue` sorts numbers
 * numerically and strings with `localeCompare`. The highscore's `percentWin` is
 * a preformatted string (`"50.0 %"`), which the original sorted as text — that
 * puts `"100.0 %"` before `"50.0 %"`, so its column supplies a number. This is
 * a UI choice, not a game rule.
 */

import { useMemo, useState } from 'react'

import { Pager } from './Pager.js'

type Direction = 'asc' | 'desc'

export interface SortableColumn<T> {
  readonly key: string
  readonly header: string
  /** Omit to make the column unsortable. */
  readonly sortValue?: (row: T) => string | number
  readonly render: (row: T, index: number) => React.ReactNode
  /** Direction when this column is first selected; numbers default desc. */
  readonly initialDirection?: 'asc' | 'desc'
}

interface Props<T> {
  readonly rows: readonly T[]
  readonly columns: readonly SortableColumn<T>[]
  readonly rowKey: (row: T, index: number) => string
  readonly initialSortKey: string
  readonly emptyMessage: string
  readonly pageSize?: number
}

const DEFAULT_PAGE_SIZE = 10

function compareValues(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

/** Numbers open descending (highest first); text opens ascending. */
function defaultDirection<T>(column: SortableColumn<T>, rows: readonly T[]): Direction {
  if (column.initialDirection !== undefined) return column.initialDirection
  const sample = rows[0]
  const sortValue = column.sortValue
  if (sample !== undefined && sortValue !== undefined) {
    return typeof sortValue(sample) === 'number' ? 'desc' : 'asc'
  }
  return 'asc'
}

export function SortableTable<T>({
  rows,
  columns,
  rowKey,
  initialSortKey,
  emptyMessage,
  pageSize = DEFAULT_PAGE_SIZE,
}: Props<T>): React.JSX.Element {
  const [sortKey, setSortKey] = useState(initialSortKey)
  const [direction, setDirection] = useState<Direction>(() => {
    const initial = columns.find((column) => column.key === initialSortKey)
    return initial === undefined ? 'asc' : defaultDirection(initial, rows)
  })
  const [page, setPage] = useState(1)

  const sorted = useMemo(() => {
    const column = columns.find((entry) => entry.key === sortKey)
    const sortValue = column?.sortValue
    if (sortValue === undefined) return [...rows]
    const factor = direction === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => compareValues(sortValue(a), sortValue(b)) * factor)
  }, [rows, columns, sortKey, direction])

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const current = Math.min(page, pageCount)
  const visible = sorted.slice((current - 1) * pageSize, current * pageSize)

  function sortBy(column: SortableColumn<T>): void {
    if (column.key === sortKey) {
      setDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(column.key)
      setDirection(defaultDirection(column, rows))
    }
    setPage(1)
  }

  const header = (column: SortableColumn<T>) => {
    if (column.sortValue === undefined) {
      return (
        <th key={column.key} scope="col">
          {column.header}
        </th>
      )
    }
    const active = column.key === sortKey
    return (
      <th
        key={column.key}
        scope="col"
        aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <button type="button" className="sort" onClick={() => sortBy(column)}>
          {column.header}
          <span className="sort-indicator">{active ? (direction === 'asc' ? '▲' : '▼') : ''}</span>
        </button>
      </th>
    )
  }

  return (
    <>
      <table className="data-table">
        <thead>
          <tr>{columns.map(header)}</tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="muted">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            visible.map((row, localIndex) => {
              // `index` is the row's position in the whole sorted list, not the
              // page, so a `#` column numbers across pages.
              const index = (current - 1) * pageSize + localIndex
              return (
                <tr key={rowKey(row, index)}>
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={column.key === 'action' ? 'action-cell' : undefined}
                    >
                      {column.render(row, index)}
                    </td>
                  ))}
                </tr>
              )
            })
          )}
        </tbody>
      </table>

      <Pager page={current} pageCount={pageCount} onPage={setPage} />
    </>
  )
}
