/**
 * The Start of Turn actions that change numbers and ownership (assisted play, part 9):
 * social policies, government abilities, changing government and investing a coin.
 *
 * Every one is a button with a log line and an undo through the vote the game already
 * has. The rules and who said them are in `docs/agents/tasks/assisted-sot.md`; what is
 * open to the player in this phase is worked out in `sot.ts`.
 *
 * An ability that only adds trade or culture is one definition built from a row
 * ({@link statGainAction}), so a new wonder or Great Person that does the same is a
 * table entry and not a copy of the code.
 */

import { placeUnchecked, removePiece } from './actions/board.js'
import {
  REPEAT_NOTE,
  blocked,
  lastLogId,
  playerOf,
  rejected,
  useTurnAction,
  usedReason,
  withPlayerHand,
} from './assisted-core.js'
import type {
  AssistedActionDefinition,
  AssistedPayload,
  BlockedAvailability,
  GovernmentPayload,
  HarvestPayload,
  InvestPayload,
} from './assisted-core.js'
import {
  drawCandidates,
  livePendingRewards,
  performAdvance,
  restoreDrawnCards,
  reverseAdvanceEffect,
} from './assisted-culture.js'
import { AREA_LABEL_HEIGHT, findBoardAsset, playerAreas, remainingBoardAssetCount } from './board.js'
import { cityFootprintsOf, pieceColorOf } from './blockade.js'
import { cityProductionsOf } from './city-production.js'
import { coinSourcesOf, findCoinSource, withCoinSource } from './coins.js'
import type { CoinSourceKey } from './coins.js'
import { cultureMarkerOf, rewardDrawCount } from './culture-track.js'
import type { CultureLevel } from './culture-track.js'
import { err, ok } from './result.js'
import type { Item } from './item.js'
import { itemName } from './item.js'
import { appendLog } from './log.js'
import type { SheetName } from './sheet-name.js'
import { SHEET_LABEL } from './sheet-name.js'
import {
  INVESTABLE_COIN_SOURCES,
  INVESTMENT_CARDS,
  SOT_PHASE_REASON,
  canEnterAnarchy,
  controlledCityStates,
  figuresOnMap,
  governmentOptionsOf,
  investableCoinsOf,
  openStartOfTurn,
  statsAfterGovernmentChange,
} from './sot.js'
import type {
  AssistedActionKind,
  GameState,
  InvestmentCard,
  PendingReward,
  Playerhand,
  StartOfTurnView,
  TechGrant,
} from './state.js'
import { turnStatus } from './turn.js'
import type { PlayerTurn } from './turn.js'
import { isGovernment } from './government.js'
import type { Government } from './government.js'

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`
const ROMAN = ['', 'I', 'II', 'III'] as const

/** "3 trade", "2 culture", "1 trade and 2 culture". */
function describeGain(gain: { readonly trade: number; readonly culture: number }): string {
  const parts = [
    ...(gain.trade > 0 ? [`${gain.trade} trade`] : []),
    ...(gain.culture > 0 ? [`${gain.culture} culture`] : []),
  ]
  return parts.length === 0 ? 'nothing' : parts.join(' and ')
}

// ---------------------------------------------------------------------------
// The gate every Start of Turn action passes
// ---------------------------------------------------------------------------

type Gate = { readonly blocked: BlockedAvailability } | { readonly turn: PlayerTurn }

/**
 * Start of Turn must be the player's open phase, and the usage key must be free (or the
 * player has confirmed a repeat). `strict` actions say plainly that the rule allows one use.
 */
function startOfTurnGate(
  state: GameState,
  player: Playerhand,
  options: { readonly usageKey: string | null; readonly label: string; readonly strict?: boolean; readonly allowRepeat?: boolean },
): Gate {
  const turn = openStartOfTurn(state, player)
  if (turn === undefined) return { blocked: blocked('wrong-phase', SOT_PHASE_REASON) }
  if (options.usageKey !== null && turn.usedActions.includes(options.usageKey) && options.allowRepeat !== true) {
    return {
      blocked: blocked(
        'used',
        options.strict === true ? `${options.label} has already been done this turn.` : usedReason(options.label),
      ),
    }
  }
  return { turn }
}

const EXPANSIONISM = ['Expansionsim', 'Expansionism'] as const

/** The policy must be adopted, revealed and not switched off by Anarchy. */
function policyBlock(player: Playerhand, names: readonly string[], label: string): BlockedAvailability | undefined {
  const policy = player.socialPolicies.find((candidate) => names.includes(candidate.name))
  if (policy === undefined) return blocked('not-owned', `You have not adopted ${label}.`)
  if (policy.hidden) return blocked('unavailable', `Reveal ${label} before using it.`)
  if (player.government === 'Anarchy') {
    return blocked('unavailable', 'Your social policies have no effect under Anarchy.')
  }
  return undefined
}

/** The government must be the one in play. */
const governmentBlock = (player: Playerhand, government: Government): BlockedAvailability | undefined =>
  player.government === government
    ? undefined
    : blocked('not-owned', `Your government is ${player.government}, not ${government}.`)

const cityPiecesOf = (state: GameState, player: Playerhand) => {
  const colour = player.color?.toLowerCase()
  return state.board.pieces.filter(
    (piece) => piece.category === 'city' && colour !== undefined && pieceColorOf(piece) === colour,
  )
}

// ---------------------------------------------------------------------------
// Abilities that add trade or culture
// ---------------------------------------------------------------------------

interface StatGain {
  readonly trade: number
  readonly culture: number
  /** Where the number comes from, as the button explains it. */
  readonly text: string
}

interface StatGainSpec {
  readonly kind: AssistedActionKind
  /** What the action is called in lists, lines and undo requests. */
  readonly label: string
  readonly group: string
  readonly usageKey: string
  /** The card or government that must be in play: a reason when it is not, nothing when it is. */
  readonly block: (state: GameState, player: Playerhand) => BlockedAvailability | undefined
  readonly gain: (state: GameState, player: Playerhand) => StatGain
}

/**
 * An ability that only adds trade and culture. Ready in the player's Start of Turn
 * while its card or government is in play, once per turn (a player may confirm a repeat
 * when a card grants one). Undoing it takes the same numbers off again.
 */
export function statGainAction(spec: StatGainSpec): AssistedActionDefinition {
  const gate = (state: GameState, player: Playerhand, allowRepeat: boolean): Gate | BlockedAvailability => {
    const missing = spec.block(state, player)
    if (missing !== undefined) return missing
    return startOfTurnGate(state, player, { usageKey: spec.usageKey, label: spec.label, allowRepeat })
  }
  return {
    kind: spec.kind,
    techName: null,
    label: spec.label,
    button: true,
    usageKey: spec.usageKey,
    phase: 'SOT',
    group: spec.group,

    availability(state, playerId) {
      const player = playerOf(state, playerId)
      if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
      const passed = gate(state, player, false)
      if ('status' in passed) return passed
      if ('blocked' in passed) return passed.blocked
      const gain = spec.gain(state, player)
      return { status: 'ready', reason: `Gain ${describeGain(gain)}: ${gain.text}.` }
    },

    apply(state, player, context) {
      const passed = gate(state, player, context.confirmedRepeat)
      if ('status' in passed) return err(rejected(spec.kind, passed))
      if ('blocked' in passed) return err(rejected(spec.kind, passed.blocked))
      const gain = spec.gain(state, player)
      const stats = {
        ...player.stats,
        trade: player.stats.trade + gain.trade,
        culture: player.stats.culture + gain.culture,
      }
      const used = useTurnAction(state, player, passed.turn, spec.usageKey, stats)
      const logged = appendLog(used, {
        username: player.username,
        playerId: player.playerId,
        publicLog:
          `${player.username} used ${spec.label}: gained ${describeGain(gain)}` +
          (context.confirmedRepeat ? REPEAT_NOTE : ''),
        privateLog: '',
        createdAt: context.at ?? null,
        assistedActionId: context.requestId,
      })
      return ok({
        state: logged,
        effect: { kind: 'statGain', trade: gain.trade, culture: gain.culture, subject: spec.label },
        logId: lastLogId(logged),
      })
    },

    reverse(state, player, record) {
      const effect = record.effect
      if (effect.kind !== 'statGain') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
      const stats = {
        ...player.stats,
        trade: Math.max(0, player.stats.trade - effect.trade),
        culture: Math.max(0, player.stats.culture - effect.culture),
      }
      return ok({
        state: withPlayerHand(state, { ...player, stats }),
        text: `${player.username}'s ${effect.subject} was undone: ${describeGain(effect)} removed`,
      })
    },
  }
}

