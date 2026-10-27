/**
 * Assisted actions: things the game does for a player instead of asking them to
 * edit counters and move pieces by hand.
 *
 * New in this port, no old-system equivalent. Every action is one entry in
 * {@link ASSISTED_ACTIONS}: what decides whether it can be pressed
 * (`availability`), what pressing it does (`apply`) and how to take it back
 * (`reverse`). The server route, the projection and the undo vote all go
 * through the registry, so the rules are written once.
 *
 * What an action did is recorded in `GameState.assistedActions`, keyed on the
 * client's `requestId`. A repeated `requestId` changes nothing, and the once
 * per turn limit is the usage key on the player's `PlayerTurn.usedActions`.
 *
 * Import cycle, on purpose: `state.ts` builds the projection from this file, this
 * file removes board pieces through `actions/board.ts`, and that file uses
 * `state.ts` again. It is safe because this file imports only types from
 * `state.ts` (erased at build time) and uses nothing from `actions/board.ts` or
 * `state.ts` while the module loads, only inside functions that run later. A
 * top-level use of a `state.ts` value here, or a top-level call into
 * `actions/board.ts`, would run before the cycle has finished loading and throw
 * on an uninitialised binding. Keep it that way: no value imports from
 * `state.ts`, and nothing computed at load time from the board actions. The
 * same goes for `build-options.ts`, which this file calls and which calls
 * `openCityManagementTurn` back.
 */

import { flipPieceUnchecked, movePieceUnchecked, placeUnchecked, removePiece, setWonderOwner } from './actions/board.js'
import { drawWonderToBoard } from './actions/draw.js'
import {
  PHASE_REASON,
  READY,
  REPEAT_NOTE,
  blocked,
  earlierCityActions,
  freeTurnAction,
  lastLogId,
  openCityManagementTurn,
  placeBack,
  playerOf,
  rejected,
  techBlock,
  useTurnAction,
  usedReason,
  withPlayerHand,
} from './assisted-core.js'
import { playCard } from './assisted-cards.js'
import { findResourceToken, returnResource, spendResource } from './assisted-resources.js'
import { CITY_ACTIONS } from './assisted-city.js'
import { ABILITY_ACTIONS } from './assisted-abilities.js'
import { SOT_ACTIONS } from './assisted-sot.js'
import {
  chooseReward,
  countLinesIn,
  cultureAdvance,
  cultureAdvanceSkip,
  drawCandidates,
  ownAreaOf,
  shuffleSheetTwice,
} from './assisted-culture.js'
import type {
  AssistedActionDefinition,
  AssistedAvailability,
  AssistedPayload,
  DevoteToTheArtsPayload,
  HarvestPayload,
  StartBuildingProgramPayload,
  UpgradeBuildingsPayload,
} from './assisted-core.js'
import { blockadedPieceIds, cityFootprintsOf, mapCellOf } from './blockade.js'
import {
  AREA_LABEL_HEIGHT,
  areaAt,
  areaSlotRegion,
  boardAreas,
  findBoardAsset,
  isInWondersArea,
  nextFreeSlot,
  playerAreas,
  wondersArea,
} from './board.js'
import type { Board, BoardPiece, PieceFace } from './board.js'
import { sameBuildItem } from './build-item.js'
import type { PlacedBuildItem, UnitType } from './build-item.js'
import {
  buildItemName,
  buildOptionsOf,
  buildSquareRefusal,
  figureAssetIdOf,
  marketWondersOf,
  squareCentre,
  squareLabel,
  unitSheetOf,
  walledAssetIdOf,
} from './build-options.js'
import type { BuildPayload, BuildSquare } from './build-options.js'
import {
  buildingProgramMarkerOf,
  cityActionsOf,
  describeUpgrades,
  ownCityFootprint,
  upgradePlanOf,
} from './city-actions.js'
import { BUILDING_UPGRADES, buildingNameOf } from './building-data.js'
import { WONDERS_IN_ERA, WONDERS_PER_ERA, WONDER_ERAS } from './wonder-data.js'
import type { WonderEra } from './wonder-data.js'
import { BUILDING_PROGRAM_ASSET_ID } from './city-production.js'
import { activeWonderOwnerIds, coinSourcesOf, findCoinSource, withCoinSource } from './coins.js'
import type { EngineError } from './errors.js'
import { MAX_DEVOTE_CULTURE } from './limits.js'
import { itemName } from './item.js'
import type { Item } from './item.js'
import { appendLog } from './log.js'
import type { Result } from './result.js'
import { err, ok } from './result.js'
import { SHEET_LABEL } from './sheet-name.js'
import { RESOURCE_KINDS } from './tile-icons.js'
import type { ResourceKind } from './tile-icons.js'
import type { SheetName } from './sheet-name.js'
import type {
  AssistedActionKind,
  AssistedActionRecord,
  AssistedEffect,
  AvailableAction,
  CultureCardKind,
  DrawnWonder,
  GameLogEntry,
  GameState,
  Playerhand,
  PlayerStats,
  PublicAssistedAction,
} from './state.js'
import { turnStatus } from './turn.js'
import type { PlayerTurn, TurnPhase } from './turn.js'

// The helpers moved to `assisted-resources.ts` and `assisted-core.ts`; they stay importable from here
export { findResourceToken, spendResource }
export type { SpendOutcome } from './assisted-resources.js'
export { PHASE_REASON, cityActionsTakenThisTurn } from './assisted-core.js'
export type { AssistedPayload } from './assisted-core.js'

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------


// -- Incense cards: Chivalry, Currency, Metal Casting -----------------------

/**
 * The cards that read "Incense, City Management: gain N culture". One row each,
 * and one definition built from it, so a fourth card of the kind is a table
 * entry and not a copy of the code. Each card has its own usage key, so Currency
 * and Chivalry can both be used in the same turn, each once, each spending its
 * own Incense.
 */
interface ResourceCultureCard {
  readonly kind: CultureCardKind
  readonly techName: string
  readonly resource: string
  readonly culture: number
}

const RESOURCE_CULTURE_CARDS: readonly ResourceCultureCard[] = [
  { kind: 'chivalry', techName: 'Chivalry', resource: 'Incense', culture: 5 },
  { kind: 'currency', techName: 'Currency', resource: 'Incense', culture: 3 },
  { kind: 'metalCasting', techName: 'Metal Casting', resource: 'Incense', culture: 7 },
]

function resourceCultureCard(card: ResourceCultureCard): AssistedActionDefinition {
  const usageKey = `card:${card.techName}`
  return {
    kind: card.kind,
    techName: card.techName,
    label: card.techName,
    button: true,
    usageKey,
    phase: 'CM',
    group: 'Resource abilities',

    availability(state, playerId) {
      const player = playerOf(state, playerId)
      if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
      const tech = techBlock(player, card.techName)
      if (tech !== undefined) return tech
      const turn = openCityManagementTurn(state, player)
      if (turn === undefined) return blocked('wrong-phase', PHASE_REASON)
      if (turn.usedActions.includes(usageKey)) {
        return blocked('used', usedReason(card.techName))
      }
      if (findResourceToken(state, playerId, card.resource) === undefined) {
        return blocked(
          'needs-resource',
          `You need an ${card.resource} token: an ${card.resource} hut in your hand or an ${card.resource} piece in your player area.`,
        )
      }
      return READY
    },

    apply(state, player, context) {
      const turn = openCityManagementTurn(state, player)
      const spend = spendResource(state, player.playerId, card.resource, context.at)
      if (turn === undefined || !spend.ok) {
        return err(
          rejected(
            card.kind,
            blocked('needs-resource', `You need an ${card.resource} token to use ${card.techName}.`),
          ),
        )
      }
      const afterSpend = spend.value.state
      const paying = playerOf(afterSpend, player.playerId) ?? player
      const stats = { ...paying.stats, culture: paying.stats.culture + card.culture }
      const used = useTurnAction(afterSpend, paying, turn, usageKey, stats)
      const logged = appendLog(used, {
        username: player.username,
        playerId: player.playerId,
        publicLog:
          `${player.username} used ${card.techName}: spent 1 ${card.resource} and gained ${card.culture} culture` +
          (context.confirmedRepeat ? REPEAT_NOTE : ''),
        privateLog: '',
        createdAt: context.at ?? null,
        assistedActionId: context.requestId,
      })
      return ok({
        state: logged,
        effect: { kind: card.kind, culture: card.culture, spent: spend.value.spent },
        logId: lastLogId(logged),
      })
    },

    reverse(state, player, record, at) {
      const effect = record.effect
      if (effect.kind !== card.kind) return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
      const stats = { ...player.stats, culture: Math.max(0, player.stats.culture - effect.culture) }
      const returned = returnResource(
        withPlayerHand(state, { ...player, stats }),
        { ...player, stats },
        effect.spent,
        at,
      )
      if (!returned.ok) return returned
      return ok({
        state: returned.value,
        text: `${player.username}'s ${card.techName} was undone: ${effect.culture} culture removed and the ${effect.spent.resource} token returned`,
      })
    },
  }
}

// -- Democracy and Printing Press -------------------------------------------

type CoinPurchaseSource = 'democracy' | 'printingPress'
type CoinPurchaseRejection = Extract<
  EngineError,
  { kind: 'COIN_PURCHASE_REJECTED' }
>['reason']
/** What can stop a purchase once the tech is known to be revealed. */
type OpenPurchaseRejection = Exclude<CoinPurchaseRejection, 'TECH_NOT_REVEALED'>

interface CoinPurchaseTerms {
  readonly techName: string
  readonly resource: 'trade' | 'culture'
  readonly cost: number
  readonly paidWith: string
}

const COIN_PURCHASES: Readonly<Record<CoinPurchaseSource, CoinPurchaseTerms>> = {
  democracy: { techName: 'Democracy', resource: 'trade', cost: 6, paidWith: '6 trade' },
  printingPress: { techName: 'Printing Press', resource: 'culture', cost: 5, paidWith: '5 culture' },
}

const coinUsageKey = (source: CoinPurchaseSource): string => `coin-purchase:${source}`

interface CoinPurchasePlan {
  readonly turn: PlayerTurn
  readonly current: number
}

/**
 * Whether the purchase can go ahead, in the order `purchaseCoin` always checked
 * it. The reasons are its existing ones, so its route and its tests are
 * untouched; the registry maps the same reasons to availability statuses.
 */
function planCoinPurchase(
  state: GameState,
  player: Playerhand,
  source: CoinPurchaseSource,
  allowRepeat = false,
): Result<CoinPurchasePlan, CoinPurchaseRejection> {
  const terms = COIN_PURCHASES[source]
  if (!player.techsChosen.some((tech) => tech.name === terms.techName && !tech.hidden)) {
    return err('TECH_NOT_REVEALED')
  }
  return planOpenCoinPurchase(state, player, source, allowRepeat)
}

