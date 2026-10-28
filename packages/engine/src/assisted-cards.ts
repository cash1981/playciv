/**
 * Playing a culture event or a Great Person card (assisted play, part 13).
 *
 * The game does exactly two things for the player: it takes the card out of the hand
 * (to the discard pile, or turned faceup for a Great Person that stays), and it
 * writes a public line saying who played what, against whom and as which resource.
 * It does not apply the card. Other players can cancel a card, and most effects
 * (kill a figure, destroy a building, discard a coin) need a choice on the map, so
 * the player carries the effect out by hand once nobody cancels it (the human's
 * decision, 2026-10-23).
 *
 * Which cards can be played, and when, is read from the card's own effect text (see
 * `card-timing.ts`). The list is own view only, because it names cards in the hand.
 */

import { tradeCeilingOf } from './limits.js'
import { investableCoinsOf } from './sot.js'
import { coinSourcesOf, findCoinSource, withCoinSource } from './coins.js'
import { createPlayerTurn } from './turn.js'
import { moveFigureWithMovementUnchecked, placeStartMarker } from './actions/board.js'
import { unbuiltArmies } from './assisted-abilities.js'
import { drawCandidates, performAdvance, reverseAdvanceEffect, shuffleSheetTwice } from './assisted-culture.js'
import { squareLabel, unitSheetOf } from './build-options.js'
import {
  GALILEO_NAME,
  galileoDestinationAllowed,
  galileoFiguresAt,
  isOuterEdgeCell,
} from './galileo.js'
import { mapTop } from './board.js'
import type { PieceMovement } from './board.js'
import { blockadedGreatPersonTypes } from './blockade.js'
import { revealedTechNamesOfOthers } from './great-person-effects.js'
import { READY, blocked, freeTurnAction, lastLogId, playerOf, rejected, useTurnAction, withPlayerHand } from './assisted-core.js'
import type { AssistedActionDefinition } from './assisted-core.js'
import {
  AUTOMATIC_EFFECTS,
  CARDS_WITH_OWN_BUTTON,
  CARD_TIMING_TEXT,
  PASSIVE_GREAT_PERSONS,
  cardPlayRuleOf,
  discardsWhenUsed,
  timingsOf,
} from './card-timing.js'
import type { CardTiming, PlayableCard } from './card-timing.js'
import { err, ok } from './result.js'
import type { Result } from './result.js'
import { itemName } from './item.js'
import type { Item } from './item.js'
import { appendLog } from './log.js'
import type { AssistedEffect, GameState, Playerhand } from './state.js'
import { withPlayer } from './state.js'
import type { PlayCardPayload } from './assisted-core.js'
import type { TechGrant } from './state.js'
import { startPlayerOf, turnStatus } from './turn.js'
import type { TurnPhase } from './turn.js'

const KIND_OF: Readonly<Partial<Record<Item['kind'], PlayableCard['kind']>>> = {
  cultureI: 'culture',
  cultureII: 'culture',
  cultureIII: 'culture',
  greatperson: 'greatPerson',
}

/** The phase the player is working on: the first not marked done, `null` once every phase is done. */
export function currentPhaseOf(state: GameState, playerId: string): TurnPhase | null {
  return turnStatus(state).players.find((candidate) => candidate.playerId === playerId)?.phase ?? null
}

const timingsText = (timings: readonly CardTiming[]): string =>
  timings.map((timing) => CARD_TIMING_TEXT[timing]).join(' or ')

/** Whether a card with these timings can be played while the player is in `now`, and why or why not. */
function playableIn(
  timings: readonly CardTiming[],
  now: TurnPhase | null,
): { readonly status: 'ready' | 'wrong-phase'; readonly reason: string } {
  if (timings.includes('ANY')) return { status: 'ready', reason: 'Can be played at any time.' }
  if (now !== null && timings.includes(now)) {
    return { status: 'ready', reason: `Can be played in ${CARD_TIMING_TEXT[now]}, which you are in.` }
  }
  if (timings.length === 1 && timings[0] === 'BATTLE') {
    return { status: 'wrong-phase', reason: 'Played during a battle.' }
  }
  const where =
    now === null ? 'You have finished every phase of this turn.' : `You are in ${CARD_TIMING_TEXT[now]}.`
  return { status: 'wrong-phase', reason: `Played in ${timingsText(timings)}. ${where}` }
}

