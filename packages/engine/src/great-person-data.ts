/**
 * The culture on each Great Person marker, keyed by its board asset id.
 *
 * Great people "function much like buildings do" (base rules p. 18): a marker in the
 * outskirts of a city gives that city the icons printed on it. Only the culture is here,
 * read by eye from the six marker images (the icons are not in any manifest): the Artist
 * and the Merchant show two culture icons, the Humanitarian one, and the Builder, General
 * and Scientist none. The trade is read the same way: the Artist and the Humanitarian show one
 * trade icon, the Scientist two, the rest none, and the production the same way: the Builder two, the
 * Humanitarian and the Scientist one, the rest none. Their coin icons are not read. The cards'
 * abilities (the culture a card gives when it is revealed or discarded) are not here
 * either.
 */

export const GREAT_PERSON_CULTURE: Readonly<Record<string, number>> = {
  'great people/artist': 2,
  'great people/builder': 0,
  'great people/general': 0,
  'great people/humanitarian': 1,
  'great people/merchant': 2,
  'great people/scientist': 0,
}

/** The culture on a Great Person marker, or `undefined` when the id is not one of the six. */
export function greatPersonCultureOf(assetId: string): number | undefined {
  return Object.hasOwn(GREAT_PERSON_CULTURE, assetId) ? GREAT_PERSON_CULTURE[assetId] : undefined
}

/** The trade on each Great Person marker, read by eye from the marker images. */
export const GREAT_PERSON_TRADE: Readonly<Record<string, number>> = {
  'great people/artist': 1,
  'great people/builder': 0,
  'great people/general': 0,
  'great people/humanitarian': 1,
  'great people/merchant': 0,
  'great people/scientist': 2,
}

/** The trade on a Great Person marker, or `undefined` when the id is not one of the six. */
export function greatPersonTradeOf(assetId: string): number | undefined {
  return Object.hasOwn(GREAT_PERSON_TRADE, assetId) ? GREAT_PERSON_TRADE[assetId] : undefined
}

/** The production on each Great Person marker, read by eye from the marker images. */
export const GREAT_PERSON_PRODUCTION: Readonly<Record<string, number>> = {
  'great people/artist': 0,
  'great people/builder': 2,
  'great people/general': 0,
  'great people/humanitarian': 1,
  'great people/merchant': 0,
  'great people/scientist': 1,
}

/** The production on a Great Person marker, or `undefined` when the id is not one of the six. */
export function greatPersonProductionOf(assetId: string): number | undefined {
  return Object.hasOwn(GREAT_PERSON_PRODUCTION, assetId) ? GREAT_PERSON_PRODUCTION[assetId] : undefined
}
