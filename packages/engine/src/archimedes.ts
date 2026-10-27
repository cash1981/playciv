import { appendLog } from './log.js'
import { activeGreatPerson } from './great-person-effects.js'
import { withPlayer } from './state.js'
import type { GameState } from './state.js'

function payForRevealedTech(
  state: GameState,
  playerId: string,
  techName: string,
  endingTurn: number,
  at: string | undefined,
): GameState {
  const holder = state.players.find((player) => player.playerId === playerId)
  if (
    holder === undefined ||
    holder.researchTurns[techName] !== endingTurn ||
    holder.techsChosen.every((tech) => tech.name !== techName || tech.hidden) ||
    Object.hasOwn(holder.archimedesCulture, techName) ||
    !activeGreatPerson(state, holder, 'Archimedes')
  ) {
    return state
  }
  const known = state.players.some(
    (other) =>
      other.playerId !== holder.playerId &&
      other.techsChosen.some((tech) => tech.name === techName && !tech.hidden),
  )
  if (known) return state

  const next = withPlayer(state, {
    ...holder,
    stats: { ...holder.stats, culture: holder.stats.culture + 3 },
    archimedesCulture: { ...holder.archimedesCulture, [techName]: 3 },
  })
  return appendLog(next, {
    username: holder.username,
    playerId: holder.playerId,
    publicLog: `${holder.username} gained 3 culture from Archimedes`,
    privateLog: '',
    createdAt: at ?? null,
  })
}

/** Pays revealed techs from a completed Research phase. Hidden choices wait to be revealed. */
export function payArchimedesAfterResearch(
  state: GameState,
  endingTurn: number,
  at: string | undefined,
): GameState {
  let next = state
  for (const player of state.players) {
    const researched = Object.entries(player.researchTurns)
      .filter(([, turnNumber]) => turnNumber === endingTurn)
      .map(([techName]) => techName)
    for (const techName of researched) {
      next = payForRevealedTech(next, player.playerId, techName, endingTurn, at)
    }
  }
  return next
}

/** Pays a researched tech when its owner reveals it after that Research phase ended. */
export function payArchimedesOnReveal(
  state: GameState,
  playerId: string,
  techName: string,
  endingTurn: number,
): GameState {
  return payForRevealedTech(state, playerId, techName, endingTurn, undefined)
}
