/**
 * The Start of Turn abilities of wonders, Great Persons, techs, huts and relics
 * (assisted play, part 13).
 *
 * One button each, with a log line and an undo through the vote the game already has.
 * They are built from tables, so a new wonder or tech that does the same is a row and
 * not a copy of the code. What the game does for the player depends on what the card
 * says:
 *
 * - **Adds trade or culture** (Stonehenge, The Colossus, The Louvre, Lorenzo de' Medici,
 *   Alan Turing): the numbers change, through `statGainAction`.
 * - **A free advance, a coin on a wonder, cards drawn, a free tech, free investment
 *   markers** (Sydney Opera House, Panama Canal, Cristo Redentor, Statue of Liberty,
 *   Teacher, Atlantis, Seven Cities of Gold): what can be counted is counted.
 * - **Everything else** (a free building or figure on the map, a resource from the market,
 *   a changed square): only a log line, once per turn. The player does it on the map, as
 *   they do for a culture card, because the choice is on the board.
 *
 * Which Great Person cards play from the hand is `playCard`; the two with a number here
 * are left out of that list (`CARDS_WITH_OWN_BUTTON`). The rules and the card texts are in
 * `docs/agents/tasks/assisted-sot.md`.
 *
 * Whether a wonder has been made obsolete is not tracked: the player judges that, as
 * they do for the Pyramids.
 */

import { setWonderCoinTokens } from './actions/board.js'
import {
  REPEAT_NOTE,
  blocked,
  lastLogId,
  playerOf,
  rejected,
  techBlock,
  useTurnAction,
  withPlayerHand,
} from './assisted-core.js'
import type { ApplyContext, AssistedActionDefinition, BlockedAvailability } from './assisted-core.js'
import {
  countLinesIn,
  drawCandidates,
  livePendingRewards,
  performAdvance,
  restoreDrawnCards,
  reverseAdvanceEffect,
} from './assisted-culture.js'
import { findResourceToken, returnResource, spendResource } from './assisted-resources.js'
import { ROMAN, levelSheet, plural, startOfTurnGate, statGainAction } from './assisted-sot.js'
import type { StatGainSpec } from './assisted-sot.js'
import { blockadedGreatPersonTypes, blockadedPieceIds } from './blockade.js'
import { findBoardAsset, remainingBoardAssetCount, whiteFigureFor } from './board.js'
import { activeWonderOwnerIds, coinSourcesOf, totalCoins } from './coins.js'
import { cultureHandBlock } from './culture-hand.js'
import type { CultureLevel } from './culture-track.js'
import { itemName } from './item.js'
import type { GreatPersonItem, HutItem, Item } from './item.js'
import { appendLog } from './log.js'
import { err, ok } from './result.js'
import { SHEET_LABEL } from './sheet-name.js'
import { INVESTMENT_CARDS } from './sot.js'
import type { AssistedActionKind, GameState, InvestmentCard, Playerhand, SpentResource, TechGrant } from './state.js'
import { turnStatus } from './turn.js'
import type { PlayerTurn } from './turn.js'

/** The groups the abilities are listed under in the Start of Turn tab. */
const WONDERS = 'Wonders'
const PEOPLE = 'Great Persons'
const TECHS = 'Techs'
const HUTS_AND_RELICS = 'Huts and relics'

/** What every ability of this file is built from. */
interface AbilityBase {
  /** The part of the kind after `sot:`. */
  readonly id: string
  readonly label: string
  readonly group: string
  /** Once per turn when set; `null` when the thing used up is the limit (a hut, a relic). */
  readonly usageKey: string | null
  /** What must be in play: a reason when it is not, nothing when it is. */
  readonly block: (state: GameState, player: Playerhand) => BlockedAvailability | undefined
  /** Anything else that must hold right now, with a reason when it does not. */
  readonly check?: (state: GameState, player: Playerhand) => BlockedAvailability | undefined
  /** The rule allows it once and nothing grants another use. */
  readonly strictOnce?: boolean
}

const kindOf = (id: string): AssistedActionKind => `sot:${id}`

// ---------------------------------------------------------------------------
// What must be in play
// ---------------------------------------------------------------------------

