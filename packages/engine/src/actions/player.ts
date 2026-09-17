/**
 * Port of `no.asgari.civilization.server.action.PlayerAction`.
 *
 * Deliberately not ported here: `createPlayer`, `newPassword`,
 * `verifyPassword` and email sending. Those are account administration and
 * infrastructure rather than game rules, and belong in the server package.
 */

import {
  civTileAssetId,
  cultureCellCenter,
  cultureStepOf,
  cultureTrackHeight,
  findBoardAsset,
  leaderAssetId,
  startingCorner,
} from '../board.js'
import type { EngineError } from '../errors.js'
import type { CivItem, Item, SocialPolicyItem, TechItem } from '../item.js'
import { isTradable, isUnit, itemName, revealAll } from '../item.js'
import {
  appendInfoLog,
  appendItemLog,
  appendLog,
  appendPublicLog,
  createLogTexts,
} from '../log.js'
import type { Result } from '../result.js'
import { err, ok } from '../result.js'
import type { SheetName } from '../sheet-name.js'
import type { GameState, Playerhand, PlayerStats } from '../state.js'
import { findPlayer, hasUserAccess, withPlayer } from '../state.js'

import { placeUnchecked } from './board.js'
import { draw } from './draw.js'

type ActionResult = Result<GameState, EngineError>

/** Java: `SecurityCheck.hasUserAccess` followed by a 403. */
function requireAccess(
  state: GameState,
  playerId: string,
): Result<Playerhand, EngineError> {
  if (!hasUserAccess(state, playerId)) return err({ kind: 'NO_ACCESS', playerId })
  const player = findPlayer(state, playerId)
  if (player === undefined) return err({ kind: 'PLAYER_NOT_FOUND', playerId })
  return ok(player)
}

// ---------------------------------------------------------------------------
// Techs
// ---------------------------------------------------------------------------

export interface ChooseTechInput {
  readonly playerId: string
  readonly techName: string
}

/**
 * Java: `PlayerAction.chooseTech`.
 *
 * Java mutated the tech in `pbf.techs` (setting hidden and ownerId) and put
 * the SAME reference in the player's hand, so the global list was polluted by
 * who chose what. Here a copy goes in the hand and `state.techs` is untouched —
 * it is the catalogue of available techs, not an ownership list.
 */
export function chooseTech(state: GameState, input: ChooseTechInput): ActionResult {
  const access = requireAccess(state, input.playerId)
  if (!access.ok) return access
  const player = access.value

  const tech = state.techs.find((candidate) => candidate.name === input.techName)
  if (tech === undefined) return err({ kind: 'ITEM_NOT_FOUND' })

  // Java: Tech has @EqualsAndHashCode(of = "name"), so equality is by name
  if (player.techsChosen.some((chosen) => chosen.name === tech.name)) {
    return err({ kind: 'TECH_ALREADY_CHOSEN', techName: tech.name })
  }

  const chosen: TechItem = { ...tech, hidden: true, ownerId: input.playerId }
  const next = withPlayer(state, {
    ...player,
    techsChosen: [...player.techsChosen, chosen],
  })

  return ok(appendItemLog(next, 'TECH', player.username, player.playerId, chosen))
}

/** Java: `PlayerAction.removeTech`. */
export function removeTech(state: GameState, input: ChooseTechInput): ActionResult {
  const access = requireAccess(state, input.playerId)
  if (!access.ok) return access
  const player = access.value

  const tech = player.techsChosen.find((candidate) => candidate.name === input.techName)
  if (tech === undefined) return err({ kind: 'ITEM_NOT_FOUND' })

  const next = withPlayer(state, {
    ...player,
    techsChosen: player.techsChosen.filter((candidate) => candidate.name !== tech.name),
  })

  return ok(appendItemLog(next, 'REMOVED_TECH', player.username, player.playerId, tech))
}

/**
 * Java: `PlayerAction.revealTech`.
 *
 * Java took the whole `GameLog` document, because the tech was stored on the
 * log in Mongo. The name is enough here: the tech in the player's hand is the
 * source of truth.
 */