const expansionism = statGainAction({
  kind: 'expansionism',
  label: 'Expansionism',
  group: 'Social policies',
  usageKey: 'policy:Expansionism',
  block: (_state, player) => policyBlock(player, EXPANSIONISM, 'Expansionism'),
  gain(state, player) {
    const cities = cityPiecesOf(state, player).length
    const cityStates = controlledCityStates(state, player).length
    return {
      trade: cities + cityStates,
      culture: 0,
      text: `1 for each of your ${cities === 1 ? '1 city' : `${cities} cities`} and 1 for each of your ${plural(cityStates, 'city-state')}`,
    }
  },
})

const pacifism = statGainAction({
  kind: 'pacifism',
  label: 'Pacifism',
  group: 'Social policies',
  usageKey: 'policy:Pacifism',
  block: (_state, player) => policyBlock(player, ['Pacifism'], 'Pacifism'),
  gain(state, player) {
    const scouts = figuresOnMap(state, player, 'scout').length
    return {
      trade: 0,
      culture: scouts > 0 ? 2 : 1,
      text: scouts > 0 ? '1, and 1 more because you have a scout on the map' : '1, and 1 more if you had a scout on the map',
    }
  },
})

const democracyTrade = statGainAction({
  kind: 'democracyTrade',
  label: 'Democracy government',
  group: 'Government',
  usageKey: 'government:Democracy',
  block: (_state, player) => governmentBlock(player, 'Democracy'),
  gain: () => ({ trade: 2, culture: 0, text: 'the Start of Turn ability of the Democracy government' }),
})

