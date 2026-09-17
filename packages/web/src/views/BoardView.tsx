/**
 * The board.
 *
 * Replaces the Google Presentation slide that `PBF.mapLink` pointed at.
 * The geometry follows `4v4 Map Template.pptx`: 16 x 16 squares labelled A-P
 * and 1-16, with a band of player areas below.
 *
 * Pieces sit at free pixel coordinates rather than snapping to squares, the way
 * the template was used. The order of `board.pieces` is the stacking order, so
 * "bring to front" is a move to the end of the list.
 *
 * Interaction:
 *   palette to board   HTML5 drag and drop, which gives a drag image for free
 *   piece on board     pointer events, for smooth dragging and pointer capture
 *
 * The replay controls step through `board.history`, rebuilding the pieces from
 * an empty board. While replaying, the board is read-only.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  AREA_LABEL_HEIGHT,
  blockColumns,
  blockOrigin,
  blockRows,
  COLUMN_LABELS,
  CULTURE_TRACK,
  CULTURE_TRACK_CELLS,
  ROTATIONS,
  TILE_SQUARES,
  areaBandTop,
  boardHeight,
  boardWidth,
  cultureCellCenter,
  cultureTrackHeight,
  locationOf,
  mapHeight,
  mapTop,
  piecesAtStep,
} from '@civ/engine'
import type { Board, BoardArea, BoardAsset, BoardPiece } from '@civ/engine'

import { errorMessage } from '../App.js'
import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'

interface Props {
  readonly gameId: string
  readonly board: Board
  readonly areas: readonly BoardArea[]
  readonly busy: boolean
  readonly run: (action: () => Promise<PlayerView | unknown>) => Promise<void>
  /** The public log, so replay can show what was known at each step. */
  readonly log: readonly { readonly id: string; readonly message: string }[]
}

function formatTimestamp(value: string | null): string {
  if (value === null) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part: number): string => String(part).padStart(2, '0')
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

const CATEGORY_LABEL: Readonly<Record<BoardAsset['category'], string>> = {
  figure: 'Figures',
  resource: 'Resources',
  marker: 'Markers',
  city: 'Cities',
  building: 'Buildings',
  civtile: 'Starting tiles',
  tile: 'Map tiles',
  leader: 'Leaders',
}

const CATEGORY_ORDER: readonly BoardAsset['category'][] = [
  'figure',
  'resource',
  'marker',
  'city',
  'building',
  'civtile',
  'tile',
  'leader',
]

/** File names may contain spaces, for example "Building Program.png". */
const assetUrl = (path: string): string =>
  `/board/${path.split('/').map(encodeURIComponent).join('/')}`

const ZOOM_STEPS = [0.3, 0.4, 0.5, 0.65, 0.8, 1] as const

