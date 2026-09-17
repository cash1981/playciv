/**
 * Port of `no.asgari.civilization.server.action.DrawAction`.
 *
 * Everything is a pure function: `(state, action) => Result<GameState, EngineError>`.
 * Java mutated the pbf object and wrote to Mongo as it went; here new state is
 * returned, and errors are values rather than `WebApplicationException`.
 */

import {
  areaSlotRegion,
  firstFreeBlock,
  tileAssetIdForNumber,
  wonderAssetId,
  wondersArea,
} from '../board.js'
import type { EngineError } from '../errors.js'
import type { Item } from '../item.js'
import { isTradable, isUnit, revealAll, revealPublic } from '../item.js'
import {
  appendItemLog,
  appendPrivateLog,
  appendPrivatePublicLog,
  appendPublicLog,
  appendShuffleLog,
} from '../log.js'
import { shuffle } from '../random.js'
import type { Result } from '../result.js'
import { err, ok } from '../result.js'

import { placeUnchecked } from './board.js'
import type { SheetName } from '../sheet-name.js'
import { SHEET_LABEL, SHUFFLABLE_ITEMS, TECHS } from '../sheet-name.js'
import type { GameState, Playerhand } from '../state.js'
import { findPlayer, withPlayer } from '../state.js'

type DrawResult = Result<GameState, EngineError>

function requirePlayer(
  state: GameState,
  playerId: string,
): Result<Playerhand, EngineError> {
  const player = findPlayer(state, playerId)
  if (player === undefined) return err({ kind: 'PLAYER_NOT_FOUND', playerId })
  return ok(player)
}

/** Java: `BaseAction.checkYourTurn`. */
function requireYourTurn(player: Playerhand): Result<Playerhand, EngineError> {
  if (!player.yourTurn) return err({ kind: 'NOT_YOUR_TURN', playerId: player.playerId })
  return ok(player)
}

export interface DrawInput {
  readonly playerId: string
  readonly sheetName: SheetName
}

/**
 * Java: `DrawAction.draw`.
 *
 * Takes the first item of the given type off the deck, puts it in the player's
 * hand, and logs it. If the deck has none of that type left it is reshuffled
 * from `discardedItems` and the draw is tried once more.
 */
export function draw(state: GameState, input: DrawInput): DrawResult {
  const found = requirePlayer(state, input.playerId)
  if (!found.ok) return found
  const turn = requireYourTurn(found.value)
  if (!turn.ok) return turn
  const player = turn.value

  // Java logged a warning and returned Optional.empty() here
  if (TECHS.has(input.sheetName)) {
    return err({ kind: 'TECHS_ARE_CHOSEN_NOT_DRAWN', sheetName: input.sheetName })
  }

  const index = state.items.findIndex((item) => item.sheetName === input.sheetName)
  if (index >= 0) {
    return ok(takeFromDeck(state, player, index))
  }

  // The deck has none of this type. Java reshuffled and called draw() again.
  const reshuffled = reshuffleItems(state, input.sheetName)
  if (!reshuffled.ok) return reshuffled

  const retryIndex = reshuffled.value.items.findIndex(
    (item) => item.sheetName === input.sheetName,
  )
  if (retryIndex < 0) {
    // Cannot happen: reshuffle fails when it finds nothing to put back
    return err({ kind: 'ITEM_NOT_FOUND', sheetName: input.sheetName })
  }
  return ok(takeFromDeck(reshuffled.value, player, retryIndex))
}

/**
 * Moves the item at `index` from the deck into the player's hand and logs the
 * draw. Java set `hidden = true` in `createDraw` — items come out of
 * ItemReader hidden already, so it is only a confirmation.
 */
function takeFromDeck(state: GameState, player: Playerhand, index: number): GameState {
  const item = state.items[index] as Item
  const drawn: Item = { ...item, ownerId: player.playerId, hidden: true }

  const withDeck: GameState = {
    ...state,
    items: [...state.items.slice(0, index), ...state.items.slice(index + 1)],
  }
  const withHand = withPlayer(withDeck, {
    ...player,
    items: [...player.items, drawn],
  })

  const logged = appendItemLog(withHand, 'ITEM', player.username, player.playerId, drawn)
  return drawn.kind === 'tile' ? placeExploredTile(logged, player.playerId, drawn) : logged
}

/**
 * A drawn exploration tile lands on the board straight away.
 *
 * The system does not know which area the player is exploring, so the tile ends
 * up in the first free 4 x 4 slot and is dragged and turned into place from
 * there. That is a convenience, not a game rule.
 */