const fundamentalismCulture = statGainAction({
  kind: 'fundamentalismCulture',
  label: 'Fundamentalism government',
  group: 'Government',
  usageKey: 'government:Fundamentalism',
  block: (_state, player) => governmentBlock(player, 'Fundamentalism'),
  gain(state, player) {
    const armies = figuresOnMap(state, player, 'army').length
    return { trade: 0, culture: armies, text: `1 for each of your ${armies === 1 ? '1 army' : `${armies} armies`} on the map` }
  },
})

// ---------------------------------------------------------------------------
// Rationalism: trade for a free tech
// ---------------------------------------------------------------------------

interface RationalismRow {
  readonly kind: 'rationalismI' | 'rationalismII'
  readonly level: 1 | 2
  readonly cost: number
}

const RATIONALISM: readonly RationalismRow[] = [
  { kind: 'rationalismI', level: 1, cost: 6 },
  { kind: 'rationalismII', level: 2, cost: 11 },
]

function rationalism(row: RationalismRow): AssistedActionDefinition {
  const label = `Rationalism, level ${ROMAN[row.level]} tech`
  const usageKey = `policy:Rationalism:${row.level}`
  const gate = (state: GameState, player: Playerhand, allowRepeat: boolean): Gate | BlockedAvailability => {
    const missing = policyBlock(player, ['Rationalism'], 'Rationalism')
    if (missing !== undefined) return missing
    const open = startOfTurnGate(state, player, { usageKey, label, allowRepeat })
    if ('blocked' in open) return open
    if (player.stats.trade < row.cost) {
      return blocked(
        'needs-resource',
        `Spend ${row.cost} trade to learn a level ${ROMAN[row.level]} tech. You have ${player.stats.trade}.`,
      )
    }
    return open
  }
  return {
    kind: row.kind,
    techName: null,
    label,
    button: true,
    usageKey,
    phase: 'SOT',
    group: 'Social policies',

    availability(state, playerId) {
      const player = playerOf(state, playerId)
      if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
      const passed = gate(state, player, false)
      if ('status' in passed) return passed
      if ('blocked' in passed) return passed.blocked
      return {
        status: 'ready',
        reason:
          `Spend ${row.cost} trade, then choose and reveal a level ${ROMAN[row.level]} tech in the tech tree. ` +
          'Learning is not researching: no coins keep any trade.',
      }
    },

    apply(state, player, context) {
      const passed = gate(state, player, context.confirmedRepeat)
      if ('status' in passed) return err(rejected(row.kind, passed))
      if ('blocked' in passed) return err(rejected(row.kind, passed.blocked))
      const grant: TechGrant = {
        id: context.requestId,
        source: 'Rationalism',
        level: row.level,
        turnNumber: turnStatus(state).currentTurn,
      }
      const stats = { ...player.stats, trade: player.stats.trade - row.cost }
      const used = useTurnAction(state, { ...player, techGrants: [...player.techGrants, grant] }, passed.turn, usageKey, stats)
      const logged = appendLog(used, {
        username: player.username,
        playerId: player.playerId,
        publicLog:
          `${player.username} used Rationalism: spent ${row.cost} trade to learn a level ${ROMAN[row.level]} tech` +
          (context.confirmedRepeat ? REPEAT_NOTE : ''),
        privateLog: '',
        createdAt: context.at ?? null,
        assistedActionId: context.requestId,
      })
      return ok({
        state: logged,
        effect: { kind: 'techGrant', trade: row.cost, grantId: grant.id, subject: label },
        logId: lastLogId(logged),
      })
    },

    reverse(state, player, record) {
      const effect = record.effect
      if (effect.kind !== 'techGrant') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
      if (!player.techGrants.some((grant) => grant.id === effect.grantId)) {
        return err({
          kind: 'ASSISTED_UNDO_BLOCKED',
          logId: record.logId,
          reason: 'The tech this paid for has been learned already. Remove that tech first.',
        })
      }
      const back: Playerhand = {
        ...player,
        stats: { ...player.stats, trade: player.stats.trade + effect.trade },
        techGrants: player.techGrants.filter((grant) => grant.id !== effect.grantId),
      }
      return ok({
        state: withPlayerHand(state, back),
        text: `${player.username}'s ${effect.subject} was undone: ${effect.trade} trade returned`,
      })
    },
  }
}

// ---------------------------------------------------------------------------
// Patronage: culture for a culture event card
// ---------------------------------------------------------------------------

/** The level of the culture track section a marker stands in. Start counts as the first section. */
export const levelOfMarker = (step: number): CultureLevel => (step <= 7 ? 1 : step <= 14 ? 2 : 3)

