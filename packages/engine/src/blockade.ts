/**
 * The blockade rule (issue #241), derived from the board rather than stored.
 *
 * Base rulebook p. 27: "A square in a city's outskirts that contains one or
 * more enemy figures (either scouts or armies) does not generate production,
 * trade, culture, coins, or resources for the city's owner. A square may be
 * blockaded even if it contains a building or a great person." The official
 * FAQ adds that a Great Person card cannot use its ability while every token
 * of its type is blockaded. Wonders follow the same rule (p. 27: the ability
 * on the card cannot be used and the marker's culture cannot be collected
 * while an enemy figure is in its square). FAQ 2.0 p. 4: the coin tokens on
 * the Panama Canal stay on the card but are not counted while it is blockaded.
 *
 * Nothing here is saved in the game state, so undo, redo, time travel and old
 * games follow the board by themselves. Only a piece on a map square can be
 * blockaded, so the shared Wonders area never is.
 */

import type { Board, BoardPiece } from './board.js'
import { WHITE_ARMY_ID, mapTop, squareOf } from './board.js'
import type { GameState, Playerhand } from './state.js'

/** The five player colours a city or figure piece can come in, matching `PLAYER_COLORS`. */
const PIECE_COLORS = ['blue', 'green', 'purple', 'red', 'yellow'] as const

/**
 * A city or figure piece's colour, lower case, read off its asset id: for
 * example "cities/redcity2" or "figures/redarmy" belong to Red. `undefined`
 * for the white army and for pieces that have no colour in the artwork
 * (buildings, great persons, city-states).
 */
export function pieceColorOf(piece: BoardPiece): string | undefined {
  const base = piece.assetId.split('/').at(-1)?.toLowerCase() ?? ''
  return PIECE_COLORS.find((colour) => base.startsWith(colour))
}

/** The Great Person token on the board, and the card `type` it stands for. */
export const GREAT_PERSON_CARD_TYPES: readonly (readonly [assetId: string, cardType: string])[] = [
  ['great people/artist', 'Artist or Thinker'],
  ['great people/builder', 'Builder or Inventor'],
  ['great people/general', 'General'],
  ['great people/humanitarian', 'Humanitarian'],
  ['great people/merchant', 'Merchant or Explorer'],
  ['great people/scientist', 'Scientist'],
]

/** The tokens that give their owner 1 coin while they stand in a city's outskirts. */
const COIN_TOKEN_IDS: ReadonlySet<string> = new Set([
  'great people/builder',
  'great people/merchant',
  'great people/humanitarian',
])

/** Russia's civilization card is named in the plural, like the other civs. */
const RUSSIA_CIV = 'Russians'

interface Cell {
  readonly column: number
  readonly row: number
}

interface CityFootprint {
  readonly color: string
  readonly centers: readonly Cell[]
  readonly cells: readonly Cell[]
}

/**
 * The map square a piece sits in, as numbers, or `null` off the map. Same
 * arithmetic as `squareOf` (which is what decides whether the piece is on a
 * playable slot); it only gives the numbers instead of the label, so the eight
 * neighbours of a city can be found.
 */
function cellOf(board: Board, piece: BoardPiece): Cell | null {
  if (squareOf(board, piece) === null) return null
  return {
    column: Math.floor((piece.x + piece.width / 2) / board.squareSize),
    row: Math.floor((piece.y + piece.height / 2 - mapTop(board)) / board.squareSize),
  }
}

const keyOf = (cell: Cell): string => `${cell.column},${cell.row}`

/** The metropolis marker spans two city squares along its long axis. */
function cityFootprint(board: Board, piece: BoardPiece, color: string): CityFootprint | undefined {
  const anchor = cellOf(board, piece)
  if (anchor === null) return undefined
  const isMetropolis = piece.assetId.includes('metropolis')
  const isVertical = piece.rotation === 90 || piece.rotation === 270
  const centers: readonly Cell[] = isMetropolis
    ? [anchor, {
        column: anchor.column - (isVertical ? 0 : 1),
        row: anchor.row - (isVertical ? 1 : 0),
      }]
    : [anchor]
  const cells = new Map<string, Cell>()
  for (const center of centers) {
    for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
      for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
        const cell = {
          column: center.column + columnOffset,
          row: center.row + rowOffset,
        }
        cells.set(keyOf(cell), cell)
      }
    }
  }
  return { color, centers, cells: [...cells.values()] }
}

/**
 * Everything the questions below need, worked out once from the board: the
 * colours of the cities on the map and of the figures in each square.
 */
class BlockadeIndex {
  private readonly cities: readonly CityFootprint[]
  private readonly figureColors = new Map<string, Set<string | undefined>>()
  private readonly russiaColor: string | undefined
  private readonly hasRussia: boolean