/** An explicitly owned wonder that no enemy figure blockades. Obsolescence is not tracked. */
const wonderBlock =
  (assetId: string, label: string) =>
  (state: GameState, player: Playerhand): BlockedAvailability | undefined => {
    const owns = state.board.pieces.some(
      (piece) => piece.category === 'wonder' && piece.assetId === assetId && piece.ownerId === player.playerId,
    )
    if (!owns) return blocked('not-owned', `You do not own ${label}.`)
    return activeWonderOwnerIds(state.board.pieces, assetId, blockadedPieceIds(state)).has(player.playerId)
      ? undefined
      : blocked('unavailable', `${label} is blockaded by an enemy figure, so you cannot use it.`)
  }

/** A revealed Great Person card in the hand whose figures are not all blockaded (FAQ 2.0). */
const personBlock =
  (name: string) =>
  (state: GameState, player: Playerhand): BlockedAvailability | undefined => {
    const card = player.items.find((item): item is GreatPersonItem => item.kind === 'greatperson' && item.name === name)
    if (card === undefined) return blocked('not-owned', `You do not hold ${name}.`)
    if (card.hidden) return blocked('unavailable', `Reveal ${name} before using it.`)
    if (card.type !== null && blockadedGreatPersonTypes(state, player).includes(card.type)) {
      return blocked('unavailable', `Every ${card.type} figure of yours is blockaded, so ${name} cannot be used.`)
    }
    return undefined
  }

/** A revealed tech: a hidden one is private. */
const techBlockOf =
  (name: string) =>
  (_state: GameState, player: Playerhand): BlockedAvailability | undefined =>
    techBlock(player, name)

const findHut = (player: Playerhand, name: string): HutItem | undefined =>
  player.items.find(
    (item): item is HutItem => item.kind === 'hut' && !item.used && item.name.trim().toLowerCase() === name.toLowerCase(),
  )

const hutBlock =
  (name: string) =>
  (_state: GameState, player: Playerhand): BlockedAvailability | undefined =>
    findHut(player, name) === undefined ? blocked('not-owned', `You hold no ${name} hut.`) : undefined

/**
 * A relic the player took off the map: the marker is gone from the board and the board's
 * history says this player removed it last. The ability is claimed once for the whole
 * game, and an undone claim can be made again.
 */
const relicBlock =
  (assetId: string, label: string, kinds: readonly AssistedActionKind[]) =>
  (state: GameState, player: Playerhand): BlockedAvailability | undefined => {
    if (state.board.pieces.some((piece) => piece.assetId === assetId)) {
      return blocked('not-owned', `The ${label} relic marker is still on the map.`)
    }
    const last = [...state.board.history]
      .reverse()
      .find((entry) => 'piece' in entry.change && entry.change.piece.assetId === assetId)
    if (last === undefined || last.change.kind !== 'remove' || last.playerId !== player.playerId) {
      return blocked('not-owned', `You have not taken the ${label} relic marker off the map.`)
    }
    const claimed = state.assistedActions.some(
      (record) => record.status === 'applied' && kinds.includes(record.kind),
    )
    return claimed ? blocked('used', `You have claimed the ${label} relic already. It gives its ability once.`) : undefined
  }

// ---------------------------------------------------------------------------
// The gate and the shared steps
// ---------------------------------------------------------------------------

type Opened = { readonly turn: PlayerTurn } | { readonly blocked: BlockedAvailability }

/** What must be in play, then the Start of Turn and the usage key, then anything else that must hold. */
function openGate(state: GameState, player: Playerhand, base: AbilityBase, allowRepeat: boolean): Opened {
  const missing = base.block(state, player)
  if (missing !== undefined) return { blocked: missing }
  const open = startOfTurnGate(state, player, { usageKey: base.usageKey, label: base.label, allowRepeat })
  if ('blocked' in open) return { blocked: open.blocked }
  const extra = base.check?.(state, player)
  return extra === undefined ? open : { blocked: extra }
}

const dismissed = (base: AbilityBase, opened: { readonly blocked: BlockedAvailability }) =>
  err(rejected(kindOf(base.id), opened.blocked))

/** The public line of an applied ability, tagged so the undo vote finds it. */
function announce(state: GameState, player: Playerhand, context: ApplyContext, text: string): GameState {
  return appendLog(state, {
    username: player.username,
    playerId: player.playerId,
    publicLog: text + (context.confirmedRepeat ? REPEAT_NOTE : ''),
    privateLog: '',
    createdAt: context.at ?? null,
    assistedActionId: context.requestId,
  })
}

