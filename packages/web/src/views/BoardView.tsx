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
 *                      (the palette sits below the board at every width)
 *   piece on board     tap to select and arm (map tiles are selected only), then tap
 *                      the board to move; or drag; or the Move button, then tap
 *   pick a square      while a Build is waiting for its square (`pickSquares`), the
 *                      legal squares are buttons on the board and everything else
 *                      on it is left alone until the pick is made or cancelled: taps,
 *                      drops, and arming a piece from the palette are all ignored
 *
 * Global replay is owned by GameView; this component only renders the supplied
 * live or historical board. Live board undo and redo remain available.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  AREA_LABEL_HEIGHT,
  CULTURE_TRACK,
  CULTURE_TRACK_CELLS,
  ROTATIONS,
  TILE_SQUARES,
  WHITE_ARMY_ID,
  WONDERS_AREA_ID,
  areaBandTop,
  boardHeight,
  boardWidth,
  clampToBoard,
  columnLabel,
  compareWonderNames,
  cultureCellCenter,
  cultureTrackHeight,
  locationOf,
  mapHeight,
  mapTop,
  nearestSlotOrigin,
  remainingBoardAssetCount,
  slotOrigin,
  terrainAt,
  terrainWarning,
} from '@civ/engine'
import type { Board, BoardArea, BoardAsset, BoardPiece } from '@civ/engine'

import { errorMessage } from '../App.js'
import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import { BOARD_PANEL_ID } from './PhaseSummary.js'

/** A map square the player may pick, as the engine lists it for a Build. */
export interface PickableSquare {
  readonly column: number
  readonly row: number
  /** For example "D5". */
  readonly label: string
}

/**
 * Square picking mode (assisted Build): one button per candidate square, laid
 * over the map. The caller owns the selection, so the board forgets nothing it
 * should not and a refresh cannot lose the player's choice.
 */
export interface PickSquares {
  /** What is being placed, for the buttons' names: "Place Library on D5". */
  readonly itemLabel: string
  readonly cells: readonly PickableSquare[]
  readonly selected: { readonly column: number; readonly row: number } | null
  readonly onPick: (cell: PickableSquare) => void
  /** Escape. The board never leaves pick mode by itself. */
  readonly onCancel: () => void
}

interface Props {
  readonly gameId: string
  readonly board: Board
  readonly numOfPlayers: number
  readonly areas: readonly BoardArea[]
  readonly busy: boolean
  readonly readOnly?: boolean
  /** Whose Undo button this is — only enabled when they made the last change. */
  readonly youId?: string | null
  /** Only the Russian player is offered the white army (issue #204). */
  readonly viewerIsRussia?: boolean
  /** Buildings and Great Persons an enemy figure stands on (issue #241); drawn greyed and struck through. */
  readonly blockadedPieceIds?: readonly string[]
  /** Set while a Build waits for the player to pick a square. */
  readonly pickSquares?: PickSquares
  readonly run: (action: () => Promise<PlayerView | unknown>) => Promise<void>
}

const CATEGORY_LABEL: Readonly<Record<BoardAsset['category'], string>> = {
  figure: 'Figures',
  resource: 'Resources',
  marker: 'Markers',
  city: 'Cities',
  citystate: 'City-states',
  building: 'Buildings',
  relic: 'Relics',
  disaster: 'Disasters',
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
  'relic',
  'disaster',
  'greatperson',
  'civtile',
  'tile',
  'leader',
  'wonder',
]

/**
 * How the Buildings tab is grouped and ordered: one box per group on the physical
 * supply sheet, the base building first, then the buildings that stand alone. It follows the
 * physical supply sheet rather than the manifest, which is alphabetical. A
 * building missing here still shows, after these groups, so a new asset is never
 * hidden. Only the display is grouped; supplies are counted in `board.ts`.
 */
