/**
 * The Prev / "Page X of Y" / Next control, lifted verbatim out of
 * `SortableTable` so the highscore and the game list share one pager.
 * Renders nothing for a single page, as before.
 */

interface Props {
  readonly page: number
  readonly pageCount: number
  readonly onPage: (page: number) => void
}

export function Pager({ page, pageCount, onPage }: Props): React.JSX.Element | null {
  if (pageCount <= 1) return null

  return (
    <div className="pager">
      <button
        type="button"
        className="small"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        Prev
      </button>
      <span className="muted">
        Page {page} of {pageCount}
      </span>
      <button
        type="button"
        className="small"
        disabled={page >= pageCount}
        onClick={() => onPage(page + 1)}
      >
        Next
      </button>
    </div>
  )
}
