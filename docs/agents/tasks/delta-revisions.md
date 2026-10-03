# Delta storage for game revisions

- **Slug:** `delta-revisions`
- **Branch:** `feat/delta-revisions`
- **Owner:** orchestrator (Claude); implementation by the `coder` role
- **Status:** claimed
- **Issue:** cash1981/playciv#238, phases 1 and 2. Phase 3 (gzip of keyframes) is out of scope and decided later.
- **Depends on:** the finished-game cleanup (PR #239, merged). It deletes all revisions of a finished game except the newest, which is only safe while every row is a full state. This task must keep that true (see "Interaction with the cleanup").

## Goal

`game_revision` stops storing a complete `GameState` per action. A revision is either a **keyframe** (full state) or a **delta** against the previous revision. Reading a revision still returns a full `GameState`; no route, projection or client changes.

## Why

On 2026-10-03 the production D1 database hit the 500 MB free limit. 446 MB was `game_revision` (about 416 KB per revision, 2 084 rows). About 72% of every copy is two append-only lists (`log`, `board.history`). Measured on the last 40 revisions of the largest game, a delta has a median of 756 bytes, an average of 2.5 KB and a maximum of 17 KB. The stop-gap deletion and the finished-game cleanup shrink the table, but a running game still adds about 400 KB per move. See issue #238 for the full analysis; read it first.

## Design (decided, follow it)

- **Codec**, a new module in `packages/server/src`, no new dependency, runs on Workers and Node:
  - Objects: recurse by key; a key missing in the new value is a delete, a new key is a set.
  - Arrays: if the old array is a prefix of the new one, store only the appended tail (`log`, `board.history`). If the elements carry a stable key (`id`, `playerId`, `itemNumber`, or whatever the data really has; look at `GameState`), diff by that key (added, removed, changed). If lengths are equal, diff element by element. Otherwise replace the array. Do **not** use RFC 6902 / `fast-json-patch` (index based; removing one card from a 229 item deck would rewrite every following element).
  - Scalars: replace. `null`, `undefined`-as-absent and key order must round-trip exactly as `JSON.parse(JSON.stringify(x))` would give.
  - `apply(prev, diff(prev, next))` deep-equals `next`, always.
- **Safety on write:** after computing a delta, apply it to the previous state and compare with the new state (deep equal). If they differ, or the delta is larger than about half of the full state, write a keyframe. A codec bug then costs space, not correctness.
- **Keyframes:** the first revision of a game, the baseline made by `ensureGameRevision`, and every K-th revision after the last keyframe, K = 25 (a constant in one place). A delta stores `base_revision`, the revision number of the keyframe its chain starts from.
- **Storage:** new migration `packages/worker/migrations/0006_revision_delta.sql`: `ALTER TABLE game_revision ADD COLUMN kind TEXT NOT NULL DEFAULT 'full'` and `ADD COLUMN base_revision INTEGER`. Every existing row stays valid as a keyframe. The `state` column holds the full state for `full` and the delta JSON for `delta`. `listGameRevisionSummaries` never reads `state` and must keep not reading it.
- **Reading revision N:** one query for the keyframe at or below N and every row between it and N (at most K rows), then apply in order. The repository API (`findGameRevision`) still returns a full `GameState`.
- **Writes keep today's semantics:** compare-and-set on the game revision, and the revision insert plus the game update stay in one `batch()`. Writing a revision may read only what is cheap: the previous revision's metadata (`kind`, `revision`, `base_revision`, no `state`) and the previous *state*, which the caller already has loaded (the live game before the action). Prefer passing the previous state in from the caller over an extra D1 read of 400 KB; justify your choice in `decisions.md`.
- **Both stores:** `JsonFileRepository` gets the same logic so local dev and most tests behave like D1. The `node:sqlite` harness covers the SQL, with every migration applied.

## Interaction with the cleanup (critical)

`deleteOldGameRevisions` keeps the newest revision and deletes the rest. If the newest revision is a delta, deleting its keyframe destroys it. Fix it so that after a cleanup the one remaining revision is a **keyframe**: reconstruct the newest revision, write it as `full` (with `base_revision` = its own number), then delete the older rows, all in the same guarded batch or an equivalent that cannot leave a half state. Verify the reconstructed state equals what `findGameRevision` returned before. Keep the existing refusal for running games, the idempotency and the result shape. Add tests for a finished game whose newest revision is a delta.

Also check every other place that deletes or rewrites revision rows (`deleteGame`, anything in the Worker) for the same chain problem.

## Backfill (phase 2)

Existing full rows must be converted into delta chains to free the space already used (about 150 MB today).

- An admin route `POST /api/admin/games/revisions/compact` with `{ gameId?: string }` and a matching dry run `GET /api/admin/games/revisions/compact` that reports, per game, revisions, how many are still `full`, and the bytes a conversion would free. Admin guard, same error style as the cleanup routes. Answers counts and names only, never state.
- Convert game by game, in order. For each revision to convert: reconstruct it from the new representation and compare with the original **before** replacing anything (deep equal); on the first mismatch abort that game, leave it untouched and report it. A conversion is an `UPDATE` of one row (`state` becomes the delta, `kind = 'delta'`, `base_revision` set), each guarded by `WHERE kind = 'full'` so a repeated run changes nothing. Keep keyframes every K.
- Stay inside the Worker limits: the free plan allows 50 subrequests per request and has small CPU. Work in chunks with a cap per request (revisions or games, your choice, justified by measurement or by arithmetic in `decisions.md`) and report `remaining` so the admin can press again. A game that is being played right now must not be corrupted: converting rows of a running game must not race the live writes (the live write only touches the newest row and inserts the next; think it through and write down why it is safe, or skip the newest revision of a running game).
- Admin page: a small panel "Compact revision history" next to the cleanup panel: load the dry run, show per game the numbers, a button per game and "Compact all", with a confirmation. Match the cleanup panel's look and tests.
- The owner takes a D1 Time Travel bookmark before running it; say so in the panel text and the README.

## Out

- gzip or any compression (phase 3).
- Changing what a revision means, the history routes, projections or the client.
- Event sourcing (rejected in #238).
- Any run against production. No `wrangler` commands.

## Paths

- `packages/worker/migrations/0006_revision_delta.sql`
- `packages/server/src/` a new codec module (for example `revision-delta.ts`), `store/types.ts`, `store/d1.ts`, `store/json-file.ts`, `context.ts` and `routes/games.ts` only where a save passes the previous state, `routes/admin.ts` (the compact routes)
- `packages/server/test/` new tests and the existing repository test helpers
- `packages/web/src/lib/api.ts` (compact functions only), `packages/web/src/views/AdminView.tsx` and its test
- `docs/agents/decisions.md`, `docs/agents/state.md`, `README.md`

## Tests that must exist

- **Codec:** a round-trip property test over many random states and over recorded real states (play real games through the engine and take consecutive states): `apply(prev, diff(prev, next)) === next`. Append, remove from the middle of a keyed array, reorder, nested change, key added and removed, `null`, empty arrays and objects, and a delta that is too large falling back to a keyframe.
- **Both stores:** a long game (more than 2K revisions) written through `saveGameWithRevision`: every revision reads back deep-equal to what was saved, keyframes appear at the right places, most rows are deltas and small, `listGameRevisionSummaries` does not touch `state`, a concurrent write is still refused, `ensureGameRevision` writes a keyframe.
- **Safety on write:** inject a codec that returns a wrong delta; the store writes a keyframe and the read is still correct.
- **Cleanup:** the newest revision a delta, after a cleanup the single row is a keyframe and equals the original; running game refused; second run no-op.
- **Compact:** converts a legacy all-`full` game and every revision still reads back deep-equal; a second run changes nothing; a corrupted conversion (inject a bad delta) aborts the game and leaves its rows untouched; a running game is not damaged; the per-request cap and `remaining`; 403 for non-admin.
- **Hidden information:** a spectator reading an old revision through the history route that is stored as a delta still gets no hands and no unrevealed techs; no route ever returns a stored delta.
- **Web:** the compact panel loads the dry run, confirmations show the numbers, single and all call the right requests, errors are shown.

## Measure and record (in `decisions.md`)

Using real-shaped data (a long game played through the engine, not toy states): average and largest delta size, the share of keyframes, the size of a revision chain before and after, and the time to read the oldest and the newest revision of a 500 revision game in the JSON store and in the `node:sqlite` D1 harness. If reading the worst case (K deltas on a 400 KB state) is slow, say so and propose a smaller K.

## Done when

`pnpm -r typecheck && pnpm -r test && pnpm -r build` pass, the read-only reviewer's last round has nothing above a nit, the compact panel has been looked at in a real browser against a local server (a game with many revisions, dry run, compact, reading its history afterwards), and the PR description gives the deploy order and rollback: apply migration 0006, deploy the Worker, take a Time Travel bookmark, dry run, compact one game and look at its history, then compact all. Old rows stay valid without any conversion, so the migration and deploy are safe on their own.
