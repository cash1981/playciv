/**
 * Battle arena reducers — the engine side of issue #63.
 *
 * All functions are pure: `(state, input) => Result<GameState, EngineError>`.
 * The arena is entirely new (the old Java backend left battle as a TODO).
 *
 * Design decisions recorded in docs/agents/decisions.md.
 */

import { nextRotation } from '../board.js'
import type { Rotation } from '../board.js'
import type { EngineError } from '../errors.js'
import type { UnitItem } from '../item.js'
import { isUnit, revealAll } from '../item.js'
import { appendPublicLog } from '../log.js'
import { nextId } from '../random.js'
import type { Result } from '../result.js'
import { err, ok } from '../result.js'
import type { GameState, Playerhand } from '../state.js'
import { findPlayer, withPlayer } from '../state.js'
import type { ArenaUnit, BattleSideId } from '../battle.js'
import { drawBarbarians } from './draw.js'

type ActionResult = Result<GameState, EngineError>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requirePlayer(
  state: GameState,
  playerId: string,
): Result<Playerhand, EngineError> {
  const player = findPlayer(state, playerId)
  if (player === undefined) return err({ kind: 'PLAYER_NOT_FOUND', playerId })
  return ok(player)
}

function requireAccess(
  state: GameState,
  playerId: string,
): Result<Playerhand, EngineError> {
  const found = requirePlayer(state, playerId)
  if (!found.ok) return found
  const player = found.value
  if (!state.players.some((p) => p.playerId === playerId)) {
    return err({ kind: 'NO_ACCESS', playerId })
  }
  return ok(player)
}

/**
 * Finds the player to the left of `playerId` (next by index in `state.players`,
 * wrapping around). Using index rather than `playernumber + 1` avoids gaps when
 * a player has withdrawn and their number is no longer assigned.
 *
 * Returns undefined if `playerId` is not found.
 */
function playerToLeft(state: GameState, ofPlayerId: string): Playerhand | undefined {
  const idx = state.players.findIndex((p) => p.playerId === ofPlayerId)
  if (idx === -1) return undefined
  return state.players[(idx + 1) % state.players.length]
}

// ---------------------------------------------------------------------------
// initiateBattle
// ---------------------------------------------------------------------------

export interface InitiateBattleInput {
  readonly initiatorId: string
  /** A playerId or the literal string 'barbarians'. */
  readonly opponentId: string | 'barbarians'
}

/**
 * Starts a battle. The initiator is always the attacker.
 *
 * For barbarians: the system draws 3 barbarian units automatically (exactly as
 * `drawBarbarians` does, but for the player to the initiator's left). That
 * player is the barbarian controller.
 *
 * Errors if a battle is already active, or if the initiator names themselves
 * as the opponent.
 */
export function initiateBattle(
  state: GameState,
  input: InitiateBattleInput,
): ActionResult {
  if (state.battle !== null) return err({ kind: 'BATTLE_ALREADY_ACTIVE' })

  const initiatorFound = requireAccess(state, input.initiatorId)
  if (!initiatorFound.ok) return initiatorFound
  const initiator = initiatorFound.value

  if (input.opponentId === input.initiatorId) {
    return err({ kind: 'CANNOT_BATTLE_YOURSELF', playerId: input.initiatorId })
  }

  let current = state

  if (input.opponentId === 'barbarians') {
    // The player to the left controls the barbarians.
    const left = playerToLeft(state, input.initiatorId)
    if (left === undefined) return err({ kind: 'GAME_NOT_STARTED' })

    // Draw 3 barbarian units for the left-side player (their existing barbarian
    // mechanics — they play those units into the arena).
    const drawn = drawBarbarians(state, left.playerId)
    if (!drawn.ok) return drawn
    current = drawn.value

    const [battleId, rng2] = nextId(current.rng)
    current = { ...current, rng: rng2 }

    current = appendPublicLog(
      current,
      initiator.username,
      initiator.playerId,
      `has initiated a battle against the Barbarians (controlled by ${left.username})`,
    )

    return ok({
      ...current,
      battle: {
        id: battleId,
        attacker: { kind: 'player', playerId: input.initiatorId },
        defender: { kind: 'barbarians', playerId: left.playerId },
        turn: 'attacker',
        arena: [],
      },
    })
  }

  // Player vs player
  const opponentFound = requireAccess(state, input.opponentId)
  if (!opponentFound.ok) return opponentFound
  const opponent = opponentFound.value

  const [battleId, rng2] = nextId(current.rng)
  current = { ...current, rng: rng2 }

  current = appendPublicLog(
    current,
    initiator.username,
    initiator.playerId,
    `has initiated a battle against ${opponent.username}`,
  )

  return ok({
    ...current,
    battle: {
      id: battleId,
      attacker: { kind: 'player', playerId: input.initiatorId },
      defender: { kind: 'player', playerId: input.opponentId },
      turn: 'attacker',
      arena: [],
    },
  })
}