export function revealTech(state: GameState, input: ChooseTechInput): ActionResult {
  const access = requireAccess(state, input.playerId)
  if (!access.ok) return access
  const player = access.value

  const tech = player.techsChosen.find((candidate) => candidate.name === input.techName)
  if (tech === undefined) return err({ kind: 'ITEM_NOT_FOUND' })

  const revealed: TechItem = { ...tech, hidden: false }
  const next = withPlayer(state, {
    ...player,
    techsChosen: player.techsChosen.map((candidate) =>
      candidate.name === tech.name ? revealed : candidate,
    ),
  })

  return ok(appendItemLog(next, 'REVEAL', player.username, player.playerId, revealed))
}

/**
 * Java: `PlayerAction.getRemaingTechsForPlayer`.
 *
 * Java did `techs.removeAll(techsChosen)` on the list that came from Mongo, a
 * read that mutated the in-memory state. Here it is a plain filter.
 */
export function remainingTechsForPlayer(
  state: GameState,
  playerId: string,
): readonly TechItem[] {
  const player = findPlayer(state, playerId)
  if (player === undefined) return state.techs

  const taken = new Set(player.techsChosen.map((tech) => tech.name))
  // Java also added the starting tech from the civilization
  if (player.civilization !== null) taken.add(player.civilization.startingTech.name)

  return state.techs
    .filter((tech) => !taken.has(tech.name))
    .sort((a, b) => a.level - b.level)
}

/** Java: `PlayerAction.getTechsForAllPlayers` — revealed techs only. */
export interface RevealedTechs {
  readonly civilization: string
  readonly color: string | null
  readonly techs: readonly { readonly name: string; readonly level: number }[]
}

export function revealedTechsForAllPlayers(state: GameState): readonly RevealedTechs[] {
  return state.players
    .filter((player) => player.civilization !== null)
    .map((player) => ({
      civilization: (player.civilization as CivItem).name,
      color: player.color,
      techs: player.techsChosen
        .filter((tech) => !tech.hidden)
        .map((tech) => ({ name: tech.name, level: tech.level })),
    }))
}

// ---------------------------------------------------------------------------
// Revealing items
// ---------------------------------------------------------------------------

export interface RevealItemInput {
  readonly playerId: string
  readonly sheetName: SheetName
  /** Java looked by itemNumber first, then by name. */
  readonly itemNumber?: number
  readonly name?: string
}

/**
 * Java: `PlayerAction.revealItem`.
 *
 * Revealing is really just writing a public log line carrying the hidden
 * contents. Civilizations are the exception: the starting tech is set, the
 * other civ cards are discarded, starting units are drawn, and once everyone
 * has chosen a civ, four ancient wonders are drawn.
 */
export function revealItem(state: GameState, input: RevealItemInput): ActionResult {
  const access = requireAccess(state, input.playerId)
  if (!access.ok) return access
  const player = access.value

  const byNumber = input.itemNumber === undefined
    ? undefined
    : player.items.find(
        (item) =>
          item.itemNumber === input.itemNumber &&
          item.sheetName === input.sheetName &&
          item.hidden,
      )

  const byName = input.name === undefined
    ? undefined
    : player.items.find(
        (item) =>
          itemName(item) === input.name &&
          item.sheetName === input.sheetName &&
          item.hidden,
      )

  const found = byNumber ?? byName
  if (found === undefined) {
    return err({ kind: 'ITEM_ALREADY_REVEALED', name: input.name ?? String(input.itemNumber) })
  }

  // Java: isCivilization threw a 400 when a civilization was already chosen
  if (input.sheetName === 'CIV' && player.civilization !== null) {
    return err({ kind: 'CIVILIZATION_ALREADY_CHOSEN', playerId: input.playerId })
  }

  const revealed: Item = { ...found, hidden: false }

  if (revealed.kind !== 'civ') {
    const next = withPlayer(state, {
      ...player,
      items: player.items.map((item) => (item.id === revealed.id ? revealed : item)),
    })
    return ok(appendItemLog(next, 'REVEAL', player.username, player.playerId, revealed))
  }

  return revealCivilization(state, player, revealed)
}