/**
 * The checks after the tech is known to be revealed. Split out so the
 * availability, which has already handled an unrevealed tech with its own
 * wording, matches on reasons that can actually occur.
 */
function planOpenCoinPurchase(
  state: GameState,
  player: Playerhand,
  source: CoinPurchaseSource,
  allowRepeat = false,
): Result<CoinPurchasePlan, OpenPurchaseRejection> {
  const terms = COIN_PURCHASES[source]
  const turn = openCityManagementTurn(state, player)
  if (turn === undefined) return err('PHASE_CLOSED')
  if (!allowRepeat && turn.usedActions.includes(coinUsageKey(source))) return err('ALREADY_USED')
  if (player.stats[terms.resource] < terms.cost) return err('INSUFFICIENT_RESOURCES')

  const current = coinSourcesOf(state, player)[source]
  const coinSource = findCoinSource(source)
  if (coinSource === undefined) return err('AT_CAPACITY')
  const internetOwners = activeWonderOwnerIds(
    state.board.pieces,
    'wonders/internet',
    blockadedPieceIds(state),
  )
  const max =
    coinSource.max === null ? null : coinSource.max + (internetOwners.has(player.playerId) ? 2 : 0)
  if (max !== null && current >= max) return err('AT_CAPACITY')
  return ok({ turn, current })
}

/**
 * Pays for one Democracy or Printing Press coin. The body `purchaseCoin` had,
 * moved here so the registry and the old route share it. A `requestId` links the
 * log line to an assisted action record; the old route passes none.
 */
export function applyCoinPurchase(
  state: GameState,
  player: Playerhand,
  source: CoinPurchaseSource,
  options: {
    readonly at?: string
    readonly requestId?: string
    /** The player confirmed using it again; only the assisted route passes it. */
    readonly confirmedRepeat?: boolean
  } = {},
): Result<{ readonly state: GameState; readonly logId: string }, EngineError> {
  const terms = COIN_PURCHASES[source]
  const plan = planCoinPurchase(state, player, source, options.confirmedRepeat === true)
  if (!plan.ok) return err({ kind: 'COIN_PURCHASE_REJECTED', source, reason: plan.error })

  const stats: PlayerStats = {
    ...player.stats,
    [terms.resource]: player.stats[terms.resource] - terms.cost,
    coinSources: withCoinSource(player.stats.coinSources, source, plan.value.current + 1),
  }
  const used = useTurnAction(state, player, plan.value.turn, coinUsageKey(source), stats)
  const logged = appendLog(used, {
    username: player.username,
    playerId: player.playerId,
    publicLog:
      `${player.username} spent ${terms.paidWith} to add 1 coin to ${terms.techName}` +
      (options.confirmedRepeat === true ? REPEAT_NOTE : ''),
    privateLog: '',
    createdAt: options.at ?? null,
    ...(options.requestId === undefined ? {} : { assistedActionId: options.requestId }),
  })
  return ok({ state: logged, logId: lastLogId(logged) })
}

function coinPurchase(source: CoinPurchaseSource): AssistedActionDefinition {
  const terms = COIN_PURCHASES[source]
  const definition: AssistedActionDefinition = {
    kind: source,
    techName: terms.techName,
    label: terms.techName,
    button: true,
    usageKey: coinUsageKey(source),
    phase: 'CM',
    group: 'Coins',

    availability(state, playerId) {
      const player = playerOf(state, playerId)
      if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
      const tech = techBlock(player, terms.techName)
      if (tech !== undefined) return tech
      const plan = planOpenCoinPurchase(state, player, source)
      if (plan.ok) {
        return { status: 'ready', reason: `Spend ${terms.paidWith} to add 1 coin to ${terms.techName}.` }
      }
      switch (plan.error) {
        case 'PHASE_CLOSED':
          return blocked('wrong-phase', PHASE_REASON)
        case 'ALREADY_USED':
          return blocked('used', usedReason(terms.techName))
        case 'INSUFFICIENT_RESOURCES':
          return blocked('needs-resource', `You need ${terms.paidWith} for this purchase.`)
        case 'AT_CAPACITY':
          return blocked('unavailable', `${terms.techName} is already at its coin capacity.`)
      }
    },

    apply(state, player, context) {
      const applied = applyCoinPurchase(state, player, source, {
        requestId: context.requestId,
        confirmedRepeat: context.confirmedRepeat,
        ...(context.at === undefined ? {} : { at: context.at }),
      })
      if (!applied.ok) return applied
      return ok({
        state: applied.value.state,
        effect: { kind: 'coinPurchase', source, resource: terms.resource, cost: terms.cost },
        logId: applied.value.logId,
      })
    },

    reverse(state, player, record) {
      const effect = record.effect
      if (effect.kind !== 'coinPurchase') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
      const current = player.stats.coinSources[effect.source]
      const stats: PlayerStats = {
        ...player.stats,
        [effect.resource]: player.stats[effect.resource] + effect.cost,
        coinSources: withCoinSource(player.stats.coinSources, effect.source, Math.max(0, current - 1)),
      }
      return ok({
        state: withPlayerHand(state, { ...player, stats }),
        text: `${player.username}'s ${terms.techName} purchase was undone: ${terms.paidWith} returned and 1 coin removed`,
      })
    },
  }
  return definition
}

// -- Build ---------------------------------------------------------------------

/** "a Library", "an Academy", "an army", "a mounted unit": by the first letter, with "a University" as the exception since it starts with a vowel but is said with a consonant. */
/** Whether a wonder other than `pieceId` sits in the Wonders area at (or on top of) the spot a wonder is to be put back to. */
function marketSpotTaken(board: Board, pieceId: string, spot: { readonly x: number; readonly y: number }): boolean {
  return board.pieces.some(
    (other) =>
      other.id !== pieceId &&
      other.category === 'wonder' &&
      isInWondersArea(board, other) &&
      Math.abs(other.x - spot.x) < other.width / 2 &&
      Math.abs(other.y - spot.y) < other.height / 2,
  )
}

const WONDER_SHEET: Readonly<Record<WonderEra, SheetName>> = {
  Ancient: 'ANCIENT_WONDERS',
  Medieval: 'MEDIEVAL_WONDERS',
  Modern: 'MODERN_WONDERS',
}

/**
 * The deck the next wonder for the market comes from. A game has four wonders of each
 * era: once four ancient wonders are out the medieval ones follow, and after four
 * medieval ones the modern. "Out" is a card that has left the deck (the nine of an era
 * less what is still in it), wherever it went: the market, an owner, the map, Egypt's own
 * area or a hand. Counted from the deck, so a wonder piece taken off the board does not
 * make room for another. An era with no card left in the deck is skipped. `undefined` when
 * twelve wonders are out or the deck has none of the eras that are still open.
 */
function nextWonderSheet(state: GameState): SheetName | undefined {
  return WONDER_ERAS.map((era) => WONDER_SHEET[era]).find((sheet, index) => {
    const left = state.items.filter((item) => item.sheetName === sheet).length
    return left > 0 && WONDERS_IN_ERA[WONDER_ERAS[index] as WonderEra] - left < WONDERS_PER_ERA
  })
}

/**
 * The wonder a build drew into the market, when it can no longer be taken back out of it:
 * it was built or owned by somebody, moved out of the Wonders area, or removed.
 */
function drawnWonderGone(state: GameState, drawn: DrawnWonder | undefined): DrawnWonder | undefined {
  if (drawn === undefined) return undefined
  const piece = state.board.pieces.find((candidate) => candidate.id === drawn.pieceId)
  return piece === undefined || !isInWondersArea(state.board, piece) || (piece.ownerId ?? null) !== null ? drawn : undefined
}

/** The card of a wonder that went back, put at the front of its deck again, where the next draw takes it from. */
function wonderBackInDeck(state: GameState, card: Item): GameState {
  const at = state.items.findIndex((item) => item.sheetName === card.sheetName)
  const items = at === -1 ? [...state.items, card] : [...state.items.slice(0, at), card, ...state.items.slice(at)]
  return { ...state, items }
}

/** What a build replaced, as its effect keeps it: a building or wonder that was removed, or a Great Person that was held in reserve. */
interface ReplacedEffect {
  readonly replaced?: { readonly piece: BoardPiece; readonly historyId: string } | undefined
  readonly reserved?: { readonly piece: BoardPiece; readonly historyId: string } | undefined
}

/** ", and the Library it replaced was put back": the part of an undo line about a replaced building, wonder or Great Person. */
function replacedText(effect: ReplacedEffect): string {
  const old = effect.replaced?.piece ?? effect.reserved?.piece
  if (old === undefined) return ''
  const name = old.category === 'building' ? (buildingNameOf(old.assetId) ?? old.label) : old.label
  return `, and ${old.category === 'wonder' ? name.replace(/^The /, 'the ') : `the ${name}`} it replaced was put back`
}

/**
 * Whether the Great Person a build held in reserve can be moved back: it is still on the board and
 * still in its owner's player area. `undefined` when it can, else the sentence that says why not.
 */
function reservedUndoBlock(state: GameState, ownerId: string, effect: ReplacedEffect): string | undefined {
  if (effect.reserved === undefined) return undefined
  const person = state.board.pieces.find((candidate) => candidate.id === effect.reserved?.piece.id)
  const name = effect.reserved.piece.label
  if (person === undefined) return `The ${name} is no longer on the board, so the build cannot be undone.`
  const inArea =
    areaAt(boardAreas(state.board, state.players), person.x + person.width / 2, person.y + person.height / 2)?.playerId === ownerId
  return inArea ? undefined : `The ${name} has left your player area. Move it back first.`
}

/** Puts back what a build replaced: a removed piece exactly as it was, or a Great Person on the square it stood on. */
function putReplacedBack(state: GameState, player: Playerhand, effect: ReplacedEffect, at: string | null): GameState {
  if (effect.replaced !== undefined) return placeBack(state, player, effect.replaced.piece, at)
  if (effect.reserved === undefined) return state
  const back = movePieceUnchecked(state, {
    playerId: player.playerId,
    pieceId: effect.reserved.piece.id,
    x: effect.reserved.piece.x,
    y: effect.reserved.piece.y,
    snap: false,
    ...(at === null ? {} : { at }),
  })
  return back ?? state
}

const withArticle = (label: string): string => `${/^[aeiou]/i.test(label) && !/^uni/i.test(label) ? 'an' : 'a'} ${label}`

/** The `build` payload, or `undefined` when the payload is another action's or missing. */
const buildPayloadOf = (payload: AssistedPayload | undefined): BuildPayload | undefined =>
  payload !== undefined && 'cityPieceId' in payload && 'item' in payload ? payload : undefined

