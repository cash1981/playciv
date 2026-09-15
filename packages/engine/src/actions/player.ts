/**
 * Port av `no.asgari.civilization.server.action.PlayerAction`.
 *
 * Ikke portert hit, med vilje: `createPlayer`, `newPassword`, `verifyPassword`
 * og e-postutsending. Det er kontoadministrasjon og infrastruktur, ikke
 * spillregler, og hører i server-pakken.
 */

import { civTileAssetId, startingCorner } from '../board.js'
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
import type { GameState, Playerhand } from '../state.js'
import { findPlayer, hasUserAccess, withPlayer } from '../state.js'

import { placeUnchecked } from './board.js'
import { draw } from './draw.js'

type ActionResult = Result<GameState, EngineError>

/** Java: `SecurityCheck.hasUserAccess` fulgt av 403. */
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
// Teknologi
// ---------------------------------------------------------------------------

export interface ChooseTechInput {
  readonly playerId: string
  readonly techName: string
}

/**
 * Java: `PlayerAction.chooseTech`.
 *
 * Java muterte teknologien i `pbf.techs` (satte hidden og ownerId) og la SAMME
 * referanse i spillerens hånd, så den globale listen ble forurenset av hvem som
 * valgte hva. Her legges en kopi i hånden og `state.techs` står urørt — den er
 * katalogen over tilgjengelige teknologier, ikke en eierskapsliste.
 */
