# Galileo Galilei and the card map picker (issue #302)

- **Slug:** `issue-302-galileo`
- **Branch:** `feat/issue-302-figure-movement` (same PR as the first movement slice)
- **Owner:** opencode (orchestrator/coder)
- **Status:** in review
- **Issue:** [#302](https://github.com/cash1981/playciv/issues/302)

## Goal

A player can play Galileo Galilei during City Management, choose any map square
holding their figures and one empty outer-edge destination, and the game moves
every figure from the source together and locks them for the turn.
The card's undo vote puts the figures back and returns the card to the hand.

## Why

Galileo is the next remaining #302 effect and the first card that needs a map
choice. The reusable bridge it introduces (`MapPickerContext`) is the base for
Migrants, Colonists, Immigrants, Disoriented, Lost, Out of Position and Hannibal.

## Scope

**In:**

- Outer-edge squares for every board shape.
- Source is any map square with one or more of the player's own figures; all of
  them move together.
- Empty destination by unofficial rules 61 to 63: no figure, building, Great
  Person, wonder, city-state, city, hut, village or relic token. A disaster alone
  or another resource token does not block. Rule 332 allows the source itself.
- Rule 332's same square is allowed when the source is itself on the outer edge.
- No terrain or stacking gate on the destination; an empty water edge square is
  allowed.
- Each moved figure is locked for the turn; one card undo vote reverses the whole
  move and returns the card.
- The Play form asks for the two squares through the board picker.

**Out:**

- Brandenburg Gate outskirts (rule 333).
- Scout gathered-square and icon-reuse follow-ups (rules 198, 257, 334, 341, 422
  to 424), which need those systems.
- Movement cards other than Galileo, Hannibal and Communism's lock.

## Reference

- Unofficial rules file: `Moderator/uoffisiell regler.rtfd/TXT.rtf`, rules 49,
  61 to 63, 255, 283, 287, 330 to 335.
- Existing movement decision in `docs/agents/decisions.md`.
- `packages/engine/src/galileo.ts`, `assisted-cards.ts`, `actions/board.ts`;
  `packages/web/src/views/mapPick.ts`, `PlayableCards.tsx`, `GameView.tsx`.

## Acceptance criteria

- [x] Galileo's source is any square with own figures; the destination is an
  outer-edge square; all source figures move together.
- [x] Non-empty destinations are refused; resource/disaster-only squares and the
  source square itself are allowed.
- [x] Moved figures are locked and one undo vote restores positions, movement
  state and the card.
- [x] The browser Play form uses the board picker for both squares.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass
- [ ] Verified in the browser: the human will test manually.

## Handover

Implemented on the same branch and PR as the first movement slice. Validation:
`pnpm -r typecheck` passed; `pnpm -r test` passed (engine 69 files / 2137 tests,
web 63 files / 1146 tests, server 40 files / 850 tests); `pnpm -r build` passed.
Independent review is pending. Details and source references are in the
"Galileo Galilei and the card map picker (#302)" decision topic.