/** The hand of the player in the state as it is now: an earlier step may have changed it. */
const holderIn = (state: GameState, player: Playerhand): Playerhand => playerOf(state, player.playerId) ?? player

/** Writes the usage key (when the ability has one) with the player's current numbers. */
function markUsed(state: GameState, player: Playerhand, turn: PlayerTurn, base: AbilityBase): GameState {
  const holder = holderIn(state, player)
  return base.usageKey === null ? state : useTurnAction(state, holder, turn, base.usageKey, holder.stats)
}

/** The fields every definition of this file shares. */
const shared = (spec: AbilityBase) =>
  ({
    kind: kindOf(spec.id),
    techName: null,
    label: spec.label,
    button: true,
    usageKey: spec.usageKey,
    phase: 'SOT' as const,
    group: spec.group,
    ...(spec.strictOnce === true ? { strictOnce: true } : {}),
  }) satisfies Partial<AssistedActionDefinition>

/** The availability every ability shares; `reason` is what it says when ready. */
function availabilityOf(spec: AbilityBase, reason: (state: GameState, player: Playerhand) => string) {
  return (state: GameState, playerId: string) => {
    const player = playerOf(state, playerId)
    if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
    const opened = openGate(state, player, spec, false)
    if ('blocked' in opened) return opened.blocked
    return { status: 'ready' as const, reason: reason(state, player) }
  }
}

// ---------------------------------------------------------------------------
// Adds trade or culture
// ---------------------------------------------------------------------------

/** Armies of the player's colour (and the white army of the Russians) still in the supply. */
function unbuiltArmies(state: GameState, player: Playerhand): number {
  const colour = player.color?.toLowerCase()
  const ids = [
    ...(colour === undefined ? [] : [`figures/${colour}army`]),
    ...(player.civilization === null || player.civilization === undefined
      ? []
      : [whiteFigureFor(player.civilization.name)].filter((id): id is string => id !== undefined && id.endsWith('army'))),
  ]
  return ids.reduce((total, id) => {
    const asset = findBoardAsset(id)
    return total + (asset === undefined ? 0 : (remainingBoardAssetCount(asset, state.board.pieces, state.numOfPlayers) ?? 0))
  }, 0)
}

const STAT_GAINS: readonly StatGainSpec[] = [
  {
    kind: kindOf('stonehenge'),
    label: 'Stonehenge',
    group: WONDERS,
    usageKey: 'wonder:stonehenge',
    block: wonderBlock('wonders/stonehenge', 'Stonehenge'),
    gain: () => ({ trade: 0, culture: 1, text: 'the Start of Turn ability of Stonehenge' }),
  },
  {
    kind: kindOf('colossus'),
    label: 'The Colossus',
    group: WONDERS,
    usageKey: 'wonder:colossus',
    block: wonderBlock('wonders/colossus', 'The Colossus'),
    gain: () => ({ trade: 3, culture: 0, text: 'the Start of Turn ability of The Colossus' }),
  },
  {
    kind: kindOf('louvre'),
    label: 'The Louvre',
    group: WONDERS,
    usageKey: 'wonder:louvre',
    block: wonderBlock('wonders/louvre', 'The Louvre'),
    gain: () => ({ trade: 0, culture: 3, text: 'the Start of Turn ability of The Louvre' }),
  },
  {
    kind: kindOf('lorenzo'),
    label: "Lorenzo de' Medici",
    group: PEOPLE,
    usageKey: 'person:lorenzo',
    block: personBlock("Lorenzo de' Medici"),
    gain(state, player) {
      const coins = totalCoins(coinSourcesOf(state, player))
      return { trade: 0, culture: Math.floor(coins / 3), text: `1 culture for every 3 coins you have (you have ${coins})` }
    },
  },
  {
    kind: kindOf('turing'),
    label: 'Alan Turing',
    group: PEOPLE,
    usageKey: 'person:turing',
    block: personBlock('Alan Turing'),
    gain(state, player) {
      const pairs = Math.floor(unbuiltArmies(state, player) / 2)
      return {
        trade: pairs,
        culture: pairs,
        text: `1 trade and 1 culture for every 2 armies you have not built (${unbuiltArmies(state, player)} in your supply)`,
      }
    },
  },
]

// ---------------------------------------------------------------------------
// Only a log line
// ---------------------------------------------------------------------------

interface NoteSpec extends AbilityBase {
  /** What the button says it does, before it is pressed. */
  readonly summary: string
  /** The rest of the public line: "X used Y: <this>". */
  readonly logText: string
  /** A resource token the ability costs, spent for the player. */
  readonly resource?: string
}

