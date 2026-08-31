/**
 * Port av `no.asgari.civilization.server.model.Undo`.
 *
 * Et undo er en avstemning. Den som ber om undo stemmer ja automatisk, og alle
 * spillere må ha stemt før resultatet er kjent. Én nei-stemme er nok til at
 * undoet avslås.
 */

export interface Undo {
  /** Satt når avstemningen er gjennomført og undoet faktisk er utført. */
  readonly done: boolean
  /** Java: `numberOfVotesRequired`, satt til antall spillere i spillet. */
  readonly numberOfVotesRequired: number
  /** playerId til ja/nei. */
  readonly votes: Readonly<Record<string, boolean>>
}

/** Java: `new Undo(numberOfVotesRequired, playerId)` — initiator stemmer ja. */
export function createUndo(numberOfVotesRequired: number, playerId: string): Undo {
  return { done: false, numberOfVotesRequired, votes: { [playerId]: true } }
}

export function numberOfVotesPerformed(undo: Undo): number {
  return Object.keys(undo.votes).length
}

/** Java brukte `Math.abs`, så en overtelling gir avstand og ikke negativt tall. */
export function votesRemaining(undo: Undo): number {
  return Math.abs(numberOfVotesPerformed(undo) - undo.numberOfVotesRequired)
}

/**
 * Java: `getResultOfVotes()` — `undefined` betyr at avstemningen ikke er ferdig.
 */
export function resultOfVotes(undo: Undo): boolean | undefined {
  if (votesRemaining(undo) !== 0) return undefined
  return !Object.values(undo.votes).includes(false)
}

export function castVote(undo: Undo, playerId: string, vote: boolean): Undo {
  return { ...undo, votes: { ...undo.votes, [playerId]: vote } }
}
