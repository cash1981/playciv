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
 * The panel shows an initial `INITIAL_SIZE` items; each "Load more" click
 * re-requests page 1 with a larger size and replaces the shown list wholesale
 * (issue #166), rather than appending client-side — so a feed that changes
 * between loads (e.g. a reshuffle) can never leave a stale or duplicated
 * entry on screen. See the `atCap` comment below for the server's 100-item
 * cap and the known limitation it leaves (recorded in `decisions.md`).
 *
 * Everything here is already public — the server only ever returns discarded
 * items and non-hidden hand items — so the full card face is shown.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { revealAll } from '@civ/engine'
import { errorMessage } from '../App.js'
import { api } from '../lib/api.js'
import type { GameRevisionView, RevealedEntry, RevealedPage } from '../lib/api.js'
import { CollapsiblePanel } from './CollapsiblePanel.js'
import { itemImageUrl } from './ItemCard.js'

const INITIAL_SIZE = 6
const LOAD_MORE_SIZE = 5

interface Props {
  readonly gameId: string
  readonly reloadCount: number
  readonly historical?: GameRevisionView | null
}

export function RevealedPanel({ gameId, reloadCount, historical = null }: Props): React.JSX.Element {
  const [visibleSize, setVisibleSize] = useState(INITIAL_SIZE)
  const [data, setData] = useState<RevealedPage | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const requestEpoch = useRef(0)

  const load = useCallback(
    async (size: number) => {
      const epoch = ++requestEpoch.current
      if (historical !== null) {
        setData({
          items: historical.revealed.slice(0, size),
          total: historical.revealed.length,
          page: 1,
          size,
        })
        setLoadError(null)
        return
      }
      try {
        const next = await api.revealed(gameId, 1, size)
        if (epoch !== requestEpoch.current) return
        setData(next)
        setLoadError(null)
      } catch (caught) {
        if (epoch !== requestEpoch.current) return
        setLoadError(errorMessage(caught))
      }
    },
    [gameId, historical],
  )

  useEffect(() => {
    void load(visibleSize)
  }, [load, reloadCount, visibleSize])

  const total = data?.total ?? 0
  const items = data?.items ?? []
  // The server clamps `size` to `MAX_REVEALED_SIZE` (100); once the requested
  // size exceeds that, the response's own `size` comes back smaller than what
  // was asked for. That is the signal used here to stop offering "Load more"
  // rather than requesting the same capped 100 forever. Known limitation: a
  // feed past 100 entries has no way to reach the rest from this panel — see
  // the 2026-09-25 "issue #166" entry in decisions.md.
  //
  // Gated on `loadError === null`: a failed request leaves `data` at its
  // last successful (smaller) size while `visibleSize` has already moved on,
  // which would otherwise look identical to hitting the cap and disable
  // "Load more" until a manual Refresh — the error banner plus a still-live
  // button is the honest state instead.
  const atCap = data !== null && loadError === null && data.size < visibleSize
  const hasMore = !atCap && items.length < total
  const capped = atCap && items.length < total

  return (
    <CollapsiblePanel id="revealed" title={`Revealed and Discarded Items (${total})`} defaultOpen={false}>
      {loadError !== null && <div className="error">{loadError}</div>}

      <ul className="card-grid scroll">
        {items.map((entry) => (
          <RevealedRow key={entry.item.id} entry={entry} />
        ))}
        {items.length === 0 && <li className="muted">Nothing has been revealed yet.</li>}
      </ul>

      <div className="row" style={{ marginTop: '0.5rem', alignItems: 'center' }}>
        <span className="muted">
          Showing {items.length} of {total}
          {capped && ' — older items are not shown here'}
        </span>
        <button
          className="small"
          disabled={!hasMore}
          onClick={() => setVisibleSize((current) => current + LOAD_MORE_SIZE)}
        >
          Load more
        </button>
        <span style={{ flex: 1 }} />
        <button className="small" onClick={() => void load(visibleSize)}>
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
