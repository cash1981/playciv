-- SQLite's NOCASE collation folds ASCII only, but the JSON repository folds
-- usernames with JavaScript's Unicode-aware `toLowerCase`. Login must behave the
-- same against D1 and locally, so store the JavaScript-folded value in its own
-- column and query that. `username` itself stays as typed; nothing compares it
-- any more, so its old NOCASE index is dropped.
--
-- The backfill uses SQLite's `lower()`, which is ASCII-only, but every restored
-- username folds to itself under both rules: the four non-ASCII names
-- (`Mały`, `Mały Farciar`, `Schnüdel`, `歐派黨民`) use characters with no case
-- mapping, so `lower()` and `toLowerCase()` agree on all 554 rows. Rows created
-- after this migration are folded in JavaScript on the way in.
--
-- Not UNIQUE: the restored data already contains case-insensitive duplicates
-- (`shogun75`, `rogerio_aa`), exactly as the JSON repository tolerates.
ALTER TABLE player ADD COLUMN username_lower TEXT NOT NULL DEFAULT '';

UPDATE player SET username_lower = lower(username);

DROP INDEX IF EXISTS player_username;
CREATE INDEX player_username_lower ON player (username_lower);
