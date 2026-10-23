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

import { placeUnchecked, removePiece } from './actions/board.js'
import {
  PHASE_REASON,
  READY,
  REPEAT_NOTE,
  blocked,
  freeTurnAction,
  lastLogId,
  openCityManagementTurn,
  playerOf,
  rejected,
  techBlock,
  useTurnAction,
  usedReason,
  withPlayerHand,
} from './assisted-core.js'
import { playCard } from './assisted-cards.js'
import { SOT_ACTIONS } from './assisted-sot.js'
import {
  chooseReward,
  countLinesIn,
  cultureAdvance,
  drawCandidates,
  shuffleSheetTwice,
} from './assisted-culture.js'
import type {
  AssistedActionDefinition,
  AssistedAvailability,
  AssistedPayload,
  StartBuildingProgramPayload,
  UpgradeBuildingsPayload,
} from './assisted-core.js'
import { blockadedPieceIds, cityFootprintsOf, mapCellOf } from './blockade.js'
import {
  areaAt,
  boardAreas,
  findBoardAsset,
  locationOf,
  playerAreas,
} from './board.js'
import type { BoardPiece } from './board.js'
import { sameBuildItem } from './build-item.js'
import type { PlacedBuildItem, UnitType } from './build-item.js'
import {
  buildItemName,
  buildOptionsOf,
  buildSquareRefusal,
  figureAssetIdOf,
  squareCentre,
  squareLabel,
  unitSheetOf,
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
import { BUILDING_PROGRAM_ASSET_ID } from './city-production.js'
import { activeWonderOwnerIds, coinSourcesOf, findCoinSource, withCoinSource } from './coins.js'
import type { EngineError } from './errors.js'
import { itemName } from './item.js'
import type { Item } from './item.js'
import { appendLog } from './log.js'
import { nextId } from './random.js'
import type { Result } from './result.js'
import { err, ok } from './result.js'
import { SHEET_LABEL } from './sheet-name.js'
import type { SheetName } from './sheet-name.js'
import type {
  AssistedActionKind,
  AssistedActionRecord,
  AssistedEffect,
  AvailableAction,
  CultureCardKind,
  GameLogEntry,
  GameState,
  Playerhand,
  PlayerStats,
  PublicAssistedAction,
  SpentResource,
} from './state.js'
import { turnStatus } from './turn.js'
import type { PlayerTurn, TurnPhase } from './turn.js'

// ---------------------------------------------------------------------------
// Spending a resource
// ---------------------------------------------------------------------------

const normalize = (name: string): string => name.trim().toLowerCase()

/**
 * The token a resource would be paid with, without paying it. A hut in the
 * player's hand comes first, then a `resources/<name>` piece whose centre lies
 * in the player's own area. A piece outside every area is nobody's and is never
 * taken. Generic over Incense, Iron, Silk, Wheat and Uranium.
 */
export function findResourceToken(
  state: GameState,
  playerId: string,
  resource: string,
): SpentResource | undefined {
  const player = playerOf(state, playerId)
  if (player === undefined) return undefined

  const wanted = normalize(resource)
  const hut = player.items.find(
    (item) => item.kind === 'hut' && !item.used && normalize(item.name) === wanted,
  )
  if (hut !== undefined) return { kind: 'hut', resource, itemId: hut.id }

  const areas = playerAreas(state.board, state.players)
  const piece = state.board.pieces.find(
    (candidate) =>
      candidate.category === 'resource' &&
      candidate.assetId === `resources/${wanted}` &&
      areaAt(areas, candidate.x + candidate.width / 2, candidate.y + candidate.height / 2)
        ?.playerId === playerId,
  )
  return piece === undefined ? undefined : { kind: 'piece', resource, piece }
}

export interface SpendOutcome {
  readonly state: GameState
  /** Exactly what was spent, so an undo can put the same token back. */
  readonly spent: SpentResource
}

/**
 * Pays one resource token. A hut goes to `discardedItems` (hidden, as
 * `discardItem` leaves it); a piece is removed from the board through the board
 * history, which is "back to stock" because supply is counted from the pieces on
 * the board. `NO_RESOURCE` when the player has neither.
 */
export function spendResource(
  state: GameState,
  playerId: string,
  resource: string,
  at?: string,
): Result<SpendOutcome, 'NO_RESOURCE'> {
  const player = playerOf(state, playerId)
  const token = findResourceToken(state, playerId, resource)
  if (player === undefined || token === undefined) return err('NO_RESOURCE')

  if (token.kind === 'hut') {
    const hut = player.items.find((item) => item.id === token.itemId)
    if (hut === undefined) return err('NO_RESOURCE')
    const next: GameState = {
      ...withPlayerHand(state, {
        ...player,
        items: player.items.filter((item) => item.id !== hut.id),
      }),
      discardedItems: [...state.discardedItems, { ...hut, hidden: true }],
    }
    return ok({ state: next, spent: token })
  }

  const removed = removePiece(state, {
    playerId,
    pieceId: token.piece.id,
    ...(at === undefined ? {} : { at }),
  })
  if (!removed.ok) return err('NO_RESOURCE')
  return ok({ state: removed.value, spent: token })
}

/** Puts a spent token back: the hut into the hand, or the piece onto the board where it was. */
function returnResource(
  state: GameState,
  player: Playerhand,
  spent: SpentResource,
  at: string | null,
): Result<GameState, EngineError> {
  if (spent.kind === 'hut') {
    const inDiscard = state.discardedItems.find((item) => item.id === spent.itemId)
    const inDeck = state.items.find((item) => item.id === spent.itemId)
    const item = inDiscard ?? inDeck
    if (item === undefined) return err({ kind: 'ITEM_NOT_FOUND', sheetName: 'HUTS' })
    return ok({
      ...withPlayerHand(state, { ...player, items: [...player.items, { ...item, hidden: true }] }),
      discardedItems: state.discardedItems.filter((candidate) => candidate.id !== item.id),
      items: state.items.filter((candidate) => candidate.id !== item.id),
    })
  }
  return ok(placeBack(state, player, spent.piece, at))
}

/**
 * Puts the exact piece back, same id and same place, as a board history entry
 * so the history bar and board replay see it. It lands on top of the stack, which
 * is what replaying a `place` change does. Not through `placePiece`: that would
 * make a new piece, snap it into the next free slot and refuse it when the
 * supply count is full, and an undo must not be refused halfway.
 */
function placeBack(
  state: GameState,
  player: Playerhand,
  piece: BoardPiece,
  at: string | null,
): GameState {
  if (state.board.pieces.some((candidate) => candidate.id === piece.id)) return state
  const [id, rng] = nextId(state.rng)
  const areas = boardAreas(state.board, state.players)
  return {
    ...state,
    rng,
    board: {
      ...state.board,
      pieces: [...state.board.pieces, piece],
      history: [
        ...state.board.history,
        {
          id,
          at,
          playerId: player.playerId,
          username: player.username,
          description: `${player.username} put back ${piece.label} at ${locationOf(state.board, areas, piece)}`,
          change: { kind: 'place', piece, onTop: true },
          logLength: state.log.length,
        },
      ],
      redo: [],
    },
  }
}

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
    }
  | {
      readonly kind: 'card'
      readonly state: GameState
      readonly card: Item
      readonly sheetName: SheetName
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
    if (!['building', 'army', 'scout', 'unit'].includes(item.kind)) {
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
              : `A ${label} cannot be built.`
            : `${why.label} cannot be built in ${city.label} now. ${why.reason}`,
        ),
      )
    }

    // A square is chosen for a building or a figure and for nothing else
    let square: BuildSquare | undefined
    if (payload.item.kind === 'unit') {
      if (payload.target !== undefined) {
        return err(failed(`${choice.label} is a card and has no square. Send no square.`))
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
    const at = context.at === undefined ? {} : { at: context.at }

    // The marker a city with the Building Program must use (Wisdom and Warfare p. 7), found before anything is placed
    const footprint = ownCityFootprint(state, player, city.cityPieceId)
    const marker = footprint === undefined ? undefined : buildingProgramMarkerOf(state, footprint)

    // The one step that differs: a piece on a square, or a card in the hand
    let made: Made
    if (payload.item.kind === 'unit') {
      const drawn = drawBuiltUnit(state, player, payload.item.unitType)
      if (!drawn.ok) return err(failed(drawn.error))
      made = drawn.value
    } else {
      if (square === undefined) return err(failed('Pick one of the highlighted squares.'))
      const placed = placeBuilt(state, player, payload.item, square, at)
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
    const paid = withPlayerHand(board, {
      ...paying,
      stats: { ...paying.stats, trade: paying.stats.trade - choice.tradeToPay },
    })
    const where =
      made.kind === 'placed'
        ? ` on square ${made.square.label}` +
          (square?.note === undefined ? '' : ' (an enemy figure is there, so the outcome is to be settled by hand)')
        : ''
    const logged = appendLog(paid, {
      username: player.username,
      playerId: player.playerId,
      publicLog:
        `${player.username} built ${withArticle(label)} in ${city.label}${where}` +
        (choice.tradeToPay > 0 ? `, paying ${choice.tradeToPay} trade for the missing production` : '') +
        (removal === null ? '' : ', using up the Building Program marker'),
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
    const counted = countLinesIn(withPrivate, [made.kind === 'placed' ? made.historyId : undefined, removal?.historyId])

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
    if (payload.item.kind === 'unit') return err(failed('A unit is not put on a square.'))
    return ok({
      state: counted,
      effect: {
        kind: 'build',
        cityPieceId: city.cityPieceId,
        item: payload.item,
        square: made.square,
        pieceId: made.piece.id,
        position: { x: made.piece.x, y: made.piece.y },
        historyId: made.historyId,
        trade: choice.tradeToPay,
        marker: removal,
      },
      logId,
    })
  },

  reverse(state, player, record, at) {
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

    // Everything is checked before anything is changed, so a refusal leaves the game as it was.
    const piece = state.board.pieces.find((candidate) => candidate.id === effect.pieceId)
    if (piece === undefined) {
      return err(refused(`The ${label} is no longer on the board, so the build cannot be undone.`))
    }
    const cell = mapCellOf(state.board, piece)
    if (cell === null || cell.column !== effect.square.column || cell.row !== effect.square.row) {
      return err(refused(`The ${label} has left ${effect.square.label}. Move it back first.`))
    }

    const removed = removePiece(withPlayerHand(state, refunded), {
      playerId: record.playerId,
      pieceId: effect.pieceId,
      ...(at === null ? {} : { at }),
    })
    if (!removed.ok) return err(refused(`The ${label} could not be taken off the board.`))
    const restored =
      effect.marker === null ? removed.value : placeBack(removed.value, refunded, effect.marker.piece, at)

    return ok({
      state: restored,
      text:
        `${player.username}'s ${label} on ${effect.square.label} was undone: the ${effect.item.kind === 'building' ? 'building' : 'figure'} was removed` +
        tradeText +
        markerText,
    })
  },
}

// -- Start a Building Program -----------------------------------------------------

/** The `startBuildingProgram` payload, or `undefined` when the payload is another action's or missing. */
const startPayloadOf = (payload: AssistedPayload | undefined): StartBuildingProgramPayload | undefined =>
  payload !== undefined && 'cityPieceId' in payload && !('item' in payload) ? payload : undefined

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
      publicLog: `${player.username} started a Building Program in ${city.label}`,
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

  reverse(state, player, record, at) {
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
    if (cell === null || cell.column !== effect.square.column || cell.row !== effect.square.row) {
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
  chooseReward,
  build,
  startBuildingProgram,
  upgradeBuildings,
  playCard,
  ...SOT_ACTIONS,
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
   * The player answered yes to "you have already used this, use it again?". It
   * lifts exactly one refusal, `used`; every other refusal stands.
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

  const reversed = definition.reverse(state, player, record, at ?? null)
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
    publicLog: `System: ${reversed.value.text}`,
    createdAt: at ?? null,
  })
  // The board changes the reversal made were recorded before this line existed:
  // count the line in, so stepping through the history shows them with it (the
  // same as the start player line in `actions/board.ts`).
  const firstNew = state.board.history.length
  if (logged.board.history.length === firstNew) return ok(logged)
  return ok({
    ...logged,
    board: {
      ...logged.board,
      history: logged.board.history.map((entry, index) =>
        index < firstNew ? entry : { ...entry, logLength: logged.log.length },
      ),
    },
  })
}