const BUILDING_GROUPS: readonly (readonly string[])[] = [
  ['buildings/library', 'buildings/university'],
  ['buildings/market', 'buildings/bank'],
  ['buildings/temple', 'buildings/cathedral'],
  ['buildings/barracks', 'buildings/academy'],
  ['buildings/workshop', 'buildings/ironmine'],
  ['buildings/shipyard', 'buildings/militarydock'],
  ['buildings/granary', 'buildings/aqueduct'],
  ['buildings/tradingpost'],
  ['buildings/harbor'],
]

/** Splits building assets into the display groups above; others follow, one each. */
export function groupBuildings(assets: readonly BoardAsset[]): readonly (readonly BoardAsset[])[] {
  const byId = new Map(assets.map((asset) => [asset.id, asset]))
  const placed = new Set<string>()
  const groups: BoardAsset[][] = []
  for (const ids of BUILDING_GROUPS) {
    const group = ids.flatMap((id) => byId.get(id) ?? [])
    if (group.length === 0) continue
    group.forEach((asset) => placed.add(asset.id))
    groups.push(group)
  }
  for (const asset of assets) {
    if (!placed.has(asset.id)) groups.push([asset])
  }
  return groups
}

/** File names may contain spaces, for example "Building Program.png". */
const assetUrl = (path: string): string =>
  `/board/${path.split('/').map(encodeURIComponent).join('/')}`

const ZOOM_STEPS = [0.3, 0.4, 0.5, 0.65, 0.8, 1] as const

/**
 * Arrow-key nudge distance, in screen pixels rather than board coordinates, so
 * a press looks the same size on screen regardless of zoom (issue #193). A
 * handful of pixels reads as a nudge — well under one grid square even at the
 * smallest zoom step.
 */
const NUDGE_STEP_PX = 6

