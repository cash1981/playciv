/**
 * Port av `no.asgari.civilization.server.action.DrawAction`.
 *
 * Alt er rene funksjoner: `(state, action) => Result<GameState, EngineError>`.
 * Java muterte pbf-objektet og skrev til Mongo underveis; her returneres ny
 * tilstand, og feil er verdier istedenfor `WebApplicationException`.
 */

import type { EngineError } from '../errors.js'
import type { Item } from '../item.js'
import { isTradable, isUnit, revealAll, revealPublic } from '../item.js'
import {
  appendItemLog,
  appendPrivateLog,
  appendPrivatePublicLog,
  appendPublicLog,
  appendShuffleLog,
} from '../log.js'
import { shuffle } from '../random.js'
import type { Result } from '../result.js'
import { err, ok } from '../result.js'
import type { SheetName } from '../sheet-name.js'
import { SHEET_LABEL, SHUFFLABLE_ITEMS, TECHS } from '../sheet-name.js'
import type { GameState, Playerhand } from '../state.js'
import { findPlayer, withPlayer } from '../state.js'

type DrawResult = Result<GameState, EngineError>

function requirePlayer(
  state: GameState,
  playerId: string,
): Result<Playerhand, EngineError> {
  const player = findPlayer(state, playerId)
  if (player === undefined) return err({ kind: 'PLAYER_NOT_FOUND', playerId })
  return ok(player)
}

/** Java: `BaseAction.checkYourTurn`. */
function requireYourTurn(player: Playerhand): Result<Playerhand, EngineError> {
  if (!player.yourTurn) return err({ kind: 'NOT_YOUR_TURN', playerId: player.playerId })
  return ok(player)
}

export interface DrawInput {
  readonly playerId: string
  readonly sheetName: SheetName
}

/**
 * Java: `DrawAction.draw`.
 *
 * Trekker første item av angitt type fra stokken, legger det i spillerens hånd
 * og logger. Er stokken tom for typen, reshuffles den fra `discardedItems` og
 * trekket forsøkes én gang på nytt.
 */
export function draw(state: GameState, input: DrawInput): DrawResult {
  const found = requirePlayer(state, input.playerId)
  if (!found.ok) return found
  const turn = requireYourTurn(found.value)
  if (!turn.ok) return turn
  const player = turn.value

  // Java loggførte en warning og returnerte Optional.empty() her
  if (TECHS.has(input.sheetName)) {
    return err({ kind: 'TECHS_ARE_CHOSEN_NOT_DRAWN', sheetName: input.sheetName })
  }

  const index = state.items.findIndex((item) => item.sheetName === input.sheetName)
  if (index >= 0) {
    return ok(takeFromDeck(state, player, index))
  }

  // Stokken er tom for denne typen. Java reshufflet og kalte draw() på nytt.
  const reshuffled = reshuffleItems(state, input.sheetName)
  if (!reshuffled.ok) return reshuffled

  const retryIndex = reshuffled.value.items.findIndex(
    (item) => item.sheetName === input.sheetName,
  )
  if (retryIndex < 0) {
    // Kan ikke skje: reshuffle feiler hvis det ikke fant noe å legge tilbake
    return err({ kind: 'ITEM_NOT_FOUND', sheetName: input.sheetName })
  }
  return ok(takeFromDeck(reshuffled.value, player, retryIndex))
}

/**
 * Flytter itemet på `index` fra stokken til spillerens hånd og logger trekket.
 * Java satte `hidden = true` i `createDraw` — items er allerede skjulte fra
 * ItemReader, så det er bare en bekreftelse.
 */
function takeFromDeck(state: GameState, player: Playerhand, index: number): GameState {
  const item = state.items[index] as Item
  const drawn: Item = { ...item, ownerId: player.playerId, hidden: true }

  const withDeck: GameState = {
    ...state,
    items: [...state.items.slice(0, index), ...state.items.slice(index + 1)],
  }
  const withHand = withPlayer(withDeck, {
    ...player,
    items: [...player.items, drawn],
  })

  return appendItemLog(withHand, 'ITEM', player.username, player.playerId, drawn)
}