export function chooseTech(state: GameState, input: ChooseTechInput): ActionResult {
  const access = requireAccess(state, input.playerId)
  if (!access.ok) return access
  const player = access.value

  const tech = state.techs.find((candidate) => candidate.name === input.techName)
  if (tech === undefined) return err({ kind: 'ITEM_NOT_FOUND' })

  // Java: Tech har @EqualsAndHashCode(of = "name"), så likhet er på navn
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
 * Java tok imot hele `GameLog`-dokumentet, fordi teknologien lå lagret på
 * loggen i Mongo. Her holder navnet: teknologien i spillerens hånd er kilden.
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
 * Java gjorde `techs.removeAll(techsChosen)` på listen som kom fra Mongo, altså
 * en lesing som muterte tilstanden i minnet. Her er det en ren filtrering.
 */
export function remainingTechsForPlayer(
  state: GameState,
  playerId: string,
): readonly TechItem[] {
  const player = findPlayer(state, playerId)
  if (player === undefined) return state.techs

  const taken = new Set(player.techsChosen.map((tech) => tech.name))
  // Java la også til startteknologien fra sivilisasjonen
  if (player.civilization !== null) taken.add(player.civilization.startingTech.name)

  return state.techs
    .filter((tech) => !taken.has(tech.name))
    .sort((a, b) => a.level - b.level)
}

/** Java: `PlayerAction.getTechsForAllPlayers` — bare avslørte teknologier. */
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
// Avsløring av items
// ---------------------------------------------------------------------------

export interface RevealItemInput {
  readonly playerId: string
  readonly sheetName: SheetName
  /** Java lette først på itemNumber, deretter på navn. */
  readonly itemNumber?: number
  readonly name?: string
}

/**
 * Java: `PlayerAction.revealItem`.
 *
 * Å avsløre er egentlig bare å skrive en offentlig logglinje med det skjulte
 * innholdet. Unntaket er sivilisasjoner: da settes startteknologien, de andre
 * civ-kortene kastes, startenheter trekkes, og om alle har valgt civ trekkes
 * fire ancient wonders.
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

  // Java: isCivilization kastet 400 hvis sivilisasjon allerede var valgt
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
 * Java: sekvensen i `revealItem` når itemet er en Civ. Rekkefølgen er bevart:
 * sett startteknologi, logg REVEAL, trekk startenheter, kast de andre civ-ene,
 * og trekk wonders til slutt.
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

  // Java trakk startenheter bare hvis spilleren ikke hadde units fra før
  const hasUnits = (findPlayer(next, player.playerId)?.items ?? []).some(isUnit)
  if (!hasUnits) {
    const drawn = drawStartingItems(next, player.playerId, civ.name)
    if (!drawn.ok) return drawn
    next = drawn.value
  }

  next = discardTheOtherCivs(next, player.playerId, civ)
  next = placeStartingTile(next, player, civ)

  if (shouldDrawWonders(next)) {
    const drawn = drawStartingWonders(next, player.playerId)
    if (!drawn.ok) return drawn
    next = drawn.value
  }

  return ok(next)
}

/**
 * Legger sivilisasjonens startbrett i spillerens hjørne.
 *
 * Spiller 1 får øvre venstre luke (A1–D4), 2 øvre høyre, 3 nedre høyre og
 * 4 nedre venstre, og brettet snus så pilen peker inn mot midten. Se
 * `startingCorner` i board.ts for hvordan rotasjonen følger av det.
 *
 * Brettet kan flyttes og snus etterpå som alle andre brikker.
 */
function placeStartingTile(
  state: GameState,
  player: Playerhand,
  civ: CivItem,
): GameState {
  const assetId = civTileAssetId(civ.name)
  if (assetId === undefined) return state

  // Ikke legg ut det samme startbrettet to ganger
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
 * Java: `drawStartingItems`. Bare enheter, og en ancient wonder for Egypt.
 * Antallene kommer fra sivilisasjonskortene i regelboken.
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

/** Java: `drawStartingWonders` — fire ancient wonders. */
function drawStartingWonders(state: GameState, playerId: string): ActionResult {
  let next = appendInfoLog(state, 'Drawing 4 ancient wonders')
  for (let i = 0; i < 4; i++) {
    const drawn = draw(next, { playerId, sheetName: 'ANCIENT_WONDERS' })
    if (!drawn.ok) return drawn
    next = drawn.value
  }
  return ok(next)
}

/** Java: `deleteTheOtherCivs` — de civ-kortene spilleren ikke valgte kastes. */
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
 * Java: `shouldDrawWonders` — alle plasser fylt, alle har valgt sivilisasjon,
 * og ingen wonders er delt ut eller kastet ennå.
 */
function shouldDrawWonders(state: GameState): boolean {
  if (state.numOfPlayers !== state.players.length) return false
  if (!state.players.every((player) => player.civilization !== null)) return false

  const isWonder = (item: Item): boolean => item.kind === 'wonder'
  if (state.discardedItems.some(isWonder)) return false
  return !state.players.some((player) => player.items.some(isWonder))
}

// ---------------------------------------------------------------------------
// Sosialpolitikk
// ---------------------------------------------------------------------------

export interface ChooseSocialPolicyInput {
  readonly playerId: string
  readonly name: string
}

/**
 * Java: `PlayerAction.chooseSocialPolicy`.
 *
 * Ett avvik: Java lagde et helt nytt `SocialPolicy`-objekt med kun navn og
 * flipside, som betyr at `itemNumber` ble 0. Logglinjen bruker itemNumber til å
 * gi hver spiller sitt eget referansenummer, så med 0 fikk alle kort samme
 * nummer for samme spiller og funksjonen var virkningsløs. Her kopieres kortet
 * med sitt faktiske itemNumber.
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

  const chosen: SocialPolicyItem = { ...policy, ownerId: input.playerId, hidden: true }
  const next = withPlayer(state, {
    ...player,
    socialPolicies: [...player.socialPolicies, chosen],
  })

  return ok(appendItemLog(next, 'SOCIAL_POLICY', player.username, player.playerId, chosen))
}

// ---------------------------------------------------------------------------
// Handel og kasting
// ---------------------------------------------------------------------------

export interface TradeInput {
  readonly playerId: string
  readonly targetPlayerId: string
  readonly sheetName: SheetName
  readonly itemNumber?: number
  readonly name?: string
}

/**
 * Java: `PlayerAction.tradeToPlayer` — gir et Tradable item til en annen
 * spiller. I motsetning til `loot` er dette frivillig og spilleren velger selv
 * hvilket item.
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

  // Java: createTradeGameLog skrev to poster. Den første tilskrives MOTTAKEREN,
  // fordi Java hentet brukernavnet fra item.ownerId etter eierbyttet.
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
  // Den andre tilskrives giveren, og er kun privat
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
 * Java: `PlayerAction.discardItem`. Kastede items havner i `discardedItems`, som
 * er det reshuffle henter fra. Java satte bevisst IKKE `ownerId` til null her,
 * med kommentaren at det trengs i tilfelle undo.
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
// Tur
// ---------------------------------------------------------------------------

/**
 * Java: `PlayerAction.endTurn`.
 *
 * Advarsel, portert som-er: Java bryr seg ikke om hvem som kaller. Den finner
 * spilleren som HAR turen og gir den videre, så en spiller kan avslutte en
 * annens tur. Autorisasjonen lå i ressurslaget.
 *
 * Javas andre kodegren, en indeksbasert variant for spill laget før
 * `playernumber` fantes, er ikke portert. Nye spill får alltid playernumber.
 */
export function endTurn(state: GameState): ActionResult {
  const current = state.players.find((player) => player.yourTurn)
  if (current === undefined) return err({ kind: 'PLAYER_NOT_FOUND', playerId: '' })

  const nextNumber = current.playernumber + 1
  const firstPlayer = state.players.find((player) => player.playernumber === 1)
  const nextPlayer =
    state.players.find((player) => player.playernumber === nextNumber) ?? firstPlayer

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
 * Java: `PlayerAction.takeTurnButton` — tar turen fra hvem som helst. Fantes
 * for å komme videre når en spiller ble borte.
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

/** Java: `PlayerAction.isYourTurn` — en ren lesing, uten kast. */
export function isYourTurn(state: GameState, playerId: string): boolean {
  return findPlayer(state, playerId)?.yourTurn ?? false
}

/** Java: `PlayerAction.saveNote` — privat notat, aldri i noen offentlig logg. */
export function saveNote(state: GameState, playerId: string, note: string): ActionResult {
  const access = requireAccess(state, playerId)
  if (!access.ok) return access
  return ok(withPlayer(state, { ...access.value, gamenote: note }))
}