/** Machu Picchu comes after an investment: the invested coin is the trigger. */
const afterInvesting = (state: GameState, player: Playerhand): BlockedAvailability | undefined => {
  const turn = player.playerTurns.find((candidate) => candidate.turnNumber === turnStatus(state).currentTurn)
  return turn?.usedActions.includes('invest') === true
    ? undefined
    : blocked('unavailable', 'Invest a coin first: Machu Picchu gives its resource after you invest.')
}

const needsResource = (resource: string) =>
  (state: GameState, player: Playerhand): BlockedAvailability | undefined =>
    findResourceToken(state, player.playerId, resource) === undefined
      ? blocked(
          'needs-resource',
          `You need a ${resource} token: a ${resource} hut in your hand or a ${resource} piece in your player area.`,
        )
      : undefined

const NOTES: readonly NoteSpec[] = [
  {
    id: 'greatWall',
    label: 'The Great Wall',
    group: WONDERS,
    usageKey: 'wonder:greatwall',
    block: wonderBlock('wonders/greatwall', 'The Great Wall'),
    summary: 'Build city walls in one of your cities for free',
    logText: 'built city walls in one of their cities for free',
  },
  {
    id: 'hangingGardens',
    label: 'The Hanging Gardens',
    group: WONDERS,
    usageKey: 'wonder:hanginggardens',
    block: wonderBlock('wonders/hanginggardens', 'The Hanging Gardens'),
    summary: 'Build a figure for free in the square that holds the Hanging Gardens',
    logText: 'built a figure for free in the square of the Hanging Gardens',
  },
  {
    id: 'tajMahal',
    label: 'Taj Mahal',
    group: WONDERS,
    usageKey: 'wonder:tajmahal',
    block: wonderBlock('wonders/tajmahal', 'Taj Mahal'),
    summary: 'Build a building you have unlocked in one of your cities for free',
    logText: 'built an unlocked building for free in one of their cities',
  },
  {
    id: 'bigBen',
    label: 'Big Ben',
    group: WONDERS,
    usageKey: 'wonder:bigben',
    block: wonderBlock('wonders/bigben', 'Big Ben'),
    summary: 'Gain one of every resource in the market',
    logText: 'gained one of every resource in the market',
  },
  {
    id: 'machuPicchu',
    label: 'Machu Picchu',
    group: WONDERS,
    usageKey: 'wonder:machupichu',
    block: wonderBlock('wonders/machupichu', 'Machu Picchu'),
    check: afterInvesting,
    summary: 'After you invest a coin, gain one resource of your choice from the market',
    logText: 'gained a resource of their choice from the market after investing',
  },
  {
    id: 'plastics',
    label: 'Plastics',
    group: TECHS,
    usageKey: 'tech:Plastics',
    block: techBlockOf('Plastics'),
    summary: 'Build a unit, figure or building you have unlocked for free',
    logText: 'built a unit, figure or building for free',
  },
  {
    id: 'ecology',
    label: 'Ecology',
    group: TECHS,
    usageKey: 'tech:Ecology',
    block: techBlockOf('Ecology'),
    check: needsResource('Wheat'),
    resource: 'Wheat',
    summary: 'Spend a Wheat to change an empty non-mountain square into a different non-mountain square for the rest of the game',
    logText: 'spent a Wheat to change an empty non-mountain square into a different non-mountain square',
  },
]

function noteAction(spec: NoteSpec): AssistedActionDefinition {
  return {
    ...shared(spec),

    availability: availabilityOf(spec, () => `${spec.summary}. The game logs it; you do it on the map.`),

    apply(state, player, context) {
      const opened = openGate(state, player, spec, context.confirmedRepeat)
      if ('blocked' in opened) return dismissed(spec, opened)
      let working = state
      let spent: SpentResource | null = null
      if (spec.resource !== undefined) {
        const paid = spendResource(state, player.playerId, spec.resource, context.at)
        if (!paid.ok) return err(rejected(kindOf(spec.id), blocked('needs-resource', `You need a ${spec.resource} token to use ${spec.label}.`)))
        working = paid.value.state
        spent = paid.value.spent
      }
      const used = markUsed(working, player, opened.turn, spec)
      const logged = announce(used, player, context, `${player.username} used ${spec.label}: ${spec.logText}`)
      return ok({
        state: logged,
        effect: { kind: 'sotNote', subject: spec.label, spent },
        logId: lastLogId(logged),
      })
    },

    reverse(state, player, record, at) {
      const effect = record.effect
      if (effect.kind !== 'sotNote') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
      let working = state
      if (effect.spent !== null) {
        const returned = returnResource(state, player, effect.spent, at)
        if (!returned.ok) return returned
        working = returned.value
      }
      return ok({
        state: working,
        text:
          `${player.username}'s ${effect.subject} was undone: take back by hand what you did on the map` +
          (effect.spent === null ? '' : `, and the ${effect.spent.resource} token returned`),
      })
    },
  }
}

