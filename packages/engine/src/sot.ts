/**
 * What the Start of Turn phase allows, read off the state (assisted play, part 13).
 *
 * Pure and read-only, like `culture-hand.ts`: everything is derived each time from the
 * board, the revealed cards and the turn marks, so the numbers follow the game and
 * cannot drift. The rules are the base rulebook p. 12 to 14 and 26 to 27, Wisdom and
 * Warfare p. 9 to 10, Fame and Fortune p. 13 and FAQ 2.0, summarised in
 * `docs/agents/tasks/assisted-sot.md`.
 */

import {
  blockadedGreatPersonTypes,
  blockadedPieceIds,
  cityStateHolderColour,
  mapCellOf,
  pieceColorOf,
} from './blockade.js'
import { whiteFigureCivilization } from './board.js'
import type { BoardPiece } from './board.js'
import {
  activeWonderOwnerIds,
  coinOnReveal,
  coinSourcesOf,
  socialPolicyCoinSource,
  withCoinSource,
} from './coins.js'
import type { CoinSourceKey } from './coins.js'
import { GOVERNMENTS } from './government.js'
import type { Government } from './government.js'
import type { GameState, InvestmentCard, Playerhand, PlayerStats, TechGrant } from './state.js'
import { createPlayerTurn, turnStatus } from './turn.js'
import type { PlayerTurn, TurnPhase } from './turn.js'

// ---------------------------------------------------------------------------
// The open phase
// ---------------------------------------------------------------------------

/** The phase the player is working on: the first one not marked done, or `null` once all are. */
export function openPhaseOf(state: GameState, playerId: string): TurnPhase | null {
  return turnStatus(state).players.find((candidate) => candidate.playerId === playerId)?.phase ?? null
}

/**
 * The player's turn record while their Start of Turn is the open phase. The record
 * does not exist before the player has written an order or marked a phase, so a
 * fresh one is returned then; writing a usage key adds it to the player.
 */
export function openStartOfTurn(state: GameState, player: Playerhand): PlayerTurn | undefined {
  if (openPhaseOf(state, player.playerId) !== 'SOT') return undefined
  const turnNumber = turnStatus(state).currentTurn
  return (
    player.playerTurns.find((candidate) => candidate.turnNumber === turnNumber) ??
    createPlayerTurn(player.username, turnNumber)
  )
}

/** The grants with the one that `techName` was learned with free again: that tech is no longer the player's. */
export function grantsAfterTechRemoved(
  grants: readonly TechGrant[],
  techName: string,
): readonly TechGrant[] {
  return grants.map((grant) => {
    if (grant.usedFor !== techName) return grant
    const { usedFor: _spent, ...free } = grant
    return free
  })
}

export const SOT_PHASE_REASON = 'Only available during your open Start of Turn phase.'

// ---------------------------------------------------------------------------
// Figures and city-states on the map
// ---------------------------------------------------------------------------

/**
 * The armies or the scouts of a player that stand on the map. The colour is the
 * player's; the white army and the white scout belong to the Russians and the
 * Spanish. A figure in a player area or off the map is not on the map.
 */
export function figuresOnMap(
  state: GameState,
  player: Playerhand,
  type: 'army' | 'scout',
): readonly BoardPiece[] {
  const colour = player.color?.toLowerCase()
  return state.board.pieces.filter((piece) => {
    if (piece.category !== 'figure' || !piece.assetId.endsWith(type)) return false
    if (mapCellOf(state.board, piece) === null) return false
    const white = whiteFigureCivilization(piece.assetId)
    return white === undefined ? colour !== undefined && pieceColorOf(piece) === colour : white === player.civilization?.name
  })
}

/** The city-states a player controls: the ones with a figure of theirs on the square (W&W p. 9). */
export function controlledCityStates(state: GameState, player: Playerhand): readonly BoardPiece[] {
  const colour = player.color?.toLowerCase()
  if (colour === undefined) return []
  return state.board.pieces.filter(
    (piece) => piece.category === 'citystate' && cityStateHolderColour(state, piece) === colour,
  )
}

