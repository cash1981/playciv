# Remove the clear-board control

- **Slug:** `issue-14-remove-clear-board`
- **Branch:** `fix/issue-14-remove-clear-board`
- **Owner:** Luna (UI removal), then Claude (full removal)
- **Status:** done

## Goal

Players no longer see a "Clear board" action in the board controls.

## Why

Issue #14 says there is no situation where the destructive clear-board
functionality is warranted.

## Scope

**In:**

- Remove the clear-board button and its confirmation handler from the board UI.

- Remove the whole action: the `clearBoard` engine reducer, the
  `POST /board/clear` route and the `api.clearBoard` client method, plus their
  tests. (The UI button was removed first; the owner then asked for the rest.)

**Out:**

- Keep the `{ kind: 'clear' }` `BoardChange` variant and its replay/undo cases:
  games cleared before this change still carry that history entry.

## Reference

The current control is in `packages/web/src/views/BoardView.tsx`. No game rule
or Java reference is involved.

## Approach

Delete the button block and leave undo, replay, and all other board controls
unchanged.

## Claimed paths

- `packages/web/src/views/BoardView.tsx`

## Acceptance criteria

- [x] The board controls contain no "Clear board" button or confirmation.
- [x] No `clearBoard` reducer, `/board/clear` route or `api.clearBoard` method.
- [x] Undo and replay remain available and unchanged.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.

## Open questions

None.
