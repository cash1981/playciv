-- Delta storage for game revisions (issue #238).
--
-- A revision used to be a complete copy of the game state, 200 to 420 KB each.
-- It is now either a keyframe (the full state) or a delta against the revision
-- before it, with a keyframe at least every 25 rows. `state` holds the full
-- state for `full` and the delta JSON for `delta`; `listGameRevisionSummaries`
-- never reads it.
--
-- Every existing row stays valid as it is: a full state, `kind = 'full'`, and a
-- NULL `base_revision` that reads as "its own number". Nothing needs converting
-- for the new code to work; the admin "Compact revision history" turns old rows
-- into deltas later, game by game.
--
-- kind          'full' (keyframe) or 'delta'.
-- base_revision The keyframe a row's chain starts from: its own number for a
--               keyframe, NULL on rows from before this migration.
-- sealed        1 when the live game changed after this revision without a new
--               one being recorded (an admin setting, say), so the next revision
--               must be a keyframe: a delta would be against a state that no
--               longer matches this row. Plain private notes do not set it,
--               because revisions never carry notes.
ALTER TABLE game_revision ADD COLUMN kind TEXT NOT NULL DEFAULT 'full';
ALTER TABLE game_revision ADD COLUMN base_revision INTEGER;
ALTER TABLE game_revision ADD COLUMN sealed INTEGER NOT NULL DEFAULT 0;

-- The code that wrote the existing rows did not track changes the history does
-- not record (an admin setting saved without a revision, say), so nothing says
-- the live game still equals its newest revision. Seal every game's newest row:
-- the first revision written after the deploy is then a keyframe, and deltas
-- start from a state known to be right.
UPDATE game_revision SET sealed = 1
WHERE revision = (SELECT MAX(r.revision) FROM game_revision r WHERE r.game_id = game_revision.game_id);
