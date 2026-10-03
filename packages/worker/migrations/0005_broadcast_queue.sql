-- The admin broadcast queue: one message sent over several days, a batch at a
-- time by the daily scheduled job. The recipients are snapshotted when the
-- message is queued.
CREATE TABLE broadcast (
  id                   TEXT PRIMARY KEY,
  subject              TEXT NOT NULL,
  markdown             TEXT NOT NULL,
  include_unsubscribed INTEGER NOT NULL DEFAULT 0,
  per_run              INTEGER NOT NULL,
  -- active, done or cancelled
  status               TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  last_run_at          TEXT
);

-- At most one active queue at a time, enforced by the database so two
-- overlapping "queue it" requests cannot both succeed.
CREATE UNIQUE INDEX broadcast_one_active ON broadcast (status) WHERE status = 'active';

CREATE TABLE broadcast_recipient (
  broadcast_id TEXT NOT NULL,
  player_id    TEXT NOT NULL,
  email        TEXT NOT NULL,
  -- pending, sending, sent or failed. `sending` is never resent automatically:
  -- a crash or timeout mid-send may have delivered the mail.
  status       TEXT NOT NULL,
  sent_at      TEXT,
  error        TEXT,
  PRIMARY KEY (broadcast_id, player_id)
);

CREATE INDEX broadcast_recipient_status ON broadcast_recipient (broadcast_id, status);