const levelSheet = (level: CultureLevel): SheetName =>
  level === 1 ? 'CULTURE_1' : level === 2 ? 'CULTURE_2' : 'CULTURE_3'

interface PatronagePlan {
  readonly turn: PlayerTurn
  readonly level: CultureLevel
  readonly sheetName: SheetName
  readonly count: number
}

function planPatronage(
  state: GameState,
  player: Playerhand,
  allowRepeat: boolean,
): { readonly plan: PatronagePlan } | { readonly blocked: BlockedAvailability } {
  const missing = policyBlock(player, ['Patronage'], 'Patronage')
  if (missing !== undefined) return { blocked: missing }
  const open = startOfTurnGate(state, player, { usageKey: 'policy:Patronage', label: 'Patronage', allowRepeat })
  if ('blocked' in open) return open
  const marker = cultureMarkerOf(state, player)
  if (marker === undefined) return { blocked: blocked('unavailable', 'Your leader marker is not on the culture track.') }
  const level = levelOfMarker(marker.step)
  if (livePendingRewards(player).length > 0) {
    return { blocked: blocked('unavailable', 'Choose the card to keep from your last advance first.') }
  }
  if (player.stats.culture < 1) {
    return { blocked: blocked('needs-resource', 'Spend 1 culture to draw a culture event card. You have none.') }
  }
  const sheetName = levelSheet(level)
  if (![...state.items, ...state.discardedItems].some((item) => item.sheetName === sheetName)) {
    return { blocked: blocked('unavailable', `There are no ${SHEET_LABEL[sheetName]} cards left to draw.`) }
  }
  return { plan: { turn: open.turn, level, sheetName, count: rewardDrawCount(state, player, 'event') } }
}

const patronage: AssistedActionDefinition = {
  kind: 'patronage',
  techName: null,
  label: 'Patronage',
  button: true,
  usageKey: 'policy:Patronage',
  phase: 'SOT',
  group: 'Social policies',

  availability(state, playerId) {
    const player = playerOf(state, playerId)
    if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
    const planned = planPatronage(state, player, false)
    if ('blocked' in planned) return planned.blocked
    const { level, count } = planned.plan
    return {
      status: 'ready',
      reason: `Spend 1 culture to draw ${plural(count, `culture ${ROMAN[level]} card`)}, of the level your marker is in, and keep one.`,
    }
  },

  apply(state, player, context) {
    const planned = planPatronage(state, player, context.confirmedRepeat)
    if ('blocked' in planned) return err(rejected('patronage', planned.blocked))
    const { turn, level, sheetName, count } = planned.plan
    const drawn = drawCandidates(state, sheetName, count)
    if (!drawn.ok) return drawn
    const candidates = drawn.value.items.map((item): Item => ({ ...item, ownerId: player.playerId, hidden: true }))
    const paying = playerOf(drawn.value.state, player.playerId) ?? player
    const resolved = candidates.length === 1
    const marker = cultureMarkerOf(state, player)
    const reward: PendingReward = {
      id: context.requestId,
      kind: 'event',
      level,
      step: marker?.step ?? 0,
      candidateIds: candidates.map((item) => item.id),
      keep: 1,
    }
    const stats = { ...paying.stats, culture: paying.stats.culture - 1 }
    const used = useTurnAction(
      drawn.value.state,
      {
        ...paying,
        items: [...paying.items, ...candidates],
        pendingRewards: resolved ? livePendingRewards(paying) : [...livePendingRewards(paying), reward],
      },
      turn,
      'policy:Patronage',
      stats,
    )
    const names = candidates.map(itemName).join(', ')
    const publicLine = appendLog(used, {
      username: player.username,
      playerId: player.playerId,
      publicLog:
        `${player.username} used Patronage: spent 1 culture and drew ${plural(candidates.length, `culture ${ROMAN[level]} card`)}` +
        (context.confirmedRepeat ? REPEAT_NOTE : ''),
      privateLog: '',
      createdAt: context.at ?? null,
      assistedActionId: context.requestId,
    })
    const logId = lastLogId(publicLine)
    const logged = appendLog(publicLine, {
      username: player.username,
      playerId: player.playerId,
      privateLog: resolved
        ? `${player.username} drew ${names} (${SHEET_LABEL[sheetName]}) and kept it`
        : `${player.username} drew ${names} (${SHEET_LABEL[sheetName]}), keeps one`,
      createdAt: context.at ?? null,
    })
    return ok({
      state: logged,
      effect: {
        kind: 'patronage',
        culture: 1,
        level,
        sheetName,
        drawn: reward.candidateIds,
        kept: resolved ? (reward.candidateIds[0] ?? null) : null,
      },
      logId,
    })
  },

  reverse(state, player, record) {
    const effect = record.effect
    if (effect.kind !== 'patronage') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    const paidBack: Playerhand = { ...player, stats: { ...player.stats, culture: player.stats.culture + effect.culture } }
    const restored = restoreDrawnCards(
      withPlayerHand(state, paidBack),
      paidBack,
      record.id,
      effect.drawn,
      effect.kept,
      effect.sheetName,
    )
    if (!restored.ok) {
      return err({
        kind: 'ASSISTED_UNDO_BLOCKED',
        logId: record.logId,
        reason: 'A card this drew has left the hand, so Patronage cannot be undone.',
      })
    }
    return ok({
      state: restored.value,
      text: `${player.username}'s Patronage was undone: 1 culture returned and the drawn cards were put back in the deck`,
    })
  },
}