const isMapTile = (piece: BoardPiece): boolean => piece.category === 'tile' || piece.category === 'civtile'

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
  /** Hides the white army from everyone else; the engine enforces it too. */
  readonly viewerIsRussia?: boolean
  /** Why the pieces cannot be used right now (for example a Build is waiting for its square); they are disabled and this is shown. */
  readonly blockedReason?: string | undefined
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
  viewerIsRussia = false,
  blockedReason,
  onSelectAsset,
}: BoardPaletteProps): React.JSX.Element {
  const available = assets.filter(
    (asset) => asset.category === category && (asset.id !== WHITE_ARMY_ID || viewerIsRussia),
  )
  const inCategory =
    category === 'wonder'
      ? [...available].sort((a, b) => compareWonderNames(a.label, b.label))
      : available
  const draggedAssetRef = useRef(false)
  const blocked = blockedReason !== undefined

  const renderAsset = (asset: BoardAsset): React.JSX.Element => {
    const remaining = remainingBoardAssetCount(asset, pieces, numOfPlayers)
    const exhausted = remaining === 0
    return (
      <button
        type="button"
        key={asset.id}
        className={`palette-item${exhausted ? ' unavailable' : ''}`}
        disabled={replaying || exhausted || blocked}
        title={exhausted ? `${asset.label} (none available)` : asset.label}
        draggable={!replaying && !exhausted && !blocked}
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
          if (!exhausted && !replaying && !blocked) onSelectAsset?.(asset)
        }}
      >
        <img src={assetUrl(asset.path)} alt={asset.label} draggable={false} />
        <span>
          {asset.label}
          {remaining !== undefined && ` (${remaining})`}
        </span>
      </button>
    )
  }

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
          : blocked
            ? blockedReason
            : 'Tap a piece, then tap the board, or drag it there. Drop it in a player area to tidy it into a row.'}
      </p>

      <div className="palette-grid">
        {category === 'building'
          ? groupBuildings(inCategory).map((group) => (
              <div
                key={group[0]?.id}
                role="group"
                aria-label={group.map((asset) => asset.label).join(' and ')}
                className={`palette-group${group.length > 1 ? ' palette-group-pair' : ''}`}
              >
                {group.map(renderAsset)}
              </div>
            ))
          : inCategory.map(renderAsset)}
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
  viewerIsRussia = false,
  blockadedPieceIds = [],
  pickSquares,
  run,
}: Props): React.JSX.Element {
  const [assets, setAssets] = useState<readonly BoardAsset[]>([])
  const [category, setCategory] = useState<BoardAsset['category']>('figure')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pendingAssetId, setPendingAssetId] = useState<string | null>(null)
  const [moveModeId, setMoveModeId] = useState<string | null>(null)
  /** The piece armed with the Move button. Unlike a tap-armed piece, any tap on the board is its destination. */
  const [explicitMoveId, setExplicitMoveId] = useState<string | null>(null)
  useEffect(() => {
    if (explicitMoveId !== null && moveModeId !== explicitMoveId) setExplicitMoveId(null)
  }, [explicitMoveId, moveModeId])
  const [zoomChoice, setZoomChoice] = useState<number | 'auto'>('auto')
  const [autoZoom, setAutoZoom] = useState<number>(ZOOM_STEPS[0])
  const [loadError, setLoadError] = useState<string | null>(null)

  const surfaceRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
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
    /**
     * A mouse press on a map tile while another piece was selected. If it turns
     * out to be a click rather than a drag, it is handled as a board tap for
     * that other piece.
     */
    previous?: { id: string; armed: boolean }
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

  const picking = pickSquares !== undefined
  const onCancelPick = pickSquares?.onCancel
  const pickFirstCell = pickSquares?.cells[0]

  useEffect(() => {
    if (!picking) return
    // A piece that was selected or armed would answer the arrow keys and the next tap.
    setSelectedId(null)
    setMoveModeId(null)
    setPendingAssetId(null)
  }, [picking])

  useEffect(() => {
    if (onCancelPick === undefined) return
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const focused = document.activeElement
      // Escape in a text field belongs to the field.
      if (
        focused instanceof HTMLInputElement ||
        focused instanceof HTMLTextAreaElement ||
        focused instanceof HTMLSelectElement ||
        (focused instanceof HTMLElement && focused.isContentEditable)
      ) return
      onCancelPick()
    }
    document.addEventListener('keydown', cancelOnEscape)
    return () => document.removeEventListener('keydown', cancelOnEscape)
  }, [onCancelPick])

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

  /**
   * Asks before a building, wonder or Great Person goes onto terrain its rule
   * does not allow (issue #255; the rules are in the engine's `terrain.ts`). The server never refuses it; this is the only place the rule shows.
   * `from` is the piece being moved: staying on the terrain it already stands
   * on is not worth a second question. Terrain that is unknown, such as a
   * player area, never asks.
   */
  const terrainAllows = useCallback(
    (assetId: string, centreX: number, centreY: number, from?: BoardPiece, quiet = false): boolean => {
      const warning = terrainWarning(board, assetId, centreX, centreY)
      if (warning === null) return true
      if (from !== undefined && terrainAt(board, from.x + from.width / 2, from.y + from.height / 2) === warning.terrain) {
        return true
      }
      // `quiet` is a held key repeating: the first press already asked, so say no without asking again.
      if (quiet) return false
      return window.confirm(`${warning.message} Place it anyway?`)
    },
    [board],
  )

  const width = boardWidth(board)
  const zoom = zoomChoice === 'auto' ? autoZoom : zoomChoice

  // The board scrolls inside its own box, so entering pick mode brings the
  // candidate squares into that box. Only on entering, never on a refresh.
  useEffect(() => {
    const scroll = scrollRef.current
    if (!picking || scroll === null || typeof scroll.scrollTo !== 'function') return
    const firstRow = pickFirstCell?.row ?? 0
    const firstColumn = pickFirstCell?.column ?? 0
    const reduced =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    scroll.scrollTo({
      top: Math.max(0, (mapTop(board) + firstRow * board.squareSize) * zoom - scroll.clientHeight / 3),
      left: Math.max(0, firstColumn * board.squareSize * zoom - scroll.clientWidth / 3),
      behavior: reduced ? 'auto' : 'smooth',
    })
    // Zoom and the board are read at entry; the squares themselves may change later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picking])

  // The Build picker sits in the Cities panel, far from the board. Entering pick
  // mode brings the board panel into the page, under the sticky confirm bar.
  // Only on entering: a refresh that keeps the plan, or leaving, does not scroll.
  useEffect(() => {
    const panel = panelRef.current
    if (!picking || panel === null || typeof panel.scrollIntoView !== 'function') return
    const reduced =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // The bar wraps onto several lines on a phone, so its real height is the margin
    // when it can be measured; the stylesheet has a fallback. The scroll position is
    // worked out inside the call, so the inline value is removed straight after.
    const barHeight = document.querySelector('.build-bar')?.getBoundingClientRect().height ?? 0
    if (barHeight > 0) panel.style.scrollMarginTop = `${Math.ceil(barHeight) + 12}px`
    panel.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
    panel.style.removeProperty('scroll-margin-top')
  }, [picking])

  useEffect(() => {
    if (selectedId === null) return

    const nudgeSelectedPiece = (event: KeyboardEvent) => {
      if (busy || readOnly) return

      const focused = document.activeElement
      if (
        focused instanceof HTMLInputElement ||
        focused instanceof HTMLTextAreaElement ||
        focused instanceof HTMLSelectElement ||
        (focused instanceof HTMLElement && focused.isContentEditable)
      ) return

      let dx = 0
      let dy = 0
      switch (event.key) {
        case 'ArrowUp':
          dy = -1
          break
        case 'ArrowDown':
          dy = 1
          break
        case 'ArrowLeft':
          dx = -1
          break
        case 'ArrowRight':
          dx = 1
          break
        default:
          return
      }

      const piece = pieces.find((candidate) => candidate.id === selectedId)
      if (piece === undefined) return

      event.preventDefault()
      const step = NUDGE_STEP_PX / zoom
      const [x, y] = clampToBoard(board, piece.x + dx * step, piece.y + dy * step, piece.width, piece.height)
      // A nudge already at the board's edge should not fire a request, the
      // same as the drag path's own no-op-click guard (`onPiecePointerUp`).
      if (x === piece.x && y === piece.y) return
      // `snap: false` bypasses the player-area and map-tile snaps in
      // `movePiece`: a nudge always moves the piece by exactly the requested
      // step, not into the nearest grid slot the way a mouse drop is (issue #193).
      if (!terrainAllows(piece.assetId, x + piece.width / 2, y + piece.height / 2, piece, event.repeat)) return
      void run(() => api.movePiece(gameId, piece.id, x, y, false))
    }

    document.addEventListener('keydown', nudgeSelectedPiece)
    return () => document.removeEventListener('keydown', nudgeSelectedPiece)
  }, [selectedId, busy, readOnly, pieces, zoom, run, gameId, board, terrainAllows])

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
      if (!isMapTile(piece)) continue
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
    // A Build waiting for its square owns the board: nothing is dropped onto it.
    if (busy || readOnly || picking) return

    const assetId = event.dataTransfer.getData('text/civ-asset')
    if (assetId === '') return

    const asset = assets.find((candidate) => candidate.id === assetId)
    if (asset === undefined) return

    const [x, y] = toBoard(event.clientX, event.clientY)
    // Drop the piece centred under the mouse, so (x, y) is its centre
    if (!terrainAllows(asset.id, x, y)) return
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
    // Picking a square is the only thing a tap on the board means now, and the
    // candidate squares are buttons of their own.
    if (picking) return

    const [x, y] = toBoard(event.clientX, event.clientY)
    if (pendingAsset !== null) {
      // Cancelling the question leaves the asset armed, so another square can be tapped.
      if (!terrainAllows(pendingAsset.id, x, y)) return
      setPendingAssetId(null)
      void run(() => api.placePiece(gameId, pendingAsset.id, x - pendingAsset.width / 2, y - pendingAsset.height / 2))
      return
    }

    const moving = pieces.find((piece) => piece.id === moveModeId)
    if (moving !== undefined) {
      if (!terrainAllows(moving.assetId, x, y, moving)) return
      setMoveModeId(null)
      void run(() => api.movePiece(gameId, moving.id, x - moving.width / 2, y - moving.height / 2))
      return
    }

    if (selected === null) return
    if (!isMapTile(selected)) {
      // Not armed (it was just dragged): a tap elsewhere only clears it.
      setSelectedId(null)
      return
    }

    // A selected map tile moves only into an empty map slot. A tap on another
    // tile, or anywhere else, just clears the selection.
    const size = TILE_SQUARES * board.squareSize
    const tappedPiece = event.target instanceof Element && event.target.closest('[data-piece-id]') !== null
    const slot = tappedPiece
      ? undefined
      : fogSlots.map((candidate) => slotOrigin(board, candidate)).find(([sx, sy]) => x >= sx && x < sx + size && y >= sy && y < sy + size)
    if (slot === undefined) {
      setSelectedId(null)
      return
    }
    void run(() => api.movePiece(gameId, selected.id, slot[0], slot[1]))
  }

  // --- moving a piece on the board -----------------------------------------

  /**
   * With a piece selected, a tap on a map tile is a board tap, not a new
   * selection: an armed figure is sent there, and a selected tile is cleared.
   * A tap on any other piece selects that piece instead.
   */
  function tileTapsSurface(piece: BoardPiece): boolean {
    return selectedId !== null && piece.id !== selectedId && isMapTile(piece)
  }

  /**
   * Whether the board surface, not this piece, handles a press on it. A piece
   * armed with the Move button treats every tap as its destination. A mouse
   * press on a map tile still starts a tile drag; if it ends as a plain click
   * it is treated as a board tap (`onPiecePointerUp`).
   */
  function surfaceOwnsTap(piece: BoardPiece, pointerType: string): boolean {
    if (explicitMoveId !== null && piece.id !== explicitMoveId) return true
    return pointerType !== 'mouse' && tileTapsSurface(piece)
  }

  function onPiecePointerDown(event: React.PointerEvent, piece: BoardPiece): void {
    // While a palette asset is armed, the board surface owns the tap—even if
    // the user taps an existing piece such as a starting tile.
    if (pendingAsset !== null || picking || surfaceOwnsTap(piece, event.pointerType)) return
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
      // The first touch marks the piece and, for anything but a map tile, arms
      // destination mode in the same tap, so the next tap on the board moves it
      // there (the same flow as a palette asset). A map tile is never armed by
      // a tap: it moves only into an empty map slot, so a tap elsewhere can
      // safely mean "deselect". Returning here, before the pointer is captured,
      // keeps an untouched piece pannable; the next touch-drag on the marked
      // piece still becomes a drag.
      setMoveModeId(isMapTile(piece) ? null : piece.id)
      surfaceGestureRef.current = null
      return
    }
    const previous = event.pointerType === 'mouse' && tileTapsSurface(piece) && selectedId !== null
      ? { id: selectedId, armed: moveModeId === selectedId }
      : undefined
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
      ...(previous !== undefined ? { previous } : {}),
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
      if (drag.previous !== undefined) {
        // A click on a map tile while another piece was selected is a board
        // tap for that piece: an armed one moves there, anything else is cleared.
        const previous = pieces.find((candidate) => candidate.id === drag.previous?.id)
        if (previous !== undefined && !isMapTile(previous) && drag.previous.armed) {
          const [x, y] = toBoard(event.clientX, event.clientY)
          if (!terrainAllows(previous.assetId, x, y, previous)) {
            // Cancelled: the press on the tile changed the selection, so give it back, still armed.
            setSelectedId(previous.id)
            setMoveModeId(previous.id)
            return
          }
          setSelectedId(previous.id)
          setMoveModeId(null)
          void run(() => api.movePiece(gameId, previous.id, x - previous.width / 2, y - previous.height / 2))
        } else {
          setSelectedId(null)
          setMoveModeId(null)
        }
        return
      }
      setMoveModeId(piece !== undefined && isMapTile(piece) ? null : drag.id)
      return
    }
    // The drag itself already moved the piece; disarm so an unrelated later
    // tap on the board does not move it a second time.
    setMoveModeId(null)
    // Cancelled, the piece springs back: the board is unchanged and the drag is already cleared.
    if (piece !== undefined && !terrainAllows(piece.assetId, drag.x + piece.width / 2, drag.y + piece.height / 2, piece)) return
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
    <section
      ref={panelRef}
      id={BOARD_PANEL_ID}
      className={`panel board-panel${picking ? ' build-picking' : ''}`}
      tabIndex={-1}
      aria-labelledby={`${BOARD_PANEL_ID}-heading`}
    >
      <div className="row">
        <h2 id={`${BOARD_PANEL_ID}-heading`} style={{ margin: 0 }}>Civilization Boardgame</h2>
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
          title="Bring back the last undone change"
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
              className={`board-surface${picking ? ' picking' : ''}`}
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

                const blockaded = blockadedPieceIds.includes(piece.id)

                return (
                  <Fragment key={piece.id}>
                    <img
                      data-piece-id={piece.id}
                      className={`board-piece${piece.category === 'relic' ? ' board-piece-relic' : ''}${blockaded ? ' board-piece-blockaded' : ''}${piece.id === selectedId ? ' selected' : ''}`}
                      src={assetUrl(piece.path)}
                      alt={blockaded ? `${piece.label}, blockaded` : piece.label}
                      title={`${piece.label} · ${locationOf(board, areas, piece)}${blockaded ? ' · Blockaded by an enemy figure' : ''}`}
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
                        if (pendingAsset === null && !picking && !surfaceOwnsTap(piece, event.pointerType)) {
                          event.stopPropagation()
                        }
                        onPiecePointerDown(event, piece)
                      }}
                      onPointerMove={onPiecePointerMove}
                      onPointerUp={onPiecePointerUp}
                      onPointerCancel={onPiecePointerCancel}
                      onLostPointerCapture={onPiecePointerCancel}
                    />
                    {blockaded && (
                      // The strike-through is a picture of the same fact the alt text and title state.
                      <span
                        aria-hidden="true"
                        className="board-piece-strike"
                        style={{
                          left: x * zoom,
                          top: y * zoom,
                          width: piece.width * zoom,
                          height: piece.height * zoom,
                        }}
                      />
                    )}
                  </Fragment>
                )
              })}

              {pickSquares?.cells.map((cell) => {
                const chosen = pickSquares.selected?.column === cell.column && pickSquares.selected.row === cell.row
                return (
                  <button
                    key={`pick-${cell.column}-${cell.row}`}
                    type="button"
                    className={`board-pick-cell${chosen ? ' chosen' : ''}`}
                    aria-label={`Place ${pickSquares.itemLabel} on ${cell.label}`}
                    aria-pressed={chosen}
                    disabled={busy || readOnly}
                    style={{
                      left: cell.column * board.squareSize * zoom,
                      top: (mapStart + cell.row * board.squareSize) * zoom,
                      width: board.squareSize * zoom,
                      height: board.squareSize * zoom,
                    }}
                    onClick={() => pickSquares.onPick(cell)}
                  >
                    <span aria-hidden="true">{cell.label}</span>
                  </button>
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
            viewerIsRussia={viewerIsRussia}
            blockedReason={picking ? 'Finish or cancel the build first.' : undefined}
            onSelectAsset={(asset) => {
              if (picking) return
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
                    setExplicitMoveId(selected.id)
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