// ---------------------------------------------------------------------------
// placeUnitInArena
// ---------------------------------------------------------------------------

export interface PlaceUnitInArenaInput {
  readonly playerId: string
  /**
   * The id of the unit to place. Must be in the player's battlehand (attacker
   * side) or in their barbarians list (defender/barbarians side).
   */
  readonly unitId: string
  readonly side: BattleSideId
  /** The column index. Two units on the same position face each other. */
  readonly position: number
  /** Attack value (user-supplied; may differ from card value due to upgrades). */
  readonly attack: number
  /** Current health (user-supplied). */
  readonly health: number
}

/**
 * Moves a unit from the player's battlehand (or the barbarian list) into the
 * arena, marking it `inBattle` so it cannot be placed again.
 *
 * Does NOT flip the battle turn — the player must press "End battle turn"
 * separately, which allows playing a unit and then ending turn as two distinct
 * steps.
 */
export function placeUnitInArena(
  state: GameState,
  input: PlaceUnitInArenaInput,
): ActionResult {
  if (state.battle === null) return err({ kind: 'NO_BATTLE_ACTIVE' })

  const found = requireAccess(state, input.playerId)
  if (!found.ok) return found
  const player = found.value

  const battle = state.battle

  // Determine which side this player acts for
  const side = sideForPlayer(battle, input.playerId)
  if (side === null) return err({ kind: 'NOT_IN_THIS_BATTLE', playerId: input.playerId })

  // Validate that the declared side matches what the player controls
  if (side !== input.side) {
    return err({ kind: 'NOT_IN_THIS_BATTLE', playerId: input.playerId })
  }

  // Find the unit — in battlehand for player/attacker sides, in barbarians
  // for the barbarian controller
  const isBarbController =
    battle.defender.kind === 'barbarians' &&
    battle.defender.playerId === input.playerId &&
    input.side === 'defender'

  let sourceUnit: UnitItem | undefined
  if (isBarbController) {
    sourceUnit = player.barbarians.find((u) => u.id === input.unitId)
  } else {
    sourceUnit = player.battlehand.find((u) => isUnit(u) && u.id === input.unitId) as
      | UnitItem
      | undefined
  }

  if (sourceUnit === undefined) {
    return err({ kind: 'ITEM_NOT_FOUND' })
  }
  if (sourceUnit.inBattle) {
    return err({ kind: 'UNIT_ALREADY_IN_BATTLE', unitId: input.unitId })
  }

  const positionOccupied = battle.arena.some(
    (u) => u.side === input.side && u.position === input.position,
  )
  if (positionOccupied) {
    return err({ kind: 'ARENA_POSITION_OCCUPIED' })
  }

  // Mark the unit inBattle in the source hand
  let nextState: GameState
  if (isBarbController) {
    const updatedBarbarians = player.barbarians.map((u) =>
      u.id === input.unitId ? { ...u, inBattle: true } : u,
    )
    nextState = withPlayer(state, { ...player, barbarians: updatedBarbarians })
  } else {
    const updatedBattlehand = player.battlehand.map((u) =>
      u.id === input.unitId ? { ...u, inBattle: true } : u,
    )
    const updatedItems = player.items.map((it) =>
      it.id === input.unitId ? { ...it, inBattle: true } as typeof it : it,
    )
    nextState = withPlayer(state, { ...player, battlehand: updatedBattlehand, items: updatedItems })
  }

  // Create the arena unit
  const [arenaUnitId, rng2] = nextId(nextState.rng)
  nextState = { ...nextState, rng: rng2 }

  const arenaUnit: ArenaUnit = {
    id: arenaUnitId,
    side: input.side,
    position: input.position,
    unit: sourceUnit,
    attack: input.attack,
    health: input.health,
    placedBy: input.playerId,
    rotation: 0,
  }

  nextState = appendPublicLog(
    nextState,
    player.username,
    player.playerId,
    `places ${revealAll(sourceUnit)} (${input.attack}/${input.health}) into the arena`,
  )

  return ok({
    ...nextState,
    battle: {
      ...battle,
      arena: [...battle.arena, arenaUnit],
    },
  })
}

