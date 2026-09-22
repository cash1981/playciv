# Mobile board placement and movement

- **Slug:** `issue-115-board-mobile`
- **Branch:** `feat/issue-115-board`
- **Owner:** Codex
- **Status:** in progress

## Goal

On a phone or tablet, a player can select a board asset with a tap, pan the
board, and place it with a second tap. Existing pieces can be selected without
starting a drag, while desktop dragging remains available as an enhancement.

## Why

Issue #115 reports that dragging a hut or village on a phone scrolls the page
instead of placing it. The board is the first delivery slice of the issue and
must establish the interaction model used by later battle/arena work.

## Scope

**In:**

- Tap-to-select palette assets and a visible pending-placement state with Cancel.
- Tap the board to place the selected asset using the existing coordinate,
  snapping, stacking and edge-clamping APIs.
- Tap existing pieces to select them without dispatching a move; retain desktop
  pointer dragging with movement tolerance and cancellation cleanup.
- Board sizing/overflow and touch-action rules that allow ordinary panning.
- Component tests for the palette selection affordance and pending state.

**Out:**

- Battle and battle arena touch flows (PR 2).
- Remaining routes, forms and dialogs (PR 3).
- Device/browser matrix and end-to-end gesture testing (PR 4).
- Engine rules or server API changes.

## Reference

The old Angular client used HTML5 drag-and-drop for board placement. This slice
adds a mobile path without changing the engine reducers or server contract.

## Approach

Add an optional palette selection callback and an explicit placement mode to
`BoardView`. The board surface handles a completed tap for placement while a
cancel action clears the selection. Existing-piece pointer gestures track one
primary pointer, movement tolerance and cancellation; a click only selects.
CSS leaves the scroll container pannable and reserves `touch-action: none` for
an actively dragged piece rather than the whole board surface.

## Claimed paths

- `packages/web/src/views/BoardView.tsx`
- `packages/web/src/views/BoardView.test.tsx`
- `packages/web/src/styles.css`
- `docs/agents/tasks/issue-115-board-mobile.md`
- `docs/agents/task-board.md`
- `docs/agents/state.md`

## Acceptance criteria

- [ ] A tap on an available palette asset visibly arms placement and exposes Cancel.
- [ ] With placement armed, a completed tap on the board sends the existing
  `placePiece` request centred at the tapped board coordinate.
- [ ] Board panning remains possible before and after selection; a swipe,
  second pointer or cancelled pointer sends no placement.
- [ ] Desktop drag-and-drop placement and pointer dragging of existing pieces
  still work; a plain click only selects.
- [ ] Component tests cover the mobile affordance and no rule/projection changes.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Browser/device verification is recorded when a connected browser/device
  is available; unavailable checks are reported honestly.

## Open questions

None for this slice. The issue's explicit tap/select/place direction is used.