/** What the part of a build that differs between items did: a piece put on a square, or a card drawn into the hand. */
type Made =
  | {
      readonly kind: 'placed'
      readonly state: GameState
      readonly square: { readonly column: number; readonly row: number; readonly label: string }
      readonly piece: BoardPiece
      readonly historyId: string
      /** Only for a wonder, which was moved out of the market: see the `build` effect. */
      readonly wonder?: { readonly from: { readonly x: number; readonly y: number }; readonly ownerHistoryId: string }
    }
  | {
      readonly kind: 'card'
      readonly state: GameState
      readonly card: Item
      readonly sheetName: SheetName
    }
  | {
      /** City Walls: the city marker was turned over to its walled side. */
      readonly kind: 'walls'
      readonly state: GameState
      readonly pieceId: string
      readonly from: PieceFace
      readonly to: PieceFace
      readonly historyId: string
    }

/**
 * Puts a building or a figure centred on its square, through the board history.
 * A building's asset is its own; a figure's is of the player's colour. `Err` is a
 * sentence for the player and nothing is changed.
 */
function placeBuilt(
  state: GameState,
  player: Playerhand,
  item: PlacedBuildItem,
  square: BuildSquare,
  at: { readonly at?: string },
): Result<Made, string> {
  if (item.kind === 'wonder') return placeWonder(state, player, item.assetId, square, at)
  const assetId =
    item.kind === 'building'
      ? item.assetId
      : player.color === null
        ? undefined
        : figureAssetIdOf(player.color.toLowerCase(), item.kind)
  const name = buildItemName(item)
  const asset = assetId === undefined ? undefined : findBoardAsset(assetId)
  if (assetId === undefined || asset === undefined) return err(`The ${name} has no artwork to put on the board.`)

  const centre = squareCentre(state.board, square)
  const placed = placeUnchecked(state, {
    playerId: player.playerId,
    assetId,
    x: centre.x - asset.width / 2,
    y: centre.y - asset.height / 2,
    ...at,
  })
  const entry = placed?.board.history.at(-1)
  if (placed === undefined || entry === undefined || entry.change.kind !== 'place') {
    return err(`The ${name} could not be placed.`)
  }
  const piece = entry.change.piece
  const landed = mapCellOf(placed.board, piece)
  if (landed === null || landed.column !== square.column || landed.row !== square.row) {
    return err(`The ${name} could not be placed on ${square.label}.`)
  }
  return ok({
    kind: 'placed',
    state: placed,
    square: { column: square.column, row: square.row, label: square.label },
    piece,
    historyId: entry.id,
  })
}

/**
 * Takes a wonder out of the market, centred on its square, and makes the player its
 * owner: two board history entries, the move and the owner. The wonder is a piece that
 * is already on the board, in the shared Wonders area, so nothing new is placed. `Err`
 * is a sentence for the player and nothing is changed.
 */
function placeWonder(
  state: GameState,
  player: Playerhand,
  assetId: string,
  square: BuildSquare,
  at: { readonly at?: string },
): Result<Made, string> {
  const name = buildItemName({ kind: 'wonder', assetId })
  const piece = marketWondersOf(state.board, state.board.pieces).find((candidate) => candidate.assetId === assetId)
  if (piece === undefined) return err(`${name} is not in the market.`)

  const centre = squareCentre(state.board, square)
  const moved = movePieceUnchecked(state, {
    playerId: player.playerId,
    pieceId: piece.id,
    x: centre.x - piece.width / 2,
    y: centre.y - piece.height / 2,
    snap: false,
    ...at,
  })
  const placed = moved?.board.pieces.find((candidate) => candidate.id === piece.id)
  const moveEntry = moved?.board.history.at(-1)
  if (moved === undefined || placed === undefined || moveEntry === undefined || moveEntry.change.kind !== 'move') {
    return err(`${name} could not be placed.`)
  }
  const landed = mapCellOf(moved.board, placed)
  if (landed === null || landed.column !== square.column || landed.row !== square.row) {
    return err(`${name} could not be placed on ${square.label}.`)
  }

  const owned = setWonderOwner(moved, { playerId: player.playerId, pieceId: piece.id, ownerId: player.playerId, ...at })
  const ownerEntry = owned.ok ? owned.value.board.history.at(-1) : undefined
  if (!owned.ok || ownerEntry === undefined) return err(`${name} could not be given to you.`)
  return ok({
    kind: 'placed',
    state: owned.value,
    square: { column: square.column, row: square.row, label: square.label },
    piece: placed,
    historyId: moveEntry.id,
    wonder: { from: { x: piece.x, y: piece.y }, ownerHistoryId: ownerEntry.id },
  })
}

/**
 * Takes the building, wonder or Great Person a new piece replaces off its square (base rules p. 17
 * and 18: the old piece goes first, then the new one is placed on the empty square). A building or
 * wonder is removed from the board; a Great Person is held in reserve, which is the player's own
 * area, where it has no effect. The piece is the one standing on the square; `square.replaces` was
 * read from this same state by `buildOptionsOf`. `Err` is a sentence for the player and nothing is
 * changed.
 */
function removeReplaced(
  state: GameState,
  player: Playerhand,
  square: BuildSquare,
  at: { readonly at?: string },
): Result<
  { readonly state: GameState; readonly piece: BoardPiece; readonly historyId: string; readonly reserved: boolean },
  string
> {
  const replaces = square.replaces
  if (replaces === undefined) return err('There is nothing to replace on that square.')
  const old = state.board.pieces.find((piece) => {
    if (piece.category !== 'building' && piece.category !== 'wonder' && piece.category !== 'greatperson') return false
    if (piece.assetId !== replaces.assetId) return false
    const cell = mapCellOf(state.board, piece)
    return cell !== null && cell.column === square.column && cell.row === square.row
  })
  if (old === undefined) return err(`${replaces.label} is no longer on ${square.label}.`)

  if (old.category === 'greatperson') {
    const area = ownAreaOf(state, player.playerId)
    if (area === undefined) return err('You have no player area on the board to hold the Great Person in.')
    const [slotX, slotY] = nextFreeSlot(state.board, area, state.board.pieces, {
      x: area.x + 20,
      y: area.y + AREA_LABEL_HEIGHT + 10,
    })
    const held = movePieceUnchecked(state, {
      playerId: player.playerId,
      pieceId: old.id,
      x: slotX,
      y: slotY,
      ...at,
    })
    const entry = held?.board.history.at(-1)
    if (held === undefined || entry === undefined || entry.change.kind !== 'move') {
      return err(`${replaces.label} on ${square.label} could not be put back in your player area.`)
    }
    return ok({ state: held, piece: old, historyId: entry.id, reserved: true })
  }

  const removed = removePiece(state, { playerId: player.playerId, pieceId: old.id, ...at })
  const entry = removed.ok ? removed.value.board.history.at(-1) : undefined
  if (!removed.ok || entry === undefined) return err(`${replaces.label} on ${square.label} could not be taken off the board.`)
  return ok({ state: removed.value, piece: old, historyId: entry.id, reserved: false })
}

/**
 * Turns a city marker over to its walled side (base rules p. 17), as one board history entry on the
 * same piece. `Err` is a sentence for the player and nothing is changed.
 */
function flipToWalls(
  state: GameState,
  player: Playerhand,
  cityPieceId: string,
  at: { readonly at?: string },
): Result<Made, string> {
  const city = state.board.pieces.find((piece) => piece.id === cityPieceId && piece.category === 'city')
  const walled = city === undefined ? undefined : walledAssetIdOf(city.assetId)
  if (city === undefined) return err('That city is no longer on the board.')
  if (walled === undefined) return err('That city already has City Walls.')
  const flipped = flipPieceUnchecked(state, { playerId: player.playerId, pieceId: city.id, assetId: walled, ...at })
  const entry = flipped?.board.history.at(-1)
  const after = flipped?.board.pieces.find((piece) => piece.id === city.id)
  if (flipped === undefined || entry === undefined || entry.change.kind !== 'flip' || after === undefined) {
    return err('The city marker could not be turned over to its walled side.')
  }
  return ok({ kind: 'walls', state: flipped, pieceId: city.id, from: entry.change.from, to: entry.change.to, historyId: entry.id })
}

/**
 * Draws one card of the unit's sheet into the player's hand, hidden, the way the
 * Draw button does (the discards are reshuffled when the deck has none). Like the
 * Great Person cards it writes no item log line: a line carrying the item would
 * make the old item undo a way to take the card back without the trade and the
 * marker. `Err` is a sentence for the player.
 */
function drawBuiltUnit(state: GameState, player: Playerhand, unitType: UnitType): Result<Made, string> {
  const sheetName = unitSheetOf(unitType)
  const drawn = drawCandidates(state, sheetName, 1)
  const first = drawn.ok ? drawn.value.items[0] : undefined
  if (!drawn.ok || first === undefined) return err(`No ${unitType} unit cards are left in the deck or the discard pile.`)
  const card: Item = { ...first, ownerId: player.playerId, hidden: true }
  const holder = playerOf(drawn.value.state, player.playerId) ?? player
  return ok({
    kind: 'card',
    state: withPlayerHand(drawn.value.state, { ...holder, items: [...holder.items, card] }),
    card,
    sheetName,
  })
}

/**
 * A city builds a building, an army or scout figure, or a military unit.
 * Everything is decided from the fresh state: the options are recomputed for the
 * city and the request must be one of them, so a square taken, a supply used up,
 * trade spent or a phase closed since the player looked is refused with the
 * reason. One step puts the piece on its square or the card in the hand, pays
 * the trade, uses up the Building Program marker and writes the public line; one
 * undo vote takes all of it back. A unit has no square and its public line names
 * the type only, never the card.
 */