// ---------------------------------------------------------------------------
// setArenaUnitStat
// ---------------------------------------------------------------------------

export type ArenaStatKey = 'attack' | 'health'

export interface SetArenaUnitStatInput {
  readonly playerId: string
  readonly arenaUnitId: string
  readonly key: ArenaStatKey
  readonly value: number
}

/**
 * Updates the attack or health of an arena unit. Any game member may call
 * this; every change is logged with the editor's name and the old/new values.
 */
export function setArenaUnitStat(
  state: GameState,
  input: SetArenaUnitStatInput,
): ActionResult {
  if (state.battle === null) return err({ kind: 'NO_BATTLE_ACTIVE' })

  const found = requireAccess(state, input.playerId)
  if (!found.ok) return found
  const player = found.value

  if (!Number.isInteger(input.value) || input.value < 0) {
    return err({ kind: 'INVALID_ARENA_STAT_VALUE', value: input.value })
  }

  const battle = state.battle
  const unit = battle.arena.find((u) => u.id === input.arenaUnitId)
  if (unit === undefined) {
    return err({ kind: 'ARENA_UNIT_NOT_FOUND', arenaUnitId: input.arenaUnitId })
  }

  const oldValue = unit[input.key]
  const updatedUnit: ArenaUnit = { ...unit, [input.key]: input.value }

  const nextState = appendPublicLog(
    state,
    player.username,
    player.playerId,
    `updates ${revealAll(unit.unit)} ${input.key}: ${oldValue} → ${input.value}`,
  )

  return ok({
    ...nextState,
    battle: {
      ...battle,
      arena: battle.arena.map((u) => (u.id === input.arenaUnitId ? updatedUnit : u)),
    },
  })
}

// ---------------------------------------------------------------------------
// rotateArenaUnit
// ---------------------------------------------------------------------------

export interface RotateArenaUnitInput {
  readonly playerId: string
  readonly arenaUnitId: string
}

/**
 * How many rotate presses (0–3) a unit is at, derived purely from its stored
 * `rotation` — no separate counter field needed. Counting counter-clockwise
 * from 0° (the direction the rotate button turns, see below) so a fresh unit
 * is always level 0 and a full 360° cycle returns to it.
 */
function rotationLevel(rotation: Rotation): 0 | 1 | 2 | 3 {
  return (((360 - rotation) / 90) % 4) as 0 | 1 | 2 | 3
}

/**
 * Rotates an arena unit's card 90° counter-clockwise ("left") — issue #68:
 * rotating left is the upgrade direction — and suggests the next tier's
 * attack/health (base + 1 per press, wrapping back to the base values after a
 * full 360°). Any game member may call this, same as `setArenaUnitStat`; it
 * is not a participant-only action.
 *
 * The suggestion is seeded from the card's pristine snapshot (`unit.unit`),
 * not the currently-edited arena values, and overwrites them — the player
 * can still hand-edit attack/health afterwards via the existing inputs.
 * Aircraft print no level ladder, so rotation stays cosmetic-only for them.
 */
