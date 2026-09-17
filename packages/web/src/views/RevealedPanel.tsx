/**
 * The Revealed and Discarded Items panel (issue #51), replacing the old
 * Opponents panel.
 *
 * A chronological, newest-first list of every publicly known item: the card
 * itself, who revealed or owns it, and whether it was revealed, discarded, or
 * both. The server pages the feed (`?page=&size=`) and returns one bounded page
 * plus the total, so the browser never loads the whole history; images on the
 * page load lazily on top of that.
 *
 * Everything here is already public — the server only ever returns discarded
 * items and non-hidden hand items — so the full card face is shown.
 */

import { useCallback, useEffect, useState } from 'react'

import { revealAll } from '@civ/engine'
import { errorMessage } from '../App.js'
import { api } from '../lib/api.js'
import type { RevealedEntry, RevealedPage } from '../lib/api.js'
import { CollapsiblePanel } from './CollapsiblePanel.js'
import { itemImageUrl } from './ItemCard.js'

const PAGE_SIZE = 20

interface Props {
  readonly gameId: string
  readonly reloadCount: number
}

export function RevealedPanel({ gameId, reloadCount }: Props): React.JSX.Element {
  const [page, setPage] = useState(1)
  const [data, setData] = useState<RevealedPage | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await api.revealed(gameId, page, PAGE_SIZE))
      setLoadError(null)
    } catch (caught) {
      setLoadError(errorMessage(caught))
    }
  }, [gameId, page])

  useEffect(() => {
    void load()
  }, [load, reloadCount])

  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const items = data?.items ?? []

  return (
    <CollapsiblePanel id="revealed" title={`Revealed and Discarded Items (${total})`}>
      {loadError !== null && <div className="error">{loadError}</div>}

      <ul className="card-grid scroll">
        {items.map((entry) => (
          <RevealedRow key={entry.item.id} entry={entry} />
        ))}
        {items.length === 0 && <li className="muted">Nothing has been revealed yet.</li>}
      </ul>

      <div className="row" style={{ marginTop: '0.5rem', alignItems: 'center' }}>
        <button className="small" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
          Previous
        </button>
        <span className="muted">
          Page {Math.min(page, totalPages)} of {totalPages}
        </span>
        <button
          className="small"
          disabled={page >= totalPages}
          onClick={() => setPage((current) => current + 1)}
        >
          Next
        </button>
        <span style={{ flex: 1 }} />
        <button className="small" onClick={() => void load()}>
          Refresh
        </button>
      </div>
    </CollapsiblePanel>
  )
}

export function RevealedRow({ entry }: { readonly entry: RevealedEntry }): React.JSX.Element {
  const { item } = entry
  const label = revealAll(item)
  const url = itemImageUrl(item)

  return (
    <li className="card">
      <div className="card-art">
        {url === null ? (
          <span className="card-art-fallback">{label}</span>
        ) : (
          <img
            src={url}
            alt={label}
            loading="lazy"
            decoding="async"
            onError={(event) => {
              event.currentTarget.style.display = 'none'
            }}
          />
        )}
      </div>

      <div className="card-caption">
        <strong>{label}</strong>
        <span className="muted">
          {item.sheetName} · #{item.itemNumber}
        </span>
        {item.description !== null && item.description !== '' && (
          <span className="card-text">{item.description}</span>
        )}
        <span className="revealed-meta">
          {entry.username !== null && <span className="muted">by {entry.username}</span>}
          {entry.revealed && <span className="tag revealed">revealed</span>}
          {entry.discarded && <span className="tag discarded">discarded</span>}
        </span>
      </div>
    </li>
  )
}