function placeExploredTile(state: GameState, playerId: string, tile: Item): GameState {
  if (tile.kind !== 'tile') return state
  // Tile cards are named "1" to "27"; the images are tile01, tile15a, Tile26b …
  const assetId = tileAssetIdForNumber(Number(tile.name))
  if (assetId === undefined) return state

  const [x, y] = firstFreeBlock(state.board)
  return placeUnchecked(state, { playerId, assetId, x, y }) ?? state
}

/**
 * Draws a wonder off the deck onto the board instead of into a hand.
 *
 * The old system, and this engine until now, put drawn wonders in the player's
 * hidden hand. The owner asked for them to sit on the board instead: the wonder
 * is taken off the deck, placed as a piece in the shared Wonders area (where it
 * tidies into the next free slot), and named in a public log line. Wonders are
 * public information once on the board, so nothing is added to any hand and the
 * hand projection is unchanged.
 *
 * This is the low-level placement, without a turn check — the start-of-game
 * reveal flow calls it directly, and reveal does not run on a player's turn.
 * The manual draw route goes through {@link drawWonder}, which checks the turn
 * first. It never reshuffles, because wonders are not shuffleable.
 */
export function drawWonderToBoard(
  state: GameState,
  playerId: string,
  sheetName: SheetName,
): DrawResult {
  const found = requirePlayer(state, playerId)
  if (!found.ok) return found
  const player = found.value

  const index = state.items.findIndex((item) => item.sheetName === sheetName)
  const item = state.items[index]
  if (item === undefined || item.kind !== 'wonder') {
    return err({ kind: 'NO_MORE_ITEMS', what: SHEET_LABEL[sheetName] })
  }

  const withDeck: GameState = {
    ...state,
    items: [...state.items.slice(0, index), ...state.items.slice(index + 1)],
  }

  const assetId = wonderAssetId(item.name)
  const region = areaSlotRegion(wondersArea(withDeck.board))
  const next = placeUnchecked(withDeck, { playerId, assetId, x: region.x, y: region.y })
  // The wonder is off the deck now; if its art is missing there is nowhere to
  // put it, so fail rather than silently drop it and log a placement that did
  // not happen.
  if (next === undefined) {
    return err({ kind: 'BOARD_ASSET_NOT_FOUND', assetId })
  }

  return ok(
    appendPublicLog(
      next,
      player.username,
      playerId,
      `drew ${item.name} and placed it in the Wonders area`,
    ),
  )
}

/**
 * A manual wonder draw from the draw menu. Like every other draw it requires
 * the caller to have the turn; it then places the wonder on the board through
 * {@link drawWonderToBoard} rather than into the hand. The start-of-game reveal
 * flow does not use this — it is not on anyone's turn — and calls
 * `drawWonderToBoard` directly.
 */
export function drawWonder(state: GameState, input: DrawInput): DrawResult {
  const found = requirePlayer(state, input.playerId)
  if (!found.ok) return found
  const turn = requireYourTurn(found.value)
  if (!turn.ok) return turn
  return drawWonderToBoard(state, input.playerId, input.sheetName)
}

/**
 * Java: `DrawAction.reshuffleItems`.
 *
 * Note what this does NOT do: it takes nothing back from the players' hands.
 * Only `discardedItems` go back into the deck. `ItemReader.redrawableItems` was
 * built to do that but was never used anywhere in old-civ-rest. Types outside
 * SHUFFLABLE_ITEMS — huts, villages, tiles, city-states and wonders — cannot be
 * reshuffled at all, and give NOT_SHUFFLABLE.
 */
export function reshuffleItems(state: GameState, sheetName: SheetName): DrawResult {
  if (!SHUFFLABLE_ITEMS.has(sheetName)) {
    return err({ kind: 'NOT_SHUFFLABLE', sheetName })
  }

  const toPutBack = state.discardedItems.filter((item) => item.sheetName === sheetName)
  if (toPutBack.length === 0) {
    return err({ kind: 'NO_MORE_ITEMS', what: SHEET_LABEL[sheetName] })
  }
  const toKeep = state.discardedItems.filter((item) => item.sheetName !== sheetName)

  const [shuffled, rng] = shuffle(toPutBack, state.rng)
  const next: GameState = {
    ...state,
    rng,
    items: [...state.items, ...shuffled],
    discardedItems: toKeep,
  }

  return ok(appendShuffleLog(next, SHEET_LABEL[sheetName]))
}

// ---------------------------------------------------------------------------
// Battlehand
// ---------------------------------------------------------------------------

export interface BattlehandInput {
  readonly playerId: string
  readonly numberOfDraws: number
}

/**
 * Java: `DrawAction.drawUnitsFromBattlehandForBattle`.
 *
 * Empties the battlehand, picks up to `numberOfDraws` random units from the
 * hand and puts them in it. If the player has fewer units than asked for, all
 * of them are used.
 */
