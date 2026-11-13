/**
 * Which assisted action belongs to which tech card, by the tech's name. The tech
 * dialog uses it to show the button for any registered card, so a new card needs
 * no change in the web code.
 *
 * A leaf module on purpose: the registry in `assisted.ts` is too heavy for the
 * browser bundle, so the web reads this small table instead. The table must list
 * the same cards as the registry's `techName` fields; a test keeps the two equal.
 */

import type { AssistedActionKind } from './state.js'

export const ASSISTED_TECH_ACTIONS: ReadonlyMap<string, AssistedActionKind> = new Map<string, AssistedActionKind>([
  ['Chivalry', 'chivalry'],
  ['Currency', 'currency'],
  ['Metal Casting', 'metalCasting'],
  ['Democracy', 'democracy'],
  ['Printing Press', 'printingPress'],
  ['Communism', 'communism'],
  ['Steam Power', 'steamPower'],
  ['Mathematics', 'mathematics'],
  ['Ballistics', 'ballistics'],
  ['Gunpowder', 'gunpowder'],
  ['Combustion', 'combustion'],
  ['Animal Husbandry', 'animalHusbandry'],
  ['Construction', 'construction'],
  ['Banking', 'banking'],
  ['Plastics', 'plastics'],
  ['Pottery', 'pottery'],
  ['Philosophy', 'philosophy'],
  ['Education', 'education'],
  ['Horseback Riding', 'horsebackRiding'],
  ['Mysticism', 'mysticism'],
  ['Writing', 'writing'],
  ['Civil Service', 'civilService'],
  ['Mass Media', 'massMedia'],
  ['Monarchy', 'monarchy'],
])

/**
 * What a tech action asks the player before it is sent (#327), so the web builds the right picker without knowing the
 * rule: resource tokens to name (`distinct`: one of each kind), a city, another player (with free text for what is
 * cancelled), an opponent and one of their coin counters, or Monarchy's mode. An action not listed is one press.
 */
export type TechPicker =
  | { readonly kind: 'resources'; readonly count: number; readonly distinct: boolean }
  | { readonly kind: 'city' }
  | { readonly kind: 'player'; readonly noteLabel?: string }
  | { readonly kind: 'coin' }
  | { readonly kind: 'monarchy' }

export const ASSISTED_TECH_PICKERS: ReadonlyMap<AssistedActionKind, TechPicker> = new Map<AssistedActionKind, TechPicker>([
  ['gunpowder', { kind: 'resources', count: 2, distinct: false }],
  ['pottery', { kind: 'resources', count: 2, distinct: false }],
  ['philosophy', { kind: 'resources', count: 3, distinct: false }],
  ['education', { kind: 'resources', count: 4, distinct: true }],
  ['animalHusbandry', { kind: 'city' }],
  ['construction', { kind: 'city' }],
  ['banking', { kind: 'city' }],
  ['plastics', { kind: 'city' }],
  ['horsebackRiding', { kind: 'player' }],
  ['writing', { kind: 'player', noteLabel: 'City action (optional)' }],
  ['civilService', { kind: 'player', noteLabel: 'Culture event (optional)' }],
  ['massMedia', { kind: 'player', noteLabel: 'Resource ability (optional)' }],
  ['mysticism', { kind: 'coin' }],
  ['monarchy', { kind: 'monarchy' }],
])
