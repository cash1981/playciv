/**
 * Board actions.
 *
 * All of this is new — Java had no board model, only a link to a Google slide.
 * The reducers follow the same shape as the rest of the engine.
 *
 * Every player may move every piece, as at a physical table. The server checks
 * that the asset name exists in the manifest, so a client cannot put an
 * arbitrary image reference on the board.
 *
 * Every change is recorded in `board.history`, which makes two things possible:
 * undoing your own last change (with a matching redo), and stepping through the
 * whole game to see what the others did while you were away. The game log is
 * not written to from here — a turn is made of many small adjustments and the
 * log would drown.
 */

import type { Board, BoardArea, BoardChange, BoardHistoryEntry, BoardPiece, Rotation } from '../board.js'
import {
  applyChange,
  areaAt,
  boardUndoBlocked,
  boardAssetLimit,
  boardAreas,
  AREA_LABEL_HEIGHT,
  clampToBoard,
  faceOf,
  findBoardAsset,
  findPiece,
  locationOf,
  nearestSlotOrigin,
  nextFreeSlot,
  nextRotation,
  remainingBoardAssetCount,
  revertChange,
  playerAreas,
  START_PLAYER_ID,
  whiteFigureCivilization,
} from '../board.js'
import { cityFootprintsOf, mapCellOf } from '../blockade.js'
import type { EngineError } from '../errors.js'
import { MAX_PRODUCTION_OVERRIDE } from '../limits.js'
import { appendLog } from '../log.js'
import { nextId } from '../random.js'
import type { Result } from '../result.js'
import { err, ok } from '../result.js'
import type { GameState, Playerhand } from '../state.js'
import { findPlayer, hasUserAccess } from '../state.js'
import { startMarkerOf, startPlayerOf } from '../turn.js'

type ActionResult = Result<GameState, EngineError>

function withBoard(state: GameState, board: Board): GameState {
  return { ...state, board }
}

function requireAccess(state: GameState, playerId: string): EngineError | undefined {
  return hasUserAccess(state, playerId) ? undefined : { kind: 'NO_ACCESS', playerId }
}

/**
 * The areas for this game: one per player plus the shared Wonders area, derived
 * from the current player list. A new piece placed in any of them tidies into
 * its grid, so wonders collect in the Wonders area the same way huts collect in
 * a player's area. A piece moved there keeps its spot (issue #100).
 */
export function areasFor(state: GameState): readonly BoardArea[] {
  return boardAreas(state.board, state.players)
}

/**
 * The actor of a board change the engine makes on its own, such as taking back
 * what a civilization reveal placed. No player is this, so nobody's board Undo
 * can revert it (`undoLastBoardChange` only reverts the caller's own entries).
 */
export const BOARD_SYSTEM_ACTOR = 'System'

interface Recorded {
  readonly state: GameState
  readonly pieces: readonly BoardPiece[]
  readonly change: BoardChange
  readonly description: string
}

/**
 * Writes one change into the board and appends it to the history.
 *
 * The caller works out the new pieces and the change that produced them; this
 * keeps the bookkeeping in one place.
 */
function record(
  input: { readonly playerId: string; readonly at?: string },
  recorded: Recorded,
): GameState {
  const { state } = recorded
  const player = findPlayer(state, input.playerId)
  const actor = input.playerId === BOARD_SYSTEM_ACTOR ? 'System' : player?.username
  const [id, rng] = nextId(state.rng)

  return {
    ...state,
    rng,
    board: {
      ...state.board,
      pieces: recorded.pieces,
      history: [
        ...state.board.history,
        {
          id,
          at: input.at ?? null,
          playerId: input.playerId,
          username: actor ?? 'unknown',
          description: `${actor ?? 'Someone'} ${recorded.description}`,
          change: recorded.change,
          logLength: state.log.length,
        },
      ],
      // A fresh change invalidates whatever undo the redo stack was offering
      // to bring back — the same way a text editor's redo dies once you type.
      redo: [],
    },
  }
}

// ---------------------------------------------------------------------------
// Placing
// ---------------------------------------------------------------------------

export interface PlacePieceInput {
  readonly playerId: string
  readonly assetId: string
  readonly x: number
  readonly y: number
  readonly rotation?: Rotation
  /**
   * Assigns the piece's owner at the moment it is placed — Egypt's own
   * starting wonder, per issue #172 (`drawWonderToBoard`'s own-area
   * destination). Every other caller places a piece unowned, exactly as
   * before; ownership is then set later, explicitly, through
   * {@link setWonderOwner}.
   */
  readonly ownerId?: string
  /** ISO timestamp for the history. The engine itself stays pure. */
  readonly at?: string
}