export function drawUnitsForBattle(state: GameState, input: BattlehandInput): DrawResult {
  const found = requirePlayer(state, input.playerId)
  if (!found.ok) return found
  const player = found.value

  const unitsInHand = player.items.filter(isUnit)

  if (unitsInHand.length === 0) {
    return ok(withPlayer(state, { ...player, battlehand: [] }))
  }

  if (unitsInHand.length <= input.numberOfDraws) {
    const next = withPlayer(state, { ...player, battlehand: unitsInHand })
    // Java wrote "units his battlehand" here and "units from his battlehand"
    // below. The typo is kept because the logs are comparable data.
    return ok(
      appendPublicLog(
        next,
        player.username,
        player.playerId,
        `has drawn ${unitsInHand.length} units his battlehand`,
      ),
    )
  }

  const [shuffled, rng] = shuffle(unitsInHand, state.rng)
  const drawn = shuffled.slice(0, input.numberOfDraws)
  const next = withPlayer({ ...state, rng }, { ...player, battlehand: drawn })

  return ok(
    appendPublicLog(
      next,
      player.username,
      player.playerId,
      `has drawn ${drawn.length} units from his battlehand`,
    ),
  )
}

/**
 * Java: `DrawAction.revealAndDiscardBattlehand`.
 *
 * The name overstates it: units are not discarded to `discardedItems`, the
 * battlehand is only emptied. The units are still in the hand.
 */
export function revealAndDiscardBattlehand(
  state: GameState,
  playerId: string,
): DrawResult {
  const found = requirePlayer(state, playerId)
  if (!found.ok) return found
  const player = found.value

  if (player.battlehand.length === 0) return ok(state)

  const revealed = player.battlehand.map(revealAll).join(', ')
  const next = withPlayer(state, { ...player, battlehand: [] })

  return ok(
    appendPublicLog(
      next,
      player.username,
      player.playerId,
      ` reveals ${revealed} from their battlehand`,
    ),
  )
}

/** Java: `DrawAction.endBattle` — clears `inBattle` on every unit in hand. */
export function endBattle(state: GameState, playerId: string): DrawResult {
  const found = requirePlayer(state, playerId)
  if (!found.ok) return found
  const player = found.value

  return ok(
    withPlayer(state, {
      ...player,
      items: player.items.map((item) =>
        isUnit(item) ? { ...item, inBattle: false } : item,
      ),
    }),
  )
}

// ---------------------------------------------------------------------------
// Barbarians
// ---------------------------------------------------------------------------

/** The order Java drew barbarians in, and the types it falls back on. */
const BARBARIAN_ORDER: readonly {
  readonly sheet: SheetName
  readonly fallbacks: readonly SheetName[]
}[] = [
  { sheet: 'INFANTRY', fallbacks: ['ARTILLERY', 'MOUNTED'] },
  { sheet: 'ARTILLERY', fallbacks: ['MOUNTED', 'INFANTRY'] },
  { sheet: 'MOUNTED', fallbacks: ['ARTILLERY', 'INFANTRY'] },
]

/**
 * Java: `DrawAction.drawBarbarians` — draws up to three barbarian units, one
 * of each type. If a type is empty a reshuffle is tried; failing that, another
 * type is drawn instead, in the order Java used.
 */
export function drawBarbarians(state: GameState, playerId: string): DrawResult {
  const found = requirePlayer(state, playerId)
  if (!found.ok) return found

  if (found.value.barbarians.length > 0) {
    return err({ kind: 'BARBARIANS_NOT_DISCARDED', playerId })
  }

  let current = state
  for (const { sheet, fallbacks } of BARBARIAN_ORDER) {
    const drawn = drawOneBarbarian(current, playerId, sheet, fallbacks)
    if (!drawn.ok) return drawn
    current = drawn.value
  }

  const player = findPlayer(current, playerId)
  if (player === undefined) return err({ kind: 'PLAYER_NOT_FOUND', playerId })

  return ok(
    appendPrivatePublicLog(
      current,
      player.username,
      playerId,
      `has drawn ${player.barbarians.length} barbarian units`,
    ),
  )
}

function drawOneBarbarian(
  state: GameState,
  playerId: string,
  sheet: SheetName,
  fallbacks: readonly SheetName[],
): DrawResult {
  const direct = addBarbarian(state, playerId, sheet)
  if (direct !== null) return ok(direct)

  const reshuffled = reshuffleItems(state, sheet)
  if (reshuffled.ok) {
    const afterReshuffle = addBarbarian(reshuffled.value, playerId, sheet)
    if (afterReshuffle !== null) return ok(afterReshuffle)
  }

  // Java: when there was nothing to reshuffle, it tried another unit type
  for (const fallback of fallbacks) {
    const substituted = addBarbarian(state, playerId, fallback)
    if (substituted !== null) {
      const player = findPlayer(substituted, playerId)
      if (player === undefined) return err({ kind: 'PLAYER_NOT_FOUND', playerId })
      return ok(
        appendPrivatePublicLog(
          substituted,
          player.username,
          playerId,
          ` tried to draw ${SHEET_LABEL[sheet]} barbarian unit. However there are no more in the deck. Will instead draw ${SHEET_LABEL[fallback]} unit instead!`,
        ),
      )
    }
  }

  return err({ kind: 'NO_MORE_ITEMS', what: 'units' })
}

