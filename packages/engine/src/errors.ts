import type { SheetName } from './sheet-name.js'

/**
 * Feilene motoren kan gi. Java kastet `WebApplicationException` med HTTP-status
 * rett fra domenelogikken; her er feilene rene data, og HTTP-mappingen hører i
 * server-pakken.
 */
export type EngineError =
  /** Java: `PlayerAction.cannotFindPlayer()` — 404 */
  | { readonly kind: 'PLAYER_NOT_FOUND'; readonly playerId: string }
  /** Java: `BaseAction.cannotFindItem()` — 404 */
  | { readonly kind: 'ITEM_NOT_FOUND'; readonly sheetName?: SheetName }
  /** Java: `BaseAction.checkYourTurn` — 403 "Its not your turn!" */
  | { readonly kind: 'NOT_YOUR_TURN'; readonly playerId: string }
  /**
   * Java: `DrawAction.draw` returnerte `Optional.empty()` og logget en warning.
   * Teknologier skal velges, ikke trekkes.
   */
  | { readonly kind: 'TECHS_ARE_CHOSEN_NOT_DRAWN'; readonly sheetName: SheetName }
  /** Java: `reshuffleItems` kastet `IllegalArgumentException` */
  | { readonly kind: 'NOT_SHUFFLABLE'; readonly sheetName: SheetName }
  /** Java: `NoMoreItemsException` — 410 Gone */
  | { readonly kind: 'NO_MORE_ITEMS'; readonly what: string }
  /** Java: 412 "Cannot draw more barbarians until they are discarded" */
  | { readonly kind: 'BARBARIANS_NOT_DISCARDED'; readonly playerId: string }
  /** Java: 404 "You have nothing to draw" */
  | { readonly kind: 'NOTHING_TO_LOOT'; readonly playerId: string }
  /** Java: 406 "Item is not lootable" */
  | { readonly kind: 'ITEM_NOT_LOOTABLE'; readonly itemId: string }

export function describeError(error: EngineError): string {
  switch (error.kind) {
    case 'PLAYER_NOT_FOUND':
      return 'Could not find player'
    case 'ITEM_NOT_FOUND':
      return 'Could not find item'
    case 'NOT_YOUR_TURN':
      return 'Its not your turn!'
    case 'TECHS_ARE_CHOSEN_NOT_DRAWN':
      return 'Drawing of techs is not possible. Techs are supposed to be chosen, not drawn.'
    case 'NOT_SHUFFLABLE':
      return `Tried to reshuffle ${error.sheetName} but not a shufflable type`
    case 'NO_MORE_ITEMS':
      return `No more ${error.what} to draw`
    case 'BARBARIANS_NOT_DISCARDED':
      return 'Cannot draw more barbarians until they are discarded'
    case 'NOTHING_TO_LOOT':
      return 'You have nothing to draw'
    case 'ITEM_NOT_LOOTABLE':
      return 'Item is not lootable'
  }
}
