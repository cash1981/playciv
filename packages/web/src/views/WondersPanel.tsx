import { compareWonderNames, WONDER_DESCRIPTIONS } from '@civ/engine'

import type { PlayerView } from '../lib/api.js'
import { api } from '../lib/api.js'
import type { Run } from './GameView.js'
import { CollapsiblePanel } from './CollapsiblePanel.js'

export function WondersPanel({
  gameId,
  view,
  busy,
  readOnly,
  run,
}: {
  readonly gameId: string
  readonly view: PlayerView
  readonly busy: boolean
  readonly readOnly: boolean
  readonly run: Run
}): React.JSX.Element {
  // Every wonder piece still on the board, wherever it currently sits — a
  // wonder moved out of the shared Wonders area (e.g. onto the map) stays
  // listed here; only removing the piece entirely drops it, since `removePiece`
  // is what takes it out of `board.pieces` (issue #191).
  const pieces = view.board.pieces
    .filter((piece) => piece.category === 'wonder')
    .sort((a, b) => compareWonderNames(a.label, b.label))
  const players = [
    ...(view.you === null ? [] : [{ playerId: view.you.playerId, username: view.you.username }]),
    ...view.opponents.map(({ playerId, username }) => ({ playerId, username })),
  ]

  return (
    <CollapsiblePanel id="wonders" title={`Wonders in play (${pieces.length})`} defaultOpen={false}>
      {pieces.length === 0 ? (
        <p className="muted">No wonders in play.</p>
      ) : (
        <ul className="card-grid">
          {pieces.map((piece) => {
            const description = WONDER_DESCRIPTIONS[piece.label]
            return (
              <li key={piece.id} className="card">
                <img src={`/board/${piece.path}`} alt="" style={{ width: 56, height: 56, objectFit: 'contain' }} />
                <strong>{piece.label}</strong>
                {description !== undefined && <span className="card-text">{description}</span>}
                <label>
                  Owner
                  <select
                    aria-label={`${piece.label} owner`}
                    value={piece.ownerId ?? ''}
                    disabled={busy || readOnly}
                    onChange={(event) =>
                      void run(() => api.setWonderOwner(gameId, piece.id, event.target.value || null))
                    }
                  >
                    <option value="">Unassigned</option>
                    {players.map((player) => (
                      <option key={player.playerId} value={player.playerId}>{player.username}</option>
                    ))}
                  </select>
                </label>
                {piece.ownerId != null && (
                  <button
                    className="small"
                    aria-label={`Disable ${piece.label}`}
                    disabled={busy || readOnly}
                    onClick={() => void run(() => api.setWonderOwner(gameId, piece.id, null))}
                  >
                    Disable
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </CollapsiblePanel>
  )
}