const build: AssistedActionDefinition = {
  kind: 'build',
  techName: null,
  label: 'Build',
  button: false,
  usageKey: null,
  phase: 'CM',
  group: 'Cities',

  availability(state, playerId) {
    const player = playerOf(state, playerId)
    if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
    if (openCityManagementTurn(state, player) === undefined) return blocked('wrong-phase', PHASE_REASON)
    if (player.color === null || cityFootprintsOf(state, player.color.toLowerCase()).length === 0) {
      return blocked('unavailable', 'You have no city on the map to build with.')
    }
    return { status: 'ready', reason: 'Choose a city, what to build and where.' }
  },

  apply(state, player, context) {
    const failed = (reason: string): EngineError => rejected('build', blocked('unavailable', reason))
    const payload = buildPayloadOf(context.payload)
    if (payload === undefined) return err(failed('Say which city, what to build and which square.'))
    const { item } = payload
    // The server checks the shape; the engine is also called with whatever a caller sent
    if (!['building', 'wonder', 'army', 'scout', 'unit', 'walls'].includes(item.kind)) {
      return err(failed('That is not something that can be built.'))
    }

    const city = buildOptionsOf(state, player).find((candidate) => candidate.cityPieceId === payload.cityPieceId)
    if (city === undefined) return err(failed('That city is not yours, or it is no longer on the map.'))
    if (city.status !== 'ready') return err(rejected('build', blocked('wrong-phase', city.reason)))

    const label = buildItemName(item)
    const choice = city.choices.find((candidate) => sameBuildItem(candidate.item, item))
    if (choice === undefined) {
      const why = city.unavailable.find((candidate) => sameBuildItem(candidate.item, item))
      return err(
        failed(
          why === undefined
            ? item.kind === 'building'
              ? `${item.assetId} is not a building that can be built.`
              : item.kind === 'wonder'
                ? `${label} is not a wonder that can be built: it is not in the market.`
                : item.kind === 'walls'
                  ? 'City Walls cannot be built.'
                  : `A ${label} cannot be built.`
            : `${why.label} cannot be built in ${city.label} now. ${why.reason}`,
        ),
      )
    }

    // A square is chosen for a building or a figure and for nothing else
    let square: BuildSquare | undefined
    const itemKind = payload.item.kind
    if (itemKind === 'unit' || itemKind === 'walls') {
      if (payload.target !== undefined) {
        return err(
          failed(
            itemKind === 'unit'
              ? `${choice.label} is a card and has no square. Send no square.`
              : `${choice.label} turn the city marker over and have no square. Send no square.`,
          ),
        )
      }
    } else {
      const target = payload.target
      if (target === undefined) return err(failed('Pick one of the highlighted squares.'))
      square = choice.squares.find((candidate) => candidate.column === target.column && candidate.row === target.row)
      if (square === undefined) {
        const why = buildSquareRefusal(state, player, city.cityPieceId, payload.item, target)
        return err(failed(`${why ?? 'That square is not one of the legal squares.'} Pick one of the highlighted squares.`))
      }
    }
    if (choice.tradeToPay > 0 && payload.rush !== true) {
      return err(
        failed(
          `${choice.label} costs ${choice.cost} and ${city.label} has ${city.production}. Confirm paying ${choice.tradeToPay} trade to build it.`,
        ),
      )
    }
    // After everything that makes the build impossible, so that a refusal says what is wrong and the question only comes for a build that would go through
    const again = earlierCityActions(state, player, city, context.confirmedAnotherCityAction)
    if (again.refusal !== undefined) return err(rejected('build', again.refusal))
    const at = context.at === undefined ? {} : { at: context.at }

    // The marker a city with the Building Program must use (Wisdom and Warfare p. 7), found before anything is placed
    const footprint = ownCityFootprint(state, player, city.cityPieceId)
    const marker = footprint === undefined ? undefined : buildingProgramMarkerOf(state, footprint)

    // The one step that differs: a piece on a square, or a card in the hand
    let made: Made
    let replaced: { readonly piece: BoardPiece; readonly historyId: string; readonly reserved: boolean } | undefined
    if (payload.item.kind === 'unit') {
      const drawn = drawBuiltUnit(state, player, payload.item.unitType)
      if (!drawn.ok) return err(failed(drawn.error))
      made = drawn.value
    } else if (payload.item.kind === 'walls') {
      const flipped = flipToWalls(state, player, city.cityPieceId, at)
      if (!flipped.ok) return err(failed(flipped.error))
      made = flipped.value
    } else {
      if (square === undefined) return err(failed('Pick one of the highlighted squares.'))
      // A building or wonder of the player's own on the square is taken off first, then the new piece goes on the empty square
      let base = state
      if (square.replaces !== undefined) {
        const cleared = removeReplaced(state, player, square, at)
        if (!cleared.ok) return err(failed(cleared.error))
        base = cleared.value.state
        replaced = { piece: cleared.value.piece, historyId: cleared.value.historyId, reserved: cleared.value.reserved }
      }
      const placed = placeBuilt(base, player, payload.item, square, at)
      if (!placed.ok) return err(failed(placed.error))
      made = placed.value
    }

    let board = made.state
    let removal: { readonly piece: BoardPiece; readonly historyId: string } | null = null
    if (marker !== undefined) {
      const removed = removePiece(made.state, { playerId: player.playerId, pieceId: marker.id, ...at })
      const removedEntry = removed.ok ? removed.value.board.history.at(-1) : undefined
      if (!removed.ok || removedEntry === undefined) {
        return err(failed('The Building Program marker could not be taken off the board.'))
      }
      board = removed.value
      removal = { piece: marker, historyId: removedEntry.id }
    }

    const paying = playerOf(board, player.playerId) ?? player
    // Michelangelo's discount is one-shot and is used up by this wonder build.
    const wonderDiscount =
      payload.item.kind === 'wonder' ? paying.wonderDiscount : 0
    const paid = withPlayerHand(board, {
      ...paying,
      wonderDiscount: paying.wonderDiscount - wonderDiscount,
      stats: { ...paying.stats, trade: paying.stats.trade - choice.tradeToPay },
    })
    const where =
      made.kind === 'placed'
        ? ` on square ${made.square.label}` +
          (replaced === undefined || square?.replaces === undefined
            ? ''
            : square.replaces.kind === 'wonder'
              ? `, replacing ${square.replaces.label.replace(/^The /, 'the ')}, which is destroyed`
              : square.replaces.kind === 'greatperson'
                ? `, replacing the ${square.replaces.label} (Great Person), which goes back to the player area`
                : `, replacing the ${square.replaces.label}`) +
          (payload.item.kind === 'army' && square?.note !== undefined
            ? ' (an enemy figure is there, so the outcome is to be settled by hand)'
            : '')
        : made.kind === 'walls'
          ? ', turning the city marker over to its walled side'
          : ''
    const logged = appendLog(paid, {
      username: player.username,
      playerId: player.playerId,
      publicLog:
        `${player.username} built ${payload.item.kind === 'wonder' ? label.replace(/^The /, 'the ') : payload.item.kind === 'walls' ? label : withArticle(label)} in ${city.label}${where}` +
        (choice.tradeToPay > 0 ? `, paying ${choice.tradeToPay} trade for the missing production` : '') +
        (removal === null ? '' : ', using up the Building Program marker') +
        again.note,
      privateLog: '',
      createdAt: context.at ?? null,
      assistedActionId: context.requestId,
    })
    const logId = lastLogId(logged)
    // The card is named in a private line only, as the Great Person draw does; the public line has the type
    const withPrivate =
      made.kind === 'card'
        ? appendLog(logged, {
            username: player.username,
            playerId: player.playerId,
            privateLog: `${player.username} drew ${itemName(made.card)} (${SHEET_LABEL[made.sheetName]}) for ${withArticle(label)} built in ${city.label}`,
            createdAt: context.at ?? null,
          })
        : logged
    // The board changes were recorded before the line existed: count it in, as the culture advance does
    const counted = countLinesIn(withPrivate, [
      made.kind === 'placed' ? made.historyId : undefined,
      made.kind === 'placed' ? made.wonder?.ownerHistoryId : undefined,
      made.kind === 'walls' ? made.historyId : undefined,
      replaced?.historyId,
      removal?.historyId,
    ])

    if (made.kind === 'card') {
      if (payload.item.kind !== 'unit') return err(failed('That is not a unit.'))
      return ok({
        state: counted,
        effect: {
          kind: 'build',
          cityPieceId: city.cityPieceId,
          item: payload.item,
          card: {
            itemId: made.card.id,
            sheetName: made.sheetName,
          },
          trade: choice.tradeToPay,
          marker: removal,
        },
        logId,
      })
    }
    if (made.kind === 'walls') {
      if (payload.item.kind !== 'walls') return err(failed('That is not City Walls.'))
      return ok({
        state: counted,
        effect: {
          kind: 'build',
          cityPieceId: city.cityPieceId,
          item: payload.item,
          walls: { pieceId: made.pieceId, from: made.from, to: made.to, historyId: made.historyId },
          trade: choice.tradeToPay,
          marker: removal,
        },
        logId,
      })
    }
    if (payload.item.kind === 'unit' || payload.item.kind === 'walls') return err(failed('That is not put on a square.'))

    // A wonder leaves the market, so the next one is drawn into it (base rules p. 17), from the
    // era the deck is at; the draw's own line follows the build's, and its entry is counted in
    let refilled = counted
    let drawn: DrawnWonder | undefined
    if (payload.item.kind === 'wonder') {
      const sheet = nextWonderSheet(counted)
      const card = sheet === undefined ? undefined : counted.items.find((item) => item.sheetName === sheet)
      const refill = sheet === undefined || card === undefined ? undefined : drawWonderToBoard(counted, player.playerId, sheet, 'system')
      const entry = refill?.ok ? refill.value.board.history.at(-1) : undefined
      if (refill?.ok && card !== undefined && entry !== undefined && entry.change.kind === 'place') {
        refilled = countLinesIn(refill.value, [entry.id])
        drawn = { item: card, pieceId: entry.change.piece.id, historyId: entry.id }
      }
    }
    return ok({
      state: refilled,
      effect: {
        kind: 'build',
        cityPieceId: city.cityPieceId,
        item: payload.item,
        square: made.square,
        pieceId: made.piece.id,
        position: { x: made.piece.x, y: made.piece.y },
        historyId: made.historyId,
        ...(made.wonder === undefined ? {} : { wonder: made.wonder }),
        ...(drawn === undefined ? {} : { drawn }),
        ...(replaced === undefined
          ? {}
          : replaced.reserved
            ? { reserved: { piece: replaced.piece, historyId: replaced.historyId } }
            : { replaced: { piece: replaced.piece, historyId: replaced.historyId } }),
        trade: choice.tradeToPay,
        marker: removal,
        ...(wonderDiscount === 0 ? {} : { wonderDiscount }),
      },
      logId,
    })
  },

  reverse(state, player, record, at, pieceMayHaveMoved = false) {
    const effect = record.effect
    if (effect.kind !== 'build') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    const refused = (reason: string): EngineError => ({
      kind: 'ASSISTED_UNDO_BLOCKED',
      logId: record.logId,
      reason,
    })
    const label = buildItemName(effect.item)
    const refunded: Playerhand = {
      ...player,
      stats: { ...player.stats, trade: player.stats.trade + effect.trade },
    }
    const markerText = effect.marker === null ? '' : ' and the Building Program marker was put back'
    const tradeText = effect.trade > 0 ? `, ${effect.trade} trade returned` : ''

    if ('card' in effect) {
      // Everything is checked before anything is changed, so a refusal leaves the game as it was.
      const found = player.items.find((candidate) => candidate.id === effect.card.itemId)
      if (found === undefined) {
        return err(refused(`The ${label} card is no longer in your hand, so the build cannot be undone.`))
      }
      // The card goes back in its deck and that deck alone is shuffled again, as an item undo does,
      // so nobody knows which card comes next. The other decks keep their order.
      const withoutCard: Playerhand = { ...refunded, items: refunded.items.filter((candidate) => candidate.id !== found.id) }
      const returned: GameState = {
        ...withPlayerHand(state, withoutCard),
        items: [...state.items, { ...found, hidden: true, ownerId: null }],
      }
      const restored = shuffleSheetTwice(returned, effect.card.sheetName)
      const withMarker =
        effect.marker === null ? restored : placeBack(restored, refunded, effect.marker.piece, at)
      return ok({
        state: withMarker,
        text:
          `${player.username}'s ${label} was undone: the card was put back in the deck` +
          tradeText +
          markerText,
      })
    }

    if ('walls' in effect) {
      // The city marker is turned back to its unwalled side, the same piece; a refusal leaves the game as it was
      const city = state.board.pieces.find((candidate) => candidate.id === effect.walls.pieceId)
      if (city === undefined) return err(refused('The city is no longer on the board, so the City Walls cannot be undone.'))
      if (city.assetId !== effect.walls.to.assetId) {
        return err(refused('The city marker is not on its walled side any more, so the City Walls cannot be undone.'))
      }
      const flipped = flipPieceUnchecked(withPlayerHand(state, refunded), {
        playerId: record.playerId,
        pieceId: city.id,
        assetId: effect.walls.from.assetId,
        ...(at === null ? {} : { at }),
      })
      if (flipped === undefined) return err(refused('The city marker could not be turned back.'))
      const withMarker = effect.marker === null ? flipped : placeBack(flipped, refunded, effect.marker.piece, at)
      return ok({
        state: withMarker,
        text:
          `${player.username}'s City Walls were undone: the city marker was turned back to its unwalled side` +
          tradeText +
          markerText,
      })
    }

    // Everything is checked before anything is changed, so a refusal leaves the game as it was.
    const piece = state.board.pieces.find((candidate) => candidate.id === effect.pieceId)
    // A wonder's name already is a name ("The Colossus"): "The Library" and "The army", but not "The The Colossus"
    const subject = effect.item.kind === 'wonder' ? label : `The ${label}`
    if (piece === undefined) {
      return err(refused(`${subject} is no longer on the board, so the build cannot be undone.`))
    }
    const cell = mapCellOf(state.board, piece)
    if (!pieceMayHaveMoved && (cell === null || cell.column !== effect.square.column || cell.row !== effect.square.row)) {
      return err(refused(`${subject} has left ${effect.square.label}. Move it back first.`))
    }

    const reservedBlock = reservedUndoBlock(state, record.playerId, effect)
    if (reservedBlock !== undefined) return err(refused(reservedBlock))

    // A wonder goes back to the market where it stood, and nobody owns it any more. The wonder
    // the build drew into the market goes back in its deck first, if it is still there to take.
    if (effect.wonder !== undefined) {
      const stamp = at === null ? {} : { at }
      const drawn = effect.drawn
      const gone = drawnWonderGone(state, drawn)
      if (gone !== undefined) {
        return err(
          refused(`${itemName(gone.item)} was drawn into the market after this build and is no longer there, so the build cannot be undone.`),
        )
      }
      let base = withPlayerHand(state, refunded)
      if (drawn !== undefined) {
        const cleared = removePiece(base, { playerId: record.playerId, pieceId: drawn.pieceId, ...stamp })
        if (!cleared.ok) return err(refused(`${itemName(drawn.item)} could not be taken out of the market.`))
        base = wonderBackInDeck(cleared.value, drawn.item)
      }
      const unowned = setWonderOwner(base, {
        playerId: record.playerId,
        pieceId: effect.pieceId,
        ownerId: null,
        ...stamp,
      })
      // Where it stood, unless another wonder has been drawn into that spot since: then the next free one
      const spot = marketSpotTaken(base.board, effect.pieceId, effect.wonder.from)
        ? nextFreeSlot(
            base.board,
            wondersArea(base.board),
            base.board.pieces.filter((candidate) => candidate.id !== effect.pieceId),
            effect.wonder.from,
          )
        : [effect.wonder.from.x, effect.wonder.from.y] as const
      const returned = unowned.ok
        ? movePieceUnchecked(unowned.value, {
            playerId: record.playerId,
            pieceId: effect.pieceId,
            x: spot[0],
            y: spot[1],
            snap: false,
            ...stamp,
          })
        : undefined
      if (returned === undefined) return err(refused(`${subject} could not be put back in the market.`))
      // What the wonder replaced stands again, exactly as it was, and then the Building Program marker
      const withOld = putReplacedBack(returned, refunded, effect, at)
      const withMarker = effect.marker === null ? withOld : placeBack(withOld, refunded, effect.marker.piece, at)
      const restoredPlayer = playerOf(withMarker, record.playerId) ?? refunded
      const restored =
        effect.wonderDiscount === undefined
          ? withMarker
          : withPlayerHand(withMarker, {
              ...restoredPlayer,
              wonderDiscount: restoredPlayer.wonderDiscount + effect.wonderDiscount,
            })
      return ok({
        state: restored,
        text:
          `${player.username}'s ${label.replace(/^The /, '')} on ${effect.square.label} was undone: the wonder was put back in the market` +
          (drawn === undefined ? '' : ` and ${itemName(drawn.item)} went back in the deck`) +
          replacedText(effect) +
          tradeText +
          markerText,
      })
    }

    const removed = removePiece(withPlayerHand(state, refunded), {
      playerId: record.playerId,
      pieceId: effect.pieceId,
      ...(at === null ? {} : { at }),
    })
    if (!removed.ok) return err(refused(`The ${label} could not be taken off the board.`))
    const withOld = putReplacedBack(removed.value, refunded, effect, at)
    const raw = effect.marker === null ? withOld : placeBack(withOld, refunded, effect.marker.piece, at)
    const restoredPlayer = playerOf(raw, record.playerId) ?? refunded
    const restored =
      effect.wonderDiscount === undefined
        ? raw
        : withPlayerHand(raw, {
            ...restoredPlayer,
            wonderDiscount: restoredPlayer.wonderDiscount + effect.wonderDiscount,
          })

    return ok({
      state: restored,
      text:
        `${player.username}'s ${label} on ${effect.square.label} was undone: the ${effect.item.kind === 'building' ? 'building' : 'figure'} was removed` +
        replacedText(effect) +
        tradeText +
        markerText,
    })
  },
}