/** Puts a new piece on the board, on top of the stack. */
export function placePiece(state: GameState, input: PlacePieceInput): ActionResult {
  const denied = requireAccess(state, input.playerId)
  if (denied !== undefined) return err(denied)

  const asset = findBoardAsset(input.assetId)
  if (asset === undefined) {
    return err({ kind: 'BOARD_ASSET_NOT_FOUND', assetId: input.assetId })
  }
  // Checked before the limit so the wrong civ is told why, not "none left"
  const owningCivilization = whiteFigureCivilization(asset.id)
  if (
    owningCivilization !== undefined &&
    findPlayer(state, input.playerId)?.civilization?.name !== owningCivilization
  ) {
    return err({
      kind: 'BOARD_ASSET_CIV_ONLY',
      assetId: input.assetId,
      civilization: owningCivilization,
    })
  }
  const remaining = remainingBoardAssetCount(asset, state.board.pieces, state.numOfPlayers)
  if (remaining !== undefined && remaining === 0) {
    return err({
      kind: 'BOARD_ASSET_LIMIT_REACHED',
      assetId: input.assetId,
      limit: boardAssetLimit(asset, state.numOfPlayers) ?? 0,
    })
  }

  const placed = placeUnchecked(state, input)
  if (placed === undefined) {
    return err({ kind: 'BOARD_ASSET_NOT_FOUND', assetId: input.assetId })
  }
  // A second start player marker dropped in another area takes over
  // The id comes from the history entry, not from the position: map tiles go underneath
  const change = placed.board.history.at(-1)?.change
  if (change?.kind !== 'place') return ok(placed)
  return ok(replaceUnderGreatPerson(announceStartPlayer(state, placed, change.piece.id), change.piece.id, input, null))
}

/**
 * The same as `placePiece`, but without the access check and without a Result.
 *
 * Used by the engine itself when one action puts a piece down as a consequence
 * of something else — a drawn exploration tile, or the starting tile of a
 * civilization being revealed. Access has already been checked by the caller.
 *
 * Returns `undefined` when the asset does not exist.
 */
export function placeUnchecked(
  state: GameState,
  input: PlacePieceInput & {
    /**
     * Who the piece is attributed to (`BoardPiece.placedBy`). Left out, it is
     * `playerId`, as for every other caller. A flip that replaces a piece
     * passes the old piece's value, so combat bonus and building count stay
     * with the original placer; `null` keeps a piece with no placer unattributed.
     */
    readonly placedBy?: string | null
  },
): GameState | undefined {
  const asset = findBoardAsset(input.assetId)
  if (asset === undefined) return undefined

  const [id, rng] = nextId(state.rng)
  const withId: GameState = { ...state, rng }

  // Dropping a piece in a player area tidies it into the next free slot
  const areas = areasFor(state)
  const area = areaAt(areas, input.x + asset.width / 2, input.y + asset.height / 2)
  const mapOrigin =
    asset.category === 'tile' || asset.category === 'civtile'
      ? nearestSlotOrigin(state.board, input.x, input.y)
      : undefined
  const wanted =
    mapOrigin !== undefined
      ? { x: mapOrigin[0], y: mapOrigin[1] }
      : area === undefined
        ? { x: input.x, y: input.y }
      : (() => {
          const [slotX, slotY] = nextFreeSlot(state.board, area, state.board.pieces, {
            x: input.x,
            y: input.y,
          })
          return { x: slotX, y: slotY }
        })()

  const [x, y] = clampToBoard(state.board, wanted.x, wanted.y, asset.width, asset.height)

  const piece: BoardPiece = {
    id,
    assetId: asset.id,
    path: asset.path,
    label: asset.label,
    category: asset.category,
    x,
    y,
    width: asset.width,
    height: asset.height,
    rotation: input.rotation ?? 0,
    placedBy: input.placedBy === undefined ? input.playerId : input.placedBy,
    ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
  }

  // Map tiles go under everything else, or they would cover the pieces on them
  const onTop = asset.category !== 'tile' && asset.category !== 'civtile'
  const pieces = onTop ? [...state.board.pieces, piece] : [piece, ...state.board.pieces]

  return record(input, {
    state: withId,
    pieces,
    change: { kind: 'place', piece, onTop },
    description: `placed ${piece.label} at ${locationOf(state.board, areas, piece)}`,
  })
}

// ---------------------------------------------------------------------------
// Moving
// ---------------------------------------------------------------------------

