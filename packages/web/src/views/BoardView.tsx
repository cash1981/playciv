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
 *   palette to board   tap/select/place on touch, plus HTML5 drag and drop
 *   piece on board     tap/select/move on touch, plus pointer dragging with a mouse
 *
 * Global replay is owned by GameView; this component only renders the supplied
 * live or historical board. Live board undo and redo remain available.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  AREA_LABEL_HEIGHT,
  CULTURE_TRACK,
  CULTURE_TRACK_CELLS,
  ROTATIONS,
  TILE_SQUARES,
  WONDERS_AREA_ID,
  areaBandTop,
  boardHeight,
  boardWidth,
  columnLabel,
  cultureCellCenter,
  cultureTrackHeight,
  locationOf,
  mapHeight,
  mapTop,
  nearestSlotOrigin,
  remainingBoardAssetCount,
  slotOrigin,
} from '@civ/engine'
import type { Board, BoardArea, BoardAsset, BoardPiece } from '@civ/engine'

import { errorMessage } from '../App.js'
import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'

interface Props {
  readonly gameId: string
  readonly board: Board
  readonly numOfPlayers: number
  readonly areas: readonly BoardArea[]
  readonly busy: boolean
  readonly readOnly?: boolean
  /** Whose Undo button this is — only enabled when they made the last change. */
  readonly youId?: string | null
  readonly run: (action: () => Promise<PlayerView | unknown>) => Promise<void>
}

const CATEGORY_LABEL: Readonly<Record<BoardAsset['category'], string>> = {
  figure: 'Figures',
  resource: 'Resources',
  marker: 'Markers',
  city: 'Cities',
  citystate: 'City-states',
  building: 'Buildings',
  greatperson: 'Great People',
  civtile: 'Starting tiles',
  tile: 'Map tiles',
  leader: 'Leaders',
  wonder: 'Wonders',
}

const CATEGORY_ORDER: readonly BoardAsset['category'][] = [
  'figure',
  'resource',
  'marker',
  'city',
  'citystate',
  'building',
  'greatperson',
  'civtile',
  'tile',
  'leader',
  'wonder',
]

/** File names may contain spaces, for example "Building Program.png". */
const assetUrl = (path: string): string =>
  `/board/${path.split('/').map(encodeURIComponent).join('/')}`

const ZOOM_STEPS = [0.3, 0.4, 0.5, 0.65, 0.8, 1] as const

export function fittingBoardZoom(boardWidth: number, availableWidth: number): number {
  return [...ZOOM_STEPS].reverse().find((step) => boardWidth * step <= availableWidth) ?? ZOOM_STEPS[0]
}

export interface BoardPaletteProps {
  readonly assets: readonly BoardAsset[]
  readonly category: BoardAsset['category']
  readonly onCategoryChange: (category: BoardAsset['category']) => void
  readonly replaying: boolean
  readonly pieces: readonly BoardPiece[]
  readonly numOfPlayers: number
  readonly onSelectAsset?: (asset: BoardAsset) => void
}

