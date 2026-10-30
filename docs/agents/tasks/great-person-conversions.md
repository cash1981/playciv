# Great Person conversions: Andrew Carnegie

- **Slug:** `great-person-conversions` · **Branch:** `feat/great-person-conversions` · **Owner:** Claude · **Status:** in progress

## Goal

Human: "One space at the time, drawing culture cards, discarding with mysticism or hand size
before next advance and so on. Also if you have shakespeare it should be possible to skip
markers with carnegie." Carnegie: advance one space on the culture track for free for every
3 coins.

## Scope

**In:** `Playerhand.freeAdvances` banked by the card; the Advance and Shakespeare buttons spend
one per advance instead of the price; undo of both; tests.

**Out:** expiry of unused advances at turn end (they stay until made).

## Approach

Playing the card banks `floor(coins / 3)`. `planAdvance` treats a banked advance as free and
usable in any phase; every existing check (pending card choice, hand size, deck) still applies,
so each advance is made one at a time. The effect records `freeAdvance` so an undo gives it back.

## Acceptance criteria

- [ ] Engine tests: bank, free advance, Shakespeare skip, pending choice blocks the next, undo
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass
- [ ] Hidden information: `freeAdvances` is not in any other player's view