// ---------------------------------------------------------------------------
// Feudalism: harvest a resource
// ---------------------------------------------------------------------------

/** What a city can harvest: the four market resources. Uranium only comes from villages. */
export const HARVESTABLE_RESOURCES: readonly string[] = ['Incense', 'Iron', 'Silk', 'Wheat']

const harvestPayloadOf = (payload: AssistedPayload | undefined): HarvestPayload | undefined =>
  payload !== undefined && 'cityPieceId' in payload && 'resource' in payload && !('targets' in payload) && !('item' in payload)
    ? { cityPieceId: payload.cityPieceId, resource: String(payload.resource) }
    : undefined

const resourceAssetId = (resource: string): string => `resources/${resource.toLowerCase()}`

const feudalismHarvest: AssistedActionDefinition = {
  kind: 'feudalismHarvest',
  techName: null,
  label: 'Feudalism government',
  button: false,
  usageKey: 'government:Feudalism',
  phase: 'SOT',
  group: 'Government',

  availability(state, playerId) {
    const player = playerOf(state, playerId)
    if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
    const missing = governmentBlock(player, 'Feudalism')
    if (missing !== undefined) return missing
    const open = startOfTurnGate(state, player, { usageKey: 'government:Feudalism', label: 'Feudalism government' })
    if ('blocked' in open) return open.blocked
    if (cityPiecesOf(state, player).length === 0) return blocked('unavailable', 'You have no city on the map.')
    return {
      status: 'ready',
      reason: 'Harvest a resource from the outskirts of one of your cities, as the Start of Turn ability of Feudalism.',
    }
  },

  apply(state, player, context) {
    const payload = harvestPayloadOf(context.payload)
    const fail = (reason: string) => err(rejected('feudalismHarvest', blocked('unavailable', reason)))
    if (payload === undefined) return fail('Choose the city and the resource.')
    const missing = governmentBlock(player, 'Feudalism')
    if (missing !== undefined) return err(rejected('feudalismHarvest', missing))
    const open = startOfTurnGate(state, player, {
      usageKey: 'government:Feudalism',
      label: 'Feudalism government',
      allowRepeat: context.confirmedRepeat,
    })
    if ('blocked' in open) return err(rejected('feudalismHarvest', open.blocked))
    if (!HARVESTABLE_RESOURCES.includes(payload.resource)) {
      return fail(`Choose a resource: ${HARVESTABLE_RESOURCES.join(', ')}.`)
    }
    const colour = player.color?.toLowerCase()
    const city = colour === undefined ? undefined : cityFootprintsOf(state, colour).find((view) => view.piece.id === payload.cityPieceId)
    if (city === undefined) return fail('That is not one of your cities on the map.')
    const assetId = resourceAssetId(payload.resource)
    const asset = findBoardAsset(assetId)
    if (asset === undefined) return fail(`There is no ${payload.resource} token to place.`)
    if ((remainingBoardAssetCount(asset, state.board.pieces, state.numOfPlayers) ?? 0) <= 0) {
      return fail(`The market has no ${payload.resource} left.`)
    }
    const area = playerAreas(state.board, state.players).find((candidate) => candidate.playerId === player.playerId)
    if (area === undefined) return fail('You have no player area on the board to put the token in.')

    const placed = placeUnchecked(state, {
      playerId: player.playerId,
      assetId,
      x: area.x + 20,
      y: area.y + AREA_LABEL_HEIGHT + 10,
      ...(context.at === undefined ? {} : { at: context.at }),
    })
    const entry = placed?.board.history.at(-1)
    if (placed === undefined || entry === undefined || entry.change.kind !== 'place') {
      return fail('The token could not be placed.')
    }
    const piece = entry.change.piece
    const cityLabel = cityProductionsOf(state, player).find((candidate) => candidate.pieceId === payload.cityPieceId)?.label ?? 'a city'
    const holder = playerOf(placed, player.playerId) ?? player
    const used = useTurnAction(placed, holder, open.turn, 'government:Feudalism', holder.stats)
    const logged = appendLog(used, {
      username: player.username,
      playerId: player.playerId,
      publicLog:
        `${player.username} used the Feudalism government: harvested ${payload.resource} in the outskirts of ${cityLabel}` +
        (context.confirmedRepeat ? REPEAT_NOTE : ''),
      privateLog: '',
      createdAt: context.at ?? null,
      assistedActionId: context.requestId,
    })
    const counted: GameState = {
      ...logged,
      board: {
        ...logged.board,
        history: logged.board.history.map((candidate) =>
          candidate.id === entry.id ? { ...candidate, logLength: logged.log.length } : candidate,
        ),
      },
    }
    return ok({
      state: counted,
      effect: {
        kind: 'harvest',
        resource: payload.resource,
        pieceId: piece.id,
        position: { x: piece.x, y: piece.y },
        historyId: entry.id,
      },
      logId: lastLogId(logged),
    })
  },

  reverse(state, player, record, at) {
    const effect = record.effect
    if (effect.kind !== 'harvest') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    const piece = state.board.pieces.find((candidate) => candidate.id === effect.pieceId)
    const area = playerAreas(state.board, state.players).find((candidate) => candidate.playerId === player.playerId)
    if (piece === undefined || area === undefined) {
      return err({
        kind: 'ASSISTED_UNDO_BLOCKED',
        logId: record.logId,
        reason: `The ${effect.resource} token is no longer on the board, so the harvest cannot be undone.`,
      })
    }
    const centre = { x: piece.x + piece.width / 2, y: piece.y + piece.height / 2 }
    const inArea = centre.x >= area.x && centre.x <= area.x + area.width && centre.y >= area.y && centre.y <= area.y + area.height
    if (!inArea) {
      return err({
        kind: 'ASSISTED_UNDO_BLOCKED',
        logId: record.logId,
        reason: `The ${effect.resource} token has left your player area. Move it back first.`,
      })
    }
    const removed = removeBoardPiece(state, player.playerId, effect.pieceId, at)
    if (removed === undefined) {
      return err({
        kind: 'ASSISTED_UNDO_BLOCKED',
        logId: record.logId,
        reason: `The ${effect.resource} token could not be taken off the board.`,
      })
    }
    return ok({
      state: removed,
      text: `${player.username}'s Feudalism harvest was undone: the ${effect.resource} token went back to the market`,
    })
  },
}