export interface MovePieceInput {
  readonly playerId: string
  readonly pieceId: string
  readonly x: number
  readonly y: number
  /**
   * Set to `false` to move the piece to exactly `x`/`y`, bypassing the map-tile
   * "snap to nearest slot" snap below. Left out (or set to anything else) keeps
   * today's map-tile snapping, so every existing caller is unaffected.
   *
   * Used by the keyboard arrow-key nudge (issue #193): a nudge should move the
   * piece by exactly the requested step, not be re-snapped to the nearest map
   * tile the way a mouse drop is.
   */
  readonly snap?: boolean
  readonly at?: string
}

/**
 * Moves a piece. Ordinary pieces come to the top, while map tiles remain in
 * the bottom tile stratum so they cannot cover pieces placed on them.
 */
export function movePiece(state: GameState, input: MovePieceInput): ActionResult {
  const denied = requireAccess(state, input.playerId)
  if (denied !== undefined) return err(denied)

  const before = state.board.pieces.find((piece) => piece.id === input.pieceId)
  const moved = movePieceUnchecked(state, input)
  if (moved === undefined) {
    return err({ kind: 'BOARD_PIECE_NOT_FOUND', pieceId: input.pieceId })
  }
  // Only a marker that arrives on a square replaces what is there: a nudge or a re-drop on its own square leaves it alone
  const from = before === undefined ? null : mapCellOf(state.board, before)
  return ok(replaceUnderGreatPerson(announceStartPlayer(state, moved, input.pieceId), input.pieceId, input, from))
}

/**
 * The same as `movePiece`, but without the access check and without a Result.
 * Used by the engine itself when a rule moves a piece, such as the start player
 * marker at the start of a turn; the caller has checked access.
 *
 * Returns `undefined` when the piece does not exist.
 */
export function movePieceUnchecked(
  state: GameState,
  input: MovePieceInput,
): GameState | undefined {
  const fromIndex = state.board.pieces.findIndex((piece) => piece.id === input.pieceId)
  const piece = state.board.pieces[fromIndex]
  if (piece === undefined) return undefined

  const areas = areasFor(state)
  const others = state.board.pieces.filter((other) => other.id !== piece.id)
  const wanted = (() => {
    // Culture-track markers are placed freely, not snapped to a space: they fall
    // through to the raw-drop case below, so the player decides the exact spot
    // (see decisions.md, 2026-09-17). The step is still read off the position
    // for the log by `cultureStepOf`.

    // The keyboard nudge (issue #193) opts out of snapping: it wants the piece
    // to move by exactly the requested amount, not be re-snapped to the nearest
    // map tile the way a mouse drop is.
    if (input.snap === false) return { x: input.x, y: input.y }

    // Dropped on the map: a 4 x 4 tile snaps to the nearest playable slot, the
    // same as placement does. The hole and the outside of a stepped board have
    // no slot, so a tile dropped there keeps its raw coordinates. Ordinary
    // pieces keep their raw drop coordinates too, in a player area as on the map,
    // so the player can arrange the area freely (issue #100).
    if (piece.category === 'tile' || piece.category === 'civtile') {
      const mapOrigin = nearestSlotOrigin(state.board, input.x, input.y)
      if (mapOrigin !== undefined) {
        return { x: mapOrigin[0], y: mapOrigin[1] }
      }
    }
    return { x: input.x, y: input.y }
  })()

  const [x, y] = clampToBoard(state.board, wanted.x, wanted.y, piece.width, piece.height)
  const moved: BoardPiece = { ...piece, x, y }
  // Map tiles must remain beneath cities, buildings and other pieces even
  // after they are moved. Ordinary pieces come to the top when picked up.
  const pieces = piece.category === 'tile' || piece.category === 'civtile'
    ? [moved, ...others]
    : [...others, moved]

  const from = locationOf(state.board, areas, piece)
  const to = locationOf(state.board, areas, moved)

  return record(input, {
    state,
    pieces,
    change: {
      kind: 'move',
      pieceId: piece.id,
      from: { x: piece.x, y: piece.y },
      to: { x, y },
      fromIndex,
    },
    description:
      from === to
        ? `nudged ${piece.label} in ${to}`
        : `moved ${piece.label} from ${from} to ${to}`,
  })
}

/**
 * A Great Person placed on a building, a wonder or another Great Person replaces it (base rules
 * p. 18, as described on p. 17; the human chose this over covering it). The old piece is taken off
 * as the board history entry after the move, so the board Undo gives it back one step at a time: a
 * building or wonder is removed (a wonder is destroyed for good), another Great Person is held in
 * reserve, which is the player's own area (it has no effect off the map). Only on a square in the
 * outskirts of a city of the player who placed it, and never another player's wonder: a drag that
 * ends anywhere else is the plain move it was before. `from` is the map square a moved marker came
 * from, `null` for a marker that was just placed or came from off the map: a marker that stays on
 * its square (a nudge, a drop in the same place) replaces nothing, so a building left beside a
 * marker on purpose is not removed by straightening it.
 */