  constructor(private readonly state: Pick<GameState, 'board' | 'players'>) {
    const cities: CityFootprint[] = []
    for (const piece of state.board.pieces) {
      if (piece.category !== 'city' && piece.category !== 'figure') continue
      const cell = cellOf(state.board, piece)
      if (cell === null) continue
      const color = pieceColorOf(piece)
      if (piece.category === 'city') {
        if (color !== undefined) {
          const footprint = cityFootprint(state.board, piece, color)
          if (footprint !== undefined) cities.push(footprint)
        }
        continue
      }
      const seen = this.figureColors.get(keyOf(cell)) ?? new Set<string | undefined>()
      seen.add(piece.assetId === WHITE_ARMY_ID ? 'white' : color)
      this.figureColors.set(keyOf(cell), seen)
    }
    this.cities = cities
    const russia = state.players.find((player) => player.civilization?.name === RUSSIA_CIV)
    this.hasRussia = russia !== undefined
    this.russiaColor = russia?.color?.toLowerCase()
  }

  /** The colours of cities whose center or outskirts include this square. */
  cityColorsAround(cell: Cell): ReadonlySet<string> {
    const colors = new Set<string>()
    for (const city of this.cities) {
      if (city.cells.some((cityCell) => keyOf(cityCell) === keyOf(cell))) {
        colors.add(city.color)
      }
    }
    return colors
  }

  isCityCenter(cell: Cell): boolean {
    return this.cities.some((city) => city.centers.some((center) => keyOf(center) === keyOf(cell)))
  }

  /**
   * The colour that owns a building or great person. The owner of the city it
   * belongs to; when the outskirts hold no city, or cities of two colours, the
   * colour of whoever placed it. `undefined` when even that is unknown.
   */
  ownerColor(piece: BoardPiece): string | undefined {
    // A wonder's owner is assigned explicitly (`setWonderOwner`), not read off
    // a city. An owner without a colour yet leaves it with no owner at all.
    if (piece.category === 'wonder' && piece.ownerId !== undefined && piece.ownerId !== null) {
      return this.state.players
        .find((player) => player.playerId === piece.ownerId)
        ?.color?.toLowerCase()
    }
    const cell = cellOf(this.state.board, piece)
    if (cell !== null) {
      const around = this.cityColorsAround(cell)
      if (around.size === 1) return [...around][0]
    }
    if (piece.placedBy === null) return undefined
    return this.state.players
      .find((player) => player.playerId === piece.placedBy)
      ?.color?.toLowerCase()
  }

  /** A building's city owner without the placedBy fallback. */
  cityOwnerColor(piece: BoardPiece): string | undefined {
    const cell = cellOf(this.state.board, piece)
    if (cell === null) return undefined
    if (this.isCityCenter(cell)) return undefined
    const around = this.cityColorsAround(cell)
    return around.size === 1 ? [...around][0] : undefined
  }

  isBlockaded(piece: BoardPiece): boolean {
    const owner = this.ownerColor(piece)
    return owner !== undefined && this.hasEnemyFigure(piece, owner)
  }

  /** Whether a figure that is no friend of `color` stands in the piece's map square. */
  hasEnemyFigure(piece: BoardPiece, color: string): boolean {
    const cell = cellOf(this.state.board, piece)
    if (cell === null) return false

    for (const figure of this.figureColors.get(keyOf(cell)) ?? []) {
      if (figure === 'white') {
        // The white army is the Russian player's extra army. Without a Russia
        // player it is nobody's, so an enemy to all. A Russia player who has no
        // colour yet makes it unattributable: it is an enemy of no one.
        if (!this.hasRussia) return true
        if (this.russiaColor === undefined) continue
        if (this.russiaColor !== color) return true
        continue
      }
      if (figure !== color) return true
    }
    return false
  }
}

/**
 * The colour that owns a `building` or `greatperson` piece: the unique colour
 * of the cities (capital, city or metropolis, walled or not; city-states do not
 * count) in its square or outskirts. A metropolis has two center squares along
 * the marker's rotated long axis and ten surrounding squares.
 * With no city, or cities of more than one colour, it is the colour of the
 * player who placed it. `undefined` when that is unknown too: the piece then
 * belongs to nobody, is never blockaded and gives no coin.
 */
export function pieceOwnerColor(
  state: Pick<GameState, 'board' | 'players'>,
  piece: BoardPiece,
): string | undefined {
  return new BlockadeIndex(state).ownerColor(piece)
}

/**
 * A building's owner only when its map square is in exactly one colour's city
 * footprint. Unlike {@link pieceOwnerColor}, this never guesses from who placed
 * the piece; derived Bank coins use it so a transferred or misplaced Bank is
 * not silently credited to its old placer.
 */
