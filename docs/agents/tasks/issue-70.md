# Global game revision history and replay

- **Slug:** `issue-70`
- **Branch:** `feat/issue-70`
- **Owner:** Codex
- **Status:** in progress

## Goal

Players can move backward and forward through immutable snapshots of every
shared game-state change and see the whole game page exactly as they were
allowed to see it at that revision, then return to the uninterrupted live game.

## Why

Issue #70 asks for a global Back / Forward / Live timeline instead of the
board-only replay and explicitly requires that “every successful shared
game-state transition should create a revision”. This makes all shared state,
including turn orders, battle, hands, techs and status, auditable together.

## Scope

**In:**

- Immutable full `GameState` snapshots stored outside `GameState`, with
  revision number, timestamp, actor, public/private descriptions and log ids.
- Equivalent save/list/read/delete behavior in the JSON-file and MongoDB
  repositories, including a baseline for existing games and history from game
  creation for new games.
- Authenticated history endpoints that authorize against current membership
  and project snapshots with the same viewer-specific hidden-information rules
  as live state.
- One replay bar below the game header that drives the board, hands/counts,
  techs, player status, battle, turn orders, revealed items and log.
- A read-only historical mode, background live refresh without leaving the
  selected revision, and an indication when newer revisions are available.
- Removal of the board-only replay controls; live board undo remains.

**Out:**

- Private player notes and game/lobby chat, because issue #70 explicitly
  excludes them from revision capture and replay.
- Reconstructing state before the first stored baseline, because incomplete
  reconstruction from board history or log text would be unreliable.
- Browser-local preferences such as auto-refresh.

## Reference

This feature is new and has no Java or AngularJS reference implementation.
Existing `GameState.rev`, `applyToGame`, `toPlayerView`, repository boundaries,
and the board replay visual language are the local references. No board-game
rule is introduced or changed.

## Approach

- Add repository revision types and operations, with one save operation that
  persists the current game and matching revision together. Store JSON
  revisions in the same atomic file snapshot and Mongo revisions in a separate
  collection; delete them with the game.
- Centralize revision construction in the server. Compare pre/post logs to
  attach all new log ids and descriptions; allow routes to supply a readable
  description for successful changes without log entries. Creation records
  revision 0. First access to an older game creates a baseline at its current
  `rev` without reconstructing earlier history.
- Add revision-list and revision-read routes. Read authorization uses the
  current game, while historical payloads are derived from the stored snapshot
  through `toPlayerView` and the same pure helpers used by live auxiliary
  panels. Never return raw `GameState`.
- Hoist revision selection into `GameView`. Historical payloads feed every
  game-state panel, while chat stays live and separate. A single replay flag
  disables all mutations. Auto-refresh updates the live cache and revision
  list but preserves the selected historical revision.
- Remove `BoardView`'s local reconstruction/timeline and make it render the
  supplied live or historical board.

## Claimed paths

- `docs/agents/tasks/issue-70.md`
- `docs/agents/task-board.md`
- `docs/agents/state.md`
- `docs/agents/decisions.md`
- `README.md`
- `packages/server/src/context.ts`
- `packages/server/src/routes/games.ts`
- `packages/server/src/routes/play.ts`
- `packages/server/src/store/types.ts`
- `packages/server/src/store/json-file.ts`
- `packages/server/src/store/mongo.ts`
- `packages/server/test/api.test.ts`
- `packages/server/test/helpers.ts`
- `packages/web/src/lib/api.ts`
- `packages/web/src/views/BoardView.tsx`
- `packages/web/src/views/BoardView.test.tsx`
- `packages/web/src/views/GameView.tsx`
- `packages/web/src/views/TechPanel.tsx`
- `packages/web/src/views/TurnPanel.tsx`
- `packages/web/src/views/StatusPanel.tsx`
- `packages/web/src/views/RevealedPanel.tsx`
- `packages/web/src/views/LogPanel.tsx`
- `packages/web/src/styles.css`

## Acceptance criteria

- [ ] Every successful shared state mutation creates exactly one stored
      revision, even when it creates multiple log entries or no log entry.
- [ ] Private notes and chat create no replay revision.
- [ ] Creation stores revision 0; an existing game gains one reliable baseline
      at its current revision on first revision access/write.
- [ ] JSON-file and MongoDB repositories can save, list, read and delete the
      same revision data; game deletion removes revision history.
- [ ] Only current game members can list or read revisions.
- [ ] Historical endpoints return projected data, never raw `GameState`.
- [ ] Hidden hands, hidden techs, private logs and social policies remain
      private in historical views for at least two different viewers.
- [ ] The global replay bar controls the complete game page and replaces the
      board-only replay UI.
- [ ] All game-state mutations are disabled while replaying; returning to Live
      shows the newest live state.
- [ ] Auto-refresh can discover newer revisions without moving a historical
      viewer back to Live.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Verified in the browser: backward/forward/live changes the entire page,
      replay is read-only, and a background live update is indicated without
      changing the selected historical revision.

## Open questions

None. Issue #70 specifies the storage, security, replay behavior and exclusions
needed to implement the feature without inventing game rules.
