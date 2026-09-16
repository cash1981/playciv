# Game fixes — core (engine + server)

- **Slug:** `game-fixes-core`
- **Branch:** `feat/game-fixes` (off `feat/mongodb-storage`)
- **Owner:** coder, orchestrated by Opus
- **Status:** in progress

## Goal

Fix the four confirmed engine/server findings from the review of Luna's work, so
a real game behaves correctly: turns can only be ended by a member, log entries
carry timestamps and read newest-first, and map tiles snap to the grid when
moved (not only when first placed).

## Why

The human tested the mongodb branch and hit "Couldn't find player" ending a
turn, and asked for timestamped, newest-first logs and correctly-aligned tiles.
Luna implemented part of it; Terra's review found gaps. These are the confirmed,
testable findings. The client-visual items (timestamp display format, tech-tree
floating/overlap, collapsible panels, tech pyramid overflow) and the three new
tasks (duplicate start-player asset, civ-tile L-shape placement, zoom panning)
are handled separately.

## The findings, with what I traced

### 1. Turns can be ended by a non-member (server must enforce membership)

`decisions.md` (2026-09-01) records that Java's `endTurn` lets anyone with the
turn pass it on, and that "the authorization lived in the resource layer; the
server package must enforce it." It never was enforced. The `endturn` route
(`packages/server/src/routes/play.ts:314`) and `taketurn` route (:322) only
require `auth` (any logged-in user), so a logged-in non-member can advance
another game's turn — reproduced by Luna (HTTP 200 from an outsider).

**Fix (server):** in both `endturn` and `taketurn`, reject a caller who is not a
player in that game with 403, before calling the engine. Use the existing
membership check `hasUserAccess(state, playerId)` (from `@civ/engine`, already
used by the board routes via `requireAccess`). Load the game, check membership,
then proceed. Keep the engine's "anyone with the turn advances it" behaviour
unchanged — the gate is at the route, matching the documented intent.

Do the same audit for the other mutating turn/game routes that currently only
have `auth` and should require membership (e.g. `updateTurn`, `lockOrUnlockTurn`
if present). Only add the check where a non-member acting would be wrong; do not
touch read routes.

### 2. "Couldn't find player" when ending a turn on an unstarted game

A started game is fine (verified: 2 players get playernumbers 1/2, `yourTurn`
set, `endTurn` advances). The error appears when no player has `yourTurn` —
an unstarted game (all `playernumber: 0`). `endTurn` then returns
`PLAYER_NOT_FOUND`, which the client shows as "Couldn't find player".

**Fix (engine):** when `endTurn` is called and no player has the turn / the game
has not started, return a clear, distinct error (add a `GAME_NOT_STARTED` kind
to `EngineError` and map it to 409 in `packages/server/src/errors.ts`), instead
of the misleading `PLAYER_NOT_FOUND`. Do **not** change the started-game path.
The zero-`playernumber` fallback branch in `endTurn` exists for "old mongo
games", but old `pbf` games are never loaded as `GameState` (they are read-only
— see the mongodb decision), so that branch only ever sees unstarted new games;
have it return `GAME_NOT_STARTED` too rather than advancing by array index.

### 3. Log entries created at game creation have no timestamp

`context.ts:82` (`stampLog`) stamps `createdAt: now` on new log entries after an
engine action — but only inside the `applyToGame` wrapper. The game-create route
(`games.ts` `POST /api/games`) calls `joinGame` and then `context.repo.saveGame`
**directly**, bypassing the stamp, so the "joined / game started" entries keep
`createdAt: null`.

**Fix (server):** stamp the log before saving in the create route. Factor the
stamping in `context.ts` into an exported helper (e.g. `stampNewLogEntries(state,
previousLogIds)` or `stampLog(state)` that stamps every entry whose `createdAt`
is null) and call it in the create route before `saveGame`. A newly created game
has no prior entries, so stamping all null-`createdAt` entries is correct.

### 4. Log is not reliably newest-first

Both log routes (`games.ts:186`, `:205`) sort `(b.createdAt ?? '').localeCompare(
a.createdAt ?? '')`. Stable sort keeps insertion order (oldest-first) for equal
or missing timestamps, so same-second or unstamped entries read oldest-first.

**Fix (server):** give the sort a deterministic newest-first tiebreak. The
engine appends entries in chronological order, so a later position in
`state.log` is newer. Sort by `createdAt` descending, then by original index
descending. Once finding 3 is fixed most entries have timestamps; the tiebreak
covers same-second entries and any legacy null.

## Reference

- `old-civ-rest` — endTurn/takeTurn semantics (anyone with the turn advances);
  do not re-port, just keep the engine behaviour and gate membership at the route.
- `hasUserAccess` in `packages/engine/src/state.ts`.
- The board routes' `requireAccess` pattern in `packages/server/src/routes/board.ts`.

## Claimed paths

- `packages/engine/src/actions/player.ts` (endTurn error)
- `packages/engine/src/errors.ts` (GAME_NOT_STARTED)
- `packages/server/src/errors.ts` (status mapping)
- `packages/server/src/routes/play.ts` (membership on endturn/taketurn/turn routes)
- `packages/server/src/routes/games.ts` (stamp on create; log sort tiebreak)
- `packages/server/src/context.ts` (export the stamping helper)
- `packages/engine/test/`, `packages/server/test/` (tests for each)

## Acceptance criteria

- [ ] A logged-in user who is **not** a member of a game gets 403 from
      `POST /api/games/:id/endturn` and `/taketurn`. A member still succeeds.
      Server test.
- [ ] `endTurn` on an unstarted game returns `GAME_NOT_STARTED` (409), not
      `PLAYER_NOT_FOUND`. A started game advances the turn as before. Engine test.
- [ ] After creating a game, every log entry has a non-null `createdAt`. Server
      test asserts no null timestamps on the freshly created game's log.
- [ ] Both public and private log endpoints return entries newest-first,
      including same-second entries (which must not fall back to oldest-first).
      Server test with two entries sharing a timestamp.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass. Report real
      output.

## Out of scope (later briefs)

- Timestamp **display** format `dd.MM.yyyy hh:mm:ss` (client, LogPanel).
- Tech-tree floating / overlapping turn orders; tech pyramid overflow;
  collapsible panels (client visual).
- Tile snapping on move (finding P2#4) — **moved to a separate brief with the
  civ-tile placement work**, since both touch board tile geometry and want
  browser verification together.
- Duplicate start-player asset; civ-tile L-shape auto-placement; zoom panning.
