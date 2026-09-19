/** The replacement government cards used by Wisdom and Warfare. */
export const GOVERNMENTS = [
  'Anarchy',
  'Feudalism',
  'Communism',
  'Republic',
  'Fundamentalism',
  'Monarchy',
  'Democracy',
  'Despotism',
] as const

export type Government = (typeof GOVERNMENTS)[number]

export const DEFAULT_GOVERNMENT: Government = 'Despotism'

export interface GovernmentCard {
  readonly government: Government
  readonly effects: readonly string[]
}

/**
 * Public reference text from the Wisdom and Warfare replacement cards.
 * These are player aids only: the engine records the selected card but does
 * not apply or enforce its effects.
 */
export const GOVERNMENT_CARDS: readonly GovernmentCard[] = [
  {
    government: 'Anarchy',
    effects: [
      'Your social policies have no effect.',
      'You cannot take any actions with your capital.',
    ],
  },
  {
    government: 'Feudalism',
    effects: ['Start of Turn: Harvest a resource in the outskirts of any of your cities.'],
  },
  {
    government: 'Communism',
    effects: [
      'Your battle hand size is increased by 1.',
      'Each of your cities generates production from its outskirts equal to your city generating the most production from its outskirts.',
    ],
  },
  {
    government: 'Republic',
    effects: ['Your armies can build cities as though they were scouts.'],
  },
  {
    government: 'Fundamentalism',
    effects: [
      'Your combat bonus is increased by 4.',
      'Start of Turn: Gain 1 culture for each of your armies on the map.',
    ],
  },
  {
    government: 'Monarchy',
    effects: [
      'You may take an additional action with your capital each turn.',
      'You cannot take the same action twice with your capital in the same turn.',
    ],
  },
  {
    government: 'Democracy',
    effects: [
      'Gain 1 coin while this government is active.',
      'Start of Turn: Gain 2 trade.',
    ],
  },
  {
    government: 'Despotism',
    effects: ['Each of your cities generates 1 extra production.'],
  },
]

export function isGovernment(value: string): value is Government {
  return (GOVERNMENTS as readonly string[]).includes(value)
}

/**
 * Official starting-government exceptions. The game data uses civilization
 * names in their plural card form (Romans, Russians, Japanese).
 */
export function startingGovernmentFor(civilizationName: string): Government {
  switch (civilizationName) {
    case 'Romans':
      return 'Republic'
    case 'Russians':
      return 'Communism'
    case 'Japanese':
      return 'Feudalism'
    default:
      return DEFAULT_GOVERNMENT
  }
}