function replaceUnderGreatPerson(
  state: GameState,
  personId: string,
  input: { readonly playerId: string; readonly at?: string },
  from: { readonly column: number; readonly row: number } | null,
): GameState {
  const person = state.board.pieces.find((piece) => piece.id === personId)
  if (person === undefined) return state
  const player = findPlayer(state, input.playerId)
  const colour = player?.color?.toLowerCase()
  const cell = mapCellOf(state.board, person)
  if (player === undefined || colour === undefined || cell === null) return state
  if (from !== null && from.column === cell.column && from.row === cell.row) return state

  const area = playerAreas(state.board, state.players).find((candidate) => candidate.playerId === input.playerId)
  let next = state
  for (const old of piecesReplacedByGreatPerson(state, { playerId: input.playerId, colour }, person)) {
    if (old.category === 'greatperson') {
      // Held in reserve: back in the player's own area, tidied into the next free slot
      if (area === undefined) continue
      const [slotX, slotY] = nextFreeSlot(next.board, area, next.board.pieces, {
        x: area.x + 20,
        y: area.y + AREA_LABEL_HEIGHT + 10,
      })
      const reserved = movePieceUnchecked(next, {
        playerId: input.playerId,
        pieceId: old.id,
        x: slotX,
        y: slotY,
        ...(input.at === undefined ? {} : { at: input.at }),
      })
      if (reserved !== undefined) next = reserved
      continue
    }
    const index = next.board.pieces.findIndex((piece) => piece.id === old.id)
    next = record(input, {
      state: next,
      pieces: next.board.pieces.filter((piece) => piece.id !== old.id),
      change: { kind: 'remove', piece: old, index },
      description: `removed ${old.label} from ${locationOf(next.board, areasFor(next), old)}, replaced by ${person.label}`,
    })
  }
  return next
}

/**
 * The pieces a Great Person standing where `person` is would replace (base rules p. 18): the
 * buildings, wonders and Great People on that map square, when it is in the outskirts of a city of
 * the mover's colour; never another player's wonder, and nothing when `person` is not a Great
 * Person or is off the map. Pure and read-only, so the web asks the same question before it sends a
 * drop that would destroy a wonder.
 */
export function piecesReplacedByGreatPerson(
  state: Pick<GameState, 'board' | 'players'>,
  mover: { readonly playerId: string; readonly colour: string },
  person: BoardPiece,
): readonly BoardPiece[] {
  if (person.category !== 'greatperson') return []
  const cell = mapCellOf(state.board, person)
  if (cell === null) return []
  const inOwnOutskirts = cityFootprintsOf(state, mover.colour).some((footprint) =>
    footprint.outskirts.some((candidate) => candidate.column === cell.column && candidate.row === cell.row),
  )
  if (!inOwnOutskirts) return []
  return state.board.pieces.filter((piece) => {
    if (piece.id === person.id) return false
    if (piece.category !== 'building' && piece.category !== 'wonder' && piece.category !== 'greatperson') return false
    if (piece.category === 'wonder' && piece.ownerId !== undefined && piece.ownerId !== null && piece.ownerId !== mover.playerId) return false
    const at = mapCellOf(state.board, piece)
    return at !== null && at.column === cell.column && at.row === cell.row
  })
}

/**
 * The start player is whoever's area holds the marker, so a manual move can
 * change it. Says so in the public log and remembers it as the last known start
 * player, for when the marker is later left outside every area. Nothing at all
 * when another piece moved.
 */
function announceStartPlayer(before: GameState, after: GameState, pieceId: string): GameState {
  if (after.board.pieces.find((piece) => piece.id === pieceId)?.assetId !== START_PLAYER_ID) {
    return after
  }
  const now = startPlayerOf(after)
  if (now === undefined || now.playerId === startPlayerOf(before)?.playerId) return after

  const logged = appendLog(
    { ...after, startPlayerId: now.playerId },
    { username: 'System', publicLog: `${now.username} is now the start player` },
  )
  // The move was recorded before this line existed: count the line in, so
  // stepping back through the history keeps it with the move.
  const last = logged.board.history.at(-1)
  if (last === undefined) return logged
  return {
    ...logged,
    board: {
      ...logged.board,
      history: [...logged.board.history.slice(0, -1), { ...last, logLength: logged.log.length }],
    },
  }
}