/**
 * Java: the sequence in `revealItem` when the item is a Civ. The order is
 * kept: set the starting tech, log REVEAL, draw starting units, discard the
 * other civs, and draw wonders last.
 */
function revealCivilization(
  state: GameState,
  player: Playerhand,
  civ: CivItem,
): ActionResult {
  // Java: setStartingTech
  const startingTech: TechItem = {
    ...civ.startingTech,
    hidden: false,
    ownerId: player.playerId,
  }

  let next = withPlayer(state, {
    ...player,
    civilization: civ,
    items: player.items.map((item) => (item.id === civ.id ? civ : item)),
    techsChosen: [...player.techsChosen, startingTech],
  })
  next = appendItemLog(next, 'REVEAL', player.username, player.playerId, civ)

  // Java drew starting units only if the player had none already
  const hasUnits = (findPlayer(next, player.playerId)?.items ?? []).some(isUnit)
  if (!hasUnits) {
    const drawn = drawStartingItems(next, player.playerId, civ.name)
    if (!drawn.ok) return drawn
    next = drawn.value
  }

  next = discardTheOtherCivs(next, player.playerId, civ)
  next = placeStartingTile(next, player, civ)
  next = placeLeaderMarker(next, player, civ)

  if (shouldDrawWonders(next)) {
    const drawn = drawStartingWonders(next, player.playerId)
    if (!drawn.ok) return drawn
    next = drawn.value
  }

  return ok(next)
}

/**
 * Puts the civilization's starting tile in the player's corner.
 *
 * Player 1 takes the top-left slot (A1-D4), 2 the top-right, 3 the
 * bottom-right and 4 the bottom-left, and the tile is turned so the arrow
 * points in towards the middle. See `startingCorner` in board.ts for how the
 * rotation follows from that.
 *
 * The tile can be moved and turned afterwards like any other piece.
 */
function placeStartingTile(
  state: GameState,
  player: Playerhand,
  civ: CivItem,
): GameState {
  const assetId = civTileAssetId(civ.name)
  if (assetId === undefined) return state

  // Do not lay out the same starting tile twice
  if (state.board.pieces.some((piece) => piece.assetId === assetId)) return state

  const corner = startingCorner(state.board, player.playernumber)
  return (
    placeUnchecked(state, {
      playerId: player.playerId,
      assetId,
      x: corner.x,
      y: corner.y,
      rotation: corner.rotation,
    }) ?? state
  )
}

/**
 * Puts the player's leader on the first space of the culture track.
 *
 * Which leader follows from the civilization and the player's colour, so
 * choosing Japan as the red player puts the red Japanese marker on Start. It is
 * an ordinary piece from there on: drag it along the track as you gain culture.
 */
function placeLeaderMarker(
  state: GameState,
  player: Playerhand,
  civ: CivItem,
): GameState {
  if (player.color === null) return state

  const assetId = leaderAssetId(civ.name, player.color)
  if (assetId === undefined) return state

  // A player who somehow reveals twice should not get a second marker
  if (state.board.pieces.some((piece) => piece.assetId === assetId)) return state

  const asset = findBoardAsset(assetId)
  if (asset === undefined) return state

  const start = cultureCellCenter(state.board, 0)
  const sharing = state.board.pieces.filter(
    (piece) => piece.category === 'leader' && cultureStepOf(state.board, piece) === 0,
  ).length
  const lanes = Math.max(1, Math.floor(cultureTrackHeight(state.board) / asset.height))

  return (
    placeUnchecked(state, {
      playerId: player.playerId,
      assetId,
      x: Math.round(start.x - asset.width / 2),
      y: Math.round(
        (cultureTrackHeight(state.board) - lanes * asset.height) / 2 +
          (sharing % lanes) * asset.height,
      ),
    }) ?? state
  )
}

/**
 * Java: `drawStartingItems`. Units only, plus one ancient wonder for Egypt.
 * The counts come from the civilization cards in the rulebook.
 */