/** The palette is separate so its finite-supply UI can be tested without a browser. */
export function BoardPalette({
  assets,
  category,
  onCategoryChange,
  replaying,
  pieces,
  numOfPlayers,
  onSelectAsset,
}: BoardPaletteProps): React.JSX.Element {
  const inCategory = assets.filter((asset) => asset.category === category)
  const draggedAssetRef = useRef(false)

  return (
    <>
      <h3>Pieces</h3>
      <div className="row" style={{ marginBottom: '0.5rem' }}>
        {CATEGORY_ORDER.map((name) => (
          <button
            key={name}
            className="small"
            disabled={category === name}
            onClick={() => onCategoryChange(name)}
          >
            {CATEGORY_LABEL[name]}
          </button>
        ))}
      </div>

      <p className="muted" style={{ margin: '0 0 0.5rem' }}>
        {replaying
          ? 'Replaying — return to now to make changes.'
          : 'Tap a piece, then tap the board, or drag it there. Drop it in a player area to tidy it into a row.'}
      </p>

      <div className="palette-grid">
        {inCategory.map((asset) => {
          const remaining = remainingBoardAssetCount(asset, pieces, numOfPlayers)
          const exhausted = remaining === 0
          return (
            <button
              type="button"
              key={asset.id}
              className={`palette-item${exhausted ? ' unavailable' : ''}`}
              disabled={replaying || exhausted}
              title={exhausted ? `${asset.label} (none available)` : asset.label}
              draggable={!replaying && !exhausted}
              onDragStart={(event) => {
                if (exhausted) return
                draggedAssetRef.current = true
                event.dataTransfer.setData('text/civ-asset', asset.id)
                event.dataTransfer.effectAllowed = 'copy'
              }}
              onDragEnd={() => {
                window.setTimeout(() => { draggedAssetRef.current = false }, 0)
              }}
              onClick={() => {
                if (draggedAssetRef.current) {
                  draggedAssetRef.current = false
                  return
                }
                if (!exhausted && !replaying) onSelectAsset?.(asset)
              }}
            >
              <img src={assetUrl(asset.path)} alt={asset.label} draggable={false} />
              <span>
                {asset.label}
                {remaining !== undefined && ` (${remaining})`}
              </span>
            </button>
          )
        })}
        {inCategory.length === 0 && <p className="muted">Loading …</p>}
      </div>
    </>
  )
}