// -- Start a Building Program -----------------------------------------------------

/** The `startBuildingProgram` payload, or `undefined` when the payload is another action's or missing. */
const startPayloadOf = (payload: AssistedPayload | undefined): StartBuildingProgramPayload | undefined =>
  payload !== undefined &&
  'cityPieceId' in payload &&
  typeof payload.cityPieceId === 'string' &&
  !('item' in payload) &&
  !('resource' in payload) &&
  !('scoutPieceId' in payload)
    ? { cityPieceId: payload.cityPieceId }
    : undefined

/**
 * Puts the Building Program marker on a city's centre (Wisdom and Warfare p. 7), so
 * the next build there doubles the outskirts. Free, and a city holds one marker at a
 * time: a marker on either centre of a metropolis counts. The marker goes on the
 * anchor centre square through the board history. The build action uses the marker up
 * and restores it on its undo, so the two undo in either order as long as the marker
 * is back where it was: undoing the start while a build has used the marker up is
 * refused with the vote left open.
 */
const startBuildingProgram: AssistedActionDefinition = {
  kind: 'startBuildingProgram',
  techName: null,
  label: 'Start Building Program',
  button: false,
  usageKey: null,
  phase: 'CM',
  group: 'Cities',

  availability(state, playerId) {
    const player = playerOf(state, playerId)
    if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
    if (openCityManagementTurn(state, player) === undefined) return blocked('wrong-phase', PHASE_REASON)
    if (player.color === null || cityFootprintsOf(state, player.color.toLowerCase()).length === 0) {
      return blocked('unavailable', 'You have no city on the map to start a Building Program in.')
    }
    return { status: 'ready', reason: 'Choose a city.' }
  },

  apply(state, player, context) {
    const failed = (reason: string): EngineError => rejected('startBuildingProgram', blocked('unavailable', reason))
    const payload = startPayloadOf(context.payload)
    if (payload === undefined) return err(failed('Say which city.'))

    const city = cityActionsOf(state, player).find((candidate) => candidate.cityPieceId === payload.cityPieceId)
    const footprint = ownCityFootprint(state, player, payload.cityPieceId)
    const anchor = footprint?.centers[0]
    if (city === undefined || anchor === undefined) return err(failed('That city is not yours, or it is no longer on the map.'))
    const option = city.startBuildingProgram
    if (option.status === 'wrong-phase') return err(rejected('startBuildingProgram', blocked('wrong-phase', option.reason)))
    if (option.status !== 'ready') return err(failed(`${city.label}: ${option.reason}`))
    const again = earlierCityActions(state, player, city, context.confirmedAnotherCityAction)
    if (again.refusal !== undefined) return err(rejected('startBuildingProgram', again.refusal))

    const asset = findBoardAsset(BUILDING_PROGRAM_ASSET_ID)
    if (asset === undefined) return err(failed('The Building Program marker has no artwork to put on the board.'))
    const centre = squareCentre(state.board, anchor)
    const at = context.at === undefined ? {} : { at: context.at }
    const placed = placeUnchecked(state, {
      playerId: player.playerId,
      assetId: BUILDING_PROGRAM_ASSET_ID,
      x: centre.x - asset.width / 2,
      y: centre.y - asset.height / 2,
      ...at,
    })
    const entry = placed?.board.history.at(-1)
    if (placed === undefined || entry === undefined || entry.change.kind !== 'place') {
      return err(failed('The Building Program marker could not be placed.'))
    }
    const piece = entry.change.piece
    const landed = mapCellOf(placed.board, piece)
    if (landed === null || landed.column !== anchor.column || landed.row !== anchor.row) {
      return err(failed(`The Building Program marker could not be placed on the centre of ${city.label}.`))
    }

    const logged = appendLog(placed, {
      username: player.username,
      playerId: player.playerId,
      publicLog: `${player.username} started a Building Program in ${city.label}${again.note}`,
      privateLog: '',
      createdAt: context.at ?? null,
      assistedActionId: context.requestId,
    })
    return ok({
      state: countLinesIn(logged, [entry.id]),
      effect: {
        kind: 'startBuildingProgram',
        cityPieceId: city.cityPieceId,
        cityLabel: city.label,
        square: { column: anchor.column, row: anchor.row, label: squareLabel(anchor) },
        pieceId: piece.id,
        position: { x: piece.x, y: piece.y },
        historyId: entry.id,
      },
      logId: lastLogId(logged),
    })
  },

  reverse(state, player, record, at, pieceMayHaveMoved = false) {
    const effect = record.effect
    if (effect.kind !== 'startBuildingProgram') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    const refused = (reason: string): EngineError => ({
      kind: 'ASSISTED_UNDO_BLOCKED',
      logId: record.logId,
      reason,
    })
    // Everything is checked before anything is changed, so a refusal leaves the game as it was.
    const piece = state.board.pieces.find((candidate) => candidate.id === effect.pieceId)
    if (piece === undefined) {
      return err(
        refused(
          `The Building Program marker of ${effect.cityLabel} is no longer on the board (a build may have used it up), so this cannot be undone.`,
        ),
      )
    }
    const cell = mapCellOf(state.board, piece)
    if (!pieceMayHaveMoved && (cell === null || cell.column !== effect.square.column || cell.row !== effect.square.row)) {
      return err(refused(`The Building Program marker has left the centre of ${effect.cityLabel}. Move it back first.`))
    }
    const removed = removePiece(state, {
      playerId: record.playerId,
      pieceId: effect.pieceId,
      ...(at === null ? {} : { at }),
    })
    if (!removed.ok) return err(refused('The Building Program marker could not be taken off the board.'))
    return ok({
      state: removed.value,
      text: `${player.username}'s Building Program in ${effect.cityLabel} was undone: the marker was removed`,
    })
  },
}