const STARTING_UNITS: Readonly<Record<string, readonly SheetName[]>> = {
  Germans: ['INFANTRY', 'INFANTRY', 'INFANTRY', 'ARTILLERY', 'MOUNTED'],
  Mongols: ['INFANTRY', 'ARTILLERY', 'MOUNTED', 'MOUNTED', 'MOUNTED'],
  Zulu: ['INFANTRY', 'ARTILLERY', 'ARTILLERY', 'ARTILLERY', 'ARTILLERY', 'MOUNTED'],
  Egyptians: ['INFANTRY', 'ARTILLERY', 'MOUNTED', 'ANCIENT_WONDERS'],
}

const DEFAULT_STARTING_UNITS: readonly SheetName[] = ['INFANTRY', 'ARTILLERY', 'MOUNTED']

function drawStartingItems(
  state: GameState,
  playerId: string,
  civName: string,
): ActionResult {
  const sheets = STARTING_UNITS[civName] ?? DEFAULT_STARTING_UNITS
  let next = state
  for (const sheetName of sheets) {
    const drawn = draw(next, { playerId, sheetName })
    if (!drawn.ok) return drawn
    next = drawn.value
  }
  return ok(next)
}

/** Java: `drawStartingWonders` — four ancient wonders. */
function drawStartingWonders(state: GameState, playerId: string): ActionResult {
  let next = appendInfoLog(state, 'Drawing 4 ancient wonders')
  for (let i = 0; i < 4; i++) {
    const drawn = draw(next, { playerId, sheetName: 'ANCIENT_WONDERS' })
    if (!drawn.ok) return drawn
    next = drawn.value
  }
  return ok(next)
}

/** Java: `deleteTheOtherCivs` — the civ cards the player did not pick are discarded. */
function discardTheOtherCivs(state: GameState, playerId: string, chosen: CivItem): GameState {
  const player = findPlayer(state, playerId)
  if (player === undefined) return state

  const toDiscard = player.items.filter(
    (item) => item.kind === 'civ' && item.id !== chosen.id,
  )
  if (toDiscard.length === 0) return state

  const hidden = toDiscard.map((item) => ({ ...item, hidden: true }))

  let next: GameState = {
    ...withPlayer(state, {
      ...player,
      items: player.items.filter((item) => !toDiscard.some((other) => other.id === item.id)),
    }),
    discardedItems: [...state.discardedItems, ...hidden],
  }

  for (const item of hidden) {
    next = appendItemLog(next, 'DISCARD', player.username, playerId, item)
  }
  return next
}

/**
 * Java: `shouldDrawWonders` — every seat filled, everyone has chosen a
 * civilization, and no wonders have been dealt or discarded yet.
 */
function shouldDrawWonders(state: GameState): boolean {
  if (state.numOfPlayers !== state.players.length) return false
  if (!state.players.every((player) => player.civilization !== null)) return false

  const isWonder = (item: Item): boolean => item.kind === 'wonder'
  if (state.discardedItems.some(isWonder)) return false
  return !state.players.some((player) => player.items.some(isWonder))
}

// ---------------------------------------------------------------------------
// Social policy
// ---------------------------------------------------------------------------

export interface ChooseSocialPolicyInput {
  readonly playerId: string
  readonly name: string
}

/**
 * Java: `PlayerAction.chooseSocialPolicy`.
 *
 * Java built a brand-new `SocialPolicy` object with only a name and a flipside,
 * which left `itemNumber` at 0. Allocate a fresh number for each choice so the
 * same policy can be chosen again after removal without reusing its old log
 * reference.
 */