// ---------------------------------------------------------------------------
// A free tech
// ---------------------------------------------------------------------------

interface GrantSpec extends AbilityBase {
  /** What granted it, as the log and the tech panel name it. */
  readonly source: string
  readonly level: TechGrant['level']
  readonly summary: string
  readonly logText: string
  /** The hut that is discarded for it. */
  readonly hut?: string
}

const GRANTS: readonly GrantSpec[] = [
  {
    id: 'statueOfLiberty',
    label: 'Statue of Liberty',
    group: WONDERS,
    usageKey: 'wonder:statueofliberty',
    block: wonderBlock('wonders/statueofliberty', 'Statue of Liberty'),
    source: 'Statue of Liberty',
    level: null,
    summary: 'Research one tech another player knows for free. You may still research normally this turn',
    logText: 'may research one tech another player knows for free',
  },
  {
    id: 'teacher',
    label: 'Teacher hut',
    group: HUTS_AND_RELICS,
    usageKey: null,
    block: hutBlock('Teacher'),
    source: 'Teacher',
    level: 1,
    hut: 'Teacher',
    summary: 'Reveal and discard the Teacher hut to learn a level I tech for free',
    logText: 'revealed and discarded the Teacher hut: may learn a level I tech for free',
  },
  {
    id: 'atlantis',
    label: 'Atlantis',
    group: HUTS_AND_RELICS,
    usageKey: null,
    strictOnce: true,
    block: relicBlock('relics/atlantis', 'Atlantis', [kindOf('atlantis')]),
    source: 'Atlantis',
    level: null,
    summary: 'The relic you removed gives you a free tech of your choice at the start of this turn',
    logText: 'claimed the Atlantis relic: may learn a free tech of their choice',
  },
]

function grantAction(spec: GrantSpec): AssistedActionDefinition {
  return {
    ...shared(spec),

    availability: availabilityOf(spec, () => `${spec.summary}. Then choose and reveal the tech in the tech tree.`),

    apply(state, player, context) {
      const opened = openGate(state, player, spec, context.confirmedRepeat)
      if ('blocked' in opened) return dismissed(spec, opened)
      const grant: TechGrant = {
        id: context.requestId,
        source: spec.source,
        level: spec.level,
        turnNumber: turnStatus(state).currentTurn,
      }
      const hut = spec.hut === undefined ? null : (findHut(player, spec.hut) ?? null)
      if (spec.hut !== undefined && hut === null) {
        return err(rejected(kindOf(spec.id), blocked('not-owned', `You hold no ${spec.hut} hut.`)))
      }
      const holding: Playerhand = {
        ...player,
        techGrants: [...player.techGrants, grant],
        items: hut === null ? player.items : player.items.filter((item) => item.id !== hut.id),
      }
      const taken: GameState = {
        ...withPlayerHand(state, holding),
        discardedItems: hut === null ? state.discardedItems : [...state.discardedItems, { ...hut, hidden: true }],
      }
      const used = markUsed(taken, holding, opened.turn, spec)
      const logged = announce(used, player, context, `${player.username} used ${spec.label}: ${spec.logText}`)
      return ok({
        state: logged,
        effect: { kind: 'sotGrant', subject: spec.label, grantId: grant.id, hut },
        logId: lastLogId(logged),
      })
    },

    reverse(state, player, record) {
      const effect = record.effect
      if (effect.kind !== 'sotGrant') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
      const blockedBy = (reason: string) => err({ kind: 'ASSISTED_UNDO_BLOCKED' as const, logId: record.logId, reason })
      if (!player.techGrants.some((grant) => grant.id === effect.grantId)) {
        return blockedBy('The tech this gave has been learned already. Remove that tech first.')
      }
      const hut = effect.hut
      if (hut !== null && !state.discardedItems.some((item) => item.id === hut.id)) {
        return blockedBy('The hut is no longer in the discard pile.')
      }
      const back: Playerhand = {
        ...player,
        techGrants: player.techGrants.filter((grant) => grant.id !== effect.grantId),
        items: hut === null ? player.items : [...player.items, hut],
      }
      return ok({
        state: {
          ...withPlayerHand(state, back),
          discardedItems: hut === null ? state.discardedItems : state.discardedItems.filter((item) => item.id !== hut.id),
        },
        text:
          `${player.username}'s ${effect.subject} was undone: the free tech was taken back` +
          (hut === null ? '' : ' and the hut is in their hand again'),
      })
    },
  }
}