// -- Devote to the Arts -------------------------------------------------------------

/** The `devoteToTheArts` payload, or `undefined` when the payload is another action's or missing. */
const devotePayloadOf = (payload: AssistedPayload | undefined): DevoteToTheArtsPayload | undefined =>
  payload !== undefined && 'cityPieceId' in payload && !('item' in payload) && !('resource' in payload) && !('scoutPieceId' in payload)
    ? (payload as DevoteToTheArtsPayload)
    : undefined

/** "B3", "B3 and C4", "B3, C4 and D5". */
const listLabels = (labels: readonly string[]): string =>
  labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1) ?? ''}`

/**
 * A city's action: take one culture token (two for a metropolis) plus one for each culture
 * icon in its outskirts (base rules p. 17), here the sum `cityGatheringOf` reads off the
 * board and the building table, plus the squares of the scouts the player sends to the city.
 * The player may type another number when the estimate misses something it cannot see (a
 * wonder, a card), as with the production figure: the log then says so. A city takes one
 * action a turn: a second one is refused until the player confirms (`earlierCityActions`). The culture goes to the
 * stock (`stats.culture`) and an undo takes it off again unless it has been spent.
 */
const devoteToTheArts: AssistedActionDefinition = {
  kind: 'devoteToTheArts',
  techName: null,
  label: 'Devote to the Arts',
  button: false,
  usageKey: null,
  phase: 'CM',
  group: 'Cities',

  availability(state, playerId) {
    const player = playerOf(state, playerId)
    if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
    if (openCityManagementTurn(state, player) === undefined) return blocked('wrong-phase', PHASE_REASON)
    if (cityActionsOf(state, player).length === 0) {
      return blocked('unavailable', 'You have no city on the map to devote to the arts.')
    }
    return { status: 'ready', reason: 'Choose a city.' }
  },

  apply(state, player, context) {
    const failed = (reason: string): EngineError => rejected('devoteToTheArts', blocked('unavailable', reason))
    const payload = devotePayloadOf(context.payload)
    if (payload === undefined) return err(failed('Say which city.'))

    const city = cityActionsOf(state, player).find((candidate) => candidate.cityPieceId === payload.cityPieceId)
    if (city === undefined) return err(failed('That city is not yours, or it is no longer on the map.'))
    const option = city.devoteToTheArts
    if (option.status === 'wrong-phase') return err(rejected('devoteToTheArts', blocked('wrong-phase', option.reason)))

    // The server checks the shape; the engine is also called with whatever a caller sent
    const scoutIds: unknown = payload.scoutPieceIds ?? []
    if (!Array.isArray(scoutIds) || scoutIds.some((id) => typeof id !== 'string') || new Set(scoutIds).size !== scoutIds.length) {
      return err(failed('scoutPieceIds must be a list of different scout ids.'))
    }
    const scouts = (scoutIds as readonly string[]).map((id) => option.scouts.find((scout) => scout.pieceId === id))
    const chosen = scouts.flatMap((scout) => (scout === undefined ? [] : [scout]))
    if (chosen.length !== scouts.length) {
      return err(failed(`A scout is not yours, stands inside ${city.label} or is on a square with no culture.`))
    }
    const typed: unknown = payload.culture
    if (typed !== undefined && (typeof typed !== 'number' || !Number.isInteger(typed) || typed < 0 || typed > MAX_DEVOTE_CULTURE)) {
      return err(failed(`culture must be a whole number from 0 to ${MAX_DEVOTE_CULTURE}.`))
    }
    const again = earlierCityActions(state, player, city, context.confirmedAnotherCityAction)
    if (again.refusal !== undefined) return err(rejected('devoteToTheArts', again.refusal))
    const estimate = option.culture + chosen.reduce((total, scout) => total + scout.culture, 0)
    const culture = typeof typed === 'number' ? typed : estimate

    const stats = { ...player.stats, culture: player.stats.culture + culture }
    const scoutText = chosen.length === 0 ? '' : `, with the squares of the scouts at ${listLabels(chosen.map((scout) => scout.square))}`
    const handText = culture === estimate ? '' : ` (set by the player; the estimate was ${estimate})`
    const logged = appendLog(withPlayerHand(state, { ...player, stats }), {
      username: player.username,
      playerId: player.playerId,
      publicLog: `${player.username} devoted ${city.label} to the arts and gained ${culture} culture${scoutText}${handText}${again.note}`,
      privateLog: '',
      createdAt: context.at ?? null,
      assistedActionId: context.requestId,
    })
    return ok({
      state: logged,
      effect: { kind: 'devoteToTheArts', cityPieceId: city.cityPieceId, cityLabel: city.label, culture },
      logId: lastLogId(logged),
    })
  },

  reverse(state, player, record) {
    const effect = record.effect
    if (effect.kind !== 'devoteToTheArts') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    if (player.stats.culture < effect.culture) {
      return err({
        kind: 'ASSISTED_UNDO_BLOCKED',
        logId: record.logId,
        reason: `Only ${player.stats.culture} culture is left, so the ${effect.culture} culture from ${effect.cityLabel} cannot be taken back. It has been spent, or the counter was changed by hand.`,
      })
    }
    const stats = { ...player.stats, culture: player.stats.culture - effect.culture }
    return ok({
      state: withPlayerHand(state, { ...player, stats }),
      text: `${player.username}'s devotion of ${effect.cityLabel} to the arts was undone: ${effect.culture} culture removed`,
    })
  },
}

// -- Harvest a resource -------------------------------------------------------------

/** The `harvest` payload, or `undefined` when the payload is another action's or missing. */
const harvestPayloadOf = (payload: AssistedPayload | undefined): HarvestPayload | undefined =>
  payload !== undefined && 'cityPieceId' in payload && 'resource' in payload && !('item' in payload) ? payload : undefined

/**
 * A city's action: take one resource token of a kind whose icon is in its outskirts, or on the
 * square of a scout the player sends to it, from the market to the player's area (base rules
 * p. 18). One token per action; the market holds as many of a kind as there are players, up to
 * five, and the pieces on the board are what is gone. The token is a board piece put in the
 * player's own area, which is where a resource is paid from. A city takes one action a turn (a
 * second is refused until the player confirms), and the game does not stop the same icon from
 * being harvested twice in a turn. An undo takes the token
 * away again, unless it has been spent.
 */
const harvest: AssistedActionDefinition = {
  kind: 'harvest',
  techName: null,
  label: 'Harvest a resource',
  button: false,
  usageKey: null,
  phase: 'CM',
  group: 'Cities',

  availability(state, playerId) {
    const player = playerOf(state, playerId)
    if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
    if (openCityManagementTurn(state, player) === undefined) return blocked('wrong-phase', PHASE_REASON)
    if (cityActionsOf(state, player).length === 0) {
      return blocked('unavailable', 'You have no city on the map to harvest with.')
    }
    return { status: 'ready', reason: 'Choose a city.' }
  },

  apply(state, player, context) {
    const failed = (reason: string): EngineError => rejected('harvest', blocked('unavailable', reason))
    const payload = harvestPayloadOf(context.payload)
    if (payload === undefined) return err(failed('Say which city and which resource.'))
    const resource: unknown = payload.resource
    if (typeof resource !== 'string' || !RESOURCE_KINDS.includes(resource as ResourceKind)) {
      return err(failed(`resource must be one of ${RESOURCE_KINDS.join(', ')}.`))
    }
    const scoutPieceId: unknown = payload.scoutPieceId
    if (scoutPieceId !== undefined && typeof scoutPieceId !== 'string') return err(failed('scoutPieceId must be a scout id.'))

    const city = cityActionsOf(state, player).find((candidate) => candidate.cityPieceId === payload.cityPieceId)
    if (city === undefined) return err(failed('That city is not yours, or it is no longer on the map.'))
    const option = city.harvest
    if (option.status === 'wrong-phase') return err(rejected('harvest', blocked('wrong-phase', option.reason)))

    const choice = option.choices.find(
      (candidate) => candidate.resource === resource && candidate.scoutPieceId === (scoutPieceId ?? null),
    )
    if (choice === undefined) {
      return err(
        failed(
          scoutPieceId === undefined
            ? `${city.label} has no ${resource} icon in its outskirts.`
            : `That scout is not yours, stands inside ${city.label} or is not on a ${resource} square.`,
        ),
      )
    }
    if (!choice.available) return err(failed(choice.unavailableReason ?? `The market has no ${resource} token left.`))
    const area = playerAreas(state.board, state.players).find((candidate) => candidate.playerId === player.playerId)
    if (area === undefined) return err(failed('You have no player area to put the token in.'))
    const again = earlierCityActions(state, player, city, context.confirmedAnotherCityAction)
    if (again.refusal !== undefined) return err(rejected('harvest', again.refusal))
    const region = areaSlotRegion(area)
    const placed = placeUnchecked(state, {
      playerId: player.playerId,
      assetId: `resources/${resource}`,
      x: region.x,
      y: region.y,
      ...(context.at === undefined ? {} : { at: context.at }),
    })
    const entry = placed?.board.history.at(-1)
    if (placed === undefined || entry === undefined || entry.change.kind !== 'place') {
      return err(failed(`The ${resource} token has no artwork to put on the board.`))
    }
    const piece = entry.change.piece

    const logged = appendLog(placed, {
      username: player.username,
      playerId: player.playerId,
      publicLog: `${player.username} harvested ${resource} with ${city.label} (${choice.label})${again.note}`,
      privateLog: '',
      createdAt: context.at ?? null,
      assistedActionId: context.requestId,
    })
    return ok({
      state: countLinesIn(logged, [entry.id]),
      effect: {
        kind: 'harvest',
        cityPieceId: city.cityPieceId,
        cityLabel: city.label,
        resource,
        pieceId: piece.id,
        historyId: entry.id,
      },
      logId: lastLogId(logged),
    })
  },

  reverse(state, player, record, at) {
    const effect = record.effect
    if (effect.kind !== 'harvest') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    const refused = (reason: string): EngineError => ({ kind: 'ASSISTED_UNDO_BLOCKED', logId: record.logId, reason })
    const piece = state.board.pieces.find((candidate) => candidate.id === effect.pieceId)
    if (piece === undefined) {
      return err(refused(`The ${effect.resource} token from ${effect.cityLabel} is no longer on the board (it may have been spent), so this cannot be undone.`))
    }
    const inArea =
      areaAt(playerAreas(state.board, state.players), piece.x + piece.width / 2, piece.y + piece.height / 2)?.playerId ===
      player.playerId
    if (!inArea) {
      return err(refused(`The ${effect.resource} token has left your player area. Move it back first.`))
    }
    const removed = removePiece(state, { playerId: record.playerId, pieceId: effect.pieceId, ...(at === null ? {} : { at }) })
    if (!removed.ok) return err(refused(`The ${effect.resource} token could not be taken off the board.`))
    return ok({
      state: removed.value,
      text: `${player.username}'s harvest of ${effect.resource} with ${effect.cityLabel} was undone: the token was removed`,
    })
  },
}