export function chooseSocialPolicy(
  state: GameState,
  input: ChooseSocialPolicyInput,
): ActionResult {
  const access = requireAccess(state, input.playerId)
  if (!access.ok) return access
  const player = access.value

  const policy = state.socialPolicies.find((candidate) => candidate.name === input.name)
  if (policy === undefined) return err({ kind: 'ITEM_NOT_FOUND' })

  if (player.socialPolicies.some((chosen) => chosen.name === policy.name)) {
    return err({ kind: 'SOCIAL_POLICY_ALREADY_CHOSEN', name: policy.name })
  }

  if (
    policy.flipside !== null &&
    player.socialPolicies.some((chosen) => chosen.name === policy.flipside)
  ) {
    return err({
      kind: 'SOCIAL_POLICY_FLIPSIDE_TAKEN',
      name: policy.name,
      flipside: policy.flipside,
    })
  }

  const itemNumber = state.itemCounter + 1
  const chosen: SocialPolicyItem = {
    ...policy,
    itemNumber,
    ownerId: input.playerId,
    hidden: true,
  }
  const next = {
    ...withPlayer(state, {
      ...player,
      socialPolicies: [...player.socialPolicies, chosen],
    }),
    itemCounter: itemNumber,
  }

  return ok(appendItemLog(next, 'SOCIAL_POLICY', player.username, player.playerId, chosen))
}

/** Remove a social policy chosen by the player. */
export function removeSocialPolicy(
  state: GameState,
  input: ChooseSocialPolicyInput,
): ActionResult {
  const access = requireAccess(state, input.playerId)
  if (!access.ok) return access
  const player = access.value

  const policy = player.socialPolicies.find((candidate) => candidate.name === input.name)
  if (policy === undefined) return err({ kind: 'ITEM_NOT_FOUND' })

  const next = withPlayer(state, {
    ...player,
    socialPolicies: player.socialPolicies.filter((candidate) => candidate.name !== policy.name),
  })

  return ok(appendItemLog(next, 'REMOVED_SOCIAL_POLICY', player.username, player.playerId, policy))
}

/**
 * There is no `PlayerAction.revealSocialPolicy` in Java — social policies were
 * never revealable there. This mirrors `revealTech` above, which is the
 * in-repo pattern for revealing a chosen item.
 */
export function revealSocialPolicy(
  state: GameState,
  input: ChooseSocialPolicyInput,
): ActionResult {
  const access = requireAccess(state, input.playerId)
  if (!access.ok) return access
  const player = access.value

  const policy = player.socialPolicies.find((candidate) => candidate.name === input.name)
  if (policy === undefined) return err({ kind: 'ITEM_NOT_FOUND' })

  const revealed: SocialPolicyItem = { ...policy, hidden: false }
  const next = withPlayer(state, {
    ...player,
    socialPolicies: player.socialPolicies.map((candidate) =>
      candidate.name === policy.name ? revealed : candidate,
    ),
  })

  return ok(appendItemLog(next, 'REVEAL', player.username, player.playerId, revealed))
}

// ---------------------------------------------------------------------------
// Trading and discarding
// ---------------------------------------------------------------------------

export interface TradeInput {
  readonly playerId: string
  readonly targetPlayerId: string
  readonly sheetName: SheetName
  readonly itemNumber?: number
  readonly name?: string
}

/**
 * Java: `PlayerAction.tradeToPlayer` — gives a Tradable item to another
 * player. Unlike `loot` this is voluntary, and the player picks the item.
 */
export function tradeToPlayer(state: GameState, input: TradeInput): ActionResult {
  const from = requireAccess(state, input.playerId)
  if (!from.ok) return from
  const to = requireAccess(state, input.targetPlayerId)
  if (!to.ok) return to

  const fromPlayer = from.value
  const toPlayer = to.value

  const matchesName = (item: Item): boolean =>
    input.name !== undefined && itemName(item).toLowerCase() === input.name.toLowerCase()

  const tradable = fromPlayer.items.filter(isTradable)
  const found =
    tradable.find((item) => item.itemNumber === input.itemNumber && matchesName(item)) ??
    tradable.find((item) => item.sheetName === input.sheetName && matchesName(item))

  if (found === undefined) return err({ kind: 'ITEM_NOT_FOUND', sheetName: input.sheetName })

  const traded: Item = { ...found, ownerId: toPlayer.playerId }

  let next = withPlayer(state, {
    ...fromPlayer,
    items: fromPlayer.items.filter((item) => item.id !== found.id),
  })
  const updatedTo = findPlayer(next, input.targetPlayerId) as Playerhand
  next = withPlayer(next, { ...updatedTo, items: [...updatedTo.items, traded] })

  // Java: createTradeGameLog wrote two entries. The first is attributed to the
  // RECEIVER, because Java read the username from item.ownerId after the swap.
  const texts = createLogTexts(
    'TRADE_BETWEEN_PLAYERS',
    toPlayer.username,
    traded,
    traded.itemNumber,
  )
  next = appendLog(next, {
    username: toPlayer.username,
    logType: 'TRADE_BETWEEN_PLAYERS',
    item: traded,
    playerId: toPlayer.playerId,
    ...texts,
  })
  // The second is attributed to the giver, and is private only
  next = appendLog(next, {
    username: fromPlayer.username,
    playerId: fromPlayer.playerId,
    privateLog: `${toPlayer.username} has received - ${revealAll(traded)}`,
    publicLog: '',
  })

  return ok(next)
}

