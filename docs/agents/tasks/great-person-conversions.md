# Great Person conversions

- **Slug:** `great-person-conversions` · **Branch:** `feat/great-person-conversions` · **Owner:** Claude · **Status:** in progress

## Goal

Issue #301: automate Frank Lloyd Wright and Albert Einstein, the
discard-for-resources Great Persons, through the engine.

## Scope

**In:** the two cards as `playCard` effects with undo, UI input for Einstein's
direction and amount, tests.

**Out:** Andrew Carnegie: every culture space leaves a card choice that blocks the next advance, and the choice is tied to one advance per record, so N free advances need a pending-free-advances counter on the player. The other open Great Persons (battle, cancel, hut-peeking) each need their own design.

## Reference

Card text in the issue. Pattern: Marco Polo, St. Francis (gain) and Mother Teresa
(free `performAdvance`) in `assisted-cards.ts`.

## Approach

- FLW: trade (capped at the track ceiling) and culture equal to `buildingCountOf`.
- Einstein: `PlayCardPayload.convert = { from, amount }`; trade to culture or culture
  to trade, limited by the holdings and the trade ceiling.
- Effect records the gains (Einstein's may be negative) for undo.

## Claimed paths

See the task board.

## Acceptance criteria

- [ ] Each card has engine tests: effect, rejection, undo
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass
- [ ] Hidden information: nothing new is projected; the effect stays server side
