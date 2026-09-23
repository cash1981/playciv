# Poll a lightweight game revision before reloading

- **Slug:** `lightweight-poll`
- **Branch:** `fix/lightweight-poll`
- **Owner:** Codex
- **Status:** review-approved (round 2; no findings or nits); PR #153 open

## Goal

An unchanged open game makes one small API request per auto-refresh tick. A changed game still refreshes its view and history, and chat still appears when someone sends a message without changing the game.

## Why

The human asked whether a saved checksum could be compared before fetching all updates. The game already has a monotonic `rev` field. Today a 10-second poll fetches the whole game even when unchanged and increments `reloadCount`, causing roughly ten more panel requests. Cloudflare Free permits only 10 ms CPU per Worker invocation.

## Scope

**In:** A cheap revision read from the D1 `game.rev` column; a client poll that only reloads on change; independent chat polling at the existing 10-second cadence while auto-refresh is on; an optimization to `/revisions` that avoids building a baseline snapshot once history already exists; focused tests.

**Out:** Hashing full game state, caching private player views, changing the interval, changing game rules or history semantics.

## Reference

The revision history and auto-refresh are new in this rewrite; there is no old Java or AngularJS counterpart. Existing behavior is recorded in `docs/agents/tasks/revisions-503.md` and `docs/agents/tasks/issue-139-poll-retry.md`.

## Approach

Expose `GET /api/games/:gameId/rev` using a repository method that reads only the revision counter. Poll that endpoint before the existing consistent reload. Do not advance `reloadCount` when unchanged. Give `ChatPanel` an independent interval tied to the auto-refresh toggle. For `/revisions`, read metadata first and only build a baseline if no history exists, while preserving a missing-game 404.

## Claimed paths

See the `lightweight-poll` block in `docs/agents/task-board.md`.

## Acceptance criteria

- [ ] An unchanged poll reads only the revision counter and leaves the game and history requests untouched.
- [ ] A changed poll reloads game, history, and dependent panels.
- [ ] Chat sent without a game write is visible while auto-refresh is on.
- [ ] The revisions route retains its projection and 404 behavior without serializing a baseline for an existing history.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass.
- [ ] No player-private data is returned by the revision marker.

## Open questions

None. The existing `rev` is the requested change marker, and chat remains on the existing refresh interval.
