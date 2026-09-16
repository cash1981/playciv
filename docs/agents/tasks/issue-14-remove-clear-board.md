# Remove the clear-board control

- **Slug:** `issue-14-remove-clear-board`
- **Branch:** `fix/issue-14-remove-clear-board`
- **Owner:** Luna
- **Status:** in progress

## Goal

Players no longer see a "Clear board" action in the board controls.

## Why

Issue #14 says there is no situation where the destructive clear-board
functionality is warranted.

## Scope

**In:**

- Remove the clear-board button and its confirmation handler from the board UI.

**Out:**

- Keep the engine reducer and server endpoint for history compatibility; this
  issue only removes the user-facing control.

## Reference

The current control is in `packages/web/src/views/BoardView.tsx`. No game rule
or Java reference is involved.

## Approach

Delete the button block and leave undo, replay, and all other board controls
unchanged.

## Claimed paths

- `packages/web/src/views/BoardView.tsx`

## Acceptance criteria

- [ ] The board controls contain no "Clear board" button or confirmation.
- [ ] Undo and replay remain available and unchanged.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.

## Open questions

None.
