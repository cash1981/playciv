/**
 * Brettet.
 *
 * Erstatter Google Presentation-lysbildet som `PBF.mapLink` pekte på.
 * Geometrien følger `4v4 Map Template.pptx`: 16 × 16 ruter merket A–P og 1–16.
 *
 * Brikker plasseres fritt i pikselkoordinater, ikke i ruter, slik malen ble
 * brukt. Rekkefølgen i `board.pieces` er z-rekkefølgen, så «legg forrest» er
 * bare en flytting bakerst i listen.
 *
 * Interaksjon:
 *   palett → brett   HTML5 drag and drop, som gir gratis ghost-bilde
 *   brikke på brett   pointer events, som gir jevn dragging og pointer capture
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { COLUMN_LABELS, ROTATIONS, squareOf } from '@civ/engine'
import type { Board, BoardAsset, BoardPiece } from '@civ/engine'

import { errorMessage } from '../App.js'
import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'

interface Props {
  readonly gameId: string
  readonly board: Board
  readonly busy: boolean
  readonly run: (action: () => Promise<PlayerView | unknown>) => Promise<void>
}

const CATEGORY_LABEL: Readonly<Record<BoardAsset['category'], string>> = {
  figure: 'Figurer',
  resource: 'Ressurser',
  marker: 'Markører',
  city: 'Byer',
  building: 'Bygninger',
  civtile: 'Startbrett',
  tile: 'Map-tiles',
}

const CATEGORY_ORDER: readonly BoardAsset['category'][] = [
  'figure',
  'resource',
  'marker',
  'city',
  'building',
  'civtile',
  'tile',
]

/** Filnavn kan inneholde mellomrom, f.eks. "Building Program.png". */
const assetUrl = (path: string): string =>
  `/board/${path.split('/').map(encodeURIComponent).join('/')}`

const ZOOM_STEPS = [0.3, 0.4, 0.5, 0.65, 0.8, 1] as const

