// @vitest-environment jsdom

/**
 * The shared sortable/paged table. The highscore's behaviour is guarded here
 * too, since it now runs through this component: text sorts ascending first,
 * numbers descending first, and the pager shows one page at a time.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { SortableTable } from './SortableTable.js'
import type { SortableColumn } from './SortableTable.js'

interface Row {
  readonly name: string
  readonly score: number
}

const columns: readonly SortableColumn<Row>[] = [
  { key: 'name', header: 'Name', sortValue: (row) => row.name, render: (row) => row.name },
  { key: 'score', header: 'Score', sortValue: (row) => row.score, render: (row) => row.score },
]

const rows: readonly Row[] = [
  { name: 'Charlie', score: 30 },
  { name: 'Alice', score: 10 },
  { name: 'Bob', score: 20 },
]

afterEach(cleanup)

/** The text of each body row's cells, in render order. */
function bodyRows(): string[][] {
  return Array.from(document.querySelectorAll('tbody tr')).map((row) =>
    Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent ?? ''),
  )
}

describe('SortableTable', () => {
  it('opens a text column ascending and a numeric column descending', () => {
    render(
      <SortableTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.name}
        initialSortKey="name"
        emptyMessage="Nothing"
      />,
    )

    expect(bodyRows().map((cells) => cells[0])).toEqual(['Alice', 'Bob', 'Charlie'])

    // Score is numeric, so the first click opens descending (highest first).
    fireEvent.click(screen.getByRole('button', { name: /score/i }))
    expect(bodyRows().map((cells) => cells[1])).toEqual(['30', '20', '10'])

    // Clicking the active column again flips the direction.
    fireEvent.click(screen.getByRole('button', { name: /score/i }))
    expect(bodyRows().map((cells) => cells[1])).toEqual(['10', '20', '30'])
  })

  it('uses the initial sort direction of the named column', () => {
    render(
      <SortableTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.name}
        initialSortKey="score"
        emptyMessage="Nothing"
      />,
    )

    expect(bodyRows().map((cells) => cells[1])).toEqual(['30', '20', '10'])
  })

  it('shows one page at a time with a working pager', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      name: `Game ${String(index).padStart(2, '0')}`,
      score: index,
    }))

    render(
      <SortableTable
        rows={many}
        columns={columns}
        rowKey={(row) => row.name}
        initialSortKey="name"
        emptyMessage="Nothing"
      />,
    )

    expect(bodyRows()).toHaveLength(10)
    expect(screen.getByText('Page 1 of 2')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Prev' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(bodyRows()).toHaveLength(2)
    expect(screen.getByText('Page 2 of 2')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Prev' }))
    expect(screen.getByText('Page 1 of 2')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Prev' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('passes the row position in the whole sorted list, not the page', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      name: `Game ${String(index).padStart(2, '0')}`,
      score: index,
    }))
    const numbered: readonly SortableColumn<Row>[] = [
      { key: 'position', header: '#', render: (_row, index) => index + 1 },
      ...columns,
    ]

    render(
      <SortableTable
        rows={many}
        columns={numbered}
        rowKey={(row) => row.name}
        initialSortKey="name"
        emptyMessage="Nothing"
      />,
    )

    expect(bodyRows()[0]?.[0]).toBe('1')

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    // The first row of page 2 is position 11 in the whole sorted list.
    expect(bodyRows()[0]?.[0]).toBe('11')
  })

  it('renders the empty message and leaves an unsortable column header plain', () => {
    render(
      <SortableTable
        rows={[]}
        columns={columns}
        rowKey={(row) => row.name}
        initialSortKey="name"
        emptyMessage="Nothing here"
      />,
    )

    expect(screen.getByText('Nothing here')).toBeTruthy()
    expect(screen.queryAllByRole('button')).toHaveLength(2)
  })
})