// -- Upgrade buildings -------------------------------------------------------------

/** The `upgradeBuildings` payload, or `undefined` when there is none or it is another action's. No payload means every family. */
const upgradePayloadOf = (payload: AssistedPayload | undefined): UpgradeBuildingsPayload | undefined =>
  payload !== undefined && 'family' in payload ? payload : undefined

/**
 * Flips the basic buildings of the player's cities to the upgraded form whose tech is
 * revealed (base rules p. 22): "they immediately flip over any of the corresponding
 * basic buildings that they've already produced in their cities". Each flipped
 * building keeps its square; the two forms share one supply, so the count never
 * changes, and nothing is paid, produced or marked as a city action. Allowed in any
 * phase of the player's turn, since the tech may be learned in Research. A flip is a
 * removal and a placement through the board history, per building, in board order.
 */
const upgradeBuildings: AssistedActionDefinition = {
  kind: 'upgradeBuildings',
  techName: null,
  label: 'Upgrade buildings',
  button: false,
  usageKey: null,
  phase: 'ANY',
  group: 'Cities',

  availability(state, playerId) {
    const player = playerOf(state, playerId)
    if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
    const plan = upgradePlanOf(state, player)
    if (!plan.ok) return blocked('unavailable', plan.error)
    return { status: 'ready', reason: 'Choose what to upgrade.' }
  },

  apply(state, player, context) {
    const failed = (reason: string): EngineError => rejected('upgradeBuildings', blocked('unavailable', reason))
    const family = upgradePayloadOf(context.payload)?.family
    // The server checks the shape; the engine is also called with whatever a caller sent, and a bad family must not read as "all"
    if (family !== undefined && typeof family !== 'string') return err(failed('family must be the asset id of a basic building.'))
    const plan = upgradePlanOf(state, player, family)
    if (!plan.ok) return err(failed(plan.error))

    const at = context.at === undefined ? {} : { at: context.at }
    const flipped: Extract<AssistedEffect, { kind: 'upgradeBuildings' }>['flipped'][number][] = []
    let next = state
    for (const { piece, cell, upgradedAssetId } of plan.value) {
      const asset = findBoardAsset(upgradedAssetId)
      const name = buildItemName({ kind: 'building', assetId: upgradedAssetId })
      if (asset === undefined) return err(failed(`The ${name} has no artwork to put on the board.`))
      const removed = removePiece(next, { playerId: player.playerId, pieceId: piece.id, ...at })
      const removedEntry = removed.ok ? removed.value.board.history.at(-1) : undefined
      if (!removed.ok || removedEntry === undefined) {
        return err(failed(`The ${buildItemName({ kind: 'building', assetId: piece.assetId })} on ${squareLabel(cell)} could not be taken off the board.`))
      }
      // The two forms differ by a few pixels, so the centre is kept: the new piece stands on the same square
      const placed = placeUnchecked(removed.value, {
        playerId: player.playerId,
        assetId: upgradedAssetId,
        x: piece.x + piece.width / 2 - asset.width / 2,
        y: piece.y + piece.height / 2 - asset.height / 2,
        rotation: piece.rotation,
        // The flip keeps whoever the old piece was attributed to: combat bonus and building count follow `placedBy`
        placedBy: piece.placedBy,
        ...at,
      })
      const placedEntry = placed?.board.history.at(-1)
      if (placed === undefined || placedEntry === undefined || placedEntry.change.kind !== 'place') {
        return err(failed(`The ${name} could not be placed on ${squareLabel(cell)}.`))
      }
      const created = placedEntry.change.piece
      const landed = mapCellOf(placed.board, created)
      if (landed === null || landed.column !== cell.column || landed.row !== cell.row) {
        return err(failed(`The ${name} could not be placed on ${squareLabel(cell)}.`))
      }
      flipped.push({
        from: piece,
        square: { column: cell.column, row: cell.row, label: squareLabel(cell) },
        pieceId: created.id,
        position: { x: created.x, y: created.y },
        removedHistoryId: removedEntry.id,
        placedHistoryId: placedEntry.id,
      })
      next = placed
    }

    const logged = appendLog(next, {
      username: player.username,
      playerId: player.playerId,
      publicLog: `${player.username} upgraded ${describeUpgrades(
        flipped.map((flip) => ({ basicAssetId: flip.from.assetId, squareLabel: flip.square.label })),
      )}`,
      privateLog: '',
      createdAt: context.at ?? null,
      assistedActionId: context.requestId,
    })
    return ok({
      state: countLinesIn(logged, flipped.flatMap((flip) => [flip.removedHistoryId, flip.placedHistoryId])),
      effect: { kind: 'upgradeBuildings', flipped },
      logId: lastLogId(logged),
    })
  },

  reverse(state, player, record, at) {
    const effect = record.effect
    if (effect.kind !== 'upgradeBuildings') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    const refused = (reason: string): EngineError => ({
      kind: 'ASSISTED_UNDO_BLOCKED',
      logId: record.logId,
      reason,
    })
    // Every upgraded piece is checked before anything is changed, so a refusal leaves the game as it was.
    for (const flip of effect.flipped) {
      const name = buildingNameOf(BUILDING_UPGRADES[flip.from.assetId] ?? flip.from.assetId) ?? 'upgraded building'
      const piece = state.board.pieces.find((candidate) => candidate.id === flip.pieceId)
      if (piece === undefined) {
        return err(refused(`The ${name} on ${flip.square.label} is no longer on the board, so the upgrade cannot be undone.`))
      }
      const cell = mapCellOf(state.board, piece)
      if (cell === null || cell.column !== flip.square.column || cell.row !== flip.square.row) {
        return err(refused(`The ${name} has left ${flip.square.label}. Move it back first.`))
      }
    }

    // In the order they were flipped, so the basic pieces keep their relative order on the board
    let next = state
    for (const flip of effect.flipped) {
      const removed = removePiece(next, {
        playerId: record.playerId,
        pieceId: flip.pieceId,
        ...(at === null ? {} : { at }),
      })
      if (!removed.ok) return err(refused(`The upgraded building on ${flip.square.label} could not be taken off the board.`))
      next = placeBack(removed.value, player, flip.from, at)
    }
    return ok({
      state: next,
      text:
        `${player.username}'s upgrade of ${describeUpgrades(
          effect.flipped.map((flip) => ({ basicAssetId: flip.from.assetId, squareLabel: flip.square.label })),
        )} was undone: the basic buildings were put back`,
    })
  },
}

/** Every assisted action, in the order the projection lists them. */
export const ASSISTED_ACTIONS: readonly AssistedActionDefinition[] = [
  ...RESOURCE_CULTURE_CARDS.map(resourceCultureCard),
  coinPurchase('democracy'),
  coinPurchase('printingPress'),
  cultureAdvance,
  cultureAdvanceSkip,
  chooseReward,
  build,
  startBuildingProgram,
  devoteToTheArts,
  harvest,
  upgradeBuildings,
  playCard,
  ...SOT_ACTIONS,
  ...ABILITY_ACTIONS,
  ...CITY_ACTIONS,
]

/** The actions that are buttons, in the order of `availableActions`. `chooseReward` answers a choice and is not one. */
export const ASSISTED_ACTION_KINDS: readonly AssistedActionKind[] = ASSISTED_ACTIONS.filter(
  (definition) => definition.button,
).map((definition) => definition.kind)

/** Any registered action, buttons and `chooseReward` alike: what the route accepts. */
export function isAssistedActionKind(value: unknown): value is AssistedActionKind {
  return typeof value === 'string' && ASSISTED_ACTIONS.some((definition) => definition.kind === value)
}

const definitionOf = (kind: AssistedActionKind): AssistedActionDefinition | undefined =>
  ASSISTED_ACTIONS.find((definition) => definition.kind === kind)

/** How a record is named in the public list and in an undo request. */
const labelOfRecord = (record: AssistedActionRecord): string => {
  const definition = definitionOf(record.kind)
  return definition?.labelOf?.(record) ?? definition?.label ?? record.kind
}


// ---------------------------------------------------------------------------
// Availability and the projection
// ---------------------------------------------------------------------------

/** Whether `kind` can be pressed by `playerId` right now, and why not when it cannot. */
export function assistedAvailability(
  state: GameState,
  playerId: string,
  kind: AssistedActionKind,
): AssistedAvailability {
  return (
    definitionOf(kind)?.availability(state, playerId) ??
    blocked('unavailable', 'Unknown action.')
  )
}

/**
 * The viewer's own button state, one entry per registered action. Meant for the
 * viewer's own `you` only: it depends on their hand and on which resource tokens
 * they hold.
 */
export function availableActionsFor(state: GameState, playerId: string): readonly AvailableAction[] {
  if (playerOf(state, playerId) === undefined) return []
  return ASSISTED_ACTIONS.filter((definition) => definition.button).map((definition) => ({
    action: definition.kind,
    label: definition.label,
    phase: definition.phase,
    group: definition.group,
    ...(definition.buttonText === undefined ? {} : { buttonText: definition.buttonText }),
    ...(definition.techName === null ? {} : { techName: definition.techName }),
    repeatable: definition.strictOnce !== true,
    ...definition.availability(state, playerId),
  }))
}

/**
 * What everyone may read of the actions performed: who, when, the public line. No
 * effect. A choice of reward is left out: it is the answer to an advance that is
 * listed, and its line is not a target for an undo.
 */
export function publicAssistedActions(state: GameState): readonly PublicAssistedAction[] {
  return state.assistedActions.filter((record) => record.kind !== 'chooseReward').map((record) => ({
    id: record.id,
    kind: record.kind,
    label: labelOfRecord(record),
    playerId: record.playerId,
    username: playerOf(state, record.playerId)?.username ?? '',
    turnNumber: record.turnNumber,
    phase: record.phase,
    status: record.status,
    text: state.log.find((entry) => entry.id === record.logId)?.publicLog ?? '',
    logId: record.logId,
    ...(record.confirmedRepeat === true ? { confirmedRepeat: true } : {}),
  }))
}

// ---------------------------------------------------------------------------
// Performing
// ---------------------------------------------------------------------------