/**
 * The cards of the player's hand that can be played at some time, with whether each
 * can be played now. A card with no timing in its text (a passive Great Person) is
 * not listed. A Great Person whose tokens are all blockaded cannot be used (FAQ 2.0).
 */
export function playableCardsOf(state: GameState, player: Playerhand): readonly PlayableCard[] {
  const now = currentPhaseOf(state, player.playerId)
  const blockaded = blockadedGreatPersonTypes(state, player)
  // The cards drawn for a choice are in the hand until one is kept: none of them is the player's yet
  const waiting = new Set(player.pendingRewards.flatMap((reward) => reward.candidateIds))
  return player.items.flatMap((item): readonly PlayableCard[] => {
    const kind = KIND_OF[item.kind]
    if (kind === undefined || item.description === null || item.description === undefined) return []
    const name = itemName(item)
    const passiveText = kind === 'greatPerson' ? PASSIVE_GREAT_PERSONS.get(name) : undefined
    const timings = timingsOf(item.description)
    if (timings.length === 0 && passiveText === undefined) return []
    if (item.kind === 'greatperson' && CARDS_WITH_OWN_BUTTON.has(name)) return []
    const rule = cardPlayRuleOf(name)
    const base = {
      itemId: item.id,
      name,
      kind,
      description: item.description,
      timings: passiveText === undefined ? timings : (['ANY'] as const),
      targets: rule.targets,
      prompt: rule.prompt,
      resources: rule.resources,
      automatic:
        passiveText === undefined
          ? kind === 'greatPerson'
            ? (AUTOMATIC_EFFECTS.get(name) ?? null)
            : null
          : passiveText,
      passive: passiveText !== undefined,
      discards: kind === 'culture' || discardsWhenUsed(item.description),
      coinSources:
        name === 'Mother Teresa'
          ? investableCoinsOf(state, player).map((source) => ({
              ...source,
              label: findCoinSource(source.key)?.label ?? source.key,
            }))
          : [],
      substituteResources:
        name === 'Marie Curie'
          ? ['Iron', 'Wheat', 'Spy', 'Silk', 'Incense']
          : [],
    }
    if (waiting.has(item.id)) {
      return [
        {
          ...base,
          status: 'unavailable',
          reason: `${name} is one of the cards you are choosing between. Choose the card to keep first.`,
        },
      ]
    }
    if (item.kind === 'greatperson' && item.type !== null && blockaded.includes(item.type)) {
      return [
        {
          ...base,
          status: 'unavailable',
          reason: `Every ${item.type} figure of yours is blockaded, so ${name} cannot be used.`,
        },
      ]
    }
    const usedThisTurn = player.playerTurns
      .find((turn) => turn.turnNumber === turnStatus(state).currentTurn)
      ?.usedActions.includes('card:Mother Teresa')
    if (name === 'Mother Teresa' && usedThisTurn === true) {
      return [
        {
          ...base,
          status: 'used',
          reason: 'Mother Teresa can give only one coin each turn.',
        },
      ]
    }
    if (name === 'Mother Teresa' && base.coinSources.length === 0) {
      return [
        {
          ...base,
          status: 'unavailable',
          reason: 'You have no coin token to give. Put a coin on your sheet or a tech card first.',
        },
      ]
    }
    if (name === 'Thomas Edison' && revealedTechNamesOfOthers(state, player.playerId).length === 0) {
      return [
        {
          ...base,
          status: 'unavailable',
          reason: 'No other player has revealed a tech for Edison to research.',
        },
      ]
    }
    return [{ ...base, ...playableIn(base.timings, now) }]
  })
}

