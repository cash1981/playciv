-- Chat orders (issue #215): the game chat becomes a timeline that also holds
-- turn orders and system lines. `kind` tells them apart, and `turn_number` and
-- `phase` tag an order (or a done marker) with where it belongs.
--
-- Rows written before this migration read as plain chat: the DEFAULT gives them
-- kind 'chat', and both tags stay NULL, so the classic chat panel is unchanged.
ALTER TABLE chat ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat';
ALTER TABLE chat ADD COLUMN turn_number INTEGER;
ALTER TABLE chat ADD COLUMN phase TEXT;