export function rotateArenaUnit(
  state: GameState,
  input: RotateArenaUnitInput,
): ActionResult {
  if (state.battle === null) return err({ kind: 'NO_BATTLE_ACTIVE' })

  const found = requireAccess(state, input.playerId)
  if (!found.ok) return found
  const player = found.value

  const battle = state.battle
  const unit = battle.arena.find((u) => u.id === input.arenaUnitId)
  if (unit === undefined) {
    return err({ kind: 'ARENA_UNIT_NOT_FOUND', arenaUnitId: input.arenaUnitId })
  }

  const rotation = nextRotation(unit.rotation, false)
  // Aircraft print no level ladder (no Archer/Cannon/Catapult-style tiers), so
  // there is no card face to justify a stat suggestion — rotation stays
  // cosmetic-only for them, same as before issue #68.
  const hasLevels = unit.unit.kind !== 'aircraft'
  const bonus = hasLevels ? rotationLevel(rotation) : 0
  const attack = hasLevels ? unit.unit.attack + bonus : unit.attack
  const health = hasLevels ? unit.unit.health + bonus : unit.health
  const updatedUnit: ArenaUnit = { ...unit, rotation, attack, health }

  const nextState = appendPublicLog(
    state,
    player.username,
    player.playerId,
    `rotates ${revealAll(unit.unit)} to ${rotation}° (${attack}.${health})`,
  )

  return ok({
    ...nextState,
    battle: {
      ...battle,
      arena: battle.arena.map((u) => (u.id === input.arenaUnitId ? updatedUnit : u)),
    },
  })
}

// ---------------------------------------------------------------------------
// killArenaUnit
// ---------------------------------------------------------------------------

export interface KillArenaUnitInput {
  readonly playerId: string
  readonly arenaUnitId: string
}

// Removes the unit from the arena and clears inBattle on its source card.
// killed is NOT set — players manage their own cards and discard manually.
export function killArenaUnit(
  state: GameState,
  input: KillArenaUnitInput,
): ActionResult {
  if (state.battle === null) return err({ kind: 'NO_BATTLE_ACTIVE' })

  const found = requireAccess(state, input.playerId)
  if (!found.ok) return found
  const player = found.value

  const battle = state.battle

  // Participant guard: only combatants may kill an arena unit.
  if (sideForPlayer(battle, input.playerId) === null) {
    return err({ kind: 'NOT_IN_THIS_BATTLE', playerId: input.playerId })
  }

  const arenaUnit = battle.arena.find((u) => u.id === input.arenaUnitId)
  if (arenaUnit === undefined) {
    return err({ kind: 'ARENA_UNIT_NOT_FOUND', arenaUnitId: input.arenaUnitId })
  }

  // Mark killed on the source card — find its owner and update the hand
  const ownerSide =
    arenaUnit.side === 'attacker' ? battle.attacker : battle.defender
  const owner = findPlayer(state, ownerSide.playerId)

  let nextState = state

  // Clear inBattle on the source card — the unit returns to the hand's
  // "available" state. Players discard killed units themselves (revival cards
  // such as Oracle can bring units back). We do NOT set `killed: true` here.
  if (owner !== undefined) {
    if (ownerSide.kind === 'barbarians') {
      const updatedBarbarians = owner.barbarians.map((u) =>
        u.id === arenaUnit.unit.id ? { ...u, inBattle: false } : u,
      )
      nextState = withPlayer(nextState, { ...owner, barbarians: updatedBarbarians })
    } else {
      const updatedBattlehand = owner.battlehand.map((u) =>
        u.id === arenaUnit.unit.id ? { ...u, inBattle: false } : u,
      )
      const updatedItems = owner.items.map((it) =>
        it.id === arenaUnit.unit.id ? { ...it, inBattle: false } as typeof it : it,
      )
      nextState = withPlayer(nextState, { ...owner, battlehand: updatedBattlehand, items: updatedItems })
    }
  }

  nextState = appendPublicLog(
    nextState,
    player.username,
    player.playerId,
    `kills ${revealAll(arenaUnit.unit)} in the arena`,
  )

  return ok({
    ...nextState,
    battle: {
      ...battle,
      arena: battle.arena.filter((u) => u.id !== input.arenaUnitId),
    },
  })
}

// ---------------------------------------------------------------------------
// endBattleTurn
// ---------------------------------------------------------------------------

export interface EndBattleTurnInput {
  readonly playerId: string
}

/**
 * Flips the battle turn to the other side.
 *
 * Advisory: not enforced server-side, consistent with the general approach in
 * this codebase (see docs/agents/decisions.md).
 */
