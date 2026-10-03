# Admin cleanup of finished games

- **Slug:** `finished-game-cleanup`
- **Branch:** `feat/finished-game-cleanup`
- **Owner:** orchestrator (Claude); implementation by the `coder` role
- **Status:** claimed
- **Issue:** cash1981/playciv#238 (phase 4). The delta storage (phases 1 and 2) is a separate task that comes after this one.

## Goal

An admin can shrink **finished** games to what is needed to read them afterwards:
the final board, the log and the chat. Everything that only exists to replay the
game step by step is removed. A dry run says what would go before anything is
deleted.

## Why

On 2026-10-03 the production D1 database hit the free plan's 500 MB limit.
446 MB of it was `game_revision`, which stores a full copy of the game state
after every action (issue #70). The owner ran a stop-gap deletion (newest 100
revisions per game kept) and the database is now about 150 MB, but it keeps
growing at about 30 MB a day. Finished games are the cheapest thing to shrink:
nobody replays a game that ended, they open it to read the chat and the log and
to see the final map. Delta storage for running games is tracked in #238 and
comes later.

## What a cleaned finished game keeps

- The live `game` row. It already holds the final state: board and pieces,
  players, the public log, `active`, `winner`. So Highscore, the player rating,
  `rated_result` and `highscore_cache` are unaffected; none of them read
  `game_revision`. Do not touch these.
- Every chat message of the game (`chat`, by `game_id`). Do not touch.
- **One** revision: the newest one (highest `revision`), kept explicitly, so the
  history view and "Live" still have a snapshot and `ensureGameRevision` does not
  have to invent a new baseline.
- `game_mail`, and anything else keyed by the game. Do not touch.

Everything else in `game_revision` for that game is deleted.

## Scope

**In:**

1. **Repository.** New methods on `Repository` (`store/types.ts`), implemented in
   `D1Repository` (`store/d1.ts`) and `JsonFileRepository` (`store/json-file.ts`):
   - a read that returns, for every game with `active = 0`, its id, name,
     revision count and the size in bytes of the revisions that would be
     removed (everything but the newest revision), without loading any `state`
     into memory beyond what a SQL `LENGTH(state)` needs; in the JSON-file
     store compute it from the serialised size;
   - a delete that removes all revisions of one finished game except the newest,
     refuses (returns a distinct result) when the game is not finished or does
     not exist, is one guarded statement (`WHERE game_id = ? AND revision <
     (SELECT MAX(revision) ...) AND EXISTS (SELECT 1 FROM game WHERE id = ? AND
     active = 0)`), and returns how many rows it removed.
2. **Routes** (admin only, in `routes/admin.ts`, same `admin` guard and error
   style as the others):
   - `GET /api/admin/games/cleanup` is the dry run: `{ games: [{ id, name,
     revisions, removableRevisions, removableBytes }], totalRevisions,
     totalBytes }` for finished games only, largest first.
   - `POST /api/admin/games/cleanup` with `{ gameId?: string }`: cleans one
     finished game, or every finished game when `gameId` is absent. Answers the
     per-game counts and the totals. A named game that is running answers 409
     `GAME_ACTIVE`, one that does not exist 404. Idempotent: a second run
     removes nothing and says so.
   - A cleanup over all games must stay inside the Worker's limits: one guarded
     statement per game, and cap the number of games handled per request (for
     example 20) with a `remaining` count in the answer, so the admin can press
     the button again. Do not loop over thousands of rows in one request.
3. **Admin page.** A panel "Clean up finished games" in `AdminView.tsx`: a button
   that loads the dry run and shows a table (game name, revisions, how many MB
   would go, a total), a "Clean up" button per game and a "Clean up all" button,
   each behind a confirmation that repeats the numbers and says plainly that the
   step by step replay of those games is lost while the final board, the log and
   the chat stay. After a run, show what was removed and refresh the list. Match
   the look of the existing admin panels.
4. **Tests** (server, repository, web), listed below.
5. **Docs.** `decisions.md` (append), README (a short paragraph next to the
   admin features; note that D1 may not shrink the reported database size after
   a delete because freed pages are reused, so the size in `wrangler d1 info`
   might not drop at once), `state.md` line. In the README and in the admin
   panel, mention D1 Time Travel as the undo for a mistake
   (`wrangler d1 time-travel info playciv`).

**Out:**

- Any change to how running games store revisions (delta storage, #238 phases 1
  to 3).
- Deleting games, chat, logs or any game state. Only `game_revision` rows.
- Scheduling or automatic cleanup. It is a manual button.
- Cleaning a game that is still running (refused).
- Un-doing a cleanup from inside the app.

## Paths

- `packages/server/src/store/types.ts`, `store/d1.ts`, `store/json-file.ts`
- `packages/server/src/routes/admin.ts`
- `packages/server/test/` (a new `finished-game-cleanup.test.ts`, and the existing repository test helpers)
- `packages/web/src/lib/api.ts` (only the new functions and types), `packages/web/src/views/AdminView.tsx` and its test, and its CSS if any
- `docs/agents/decisions.md`, `docs/agents/state.md`, `README.md`

## Tests that must exist

Repository (both implementations; the D1 one through the existing `node:sqlite`
harness, which applies every migration):

- the dry run lists only finished games and counts everything except the newest
  revision; a running game is not listed;
- the delete keeps exactly the newest revision, removes the rest, and a second
  call removes nothing;
- the delete refuses a running game and an unknown game and removes nothing;
- the delete touches only that game's rows (another game's revisions are
  unchanged);
- `game`, `chat`, `game_mail` and `rated_result` rows are unchanged after a
  delete.

Routes and behaviour:

- 403 for a non-admin on both routes; 409 `GAME_ACTIVE` for a running game; 404
  for an unknown id; the all-games run honours the per-request cap and reports
  `remaining`;
- **the safety test:** build a finished game with several revisions and chat
  messages, fetch the highscore response and the game's projection and chat, run
  the cleanup, and assert the highscore response, the game view, the chat and the
  rating are deep-equal to before; and that reading the history afterwards still
  works (the revision list has one entry, reading it returns the final state
  projected for the viewer, a spectator gets no hands or unrevealed techs, as
  today);
- opening a cleaned game does not create a second baseline revision.

Web:

- the panel loads the dry run, shows the totals, the confirmation text names the
  game and the size, "Clean up all" and a single game call the right requests,
  a 409 message is shown, and the list refreshes after a run.

## Done when

`pnpm -r typecheck && pnpm -r test && pnpm -r build` pass, the read-only
reviewer's last round has nothing above a nit, the admin page has been looked at
in a real browser against a local server (a finished game with revisions, dry run,
clean up, list refreshed), and the PR description tells the owner how to use it
and how to undo it (Time Travel).
