-- Server-only activity and reminder claims. NULL on legacy games: a cron first
-- observes them rather than inferring inactivity from incomplete historic logs.
ALTER TABLE game ADD COLUMN activity_at_ms INTEGER;
ALTER TABLE game ADD COLUMN activity_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE game ADD COLUMN reminder_version INTEGER;
ALTER TABLE game ADD COLUMN reminder_checked_at_ms INTEGER;
CREATE INDEX game_idle_scan ON game(active, reminder_checked_at_ms);

CREATE TRIGGER game_activity_insert AFTER INSERT ON game BEGIN
  UPDATE game SET activity_at_ms = CAST(strftime('%s', 'now') AS INTEGER) * 1000 +
    CAST(substr(strftime('%f', 'now'), 4, 3) AS INTEGER)
  WHERE id = NEW.id;
END;
CREATE TRIGGER game_activity_update AFTER UPDATE OF state ON game
WHEN OLD.state <> NEW.state BEGIN
  UPDATE game SET activity_at_ms = CAST(strftime('%s', 'now') AS INTEGER) * 1000 +
    CAST(substr(strftime('%f', 'now'), 4, 3) AS INTEGER),
    activity_version = OLD.activity_version + 1
  WHERE id = NEW.id;
END;