/**
 * Java: `DrawAction.reshuffleItems`.
 *
 * Merk hva denne IKKE gjør: den henter ingenting tilbake fra spillernes hender.
 * Kun `discardedItems` legges tilbake i stokken. `ItemReader.redrawableItems`
 * var bygget for å gjøre det, men ble aldri brukt noe sted i old-civ-rest.
 * Typer utenfor SHUFFLABLE_ITEMS — huts, villages, tiles, bystater og wonders —
 * kan ikke reshuffles i det hele tatt, og gir NOT_SHUFFLABLE.
 */
export function reshuffleItems(state: GameState, sheetName: SheetName): DrawResult {
  if (!SHUFFLABLE_ITEMS.has(sheetName)) {
    return err({ kind: 'NOT_SHUFFLABLE', sheetName })
  }

  const toPutBack = state.discardedItems.filter((item) => item.sheetName === sheetName)
  if (toPutBack.length === 0) {
    return err({ kind: 'NO_MORE_ITEMS', what: SHEET_LABEL[sheetName] })
  }
  const toKeep = state.discardedItems.filter((item) => item.sheetName !== sheetName)

  const [shuffled, rng] = shuffle(toPutBack, state.rng)
  const next: GameState = {
    ...state,
    rng,
    items: [...state.items, ...shuffled],
    discardedItems: toKeep,
  }

  return ok(appendShuffleLog(next, SHEET_LABEL[sheetName]))
}

// ---------------------------------------------------------------------------
// Battlehand
// ---------------------------------------------------------------------------

export interface BattlehandInput {
  readonly playerId: string
  readonly numberOfDraws: number
}

/**
 * Java: `DrawAction.drawUnitsFromBattlehandForBattle`.
 *
 * Tømmer battlehand, plukker inntil `numberOfDraws` tilfeldige units fra
 * hånden og legger dem i battlehand. Har spilleren færre units enn ønsket
 * antall, brukes alle.
 */
export function drawUnitsForBattle(state: GameState, input: BattlehandInput): DrawResult {
  const found = requirePlayer(state, input.playerId)
  if (!found.ok) return found
  const player = found.value

  const unitsInHand = player.items.filter(isUnit)

  if (unitsInHand.length === 0) {
    return ok(withPlayer(state, { ...player, battlehand: [] }))
  }

  if (unitsInHand.length <= input.numberOfDraws) {
    const next = withPlayer(state, { ...player, battlehand: unitsInHand })
    // Java skrev «units his battlehand» her og «units from his battlehand»
    // under. Skrivefeilen er beholdt fordi loggene er sammenlignbare data.
    return ok(
      appendPublicLog(
        next,
        player.username,
        player.playerId,
        `has drawn ${unitsInHand.length} units his battlehand`,
      ),
    )
  }

  const [shuffled, rng] = shuffle(unitsInHand, state.rng)
  const drawn = shuffled.slice(0, input.numberOfDraws)
  const next = withPlayer({ ...state, rng }, { ...player, battlehand: drawn })

  return ok(
    appendPublicLog(
      next,
      player.username,
      player.playerId,
      `has drawn ${drawn.length} units from his battlehand`,
    ),
  )
}

/**
 * Java: `DrawAction.revealAndDiscardBattlehand`.
 *
 * Navnet lyver litt: units kastes ikke til `discardedItems`, battlehand tømmes
 * bare. Unitene ligger fortsatt i spillerens hånd.
 */
export function revealAndDiscardBattlehand(
  state: GameState,
  playerId: string,
): DrawResult {
  const found = requirePlayer(state, playerId)
  if (!found.ok) return found
  const player = found.value

  if (player.battlehand.length === 0) return ok(state)

  const revealed = player.battlehand.map(revealAll).join(', ')
  const next = withPlayer(state, { ...player, battlehand: [] })

  return ok(
    appendPublicLog(
      next,
      player.username,
      player.playerId,
      ` reveals ${revealed} from their battlehand`,
    ),
  )
}

