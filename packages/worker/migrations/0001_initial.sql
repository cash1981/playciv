-- D1 schema for playciv (issue #72).
--
-- Hybrid shape: flat columns for the fields the app queries and indexes, and a
-- JSON payload for the rest of each document. The `Repository` boundary always
-- reads and writes a whole game, so the state itself is not normalised.
--
-- Applied with `wrangler d1 migrations apply playciv --remote`. The test suite
-- applies this same file to an in-memory SQLite database, so it is the one
-- source of truth for the schema.

CREATE TABLE player (
  id            TEXT PRIMARY KEY,
  -- Case-insensitive, matching Java's username lookup. ASCII-only folding is
  -- enough: usernames are ASCII in every restored account.
  username      TEXT NOT NULL COLLATE NOCASE,
  email         TEXT,
  password      TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  disabled      INTEGER NOT NULL DEFAULT 0,
  disable_email INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX player_username ON player (username);

CREATE TABLE game (
  id             TEXT PRIMARY KEY,
  rev            INTEGER NOT NULL,
  active         INTEGER NOT NULL,
  winner         TEXT,
  num_of_players INTEGER NOT NULL,
  -- The full GameState as JSON. Migrated games are passed through
  -- `migrateGameState` on read, exactly like the Mongo and JSON repositories.
  state          TEXT NOT NULL
);

-- `finishedGamesForHighscore` reads finished games that have a winner.
CREATE INDEX game_highscore ON game (active, winner);

CREATE TABLE game_revision (
  game_id              TEXT NOT NULL,
  revision             INTEGER NOT NULL,
  created_at           TEXT NOT NULL,
  actor_id             TEXT NOT NULL,
  actor_username       TEXT NOT NULL,
  public_description   TEXT NOT NULL,
  private_descriptions TEXT NOT NULL,
  log_ids              TEXT NOT NULL,
  state                TEXT NOT NULL,
  PRIMARY KEY (game_id, revision)
);

CREATE TABLE chat (
  id         TEXT PRIMARY KEY,
  -- NULL is lobby chat. The restored documents simply omit `pbfId`, and Mongo's
  -- `{ pbfId: null }` query matched a missing field, so the migration writes
  -- NULL for both.
  game_id    TEXT,
  username   TEXT NOT NULL,
  message    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX chat_game_created ON chat (game_id, created_at);

CREATE TABLE email_sent (
  scope TEXT PRIMARY KEY,
  at    TEXT NOT NULL
);

-- The old Java `pbf` collection. Read-only: a highscore source only, never
-- written to by the app. `players` is the highscore roster as JSON.
CREATE TABLE pbf (
  id             TEXT PRIMARY KEY,
  active         INTEGER NOT NULL,
  winner         TEXT,
  num_of_players INTEGER NOT NULL,
  players        TEXT NOT NULL
);

CREATE INDEX pbf_highscore ON pbf (active, winner);

-- The full old `pbf` document, archived in ~40 KB chunks (one row per chunk).
-- A single large document exceeds D1's ~100 KB per-statement limit, so it
-- cannot be one SQL literal; chunking keeps every byte without a statement ever
-- getting close to the limit. The app never reads this table.
CREATE TABLE pbf_doc (
  pbf_id TEXT NOT NULL,
  seq    INTEGER NOT NULL,
  chunk  TEXT NOT NULL,
  PRIMARY KEY (pbf_id, seq)
);

-- Archival only. The app keeps its log inside GameState and does not query
-- these two; they exist so no restored data is left behind in the move.
CREATE TABLE gamelog (
  id         TEXT PRIMARY KEY,
  game_id    TEXT,
  username   TEXT NOT NULL,
  public_log TEXT NOT NULL,
  created_at TEXT
);

CREATE INDEX gamelog_game ON gamelog (game_id);

CREATE TABLE tournament (
  id  TEXT PRIMARY KEY,
  doc TEXT NOT NULL
);