// ---------------------------------------------------------------------------
// Governments
// ---------------------------------------------------------------------------

/** The tech that unlocks a government. Despotism and Anarchy need none. */
export const GOVERNMENT_UNLOCK_TECH: Readonly<Partial<Record<Government, string>>> = {
  Republic: 'Code of Laws',
  Feudalism: 'Chivalry',
  Democracy: 'Democracy',
  Monarchy: 'Monarchy',
  Communism: 'Communism',
  Fundamentalism: 'Theology',
}

const PYRAMIDS_ASSET_ID = 'wonders/pyramids'

/**
 * Whether the player owns a Pyramids wonder that can be used: explicitly owned and not
 * blockaded. Whether the card has been obsoleted is not tracked, so the player judges it.
 */
export const hasUsablePyramids = (state: GameState, player: Playerhand): boolean =>
  activeWonderOwnerIds(state.board.pieces, PYRAMIDS_ASSET_ID, blockadedPieceIds(state)).has(player.playerId)

const MARTIN_LUTHER_KING = 'Dr. Martin Luther King'

/**
 * Whether the player never needs Anarchy: they own the Pyramids, or they hold a revealed
 * Dr. Martin Luther King whose Humanitarian figures are not all blockaded (F&F p. 5).
 */
export function isImmuneToAnarchy(state: GameState, player: Playerhand): boolean {
  if (hasUsablePyramids(state, player)) return true
  const king = player.items.some(
    (item) => item.kind === 'greatperson' && item.name === MARTIN_LUTHER_KING && !item.hidden,
  )
  return king && !blockadedGreatPersonTypes(state, player).includes('Humanitarian')
}

/** The governments the player has unlocked: Despotism, and one for each revealed tech that gives one. */
export function unlockedGovernments(state: GameState, player: Playerhand): readonly Government[] {
  if (hasUsablePyramids(state, player)) return GOVERNMENTS.filter((government) => government !== 'Anarchy')
  return GOVERNMENTS.filter((government) => {
    if (government === 'Anarchy') return false
    if (government === 'Despotism') return true
    const tech = GOVERNMENT_UNLOCK_TECH[government]
    return (
      tech !== undefined && player.techsChosen.some((chosen) => chosen.name === tech && !chosen.hidden)
    )
  })
}

/** How a change to a government goes. */
export interface GovernmentOption {
  readonly government: Government
  /** `direct`: the player becomes this government now. `anarchy`: they enter Anarchy first. */
  readonly route: 'direct' | 'anarchy'
  /** Why, as a sentence. */
  readonly reason: string
}

/**
 * Where the player can change to in this Start of Turn (base rulebook p. 14, FAQ 2.0).
 * A government unlocked during the Research of last turn, or during this Start of Turn,
 * can be taken directly. Any other change goes through Anarchy, and from Anarchy any
 * unlocked government can be taken directly. Immunity to Anarchy takes any unlocked
 * government directly.
 */
export function governmentOptionsOf(state: GameState, player: Playerhand): readonly GovernmentOption[] {
  const turn = turnStatus(state).currentTurn
  const immune = isImmuneToAnarchy(state, player)
  const options: GovernmentOption[] = []
  for (const government of unlockedGovernments(state, player)) {
    if (government === player.government) continue
    const tech = GOVERNMENT_UNLOCK_TECH[government]
    const learned = tech === undefined ? undefined : player.techRevealTurns[tech]
    if (player.government === 'Anarchy') {
      options.push({ government, route: 'direct', reason: 'You are in Anarchy, so you can take any government you know.' })
    } else if (immune) {
      options.push({ government, route: 'direct', reason: 'You are immune to Anarchy.' })
    } else if (learned !== undefined && learned >= turn - 1) {
      options.push({ government, route: 'direct', reason: `You learned ${tech ?? government} recently, so you can change at once.` })
    } else {
      options.push({
        government,
        route: 'anarchy',
        reason: `Changing to ${government} now goes through Anarchy: your capital takes no action this turn, and next Start of Turn you can take it.`,
      })
    }
  }
  return options
}