export function BoardView({
  gameId,
  board,
  areas,
  busy,
  run,
  log,
}: Props): React.JSX.Element {
  const [assets, setAssets] = useState<readonly BoardAsset[]>([])
  const [category, setCategory] = useState<BoardAsset['category']>('figure')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(0.4)
  const [loadError, setLoadError] = useState<string | null>(null)

  /** `null` means live. A number is the history step being shown. */
  const [replayStep, setReplayStep] = useState<number | null>(null)

  const surfaceRef = useRef<HTMLDivElement>(null)
  /**
   * The piece being dragged: the grab offset inside it, and its latest position.
   *
   * The position lives in a ref rather than only in state because pointerdown,
   * move and up can arrive in the same tick. React does not re-render between
   * them, so a state value read in pointerup would be the one from the previous
   * render.
   */
  const dragRef = useRef<{
    id: string
    offsetX: number
    offsetY: number
    x: number
    y: number
  } | null>(null)
  /** Mirrors dragRef, purely to trigger a render while the piece follows the mouse. */
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    api
      .boardAssets()
      .then(setAssets)
      .catch((caught: unknown) => setLoadError(errorMessage(caught)))
  }, [])

  const history = board.history
  const replaying = replayStep !== null

  // Step past the end when new changes arrive, so the view does not stick
  useEffect(() => {
    setReplayStep((step) => (step !== null && step > history.length ? history.length : step))
  }, [history.length])

  const pieces = useMemo(
    () => (replayStep === null ? board.pieces : piecesAtStep(history, replayStep)),
    [board.pieces, history, replayStep],
  )

  const visibleLog = useMemo(() => {
    if (replayStep === null || replayStep === 0) {
      return replayStep === 0 ? [] : log
    }
    const entry = history[replayStep - 1]
    return entry === undefined ? log : log.slice(0, entry.logLength)
  }, [history, log, replayStep])

  const width = boardWidth(board)
  const height = boardHeight(board)
  const trackHeight = cultureTrackHeight(board)
  const mapStart = mapTop(board)
  const mapBottom = mapStart + mapHeight(board)
  const bandTop = areaBandTop(board)

  const inCategory = useMemo(
    () => assets.filter((asset) => asset.category === category),
    [assets, category],
  )

  const selected = pieces.find((piece) => piece.id === selectedId) ?? null

  /** Empty map slots are unknown territory until a tile is placed there. */
  const fogSlots = useMemo(() => {
    const tileSize = TILE_SQUARES * board.squareSize
    const occupied = new Set(
      pieces
        .filter((piece) => piece.category === 'tile' || piece.category === 'civtile')
        .map(
          (piece) =>
            `${Math.round(piece.x / tileSize)},${Math.round((piece.y - mapStart) / tileSize)}`,
        ),
    )

    return Array.from({ length: blockRows(board) }, (_, row) =>
      Array.from({ length: blockColumns(board) }, (_, column) => ({ column, row })),
    )
      .flat()
      .filter(({ column, row }) => !occupied.has(`${column},${row}`))
  }, [board, mapStart, pieces])

  /** Mouse coordinates into board coordinates, with the zoom taken out. */
  const toBoard = useCallback(
    (clientX: number, clientY: number): readonly [number, number] => {
      const rect = surfaceRef.current?.getBoundingClientRect()
      if (rect === undefined) return [0, 0]
      return [(clientX - rect.left) / zoom, (clientY - rect.top) / zoom]
    },
    [zoom],
  )

  // --- palette to board -----------------------------------------------------

  function onDrop(event: React.DragEvent): void {
    event.preventDefault()
    if (replaying) return

    const assetId = event.dataTransfer.getData('text/civ-asset')
    if (assetId === '') return

    const asset = assets.find((candidate) => candidate.id === assetId)
    if (asset === undefined) return

    const [x, y] = toBoard(event.clientX, event.clientY)
    // Drop the piece centred under the mouse
    void run(() => api.placePiece(gameId, assetId, x - asset.width / 2, y - asset.height / 2))
  }

  // --- moving a piece on the board -----------------------------------------

  function onPiecePointerDown(event: React.PointerEvent, piece: BoardPiece): void {
    if (busy || replaying) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)

    const [x, y] = toBoard(event.clientX, event.clientY)
    dragRef.current = {
      id: piece.id,
      offsetX: x - piece.x,
      offsetY: y - piece.y,
      x: piece.x,
      y: piece.y,
    }
    setDragPosition({ x: piece.x, y: piece.y })
    setSelectedId(piece.id)
  }

  function onPiecePointerMove(event: React.PointerEvent): void {
    const drag = dragRef.current
    if (drag === null) return

    const [x, y] = toBoard(event.clientX, event.clientY)
    drag.x = x - drag.offsetX
    drag.y = y - drag.offsetY
    setDragPosition({ x: drag.x, y: drag.y })
  }

  function onPiecePointerUp(event: React.PointerEvent): void {
    const drag = dragRef.current
    dragRef.current = null
    setDragPosition(null)
    if (drag === null) return

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    const piece = pieces.find((candidate) => candidate.id === drag.id)
    // A plain click without movement should only select, not send a request
    if (piece !== undefined && piece.x === Math.round(drag.x) && piece.y === Math.round(drag.y)) {
      return
    }
    void run(() => api.movePiece(gameId, drag.id, drag.x, drag.y))
  }

  return (
    <section className="panel board-panel">
      <div className="row">
        <h2 style={{ margin: 0 }}>Board</h2>
        <span className="muted">
          {board.columns} × {board.rows} squares · {pieces.length}{' '}
          {pieces.length === 1 ? 'piece' : 'pieces'}
        </span>
        <span style={{ flex: 1 }} />
        <label style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span className="muted">Zoom</span>
          <select
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            style={{ width: 'auto' }}
          >
            {ZOOM_STEPS.map((step) => (
              <option key={step} value={step}>
                {Math.round(step * 100)} %
              </option>
            ))}
          </select>
        </label>
        <button
          className="small"
          disabled={busy || replaying || history.length === 0}
          title="Take back the last change to the board"
          onClick={() => void run(() => api.undoBoard(gameId))}
        >
          Undo
        </button>
      </div>

      <ReplayBar
        history={history}
        step={replayStep}
        onStep={setReplayStep}
      />

      {loadError !== null && <div className="error">{loadError}</div>}

      <div className="board-layout">
        <div className="board-scroll">
          <div
            className={`board-frame${replaying ? ' replaying' : ''}`}
            style={{ width: width * zoom + 28, height: height * zoom + 28 }}
          >
            <ColumnLabels board={board} zoom={zoom} edge="top" offset={mapStart * zoom} />
            <ColumnLabels board={board} zoom={zoom} edge="bottom" offset={mapBottom * zoom} />
            <RowLabels board={board} zoom={zoom} edge="left" offset={mapStart * zoom} />
            <RowLabels board={board} zoom={zoom} edge="right" offset={mapStart * zoom} />

            <div
              ref={surfaceRef}
              className="board-surface"
              style={{ width: width * zoom, height: height * zoom }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={onDrop}
              onPointerDown={() => setSelectedId(null)}
            >
              {/* The culture track runs across the top, above the map */}
              <div
                className="board-track"
                style={{
                  width: width * zoom,
                  height: trackHeight * zoom,
                  backgroundImage: `url(/board/${CULTURE_TRACK.path})`,
                }}
                title="Culture track"
              >
                {Array.from({ length: CULTURE_TRACK_CELLS }, (_, index) => {
                  const step = index + 1
                  return (
                    <span
                      key={step}
                      className="board-track-cell"
                      style={{
                        left: cultureCellCenter(board, step).x * zoom,
                        height: trackHeight * zoom,
                      }}
                      title={`Culture ${step}`}
                    />
                  )
                })}
              </div>

              {/* The grid covers the map only, not the track or the areas */}
              <div
                className="board-map"
                style={{
                  width: width * zoom,
                  top: mapStart * zoom,
                  height: mapHeight(board) * zoom,
                  backgroundSize: `${board.squareSize * zoom}px ${board.squareSize * zoom}px`,
                }}
              />

              {fogSlots.map(({ column, row }) => {
                const [x, y] = blockOrigin(board, column, row)
                const size = TILE_SQUARES * board.squareSize * zoom
                return (
                  <img
                    key={`fog-${column}-${row}`}
                    className="board-fog-tile"
                    src="/board/tiles/tileback.png"
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                    style={{ left: x * zoom, top: y * zoom, width: size, height: size }}
                  />
                )
              })}

              {areas.map((area) => (
                <div
                  key={area.playerId}
                  className="board-area"
                  style={{
                    left: area.x * zoom,
                    top: area.y * zoom,
                    width: area.width * zoom,
                    height: area.height * zoom,
                    borderColor: area.color?.toLowerCase() ?? 'var(--line)',
                  }}
                >
                  <span
                    className="board-area-name"
                    style={{
                      height: AREA_LABEL_HEIGHT * zoom,
                      background: area.color?.toLowerCase() ?? 'var(--panel-2)',
                      fontSize: Math.max(8, 13 * zoom),
                    }}
                  >
                    {area.username}
                  </span>
                </div>
              ))}

              {pieces.map((piece) => {
                const dragging = dragRef.current?.id === piece.id && dragPosition !== null
                const x = dragging ? (dragPosition as { x: number }).x : piece.x
                const y = dragging ? (dragPosition as { y: number }).y : piece.y

                return (
                  <img
                    key={piece.id}
                    className={`board-piece${piece.id === selectedId ? ' selected' : ''}`}
                    src={assetUrl(piece.path)}
                    alt={piece.label}
                    title={`${piece.label} · ${locationOf(board, areas, piece)}`}
                    draggable={false}
                    style={{
                      left: x * zoom,
                      top: y * zoom,
                      width: piece.width * zoom,
                      height: piece.height * zoom,
                      ...(piece.rotation !== 0
                        ? { transform: `rotate(${piece.rotation}deg)` }
                        : {}),
                      ...(replaying ? { cursor: 'default' } : {}),
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation()
                      onPiecePointerDown(event, piece)
                    }}
                    onPointerMove={onPiecePointerMove}
                    onPointerUp={onPiecePointerUp}
                  />
                )
              })}
            </div>
            <span className="board-band-label" style={{ top: 1 }}>
              Culture track
            </span>
            <span className="board-band-label" style={{ top: bandTop * zoom + 14 - 13 }}>
              Player areas
            </span>
          </div>
        </div>

        <aside className="board-palette">
          <h3>Pieces</h3>
          <div className="row" style={{ marginBottom: '0.5rem' }}>
            {CATEGORY_ORDER.map((name) => (
              <button
                key={name}
                className="small"
                disabled={category === name}
                onClick={() => setCategory(name)}
              >
                {CATEGORY_LABEL[name]}
              </button>
            ))}
          </div>

          <p className="muted" style={{ margin: '0 0 0.5rem' }}>
            {replaying
              ? 'Replaying — return to now to make changes.'
              : 'Drag a piece onto the board. Drop it in a player area to tidy it into a row.'}
          </p>

          <div className="palette-grid">
            {inCategory.map((asset) => (
              <div
                key={asset.id}
                className="palette-item"
                title={asset.label}
                draggable={!replaying}
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/civ-asset', asset.id)
                  event.dataTransfer.effectAllowed = 'copy'
                }}
              >
                <img src={assetUrl(asset.path)} alt={asset.label} draggable={false} />
                <span>{asset.label}</span>
              </div>
            ))}
            {inCategory.length === 0 && <p className="muted">Loading …</p>}
          </div>

          <h3 style={{ marginTop: '1rem' }}>Selected piece</h3>
          {selected === null ? (
            <p className="muted">Click a piece on the board.</p>
          ) : (
            <>
              <p style={{ margin: '0 0 0.5rem' }}>
                <strong>{selected.label}</strong>{' '}
                <span className="muted">
                  {locationOf(board, areas, selected)}
                  {selected.rotation !== 0 && ` · ${selected.rotation}°`}
                </span>
              </p>
              <div className="row" style={{ marginBottom: '0.4rem' }}>
                <button
                  className="small"
                  disabled={busy || replaying}
                  title="Turn a quarter step clockwise"
                  onClick={() => void run(() => api.rotatePiece(gameId, selected.id))}
                >
                  Turn ↻
                </button>
                {/* Map tiles carry an arrow showing which way the tile goes */}
                {ROTATIONS.map((rotation) => (
                  <button
                    key={rotation}
                    className="small"
                    disabled={busy || replaying || selected.rotation === rotation}
                    onClick={() => void run(() => api.rotatePiece(gameId, selected.id, rotation))}
                  >
                    {rotation}°
                  </button>
                ))}
              </div>
              <div className="row">
                <button
                  className="small"
                  disabled={busy || replaying}
                  onClick={() => void run(() => api.pieceToFront(gameId, selected.id))}
                >
                  To front
                </button>
                <button
                  className="small"
                  disabled={busy || replaying}
                  onClick={() => void run(() => api.pieceToBack(gameId, selected.id))}
                >
                  To back
                </button>
                <button
                  className="small danger"
                  disabled={busy || replaying}
                  onClick={() => {
                    setSelectedId(null)
                    void run(() => api.removePiece(gameId, selected.id))
                  }}
                >
                  Remove
                </button>
              </div>
            </>
          )}

          <h3 style={{ marginTop: '1rem' }}>History ({history.length})</h3>
          <ul className="list scroll history">
            {[...history].reverse().map((entry, reverseIndex) => {
              const index = history.length - reverseIndex
              const timestamp = formatTimestamp(entry.at)
              return (
                <li key={entry.id}>
                  <button
                    className={`link${replayStep === index ? ' current' : ''}`}
                    onClick={() => setReplayStep(index)}
                    title="Show the board as it was here"
                  >
                    {timestamp !== '' ? `${timestamp} — ${entry.description}` : entry.description}
                  </button>
                </li>
              )
            })}
            {history.length === 0 && <li className="muted">Nothing has happened yet.</li>}
          </ul>

          {replaying && (
            <>
              <h3 style={{ marginTop: '1rem' }}>Log at this point</h3>
              <ul className="list scroll">
                {visibleLog.slice(-8).map((entry) => (
                  <li key={entry.id}>{entry.message}</li>
                ))}
                {visibleLog.length === 0 && <li className="muted">Nothing logged yet.</li>}
              </ul>
            </>
          )}
        </aside>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Replay controls
