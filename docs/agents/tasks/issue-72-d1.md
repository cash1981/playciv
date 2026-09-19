# Migrate storage from MongoDB to Cloudflare D1 (issue #72)

- **Slug:** `issue-72-d1`
- **Branch:** `feat/issue-72-d1`
- **Owner:** orchestrator (DeepSeek), verified by a second agent
- **Status:** in review

## Goal

The application's data lives in a Cloudflare D1 (SQLite) database instead of
MongoDB Atlas, and the API runs on the Cloudflare Worker itself with a D1
binding. Only the restored old data the app actually uses is migrated: the 554
`player` accounts and the 310 old `pbf` games (the full documents, for the
highscore and possible future statistics). The old `chat`, `gamelog` and
`tournament` data is deliberately dropped — the mongodump backup keeps it. The
Render proxy, `render.yaml`, MongoDB Atlas and the `mongodb` driver are gone.
Local `pnpm dev` keeps using the JSON file.

## Why

GitHub issue #72. The API cannot run on workerd today because the MongoDB
driver's cursor queries hang there, so production runs the API on Render's free
tier (30–50 s cold start) against Atlas. Moving storage to D1 removes both the
cold start and the Atlas dependency, keeps Worker and data co-located at the
edge, and stays exportable (`wrangler d1 export`). The owner confirmed the
direction and chose to cut Render + Mongo in this branch rather than run the two
storage paths side by side.

## Scope

**In:**

- D1 schema and indices in `packages/worker/migrations/0001_initial.sql`.
- `D1Repository` implementing the existing `Repository` interface, with the
  same compare-and-set semantics as today's `MongoRepository`.
- An automated test suite for `D1Repository` that needs no database and no
  workerd: a thin D1 adapter over Node's built-in `node:sqlite`.
- The Worker runs the Hono API directly with the D1 binding; the `/api/*` proxy
  and `render.yaml` are removed.
- A one-off migration script that reads the local mongodump JSON export
  (`Civilization/database backup/mongo`, gitignored) and produces a `dump.sql`
  that is loaded into D1 with `wrangler d1 execute --remote --file`. It migrates
  only `player` and `pbf` (the account records and the full old games).
- Removing `MongoRepository`, the `mongodb` dependency and the two
  Mongo-only scripts (`seed:test-user`, `migrate:user-roles`); their jobs are
  either obsolete (roles now arrive in the migrated data) or served by the
  local JSON file.
- Docs: `decisions.md`, `state.md`, `README.md`, `repo-map.md`.

**Out:**

- Full relational normalization of `GameState` internals. The `Repository`
  boundary always reads and writes a whole game, so normalizing players/log/
  items/board into their own tables buys nothing and couples the schema to the
  engine's state shape and its `migrateGameState` history.
- Migrating old `pbf` games into playable `GameState`. They stay read-only and
  are a highscore source only, exactly as the 2026-09-16 decision records.
- Migrating the old `chat`, `gamelog` and `tournament` data. `chat` is a live
  feature, so its table stays, but the 87,756 old messages are dropped along
  with the 66,288 `gamelog` rows and the single `tournament` document. The owner
  keeps the mongodump backup for anything that might be wanted later. Dropping
  them is also what keeps the import under D1's free-tier daily row-write limit.
- A tournament feature. The old document is not carried into D1 at all.
- Changing local development off the JSON file. `pnpm dev` stays Node + JSON,
  per the owner's choice; D1 is production-only.

## Reference

- Issue #72 proposed the JSON-blob-per-row approach; the owner chose a hybrid
  (flat columns for what we query plus a JSON payload) in conversation.
- `Repository`: `packages/server/src/store/types.ts`.
- Behaviour to reproduce exactly: `packages/server/src/store/mongo.ts` and
  `packages/server/src/store/json-file.ts`.
- The dump: `Civilization/database backup/mongo/playciv.<collection>.json`, a
  pretty-printed extended-JSON array whose only special type is `{"$oid": …}`.
  It was exported from the restored `playciv` database after the new app had
  run against it: all 554 players already carry `role`/`disabled`, 552 still
  have unsalted SHA-1 passwords and 2 have scrypt. It contains no `game_state`,
  `game_revision` or `email_sent` documents, so those tables start empty.

## Approach

### Schema (`packages/worker/migrations/0001_initial.sql`)

Hybrid: flat columns for the fields the queries and indices need, and a JSON
payload for the rest of the document.