/** Takes a piece off the board through the board history; `undefined` when the board refuses. */
function removeBoardPiece(state: GameState, playerId: string, pieceId: string, at: string | null): GameState | undefined {
  const removed = removePiece(state, { playerId, pieceId, ...(at === null ? {} : { at }) })
  return removed.ok ? removed.value : undefined
}

// ---------------------------------------------------------------------------
// Changing government
// ---------------------------------------------------------------------------

const governmentPayloadOf = (payload: AssistedPayload | undefined): GovernmentPayload | undefined =>
  payload !== undefined && 'government' in payload && isGovernment(String(payload.government))
    ? { government: payload.government }
    : undefined

const SWITCH_KEY = 'government:switch'

const switchGovernment: AssistedActionDefinition = {
  kind: 'switchGovernment',
  techName: null,
  label: 'Change government',
  button: false,
  usageKey: SWITCH_KEY,
  phase: 'SOT',
  group: 'Government',
  strictOnce: true,

  availability(state, playerId) {
    const player = playerOf(state, playerId)
    if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
    const open = startOfTurnGate(state, player, { usageKey: SWITCH_KEY, label: 'Changing government', strict: true })
    if ('blocked' in open) return open.blocked
    const options = governmentOptionsOf(state, player)
    if (options.length === 0 && !canEnterAnarchy(state, player)) {
      return blocked('unavailable', 'You know no other government to change to.')
    }
    return { status: 'ready', reason: 'You may change government once in your Start of Turn.' }
  },

  apply(state, player, context) {
    const payload = governmentPayloadOf(context.payload)
    const fail = (reason: string) => err(rejected('switchGovernment', blocked('unavailable', reason)))
    if (payload === undefined) return fail('Choose the government.')
    const open = startOfTurnGate(state, player, { usageKey: SWITCH_KEY, label: 'Changing government', strict: true })
    if ('blocked' in open) return err(rejected('switchGovernment', open.blocked))
    const target = payload.government
    if (target === player.government) return fail(`Your government is ${target} already.`)

    if (target === 'Anarchy') {
      if (!canEnterAnarchy(state, player)) return fail('You are immune to Anarchy, or already in it.')
    } else {
      const option = governmentOptionsOf(state, player).find((candidate) => candidate.government === target)
      if (option === undefined) return fail(`You have not unlocked ${target}.`)
      if (option.route === 'anarchy') {
        return fail(`You can only change to ${target} through Anarchy. Change to Anarchy now and take ${target} next Start of Turn.`)
      }
    }

    const stats = statsAfterGovernmentChange(player, target)
    const changed: Playerhand = { ...player, government: target, stats }
    const used = useTurnAction(state, changed, open.turn, SWITCH_KEY, stats)
    const note =
      target === 'Anarchy'
        ? ' (Anarchy: your capital takes no action this turn and your social policies have no effect)'
        : ''
    const logged = appendLog(used, {
      username: player.username,
      playerId: player.playerId,
      publicLog: `${player.username} changed government from ${player.government} to ${target}${note}`,
      privateLog: '',
      createdAt: context.at ?? null,
      assistedActionId: context.requestId,
    })
    return ok({
      state: logged,
      effect: {
        kind: 'switchGovernment',
        from: player.government,
        to: target,
        democracyCoin: player.stats.coinSources.democracyGovernment,
        religionCoin: player.stats.coinSources.organizedReligion,
      },
      logId: lastLogId(logged),
    })
  },

  reverse(state, player, record) {
    const effect = record.effect
    if (effect.kind !== 'switchGovernment') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    if (player.government !== effect.to) {
      return err({
        kind: 'ASSISTED_UNDO_BLOCKED',
        logId: record.logId,
        reason: `The government is ${player.government} now, not ${effect.to}. Set it back by hand first.`,
      })
    }
    const stats = statsAfterGovernmentChange(player, effect.from)
    const restoredStats = {
      ...stats,
      coinSources: withCoinSource(
        withCoinSource(stats.coinSources, 'democracyGovernment', effect.democracyCoin),
        'organizedReligion',
        effect.religionCoin,
      ),
    }
    return ok({
      state: withPlayerHand(state, { ...player, government: effect.from, stats: restoredStats }),
      text: `${player.username}'s change of government was undone: back to ${effect.from}`,
    })
  },
}

