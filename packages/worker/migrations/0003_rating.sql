-- Immutable historical results and a complete materialized public response.
CREATE TABLE rated_result (
  id TEXT PRIMARY KEY,
  sort_key TEXT NOT NULL,
  participants TEXT NOT NULL
);
CREATE INDEX rated_result_order ON rated_result (sort_key, id);
CREATE TABLE highscore_cache (
  key TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  response TEXT NOT NULL
);
CREATE TABLE highscore_generation (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL
);
INSERT INTO highscore_generation (id, version) VALUES (1, 0);

-- Triggers keep source mutation and invalidation in the same SQLite transaction.
CREATE TRIGGER highscore_player_insert AFTER INSERT ON player BEGIN
  UPDATE highscore_generation SET version = version + 1 WHERE id = 1;
END;
CREATE TRIGGER highscore_player_delete AFTER DELETE ON player BEGIN
  UPDATE highscore_generation SET version = version + 1 WHERE id = 1;
END;
CREATE TRIGGER highscore_player_rename AFTER UPDATE OF username ON player BEGIN
  UPDATE highscore_generation SET version = version + 1 WHERE id = 1;
END;
CREATE TRIGGER highscore_game_insert AFTER INSERT ON game
WHEN NEW.active = 0 AND NEW.winner IS NOT NULL AND NEW.winner <> '' BEGIN
  UPDATE highscore_generation SET version = version + 1 WHERE id = 1;
END;
CREATE TRIGGER highscore_game_update AFTER UPDATE ON game
WHEN (OLD.active = 0 OR NEW.active = 0) AND
     (OLD.active <> NEW.active OR OLD.winner IS NOT NEW.winner OR OLD.state <> NEW.state) BEGIN
  UPDATE highscore_generation SET version = version + 1 WHERE id = 1;
END;
CREATE TRIGGER highscore_game_delete AFTER DELETE ON game
WHEN OLD.active = 0 AND OLD.winner IS NOT NULL AND OLD.winner <> '' BEGIN
  UPDATE highscore_generation SET version = version + 1 WHERE id = 1;
END;
CREATE TRIGGER highscore_result_insert AFTER INSERT ON rated_result BEGIN
  UPDATE highscore_generation SET version = version + 1 WHERE id = 1;
END;
CREATE TRIGGER highscore_result_update AFTER UPDATE ON rated_result BEGIN
  UPDATE highscore_generation SET version = version + 1 WHERE id = 1;
END;
CREATE TRIGGER highscore_result_delete AFTER DELETE ON rated_result BEGIN
  UPDATE highscore_generation SET version = version + 1 WHERE id = 1;
END;