const joinNames = (names: readonly string[]): string =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`

type PlayCardEffect = Extract<AssistedEffect, { readonly kind: 'playCard' }>

interface Automated {
  readonly state: GameState
  readonly extra: Pick<
    PlayCardEffect,
    | 'gain'
    | 'drew'
    | 'starter'
    | 'grantId'
    | 'wonderDiscount'
    | 'coin'
    | 'advance'
    | 'curieSubstitute'
    | 'usedAction'
    | 'galileo'
  >
  /** The end of the public line: what the game did for the card. */
  readonly said: string
}

/** The current turn's record, or a fresh one when the player has not written anything yet. */
function turnFor(state: GameState, player: Playerhand) {
  const turnNumber = turnStatus(state).currentTurn
  return player.playerTurns.find((turn) => turn.turnNumber === turnNumber) ?? createPlayerTurn(player.username, turnNumber)
}

/**
 * The effects of a Great Person card the game can carry out itself, because they need
 * no choice on the map: trade or culture gained, or a unit card drawn. Every other card
 * is only logged and discarded, and the player does the rest by hand. `Err` is a
 * sentence for the player, and then the card stays in the hand.
 */
function automate(
  state: GameState,
  player: Playerhand,
  name: string,
  at: string | undefined,
  payload: PlayCardPayload | undefined,
  targets: readonly Playerhand[],
  requestId: string,
): Result<Automated | null, string> {
  const gained = (trade: number, culture: number, said: string): Result<Automated, string> =>
    ok({
      state: withPlayerHand(state, {
        ...player,
        stats: { ...player.stats, trade: player.stats.trade + trade, culture: player.stats.culture + culture },
      }),
      extra: { gain: { trade, culture } },
      said,
    })
  switch (name) {
    case 'Marco Polo': {
      const trade = Math.max(0, Math.min(tradeCeilingOf(player.civilization?.name), player.stats.trade + 27) - player.stats.trade)
      return gained(trade, 0, `, gaining ${trade} trade`)
    }
    case 'St. Francis of Assisi': {
      const armies = unbuiltArmies(state, player)
      return gained(0, armies * 3, `, gaining ${armies * 3} culture for ${armies} unbuilt ${armies === 1 ? 'army' : 'armies'}`)
    }
    case 'Orville Wright': {
      const sheetName = unitSheetOf('aircraft')
      const drawn = drawCandidates(state, sheetName, 1)
      const first = drawn.ok ? drawn.value.items[0] : undefined
      if (!drawn.ok || first === undefined) return err('No aircraft unit cards are left in the deck or the discard pile.')
      const card = { ...first, ownerId: player.playerId, hidden: true }
      const holder = playerOf(drawn.value.state, player.playerId) ?? player
      return ok({
        state: withPlayerHand(drawn.value.state, { ...holder, items: [...holder.items, card] }),
        extra: { drew: { itemId: card.id, sheetName } },
        said: ', building an aircraft unit for free',
      })
    }
    case 'Khalid ibn al-Walid': {
      const current = startPlayerOf(state)
      if (current === undefined || current.playerId === player.playerId) {
        return ok({ state, extra: {}, said: `, but ${player.username} was already the start player` })
      }
      const moved = placeStartMarker(state, player, player.playerId, at)
      const entry = moved.board.history.at(-1)
      if (moved === state || entry === undefined) return err('The start player marker could not be moved to your area.')
      return ok({
        state: { ...moved, startPlayerId: player.playerId },
        extra: { starter: { from: current.playerId, historyId: entry.id } },
        said: `, becoming the start player (next turn passes clockwise from ${player.username})`,
      })
    }
    case 'Michelangelo': {
      if (player.wonderDiscount > 0) return err('Michelangelo\'s discount is already armed for your next wonder.')
      return ok({
        state: withPlayerHand(state, { ...player, wonderDiscount: 5 }),
        extra: { wonderDiscount: 5 },
        said: ', taking 5 production off their next wonder',
      })
    }
    case 'Thomas Edison': {
      const target = targets[0]
      const allowedTechNames =
        target?.techsChosen.filter((tech) => !tech.hidden).map((tech) => tech.name).sort((a, b) => a.localeCompare(b)) ?? []
      if (allowedTechNames.length === 0) {
        return err(`${target?.username ?? 'That player'} has not revealed a tech to research.`)
      }
      const grant: TechGrant = {
        id: requestId,
        source: 'Thomas Edison',
        level: null,
        turnNumber: turnStatus(state).currentTurn,
        allowedTechNames,
      }
      return ok({
        state: withPlayerHand(state, { ...player, techGrants: [...player.techGrants, grant] }),
        extra: { grantId: grant.id },
        said: `, and may research one tech another player knows (${allowedTechNames.join(', ')}) for free`,
      })
    }
    case 'Mother Teresa': {
      const target = targets[0]
      const source = payload?.coinSource
      if (target === undefined || source === undefined) return err('Choose the player and the coin token to give.')
      const known = findCoinSource(source)
      const coins = coinSourcesOf(state, player)
      const held = known === undefined ? 0 : coins[source as keyof typeof coins]
      if (known === undefined || typeof held !== 'number' || held < 1) {
        return err(`You have no ${known?.label ?? source} coin to give.`)
      }
      const usedKey = 'card:Mother Teresa'
      const turn = turnFor(state, player)
      if (turn.usedActions.includes(usedKey)) return err('Mother Teresa can give only one coin each turn.')

      const payer = withPlayerHand(state, {
        ...player,
        stats: { ...player.stats, coinSources: withCoinSource(player.stats.coinSources, source as never, held - 1) },
      })
      const recipient = playerOf(payer, target.playerId) ?? target
      const paid = withPlayer(payer, {
        ...recipient,
        stats: {
          ...recipient.stats,
          coinSources: withCoinSource(
            recipient.stats.coinSources,
            'sheet',
            recipient.stats.coinSources.sheet + 1,
          ),
        },
      })
      const advanced = performAdvance(
        paid,
        playerOf(paid, player.playerId) ?? player,
        { requestId, at },
        { free: true, tagLog: false },
      )
      if (!advanced.ok) return err('The free culture advance could not be made.')
      const holder = playerOf(advanced.value.state, player.playerId) ?? player
      const marked = useTurnAction(advanced.value.state, holder, turn, usedKey, holder.stats)
      return ok({
        state: marked,
        extra: {
          coin: { source: known.key, targetId: target.playerId },
          advance: advanced.value.effect,
        },
        said: `, gave their ${known.label} coin to ${target.username} and advanced one space for free`,
      })
    }
    case 'Captain James Cook': {
      const key = 'card:Captain James Cook'
      const turn = turnFor(state, player)
      if (turn.usedActions.includes(key)) {
        return err('Captain James Cook can double travel speed only once each turn.')
      }
      return ok({
        state: useTurnAction(state, player, turn, key, player.stats),
        extra: { usedAction: { key, turnNumber: turn.turnNumber } },
        said: ', doubling their travel speed until the end of the turn',
      })
    }
    case GALILEO_NAME: {
      const from = payload?.from
      const to = payload?.to
      if (from === undefined || to === undefined) {
        return err('Choose a source square with your figures and an empty outer-edge destination.')
      }
      const figures = galileoFiguresAt(state.board, player, from)
      if (figures.length === 0) {
        return err(`No figure of yours stands on ${squareLabel(from)}.`)
      }
      const sameSquare = from.column === to.column && from.row === to.row
      if (sameSquare) {
        if (!isOuterEdgeCell(state.board, from)) {
          return err('Galileo can only lock figures in place when they stand on the outer edge.')
        }
      } else {
        if (!isOuterEdgeCell(state.board, to)) {
          return err('The destination must be a square on the outer edge of the map.')
        }
        if (!galileoDestinationAllowed(state.board, to)) {
          return err(`${squareLabel(to)} is not an empty outer-edge square.`)
        }
      }

      const turnNumber = turnStatus(state).currentTurn
      const sourceX = from.column * state.board.squareSize
      const sourceY = mapTop(state.board) + from.row * state.board.squareSize
      const destX = to.column * state.board.squareSize
      const destY = mapTop(state.board) + to.row * state.board.squareSize
      const moves: {
        pieceId: string
        from: { x: number; y: number }
        to: { x: number; y: number }
        movementFrom: PieceMovement | null
        historyId: string
      }[] = []
      let current = state
      for (const figure of figures) {
        const before = figure.movement?.turn === turnNumber ? figure.movement : null
        const movementTo: PieceMovement = {
          turn: turnNumber,
          used: before?.used ?? 0,
          locked: true,
        }
        const x = destX + (figure.x - sourceX)
        const y = destY + (figure.y - sourceY)
        const next = moveFigureWithMovementUnchecked(current, {
          playerId: player.playerId,
          pieceId: figure.id,
          x,
          y,
          movementFrom: figure.movement ?? null,
          movementTo,
          description: sameSquare
            ? `locked ${figure.label} on ${squareLabel(from)} with ${GALILEO_NAME}`
            : `moved ${figure.label} from ${squareLabel(from)} to ${squareLabel(to)} with ${GALILEO_NAME}`,
          ...(at === undefined ? {} : { at }),
        })
        if (next === undefined) return err('The figures could not be moved.')
        const historyId = next.board.history.at(-1)?.id
        if (historyId === undefined) return err('The move could not be recorded.')
        current = next
        moves.push({
          pieceId: figure.id,
          from: { x: figure.x, y: figure.y },
          to: { x, y },
          movementFrom: figure.movement ?? null,
          historyId,
        })
      }
      return ok({
        state: current,
        extra: { galileo: { from, to, moves } },
        said: sameSquare
          ? `, locked ${figures.length} ${figures.length === 1 ? 'figure' : 'figures'} on ${squareLabel(from)}`
          : `, moved ${figures.length} ${figures.length === 1 ? 'figure' : 'figures'} from ` +
            `${squareLabel(from)} to ${squareLabel(to)}`,
      })
    }
    case 'Marie Curie': {
      const substitute = payload?.substitute
      if (substitute === undefined) return err('Choose the resource to spend instead of Uranium.')
      if (player.curieSubstitute !== null) return err('Marie Curie is already armed for the next Uranium spend.')
      return ok({
        state: withPlayerHand(state, { ...player, curieSubstitute: substitute }),
        extra: { curieSubstitute: substitute },
        said: ', so their next Uranium spend may use the resource they chose instead',
      })
    }
    default:
      return ok(null)
  }
}

export const playCard: AssistedActionDefinition = {
  kind: 'playCard',
  techName: null,
  label: 'Play a card',
  button: false,
  usageKey: null,
  phase: 'ANY',
  group: 'Cards',
  labelOf: (record) => (record.effect.kind === 'playCard' ? record.effect.name : 'Play a card'),

  // Which card can be played depends on the card chosen, so `apply` decides with the
  // payload and says why in its own words; a player is always allowed to try.
  availability(state, playerId) {
    return playerOf(state, playerId) === undefined
      ? blocked('unavailable', 'You are not a player in this game.')
      : READY
  },

  apply(state, player, context) {
    const payload = context.payload
    if (payload === undefined || !('itemId' in payload) || !('targets' in payload) || !Array.isArray(payload.targets)) {
      return err(rejected('playCard', blocked('unavailable', 'Choose the card to play.')))
    }
    const card = playableCardsOf(state, player).find((candidate) => candidate.itemId === payload.itemId)
    if (card === undefined) {
      return err(rejected('playCard', blocked('unavailable', 'That card is not in your hand, or cannot be played.')))
    }
    if (card.status !== 'ready') return err(rejected('playCard', blocked(card.status, card.reason)))

    // Who the card names: every other player for a card that hits all, else the choice
    const others = state.players.filter((candidate) => candidate.playerId !== player.playerId)
    const named =
      card.targets.kind === 'allOthers'
        ? others
        : card.targets.kind === 'none'
          ? []
          : payload.targets.map((id) => others.find((candidate) => candidate.playerId === id))
    if (named.some((target) => target === undefined) || new Set(payload.targets).size !== payload.targets.length) {
      return err(rejected('playCard', blocked('unavailable', 'Choose other players of this game, each once.')))
    }
    const targets = named.filter((target): target is Playerhand => target !== undefined)
    if (card.targets.kind === 'none' && payload.targets.length > 0) {
      return err(rejected('playCard', blocked('unavailable', `${card.name} names no player.`)))
    }
    if (card.targets.kind === 'players' && (targets.length < card.targets.min || targets.length > card.targets.max)) {
      const { min, max } = card.targets
      const wanted = min === max ? `${min}` : `${min} to ${max}`
      return err(rejected('playCard', blocked('unavailable', `${card.name} names ${wanted} other player${max === 1 ? '' : 's'}.`)))
    }

    if (card.name === 'Mother Teresa' && !card.coinSources.some((source) => source.key === payload.coinSource)) {
      return err(rejected('playCard', blocked('unavailable', 'Choose one of your coin tokens to give.')))
    }
    if (
      card.name === 'Marie Curie' &&
      (payload.substitute === undefined || !card.substituteResources.includes(payload.substitute))
    ) {
      return err(rejected('playCard', blocked('unavailable', `Choose a resource to spend instead of Uranium: ${card.substituteResources.join(', ')}.`)))
    }

    // The resource a card is played as
    const resource = payload.resource ?? null
    if (card.resources.length > 0) {
      if (resource === null || !card.resources.includes(resource)) {
        return err(rejected('playCard', blocked('unavailable', `Choose a resource: ${card.resources.join(', ')}.`)))
      }
    } else if (resource !== null) {
      return err(rejected('playCard', blocked('unavailable', `${card.name} is not played as a resource.`)))
    }

    const item = player.items.find((candidate) => candidate.id === card.itemId)
    if (item === undefined) {
      return err(rejected('playCard', blocked('unavailable', 'That card is not in your hand.')))
    }
    const now = currentPhaseOf(state, player.playerId)
    const when = card.timings.includes('ANY') ? CARD_TIMING_TEXT.ANY : CARD_TIMING_TEXT[now ?? 'SOT']

    // The card leaves the hand: to the discard pile, or faceup in place for a Great Person that stays
    const moved: GameState = card.discards
      ? {
          ...withPlayerHand(state, { ...player, items: player.items.filter((candidate) => candidate.id !== item.id) }),
          discardedItems: [...state.discardedItems, { ...item, hidden: true }],
        }
      : withPlayerHand(state, {
          ...player,
          items: player.items.map((candidate) => (candidate.id === item.id ? { ...candidate, hidden: false } : candidate)),
        })

    const automated =
      card.kind === 'greatPerson'
        ? automate(moved, playerOf(moved, player.playerId) ?? player, card.name, context.at, payload, targets, context.requestId)
        : ok<Automated | null>(null)
    if (!automated.ok) return err(rejected('playCard', blocked('unavailable', automated.error)))
    const after = automated.value?.state ?? moved

    const verb = card.kind === 'culture' ? 'played' : card.discards ? 'played' : 'used'
    const aimed =
      card.targets.kind === 'allOthers'
        ? ', targeting every other player'
        : targets.length > 0
          ? `, targeting ${joinNames(targets.map((target) => target.username))}`
          : ''
    const logged = appendLog(after, {
      username: player.username,
      playerId: player.playerId,
      publicLog:
        `${player.username} ${verb} ${card.name} (${when})` +
        (resource === null ? '' : ` as ${resource}`) +
        aimed +
        (card.discards && card.kind === 'greatPerson' ? ' and discarded it' : '') +
        (automated.value === null ? '' : automated.value.said),
      privateLog: '',
      createdAt: context.at ?? null,
      assistedActionId: context.requestId,
    })
    return ok({
      state: logged,
      effect: {
        kind: 'playCard',
        item,
        discarded: card.discards,
        targets: targets.map((target) => target.playerId),
        resource,
        name: card.name,
        ...automated.value?.extra,
      },
      logId: lastLogId(logged),
    })
  },

  reverse(state, player, record, at) {
    const effect = record.effect
    if (effect.kind !== 'playCard') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    const blockedBy = (reason: string) => err({ kind: 'ASSISTED_UNDO_BLOCKED' as const, logId: record.logId, reason })

    // What the game did besides logging goes first, checked before anything changes
    const drewCard = effect.drew === undefined ? undefined : player.items.find((candidate) => candidate.id === effect.drew?.itemId)
    if (effect.drew !== undefined && drewCard === undefined) {
      return blockedBy(`The unit card ${effect.name} gave is no longer in ${player.username}'s hand.`)
    }
    if (effect.discarded && !state.discardedItems.some((candidate) => candidate.id === effect.item.id)) {
      return blockedBy(`${effect.name} is no longer in the discard pile.`)
    }
    if (!effect.discarded && !player.items.some((candidate) => candidate.id === effect.item.id)) {
      return blockedBy(`${effect.name} has left ${player.username}'s hand.`)
    }

    if (effect.starter !== undefined && startPlayerOf(state)?.playerId !== player.playerId) {
      return blockedBy(`${player.username} is no longer the start player, so ${effect.name} cannot be undone.`)
    }
    const grant =
      effect.grantId === undefined
        ? undefined
        : player.techGrants.find((candidate) => candidate.id === effect.grantId)
    if (effect.grantId !== undefined && grant === undefined) {
      return blockedBy(`The free tech ${effect.name} gave is no longer pending.`)
    }
    if (grant?.usedFor !== undefined) {
      return blockedBy(`The free tech from ${effect.name} was already used for ${grant.usedFor}. Remove that tech first.`)
    }
    if (effect.wonderDiscount !== undefined && player.wonderDiscount < effect.wonderDiscount) {
      return blockedBy(`The ${effect.wonderDiscount}-production discount from ${effect.name} has already been used.`)
    }
    if (effect.curieSubstitute !== undefined && player.curieSubstitute !== effect.curieSubstitute) {
      return blockedBy(`The Uranium substitution from ${effect.name} has already been used or replaced.`)
    }
    if (effect.galileo !== undefined) {
      const movedAway = effect.galileo.moves.find((move) => {
        const piece = state.board.pieces.find((candidate) => candidate.id === move.pieceId)
        return piece === undefined || piece.x !== move.to.x || piece.y !== move.to.y
      })
      if (movedAway !== undefined) {
        return blockedBy(`${effect.name} cannot be undone: a figure it moved has been moved again.`)
      }
    }
    const coinTarget =
      effect.coin === undefined ? undefined : playerOf(state, effect.coin.targetId)
    if (effect.coin !== undefined && (coinTarget === undefined || coinTarget.stats.coinSources.sheet < 1)) {
      return blockedBy(`${coinTarget?.username ?? 'The other player'} no longer has the coin ${effect.name} gave them.`)
    }

    let current: GameState = state
    let hand: Playerhand = player
    if (effect.starter !== undefined) {
      const previous = state.players.find((candidate) => candidate.playerId === effect.starter?.from)
      if (previous === undefined) return blockedBy('The previous start player has left the game.')
      current = { ...placeStartMarker(current, previous, player.playerId, at ?? undefined), startPlayerId: previous.playerId }
    }
    if (effect.advance !== undefined) {
      const reversed = reverseAdvanceEffect(current, player, record, effect.advance, at)
      if (!reversed.ok) return reversed
      current = reversed.value.state
      hand = playerOf(current, player.playerId) ?? hand
    }
    if (effect.gain !== undefined) {
      hand = {
        ...hand,
        stats: {
          ...hand.stats,
          trade: Math.max(0, hand.stats.trade - effect.gain.trade),
          culture: Math.max(0, hand.stats.culture - effect.gain.culture),
        },
      }
    }
    if (effect.drew !== undefined && drewCard !== undefined) {
      current = {
        ...withPlayerHand(current, { ...hand, items: hand.items.filter((candidate) => candidate.id !== drewCard.id) }),
        items: [...current.items, { ...drewCard, hidden: true, ownerId: null }],
      }
      current = shuffleSheetTwice(current, effect.drew.sheetName)
      hand = playerOf(current, player.playerId) ?? hand
    }
    if (effect.grantId !== undefined) {
      hand = { ...hand, techGrants: hand.techGrants.filter((candidate) => candidate.id !== effect.grantId) }
    }
    if (effect.wonderDiscount !== undefined) {
      hand = { ...hand, wonderDiscount: Math.max(0, hand.wonderDiscount - effect.wonderDiscount) }
    }
    if (effect.curieSubstitute !== undefined) {
      hand = { ...hand, curieSubstitute: null }
    }
    if (effect.galileo !== undefined) {
      for (const move of [...effect.galileo.moves].reverse()) {
        const piece = current.board.pieces.find((candidate) => candidate.id === move.pieceId)
        if (piece === undefined) return blockedBy(`${effect.name} cannot be undone: a figure it moved is gone.`)
        const next = moveFigureWithMovementUnchecked(current, {
          playerId: player.playerId,
          pieceId: move.pieceId,
          x: move.from.x,
          y: move.from.y,
          movementFrom: piece.movement ?? null,
          movementTo: move.movementFrom,
          description: `moved ${piece.label} back with ${effect.name}`,
          ...(at === null || at === undefined ? {} : { at }),
        })
        if (next === undefined) return blockedBy(`${effect.name} cannot be undone: a figure could not be moved back.`)
        current = next
      }
      hand = playerOf(current, player.playerId) ?? hand
    }
    if (effect.coin !== undefined && coinTarget !== undefined) {
      const recipient = playerOf(current, effect.coin.targetId) ?? coinTarget
      current = withPlayer(current, {
        ...recipient,
        stats: {
          ...recipient.stats,
          coinSources: withCoinSource(recipient.stats.coinSources, 'sheet', recipient.stats.coinSources.sheet - 1),
        },
      })
      const source = effect.coin.source as keyof typeof hand.stats.coinSources
      hand = {
        ...hand,
        stats: {
          ...hand.stats,
          coinSources: withCoinSource(hand.stats.coinSources, source, hand.stats.coinSources[source] + 1),
        },
      }
    }

    const freeTurnUse = (state: GameState): GameState => {
      let freed = state
      if (effect.coin !== undefined) {
        freed = freeTurnAction(freed, playerOf(freed, player.playerId) ?? hand, record.turnNumber, 'card:Mother Teresa')
      }
      if (effect.usedAction !== undefined) {
        freed = freeTurnAction(
          freed,
          playerOf(freed, player.playerId) ?? hand,
          effect.usedAction.turnNumber,
          effect.usedAction.key,
        )
      }
      return freed
    }
    if (effect.discarded) {
      const back: GameState = freeTurnUse({
        ...withPlayerHand(current, { ...hand, items: [...hand.items, effect.item] }),
        discardedItems: current.discardedItems.filter((candidate) => candidate.id !== effect.item.id),
      })
      return ok({ state: back, text: `${player.username}'s ${effect.name} was undone: the card is back in their hand` })
    }
    const back = freeTurnUse(
      withPlayerHand(current, {
        ...hand,
        items: hand.items.map((candidate) =>
          candidate.id === effect.item.id ? { ...candidate, hidden: effect.item.hidden } : candidate,
        ),
      }),
    )
    return ok({ state: back, text: `${player.username}'s use of ${effect.name} was undone: the card is facedown again` })
  },
}