// ---------------------------------------------------------------------------
// Investing a coin
// ---------------------------------------------------------------------------

const INVEST_KEY = 'invest'

const investPayloadOf = (payload: AssistedPayload | undefined): InvestPayload | undefined =>
  payload !== undefined && 'card' in payload && 'source' in payload
    ? { source: String(payload.source), card: payload.card }
    : undefined

const investmentCardOf = (key: InvestmentCard) => INVESTMENT_CARDS.find((card) => card.key === key)

const invest: AssistedActionDefinition = {
  kind: 'invest',
  techName: null,
  label: 'Invest a coin',
  button: false,
  usageKey: INVEST_KEY,
  phase: 'SOT',
  group: 'Investments',
  strictOnce: true,

  availability(state, playerId) {
    const player = playerOf(state, playerId)
    if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
    const open = startOfTurnGate(state, player, { usageKey: INVEST_KEY, label: 'Investing', strict: true })
    if ('blocked' in open) return open.blocked
    if (investableCoinsOf(state, player).length === 0) {
      return blocked(
        'needs-resource',
        'You have no coin token to invest. Only coins on your sheet and on tech cards can be invested, not printed coins.',
      )
    }
    return { status: 'ready', reason: 'Invest one coin token this turn, and put the marker on one of your investment cards.' }
  },

  apply(state, player, context) {
    const payload = investPayloadOf(context.payload)
    const fail = (reason: string) => err(rejected('invest', blocked('unavailable', reason)))
    if (payload === undefined) return fail('Choose the coin and the investment card.')
    const open = startOfTurnGate(state, player, { usageKey: INVEST_KEY, label: 'Investing', strict: true })
    if ('blocked' in open) return err(rejected('invest', open.blocked))
    const card = investmentCardOf(payload.card)
    if (card === undefined) return fail('Choose one of your four investment cards.')
    const source = payload.source as CoinSourceKey
    if (!INVESTABLE_COIN_SOURCES.includes(source) || findCoinSource(source) === undefined) {
      return fail('That coin cannot be invested. Only coin tokens on your sheet and on tech cards can.')
    }
    if ((coinSourcesOf(state, player)[source] ?? 0) < 1) return fail('There is no coin there to invest.')

    // The Arabs advance one space for free with every coin they invest (civilization sheet)
    let working = state
    let advance = null as ReturnType<typeof performAdvance> | null
    if (player.civilization?.name === 'Arabs') {
      advance = performAdvance(state, player, { requestId: context.requestId, at: context.at }, { free: true, tagLog: false })
      // At the end of the track, or without a marker, there is nothing to advance; anything else refuses
      if (!advance.ok) {
        const refusal = advance.error
        const text = refusal.kind === 'ASSISTED_ACTION_REJECTED' ? refusal.reason : ''
        const nothingToAdvance = /Culture Victory space|leader marker is not on/.test(text)
        if (!nothingToAdvance) return advance
        advance = null
      } else {
        working = advance.value.state
      }
    }

    const current = playerOf(working, player.playerId) ?? player
    const markers = current.stats[card.key] + 1
    const stats = {
      ...current.stats,
      coinSources: withCoinSource(current.stats.coinSources, source, current.stats.coinSources[source] - 1),
      [card.key]: markers,
    }
    // Public Education activates at 3, 6 and 9 markers: a tech of the player's choice for free
    const grant: TechGrant | null =
      card.key === 'pe' && card.thresholds.includes(markers)
        ? { id: context.requestId, source: 'Public Education', level: null, turnNumber: turnStatus(state).currentTurn }
        : null
    const used = useTurnAction(
      working,
      { ...current, techGrants: grant === null ? current.techGrants : [...current.techGrants, grant] },
      open.turn,
      INVEST_KEY,
      stats,
    )
    const logged = appendLog(used, {
      username: player.username,
      playerId: player.playerId,
      publicLog:
        `${player.username} invested a coin in ${card.label} (${plural(markers, 'marker')} on it)` +
        (grant === null ? '' : ': its ability activated, so they may learn a tech for free'),
      privateLog: '',
      createdAt: context.at ?? null,
      assistedActionId: context.requestId,
    })
    return ok({
      state: logged,
      effect: {
        kind: 'invest',
        source,
        card: card.key,
        grantId: grant?.id ?? null,
        advance: advance !== null && advance.ok ? advance.value.effect : null,
      },
      logId: lastLogId(logged),
    })
  },

  reverse(state, player, record, at) {
    const effect = record.effect
    if (effect.kind !== 'invest') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    const blockedBy = (reason: string) => err({ kind: 'ASSISTED_UNDO_BLOCKED' as const, logId: record.logId, reason })
    if (effect.grantId !== null && !player.techGrants.some((grant) => grant.id === effect.grantId)) {
      return blockedBy('The tech this paid for has been learned already. Remove that tech first.')
    }
    let working = state
    let current = player
    // The free advance goes first: it can refuse (the marker moved on)
    const advanced = effect.advance
    if (advanced !== null) {
      const reversed = reverseAdvanceEffect(state, player, record, advanced, at)
      if (!reversed.ok) return reversed
      working = reversed.value.state
      current = playerOf(working, player.playerId) ?? player
    }
    const key = effect.source as CoinSourceKey
    const back: Playerhand = {
      ...current,
      techGrants: effect.grantId === null ? current.techGrants : current.techGrants.filter((grant) => grant.id !== effect.grantId),
      stats: {
        ...current.stats,
        coinSources: withCoinSource(current.stats.coinSources, key, current.stats.coinSources[key] + 1),
        [effect.card]: Math.max(0, current.stats[effect.card] - 1),
      },
    }
    const label = investmentCardOf(effect.card)?.label ?? 'an investment card'
    return ok({
      state: withPlayerHand(working, back),
      text:
        `${player.username}'s investment was undone: the coin is back and the marker is off ${label}` +
        (advanced === null ? '' : ', and the free advance was taken back'),
    })
  },
}