/** Whether the player can go through Anarchy at all: they are not in it and not immune to it. */
export const canEnterAnarchy = (state: GameState, player: Playerhand): boolean =>
  player.government !== 'Anarchy' && !isImmuneToAnarchy(state, player)

// ---------------------------------------------------------------------------
// Investments (F&F p. 13)
// ---------------------------------------------------------------------------

export interface InvestmentCardInfo {
  readonly key: InvestmentCard
  readonly label: string
  /** The marker totals at which each ability becomes active. */
  readonly thresholds: readonly number[]
  /** What the card does once its markers are on it. Not named `effect`: that word marks an action record in the privacy tests. */
  readonly ability: string
}

/** The four investment cards. Endowment for the Arts follows the W&W replacement card (FAQ 2.0). */
export const INVESTMENT_CARDS: readonly InvestmentCardInfo[] = [
  { key: 'infra', label: 'Infrastructure', thresholds: [1, 2, 3], ability: 'Your cities produce +1/+2/+3 production.' },
  {
    key: 'efta',
    label: 'Endowment for the Arts',
    thresholds: [1, 2, 4],
    ability: 'Pay 0/1/2 less culture to advance; +1 culture hand size.',
  },
  { key: 'mic', label: 'Military-Industrial Complex', thresholds: [2, 4, 6], ability: 'Combat bonus +4/+8/+12.' },
  { key: 'pe', label: 'Public Education', thresholds: [3, 6, 9], ability: 'Each time an ability activates, learn a tech for free.' },
]

/**
 * The coin counters a coin can be invested from: only coin tokens, the ones on the
 * civilization sheet and on the tech cards that hold tokens. Coins printed on the map,
 * on a building, a government, a policy or a Great Person card, and the coins on a
 * wonder, cannot be invested (the human; F&F p. 13).
 */
export const INVESTABLE_COIN_SOURCES: readonly CoinSourceKey[] = [
  'sheet',
  'codeOfLaws',
  'pottery',
  'democracy',
  'printingPress',
  'education',
]

/** The investable counters that hold at least one coin. */
export function investableCoinsOf(
  state: GameState,
  player: Playerhand,
): readonly { readonly key: CoinSourceKey; readonly coins: number }[] {
  const sources = coinSourcesOf(state, player)
  return INVESTABLE_COIN_SOURCES.flatMap((key) => (sources[key] > 0 ? [{ key, coins: sources[key] }] : []))
}

// ---------------------------------------------------------------------------
// What a change of government does to the coin counters
// ---------------------------------------------------------------------------

/**
 * The status board after the player's government becomes `government` (issue #158). The
 * government card holds its coin, so leaving Democracy clears that counter and moving
 * to it starts it at 1; setting it again leaves a lowered counter alone. Anarchy
 * switches every social policy off, so the Organized Religion coin goes to 0 there, and
 * leaving Anarchy brings it back only for a policy the player has revealed, because a
 * hidden policy must not show up in a public counter. Shared by the manual government
 * marker and the assisted change, so the two cannot disagree.
 */
export function statsAfterGovernmentChange(player: Playerhand, government: Government): PlayerStats {
  let coinSources = player.stats.coinSources
  if (government !== 'Democracy') {
    coinSources = withCoinSource(coinSources, 'democracyGovernment', 0)
  } else if (player.government !== 'Democracy') {
    coinSources = withCoinSource(coinSources, 'democracyGovernment', coinOnReveal('democracyGovernment'))
  }
  if (government === 'Anarchy') {
    coinSources = withCoinSource(coinSources, 'organizedReligion', 0)
  } else if (player.government === 'Anarchy') {
    const hasPolicy = player.socialPolicies.some(
      (policy) => !policy.hidden && socialPolicyCoinSource(policy.name) === 'organizedReligion',
    )
    if (hasPolicy) coinSources = withCoinSource(coinSources, 'organizedReligion', coinOnReveal('organizedReligion'))
  }
  return { ...player.stats, coinSources }
}