export function endBattleTurn(
  state: GameState,
  input: EndBattleTurnInput,
): ActionResult {
  if (state.battle === null) return err({ kind: 'NO_BATTLE_ACTIVE' })

  const found = requireAccess(state, input.playerId)
  if (!found.ok) return found
  const player = found.value

  const battle = state.battle

  // Participant guard: only combatants may end the battle turn.
  if (sideForPlayer(battle, input.playerId) === null) {
    return err({ kind: 'NOT_IN_THIS_BATTLE', playerId: input.playerId })
  }

  const nextTurn: BattleSideId = battle.turn === 'attacker' ? 'defender' : 'attacker'

  const nextState = appendPublicLog(
    state,
    player.username,
    player.playerId,
    `ends their battle turn`,
  )

  return ok({
    ...nextState,
    battle: { ...battle, turn: nextTurn },
  })
}

// ---------------------------------------------------------------------------
// endBattle (extends the existing one in draw.ts)
// ---------------------------------------------------------------------------

export interface EndBattleInput {
  readonly playerId: string
}

/**
 * Ends the active battle and cleans up.
 *
 * If a battle is active:
 *   - Clears `inBattle` on all arena units' source cards (both sides).
 *   - Does NOT touch `killed` — players handle their own discard.
 *   - Sets `battle` to null.
 *
 * If no battle is active, falls back to the original `endBattle` behaviour in
 * `draw.ts` (clears `inBattle` on the caller's hand units) so the standalone
 * battlehand mechanics continue to work.
 */
export function endBattleAction(
  state: GameState,
  input: EndBattleInput,
): ActionResult {
  const found = requireAccess(state, input.playerId)
  if (!found.ok) return found
  const player = found.value

  if (state.battle === null) {
    // Fallback: no arena — just clear inBattle on the caller's hand (original behaviour)
    const updatedPlayer = {
      ...player,
      items: player.items.map((item) =>
        isUnit(item) ? { ...item, inBattle: false } : item,
      ),
    }
    return ok(withPlayer(state, updatedPlayer))
  }

  const battle = state.battle

  // Participant guard: only combatants may end an active battle.
  // This prevents a third player from accidentally wiping another pair's arena.
  const isParticipant =
    battle.attacker.playerId === input.playerId ||
    battle.defender.playerId === input.playerId
  if (!isParticipant) return err({ kind: 'NOT_IN_THIS_BATTLE', playerId: input.playerId })

  // Clear inBattle on all arena unit source cards, for both sides
  let nextState = state
  for (const arenaUnit of battle.arena) {
    const ownerSide =
      arenaUnit.side === 'attacker' ? battle.attacker : battle.defender
    const owner = findPlayer(nextState, ownerSide.playerId)
    if (owner === undefined) continue

    if (ownerSide.kind === 'barbarians') {
      const updated = owner.barbarians.map((u) =>
        u.id === arenaUnit.unit.id ? { ...u, inBattle: false } : u,
      )
      nextState = withPlayer(nextState, { ...owner, barbarians: updated })
    } else {
      const updatedBattlehand = owner.battlehand.map((u) =>
        u.id === arenaUnit.unit.id ? { ...u, inBattle: false } : u,
      )
      const updatedItems = owner.items.map((it) =>
        it.id === arenaUnit.unit.id ? { ...it, inBattle: false } as typeof it : it,
      )
      nextState = withPlayer(nextState, { ...owner, battlehand: updatedBattlehand, items: updatedItems })
    }
  }

  nextState = appendPublicLog(
    nextState,
    player.username,
    player.playerId,
    `ends the battle`,
  )

  return ok({ ...nextState, battle: null })
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Returns which side (`'attacker'` or `'defender'`) a player controls, or
 * `null` if they are not a participant.
 */
export function sideForPlayer(
  battle: { attacker: { playerId: string }; defender: { playerId: string } },
  playerId: string,
): BattleSideId | null {
  if (battle.attacker.playerId === playerId) return 'attacker'
  if (battle.defender.playerId === playerId) return 'defender'
  return null
}

// Re-export for convenience
export type { ArenaUnit, BattleSideId }