export function BoardView({
  gameId,
  board,
  numOfPlayers,
  areas,
  busy,
  readOnly = false,
  youId = null,
  run,
}: Props): React.JSX.Element {
  const [assets, setAssets] = useState<readonly BoardAsset[]>([])
  const [category, setCategory] = useState<BoardAsset['category']>('figure')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pendingAssetId, setPendingAssetId] = useState<string | null>(null)
  const [moveModeId, setMoveModeId] = useState<string | null>(null)
  const [zoomChoice, setZoomChoice] = useState<number | 'auto'>('auto')
  const [autoZoom, setAutoZoom] = useState<number>(ZOOM_STEPS[0])
  const [loadError, setLoadError] = useState<string | null>(null)

  const surfaceRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
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
    startClientX: number
    startClientY: number
    moved: boolean
  } | null>(null)
  /** Mirrors dragRef, purely to trigger a render while the piece follows the mouse. */
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null)
  const surfaceGestureRef = useRef<{
    pointerId: number
    clientX: number
    clientY: number
    moved: boolean
  } | null>(null)

  useEffect(() => {
    api
      .boardAssets()
      .then(setAssets)
      .catch((caught: unknown) => setLoadError(errorMessage(caught)))
  }, [])

  useEffect(() => {
    if (selectedId === null && moveModeId === null) return
    const clearSelectionOutsideBoard = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('.board-surface') !== null || target.closest('.board-palette') !== null) return
      setSelectedId(null)
      setMoveModeId(null)
    }
    document.addEventListener('pointerdown', clearSelectionOutsideBoard)
    return () => document.removeEventListener('pointerdown', clearSelectionOutsideBoard)
  }, [moveModeId, selectedId])

  const pieces = board.pieces

  const width = boardWidth(board)
  const zoom = zoomChoice === 'auto' ? autoZoom : zoomChoice

  useEffect(() => {
    const scroll = scrollRef.current
    const frame = frameRef.current
    if (scroll === null || frame === null) return

    const updateZoom = () => {
      if (scroll.clientWidth === 0) return
      const scrollStyle = getComputedStyle(scroll)
      const frameStyle = getComputedStyle(frame)
      const inset =
        (parseFloat(scrollStyle.paddingLeft) || 0) + (parseFloat(scrollStyle.paddingRight) || 0) +
        (parseFloat(frameStyle.paddingLeft) || 0) + (parseFloat(frameStyle.paddingRight) || 0)
      setAutoZoom(fittingBoardZoom(width, scroll.clientWidth - inset))
    }
    updateZoom()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateZoom)
      return () => window.removeEventListener('resize', updateZoom)
    }
    const observer = new ResizeObserver(updateZoom)
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [width])
  const height = boardHeight(board)
  const trackHeight = cultureTrackHeight(board)
  const mapStart = mapTop(board)
  const mapBottom = mapStart + mapHeight(board)
  const bandTop = areaBandTop(board)

  const selected = pieces.find((piece) => piece.id === selectedId) ?? null
  const pendingAsset = assets.find((asset) => asset.id === pendingAssetId) ?? null

  /**
   * Empty map slots are unknown territory until a tile is placed there. Only
   * the board's own slots fog: the hole and the outside of a stepped board are
   * not slots, so nothing is drawn there.
   */
  const fogSlots = useMemo(() => {
    const occupied = new Set<string>()
    for (const piece of pieces) {
      if (piece.category !== 'tile' && piece.category !== 'civtile') continue
      const origin = nearestSlotOrigin(board, piece.x, piece.y)
      if (origin !== undefined) occupied.add(`${origin[0]},${origin[1]}`)
    }

    return board.slots.filter((slot) => {
      const [x, y] = slotOrigin(board, slot)
      return !occupied.has(`${x},${y}`)
    })
  }, [board, pieces])

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
    if (busy || readOnly) return

    const assetId = event.dataTransfer.getData('text/civ-asset')
    if (assetId === '') return

    const asset = assets.find((candidate) => candidate.id === assetId)
    if (asset === undefined) return

    const [x, y] = toBoard(event.clientX, event.clientY)
    // Drop the piece centred under the mouse
    void run(() => api.placePiece(gameId, assetId, x - asset.width / 2, y - asset.height / 2))
  }

  function onSurfacePointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (surfaceGestureRef.current !== null && surfaceGestureRef.current.pointerId !== event.pointerId) {
      surfaceGestureRef.current = null
    }
    if (event.isPrimary && event.button === 0) {
      surfaceGestureRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        moved: false,
      }
    }
    if (pendingAsset === null && moveModeId === null) setSelectedId(null)
  }

  function onSurfacePointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    const gesture = surfaceGestureRef.current
    if (gesture === null || gesture.pointerId !== event.pointerId) return
    if (Math.hypot(event.clientX - gesture.clientX, event.clientY - gesture.clientY) > 8) {
      gesture.moved = true
    }
  }

  function onSurfacePointerCancel(event: React.PointerEvent<HTMLDivElement>): void {
    if (surfaceGestureRef.current?.pointerId === event.pointerId) surfaceGestureRef.current = null
  }

  function onSurfacePointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    const gesture = surfaceGestureRef.current
    surfaceGestureRef.current = null
    if (
      gesture === null || gesture.pointerId !== event.pointerId || gesture.moved ||
      !event.isPrimary || event.button !== 0 || busy || readOnly
    ) return

    const [x, y] = toBoard(event.clientX, event.clientY)
    if (pendingAsset !== null) {
      setPendingAssetId(null)
      void run(() => api.placePiece(gameId, pendingAsset.id, x - pendingAsset.width / 2, y - pendingAsset.height / 2))
      return
    }

    const moving = pieces.find((piece) => piece.id === moveModeId)
    if (moving !== undefined) {
      setMoveModeId(null)
      void run(() => api.movePiece(gameId, moving.id, x - moving.width / 2, y - moving.height / 2))
    }
  }

  // --- moving a piece on the board -----------------------------------------

  function onPiecePointerDown(event: React.PointerEvent, piece: BoardPiece): void {
    // While a palette asset is armed, the board surface owns the tap—even if
    // the user taps an existing piece such as a starting tile.
    if (pendingAsset !== null || (moveModeId !== null && moveModeId !== piece.id)) return
    if (busy || readOnly) return
    if (!event.isPrimary) {
      // A second finger may land on a piece, whose pointerdown does not bubble
      // to the surface. Cancel any pending surface tap before returning.
      surfaceGestureRef.current = null
      return
    }
    if (event.button !== 0) return
    setSelectedId(piece.id)
    if (event.pointerType !== 'mouse' && selectedId !== piece.id) {
      // The first touch marks the piece and arms destination mode in the same
      // tap, so the next tap on the board moves it there (the same flow as a
      // palette asset). Returning here, before the pointer is captured, keeps
      // an untouched piece pannable; the next touch-drag on the marked piece
      // still becomes a drag.
      setMoveModeId(piece.id)
      surfaceGestureRef.current = null
      return
    }
    if (event.pointerType === 'mouse') setMoveModeId(null)
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)

    const [x, y] = toBoard(event.clientX, event.clientY)
    dragRef.current = {
      id: piece.id,
      offsetX: x - piece.x,
      offsetY: y - piece.y,
      x: piece.x,
      y: piece.y,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false,
    }
    setDragPosition({ x: piece.x, y: piece.y })
  }

  function onPiecePointerMove(event: React.PointerEvent): void {
    const drag = dragRef.current
    if (drag === null) return

    if (!drag.moved && Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY) <= 6) {
      return
    }
    drag.moved = true
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

    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    }

    const piece = pieces.find((candidate) => candidate.id === drag.id)
    // A plain click without movement should only select, not send a request
    if (!drag.moved || (piece !== undefined && piece.x === Math.round(drag.x) && piece.y === Math.round(drag.y))) {
      setMoveModeId(drag.id)
      return
    }
    // The drag itself already moved the piece; disarm so an unrelated later
    // tap on the board does not move it a second time.
    setMoveModeId(null)
    void run(() => api.movePiece(gameId, drag.id, drag.x, drag.y))
  }

  function onPiecePointerCancel(event: React.PointerEvent): void {
    if (dragRef.current === null) return
    dragRef.current = null
    setDragPosition(null)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    }
  }

  return (
    <section className="panel board-panel">
      <div className="row">
        <h2 style={{ margin: 0 }}>Civilization Boardgame</h2>
        <span style={{ flex: 1 }} />
        <label style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span className="muted">Zoom</span>
          <select
            value={zoomChoice}
            onChange={(event) => setZoomChoice(event.target.value === 'auto' ? 'auto' : Number(event.target.value))}
            style={{ width: 'auto' }}
          >
            <option value="auto">Auto ({Math.round(autoZoom * 100)} %)</option>
            {ZOOM_STEPS.map((step) => (
              <option key={step} value={step}>
                {Math.round(step * 100)} %
              </option>
            ))}
          </select>
        </label>
        <button
          className="small"
          disabled={busy || readOnly || board.history.at(-1)?.playerId !== youId}
          title="Take back your last change to the board"
          onClick={() => void run(() => api.undoBoard(gameId))}
        >
          Undo
        </button>
        <button
          className="small"
          disabled={busy || readOnly || board.redo.length === 0}
          title="Bring back the change you just undid"
          onClick={() => void run(() => api.redoBoard(gameId))}
        >
          Redo
        </button>
      </div>

      {loadError !== null && <div className="error">{loadError}</div>}

      <div className="board-layout">
        <div className="board-scroll" ref={scrollRef}>
          <div
            ref={frameRef}
            className={`board-frame${readOnly ? ' replaying' : ''}`}
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
              onPointerDown={onSurfacePointerDown}
              onPointerMove={onSurfacePointerMove}
              onPointerUp={onSurfacePointerUp}
              onPointerCancel={onSurfacePointerCancel}
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

              {/* The grid covers the map only, not the track or the areas.
                  A rectangle keeps one mat with an outline; a stepped board
                  gets one mat per slot, because there is no rectangle to
                  outline any more. */}
              {board.slotStep === TILE_SQUARES ? (
                <div
                  className="board-map"
                  style={{
                    width: width * zoom,
                    top: mapStart * zoom,
                    height: mapHeight(board) * zoom,
                    backgroundSize: `${board.squareSize * zoom}px ${board.squareSize * zoom}px`,
                  }}
                />
              ) : (
                board.slots.map((slot) => {
                  const [x, y] = slotOrigin(board, slot)
                  const size = TILE_SQUARES * board.squareSize * zoom
                  return (
                    <div
                      key={`mat-${slot.x}-${slot.y}`}
                      className="board-map-slot"
                      style={{
                        left: x * zoom,
                        top: y * zoom,
                        width: size,
                        height: size,
                        backgroundSize: `${board.squareSize * zoom}px ${board.squareSize * zoom}px`,
                      }}
                    />
                  )
                })
              )}

              {fogSlots.map((slot) => {
                const [x, y] = slotOrigin(board, slot)
                const size = TILE_SQUARES * board.squareSize * zoom
                return (
                  <img
                    key={`fog-${slot.x}-${slot.y}`}
                    className="board-fog-tile"
                    src="/board/tiles/tileback.png"
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                    style={{ left: x * zoom, top: y * zoom, width: size, height: size }}
                  />
                )
              })}

              {areas.map((area) => {
                const isWonders = area.playerId === WONDERS_AREA_ID
                return (
                  <div
                    key={area.playerId}
                    className={`board-area${isWonders ? ' board-area-wonders' : ''}`}
                    style={{
                      left: area.x * zoom,
                      top: area.y * zoom,
                      width: area.width * zoom,
                      height: area.height * zoom,
                      borderColor: isWonders
                        ? 'var(--wonder-accent)'
                        : (area.color?.toLowerCase() ?? 'var(--line)'),
                    }}
                  >
                    <span
                      className="board-area-name"
                      style={{
                        height: AREA_LABEL_HEIGHT * zoom,
                        background: isWonders
                          ? 'var(--wonder-accent)'
                          : (area.color?.toLowerCase() ?? 'var(--panel-2)'),
                        fontSize: Math.max(8, 13 * zoom),
                      }}
                    >
                      {area.username}
                    </span>
                  </div>
                )
              })}

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
                      ...(readOnly ? { cursor: 'default' } : {}),
                    }}
                    onPointerDown={(event) => {
                      if (pendingAsset === null && (moveModeId === null || moveModeId === piece.id)) {
                        event.stopPropagation()
                      }
                      onPiecePointerDown(event, piece)
                    }}
                    onPointerMove={onPiecePointerMove}
                    onPointerUp={onPiecePointerUp}
                    onPointerCancel={onPiecePointerCancel}
                    onLostPointerCapture={onPiecePointerCancel}
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
          <BoardPalette
            assets={assets}
            category={category}
            onCategoryChange={setCategory}
            replaying={readOnly}
            pieces={pieces}
            numOfPlayers={numOfPlayers}
            onSelectAsset={(asset) => {
              setPendingAssetId(asset.id)
              setMoveModeId(null)
              setSelectedId(null)
            }}
          />

          {pendingAsset !== null && (
            <div className="board-placement-status" role="status" aria-live="polite">
              <strong>Placing {pendingAsset.label}</strong>
              <span>Tap the board where it should go.</span>
              <button type="button" className="small" onClick={() => setPendingAssetId(null)}>
                Cancel
              </button>
            </div>
          )}

          <h3 style={{ marginTop: '1rem' }}>Selected piece</h3>
          {selected === null ? (
            <p className="muted">Click a piece on the board.</p>
          ) : (
            <>
              {moveModeId === selected.id && (
                <div className="board-placement-status" role="status" aria-live="polite">
                  <strong>Moving {selected.label}</strong>
                  <span>Tap a destination on the board.</span>
                  <button type="button" className="small" onClick={() => setMoveModeId(null)}>
                    Cancel
                  </button>
                </div>
              )}
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
                  disabled={busy || readOnly}
                  onClick={() => {
                    setMoveModeId(selected.id)
                    setPendingAssetId(null)
                  }}
                >
                  Move
                </button>
                <button
                  className="small"
                  disabled={busy || readOnly}
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
                    disabled={busy || readOnly || selected.rotation === rotation}
                    onClick={() => void run(() => api.rotatePiece(gameId, selected.id, rotation))}
                  >
                    {rotation}°
                  </button>
                ))}
              </div>
              <div className="row">
                <button
                  className="small"
                  disabled={busy || readOnly}
                  onClick={() => void run(() => api.pieceToFront(gameId, selected.id))}
                >
                  To front
                </button>
                <button
                  className="small"
                  disabled={busy || readOnly}
                  onClick={() => void run(() => api.pieceToBack(gameId, selected.id))}
                >
                  To back
                </button>
                <button
                  className="small danger"
                  disabled={busy || readOnly}
                  onClick={() => {
                    setSelectedId(null)
                    setMoveModeId(null)
                    void run(() => api.removePiece(gameId, selected.id))
                  }}
                >
                  Remove
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
          {columnLabel(index)}
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
