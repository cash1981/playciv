# Great Person coins around metropolises

- **Slug:** `issue-298-adam-smith-merchant-coin`
- **Branch:** `fix/issue-298`
- **Owner:** Copilot
- **Status:** ready for review

## Goal

The Coins panel counts Great Person markers on all ten outskirts squares of a
metropolis, whether it is horizontal or vertical. A Merchant marker representing
Adam Smith contributes its marker coin independently of Adam Smith's revealed
card ability.

## Why

Issue #298 reports a missing Great Person coin. In the linked public game, the
Aztec player's rotated Green metropolis has centers B2 and B3, while its
Humanitarian and Merchant markers are on B1 and C1. The Merchant counts under
the current calculation, but the Humanitarian does not because the vertical
metropolis footprint is shifted one row too far upward. The public revealed
feed has no Adam Smith card, so this task does not change his separate ability
coin.

## Scope

**In:**

- Correct metropolis footprint alignment and add an engine regression test
  for two eligible markers at every rotation.

**Out:**

- Changing Adam Smith's card-specific ability coin or counting markers on city
  centers.
- Browser verification; the user requested unit tests only.

## Reference

`greatPersonCoinsOf` counts unblockaded Builder, Merchant and Humanitarian
markers in a player's city outskirts. `cityFootprint` currently floors the
metropolis sprite's pixel center along its long axis; a small placement offset
can therefore assign its second center to the wrong row or column. The
rulebook PDF is not present in the checkout; the user supplied the expected
metropolis centers and outskirts for the linked game.

## Approach

Snap the metropolis center to a nearby grid boundary along the long axis only
when it is within one eighth of a square; otherwise preserve the existing
anchor-minus-one footprint. Keep the pixel-center square first for existing
anchor callers, and test both eligible marker coins across all rotations.

## Claimed paths

- `packages/engine/src/blockade.ts`
- `packages/engine/test/coin-sources.test.ts`
- `docs/agents/task-board.md`
- `docs/agents/tasks/issue-298-adam-smith-merchant-coin.md`

## Acceptance criteria

- [ ] Two Great Person markers on metropolis outskirts contribute 2 Great
  People coins at rotations 0, 90, 180 and 270.
- [ ] A metropolis centered in a square retains its existing footprint.
- [ ] Adam Smith's revealed, usable ability coin remains a separate +1.
- [ ] The focused engine unit test passes.
- [ ] No browser test is needed; no UI rendering changes are in scope.

## Notes

The linked game's public board has no publicly revealed Adam Smith card; that
row remains 0 in this report and is outside this geometry fix.

## Handover

Review rejected the initial card-derived Merchant coin because it duplicated
the board marker coin. Inspection of the linked public board showed the actual
cause: the vertical metropolis center was misaligned with its grid boundary,
putting a Humanitarian marker on a falsely classified center square.

The Opus review caught a compatibility case where a metropolis centered in a
square would shift to the right/below under unconditional rounding. The final
logic only snaps when the pixel center is within one eighth of a square from a
grid boundary, preserving the prior behavior for centered pieces.

Verification passed:

- `pnpm --filter @civ/engine exec vitest run test/assisted-city.test.ts test/coin-sources.test.ts test/blockade.test.ts test/city-production.test.ts` (4 files / 292 tests)
- `pnpm -r typecheck`
- `pnpm -r test` (66 engine files / 2,083 tests; 40 server files / 847 tests;
  63 web files / 1,134 tests)
- `pnpm -r build`

No browser test was run, as requested; there are no UI rendering changes.

The final checks were run explicitly from the `civ-issue-298` worktree. An
initial full check from the shared checkout did not include these changes; the
focused and full worktree runs above are the verification evidence.
