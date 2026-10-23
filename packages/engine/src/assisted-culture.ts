/**
 * The culture track: advancing the leader marker, the cards or Great Person it
 * draws, the private choice of which card to keep, and taking it all back.
 *
 * Moved out of `assisted.ts` so the Start of Turn actions (a free advance for the
 * Romans, the Arabs and Sydney Opera House; Patronage) can use the same code
 * without importing `assisted.ts` in a circle. This file and `assisted.ts` follow
 * the import rules described at the top of `assisted.ts`.
 */

import { movePieceUnchecked, placeUnchecked, removePiece } from './actions/board.js'
import {
  PHASE_REASON,
  blocked,
  lastLogId,
  openCityManagementTurn,
  playerOf,
  rejected,
  withPlayerHand,
} from './assisted-core.js'
import type {
  AssistedActionDefinition,
  BlockedAvailability,
} from './assisted-core.js'
import { reshuffleItems } from './actions/draw.js'
import { GREAT_PERSON_CARD_TYPES } from './blockade.js'
import {
  AREA_LABEL_HEIGHT,
  CULTURE_VICTORY_STEP,
  areaAt,
  boardAreas,
  cultureCellCenter,
  cultureStepOf,
  findBoardAsset,
  playerAreas,
  remainingBoardAssetCount,
} from './board.js'
import {
  cultureAdvanceCost,
  cultureMarkerOf,
  cultureSpaceAt,
  rewardDrawCount,
} from './culture-track.js'
import type { CultureAdvanceCost, CultureLevel, CultureMarker, CultureSpace } from './culture-track.js'
import type { EngineError } from './errors.js'
import { itemName } from './item.js'
import type { Item } from './item.js'
import { appendLog } from './log.js'
import { shuffle } from './random.js'
import type { Result } from './result.js'
import { err, ok } from './result.js'
import { SHEET_LABEL } from './sheet-name.js'
import type { SheetName } from './sheet-name.js'
import type {
  AssistedActionRecord,
  GameState,
  GreatPersonMarker,
  PendingReward,
  Playerhand,
} from './state.js'

// ---------------------------------------------------------------------------
// Spending a resource

// -- The culture advance and its reward ---------------------------------------

const ROMAN = ['', 'I', 'II', 'III'] as const

/** "space 8 (culture II event)" or "space 7 (Great Person)". */
function describeSpace(space: CultureSpace): string {
  const what = space.kind === 'event' ? `culture ${ROMAN[space.level]} event` : 'Great Person'
  return `space ${space.step} (${what})`
}

/** "5 culture and 3 trade", "3 culture", or "nothing" when a discount took it all. */
function describeCost(cost: CultureAdvanceCost): string {
  const parts = [
    ...(cost.culture > 0 ? [`${cost.culture} culture`] : []),
    ...(cost.trade > 0 ? [`${cost.trade} trade`] : []),
  ]
  return parts.length === 0 ? 'nothing' : parts.join(' and ')
}

/** The deck a space draws from: its level's culture deck, or the Great Person deck. */
function rewardSheet(space: CultureSpace): SheetName {
  if (space.kind === 'greatPerson') return 'GREAT_PERSON'
  return space.level === 1 ? 'CULTURE_1' : space.level === 2 ? 'CULTURE_2' : 'CULTURE_3'
}

