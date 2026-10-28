/**
 * The movement ability of the culture cards (issue #302).
 *
 * One-figure cards: Migrants (2), Colonists (4), Immigrants (6) move one own
 * figure to an empty square, with the same cardinal, figure, hut/village and
 * water rules as normal travel. The card is a separate move from the figure's
 * normal travel, so it may be used after that travel and does not spend or set
 * the normal movement lock.
 *
 * Group cards: Disoriented (2), Lost (3), Out of Position (4) move every figure
 * of another player in one chosen square together to an empty square, with no
 * diagonals and no crossing water.
 */

import type { Cell } from './blockade.js'
import type { Board, BoardPiece } from './board.js'
import {
  canCultureMoveFigure,
  figureSources,
  figuresAt,
} from './movement.js'
import type { FigureOwner } from './movement.js'

export type CardMoveKind = 'one' | 'group'

export interface CardMoveRule {
  readonly kind: CardMoveKind
  /** How many cardinal squares the card grants. */
  readonly allowance: number
}

export const CARD_MOVE_RULES: ReadonlyMap<string, CardMoveRule> = new Map<string, CardMoveRule>([
  ['Migrants', { kind: 'one', allowance: 2 }],
  ['Colonists', { kind: 'one', allowance: 4 }],
  ['Immigrants', { kind: 'one', allowance: 6 }],
  ['Disoriented', { kind: 'group', allowance: 2 }],
  ['Lost', { kind: 'group', allowance: 3 }],
  ['Out of Position', { kind: 'group', allowance: 4 }],
])

export const cardMoveRuleOf = (name: string): CardMoveRule | undefined => CARD_MOVE_RULES.get(name)

/** The figures a one-figure card may choose in `cell`: the owner's and not locked by Galileo. */
export function cardMoveFigureChoices(
  board: Board,
  owner: FigureOwner,
  cell: Cell,
  turnNumber: number,
): readonly BoardPiece[] {
  return figuresAt(board, owner, cell).filter((piece) => canCultureMoveFigure(piece, turnNumber))
}

/** The source squares a card may use. A group card needs every target figure there to be eligible. */
export function cardMoveSources(
  board: Board,
  owner: FigureOwner,
  turnNumber: number,
  kind: CardMoveKind,
): readonly Cell[] {
  return figureSources(board, owner).filter((cell) => {
    const figures = figuresAt(board, owner, cell)
    return kind === 'one'
      ? figures.some((piece) => canCultureMoveFigure(piece, turnNumber))
      : figures.every((piece) => canCultureMoveFigure(piece, turnNumber))
  })
}