export function BoardView({ gameId, board, busy, run }: Props): React.JSX.Element {
  const [assets, setAssets] = useState<readonly BoardAsset[]>([])
  const [category, setCategory] = useState<BoardAsset['category']>('figure')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(0.5)
  const [loadError, setLoadError] = useState<string | null>(null)

  const surfaceRef = useRef<HTMLDivElement>(null)
  /**
   * Brikken som dras akkurat nå: grepet inne i brikken, og siste posisjon.
   *
   * Posisjonen ligger i en ref og ikke bare i state fordi pointerdown, move og
   * up kan komme i samme tick. React rekker da ikke å rendre mellom dem, og en
   * state-verdi lest i pointerup ville vært den fra forrige render.
   */
  const dragRef = useRef<{
    id: string
    offsetX: number
    offsetY: number
    x: number
    y: number
  } | null>(null)
  /** Speiler dragRef, kun for å utløse ny rendring mens brikken følger musen. */
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    api
      .boardAssets()
      .then(setAssets)
      .catch((caught: unknown) => setLoadError(errorMessage(caught)))
  }, [])

  const width = board.columns * board.squareSize
  const height = board.rows * board.squareSize

  const inCategory = useMemo(
    () => assets.filter((asset) => asset.category === category),
    [assets, category],
  )

  const selected = board.pieces.find((piece) => piece.id === selectedId) ?? null

  /** Musekoordinater om til brettkoordinater, med zoom regnet inn. */
  const toBoard = useCallback(
    (clientX: number, clientY: number): readonly [number, number] => {
      const rect = surfaceRef.current?.getBoundingClientRect()
      if (rect === undefined) return [0, 0]
      return [(clientX - rect.left) / zoom, (clientY - rect.top) / zoom]
    },
    [zoom],
  )

  // --- palett → brett -------------------------------------------------------

  function onDrop(event: React.DragEvent): void {
    event.preventDefault()
    const assetId = event.dataTransfer.getData('text/civ-asset')
    if (assetId === '') return

    const asset = assets.find((candidate) => candidate.id === assetId)
    if (asset === undefined) return

    const [x, y] = toBoard(event.clientX, event.clientY)
    // Slipp brikken sentrert under musen
    void run(() =>
      api.placePiece(gameId, assetId, x - asset.width / 2, y - asset.height / 2),
    )
  }

  // --- flytting av brikke på brettet ---------------------------------------

  function onPiecePointerDown(event: React.PointerEvent, piece: BoardPiece): void {
    if (busy) return
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

    const piece = board.pieces.find((candidate) => candidate.id === drag.id)
    // Et rent klikk uten bevegelse skal bare velge, ikke sende et kall
    if (piece !== undefined && piece.x === Math.round(drag.x) && piece.y === Math.round(drag.y)) {
      return
    }
    void run(() => api.movePiece(gameId, drag.id, drag.x, drag.y))
  }

  return (
    <section className="panel board-panel">
      <div className="row">
        <h2 style={{ margin: 0 }}>Brett</h2>
        <span className="muted">
          {board.columns} × {board.rows} ruter · {board.pieces.length} brikker
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
          className="small danger"
          disabled={busy || board.pieces.length === 0}
          onClick={() => {
            if (window.confirm('Fjerne alle brikkene fra brettet?')) {
              void run(() => api.clearBoard(gameId))
            }
          }}
        >
          Tøm brettet
        </button>
      </div>

      {loadError !== null && <div className="error">{loadError}</div>}

      <div className="board-layout">
        <div className="board-scroll">
          <div
            className="board-frame"
            style={{ width: width * zoom + 28, height: height * zoom + 28 }}
          >
            <ColumnLabels board={board} zoom={zoom} edge="top" />
            <ColumnLabels board={board} zoom={zoom} edge="bottom" />
            <RowLabels board={board} zoom={zoom} edge="left" />
            <RowLabels board={board} zoom={zoom} edge="right" />

            <div
              ref={surfaceRef}
              className="board-surface"
              style={{
                width: width * zoom,
                height: height * zoom,
                // Rutenettet tegnes som bakgrunn, så det ikke koster 256 noder
                backgroundSize: `${board.squareSize * zoom}px ${board.squareSize * zoom}px`,
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={onDrop}
              onPointerDown={() => setSelectedId(null)}
            >
              {board.pieces.map((piece) => {
                const dragging = dragRef.current?.id === piece.id && dragPosition !== null
                const x = dragging ? (dragPosition as { x: number }).x : piece.x
                const y = dragging ? (dragPosition as { y: number }).y : piece.y

                return (
                  <img
                    key={piece.id}
                    className={`board-piece${piece.id === selectedId ? ' selected' : ''}`}
                    src={assetUrl(piece.path)}
                    alt={piece.label}
                    title={`${piece.label} · ${squareOf(board, piece) ?? 'utenfor'}`}
                    draggable={false}
                    style={{
                      left: x * zoom,
                      top: y * zoom,
                      width: piece.width * zoom,
                      height: piece.height * zoom,
                      // Brikkene er kvadratiske eller nær det, så rotasjon om
                      // midtpunktet holder seg innenfor samme flate
                      ...(piece.rotation !== 0
                        ? { transform: `rotate(${piece.rotation}deg)` }
                        : {}),
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
          </div>
        </div>

        <aside className="board-palette">
          <h3>Brikker</h3>
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
            Dra en brikke inn på brettet.
          </p>

          <div className="palette-grid">
            {inCategory.map((asset) => (
              <div
                key={asset.id}
                className="palette-item"
                title={asset.label}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/civ-asset', asset.id)
                  event.dataTransfer.effectAllowed = 'copy'
                }}
              >
                <img src={assetUrl(asset.path)} alt={asset.label} draggable={false} />
                <span>{asset.label}</span>
              </div>
            ))}
            {inCategory.length === 0 && <p className="muted">Laster …</p>}
          </div>

          <h3 style={{ marginTop: '1rem' }}>Valgt brikke</h3>
          {selected === null ? (
            <p className="muted">Klikk en brikke på brettet.</p>
          ) : (
            <>
              <p style={{ margin: '0 0 0.5rem' }}>
                <strong>{selected.label}</strong>{' '}
                <span className="muted">
                  {squareOf(board, selected) ?? 'utenfor brettet'}
                  {selected.rotation !== 0 && ` · ${selected.rotation}°`}
                </span>
              </p>
              <div className="row" style={{ marginBottom: '0.4rem' }}>
                <button
                  className="small"
                  disabled={busy}
                  title="Snu et kvart trinn med klokka"
                  onClick={() => void run(() => api.rotatePiece(gameId, selected.id))}
                >
                  Snu ↻
                </button>
                {/* Map-tiles har en pil som viser hvilken vei brettet skal ligge */}
                {ROTATIONS.map((rotation) => (
                  <button
                    key={rotation}
                    className="small"
                    disabled={busy || selected.rotation === rotation}
                    onClick={() => void run(() => api.rotatePiece(gameId, selected.id, rotation))}
                  >
                    {rotation}°
                  </button>
                ))}
              </div>
              <div className="row">
                <button
                  className="small"
                  disabled={busy}
                  onClick={() => void run(() => api.pieceToFront(gameId, selected.id))}
                >
                  Forrest
                </button>
                <button
                  className="small"
                  disabled={busy}
                  onClick={() => void run(() => api.pieceToBack(gameId, selected.id))}
                >
                  Bakerst
                </button>
                <button
                  className="small danger"
                  disabled={busy}
                  onClick={() => {
                    setSelectedId(null)
                    void run(() => api.removePiece(gameId, selected.id))
                  }}
                >
                  Fjern
                </button>
              </div>
            </>
          )}
        </aside>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Koordinatmerkingen rundt brettet, som i malen
// ---------------------------------------------------------------------------

function ColumnLabels({
  board,
  zoom,
  edge,
}: {
  readonly board: Board
  readonly zoom: number
  readonly edge: 'top' | 'bottom'
}): React.JSX.Element {
  return (
    <div className={`board-labels columns ${edge}`}>
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
}: {
  readonly board: Board
  readonly zoom: number
  readonly edge: 'left' | 'right'
}): React.JSX.Element {
  return (
    <div className={`board-labels rows ${edge}`}>
      {Array.from({ length: board.rows }, (_, index) => (
        <span key={index} style={{ height: board.squareSize * zoom }}>
          {index + 1}
        </span>
      ))}
    </div>
  )
}
