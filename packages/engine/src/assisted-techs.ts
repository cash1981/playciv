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
])
