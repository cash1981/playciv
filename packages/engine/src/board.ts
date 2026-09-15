/**
 * Brettet.
 *
 * Erstatter Google Presentation-hacket: den gamle løsningen la en lenke til et
 * lysbilde i `PBF.mapLink` og lot en moderator flytte brikker for hånd.
 *
 * Geometrien er hentet fra `Civilization/Moderator/4v4 Map Template.pptx`:
 * 16 × 16 ruter merket A–P og 1–16, satt sammen av 4 × 4 map-tiles på
 * 375 × 375 piksler. Det gir en rute på 375 / 4 ≈ 94 piksler, som er nøyaktig
 * størrelsen på by-, bygnings- og bystatbrikkene i samme mappe.
 *
 * Brikker plasseres fritt i pikselkoordinater, ikke i ruter. Det er hvordan
 * PowerPoint-malen ble brukt, og det er nødvendig for å kunne stable flere
 * brikker i samme rute og parkere dem halvveis utenfor.
 */

import boardAssets from '../data/board-assets.json' with { type: 'json' }

/** Kantlengden på én rute, i brettets eget koordinatsystem. */
export const SQUARE_SIZE = 94

/** Et map-tile dekker 4 × 4 ruter. */
export const TILE_SQUARES = 4

/** 4 × 4 map-tiles, som i malen for fire spillere. */
export const DEFAULT_COLUMNS = 16
export const DEFAULT_ROWS = 16

/** Kolonneetikettene i malen: A til P. */
export const COLUMN_LABELS = Array.from({ length: DEFAULT_COLUMNS }, (_, index) =>
  String.fromCharCode(65 + index),
)

export type BoardAssetCategory = 'figure' | 'resource' | 'marker' | 'city' | 'building'

/** En brikketype som kan legges på brettet. Hentet fra bildene på disk. */
export interface BoardAsset {
  /** Stabil nøkkel, f.eks. "figures/redarmy". */
  readonly id: string
  readonly category: BoardAssetCategory
  /** Filsti under klientens /board/, f.eks. "figures/redarmy.png". */
  readonly path: string
  readonly label: string
  readonly width: number
  readonly height: number
}

interface BoardAssetFile {
  readonly assets: readonly BoardAsset[]
}

/**
 * Alle kjente brikketyper, generert av `tools/board-assets.ps1` fra bildene i
 * `Civilization/Moderator`. Manifestet ligger i motoren og ikke i klienten
 * fordi serveren må kunne avvise en brikke som peker på en ukjent fil.
 */
export const BOARD_ASSETS: readonly BoardAsset[] = (boardAssets as BoardAssetFile).assets

const ASSETS_BY_ID = new Map(BOARD_ASSETS.map((asset) => [asset.id, asset]))

export function findBoardAsset(assetId: string): BoardAsset | undefined {
  return ASSETS_BY_ID.get(assetId)
}

export function boardAssetsByCategory(category: BoardAssetCategory): readonly BoardAsset[] {
  return BOARD_ASSETS.filter((asset) => asset.category === category)
}

/** En brikke som ligger på brettet. */
export interface BoardPiece {
  readonly id: string
  readonly assetId: string
  /** Kopiert fra manifestet ved utlegging, så klienten slipper et oppslag. */
  readonly path: string
  readonly label: string
  readonly category: BoardAssetCategory
  /** Venstre og topp i brettkoordinater. */
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  /** Hvem som la den ut. Brikker kan flyttes av alle. */
  readonly placedBy: string | null
}

/**
 * Brettet. Rekkefølgen i `pieces` ER z-rekkefølgen: siste element tegnes
 * øverst. Derfor trengs ikke noe z-felt, og «legg forrest» er bare en flytting
 * til slutten av listen.
 */
export interface Board {
  readonly columns: number
  readonly rows: number
  readonly squareSize: number
  readonly pieces: readonly BoardPiece[]
}

export function createBoard(
  columns = DEFAULT_COLUMNS,
  rows = DEFAULT_ROWS,
): Board {
  return { columns, rows, squareSize: SQUARE_SIZE, pieces: [] }
}

export const boardWidth = (board: Board): number => board.columns * board.squareSize
export const boardHeight = (board: Board): number => board.rows * board.squareSize

/**
 * Holder brikken innenfor brettflaten. Halve brikken får stikke utenfor, slik
 * at man kan markere noe i kanten uten at brikken forsvinner helt.
 */
export function clampToBoard(
  board: Board,
  x: number,
  y: number,
  width: number,
  height: number,
): readonly [x: number, y: number] {
  const clamp = (value: number, max: number): number => Math.min(Math.max(value, 0), max)
  return [
    clamp(Math.round(x), boardWidth(board) - width / 2),
    clamp(Math.round(y), boardHeight(board) - height / 2),
  ]
}

/** Ruten en brikke ligger i, ut fra sitt midtpunkt. `null` utenfor brettet. */
export function squareOf(board: Board, piece: BoardPiece): string | null {
  const column = Math.floor((piece.x + piece.width / 2) / board.squareSize)
  const row = Math.floor((piece.y + piece.height / 2) / board.squareSize)
  if (column < 0 || column >= board.columns || row < 0 || row >= board.rows) return null
  return `${COLUMN_LABELS[column] ?? '?'}${row + 1}`
}

export function findPiece(board: Board, pieceId: string): BoardPiece | undefined {
  return board.pieces.find((piece) => piece.id === pieceId)
}
