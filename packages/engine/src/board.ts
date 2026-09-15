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

export type BoardAssetCategory =
  | 'figure'
  | 'resource'
  | 'marker'
  | 'city'
  | 'building'
  /** Sivilisasjonenes startbrett, ett per civ. */
  | 'civtile'
  /** De nummererte utforskningsbrettene, pluss baksiden. */
  | 'tile'

/** Brikker kan snus i fire retninger. Grader med klokka. */
export type Rotation = 0 | 90 | 180 | 270

export const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270]

export function nextRotation(rotation: Rotation, clockwise = true): Rotation {
  const index = ROTATIONS.indexOf(rotation)
  const step = clockwise ? 1 : ROTATIONS.length - 1
  return ROTATIONS[(index + step) % ROTATIONS.length] as Rotation
}

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
  /**
   * Rotasjon med klokka. Map-tiles har en pil som viser hvilken vei brettet
   * skal ligge, så de må kunne snus. Alle brikker kan snus, for enkelhets skyld.
   */
  readonly rotation: Rotation
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

// ---------------------------------------------------------------------------
// Map-tiles: luker, hjørner og orientering
// ---------------------------------------------------------------------------

/** Antall 4 × 4-luker langs hver kant. For 16 ruter blir det fire. */
export const blockColumns = (board: Board): number =>
  Math.floor(board.columns / TILE_SQUARES)
export const blockRows = (board: Board): number => Math.floor(board.rows / TILE_SQUARES)

/** Øvre venstre hjørne av luken på (blokk-kolonne, blokk-rad), i piksler. */
export function blockOrigin(
  board: Board,
  blockColumn: number,
  blockRow: number,
): readonly [x: number, y: number] {
  const size = TILE_SQUARES * board.squareSize
  return [blockColumn * size, blockRow * size]
}

/**
 * Hvor sivilisasjonens startbrett skal ligge, og hvilken vei det skal snus.
 *
 * Spiller 1 får øvre venstre luke (A1–D4), 2 øvre høyre, 3 nedre høyre og
 * 4 nedre venstre — samme fordeling som eksempelbrettet.
 *
 * Startbrettene har en pil som viser hvilken vei brettet skal ligge, og den
 * skal peke inn mot midten. I bildefilene peker pilen ned — kontrollert mot
 * japan.jpg og germany.png. Rotasjon med klokka flytter den rundt: 0° gir pil
 * ned, som passer øvre venstre luke; 90° gir pil venstre, som passer øvre
 * høyre; og så videre rundt brettet.
 *
 * Brettet kan snus fritt etterpå, så dette er startpunktet og ikke en tvang.
 */
export function startingCorner(
  board: Board,
  playernumber: number,
): { readonly x: number; readonly y: number; readonly rotation: Rotation } {
  const lastColumn = blockColumns(board) - 1
  const lastRow = blockRows(board) - 1

  const corners: readonly { blockColumn: number; blockRow: number; rotation: Rotation }[] = [
    { blockColumn: 0, blockRow: 0, rotation: 0 },
    { blockColumn: lastColumn, blockRow: 0, rotation: 90 },
    { blockColumn: lastColumn, blockRow: lastRow, rotation: 180 },
    { blockColumn: 0, blockRow: lastRow, rotation: 270 },
  ]

  // playernumber er 1-basert; flere enn fire spillere deler hjørnene på nytt
  const corner = corners[(Math.max(playernumber, 1) - 1) % corners.length] as (typeof corners)[number]
  const [x, y] = blockOrigin(board, corner.blockColumn, corner.blockRow)
  return { x, y, rotation: corner.rotation }
}

/**
 * Første ledige 4 × 4-luke, lest radvis. Brukes når et utforskningsbrett
 * trekkes: systemet vet ikke hvilket område spilleren utforsker, så brettet
 * legges et sted det er plass og dras på plass derfra.
 *
 * Er alt fullt, legges det i øvre venstre luke, oppå det som ligger der.
 */
export function firstFreeBlock(board: Board): readonly [x: number, y: number] {
  const size = TILE_SQUARES * board.squareSize
  const taken = new Set(
    board.pieces
      .filter((piece) => piece.category === 'tile' || piece.category === 'civtile')
      .map((piece) => `${Math.round(piece.x / size)},${Math.round(piece.y / size)}`),
  )

  for (let row = 0; row < blockRows(board); row++) {
    for (let column = 0; column < blockColumns(board); column++) {
      if (!taken.has(`${column},${row}`)) return blockOrigin(board, column, row)
    }
  }
  return [0, 0]
}

/**
 * Sivilisasjonsnavnet i regnearket til filnavnet på startbrettet.
 *
 * Navnene stemmer ikke overens: arket sier «Americans» mens bildet heter
 * «america.png». Derfor er koblingen listet ut i sin helhet i stedet for å
 * gjettes.
 */
const CIV_TILE_BY_NAME: Readonly<Record<string, string>> = {
  Americans: 'tiles/america',
  Arabs: 'tiles/arabia',
  Aztecs: 'tiles/Aztec',
  Chinese: 'tiles/china',
  Egyptians: 'tiles/egypt',
  England: 'tiles/England',
  French: 'tiles/France',
  Germans: 'tiles/germany',
  Greeks: 'tiles/greece',
  Indians: 'tiles/india',
  Japanese: 'tiles/japan',
  Mongols: 'tiles/mongolia',
  Romans: 'tiles/rome',
  Russians: 'tiles/russia',
  Spanish: 'tiles/spain',
  Zulu: 'tiles/Zulu',
}

export function civTileAssetId(civName: string): string | undefined {
  return CIV_TILE_BY_NAME[civName]
}

/**
 * Tallet på et Tile-kort til filnavnet på bildet.
 *
 * Filene heter tile01 til tile14, så tile15a til tile21a, tile22b til tile25b,
 * og til slutt Tile26b og Tile27b. Suffiksene skiller utvidelsene, så oppslaget
 * gjøres på tallet i navnet.
 */
const TILE_BY_NUMBER = new Map<number, string>(
  BOARD_ASSETS.filter((asset) => asset.category === 'tile')
    .map((asset) => {
      const digits = /(\d+)/.exec(asset.id)
      return digits === null ? null : ([Number(digits[1]), asset.id] as const)
    })
    .filter((entry): entry is readonly [number, string] => entry !== null),
)

export function tileAssetIdForNumber(tileNumber: number): string | undefined {
  return TILE_BY_NUMBER.get(tileNumber)
}