// ---------------------------------------------------------------------------
// Sydney Opera House: a free advance
// ---------------------------------------------------------------------------

const SYDNEY: AbilityBase = {
  id: 'sydneyOperaHouse',
  label: 'Sydney Opera House',
  group: WONDERS,
  usageKey: 'wonder:sydneyoperahouse',
  block: wonderBlock('wonders/sydneyoperahouse', 'Sydney Opera House'),
  check: (_state, player) =>
    livePendingRewards(player).length > 0
      ? blocked('unavailable', 'Choose the card to keep from your last advance first.')
      : undefined,
}

const sydneyOperaHouse: AssistedActionDefinition = {
  ...shared(SYDNEY),

  availability: availabilityOf(SYDNEY, () => 'Advance one space on the culture track for free, and take what the space gives.'),

  apply(state, player, context) {
    const opened = openGate(state, player, SYDNEY, context.confirmedRepeat)
    if ('blocked' in opened) return dismissed(SYDNEY, opened)
    const line = announce(state, player, context, `${player.username} used ${SYDNEY.label}: an advance on the culture track for free`)
    const logId = lastLogId(line)
    const advanced = performAdvance(line, holderIn(line, player), { requestId: context.requestId, at: context.at }, { free: true, tagLog: false })
    if (!advanced.ok) return advanced
    const used = markUsed(advanced.value.state, player, opened.turn, SYDNEY)
    return ok({ state: used, effect: { kind: 'sotAdvance', subject: SYDNEY.label, advance: advanced.value.effect }, logId })
  },

  reverse(state, player, record, at) {
    const effect = record.effect
    if (effect.kind !== 'sotAdvance') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    const reversed = reverseAdvanceEffect(state, player, record, effect.advance, at)
    if (!reversed.ok) return reversed
    return ok({
      state: reversed.value.state,
      text: `${player.username}'s ${effect.subject} was undone: the free advance was taken back`,
    })
  },
}

// ---------------------------------------------------------------------------
// Panama Canal: a coin on the wonder
// ---------------------------------------------------------------------------

const PANAMA: AbilityBase = {
  id: 'panamaCanal',
  label: 'Panama Canal',
  group: WONDERS,
  usageKey: 'wonder:panamacanal',
  block: wonderBlock('wonders/panamacanal', 'Panama Canal'),
}

const panamaPieceOf = (state: GameState, player: Playerhand) =>
  state.board.pieces.find(
    (piece) => piece.category === 'wonder' && piece.assetId === 'wonders/panamacanal' && piece.ownerId === player.playerId,
  )