- `player(id TEXT PK, username, username_lower, email, password, created_at,
  role, disabled, disable_email)`. `username_lower` is `username` folded with
  JavaScript's Unicode-aware `toLowerCase`, and is what `findPlayerByUsername`
  queries (non-unique index); SQLite's ASCII-only `COLLATE NOCASE` is not used,
  so `Åse`/`åse` behaves the same against D1 as locally. Added by
  `0002_username_lower.sql`, which back-fills migrated rows with `lower()` —
  exact for every restored name, non-ASCII ones included.
- `game(id TEXT PK, rev, active, winner, num_of_players, state TEXT)` +
  `INDEX game_highscore ON game(active, winner)`.
- `game_revision(game_id, revision, created_at, actor_id, actor_username,
  public_description, private_descriptions, log_ids, state, PK(game_id,
  revision))`.
- `chat(id TEXT PK, game_id, username, message, created_at)` +
  `INDEX chat_game_created ON chat(game_id, created_at)`.
- `email_sent(scope TEXT PK, at)`.
- `pbf(id TEXT PK, active, winner, num_of_players, players TEXT)` +
  `INDEX pbf_highscore ON pbf(active, winner)`. `players` is the highscore
  roster (`[{username, civName}]`).
- `pbf_doc(pbf_id, seq, chunk, PK(pbf_id, seq))` — the full old document,
  normalised and chunked at 40 KB. A single `pbf` document reaches 123 KB,
  above D1's ~100 KB per-statement limit, so it cannot be one SQL literal.
  Nothing reads it today; it keeps the old games available for future
  statistics (most-researched tech, items, social policies) without the
  mongodump.

The `chat` table is kept for live chat, with no restored rows. There is no
`gamelog` or `tournament` table: that data is dropped on purpose.

`created_at` for old players is derived from the ObjectId timestamp, as
`MongoRepository` did.

### `D1Repository`

Uses only a small structural `D1Database`-like interface, so the real Worker
binding and the `node:sqlite` test adapter both satisfy it without importing
`@cloudflare/workers-types` into `@civ/server`.

D1 has no interactive transactions and `batch()` is one atomic transaction, so
the compare-and-set operations are written as guarded batches:

- `saveGameWithRevision`: `UPDATE game … WHERE id=? AND rev=?` then
  `INSERT INTO game_revision … SELECT … WHERE EXISTS (SELECT 1 FROM game WHERE
  id=? AND rev=<new>)`. The second statement sees the first's row, so a lost
  race inserts neither.
- `ensureGameRevision`: `INSERT OR IGNORE INTO game_revision … SELECT … WHERE
  EXISTS (SELECT 1 FROM game WHERE id=? AND rev=?)`.
- `claimEmailSlot`: one `INSERT … ON CONFLICT(scope) DO UPDATE SET at=excluded.at
  WHERE at < <cutoff> RETURNING at`, which is atomic and matches Mongo's
  behaviour (a future stamp is not `< cutoff`, so it suppresses).

### Worker

`packages/worker/src/index.ts` serves assets for non-`/api` paths and, for
`/api/*`, builds the Hono app with `new D1Repository(env.DB)` and calls
`app.fetch`. `wrangler.jsonc` gains the `d1_databases` binding (name `playciv`,
id `a289a3f1-e6b1-4831-b35d-9775e222ec69`, re-created for the reduced data) and
`migrations_dir`. The
`API_ORIGIN` var and proxy code are deleted, along with `render.yaml`.

### Migration script

`packages/server/src/migrate-to-d1.ts` is a thin CLI over
`packages/server/src/migrate/run.ts`. The core reads a dump directory,
normalizes extended JSON, maps each collection to its rows, and writes a
`dump.sql` of `INSERT` statements. The pure mapping lives in
`packages/server/src/migrate/rows.ts`, the SQL emission in
`packages/server/src/migrate/sql.ts`, and all three are unit-tested with small
fixtures. A missing dump directory or a missing required collection (`player`, `pbf`)
fails the run with a non-zero exit and leaves the output untouched (`run.ts`
validates before writing; the file is moved into place from a temporary only on
success, so a typo can never produce an empty dump). `chat`, `gamelog` and
`tournament` are not mapped at all.

## Review fixes (first review round)

- **Unicode usernames.** `COLLATE NOCASE` is ASCII-only, so `Åse`/`åse` would
  have behaved differently in production than locally. `0002_username_lower.sql`
  stores JavaScript's `toLowerCase` in its own column, the repository queries
  that, and a test registers `Åse` and finds `ÅSE`.
- **Wrong `--dump` path.** The migration core validates the directory and the
  required collections before writing, writes through a temporary file, and
  refuses to emit an empty dump. `migrate-run.test.ts` covers a missing
  directory, a missing required collection and the happy path, including that a
  previous output file is left untouched on failure.
