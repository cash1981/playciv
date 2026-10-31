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
import { DARWIN_NAME, KUROSAWA_NAME, payKurosawa, takeBackKurosawa } from './assisted-arts.js'
import { cityActionsOf } from './city-actions.js'
import { ZHENG_HE_NAME, lookUnderTokens, putBackTokens } from './zheng-he.js'
import {
  LOVELACE_ACTION_NOTE,
  LOVELACE_NAME,
  cityActionsTakenThisTurn,
  extraCityActionsLeft,
  lovelaceCreditWasUsed,
} from './assisted-core.js'
import { capitalOf, investableCoinsOf } from './sot.js'
import { coinSourcesOf, findCoinSource, totalCoins, withCoinSource } from './coins.js'
import { createPlayerTurn } from './turn.js'
import { moveFigureWithMovementUnchecked, placeStartMarker, placeUnchecked, removePiece } from './actions/board.js'
import { unbuiltArmies } from './assisted-abilities.js'
import {
  countLinesIn,
  drawCandidates,
  freeAdvancesLeft,
  livePendingRewards,
  performAdvance,
  reverseAdvanceEffect,
  shuffleSheetTwice,
} from './assisted-culture.js'
import { CULTURE_VICTORY_STEP, findBoardAsset, remainingBoardAssetCount } from './board.js'
import { cultureMarkerOf, rewardDrawCount } from './culture-track.js'
import { levelOfMarker } from './assisted-sot.js'
import { cultureCardsHeld, cultureHandSizeOf } from './culture-hand.js'
import { SHEET_LABEL } from './sheet-name.js'
import { buildSquareRefusal, freeBuildingSquaresOf, squareCentre, squareLabel, unitSheetOf } from './build-options.js'
import { cityFootprintsOf, mapCellOf } from './blockade.js'
import { cityLabelOf } from './disband.js'
import { cardMoveFigureChoices, cardMoveRuleOf, cardMoveSources } from './card-movement.js'
import {
  GALILEO_NAME,
  galileoDestinationAllowed,
  galileoFiguresAt,
  isOuterEdgeCell,
} from './galileo.js'
import { mapTop } from './board.js'
import { brandenburgForbiddenFor } from './brandenburg.js'
import { communismLocksOf } from './communism.js'
import type { BoardPiece, PieceMovement } from './board.js'
import {
  canCultureMoveFigure,
  cardMoveDestinations,
  cardWaterRulesOf,
  figuresAt,
} from './movement.js'
import { blockadedGreatPersonTypes } from './blockade.js'
import { buildingsInCitiesOf, revealedTechNamesOfOthers, stackingLimitOf } from './great-person-effects.js'
import {
  READY,
  blocked,
  freeTurnAction,
  lastLogId,
  levelSheet,
  playerOf,
  plural,
  rejected,
  useTurnAction,
  withPlayerHand,
} from './assisted-core.js'
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
import type { CardTiming, HarborChoice, PlayableCard } from './card-timing.js'
import { err, ok } from './result.js'
import type { Result } from './result.js'
import { itemName } from './item.js'
import type { Item } from './item.js'
import { appendLog } from './log.js'
import type { AssistedEffect, GameState, PendingReward, Playerhand } from './state.js'
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
  const waiting = waitingCardIds(player)
  return player.items.flatMap((item): readonly PlayableCard[] => {
    const kind = KIND_OF[item.kind]
    if (kind === undefined || item.description === null || item.description === undefined) return []
    const name = itemName(item)
    const passiveText = kind === 'greatPerson' ? PASSIVE_GREAT_PERSONS.get(name) : undefined
    const timings = timingsOf(item.description)
    if (timings.length === 0 && passiveText === undefined) return []
    if (item.kind === 'greatperson' && CARDS_WITH_OWN_BUTTON.has(name)) return []
    const rule = cardPlayRuleOf(name)
    const moveRule = cardMoveRuleOf(name)
    const mapMove =
      moveRule === undefined
        ? null
        : moveRule.kind === 'one'
          ? now === 'MOVEMENT'
            ? moveRule
            : null
          : now === 'CM'
            ? moveRule
            : null
    const base = {
      itemId: item.id,
      name,
      kind,
      description: item.description,
      inEffect: false,
      timings: passiveText === undefined ? timings : (['ANY'] as const),
      targets: rule.targets,
      prompt: rule.prompt,
      resources: rule.resources,
      automatic:
        passiveText === undefined
          ? kind === 'greatPerson'
            ? (AUTOMATIC_EFFECTS.get(name) ?? null)
            : mapMove === null
              ? null
              : mapMove.kind === 'one'
                ? `moves one of your figures up to ${mapMove.allowance} squares to an empty square`
                : `moves all figures of another player in a square up to ${mapMove.allowance} squares to an empty square`
          : passiveText,
      mapMove,
      passive: passiveText !== undefined,
      discards: kind === 'culture' || discardsWhenUsed(item.description),
      coinSources:
        name === 'Mother Teresa'
          ? investableCoinsOf(state, player).map((source) => ({
              ...source,
              label: findCoinSource(source.key)?.label ?? source.key,
            }))
          : [],
      conversion:
        name === 'Albert Einstein'
          ? {
              trade: player.stats.trade,
              // Only as much culture as the trade track has room for: more would be refused
              culture: Math.max(0, Math.min(player.stats.culture, tradeCeilingOf(player.civilization?.name) - player.stats.trade)),
            }
          : null,
      harbors: name === 'Jacques Cousteau' ? harborChoicesOf(state, player) : null,
      cultureHand:
        name === FRIDA
          ? cultureCardsOf(player).map((card) => ({ itemId: card.id, name: itemName(card) }))
          : null,
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
    // A kept Great Person is used once: the faceup card stays and its effect stands. Shakespeare has no
    // button effect at all, his skip is a choice of the advance, so showing him faceup is using him.
    const usedAlready =
      kind === 'greatPerson' &&
      !base.discards &&
      !item.hidden &&
      (name === 'William Shakespeare' ||
        state.assistedActions.some(
          (record) =>
            record.status === 'applied' &&
            record.playerId === player.playerId &&
            record.effect.kind === 'playCard' &&
            record.effect.item.id === item.id,
        ))
    if (usedAlready) {
      return [
        {
          ...base,
          inEffect: true,
          status: 'used',
          reason:
            name === 'William Shakespeare'
              ? 'William Shakespeare is faceup. Skip occupied spaces with the advance buttons on the culture track.'
              : `${name} has been used and stays faceup.`,
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

/** The cards drawn for a choice, which stay in the hand until one is kept. */
const waitingCardIds = (player: Playerhand): ReadonlySet<string> =>
  new Set(player.pendingRewards.flatMap((reward) => reward.candidateIds))

const FRIDA = 'Frida Kahlo'
const GIANNINI_NAME = 'A. P. Giannini'

/** The culture cards of the hand that are the player's own: not the ones still being chosen between. */
function cultureCardsOf(player: Playerhand): readonly Item[] {
  const waiting = waitingCardIds(player)
  return player.items.filter(
    (item) =>
      (item.kind === 'cultureI' || item.kind === 'cultureII' || item.kind === 'cultureIII') && !waiting.has(item.id),
  )
}

const HARBOR = 'buildings/harbor'

/** Every empty square where Jacques Cousteau can put a Harbor, with the city it belongs to. */
function harborChoicesOf(state: GameState, player: Playerhand): readonly HarborChoice[] {
  if (player.color === null) return []
  const choices: HarborChoice[] = []
  for (const footprint of cityFootprintsOf(state, player.color.toLowerCase())) {
    for (const square of freeBuildingSquaresOf(state, player, footprint.piece.id, HARBOR)) {
      // A square in the outskirts of two cities is listed once, under the first
      if (choices.some((choice) => choice.column === square.column && choice.row === square.row)) continue
      choices.push({
        cityPieceId: footprint.piece.id,
        cityLabel: cityLabelOf(state.board, footprint.piece),
        column: square.column,
        row: square.row,
        label: square.label,
      })
    }
  }
  return choices
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
    | 'freeAdvances'
    | 'harbors'
    | 'frida'
    | 'curieSubstitute'
    | 'usedAction'
    | 'galileo'
    | 'cardMove'
    | 'garcia'
    | 'kurosawa'
    | 'zhengHe'
  >
  /** The end of the public line: what the game did for the card. */
  readonly said: string
  /** A line for the player's own log, naming cards the public line must not. */
  readonly privateSaid?: string
  /** More lines for the player's own log, one entry each (Zheng He's look). */
  readonly privateLines?: readonly string[]
}

/** The current turn's record, or a fresh one when the player has not written anything yet. */
function turnFor(state: GameState, player: Playerhand) {
  const turnNumber = turnStatus(state).currentTurn
  return player.playerTurns.find((turn) => turn.turnNumber === turnNumber) ?? createPlayerTurn(player.username, turnNumber)
}

interface CardMoveResult {
  readonly state: GameState
  readonly moves: readonly {
    readonly pieceId: string
    readonly from: { readonly x: number; readonly y: number }
    readonly to: { readonly x: number; readonly y: number }
    readonly movement: PieceMovement | null
    readonly historyId: string
  }[]
}

/** Moves a set of figures together for a culture card, keeping their offsets within the square. */
function moveFiguresForCard(
  state: GameState,
  playerId: string,
  cardName: string,
  figures: readonly BoardPiece[],
  from: { readonly column: number; readonly row: number },
  to: { readonly column: number; readonly row: number },
  at: string | undefined,
): CardMoveResult | string {
  const sourceX = from.column * state.board.squareSize
  const sourceY = mapTop(state.board) + from.row * state.board.squareSize
  const destX = to.column * state.board.squareSize
  const destY = mapTop(state.board) + to.row * state.board.squareSize
  let current = state
  const moves: {
    pieceId: string
    from: { x: number; y: number }
    to: { x: number; y: number }
    movement: PieceMovement | null
    historyId: string
  }[] = []
  for (const figure of figures) {
    const x = destX + (figure.x - sourceX)
    const y = destY + (figure.y - sourceY)
    const next = moveFigureWithMovementUnchecked(current, {
      playerId,
      pieceId: figure.id,
      x,
      y,
      movementFrom: figure.movement ?? null,
      movementTo: figure.movement ?? null,
      description: `moved ${figure.label} from ${squareLabel(from)} to ${squareLabel(to)} with ${cardName}`,
      ...(at === undefined ? {} : { at }),
    })
    if (next === undefined) return 'The figures could not be moved.'
    const historyId = next.board.history.at(-1)?.id
    if (historyId === undefined) return 'The move could not be recorded.'
    current = next
    moves.push({
      pieceId: figure.id,
      from: { x: figure.x, y: figure.y },
      to: { x, y },
      movement: figure.movement ?? null,
      historyId,
    })
  }
  return { state: current, moves }
}

const sameCell = (
  a: { readonly column: number; readonly row: number },
  b: { readonly column: number; readonly row: number },
): boolean => a.column === b.column && a.row === b.row

const sameMovement = (a: PieceMovement | null, b: PieceMovement | null): boolean => {
  if (a === null || b === null) return a === b
  return a.turn === b.turn && a.used === b.used && a.locked === b.locked && a.reason === b.reason
}

const hasFlight = (player: Playerhand): boolean =>
  player.techsChosen.some((tech) => tech.name === 'Flight' && !tech.hidden)

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
    case 'Frank Lloyd Wright': {
      const buildings = buildingsInCitiesOf(state, player)
      const trade = Math.max(0, Math.min(tradeCeilingOf(player.civilization?.name), player.stats.trade + buildings) - player.stats.trade)
      return gained(
        trade,
        buildings,
        `, gaining ${trade} trade and ${buildings} culture for ${buildings} ${buildings === 1 ? 'building' : 'buildings'}`,
      )
    }
    case 'Albert Einstein': {
      const convert = payload?.convert
      if (convert === undefined || (convert.from !== 'trade' && convert.from !== 'culture')) {
        return err('Choose whether to turn trade into culture or culture into trade, and how much.')
      }
      const held = convert.from === 'trade' ? player.stats.trade : player.stats.culture
      if (held < 1) return err(`You have no ${convert.from} to turn.`)
      if (!Number.isInteger(convert.amount) || convert.amount < 1 || convert.amount > held) {
        return err(`Choose a whole amount from 1 to ${held} of your ${convert.from}.`)
      }
      if (convert.from === 'culture') {
        const room = tradeCeilingOf(player.civilization?.name) - player.stats.trade
        if (convert.amount > room) {
          return err(`Your trade track has room for only ${Math.max(0, room)} more trade.`)
        }
        return gained(convert.amount, -convert.amount, `, turning ${convert.amount} culture into ${convert.amount} trade`)
      }
      return gained(-convert.amount, convert.amount, `, turning ${convert.amount} trade into ${convert.amount} culture`)
    }
    case 'Andrew Carnegie': {
      const marker = cultureMarkerOf(state, player)
      if (marker === undefined) return err('Your leader marker is not on the culture track.')
      // One grant a turn, so an undo of it can tell that none of the bank is anyone else's
      if (player.freeAdvancesTurn === turnStatus(state).currentTurn) {
        return err('Andrew Carnegie has already given free advances this turn.')
      }
      const room = CULTURE_VICTORY_STEP - marker.step
      const earned = Math.min(Math.floor(totalCoins(coinSourcesOf(state, player)) / 3), room - freeAdvancesLeft(state, player))
      if (earned < 1) {
        return err(
          room <= 0 || freeAdvancesLeft(state, player) >= room
            ? 'There are no culture spaces left to advance onto.'
            : 'You need at least 3 coins to advance with Andrew Carnegie.',
        )
      }
      return ok({
        state: withPlayerHand(state, {
          ...player,
          freeAdvances: freeAdvancesLeft(state, player) + earned,
          freeAdvancesTurn: turnStatus(state).currentTurn,
        }),
        extra: { freeAdvances: earned },
        said: `, earning ${earned} free culture ${earned === 1 ? 'advance' : 'advances'} to make one space at a time`,
      })
    }
    case 'Jerry Garcia': {
      // The capital's own action: every city is devoted for the culture the board gives it, and the other
      // cities may still act (the card's text). The scouts' squares are not sent, so the figure can be
      // corrected by hand on the counter.
      const cities = cityActionsOf(state, player)
      const capitalPiece = capitalOf(state, player)
      const capital = capitalPiece === undefined ? undefined : cities.find((city) => city.cityPieceId === capitalPiece.id)
      if (capital === undefined) return err('You have no capital on the map, so there is no city action for Jerry Garcia to take.')
      const devoted = cities.map((city) => ({
        cityPieceId: city.cityPieceId,
        cityLabel: city.label,
        culture: city.devoteToTheArts.culture,
      }))
      const culture = devoted.reduce((total, city) => total + city.culture, 0)
      const acted = cityActionsTakenThisTurn(state, player, capital.cityPieceId)
      const gained = withPlayerHand(state, {
        ...player,
        stats: { ...player.stats, culture: player.stats.culture + culture },
      })
      const kurosawa = payKurosawa(gained, player, devoted.length)
      const list = devoted.map((city) => `${city.cityLabel} ${city.culture}`).join(', ')
      return ok({
        state: kurosawa.state,
        extra: {
          gain: { trade: 0, culture },
          garcia: { capitalPieceId: capital.cityPieceId, cities: devoted },
          ...(kurosawa.paid.length === 0 ? {} : { kurosawa: kurosawa.paid }),
        },
        said:
          `, devoting ${devoted.length} ${devoted.length === 1 ? 'city' : 'cities'} to the arts as the action of ${capital.label} ` +
          `and gaining ${culture} culture (${list})` +
          (acted.length === 0
            ? ''
            : extraCityActionsLeft(state, player) > 0
              ? LOVELACE_ACTION_NOTE
              : ` (${capital.label} had already acted this turn: ${acted.join(', ')})`) +
          kurosawa.said,
      })
    }
    case 'Jacques Cousteau': {
      const chosen = payload?.harbors ?? []
      if (chosen.length < 1 || chosen.length > 3) return err('Choose from 1 to 3 squares for the Harbors.')
      let working = state
      const built: { pieceId: string; historyId: string; cityPieceId: string; square: { column: number; row: number; label: string } }[] = []
      for (const [index, target] of chosen.entries()) {
        if (!Number.isInteger(target.column) || !Number.isInteger(target.row) || target.column < 0 || target.row < 0 || target.column > 999 || target.row > 999) {
          return err('Choose squares on the map.')
        }
        const where = squareLabel(target)
        if (chosen.findIndex((other) => other.column === target.column && other.row === target.row) !== index) {
          return err(`${where} is chosen twice.`)
        }
        const holder = playerOf(working, player.playerId) ?? player
        const legal = freeBuildingSquaresOf(working, holder, target.cityPieceId, HARBOR).find(
          (square) => square.column === target.column && square.row === target.row,
        )
        if (legal === undefined) {
          const why = buildSquareRefusal(working, holder, target.cityPieceId, { kind: 'building', assetId: HARBOR }, target)
          return err(`${why ?? `${where} cannot take a Harbor: it must be an empty water square in the outskirts of one of your cities.`}`)
        }
        const asset = findBoardAsset(HARBOR)
        if (asset === undefined) return err('The Harbor has no artwork to put on the board.')
        if ((remainingBoardAssetCount(asset, working.board.pieces, working.numOfPlayers) ?? Infinity) <= 0) {
          return err('There is no Harbor left in the supply.')
        }
        const centre = squareCentre(working.board, target)
        const placed = placeUnchecked(working, {
          playerId: player.playerId,
          assetId: HARBOR,
          x: centre.x - asset.width / 2,
          y: centre.y - asset.height / 2,
          ...(at === undefined ? {} : { at }),
        })
        const entry = placed?.board.history.at(-1)
        if (placed === undefined || entry === undefined || entry.change.kind !== 'place') {
          return err(`The Harbor could not be placed on ${where}.`)
        }
        const landed = mapCellOf(placed.board, entry.change.piece)
        if (landed === null || landed.column !== target.column || landed.row !== target.row) {
          return err(`The Harbor could not be placed on ${where}.`)
        }
        working = placed
        built.push({
          pieceId: entry.change.piece.id,
          historyId: entry.id,
          cityPieceId: target.cityPieceId,
          square: { column: target.column, row: target.row, label: where },
        })
      }
      return ok({
        state: working,
        extra: { harbors: built },
        said: `, building ${built.length === 1 ? 'a Harbor' : `${built.length} Harbors`} for free on ${joinNames(built.map((harbor) => harbor.square.label))}`,
      })
    }
    case 'Frida Kahlo': {
      const marker = cultureMarkerOf(state, player)
      if (marker === undefined) return err('Your leader marker is not on the culture track, so there is no culture deck to draw from.')
      // The start space belongs to no level; every other space, a Great Person space and the last one included, is in
      // the area of a level, as for Patronage
      if (marker.step < 1) return err('Your leader marker is still at the start of the culture track, so there is no culture deck to draw from.')
      const level = levelOfMarker(marker.step)
      const sheetName = levelSheet(level)
      const deck = `the ${SHEET_LABEL[sheetName]} deck`

      if (livePendingRewards(player).length > 0) {
        return err('Choose the card to keep from your last draw first.')
      }
      const wanted = payload?.discard ?? []
      if (!Array.isArray(wanted) || new Set(wanted).size !== wanted.length) {
        return err('Choose each culture card to discard once.')
      }
      const own = cultureCardsOf(player)
      const thrown = wanted.map((id) => own.find((card) => card.id === id))
      if (thrown.some((card) => card === undefined)) return err('Choose only culture cards from your own hand to discard.')
      const discarding = thrown.filter((card): card is Item => card !== undefined)

      const holder: Playerhand = { ...player, items: player.items.filter((card) => !wanted.includes(card.id)) }
      const discarded: GameState = {
        ...withPlayerHand(state, holder),
        discardedItems: [...state.discardedItems, ...discarding.map((card) => ({ ...card, hidden: true }))],
      }
      const room = Math.max(0, cultureHandSizeOf(discarded, holder) - cultureCardsHeld(holder))
      const thrownText = discarding.length === 0 ? '' : `discarding ${plural(discarding.length, 'culture card')}`
      const effectOf = (drawn: readonly string[]) => ({ frida: { discarded: discarding, drawn, sheetName } })
      if (room === 0) {
        return ok({
          state: discarded,
          extra: effectOf([]),
          said:
            discarding.length === 0
              ? ', but the culture hand was already full, so nothing was drawn'
              : `, ${thrownText}; the culture hand was already full, so nothing was drawn`,
          ...(discarding.length === 0 ? {} : { privateSaid: `${player.username} discarded ${discarding.map(itemName).join(', ')} with ${FRIDA}` }),
        })
      }
      // Every card of the hand is a draw of its own, which with Mysticism takes an extra card to choose from
      const count = rewardDrawCount(discarded, holder, 'event')
      let working = discarded
      const groups: Item[][] = []
      for (let draw = 0; draw < room; draw += 1) {
        const taken = drawCandidates(working, sheetName, count)
        if (!taken.ok) {
          if (groups.length === 0) return err(`No ${SHEET_LABEL[sheetName]} cards are left in the deck or the discard pile.`)
          break
        }
        working = taken.value.state
        const items = taken.value.items.map((card): Item => ({ ...card, ownerId: player.playerId, hidden: true }))
        if (items.length > 0) groups.push(items)
      }
      const cards = groups.flat()
      // A draw with one card has no choice: that card is kept
      const keptAtOnce = groups.flatMap((items) => (items.length === 1 ? items.map((card) => card.id) : []))
      // The second choice is `<request id>:2`, so the record of the card still finds both
      const rewards = groups.flatMap((items, draw): readonly PendingReward[] =>
        items.length < 2
          ? []
          : [
              {
                id: draw === 0 ? requestId : `${requestId}:${draw + 1}`,
                kind: 'event',
                level,
                step: marker.step,
                candidateIds: items.map((card) => card.id),
                keep: 1,
              },
            ],
      )
      const drawer = playerOf(working, player.playerId) ?? holder
      const drawnText =
        `drawing ${cards.length} from ${deck}` +
        (rewards.length === 0 ? '' : ', keeping one of each pair') +
        (groups.length < room ? ' (no more cards were left)' : '')
      return ok({
        state: withPlayerHand(working, {
          ...drawer,
          items: [...drawer.items, ...cards],
          pendingRewards: [...livePendingRewards(drawer), ...rewards],
        }),
        extra: { frida: { discarded: discarding, drawn: cards.map((card) => card.id), kept: keptAtOnce, sheetName } },
        said: `, ${thrownText === '' ? '' : `${thrownText} and `}${drawnText}`,
        privateSaid:
          `${player.username} ` +
          (discarding.length === 0 ? '' : `discarded ${discarding.map(itemName).join(', ')} and `) +
          `drew ${cards.map(itemName).join(', ')} (${SHEET_LABEL[sheetName]}) with ${FRIDA}` +
          (rewards.length === 0 ? '' : ', keeps one of each pair'),
      })
    }
    case 'Zheng He': {
      const look = lookUnderTokens(state, state.players.filter((candidate) => candidate.playerId !== player.playerId))
      return ok({
        state: look.state,
        extra: { zhengHe: { bound: look.bound } },
        said: ", looking under the hut and village tokens on the map and in the other players' hands",
        privateLines: look.lines,
      })
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
      if (figures.some((figure) => !canCultureMoveFigure(figure, turnStatus(state).currentTurn))) {
        return err(`A figure on ${squareLabel(from)} has already been moved by Galileo or Steam Power this turn and cannot move again.`)
      }
      if (communismLocksOf(state).some((cell) => sameCell(cell, from))) {
        return err(`${squareLabel(from)} is locked by Communism; no figure may leave it this turn.`)
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
        if (brandenburgForbiddenFor(state, player.playerId).some((cell) => sameCell(cell, to))) {
          return err(`${squareLabel(to)} is in the outskirts of a Brandenburg Gate; your figures may not end there.`)
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
          reason: 'galileo',
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
    case 'Hannibal': {
      const from = payload?.from
      const to = payload?.to
      if (from === undefined || to === undefined) {
        return err('Choose a source square with your figures and another square with your figures.')
      }
      if (sameCell(from, to)) return err('Hannibal moves figures to another square.')
      const sourceFigures = cardMoveFigureChoices(state.board, player, from, turnStatus(state).currentTurn)
      if (sourceFigures.length === 0) return err(`No movable figure of yours stands on ${squareLabel(from)}.`)
      if (communismLocksOf(state).some((cell) => sameCell(cell, from))) {
        return err(`${squareLabel(from)} is locked by Communism; no figure may leave it this turn.`)
      }
      const atDestination = figuresAt(state.board, player, to)
      if (atDestination.length === 0) {
        return err(`${squareLabel(to)} must already contain one of your figures.`)
      }
      if (brandenburgForbiddenFor(state, player.playerId).some((cell) => sameCell(cell, to))) {
        return err(`${squareLabel(to)} is in the outskirts of a Brandenburg Gate; your figures may not end there.`)
      }
      const selected =
        payload?.figureIds === undefined
          ? sourceFigures
          : sourceFigures.filter((figure) => payload.figureIds?.includes(figure.id) === true)
      if (selected.length === 0) return err('Choose at least one figure to move.')
      if (
        payload?.figureIds !== undefined &&
        (new Set(payload.figureIds).size !== payload.figureIds.length || selected.length !== payload.figureIds.length)
      ) {
        return err('Choose each figure in the source square only once.')
      }
      const room = stackingLimitOf(state, player) - atDestination.length
      if (selected.length > room) {
        return err(
          `${squareLabel(to)} has room for ${Math.max(0, room)} more of your figures, not ${selected.length}.`,
        )
      }
      const moved = moveFiguresForCard(state, player.playerId, name, selected, from, to, at)
      if (typeof moved === 'string') return err(moved)
      return ok({
        state: moved.state,
        extra: { cardMove: { card: name, kind: 'hannibal', from, to, moves: moved.moves } },
        said: `, moved ${selected.length} ${selected.length === 1 ? 'figure' : 'figures'} from ${squareLabel(from)} to ${squareLabel(to)}`,
      })
    }
    case 'Migrants':
    case 'Colonists':
    case 'Immigrants': {
      const rule = cardMoveRuleOf(name)
      const from = payload?.from
      const to = payload?.to
      if (rule === undefined || from === undefined || to === undefined) {
        return err('Choose one of your figures and an empty destination square.')
      }
      const turnNumber = turnStatus(state).currentTurn
      if (communismLocksOf(state).some((cell) => sameCell(cell, from))) {
        return err(`${squareLabel(from)} is locked by Communism; no figure may leave it this turn.`)
      }
      const choices = cardMoveFigureChoices(state.board, player, from, turnNumber)
      const figureId = payload?.figureId
      const figure =
        figureId === undefined
          ? choices.length === 1
            ? choices[0]
            : undefined
          : choices.find((candidate) => candidate.id === figureId)
      if (figure === undefined) return err('Choose one of your figures in the source square.')
      const destinations = cardMoveDestinations(
        state.board,
        from,
        rule.allowance,
        cardWaterRulesOf(player),
        hasFlight(player),
        communismLocksOf(state),
        brandenburgForbiddenFor(state, player.playerId),
        { owner: player, stackingLimit: stackingLimitOf(state, player) },
      )
      if (!destinations.some((cell) => sameCell(cell, to))) {
        return err(`${squareLabel(to)} is not an empty square within ${rule.allowance} of ${squareLabel(from)}.`)
      }
      const moved = moveFiguresForCard(state, player.playerId, name, [figure], from, to, at)
      if (typeof moved === 'string') return err(moved)
      return ok({
        state: moved.state,
        extra: { cardMove: { card: name, kind: 'one', from, to, moves: moved.moves } },
        said: `, moved ${figure.label} from ${squareLabel(from)} to ${squareLabel(to)}`,
      })
    }
    case 'Disoriented':
    case 'Lost':
    case 'Out of Position': {
      const rule = cardMoveRuleOf(name)
      const from = payload?.from
      const to = payload?.to
      if (rule === undefined || from === undefined || to === undefined) {
        return err('Choose a square with another player\'s figures and an empty destination.')
      }
      if (communismLocksOf(state).some((cell) => sameCell(cell, from))) {
        return err(`${squareLabel(from)} is locked by Communism; no figure may leave it this turn.`)
      }
      const holders = state.players
        .filter((candidate) => candidate.playerId !== player.playerId)
        .filter((candidate) => figuresAt(state.board, candidate, from).length > 0)
      const target = holders.length === 1 ? holders[0] : undefined
      if (target === undefined) {
        return err(`Choose a square holding figures of exactly one other player.`)
      }
      const turnNumber = turnStatus(state).currentTurn
      if (!cardMoveSources(state.board, target, turnNumber, 'group').some((cell) => sameCell(cell, from))) {
        return err(`No movable figures of ${target.username} stand on ${squareLabel(from)}.`)
      }
      const destinations = cardMoveDestinations(
        state.board,
        from,
        rule.allowance,
        { cross: false, end: false },
        hasFlight(target),
        communismLocksOf(state),
        brandenburgForbiddenFor(state, target.playerId),
        { owner: target, stackingLimit: stackingLimitOf(state, target) },
      )
      if (!destinations.some((cell) => sameCell(cell, to))) {
        return err(`${squareLabel(to)} is not an empty square within ${rule.allowance} of ${squareLabel(from)}.`)
      }
      const figures = figuresAt(state.board, target, from)
      const moved = moveFiguresForCard(state, player.playerId, name, figures, from, to, at)
      if (typeof moved === 'string') return err(moved)
      return ok({
        state: moved.state,
        extra: { cardMove: { card: name, kind: 'group', from, to, moves: moved.moves } },
        said:
          `, moved ${figures.length} ${figures.length === 1 ? 'figure' : 'figures'} of ` +
          `${target.username} from ${squareLabel(from)} to ${squareLabel(to)}`,
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
      card.kind === 'greatPerson' || card.mapMove != null
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
    const logId = lastLogId(logged)
    // Names of cards go to the player's own log only, after the public line the undo is tied to
    const privateLines = [
      ...(automated.value?.privateSaid === undefined ? [] : [automated.value.privateSaid]),
      ...(automated.value?.privateLines ?? []),
    ]
    const withPrivate = privateLines.reduce(
      (log, line) =>
        appendLog(log, { username: player.username, playerId: player.playerId, privateLog: line, createdAt: context.at ?? null }),
      logged,
    )
    return ok({
      state: countLinesIn(withPrivate, (automated.value?.extra.harbors ?? []).map((harbor) => harbor.historyId)),
      effect: {
        kind: 'playCard',
        item,
        discarded: card.discards,
        targets: targets.map((target) => target.playerId),
        resource,
        name: card.name,
        ...automated.value?.extra,
      },
      logId,
    })
  },

  reverse(state, player, record, at) {
    const effect = record.effect
    if (effect.kind !== 'playCard') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    const blockedBy = (reason: string) => err({ kind: 'ASSISTED_UNDO_BLOCKED' as const, logId: record.logId, reason })

    // Her extra city action cannot be taken away while a city action that used it is in force
    if (effect.name === LOVELACE_NAME && lovelaceCreditWasUsed(state, record.id)) {
      return blockedBy(`The extra city action from ${effect.name} has already been used. Undo that city action first.`)
    }

    // A devotion that Darwin or Kurosawa changed names the card play that made it so
    const dependentAction = state.assistedActions.find(
      (other) =>
        other.status === 'applied' &&
        ((effect.name === DARWIN_NAME && other.effect.kind === 'devoteToTheArts' && other.effect.darwinActivationId === record.id) ||
          (effect.name === KUROSAWA_NAME &&
            'kurosawa' in other.effect &&
            other.effect.kurosawa?.some((payment) => payment.cardActionId === record.id) === true)),
    )
    if (dependentAction !== undefined) {
      return blockedBy(`${effect.name} has already affected a devotion. Undo that devotion first.`)
    }

    // His free building came with his being faceup when the coin was invested
    if (
      effect.name === GIANNINI_NAME &&
      state.assistedActions.some((other) => other.status === 'applied' && other.kind === 'gianniniBuild' && other.playerId === record.playerId)
    ) {
      return blockedBy(`${effect.name} has already given a free building. Undo that building first.`)
    }

    // What the game did besides logging goes first, checked before anything changes
    const drewCard = effect.drew === undefined ? undefined : player.items.find((candidate) => candidate.id === effect.drew?.itemId)
    if (effect.drew !== undefined && drewCard === undefined) {
      return blockedBy(`The unit card ${effect.name} gave is no longer in ${player.username}'s hand.`)
    }
    if (effect.frida !== undefined) {
      const { drawn, discarded, kept = [] } = effect.frida
      const inHand = (id: string): boolean => player.items.some((candidate) => candidate.id === id)
      const inPile = (id: string): boolean => state.discardedItems.some((candidate) => candidate.id === id)
      // A card kept has to be in the hand; the others wait there for the choice or were put in the discard pile by it
      if (kept.some((id) => !inHand(id)) || drawn.some((id) => !kept.includes(id) && !inHand(id) && !inPile(id))) {
        return blockedBy(`A culture card ${effect.name} drew is no longer in ${player.username}'s hand, so it cannot be undone.`)
      }
      // A discard reshuffled into the deck and drawn again is among the drawn cards, and goes back with them
      if (discarded.some((card) => !drawn.includes(card.id) && !inPile(card.id))) {
        return blockedBy(`A culture card ${effect.name} discarded is no longer in the discard pile, so it cannot be undone.`)
      }
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
    if (
      effect.freeAdvances !== undefined &&
      (player.freeAdvancesTurn !== record.turnNumber || player.freeAdvances !== effect.freeAdvances)
    ) {
      return blockedBy(`Some of the free advances from ${effect.name} have already been made. Undo those advances first.`)
    }
    const missingHarbor = effect.harbors?.find(
      (harbor) => !state.board.pieces.some((piece) => piece.id === harbor.pieceId),
    )
    if (missingHarbor !== undefined) {
      return blockedBy(`The Harbor on ${missingHarbor.square.label} is no longer on the board, so ${effect.name} cannot be undone.`)
    }
    const movedHarbor = effect.harbors?.find((harbor) => {
      const piece = state.board.pieces.find((candidate) => candidate.id === harbor.pieceId)
      const cell = piece === undefined ? null : mapCellOf(state.board, piece)
      return cell === null || cell.column !== harbor.square.column || cell.row !== harbor.square.row
    })
    if (movedHarbor !== undefined) {
      return blockedBy(`The Harbor has left ${movedHarbor.square.label}. Move it back first.`)
    }
    if (effect.curieSubstitute !== undefined && player.curieSubstitute !== effect.curieSubstitute) {
      return blockedBy(`The Uranium substitution from ${effect.name} has already been used or replaced.`)
    }
    if (effect.galileo !== undefined) {
      const movedAway = effect.galileo.moves.find((move) => {
        const piece = state.board.pieces.find((candidate) => candidate.id === move.pieceId)
        // Still where the card put it and still carrying its lock from that turn: a later exploration
        // or move of the figure changes the allowance, which an undo would otherwise refund
        return (
          piece === undefined ||
          piece.x !== move.to.x ||
          piece.y !== move.to.y ||
          piece.movement?.turn !== record.turnNumber ||
          piece.movement.locked !== true ||
          piece.movement.reason !== 'galileo'
        )
      })
      if (movedAway !== undefined) {
        return blockedBy(`${effect.name} cannot be undone: a figure it moved has been moved again.`)
      }
    }
    if (effect.cardMove !== undefined) {
      const changed = effect.cardMove.moves.find((move) => {
        const piece = state.board.pieces.find((candidate) => candidate.id === move.pieceId)
        return (
          piece === undefined ||
          piece.x !== move.to.x ||
          piece.y !== move.to.y ||
          !sameMovement(piece.movement ?? null, move.movement)
        )
      })
      if (changed !== undefined) {
        return blockedBy(`${effect.name} cannot be undone: a figure it moved has moved or changed movement since.`)
      }
    }
    const coinTarget =
      effect.coin === undefined ? undefined : playerOf(state, effect.coin.targetId)
    if (effect.coin !== undefined && (coinTarget === undefined || coinTarget.stats.coinSources.sheet < 1)) {
      return blockedBy(`${coinTarget?.username ?? 'The other player'} no longer has the coin ${effect.name} gave them.`)
    }

    if (effect.garcia !== undefined && effect.gain !== undefined && player.stats.culture < effect.gain.culture) {
      return blockedBy(`Only ${player.stats.culture} culture is left, so the ${effect.gain.culture} culture from ${effect.name} cannot be taken back. It has been spent, or the counter was changed by hand.`)
    }

    // Einstein's gain is negative on the side he spent, so the undo gives that back: it has to fit
    // the track and the other side has to still hold what he gave, or the undo would invent resources
    if (effect.gain !== undefined && effect.name === 'Albert Einstein') {
      const trade = player.stats.trade - effect.gain.trade
      const culture = player.stats.culture - effect.gain.culture
      if (trade < 0 || culture < 0) {
        return blockedBy(`${player.username} has already spent what ${effect.name} gave, so it cannot be undone.`)
      }
      if (trade > tradeCeilingOf(player.civilization?.name)) {
        return blockedBy(`Giving the trade back would pass the end of ${player.username}'s trade track, so ${effect.name} cannot be undone.`)
      }
    }

    let current: GameState = state
    let hand: Playerhand = player
    if (effect.starter !== undefined) {
      const previous = state.players.find((candidate) => candidate.playerId === effect.starter?.from)
      if (previous === undefined) return blockedBy('The previous start player has left the game.')
      current = { ...placeStartMarker(current, previous, player.playerId, at ?? undefined), startPlayerId: previous.playerId }
    }
    for (const harbor of [...(effect.harbors ?? [])].reverse()) {
      const removed = removePiece(current, {
        playerId: player.playerId,
        pieceId: harbor.pieceId,
        ...(at === null || at === undefined ? {} : { at }),
      })
      if (!removed.ok) return blockedBy(`The Harbor on ${harbor.square.label} could not be taken off the board.`)
      current = removed.value
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
    if (effect.frida !== undefined) {
      const { drawn, discarded, sheetName } = effect.frida
      // The drawn cards go back to the deck first, from the hand or, once the choice was made, the discard pile; a
      // discard that was reshuffled and drawn again is among them
      const returning = [
        ...hand.items.filter((candidate) => drawn.includes(candidate.id)),
        ...current.discardedItems.filter((candidate) => drawn.includes(candidate.id)),
      ]
      const ownsChoice = (id: string): boolean => id === record.id || id.startsWith(`${record.id}:`)
      current = {
        ...withPlayerHand(current, {
          ...hand,
          items: hand.items.filter((candidate) => !drawn.includes(candidate.id)),
          pendingRewards: hand.pendingRewards.filter((reward) => !ownsChoice(reward.id)),
        }),
        discardedItems: current.discardedItems.filter((candidate) => !drawn.includes(candidate.id)),
        items: [...current.items, ...returning.map((card) => ({ ...card, hidden: true, ownerId: null }))],
      }
      const restored = discarded.map((card) => card.id)
      hand = playerOf(current, player.playerId) ?? hand
      current = {
        ...withPlayerHand(current, { ...hand, items: [...hand.items, ...discarded] }),
        discardedItems: current.discardedItems.filter((candidate) => !restored.includes(candidate.id)),
        items: current.items.filter((candidate) => !restored.includes(candidate.id)),
      }
      current = shuffleSheetTwice(current, sheetName)
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
    if (effect.freeAdvances !== undefined) {
      // The whole bank is this grant's: it is the only one of its turn and none of it is spent
      hand = { ...hand, freeAdvances: 0, freeAdvancesTurn: 0 }
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
    if (effect.cardMove !== undefined) {
      for (const move of [...effect.cardMove.moves].reverse()) {
        const piece = current.board.pieces.find((candidate) => candidate.id === move.pieceId)
        if (piece === undefined) return blockedBy(`${effect.name} cannot be undone: a figure it moved is gone.`)
        const next = moveFigureWithMovementUnchecked(current, {
          playerId: player.playerId,
          pieceId: move.pieceId,
          x: move.from.x,
          y: move.from.y,
          movementFrom: piece.movement ?? null,
          movementTo: move.movement,
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

    // What Zheng He's player saw is worth nothing after this: the tokens still set aside go back to the deck and the
    // two decks are shuffled, also what an earlier draw released on top of them
    if (effect.zhengHe !== undefined) {
      current = putBackTokens(current, effect.zhengHe.bound)
      for (const sheetName of new Set(effect.zhengHe.bound.map((token) => token.item.sheetName))) {
        current = shuffleSheetTwice(current, sheetName)
      }
      if (effect.zhengHe.bound.length > 0) {
        current = appendLog(current, {
          username: player.username,
          playerId: player.playerId,
          privateLog: `${ZHENG_HE_NAME}: the look was undone and the huts and villages were reshuffled, so what you saw no longer holds`,
          createdAt: at ?? null,
        })
      }
      hand = playerOf(current, player.playerId) ?? hand
    }

    // Akira Kurosawa's culture goes back from the holder, as far as it is still there
    const kurosawa = takeBackKurosawa(current, effect.kurosawa ?? [])
    current = kurosawa.state

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
      return ok({ state: back, text: `${player.username}'s ${effect.name} was undone: the card is back in their hand${kurosawa.said}` })
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