/**
 * Puts the start player marker in a player's area: moves the one on the board,
 * or places one when the board has none. A board history entry either way, so
 * it can be undone, made in the name of `actorId`. The caller has checked
 * access, so this uses the unchecked helpers.
 */
export function placeStartMarker(
  state: GameState,
  target: Playerhand,
  actorId: string,
  at: string | undefined,
): GameState {
  const area = playerAreas(state.board, state.players).find(
    (candidate) => candidate.playerId === target.playerId,
  )
  const asset = findBoardAsset(START_PLAYER_ID)
  if (area === undefined || asset === undefined) return state

  // Dropped by its centre, so it lands in this area whatever the area's width
  const centre = {
    x: area.x + (area.width - asset.width) / 2,
    y: area.y + (area.height - asset.height) / 2,
  }
  const stamp = at === undefined ? {} : { at }
  const marker = startMarkerOf(state)?.piece
  // A marker already on the board is moved through the unchecked move, which no
  // longer tidies a player area, so pick its free slot here as a new one would be.
  const [x, y] = marker === undefined
    ? [centre.x, centre.y]
    : nextFreeSlot(
        state.board,
        area,
        state.board.pieces.filter((candidate) => candidate.id !== marker.id),
        centre,
      )
  const placed =
    marker === undefined
      ? placeUnchecked(state, { playerId: actorId, assetId: START_PLAYER_ID, x, y, ...stamp })
      : movePieceUnchecked(state, { playerId: actorId, pieceId: marker.id, x, y, ...stamp })
  return placed ?? state
}

// ---------------------------------------------------------------------------
// Stacking and turning
// ---------------------------------------------------------------------------

export interface PieceInput {
  readonly playerId: string
  readonly pieceId: string
  readonly at?: string
}

function reorder(state: GameState, input: PieceInput, toTop: boolean): ActionResult {
  const denied = requireAccess(state, input.playerId)
  if (denied !== undefined) return err(denied)

  const fromIndex = state.board.pieces.findIndex((piece) => piece.id === input.pieceId)
  const piece = state.board.pieces[fromIndex]
  if (piece === undefined) {
    return err({ kind: 'BOARD_PIECE_NOT_FOUND', pieceId: input.pieceId })
  }

  const rest = state.board.pieces.filter((other) => other.id !== piece.id)
  const tiles = rest.filter((other) => other.category === 'tile' || other.category === 'civtile')
  const ordinary = rest.filter((other) => other.category !== 'tile' && other.category !== 'civtile')
  const isTile = piece.category === 'tile' || piece.category === 'civtile'
  const pieces = isTile
    ? (toTop ? [...tiles, piece, ...ordinary] : [piece, ...tiles, ...ordinary])
    : (toTop ? [...tiles, ...ordinary, piece] : [...tiles, piece, ...ordinary])

  return ok(
    record(input, {
      state,
      pieces,
      change: { kind: 'reorder', pieceId: piece.id, fromIndex, toTop },
      description: `sent ${piece.label} to the ${toTop ? 'front' : 'back'}`,
    }),
  )
}

/** Moves an ordinary piece to the top of its stratum. */
export const bringToFront = (state: GameState, input: PieceInput): ActionResult =>
  reorder(state, input, true)

/** Moves an ordinary piece to the bottom of its stratum, below other pieces. */
export const sendToBack = (state: GameState, input: PieceInput): ActionResult =>
  reorder(state, input, false)

export interface RotatePieceInput extends PieceInput {
  /** Leave out to turn a quarter step clockwise. */
  readonly rotation?: Rotation
}

/**
 * Turns a piece. Map tiles carry an arrow showing which way the tile goes, and
 * a drawn tile may need any of the four directions.
 */
export function rotatePiece(state: GameState, input: RotatePieceInput): ActionResult {
  const denied = requireAccess(state, input.playerId)
  if (denied !== undefined) return err(denied)

  const piece = findPiece(state.board, input.pieceId)
  if (piece === undefined) return err({ kind: 'BOARD_PIECE_NOT_FOUND', pieceId: input.pieceId })

  const rotation = input.rotation ?? nextRotation(piece.rotation)
  const pieces = state.board.pieces.map((other) =>
    other.id === piece.id ? { ...other, rotation } : other,
  )

  return ok(
    record(input, {
      state,
      pieces,
      change: { kind: 'rotate', pieceId: piece.id, from: piece.rotation, to: rotation },
      description: `turned ${piece.label} to ${rotation} degrees`,
    }),
  )
}