const panamaCanal: AssistedActionDefinition = {
  ...shared(PANAMA),

  availability: availabilityOf(PANAMA, () => 'Add 1 coin token to the Panama Canal. It can be invested later, and it counts as a coin.'),

  apply(state, player, context) {
    const opened = openGate(state, player, PANAMA, context.confirmedRepeat)
    if ('blocked' in opened) return dismissed(PANAMA, opened)
    const piece = panamaPieceOf(state, player)
    if (piece === undefined) return err(rejected(kindOf(PANAMA.id), blocked('not-owned', 'You do not own the Panama Canal.')))
    const set = setWonderCoinTokens(state, {
      playerId: player.playerId,
      pieceId: piece.id,
      value: (piece.coinTokens ?? 0) + 1,
      ...(context.at === undefined ? {} : { at: context.at }),
    })
    const entry = set.ok ? set.value.board.history.at(-1) : undefined
    if (!set.ok || entry === undefined) return err(rejected(kindOf(PANAMA.id), blocked('unavailable', 'The coin could not be added.')))
    const used = markUsed(set.value, player, opened.turn, PANAMA)
    const logged = announce(used, player, context, `${player.username} used ${PANAMA.label}: added a coin token to it (${piece.coinTokens === undefined ? 1 : piece.coinTokens + 1} on it)`)
    return ok({
      state: countLinesIn(logged, [entry.id]),
      effect: { kind: 'sotCoin', subject: PANAMA.label, pieceId: piece.id, historyId: entry.id },
      logId: lastLogId(logged),
    })
  },

  reverse(state, player, record, at) {
    const effect = record.effect
    if (effect.kind !== 'sotCoin') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    const piece = state.board.pieces.find((candidate) => candidate.id === effect.pieceId)
    if (piece === undefined || (piece.coinTokens ?? 0) < 1) {
      return err({
        kind: 'ASSISTED_UNDO_BLOCKED',
        logId: record.logId,
        reason: 'The Panama Canal has no coin token left to take back.',
      })
    }
    const set = setWonderCoinTokens(state, {
      playerId: player.playerId,
      pieceId: piece.id,
      value: (piece.coinTokens ?? 0) - 1,
      ...(at === null ? {} : { at }),
    })
    if (!set.ok) {
      return err({ kind: 'ASSISTED_UNDO_BLOCKED', logId: record.logId, reason: 'The coin could not be taken off the Panama Canal.' })
    }
    return ok({ state: set.value, text: `${player.username}'s ${effect.subject} was undone: the coin token was taken off it` })
  },
}

// ---------------------------------------------------------------------------
// Cristo Redentor: two culture events from a deck of the player's choice
// ---------------------------------------------------------------------------

const CRISTO_COUNT = 2

function cristoRedentor(level: CultureLevel): AssistedActionDefinition {
  const sheetName = levelSheet(level)
  const spec: AbilityBase = {
    id: `cristoRedentor:${level}`,
    label: `Cristo Redentor, level ${ROMAN[level]} events`,
    group: WONDERS,
    usageKey: 'wonder:cristoredentor',
    block: wonderBlock('wonders/cristoredentor', 'Cristo Redentor'),
    check: (state, player) =>
      [...state.items, ...state.discardedItems].some((item) => item.sheetName === sheetName)
        ? // Culture cards come in: the hand must be down to its size first
          ((full) => (full === undefined ? undefined : blocked('unavailable', full)))(cultureHandBlock(state, player))
        : blocked('unavailable', `There are no ${SHEET_LABEL[sheetName]} cards left to draw.`),
  }
  return {
    ...shared(spec),

    availability: availabilityOf(spec, () => `Draw two ${SHEET_LABEL[sheetName]} cards. You keep both.`),

    apply(state, player, context) {
      const opened = openGate(state, player, spec, context.confirmedRepeat)
      if ('blocked' in opened) return dismissed(spec, opened)
      const drawn = drawCandidates(state, sheetName, CRISTO_COUNT)
      if (!drawn.ok) return drawn
      const cards = drawn.value.items.map((item): Item => ({ ...item, ownerId: player.playerId, hidden: true }))
      const holder = holderIn(drawn.value.state, player)
      const holding: Playerhand = { ...holder, items: [...holder.items, ...cards] }
      const used = markUsed(withPlayerHand(drawn.value.state, holding), holding, opened.turn, spec)
      const publicLine = announce(
        used,
        player,
        context,
        `${player.username} used Cristo Redentor: drew ${plural(cards.length, `level ${ROMAN[level]} culture event card`)}`,
      )
      const logId = lastLogId(publicLine)
      const logged = appendLog(publicLine, {
        username: player.username,
        playerId: player.playerId,
        privateLog: `${player.username} drew ${cards.map(itemName).join(', ')} (${SHEET_LABEL[sheetName]}) with Cristo Redentor`,
        createdAt: context.at ?? null,
      })
      return ok({
        state: logged,
        effect: { kind: 'sotDraw', subject: 'Cristo Redentor', sheetName, drawn: cards.map((card) => card.id) },
        logId,
      })
    },

    reverse(state, player, record) {
      const effect = record.effect
      if (effect.kind !== 'sotDraw') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
      const restored = restoreDrawnCards(state, player, record.id, effect.drawn, null, effect.sheetName)
      if (!restored.ok) {
        return err({
          kind: 'ASSISTED_UNDO_BLOCKED',
          logId: record.logId,
          reason: 'A card this drew has left the hand, so Cristo Redentor cannot be undone.',
        })
      }
      return ok({
        state: restored.value,
        text: `${player.username}'s ${effect.subject} was undone: the drawn cards were put back in the deck`,
      })
    },
  }
}

