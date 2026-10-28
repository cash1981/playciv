# Show newly played cards at the top of Revealed and Discarded Items

- **Slug:** `issue-297-revealed-discards`
- **Branch:** `fix/issue-297-revealed-discards`
- **Owner:** opencode (orchestrator/coder)
- **Status:** in review

## Goal

After a player presses Play on a culture card such as Barbarian Encampment, the
discarded card appears in the first page of the Revealed and Discarded Items
panel, not buried at the bottom of the history.

## Why

Issue #297: the card was discarded and logged, but the reporter could not see it
in the panel. The feed row existed but had no timestamp, so the newest-first
sort put it after every dated row. The human verified it on a live game.

## Scope

**In:**

- Give an assisted play/reward discard row the play line's timestamp and log
  order when the card is already in the public discard pile.
- Regression test for a played Barbarian Encampment next to an older revealed
  item.

**Out:**

- Changing the panel's page size, pagination or sorting rules.
- Reconstructing old feed rows from display names.

## Reference

- `docs/agents/decisions.md`, "Revealed and Discarded history".
- `packages/engine/src/actions/game.ts` (`revealedFeed`).
- `packages/engine/test/revealed-feed.test.ts`.

## Approach

In `revealedFeed`, `rememberDiscard` returns early when the row was already
seeded from `discardedItems`. Merge the record's `at` and log index into that
row instead of leaving its `createdAt` null and `logOrder` at -1, and preserve
the existing item/holder so a reshuffle or hidden redraw still leaks nothing.

## Claimed paths

- `packages/engine/src/actions/game.ts`
- `packages/engine/test/revealed-feed.test.ts`
- `docs/agents/tasks/issue-297-revealed-discards.md`, `docs/agents/task-board.md`, `docs/agents/decisions.md`

## Acceptance criteria

- [x] A played card already in the discard pile gets the play timestamp and sorts newest first.
- [x] The row still shows the card as discarded and does not expose a later hidden holder.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [x] Hidden information: no new holder or hidden state leaks; covered by the existing reward-reshuffle test.
- [ ] Verified in the browser: not performed; the engine test reproduces the reported order.

## Open questions

None.

## Handover

Reproduced with a played Barbarian Encampment beside an older revealed item: the
feed row existed but `createdAt` was null, so the card sorted below all dated
rows and the panel's first page never showed it. With the fix, the row carries
the play line's time and appears first.

Validation from the worktree root: `pnpm -r typecheck && pnpm -r test && pnpm -r
build` passed; engine 67 files / 2103 tests, server 40 / 848, web 63 / 1141.
The regression test failed before the source change (`expected null to be
'2026-10-09T10:00:00.000Z'`) and passes after it. Browser check not performed;
the local worktree was not seeded with a live game.