export interface PerformAssistedActionInput {
  readonly playerId: string
  readonly action: AssistedActionKind
  /** Chosen by the client and kept until the request settles; makes a retry harmless. */
  readonly requestId: string
  /** ISO timestamp for the log and the board history. The engine itself stays pure. */
  readonly at?: string
  /** What `chooseReward` needs (which reward and which card) or `build` needs (which city, item and square). Other actions take none. */
  readonly payload?: AssistedPayload
  /**
   * The player answered yes to "you have already used this, use it again?" for a card, or to "this city
   * has already acted this turn, act again?" for a build, a Building Program, a devote or a harvest. It
   * lifts exactly that one refusal, `used`; every other refusal stands.
   */
  readonly confirmedRepeat?: boolean
}

/**
 * Performs one assisted action, atomically: either every change is made or none
 * is. A `requestId` that is already recorded returns the state as it is, so a
 * retry, a refresh or a second tab cannot do it twice. A new `requestId` for an
 * action that is out of uses is refused with `status: 'used'`.
 */
export function performAssistedAction(
  state: GameState,
  input: PerformAssistedActionInput,
): Result<GameState, EngineError> {
  const definition = definitionOf(input.action)
  if (definition === undefined) {
    return err(rejected(String(input.action), blocked('unavailable', 'Unknown action.')))
  }
  const player = playerOf(state, input.playerId)
  if (player === undefined) return err({ kind: 'NO_ACCESS', playerId: input.playerId })
  if (input.requestId.trim() === '') {
    return err(rejected(input.action, blocked('unavailable', 'A request id is required.')))
  }

  const existing = state.assistedActions.find((record) => record.id === input.requestId)
  if (existing !== undefined) {
    if (existing.playerId === input.playerId && existing.kind === input.action) return ok(state)
    return err(rejected(input.action, blocked('unavailable', 'This request id was already used.')))
  }

  const availability = definition.availability(state, input.playerId)
  // Some Great Persons and culture cards allow a second use and are not built, so
  // the player may override `used` and nothing else. The reducers re-check the
  // rest (resource, capacity, cost) when they apply.
  const repeat =
    availability.status === 'used' && input.confirmedRepeat === true && definition.strictOnce !== true
  if (availability.status !== 'ready' && !repeat) return err(rejected(input.action, availability))

  const applied = definition.apply(state, player, {
    requestId: input.requestId,
    at: input.at,
    payload: input.payload,
    confirmedRepeat: repeat,
    confirmedAnotherCityAction: input.confirmedRepeat === true,
  })
  if (!applied.ok) return applied

  const status = turnStatus(state)
  const record: AssistedActionRecord = {
    id: input.requestId,
    kind: input.action,
    playerId: input.playerId,
    turnNumber: status.currentTurn,
    // A reward can be chosen after City Management has closed, and an upgrade is done in whatever phase the tech was learned in; every other action needs it open
    phase: definition.phase === 'ANY' ? openPhaseOf(status, input.playerId) : definition.phase,
    usageKey: definition.usageKey,
    at: input.at ?? null,
    logId: applied.value.logId,
    status: 'applied',
    effect: applied.value.effect,
    ...(repeat ? { confirmedRepeat: true } : {}),
  }
  return ok({ ...applied.value.state, assistedActions: [...applied.value.state.assistedActions, record] })
}

/** The phase the player is working on, for the record of an action that does not need City Management. */
const openPhaseOf = (status: ReturnType<typeof turnStatus>, playerId: string): TurnPhase =>
  status.players.find((candidate) => candidate.playerId === playerId)?.phase ?? 'CM'

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

/** The record an assisted log line reports, if it has one. */
export function assistedRecordOf(
  state: GameState,
  entry: GameLogEntry,
): AssistedActionRecord | undefined {
  if (entry.assistedActionId === undefined) return undefined
  return state.assistedActions.find((record) => record.id === entry.assistedActionId)
}

/** How an undo request or vote names the action: public, the same as its own line. */
export function assistedSubject(state: GameState, record: AssistedActionRecord): string {
  const label = labelOfRecord(record)
  return `${label} used by ${playerOf(state, record.playerId)?.username ?? 'a player'}`
}

/**
 * Runs the reversal once the undo vote has passed: the stats, the exact token,
 * the usage key, the record marked `undone`, and a new public line saying what
 * was reversed. The original line stays. An action already undone is refused.
 */
export function reverseAssistedAction(
  state: GameState,
  recordId: string,
  at?: string,
  removedByHand = false,
): Result<GameState, EngineError> {
  const record = state.assistedActions.find((candidate) => candidate.id === recordId)
  if (record === undefined) return err({ kind: 'NOTHING_TO_UNDO', logId: recordId })
  if (record.status === 'undone') {
    return err({ kind: 'ASSISTED_ACTION_ALREADY_UNDONE', logId: record.logId })
  }
  const definition = definitionOf(record.kind)
  const player = playerOf(state, record.playerId)
  if (definition === undefined) return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
  if (player === undefined) return err({ kind: 'PLAYER_NOT_FOUND', playerId: record.playerId })

  const reversed = definition.reverse(state, player, record, at ?? null, removedByHand)
  if (!reversed.ok) return reversed

  const current = playerOf(reversed.value.state, record.playerId) ?? player
  const marked: GameState = {
    ...reversed.value.state,
    assistedActions: reversed.value.state.assistedActions.map((candidate) =>
      candidate.id === record.id ? { ...candidate, status: 'undone' as const } : candidate,
    ),
  }
  // A confirmed repeat shares the first use's key, so the key is freed only when no
  // other applied record of this player and turn still holds it.
  const stillHeld = marked.assistedActions.some(
    (candidate) =>
      candidate.status === 'applied' &&
      candidate.playerId === record.playerId &&
      candidate.turnNumber === record.turnNumber &&
      candidate.usageKey === record.usageKey,
  )
  const freed =
    record.usageKey === null || stillHeld
      ? marked
      : freeTurnAction(marked, current, record.turnNumber, record.usageKey)
  const logged = appendLog(freed, {
    username: 'System',
    // The original line stays; a piece taken off by hand adds this one, so the log shows what happened to it
    publicLog: `System: ${reversed.value.text}${removedByHand ? '. It was removed before End turn.' : ''}`,
    createdAt: at ?? null,
  })
  // The board changes the reversal made were recorded before this line existed:
  // count the line in, so stepping through the history shows them with it (the
  // same as the start player line in `actions/board.ts`).
  const firstNew = state.board.history.length
  const counted: GameState =
    logged.board.history.length === firstNew
      ? logged
      : {
          ...logged,
          board: {
            ...logged.board,
            history: logged.board.history.map((entry, index) =>
              index < firstNew ? entry : { ...entry, logLength: logged.log.length },
            ),
          },
        }
  // A wonder build that put its drawn card back in the deck: the board Undo must not bring the
  // drawn piece back while its card is in the deck, or the next draw would make a second one
  const effect = record.effect
  if (effect.kind === 'build' && 'drawn' in effect && effect.drawn !== undefined) {
    return ok({ ...counted, board: { ...counted.board, redo: [], undoFloor: counted.board.history.length } })
  }
  return ok(counted)
}

/**
 * The applied build or Building Program start that put this piece on the board, while
 * its City Management is still open: the owner has not pressed End turn for that phase.
 * Only the owner's own piece counts. `undefined` for any other piece.
 */
function openBuildOf(state: GameState, playerId: string, pieceId: string): AssistedActionRecord | undefined {
  const currentTurn = turnStatus(state).currentTurn
  // The newest first: a wonder keeps its piece id from one build to the next
  return [...state.assistedActions].reverse().find((record) => {
    if (record.status !== 'applied' || record.playerId !== playerId) return false
    const effect = record.effect
    const placedHere =
      (effect.kind === 'build' && 'pieceId' in effect && effect.pieceId === pieceId) ||
      (effect.kind === 'startBuildingProgram' && effect.pieceId === pieceId)
    if (!placedHere) return false
    // Only the turn that is being played: a phase unmarked in an older turn does not reopen its builds
    if (record.turnNumber !== currentTurn) return false
    const turn = playerOf(state, playerId)?.playerTurns.find((candidate) => candidate.turnNumber === record.turnNumber)
    return turn?.done?.[record.phase] !== true
  })
}

/**
 * The owner takes a piece that a build put on the board off it again, before pressing
 * End turn for City Management: the whole build is taken back, as an undo vote would, so
 * the trade comes back and a used Building Program marker is put back, and a new System
 * line says so. The line that reported the build stays. The piece may have been moved
 * since; it is taken off wherever it is.
 *
 * `undefined` when the piece is not a build's piece, when it is not the owner who removes
 * it, when End turn has been pressed for that turn's City Management, or when the wonder
 * drawn into the market after a wonder is no longer there, or when a Great Person the build held
 * in reserve has been placed somewhere else since: the caller then removes it as any other
 * piece, and from then on it is a plain removal. A unit places nothing and is never
 * taken back this way. After a take-back the board Undo cannot go back
 * past it (`undoFloor`, as after taking back a civilization reveal), so it cannot restore the
 * piece alone.
 */
export function takeBackOpenBuild(
  state: GameState,
  input: { readonly playerId: string; readonly pieceId: string; readonly at?: string },
): Result<GameState, EngineError> | undefined {
  const record = openBuildOf(state, input.playerId, input.pieceId)
  if (record === undefined) return undefined
  // The wonder drawn after this one has been taken, so this one cannot go back with it: the
  // piece is removed as any other, which is what the player asked for
  if (record.effect.kind === 'build' && 'drawn' in record.effect && drawnWonderGone(state, record.effect.drawn) !== undefined) {
    return undefined
  }
  // A Great Person this build held in reserve has been placed somewhere else since, so it cannot go back
  // with the build: the piece is removed as any other, which is what the player asked for
  if (record.effect.kind === 'build' && 'reserved' in record.effect && reservedUndoBlock(state, record.playerId, record.effect) !== undefined) {
    return undefined
  }
  const reversed = reverseAssistedAction(state, record.id, input.at, true)
  if (!reversed.ok) return reversed

  // A vote that was asked on the build's line is answered by this: close it, or it would
  // stay on every player's list of votes waiting and no vote could ever pass.
  const next = reversed.value
  const asked = next.log.find((entry) => entry.id === record.logId)
  const closed =
    asked === undefined || asked.undo === null || asked.undo.done
      ? next
      : {
          ...next,
          log: next.log.map((entry) =>
            entry.id === asked.id && entry.undo !== null ? { ...entry, undo: { ...entry.undo, done: true } } : entry,
          ),
        }
  // The board Undo must not bring the piece back while the build stays undone and the trade
  // refunded: nothing made before this may be reverted by it, and Redo is cleared
  return ok({ ...closed, board: { ...closed.board, redo: [], undoFloor: closed.board.history.length } })
}
