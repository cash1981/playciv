# Make the 10 s poll cheap, and survive a gateway blip

- **Slug:** `issue-139-poll-retry`
- **Branch:** `feat/issue-139-poll-retry`
- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Status:** in progress

## Goal

The game page's 10 s auto-refresh stops re-reading the whole revision list when
nothing has happened, and one transient gateway error no longer fails a load
outright. From the player's side: a game left open in a tab polls quietly, and a
single blip at Cloudflare's edge resolves itself instead of showing an error
banner until the next poll.

## Why

The first slice of #139. #138 (PR #138, merged) removed the cause of the live
`503 error code: 1102`, and the human asked to start on what remained: *"Kan du
starte implementering av det som gjenstår."*

Two things are left from #138's own "deliberately left out" list:

- Auto-refresh moved from 30 s to 10 s there, so every watching client fetches
  the game **and** the ~101 KB revision list three times as often, even when
  nothing has changed. The game read already carries `rev`.
- A single `502`/`503`/`504` still rejects the whole load. The human's original
  report was literally "and a few retries it suddenly worked".

The post-deploy check is done: `GET /api/games/b87c44725c869148/revisions`
answered `200` on 8 of 8 requests on 2026-09-23, recorded on #139.

## Scope

**In:**

- A bounded retry in `api.ts`: at most two more attempts, 250 ms then 1 s, and
  **only** for `GET` requests that answer `502`, `503` or `504`.
- A poll that reads the game first and skips the revision list while `rev` has
  not moved (`loadAfterKnownRevision`), delegating to the existing history-first
  pair (`loadConsistentLive`, issue #70) when it has.
- Tests for both.

**Out:**

- **Paginating or caching the revision list.** The largest remaining item and a
  design of its own; #139 says nothing needs it yet. Next slice if wanted.
- **Retrying writes.** The game's actions are not idempotent: a retried
  `endTurn` or `draw` could apply twice. Only `GET` is retried.
- **Retrying a network-level failure** (`fetch` itself rejecting). The issue
  names transient 5xx; a VPN or offline blip is a different decision.
- **A behavioural test for the interval itself.** `GameView.test.tsx` keeps
  pinning `AUTO_REFRESH_MS`; the poll *decision* is covered directly instead,
  which is the part that can be wrong. A real interval test needs the whole
  `GameView` render harness (milkdown, board), which is its own task.
- **The two recorded nits** (`Accept: application/json`; `SELECT *` in the SQL
  guard). Both are in #139 and neither is worth the churn.

## Reference

Client-only. No counterpart in the old system: issue #63 introduced the
auto-refresh toggle and issue #70 the revision history, both this rewrite's own.
No engine, server, route or projection change, so no hidden-information surface
moves.

## Approach

- `packages/web/src/lib/api.ts`: `RETRYABLE_STATUSES = {502, 503, 504}` and
  `RETRY_DELAYS_MS = [250, 1000]`. `request()` gains an `attempt` parameter and
  recurses after the delay when the method is `GET` and the status is retryable.
  Everything else keeps today's behaviour; the final failure is the same
  `ApiError` as before.
- `packages/web/src/views/GameView.tsx`: a new exported
  `loadAfterKnownRevision(loadRevisions, loadView, newestKnownRevision)`.
  It calls `loadView()` once; when `view.rev <= newestKnownRevision` it returns
  `{ view, revisions: null }`, meaning "keep the list you have". Otherwise it
  returns `loadConsistentLive(...)`, so the same-revision guarantee of #70 still
  applies to the read that can actually be inconsistent. `reload` calls
  `applyRevisionList` only when the list is not `null`.
- Tests: `api.test.ts` drives the retry cases with fake timers and asserts a
  write is not retried; `GameView.test.tsx` asserts the skip and the refetch.

## Claimed paths

- `packages/web/src/lib/api.ts`
- `packages/web/src/lib/api.test.ts`
- `packages/web/src/views/GameView.tsx` (`loadConsistentLive`/`reload` region and the
  auto-refresh effect only)
- `packages/web/src/views/GameView.test.tsx`
- `docs/agents/tasks/issue-139-poll-retry.md`
- `docs/agents/task-board.md`, `docs/agents/state.md`, `docs/agents/decisions.md`

## Acceptance criteria

- [ ] A `GET` answering `503` then `200` resolves, with the retry 250 ms later.
- [ ] A `GET` answering `503` twice then `200` resolves, with a 1 s second wait.
- [ ] A `GET` answering `503` every time rejects with the same `ApiError` after
      three attempts, and never loops.
- [ ] A write (`POST`/`PATCH`/`PUT`/`DELETE`) answering `503` is **not** retried.
- [ ] `loadAfterKnownRevision` does not call `loadRevisions` when `view.rev` has
      not moved, and returns the consistent pair when it has.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Hidden information: nothing new is projected; the `PlayerView` and
      revision-list shapes are unchanged.
- [ ] Verified in the browser: not attempted; a gateway failure cannot be
      produced locally, so the tests are the evidence. The live post-deploy check
      is recorded on #139.

## Open questions

None. The one real fork — whether to also paginate the revision list — is left
as the next slice because #139 itself says nothing needs it yet.