/** Java: `DrawAction.endBattle` — nullstiller `inBattle` på alle units i hånden. */
export function endBattle(state: GameState, playerId: string): DrawResult {
  const found = requirePlayer(state, playerId)
  if (!found.ok) return found
  const player = found.value

  return ok(
    withPlayer(state, {
      ...player,
      items: player.items.map((item) =>
        isUnit(item) ? { ...item, inBattle: false } : item,
      ),
    }),
  )
}

// ---------------------------------------------------------------------------
// Barbarer
// ---------------------------------------------------------------------------

/** Rekkefølgen Java trakk barbarer i, og hvilke typer den faller tilbake på. */
const BARBARIAN_ORDER: readonly {
  readonly sheet: SheetName
  readonly fallbacks: readonly SheetName[]
}[] = [
  { sheet: 'INFANTRY', fallbacks: ['ARTILLERY', 'MOUNTED'] },
  { sheet: 'ARTILLERY', fallbacks: ['MOUNTED', 'INFANTRY'] },
  { sheet: 'MOUNTED', fallbacks: ['ARTILLERY', 'INFANTRY'] },
]

/**
 * Java: `DrawAction.drawBarbarians` — trekker inntil tre barbarenheter, én av
 * hver type. Er en type tom, forsøkes reshuffle; går ikke det, trekkes en annen
 * type i stedet, i den rekkefølgen Java brukte.
 */
export function drawBarbarians(state: GameState, playerId: string): DrawResult {
  const found = requirePlayer(state, playerId)
  if (!found.ok) return found

  if (found.value.barbarians.length > 0) {
    return err({ kind: 'BARBARIANS_NOT_DISCARDED', playerId })
  }

  let current = state
  for (const { sheet, fallbacks } of BARBARIAN_ORDER) {
    const drawn = drawOneBarbarian(current, playerId, sheet, fallbacks)
    if (!drawn.ok) return drawn
    current = drawn.value
  }

  const player = findPlayer(current, playerId)
  if (player === undefined) return err({ kind: 'PLAYER_NOT_FOUND', playerId })

  return ok(
    appendPrivatePublicLog(
      current,
      player.username,
      playerId,
      `has drawn ${player.barbarians.length} barbarian units`,
    ),
  )
}

function drawOneBarbarian(
  state: GameState,
  playerId: string,
  sheet: SheetName,
  fallbacks: readonly SheetName[],
): DrawResult {
  const direct = addBarbarian(state, playerId, sheet)
  if (direct !== null) return ok(direct)

  const reshuffled = reshuffleItems(state, sheet)
  if (reshuffled.ok) {
    const afterReshuffle = addBarbarian(reshuffled.value, playerId, sheet)
    if (afterReshuffle !== null) return ok(afterReshuffle)
  }

  // Java: fant den ikke noe å reshuffle, forsøkte den en annen unittype
  for (const fallback of fallbacks) {
    const substituted = addBarbarian(state, playerId, fallback)
    if (substituted !== null) {
      const player = findPlayer(substituted, playerId)
      if (player === undefined) return err({ kind: 'PLAYER_NOT_FOUND', playerId })
      return ok(
        appendPrivatePublicLog(
          substituted,
          player.username,
          playerId,
          ` tried to draw ${SHEET_LABEL[sheet]} barbarian unit. However there are no more in the deck. Will instead draw ${SHEET_LABEL[fallback]} unit instead!`,
        ),
      )
    }
  }

  return err({ kind: 'NO_MORE_ITEMS', what: 'units' })
}

