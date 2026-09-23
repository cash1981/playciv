/**
 * The coin sources on the status board: one counter per source per player.
 *
 * New in this port. Neither `old-civ-rest` nor `old-civ-web` modelled coin
 * sources — the old shared spreadsheet kept one `coins` number per player and
 * the players summed the individual sources by hand ("3 coins on CoL"). The
 * fifteen rows below are the human's reference sheet
 * (`Civ_Tech_FF-WW.-1.jpg`): the four "Up to 4" techs hold coin tokens, the
 * "1 coin" rows are a single printed coin each, and `Sheet` (culture cards,
 * loot, villages, …) and Panama Canal have no printed limit.
 *
 * The counters are bookkeeping, like the rest of the status board: no card
 * effect is applied and nothing beyond the printed limit is enforced.
 */

export interface CoinSource {
  readonly key: string
  /** The card or pile this counter belongs to, as printed on the reference sheet. */
  readonly label: string
  /** The reference sheet's second column, shown under the label. */
  readonly help: string
  /** How many coins the source can hold; `null` means no limit. */
  readonly max: number | null
}

/** The order here is the order the Coins tab renders. */
export const COIN_SOURCES = [
  { key: 'codeOfLaws', label: 'Code of Laws (I)', help: 'Up to 4 for winning battles', max: 4 },
  { key: 'pottery', label: 'Pottery (I)', help: 'Up to 4 for any 2 resource tokens each', max: 4 },
  { key: 'civilService', label: 'Civil Service (II)', help: '1 coin', max: 1 },
  {
    key: 'democracy',
    label: 'Democracy (II)',
    help: 'Up to 4 for spending 6 trade during City Management',
    max: 4,
  },
  {
    key: 'printingPress',
    label: 'Printing Press (II)',
    help: 'Up to 4 for spending 5 culture during City Management',
    max: 4,
  },
  { key: 'bureaucracy', label: 'Bureaucracy (II)', help: '1 coin', max: 1 },
  { key: 'railroad', label: 'Railroad (III)', help: '1 coin', max: 1 },
  { key: 'computers', label: 'Computers (IV)', help: '1 coin', max: 1 },
  { key: 'bank', label: 'Bank (Building)', help: '1 coin', max: 1 },
  { key: 'democracyGovernment', label: 'Democracy (Govt)', help: '1 coin', max: 1 },
  { key: 'greatPeople', label: 'Great People', help: '50% chance of providing 1 coin', max: 1 },
  { key: 'terrain', label: 'Terrain', help: 'Some terrain spots provide 1 coin', max: 1 },
  {
    key: 'panamaCanal',
    label: 'Panama Canal',
    help: 'Start of Turn: Add 1 coin to this wonder',
    // No limit, per the human: "Det er ingen grenser på coins på panama canal wonder."
    max: null,
  },
  { key: 'organizedReligion', label: 'Organized Religion', help: '1 coin', max: 1 },
  {
    key: 'sheet',
    label: 'Sheet',
    help: 'Coins from culture cards, loot or village etc.',
    max: null,
  },
] as const satisfies readonly CoinSource[]

export type CoinSourceKey = (typeof COIN_SOURCES)[number]['key']

/** One counter per source, for one player. */
export type CoinSources = Readonly<Record<CoinSourceKey, number>>

/** The state a fresh game starts in: every counter at zero. */
export const EMPTY_COIN_SOURCES: CoinSources = {
  codeOfLaws: 0,
  pottery: 0,
  civilService: 0,
  democracy: 0,
  printingPress: 0,
  bureaucracy: 0,
  railroad: 0,
  computers: 0,
  bank: 0,
  democracyGovernment: 0,
  greatPeople: 0,
  terrain: 0,
  panamaCanal: 0,
  organizedReligion: 0,
  sheet: 0,
}

const BY_KEY: ReadonlyMap<string, CoinSource> = new Map(
  COIN_SOURCES.map((source) => [source.key, source] as const),
)

/**
 * The source for a key, or `undefined` when the key is unknown. A key arriving
 * from a request body is untrusted, so this returns rather than throws; the
 * engine has no exceptions.
 */
export function findCoinSource(key: string): CoinSource | undefined {
  return BY_KEY.get(key)
}

/** What a player's counters add up to — the total the status table shows. */
export function totalCoins(sources: CoinSources): number {
  let total = 0
  for (const source of COIN_SOURCES) total += sources[source.key]
  return total
}