export interface DiscardInput {
  readonly playerId: string
  readonly sheetName: SheetName
  readonly itemNumber?: number
  readonly name?: string
}

/**
 * Java: `PlayerAction.discardItem`. Discarded items land in `discardedItems`,
 * which is what a reshuffle draws from. Java deliberately did NOT set `ownerId`
 * to null here, noting that it is needed in case of an undo.
 */
export function discardItem(state: GameState, input: DiscardInput): ActionResult {
  const access = requireAccess(state, input.playerId)
  if (!access.ok) return access
  const player = access.value

  const matchesName = (item: Item): boolean =>
    input.name !== undefined && itemName(item).toLowerCase() === input.name.toLowerCase()

  const found =
    player.items.find((item) => item.itemNumber === input.itemNumber && matchesName(item)) ??
    player.items.find((item) => item.sheetName === input.sheetName && matchesName(item))

  if (found === undefined) return err({ kind: 'ITEM_NOT_FOUND', sheetName: input.sheetName })

  const discarded: Item = { ...found, hidden: true }
  const next: GameState = {
    ...withPlayer(state, {
      ...player,
      items: player.items.filter((item) => item.id !== found.id),
    }),
    discardedItems: [...state.discardedItems, discarded],
  }

  return ok(appendItemLog(next, 'DISCARD', player.username, player.playerId, discarded))
}

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

/**
 * Java: `PlayerAction.endTurn`.
 *
 * A warning, ported as it is: Java does not care who calls. It finds the
 * player who HAS the turn and passes it on, so one player can end another
 * player's turn. The authorisation lived in the resource layer.
 *
 * Java's other branch, an index-based variant for games made before
 * `playernumber` existed, is not ported. New games always have playernumber.
 */
export interface EndTurnActor {
  readonly playerId: string
  readonly username: string
}

// `_actor` is accepted (and passed by the route) but never read: Java's
// endTurn does not care who calls, and membership is gated at the route.
export function endTurn(state: GameState, _actor?: EndTurnActor): ActionResult {
  const firstPlayer = state.players[0]

  // Java kept a username/index fallback for games created before playernumber
  // was introduced. MongoDB still contains such games, but old `pbf` games are
  // never loaded as GameState (they are read-only — see the mongodb decision),
  // so this branch only ever sees an unstarted new game, where no player has a
  // playernumber yet. There is nothing to advance by index; report that plainly
  // instead of guessing at a next player.
  if ((firstPlayer?.playernumber ?? 0) <= 0) {
    return err({ kind: 'GAME_NOT_STARTED' })
  }

  const current = state.players.find((player) => player.yourTurn)
  if (current === undefined) return err({ kind: 'GAME_NOT_STARTED' })

  const nextNumber = current.playernumber + 1
  const firstNumberedPlayer = state.players.find((player) => player.playernumber === 1)
  const nextPlayer =
    state.players.find((player) => player.playernumber === nextNumber) ?? firstNumberedPlayer

  if (nextPlayer === undefined) return err({ kind: 'PLAYER_NOT_FOUND', playerId: '' })

  return ok({
    ...state,
    players: state.players.map((player) => {
      if (player.playerId === nextPlayer.playerId) return { ...player, yourTurn: true }
      if (player.playerId === current.playerId) return { ...player, yourTurn: false }
      return player
    }),
  })
}