// ---------------------------------------------------------------------------

/** The Start of Turn actions of this file, in the order the projection lists them. */
export const SOT_ACTIONS: readonly AssistedActionDefinition[] = [
  expansionism,
  pacifism,
  patronage,
  ...RATIONALISM.map(rationalism),
  democracyTrade,
  fundamentalismCulture,
  feudalismHarvest,
  switchGovernment,
  invest,
]


// ---------------------------------------------------------------------------
// What the Start of Turn tab shows besides the buttons
// ---------------------------------------------------------------------------

/**
 * The choices behind the actions that need one (a government, a coin and a card, a
 * city and a resource), with the engine's own answer on whether each can be done now.
 * Own view only: it depends on the viewer's techs, coins and hand.
 */
export function startOfTurnViewOf(state: GameState, player: Playerhand): StartOfTurnView {
  const now = (availability: ReturnType<AssistedActionDefinition['availability']>) => ({
    status: availability.status,
    reason: availability.reason,
  })
  const turn = turnStatus(state).currentTurn
  const colour = player.color?.toLowerCase()
  const cities =
    colour === undefined
      ? []
      : cityProductionsOf(state, player).map((city) => ({ pieceId: city.pieceId, label: city.label }))
  const sources = coinSourcesOf(state, player)
  return {
    government: {
      current: player.government,
      ...now(switchGovernment.availability(state, player.playerId)),
      options: governmentOptionsOf(state, player),
      canEnterAnarchy: canEnterAnarchy(state, player),
    },
    feudalism:
      player.government === 'Feudalism'
        ? { ...now(feudalismHarvest.availability(state, player.playerId)), cities, resources: HARVESTABLE_RESOURCES }
        : null,
    invest: {
      ...now(invest.availability(state, player.playerId)),
      coins: investableCoinsOf(state, player).map(({ key, coins }) => ({
        key,
        label: findCoinSource(key)?.label ?? key,
        coins,
      })),
      cards: INVESTMENT_CARDS.map((card) => ({
        key: card.key,
        label: card.label,
        ability: card.ability,
        thresholds: card.thresholds,
        markers: player.stats[card.key],
      })),
      // Only the sources the player may pick from; the total shows what sits on printed coins as well
      totalCoins: Object.values(sources).reduce((total, value) => total + value, 0),
    },
    techGrants: player.techGrants
      .filter((grant) => grant.turnNumber === turn)
      .map((grant) => ({ id: grant.id, source: grant.source, level: grant.level })),
  }
}