/** Java: `DrawAction.addBarbarian`. Returns null when the deck is empty. */
function addBarbarian(
  state: GameState,
  playerId: string,
  sheet: SheetName,
): GameState | null {
  const index = state.items.findIndex((item) => item.sheetName === sheet)
  if (index < 0) return null

  const item = state.items[index] as Item
  if (!isUnit(item)) return null

  const player = findPlayer(state, playerId)
  if (player === undefined) return null

  const withDeck: GameState = {
    ...state,
    items: [...state.items.slice(0, index), ...state.items.slice(index + 1)],
  }
  return withPlayer(withDeck, {
    ...player,
    barbarians: [...player.barbarians, { ...item, ownerId: playerId }],
  })
}

/**
 * Java: `DrawAction.discardBarbarians` — puts the barbarians in
 * `discardedItems`, clears their owner and reveals them publicly.
 */
export function discardBarbarians(state: GameState, playerId: string): DrawResult {
  const found = requirePlayer(state, playerId)
  if (!found.ok) return found
  const player = found.value

  if (player.barbarians.length === 0) return ok(state)

  const discarded = player.barbarians.map((unit) => ({ ...unit, ownerId: null }))
  const revealed = player.barbarians.map(revealAll).join(', ')

  const next: GameState = {
    ...withPlayer(state, { ...player, barbarians: [] }),
    discardedItems: [...state.discardedItems, ...discarded],
  }

  return ok(
    appendPublicLog(
      next,
      player.username,
      player.playerId,
      ` reveals ${revealed} as barbarians`,
    ),
  )
}

// ---------------------------------------------------------------------------
// Loot
// ---------------------------------------------------------------------------

export interface LootInput {
  /** The player it is taken from. */
  readonly playerId: string
  /** The player receiving it. */
  readonly targetPlayerId: string
  readonly sheetNames: ReadonlySet<SheetName>
}

/**
 * Java: `DrawAction.loot` — takes a random item of a given type from one
 * player's hand and gives it to another.
 *
 * Java checked that the item is `Tradable` on element 0 of the UNSHUFFLED list
 * and only shuffled afterwards. That is kept: in practice every item of the
 * same sheet type is equally tradable, so the check is homogeneous anyway.
 */
export function loot(state: GameState, input: LootInput): DrawResult {
  const from = requirePlayer(state, input.playerId)
  if (!from.ok) return from
  const to = requirePlayer(state, input.targetPlayerId)
  if (!to.ok) return to

  const playerFrom = from.value
  const playerTo = to.value

  const candidates = playerFrom.items.filter((item) => input.sheetNames.has(item.sheetName))
  if (candidates.length === 0) {
    return err({ kind: 'NOTHING_TO_LOOT', playerId: input.playerId })
  }

  const first = candidates[0] as Item
  if (!isTradable(first)) {
    return err({ kind: 'ITEM_NOT_LOOTABLE', itemId: first.id })
  }

  const [shuffled, rng] = shuffle(candidates, state.rng)
  const itemToGive = shuffled[0] as Item

  let next: GameState = { ...state, rng }
  next = withPlayer(next, {
    ...playerFrom,
    items: playerFrom.items.filter((item) => item.id !== itemToGive.id),
  })
  const updatedTo = findPlayer(next, input.targetPlayerId) as Playerhand
  next = withPlayer(next, {
    ...updatedTo,
    items: [...updatedTo.items, { ...itemToGive, ownerId: playerTo.playerId }],
  })

  const all = revealAll(itemToGive)
  const pub = revealPublic(itemToGive)

  next = appendPrivateLog(
    next,
    playerFrom.username,
    playerFrom.playerId,
    ` is randomly looted ${all} and gives to ${playerTo.username}`,
  )
  next = appendPrivateLog(
    next,
    playerTo.username,
    playerTo.playerId,
    ` receives as loot ${all} from ${playerFrom.username}`,
  )
  next = appendPublicLog(
    next,
    playerFrom.username,
    playerFrom.playerId,
    ` is randomly looted ${pub} and gives to ${playerTo.username}`,
  )
  next = appendPublicLog(
    next,
    playerTo.username,
    playerTo.playerId,
    ` receives as loot ${pub} from ${playerFrom.username}`,
  )

  return ok(next)
}
