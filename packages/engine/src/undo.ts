/**
 * Port of `no.asgari.civilization.server.model.Undo`.
 *
 * An undo is a vote. Whoever asks for it votes yes automatically, and every
 * player has to vote before the result is known. One no is enough to refuse it.
 */

export interface Undo {
  /** Set once the vote has run and the undo has actually been carried out. */
  readonly done: boolean
  /** Java: `numberOfVotesRequired`, set to the number of players in the game. */
  readonly numberOfVotesRequired: number
  /** playerId to yes or no. */
  readonly votes: Readonly<Record<string, boolean>>
}

/** Java: `new Undo(numberOfVotesRequired, playerId)` — the initiator votes yes. */
export function createUndo(numberOfVotesRequired: number, playerId: string): Undo {
  return { done: false, numberOfVotesRequired, votes: { [playerId]: true } }
}

export function numberOfVotesPerformed(undo: Undo): number {
  return Object.keys(undo.votes).length
}

/** Java used `Math.abs`, so an overcount gives a distance, not a negative. */
export function votesRemaining(undo: Undo): number {
  return Math.abs(numberOfVotesPerformed(undo) - undo.numberOfVotesRequired)
}

/**
 * Java: `getResultOfVotes()` — `undefined` means the vote is not finished.
 */
export function resultOfVotes(undo: Undo): boolean | undefined {
  if (votesRemaining(undo) !== 0) return undefined
  return !Object.values(undo.votes).includes(false)
}

export function castVote(undo: Undo, playerId: string, vote: boolean): Undo {
  return { ...undo, votes: { ...undo.votes, [playerId]: vote } }
}
