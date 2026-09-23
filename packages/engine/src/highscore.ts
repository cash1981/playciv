/**
 * Port of `GameAction.getPlayerHighScore` and `GameAction.getCivHighscore`
 * (`GameAction.java`), and their `WinnerDTO`/`PlayerHighscoreDTO`/
 * `CivHighscoreDTO` shapes.
 *
 * `FinishedGame` carries the whole roster (`players`), not just the winner —
 * Java's `attempts` needs to know who *lost* a game too. The full roster is
 * why `FinishedGame` needs both `pbf.players[]` (old) and `GameState.players`
 * (new) mapped down to `{ username, civName }`; see `store/types.ts` on the
 * server for where that mapping happens.
 */

import { compareJavaStrings } from './turn.js'

export interface FinishedGame {
  readonly numOfPlayers: number
  /** Username of the winner. */
  readonly winner: string
  readonly players: readonly { readonly username: string; readonly civName: string | null }[]
}

export interface WinnerEntry {
  readonly username: string
  readonly totalWins: number
  readonly attempts: number
  readonly percentWin: string
}

export interface HighscoreTable {
  readonly winners: readonly WinnerEntry[]
  readonly twoWinners: readonly WinnerEntry[]
  readonly threeWinners: readonly WinnerEntry[]
  readonly fourWinners: readonly WinnerEntry[]
  readonly fiveWinners: readonly WinnerEntry[]
  readonly totalNumberOfGames: number
  readonly twoPlayerGamesTotal: number
  readonly threePlayerGamesTotal: number
  readonly fourPlayerGamesTotal: number
  readonly fivePlayerGamesTotal: number
}

export interface PlayerHighscoreTable extends HighscoreTable {
  /** Java: the whole player registry's size, when known. */
  readonly totalNumberOfPlayers: number
}

export interface HighscoreResult {
  readonly players: PlayerHighscoreTable
  readonly civs: HighscoreTable
  readonly ratings?: readonly RatingEntry[]
}

export interface RatingEntry {
  readonly username: string
  readonly rating: number
  readonly uncertainty: number
  readonly games: number
}

export interface PlacementEvidence {
  readonly username: string
  readonly techs: number | null
  readonly cultureTier: number | null
  readonly coins: number | null
}

export interface RankedParticipant {
  readonly username: string
  /** Competition rank: 1, 2, 2, 4 for a tie. */
  readonly rank: number
}

export interface RatedGame {
  readonly id: string
  readonly sortKey: string
  readonly participants: readonly RankedParticipant[]
}

/** Only complete comparable evidence can establish that one loser outranks another. */
function dominates(a: PlacementEvidence, b: PlacementEvidence): boolean {
  const pairs = [[a.techs, b.techs], [a.cultureTier, b.cultureTier], [a.coins, b.coins]] as const
  return pairs.every(([left, right]) => left !== null && right !== null && left >= right)
    && pairs.some(([left, right]) => left !== null && right !== null && left > right)
}

/** The explicit winner is first; incomparable or incomplete loser evidence ties. */
export function rankByEvidence(
  winner: string,
  participants: readonly PlacementEvidence[],
): readonly RankedParticipant[] {
  const remaining = participants.filter((participant) => participant.username !== winner)
  const result: RankedParticipant[] = [{ username: winner, rank: 1 }]
  while (remaining.length > 0) {
    const front = remaining.filter((candidate) =>
      !remaining.some((other) => other !== candidate && dominates(other, candidate)),
    )
    const rank = result.length + 1
    for (const participant of front) result.push({ username: participant.username, rank })
    for (const participant of front) remaining.splice(remaining.indexOf(participant), 1)
  }
  return result
}

/**
 * Java: `WinnerDTO.percentWin()` / `CivWinnerDTO.percentWin()`, identical
 * bodies. `"0 %"` when either side is zero; otherwise rounded to two
 * decimals. Java's `double + " %"` always keeps at least one fraction digit
 * (`Double.toString(100.0)` is `"100.0"`), where `Number.prototype.toString`
 * drops it for integers — restored here.
 */
export function formatPercentWin(totalWins: number, attempts: number): string {
  if (totalWins === 0 || attempts === 0) return '0 %'

  const percent = (totalWins / attempts) * 100
  const twoDecimals = Math.round(percent * 100) / 100
  const text = Number.isInteger(twoDecimals) ? `${twoDecimals}.0` : `${twoDecimals}`
  return `${text} %`
}

/**
 * Java: `Collections.sort` ascending by `compareTo` (totalWins, then
 * username) followed by `Collections.reverse`. Reversing a fully sorted list
 * does not just flip the primary order — it flips the username tiebreak too,
 * so ties end up in *descending* username order, not ascending. The per-count
 * breakdowns (`getWinners`, `getCivWinners`) reach the same order directly
 * with a swapped-argument comparator. Both paths are ported as this one rule.
 */
function compareWinnerEntries(a: WinnerEntry, b: WinnerEntry): number {
  if (a.totalWins !== b.totalWins) return b.totalWins - a.totalWins
  return compareJavaStrings(b.username, a.username)
}

function countBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of items) {
    const key = keyOf(item)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/** Builds one `WinnerEntry` per name in `roster`, sorted Java's way. */
function toEntries(
  roster: ReadonlySet<string>,
  wins: ReadonlyMap<string, number>,
  attempts: ReadonlyMap<string, number>,
): WinnerEntry[] {
  const entries: WinnerEntry[] = []
  for (const username of roster) {
    const totalWins = wins.get(username) ?? 0
    const att = attempts.get(username) ?? 0
    entries.push({ username, totalWins, attempts: att, percentWin: formatPercentWin(totalWins, att) })
  }
  return entries.sort(compareWinnerEntries)
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

/**
 * Java: `getAllWinners`. The roster is winners plus — only when the caller
 * supplies the player registry — everyone else, with zero wins and their
 * real attempt count. Without a registry, a player who lost every game they
 * were in simply cannot be named, because nothing else lists them.
 */
function totalPlayerEntries(
  games: readonly FinishedGame[],
  allUsernames: readonly string[] | undefined,
): readonly WinnerEntry[] {
  const wins = countBy(games, (game) => game.winner)
  const attempts = countBy(
    games.flatMap((game) => game.players),
    (player) => player.username,
  )

  const roster = new Set(wins.keys())
  if (allUsernames !== undefined) {
    for (const username of allUsernames) roster.add(username)
  }

  return toEntries(roster, wins, attempts)
}

/**
 * Java: `getWinners`. Unlike the total table, the roster here is every
 * participant of a game at this player count — win or lose — because it
 * comes straight from `pbf.getPlayers()` rather than from the winners map.
 */
function bucketPlayerEntries(games: readonly FinishedGame[]): readonly WinnerEntry[] {
  const wins = countBy(games, (game) => game.winner)
  const attempts = countBy(
    games.flatMap((game) => game.players),
    (player) => player.username,
  )
  return toEntries(new Set(attempts.keys()), wins, attempts)
}

// ---------------------------------------------------------------------------
// Civilizations
// ---------------------------------------------------------------------------

function winnerCivOf(game: FinishedGame): string | null {
  return game.players.find((player) => player.username === game.winner)?.civName ?? null
}

/**
 * Java: `getAllCivWinners` and `getCivWinners`. Both build their roster from
 * the *winning* civilization of each game, not from every participant's
 * civilization — a civilization that only ever lost never gets its own row,
 * even though it still counts toward another civilization's `attempts`
 * (`findAllGamesCivHasPlayed` counts every participant). That asymmetry with
 * the player tables above is in the Java source, not a guess: `getWinners`
 * flatMaps `pbf.getPlayers()`, `getCivWinners` maps `finishedGames` directly.
 */
function civEntries(games: readonly FinishedGame[]): readonly WinnerEntry[] {
  const wins = countBy(
    games.map((game) => winnerCivOf(game)).filter((civ): civ is string => civ !== null),
    (civ) => civ,
  )
  const attempts = countBy(
    games.flatMap((game) => game.players).filter((player) => player.civName !== null),
    (player) => player.civName as string,
  )
  return toEntries(new Set(wins.keys()), wins, attempts)
}

// ---------------------------------------------------------------------------

function buildTable(
  games: readonly FinishedGame[],
  totalEntries: readonly WinnerEntry[],
  bucketEntriesOf: (games: readonly FinishedGame[]) => readonly WinnerEntry[],
): HighscoreTable {
  const byCount = (numOfPlayers: number): readonly FinishedGame[] =>
    games.filter((game) => game.numOfPlayers === numOfPlayers)

  const two = byCount(2)
  const three = byCount(3)
  const four = byCount(4)
  const five = byCount(5)

  return {
    winners: totalEntries,
    twoWinners: bucketEntriesOf(two),
    threeWinners: bucketEntriesOf(three),
    fourWinners: bucketEntriesOf(four),
    fiveWinners: bucketEntriesOf(five),
    totalNumberOfGames: games.length,
    twoPlayerGamesTotal: two.length,
    threePlayerGamesTotal: three.length,
    fourPlayerGamesTotal: four.length,
    fivePlayerGamesTotal: five.length,
  }
}

/**
 * Java: `GameAction.getPlayerHighScore` and `GameAction.getCivHighscore`.
 * `games` should already be filtered to finished, won games — that filter is
 * the repository's job (`finishedGamesForHighscore`), not this pure
 * function's. `allUsernames`, when supplied, is the whole player registry
 * (Java: `playerCollection.find()`), used to list players who never won.
 */
export function highscore(
  games: readonly FinishedGame[],
  allUsernames?: readonly string[],
): HighscoreResult {
  const players: PlayerHighscoreTable = {
    ...buildTable(games, totalPlayerEntries(games, allUsernames), bucketPlayerEntries),
    totalNumberOfPlayers:
      allUsernames?.length ??
      new Set(games.flatMap((game) => game.players.map((player) => player.username))).size,
  }

  // Java: the civ tables are built from finished games where every player
  // has a resolved civilization — `allMatch(p -> p.getCivilization() != null)`.
  const civGames = games.filter((game) => game.players.every((player) => player.civName !== null))
  const civs: HighscoreTable = buildTable(civGames, civEntries(civGames), civEntries)

  return { players, civs }
}