/**
 * Java: `PlayerAction.takeTurnButton` — takes the turn from anyone. It existed
 * to keep things moving when a player went missing.
 */
export function takeTurn(state: GameState, playerId: string): ActionResult {
  const access = requireAccess(state, playerId)
  if (!access.ok) return access
  const player = access.value

  const next: GameState = {
    ...state,
    players: state.players.map((candidate) => ({
      ...candidate,
      yourTurn: candidate.playerId === playerId,
    })),
  }

  return ok(appendPublicLog(next, player.username, playerId, 'took turn button'))
}

/** Java: `PlayerAction.isYourTurn` — a plain read, with no throwing. */
export function isYourTurn(state: GameState, playerId: string): boolean {
  return findPlayer(state, playerId)?.yourTurn ?? false
}

/** Java: `PlayerAction.saveNote` — a private note, never in any public log. */
export function saveNote(state: GameState, playerId: string, note: string): ActionResult {
  const access = requireAccess(state, playerId)
  if (!access.ok) return access
  return ok(withPlayer(state, { ...access.value, gamenote: note }))
}

// ---------------------------------------------------------------------------
// Status board (issue #43)
//
// Java has no equivalent — the players tracked these values on a manual
// spreadsheet alongside the game. This replaces it with a shared board: every
// member of the game may edit every player's numbers, exactly as they could
// reach across the physical table and update someone else's tally.
// ---------------------------------------------------------------------------

const STAT_KEYS: readonly (keyof PlayerStats)[] = [
  'coins',
  'trade',
  'culture',
  'infantry',
  'artillery',
  'mounted',
  'stacking',
  'mvmt',
  'combat',
  'handSize',
  'efta',
  'infra',
  'mic',
  'pe',
]

const STAT_LABEL: Readonly<Record<keyof PlayerStats, string>> = {
  coins: 'coins',
  trade: 'trade',
  culture: 'culture',
  infantry: 'infantry',
  artillery: 'artillery',
  mounted: 'mounted',
  stacking: 'stacking',
  mvmt: 'movement',
  combat: 'combat',
  handSize: 'hand size',
  efta: 'EftA',
  infra: 'Infra',
  mic: 'MIC',
  pe: 'PE',
}

function isPlayerStatKey(stat: string): stat is keyof PlayerStats {
  return (STAT_KEYS as readonly string[]).includes(stat)
}

export interface SetPlayerStatInput {
  readonly editorPlayerId: string
  readonly targetPlayerId: string
  readonly stat: keyof PlayerStats
  readonly value: number
  /** ISO timestamp for the log entry. The engine itself stays pure. */
  readonly at?: string
}

/**
 * Sets one entry on a player's status board. Any current player may edit any
 * other current player's numbers — the board is shared bookkeeping, not a
 * private hand, so there is no owner-only restriction here.
 */
export function setPlayerStat(state: GameState, input: SetPlayerStatInput): ActionResult {
  const editorAccess = requireAccess(state, input.editorPlayerId)
  if (!editorAccess.ok) return editorAccess
  const editor = editorAccess.value

  const targetAccess = requireAccess(state, input.targetPlayerId)
  if (!targetAccess.ok) return targetAccess
  const target = targetAccess.value

  if (!isPlayerStatKey(input.stat)) {
    return err({ kind: 'UNKNOWN_STAT', stat: String(input.stat) })
  }

  const allowsNegative = input.stat === 'combat'
  if (!Number.isInteger(input.value) || (!allowsNegative && input.value < 0)) {
    return err({ kind: 'INVALID_STAT_VALUE', value: input.value })
  }

  const next = withPlayer(state, {
    ...target,
    stats: { ...target.stats, [input.stat]: input.value },
  })

  const message =
    editor.playerId === target.playerId
      ? `set their ${STAT_LABEL[input.stat]} to ${input.value}`
      : `set ${target.username}'s ${STAT_LABEL[input.stat]} to ${input.value}`

  return ok(
    appendLog(next, {
      username: editor.username,
      playerId: editor.playerId,
      publicLog: `${editor.username} ${message}`,
      privateLog: '',
      createdAt: input.at ?? null,
    }),
  )
}


