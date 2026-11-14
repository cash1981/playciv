/**
 * The coins a tech card earns by itself (issue #327): Education ("Once per turn, when you build a wonder, add one coin to this
 * tech (max 4)") and Code of Laws ("Once per turn, after you win a battle, add 1 coin to this token (max 4)").
 *
 * The coin goes on the tech's counter (`coins.ts`) when the player has the tech revealed, the counter is below its printed
 * limit and the coin has not been earned yet this turn. The once-per-turn mark is a usage key on the player's turn record,
 * written with the coin and taken off with it, so the undo of the build or of End battle gives both back. A coin the player
 * already typed in by hand counts toward the limit, so the two never add up past it. The limit is the printed 4, and 6 for the owner
 * of an active Internet, as everywhere else the counter is raised.
 */

import { freeTurnAction, useTurnAction } from './assisted-core.js'
import { blockadedPieceIds } from './blockade.js'
import { activeWonderOwnerIds, findCoinSource, techCoinSource, withCoinSource } from './coins.js'
import type { CoinSourceKey } from './coins.js'
import { withPlayer } from './state.js'
import type { GameState, Playerhand } from './state.js'
import { createPlayerTurn, turnStatus } from './turn.js'

/** What a coin grant records, so the action that earned it can take it back. */
export interface TechCoinGrant {
  readonly playerId: string
  readonly tech: string
  readonly source: CoinSourceKey
  readonly turnNumber: number
  /** What the counter may hold, for the log line: 4, or 6 with an active Internet. */
  readonly capacity: number
}

const usageKeyOf = (tech: string): string => `coin:${tech}`

/** The tech counts only while the player has it revealed: a hidden one is private and not in play. */
const hasRevealed = (player: Playerhand, tech: string): boolean =>
  player.techsChosen.some((candidate) => candidate.name === tech && !candidate.hidden)

/**
 * Adds the coin when the tech is revealed, the counter has room and it is the first this turn. `granted` is `null` when nothing
 * was added, and the state is then the one passed in.
 */
export function earnTechCoin(
  state: GameState,
  playerId: string,
  tech: string,
): { readonly state: GameState; readonly granted: TechCoinGrant | null } {
  const player = state.players.find((candidate) => candidate.playerId === playerId)
  const source = techCoinSource(tech)
  if (player === undefined || source === undefined || !hasRevealed(player, tech)) return { state, granted: null }
  const printed = findCoinSource(source)?.max ?? null
  const internet = activeWonderOwnerIds(state.board.pieces, 'wonders/internet', blockadedPieceIds(state)).has(playerId)
  const capacity = printed === null ? null : printed + (internet ? 2 : 0)
  const held = player.stats.coinSources[source]
  if (capacity !== null && held >= capacity) return { state, granted: null }
  const turnNumber = turnStatus(state).currentTurn
  const turn = player.playerTurns.find((candidate) => candidate.turnNumber === turnNumber) ?? createPlayerTurn(player.username, turnNumber)
  const key = usageKeyOf(tech)
  if (turn.usedActions.includes(key)) return { state, granted: null }
  const stats = { ...player.stats, coinSources: withCoinSource(player.stats.coinSources, source, held + 1) }
  return { state: useTurnAction(state, player, turn, key, stats), granted: { playerId, tech, source, turnNumber, capacity: capacity ?? held + 1 } }
}

/** Takes a granted coin off again and frees the turn's use; a counter the players already lowered by hand stays at 0. */
export function returnTechCoin(state: GameState, grant: TechCoinGrant): GameState {
  const player = state.players.find((candidate) => candidate.playerId === grant.playerId)
  if (player === undefined) return state
  const held = player.stats.coinSources[grant.source]
  const lowered = withPlayer(state, {
    ...player,
    stats: { ...player.stats, coinSources: withCoinSource(player.stats.coinSources, grant.source, Math.max(0, held - 1)) },
  })
  const after = lowered.players.find((candidate) => candidate.playerId === grant.playerId) ?? player
  return freeTurnAction(lowered, after, grant.turnNumber, usageKeyOf(grant.tech))
}