/** "culture II" or "Great Person", as the public line names the cards. */
function rewardLabel(space: Pick<CultureSpace, 'kind' | 'level'>): string {
  return space.kind === 'event' ? `culture ${ROMAN[space.level]}` : 'Great Person'
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

/**
 * The pending rewards that still have a candidate in the hand. A choice whose
 * cards have all left (put back in the deck, traded, discarded by hand) has
 * nothing to choose any more: it blocks nothing and is not shown. Exported for
 * the projection.
 */
export function livePendingRewards(player: Playerhand): readonly PendingReward[] {
  return player.pendingRewards.filter((reward) =>
    reward.candidateIds.some((id) => player.items.some((item) => item.id === id)),
  )
}

interface AdvancePlan {
  readonly marker: CultureMarker
  readonly to: CultureSpace
  readonly cost: CultureAdvanceCost
  readonly count: number
  readonly sheetName: SheetName
}

/**
 * Whether the player can advance now, and onto what. The order of the checks is
 * the order the reasons are given in: phase, the marker, the end of the track, a
 * choice still waiting, the price, and last the deck, so the reason that comes
 * first is the one the player can do something about first.
 */
function planAdvance(state: GameState, player: Playerhand): Result<AdvancePlan, BlockedAvailability> {
  if (openCityManagementTurn(state, player) === undefined) return err(blocked('wrong-phase', PHASE_REASON))
  const marker = cultureMarkerOf(state, player)
  if (marker === undefined) {
    return err(blocked('unavailable', 'Your leader marker is not on the culture track.'))
  }
  const to = cultureSpaceAt(marker.step + 1)
  if (to === undefined) {
    return err(blocked('unavailable', 'Your marker is already on the Culture Victory space.'))
  }

  const cost = cultureAdvanceCost(state, player, to.step)
  const where = `Advance to ${describeSpace(to)}: ${describeCost(cost)}.`
  if (livePendingRewards(player).length > 0) {
    return err(blocked('unavailable', `${where} Choose the card to keep from your last advance first.`))
  }

  const lackingCulture = Math.max(0, cost.culture - player.stats.culture)
  const lackingTrade = Math.max(0, cost.trade - player.stats.trade)
  if (lackingCulture > 0 || lackingTrade > 0) {
    return err(
      blocked(
        'needs-resource',
        `${where} You are missing ${describeCost({ culture: lackingCulture, trade: lackingTrade })}.`,
      ),
    )
  }

  const sheetName = rewardSheet(to)
  const cardsLeft = [...state.items, ...state.discardedItems].some((item) => item.sheetName === sheetName)
  // A Great Person space with no card or no marker left still advances: the player receives nothing
  if (!cardsLeft && to.kind === 'event') {
    return err(blocked('unavailable', `${where} There are no ${SHEET_LABEL[sheetName]} cards left to draw.`))
  }

  return ok({ marker, to, cost, count: rewardDrawCount(state, player, to.kind), sheetName })
}

/**
 * Takes up to `count` cards of one sheet off the deck, the way the Draw button takes
 * the first of the sheet and reshuffles the discards when the deck has none of it.
 * Without an item log line per card: a line carrying the item would make the old
 * item undo a way to take back one card of the choice. Fewer cards than asked for is
 * fine once the first one is drawn (there is nothing left to draw); not even one is
 * the reshuffle's own error.
 *
 * With `filter` (the Great Person space) a card that is not valid is not drawn: it
 * is handed to `filter.reject`, which discards it and says so, and the draw goes on.
 * The rejected cards are kept aside and added to the discard pile at the end, so the
 * reshuffle cannot deal them again and the loop ends when the deck and the discards
 * are used up. Then even no card at all is a normal result, not an error.
 */
export function drawCandidates(
  state: GameState,
  sheetName: SheetName,
  count: number,
  filter?: {
    readonly valid: (state: GameState, item: Item) => boolean
    readonly reject: (state: GameState, item: Item) => GameState
  },
): Result<
  {
    readonly state: GameState
    readonly items: readonly Item[]
    readonly rejected: readonly Item[]
  },
  EngineError
> {
  let current = state
  const items: Item[] = []
  const rejected: Item[] = []
  while (items.length < count) {
    let index = current.items.findIndex((item) => item.sheetName === sheetName)
    if (index < 0) {
      const reshuffled = reshuffleItems(current, sheetName)
      if (!reshuffled.ok) {
        if (items.length === 0 && filter === undefined) return reshuffled
        break
      }
      current = reshuffled.value
      index = current.items.findIndex((item) => item.sheetName === sheetName)
    }
    const item = current.items[index]
    if (item === undefined) break
    current = { ...current, items: [...current.items.slice(0, index), ...current.items.slice(index + 1)] }
    if (filter === undefined || filter.valid(current, item)) {
      items.push(item)
    } else {
      rejected.push(item)
      current = filter.reject(current, item)
    }
  }
  return ok({ state: current, items, rejected })
}

/** Two shuffles of the deck, as an item undo does (`shuffleDeckTwice` in `actions/undo.ts`). */
function shuffleDeckTwice(state: GameState): GameState {
  const [once, afterFirst] = shuffle(state.items, state.rng)
  const [twice, rng] = shuffle(once, afterFirst)
  return { ...state, items: twice, rng }
}

/**
 * Two shuffles of one sheet's cards only. The cards of the sheet are shuffled among the
 * places they already hold in `state.items`, so every card of another sheet (the Great
 * Person and culture decks, the other unit decks) stays exactly where it is.
 */
export function shuffleSheetTwice(state: GameState, sheetName: SheetName): GameState {
  const slots: number[] = []
  const cards: Item[] = []
  state.items.forEach((item, index) => {
    if (item.sheetName === sheetName) {
      slots.push(index)
      cards.push(item)
    }
  })
  const [once, afterFirst] = shuffle(cards, state.rng)
  const [twice, rng] = shuffle(once, afterFirst)
  const items = [...state.items]
  slots.forEach((slot, position) => {
    const card = twice[position]
    if (card !== undefined) items[slot] = card
  })
  return { ...state, items, rng }
}

// -- Great Person cards and their markers --------------------------------------

/**
 * The Great Person marker a card takes, by the card's `type`, through the table
 * the blockade rule already uses. A card whose type is not in the table has no
 * marker and is never valid.
 */
function markerAssetIdOf(item: Item): string | undefined {
  if (item.kind !== 'greatperson') return undefined
  return GREAT_PERSON_CARD_TYPES.find(([, cardType]) => cardType === item.type)?.[0]
}

/** Markers of one kind still in the supply: the box holds 3, and every piece on the board counts, in an area or not. */
function markersLeft(state: GameState, assetId: string): number {
  const asset = findBoardAsset(assetId)
  if (asset === undefined) return 0
  return remainingBoardAssetCount(asset, state.board.pieces, state.numOfPlayers) ?? 0
}

/** "scientist" or "merchant": the marker's artwork label, as the public line names a marker type. */
const markerLabelOf = (assetId: string): string =>
  (findBoardAsset(assetId)?.label ?? 'Great Person').toLowerCase()

/** True while at least one Great Person marker type still has a piece in the supply. */
const anyMarkerLeft = (state: GameState): boolean =>
  GREAT_PERSON_CARD_TYPES.some(([assetId]) => markersLeft(state, assetId) > 0)

/** A card is valid while the marker of its type is in the supply. */
function hasMarkerLeft(state: GameState, item: Item): boolean {
  const assetId = markerAssetIdOf(item)
  return assetId !== undefined && markersLeft(state, assetId) > 0
}

/** The player's own area, where a marker is put. */
const ownAreaOf = (state: GameState, playerId: string) =>
  playerAreas(state.board, state.players).find((area) => area.playerId === playerId)

/**
 * Puts the marker of `card`'s type in the player's own area, tidied into the next
 * free slot, as a board history entry. Not `placePiece`: the supply is checked
 * here, with a reason, and the caller has already checked access. `Err` carries a
 * sentence for the player; nothing is changed then.
 */
function takeGreatPersonMarker(
  state: GameState,
  player: Playerhand,
  card: Item,
  at: string | undefined,
): Result<{ readonly state: GameState; readonly marker: GreatPersonMarker }, string> {
  const assetId = markerAssetIdOf(card)
  if (assetId === undefined) return err('That card has no Great Person marker.')
  if (markersLeft(state, assetId) === 0) {
    return err(
      `No ${markerLabelOf(assetId)} marker is left. Choose another card, or take a ${markerLabelOf(assetId)} marker off the board first.`,
    )
  }
  const area = ownAreaOf(state, player.playerId)
  if (area === undefined) return err('You have no player area on the board to put the marker in.')

  const placed = placeUnchecked(state, {
    playerId: player.playerId,
    assetId,
    x: area.x + 20,
    y: area.y + AREA_LABEL_HEIGHT + 10,
    ...(at === undefined ? {} : { at }),
  })
  const entry = placed?.board.history.at(-1)
  if (placed === undefined || entry === undefined || entry.change.kind !== 'place') {
    return err('The Great Person marker could not be placed.')
  }
  const piece = entry.change.piece
  return ok({
    state: placed,
    marker: { assetId, pieceId: piece.id, position: { x: piece.x, y: piece.y }, historyId: entry.id },
  })
}

/** Where a marker is checked before an undo: still on the board, and still in its owner's area. */
function markerUndoBlock(state: GameState, ownerId: string, marker: GreatPersonMarker): string | undefined {
  const piece = state.board.pieces.find((candidate) => candidate.id === marker.pieceId)
  if (piece === undefined) {
    return 'The Great Person marker is no longer on the board, so this cannot be undone.'
  }
  const inArea =
    areaAt(boardAreas(state.board, state.players), piece.x + piece.width / 2, piece.y + piece.height / 2)
      ?.playerId === ownerId
  if (!inArea) {
    return 'The Great Person marker has left its owner\'s player area. Move it back first.'
  }
  return undefined
}

/** Counts the lines written after a board change into its history entry, so stepping through the history shows them together. */
export function countLinesIn(state: GameState, historyIds: readonly (string | undefined)[]): GameState {
  const ids = new Set(historyIds.filter((id): id is string => id !== undefined))
  return {
    ...state,
    board: {
      ...state.board,
      history: state.board.history.map((entry) =>
        ids.has(entry.id) ? { ...entry, logLength: state.log.length } : entry,
      ),
    },
  }
}

interface GreatPersonOrigin {
  readonly requestId: string
  readonly at: string | undefined
  /** Cards to draw: `rewardDrawCount` for the Great Person kind. */
  readonly count: number
  /** The Great Person space the advance moved onto. */
  readonly level: CultureLevel
  readonly step: number
}

/** The two reasons a Great Person space gives nothing, as the public line ends. */
const NONE_BECAUSE_NO_MARKER = 'gained no Great Person, because no marker was available'
const NONE_BECAUSE_NO_CARD = 'gained no Great Person, because no Great Person card could be drawn'

/** What gaining a Great Person did. The caller writes the public line with `phrase` and records `effect`. */
interface GreatPersonGain {
  readonly state: GameState
  readonly outcome: 'none' | 'kept' | 'choice'
  /** Ends the public line: "took a scientist great person marker into reserve", "drew 3 Great Person cards" or the reason nothing came. */
  readonly phrase: string
  /** The private line, naming the cards; empty when nothing secret happened. */
  readonly privateText: string
  readonly drawn: readonly string[]
  readonly rejected: readonly string[]
  readonly kept: string | null
  readonly marker: GreatPersonMarker | null
}

/**
 * Gaining a Great Person (Fame and Fortune p. 11 to 12), as the culture
 * advance's Great Person space does it: draw until `count` cards have a marker left, give
 * the valid cards to the hand hidden, and with exactly one take its marker at once;
 * with more, store a pending choice that `chooseReward` resolves. With no valid card
 * the player receives nothing. Pure: only a refusal to place the marker is an error.
 *
 * Faceup discard and redraw is only for a card whose own type is out while some type
 * is still available (p. 11 to 12). With no marker of any type left the player does not
 * receive a Great Person at all, so nothing is drawn: draining the deck would name every
 * card in a public line and leak which cards the hands hold.
 * Residual case, accepted as rare: some types have supply but every card still to draw is
 * of an exhausted type. The loop then names and discards those cards faceup, as the rule
 * does for each one drawn.
 */
function gainGreatPerson(
  state: GameState,
  player: Playerhand,
  origin: GreatPersonOrigin,
): Result<GreatPersonGain, string> {
  if (!anyMarkerLeft(state)) {
    return ok({
      state,
      outcome: 'none',
      phrase: NONE_BECAUSE_NO_MARKER,
      privateText: '',
      drawn: [],
      rejected: [],
      kept: null,
      marker: null,
    })
  }

  // The deck draw is the advance's own (`drawCandidates`, which reshuffles the discards
  // the way the Draw button does); only the validity filter is added. A rejected card
  // goes to the discard pile faceup, named in a public line.
  const drawnCards = drawCandidates(state, 'GREAT_PERSON', origin.count, {
    valid: hasMarkerLeft,
    reject: (current, item) => {
      const assetId = markerAssetIdOf(item)
      return appendLog(current, {
        username: player.username,
        playerId: player.playerId,
        publicLog:
          `${player.username} drew the Great Person card ${itemName(item)}, but ` +
          (assetId === undefined ? 'it has no marker type' : `no ${markerLabelOf(assetId)} marker is left`) +
          ', so it was discarded faceup',
        privateLog: '',
        createdAt: origin.at ?? null,
      })
    },
  })
  if (!drawnCards.ok) return err('No Great Person card could be drawn.')
  const discardedCards = drawnCards.value.rejected.map(
    (item): Item => ({ ...item, ownerId: player.playerId, hidden: true }),
  )
  const afterDraw: GameState = {
    ...drawnCards.value.state,
    discardedItems: [...drawnCards.value.state.discardedItems, ...discardedCards],
  }
  const rejectedIds = discardedCards.map((item) => item.id)
  const candidates = drawnCards.value.items.map((item): Item => ({ ...item, ownerId: player.playerId, hidden: true }))

  if (candidates.length === 0) {
    return ok({
      state: afterDraw,
      outcome: 'none',
      phrase: NONE_BECAUSE_NO_CARD,
      privateText: '',
      drawn: [],
      rejected: rejectedIds,
      kept: null,
      marker: null,
    })
  }

  const holder = playerOf(afterDraw, player.playerId) ?? player
  const reward: PendingReward = {
    id: origin.requestId,
    kind: 'greatPerson',
    level: origin.level,
    step: origin.step,
    candidateIds: candidates.map((item) => item.id),
    keep: 1,
  }
  const resolved = candidates.length === 1
  // A choice with no card left in the hand is dropped here, so it cannot pile up
  const pendingRewards = resolved
    ? livePendingRewards(holder)
    : [...livePendingRewards(holder), reward]
  const withHand = withPlayerHand(afterDraw, {
    ...holder,
    items: [...holder.items, ...candidates],
    pendingRewards,
  })
  const names = candidates.map(itemName).join(', ')
  const base = { drawn: reward.candidateIds, rejected: rejectedIds }

  if (!resolved) {
    return ok({
      ...base,
      state: withHand,
      outcome: 'choice',
      phrase: `drew ${plural(candidates.length, 'Great Person card')}`,
      privateText: `${player.username} drew ${names} (${SHEET_LABEL.GREAT_PERSON}), keeps one`,
      kept: null,
      marker: null,
    })
  }

  const [only] = candidates
  if (only === undefined) return err('No Great Person card was drawn.')
  const taken = takeGreatPersonMarker(withHand, player, only, origin.at)
  if (!taken.ok) return taken
  return ok({
    ...base,
    state: taken.value.state,
    outcome: 'kept',
    phrase: `took a ${markerLabelOf(taken.value.marker.assetId)} great person marker into reserve`,
    privateText: `${player.username} drew ${names} (${SHEET_LABEL.GREAT_PERSON}) and kept it`,
    kept: only.id,
    marker: taken.value.marker,
  })
}

/**
 * Takes the cards of a gain back to the deck: the kept one from the hand, the
 * rejected and discarded ones from the discard pile, a pending choice dropped, and
 * the deck shuffled twice the way an item undo does. Everything is checked first, so
 * a refusal changes nothing. A card that left the hand cannot be taken back, like a
 * missing hut.
 */
function restoreDrawnCards(
  state: GameState,
  player: Playerhand,
  recordId: string,
  ids: readonly string[],
  kept: string | null,
  sheetName: SheetName,
): Result<GameState, EngineError> {
  const inHand = (id: string): Item | undefined => player.items.find((item) => item.id === id)
  const inDiscard = (id: string): Item | undefined => state.discardedItems.find((item) => item.id === id)
  const inDeck = (id: string): boolean => state.items.some((item) => item.id === id)
  const toDeck: Item[] = []
  for (const id of ids) {
    const found = id === kept ? inHand(id) : (inDiscard(id) ?? inHand(id))
    if (found !== undefined) {
      toDeck.push(found)
    } else if (!inDeck(id) || id === kept) {
      return err({ kind: 'ITEM_NOT_FOUND', sheetName })
    }
  }

  const returnedIds = new Set(toDeck.map((item) => item.id))
  const withCards: GameState = {
    ...withPlayerHand(state, {
      ...player,
      items: player.items.filter((item) => !returnedIds.has(item.id)),
      pendingRewards: player.pendingRewards.filter((reward) => reward.id !== recordId),
    }),
    discardedItems: state.discardedItems.filter((item) => !returnedIds.has(item.id)),
    items: [...state.items, ...toDeck.map((item): Item => ({ ...item, hidden: true, ownerId: null }))],
  }
  return ok(toDeck.length === 0 ? withCards : shuffleDeckTwice(withCards))
}

/** Takes the marker of a gain off the board, through the board history. `Err` is the reason the undo must refuse. */
function removeGreatPersonMarker(
  state: GameState,
  record: AssistedActionRecord,
  marker: GreatPersonMarker,
  at: string | null,
): Result<GameState, string> {
  const removed = removePiece(state, {
    playerId: record.playerId,
    pieceId: marker.pieceId,
    ...(at === null ? {} : { at }),
  })
  return removed.ok ? ok(removed.value) : err('The Great Person marker could not be taken off the board.')
}

/** The sentence part for a removed marker, or an empty string. */
const removedMarkerText = (marker: GreatPersonMarker | null | undefined): string =>
  marker === null || marker === undefined ? '' : ` and the ${markerLabelOf(marker.assetId)} great person marker was removed`

export const cultureAdvance: AssistedActionDefinition = {
  kind: 'cultureAdvance',
  techName: null,
  label: 'Culture advance',
  button: true,
  usageKey: null,
  phase: 'CM',
  group: 'Culture track',

  availability(state, playerId) {
    const player = playerOf(state, playerId)
    if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
    const plan = planAdvance(state, player)
    if (!plan.ok) return plan.error
    return {
      status: 'ready',
      reason: `Advance to ${describeSpace(plan.value.to)}: ${describeCost(plan.value.cost)}.`,
    }
  },

  apply(state, player, context) {
    const plan = planAdvance(state, player)
    if (!plan.ok) return err(rejected('cultureAdvance', plan.error))
    const { marker, to, cost, count, sheetName } = plan.value
    const failed = (reason: string): EngineError =>
      rejected('cultureAdvance', blocked('unavailable', reason))
    const at = context.at === undefined ? {} : { at: context.at }

    // The marker moves exactly one space, through the board's own move so the
    // history records it. Only the horizontal position changes, so it keeps its lane.
    const target = cultureCellCenter(state.board, to.step)
    const moved = movePieceUnchecked(state, {
      playerId: player.playerId,
      pieceId: marker.piece.id,
      x: Math.round(target.x - marker.piece.width / 2),
      y: marker.piece.y,
      snap: false,
      ...at,
    })
    const move = moved?.board.history.at(-1)
    const placed = moved?.board.pieces.find((piece) => piece.id === marker.piece.id)
    if (moved === undefined || move === undefined || placed === undefined) {
      return err(failed('Your leader marker could not be moved.'))
    }
    if (cultureStepOf(moved.board, placed) !== to.step) {
      return err(failed('Your leader marker could not be moved onto that space.'))
    }

    // A Great Person space goes through the Great Person step (valid cards, a marker);
    // a culture event draws as before.
    const paysWith = (state: GameState): GameState => {
      const paying = playerOf(state, player.playerId) ?? player
      return withPlayerHand(state, {
        ...paying,
        stats: {
          ...paying.stats,
          culture: paying.stats.culture - cost.culture,
          trade: paying.stats.trade - cost.trade,
        },
      })
    }
    const prefix = `${player.username} advanced on the culture track to space ${to.step} and `

    let paid: GameState
    let publicText: string
    let privateText: string
    let cards: {
      readonly drawn: readonly string[]
      readonly kept: string | null
      readonly extra: { readonly rejected: readonly string[]; readonly marker: GreatPersonMarker | null } | null
    }
    if (to.kind === 'greatPerson') {
      const gained = gainGreatPerson(moved, player, {
        requestId: context.requestId,
        at: context.at,
        count,
        level: to.level,
        step: to.step,
      })
      if (!gained.ok) return err(failed(gained.error))
      paid = paysWith(gained.value.state)
      publicText = prefix + gained.value.phrase
      privateText = gained.value.privateText
      cards = {
        drawn: gained.value.drawn,
        kept: gained.value.kept,
        extra: { rejected: gained.value.rejected, marker: gained.value.marker },
      }
    } else {
      const drawn = drawCandidates(moved, sheetName, count)
      if (!drawn.ok) return drawn
      const candidates = drawn.value.items.map((item): Item => ({ ...item, ownerId: player.playerId, hidden: true }))
      const paying = playerOf(drawn.value.state, player.playerId) ?? player
      const resolved = candidates.length === 1
      const reward: PendingReward = {
        id: context.requestId,
        kind: to.kind,
        level: to.level,
        step: to.step,
        candidateIds: candidates.map((item) => item.id),
        keep: 1,
      }
      paid = paysWith(
        withPlayerHand(drawn.value.state, {
          ...paying,
          items: [...paying.items, ...candidates],
          // A choice with no card left in the hand is dropped here, so it cannot pile up
          pendingRewards: resolved
            ? livePendingRewards(paying)
            : [...livePendingRewards(paying), reward],
        }),
      )
      const names = candidates.map(itemName).join(', ')
      publicText = prefix + `drew ${plural(candidates.length, `${rewardLabel(to)} card`)}`
      privateText = resolved
        ? `${player.username} drew ${names} (${SHEET_LABEL[sheetName]}) and kept it`
        : `${player.username} drew ${names} (${SHEET_LABEL[sheetName]}), keeps one`
      cards = { drawn: reward.candidateIds, kept: resolved ? (reward.candidateIds[0] ?? null) : null, extra: null }
    }

    const publicLine = appendLog(paid, {
      username: player.username,
      playerId: player.playerId,
      publicLog: publicText,
      privateLog: '',
      createdAt: context.at ?? null,
      assistedActionId: context.requestId,
    })
    const logId = lastLogId(publicLine)
    const withPrivate =
      privateText === ''
        ? publicLine
        : appendLog(publicLine, {
            username: player.username,
            playerId: player.playerId,
            privateLog: privateText,
            createdAt: context.at ?? null,
          })
    // Reaching the last panel changes nothing else: no winner, no end of the game.
    const logged =
      to.step === CULTURE_VICTORY_STEP
        ? appendLog(withPrivate, {
            username: player.username,
            playerId: player.playerId,
            publicLog: `${player.username} has reached the Culture Victory space on the culture track`,
            createdAt: context.at ?? null,
          })
        : withPrivate

    // The marker move was recorded before the advance lines existed: count them in,
    // so stepping through the board history shows the move with the advance line
    // (reverseAssistedAction does the same for its own entry). So does the marker
    // a Great Person space put in the area.
    const counted = countLinesIn(logged, [move.id, cards.extra?.marker?.historyId])

    return ok({
      state: counted,
      effect: {
        kind: 'cultureAdvance',
        fromStep: marker.step,
        toStep: to.step,
        culture: cost.culture,
        trade: cost.trade,
        markerPieceId: marker.piece.id,
        markerFrom: { x: marker.piece.x, y: marker.piece.y },
        markerTo: { x: placed.x, y: placed.y },
        historyId: move.id,
        reward: to.kind,
        level: to.level,
        sheetName,
        drawn: cards.drawn,
        kept: cards.kept,
        ...(cards.extra === null ? {} : cards.extra),
      },
      logId,
    })
  },

  reverse(state, player, record, at) {
    const effect = record.effect
    if (effect.kind !== 'cultureAdvance') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    const refused = (reason: string): EngineError => ({
      kind: 'ASSISTED_UNDO_BLOCKED',
      logId: record.logId,
      reason,
    })

    // Everything is checked before anything is changed, so a refusal leaves the game as it was.
    const marker = state.board.pieces.find((piece) => piece.id === effect.markerPieceId)
    if (marker === undefined) {
      return err(refused('The leader marker is no longer on the board, so the advance cannot be undone.'))
    }
    if (cultureStepOf(state.board, marker) !== effect.toStep) {
      return err(
        refused(
          `The leader marker is no longer on space ${effect.toStep}. Move it back, or undo the later advances first.`,
        ),
      )
    }

    // A Great Person space also put a marker in the owner's area, which has to be
    // there still. A record saved before the markers existed has none.
    const greatPersonMarker = effect.marker ?? null
    if (greatPersonMarker !== null) {
      const blockedBy = markerUndoBlock(state, record.playerId, greatPersonMarker)
      if (blockedBy !== undefined) return err(refused(blockedBy))
    }

    const paidBack: Playerhand = {
      ...player,
      stats: {
        ...player.stats,
        culture: player.stats.culture + effect.culture,
        trade: player.stats.trade + effect.trade,
      },
    }
    const restored = restoreDrawnCards(
      withPlayerHand(state, paidBack),
      paidBack,
      record.id,
      [...effect.drawn, ...(effect.rejected ?? [])],
      effect.kept,
      effect.sheetName,
    )
    if (!restored.ok) return restored

    let deck = restored.value
    if (greatPersonMarker !== null) {
      const removed = removeGreatPersonMarker(deck, record, greatPersonMarker, at)
      if (!removed.ok) return err(refused(removed.error))
      deck = removed.value
    }

    const movedBack = movePieceUnchecked(deck, {
      playerId: record.playerId,
      pieceId: effect.markerPieceId,
      x: effect.markerFrom.x,
      y: effect.markerFrom.y,
      snap: false,
      ...(at === null ? {} : { at }),
    })
    if (movedBack === undefined) return err(refused('The leader marker could not be moved back.'))

    return ok({
      state: movedBack,
      text:
        `${player.username}'s culture advance was undone: the leader marker is back on space ${effect.fromStep}, ` +
        `${describeCost(effect)} returned and the drawn cards were put back in the deck` +
        removedMarkerText(greatPersonMarker),
    })
  },
}

export const chooseReward: AssistedActionDefinition = {
  kind: 'chooseReward',
  techName: null,
  label: 'Choose reward',
  button: false,
  usageKey: null,
  phase: 'ANY',
  group: 'Culture track',

  availability(state, playerId) {
    const player = playerOf(state, playerId)
    if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
    if (player.pendingRewards.length === 0) {
      return blocked('unavailable', 'You have no card choice waiting.')
    }
    return { status: 'ready', reason: 'Choose the card to keep.' }
  },

  apply(state, player, context) {
    const failed = (reason: string): EngineError =>
      rejected('chooseReward', blocked('unavailable', reason))
    const payload =
      context.payload !== undefined && 'rewardId' in context.payload ? context.payload : undefined
    if (payload === undefined) return err(failed('Say which reward and which card.'))

    const reward = player.pendingRewards.find((candidate) => candidate.id === payload.rewardId)
    if (reward === undefined) {
      return err(failed('That card choice is not waiting any more. It may already have been made.'))
    }
    if (!livePendingRewards(player).includes(reward)) {
      // Every candidate has left the hand: nothing is left to choose, so the entry
      // is removed instead of blocking the next advance for good.
      const cleared = withPlayerHand(state, {
        ...player,
        pendingRewards: player.pendingRewards.filter((candidate) => candidate.id !== reward.id),
      })
      const line = appendLog(cleared, {
        username: player.username,
        playerId: player.playerId,
        publicLog: `${player.username} had no card left to choose, so the card choice was dropped`,
        privateLog: '',
        createdAt: context.at ?? null,
      })
      return ok({
        state: line,
        effect: { kind: 'chooseReward', rewardId: reward.id, itemId: null },
        logId: lastLogId(line),
      })
    }
    if (!reward.candidateIds.includes(payload.itemId)) {
      return err(failed('That card is not one of the choices.'))
    }
    const kept = player.items.find((item) => item.id === payload.itemId)
    if (kept === undefined) return err(failed('That card is no longer in your hand.'))

    // A Great Person is kept together with its marker. A reward from before the
    // markers existed (its record has no `rejected` list) keeps the old, by-hand step.
    const origin = state.assistedActions.find((record) => record.id === reward.id)
    const takesMarker =
      reward.kind === 'greatPerson' &&
      origin !== undefined &&
      origin.effect.kind === 'cultureAdvance' &&
      origin.effect.rejected !== undefined
    let board = state
    let marker: GreatPersonMarker | null = null
    if (takesMarker) {
      const taken = takeGreatPersonMarker(state, player, kept, context.at)
      if (!taken.ok) return err(failed(taken.error))
      board = taken.value.state
      marker = taken.value.marker
    }

    // The others leave the hand for the discard pile, as `discardItem` leaves them
    // (`hidden: true` is only the stored flag). The discard pile is public: the
    // revealed and discarded feed lists them by name, attributed to the player,
    // exactly as for any discard. Only the card kept stays secret.
    const others = player.items.filter(
      (item) => item.id !== kept.id && reward.candidateIds.includes(item.id),
    )
    const otherIds = new Set(others.map((item) => item.id))
    const discarded = withPlayerHand(
      {
        ...board,
        discardedItems: [...board.discardedItems, ...others.map((item): Item => ({ ...item, hidden: true }))],
        assistedActions: board.assistedActions.map((record) =>
          record.id === reward.id && record.effect.kind === 'cultureAdvance'
            ? {
                ...record,
                effect: { ...record.effect, kept: kept.id, ...(marker === null ? {} : { marker }) },
              }
            : record,
        ),
      },
      {
        ...player,
        items: player.items.filter((item) => !otherIds.has(item.id)),
        pendingRewards: player.pendingRewards.filter((candidate) => candidate.id !== reward.id),
      },
    )

    const publicLine = appendLog(discarded, {
      username: player.username,
      playerId: player.playerId,
      publicLog:
        marker === null
          ? `${player.username} kept a card`
          : `${player.username} took a ${markerLabelOf(marker.assetId)} great person marker into reserve`,
      privateLog: '',
      createdAt: context.at ?? null,
    })
    const logId = lastLogId(publicLine)
    const logged = appendLog(publicLine, {
      username: player.username,
      playerId: player.playerId,
      privateLog:
        `${player.username} kept ${itemName(kept)}` +
        (others.length === 0 ? '' : ` and discarded ${others.map(itemName).join(', ')}`),
      createdAt: context.at ?? null,
    })
    return ok({
      state: countLinesIn(logged, [marker?.historyId]),
      effect: { kind: 'chooseReward', rewardId: reward.id, itemId: kept.id },
      logId,
    })
  },

  // Choosing is undone by undoing the advance, whose line is the one the vote targets.
  reverse(_state, _player, record) {
    return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
  },
}

