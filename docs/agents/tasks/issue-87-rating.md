# Issue #87: multiplayer rating and cached highscore

- **Slug:** `issue-87-rating`
- **Branch:** `codex/issue-87-rating`
- **Owner:** Codex
- **Status:** in progress

## Goal

Players see a sortable rating on the existing public highscore. Old finished games contribute through a one-time, repeatable migration; new finished games update the rating. Ordinary highscore reads use persisted precomputed data.

## Why

Issue #87 asks for a known open-source rating library and placement estimates from coins, culture, and technology. The human chose shared placement where evidence is uncertain and requested a one-time migration plus a cache for all highscore data.

## Scope

**In:** OpenSkill for 2–5-player results; conservative placement evidence; idempotent legacy backfill from archived `pbf_doc`; durable highscore cache including existing wins, attempts, percentages, civilization tables, and ratings; cache refresh on relevant writes; public sortable rating column; tests and documentation.

**Out:** Guessing exact historical culture positions or spent/earned coin tokens. The old archive has no reliable record of these.

## Reference

Old Java's `GameAction.getPlayerHighScore` and `getCivHighscore` define the existing wins tables. Rating and culture track placement are new behavior specified by issue #87 and the human. `packages/server/src/migrate/rows.ts` archives original `pbf` documents in `pbf_doc`, while `pbf` contains only a summary.

## Approach

Store immutable per-game results and a persisted complete highscore response in D1. Extract old results once from the archived documents, recording explicit winners and conservative evidence for the other participants. Rate all results in a deterministic order with OpenSkill; derived cache can be rebuilt without double-counting. Use tech count, highest reliably owned culture card tier, and only provable coins as evidence. Place tied or incomparable nonwinners in the same non-dominated tier rather than choosing arbitrary weights. Fresh finished games produce results through the same path. Highscore GET reads the cached response; relevant mutations invalidate or refresh it.

## Claimed paths

As listed on the task board.

## Acceptance criteria

- [ ] Every old finished game with a valid winner gets one stable result; rerun does not duplicate games or rating effects.
- [ ] The winner is first; unclear nonwinner ordering ties, including missing data. Culture card transfer and discarded owner IDs are handled conservatively.
- [ ] OpenSkill produces player rating, including uncertainty; all 2–5-player outcomes are supported.
- [ ] Existing highscore values stay compatible; the complete public response is served from durable cache on repeated GETs.
- [ ] Finishing or deleting a game and adding a player keeps the cache correct; tests prove this and that private archived data never reaches the public response.
- [ ] Ratings sort numerically in the UI.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Browser-visible highscore checked if a browser session is available.

## Open questions

None blocking. Conservative comparisons avoid assigning arbitrary numerical weights to the three progress indicators.
