# Board undo is scoped to the acting player, and gets a redo

- **Slug:** `issue-174-board-undo-redo`
- **Branch:** `feat/issue-174-board-undo-redo`
- **Owner:** Claude (Sonnet 5)
- **Status:** draft

## Goal

Clicking Undo on the board only takes back the current player's own most
recent change, never another player's. Once undone, that same change can be
brought back with a new Redo button. The Undo button itself is only enabled
when the player actually has a change of their own to take back.

## Why

Issue #174 (https://github.com/cash1981/playciv/issues/174), quoting the
reporter directly:

> Undo is broken. It undos other players orders. It should only undo your
> current orders, and then there should be a way to redo the undo. I did one
> undo too much and I couldnt redo it.
>
> Only changes you make should be made possible to undo, and only undo should
> be present if you actually make a change on the map

## Scope

**In:**

- Undo reverts the board's last history entry only when that entry belongs to
  the requesting player; otherwise it is refused rather than reverting someone
  else's move.
- A new Redo brings back the single most recently undone change.
- Redo is cleared the moment any further board change is recorded, by any
  player — the same way a text editor's redo dies once you keep typing.
- The Undo button in `BoardView` is disabled unless the board's last change was
  made by the current player. A new Redo button is disabled unless there is
  something to redo.

**Out:**

- Undoing anything other than the single most recent entry belonging to the
  player (no reaching back over other players' more recent, unrelated moves —
  confirmed with the human; see Open questions).
- A multi-level redo *stack* deeper than the one change just undone — also
  confirmed with the human as out of scope for the stack depth question, but
  see note below: the human asked for "a full stack" for undo/redo depth,
  which this brief satisfies by chaining single-step undo/redo rather than
  keeping a separate multi-entry buffer (see Approach).
- The unrelated card-draw/discard undo-by-vote system
  (`packages/engine/src/actions/undo.ts`, `LogPanel`'s "Ask for undo"). Human
  confirmed this issue is about the board only.

## Reference

None — the board and its history are new in this rewrite (Java had only a
link to a Google slide; see the file header of `packages/engine/src/board.ts`
and `packages/engine/src/actions/board.ts`). This is a design decision, not a
port, so the shape below reflects the human's answers to the clarifying
questions asked before starting (recorded in `docs/agents/decisions.md` once
implemented).

## Approach

- `packages/engine/src/board.ts`: add `redo: readonly BoardHistoryEntry[]` to
  `Board`, alongside `history`. `createBoard` starts both empty.
- `packages/engine/src/actions/board.ts`:
  - `record()` (the single funnel every forward action goes through) also
    resets `redo: []`, so any new change — by any player — clears it.
  - `undoLastBoardChange(state, playerId)`: keep the existing "history empty"
    check, then add: if the last entry's `playerId` is not the caller's,
    return a new error instead of reverting it. On success, move the entry
    from the tail of `history` onto the tail of `redo` (so repeated undo by
    the same player, uninterrupted by anyone else, keeps working — this is
    the "full stack" the human asked for, achieved by chaining single steps
    rather than a separate buffer).
  - New `redoLastBoardChange(state, playerId)`: pops the tail of `redo`,
    re-applies its change with `applyChange`, and appends it back onto
    `history`. Refused with a new error when `redo` is empty. Left open to
    any player with access, matching the existing "everyone may move
    everything" board philosophy — not just whoever undid it.
- `packages/engine/src/errors.ts`: two new `EngineError` kinds —
  `BOARD_UNDO_NOT_YOURS` (403) and `NOTHING_TO_REDO_ON_BOARD` (412, the same
  status as its undo counterpart) — plus `describeError` text and the
  `packages/server/src/errors.ts` status mapping.
- `packages/engine/src/migrate.ts`: a board saved before `redo` existed gets
  `redo: []` on read, the same way `history` was backfilled.
- `packages/server/src/routes/board.ts`: new
  `POST /api/games/:gameId/board/redo`, calling `redoLastBoardChange`.
- `packages/web/src/lib/api.ts`: `redoBoard(gameId)`.
- `packages/web/src/views/BoardView.tsx`: needs to know the current player's
  id to gate the Undo button, so a `youId: string | null` prop is threaded in
  from `GameView.tsx` (`you?.playerId ?? null`). Undo is disabled unless
  `board.history.at(-1)?.playerId === youId`; a new Redo button sits next to
  it, disabled unless `board.redo.length > 0`.
- `packages/web/src/views/FaqView.tsx`: the board FAQ answer is updated to
  describe the new scoping and the redo button.

## Claimed paths

- `packages/engine/src/board.ts`
- `packages/engine/src/actions/board.ts`
- `packages/engine/src/errors.ts`
- `packages/engine/src/migrate.ts`
- `packages/server/src/routes/board.ts`
- `packages/server/src/errors.ts`
- `packages/web/src/lib/api.ts`
- `packages/web/src/views/BoardView.tsx`
- `packages/web/src/views/GameView.tsx`
- `packages/web/src/views/FaqView.tsx`
- `packages/engine/test/board-history.test.ts`
- `packages/server/test/board-api.test.ts`

## Acceptance criteria

- [x] Undo reverts only the acting player's own last board change.
- [x] Attempting to undo when the last change belongs to someone else is
      refused with a distinct error, not silently reverting it.
- [x] A player can undo several of their own changes in a row, as long as
      nobody else has acted in between.
- [x] Redo brings back the single most recently undone change.
- [x] Redo is cleared as soon as any further change is recorded, by anyone.
- [x] The Undo button is disabled unless the current player made the board's
      last change; the Redo button is disabled unless there is something to
      redo.
- [x] A board saved before `redo` existed loads without error.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [x] Hidden information: none of this touches hands or private state — the
      board and its history are already fully public; no new test needed
      beyond the existing ones.
- [~] Verified in the browser: no interactive browser tool was available
      during implementation (see `docs/agents/state.md` for the standing
      note on this); verified instead via engine/server/component tests and a
      manual reading of the built bundle. Left for the human to confirm
      visually.

## Open questions

Asked the human before starting (via `AskUserQuestion`), answers recorded
here and above:

1. Should Undo reach back past other players' unrelated moves to find your
   last change, or only work while your change is still the very last thing
   that happened? → **Only while still last.**
2. Undo/redo depth: one step, or a full stack? → **A full stack** (delivered
   as chained single-step undo/redo, since each undo only ever targets the
   new last entry — see Approach).
3. Does Redo survive another player's unrelated change, or only your own? →
   **Cleared by anyone's next change.**
4. Is this about the board's Undo button, or also the card-draw/discard
   vote-based undo? → **Board only.**
