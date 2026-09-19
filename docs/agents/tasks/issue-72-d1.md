# Migrate storage from MongoDB to Cloudflare D1 (issue #72)

- **Slug:** `issue-72-d1`
- **Branch:** `feat/issue-72-d1`
- **Owner:** orchestrator (DeepSeek), verified by a second agent
- **Status:** in progress

## Goal

The application's data lives in a Cloudflare D1 (SQLite) database instead of
MongoDB Atlas, and the API runs on the Cloudflare Worker itself with a D1
binding. The restored old `playciv` data — 554 players, 310 old `pbf` games,
87,756 chat messages, 66,288 old `gamelog` entries and the single tournament —
is migrated into D1 tables. The Render proxy, `render.yaml`, MongoDB Atlas and
the `mongodb` driver are gone. Local `pnpm dev` keeps using the JSON file.

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
  that is loaded into D1 with `wrangler d1 execute --remote --file`.
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
- A tournament feature. The old `tournament` document is archived as data, not
  queried by the app.
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
- Lobby chat in the dump has **no** `pbfId` field (83 documents) rather than an
  explicit `null`; Mongo's `{ pbfId: null }` query matched missing fields, so
  the SQL side must map a missing/absent `pbfId` to `NULL`.

## Approach

### Schema (`packages/worker/migrations/0001_initial.sql`)

Hybrid: flat columns for the fields the queries and indices need, and a JSON
payload for the rest of the document.

- `player(id TEXT PK, username, email, password, created_at, role, disabled,
  disable_email)` + `INDEX player_username ON player(username COLLATE NOCASE)`.
- `game(id TEXT PK, rev, active, winner, num_of_players, state TEXT)` +
  `INDEX game_highscore ON game(active, winner)`.
- `game_revision(game_id, revision, created_at, actor_id, actor_username,
  public_description, private_descriptions, log_ids, state, PK(game_id,
  revision))`.
- `chat(id TEXT PK, game_id, username, message, created_at)` +
  `INDEX chat_game_created ON chat(game_id, created_at)`.
- `email_sent(scope TEXT PK, at)`.
- `pbf(id TEXT PK, active, winner, num_of_players, players TEXT, doc TEXT)` +
  `INDEX pbf_highscore ON pbf(active, winner)`. `players` is the highscore
  roster (`[{username, civName}]`), `doc` the full normalized document.
- `gamelog(id TEXT PK, game_id, username, public_log, created_at)` +
  `INDEX gamelog_game ON gamelog(game_id)` — archival.
- `tournament(id TEXT PK, doc TEXT)` — archival.

`created_at` for old players/games is derived from the ObjectId timestamp, as
`MongoRepository` does today. Legacy `created` arrays become ISO strings.

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
id `055e06d7-5d3b-4d4a-95aa-5d396c04b9bd`) and `migrations_dir`. The
`API_ORIGIN` var and proxy code are deleted, along with `render.yaml`.

### Migration script

`packages/server/src/migrate-to-d1.ts` (run with `tsx`) reads a dump directory,
normalizes extended JSON, maps each collection to its rows, and writes a
`dump.sql` of `INSERT` statements. The pure mapping lives in
`packages/server/src/migrate/dump.ts` and is unit-tested with small fixtures.

## Claimed paths

- `packages/worker/migrations/0001_initial.sql` (new)
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
- `packages/server/src/migrate/dump.ts` (new)
- `packages/server/src/migrate-user-roles.ts` (delete)
- `packages/server/src/seed-test-user.ts` (delete)
- `packages/server/test/d1-sqlite-adapter.ts` (new)
- `packages/server/test/d1-repository.test.ts` (new)
- `packages/server/test/migrate-dump.test.ts` (new)
- `packages/server/test/api.test.ts`
- `packages/server/package.json`
- `packages/server/.env.example`
- `package.json` (add `wrangler` dev dependency)
- `pnpm-workspace.yaml` (`allowBuilds.workerd`)
- `.gitignore` (ignore `dump.sql`)
- `README.md`, `docs/agents/repo-map.md`, `docs/agents/state.md`,
  `docs/agents/decisions.md`, `docs/agents/task-board.md`

## Acceptance criteria

- [ ] `D1Repository` implements every `Repository` method; its compare-and-set
      behaviour matches `MongoRepository`/`JsonFileRepository` (a lost race
      returns false and returns HTTP 409 through the routes).
- [ ] The full API test suite passes against `D1Repository` as well as the JSON
      repo (a parametrised smoke run), so the routes do not depend on Mongo.
- [ ] The migration maps the real dump and the resulting `dump.sql` loads into a
      fresh SQLite database with the row counts the dump has (554 players, 310
      `pbf`, 87,756 chat, 66,288 `gamelog`, 1 tournament), asserted locally with
      `node:sqlite`.
- [ ] No `mongodb` import remains in `@civ/server` or the Worker bundle.
- [ ] `render.yaml` is removed and the Worker has no `API_ORIGIN` proxy.
- [ ] Local `pnpm dev` still runs on the JSON file with the whole suite green.
- [ ] Hidden information: no projection is touched; the existing hidden-info
      tests still pass, and the D1 adapter test asserts a stored game keeps
      private hands private after a round-trip only through `toPlayerView`
      (which is unchanged).
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.

## Open questions

- Cloudflare remote access: `wrangler login` must be completed by the human
  before the remote `dump.sql` import and the migration-count check can run.
  Everything else is verifiable locally.