/** Assigns or clears ownership of a wonder. Ownership changes are replayable and undoable. */
export function setWonderOwner(
  state: GameState,
  input: PieceInput & { readonly ownerId: string | null; readonly disable?: boolean },
): ActionResult {
  const denied = requireAccess(state, input.playerId)
  if (denied !== undefined) return err(denied)
  const piece = findPiece(state.board, input.pieceId)
  if (piece === undefined) return err({ kind: 'BOARD_PIECE_NOT_FOUND', pieceId: input.pieceId })
  if (piece.category !== 'wonder') return err({ kind: 'BOARD_PIECE_NOT_FOUND', pieceId: input.pieceId })
  const owner = input.ownerId === null ? undefined : findPlayer(state, input.ownerId)
  if (input.ownerId !== null && owner === undefined) {
    return err({ kind: 'UNKNOWN_WONDER_OWNER', playerId: input.ownerId })
  }
  const from = piece.ownerId ?? null
  const wasDisabled = piece.disabled === true
  // Disabling clears the owner and marks the wonder; assigning an owner switches it back on.
  const nowDisabled = input.disable === true ? true : input.ownerId !== null ? false : wasDisabled
  const pieces = state.board.pieces.map((other) =>
    other.id === piece.id ? { ...other, ownerId: input.ownerId, ...(nowDisabled || wasDisabled ? { disabled: nowDisabled } : {}) } : other,
  )
  return ok(record(input, {
    state,
    pieces,
    change: {
      kind: 'owner',
      pieceId: piece.id,
      from,
      to: input.ownerId,
      ...(wasDisabled === nowDisabled ? {} : { disabled: { from: wasDisabled, to: nowDisabled } }),
    },
    description: input.disable === true
      ? `disabled ${piece.label}`
      : input.ownerId === null
      ? `cleared the owner of ${piece.label}`
      : `assigned ${piece.label} to ${owner?.username ?? input.ownerId}`,
  }))
}

/** Edits the coin tokens physically stored on a Panama Canal wonder. */
export function setWonderCoinTokens(
  state: GameState,
  input: PieceInput & { readonly value: number },
): ActionResult {
  const denied = requireAccess(state, input.playerId)
  if (denied !== undefined) return err(denied)
  if (!Number.isInteger(input.value) || input.value < 0) {
    return err({ kind: 'INVALID_COIN_VALUE', value: input.value, max: null })
  }
  const piece = findPiece(state.board, input.pieceId)
  if (piece === undefined || piece.category !== 'wonder' || piece.assetId !== 'wonders/panamacanal') {
    return err({ kind: 'BOARD_PIECE_NOT_FOUND', pieceId: input.pieceId })
  }
  const from = piece.coinTokens ?? 0
  if (from === input.value) return ok(state)
  const pieces = state.board.pieces.map((other) =>
    other.id === piece.id ? { ...other, coinTokens: input.value } : other,
  )
  return ok(record(input, {
    state,
    pieces,
    change: { kind: 'wonderCoins', pieceId: piece.id, from, to: input.value },
    description: `set the Panama Canal's coin tokens to ${input.value}`,
  }))
}

/**
 * Sets, or with `null` removes, the production a player typed in for a city. A
 * typed number wins over the estimate (`cityProductionsOf`), because the map data
 * does not hold every icon. Any player in the game may do it, like other board
 * edits, and it is undone and replayed like them. Setting the value a city
 * already has changes nothing and is not recorded.
 */
export function setCityProductionOverride(
  state: GameState,
  input: PieceInput & { readonly value: number | null },
): ActionResult {
  const denied = requireAccess(state, input.playerId)
  if (denied !== undefined) return err(denied)
  if (
    input.value !== null &&
    (!Number.isInteger(input.value) || input.value < 0 || input.value > MAX_PRODUCTION_OVERRIDE)
  ) {
    return err({ kind: 'INVALID_PRODUCTION_OVERRIDE', value: input.value })
  }
  const piece = findPiece(state.board, input.pieceId)
  if (piece === undefined) return err({ kind: 'BOARD_PIECE_NOT_FOUND', pieceId: input.pieceId })
  if (piece.category !== 'city') return err({ kind: 'PIECE_NOT_A_CITY', pieceId: input.pieceId })
  const from = piece.productionOverride ?? null
  if (from === input.value) return ok(state)
  const change: BoardChange = { kind: 'productionOverride', pieceId: piece.id, from, to: input.value }
  const to = input.value
  return ok(record(input, {
    state,
    pieces: applyChange(state.board.pieces, change),
    change,
    description: to === null
      ? `removed the typed production of ${piece.label} at ${locationOf(state.board, areasFor(state), piece)}`
      : `set the production of ${piece.label} at ${locationOf(state.board, areasFor(state), piece)} to ${to}`,
  }))
}

// ---------------------------------------------------------------------------
// Removing
// ---------------------------------------------------------------------------