// ---------------------------------------------------------------------------

function ReplayBar({
  history,
  step,
  onStep,
}: {
  readonly history: readonly { readonly id: string; readonly description: string }[]
  readonly step: number | null
  readonly onStep: (step: number | null) => void
}): React.JSX.Element | null {
  if (history.length === 0) return null

  const current = step ?? history.length
  const atStart = current <= 0
  const atEnd = current >= history.length

  return (
    <div className="replay-bar">
      <button
        className="small"
        disabled={atStart}
        title="Back to the start"
        onClick={() => onStep(0)}
      >
        ⏮
      </button>
      <button
        className="small"
        disabled={atStart}
        onClick={() => onStep(Math.max(0, current - 1))}
      >
        ◀ Back
      </button>
      <input
        type="range"
        min={0}
        max={history.length}
        value={current}
        onChange={(event) => onStep(Number(event.target.value))}
        style={{ flex: 1, minWidth: '6rem' }}
      />
      <button
        className="small"
        disabled={atEnd}
        onClick={() => onStep(Math.min(history.length, current + 1))}
      >
        Forward ▶
      </button>
      <span className="muted" style={{ whiteSpace: 'nowrap' }}>
        {current} / {history.length}
      </span>
      {step === null ? (
        <span className="tag turn">Live</span>
      ) : (
        <button className="small primary" onClick={() => onStep(null)}>
          Back to now
        </button>
      )}
      <span className="muted replay-what">
        {step === null
          ? (history.at(-1)?.description ?? '')
          : current === 0
            ? 'Before anything happened'
            : (history[current - 1]?.description ?? '')}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Coordinate labels around the map, as in the template
// ---------------------------------------------------------------------------

function ColumnLabels({
  board,
  zoom,
  edge,
  offset,
}: {
  readonly board: Board
  readonly zoom: number
  readonly edge: 'top' | 'bottom'
  readonly offset: number
}): React.JSX.Element {
  return (
    <div
      className={`board-labels columns ${edge}`}
      style={{ top: edge === 'bottom' ? offset + 14 : offset }}
    >
      {Array.from({ length: board.columns }, (_, index) => (
        <span key={index} style={{ width: board.squareSize * zoom }}>
          {COLUMN_LABELS[index]}
        </span>
      ))}
    </div>
  )
}

function RowLabels({
  board,
  zoom,
  edge,
  offset,
}: {
  readonly board: Board
  readonly zoom: number
  readonly edge: 'left' | 'right'
  readonly offset: number
}): React.JSX.Element {
  return (
    <div className={`board-labels rows ${edge}`} style={{ top: offset + 14 }}>
      {Array.from({ length: board.rows }, (_, index) => (
        <span key={index} style={{ height: board.squareSize * zoom }}>
          {index + 1}
        </span>
      ))}
    </div>
  )
}