// ---------------------------------------------------------------------------
// Scouts sending their square to a city (base rulebook p. 26)
// ---------------------------------------------------------------------------

/** A scout's square, sent to one of the player's cities for this turn. */
export interface ScoutAssignment {
  readonly scoutPieceId: string
  readonly cityPieceId: string
  readonly column: number
  readonly row: number
  /** `false` when no `assignScout` record chose the city and the capital is the default. */
  readonly chosen: boolean
}

/**
 * The cities the player chose for their scouts this turn. They are not stored on their own:
 * each is a record of the `assignScout` action, so the log, the undo vote and a retry already
 * cover them. The latest applied record of a scout wins, and a record that was undone does
 * not count, so undoing a change brings back the one before it. A choice holds only while the
 * scout still stands on the square it was declared for and the city marker is still on the board.
 * A scout without a choice goes to the capital: see `scoutDestinationsOf`.
 */
export function scoutAssignmentsOf(state: GameState, player: Playerhand): readonly ScoutAssignment[] {
  const turn = turnStatus(state).currentTurn
  const latest = new Map<string, ScoutAssignment | null>()
  for (const record of state.assistedActions) {
    if (record.kind !== 'assignScout' || record.status !== 'applied') continue
    if (record.playerId !== player.playerId || record.turnNumber !== turn) continue
    const effect = record.effect
    if (effect.kind !== 'assignScout') continue
    latest.set(
      effect.scoutPieceId,
      effect.cityPieceId === null
        ? null
        : {
            scoutPieceId: effect.scoutPieceId,
            cityPieceId: effect.cityPieceId,
            column: effect.column,
            row: effect.row,
            chosen: true,
          },
    )
  }
  return [...latest.values()].filter((assignment): assignment is ScoutAssignment => {
    if (assignment === null) return false
    const scout = state.board.pieces.find((piece) => piece.id === assignment.scoutPieceId)
    const at = scout === undefined ? null : mapCellOf(state.board, scout)
    const city = state.board.pieces.find((piece) => piece.id === assignment.cityPieceId && piece.category === 'city')
    return at !== null && at.column === assignment.column && at.row === assignment.row && city !== undefined
  })
}

/** The player's capital: the city marker that says so. A capital grown into a metropolis has none. */
export function capitalOf(state: GameState, player: Playerhand): BoardPiece | undefined {
  const colour = player.color?.toLowerCase()
  if (colour === undefined) return undefined
  return state.board.pieces.find(
    (piece) => piece.category === 'city' && piece.assetId.includes('capital') && pieceColorOf(piece) === colour,
  )
}

/**
 * Where each of the player's scouts on the map sends its square this turn: the city they chose,
 * and for a scout they did not send anywhere, the capital. An English army sent to a city is
 * kept too, but never goes to the capital on its own. Without a capital marker (a capital that
 * grew into a metropolis has none) a scout that was not sent has no destination.
 */
export function scoutDestinationsOf(state: GameState, player: Playerhand): readonly ScoutAssignment[] {
  const chosen = scoutAssignmentsOf(state, player)
  const capital = capitalOf(state, player)
  if (capital === undefined) return chosen
  const sent = new Set(chosen.map((assignment) => assignment.scoutPieceId))
  const defaults = figuresOnMap(state, player, 'scout').flatMap((scout): readonly ScoutAssignment[] => {
    const at = mapCellOf(state.board, scout)
    if (sent.has(scout.id) || at === null) return []
    return [{ scoutPieceId: scout.id, cityPieceId: capital.id, column: at.column, row: at.row, chosen: false }]
  })
  return [...chosen, ...defaults]
}