export function removePiece(state: GameState, input: PieceInput): ActionResult {
  const denied = requireAccess(state, input.playerId)
  if (denied !== undefined) return err(denied)

  const index = state.board.pieces.findIndex((piece) => piece.id === input.pieceId)
  const piece = state.board.pieces[index]
  if (piece === undefined) {
    return err({ kind: 'BOARD_PIECE_NOT_FOUND', pieceId: input.pieceId })
  }

  return ok(
    record(input, {
      state,
      pieces: state.board.pieces.filter((other) => other.id !== piece.id),
      change: { kind: 'remove', piece, index },
      description: `removed ${piece.label} from ${locationOf(state.board, areasFor(state), piece)}`,
    }),
  )
}

/**
 * Removes a piece on the engine's own account, as an ordinary history entry
 * credited to {@link BOARD_SYSTEM_ACTOR}. `undefined` when the piece is gone.
 */
export function removePieceAsSystem(state: GameState, pieceId: string): GameState | undefined {
  const index = state.board.pieces.findIndex((piece) => piece.id === pieceId)
  const piece = state.board.pieces[index]
  if (piece === undefined) return undefined
  return record(
    { playerId: BOARD_SYSTEM_ACTOR },
    {
      state,
      pieces: state.board.pieces.filter((other) => other.id !== piece.id),
      change: { kind: 'remove', piece, index },
      description: `removed ${piece.label} from ${locationOf(state.board, areasFor(state), piece)}`,
    },
  )
}

/**
 * Turns a piece over to another asset, as one history entry: the city marker to its walled side.
 * The piece keeps its id, its owner data and its centre, so everything that refers to it (a typed
 * production, a build's record) still does. Without the access check and without a Result, like
 * {@link placeUnchecked}: the caller is an engine action that has checked access. `undefined`
 * when the piece or the asset is not there.
 */
