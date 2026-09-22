# Put the front page's Open and Join buttons first

- **Slug:** `front-page-actions-first`
- **Branch:** `feat/front-page-actions-first`
- **Owner:** orchestrator (DeepSeek V4.1 Flash); implementation by the `coder` role
- **Status:** draft

## Goal

On the front page's **Active games** table, the row's action — **Open** for a
game the player is already in, **Join** for one with a free seat — is the last
of seven columns. On a narrow screen the table scrolls sideways, so the buttons
sit off the right edge and need a horizontal scroll to reach. When this is done
the **Action** column is the first column of that table, so the buttons a player
can act on are visible without scrolling; the remaining columns keep their
existing relative order.

## Why

The human asked directly, in Norwegian: *"Kan du bytte plassering på forsiden på
action knappene join og open slik at de kommer først? Det er mer mobil vennlig så
slipper man å måtte scrolle bort."* — move the two buttons so they come first,
because it is more mobile friendly and saves scrolling over to them.

This is a deliberate deviation from the old client's column order (see
`Reference`); the human is the authority for it.

## Scope

**In:**

- The active games table's column order becomes
  **Action, #, Created, Name, Type, Number of players, Players**. Only the
  Action column moves; every other column keeps its old relative order.
- The Action cells and header, now at the left edge, align left instead of
  right (`.action-cell` in `styles.css`), with the comment updated to match.
- The module and `columnsFor` doc comments in `GameList.tsx` that spell out the
  old column order are updated to the new one.
- `GameList.test.tsx` is updated for the new order, and gains a case that fails
  if the Action column moves out of first place.
- `decisions.md` records the deviation from the old column order and the README
  game-list paragraph mentions it.

**Out:**

- **The Finished games table does not change.** It has no Action column (a
  finished game has nothing to open or join), so it keeps
  **#, Created, Name, Type, Number of players, Players**.
- **No change to button labels, colours, sizes or behaviour** — this is the
  placement only; `Open`, `Join`, `Full` and "Sign in to join" are untouched.
- **No mobile card layout.** A responsive re-layout of the table is a bigger
  question the human has not asked for; moving the column is what they asked
  for.
- **No sortable header for Action.** It is an action, not a value to sort by;
  it stays unsortable exactly as it is.

## Reference

The old client's Active Games table (`old-civ-web/app/views/list.html`) ordered
its columns `#`, Created, Name, Type, Number of players, Players, Action — the
order `GameList.tsx` still documents. This change moves Action to the front on
the human's request; it is a UI layout choice, not a game rule. The old system
has no equivalent (its Join action was already in the last column), so there is
nothing to reproduce here beyond recording the deviation.

## Approach

- `packages/web/src/views/GameList.tsx`: in `columnsFor`, build the Action
  column first when `options.withAction` is true, then push the six existing
  columns in their current order. Update the `columnsFor` comment and the module
  doc comment that list the old column order.
- `packages/web/src/styles.css`: change `.data-table .action-cell` to
  `text-align: left` and reword its comment from "to the right of the table".
  The `SortableTable.tsx` class-name hook on `key === 'action'` is unchanged;
  only its now-stale "right-aligns" comment is corrected.
- `packages/web/src/views/GameList.test.tsx`: make the `names()` helper find the
  Name link instead of the third cell, so it works whichever tab is open (the
  two tabs now have different column positions). Update the "empty Created cell"
  index for the new active-table order. Add a case asserting the active table's
  first header is **Action**, that the first body cell holds the row's button,
  and that the Finished table has no Action column.
- `docs/agents/decisions.md` (append) and `README.md` (the game-list paragraph)
  record the new order as a deliberate change from the old client.

## Claimed paths

- `packages/web/src/views/GameList.tsx`
- `packages/web/src/views/GameList.test.tsx`
- `packages/web/src/views/SortableTable.tsx` (`action-cell` comment only)
- `packages/web/src/styles.css`
- `docs/agents/tasks/front-page-actions-first.md`
- `docs/agents/task-board.md`
- `docs/agents/state.md`, `docs/agents/decisions.md`, `README.md`

## Acceptance criteria

- [ ] On the Active games tab the first column is **Action**, holding the row's
      `Open` / `Join` / `Full` button or the "Sign in to join" text; the other
      six columns follow in their existing order.
- [ ] The Finished games tab is unchanged and has no Action column.
- [ ] The Action column is left-aligned, matching its new position.
- [ ] The old client's `#, Created, …, Action` order is recorded as deliberately
      changed in `decisions.md` and `README.md`.
- [ ] A test fails if the Action column is not first on the Active games table.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass
- [ ] Hidden information: no projection or data shape changes; the cells render
      `game.id` and fields already public in the list, so nothing can leak.
- [ ] Verified in the browser: **not possible in this session** unless a browser
      is connected; the column order is asserted in jsdom and the visual pass is
      left to the human.

## Open questions

_None._ The human named the change and the reason; the column order is the
only open detail and "Action first" is what they asked for.