- **Skipped D1 tests.** The root `engines` is raised to Node `>=24`
  (`node:sqlite` without a flag) and the `describe.skip` guards are removed, so
  a broken D1 path fails the suite loudly instead of reporting green.

## Scope reduction (owner decision, 2026-09-20)

The owner confirmed the old games are unplayable and that only the account
records and the old `pbf` games are wanted. The full `pbf` document is kept
(after reconsidering): it is 876 cheap chunk rows and preserves the option of
later statistics — most-researched tech, items, social policies — that the
highscore columns alone could not answer. Dropped on purpose: the 87,756 old
chat messages (`chat` remains for live chat), the 66,288 `gamelog` rows and the
one `tournament` document. Total writes fall from 466,478 to roughly 2,000, so
the free-tier daily row limit is no longer the constraint.

## Claimed paths

- `packages/worker/migrations/0001_initial.sql` (new), `packages/worker/migrations/0002_username_lower.sql` (new)
- `packages/worker/src/index.ts`
- `packages/worker/package.json`
- `wrangler.jsonc`
- `render.yaml` (delete)
- `packages/server/src/store/d1.ts` (new)
- `packages/server/src/store/mongo.ts` (delete)
- `packages/server/src/store/types.ts`
- `packages/server/src/lib.ts`
- `packages/server/src/index.ts`
- `packages/server/src/migrate-to-d1.ts` (new)
- `packages/server/src/migrate/rows.ts` (new), `packages/server/src/migrate/sql.ts` (new), `packages/server/src/migrate/run.ts` (new)
- `packages/server/src/migrate-user-roles.ts` (delete)
- `packages/server/src/seed-test-user.ts` (delete)
- `packages/server/test/d1-sqlite-adapter.ts` (new), `packages/server/test/migrations.ts` (new)
- `packages/server/test/d1-repository.test.ts` (new)
- `packages/server/test/migrate-dump.test.ts` (new), `packages/server/test/migrate-run.test.ts` (new)
- `packages/server/test/api.test.ts`
- `packages/server/package.json`
- `packages/server/.env.example`
- `package.json` (add `wrangler` dev dependency)
- `pnpm-workspace.yaml` (`allowBuilds.workerd`)
- `.gitignore` (ignore `dump.sql`)
- `README.md`, `docs/agents/repo-map.md`, `docs/agents/state.md`,
  `docs/agents/decisions.md`, `docs/agents/task-board.md`

## Acceptance criteria

- [x] `D1Repository` implements every `Repository` method; its compare-and-set
      behaviour matches `MongoRepository`/`JsonFileRepository` (a lost race
      returns false and returns HTTP 409 through the routes).
- [x] A D1-backed API test exercises registration, game creation, revision
      history, chat and deletion through `D1Repository`, and the existing API
      suite still passes unchanged on the JSON repo.
- [x] The migration maps the real dump; the resulting `dump.sql` loads into a
      fresh SQLite database with the dump's row counts — 554 players, 310 `pbf`
      (plus 876 `pbf_doc` chunks), 247 finished pbf games — and emits no rows
      for the dropped `chat`/`gamelog`/`tournament`, asserted locally with
      `node:sqlite`. The remote D1 is re-created and imported with the same
      counts once the daily write limit resets.
- [x] Every generated SQL statement is under D1's per-statement limit
      (longest 40,106 bytes).
- [x] No `mongodb` import remains in `@civ/server` or the Worker bundle.
- [x] `render.yaml` is removed and the Worker has no `API_ORIGIN` proxy.
- [x] Local `pnpm dev` still runs on the JSON file with the whole suite green.
- [x] Hidden information: no projection is touched; the existing hidden-info
      tests still pass, and the D1 test asserts a stored hidden hand does not
      reach another viewer's `toPlayerView`.
- [x] Username lookup is Unicode case-insensitive against D1 exactly as it is
      against the JSON file (`Åse` / `ÅSE` test).
- [x] A wrong `--dump` path fails with a non-zero exit and leaves any previous
      output untouched; covered by `migrate-run.test.ts`.
- [x] The root `engines` requires Node `>=24`, and the D1 tests no longer skip
      themselves on a supported runtime.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.

## Open questions

- Cloudflare remote access is done. The old `playciv` database is deleted and
  re-created with only the migrated tables; the reduced `dump.sql` is imported
  once the free-tier daily row-write limit resets (00:00 UTC). Local
  development remains on the JSON file.
