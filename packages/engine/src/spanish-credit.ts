/**
 * The Spanish civilization ability: "when they discover an unexplored map tile, may immediately build a basic
 * (non-upgraded) building in any city for free, even if not unlocked". Each tile a Spanish figure explores gives one
 * credit, kept server-only as a grant tied to the board entry that laid the tile (`GameState.spanishFreeBuildings`).
 * A credit is spent by an applied `spanishBuild` record (`assisted-spanish.ts`), so undoing that record gives it back.
 *
 * The board Undo of the exploration is unilateral, so it takes the grant back only while the credit is unspent, and
 * refuses once the building was built (otherwise explore, build, undo, explore would farm buildings).
 */

import type { GameState } from './state.js'

export const SPANISH_BUILDING_KIND = 'spanishBuild'

/** The credits the player has been given for tiles still on the board, spent or not. */
export const spanishGrantsOf = (state: GameState, playerId: string): number =>
  (state.spanishFreeBuildings ?? []).filter((grant) => grant.playerId === playerId).length

/** The free buildings the player has built: applied `spanishBuild` records. */
export const spanishUsedBy = (state: GameState, playerId: string): number =>
  state.assistedActions.filter(
    (record) => record.status === 'applied' && record.playerId === playerId && record.kind === SPANISH_BUILDING_KIND,
  ).length

/** The credits not spent yet. Never negative. */
export const spanishCreditsOf = (state: GameState, playerId: string): number =>
  Math.max(0, spanishGrantsOf(state, playerId) - spanishUsedBy(state, playerId))

export const withSpanishGrant = (state: GameState, playerId: string, historyId: string): GameState => ({
  ...state,
  spanishFreeBuildings: [...(state.spanishFreeBuildings ?? []), { playerId, historyId }],
})

/** The grant the tile laid by this board entry gave, if any. */
export const spanishGrantAt = (
  state: GameState,
  historyId: string,
): { readonly playerId: string; readonly historyId: string } | undefined =>
  state.spanishFreeBuildings?.find((grant) => grant.historyId === historyId)

export const withoutSpanishGrant = (state: GameState, historyId: string): GameState => ({
  ...state,
  spanishFreeBuildings: (state.spanishFreeBuildings ?? []).filter((grant) => grant.historyId !== historyId),
})