/** Java: `DrawAction.addBarbarian`. Returnerer null når stokken er tom. */
function addBarbarian(
  state: GameState,
  playerId: string,
  sheet: SheetName,
): GameState | null {
  const index = state.items.findIndex((item) => item.sheetName === sheet)
  if (index < 0) return null

  const item = state.items[index] as Item
  if (!isUnit(item)) return null

  const player = findPlayer(state, playerId)
  if (player === undefined) return null

  const withDeck: GameState = {
    ...state,
    items: [...state.items.slice(0, index), ...state.items.slice(index + 1)],
  }
  return withPlayer(withDeck, {
    ...player,
    barbarians: [...player.barbarians, { ...item, ownerId: playerId }],
  })
}

/**
 * Java: `DrawAction.discardBarbarians` — legger barbarene i `discardedItems`,
 * nullstiller eier og avslører dem offentlig.
 */
export function discardBarbarians(state: GameState, playerId: string): DrawResult {
  const found = requirePlayer(state, playerId)
  if (!found.ok) return found
  const player = found.value

  if (player.barbarians.length === 0) return ok(state)

  const discarded = player.barbarians.map((unit) => ({ ...unit, ownerId: null }))
  const revealed = player.barbarians.map(revealAll).join(', ')

  const next: GameState = {
    ...withPlayer(state, { ...player, barbarians: [] }),
    discardedItems: [...state.discardedItems, ...discarded],
  }

  return ok(
    appendPublicLog(
      next,
      player.username,
      player.playerId,
      ` reveals ${revealed} as barbarians`,
    ),
  )
}

// ---------------------------------------------------------------------------
// Loot
// ---------------------------------------------------------------------------

export interface LootInput {
  /** Spilleren det tas fra. */
  readonly playerId: string
  /** Spilleren som mottar. */
  readonly targetPlayerId: string
  readonly sheetNames: ReadonlySet<SheetName>
}

/**
 * Java: `DrawAction.loot` — trekker et tilfeldig item av gitt type fra én
 * spillers hånd og gir det til en annen.
 *
 * Java sjekket at itemet er `Tradable` på element 0 av den USORTERTE listen, og
 * stokket først etterpå. Det er bevart: i praksis er alle items av samme
 * arktype like tradable, så sjekken er uansett homogen.
 */
export function loot(state: GameState, input: LootInput): DrawResult {
  const from = requirePlayer(state, input.playerId)
  if (!from.ok) return from
  const to = requirePlayer(state, input.targetPlayerId)
  if (!to.ok) return to

  const playerFrom = from.value
  const playerTo = to.value

  const candidates = playerFrom.items.filter((item) => input.sheetNames.has(item.sheetName))
  if (candidates.length === 0) {
    return err({ kind: 'NOTHING_TO_LOOT', playerId: input.playerId })
  }

  const first = candidates[0] as Item
  if (!isTradable(first)) {
    return err({ kind: 'ITEM_NOT_LOOTABLE', itemId: first.id })
  }

  const [shuffled, rng] = shuffle(candidates, state.rng)
  const itemToGive = shuffled[0] as Item

  let next: GameState = { ...state, rng }
  next = withPlayer(next, {
    ...playerFrom,
    items: playerFrom.items.filter((item) => item.id !== itemToGive.id),
  })
  const updatedTo = findPlayer(next, input.targetPlayerId) as Playerhand
  next = withPlayer(next, {
    ...updatedTo,
    items: [...updatedTo.items, { ...itemToGive, ownerId: playerTo.playerId }],
  })

  const all = revealAll(itemToGive)
  const pub = revealPublic(itemToGive)

  next = appendPrivateLog(
    next,
    playerFrom.username,
    playerFrom.playerId,
    ` is randomly looted ${all} and gives to ${playerTo.username}`,
  )
  next = appendPrivateLog(
    next,
    playerTo.username,
    playerTo.playerId,
    ` receives as loot ${all} from ${playerFrom.username}`,
  )
  next = appendPublicLog(
    next,
    playerFrom.username,
    playerFrom.playerId,
    ` is randomly looted ${pub} and gives to ${playerTo.username}`,
  )
  next = appendPublicLog(
    next,
    playerTo.username,
    playerTo.playerId,
    ` receives as loot ${pub} from ${playerFrom.username}`,
  )

  return ok(next)
}
