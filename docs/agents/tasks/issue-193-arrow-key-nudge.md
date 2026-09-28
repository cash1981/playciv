# Arrow-key nudge for selected board pieces

- **Slug:** `issue-193-arrow-key-nudge`
- **Branch:** `feat/issue-193-arrow-key-nudge`
- **Owner:** Claude
- **Status:** draft

## Goal

With a piece selected on the board (a building, great person, hut, wonder, unit
or map tile — anything that can already be dragged), the player can nudge it
up, down, left or right by a small amount using the arrow keys, instead of
having to drag it with the mouse or touch. The nudge distance looks the same
on screen at any zoom level.

## Why

Issue #193 (human, verbatim): "You should be able to use arrow to move an item
up, down, left or right slightly at a time. It should be proportional to zoom
size. For instance moving a building or great person or hut."

Dragging a piece a short, precise distance is fiddly, especially at low zoom
where a few screen pixels of mouse movement cover a large board distance.
Arrow keys give a precise, repeatable nudge.

## Scope

**In:**

- A keydown handler in `BoardView.tsx`, active whenever a piece is selected
  (`selectedId !== null`), for `ArrowUp` / `ArrowDown` / `ArrowLeft` /
  `ArrowRight`.
- Applies to every piece category that can already be selected and moved —
  not just building/great person/hut, which the issue gives only as examples.
- The nudge step is a constant number of **screen** pixels, converted to board
  coordinates by dividing by the current `zoom` (mirroring `toBoard`'s
  `/ zoom`), so one press moves the piece the same visible distance regardless
  of zoom level.
- Each keydown (including the browser's own key-repeat while the key is held)
  calls `api.movePiece(gameId, selected.id, x, y)` through the existing `run`
  prop, exactly once per event — the same one-call-per-step shape the pointer
  drag path already uses. No debouncing or batching.
- `preventDefault()` on the handled arrow keys so the page/scroll container
  does not also scroll.
- Respects the existing guards: no-op when `busy || readOnly`, and no-op if
  keyboard focus is inside a form control (input/textarea/select) elsewhere on
  the page, so typing in, say, a chat box does not move the board piece.
- The server (`movePiece` in `packages/engine/src/actions/board.ts`) already
  clamps to the board (`clampToBoard`) and snaps into player-area slots or map
  tile positions exactly as a drag-drop does — the client sends a raw
  `x + dx, y + dy` and lets the existing reducer logic handle bounds/snapping,
  same as a mouse drag already does.

**Out:**

- Any modifier-key variant (Shift for a bigger step, etc.) — not asked for.
- Changing the drag-and-drop or tap-to-move paths.
- Any new keyboard shortcut beyond the four arrow keys (e.g. Delete-to-remove).
- Touch/on-screen controls — this is a physical-keyboard feature.

## Reference

None. Confirmed by search: `old-civ-web` (AngularJS) has no board/map view at
all — no controller, no view, and no keyboard handling on anything resembling
a map. The pixel-coordinate drag board is new in this rewrite, so there is
nothing to port; the design decisions below were settled directly with the
human rather than by precedent (see "Open questions", now answered).

## Approach

All in `packages/web/src/views/BoardView.tsx`:

- Add a `useEffect` similar in shape to the existing outside-click-clears-
  selection effect (lines ~242-253): gate on `selectedId !== null`, attach a
  `document.addEventListener('keydown', ...)`, clean up on unmount/dependency
  change.
- The handler:
  - Returns early unless `event.key` is one of the four arrow keys.
  - Returns early if `busy || readOnly`.
  - Returns early if `document.activeElement` is an `input`, `textarea` or
    `select` (or has `isContentEditable`), so the board does not steal arrow
    keys from an unrelated focused control.
  - Looks up `selected` (already derived from `pieces`/`selectedId`).
  - Computes `dx`/`dy` in board coordinates: a fixed `NUDGE_STEP_PX` constant
    (screen pixels) divided by `zoom`, applied to the correct axis/sign for
    the key pressed.
  - Calls `event.preventDefault()`.
  - Calls `void run(() => api.movePiece(gameId, selected.id, selected.x + dx, selected.y + dy))`.
- Pick `NUDGE_STEP_PX` as a small, clearly-a-nudge value (a handful of screen
  pixels — well under one grid square at any zoom step) and say in a one-line
  comment why that value, since it is otherwise a magic number.
- No engine or server change needed — `movePiece` already exists and already
  clamps/snaps.

## Claimed paths

- `packages/web/src/views/BoardView.tsx`

## Acceptance criteria

- [ ] Selecting a piece and pressing an arrow key moves it one small, visible
      step in the expected direction, at both a high and a low zoom level, and
      the step looks the same size on screen at both.
- [ ] Holding an arrow key down moves the piece repeatedly (OS auto-repeat),
      each step reaching the server.
- [ ] Pressing an arrow key with no piece selected does nothing and does not
      scroll the page.
- [ ] Pressing an arrow key while `readOnly` or `busy` does nothing.
- [ ] Pressing an arrow key while focus is in an unrelated text input does not
      move the board piece and does not block that input's own arrow-key
      behaviour (e.g. moving the text cursor).
- [ ] A piece nudged past the edge of its area/the map behaves exactly as a
      drag to that same spot would (clamped/snapped by the existing
      `movePiece` reducer) — no new client-side bounds logic.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Hidden information: not applicable — this only changes where an already-
      visible piece sits, the same information `movePiece` already exposes.
- [ ] Verified in the browser: nudge a piece at two different zoom levels and
      describe what was seen.

## Open questions

Settled with the human before starting:

- **Scope of piece types:** all movable pieces, not only building/great
  person/hut.
- **"Proportional to zoom" meaning:** constant on-screen step, converted by
  dividing by zoom — not a constant board-coordinate step.
- **Key repeat:** one `movePiece` call per keydown event, including
  auto-repeat; no throttling.
- **Activation:** live whenever a piece is selected, not gated on the board
  surface itself having focus.