export function pieceCityOwnerColor(
  state: Pick<GameState, 'board' | 'players'>,
  piece: BoardPiece,
): string | undefined {
  return new BlockadeIndex(state).cityOwnerColor(piece)
}

/**
 * Whether a piece is on a map square (never a player area or the culture
 * track) that holds an army or scout of another colour than its owner's.
 * `figures/whitearmy` counts as the Russian player's colour.
 */
export function isBlockaded(state: Pick<GameState, 'board' | 'players'>, piece: BoardPiece): boolean {
  return new BlockadeIndex(state).isBlockaded(piece)
}

/**
 * Whether a figure of another colour than `colour` stands in the piece's map
 * square, whoever owns the piece. The combat bonus uses this with the colour of
 * the player a piece is attributed to (`placedBy`), where `isBlockaded` asks the
 * same question for the colour of the city the piece belongs to.
 */
export function isBlockadedFor(
  state: Pick<GameState, 'board' | 'players'>,
  piece: BoardPiece,
  colour: string,
): boolean {
  return blockadeCheckFor(state)(piece, colour)
}

/** `isBlockadedFor` for many pieces: the board is indexed once, not per call. */
export function blockadeCheckFor(
  state: Pick<GameState, 'board' | 'players'>,
): (piece: BoardPiece, colour: string) => boolean {
  const index = new BlockadeIndex(state)
  return (piece, colour) => index.hasEnemyFigure(piece, colour)
}

/**
 * Whether a wonder the player owns (`ownerId`) stands on a map square with a
 * figure of another colour than the player's in it. Used for the wonders whose
 * effect the engine derives: the Statue of Zeus and the Panama Canal.
 */
export function isOwnWonderBlockaded(
  state: Pick<GameState, 'board' | 'players'>,
  player: Playerhand,
  assetId: string,
): boolean {
  if (player.color === null) return false
  const colour = player.color.toLowerCase()
  const index = new BlockadeIndex(state)
  return state.board.pieces.some(
    (piece) => piece.assetId === assetId && piece.ownerId === player.playerId && index.hasEnemyFigure(piece, colour),
  )
}

/** The ids of every blockaded building, wonder and Great Person token on the board. */
export function blockadedPieceIds(state: Pick<GameState, 'board' | 'players'>): readonly string[] {
  const index = new BlockadeIndex(state)
  return state.board.pieces
    .filter(
      (piece) =>
        (piece.category === 'building' || piece.category === 'greatperson' || piece.category === 'wonder') &&
        index.isBlockaded(piece),
    )
    .map((piece) => piece.id)
}

/**
 * The Great Person card types a player cannot use because of the blockade: the
 * ones with at least one token of the player's colour on the map, all of them
 * blockaded (FAQ 2.0: one free token keeps the card usable). A type with no
 * token on the map is not listed. The players may not track their tokens, so
 * "no token" must not look like "disabled".
 *
 * Derived from the public board and the player's colour only, never from the
 * cards in the hand.
 */
export function blockadedGreatPersonTypes(
  state: Pick<GameState, 'board' | 'players'>,
  player: Playerhand,
): readonly string[] {
  if (player.color === null) return []
  const colour = player.color.toLowerCase()
  const index = new BlockadeIndex(state)

  return GREAT_PERSON_CARD_TYPES.filter(([assetId]) => {
    const tokens = state.board.pieces.filter(
      (piece) =>
        piece.assetId === assetId &&
        cellOf(state.board, piece) !== null &&
        index.ownerColor(piece) === colour,
    )
    return tokens.length > 0 && tokens.every((piece) => index.isBlockaded(piece))
  }).map(([, cardType]) => cardType)
}

/**
 * The coins a player gets from Great Persons: 1 for each Builder, Merchant or
 * Humanitarian token on the map in the outskirts of one of their cities, as
 * long as it is not blockaded. A token in a player area, off the map, removed
 * or blockaded gives nothing.
 */
export function greatPersonCoinsOf(
  state: Pick<GameState, 'board' | 'players'>,
  player: Playerhand,
): number {
  if (player.color === null) return 0
  const colour = player.color.toLowerCase()
  const index = new BlockadeIndex(state)

  let coins = 0
  for (const piece of state.board.pieces) {
    if (!COIN_TOKEN_IDS.has(piece.assetId)) continue
    const cell = cellOf(state.board, piece)
    if (cell === null) continue
    if (index.isCityCenter(cell)) continue
    if (!index.cityColorsAround(cell).has(colour)) continue
    if (index.ownerColor(piece) !== colour || index.isBlockaded(piece)) continue
    coins += 1
  }
  return coins
}