// ---------------------------------------------------------------------------
// Seven Cities of Gold: two investments for free
// ---------------------------------------------------------------------------

const SEVEN_CITIES_MARKERS = 2

function sevenCities(card: InvestmentCard): AssistedActionDefinition {
  const info = INVESTMENT_CARDS.find((candidate) => candidate.key === card)
  const label = `Seven Cities of Gold, ${info?.label ?? card}`
  const kinds = INVESTMENT_CARDS.map((candidate) => kindOf(`sevenCities:${candidate.key}`))
  const spec: AbilityBase = {
    id: `sevenCities:${card}`,
    label,
    group: HUTS_AND_RELICS,
    usageKey: null,
    strictOnce: true,
    block: relicBlock('relics/seven_cities_of_gold', 'Seven Cities of Gold', kinds),
  }
  return {
    ...shared(spec),

    availability: availabilityOf(
      spec,
      () => `Put ${SEVEN_CITIES_MARKERS} investment markers on ${info?.label ?? card} without paying a coin.`,
    ),

    apply(state, player, context) {
      const opened = openGate(state, player, spec, context.confirmedRepeat)
      if ('blocked' in opened) return dismissed(spec, opened)
      const before = player.stats[card]
      const markers = before + SEVEN_CITIES_MARKERS
      // Public Education activates at 3, 6 and 9 markers: a tech of the player's choice for free
      const activated = card === 'pe' && info?.thresholds.some((threshold) => before < threshold && threshold <= markers) === true
      const grant: TechGrant | null = activated
        ? { id: context.requestId, source: 'Public Education', level: null, turnNumber: turnStatus(state).currentTurn }
        : null
      const holding: Playerhand = {
        ...player,
        stats: { ...player.stats, [card]: markers },
        techGrants: grant === null ? player.techGrants : [...player.techGrants, grant],
      }
      const used = markUsed(withPlayerHand(state, holding), holding, opened.turn, spec)
      const logged = announce(
        used,
        player,
        context,
        `${player.username} used the Seven Cities of Gold: invested ${SEVEN_CITIES_MARKERS} markers in ${info?.label ?? card} for free ` +
          `(${plural(markers, 'marker')} on it)` +
          (grant === null ? '' : ': its ability activated, so they may learn a tech for free'),
      )
      return ok({
        state: logged,
        effect: { kind: 'sotInvest', subject: label, card, markers: SEVEN_CITIES_MARKERS, grantId: grant?.id ?? null },
        logId: lastLogId(logged),
      })
    },

    reverse(state, player, record) {
      const effect = record.effect
      if (effect.kind !== 'sotInvest') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
      if (effect.grantId !== null && !player.techGrants.some((grant) => grant.id === effect.grantId)) {
        return err({
          kind: 'ASSISTED_UNDO_BLOCKED',
          logId: record.logId,
          reason: 'The tech this paid for has been learned already. Remove that tech first.',
        })
      }
      const back: Playerhand = {
        ...player,
        stats: { ...player.stats, [effect.card]: Math.max(0, player.stats[effect.card] - effect.markers) },
        techGrants: effect.grantId === null ? player.techGrants : player.techGrants.filter((grant) => grant.id !== effect.grantId),
      }
      return ok({
        state: withPlayerHand(state, back),
        text: `${player.username}'s ${effect.subject} was undone: ${plural(effect.markers, 'marker')} taken off the card`,
      })
    },
  }
}

// ---------------------------------------------------------------------------

/** The abilities of this file, in the order the Start of Turn tab lists them (its groups follow the first of each). */
export const ABILITY_ACTIONS: readonly AssistedActionDefinition[] = [
  ...STAT_GAINS.map(statGainAction),
  sydneyOperaHouse,
  panamaCanal,
  ...([1, 2, 3] as const).map(cristoRedentor),
  ...GRANTS.map(grantAction),
  ...NOTES.map(noteAction),
  ...INVESTMENT_CARDS.map((card) => sevenCities(card.key)),
]

/** The kinds of this file, for the tests that keep the registry and its tables in step. */
export const ABILITY_KINDS: readonly AssistedActionKind[] = ABILITY_ACTIONS.map((definition) => definition.kind)
