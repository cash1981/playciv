-- Issue #217: game emails are held until the player has opened the game.
-- One row per player and game; either stamp is NULL until it first happens.
-- `email_sent` stays: the Mongo import still fills it, but the app no longer
-- reads it.
CREATE TABLE game_mail (
  game_id    TEXT NOT NULL,
  player_id  TEXT NOT NULL,
  emailed_at TEXT,
  opened_at  TEXT,
  PRIMARY KEY (game_id, player_id)
);
