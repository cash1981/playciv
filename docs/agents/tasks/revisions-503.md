# The revision list stops reading every revision's full state

- **Slug:** `revisions-503`
- **Branch:** `fix/revisions-503`
- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Status:** in progress

## Goal

Opening a game never shows a cryptic `JSON.parse: …` banner because the server
answered with a body that is not JSON, whatever failed. The Back/Forward history
bar keeps working exactly as it does now, but building its list no longer reads
and parses the full game state of every revision.

The auto-refresh toggle also moves from 30 s to 10 s, because the human asked
for it in the same session.

## Why

The human reported that `https://playciv.app/game/b87c44725c869148` sometimes
showed

> JSON.parse: unexpected character at line 1 column 1 of the JSON data

and did not load the game, then worked again after a few minutes and retries.

Reproduced live against the deployment. `GET /api/games/<id>/revisions`
answered 200 with an 84 KB body about half the time, and otherwise:

```
HTTP/1.1 503
content-type: text/plain; charset=UTF-8

error code: 1102
```

Cloudflare error 1102 is *Worker exceeded resource limits*. Two things combine:

1. **The trigger.** `D1Repository.listGameRevisions` selects the `state` column —
   the full game state of every revision — and `toGameRevision` runs
   `JSON.parse` + `migrateGameState` on each row. The route then throws all of it
   away and returns summaries. Holding every revision's parsed state in one
   array is the CPU/memory cost that tips the Worker over its limit on this
   game.
2. **The misleading message.** `api.ts`'s `request()` called `JSON.parse` on the
   body before checking `response.ok`, so the plain-text error page became a
   `SyntaxError`, and `App.tsx`'s `errorMessage` showed it verbatim. `GameView`'s
   `loadConsistentLive` calls `api.revisions` *first*, so the whole game page
   failed to load.

## Scope

**In:**

- A repository accessor that returns revision metadata **without** `state`, and
  the `/revisions` route using it. The HTTP response must be byte-identical.
- `api.ts` turning a non-JSON response into a clear `ApiError` instead of a
  `SyntaxError`.
- The auto-refresh interval 30 s -> 10 s.

**Out:**

- **Auto-retrying** a failed request in the client. Deferred: the root cause is
  removed, the poll is now every 10 s, and a retry adds back-off and
  idempotency semantics that deserve their own brief.
- **Paginating or caching** the revision list. The 84 KB response stays; only
  the D1 read and the parsing are removed.
- **Restructuring `GameView`'s load/consistency logic** (issue #70). The
  interval becomes one named constant, nothing else moves.
- A browser pass on the error banner. Producing a non-JSON 5xx from the local
  Node server is not possible; the unit test is the evidence for that half.

## Reference

There is no counterpart in the old system: full-game revision snapshots are
issue #70, a new-client mechanic (see `state.md`), and the 30 s auto-refresh is
issue #63's, also new. 10 s is a direct request from the human, so it is a
deliberate product change, recorded in `decisions.md`.

## Approach

- `packages/server/src/store/types.ts`: add
  `GameRevisionMetadata = Omit<GameRevision, 'state'>` and
  `listGameRevisionSummaries(gameId)` to `Repository`. `listGameRevisions` stays
  as it is — `api.test.ts` asserts on `.state`.
- `packages/server/src/store/d1.ts`: a `REVISION_METADATA_SELECT` that omits
  `state`, a `RevisionMetadataRow` without it, `toGameRevisionMetadata`, and the
  method.
- `packages/server/src/store/json-file.ts`: the same method, derived from the
  in-memory revisions.
- `packages/server/src/routes/games.ts`: the `/revisions` route calls the new
  method; `revisionSummary` takes `GameRevisionMetadata`.
- `packages/web/src/lib/api.ts`: parse the body with a `try` and a `NOT_JSON`
  sentinel. `!response.ok` throws an `ApiError` carrying the server's
  `{ error, message }` when the body is JSON, and otherwise a message naming the
  status and the body. A 2xx body that is not JSON throws an `ApiError` with
  code `INVALID_RESPONSE`.
- `packages/web/src/views/GameView.tsx`: an exported `AUTO_REFRESH_MS = 10_000`
  used by the interval and by the toggle's title.

## Claimed paths

- `packages/server/src/store/types.ts`
- `packages/server/src/store/d1.ts`
- `packages/server/src/store/json-file.ts`
- `packages/server/src/routes/games.ts` (`revisionSummary` and the `/revisions`
  route only)
- `packages/server/test/d1-repository.test.ts`
- `packages/server/test/api.test.ts` (a revision-projection assertion only)
- `packages/web/src/lib/api.ts`
- `packages/web/src/lib/api.test.ts` (new)
- `packages/web/src/views/GameView.tsx` (the auto-refresh constant, effect and
  title only)
- `docs/agents/tasks/revisions-503.md`
- `docs/agents/task-board.md`, `docs/agents/state.md`, `docs/agents/decisions.md`

## Acceptance criteria

- [ ] `GET /api/games/:gameId/revisions` returns the same payload it does today,
      and the repository read no longer selects `state`.
- [ ] A repository test proves the metadata accessor carries no `state` and
      keeps the revision order and the per-viewer private descriptions.
- [ ] A server test proves the route still projects only the viewer's own
      `privateDescription` and never ships a revision `state`.
- [ ] An `api.ts` test proves a `503` `text/plain` body rejects with an
      `ApiError` whose message names the status, not a `SyntaxError`.
- [ ] Auto-refresh is 10 s and the toggle's `title` says so.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Hidden information: the route's payload is unchanged; the existing
      private-history tests still pass.
- [ ] Post-deploy, the live endpoint no longer answers 1102 across repeated
      requests. This cannot be checked before the human deploys; it is called
      out in the PR.

## Open questions

None.
