# Single chat: chat orders becomes the only view

- **Slug:** `single-chat`
- **Branch:** `claude/pr-218-default-view-wlml28`
- **Owner:** Claude
- **Status:** in progress

## Goal

Every game, running or finished, uses the merged chat and turn orders timeline
(PR #218). There is no switch, no classic Turn orders panel, no classic chat
panel and no baton buttons. Games that were classic open as a single chat with
their old public orders in the timeline. A finished game's revision line names
only the winner.

## Why

The human: "I have tested #218 a while in main now and I like it. I am not going
back to the old view. Make this the new default and remove the option of
turning it on/off. Delete all dead code and migrate any existing to single chat
if not already done. I think that applies to finished game also." And: the
revision line "System: cash won the game! Congratulations! · System: admin
Ended this game — cash" should only say who won.

## Decisions taken (the human did not answer the questions, these are the proposals)

1. Migration is automatic when a game is loaded (pure, in `migrate.ts`) for the
   state, plus an admin route with a dry run for the database rows (copying the
   public classic orders into `chat`). Finished games are included.
2. Finished games are migrated the same way; they show the timeline, and the
   title does not claim anyone is waiting.
3. Only public order history is copied (as today). Drafts and private notes are
   not copied.
4. `chatOrders` leaves `GameState` and `PlayerView`. The baton actions
   (`endTurn`, `takeTurn`), their routes, API calls and buttons go. The per
   player `yourTurn` flag stays as stored data (it also marks "game started"),
   but nothing moves it any more.
5. One PR on this branch; no real D1 is touched.

## Scope

**In:** engine, server, web, worker migration notes, README, docs.
**Out:** the `yourTurn` data field and the order data shape in state (the
timeline reads them); mail hold-until-opened (#217).

## Approach

- Engine: delete `chatOrders`, `setChatOrders`, `CHAT_ORDERS_OFF`, the classic
  branches in `activeTurnStatus`, `draw`, `board`, `turn`, `new-turn`, and the
  baton actions. `migrate.ts` adopts a classic state: when `older.chatOrders` is
  `false`, or when both `chatOrders` and `chatOrdersStartTurn` are missing, set
  `chatOrdersStartTurn = max(older value, playedTurn)`, `startPlayerId` and
  `turnStarters` as `setChatOrders(on)` did. It must be idempotent: a state
  saved by new code has `chatOrdersStartTurn` and no `chatOrders` and is left
  alone. `legacyOrdersCopied` keeps its meaning (the database rows were copied).
- Engine end game: the public log line for a winner reads only the winner.
- Server: remove the toggle route, `copyLegacyOrders` on toggle, classic chat
  array shape (the chat route always answers the timeline), baton routes,
  `chatOrders` branches in notifications. Add `GET`/`POST
  /api/admin/games/migrate-chat` with dry run (like the cleanup route) that runs
  `copyLegacyOrders` for games with `legacyOrdersCopied === false`, then saves
  with the flag true. Revision description for end game shows only the winner.
- Web: remove `TurnPanel`, `ChatPanel`, the classic branches in `GameView`,
  `Navigation`, `StatusPanel`, `api.ts`, the End turn and Take the turn
  buttons, and every test of the classic mode. Replay bar: for a revision whose
  description is a winner line, do not append the actor.
- Docs: README, `state.md`, `decisions.md` (append), this brief.

## Claimed paths

- `packages/engine/src/**`, `packages/engine/test/**`
- `packages/server/src/**`, `packages/server/test/**`
- `packages/web/src/**`
- `README.md`, `docs/agents/**`

## Acceptance criteria

- [ ] No `chatOrders` in `GameState`/`PlayerView`, no toggle in the UI or API.
- [ ] No unused exports, files or tests of the classic mode remain.
- [ ] A classic state loads as a chat-mode state with the right baseline, and
      loading it twice changes nothing more.
- [ ] Finished game: the revision line shows only who won.
- [ ] Hidden information: the migration route copies only `publicOrderVersions`;
      a test proves an unrevealed draft and a private note are not copied.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