export function flipPieceUnchecked(
  state: GameState,
  input: { readonly playerId: string; readonly pieceId: string; readonly assetId: string; readonly at?: string },
): GameState | undefined {
  const piece = state.board.pieces.find((candidate) => candidate.id === input.pieceId)
  const asset = findBoardAsset(input.assetId)
  if (piece === undefined || asset === undefined) return undefined
  const to = {
    assetId: asset.id,
    path: asset.path,
    label: asset.label,
    // The two faces differ by a few pixels, so the centre is kept: the marker stays on its squares
    x: piece.x + piece.width / 2 - asset.width / 2,
    y: piece.y + piece.height / 2 - asset.height / 2,
    width: asset.width,
    height: asset.height,
  }
  const change: BoardChange = { kind: 'flip', pieceId: piece.id, from: faceOf(piece), to }
  return record(input, {
    state,
    pieces: applyChange(state.board.pieces, change),
    change,
    description: `turned ${piece.label} over to ${asset.label} at ${locationOf(state.board, areasFor(state), piece)}`,
  })
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

/**
 * Whether a board history entry is part of an assisted action that is still
 * applied: the removal of the resource piece it spent, the move of the culture
 * marker a culture advance made, the Great Person marker a culture advance put in the
 * player's area, or the building a build placed and the Building Program marker it
 * used up, the marker a Building Program start placed and each building an upgrade
 * removed and placed again, the city a scout founded (and the scout and city-state it
 * took off the map), a harvested token, a coin a wonder was given, and the free
 * advance another action holds. That change belongs to the action, so only the undo vote on the
 * action's log line may take it back; the board's own Undo would return it and keep
 * what the action gave (or take the marker and keep the card). Once the action is
 * undone the old history entry is an ordinary one again.
 *
 * Reads the records directly instead of importing `assisted.ts`, which imports
 * this file.
 */
function isAssistedBoardChange(state: GameState, entry: BoardHistoryEntry): boolean {
  const { change } = entry
  return state.assistedActions.some((record) => {
    if (record.status !== 'applied') return false
    const effect = record.effect
    // A build placed a building or a figure and used up the Building Program marker: neither can be taken back alone.
    // A unit placed nothing, so only a marker is on the board; City Walls only turned the city marker over.
    if (effect.kind === 'build') {
      return (
        ('historyId' in effect && effect.historyId === entry.id) ||
        // A wonder also became the player's: that entry belongs to the build too
        ('wonder' in effect && effect.wonder?.ownerHistoryId === entry.id) ||
        // and so did the wonder it drew into the market: its card is out of the deck
        ('drawn' in effect && effect.drawn?.historyId === entry.id) ||
        // a building or wonder it replaced was taken off the board, a Great Person it replaced was put in the player's area, and the city marker City Walls turned over
        ('replaced' in effect && effect.replaced?.historyId === entry.id) ||
        ('reserved' in effect && effect.reserved?.historyId === entry.id) ||
        ('walls' in effect && effect.walls.historyId === entry.id) ||
        effect.marker?.historyId === entry.id
      )
    }
    // Khalid moved the start player marker: stepping that back alone would undo only half the card
    if (effect.kind === 'playCard' && effect.starter?.historyId === entry.id) return true
    // Starting a Building Program placed one marker; an upgrade removed and placed one building per flip
    if (effect.kind === 'startBuildingProgram') return effect.historyId === entry.id
    // A harvest put one resource token in the player's area
    if (effect.kind === 'harvest') return effect.historyId === entry.id
    if (effect.kind === 'upgradeBuildings') {
      return effect.flipped.some((flip) => flip.removedHistoryId === entry.id || flip.placedHistoryId === entry.id)
    }
    // A city took the scout off the map, put the city (and the destroyed city-state) on it: all one action
    if (effect.kind === 'foundCity') {
      if ([effect.figureHistoryId, effect.historyId, effect.cityState?.historyId].includes(entry.id)) return true
    }
    // The token a Feudalism harvest put in the player's area, and the coin a wonder was given
    if (effect.kind === 'feudalismHarvest' || effect.kind === 'sotCoin') {
      if (effect.historyId === entry.id) return true
    }
    // A culture advance, or the free one another action holds (Romans, Arabs, Sydney Opera House)
    const advance = effect.kind === 'cultureAdvance' ? effect : 'advance' in effect ? effect.advance : null
    if (advance !== null && advance !== undefined) {
      if (change.kind === 'place' && advance.marker?.pieceId === change.piece.id) return true
      if (change.kind === 'move' && advance.historyId === entry.id) return true
    }
    return (
      change.kind === 'remove' &&
      'spent' in effect &&
      effect.spent !== null &&
      effect.spent.kind === 'piece' &&
      effect.spent.piece.id === change.piece.id
    )
  })
}

/**
 * Takes back the board's last change, but only the player's own.
 *
 * Everyone may move everything on this shared board, but Undo is scoped to
 * whoever made the change: it only fires when the caller's own action is
 * still the most recent one, so one player's Undo can never revert another
 * player's move (issue #174). Undoing repeatedly walks back through a
 * player's own consecutive changes; it stops as soon as it reaches an entry
 * made by someone else.
 *
 * The entry moves onto `redo` rather than being dropped, so a single Redo can
 * bring it straight back.
 */
export function undoLastBoardChange(state: GameState, playerId: string): ActionResult {
  const denied = requireAccess(state, playerId)
  if (denied !== undefined) return err(denied)

  const last = state.board.history.at(-1)
  if (last === undefined || boardUndoBlocked(state.board)) {
    return err({ kind: 'NOTHING_TO_UNDO_ON_BOARD' })
  }
  if (last.playerId !== playerId) return err({ kind: 'BOARD_UNDO_NOT_YOURS' })
  if (isAssistedBoardChange(state, last)) return err({ kind: 'BOARD_UNDO_ASSISTED' })

  return ok(
    withBoard(state, {
      ...state.board,
      pieces: revertChange(state.board.pieces, last.change),
      history: state.board.history.slice(0, -1),
      redo: [...state.board.redo, last],
    }),
  )
}

/**
 * Brings back the single most recently undone change.
 *
 * Left open to any player with access, not only whoever undid it — the same
 * "everyone may move everything" philosophy as the rest of the board. Any new
 * change clears this stack (see `record`), so a redo is only ever offered
 * right after an undo, before anyone has acted since.
 */
export function redoLastBoardChange(state: GameState, playerId: string): ActionResult {
  const denied = requireAccess(state, playerId)
  if (denied !== undefined) return err(denied)

  const last = state.board.redo.at(-1)
  if (last === undefined) return err({ kind: 'NOTHING_TO_REDO_ON_BOARD' })

  return ok(
    withBoard(state, {
      ...state.board,
      pieces: applyChange(state.board.pieces, last.change),
      // Re-appended at the tail of history, so its logLength is refreshed to
      // now rather than kept from when it first happened — a non-board action
      // (a card draw, say) may have grown the log while it sat on the redo
      // stack, and a stale, smaller value here would break the invariant that
      // logLength never decreases along history, which replay relies on.
      history: [...state.board.history, { ...last, logLength: state.log.length }],
      redo: state.board.redo.slice(0, -1),
    }),
  )
}

/** Helper for the server: the players an area layout is built from. */
export function areaPlayers(state: GameState): readonly Playerhand[] {
  return state.players
}
