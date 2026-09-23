-- Email verification and social login (issues #42 and #121).
--
-- `email_verified` defaults to 0 for new rows, but the `UPDATE` below marks
-- everything that already exists as verified: those accounts predate the
-- feature and are grandfathered on purpose, so they can keep playing without
-- re-verifying. The migration runs before the deploy, so the `UPDATE` can only
-- touch pre-existing rows and never a new account.
--
-- `oauth_providers` holds the linked identities as JSON text, matching how the
-- JSON repository stores them. The test suite applies this file to an empty
-- database, where the `UPDATE` is a no-op.
ALTER TABLE player ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE player ADD COLUMN oauth_providers  TEXT NOT NULL DEFAULT '[]';
-- Everything that exists before this migration is grandfathered.
UPDATE player SET email_verified = 1;
